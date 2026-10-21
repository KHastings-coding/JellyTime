import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, addChild, setClock } from './helpers.js';

const {
  createChecklist, updateChecklist, getChecklist, syncRuns, childRuns, tickItem, submitRun, runExpired,
} = await import('../src/checklists.js');
const { childSummary } = await import('../src/accounting.js');
const { addDays } = await import('../src/clock.js');

const db = getDb();
const at = iso => new Date(iso);
const TUE = '2026-10-20';
const NOON_TUE = at('2026-10-20T12:00:00Z');
const status = fn => { try { fn(); } catch (e) { return e.status; } return null; };

function make(kids, over = {}) {
  const { id } = createChecklist(db, {
    name: 'Morning', reward_minutes: 15, schedule: { type: 'daily' },
    items: ['Brush teeth', 'Get dressed'],
    assignments: kids.map(k => ({ childId: k.id, minutesOverride: null })), ...over,
  });
  return id;
}
const runsFor = (kid, checklistId) => db.prepare(
  'SELECT * FROM checklist_runs WHERE child_id=? AND checklist_id=? ORDER BY date').all(kid.id, checklistId);
const adjustments = kid => db.prepare("SELECT * FROM time_adjustments WHERE child_id=? AND kind='checklist'").all(kid.id);
function tickAll(kid, view, now) {
  let v = view;
  for (const item of view.items) v = tickItem(db, view.id, { childId: kid.id, itemId: item.id, done: true }, now);
  return v;
}

test('runs are created only for assigned kids on scheduled days', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const other = addChild(db);
  make([kid], { schedule: { type: 'weekly', days: [1, 2, 3, 4, 5] } });
  const runs = childRuns(db, kid.id, NOON_TUE);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'open');
  assert.equal(runs[0].date, TUE);
  assert.equal(runs[0].reward_minutes, 15);
  assert.equal(runs[0].deadline_at, null);
  assert.equal(runs[0].can_submit, false);
  assert.deepEqual(childRuns(db, kid.id, at('2026-10-24T12:00:00Z')), []);
  assert.deepEqual(childRuns(db, other.id, NOON_TUE), []);
  assert.equal(status(() => childRuns(db, 'nobody', NOON_TUE)), 404);
});

test('the per-kid override is snapshotted as reward_minutes', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  createChecklist(db, {
    name: 'Bedtime', reward_minutes: 15, schedule: { type: 'daily' }, items: ['PJs'],
    assignments: [{ childId: kid.id, minutesOverride: 40 }],
  });
  assert.equal(childRuns(db, kid.id, NOON_TUE)[0].reward_minutes, 40);
});

test('the snapshot survives an edit; the next day gets the new items', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid]);
  const [run] = childRuns(db, kid.id, NOON_TUE);
  const oldItem = run.items[0];
  updateChecklist(db, id, {
    name: 'Morning', reward_minutes: 15, schedule: { type: 'daily' },
    items: ['Brush teeth well', 'Get dressed', 'Feed cat'],
    assignments: [{ childId: kid.id, minutesOverride: null }],
  }, NOON_TUE);
  const [same] = childRuns(db, kid.id, NOON_TUE);
  assert.deepEqual(same.items.map(i => i.label), ['Brush teeth', 'Get dressed']);
  // Review Focus 3: the old snapshot ids still tick; a new item's id does not.
  const ticked = tickItem(db, run.id, { childId: kid.id, itemId: oldItem.id, done: true }, NOON_TUE);
  assert.equal(ticked.items[0].done, true);
  const newItem = getChecklist(db, id).items.find(i => i.label === 'Feed cat');
  assert.equal(status(() => tickItem(db, run.id, { childId: kid.id, itemId: newItem.id, done: true }, NOON_TUE)), 400);
  const [next] = childRuns(db, kid.id, at('2026-10-21T12:00:00Z'));
  assert.deepEqual(next.items.map(i => i.label), ['Brush teeth well', 'Get dressed', 'Feed cat']);
  assert.ok(next.items.every(i => i.done === false));
});

