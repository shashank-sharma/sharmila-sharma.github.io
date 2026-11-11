import { test, expect } from "@playwright/test";
import website, { type Catalogue } from "../src/site";
import type { Artwork } from "../src/views";

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  },
});

const artworks: Artwork[] = [
  null,
  "others",
  "missing",
  "school",
  "puppet",
  "school",
  "puppet",
].map((seriesId, index) => ({
  id: `painting-${index}`,
  slug: `painting-${index}`,
  title: `Painting ${index} & friends`,
  description: "",
  price: null,
  currency: "INR",
  priceMode: "request",
  medium: index % 2 ? "Acrylic" : "Watercolour",
  width: 100,
  height: 80,
  unit: "cm",
  year: 2020 + index,
  availability: "available",
  seriesId,
  sortOrder: index,
  featured: index < 2,
  images: [
    {
      key: `${index}.svg`,
      url: `http://home.test/${index}.svg`,
      alt: `Photo ${index}`,
      width: 100,
      height: 80,
    },
  ],
  version: 1,
}));
const catalogue: Catalogue = {
  artworks,
  series: ["school", "puppet"].map((id) => ({
    id,
    slug: id,
    name: id,
    description: "",
    sortOrder: 0,
    coverArtworkId: null,
  })),
  preview: false,
};

test("chooses a named-series hero on each load of the same static homepage", async ({
  page,
}) => {
  // Render once, as GitHub Pages does: randomness must run in the visitor's browser.
  const html = await (
    await website.request(
      "http://home.test/",
      {},
      {
        CATALOGUE: catalogue,
        STUDIO_URL: "https://studio.test",
      },
    )
  ).text();
  await page.route("http://home.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/")
      return route.fulfill({ contentType: "text/html", body: html });
    if (path.endsWith(".svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"/>',
      });
    return route.fulfill({ path: `public${path}` });
  });
  await page.addInitScript(() => {
    Math.random = () => Number(sessionStorage.getItem("random") || "0");
  });
  await page.goto("http://home.test/");
  for (const [random, index] of [
    [0, 3],
    [0.25, 4],
    [0.5, 5],
    [0.999999, 6],
  ]) {
    await page.evaluate(
      (value) => sessionStorage.setItem("random", String(value)),
      random,
    );
    await page.reload();
    const hero = page.locator(".hero-work");
    await expect(hero).toHaveCount(1);
    await expect(hero.locator("a").first()).toHaveAttribute(
      "href",
      `/works/painting-${index}`,
    );
    await expect(hero.locator("a").first()).toHaveAttribute(
      "aria-label",
      `View Painting ${index} & friends`,
    );
    await expect(hero.locator("figcaption")).toContainText(
      `Painting ${index} & friends`,
    );
    await expect(hero.locator("figcaption")).toContainText(
      `${artworks[index].medium}, ${2020 + index}`,
    );
    await expect(hero.locator("figcaption a")).toHaveAttribute(
      "href",
      `/works/painting-${index}`,
    );
    await expect(hero.locator("img")).toHaveAttribute(
      "src",
      `http://home.test/${index}.svg`,
    );
    await expect(hero.locator("img")).toHaveAttribute("alt", `Photo ${index}`);
    await expect(page.locator(".selected-section .work-title")).toHaveText([
      "Painting 1 & friends",
    ]);
  }
});

test("does not fall back to Others when no named-series paintings exist", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://home.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") {
      const response = await website.request(
        "http://home.test/",
        {},
        {
          CATALOGUE: { ...catalogue, artworks: artworks.slice(0, 3) },
          STUDIO_URL: "https://studio.test",
        },
      );
      return route.fulfill({
        contentType: "text/html",
        body: await response.text(),
      });
    }
    if (path.endsWith(".svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      });
    return route.fulfill({ path: `public${path}` });
  });
  await page.goto("http://home.test/");
  await expect(page.locator(".hero-work")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Selected works" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
