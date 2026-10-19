import express from 'express';
import { getDb } from '../db.js';
import { requireAuth } from './auth.js';
import { getUsers } from '../jellyfin.js';
import { randomUUID } from 'crypto';
import { HttpError, sendError } from '../httpError.js';
import { childSummary, listAdjustments } from '../accounting.js';
import { assignAllTemplatesToChild } from '../templates.js';
import { today } from '../clock.js';

const router = express.Router();

// Strict whole-number parse: a JS number, or a digits-only string. Anything else is NaN.
function strictNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return NaN;
}

function parseChildOptions(body, existing) {
  let bank_cap_minutes;
  const cap = body.bank_cap_minutes;
  if (cap === undefined && existing) bank_cap_minutes = existing.bank_cap_minutes;
  else if (cap === null || cap === undefined || cap === '') bank_cap_minutes = null;
  else {
    bank_cap_minutes = strictNumber(cap);
    if (!Number.isInteger(bank_cap_minutes) || bank_cap_minutes < 0 || bank_cap_minutes > 10000) {
      throw new HttpError(400, 'Bank cap must be blank or a whole number of minutes (0–10000)');
    }
  }
  const debt_mode = body.debt_mode ?? (existing ? existing.debt_mode : 'carry');
  if (!['carry', 'forgive'].includes(debt_mode)) throw new HttpError(400, "debt_mode must be 'carry' or 'forgive'");
  return { bank_cap_minutes, debt_mode };
}

function parseDailyLimit(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = strictNumber(value);
  if (!Number.isInteger(n) || n < 0 || n > 1440) throw new HttpError(400, 'Daily limit must be 0–1440 minutes');
  return n;
}

// GET /api/children - list all managed children with today's balance
router.get('/', (req, res) => {
  const db = getDb();
  const children = db.prepare('SELECT * FROM children ORDER BY name').all();
  res.json(children.map(child => ({ ...child, ...childSummary(db, child) })));
});

// GET /api/children/:id/status - for child dashboard
router.get('/:id/status', (req, res) => {
  const db = getDb();
  const child = db.prepare('SELECT * FROM children WHERE id=?').get(req.params.id);
  if (!child) return res.status(404).json({ error: 'Not found' });

  const summary = childSummary(db, child);
  const pendingChores = db.prepare(
    "SELECT COUNT(*) as c FROM chore_completions WHERE child_id=? AND date=? AND status='pending'"
  ).get(child.id, summary.date).c;

  res.json({
    id: child.id,
    name: child.name,
    avatar_emoji: child.avatar_emoji,
    bank_cap_minutes: child.bank_cap_minutes,
    debt_mode: child.debt_mode,
    ...summary,
    pending_chores: pendingChores,
    recent: listAdjustments(db, child.id, { days: 7, limit: 10 }),
  });
});

// POST /api/children - add a child
router.post('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { jellyfin_user_id, name, avatar_emoji } = req.body;
    if (!jellyfin_user_id || !name) return res.status(400).json({ error: 'jellyfin_user_id and name required' });
    const { bank_cap_minutes, debt_mode } = parseChildOptions(req.body);
    const daily = parseDailyLimit(req.body.daily_limit_minutes, 60);

    const id = randomUUID();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO children (id, jellyfin_user_id, name, avatar_emoji, daily_limit_minutes, bank_cap_minutes, debt_mode)
        VALUES (?,?,?,?,?,?,?)
      `).run(id, jellyfin_user_id, name, avatar_emoji || '🧒', daily, bank_cap_minutes, debt_mode);
      assignAllTemplatesToChild(db, id);
    })();
    res.json({ id });
  } catch (e) { sendError(res, e); }
});

// PUT /api/children/:id - update child settings
router.put('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const child = db.prepare('SELECT * FROM children WHERE id=?').get(req.params.id);
    if (!child) return res.status(404).json({ error: 'Not found' });
    const { name, avatar_emoji } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) throw new HttpError(400, 'name cannot be blank');
    const { bank_cap_minutes, debt_mode } = parseChildOptions(req.body, child);
    const daily = parseDailyLimit(req.body.daily_limit_minutes, child.daily_limit_minutes);
    db.transaction(() => {
      db.prepare(`
        UPDATE children SET name=?, avatar_emoji=?, daily_limit_minutes=?, bank_cap_minutes=?, debt_mode=? WHERE id=?
      `).run(name !== undefined ? name.trim() : child.name, avatar_emoji ?? child.avatar_emoji, daily, bank_cap_minutes, debt_mode, child.id);
      // A new limit applies from today, as it did before rollover existed
      db.prepare('UPDATE time_ledger SET daily_limit_minutes=? WHERE child_id=? AND date=? AND settled=0')
        .run(daily, child.id, today(db));
    })();
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
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
