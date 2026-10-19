import { getDb, startApp, setClock } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { default: childrenRouter } = await import('../src/routes/children.js');
const { applyAdjustment } = await import('../src/accounting.js');

const app = await startApp([['/api/children', childrenRouter]]);
after(() => app.close());
const db = getDb();
setClock(db, 'UTC');

let n = 0;
async function create(extra = {}) {
  n += 1;
  const r = await app.call('POST', '/api/children', {
    jellyfin_user_id: `jf-children-${n}`, name: `Kid ${n}`, daily_limit_minutes: 60, ...extra,
  });
  return r;
}

test('bank cap and debt mode are saved and validated', async () => {
  const ok = await create({ bank_cap_minutes: 120, debt_mode: 'forgive' });
  assert.equal(ok.status, 200);
  const row = db.prepare('SELECT * FROM children WHERE id=?').get(ok.body.id);
  assert.deepEqual([row.bank_cap_minutes, row.debt_mode], [120, 'forgive']);

  const blank = await create({ bank_cap_minutes: '' });
  assert.equal(db.prepare('SELECT bank_cap_minutes FROM children WHERE id=?').get(blank.body.id).bank_cap_minutes, null);

  assert.equal((await create({ bank_cap_minutes: -1 })).status, 400);
  assert.equal((await create({ bank_cap_minutes: 2.5 })).status, 400);
  assert.equal((await create({ debt_mode: 'never' })).status, 400);
});

test('a new kid is assigned every active chore and removal template', async () => {
  db.prepare("INSERT INTO removal_templates (id, name, minutes) VALUES ('rem-children-test','Talking back',5)").run();
  const r = await create();
  const count = type => db.prepare('SELECT COUNT(*) c FROM template_assignments WHERE template_type=? AND child_id=?')
    .get(type, r.body.id).c;
  assert.equal(count('chore'), db.prepare('SELECT COUNT(*) c FROM chore_templates WHERE active=1').get().c);
  assert.equal(count('removal'), db.prepare('SELECT COUNT(*) c FROM removal_templates WHERE active=1').get().c);
});

test("editing the daily limit mid-day changes today's allotment", async () => {
  const r = await create();
  assert.equal((await app.call('GET', `/api/children/${r.body.id}/status`, undefined, { auth: false })).body.remaining_minutes, 60);
  const put = await app.call('PUT', `/api/children/${r.body.id}`, {
    name: 'Renamed', avatar_emoji: '🦊', daily_limit_minutes: 90, bank_cap_minutes: null, debt_mode: 'carry',
  });
  assert.equal(put.status, 200);
  const status = (await app.call('GET', `/api/children/${r.body.id}/status`, undefined, { auth: false })).body;
  assert.deepEqual([status.name, status.remaining_minutes, status.daily_limit_minutes], ['Renamed', 90, 90]);
});

test('status shows the balance breakdown and recent changes, newest first, max 10', async () => {
  const r = await create();
  for (let i = 1; i <= 12; i++) {
    applyAdjustment(db, { childId: r.body.id, minutes: i % 2 ? 5 : -5, kind: i % 2 ? 'grant' : 'removal', reason: `#${i}` });
  }
  const status = (await app.call('GET', `/api/children/${r.body.id}/status`, undefined, { auth: false })).body;
  assert.equal(status.recent.length, 10);
  assert.equal(status.recent[0].reason, '#12');
  assert.equal(status.remaining_minutes, 60);
  const list = (await app.call('GET', '/api/children', undefined, { auth: false })).body;
  assert.equal(list.find(c => c.id === r.body.id).daily_left, 60);
});

test('PUT that omits cap and mode keeps them', async () => {
  const r = await create({ bank_cap_minutes: 120, debt_mode: 'forgive' });
  assert.equal((await app.call('PUT', `/api/children/${r.body.id}`, { name: 'X' })).status, 200);
  const row = db.prepare('SELECT * FROM children WHERE id=?').get(r.body.id);
  assert.deepEqual([row.name, row.bank_cap_minutes, row.debt_mode], ['X', 120, 'forgive']);
  await app.call('PUT', `/api/children/${r.body.id}`, { bank_cap_minutes: null });
  assert.equal(db.prepare('SELECT bank_cap_minutes FROM children WHERE id=?').get(r.body.id).bank_cap_minutes, null);
});

test('numeric fields are parsed strictly', async () => {
  for (const bad of [true, '  ', [], {}, '1e2', '-5', [5]]) {
    assert.equal((await create({ bank_cap_minutes: bad })).status, 400, `cap ${JSON.stringify(bad)}`);
    assert.equal((await create({ daily_limit_minutes: bad === '  ' ? 'x' : bad })).status, 400, `limit ${JSON.stringify(bad)}`);
  }
  const ok = await create({ bank_cap_minutes: ' 45 ', daily_limit_minutes: '30' });
  assert.equal(ok.status, 200);
  const row = db.prepare('SELECT * FROM children WHERE id=?').get(ok.body.id);
  assert.deepEqual([row.bank_cap_minutes, row.daily_limit_minutes], [45, 30]);
});

test('PUT rejects a blank name and keeps the name when omitted', async () => {
  const r = await create();
  for (const name of ['', '   ']) {
    assert.equal((await app.call('PUT', `/api/children/${r.body.id}`, { name })).status, 400);
  }
  assert.equal((await app.call('PUT', `/api/children/${r.body.id}`, { avatar_emoji: '🐱' })).status, 200);
  assert.match(db.prepare('SELECT name FROM children WHERE id=?').get(r.body.id).name, /^Kid /);
});

test('removing a kid deletes their history and assignments; other kids are untouched', async () => {
  db.prepare("INSERT OR IGNORE INTO removal_templates (id, name, minutes) VALUES ('rem-delete-test','Shouting',5)").run();
  const gone = (await create()).body.id;
  const kept = (await create()).body.id;
  db.prepare("INSERT OR IGNORE INTO chore_templates (id, name, reward_minutes) VALUES ('chore-delete-test','Dishes',10)").run();
  const chore = { id: 'chore-delete-test' };
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  db.prepare('INSERT INTO time_ledger (child_id, date, minutes_used, bonus_minutes) VALUES (?,?,5,0)').run(gone, yesterday);
  applyAdjustment(db, { childId: gone, minutes: 10, kind: 'grant', reason: 'x' });
  db.prepare("INSERT INTO chore_completions (child_id, chore_id, reward_minutes, date) VALUES (?,?,10,?)").run(gone, chore.id, yesterday);
  db.prepare('INSERT INTO sessions (child_id, started_at) VALUES (?, unixepoch())').run(gone);
  db.prepare("INSERT OR IGNORE INTO template_assignments (template_type, template_id, child_id) VALUES ('removal','rem-delete-test',?)").run(gone);
  const keptAssignments = db.prepare('SELECT COUNT(*) c FROM template_assignments WHERE child_id=?').get(kept).c;
  assert.ok(keptAssignments > 0);

  const r = await app.call('DELETE', `/api/children/${gone}`);
  assert.equal(r.status, 200);
  for (const table of ['children', 'time_ledger', 'time_adjustments', 'chore_completions', 'sessions', 'template_assignments']) {
    const col = table === 'children' ? 'id' : 'child_id';
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${col}=?`).get(gone).c, 0, table);
  }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM template_assignments WHERE child_id=?').get(kept).c, keptAssignments);
  assert.equal((await app.call('DELETE', `/api/children/${gone}`)).status, 404);
});
