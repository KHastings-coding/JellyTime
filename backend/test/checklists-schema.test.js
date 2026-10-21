import { getDb } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { migrateToV3 } = await import('../src/db.js');
const { parseMinutes } = await import('../src/templates.js');
const db = getDb();

test('initDb leaves schema v3 with the checklist tables and index', () => {
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='schema_version'").get().value, '3');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all().map(r => r.name);
  for (const n of ['checklist_templates', 'checklist_items', 'checklist_runs', 'checklist_fences', 'idx_checklist_runs_child_date']) {
    assert.ok(names.includes(n), n);
  }
});

test('migrateToV3 is idempotent', () => {
  migrateToV3(db);
  migrateToV3(db);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='schema_version'").get().value, '3');
});

test('migrateToV3 builds the tables when upgrading from v2', () => {
  db.exec('DROP TABLE checklist_fences; DROP TABLE checklist_runs; DROP TABLE checklist_items; DROP TABLE checklist_templates');
  db.prepare("UPDATE settings SET value='2' WHERE key='schema_version'").run();
  migrateToV3(db);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='schema_version'").get().value, '3');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('checklist_templates','checklist_items','checklist_runs','checklist_fences')").get().c, 4);
});

test('parseMinutes honours a custom range and defaults to 1-1440', () => {
  assert.equal(parseMinutes(0, 'x', { min: 0, max: 600 }), 0);
  assert.throws(() => parseMinutes(601, 'x', { min: 0, max: 600 }), e => e.status === 400 && /from 0 to 600/.test(e.message));
  assert.throws(() => parseMinutes(0, 'x'), e => e.status === 400 && /from 1 to 1440/.test(e.message));
  assert.equal(parseMinutes(1440, 'x'), 1440);
});
