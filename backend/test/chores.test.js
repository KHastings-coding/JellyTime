import { getDb, startApp, addChild, setClock } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { default: choresRouter } = await import('../src/routes/chores.js');
const { childSummary } = await import('../src/accounting.js');
const { today } = await import('../src/clock.js');

const app = await startApp([['/api/chores', choresRouter]]);
after(() => app.close());
const db = getDb();
setClock(db, 'UTC');

const chore = (extra = {}) => ({
  name: 'Clean room', description: '', reward_minutes: 20, icon: '🧹',
  auto_approve: true, active: true, max_completions: 1, ...extra,
});

test('a new chore goes to every kid; an override changes one kid\'s reward', async () => {
  const a = addChild(db), b = addChild(db);
  const created = await app.call('POST', '/api/chores/templates', chore());
  assert.equal(created.status, 200);
  const id = created.body.id;
  const list = await app.call('GET', '/api/chores/templates');
  const ids = list.body.find(t => t.id === id).assignments.map(x => x.childId);
  assert.ok(ids.includes(a.id) && ids.includes(b.id));

  const put = await app.call('PUT', `/api/chores/templates/${id}`, chore({
    assignments: [{ childId: a.id, minutesOverride: 10 }, { childId: b.id, minutesOverride: null }],
  }));
  assert.equal(put.status, 200);
  const forA = await app.call('GET', `/api/chores/child/${a.id}`, undefined, { auth: false });
  const forB = await app.call('GET', `/api/chores/templates?childId=${b.id}`, undefined, { auth: false });
  assert.equal(forA.body.find(t => t.id === id).reward_minutes, 10);
  const bView = forB.body.find(t => t.id === id);
  assert.equal(bView.reward_minutes, 20);
  assert.equal(bView.default_reward_minutes, 20);
});

test('unassigned chores are hidden from a kid and cannot be submitted', async () => {
  const a = addChild(db), b = addChild(db);
  const { body } = await app.call('POST', '/api/chores/templates', chore({
    name: 'Feed pets', assignments: [{ childId: a.id, minutesOverride: null }],
  }));
  const forB = await app.call('GET', `/api/chores/child/${b.id}`, undefined, { auth: false });
  assert.equal(forB.body.some(t => t.id === body.id), false);
  const submit = await app.call('POST', '/api/chores/submit', { childId: b.id, choreId: body.id }, { auth: false });
  assert.equal(submit.status, 404);
});

test('an auto-approved chore credits the kid\'s effective reward as an adjustment', async () => {
  const a = addChild(db);
  const { body } = await app.call('POST', '/api/chores/templates', chore({
    name: 'Dishes', assignments: [{ childId: a.id, minutesOverride: 7 }],
  }));
  const submit = await app.call('POST', '/api/chores/submit', { childId: a.id, choreId: body.id }, { auth: false });
  assert.equal(submit.status, 200);
  assert.equal(submit.body.reward_minutes, 7);
  assert.equal(childSummary(db, a).earned_today, 7);
  const adj = db.prepare('SELECT * FROM time_adjustments WHERE child_id=?').get(a.id);
  assert.deepEqual([adj.kind, adj.reason, adj.minutes], ['chore', 'Dishes', 7]);
});

test('approving a chore from an earlier day credits today', async () => {
  const a = addChild(db);
  const { body } = await app.call('POST', '/api/chores/templates', chore({ name: 'Homework', auto_approve: false }));
  const info = db.prepare(`INSERT INTO chore_completions (child_id, chore_id, status, reward_minutes, date)
    VALUES (?,?, 'pending', 15, '2020-01-01')`).run(a.id, body.id);
  const r = await app.call('POST', '/api/chores/review', { completionId: Number(info.lastInsertRowid), action: 'approve' });
  assert.equal(r.status, 200);
  const adj = db.prepare('SELECT * FROM time_adjustments WHERE child_id=?').get(a.id);
  assert.equal(adj.date, today(db));
  assert.equal(adj.minutes, 15);
});

test('invalid reward or assignment is rejected', async () => {
  assert.equal((await app.call('POST', '/api/chores/templates', chore({ reward_minutes: 0 }))).status, 400);
  assert.equal((await app.call('POST', '/api/chores/templates', chore({
    assignments: [{ childId: 'ghost', minutesOverride: null }],
  }))).status, 400);
});

test('approval and credit are atomic: a failed credit leaves the completion pending', async () => {
  const a = addChild(db);
  const { body } = await app.call('POST', '/api/chores/templates', chore({ name: 'Atomic', auto_approve: false }));
  const info = db.prepare(`INSERT INTO chore_completions (child_id, chore_id, status, reward_minutes, date)
    VALUES (?,?, 'pending', 5, ?)`).run(a.id, body.id, today(db));
  db.pragma('foreign_keys = OFF');
  db.prepare('DELETE FROM children WHERE id=?').run(a.id);
  db.pragma('foreign_keys = ON');
  const r = await app.call('POST', '/api/chores/review', { completionId: Number(info.lastInsertRowid), action: 'approve' });
  assert.ok(r.status >= 400 && r.status < 500);
  assert.equal(db.prepare('SELECT status FROM chore_completions WHERE id=?').get(Number(info.lastInsertRowid)).status, 'pending');
});

test('duplicate childId in assignments is rejected with 400', async () => {
  const a = addChild(db);
  const r = await app.call('POST', '/api/chores/templates', chore({
    assignments: [{ childId: a.id, minutesOverride: null }, { childId: a.id, minutesOverride: 5 }],
  }));
  assert.equal(r.status, 400);
});

test('PUT on a missing or inactive chore returns 404', async () => {
  assert.equal((await app.call('PUT', '/api/chores/templates/nope', chore())).status, 404);
  const { body } = await app.call('POST', '/api/chores/templates', chore({ name: 'Gone' }));
  await app.call('DELETE', `/api/chores/templates/${body.id}`);
  assert.equal((await app.call('PUT', `/api/chores/templates/${body.id}`, chore())).status, 404);
});
