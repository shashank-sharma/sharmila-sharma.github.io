-- Permanently discard saved history, including its index and revision-only trigger.
-- Current artworks, draft/published snapshots, images and tombstones are untouched.
DROP TABLE artwork_revisions;

-- Artwork deletion is now permanent; there is no recoverable Trash state.
ALTER TABLE artworks DROP COLUMN deleted_at;
