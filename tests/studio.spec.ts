import { test, expect, devices, type Page } from "@playwright/test";
import { layout, studioMarkup } from "../src/views";

test.use({
  ...devices["Pixel 7"],
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  },
});

async function studio(page: Page) {
  let email = "artist@example.test";
  let authenticated = true;
  let artwork: Record<string, any> | null = null;
  let rebuild: Record<string, any> = { status: "queued" };
  const writes: Record<string, any>[] = [];
  await page.context().route("http://studio.test/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/studio")
      return route.fulfill({
        contentType: "text/html",
        body: layout("Studio", studioMarkup(), { studio: true }),
      });
    if (path === "/cdn-cgi/access/logout")
      return route.fulfill({ contentType: "text/html", body: "Signed out" });
    if (!path.startsWith("/api/"))
      return route.fulfill({ path: `public${path}` });
    let data;
    if (path === "/api/session") {
      if (request.method() === "DELETE") authenticated = false;
      if (request.method() === "POST") authenticated = true;
      data = { authenticated, email };
    } else if (path === "/api/studio/artworks" && request.method() === "GET") {
      data = { artworks: artwork ? [artwork] : [], series: [] };
    } else if (path === "/api/studio/rebuild") {
      data = { siteUpdate: rebuild };
    } else if (path === "/api/studio/images") {
      data = {
        image: {
          key: "sharmila/test.webp",
          url: "http://studio.test/mark.svg",
          alt: "A detail photograph",
          width: 3,
          height: 5,
        },
      };
    } else if (["POST", "PUT"].includes(request.method())) {
      const saved = request.postDataJSON().artwork;
      writes.push(saved);
      artwork = { ...saved, id: "painting", slug: "painting", version: 1 };
      data = { artwork };
    } else if (artwork) {
      data = { artwork, published: false, hasDraft: true };
    } else return route.fulfill({ status: 404, json: { error: "Not found" } });
    return route.fulfill({ json: data });
  });
  await page.goto("http://studio.test/studio");
  await expect(page.locator("#studio-list")).toBeVisible();
  return {
    writes,
    setEmail: (value: string) => (email = value),
    expire: () => (authenticated = false),
    setArtwork: (value: Record<string, any>) => (artwork = value),
    setRebuild: (value: Record<string, any>) => (rebuild = value),
  };
}

test("recovers unsaved painting fields after reload and clears recovery after saving", async ({
  page: initialPage,
}) => {
  let page = initialPage;
  const server = await studio(page);
  await page.locator("#add-painting").click();
  await page
    .getByLabel("Painting title", { exact: true })
    .fill("Birds at dusk");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Blue wings\nAbove the river ");
  await page.locator("#art-price-mode").selectOption("listed");
  await page.locator("#art-price").fill("12345");
  await page.locator("#art-featured").check();
  const photo = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 3;
    canvas.height = 5;
    canvas.getContext("2d")!.fillRect(0, 0, 3, 5);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#photo-input").setInputFiles({
    name: "painting.png",
    mimeType: "image/png",
    buffer: Buffer.from(photo, "base64"),
  });
  await expect(page.locator("#upload-progress")).toContainText(
    "Photographs uploaded",
  );
  // Simulate a killed renderer: no unload handler can rescue in-memory edits.
  const cdp = await page.context().newCDPSession(page);
  const crashed = page.waitForEvent("crash");
  void cdp.send("Page.crash").catch(() => {});
  await crashed;
  const context = page.context();
  await page.close();
  page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("http://studio.test/studio");
  await expect(page.locator("#studio-editor")).toBeVisible();
  await expect(page.locator("#art-title")).toHaveValue("Birds at dusk");
  await expect(page.locator("#art-description")).toHaveValue(
    "Blue wings\nAbove the river ",
  );
  await expect(page.locator("#art-price")).toHaveValue("12345");
  await expect(page.locator("#art-featured")).toBeChecked();
  await expect(page.locator("#editor-images img")).toHaveAttribute(
    "alt",
    "A detail photograph",
  );
  expect(server.writes).toHaveLength(0);
  await page.locator("#save-draft").click();
  await expect(page.locator("#save-state")).toHaveText(
    "Draft saved successfully.",
  );
  expect(server.writes).toHaveLength(1);
  expect(server.writes[0].description).toBe("Blue wings\nAbove the river");
  expect(server.writes[0].images[0].key).toBe("sharmila/test.webp");
  await page.reload();
  await expect(page.locator("#studio-list")).toBeVisible();
});

test("restores only for the same signed-in artist, including after session expiry", async ({
  page,
}) => {
  const server = await studio(page);
  await page.locator("#add-painting").click();
  await page.locator("#art-title").fill("Private work in progress");
  page.on("dialog", (dialog) => dialog.accept());
  server.expire();
  await page.reload();
  await expect(page.locator("#studio-login")).toBeVisible();
  await expect(page.locator("#art-title")).toHaveValue("");
  await page.locator("#password").fill("local-test-only");
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator("#art-title")).toHaveValue(
    "Private work in progress",
  );
  server.setEmail("someone-else@example.test");
  await page.reload();
  await expect(page.locator("#studio-list")).toBeVisible();
  await expect(page.locator("#art-title")).toHaveValue("");
  server.setEmail("artist@example.test");
  await page.reload();
  await expect(page.locator("#art-title")).toHaveValue(
    "Private work in progress",
  );
  await page.locator("#back-to-inventory").click();
  await page.locator("#sign-out").click();
  await expect(page).toHaveURL(/logout/);
  await page.goto("http://studio.test/studio");
  await page.locator("#password").fill("local-test-only");
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator("#studio-list")).toBeVisible();
});

test("discarded edits do not return, and newer server edits require confirmation", async ({
  page,
}) => {
  const server = await studio(page);
  await page.locator("#add-painting").click();
  await page.locator("#art-title").fill("Discard this");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#back-to-inventory").click();
  await page.reload();
  await expect(page.locator("#studio-list")).toBeVisible();
  await page.locator("#add-painting").click();
  await page.locator("#art-title").fill("Original draft");
  await page.locator("#save-draft").click();
  await expect(page.locator("#save-state")).toHaveText(
    "Draft saved successfully.",
  );
  await page.locator("#art-title").fill("Unsaved local edit");
  server.setArtwork({
    ...server.writes[0],
    id: "painting",
    version: 2,
    title: "Newer server edit",
  });
  // Accept leaving, but decline replacing the newer server draft on recovery.
  page.on("dialog", (dialog) =>
    dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss(),
  );
  await page.reload();
  await expect(page.locator("#art-title")).toHaveValue("Newer server edit");
  expect(server.writes).toHaveLength(1);
});

test("Update website explains a rejected token and an unconfirmed timeout without changing inventory", async ({
  page,
}) => {
  const server = await studio(page);
  server.setRebuild({ status: "failed", httpStatus: 401 });
  await page.locator("#update-website").click();
  await expect(page.locator("#studio-message")).toContainText(
    "GitHub rejected the publishing token (HTTP 401)",
  );
  server.setRebuild({ status: "failed", reason: "timeout" });
  await page.locator("#update-website").click();
  await expect(page.locator("#studio-message")).toContainText(
    "It may still have started; check GitHub Actions before retrying",
  );
  expect(server.writes).toHaveLength(0);
});
