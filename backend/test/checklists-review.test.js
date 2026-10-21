import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, addChild, setClock } from './helpers.js';

const {
  createChecklist, archiveChecklist, listChecklists, childRuns, tickItem, submitRun,
  reviewRun, pendingRuns, streaks,
} = await import('../src/checklists.js');
const { childSummary } = await import('../src/accounting.js');

const db = getDb();
const at = iso => new Date(iso);
const NOON_TUE = at('2026-10-20T12:00:00Z');
const status = fn => { try { fn(); } catch (e) { return e.status; } return null; };

function make(kid, over = {}) {
  return createChecklist(db, {
    name: 'Morning', reward_minutes: 15, schedule: { type: 'daily' }, items: ['Brush', 'Dress'],
    assignments: [{ childId: kid.id, minutesOverride: null }], ...over,
  }).id;
}
function submitted(kid, now = NOON_TUE, over = {}) {
  const id = make(kid, over);
  const [view] = childRuns(db, kid.id, now);
  for (const i of view.items) tickItem(db, view.id, { childId: kid.id, itemId: i.id, done: true }, now);
  submitRun(db, view.id, { childId: kid.id }, now);
  return { id, runId: view.id };
}
const adjustments = kid => db.prepare("SELECT * FROM time_adjustments WHERE child_id=? AND kind='checklist'").all(kid.id);
const getRun = id => db.prepare('SELECT * FROM checklist_runs WHERE id=?').get(id);

test('approve credits once; a second approve is 409', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const { runId } = submitted(kid);
  const before = childSummary(db, kid, '2026-10-20').available;
  const view = reviewRun(db, runId, { action: 'approve' }, NOON_TUE);
  assert.equal(view.status, 'approved');
  assert.equal(childSummary(db, kid, '2026-10-20').available, before + 15);
  assert.equal(status(() => reviewRun(db, runId, { action: 'approve' }, NOON_TUE)), 409);
  assert.equal(adjustments(kid).length, 1);
  assert.ok(getRun(runId).reviewed_at);
});

test('approving the next day credits the kid current day', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const { runId } = submitted(kid);
  reviewRun(db, runId, { action: 'approve' }, at('2026-10-21T08:00:00Z'));
  assert.equal(adjustments(kid)[0].date, '2026-10-21');
});

test('retry before the deadline reopens and keeps ticks', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const { runId } = submitted(kid, NOON_TUE, { deadline: '18:00' });
  const view = reviewRun(db, runId, { action: 'retry', note: ' again ' }, NOON_TUE);
  assert.equal(view.status, 'open');
  assert.equal(view.review_note, 'again');
  assert.ok(view.items.every(i => i.done));
});

test('retry after the deadline or on a past day is 400 and stays submitted', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const { runId } = submitted(kid, NOON_TUE, { deadline: '18:00' });
  assert.equal(status(() => reviewRun(db, runId, { action: 'retry' }, at('2026-10-20T19:00:00Z'))), 400);
  assert.equal(getRun(runId).status, 'submitted');
  const kid2 = addChild(db);
  const second = submitted(kid2);
  assert.equal(status(() => reviewRun(db, second.runId, { action: 'retry' }, at('2026-10-21T08:00:00Z'))), 400);
  assert.equal(getRun(second.runId).status, 'submitted');
});

test('missed records the note and creates no adjustment', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const { runId } = submitted(kid);
  const view = reviewRun(db, runId, { action: 'missed', note: 'sloppy' }, NOON_TUE);
  assert.equal(view.status, 'missed');
  assert.equal(view.review_note, 'sloppy');
  assert.equal(adjustments(kid).length, 0);
});