test('tick, untick, submit guards and a submitted run with notify', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  make([kid]);
  const [run] = childRuns(db, kid.id, NOON_TUE);
  const [a, b] = run.items;
  let v = tickItem(db, run.id, { childId: kid.id, itemId: a.id, done: true }, NOON_TUE);
  assert.equal(v.items[0].done, true);
  v = tickItem(db, run.id, { childId: kid.id, itemId: a.id, done: false }, NOON_TUE);
  assert.equal(v.items[0].done, false);
  tickItem(db, run.id, { childId: kid.id, itemId: a.id, done: true }, NOON_TUE);
  assert.equal(status(() => submitRun(db, run.id, { childId: kid.id }, NOON_TUE)), 400);
  v = tickItem(db, run.id, { childId: kid.id, itemId: b.id, done: true }, NOON_TUE);
  assert.equal(v.can_submit, true);
  const { view, notify } = submitRun(db, run.id, { childId: kid.id }, NOON_TUE);
  assert.equal(view.status, 'submitted');
  assert.equal(notify, true);
  assert.equal(view.submitted_at, Math.floor(NOON_TUE.getTime() / 1000));
  assert.equal(view.can_submit, false);
  assert.equal(view.can_retry, true);
  assert.equal(adjustments(kid).length, 0);
  // Not open any more: ticking and resubmitting are refused.
  assert.equal(status(() => tickItem(db, run.id, { childId: kid.id, itemId: a.id, done: false }, NOON_TUE)), 400);
  assert.equal(status(() => submitRun(db, run.id, { childId: kid.id }, NOON_TUE)), 400);
});

test('auto-approve credits the reward to the current day', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  make([kid], { auto_approve: true, reward_minutes: 20 });
  const before = childSummary(db, kid, TUE).available;
  const [run] = childRuns(db, kid.id, NOON_TUE);
  tickAll(kid, run, NOON_TUE);
  const { view, notify } = submitRun(db, run.id, { childId: kid.id }, NOON_TUE);
  assert.equal(view.status, 'approved');
  assert.equal(notify, false);
  assert.equal(childSummary(db, kid, TUE).available, before + 20);
  const rows = adjustments(kid);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, TUE);
  assert.equal(rows[0].minutes, 20);
  assert.equal(rows[0].reason, 'Morning');
  assert.ok(db.prepare('SELECT reviewed_at FROM checklist_runs WHERE id=?').get(run.id).reviewed_at);
});

test('auto-approve with 0 minutes approves without a ledger entry', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  make([kid], { auto_approve: true, reward_minutes: 0 });
  const [run] = childRuns(db, kid.id, NOON_TUE);
  tickAll(kid, run, NOON_TUE);
  assert.equal(submitRun(db, run.id, { childId: kid.id }, NOON_TUE).view.status, 'approved');
  assert.equal(adjustments(kid).length, 0);
});

test('a deadline expires the run at exactly the deadline', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  make([kid], { deadline: '20:30' });
  const before = at('2026-10-20T20:29:59Z');
  const [run] = childRuns(db, kid.id, before);
  assert.equal(run.status, 'open');
  assert.equal(run.deadline_at, '2026-10-20T20:30:00.000Z');
  tickAll(kid, run, before);
  const deadline = at('2026-10-20T20:30:00Z');
  assert.equal(runExpired(db, db.prepare('SELECT * FROM checklist_runs WHERE id=?').get(run.id), deadline), true);
  assert.equal(childRuns(db, kid.id, deadline)[0].status, 'missed');
  assert.equal(status(() => submitRun(db, run.id, { childId: kid.id }, deadline)), 400);
});

test('a deadline before a non-midnight reset falls on the next calendar date', () => {
  setClock(db, 'UTC', '04:00');
  const kid = addChild(db);
  make([kid], { deadline: '01:00' });
  const [run] = childRuns(db, kid.id, at('2026-10-20T12:00:00Z'));
  assert.equal(run.date, TUE);
  assert.equal(childRuns(db, kid.id, at('2026-10-21T00:59:00Z'))[0].status, 'open');
  const [after] = childRuns(db, kid.id, at('2026-10-21T01:00:00Z'));
  assert.equal(after.id, run.id);
  assert.equal(after.status, 'missed');
  setClock(db, 'UTC', '00:00');
});

