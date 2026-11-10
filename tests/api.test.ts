/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import api, { type Artwork, type Bindings, type Series } from "../src/api";
import website from "../src/site";
import studio from "../src/index";

const bindings = env as unknown as Bindings & {
  TEST_MIGRATIONS: D1Migration[];
};
const app = new Hono<{ Bindings: Bindings }>().route("/api", api);
let local: Bindings;
let cookie: string;

function request(
  path: string,
  options: RequestInit = {},
  configuration = local,
) {
  return app.request(
    `https://catalogue.test/api${path}`,
    options,
    configuration,
  );
}

function json(
  method: string,
  body?: unknown,
  authenticated = true,
): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://catalogue.test",
      ...(authenticated ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined && !["GET", "HEAD"].includes(method)
      ? { body: JSON.stringify(body) }
      : {}),
  };
}

async function create(input: Partial<Artwork> = {}) {
  const response = await request("/studio/artworks", json("POST", input));
  expect(response.status).toBe(201);
  return ((await response.json()) as { artwork: Artwork }).artwork;
}

async function save(artwork: Artwork) {
  const response = await request(
    `/studio/artworks/${artwork.id}`,
    json("PUT", { artwork }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { artwork: Artwork }).artwork;
}

async function catalogue() {
  const response = await request("/catalogue");
  expect(response.status).toBe(200);
  return response.json() as Promise<{ artworks: Artwork[]; series: Series[] }>;
}

const image = {
  key: "legacy/painting.webp",
  url: "/media/legacy/painting.webp",
  alt: "A painting",
  width: 1200,
  height: 900,
};

beforeEach(async () => {
  await reset();
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  local = {
    ...bindings,
    STUDIO_PASSWORD: crypto.randomUUID(),
    SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    GITHUB_PAGES_TOKEN: undefined,
  };
  const response = await request(
    "/session",
    json("POST", { password: local.STUDIO_PASSWORD }, false),
  );
  expect(response.status).toBe(200);
  cookie = response.headers.get("Set-Cookie")!.split(";")[0];
});

afterEach(() => vi.restoreAllMocks());

describe("inventory simplification upgrade on real D1", () => {
  it("drops history and Trash metadata without changing current snapshots, image inventory or R2", async () => {
    await reset();
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS.slice(0, 2));
    const artwork = await create({
      title: "Keep current work",
      images: [image],
    });
    await request(`/studio/artworks/${artwork.id}/publish`, json("POST"));
    const published = (await catalogue()).artworks[0];
    await save({ ...published, title: "Keep working draft" });
    await bindings.DB.prepare(
      "UPDATE artworks SET deleted_at = '2026-11-01' WHERE id = ?",
    )
      .bind(artwork.id)
      .run();
    await request(
      "/studio/series",
      json("POST", { name: "Keep series", coverArtworkId: artwork.id }),
    );
    await bindings.DB.batch([
      bindings.DB.prepare(
        `INSERT INTO artwork_revisions (id, artwork_id, action, artwork_json, version)
        VALUES ('old-revision', ?, 'create', ?, 1)`,
      ).bind(artwork.id, JSON.stringify(artwork)),
      bindings.DB.prepare(
        "INSERT INTO images (key, content_type, width, height, byte_size) VALUES (?, 'image/webp', 1200, 900, 3)",
      ).bind(image.key),
      bindings.DB.prepare(
        "INSERT INTO deleted_images (key) VALUES ('already-deleted.webp')",
      ),
    ]);
    await bindings.IMAGES.put(image.key, new Uint8Array([1, 2, 3]));
    const inventory = async () =>
      Promise.all(
        ["artworks", "series", "images", "deleted_images"].map(
          async (table) => {
            const { results } = await bindings.DB.prepare(
              `SELECT * FROM ${table}`,
            ).all();
            return results.map(({ deleted_at, ...row }) => row);
          },
        ),
      );
    const before = await inventory();
    expect(
      await bindings.DB.prepare("SELECT id FROM artwork_revisions").first(),
    ).toEqual({ id: "old-revision" });
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
    expect(await inventory()).toEqual(before);
    expect(
      (
        await bindings.DB.prepare("PRAGMA table_info(artworks)").all()
      ).results.map((column) => column.name),
    ).not.toContain("deleted_at");
    expect(
      new Uint8Array(
        await (await bindings.IMAGES.get(image.key))!.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect(
      (
        await bindings.DB.prepare(
          `SELECT name FROM sqlite_master WHERE name IN
          ('artwork_revisions', 'artwork_revisions_artwork', 'revisions_no_deleted_images')`,
        ).all()
      ).results,
    ).toEqual([]);
    expect(
      (
        await bindings.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
        ).all()
      ).results,
    ).toEqual([
      { name: "artworks_no_deleted_images_insert" },
      { name: "artworks_no_deleted_images_update" },
    ]);
  });
});

describe("authentication and request boundaries", () => {
  it("advertises Studio links and installation only on the private Studio page", async () => {
    for (const path of [
      "/",
      "/works",
      "/series",
      "/about",
      "/contact",
      "/missing",
    ]) {
      const page = await website.request(
        `https://catalogue.test${path}`,
        {},
        {
          CATALOGUE: { artworks: [], series: [], preview: false },
          STUDIO_URL: "https://studio.test/studio",
        },
      );
      const html = await page.text();
      expect(html).not.toContain('rel="manifest"');
      expect(html).not.toContain('href="/studio"');
    }
    const editor = await studio.request(
      "https://studio.test/studio",
      {},
      local,
    );
    expect(editor.status).toBe(200);
    expect(await editor.text()).toContain(
      '<link rel="manifest" href="/manifest.webmanifest">',
    );
  });

  it("denies all studio endpoints without authentication and fails closed without configuration", async () => {
    for (const [path, method] of [
      ["/studio/artworks", "GET"],
      ["/studio/artworks", "POST"],
      ["/studio/artworks/missing", "GET"],
      ["/studio/artworks/missing", "PUT"],
      ["/studio/artworks/missing/publish", "POST"],
      ["/studio/artworks/missing/unpublish", "POST"],
      ["/studio/series", "POST"],
      ["/studio/series/missing", "PUT"],
      ["/studio/images", "POST"],
      ["/studio/export", "GET"],
      ["/studio/artworks/missing", "DELETE"],
      ["/studio/images", "GET"],
      ["/studio/images", "DELETE"],
      ["/studio/rebuild", "POST"],
    ]) {
      expect(
        (await request(path, json(method, {}, false), bindings)).status,
      ).toBe(401);
    }
    expect(await (await request("/session", {}, bindings)).json()).toEqual({
      authenticated: false,
    });
    expect(
      (
        await request(
          "/session",
          json("POST", { password: "anything" }, false),
          bindings,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await request(
          "/session",
          json("POST", { password: local.STUDIO_PASSWORD }, false),
          {
            ...local,
            SESSION_SECRET: "short",
          },
        )
      ).status,
    ).toBe(503);
  });

  it("sets a strict signed HttpOnly cookie, detects tampering, and deletes it on logout", async () => {
    expect(
      await (await request("/session", { headers: { Cookie: cookie } })).json(),
    ).toEqual({ authenticated: true, email: "local-studio" });
    const login = await request(
      "/session",
      json("POST", { password: local.STUDIO_PASSWORD }, false),
    );
    expect(login.headers.get("Set-Cookie")).toMatch(/HttpOnly/);
    expect(login.headers.get("Set-Cookie")).toMatch(/SameSite=Strict/i);
    expect(login.headers.get("Set-Cookie")).toMatch(/Secure/);
    expect(login.headers.get("Set-Cookie")).toMatch(/Path=\/api/);
    expect(
      await (
        await request("/session", { headers: { Cookie: `${cookie}invalid` } })
      ).json(),
    ).toEqual({ authenticated: false });
    expect(
      (await request("/session", json("POST", { password: "wrong" }, false)))
        .status,
    ).toBe(401);
    const logout = await request("/session", json("DELETE"));
    expect(await logout.json()).toEqual({ authenticated: false });
    expect(logout.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
  });

  it("rejects cross-origin and null-origin writes, including login, publish, and logout", async () => {
    const artwork = await create();
    for (const origin of [
      "https://evil.test",
      "null",
      "https://catalogue.test.evil.test",
    ]) {
      for (const [path, method] of [
        ["/session", "POST"],
        ["/session", "DELETE"],
        ["/studio/artworks", "POST"],
        [`/studio/artworks/${artwork.id}`, "PUT"],
        [`/studio/artworks/${artwork.id}/publish`, "POST"],
        [`/studio/artworks/${artwork.id}/unpublish`, "POST"],
        [`/studio/artworks/${artwork.id}`, "DELETE"],
        ["/studio/images", "DELETE"],
        ["/studio/rebuild", "POST"],
      ]) {
        const options = json(method, {});
        options.headers = { ...options.headers, Origin: origin };
        expect((await request(path, options)).status).toBe(403);
      }
    }
    expect(
      (
        await request("/studio/artworks", {
          method: "POST",
          headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/catalogue", {
          headers: { Origin: "https://evil.test" },
        })
      ).headers.has("Access-Control-Allow-Origin"),
    ).toBe(false);
    expect((await catalogue()).artworks).toEqual([]);
  });

  it("verifies Access signatures, issuer, audience, expiry, and an explicit email allowlist", async () => {
    const domain = `${crypto.randomUUID()}.cloudflareaccess.com`;
    const { publicKey, privateKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: "test-key",
      alg: "RS256",
      use: "sig",
    };
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ keys: [jwk] }));
    const configuration = {
      ...bindings,
      ACCESS_TEAM_DOMAIN: domain,
      ACCESS_AUD: "studio",
      ACCESS_EMAILS: "artist@example.test",
    };
    const token = (
      email: string,
      audience = "studio",
      issuer = `https://${domain}`,
      expiration = "5m",
    ) =>
      new SignJWT({ email })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject("artist")
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(expiration)
        .sign(privateKey);
    const accessRequest = async (jwt: string, settings = configuration) =>
      request(
        "/studio/artworks",
        {
          headers: { "Cf-Access-Jwt-Assertion": jwt },
        },
        settings,
      );
    expect(
      (await accessRequest(await token("Artist@Example.Test"))).status,
    ).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      `https://${domain}/cdn-cgi/access/certs`,
      expect.anything(),
    );
    expect(
      (await accessRequest(await token("other@example.test"))).status,
    ).toBe(401);
    expect(
      (await accessRequest(await token("artist@example.test", "wrong"))).status,
    ).toBe(401);
    expect(
      (
        await accessRequest(
          await token("artist@example.test", "studio", "https://evil.test"),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await accessRequest(
          await token(
            "artist@example.test",
            "studio",
            `https://${domain}`,
            "-1s",
          ),
        )
      ).status,
    ).toBe(401);
    expect((await accessRequest("invalid.jwt.signature")).status).toBe(401);
    expect(
      (
        await accessRequest(await token("artist@example.test"), {
          ...configuration,
          ACCESS_EMAILS: "",
        })
      ).status,
    ).toBe(401);
  });
});

