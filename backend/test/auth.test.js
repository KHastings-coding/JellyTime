import { getDb, startApp, addChild, setClock, childToken } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const { default: timeRouter } = await import('../src/routes/time.js');
const { default: settingsRouter } = await import('../src/routes/settings.js');
const { default: childrenRouter } = await import('../src/routes/children.js');
const { default: choresRouter } = await import('../src/routes/chores.js');
const { stopReset } = await import('../src/poller.js');

const app = await startApp([
  ['/api/time', timeRouter], ['/api/settings', settingsRouter],
  ['/api/children', childrenRouter], ['/api/chores', choresRouter],
]);
after(async () => { stopReset(); await app.close(); });

const db = getDb();
setClock(db, 'UTC');
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('jellyfin_url','https://jf.test')").run();
const kid = addChild(db);
const token = childToken(kid.id);

test('a kid token cannot use parent routes', async () => {
  const attempts = [
    ['POST', '/api/time/adjust', { childId: kid.id, kind: 'grant', minutes: 60 }],
    ['POST', '/api/time/reset', { childId: kid.id }],
    ['GET', '/api/time/today-all'],
    ['GET', '/api/settings'],
    ['POST', '/api/settings', { reset_time: '05:00' }],
    ['PUT', `/api/children/${kid.id}`, { name: 'Hacker', daily_limit_minutes: 999 }],
    ['POST', '/api/chores/templates', { name: 'Free time', reward_minutes: 600 }],
  ];
  for (const [method, path, body] of attempts) {
    const r = await app.call(method, path, body, { token });
    assert.equal(r.status, 403, `${method} ${path}`);
  }
  const fresh = db.prepare('SELECT * FROM children WHERE id=?').get(kid.id);
  assert.equal(fresh.name, kid.name);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM time_adjustments WHERE child_id=?').get(kid.id).c, 0);
});

test('kid pages still work with a kid token', async () => {
  assert.equal((await app.call('GET', `/api/children/${kid.id}/status`, undefined, { token })).status, 200);
  assert.equal((await app.call('GET', '/api/children', undefined, { token })).status, 200);
  assert.equal((await app.call('GET', `/api/chores/child/${kid.id}`, undefined, { token })).status, 200);
});

test('parents are unaffected and missing tokens are still 401', async () => {
  assert.equal((await app.call('GET', '/api/time/today-all')).status, 200);
  assert.equal((await app.call('GET', '/api/time/today-all', undefined, { auth: false })).status, 401);
});

test('settings connection test is parent-only', async () => {
  const body = { jellyfin_url: 'http://127.0.0.1:9', jellyfin_api_key: 'k' };
  assert.equal((await app.call('POST', '/api/settings/test', body, { token })).status, 403);
  assert.equal((await app.call('POST', '/api/settings/test', body, { auth: false })).status, 401);
  assert.equal((await app.call('POST', '/api/settings/test', body)).status, 200);
});

test('tokens with a childId or a non-parent role are refused, garbage is 401', async () => {
  const noRole = jwt.sign({ childId: 'x' }, 'test-secret');
  assert.equal((await app.call('GET', '/api/time/today-all', undefined, { token: noRole })).status, 403);
  assert.equal((await app.call('GET', '/api/time/today-all', undefined, { token: 'not-a-jwt' })).status, 401);
});
