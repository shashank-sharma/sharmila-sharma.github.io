-- Snapshots are deliberately stored independently. Never derive public data from draft_json.
CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  draft_json TEXT,
  published_json TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (draft_json IS NOT NULL OR published_json IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS artwork_revisions (
  id TEXT PRIMARY KEY,
  artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create', 'save', 'publish', 'restore')),
  artwork_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS artwork_revisions_artwork ON artwork_revisions(artwork_id, version DESC);

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order REAL NOT NULL DEFAULT 0,
  cover_artwork_id TEXT REFERENCES artworks(id) ON DELETE SET NULL
);

-- Only public web derivatives belong here or in R2; private originals must never be uploaded.
CREATE TABLE IF NOT EXISTS images (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
