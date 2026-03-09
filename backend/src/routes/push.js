import express from 'express';
import webpush from 'web-push';
import { getDb } from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();

// GET /api/push/vapid-key — public
router.get('/vapid-key', (req, res) => {
  const db = getDb();
  const keys = db.prepare('SELECT public_key FROM vapid_keys WHERE id=1').get();
  if (!keys) return res.status(503).json({ error: 'VAPID not initialized' });
  res.json({ publicKey: keys.public_key });
});

// POST /api/push/subscribe — requireAuth
router.post('/subscribe', requireAuth, (req, res) => {
  const db = getDb();
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES (?, ?, ?)
  `).run(endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

// POST /api/push/unsubscribe — requireAuth
router.post('/unsubscribe', requireAuth, (req, res) => {
  const db = getDb();
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);
  res.json({ ok: true });
});

export async function sendPushToAllParents(title, body, url) {
  const db = getDb();
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  const payload = JSON.stringify({ title, body, url });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (err) {
      if (err.statusCode === 410) {
        // Subscription expired — remove it
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(sub.endpoint);
      }
    }
  }
}

export default router;
