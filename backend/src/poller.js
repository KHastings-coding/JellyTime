import cron from 'node-cron';
import { getDb } from './db.js';
import * as jellyfin from './jellyfin.js';
import { getClockSettings, today, DEFAULT_TIMEZONE } from './clock.js';
import { addUsage, childSummary } from './accounting.js';

const POLL_INTERVAL_SECONDS = 30;
const activeTracking = new Map(); // childId -> { startedAt }

export async function poll(jf = jellyfin, now = Date.now()) {
  const db = getDb();
  const children = db.prepare('SELECT * FROM children').all();
  if (!children.length) return;

  const sessions = await jf.getActiveSessions();
  const playing = new Set(sessions.filter(s => s.NowPlayingItem && s.UserId).map(s => s.UserId));
  const date = today(db, new Date(now));

  for (const child of children) {
    const tracking = activeTracking.get(child.id);
    if (playing.has(child.jellyfin_user_id)) {
      if (tracking) addUsage(db, child, (now - tracking.startedAt) / 60000, date);
      activeTracking.set(child.id, { startedAt: now });
      if (childSummary(db, child, date).available <= 0) {
        console.log(`[JellyTime] ${child.name} ran out of time. Disabling...`);
        await jf.disableUser(child.jellyfin_user_id);
        activeTracking.delete(child.id);
      }
    } else {
      activeTracking.delete(child.id);
      // Re-enable if they have time again (new day, chore approved, grant, undo)
      if (childSummary(db, child, date).available > 0) await jf.enableUser(child.jellyfin_user_id);
    }
  }
}

export async function runDailyReset(jf = jellyfin) {
  const db = getDb();
  for (const child of db.prepare('SELECT * FROM children').all()) {
    if (childSummary(db, child).available > 0) await jf.enableUser(child.jellyfin_user_id);
    else await jf.disableUser(child.jellyfin_user_id);
  }
}

let resetJob = null;

export function scheduleReset() {
  stopReset();
  const db = getDb();
  const { timezone, resetTime } = getClockSettings(db);
  const [h, m] = resetTime.split(':').map(Number);
  console.log(`[JellyTime] Scheduling daily reset at ${resetTime} (${timezone})`);
  const task = () => {
    console.log(`[JellyTime] Daily reset at ${resetTime} (${timezone})`);
    runDailyReset().catch(console.error);
  };
  const expr = `0 ${m} ${h} * * *`;
  try {
    resetJob = cron.schedule(expr, task, { timezone });
  } catch (err) {
    console.warn(`[JellyTime] Cron rejected timezone "${timezone}" (${err.message}); using ${DEFAULT_TIMEZONE}`);
    resetJob = cron.schedule(expr, task, { timezone: DEFAULT_TIMEZONE });
  }
}

export function stopReset() {
  if (resetJob) { resetJob.stop(); resetJob = null; }
}

export function startPolling() {
  console.log(`[JellyTime] Starting session poller every ${POLL_INTERVAL_SECONDS}s`);
  // Run immediately, then on schedule
  poll().catch(console.error);
  cron.schedule(`*/${POLL_INTERVAL_SECONDS} * * * * *`, () => {
    poll().catch(console.error);
  });

  scheduleReset();
}

export function getRemainingMinutes(childId) {
  const db = getDb();
  const child = db.prepare('SELECT * FROM children WHERE id=?').get(childId);
  return child ? childSummary(db, child).remaining_minutes : 0;
}
