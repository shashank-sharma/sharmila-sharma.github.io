import { Hono } from "hono";
import {
  artworkCard,
  escape as e,
  image,
  layout,
  price,
  type Artwork,
  type Series,
} from "./views";

export type Catalogue = {
  artworks: Artwork[];
  series: Series[];
  preview: boolean;
};
export type SiteBindings = { CATALOGUE: Catalogue; STUDIO_URL: string };
const app = new Hono<{ Bindings: SiteBindings }>();
function catalogue(env: SiteBindings) {
  const { artworks, series, preview } = env.CATALOGUE;
  return {
    artworks: artworks.map((a) => ({ ...a, seriesId: a.seriesId || "others" })),
    series: [
      ...series,
      {
        id: "others",
        slug: "others",
        name: "Others",
        description: "Paintings beyond the named series.",
        sortOrder: 0,
        coverArtworkId: null,
      },
    ],
    preview,
  };
}
app.get("/", async (c) => {
  const { artworks, series, preview } = await catalogue(c.env);
  const featured = artworks.filter((a) => a.featured);
  const selected = (featured.length ? featured : artworks).slice(0, 6);
  const heroPool = artworks.filter(
    (a) => a.seriesId !== "others" && series.some((s) => s.id === a.seriesId),
  );
  const renderHero = (hero: Artwork) =>
    `<figure class="hero-work"><a href="/works/${e(hero.slug)}" aria-label="View ${e(hero.title)}">${image(hero, "", true)}</a><figcaption><span>${e(hero.title)} <span class="caption-divider">/</span> ${e(preview ? "From the archive" : [hero.medium, hero.year].filter(Boolean).join(", "))}</span><a href="/works/${e(hero.slug)}">View painting ↗</a></figcaption></figure>`;
  const content = `<section class="home-intro"><div><h1>Sharmila Sharma</h1><p class="intro-line">Contemporary artist</p></div><div class="intro-bio"><p>A Delhi-based artist with over 25 years of experience.<br>Working in acrylics, watercolours and mixed media.</p><a class="text-link" href="/about">About the artist <span aria-hidden="true">↗</span></a></div></section>${heroPool.length ? `${renderHero(heroPool[0])}<template id="home-hero-pool">${heroPool.map(renderHero).join("")}</template>` : artworks.length ? "" : '<section class="empty-state"><h2>The catalogue is being prepared.</h2><p>A selection of paintings will appear here soon.</p><a href="/contact">Enquire about available work</a></section>'}${
    selected.length > 1
      ? `<section class="selected-section"><div class="section-heading"><h2>Selected works</h2><a class="text-link" href="/works">View all works ↗</a></div><div class="works-grid">${selected
          .slice(1)
          .map((a) => artworkCard(a, series, preview))
          .join("")}</div></section>`
      : ""
  }<section class="home-closing"><h2>Enquiries</h2><p>For availability, delivery or further photographs, please contact Sharmila.</p><a class="text-link" href="/contact">Contact Sharmila ↗</a></section>`;
  return c.html(layout("Sharmila Sharma", content, { preview }));
});
app.get("/works", async (c) => {
  const { artworks, series, preview } = await catalogue(c.env);
  // Pages serves the same HTML for every query string; filtering runs over this complete snapshot.
  const shown = artworks;
  const content = `<section class="page-heading"><h1>Works</h1><p>Explore the paintings, together and individually.</p></section><form class="catalogue-filters" method="get"><div class="filter-links"><a href="/works" aria-current="page">All works</a>${series.map((s) => `<a href="/works?series=${e(s.id)}">${e(s.name)}</a>`).join("")}</div><div class="availability-filter"><label><input type="checkbox" name="availability" value="available"> Available works</label><button type="submit" class="text-button">Apply</button></div></form><p class="result-count" aria-live="polite">${shown.length} ${shown.length === 1 ? "work" : "works"}${preview ? " from the archive" : ""}</p><div class="works-grid catalogue-grid">${shown.map((a) => artworkCard(a, series, preview)).join("")}</div>${!shown.length ? '<div class="empty-state"><h2>No works here just yet.</h2><p>Try another selection or visit again as the catalogue grows.</p><a href="/works">See all works</a></div>' : ""}`;
  return c.html(
    layout(
      "Works",
      content +
        (shown.length
          ? '<div id="catalogue-empty" class="empty-state" hidden><h2>No works in this selection.</h2><p>Try another series or clear the availability filter.</p></div>'
          : ""),
      { active: "works", preview, path: "/works" },
    ),
  );
});
app.get("/works/:slug", async (c) => {
  const { artworks, series, preview } = await catalogue(c.env);
  const artwork = artworks.find((a) => a.slug === c.req.param("slug"));
  if (!artwork)
    return c.html(
      layout(
        "Painting not found",
        '<section class="empty-state"><h1>Painting not found.</h1><p>This work may no longer be published.</p><a href="/works">Return to the catalogue</a></section>',
      ),
      404,
    );
  const a = artwork;
  const group = series.find((s) => s.id === a.seriesId);
  const related = artworks
    .filter((w) => w.id !== a.id && w.seriesId === a.seriesId)
    .slice(0, 3);
  const email = `mailto:sharmila.sharma31@gmail.com?subject=${encodeURIComponent(`Enquiry: ${a.title} (${a.id})`)}&body=${encodeURIComponent(`Hello Sharmila,\n\nI would like to know more about ${a.title} (${a.id}).\nhttps://sharmila.me/works/${a.slug}\n\n`)}`;
  const content = `<a class="back-link text-link" href="${group ? `/series/${e(group.slug)}` : "/works"}">← ${group ? e(group.name) : "All works"}</a><article class="painting-detail"><div class="painting-images"><button class="painting-enlarge" data-enlarge="${e(a.images[0]?.url || "")}" data-alt="${e(a.images[0]?.alt || a.title)}" aria-label="Enlarge ${e(a.title)}">${image(a, "", true)}<span>View larger <span aria-hidden="true">↗</span></span></button>${a.images
    .slice(1)
    .map(
      (im) =>
        `<button class="detail-photo" data-enlarge="${e(im.url)}" data-alt="${e(im.alt)}"><img src="${e(im.url)}" alt="${e(im.alt)}" loading="lazy" width="${im.width}" height="${im.height}"></button>`,
    )
    .join(
      "",
    )}</div><div class="painting-info">${group ? `<a class="text-link" href="/series/${e(group.slug)}">${e(group.name)}</a>` : ""}<h1>${e(a.title)}</h1>${preview ? '<p class="secondary">Title and painting details awaiting the artist’s review.</p>' : `<p class="painting-medium">${e([a.medium, a.year].filter(Boolean).join(", "))}</p>`}<div class="painting-description">${
    a.description
      ? a.description
          .split("\n")
          .filter(Boolean)
          .map((p) => `<p>${e(p)}</p>`)
          .join("")
      : preview
        ? "<p>This painting is part of Sharmila Sharma’s studio archive. Its story and catalogue details will be added by the artist.</p>"
        : ""
  }</div><dl class="painting-facts">${a.height && a.width ? `<div><dt>Dimensions</dt><dd>${a.height} × ${a.width} ${e(a.unit)} (H × W)</dd></div>` : ""}${a.medium ? `<div><dt>Medium</dt><dd>${e(a.medium)}</dd></div>` : ""}<div><dt>Catalogue no.</dt><dd>${e(a.id)}</dd></div></dl><div class="painting-purchase">${!preview && a.availability === "sold" ? '<p class="painting-availability">Sold</p>' : ""}<p class="painting-price">${preview ? "Price to be confirmed" : e(price(a))}</p><p class="secondary">${preview ? "Availability awaiting review" : a.availability === "available" ? "Enquire for delivery and framing details." : a.availability === "sold" ? "This work is in a private collection." : "Please get in touch for availability updates."}</p><a class="button" href="${e(email)}">${a.availability === "sold" && !preview ? "Enquire about similar works" : "Enquire about this painting"} <span aria-hidden="true">↗</span></a></div></div></article>${related.length ? `<section class="related-works"><div class="section-heading"><h2>${group ? `More from ${e(group.name)}` : "Other works"}</h2><a href="/works" class="text-link">Explore the catalogue ↗</a></div><div class="works-grid">${related.map((w) => artworkCard(w, series, preview)).join("")}</div></section>` : ""}`;
  return c.html(
    layout(a.title, content, {
      active: "works",
      preview,
      description: a.description || undefined,
      image: a.images[0]?.url,
      path: `/works/${a.slug}`,
    }),
  );
});
app.get("/series", async (c) => {
  const { artworks, series, preview } = await catalogue(c.env);
  const populated = series.filter((s) =>
    artworks.some((a) => a.seriesId === s.id),
  );
  const content = `<section class="page-heading"><h1>Series</h1><p>Paintings connected by a shared idea, subject, or story.</p></section><div class="series-grid">${populated
    .map((s) => {
      const works = artworks.filter((a) => a.seriesId === s.id);
      const cover = works.find((a) => a.id === s.coverArtworkId) || works[0];
      return `<article><a class="series-image" href="/series/${e(s.slug)}">${image(cover)}</a><div class="series-caption"><h2><a href="/series/${e(s.slug)}">${e(s.name)}</a></h2><span>${works.length} works</span></div><p>${e(s.description)}</p></article>`;
    })
    .join(
      "",
    )}</div>${!populated.length ? '<section class="empty-state"><h2>The series are being catalogued.</h2><p>Each body of work will have its own introduction and selection of paintings. In the meantime, explore the complete archive.</p><a class="text-link" href="/works">View all works ↗</a></section>' : ""}`;
  return c.html(
    layout("Series", content, { active: "series", preview, path: "/series" }),
  );
});
app.get("/series/:slug", async (c) => {
  const { artworks, series, preview } = await catalogue(c.env);
  const s = series.find((s) => s.slug === c.req.param("slug"));
  if (!s) return c.notFound();
  const works = artworks.filter((a) => a.seriesId === s.id);
  return c.html(
    layout(
      s.name,
      `<a class="back-link text-link" href="/series">← All series</a><section class="page-heading series-heading"><h1>${e(s.name)}</h1><p>${e(s.description)}</p><span class="result-count">${works.length} works</span></section><div class="works-grid">${works.map((a) => artworkCard(a, series, preview)).join("")}</div>${!works.length ? '<p class="empty-state">Paintings in this series will appear here once published.</p>' : ""}`,
      { active: "series", preview, path: `/series/${s.slug}` },
    ),
  );
});
app.get("/about", (c) =>
  c.html(
    layout(
      "About the artist",
      `<section class="page-heading"><h1>Sharmila Sharma</h1><p>Contemporary Artist</p></section><div class="about-layout"><img class="artist-portrait" src="/artist.webp" alt="Sharmila Sharma" width="720" height="861"><div class="prose"><p>Sharmila Sharma is a Delhi-based contemporary artist with over 25 years of experience in the field of visual arts. She holds a Bachelor’s degree and a Master’s degree in Painting from Jiwaji University, Gwalior, and a <strong>Five-Year National Diploma in Fine Arts (Painting)</strong> from the Madhya Pradesh Board of Technical Education, Bhopal.</p><p>Her artistic practice explores diverse themes through acrylics, watercolours and mixed media. She enjoys working in series, blending creativity, vibrant colours and emotions to express stories through her art. Her works have been showcased in several prestigious national and group exhibitions.</p><a href="/works" class="text-link">Explore the paintings ↗</a></div></div>`,
      { active: "about", path: "/about" },
    ),
  ),
);
app.get("/contact", (c) =>
  c.html(
    layout(
      "Contact",
      `<section class="page-heading"><h1>Contact Sharmila</h1><p>For enquiries about original works, availability, or further photographs.</p></section><section class="contact-layout"><div><h2>Write to Sharmila</h2><a class="contact-email" href="mailto:sharmila.sharma31@gmail.com">sharmila.sharma31@gmail.com ↗</a><p>Please include the painting’s title or catalogue number if you have a particular work in mind.</p></div><div><h2>Follow the studio</h2><a href="https://www.instagram.com/sharmila.sharma31/" target="_blank" rel="noopener noreferrer">Instagram ↗</a><p>See more from the artist’s practice.</p></div></section>`,
      { active: "contact", path: "/contact" },
    ),
  ),
);
app.get("/studio", (c) => c.redirect(c.env.STUDIO_URL));
app.get("/gallery", (c) => c.redirect("/works", 301));
app.get("/gallery/*", (c) => c.redirect("/works", 301));
app.get("/robots.txt", (c) =>
  c.text(
    `User-agent: *\nDisallow: /studio\n${c.env.CATALOGUE.preview ? "Disallow: /\n" : "Sitemap: https://sharmila.me/sitemap.xml\n"}`,
  ),
);
app.get("/sitemap.xml", async (c) => {
  const { artworks, series, preview } = await catalogue(c.env);
  const paths = preview
    ? []
    : [
        "/",
        "/works",
        "/series",
        "/about",
        "/contact",
        ...artworks.map((a) => `/works/${a.slug}`),
        ...series.map((s) => `/series/${s.slug}`),
      ];
  c.header("Content-Type", "application/xml");
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>https://sharmila.me${e(p)}</loc></url>`).join("")}</urlset>`,
  );
});
app.notFound((c) =>
  c.html(
    layout(
      "Page not found",
      '<section class="empty-state"><h1>A different direction.</h1><p>We could not find that page.</p><a class="text-link" href="/works">Explore the paintings ↗</a></section>',
    ),
    404,
  ),
);
app.onError((error, c) => {
  console.error("Request failed", error.message);
  return c.html(
    layout(
      "Temporarily unavailable",
      '<section class="empty-state"><h1>The catalogue is resting.</h1><p>Please try again shortly, or <a href="mailto:sharmila.sharma31@gmail.com">contact Sharmila directly</a>.</p></section>',
    ),
    503,
  );
});
export default app;
