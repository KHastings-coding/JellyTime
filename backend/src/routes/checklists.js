import express from 'express';
import { getDb } from '../db.js';
import { requireAuth } from './auth.js';
import { sendPushToAllParents } from './push.js';
import { getChild } from '../accounting.js';
import { sendError } from '../httpError.js';
import {
  createChecklist, updateChecklist, archiveChecklist, listChecklists, syncRuns,
  childRuns, tickItem, submitRun, reviewRun, pendingRuns,
} from '../checklists.js';

const router = express.Router();

// Brings every kid's runs current (missed rollovers, today's runs) before a parent view reads them.
function syncAllKids(db) {
  for (const child of db.prepare('SELECT * FROM children').all()) {
    try { syncRuns(db, child); } catch (err) { console.error(`[JellyTime] Checklist sync failed for ${child.name}:`, err); }
  }
}

router.get('/templates', requireAuth, (req, res) => {
  try {
    const db = getDb();
    syncAllKids(db);
    res.json(listChecklists(db));
  } catch (e) { sendError(res, e); }
});

router.post('/templates', requireAuth, (req, res) => {
  try { res.json({ id: createChecklist(getDb(), req.body || {}).id }); } catch (e) { sendError(res, e); }
});

router.put('/templates/:id', requireAuth, (req, res) => {
  try { updateChecklist(getDb(), req.params.id, req.body || {}); res.json({ ok: true }); } catch (e) { sendError(res, e); }
});

router.delete('/templates/:id', requireAuth, (req, res) => {
  try { archiveChecklist(getDb(), req.params.id); res.json({ ok: true }); } catch (e) { sendError(res, e); }
});

router.get('/child/:childId', (req, res) => {
  try { res.json(childRuns(getDb(), req.params.childId)); } catch (e) { sendError(res, e); }
});

router.post('/runs/:runId/tick', (req, res) => {
  try { res.json(tickItem(getDb(), Number(req.params.runId), req.body || {})); } catch (e) { sendError(res, e); }
});

router.post('/runs/:runId/submit', (req, res) => {
  try {
    const db = getDb();
    const kidName = getChild(db, req.body?.childId)?.name;
    const { view, notify } = submitRun(db, Number(req.params.runId), req.body || {});
    if (notify) {
      sendPushToAllParents('Checklist done', `${kidName ?? 'A kid'} finished ${view.name}`, '/parent/chores')
        .catch(err => console.error('[JellyTime] Checklist push failed:', err));
    }
    res.json(view);
  } catch (e) { sendError(res, e); }
});

router.get('/pending', requireAuth, (req, res) => {
  try {
    const db = getDb();
    syncAllKids(db);
    res.json(pendingRuns(db));
  } catch (e) { sendError(res, e); }
});

router.post('/runs/:runId/review', requireAuth, (req, res) => {
  try { res.json(reviewRun(getDb(), Number(req.params.runId), req.body || {})); } catch (e) { sendError(res, e); }
});

export default router;
