import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { authenticate, login, logout, requireStudio, sameOrigin } from "./auth";

export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  IMAGE_BASE_URL: string;
  STUDIO_PASSWORD?: string;
  SESSION_SECRET?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_EMAILS?: string;
  GITHUB_PAGES_TOKEN?: string;
};

const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const idSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/);
const keySchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (key) =>
      key
        .split("/")
        .every((part) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part)),
    "Invalid image key",
  );
const imageSchema = z.object({
  key: keySchema,
  url: z.string().max(2048).optional().default(""),
  alt: z.string().max(1000).default(""),
  width: z.number().int().positive().max(65535),
  height: z.number().int().positive().max(65535),
});
const artworkSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  title: z.string().trim().max(300),
  description: z.string().max(20000),
  price: z.number().finite().nonnegative().nullable(),
  currency: z.literal("INR"),
  priceMode: z.enum(["listed", "request"]),
  medium: z.string().max(500),
  width: z.number().finite().positive().nullable(),
  height: z.number().finite().positive().nullable(),
  unit: z.enum(["cm", "in"]),
  year: z.number().int().min(1).max(9999).nullable(),
  availability: z.enum(["available", "reserved", "sold"]),
  seriesId: idSchema.nullable(),
  sortOrder: z.number().finite(),
  featured: z.boolean(),
  images: z.array(imageSchema).max(30),
  version: z.number().int().positive(),
});
const publishSchema = artworkSchema
  .refine((artwork) => artwork.title.length > 0, {
    message: "A title is required to publish",
    path: ["title"],
  })
  .refine((artwork) => artwork.images.length > 0, {
    message: "An image is required to publish",
    path: ["images"],
  })
  .refine(
    (artwork) => artwork.priceMode !== "listed" || artwork.price !== null,
    {
      message: "Listed artworks require a nonnegative numeric price",
      path: ["price"],
    },
  );
const seriesSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string().trim().min(1).max(300),
  description: z.string().max(20000),
  sortOrder: z.number().finite(),
  coverArtworkId: idSchema.nullable(),
});
export type Artwork = z.infer<typeof artworkSchema>;
export type Series = z.infer<typeof seriesSchema>;
type ArtworkRow = {
  id: string;
  slug: string;
  draft_json: string | null;
  published_json: string | null;
  version: number;
};
type Environment = { Bindings: Bindings; Variables: { email: string } };
const rowColumns = "id, slug, draft_json, published_json, version";

async function rebuildSite(env: Bindings): Promise<{
  status: "queued" | "not-configured" | "failed";
  httpStatus?: number;
  reason?: "timeout" | "request-error";
}> {
  if (!env.GITHUB_PAGES_TOKEN) return { status: "not-configured" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      fetch(
        "https://api.github.com/repos/shashank-sharma/sharmila-sharma.github.io/actions/workflows/pages.yml/dispatches",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.GITHUB_PAGES_TOKEN.trim()}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Sharmila-Studio",
          },
          body: JSON.stringify({ ref: "master" }),
          signal: controller.signal,
          // Workers supports manual/follow only; never forward the token on redirects.
          redirect: "manual",
        },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Site update timed out"));
        }, 5000);
      }),
    ]);
    // GitHub acknowledges workflow_dispatch with 204, not a completed deployment.
    return response.status === 204
      ? { status: "queued" }
      : { status: "failed", httpStatus: response.status };
  } catch {
    // Return only safe categories, never raw GitHub bodies, exceptions or secrets.
    return {
      status: "failed",
      reason: controller.signal.aborted ? "timeout" : "request-error",
    };
  } finally {
    clearTimeout(timer);
  }
}
// Exact JSON key matches in both current snapshots.
const referencedImages = `SELECT json_extract(image.value, '$.key') AS key FROM (
  SELECT draft_json AS artwork_json FROM artworks WHERE draft_json IS NOT NULL
  UNION ALL SELECT published_json FROM artworks WHERE published_json IS NOT NULL
) AS snapshot, json_each(snapshot.artwork_json, '$.images') AS image`;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first.path
      .filter((part) => part !== "artwork" && part !== "series")
      .join(".");
    throw new HTTPException(400, {
      res: Response.json(
        {
          error: `${field ? `${field}: ` : ""}${first.message}`,
          issues: result.error.issues,
        },
        { status: 400 },
      ),
    });
  }
  return result.data;
}

