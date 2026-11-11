import { describe, expect, it } from "vitest";
import website from "../src/site";
import { artworkCard, layout, price, type Artwork } from "../src/views";

const artwork = {
  id: "painting-1",
  slug: "painting-1",
  title: "A sold painting",
  description: "",
  price: null,
  currency: "INR",
  priceMode: "request",
  medium: "Acrylic",
  width: 100,
  height: 100,
  unit: "cm",
  year: 2026,
  availability: "sold",
  seriesId: null,
  sortOrder: 0,
  featured: false,
  images: [
    {
      key: "painting.webp",
      url: "https://example.com/painting.webp",
      alt: "A sold painting",
      width: 1200,
      height: 1200,
    },
  ],
  version: 1,
} satisfies Artwork;

describe("artworkCard", () => {
  it("adds a sold banner without rendering the series name", () => {
    const card = artworkCard(
      artwork,
      [{ id: "puppet", name: "Puppet" }],
      false,
    );
    expect(card).toContain('<span class="work-sold-banner">Sold</span>');
    expect(card).not.toContain("Puppet");
    expect(artworkCard(artwork, [], true)).not.toContain("work-sold-banner");
    expect(
      artworkCard({ ...artwork, availability: "available" }, [], false),
    ).not.toContain("work-sold-banner");
  });

  it("keeps a listed price visible for sold paintings", () => {
    expect(price({ ...artwork, priceMode: "listed", price: 25000 })).toBe(
      "₹25,000",
    );
  });

  it("shows sold status alongside the listed price on a painting page", async () => {
    const response = await website.request(
      "https://catalogue.test/works/painting-1",
      {},
      {
        CATALOGUE: {
          artworks: [{ ...artwork, priceMode: "listed", price: 25000 }],
          series: [],
          preview: false,
        },
        STUDIO_URL: "https://studio.test",
      },
    );
    const html = await response.text();
    expect(html).toContain('<p class="painting-availability">Sold</p>');
    expect(html).toContain('<p class="painting-price">₹25,000</p>');
  });
});

describe("analytics", () => {
  it("tracks the public site but not the private Studio or preview", () => {
    expect(layout("Sharmila Sharma", "")).toContain(
      '<script defer data-domain="sharmila.me" src="https://plausible.io/js/script.js"></script>',
    );
    expect(layout("Studio", "", { studio: true })).not.toContain("plausible.io");
    expect(layout("Preview", "", { preview: true })).not.toContain("plausible.io");
  });
});

describe("Others series", () => {
  const namedSeries = [
    {
      id: "school",
      slug: "school",
      name: "School",
      description: "",
      sortOrder: -10,
      coverArtworkId: null,
    },
    {
      id: "puppet",
      slug: "puppet",
      name: "Puppet",
      description: "",
      sortOrder: 999,
      coverArtworkId: null,
    },
  ];
  const bindings = {
    CATALOGUE: {
      artworks: [
        artwork,
        {
          ...artwork,
          id: "school-work",
          slug: "school-work",
          title: "School work",
          seriesId: "school",
        },
        {
          ...artwork,
          id: "other-work",
          slug: "other-work",
          title: "Another painting",
          availability: "available" as const,
        },
        {
          ...artwork,
          id: "puppet-work",
          slug: "puppet-work",
          title: "Puppet work",
          seriesId: "puppet",
        },
      ],
      series: namedSeries,
      preview: false,
    },
    STUDIO_URL: "https://studio.test",
  };

  it("lists Others last and includes only unassigned paintings on its page", async () => {
    const index = await (
      await website.request("https://catalogue.test/series", {}, bindings)
    ).text();
    expect(
      [...index.matchAll(/<h2><a href="\/series\/([^"]+)">/g)].map(
        (match) => match[1],
      ),
    ).toEqual(["school", "puppet", "others"]);
    const response = await website.request(
      "https://catalogue.test/series/others",
      {},
      bindings,
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<h1>Others</h1>");
    expect(html).toContain("2 works");
    expect(html).toContain('href="/works/painting-1"');
    expect(html).toContain('href="/works/other-work"');
    expect(html).not.toContain('href="/works/school-work"');
    expect(html).not.toContain('href="/works/puppet-work"');
    const named = await (
      await website.request(
        "https://catalogue.test/series/school",
        {},
        bindings,
      )
    ).text();
    expect(named).toContain('href="/works/school-work"');
    expect(named).not.toContain('href="/works/other-work"');
  });

  it("uses Others in filters, painting navigation and the sitemap without changing inventory", async () => {
    const works = await (
      await website.request("https://catalogue.test/works", {}, bindings)
    ).text();
    expect(works).toContain('href="/works?series=others">Others</a>');
    expect(works).toContain('data-series="others"');
    expect(works).not.toContain("Standalone");
    const detail = await (
      await website.request(
        "https://catalogue.test/works/painting-1",
        {},
        bindings,
      )
    ).text();
    expect(detail).toContain('href="/series/others">← Others</a>');
    const sitemap = await (
      await website.request("https://catalogue.test/sitemap.xml", {}, bindings)
    ).text();
    expect(sitemap).toContain("https://sharmila.me/series/others");
    expect(bindings.CATALOGUE.artworks[0].seriesId).toBeNull();
    expect(bindings.CATALOGUE.series).toHaveLength(2);
  });

  it("hides an empty Others group but keeps its page available for static builds", async () => {
    const empty = {
      ...bindings,
      CATALOGUE: { ...bindings.CATALOGUE, artworks: [] },
    };
    const index = await (
      await website.request("https://catalogue.test/series", {}, empty)
    ).text();
    expect(index).not.toContain('href="/series/others"');
    const response = await website.request(
      "https://catalogue.test/series/others",
      {},
      empty,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      "Paintings in this series will appear here once published.",
    );
  });
});
