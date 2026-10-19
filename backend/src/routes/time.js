import express from 'express';
import { getDb } from '../db.js';
import { requireAuth } from './auth.js';
import { enableUser, disableUser } from '../jellyfin.js';
import { HttpError, sendError } from '../httpError.js';
import {
  applyAdjustment, undoAdjustment, resetUsage, childSummary, listAdjustments, getChild,
} from '../accounting.js';
import { parseMinutes, effectiveMinutes } from '../templates.js';

const router = express.Router();

function requireChild(db, childId) {
  const child = getChild(db, childId);
  if (!child) throw new HttpError(404, 'Child not found');
  return child;
}

// Apply the balance to Jellyfin right away instead of waiting for the next poll.
function syncJellyfin(child, summary) {
  const update = summary.available > 0 ? enableUser : disableUser;
  update(child.jellyfin_user_id).catch(console.error);
}

function adjust(req, res) {
  try {
    const db = getDb();
    const { childId, kind, minutes, reason, templateId } = req.body;
    const child = requireChild(db, childId);
    let entry;
    if (kind === 'grant') {
      entry = { minutes: parseMinutes(minutes, 'Minutes'), reason: reason?.trim() || 'Bonus from parent', icon: '🎁' };
    } else if (kind === 'removal' && templateId) {
      const t = db.prepare('SELECT * FROM removal_templates WHERE id=? AND active=1').get(templateId);
      const m = t ? effectiveMinutes(db, 'removal', t.id, child.id, t.minutes) : null;
      if (m === null) throw new HttpError(400, 'That removal is not set up for this child');
      entry = { minutes: -m, reason: t.name, icon: t.icon, templateId: t.id };
    } else if (kind === 'removal') {
      if (!reason?.trim()) throw new HttpError(400, 'A reason is required when removing time');
      entry = { minutes: -parseMinutes(minutes, 'Minutes'), reason: reason.trim(), icon: '⚠️' };
    } else {
      throw new HttpError(400, "kind must be 'grant' or 'removal'");
    }
    const { id, summary } = applyAdjustment(db, { childId: child.id, kind, ...entry });
    syncJellyfin(child, summary);
    res.json({ ok: true, id, summary });
  } catch (e) { sendError(res, e); }
}

// POST /api/time/adjust - parent adds or removes time
router.post('/adjust', requireAuth, adjust);

// POST /api/time/grant - older clients; same as adjust with kind=grant
router.post('/grant', requireAuth, (req, res) => {
  req.body = { ...req.body, kind: 'grant' };
  adjust(req, res);
});

// DELETE /api/time/adjust/:id - undo one of today's grants or removals
router.delete('/adjust/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const adj = undoAdjustment(db, Number(req.params.id));
    const child = requireChild(db, adj.child_id);
    const summary = childSummary(db, child);
    syncJellyfin(child, summary);
    res.json({ ok: true, summary });
  } catch (e) { sendError(res, e); }
});

// POST /api/time/reset - clear today's watched time (earned and removed time stay)
router.post('/reset', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const child = requireChild(db, req.body.childId);
    resetUsage(db, child);
    const summary = childSummary(db, child);
    syncJellyfin(child, summary);
    res.json({ ok: true, summary });
  } catch (e) { sendError(res, e); }
});

// GET /api/time/adjustments/:childId?days=7
router.get('/adjustments/:childId', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const child = requireChild(db, req.params.childId);
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7));
    res.json({ today: childSummary(db, child).date, adjustments: listAdjustments(db, child.id, { days }) });
  } catch (e) { sendError(res, e); }
});

// GET /api/time/history/:childId
router.get('/history/:childId', requireAuth, (req, res) => {
  const db = getDb();
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7));
  res.json(db.prepare('SELECT * FROM time_ledger WHERE child_id=? ORDER BY date DESC LIMIT ?')
    .all(req.params.childId, days));
});

// GET /api/time/today-all - all children's balance for the parent dashboard
router.get('/today-all', requireAuth, (req, res) => {
  const db = getDb();
  const children = db.prepare('SELECT * FROM children ORDER BY name').all();
  res.json(children.map(child => ({ ...child, ...childSummary(db, child) })));
});

export default router;
