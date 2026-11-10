import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import site from "../src/site.ts";
import { escape } from "../src/views.ts";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist/pages");
const preview = process.argv.includes("--preview");
let catalogue;
if (preview) {
  catalogue = {
    artworks: JSON.parse(
      await readFile(resolve(root, "data/legacy-preview.json"), "utf8"),
    ),
    series: [
      {
        id: "school",
        slug: "school",
        name: "School",
        description: "",
        coverArtworkId: null,
        sortOrder: 0,
      },
      {
        id: "puppet",
        slug: "puppet",
        name: "Puppet",
        description: "",
        coverArtworkId: null,
        sortOrder: 1,
      },
    ],
    preview: true,
  };
} else {
  if (!process.env.CATALOGUE_URL || !process.env.STUDIO_URL)
    throw new Error(
      "Set CATALOGUE_URL to the published /api/catalogue endpoint and STUDIO_URL to the private Studio. Use --preview only for archive design review.",
    );
  const endpoint = new URL(process.env.CATALOGUE_URL);
  if (endpoint.pathname.replace(/\/$/, "") !== "/api/catalogue")
    throw new Error(
      "Builds may read only the public /api/catalogue endpoint, never Studio exports or drafts.",
    );
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `Public catalogue fetch failed: HTTP ${response.status}. Existing Pages deployment is unchanged.`,
    );
  const data = await response.json();
  if (!Array.isArray(data.artworks) || !Array.isArray(data.series))
    throw new Error("Invalid public catalogue response");
  catalogue = { ...data, preview: false };
}
const studioURL = process.env.STUDIO_URL || "/studio-not-configured";
const studio = new URL(studioURL, "https://sharmila.me");
if (!["https:", "http:"].includes(studio.protocol))
  throw new Error("Studio URL must be HTTP(S)");
const paths = [
  "/",
  "/works",
  "/series",
  "/about",
  "/contact",
  "/studio",
  "/robots.txt",
  "/sitemap.xml",
  "/404.html",
  "/gallery",
  ...(await readdir(resolve(root, "gallery")))
    .filter((name) => /^gallery\d+$/.test(name))
    .map((name) => "/gallery/" + name),
];
for (const a of catalogue.artworks) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug))
    throw new Error("Invalid painting slug");
  if (a.images.some((im) => !/^https:\/\//.test(im.url)))
    throw new Error(
      "Pages requires public HTTPS image URLs; /media is for local development only.",
    );
  paths.push("/works/" + a.slug);
}
for (const s of catalogue.series) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.slug))
    throw new Error("Invalid series slug");
  paths.push("/series/" + s.slug);
}
// Build in an isolated output folder. Never copy repository data, secrets, Worker code or original photos.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of [
  "style.css",
  "site.js",
  "mark.svg",
  "manifest.webmanifest",
  "fonts",
])
  await cp(resolve(root, "public", asset), resolve(output, asset), {
    recursive: true,
  });
await cp(resolve(root, "CNAME"), resolve(output, "CNAME"));
await writeFile(resolve(output, ".nojekyll"), "");
for (const path of paths) {
  const response = await site.request(
    "https://sharmila.me" + path,
    {},
    { CATALOGUE: catalogue, STUDIO_URL: studioURL },
  );
  let html;
  if (response.status >= 300 && response.status < 400) {
    const target = escape(response.headers.get("Location"));
    html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${target}"><title>Continue — Sharmila Sharma</title></head><body><a href="${target}">Continue ↗</a></body></html>`;
  } else {
    if (!response.ok && path !== "/404.html")
      throw new Error(`Rendering ${path} failed: HTTP ${response.status}`);
    html = await response.text();
  }
  const file = resolve(
    output,
    path === "/"
      ? "index.html"
      : path.includes(".")
        ? path.slice(1)
        : path.slice(1) + "/index.html",
  );
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
console.log(
  `Built ${paths.length} static pages/files from ${catalogue.artworks.length} ${preview ? "archive-preview" : "published"} paintings into dist/pages. No runtime API calls required by visitors.`,
);
