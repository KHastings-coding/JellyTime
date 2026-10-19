import express from 'express';
import { getDb } from '../db.js';
import { requireAuth } from './auth.js';
import { randomUUID } from 'crypto';
import { sendPushToAllParents } from './push.js';

const router = express.Router();

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// GET /api/chores/templates
router.get('/templates', (req, res) => {
  const db = getDb();
  const templates = db.prepare('SELECT * FROM chore_templates WHERE active=1 ORDER BY name').all();
  res.json(templates);
});

// POST /api/chores/templates
router.post('/templates', requireAuth, (req, res) => {
  const db = getDb();
  const { name, description, reward_minutes, icon, auto_approve, max_completions } = req.body;
  const id = randomUUID();
  db.prepare(`
    INSERT INTO chore_templates (id, name, description, reward_minutes, icon, auto_approve, max_completions)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, name, description || '', reward_minutes, icon || '✅', auto_approve ? 1 : 0, max_completions ?? 1);
  res.json({ id });
});

// PUT /api/chores/templates/:id
router.put('/templates/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { name, description, reward_minutes, icon, auto_approve, active, max_completions } = req.body;
  db.prepare(`
    UPDATE chore_templates SET name=?, description=?, reward_minutes=?, icon=?, auto_approve=?, active=?, max_completions=?
    WHERE id=?
  `).run(name, description, reward_minutes, icon, auto_approve ? 1 : 0, active ? 1 : 0, max_completions ?? 1, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/chores/templates/:id
router.delete('/templates/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE chore_templates SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/chores/completions?childId=xxx&date=xxx
router.get('/completions', requireAuth, (req, res) => {
  const db = getDb();
  const { childId, date } = req.query;
  let query = `
    SELECT cc.*, ct.name as chore_name, ct.icon, ch.name as child_name
    FROM chore_completions cc
    JOIN chore_templates ct ON cc.chore_id = ct.id
    JOIN children ch ON cc.child_id = ch.id
    WHERE 1=1
  `;
  const params = [];
  if (childId) { query += ' AND cc.child_id=?'; params.push(childId); }
  if (date) { query += ' AND cc.date=?'; params.push(date); }
  query += ' ORDER BY cc.submitted_at DESC';

  res.json(db.prepare(query).all(...params));
});

// GET /api/chores/pending - all pending for parent
router.get('/pending', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT cc.*, ct.name as chore_name, ct.icon, ch.name as child_name, ch.avatar_emoji
    FROM chore_completions cc
    JOIN chore_templates ct ON cc.chore_id = ct.id
    JOIN children ch ON cc.child_id = ch.id
    WHERE cc.status='pending'
    ORDER BY cc.submitted_at ASC
  `).all();
  res.json(rows);
});

// GET /api/chores/child/:childId - chores for a specific child today
router.get('/child/:childId', (req, res) => {
  const db = getDb();
  const date = today();
  const templates = db.prepare('SELECT * FROM chore_templates WHERE active=1').all();

  // Get today's completions for this child
  const completions = db.prepare(`
    SELECT * FROM chore_completions WHERE child_id=? AND date=?
  `).all(req.params.childId, date);

  const completionsByChoreId = {};
  for (const c of completions) {
    if (!completionsByChoreId[c.chore_id]) completionsByChoreId[c.chore_id] = [];
    completionsByChoreId[c.chore_id].push(c);
  }

  const result = templates.map(t => {
    const comps = completionsByChoreId[t.id] || [];
    const activeCount = comps.filter(c => c.status !== 'rejected').length;
    const can_submit = t.max_completions === 0 || activeCount < t.max_completions;
    return { ...t, completions: comps, can_submit };
  });

  res.json(result);
});

// POST /api/chores/submit - child submits a chore
router.post('/submit', (req, res) => {
  const db = getDb();
  const { childId, choreId } = req.body;
  const date = today();

  const child = db.prepare('SELECT * FROM children WHERE id=?').get(childId);
  if (!child) return res.status(404).json({ error: 'Child not found' });

  const chore = db.prepare('SELECT * FROM chore_templates WHERE id=? AND active=1').get(choreId);
  if (!chore) return res.status(404).json({ error: 'Chore not found' });

  // Check completion limit
  const countRow = db.prepare(
    "SELECT COUNT(*) as c FROM chore_completions WHERE child_id=? AND chore_id=? AND date=? AND status != 'rejected'"
  ).get(childId, choreId, date);
  const limit = chore.max_completions;
  if (limit !== 0 && countRow.c >= limit) {
    return res.status(400).json({ error: 'Limit reached for today' });
  }

  const autoApprove = chore.auto_approve === 1;
  const status = autoApprove ? 'approved' : 'pending';

  db.prepare(`
    INSERT INTO chore_completions (child_id, chore_id, status, reward_minutes, date, reviewed_at)
    VALUES (?,?,?,?,?,?)
  `).run(childId, choreId, status, chore.reward_minutes, date, autoApprove ? Math.floor(Date.now() / 1000) : null);

  // If auto-approved, grant time immediately
  if (autoApprove) {
    db.prepare(`
      INSERT INTO time_ledger (child_id, date, minutes_used, bonus_minutes) VALUES (?,?,0,?)
      ON CONFLICT(child_id, date) DO UPDATE SET bonus_minutes = bonus_minutes + ?
    `).run(childId, date, chore.reward_minutes, chore.reward_minutes);
  } else {
    // Notify parents that a chore needs approval
    sendPushToAllParents(
      '🧹 Chore needs approval',
      `${child.name} completed "${chore.name}" — tap to review`,
      '/parent/chores'
    );
  }

  res.json({ ok: true, status, reward_minutes: chore.reward_minutes, auto_approved: autoApprove });
});

// POST /api/chores/review - parent approves or rejects
router.post('/review', requireAuth, (req, res) => {
  const db = getDb();
  const { completionId, action, note } = req.body; // action: 'approve' | 'reject'

  const completion = db.prepare('SELECT * FROM chore_completions WHERE id=?').get(completionId);
  if (!completion) return res.status(404).json({ error: 'Not found' });
  if (completion.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  db.prepare(`
    UPDATE chore_completions SET status=?, reviewed_at=unixepoch(), review_note=? WHERE id=?
  `).run(newStatus, note || null, completionId);

  if (action === 'approve') {
    db.prepare(`
      INSERT INTO time_ledger (child_id, date, minutes_used, bonus_minutes) VALUES (?,?,0,?)
      ON CONFLICT(child_id, date) DO UPDATE SET bonus_minutes = bonus_minutes + ?
    `).run(completion.child_id, completion.date, completion.reward_minutes, completion.reward_minutes);
  }

  res.json({ ok: true, status: newStatus });
});

export default router;
