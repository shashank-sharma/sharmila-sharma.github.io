import { describe, expect, it } from "vitest";
import { artworkCard, type Artwork } from "../src/views";

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
  it("adds a sold banner to published sold-work thumbnails only", () => {
    expect(artworkCard(artwork, [], false)).toContain(
      '<span class="work-sold-banner">Sold</span>',
    );
    expect(artworkCard(artwork, [], true)).not.toContain("work-sold-banner");
    expect(
      artworkCard({ ...artwork, availability: "available" }, [], false),
    ).not.toContain("work-sold-banner");
  });
});
