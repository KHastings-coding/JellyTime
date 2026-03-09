import express from 'express';
import { getDb } from '../db.js';
import { requireAuth } from './auth.js';
import { getUsers } from '../jellyfin.js';
import { randomUUID } from 'crypto';

const router = express.Router();

// GET /api/children - list all managed children
router.get('/', (req, res) => {
  const db = getDb();
  const children = db.prepare('SELECT * FROM children ORDER BY name').all();
  const today = new Date().toISOString().slice(0, 10);

  const result = children.map(child => {
    const ledger = db.prepare('SELECT * FROM time_ledger WHERE child_id=? AND date=?').get(child.id, today);
    const minutesUsed = ledger?.minutes_used || 0;
    const bonusMinutes = ledger?.bonus_minutes || 0;
    const totalAllowed = child.daily_limit_minutes + bonusMinutes;
    return {
      ...child,
      minutes_used: Math.round(minutesUsed),
      bonus_minutes: bonusMinutes,
      total_allowed: totalAllowed,
      remaining_minutes: Math.max(0, Math.round(totalAllowed - minutesUsed)),
    };
  });

  res.json(result);
});

// GET /api/children/:id/status - for child dashboard
router.get('/:id/status', (req, res) => {
  const db = getDb();
  const child = db.prepare('SELECT * FROM children WHERE id=?').get(req.params.id);
  if (!child) return res.status(404).json({ error: 'Not found' });

  const today = new Date().toISOString().slice(0, 10);
  const ledger = db.prepare('SELECT * FROM time_ledger WHERE child_id=? AND date=?').get(child.id, today);
  const minutesUsed = ledger?.minutes_used || 0;
  const bonusMinutes = ledger?.bonus_minutes || 0;
  const totalAllowed = child.daily_limit_minutes + bonusMinutes;
  const remaining = Math.max(0, totalAllowed - minutesUsed);

  const pendingChores = db.prepare(`
    SELECT cc.*, ct.name, ct.icon, ct.reward_minutes
    FROM chore_completions cc
    JOIN chore_templates ct ON cc.chore_id = ct.id
    WHERE cc.child_id=? AND cc.date=? AND cc.status='pending'
  `).all(child.id, today);

  res.json({
    id: child.id,
    name: child.name,
    avatar_emoji: child.avatar_emoji,
    daily_limit_minutes: child.daily_limit_minutes,
    minutes_used: Math.round(minutesUsed),
    bonus_minutes: bonusMinutes,
    total_allowed: totalAllowed,
    remaining_minutes: Math.round(remaining),
    pending_chores: pendingChores.length,
  });
});

// POST /api/children - add a child
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { jellyfin_user_id, name, avatar_emoji, daily_limit_minutes } = req.body;
  if (!jellyfin_user_id || !name) return res.status(400).json({ error: 'jellyfin_user_id and name required' });

  const id = randomUUID();
  db.prepare(`
    INSERT INTO children (id, jellyfin_user_id, name, avatar_emoji, daily_limit_minutes)
    VALUES (?,?,?,?,?)
  `).run(id, jellyfin_user_id, name, avatar_emoji || '🧒', daily_limit_minutes || 60);

  res.json({ id });
});

// PUT /api/children/:id - update child settings
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { name, avatar_emoji, daily_limit_minutes } = req.body;
  db.prepare(`
    UPDATE children SET name=?, avatar_emoji=?, daily_limit_minutes=? WHERE id=?
  `).run(name, avatar_emoji, daily_limit_minutes, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/children/:id
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM children WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/children/jellyfin-users - fetch Jellyfin user list for setup
router.get('/jellyfin-users', requireAuth, async (req, res) => {
  try {
    const users = await getUsers();
    const db = getDb();
    const managed = db.prepare('SELECT jellyfin_user_id FROM children').all().map(r => r.jellyfin_user_id);
    const available = users
      .filter(u => !u.Policy?.IsAdministrator)
      .map(u => ({ id: u.Id, name: u.Name, isManaged: managed.includes(u.Id) }));
    res.json(available);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
