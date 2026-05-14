create table if not exists items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  price INTEGER,
  url TEXT NOT NULL,
  location TEXT,
  seller_name TEXT,
  description TEXT,
  category TEXT,
  query TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_notified_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_items_query ON items(query);
CREATE INDEX IF NOT EXISTS idx_items_last_seen_at ON items(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_items_is_active ON items(is_active);