import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initDb, migrateToV2 } from '../src/db.js';
import { today, addDays } from '../src/clock.js';
import {
  ensureDay, addUsage, applyAdjustment, undoAdjustment, resetUsage, childSummary, listAdjustments,
} from '../src/accounting.js';
import { HttpError } from '../src/httpError.js';

function freshDb() {
  const db = new Database(':memory:');
  initDb(db);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone','UTC')").run();
  return db;
}

function addChild(db, { daily = 30, bankCap = null, debtMode = 'carry' } = {}) {
  const id = `kid-${Math.random().toString(36).slice(2)}`;
  db.prepare(`INSERT INTO children (id, jellyfin_user_id, name, daily_limit_minutes, bank_cap_minutes, debt_mode)
    VALUES (?,?,?,?,?,?)`).run(id, `jf-${id}`, 'Kid', daily, bankCap, debtMode);
  return db.prepare('SELECT * FROM children WHERE id=?').get(id);
}

const D1 = '2026-10-19', D2 = '2026-10-20', D3 = '2026-10-21';

test("user example: 10 earned left minus 20 removed starts tomorrow 10 short", () => {
  const db = freshDb();
  const kid = addChild(db);
  ensureDay(db, kid, D1);
  addUsage(db, kid, 30, D1);
  applyAdjustment(db, { childId: kid.id, minutes: 10, kind: 'chore', reason: 'Made bed', date: D1 });
  applyAdjustment(db, { childId: kid.id, minutes: -20, kind: 'removal', reason: 'Hit sibling', date: D1 });
  const next = childSummary(db, kid, D2);
  assert.equal(next.available, 20);
  assert.equal(next.owed, 10);
  assert.equal(next.daily_left, 30);
});

test('days with no row still settle: allotment pays debt down', () => {
  const db = freshDb();
  const kid = addChild(db);
  applyAdjustment(db, { childId: kid.id, minutes: -80, kind: 'removal', reason: 'x', date: D1 }); // carry -50
  // D2 has no row: -50 + 30 allotment -> -20 carried into D3
  assert.equal(childSummary(db, kid, D3).available, 10);
});

test('forgive mode caps inherited debt at one day', () => {
  const db = freshDb();
  const kid = addChild(db, { debtMode: 'forgive' });
  applyAdjustment(db, { childId: kid.id, minutes: -80, kind: 'removal', reason: 'x', date: D1 });
  assert.equal(childSummary(db, kid, D2).available, 0);
  assert.equal(childSummary(db, kid, D3).available, 30);
});

test('bank cap limits carried earned time', () => {
  const db = freshDb();
  const kid = addChild(db, { bankCap: 60 });
  applyAdjustment(db, { childId: kid.id, minutes: 100, kind: 'grant', reason: 'x', date: D1 });
  addUsage(db, kid, 30, D1);
  const s = childSummary(db, kid, D2);
  assert.equal(s.available, 90);
  assert.equal(s.banked, 60);
});

test('settling is idempotent and a backwards day key reuses the stored carry', () => {
  const db = freshDb();
  const kid = addChild(db);
  applyAdjustment(db, { childId: kid.id, minutes: 15, kind: 'grant', reason: 'x', date: D1 });
  ensureDay(db, kid, D3); // settles D1 with carry 15
  const d1 = db.prepare('SELECT * FROM time_ledger WHERE child_id=? AND date=?').get(kid.id, D1);
  assert.equal(d1.settled, 1);
  assert.equal(d1.carry_out_minutes, 15);
  // Timezone change moves "today" back to D2: no crash, D1 is not re-settled
  assert.throws(() => applyAdjustment(db, { childId: kid.id, minutes: 5, kind: 'grant', reason: 'late', date: D1 }),
    e => e instanceof HttpError && e.status === 400);
  const d2 = ensureDay(db, kid, D2);
  assert.equal(d2.carry_in_minutes, 15);
});

test('summary breakdown before and after the allotment is used', () => {
  const db = freshDb();
  const kid = addChild(db);
  applyAdjustment(db, { childId: kid.id, minutes: 15, kind: 'grant', reason: 'x', date: D1 });
  let s = childSummary(db, kid, D1);
  assert.deepEqual([s.remaining_minutes, s.daily_left, s.banked, s.owed], [45, 30, 15, 0]);
  addUsage(db, kid, 40, D1);
  s = childSummary(db, kid, D1);
  assert.deepEqual([s.remaining_minutes, s.daily_left, s.banked, s.owed], [5, 0, 5, 0]);
});

test("undo: today's grant/removal only, never chores or past days", () => {
  const db = freshDb();
  const kid = addChild(db);
  const t = today(db);
  const { id } = applyAdjustment(db, { childId: kid.id, minutes: -20, kind: 'removal', reason: 'x', date: t });
  assert.equal(childSummary(db, kid, t).available, 10);
  undoAdjustment(db, id);
  assert.equal(childSummary(db, kid, t).available, 30);

  const chore = applyAdjustment(db, { childId: kid.id, minutes: 10, kind: 'chore', reason: 'x', date: t });
  assert.throws(() => undoAdjustment(db, chore.id), e => e instanceof HttpError && e.status === 400);

  const old = { id: Number(db.prepare(`INSERT INTO time_adjustments (child_id, date, minutes, kind, reason)
    VALUES (?,?,10,'grant','x')`).run(kid.id, addDays(t, -1)).lastInsertRowid) };
  assert.throws(() => undoAdjustment(db, old.id), e => e instanceof HttpError && e.status === 400);
  assert.throws(() => undoAdjustment(db, 999999), e => e instanceof HttpError && e.status === 404);
});