test('invalid note and action are 400; unknown run 404; non-submitted 409', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const { runId } = submitted(kid);
  assert.equal(status(() => reviewRun(db, runId, { action: 'approve', note: 'x'.repeat(201) }, NOON_TUE)), 400);
  assert.equal(status(() => reviewRun(db, runId, { action: 'nope' }, NOON_TUE)), 400);
  assert.equal(status(() => reviewRun(db, 999999, { action: 'approve' }, NOON_TUE)), 404);
  const kid2 = addChild(db);
  make(kid2);
  const [open] = childRuns(db, kid2.id, NOON_TUE);
  assert.equal(status(() => reviewRun(db, open.id, { action: 'approve' }, NOON_TUE)), 409);
  assert.equal(getRun(runId).status, 'submitted');
});

test('an archived checklist run is still pending and approvable', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const { id, runId } = submitted(kid);
  archiveChecklist(db, id, NOON_TUE);
  const pending = pendingRuns(db, NOON_TUE).filter(r => r.child_id === kid.id);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].child_name, kid.name);
  reviewRun(db, runId, { action: 'approve' }, NOON_TUE);
  assert.equal(adjustments(kid).length, 1);
  assert.equal(pendingRuns(db, NOON_TUE).filter(r => r.child_id === kid.id).length, 0);
});

// ---- streaks ----
function seed(kid, checklistId, rows) {
  const ins = db.prepare(`INSERT INTO checklist_runs (checklist_id, child_id, date, status, items, reward_minutes, name, icon)
    VALUES (?,?,?,?,'[]',0,'Morning','📝')`);
  for (const [date, st] of rows) ins.run(checklistId, kid.id, date, st);
}
const weekdays = kid => make(kid, { schedule: { type: 'weekly', days: [1, 2, 3, 4, 5] } });
const WEEK = [['2026-10-12', 'approved'], ['2026-10-13', 'approved'], ['2026-10-14', 'approved'],
  ['2026-10-15', 'approved'], ['2026-10-16', 'approved'], ['2026-10-19', 'approved']];

test('weekend gaps do not break a streak; a missed run does', () => {
  const kid = addChild(db);
  const id = weekdays(kid);
  seed(kid, id, WEEK);
  assert.deepEqual(streaks(db, kid.id, id), { streak: 6, best: 6 });
  db.prepare("UPDATE checklist_runs SET status='missed' WHERE child_id=? AND date='2026-10-13'").run(kid.id);
  assert.deepEqual(streaks(db, kid.id, id), { streak: 4, best: 4 });
  db.prepare("UPDATE checklist_runs SET status='approved' WHERE child_id=? AND date='2026-10-13'").run(kid.id);
  seed(kid, id, [['2026-10-20', 'missed']]);
  assert.deepEqual(streaks(db, kid.id, id), { streak: 0, best: 6 });
});

test('submitted runs are skipped; open today is skipped', () => {
  const kid = addChild(db);
  const id = weekdays(kid);
  seed(kid, id, [['2026-10-14', 'approved'], ['2026-10-15', 'submitted'], ['2026-10-16', 'approved']]);
  assert.deepEqual(streaks(db, kid.id, id), { streak: 2, best: 2 });
  const kid2 = addChild(db);
  const id2 = weekdays(kid2);
  seed(kid2, id2, [['2026-10-15', 'approved'], ['2026-10-16', 'approved'], ['2026-10-19', 'approved'], ['2026-10-20', 'open']]);
  assert.equal(streaks(db, kid2.id, id2).streak, 3);
});

test('a retried then approved run counts; list and childRuns expose streaks', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const { id, runId } = submitted(kid);
  reviewRun(db, runId, { action: 'retry' }, NOON_TUE);
  const [v] = childRuns(db, kid.id, NOON_TUE);
  submitRun(db, v.id, { childId: kid.id }, NOON_TUE);
  reviewRun(db, runId, { action: 'approve' }, NOON_TUE);
  assert.deepEqual(streaks(db, kid.id, id), { streak: 1, best: 1 });
  assert.equal(childRuns(db, kid.id, NOON_TUE)[0].streak, 1);
  assert.deepEqual(listChecklists(db).find(c => c.id === id).streaks[kid.id], { streak: 1, best: 1 });
});
