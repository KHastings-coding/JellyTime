import express from 'express';
import cors from 'cors';
import webpush from 'web-push';
import { initDb, getDb } from './db.js';
import { startPolling } from './poller.js';
import authRoutes from './routes/auth.js';
import choreRoutes from './routes/chores.js';
import timeRoutes from './routes/time.js';
import childRoutes from './routes/children.js';
import settingsRoutes from './routes/settings.js';
import pushRoutes from './routes/push.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chores', choreRoutes);
app.use('/api/time', timeRoutes);
app.use('/api/children', childRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/push', pushRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

function seedJellyfinFromEnv() {
  const url = process.env.JELLYFIN_URL;
  const apiKey = process.env.JELLYFIN_API_KEY;
  if (!url || !apiKey) return;
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('jellyfin_url', ?)").run(url.replace(/\/$/, ''));
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('jellyfin_api_key', ?)").run(apiKey);
  console.log('Jellyfin pre-configured from environment');
}

function initVapid() {
  const db = getDb();
  let keys = db.prepare('SELECT * FROM vapid_keys WHERE id=1').get();
  if (!keys) {
    const generated = webpush.generateVAPIDKeys();
    db.prepare('INSERT INTO vapid_keys (id, public_key, private_key) VALUES (1,?,?)').run(generated.publicKey, generated.privateKey);
    keys = { public_key: generated.publicKey, private_key: generated.privateKey };
    console.log('Generated new VAPID keys');
  }
  webpush.setVapidDetails('mailto:jellytime@localhost', keys.public_key, keys.private_key);
}

// Init
initDb();
seedJellyfinFromEnv();
initVapid();
startPolling();

app.listen(PORT, () => {
  console.log(`JellyTime backend running on port ${PORT}`);
});