test('resetUsage clears watched time but keeps earned time', () => {
  const db = freshDb();
  const kid = addChild(db);
  applyAdjustment(db, { childId: kid.id, minutes: 15, kind: 'grant', reason: 'x', date: D1 });
  addUsage(db, kid, 40, D1);
  resetUsage(db, kid, D1);
  assert.equal(childSummary(db, kid, D1).available, 45);
});

test('applyAdjustment rejects unknown children', () => {
  const db = freshDb();
  assert.throws(() => applyAdjustment(db, { childId: 'nope', minutes: 5, kind: 'grant' }), e => e.status === 404);
});

test('listAdjustments returns the window newest first', () => {
  const db = freshDb();
  const kid = addChild(db);
  const t = today(db);
  applyAdjustment(db, { childId: kid.id, minutes: 5, kind: 'grant', reason: 'old', date: addDays(t, -10) });
  applyAdjustment(db, { childId: kid.id, minutes: 5, kind: 'grant', reason: 'first', date: t });
  applyAdjustment(db, { childId: kid.id, minutes: -5, kind: 'removal', reason: 'second', date: t });
  assert.deepEqual(listAdjustments(db, kid.id, { days: 1 }).map(a => a.reason), ['second', 'first']);
  assert.equal(listAdjustments(db, kid.id, { days: 30 }).length, 3);
});

test('migrateToV2 settles history, folds future rows, keeps today and assigns chores', () => {
  const db = freshDb();
  const kid = addChild(db);
  const t = today(db);
  db.prepare("UPDATE settings SET value='1' WHERE key='schema_version'").run();
  const legacy = db.prepare('INSERT INTO time_ledger (child_id, date, minutes_used, bonus_minutes) VALUES (?,?,?,?)');
  legacy.run(kid.id, addDays(t, -1), 50, 30);
  legacy.run(kid.id, t, 10, 20);
  legacy.run(kid.id, addDays(t, 1), 5, 15); // created under the old UTC+7 TZ
  db.prepare('DELETE FROM template_assignments').run();

  migrateToV2(db);

  const rows = db.prepare('SELECT * FROM time_ledger WHERE child_id=? ORDER BY date').all(kid.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].settled, 1);
  assert.equal(rows[0].carry_out_minutes, 0);
  assert.equal(rows[1].date, t);
  assert.equal(rows[1].minutes_used, 15);
  assert.equal(rows[1].bonus_minutes, 35);
  assert.equal(rows[1].daily_limit_minutes, 30);
  const adj = db.prepare('SELECT * FROM time_adjustments WHERE child_id=?').all(kid.id);
  assert.deepEqual(adj.map(a => [a.date, a.minutes, a.kind, a.reason]), [[t, 35, 'carryover', 'Earlier today']]);
  const chores = db.prepare('SELECT COUNT(*) c FROM chore_templates WHERE active=1').get().c;
  const assigned = db.prepare("SELECT COUNT(*) c FROM template_assignments WHERE template_type='chore' AND child_id=?").get(kid.id).c;
  assert.equal(assigned, chores);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='schema_version'").get().value, '2');
  migrateToV2(db); // second run is a no-op
  assert.equal(db.prepare('SELECT COUNT(*) c FROM time_adjustments WHERE child_id=?').get(kid.id).c, 1);
});

test('applyAdjustment refuses past days once a later row exists', () => {
  const db = freshDb();
  const kid = addChild(db);
  const t = today(db);
  ensureDay(db, kid, t);
  const before = childSummary(db, kid, t).available;
  assert.throws(() => applyAdjustment(db, { childId: kid.id, minutes: 5, kind: 'grant', reason: 'x', date: addDays(t, -1) }),
    e => e instanceof HttpError && e.status === 400);
  assert.equal(childSummary(db, kid, t).available, before);
});

test('migrateToV2 drops orphan future rows instead of crashing', () => {
  const db = freshDb();
  db.pragma('foreign_keys = ON');
  const kid = addChild(db);
  const t = today(db);
  db.prepare("UPDATE settings SET value='1' WHERE key='schema_version'").run();
  db.pragma('foreign_keys = OFF');
  db.prepare('INSERT INTO time_ledger (child_id, date, minutes_used, bonus_minutes) VALUES (?,?,?,?)')
    .run('ghost', addDays(t, 1), 5, 15);
  db.pragma('foreign_keys = ON');
  assert.doesNotThrow(() => migrateToV2(db));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM time_ledger WHERE child_id='ghost'").get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM time_ledger WHERE child_id=?').get(kid.id).c, 0);
});

test('daily_left + banked equals remaining_minutes despite rounding', () => {
  const db = freshDb();
  const kid = addChild(db);
  applyAdjustment(db, { childId: kid.id, minutes: 10.4, kind: 'grant', reason: 'x', date: D1 });
  addUsage(db, kid, 19.6, D1);
  const s = childSummary(db, kid, D1);
  assert.equal(s.daily_left + s.banked, s.remaining_minutes);
});