function imageURL(env: Bindings, key: string) {
  return `${env.IMAGE_BASE_URL.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function publicArtwork(env: Bindings, json: string): Artwork {
  const artwork: Artwork = JSON.parse(json);
  return {
    ...artwork,
    images: artwork.images.map((image) => ({
      ...image,
      url: imageURL(env, image.key),
    })),
  };
}

function workingArtwork(env: Bindings, row: ArtworkRow): Artwork {
  return {
    ...publicArtwork(env, (row.draft_json ?? row.published_json)!),
    version: row.version,
  };
}

function makeSlug(value: unknown, id: string) {
  const prefix = (typeof value === "string" ? value : "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 110)
    .replace(/-$/, "");
  const suffix = id
    .toLowerCase()
    .replace(/_/g, "-")
    .slice(-36)
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return `${prefix || "artwork"}-${suffix || "item"}`;
}

async function getRow(db: D1Database, id: string): Promise<ArtworkRow> {
  const row = await db
    .prepare(`SELECT ${rowColumns} FROM artworks WHERE id = ?`)
    .bind(id)
    .first<ArtworkRow>();
  if (!row) throw new HTTPException(404, { message: "Artwork not found" });
  return row;
}

async function checkExpectedVersion(c: Context<Environment>, row: ArtworkRow) {
  const text = await c.req.text();
  const { version } = parse(
    z.object({ version: z.number().int().positive().optional() }),
    text.trim() ? JSON.parse(text) : {},
  );
  if (version !== undefined && version !== row.version) {
    throw new HTTPException(409, {
      message: "Artwork changed; reload before continuing",
    });
  }
}

function studioArtwork(env: Bindings, row: ArtworkRow) {
  return {
    artwork: workingArtwork(env, row),
    published: row.published_json !== null,
    hasDraft: row.draft_json !== null,
  };
}

async function getSeries(db: D1Database): Promise<Series[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, name, description, sort_order AS sortOrder,
    cover_artwork_id AS coverArtworkId FROM series ORDER BY sort_order, name, id`,
    )
    .all<Series>();
  return results;
}

async function validateReferences(db: D1Database, artwork: Artwork) {
  if (artwork.images.some((image) => image.key.startsWith("sharmila/site/"))) {
    throw new HTTPException(400, {
      message:
        "Website photos are separate from painting images. Upload this photo as an artwork image.",
    });
  }
  if (
    artwork.seriesId &&
    !(await db
      .prepare("SELECT id FROM series WHERE id = ?")
      .bind(artwork.seriesId)
      .first())
  ) {
    throw new HTTPException(400, { message: "Series not found" });
  }
}

// The conditional UPDATE atomically protects the working version.
async function saveArtwork(
  env: Bindings,
  row: ArtworkRow,
  artwork: Artwork,
  action: "save" | "publish",
) {
  const json = JSON.stringify(artwork);
  const column = action === "publish" ? "published_json" : "draft_json";
  const result = await env.DB.prepare(
    `UPDATE artworks SET ${column} = ?, ${action === "publish" ? "draft_json = NULL," : ""}
      version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND version = ?`,
  )
    .bind(json, artwork.version, row.id, row.version)
    .run();
  if (result.meta.changes !== 1)
    throw new HTTPException(409, {
      message: "Artwork changed; reload before saving",
    });
}

const api = new Hono<Environment>();
api.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "no-store");
  await next();
});
api.use("*", sameOrigin);
api.use("/studio/*", requireStudio);
api.use("/studio", requireStudio);