describe("GitHub Pages rebuilds", () => {
  it("reports missing configuration without network for public mutations and manual retries", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network request"));
    const artwork = await create({ title: "Offline setup", images: [image] });
    const seriesResponse = await request(
      "/studio/series",
      json("POST", { name: "Nature" }),
    );
    const { series } = (await seriesResponse.clone().json()) as {
      series: Series;
    };
    const responses = [
      seriesResponse,
      await request(`/studio/series/${series.id}`, json("PUT", series)),
      await request(`/studio/artworks/${artwork.id}/publish`, json("POST")),
      await request(`/studio/artworks/${artwork.id}/unpublish`, json("POST")),
      await request(`/studio/artworks/${artwork.id}/publish`, json("POST")),
      await request(`/studio/artworks/${artwork.id}`, json("DELETE")),
      await request("/studio/rebuild", json("POST")),
    ];
    for (const response of responses) {
      expect(response.ok).toBe(true);
      expect(await response.json()).toMatchObject({
        siteUpdate: { status: "not-configured" },
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("dispatches only to the fixed workflow and ref with server-side authorization", async () => {
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    expect(
      (await request("/studio/rebuild", json("POST", {}, false))).status,
    ).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await request(
      "/studio/rebuild",
      json("POST", { ref: "evil", repository: "other/repo" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ siteUpdate: { status: "queued" } });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://api.github.com/repos/shashank-sharma/sharmila-sharma.github.io/actions/workflows/pages.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${local.GITHUB_PAGES_TOKEN}`,
          Accept: "application/vnd.github+json",
        }),
        body: JSON.stringify({ ref: "master" }),
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("queues successful public changes but not failed or repeated mutations", async () => {
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const artwork = await create({ title: "Public changes", images: [image] });
    const published = await request(
      `/studio/artworks/${artwork.id}/publish`,
      json("POST"),
    );
    expect(await published.json()).toMatchObject({
      siteUpdate: { status: "queued" },
    });
    const seriesResponse = await request(
      "/studio/series",
      json("POST", { name: "Nature" }),
    );
    const seriesBody = (await seriesResponse.json()) as { series: Series };
    expect(seriesBody).toMatchObject({ siteUpdate: { status: "queued" } });
    expect(
      await (
        await request(
          `/studio/series/${seriesBody.series.id}`,
          json("PUT", { ...seriesBody.series, name: "River" }),
        )
      ).json(),
    ).toMatchObject({ siteUpdate: { status: "queued" } });
    expect(
      await (
        await request(`/studio/artworks/${artwork.id}/unpublish`, json("POST"))
      ).json(),
    ).toMatchObject({ siteUpdate: { status: "queued" } });
    expect(
      await (
        await request(`/studio/artworks/${artwork.id}/unpublish`, json("POST"))
      ).json(),
    ).toMatchObject({ siteUpdate: { status: "not-needed" } });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}/unpublish`,
          json("POST", { version: 1 }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}`,
          json("DELETE", { version: 1 }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await request("/studio/series", json("POST", { name: "" }))).status,
    ).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("keeps draft changes and draft-only permanent deletion private without dispatching", async () => {
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const initial = await create({ title: "Private work", images: [image] });
    const artwork = await save({ ...initial, title: "Edited privately" });
    const privateWork = await create({ title: "Delete private work" });
    expect(
      await (
        await request(`/studio/artworks/${privateWork.id}`, json("DELETE"))
      ).json(),
    ).toEqual({ deleted: true, id: privateWork.id });
    expect(fetcher).not.toHaveBeenCalled();
    await request(`/studio/artworks/${artwork.id}/publish`, json("POST"));
    const snapshot = (await catalogue()).artworks[0];
    await save({ ...snapshot, title: "Not public" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await catalogue()).artworks).toEqual([snapshot]);
  });

  it("preserves durable public changes when GitHub rejects or transport fails, and allows retry", async () => {
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(local.GITHUB_PAGES_TOKEN, { status: 403 }),
      );
    const artwork = await create({
      title: "Saved despite outage",
      images: [image],
    });
    const published = await request(
      `/studio/artworks/${artwork.id}/publish`,
      json("POST"),
    );
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({
      published: true,
      siteUpdate: { status: "failed" },
    });
    expect((await catalogue()).artworks).toHaveLength(1);
    fetcher.mockRejectedValue(new Error(local.GITHUB_PAGES_TOKEN));
    const series = await request(
      "/studio/series",
      json("POST", { name: "Still saved" }),
    );
    expect(series.status).toBe(201);
    expect(await series.json()).toMatchObject({
      siteUpdate: { status: "failed" },
    });
    const savedSeries = (await catalogue()).series[0];
    expect(savedSeries.name).toBe("Still saved");
    expect(
      await (
        await request(
          `/studio/series/${savedSeries.id}`,
          json("PUT", { ...savedSeries, name: "Updated despite outage" }),
        )
      ).json(),
    ).toMatchObject({ siteUpdate: { status: "failed" } });
    expect((await catalogue()).series[0].name).toBe("Updated despite outage");
    const unpublished = await request(
      `/studio/artworks/${artwork.id}/unpublish`,
      json("POST"),
    );
    expect(unpublished.status).toBe(200);
    expect(await unpublished.json()).toMatchObject({
      published: false,
      hasDraft: true,
      siteUpdate: { status: "failed" },
    });
    expect((await catalogue()).artworks).toEqual([]);
    const calls = fetcher.mock.calls.length;
    expect(
      await (
        await request(`/studio/artworks/${artwork.id}/unpublish`, json("POST"))
      ).json(),
    ).toMatchObject({ siteUpdate: { status: "not-needed" } });
    expect(fetcher).toHaveBeenCalledTimes(calls);
    await request(`/studio/artworks/${artwork.id}/publish`, json("POST"));
    expect(
      await (
        await request(`/studio/artworks/${artwork.id}`, json("DELETE"))
      ).json(),
    ).toMatchObject({
      deleted: true,
      id: artwork.id,
      siteUpdate: { status: "failed" },
    });
    expect((await catalogue()).artworks).toEqual([]);
    const failed = await request("/studio/rebuild", json("POST"));
    expect(await failed.json()).toEqual({ siteUpdate: { status: "failed" } });
    fetcher.mockResolvedValue(new Response(null, { status: 204 }));
    expect(
      await (await request("/studio/rebuild", json("POST"))).json(),
    ).toEqual({ siteUpdate: { status: "queued" } });
  });

  it("does not report queued for unexpected acknowledgements or GitHub error statuses", async () => {
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi.spyOn(globalThis, "fetch");
    for (const status of [200, 202, 401, 404, 422, 429, 500]) {
      fetcher.mockResolvedValue(new Response("GitHub details", { status }));
      expect(
        await (await request("/studio/rebuild", json("POST"))).json(),
      ).toEqual({ siteUpdate: { status: "failed" } });
    }
  });

  it("bounds even a nonresponsive transport and aborts it after five seconds", async () => {
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise<Response>(() => {}));
    vi.useFakeTimers();
    try {
      const pending = request("/studio/rebuild", json("POST"));
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(5000);
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        siteUpdate: { status: "failed" },
      });
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("drafts, publication and optimistic updates on real D1", () => {
  it("unpublishes without overwriting the working draft and removes public artwork and series cover", async () => {
    const initial = await create({ title: "Published work", images: [image] });
    await request(`/studio/artworks/${initial.id}/publish`, json("POST"));
    const snapshot = (await catalogue()).artworks[0];
    await request(
      "/studio/series",
      json("POST", { name: "Nature", coverArtworkId: initial.id }),
    );
    expect((await catalogue()).series[0].coverArtworkId).toBe(initial.id);
    // An incomplete draft is still valid working state and must not be replaced by published work.
    const draft = await save({
      ...snapshot,
      title: "",
      images: [],
      description: "Private edits",
    });
    const before = await bindings.DB.prepare(
      "SELECT draft_json FROM artworks WHERE id = ?",
    )
      .bind(initial.id)
      .first<{ draft_json: string }>();
    const response = await request(
      `/studio/artworks/${initial.id}/unpublish`,
      json("POST", { version: draft.version }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      artwork: { ...draft, version: draft.version + 1 },
      published: false,
      hasDraft: true,
      siteUpdate: { status: "not-configured" },
    });
    expect(
      await bindings.DB.prepare(
        "SELECT draft_json, published_json, version FROM artworks WHERE id = ?",
      )
        .bind(initial.id)
        .first(),
    ).toEqual({
      draft_json: before!.draft_json,
      published_json: null,
      version: draft.version + 1,
    });
    const publicData = await catalogue();
    expect(publicData.artworks).toEqual([]);
    expect(publicData.series[0].coverArtworkId).toBeNull();
    const list = await request("/studio/artworks", {
      headers: { Cookie: cookie },
    });
    expect(await list.json()).toMatchObject({
      artworks: [{ id: initial.id, published: false, hasDraft: true }],
      series: [{ coverArtworkId: initial.id }],
    });
    expect(
      (
        await website.request(
          `https://catalogue.test/works/${initial.slug}`,
          {},
          {
            CATALOGUE: { ...publicData, preview: false },
            STUDIO_URL: "https://studio.test",
          },
        )
      ).status,
    ).toBe(404);
  });

  it("retains published work as a draft when needed and makes repeated unpublish a strict no-op", async () => {
    const artwork = await create({ title: "Retain me", images: [image] });
    await request(`/studio/artworks/${artwork.id}/publish`, json("POST"));
    const snapshot = (await catalogue()).artworks[0];
    const row = () =>
      bindings.DB.prepare("SELECT * FROM artworks WHERE id = ?")
        .bind(artwork.id)
        .first();
    const published = await row();
    const response = await request(
      `/studio/artworks/${artwork.id}/unpublish`,
      json("POST"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { artwork: Artwork };
    expect(body).toEqual({
      artwork: { ...snapshot, version: snapshot.version + 1 },
      published: false,
      hasDraft: true,
      siteUpdate: { status: "not-configured" },
    });
    const unpublished = await row();
    expect(unpublished).toMatchObject({
      draft_json: published!.published_json,
      published_json: null,
    });
    for (const options of [
      json("POST"),
      json("POST", { version: body.artwork.version }),
    ]) {
      const repeated = await request(
        `/studio/artworks/${artwork.id}/unpublish`,
        options,
      );
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toEqual({
        ...body,
        siteUpdate: { status: "not-needed" },
      });
      expect(await row()).toEqual(unpublished);
    }
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}/unpublish`,
          json("POST", {
            version: snapshot.version,
          }),
        )
      ).status,
    ).toBe(409);
    expect(await row()).toEqual(unpublished);
    // Retained work can be published again; no revision restoration is needed.
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}/publish`,
          json("POST", {
            version: body.artwork.version,
          }),
        )
      ).status,
    ).toBe(200);
    expect((await catalogue()).artworks[0]).toEqual({
      ...snapshot,
      version: snapshot.version + 2,
    });
  });

  it("dispatches unpublish only for an actual publication, never for invalid, stale, private, or deleted requests", async () => {
    const artwork = await create({
      title: "Dispatch boundaries",
      images: [image],
    });
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const path = `/studio/artworks/${artwork.id}/unpublish`;
    expect(
      await (
        await request(path, json("POST", { version: artwork.version }))
      ).json(),
    ).toMatchObject({
      artwork,
      siteUpdate: { status: "not-needed" },
    });
    for (const version of ["1", 0, -1, 1.5, null]) {
      expect((await request(path, json("POST", { version }))).status).toBe(400);
    }
    expect((await request(path, { ...json("POST"), body: "{" })).status).toBe(
      400,
    );
    expect(
      (await request("/studio/artworks/missing/unpublish", json("POST")))
        .status,
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    await request(`/studio/artworks/${artwork.id}/publish`, json("POST"));
    fetcher.mockClear();
    expect(
      (await request(path, json("POST", { version: artwork.version }))).status,
    ).toBe(409);
    expect((await request(path, json("POST", {}, false))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    const snapshot = (await catalogue()).artworks[0];
    const response = await request(
      path,
      json("POST", { version: snapshot.version }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      siteUpdate: { status: "queued" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await (await request(path, json("POST"))).json()).toMatchObject({
      siteUpdate: { status: "not-needed" },
    });
    await request(`/studio/artworks/${artwork.id}`, json("DELETE"));
    expect((await request(path, json("POST"))).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await catalogue()).artworks).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not lose simultaneous edits when unpublishing with an expected version", async () => {
    const initial = await create({ title: "Public work", images: [image] });
    await request(`/studio/artworks/${initial.id}/publish`, json("POST"));
    const snapshot = (await catalogue()).artworks[0];
    const draft = await save({ ...snapshot, title: "Existing draft" });
    const [unpublishing, saving] = await Promise.all([
      request(
        `/studio/artworks/${initial.id}/unpublish`,
        json("POST", { version: draft.version }),
      ),
      request(
        `/studio/artworks/${initial.id}`,
        json("PUT", { artwork: { ...draft, title: "Concurrent edit" } }),
      ),
    ]);
    expect([unpublishing.status, saving.status].sort()).toEqual([200, 409]);
    const detail = (await (
      await request(`/studio/artworks/${initial.id}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { artwork: Artwork; published: boolean };
    expect(detail.artwork.version).toBe(draft.version + 1);
    if (saving.status === 200) {
      expect(detail.artwork.title).toBe("Concurrent edit");
      expect(detail.published).toBe(true);
      expect((await catalogue()).artworks).toEqual([snapshot]);
      expect(
        (
          await request(
            `/studio/artworks/${initial.id}/unpublish`,
            json("POST", {
              version: detail.artwork.version,
            }),
          )
        ).status,
      ).toBe(200);
      expect(
        await (
          await request(`/studio/artworks/${initial.id}`, {
            headers: { Cookie: cookie },
          })
        ).json(),
      ).toMatchObject({
        artwork: { title: "Concurrent edit", version: draft.version + 2 },
        published: false,
      });
    } else {
      expect(detail.artwork.title).toBe("Existing draft");
      expect(detail.published).toBe(false);
      expect((await catalogue()).artworks).toEqual([]);
      await save({ ...detail.artwork, title: "Concurrent edit" });
    }
  });

  it("allows only one competing versioned unpublish and dispatches once", async () => {
    const initial = await create({ title: "One unpublish", images: [image] });
    await request(`/studio/artworks/${initial.id}/publish`, json("POST"));
    const snapshot = (await catalogue()).artworks[0];
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const responses = await Promise.all([
      request(
        `/studio/artworks/${initial.id}/unpublish`,
        json("POST", { version: snapshot.version }),
      ),
      request(
        `/studio/artworks/${initial.id}/unpublish`,
        json("POST", { version: snapshot.version }),
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await catalogue()).artworks).toEqual([]);
  });

  it("checks the optional publish version without breaking body-less callers", async () => {
    const initial = await create({
      id: "",
      title: "Versioned",
      images: [image],
    });
    expect(initial.id).not.toBe("");
    const artwork = await save({ ...initial, title: "Newer draft" });
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}/publish`,
          json("POST", { version: initial.version }),
        )
      ).status,
    ).toBe(409);
    expect((await catalogue()).artworks).toEqual([]);
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}/publish`,
          json("POST", { version: "2" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}/publish`,
          json("POST", { version: artwork.version }),
        )
      ).status,
    ).toBe(200);
    expect((await catalogue()).artworks[0].title).toBe("Newer draft");
  });

  it("permanently deletes artwork with an optional version and clears catalogue, Studio, export and series cover", async () => {
    const initial = await create({
      title: "Delete this painting",
      images: [image],
    });
    const published = await request(
      `/studio/artworks/${initial.id}/publish`,
      json("POST"),
    );
    const snapshot = ((await published.json()) as { artwork: Artwork }).artwork;
    const artwork = await save({ ...snapshot, title: "Unsaved publicly" });
    await request(
      "/studio/series",
      json("POST", { name: "Nature", coverArtworkId: artwork.id }),
    );
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}`,
          json("DELETE", { version: snapshot.version }),
        )
      ).status,
    ).toBe(409);
    expect((await catalogue()).artworks).toEqual([snapshot]);
    const removed = await request(
      `/studio/artworks/${artwork.id}`,
      json("DELETE", { version: artwork.version }),
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      deleted: true,
      id: artwork.id,
      siteUpdate: { status: "not-configured" },
    });
    const publicData = await catalogue();
    expect(publicData.artworks).toEqual([]);
    expect(publicData.series[0].coverArtworkId).toBeNull();
    const list = (await (
      await request("/studio/artworks", { headers: { Cookie: cookie } })
    ).json()) as { artworks: Artwork[]; series: Series[] };
    expect(list.artworks).toEqual([]);
    expect(list.series[0].coverArtworkId).toBeNull();
    expect(
      await bindings.DB.prepare("SELECT id FROM artworks WHERE id = ?")
        .bind(artwork.id)
        .first(),
    ).toBeNull();
    expect(
      (
        await request(`/studio/artworks/${artwork.id}`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}`,
          json("PUT", { artwork }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await request(`/studio/artworks/${artwork.id}/publish`, json("POST")))
        .status,
    ).toBe(404);
    expect(
      (await request(`/studio/artworks/${artwork.id}/unpublish`, json("POST")))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}/undelete`,
          json("POST", { version: artwork.version }),
        )
      ).status,
    ).toBe(404);
    const exported = (await (
      await request("/studio/export", { headers: { Cookie: cookie } })
    ).json()) as { artworks: unknown[] };
    expect(exported.artworks).toEqual([]);
    // Repeating deletion of a missing painting is 404 and never dispatches again.
    const repeated = await request(
      `/studio/artworks/${artwork.id}`,
      json("DELETE"),
    );
    expect(repeated.status).toBe(404);
  });

  it("guards permanent deletion against concurrent edits and never resurrects deleted work", async () => {
    const initial = await create({
      title: "Concurrent deletion",
      images: [image],
    });
    await request(`/studio/artworks/${initial.id}/publish`, json("POST"));
    const artwork = (await catalogue()).artworks[0];
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const path = `/studio/artworks/${artwork.id}`;
    for (const version of [0, "2", null, -1]) {
      expect((await request(path, json("DELETE", { version }))).status).toBe(
        400,
      );
    }
    expect(fetcher).not.toHaveBeenCalled();
    const [deleting, saving] = await Promise.all([
      request(path, json("DELETE", { version: artwork.version })),
      request(
        path,
        json("PUT", { artwork: { ...artwork, title: "Concurrent edit" } }),
      ),
    ]);
    if (deleting.status === 200) {
      expect([404, 409]).toContain(saving.status);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(
        (await request(path, { headers: { Cookie: cookie } })).status,
      ).toBe(404);
      expect((await request(path, json("DELETE"))).status).toBe(404);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } else {
      expect(deleting.status).toBe(409);
      expect(saving.status).toBe(200);
      expect(fetcher).not.toHaveBeenCalled();
      const detail = (await (
        await request(path, { headers: { Cookie: cookie } })
      ).json()) as { artwork: Artwork };
      expect(detail.artwork).toMatchObject({
        title: "Concurrent edit",
        version: artwork.version + 1,
      });
      expect((await request(path, json("DELETE"))).status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    expect((await catalogue()).artworks).toEqual([]);
  });

  it("keeps draft-only work private and leaves the published snapshot unchanged after edits", async () => {
    const artwork = await create({ title: "River", images: [image] });
    expect(artwork.slug).toMatch(/^river-/);
    expect((await catalogue()).artworks).toEqual([]);
    const list = (await (
      await request("/studio/artworks", { headers: { Cookie: cookie } })
    ).json()) as { artworks: Artwork[] };
    expect(list.artworks[0]).toMatchObject({
      id: artwork.id,
      published: false,
      hasDraft: true,
    });
    const published = await request(
      `/studio/artworks/${artwork.id}/publish`,
      json("POST"),
    );
    expect(published.status).toBe(200);
    const snapshot = ((await published.json()) as { artwork: Artwork }).artwork;
    expect(snapshot.version).toBe(2);
    expect((await catalogue()).artworks).toEqual([snapshot]);
    const edited = await save({
      ...snapshot,
      title: "Unpublished title",
      priceMode: "listed",
      price: 25000,
    });
    expect(edited.version).toBe(3);
    expect((await catalogue()).artworks).toEqual([snapshot]);
    const detail = (await (
      await request(`/studio/artworks/${artwork.id}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as Record<string, unknown>;
    expect(detail).toMatchObject({
      artwork: edited,
      published: true,
      hasDraft: true,
    });
    expect(detail).not.toHaveProperty("history");
    expect(detail).not.toHaveProperty("trashed");
    expect(
      (await request(`/studio/artworks/${artwork.id}/publish`, json("POST")))
        .status,
    ).toBe(200);
    expect((await catalogue()).artworks[0]).toMatchObject({
      title: "Unpublished title",
      price: 25000,
      version: 4,
    });
    const page = await website.request(
      `https://catalogue.test/works/${artwork.slug}`,
      {},
      {
        CATALOGUE: { ...(await catalogue()), preview: false },
        STUDIO_URL: "https://studio.test",
      },
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("₹25,000");
    expect(html).not.toContain("Price to be confirmed");
    expect(
      (await request(`/studio/artworks/${artwork.id}/publish`, json("POST")))
        .status,
    ).toBe(409);
  });

  it("requires title and image on publish, permits incomplete drafts, and validates listed prices", async () => {
    let artwork = await create();
    const noTitle = await request(
      `/studio/artworks/${artwork.id}/publish`,
      json("POST"),
    );
    expect(noTitle.status).toBe(400);
    expect(await noTitle.json()).toMatchObject({
      error: expect.stringContaining("title"),
      issues: expect.any(Array),
    });
    artwork = await save({ ...artwork, title: "Study", priceMode: "listed" });
    expect(
      (await request(`/studio/artworks/${artwork.id}/publish`, json("POST")))
        .status,
    ).toBe(400);
    artwork = await save({ ...artwork, images: [image] });
    const noPrice = await request(
      `/studio/artworks/${artwork.id}/publish`,
      json("POST"),
    );
    expect(noPrice.status).toBe(400);
    expect(await noPrice.json()).toMatchObject({
      error: expect.stringContaining("price"),
    });
    for (const price of [-1, "100", "NaN"]) {
      const invalid = await request(
        `/studio/artworks/${artwork.id}`,
        json("PUT", { artwork: { ...artwork, price } }),
      );
      expect(invalid.status).toBe(400);
    }
    artwork = await save({ ...artwork, price: 0 });
    expect(
      (await request(`/studio/artworks/${artwork.id}/publish`, json("POST")))
        .status,
    ).toBe(200);
    expect((await catalogue()).artworks[0].price).toBe(0);
  });

  it("rejects stale and simultaneously competing updates", async () => {
    const artwork = await create({ title: "Original" });
    // Identical bodies exercise the SQL guard even if both requests read version 1.
    const body = { artwork: { ...artwork, title: "Changed" } };
    const responses = await Promise.all([
      request(`/studio/artworks/${artwork.id}`, json("PUT", body)),
      request(`/studio/artworks/${artwork.id}`, json("PUT", body)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      (await request(`/studio/artworks/${artwork.id}`, json("PUT", body)))
        .status,
    ).toBe(409);
    const detail = (await (
      await request(`/studio/artworks/${artwork.id}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { artwork: Artwork };
    expect(detail.artwork).toMatchObject({ version: 2, title: "Changed" });
    expect(detail).not.toHaveProperty("history");
  });

  it("exports only independent current snapshots and removes the revision restore route", async () => {
    let artwork = await create({ title: "First", images: [image] });
    await request(`/studio/artworks/${artwork.id}/publish`, json("POST"));
    const detail = (await (
      await request(`/studio/artworks/${artwork.id}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      artwork: Artwork;
    };
    artwork = await save({ ...detail.artwork, title: "Second draft" });
    const restore = await request(
      `/studio/artworks/${artwork.id}/restore`,
      json("POST", { revisionId: "obsolete-revision" }),
    );
    expect(restore.status).toBe(404);
    expect(
      (await request(`/studio/artworks/${artwork.id}/undelete`, json("POST")))
        .status,
    ).toBe(404);
    expect((await catalogue()).artworks[0]).toMatchObject({
      title: "First",
      version: 2,
    });
    await create();
    const exported = await request("/studio/export", {
      headers: { Cookie: cookie },
    });
    expect(exported.headers.get("Content-Disposition")).toContain(
      "catalogue-inventory.json",
    );
    const inventory = (await exported.json()) as {
      artworks: Array<{ id: string; draft: Artwork; published: Artwork }>;
    };
    expect(
      inventory.artworks.find((item) => item.id === artwork.id),
    ).toMatchObject({
      draft: { title: "Second draft", version: 3 },
      published: { version: 2 },
    });
    expect(inventory).not.toHaveProperty("revisions");
    for (const item of inventory.artworks) {
      expect(item).not.toHaveProperty("trashed");
      expect(item).not.toHaveProperty("deletedAt");
    }
    expect(JSON.stringify(inventory)).not.toContain(local.STUDIO_PASSWORD);
    expect(JSON.stringify(inventory)).not.toContain(local.SESSION_SECRET);
  });

  it("validates series and artwork references and hides draft-only cover IDs publicly", async () => {
    const artwork = await create();
    const response = await request(
      "/studio/series",
      json("POST", { name: "Nature", coverArtworkId: artwork.id }),
    );
    expect(response.status).toBe(201);
    const { series } = (await response.json()) as { series: Series };
    expect((await catalogue()).series[0]).toMatchObject({
      name: "Nature",
      coverArtworkId: null,
    });
    expect(
      (
        await request(
          `/studio/series/${series.id}`,
          json("PUT", { ...series, name: "" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/studio/series/${series.id}`,
          json("PUT", { series: { ...series, name: "Landscapes" } }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/studio/artworks/${artwork.id}`,
          json("PUT", { artwork: { ...artwork, seriesId: "missing" } }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await request("/studio/artworks", json("POST", { title: 42 }))).status,
    ).toBe(400);
    expect(
      (await request("/studio/artworks", json("POST", { id: artwork.id })))
        .status,
    ).toBe(409);
    expect(
      (await request("/studio/artworks", { ...json("POST"), body: "{invalid" }))
        .status,
    ).toBe(400);
  });
});

describe("immutable public web derivatives in real R2", () => {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO9sAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );

  function multipart(
    bytes: Uint8Array | string,
    type = "image/png",
    kind?: string,
  ) {
    const form = new FormData();
    form.set(
      "file",
      new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], {
        type,
      }),
      "painting.png",
    );
    if (kind !== undefined) form.set("kind", kind);
    return {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://catalogue.test" },
      body: form,
    };
  }

  async function upload(kind?: string) {
    const response = await request(
      "/studio/images",
      multipart(png, "image/png", kind),
    );
    expect(response.status).toBe(201);
    return response.json() as Promise<Artwork["images"][number]>;
  }

  async function library() {
    const response = await request("/studio/images", {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    return (
      (await response.json()) as {
        images: Array<Artwork["images"][number] & { used: boolean }>;
      }
    ).images;
  }

  it("separates website and artwork uploads and permanently deletes only unused managed images", async () => {
    local.GITHUB_PAGES_TOKEN = crypto.randomUUID();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network request"));
    const artworkImage = await upload();
    const siteImage = await upload("site");
    expect(artworkImage.key).toMatch(
      /^sharmila\/artworks\/uploads\/[0-9a-f-]+\.png$/,
    );
    expect(siteImage.key).toMatch(/^sharmila\/site\/[0-9a-f-]+\.png$/);
    expect(
      (await library())
        .map((item) => ({ key: item.key, used: item.used }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ).toEqual(
      [artworkImage, siteImage]
        .map((item) => ({ key: item.key, used: false }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(
      (await request("/studio/images", multipart(png, "image/png", "private")))
        .status,
    ).toBe(400);
    expect(
      (await request("/studio/artworks", json("POST", { images: [siteImage] })))
        .status,
    ).toBe(400);
    const denied = await request(
      "/studio/images",
      json("DELETE", { key: siteImage.key }, false),
    );
    expect(denied.status).toBe(401);
    expect(await bindings.IMAGES.head(siteImage.key)).not.toBeNull();
    for (const uploaded of [artworkImage, siteImage]) {
      const removed = await request(
        "/studio/images",
        json("DELETE", { key: uploaded.key }),
      );
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual({
        deleted: true,
        key: uploaded.key,
      });
      expect(await bindings.IMAGES.head(uploaded.key)).toBeNull();
      expect(
        await bindings.DB.prepare("SELECT key FROM images WHERE key = ?")
          .bind(uploaded.key)
          .first(),
      ).toBeNull();
    }
    expect(await library()).toEqual([]);
    expect(
      (await request("/studio/images", json("DELETE", { key: siteImage.key })))
        .status,
    ).toBe(404);
    // A stale form cannot reattach a permanently deleted image.
    expect(
      (
        await request(
          "/studio/artworks",
          json("POST", { images: [artworkImage] }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          "/studio/images",
          json("DELETE", { key: "sharmila/artworks/legacy.webp" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/studio/images",
          json("DELETE", { key: "another-blog/file.webp" }),
        )
      ).status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("protects both current snapshots but allows deletion of obsolete photos after replacement", async () => {
    const original = await upload();
    const replacement = await upload();
    let artwork = await create({ title: "Current photos", images: [original] });
    const assertProtected = async (key: string) => {
      const response = await request("/studio/images", json("DELETE", { key }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining("current draft or published version"),
      });
      expect(await bindings.IMAGES.head(key)).not.toBeNull();
      expect((await library()).find((item) => item.key === key)?.used).toBe(
        true,
      );
    };
    await assertProtected(original.key);
    const published = await request(
      `/studio/artworks/${artwork.id}/publish`,
      json("POST"),
    );
    artwork = ((await published.json()) as { artwork: Artwork }).artwork;
    artwork = await save({ ...artwork, images: [replacement] });
    await assertProtected(original.key);
    await assertProtected(replacement.key);
    await request(`/studio/artworks/${artwork.id}/publish`, json("POST"));
    // Neither current snapshot references the original; no history retains it.
    expect(
      (await library()).find((item) => item.key === original.key)?.used,
    ).toBe(false);
    expect(
      (await request("/studio/images", json("DELETE", { key: original.key })))
        .status,
    ).toBe(200);
    expect(await bindings.IMAGES.head(original.key)).toBeNull();
    await assertProtected(replacement.key);
  });

  it("releases published-only photos on unpublish without deleting R2 objects or the current draft photo", async () => {
    const original = await upload();
    const replacement = await upload();
    const initial = await create({
      title: "Unpublish photo",
      images: [original],
    });
    await request(`/studio/artworks/${initial.id}/publish`, json("POST"));
    const snapshot = (await catalogue()).artworks[0];
    const draft = await save({ ...snapshot, images: [replacement] });
    expect(
      (
        await request(
          `/studio/artworks/${initial.id}/unpublish`,
          json("POST", { version: draft.version }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await library()).find((item) => item.key === original.key)?.used,
    ).toBe(false);
    expect(
      (await library()).find((item) => item.key === replacement.key)?.used,
    ).toBe(true);
    expect(await bindings.IMAGES.head(original.key)).not.toBeNull();
    expect(
      (await request("/studio/images", json("DELETE", { key: original.key })))
        .status,
    ).toBe(200);
    expect(
      (
        await request(
          "/studio/images",
          json("DELETE", { key: replacement.key }),
        )
      ).status,
    ).toBe(409);
    const current = (await (
      await request(`/studio/artworks/${initial.id}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { artwork: Artwork };
    expect(
      (
        await request(
          `/studio/artworks/${initial.id}`,
          json("PUT", {
            artwork: { ...current.artwork, images: [original] },
          }),
        )
      ).status,
    ).toBe(409);
  });

  it("permanent artwork deletion only releases references and never cascades to shared or unused R2 photos", async () => {
    const shared = await upload();
    const draftOnly = await upload();
    const first = await create({ title: "First painting", images: [shared] });
    const second = await create({ title: "Shared photo", images: [shared] });
    await request(`/studio/artworks/${first.id}/publish`, json("POST"));
    const published = (await catalogue()).artworks[0];
    await save({ ...published, images: [draftOnly] });
    expect(
      (await request(`/studio/artworks/${first.id}`, json("DELETE"))).status,
    ).toBe(200);
    expect(await bindings.IMAGES.head(shared.key)).not.toBeNull();
    expect(await bindings.IMAGES.head(draftOnly.key)).not.toBeNull();
    expect(
      (await library()).find((item) => item.key === shared.key)?.used,
    ).toBe(true);
    expect(
      (await library()).find((item) => item.key === draftOnly.key)?.used,
    ).toBe(false);
    expect(
      (await request("/studio/images", json("DELETE", { key: shared.key })))
        .status,
    ).toBe(409);
    expect(
      (await request("/studio/images", json("DELETE", { key: draftOnly.key })))
        .status,
    ).toBe(200);
    expect(
      (await request(`/studio/artworks/${second.id}`, json("DELETE"))).status,
    ).toBe(200);
    expect(await bindings.IMAGES.head(shared.key)).not.toBeNull();
    expect(
      (await library()).find((item) => item.key === shared.key)?.used,
    ).toBe(false);
    expect(
      (await request("/studio/images", json("DELETE", { key: shared.key })))
        .status,
    ).toBe(200);
    expect(await library()).toEqual([]);
  });

  it("serializes deletion against a competing save so no painting acquires a missing photo", async () => {
    const uploaded = await upload();
    const artwork = await create({ title: "Concurrent photo" });
    const [deletion, saving] = await Promise.all([
      request("/studio/images", json("DELETE", { key: uploaded.key })),
      request(
        `/studio/artworks/${artwork.id}`,
        json("PUT", { artwork: { ...artwork, images: [uploaded] } }),
      ),
    ]);
    expect([deletion.status, saving.status]).toSatisfy(
      ([deleted, saved]: number[]) =>
        (deleted === 200 && saved === 409) ||
        (deleted === 409 && saved === 200),
    );
    if (saving.status === 200)
      expect(await bindings.IMAGES.head(uploaded.key)).not.toBeNull();
    else expect(await bindings.IMAGES.head(uploaded.key)).toBeNull();
  });

  it("keeps failed R2 deletions retryable and blocks stale references while deletion is pending", async () => {
    const uploaded = await upload();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const unavailable = {
      ...local,
      IMAGES: {
        delete: async () => {
          throw new Error("Simulated R2 outage");
        },
      } as unknown as R2Bucket,
    };
    expect(
      (
        await request(
          "/studio/images",
          json("DELETE", { key: uploaded.key }),
          unavailable,
        )
      ).status,
    ).toBe(500);
    expect(errorLog).toHaveBeenCalled();
    expect(await bindings.IMAGES.head(uploaded.key)).not.toBeNull();
    expect(
      (await library()).find((item) => item.key === uploaded.key),
    ).toBeDefined();
    expect(
      (await request("/studio/artworks", json("POST", { images: [uploaded] })))
        .status,
    ).toBe(409);
    expect(
      (await request("/studio/images", json("DELETE", { key: uploaded.key })))
        .status,
    ).toBe(200);
    expect(await bindings.IMAGES.head(uploaded.key)).toBeNull();
    expect(await library()).toEqual([]);
  });

  it("sniffs actual image bytes, extracts dimensions, and never trusts filenames or MIME", async () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO9sAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const response = await request(
      "/studio/images",
      multipart(bytes, "text/html"),
    );
    expect(response.status).toBe(201);
    const uploaded = (await response.json()) as Artwork["images"][number];
    expect(uploaded).toMatchObject({ width: 1, height: 1, alt: "" });
    expect(uploaded.key).toMatch(
      /^sharmila\/artworks\/uploads\/[0-9a-f-]+\.png$/,
    );
    expect(uploaded.url).toBe(`/media/${uploaded.key}`);
    const stored = await bindings.IMAGES.get(uploaded.key);
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);
    const repeated = await request("/studio/images", multipart(bytes));
    expect(((await repeated.json()) as { key: string }).key).not.toBe(
      uploaded.key,
    );
    expect(
      (
        await request(
          "/studio/images",
          multipart('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        )
      ).status,
    ).toBe(400);
    expect(
      (await request("/studio/images", multipart("<html>not an image</html>")))
        .status,
    ).toBe(400);
    expect(
      (await request("/studio/images", multipart(bytes.subarray(0, 12))))
        .status,
    ).toBe(400);
  });

  it("rejects oversized files before storing them", async () => {
    const response = await request(
      "/studio/images",
      multipart(new Uint8Array(8 * 1024 * 1024 + 1)),
    );
    expect(response.status).toBe(413);
    expect((await bindings.IMAGES.list()).objects).toHaveLength(0);
  });
});
