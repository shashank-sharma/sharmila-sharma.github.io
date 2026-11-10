ALTER TABLE artworks ADD COLUMN deleted_at TEXT;

-- Keep a tiny tombstone after permanent deletion: a stale or concurrent save must
-- not reattach an image whose R2 object is being removed. Inventory rows are still deleted.
CREATE TABLE deleted_images (
  key TEXT PRIMARY KEY
);

CREATE TRIGGER artworks_no_deleted_images_insert
BEFORE INSERT ON artworks
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.draft_json, '$.images') AS image
  JOIN deleted_images ON deleted_images.key = json_extract(image.value, '$.key')
) OR EXISTS (
  SELECT 1 FROM json_each(NEW.published_json, '$.images') AS image
  JOIN deleted_images ON deleted_images.key = json_extract(image.value, '$.key')
)
BEGIN
  SELECT RAISE(ABORT, 'Image was permanently deleted; upload a replacement');
END;

CREATE TRIGGER artworks_no_deleted_images_update
BEFORE UPDATE OF draft_json, published_json ON artworks
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.draft_json, '$.images') AS image
  JOIN deleted_images ON deleted_images.key = json_extract(image.value, '$.key')
) OR EXISTS (
  SELECT 1 FROM json_each(NEW.published_json, '$.images') AS image
  JOIN deleted_images ON deleted_images.key = json_extract(image.value, '$.key')
)
BEGIN
  SELECT RAISE(ABORT, 'Image was permanently deleted; upload a replacement');
END;

CREATE TRIGGER revisions_no_deleted_images
BEFORE INSERT ON artwork_revisions
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.artwork_json, '$.images') AS image
  JOIN deleted_images ON deleted_images.key = json_extract(image.value, '$.key')
)
BEGIN
  SELECT RAISE(ABORT, 'Image was permanently deleted; upload a replacement');
END;
