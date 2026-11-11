import { describe, expect, it } from "vitest";
import website from "../src/site";
import { artworkCard, price, type Artwork } from "../src/views";

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
