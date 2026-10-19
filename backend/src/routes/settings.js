import express from 'express';
import { getDb } from '../db.js';
import { requireAuth } from './auth.js';
import { testConnection } from '../jellyfin.js';
import { scheduleReset } from '../poller.js';
import { getClockSettings, isValidResetTime, isValidTimezone } from '../clock.js';

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) {
    if (r.key === 'jellyfin_api_key') {
      settings[r.key] = r.value ? '***configured***' : '';
    } else {
      settings[r.key] = r.value;
    }
  }
  const clock = getClockSettings(db);
  settings.timezone = clock.timezone;
  settings.reset_time = clock.resetTime;
  res.json(settings);
});

function requireAuthIfConfigured(req, res, next) {
  const db = getDb();
  const jfUrl = db.prepare("SELECT value FROM settings WHERE key='jellyfin_url'").get();
  if (!jfUrl?.value) return next(); // setup mode — allow unauthenticated
  return requireAuth(req, res, next);
}

const provided = v => v !== undefined && v !== null && v !== '';

router.post('/', requireAuthIfConfigured, (req, res) => {
  const db = getDb();
  const { jellyfin_url, jellyfin_api_key, local_login_enabled, reset_time, timezone } = req.body;

  if (provided(reset_time) && !isValidResetTime(reset_time)) {
    return res.status(400).json({ error: 'Reset time must be HH:MM (24-hour)' });
  }
  if (provided(timezone) && !isValidTimezone(timezone)) {
    return res.status(400).json({ error: 'Unknown timezone' });
  }

  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  if (jellyfin_url) upsert.run('jellyfin_url', jellyfin_url.replace(/\/$/, ''));
  if (jellyfin_api_key && jellyfin_api_key !== '***configured***') {
    upsert.run('jellyfin_api_key', jellyfin_api_key);
  }
  if (typeof local_login_enabled === 'boolean') {
    upsert.run('local_login_enabled', local_login_enabled ? 'true' : 'false');
  }
  if (provided(reset_time)) upsert.run('reset_time', reset_time);
  if (provided(timezone)) upsert.run('timezone', timezone);
  if (provided(reset_time) || provided(timezone)) scheduleReset();

  res.json({ ok: true });
});

router.post('/test', async (req, res) => {
  const { jellyfin_url, jellyfin_api_key } = req.body;
  const db = getDb();
  const storedKey = db.prepare("SELECT value FROM settings WHERE key='jellyfin_api_key'").get();
  const apiKey = (jellyfin_api_key && jellyfin_api_key !== '***configured***')
    ? jellyfin_api_key
    : storedKey?.value;

  if (!jellyfin_url || !apiKey) return res.status(400).json({ error: 'URL and API key required' });
  const result = await testConnection(jellyfin_url.replace(/\/$/, ''), apiKey);
  res.json(result);
});

export default router;
