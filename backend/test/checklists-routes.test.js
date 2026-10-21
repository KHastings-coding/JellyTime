import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, addChild, setClock, startApp, childToken } from './helpers.js';

const { default: router } = await import('../src/routes/checklists.js');
const { addDays, today } = await import('../src/clock.js');

const db = getDb();
setClock(db, 'UTC', '00:00');
const app = await startApp([['/api/checklists', router]]);
after(() => app.close());

const body = kid => ({
  name: 'Morning', reward_minutes: 10, schedule: { type: 'daily' }, items: ['Brush', 'Dress'],
  assignments: [{ childId: kid.id, minutesOverride: null }],
});

test('parent routes reject missing auth (401) and kid tokens (403)', async () => {
  const kid = addChild(db);
  const routes = [
    ['GET', '/api/checklists/templates'], ['POST', '/api/checklists/templates', body(kid)],
    ['PUT', '/api/checklists/templates/x', body(kid)], ['DELETE', '/api/checklists/templates/x'],
    ['GET', '/api/checklists/pending'], ['POST', '/api/checklists/runs/1/review', { action: 'approve' }],
  ];
  for (const [m, p, b] of routes) {
    const none = await app.call(m, p, b, { auth: false });
    assert.equal(none.status, 401, `${m} ${p}`);
    assert.equal((await app.call(m, p, b, { token: childToken(kid.id) })).status, 403, `${m} ${p}`);
  }
});

test('full flow over HTTP', async () => {
  const kid = addChild(db);
  const created = await app.call('POST', '/api/checklists/templates', body(kid));
  assert.equal(created.status, 200);
  const runs = await app.call('GET', `/api/checklists/child/${kid.id}`, undefined, { auth: false });
  assert.equal(runs.body.length, 1);
  const run = runs.body[0];
  for (const i of run.items) {
    const t = await app.call('POST', `/api/checklists/runs/${run.id}/tick`, { childId: kid.id, itemId: i.id, done: true }, { auth: false });
    assert.equal(t.status, 200);
  }
  const sub = await app.call('POST', `/api/checklists/runs/${run.id}/submit`, { childId: kid.id }, { auth: false });
  assert.equal(sub.body.status, 'submitted');
  const pending = await app.call('GET', '/api/checklists/pending');
  assert.equal(pending.body.find(p => p.id === run.id).child_name, kid.name);
  const rev = await app.call('POST', `/api/checklists/runs/${run.id}/review`, { action: 'approve' });
  assert.equal(rev.body.status, 'approved');
  const after = await app.call('GET', `/api/checklists/child/${kid.id}`, undefined, { auth: false });
  assert.equal(after.body[0].status, 'approved');
  const put = await app.call('PUT', `/api/checklists/templates/${created.body.id}`, body(kid));
  assert.deepEqual(put.body, { ok: true });
  const del = await app.call('DELETE', `/api/checklists/templates/${created.body.id}`);
  assert.deepEqual(del.body, { ok: true });
});

test('unknown kid is 404; ticking another kid\'s run is 404', async () => {
  assert.equal((await app.call('GET', '/api/checklists/child/nope', undefined, { auth: false })).status, 404);
  const a = addChild(db), b = addChild(db);
  await app.call('POST', '/api/checklists/templates', body(a));
  const [run] = (await app.call('GET', `/api/checklists/child/${a.id}`, undefined, { auth: false })).body;
  const r = await app.call('POST', `/api/checklists/runs/${run.id}/tick`, { childId: b.id, itemId: run.items[0].id, done: true }, { auth: false });
  assert.equal(r.status, 404);
});

test('GET /pending and /templates sync runs: yesterday\'s open run becomes missed', async () => {
  const kid = addChild(db);
  const { body: { id } } = await app.call('POST', '/api/checklists/templates', body(kid));
  const yesterday = addDays(today(db), -1);
  const ins = d => db.prepare(`INSERT INTO checklist_runs (checklist_id, child_id, date, status, items, reward_minutes, name)
    VALUES (?,?,?,?,?,?,?)`).run(id, kid.id, d, 'open', JSON.stringify([{ id: 'x', label: 'a', done: false }]), 10, 'Morning');
  ins(yesterday);
  assert.equal((await app.call('GET', '/api/checklists/pending')).status, 200);
  const st = d => db.prepare('SELECT status FROM checklist_runs WHERE checklist_id=? AND child_id=? AND date=?').get(id, kid.id, d).status;
  assert.equal(st(yesterday), 'missed');

  const kid2 = addChild(db);
  const { body: { id: id2 } } = await app.call('POST', '/api/checklists/templates', body(kid2));
  db.prepare(`INSERT INTO checklist_runs (checklist_id, child_id, date, status, items, reward_minutes, name)
    VALUES (?,?,?,?,?,?,?)`).run(id2, kid2.id, yesterday, 'open', '[]', 10, 'Morning');
  const list = await app.call('GET', '/api/checklists/templates');
  assert.equal(list.body.find(c => c.id === id2).streaks[kid2.id].streak, 0);
  assert.equal(db.prepare('SELECT status FROM checklist_runs WHERE checklist_id=? AND date=?').get(id2, yesterday).status, 'missed');
});

test('a checklist with corrupt schedule JSON does not break /templates or /pending', async t => {
  t.mock.method(console, 'error', () => {});
  const kid = addChild(db);
  db.prepare("INSERT INTO checklist_templates (id, name, reward_minutes, schedule) VALUES ('bad-sched', 'Bad', 5, '{bad')").run();
  db.prepare("INSERT INTO template_assignments (template_type, template_id, child_id) VALUES ('checklist', 'bad-sched', ?)").run(kid.id);
  assert.equal((await app.call('GET', '/api/checklists/pending')).status, 200);
  const list = await app.call('GET', '/api/checklists/templates');
  assert.equal(list.status, 200);
  assert.ok(!list.body.some(c => c.id === 'bad-sched'));
  db.prepare("UPDATE checklist_templates SET archived=1 WHERE id='bad-sched'").run();
});
