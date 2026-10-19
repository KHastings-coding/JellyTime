import { getDb, startApp, addChild, setClock } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { default: timeRouter } = await import('../src/routes/time.js');
const { default: removalsRouter } = await import('../src/routes/removals.js');
const { today, addDays } = await import('../src/clock.js');

const app = await startApp([['/api/time', timeRouter], ['/api/removals', removalsRouter]]);
after(() => app.close());
const db = getDb();
setClock(db, 'UTC');

const summaryOf = async kid => (await app.call('GET', '/api/time/today-all')).body.find(c => c.id === kid.id);

test('removal template uses the kid\'s override and reports owed time', async () => {
  const little = addChild(db), teen = addChild(db);
  const t = await app.call('POST', '/api/removals/templates', {
    name: 'Left room at night', icon: '🚪', minutes: 20,
    assignments: [{ childId: little.id, minutesOverride: 10 }, { childId: teen.id, minutesOverride: null }],
  });
  assert.equal(t.status, 200);
  const forLittle = await app.call('GET', `/api/removals/templates?childId=${little.id}`);
  assert.equal(forLittle.body.find(x => x.id === t.body.id).minutes, 10);

  const r = await app.call('POST', '/api/time/adjust', { childId: little.id, kind: 'removal', templateId: t.body.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.remaining_minutes, 20);
  const s = await summaryOf(little);
  assert.deepEqual([s.remaining_minutes, s.daily_left, s.owed, s.banked], [20, 30, 10, 0]);
  const adj = (await app.call('GET', `/api/time/adjustments/${little.id}?days=1`)).body.adjustments[0];
  assert.deepEqual([adj.minutes, adj.reason, adj.icon, adj.kind], [-10, 'Left room at night', '🚪', 'removal']);
});

test('applying a removal template not assigned (or deleted) is a clean 400', async () => {
  const a = addChild(db), b = addChild(db);
  const t = await app.call('POST', '/api/removals/templates', {
    name: 'Stay in bed', icon: '🛏️', minutes: 5, assignments: [{ childId: a.id, minutesOverride: null }],
  });
  const wrongKid = await app.call('POST', '/api/time/adjust', { childId: b.id, kind: 'removal', templateId: t.body.id });
  assert.equal(wrongKid.status, 400);
  await app.call('DELETE', `/api/removals/templates/${t.body.id}`);
  const deleted = await app.call('POST', '/api/time/adjust', { childId: a.id, kind: 'removal', templateId: t.body.id });
  assert.equal(deleted.status, 400);
  assert.equal((await summaryOf(a)).remaining_minutes, 30);
  assert.equal((await summaryOf(b)).remaining_minutes, 30);
});

test('free-form removal needs a reason; grants get a default reason', async () => {
  const kid = addChild(db);
  const noReason = await app.call('POST', '/api/time/adjust', { childId: kid.id, kind: 'removal', minutes: 20, reason: '  ' });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /reason/i);
  assert.equal((await app.call('POST', '/api/time/adjust', { childId: kid.id, kind: 'removal', minutes: 20, reason: 'Hit sibling' })).status, 200);
  assert.equal((await app.call('POST', '/api/time/adjust', { childId: kid.id, kind: 'grant', minutes: 15 })).status, 200);
  const list = (await app.call('GET', `/api/time/adjustments/${kid.id}?days=1`)).body.adjustments;
  assert.deepEqual(list.map(a => [a.minutes, a.reason]), [[15, 'Bonus from parent'], [-20, 'Hit sibling']]);
});

test('minutes are validated', async () => {
  const kid = addChild(db);
  for (const minutes of [0, -5, 'abc', 2000, 1.5, null]) {
    const r = await app.call('POST', '/api/time/adjust', { childId: kid.id, kind: 'grant', minutes });
    assert.equal(r.status, 400, String(minutes));
  }
  assert.equal((await app.call('POST', '/api/time/adjust', { childId: kid.id, kind: 'bogus', minutes: 5 })).status, 400);
  assert.equal((await app.call('POST', '/api/time/adjust', { childId: 'ghost', kind: 'grant', minutes: 5 })).status, 404);
});

test('undo restores today\'s change and refuses past days', async () => {
  const kid = addChild(db);
  const r = await app.call('POST', '/api/time/adjust', { childId: kid.id, kind: 'removal', minutes: 25, reason: 'x' });
  const undo = await app.call('DELETE', `/api/time/adjust/${r.body.id}`);
  assert.equal(undo.status, 200);
  assert.equal(undo.body.summary.remaining_minutes, 30);
  const info = db.prepare("INSERT INTO time_adjustments (child_id, date, minutes, kind, reason) VALUES (?,?,5,'grant','x')").run(kid.id, addDays(today(db), -1));
  assert.equal((await app.call('DELETE', `/api/time/adjust/${Number(info.lastInsertRowid)}`)).status, 400);
});

test('reset clears watched time only', async () => {
  const kid = addChild(db);
  await app.call('POST', '/api/time/adjust', { childId: kid.id, kind: 'grant', minutes: 15 });
  db.prepare('UPDATE time_ledger SET minutes_used=40 WHERE child_id=?').run(kid.id);
  const r = await app.call('POST', '/api/time/reset', { childId: kid.id });
  assert.equal(r.body.summary.remaining_minutes, 45);
});

test('legacy /grant still works and everything needs auth', async () => {
  const kid = addChild(db);
  assert.equal((await app.call('POST', '/api/time/grant', { childId: kid.id, minutes: 10 })).status, 200);
  assert.equal((await summaryOf(kid)).remaining_minutes, 40);
  assert.equal((await app.call('POST', '/api/time/adjust', { childId: kid.id, kind: 'grant', minutes: 5 }, { auth: false })).status, 401);
  assert.equal((await app.call('GET', '/api/removals/templates', undefined, { auth: false })).status, 401);
});

test('removal template validation', async () => {
  assert.equal((await app.call('POST', '/api/removals/templates', { name: '', minutes: 5 })).status, 400);
  assert.equal((await app.call('POST', '/api/removals/templates', { name: 'x', minutes: 0 })).status, 400);
  assert.equal((await app.call('PUT', '/api/removals/templates/nope', { name: 'x', minutes: 5 })).status, 404);
});
