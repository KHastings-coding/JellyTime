import express from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db.js';
import { requireAuth } from './auth.js';
import { sendError } from '../httpError.js';
import {
  parseMinutes, validateAssignments, setAssignments, assignToAllChildren, getAssignments, effectiveMinutes,
} from '../templates.js';

const router = express.Router();

// GET /api/removals/templates[?childId=] — with childId: only that kid's, at their minutes
router.get('/templates', requireAuth, (req, res) => {
  const db = getDb();
  const templates = db.prepare('SELECT * FROM removal_templates WHERE active=1 ORDER BY name').all();
  const { childId } = req.query;
  if (childId) {
    return res.json(templates.flatMap(t => {
      const minutes = effectiveMinutes(db, 'removal', t.id, childId, t.minutes);
      return minutes === null ? [] : [{ ...t, default_minutes: t.minutes, minutes }];
    }));
  }
  res.json(templates.map(t => ({ ...t, assignments: getAssignments(db, 'removal', t.id) })));
});

// POST /api/removals/templates
router.post('/templates', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { name, icon, minutes, assignments } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (name.trim().length > 200) return res.status(400).json({ error: 'Name must be 200 characters or fewer' });
    const m = parseMinutes(minutes, 'Minutes');
    const list = assignments === undefined ? null : validateAssignments(db, assignments);
    const id = randomUUID();
    db.transaction(() => {
      db.prepare('INSERT INTO removal_templates (id, name, icon, minutes) VALUES (?,?,?,?)')
        .run(id, name.trim(), icon || '⚠️', m);
      if (list) setAssignments(db, 'removal', id, list);
      else assignToAllChildren(db, 'removal', id);
    })();
    res.json({ id });
  } catch (e) { sendError(res, e); }
});

// PUT /api/removals/templates/:id
router.put('/templates/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM removal_templates WHERE id=? AND active=1').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name, icon, minutes, assignments } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (name.trim().length > 200) return res.status(400).json({ error: 'Name must be 200 characters or fewer' });
    const m = parseMinutes(minutes, 'Minutes');
    const list = assignments === undefined ? null : validateAssignments(db, assignments);
    db.transaction(() => {
      db.prepare('UPDATE removal_templates SET name=?, icon=?, minutes=? WHERE id=?')
        .run(name.trim(), icon || existing.icon, m, existing.id);
      if (list) setAssignments(db, 'removal', existing.id, list);
    })();
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// DELETE /api/removals/templates/:id — soft delete; past removals keep their reason
router.delete('/templates/:id', requireAuth, (req, res) => {
  getDb().prepare('UPDATE removal_templates SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
