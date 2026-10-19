import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { getDb } from '../db.js';
import { randomUUID } from 'crypto';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'jellytime-secret-change-me';

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// POST /api/auth/setup - first-time parent account creation
router.post('/setup', async (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) as c FROM parent_accounts').get();
  if (existing.c > 0) return res.status(400).json({ error: 'Already set up' });

  const { username, password, display_name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const hash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  db.prepare('INSERT INTO parent_accounts (id, username, password_hash, display_name) VALUES (?,?,?,?)').run(id, username, hash, display_name || null);
  res.json({ ok: true });
});

// GET /api/auth/setup-status
router.get('/setup-status', (req, res) => {
  const db = getDb();
  const jfUrl = db.prepare("SELECT value FROM settings WHERE key='jellyfin_url'").get();
  const parentCount = db.prepare('SELECT COUNT(*) as c FROM parent_accounts').get();
  const localLogin = db.prepare("SELECT value FROM settings WHERE key='local_login_enabled'").get();
  const jellyfinConfigured = !!jfUrl?.value;
  res.json({
    jellyfinConfigured,
    hasParentAccount: parentCount.c > 0,
    localLoginEnabled: !jellyfinConfigured || localLogin?.value === 'true',
  });
});

// GET /api/auth/needs-setup (legacy — kept for compatibility)
router.get('/needs-setup', (req, res) => {
  const db = getDb();
  const jfUrl = db.prepare("SELECT value FROM settings WHERE key='jellyfin_url'").get();
  res.json({ needsSetup: !jfUrl?.value });
});

// GET /api/auth/local-users — list local parent accounts
router.get('/local-users', requireAuth, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, display_name, username, created_at FROM parent_accounts ORDER BY created_at ASC').all();
  res.json(users);
});

// POST /api/auth/local-users — create new local parent account
router.post('/local-users', requireAuth, async (req, res) => {
  const db = getDb();
  const { display_name, username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.prepare('SELECT id FROM parent_accounts WHERE username=?').get(username);
  if (existing) return res.status(400).json({ error: 'Username already exists' });

  const hash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  db.prepare('INSERT INTO parent_accounts (id, username, password_hash, display_name) VALUES (?,?,?,?)').run(id, username, hash, display_name || null);
  res.json({ id });
});

// DELETE /api/auth/local-users/:id — delete a local account
router.delete('/local-users/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM parent_accounts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/auth/jellyfin-login
router.post('/jellyfin-login', async (req, res) => {
  const db = getDb();
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const urlRow = db.prepare("SELECT value FROM settings WHERE key='jellyfin_url'").get();
  if (!urlRow?.value) return res.status(400).json({ error: 'Jellyfin not configured' });

  try {
    const jfRes = await axios.post(
      `${urlRow.value}/Users/AuthenticateByName`,
      { Username: username, Pw: password },
      {
        headers: {
          'Authorization': 'MediaBrowser Client="JellyTime", Device="JellyTime", DeviceId="jellytime", Version="1.0"',
          'Content-Type': 'application/json',
        },
        timeout: 8000,
      }
    );
    const user = jfRes.data?.User;
    if (!user?.Policy?.IsAdministrator) {
      return res.status(403).json({ error: 'Jellyfin account must be an administrator' });
    }
    const token = jwt.sign({ id: user.Id, username: user.Name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.Name });
  } catch (e) {
    if (e.response?.status === 401) return res.status(401).json({ error: 'Invalid Jellyfin credentials' });
    res.status(500).json({ error: 'Jellyfin connection failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const db = getDb();
  const { username, password } = req.body;
  const account = db.prepare('SELECT * FROM parent_accounts WHERE username=?').get(username);
  if (!account) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: account.id, username: account.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: account.username });
});

// POST /api/auth/child-login - simple PIN or name-based for child interface
router.post('/child-login', (req, res) => {
  const db = getDb();
  const { childId } = req.body;
  const child = db.prepare('SELECT * FROM children WHERE id=?').get(childId);
  if (!child) return res.status(404).json({ error: 'Child not found' });

  const token = jwt.sign({ childId: child.id, role: 'child' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, child: { id: child.id, name: child.name, avatar_emoji: child.avatar_emoji } });
});

export function requireChildAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    if (decoded.role !== 'child') return res.status(403).json({ error: 'Forbidden' });
    req.child = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export default router;
