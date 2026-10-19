import Database from 'better-sqlite3';
import path from 'path';
import { today } from './clock.js';

const DB_PATH = process.env.DB_PATH || '/data/jellytime.db';

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDb(db = getDb()) {

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      jellyfin_user_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      avatar_emoji TEXT DEFAULT '🧒',
      daily_limit_minutes INTEGER DEFAULT 60,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS time_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id TEXT NOT NULL,
      date TEXT NOT NULL,
      minutes_used INTEGER DEFAULT 0,
      bonus_minutes INTEGER DEFAULT 0,
      last_updated INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (child_id) REFERENCES children(id),
      UNIQUE(child_id, date)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id TEXT NOT NULL,
      jellyfin_session_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      minutes_counted INTEGER DEFAULT 0,
      FOREIGN KEY (child_id) REFERENCES children(id)
    );

    CREATE TABLE IF NOT EXISTS chore_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      reward_minutes INTEGER NOT NULL,
      icon TEXT DEFAULT '✅',
      auto_approve INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS chore_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id TEXT NOT NULL,
      chore_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      submitted_at INTEGER DEFAULT (unixepoch()),
      reviewed_at INTEGER,
      review_note TEXT,
      reward_minutes INTEGER NOT NULL,
      date TEXT NOT NULL,
      FOREIGN KEY (child_id) REFERENCES children(id),
      FOREIGN KEY (chore_id) REFERENCES chore_templates(id)
    );

    CREATE TABLE IF NOT EXISTS parent_accounts (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS vapid_keys (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL
    );
  `);

  // Add display_name column if it doesn't exist (SQLite migration)
  try { db.exec("ALTER TABLE parent_accounts ADD COLUMN display_name TEXT"); } catch {}

  // Add max_completions column if it doesn't exist (SQLite migration)
  try { db.exec("ALTER TABLE chore_templates ADD COLUMN max_completions INTEGER DEFAULT 1"); } catch {}

  // Seed default chore templates if none exist
  const count = db.prepare('SELECT COUNT(*) as c FROM chore_templates').get();
  if (count.c === 0) {
    const insert = db.prepare(`
      INSERT INTO chore_templates (id, name, description, reward_minutes, icon, auto_approve)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run('chore-1', 'Make Bed', 'Make your bed neat and tidy', 15, '🛏️', 1);
    insert.run('chore-2', 'Clean Room', 'Tidy up your room completely', 30, '🧹', 0);
    insert.run('chore-3', 'Do Dishes', 'Wash or load the dishwasher', 20, '🍽️', 0);
    insert.run('chore-4', 'Take Out Trash', 'Empty trash bins around the house', 15, '🗑️', 1);
    insert.run('chore-5', 'Feed Pets', 'Feed and water the pets', 10, '🐾', 1);
    insert.run('chore-6', 'Homework Done', 'Complete all homework assignments', 30, '📚', 0);
  }

  // Earned-time rollover (schema v2)
  for (const sql of [
    'ALTER TABLE children ADD COLUMN bank_cap_minutes INTEGER',
    "ALTER TABLE children ADD COLUMN debt_mode TEXT DEFAULT 'carry'",
    'ALTER TABLE time_ledger ADD COLUMN carry_in_minutes REAL DEFAULT 0',
    'ALTER TABLE time_ledger ADD COLUMN daily_limit_minutes INTEGER',
    'ALTER TABLE time_ledger ADD COLUMN settled INTEGER DEFAULT 0',
    'ALTER TABLE time_ledger ADD COLUMN carry_out_minutes REAL',
  ]) {
    try { db.exec(sql); } catch {}
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS time_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id TEXT NOT NULL,
      date TEXT NOT NULL,
      minutes REAL NOT NULL,
      kind TEXT NOT NULL,
      reason TEXT,
      icon TEXT,
      template_id TEXT,
      completion_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_time_adjustments_child_date ON time_adjustments(child_id, date);

    CREATE TABLE IF NOT EXISTS removal_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '⚠️',
      minutes INTEGER NOT NULL,
      active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS template_assignments (
      template_type TEXT NOT NULL,
      template_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      minutes_override INTEGER,
      PRIMARY KEY (template_type, template_id, child_id)
    );
  `);

  migrateToV2(db);

  console.log('Database initialized at', DB_PATH);
}

// One-time upgrade of pre-rollover data. Before v2 nothing carried over, so every
// earlier day settles to zero; today's bonus becomes a visible adjustment.
export function migrateToV2(db) {
  const version = Number(db.prepare("SELECT value FROM settings WHERE key='schema_version'").get()?.value || 1);
  if (version >= 2) return;
  const date = today(db);
  db.transaction(() => {
    db.exec(`UPDATE time_ledger SET daily_limit_minutes =
      (SELECT c.daily_limit_minutes FROM children c WHERE c.id = time_ledger.child_id)
      WHERE daily_limit_minutes IS NULL`);

    // TZ used to be misconfigured (UTC+7), so a row dated after today can exist: fold it in.
    for (const row of db.prepare('SELECT * FROM time_ledger WHERE date > ?').all(date)) {
      db.prepare(`
        INSERT INTO time_ledger (child_id, date, minutes_used, bonus_minutes, daily_limit_minutes) VALUES (?,?,?,?,?)
        ON CONFLICT(child_id, date) DO UPDATE SET
          minutes_used = minutes_used + excluded.minutes_used,
          bonus_minutes = bonus_minutes + excluded.bonus_minutes
      `).run(row.child_id, date, row.minutes_used, row.bonus_minutes, row.daily_limit_minutes);
      db.prepare('DELETE FROM time_ledger WHERE id=?').run(row.id);
    }

    db.prepare('UPDATE time_ledger SET settled=1, carry_out_minutes=0 WHERE date < ?').run(date);

    for (const row of db.prepare('SELECT * FROM time_ledger WHERE date=? AND bonus_minutes != 0').all(date)) {
      db.prepare(`INSERT INTO time_adjustments (child_id, date, minutes, kind, reason, icon)
        VALUES (?,?,?,'grant','Earlier today','🎁')`).run(row.child_id, date, row.bonus_minutes);
    }

    db.exec(`INSERT OR IGNORE INTO template_assignments (template_type, template_id, child_id)
      SELECT 'chore', ct.id, c.id FROM chore_templates ct CROSS JOIN children c WHERE ct.active=1`);

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version','2')").run();
  })();
}
