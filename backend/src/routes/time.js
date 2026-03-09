import express from 'express';
import { getDb } from '../db.js';
import { requireAuth } from './auth.js';
import { enableUser } from '../jellyfin.js';

const router = express.Router();

function today() {
  return new Date().toISOString().slice(0, 10);
}

// POST /api/time/grant - parent manually grants bonus time
router.post('/grant', requireAuth, (req, res) => {
  const db = getDb();
  const { childId, minutes, date: targetDate } = req.body;
  const date = targetDate || today();

  const child = db.prepare('SELECT * FROM children WHERE id=?').get(childId);
  if (!child) return res.status(404).json({ error: 'Child not found' });

  db.prepare(`
    INSERT INTO time_ledger (child_id, date, minutes_used, bonus_minutes) VALUES (?,?,0,?)
    ON CONFLICT(child_id, date) DO UPDATE SET bonus_minutes = bonus_minutes + ?
  `).run(childId, date, minutes, minutes);

  // Re-enable if they were cut off
  enableUser(child.jellyfin_user_id).catch(console.error);

  res.json({ ok: true });
});

// POST /api/time/reset - reset today's usage for a child
router.post('/reset', requireAuth, (req, res) => {
  const db = getDb();
  const { childId } = req.body;
  const date = today();

  db.prepare(`
    INSERT INTO time_ledger (child_id, date, minutes_used, bonus_minutes) VALUES (?,?,0,0)
    ON CONFLICT(child_id, date) DO UPDATE SET minutes_used=0, bonus_minutes=0
  `).run(childId, date);

  const child = db.prepare('SELECT * FROM children WHERE id=?').get(childId);
  if (child) enableUser(child.jellyfin_user_id).catch(console.error);

  res.json({ ok: true });
});

// GET /api/time/history/:childId
router.get('/history/:childId', requireAuth, (req, res) => {
  const db = getDb();
  const { days = 7 } = req.query;
  const rows = db.prepare(`
    SELECT * FROM time_ledger 
    WHERE child_id=? 
    ORDER BY date DESC 
    LIMIT ?
  `).all(req.params.childId, parseInt(days));
  res.json(rows);
});

// GET /api/time/today-all - all children's status today for parent dashboard
router.get('/today-all', requireAuth, (req, res) => {
  const db = getDb();
  const date = today();
  const children = db.prepare('SELECT * FROM children').all();

  const result = children.map(child => {
    const ledger = db.prepare('SELECT * FROM time_ledger WHERE child_id=? AND date=?').get(child.id, date);
    const minutesUsed = ledger?.minutes_used || 0;
    const bonusMinutes = ledger?.bonus_minutes || 0;
    const totalAllowed = child.daily_limit_minutes + bonusMinutes;

    return {
      ...child,
      minutes_used: Math.round(minutesUsed),
      bonus_minutes: bonusMinutes,
      total_allowed: totalAllowed,
      remaining_minutes: Math.max(0, Math.round(totalAllowed - minutesUsed)),
      pct_used: Math.min(100, Math.round((minutesUsed / totalAllowed) * 100)),
    };
  });

  res.json(result);
});

export default router;
