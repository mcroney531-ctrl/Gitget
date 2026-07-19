CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL DEFAULT '',
  live_url TEXT,
  has_pages INTEGER NOT NULL DEFAULT 1,
  build_status TEXT,
  last_deploy TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'push', 'synced')),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_repos_name ON repos(name);
