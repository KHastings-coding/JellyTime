import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchedule, isScheduled, scheduledDatesBetween } from '../src/schedule.js';

const monthly = rules => ({ type: 'monthly', rules });

test('daily is scheduled on any date', () => {
  assert.equal(isScheduled({ type: 'daily' }, '2026-10-21'), true);
  assert.equal(isScheduled({ type: 'daily' }, '2028-02-29'), true);
});

test('weekly matches listed weekdays', () => {
  const s = { type: 'weekly', days: [1, 2, 3, 4, 5] };
  assert.equal(isScheduled(s, '2026-10-19'), true);
  assert.equal(isScheduled(s, '2026-10-24'), false);
});

test('monthly date rule', () => {
  const s = monthly([{ date: 15 }]);
  assert.equal(isScheduled(s, '2026-10-15'), true);
  assert.equal(isScheduled(s, '2026-10-16'), false);
});

test('monthly date 31 clamps to the last day of short months', () => {
  const s = monthly([{ date: 31 }]);
  assert.equal(isScheduled(s, '2026-04-30'), true);
  assert.equal(isScheduled(s, '2026-04-29'), false);
  assert.equal(isScheduled(s, '2026-02-28'), true);
  assert.equal(isScheduled(s, '2028-02-29'), true);
  assert.equal(isScheduled(s, '2028-02-28'), false);
  assert.equal(isScheduled(s, '2026-10-31'), true);
  assert.equal(isScheduled(s, '2026-10-30'), false);
});

test('nth weekday rules', () => {
  const third = monthly([{ nth: 3, weekday: 1 }]);
  assert.equal(isScheduled(third, '2026-10-19'), true);
  assert.equal(isScheduled(third, '2026-10-12'), false);
  const last = monthly([{ nth: 'last', weekday: 5 }]);
  assert.equal(isScheduled(last, '2026-10-30'), true);
  assert.equal(isScheduled(last, '2026-10-23'), false);
  const both = monthly([{ nth: 1, weekday: 0 }, { nth: 4, weekday: 0 }]);
  assert.equal(isScheduled(both, '2026-10-04'), true);
  assert.equal(isScheduled(both, '2026-10-25'), true);
  assert.equal(isScheduled(both, '2026-10-11'), false);
});

test('overlapping rules yield each date once', () => {
  const s = monthly([{ date: 19 }, { nth: 3, weekday: 1 }]);
  assert.equal(isScheduled(s, '2026-10-19'), true);
  const dates = scheduledDatesBetween(s, '2026-10-01', '2026-10-31');
  assert.equal(dates.filter(d => d === '2026-10-19').length, 1);
});

test('scheduledDatesBetween is inclusive and ascending', () => {
  const dates = scheduledDatesBetween({ type: 'weekly', days: [1] }, '2026-10-19', '2026-11-02');
  assert.deepEqual(dates, ['2026-10-19', '2026-10-26', '2026-11-02']);
  assert.deepEqual(scheduledDatesBetween({ type: 'daily' }, '2026-10-02', '2026-10-01'), []);
});

test('validateSchedule rejects bad input with 400', () => {
  const bad = [
    { type: 'weekly', days: [] }, { type: 'weekly', days: [7] },
    monthly([]), monthly([{ date: 0 }]), monthly([{ nth: 5, weekday: 1 }]),
    monthly([{ date: 3, weekday: 1 }]), { type: 'yearly' }, null,
    { type: 'daily', extra: 1 }, { type: 'weekly', days: [1], extra: 1 },
  ];
  for (const b of bad) {
    assert.throws(() => validateSchedule(b), e => e.status === 400, JSON.stringify(b));
  }
});

test('validateSchedule normalizes', () => {
  assert.deepEqual(validateSchedule({ type: 'weekly', days: [5, 1, 1] }), { type: 'weekly', days: [1, 5] });
  assert.deepEqual(validateSchedule({ type: 'daily' }), { type: 'daily' });
  assert.deepEqual(validateSchedule(monthly([{ nth: 'last', weekday: 5 }, { date: 3 }])),
    monthly([{ nth: 'last', weekday: 5 }, { date: 3 }]));
});