api.onError((error, c) => {
  if (error instanceof HTTPException) {
    if (error.res) return error.getResponse();
    return c.json({ error: error.message }, error.status);
  }
  if (error instanceof SyntaxError)
    return c.json({ error: "Invalid JSON" }, 400);
  if (/Image was permanently deleted/i.test(String(error))) {
    return c.json(
      {
        error:
          "This image was permanently deleted. Upload a replacement before saving.",
      },
      409,
    );
  }
  if (/UNIQUE constraint failed/i.test(String(error)))
    return c.json({ error: "ID or slug already exists" }, 409);
  // Never expose SQL, credentials, or request contents through an error response.
  console.error(
    "Catalogue API error",
    error instanceof Error ? error.name : "Unknown error",
  );
  return c.json({ error: "Internal server error" }, 500);
});
api.notFound((c) => c.json({ error: "Not found" }, 404));

api.post("/session", login);
api.get("/session", async (c) => {
  const email = await authenticate(c);
  return c.json(
    email ? { authenticated: true, email } : { authenticated: false },
  );
});
api.delete("/session", logout);

api.post("/studio/rebuild", async (c) => {
  return c.json({ siteUpdate: await rebuildSite(c.env) });
});

api.get("/catalogue", async (c) => {
  const [{ results }, series] = await Promise.all([
    c.env.DB.prepare(
      "SELECT published_json FROM artworks WHERE published_json IS NOT NULL",
    ).all<{ published_json: string }>(),
    getSeries(c.env.DB),
  ]);
  const artworks = results
    .map((row) => publicArtwork(c.env, row.published_json))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const publishedIds = new Set(artworks.map((artwork) => artwork.id));
  return c.json({
    artworks,
    series: series.map((item) => ({
      ...item,
      coverArtworkId:
        item.coverArtworkId && publishedIds.has(item.coverArtworkId)
          ? item.coverArtworkId
          : null,
    })),
  });
});