test('day rollover with no deadline misses an open run but not a submitted one', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid]);
  const other = make([kid], { name: 'Bedtime' });
  const late = at('2026-10-20T23:59:00Z');
  const runs = childRuns(db, kid.id, late);
  assert.deepEqual(runs.map(r => [r.name, r.status]), [['Bedtime', 'open'], ['Morning', 'open']]);
  const bedtime = runs[0];
  tickAll(kid, bedtime, late);
  submitRun(db, bedtime.id, { childId: kid.id }, late);
  syncRuns(db, kid, at('2026-10-21T00:01:00Z'));
  assert.equal(runsFor(kid, id)[0].status, 'missed');
  assert.equal(runsFor(kid, other)[0].status, 'submitted');
});

test('Review Focus 2: a fully ticked run submitted after rollover is refused and missed', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid], { auto_approve: true });
  const [run] = childRuns(db, kid.id, NOON_TUE);
  tickAll(kid, run, NOON_TUE);
  assert.equal(status(() => submitRun(db, run.id, { childId: kid.id }, at('2026-10-21T00:05:00Z'))), 400);
  assert.equal(adjustments(kid).length, 0);
  assert.equal(runsFor(kid, id)[0].status, 'missed');
});

test('backfill inserts missed runs between the newest run and today', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid]);
  childRuns(db, kid.id, NOON_TUE);
  const runs = childRuns(db, kid.id, at('2026-10-24T12:00:00Z'));
  assert.equal(runs.length, 1);
  assert.deepEqual(runsFor(kid, id).map(r => [r.date, r.status]), [
    ['2026-10-20', 'missed'], ['2026-10-21', 'missed'], ['2026-10-22', 'missed'],
    ['2026-10-23', 'missed'], ['2026-10-24', 'open'],
  ]);
  const backfilled = runsFor(kid, id)[1];
  assert.deepEqual(JSON.parse(backfilled.items).map(i => i.done), [false, false]);
  assert.equal(backfilled.reward_minutes, 15);
});

test('backfill skips unscheduled days', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid], { schedule: { type: 'weekly', days: [1, 2, 3, 4, 5] } });
  childRuns(db, kid.id, at('2026-10-23T12:00:00Z'));
  childRuns(db, kid.id, at('2026-10-27T12:00:00Z'));
  assert.deepEqual(runsFor(kid, id).map(r => [r.date, r.status]), [
    ['2026-10-23', 'missed'], ['2026-10-26', 'missed'], ['2026-10-27', 'open'],
  ]);
});

test('backfill is capped at 60 days', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid]);
  const oldDay = addDays(TUE, -90);
  childRuns(db, kid.id, at(`${oldDay}T12:00:00Z`));
  childRuns(db, kid.id, NOON_TUE);
  const dates = runsFor(kid, id).map(r => r.date);
  assert.equal(dates.length, 1 + 60 + 1);
  assert.equal(dates[0], oldDay);
  assert.equal(dates[1], addDays(TUE, -60));
  assert.equal(dates[60], addDays(TUE, -1));
  assert.equal(dates[61], TUE);
});

test('a first assignment creates only today, no backfill', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid]);
  childRuns(db, kid.id, at('2026-10-24T12:00:00Z'));
  assert.deepEqual(runsFor(kid, id).map(r => r.date), ['2026-10-24']);
});

test("another kid's childId gets 404 on tick and submit", () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const other = addChild(db);
  make([kid]);
  const [run] = childRuns(db, kid.id, NOON_TUE);
  assert.equal(status(() => tickItem(db, run.id, { childId: other.id, itemId: run.items[0].id, done: true }, NOON_TUE)), 404);
  assert.equal(status(() => submitRun(db, run.id, { childId: other.id }, NOON_TUE)), 404);
  assert.equal(status(() => tickItem(db, 999999, { childId: kid.id, itemId: run.items[0].id, done: true }, NOON_TUE)), 404);
});

