import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  addDays, dayKeyFor, isValidResetTime, isValidTimezone, getClockSettings, today,
  DEFAULT_TIMEZONE, DEFAULT_RESET_TIME,
} from '../src/clock.js';

function settingsDb(values = {}) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  for (const [k, v] of Object.entries(values)) db.prepare('INSERT INTO settings VALUES (?,?)').run(k, v);
  return db;
}

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-10-19', 0), '2026-10-19');
});

test('dayKeyFor uses the configured timezone, not UTC', () => {
  // 05:30 UTC on the 19th is 23:30 on the 18th in Denver (MDT, UTC-6)
  assert.equal(dayKeyFor(new Date('2026-10-19T05:30:00Z'), 'America/Denver', '00:00'), '2026-10-18');
  assert.equal(dayKeyFor(new Date('2026-10-19T06:00:00Z'), 'America/Denver', '00:00'), '2026-10-19');
});

test('dayKeyFor treats time before the reset as the previous day', () => {
  // 06:00 MDT is 12:00 UTC
  assert.equal(dayKeyFor(new Date('2026-10-19T11:59:00Z'), 'America/Denver', '06:00'), '2026-10-18');
  assert.equal(dayKeyFor(new Date('2026-10-19T12:00:00Z'), 'America/Denver', '06:00'), '2026-10-19');
});

test('dayKeyFor handles the DST fall-back night', () => {
  // US DST ends 2026-11-01; midnight on 11-02 is 07:00 UTC (MST, UTC-7)
  assert.equal(dayKeyFor(new Date('2026-11-02T06:59:00Z'), 'America/Denver', '00:00'), '2026-11-01');
  assert.equal(dayKeyFor(new Date('2026-11-02T07:00:00Z'), 'America/Denver', '00:00'), '2026-11-02');
});

test('validation of reset time and timezone', () => {
  for (const ok of ['00:00', '06:30', '23:59']) assert.equal(isValidResetTime(ok), true, ok);
  for (const bad of ['24:00', '6:30', 'abc', '', null, undefined, 630]) assert.equal(isValidResetTime(bad), false, String(bad));
  assert.equal(isValidTimezone('America/Denver'), true);
  assert.equal(isValidTimezone('UTC'), true);
  for (const bad of ['Mars/Base', '', null, 42]) assert.equal(isValidTimezone(bad), false, String(bad));
});

test('getClockSettings falls back to defaults for missing or invalid stored values', () => {
  assert.deepEqual(getClockSettings(settingsDb()), { timezone: DEFAULT_TIMEZONE, resetTime: DEFAULT_RESET_TIME });
  assert.deepEqual(
    getClockSettings(settingsDb({ timezone: 'Mars/Base', reset_time: 'abc' })),
    { timezone: DEFAULT_TIMEZONE, resetTime: DEFAULT_RESET_TIME },
  );
  assert.deepEqual(
    getClockSettings(settingsDb({ timezone: 'UTC', reset_time: '06:00' })),
    { timezone: 'UTC', resetTime: '06:00' },
  );
});

test('today reads the clock settings', () => {
  const db = settingsDb({ timezone: 'UTC', reset_time: '00:00' });
  assert.equal(today(db, new Date('2026-10-19T23:59:00Z')), '2026-10-19');
});
