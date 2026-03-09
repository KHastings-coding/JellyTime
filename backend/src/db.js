import Database from 'better-sqlite3';
import path from 'path';

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

export function initDb() {
  const db = getDb();

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

  console.log('Database initialized at', DB_PATH);
}