test('Review Focus 4: unassigning deletes an open run today but keeps a submitted one', () => {
  setClock(db, 'UTC', '00:00');
  const a = addChild(db);
  const b = addChild(db);
  const keep = addChild(db);
  const id = make([a, b, keep]);
  childRuns(db, a.id, NOON_TUE);
  const [bRun] = childRuns(db, b.id, NOON_TUE);
  childRuns(db, keep.id, NOON_TUE);
  tickAll(b, bRun, NOON_TUE);
  submitRun(db, bRun.id, { childId: b.id }, NOON_TUE);
  updateChecklist(db, id, {
    name: 'Morning', reward_minutes: 15, schedule: { type: 'daily' }, items: ['Brush teeth', 'Get dressed'],
    assignments: [{ childId: keep.id, minutesOverride: null }],
  }, NOON_TUE);
  assert.deepEqual(runsFor(a, id), []);
  assert.deepEqual(runsFor(b, id).map(r => r.status), ['submitted']);
  assert.deepEqual(runsFor(keep, id).map(r => r.status), ['open']);
  assert.deepEqual(childRuns(db, a.id, NOON_TUE), []);
});

test('R2: a first sync after the deadline creates no run, and the next day has no backfill', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid], { deadline: '20:30' });
  assert.deepEqual(childRuns(db, kid.id, at('2026-10-20T21:00:00Z')), []);
  const runs = childRuns(db, kid.id, at('2026-10-21T12:00:00Z'));
  assert.deepEqual(runs.map(r => [r.date, r.status]), [['2026-10-21', 'open']]);
  assert.deepEqual(runsFor(kid, id).map(r => r.date), ['2026-10-21']);
});

test('R2: a day skipped after its deadline is backfilled as missed once a later run exists', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid], { deadline: '20:30' });
  childRuns(db, kid.id, NOON_TUE);
  assert.deepEqual(childRuns(db, kid.id, at('2026-10-21T21:00:00Z')), []);
  childRuns(db, kid.id, at('2026-10-22T12:00:00Z'));
  assert.deepEqual(runsFor(kid, id).map(r => [r.date, r.status]), [
    ['2026-10-20', 'missed'], ['2026-10-21', 'missed'], ['2026-10-22', 'open'],
  ]);
});

const body = (kids, over = {}) => ({
  name: 'Morning', reward_minutes: 15, schedule: { type: 'daily' }, items: ['Brush teeth', 'Get dressed'],
  assignments: kids.map(k => ({ childId: k.id, minutesOverride: null })), ...over,
});

test('R4: days a kid was unassigned are not backfilled as missed', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid]);
  childRuns(db, kid.id, at('2026-10-01T12:00:00Z'));
  updateChecklist(db, id, body([]), at('2026-10-02T12:00:00Z'));
  const now = at('2026-10-20T12:00:00Z');
  updateChecklist(db, id, body([kid]), now);
  assert.deepEqual(childRuns(db, kid.id, now).map(r => [r.date, r.status]), [['2026-10-20', 'open']]);
  assert.deepEqual(runsFor(kid, id).map(r => [r.date, r.status]), [['2026-10-01', 'missed'], ['2026-10-20', 'open']]);
});

test('R4: days a checklist was inactive are not backfilled as missed', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid]);
  childRuns(db, kid.id, at('2026-10-01T12:00:00Z'));
  updateChecklist(db, id, body([kid], { active: false }), at('2026-10-02T12:00:00Z'));
  const now = at('2026-10-20T12:00:00Z');
  updateChecklist(db, id, body([kid], { active: true }), now);
  childRuns(db, kid.id, now);
  assert.deepEqual(runsFor(kid, id).map(r => [r.date, r.status]), [['2026-10-01', 'missed'], ['2026-10-20', 'open']]);
});

test('R4: an edit that keeps the assignment does not stop downtime backfill', () => {
  setClock(db, 'UTC', '00:00');
  const kid = addChild(db);
  const id = make([kid]);
  childRuns(db, kid.id, NOON_TUE);
  updateChecklist(db, id, body([kid], { name: 'Morning!' }), at('2026-10-21T12:00:00Z'));
  childRuns(db, kid.id, at('2026-10-24T12:00:00Z'));
  assert.deepEqual(runsFor(kid, id).map(r => r.date),
    ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
});
