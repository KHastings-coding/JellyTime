import { getDb, startApp } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { default: settingsRouter } = await import('../src/routes/settings.js');
const { scheduleReset, stopReset } = await import('../src/poller.js');

const app = await startApp([['/api/settings', settingsRouter]]);
after(async () => { stopReset(); await app.close(); });

const db = getDb();
const stored = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;

test('GET reports the default timezone and reset time when none are stored', async () => {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('jellyfin_url','https://jf.test')").run();
  const r = await app.call('GET', '/api/settings');
  assert.equal(r.status, 200);
  assert.equal(r.body.timezone, 'America/Denver');
  assert.equal(r.body.reset_time, '00:00');
});

test('the Settings page payload is accepted as-is', async () => {
  const r = await app.call('POST', '/api/settings', {
    jellyfin_url: 'https://jf.test', jellyfin_api_key: '***configured***',
    reset_time: '06:00', timezone: 'America/Chicago', local_login_enabled: 'true',
  });
  assert.equal(r.status, 200);
  assert.equal(stored('reset_time'), '06:00');
  assert.equal(stored('timezone'), 'America/Chicago');
  assert.equal(stored('jellyfin_api_key'), undefined);
});

test('a malformed reset_time is rejected and never stored', async () => {
  const r = await app.call('POST', '/api/settings', { reset_time: 'abc' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /HH:MM/);
  assert.equal(stored('reset_time'), '06:00');
});

test('an unknown timezone is rejected and nothing else is saved', async () => {
  const r = await app.call('POST', '/api/settings', { timezone: 'Mars/Base', reset_time: '07:00' });
  assert.equal(r.status, 400);
  assert.equal(stored('timezone'), 'America/Chicago');
  assert.equal(stored('reset_time'), '06:00');
});

test('settings changes require auth once Jellyfin is configured', async () => {
  const r = await app.call('POST', '/api/settings', { reset_time: '05:00' }, { auth: false });
  assert.equal(r.status, 401);
});

test('scheduleReset survives bad values already stored in the database', () => {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('reset_time','abc')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone','Mars/Base')").run();
  assert.doesNotThrow(() => scheduleReset());
  stopReset();
});
