// Shared setup for tests that use the app's singleton DB and real routers.
// Import this before any ../src module, then load src modules with `await import(...)`.
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

import express from 'express';
import jwt from 'jsonwebtoken';

const db = await import('../src/db.js');
db.initDb();
export const getDb = db.getDb;

export function authHeaders() {
  return { Authorization: `Bearer ${jwt.sign({ id: 'test-parent', username: 'parent' }, 'test-secret')}` };
}

export async function startApp(mounts) {
  const app = express();
  app.use(express.json());
  for (const [path, router] of mounts) app.use(path, router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, path, body, { auth = true } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? authHeaders() : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

let seq = 0;
export function addChild(database, { daily = 30, bankCap = null, debtMode = 'carry' } = {}) {
  const id = `kid-${++seq}-${Date.now()}`;
  database.prepare(`INSERT INTO children (id, jellyfin_user_id, name, daily_limit_minutes, bank_cap_minutes, debt_mode)
    VALUES (?,?,?,?,?,?)`).run(id, `jf-${id}`, `Kid ${seq}`, daily, bankCap, debtMode);
  return database.prepare('SELECT * FROM children WHERE id=?').get(id);
}

export function setClock(database, timezone = 'UTC', resetTime = '00:00') {
  const upsert = database.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  upsert.run('timezone', timezone);
  upsert.run('reset_time', resetTime);
}