api.get("/studio/artworks", async (c) => {
  const [{ results }, series] = await Promise.all([
    c.env.DB.prepare(`SELECT ${rowColumns} FROM artworks`).all<ArtworkRow>(),
    getSeries(c.env.DB),
  ]);
  const artworks = results
    .map((row) => ({
      ...workingArtwork(c.env, row),
      published: row.published_json !== null,
      hasDraft: row.draft_json !== null,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return c.json({ artworks, series });
});

api.post("/studio/artworks", async (c) => {
  const body = await c.req.json();
  const input = parse(
    z.record(z.string(), z.unknown()),
    body?.artwork ?? body ?? {},
  );
  const id = parse(
    idSchema,
    input.id === "" ? crypto.randomUUID() : (input.id ?? crypto.randomUUID()),
  );
  const artwork = parse(artworkSchema, {
    title: "",
    description: "",
    price: null,
    currency: "INR",
    priceMode: "request",
    medium: "",
    width: null,
    height: null,
    unit: "cm",
    year: null,
    availability: "available",
    seriesId: null,
    sortOrder: 0,
    featured: false,
    images: [],
    ...input,
    id,
    slug: input.slug || makeSlug(input.title || "", id),
    version: 1,
  });
  await validateReferences(c.env.DB, artwork);
  const json = JSON.stringify(artwork);
  await c.env.DB.prepare(
    "INSERT INTO artworks (id, slug, draft_json, version) VALUES (?, ?, ?, 1)",
  )
    .bind(id, artwork.slug, json)
    .run();
  return c.json(
    {
      artwork: publicArtwork(c.env, json),
      published: false,
      hasDraft: true,
    },
    201,
  );
});

api.get("/studio/artworks/:id", async (c) => {
  const row = await getRow(c.env.DB, c.req.param("id"));
  return c.json(studioArtwork(c.env, row));
});

api.put("/studio/artworks/:id", async (c) => {
  const row = await getRow(c.env.DB, c.req.param("id"));
  const { artwork: input } = parse(
    z.object({ artwork: artworkSchema }),
    await c.req.json(),
  );
  if (input.id !== row.id || input.slug !== row.slug) {
    return c.json({ error: "Artwork ID and slug are immutable" }, 400);
  }
  if (input.version !== row.version)
    return c.json({ error: "Artwork changed; reload before saving" }, 409);
  const artwork = { ...input, version: row.version + 1 };
  await validateReferences(c.env.DB, artwork);
  await saveArtwork(c.env, row, artwork, "save");
  return c.json({
    artwork: publicArtwork(c.env, JSON.stringify(artwork)),
    published: row.published_json !== null,
    hasDraft: true,
  });
});

api.post("/studio/artworks/:id/publish", async (c) => {
  const row = await getRow(c.env.DB, c.req.param("id"));
  await checkExpectedVersion(c, row);
  if (!row.draft_json) return c.json({ error: "No draft to publish" }, 409);
  const artwork = parse(publishSchema, {
    ...workingArtwork(c.env, row),
    version: row.version + 1,
  });
  await validateReferences(c.env.DB, artwork);
  await saveArtwork(c.env, row, artwork, "publish");
  return c.json({
    artwork,
    published: true,
    hasDraft: false,
    siteUpdate: await rebuildSite(c.env),
  });
});

api.post("/studio/artworks/:id/unpublish", async (c) => {
  const row = await getRow(c.env.DB, c.req.param("id"));
  await checkExpectedVersion(c, row);
  if (!row.published_json)
    return c.json({
      ...studioArtwork(c.env, row),
      siteUpdate: { status: "not-needed" },
    });
  const result = await c.env.DB.prepare(
    `UPDATE artworks SET draft_json = COALESCE(draft_json, published_json), published_json = NULL,
    version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND version = ? AND published_json IS NOT NULL`,
  )
    .bind(row.id, row.version)
    .run();
  if (result.meta.changes !== 1)
    return c.json({ error: "Artwork changed; reload before continuing" }, 409);
  return c.json({
    ...studioArtwork(c.env, {
      ...row,
      draft_json: row.draft_json ?? row.published_json,
      published_json: null,
      version: row.version + 1,
    }),
    siteUpdate: await rebuildSite(c.env),
  });
});

api.delete("/studio/artworks/:id", async (c) => {
  const row = await getRow(c.env.DB, c.req.param("id"));
  await checkExpectedVersion(c, row);
  // RETURNING counts only the artwork, not series-cover foreign-key updates.
  const result = await c.env.DB.prepare(
    "DELETE FROM artworks WHERE id = ? AND version = ? RETURNING id",
  )
    .bind(row.id, row.version)
    .first<{ id: string }>();
  if (!result)
    return c.json({ error: "Artwork changed; reload before continuing" }, 409);
  // Only artwork references are removed. Unused photos remain manually deletable.
  return c.json({
    deleted: true,
    id: row.id,
    ...(row.published_json !== null
      ? { siteUpdate: await rebuildSite(c.env) }
      : {}),
  });
});

api.get("/studio/export", async (c) => {
  const [rows, series, images] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ${rowColumns} FROM artworks ORDER BY id`,
    ).all<ArtworkRow>(),
    getSeries(c.env.DB),
    c.env.DB.prepare(
      "SELECT key, content_type AS contentType, width, height, byte_size AS byteSize FROM images ORDER BY key",
    ).all(),
  ]);
  c.header(
    "Content-Disposition",
    'attachment; filename="catalogue-inventory.json"',
  );
  return c.json({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    series,
    artworks: rows.results.map((row) => ({
      id: row.id,
      slug: row.slug,
      version: row.version,
      draft: row.draft_json ? publicArtwork(c.env, row.draft_json) : null,
      published: row.published_json
        ? publicArtwork(c.env, row.published_json)
        : null,
    })),
    images: images.results,
  });
});

async function checkCover(db: D1Database, series: Series) {
  if (
    series.coverArtworkId &&
    !(await db
      .prepare("SELECT id FROM artworks WHERE id = ?")
      .bind(series.coverArtworkId)
      .first())
  ) {
    throw new HTTPException(400, { message: "Cover artwork not found" });
  }
}

api.post("/studio/series", async (c) => {
  const body = await c.req.json();
  const input = parse(
    z.record(z.string(), z.unknown()),
    body?.series ?? body ?? {},
  );
  const id = parse(idSchema, input.id ?? crypto.randomUUID());
  const series = parse(seriesSchema, {
    description: "",
    sortOrder: 0,
    coverArtworkId: null,
    ...input,
    id,
    slug: input.slug || makeSlug(input.name || "", id),
  });
  await checkCover(c.env.DB, series);
  await c.env.DB.prepare(
    `INSERT INTO series (id, slug, name, description, sort_order, cover_artwork_id)
    VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      series.id,
      series.slug,
      series.name,
      series.description,
      series.sortOrder,
      series.coverArtworkId,
    )
    .run();
  return c.json({ series, siteUpdate: await rebuildSite(c.env) }, 201);
});

api.put("/studio/series/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM series WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) return c.json({ error: "Series not found" }, 404);
  const body = await c.req.json();
  const series = parse(seriesSchema, { ...(body?.series ?? body), id });
  await checkCover(c.env.DB, series);
  await c.env.DB.prepare(
    `UPDATE series SET slug = ?, name = ?, description = ?, sort_order = ?, cover_artwork_id = ? WHERE id = ?`,
  )
    .bind(
      series.slug,
      series.name,
      series.description,
      series.sortOrder,
      series.coverArtworkId,
      id,
    )
    .run();
  return c.json({ series, siteUpdate: await rebuildSite(c.env) });
});

api.get("/studio/images", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT key, width, height,
    EXISTS (SELECT 1 FROM (${referencedImages}) AS reference WHERE reference.key = images.key) AS used
    FROM images ORDER BY created_at DESC, key`,
  ).all<{ key: string; width: number; height: number; used: number }>();
  return c.json({
    images: results.map((image) => ({
      ...image,
      url: imageURL(c.env, image.key),
      alt: "",
      used: Boolean(image.used),
    })),
  });
});

api.delete("/studio/images", async (c) => {
  const { key } = parse(z.object({ key: keySchema }), await c.req.json());
  if (
    !key.startsWith("sharmila/artworks/uploads/") &&
    !key.startsWith("sharmila/site/")
  ) {
    return c.json(
      {
        error:
          "Only managed artwork uploads and website photos can be permanently deleted",
      },
      400,
    );
  }
  if (
    !(await c.env.DB.prepare("SELECT key FROM images WHERE key = ?")
      .bind(key)
      .first())
  ) {
    return c.json({ error: "Image not found in the image library" }, 404);
  }
  // Reserve deletion atomically against both current snapshots. Triggers then
  // prevent a concurrent save from attaching the key while R2 deletion is in flight.
  await c.env.DB.prepare(
    `INSERT INTO deleted_images (key)
    SELECT ? WHERE NOT EXISTS (SELECT 1 FROM (${referencedImages}) WHERE key = ?)
    ON CONFLICT(key) DO NOTHING`,
  )
    .bind(key, key)
    .run();
  if (
    !(await c.env.DB.prepare("SELECT key FROM deleted_images WHERE key = ?")
      .bind(key)
      .first())
  ) {
    return c.json(
      {
        error:
          "This photo is used by a painting's current draft or published version. Remove it from both snapshots before permanently deleting it.",
      },
      409,
    );
  }
  // Keep the tombstone and registry on failure so retrying can safely finish deletion.
  await c.env.IMAGES.delete(key);
  await c.env.DB.prepare("DELETE FROM images WHERE key = ?").bind(key).run();
  return c.json({ deleted: true, key });
});

type ImageInfo = {
  width: number;
  height: number;
  contentType: string;
  extension: string;
};

// Inspect bytes, not the untrusted filename or browser-supplied Content-Type.
function inspectImage(bytes: Uint8Array): ImageInfo | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (
    bytes.length >= 33 &&
    bytes[0] === 137 &&
    text(1, 7) === "PNG\r\n\u001a\n" &&
    data.getUint32(8) === 13 &&
    text(12, 4) === "IHDR"
  ) {
    return {
      width: data.getUint32(16),
      height: data.getUint32(20),
      contentType: "image/png",
      extension: "png",
    };
  }
  if (
    bytes.length >= 30 &&
    text(0, 4) === "RIFF" &&
    text(8, 4) === "WEBP" &&
    data.getUint32(4, true) + 8 === bytes.length
  ) {
    if (text(12, 4) === "VP8X") {
      const uint24 = (offset: number) =>
        bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
      return {
        width: uint24(24) + 1,
        height: uint24(27) + 1,
        contentType: "image/webp",
        extension: "webp",
      };
    }
    if (
      text(12, 4) === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return {
        width: data.getUint16(26, true) & 0x3fff,
        height: data.getUint16(28, true) & 0x3fff,
        contentType: "image/webp",
        extension: "webp",
      };
    }
    if (text(12, 4) === "VP8L" && bytes[20] === 0x2f) {
      const bits = data.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        contentType: "image/webp",
        extension: "webp",
      };
    }
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  ) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      ) {
        return {
          width: data.getUint16(offset + 5),
          height: data.getUint16(offset + 3),
          contentType: "image/jpeg",
          extension: "jpg",
        };
      }
      offset += length;
    }
  }
  return null;
}

api.post("/studio/images", async (c) => {
  const maxBytes = 8 * 1024 * 1024;
  const length = Number(c.req.header("Content-Length") || 0);
  if (length > maxBytes + 65536)
    return c.json({ error: "Image exceeds 8MB" }, 413);
  // Bound multipart parsing as well as the file itself, including chunked requests.
  const reader = c.req.raw.body?.getReader();
  if (!reader) return c.json({ error: "Multipart file is required" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes + 65536) {
      await reader.cancel();
      return c.json({ error: "Image exceeds 8MB" }, 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { "Content-Type": c.req.header("Content-Type") || "" },
    }).formData();
  } catch {
    return c.json({ error: "Invalid multipart form" }, 400);
  }
  const kind = parse(
    z.enum(["artwork", "site"]),
    form.get("kind") ?? "artwork",
  );
  const file = form.get("file");
  if (!file || typeof file === "string")
    return c.json({ error: "Multipart file is required" }, 400);
  if (file.size > maxBytes) return c.json({ error: "Image exceeds 8MB" }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = inspectImage(bytes);
  if (
    !info ||
    !info.width ||
    !info.height ||
    info.width > 65535 ||
    info.height > 65535
  ) {
    return c.json(
      {
        error:
          "Use a WebP, JPEG or PNG web image with dimensions under 65536 pixels",
      },
      400,
    );
  }
  const key = `sharmila/${kind === "site" ? "site" : "artworks/uploads"}/${crypto.randomUUID()}.${info.extension}`;
  // These are public web derivatives, not private originals. Public R2 URLs cannot be revoked by studio auth.
  // A /media route can restrict unreferenced keys by checking published_json, but R2 public URLs bypass that gate.
  await c.env.IMAGES.put(key, bytes, {
    httpMetadata: {
      contentType: info.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  try {
    await c.env.DB.prepare(
      "INSERT INTO images (key, content_type, width, height, byte_size) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(key, info.contentType, info.width, info.height, bytes.length)
      .run();
  } catch (error) {
    await c.env.IMAGES.delete(key);
    throw error;
  }
  return c.json(
    {
      key,
      url: imageURL(c.env, key),
      alt: "",
      width: info.width,
      height: info.height,
    },
    201,
  );
});

export default api;
