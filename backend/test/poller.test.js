import { getDb, addChild, setClock } from './helpers.js';
import { test, mock } from 'node:test';
import cron from 'node-cron';
import assert from 'node:assert/strict';

const { poll, runDailyReset, scheduleReset, stopReset } = await import('../src/poller.js');
const { childSummary, applyAdjustment } = await import('../src/accounting.js');
const { today } = await import('../src/clock.js');

const db = getDb();
setClock(db, 'UTC', '00:00');

function fakeJellyfin(playingUserIds) {
  const calls = [];
  return {
    calls,
    getActiveSessions: async () => [...playingUserIds].map(UserId => ({ UserId, NowPlayingItem: { Name: 'Show' } })),
    enableUser: async id => { calls.push(['enable', id]); return true; },
    disableUser: async id => { calls.push(['disable', id]); return true; },
  };
}
const callsFor = (jf, kid) => jf.calls.filter(c => c[1] === kid.jellyfin_user_id).map(c => c[0]);

test('watch time accumulates and the kid is disabled when it runs out', async () => {
  const kid = addChild(db, { daily: 30 });
  const jf = fakeJellyfin([kid.jellyfin_user_id]);
  const t0 = Date.parse('2026-10-19T12:00:00Z');
  await poll(jf, t0);
  await poll(jf, t0 + 20 * 60000);
  assert.equal(childSummary(db, kid, '2026-10-19').minutes_used, 20);
  assert.deepEqual(callsFor(jf, kid), []);
  await poll(jf, t0 + 31 * 60000);
  assert.equal(childSummary(db, kid, '2026-10-19').minutes_used, 31);
  assert.deepEqual(callsFor(jf, kid), ['disable']);
});

test('a stream spanning the reset counts once, toward the new day', async () => {
  const kid = addChild(db, { daily: 30 });
  const jf = fakeJellyfin([kid.jellyfin_user_id]);
  await poll(jf, Date.parse('2026-10-19T23:50:00Z'));
  await poll(jf, Date.parse('2026-10-20T00:10:00Z'));
  assert.equal(childSummary(db, kid, '2026-10-19').minutes_used, 0);
  assert.equal(childSummary(db, kid, '2026-10-20').minutes_used, 20);
});

test('a removal that empties the balance cuts off an active stream on the next poll', async () => {
  const kid = addChild(db, { daily: 30 });
  const jf = fakeJellyfin([kid.jellyfin_user_id]);
  const t0 = Date.parse('2026-10-21T12:00:00Z');
  await poll(jf, t0);
  applyAdjustment(db, { childId: kid.id, minutes: -40, kind: 'removal', reason: 'x', date: '2026-10-21' });
  await poll(jf, t0 + 30000);
  assert.deepEqual(callsFor(jf, kid), ['disable']);
});

test('idle kids with time are re-enabled', async () => {
  const kid = addChild(db, { daily: 30 });
  const jf = fakeJellyfin([]);
  await poll(jf, Date.parse('2026-10-22T12:00:00Z'));
  assert.deepEqual(callsFor(jf, kid), ['enable']);
});

test('daily reset enables kids with time and keeps kids in debt disabled', async () => {
  const ok = addChild(db, { daily: 30 });
  const owing = addChild(db, { daily: 30 });
  applyAdjustment(db, { childId: owing.id, minutes: -40, kind: 'removal', reason: 'x', date: today(db) });
  const jf = fakeJellyfin([]);
  await runDailyReset(jf);
  assert.deepEqual(callsFor(jf, ok), ['enable']);
  assert.deepEqual(callsFor(jf, owing), ['disable']);
});

test('scheduleReset falls back to the default timezone when cron rejects the zone', () => {
  setClock(db, 'Europe/Paris', '06:00');
  const real = cron.schedule;
  let n = 0;
  const m = mock.method(cron, 'schedule', (...args) => {
    if (++n === 1) throw new Error('bad timezone');
    return real.apply(cron, args);
  });
  try {
    assert.doesNotThrow(() => scheduleReset());
    assert.equal(m.mock.callCount(), 2);
    assert.equal(m.mock.calls[1].arguments[2].timezone, 'America/Denver');
  } finally {
    m.mock.restore();
    stopReset();
    setClock(db, 'UTC', '00:00');
  }
});
