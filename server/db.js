const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const config = require('./config');

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS connections (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    host              TEXT NOT NULL,
    port              INTEGER NOT NULL DEFAULT 22,
    username          TEXT NOT NULL,
    auth_method       TEXT NOT NULL DEFAULT 'password',
    password          TEXT,
    private_key       TEXT,
    passphrase        TEXT,
    tunnel_enabled    INTEGER NOT NULL DEFAULT 0,
    tunnel_local_port INTEGER,
    tunnel_remote_host TEXT,
    tunnel_remote_port INTEGER,
    tunnel_bind_address TEXT DEFAULT '0.0.0.0',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quick_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quick_commands (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES quick_categories(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    command     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user', 'viewer')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: if users table is empty, seed from old settings password or create default admin
const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
if (userCount === 0) {
  const oldPw = db.prepare('SELECT value FROM settings WHERE key = ?').get('password');
  const hash = oldPw ? oldPw.value : bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
}

// ---- Migration System ----
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function hasMigration(id) {
  return !!db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(id);
}

function markMigration(id, name) {
  db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(id, name);
}

// Migration 1: Add user_id to connections
if (!hasMigration(1)) {
  db.transaction(() => {
    const cols = db.prepare("PRAGMA table_info(connections)").all().map(c => c.name);
    if (!cols.includes('user_id')) {
      db.exec("ALTER TABLE connections ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
    }
    // Assign existing connections to first admin
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    if (admin) {
      db.prepare("UPDATE connections SET user_id = ? WHERE user_id IS NULL").run(admin.id);
    }
    markMigration(1, 'add_user_id_to_connections');
  })();
}

// Migration 2: Remove viewer role, rebuild users table
if (!hasMigration(2)) {
  db.transaction(() => {
    // Upgrade existing viewers to users
    db.exec("UPDATE users SET role = 'user' WHERE role = 'viewer'");
    // Rebuild users table with updated CHECK constraint
    db.exec(`
      CREATE TABLE users_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, username, password_hash, role, created_at)
        SELECT id, username, password_hash, role, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    markMigration(2, 'remove_viewer_role');
  })();
}

// Migration 3: Create share_tokens table
if (!hasMigration(3)) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      token       TEXT NOT NULL UNIQUE,
      session_id  TEXT NOT NULL,
      owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer', 'coworker')),
      label       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT
    );
  `);
  markMigration(3, 'create_share_tokens');
}

// Migration 4: Create groups table
if (!hasMigration(4)) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  markMigration(4, 'create_groups');
}

// Migration 5: Create user_groups table
if (!hasMigration(5)) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_groups (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, group_id)
    );
  `);
  markMigration(5, 'create_user_groups');
}

// Migration 6: Create group_connections table
if (!hasMigration(6)) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_connections (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id          INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      host              TEXT NOT NULL,
      port              INTEGER NOT NULL DEFAULT 22,
      username          TEXT DEFAULT '',
      auth_method       TEXT NOT NULL DEFAULT 'password',
      password          TEXT,
      private_key       TEXT,
      passphrase        TEXT,
      tunnel_enabled    INTEGER NOT NULL DEFAULT 0,
      tunnel_local_port INTEGER,
      tunnel_remote_host TEXT,
      tunnel_remote_port INTEGER,
      tunnel_bind_address TEXT DEFAULT '0.0.0.0',
      sort_order        INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  markMigration(6, 'create_group_connections');
}

// Migration 7: Add auth_source to users for SSO
if (!hasMigration(7)) {
  db.transaction(() => {
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!cols.includes('auth_source')) {
      db.exec("ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local'");
    }
    markMigration(7, 'add_auth_source_to_users');
  })();
}

// Migration 8: Make group_connections.username nullable for user-fillable connections
if (!hasMigration(8)) {
  db.transaction(() => {
    // Recreate group_connections with nullable username
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='group_connections'").get();
    if (exists) {
      db.exec(`
        CREATE TABLE group_connections_new (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id          INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          name              TEXT NOT NULL,
          host              TEXT NOT NULL,
          port              INTEGER NOT NULL DEFAULT 22,
          username          TEXT DEFAULT '',
          auth_method       TEXT NOT NULL DEFAULT 'password',
          password          TEXT,
          private_key       TEXT,
          passphrase        TEXT,
          tunnel_enabled    INTEGER NOT NULL DEFAULT 0,
          tunnel_local_port INTEGER,
          tunnel_remote_host TEXT,
          tunnel_remote_port INTEGER,
          tunnel_bind_address TEXT DEFAULT '0.0.0.0',
          sort_order        INTEGER NOT NULL DEFAULT 0,
          created_at        TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO group_connections_new SELECT * FROM group_connections;
        DROP TABLE group_connections;
        ALTER TABLE group_connections_new RENAME TO group_connections;
      `);
    }
    markMigration(8, 'group_connections_nullable_username');
  })();
}

// Migration 9: Create user_group_credentials table for per-user credentials on group connections
if (!hasMigration(9)) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_group_credentials (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_connection_id   INTEGER NOT NULL REFERENCES group_connections(id) ON DELETE CASCADE,
      username              TEXT DEFAULT '',
      auth_method           TEXT NOT NULL DEFAULT 'password',
      password              TEXT,
      private_key           TEXT,
      passphrase            TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, group_connection_id)
    );
  `);
  markMigration(9, 'create_user_group_credentials');
}

// Encrypt any plaintext SSH credentials in connections table
const { migrateConnections } = require('./services/encryption');
migrateConnections(db);

module.exports = db;
