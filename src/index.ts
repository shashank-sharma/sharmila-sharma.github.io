import { Hono } from "hono";
import api, { type Bindings, type Artwork, type Series } from "./api";
import site from "./site";
import { layout, studioMarkup } from "./views";
import legacy from "../data/legacy-preview.json";
import r2 from "../data/r2-manifest.json";

type Env = Bindings & { ASSETS: Fetcher; CATALOGUE_PREVIEW?: string };
const legacyImageURLs = new Map(
  r2.artworks.flatMap((a) =>
    a.derivatives.map((d) => [d.object_key, d.url] as const),
  ),
);
const app = new Hono<{ Bindings: Env }>();
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' https://images.vipul.xyz blob: data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  if (c.req.path === "/studio" || c.req.path.startsWith("/api/"))
    c.header("Cache-Control", "no-store");
});
app.route("/api", api);
app.get("/studio", (c) =>
  c.html(layout("Studio", studioMarkup(), { studio: true })),
);
app.get("/media/*", async (c) => {
  const key = c.req.path.slice("/media/".length);
  if (!key.startsWith("sharmila/")) return c.notFound();
  const url = legacyImageURLs.get(key);
  if (url) return c.redirect(url, 302);
  const object = await c.env.IMAGES.get(key);
  if (!object) return c.notFound();
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  c.header("Content-Type", object.httpMetadata?.contentType || "image/webp");
  return c.body(object.body);
});
app.get("*", async (c) => {
  // Only the orb preview renders public pages here. Production public HTML is built for GitHub Pages.
  if (c.env.CATALOGUE_PREVIEW !== "true") {
    return c.redirect(
      `https://sharmila.me${c.req.path}${new URL(c.req.url).search}`,
    );
  }
  const response = await api.request("/catalogue", {}, c.env);
  if (!response.ok) return c.text("Catalogue unavailable", 503);
  const data = (await response.json()) as {
    artworks: Artwork[];
    series: Series[];
  };
  const preview = !data.artworks.length;
  if (preview) {
    const { results } = await c.env.DB.prepare(
      "SELECT id FROM artworks WHERE deleted_at IS NOT NULL",
    ).all<{ id: string }>();
    const trashed = new Set(results.map((row) => row.id));
    data.artworks = (legacy as Artwork[]).filter((a) => !trashed.has(a.id));
  }
  return site.request(
    c.req.raw,
    {},
    { CATALOGUE: { ...data, preview }, STUDIO_URL: "/studio" },
  );
});
export default app;
