import cron from 'node-cron';
import { getDb } from './db.js';
import { getActiveSessions, disableUser, enableUser } from './jellyfin.js';

const POLL_INTERVAL_SECONDS = 30;
const activeTracking = new Map(); // childId -> { sessionId, startedAt }

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getLedger(db, childId) {
  const date = today();
  let row = db.prepare('SELECT * FROM time_ledger WHERE child_id=? AND date=?').get(childId, date);
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO time_ledger (child_id, date, minutes_used, bonus_minutes) VALUES (?,?,0,0)')
      .run(childId, date);
    row = db.prepare('SELECT * FROM time_ledger WHERE child_id=? AND date=?').get(childId, date);
  }
  return row;
}

function getChild(db, jellyfinUserId) {
  return db.prepare('SELECT * FROM children WHERE jellyfin_user_id=?').get(jellyfinUserId);
}

async function poll() {
  const db = getDb();
  const children = db.prepare('SELECT * FROM children').all();
  if (!children.length) return;

  let activeSessions;
  try {
    activeSessions = await getActiveSessions();
  } catch {
    return;
  }

  // Map active jellyfin sessions by userId
  const activeByUserId = new Map();
  for (const s of activeSessions) {
    if (s.NowPlayingItem && s.UserId) {
      activeByUserId.set(s.UserId, s);
    }
  }

  for (const child of children) {
    const date = today();
    const ledger = getLedger(db, child.id);
    const totalAllowed = child.daily_limit_minutes + ledger.bonus_minutes;
    const remaining = totalAllowed - ledger.minutes_used;

    const isPlaying = activeByUserId.has(child.jellyfin_user_id);
    const tracking = activeTracking.get(child.id);

    if (isPlaying) {
      if (!tracking) {
        // Start tracking this session
        activeTracking.set(child.id, {
          startedAt: Date.now(),
          sessionId: activeByUserId.get(child.jellyfin_user_id).Id,
        });
        // Re-enable if was disabled (new day or bonus granted)
        if (remaining > 0) {
          await enableUser(child.jellyfin_user_id);
        }
      } else {
        // Add elapsed time
        const elapsedMs = Date.now() - tracking.startedAt;
        const elapsedMinutes = elapsedMs / 60000;

        // Update ledger with fractional minutes
        db.prepare(`
          UPDATE time_ledger SET minutes_used = minutes_used + ?, last_updated = unixepoch()
          WHERE child_id=? AND date=?
        `).run(elapsedMinutes, child.id, date);

        // Reset start time for next interval
        activeTracking.set(child.id, { ...tracking, startedAt: Date.now() });

        // Check if over limit
        const updatedLedger = getLedger(db, child.id);
        const newRemaining = totalAllowed - updatedLedger.minutes_used;

        if (newRemaining <= 0) {
          console.log(`[JellyTime] ${child.name} ran out of time. Disabling...`);
          await disableUser(child.jellyfin_user_id);
          activeTracking.delete(child.id);
        }
      }
    } else {
      // Not playing - clean up tracking
      if (tracking) {
        activeTracking.delete(child.id);
      }

      // Ensure re-enabled if they have time remaining (e.g., after new day)
      if (remaining > 0) {
        await enableUser(child.jellyfin_user_id);
      }
    }
  }
}

export function startPolling() {
  console.log(`[JellyTime] Starting session poller every ${POLL_INTERVAL_SECONDS}s`);
  // Run immediately, then on schedule
  poll().catch(console.error);
  cron.schedule(`*/${POLL_INTERVAL_SECONDS} * * * * *`, () => {
    poll().catch(console.error);
  });

  // Midnight reset: re-enable all children for new day
  cron.schedule('0 0 * * *', async () => {
    console.log('[JellyTime] Midnight reset - re-enabling all children');
    const db = getDb();
    const children = db.prepare('SELECT * FROM children').all();
    for (const child of children) {
      await enableUser(child.jellyfin_user_id);
    }
  });
}

export function getRemainingMinutes(childId) {
  const db = getDb();
  const child = db.prepare('SELECT * FROM children WHERE id=?').get(childId);
  if (!child) return 0;
  const ledger = getLedger(db, childId);
  const total = child.daily_limit_minutes + ledger.bonus_minutes;
  return Math.max(0, total - ledger.minutes_used);
}
