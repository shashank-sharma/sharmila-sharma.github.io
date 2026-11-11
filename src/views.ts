import type { Artwork, Series } from "./api";
export type { Artwork, Series } from "./api";
export const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
export const price = (a: Artwork) =>
  a.priceMode === "listed" && a.price !== null
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(a.price)
    : a.availability === "sold"
      ? "Sold"
      : a.availability === "reserved"
        ? "Reserved"
        : "Price on request";
export const image = (a: Artwork, className = "", eager = false) => {
  const original = a.images[0];
  if (!original)
    return '<div class="image-placeholder">Photograph to follow</div>';
  return `<img class="${className}" src="${escape(original.url)}" alt="${escape(original.alt || a.title)}" width="${original.width}" height="${original.height}" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
};
export function artworkCard(a: Artwork, _series: Series[], preview: boolean) {
  const soldBanner =
    !preview && a.availability === "sold"
      ? '<span class="work-sold-banner">Sold</span>'
      : "";
  return `<article class="work" data-series="${escape(a.seriesId || "standalone")}" data-availability="${preview ? "unconfirmed" : escape(a.availability)}"><a class="work-image" href="/works/${escape(a.slug)}">${image(a)}${soldBanner}</a><div class="work-caption"><div><a class="work-title" href="/works/${escape(a.slug)}">${escape(a.title || a.id)}</a><p>${escape(preview ? "From the studio archive" : [a.medium, a.year].filter(Boolean).join(", "))}</p></div><span class="work-status">${preview ? escape(a.id) : escape(a.availability === "sold" ? "Sold" : a.availability === "reserved" ? "Reserved" : "")}</span></div></article>`;
}
export function layout(
  title: string,
  content: string,
  options: {
    active?: string;
    preview?: boolean;
    studio?: boolean;
    description?: string;
    image?: string;
    path?: string;
  } = {},
) {
  const e = escape;
  const nav = ["Works", "Series", "About", "Contact"]
    .map(
      (n) =>
        `<a href="/${n.toLowerCase()}" ${options.active === n.toLowerCase() ? 'aria-current="page"' : ""}>${n}</a>`,
    )
    .join("");
  const description =
    options.description ||
    "Paintings and selected works by Sharmila Sharma. Explore the catalogue, discover series and enquire about an original work.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)}${title === "Sharmila Sharma" ? "" : " — Sharmila Sharma"}</title><meta name="description" content="${e(description)}"><meta name="theme-color" content="#f1f1f1"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:type" content="website">${options.image ? `<meta property="og:image" content="${e(options.image)}">` : ""}${options.preview || options.studio ? '<meta name="robots" content="noindex,nofollow">' : `<link rel="canonical" href="https://sharmila.me${e(options.path || "/")}">`}<link rel="icon" type="image/svg+xml" href="/mark.svg">${options.studio ? '<link rel="manifest" href="/manifest.webmanifest">' : ""}<link rel="stylesheet" href="/style.css"><script src="/site.js" defer></script>${options.studio ? '<script src="/studio.js" defer></script>' : ""}</head><body${options.studio ? ' class="studio-page"' : ""}><a class="skip-link" href="#main">Skip to content</a>${options.preview ? '<div class="preview-note">Local preview <span>No archive paintings are imported</span></div>' : ""}<div class="shell"><header class="site-header"><a class="wordmark" href="/">Sharmila Sharma</a><nav aria-label="Main navigation">${nav}${options.studio ? '<a href="/studio" aria-current="page">Studio</a>' : ""}</nav></header><main id="main">${content}</main><footer class="site-footer"><p>© ${new Date().getFullYear()} Sharmila Sharma</p><div><a href="mailto:sharmila.sharma31@gmail.com">Email</a><a href="https://www.instagram.com/sharmila.sharma31/" target="_blank" rel="noopener noreferrer">Instagram</a>${options.studio ? '<a href="/studio">Studio</a>' : ""}</div></footer></div><dialog id="image-viewer" aria-label="Painting image viewer"><div class="viewer-toolbar"><span>Use your browser’s zoom to see the details</span><button type="button" id="close-viewer" aria-label="Close image viewer">Close <span aria-hidden="true">×</span></button></div><img id="viewer-image" alt=""></dialog></body></html>`;
}
export function studioMarkup() {
  return /* HTML */ `
    <section class="page-heading studio-heading">
      <div>
        <h1>Studio</h1>
        <p>Add, edit and organise your paintings.</p>
      </div>
      <a href="/" class="text-link">View website ↗</a>
    </section>
    <p
      id="studio-message"
      class="notice"
      role="status"
      aria-live="polite"
      hidden
    ></p>
    <section id="studio-login" class="login-panel" hidden>
      <h2>Welcome to your studio.</h2>
      <p>
        Sign in to manage your paintings. Your changes stay private until you
        publish them.
      </p>
      <form id="login-form">
        <label for="password">Studio password</label
        ><input
          id="password"
          type="password"
          name="password"
          autocomplete="current-password"
          required
        /><button class="button" type="submit">Sign in</button>
      </form>
    </section>
    <section id="studio-list" hidden>
      <div class="studio-actions" role="group" aria-label="Inventory actions">
        <button class="text-button" id="manage-series">Manage series</button
        ><button class="text-button" id="manage-images">Image library</button
        ><button class="text-button" id="update-website">Update website</button
        ><a href="/api/studio/export" download="sharmila-inventory.json"
          >Export inventory</a
        ><button class="text-button" id="sign-out">Sign out</button>
      </div>
      <div class="studio-toolbar">
        <label class="search-label"
          ><span class="sr-only">Search paintings</span
          ><input
            id="studio-search"
            type="search"
            placeholder="Find a painting by title or number…" /></label
        ><button class="button" id="add-painting">
          Add painting <span aria-hidden="true">+</span>
        </button>
      </div>
      <div class="studio-tabs" role="group" aria-label="Filter paintings">
        <button data-filter="all" aria-pressed="true">All paintings</button
        ><button data-filter="draft" aria-pressed="false">Drafts</button
        ><button data-filter="published" aria-pressed="false">Published</button
        ><button data-filter="sold" aria-pressed="false">Sold</button>
      </div>
      <div id="inventory" class="inventory-list"></div>
    </section>
    <section id="studio-editor" hidden>
      <button class="text-button back-link" id="back-to-inventory">
        ← All paintings
      </button>
      <div class="editor-heading">
        <div>
          <p id="editor-id">New painting</p>
          <h2 id="editor-heading">Add a painting</h2>
        </div>
        <span id="editor-state" class="editor-state"
          >Draft · only you can see this</span
        >
      </div>
      <form id="artwork-form">
        <div class="editor-grid">
          <section class="editor-photos">
            <label class="upload-zone" for="photo-input"
              ><span class="upload-plus" aria-hidden="true">+</span
              ><span>Add photographs</span
              ><small
                >Choose from your phone or camera.<br />Web images are resized
                before upload.</small
              ></label
            >
            <input
              class="sr-only"
              id="photo-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
            />
            <input
              class="sr-only"
              id="replace-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
            />
            <p id="upload-progress" role="status" class="secondary"></p>
            <div id="editor-images" class="editor-images"></div>
            <p class="field-help">
              The first photograph is the cover. Add details or a framed view
              below it. Uploaded web images have a public URL; do not upload
              private photographs.
            </p>
          </section>
          <div class="editor-fields">
            <label for="art-title">Painting title</label
            ><input
              id="art-title"
              name="title"
              placeholder="Title of the painting"
              maxlength="200"
            />
            <label for="art-description">Description</label
            ><textarea
              id="art-description"
              name="description"
              rows="5"
              placeholder="A few words about this painting, in your own voice…"
            ></textarea>
            <p class="field-help">
              You can use your phone keyboard’s microphone to dictate.
            </p>
            <div class="form-row">
              <div>
                <label for="art-series">Series</label
                ><select id="art-series" name="seriesId">
                  <option value="">Standalone</option>
                </select>
              </div>
              <div>
                <label for="art-availability">Availability</label
                ><select id="art-availability" name="availability">
                  <option value="available">Available</option>
                  <option value="reserved">Reserved</option>
                  <option value="sold">Sold</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div>
                <label for="art-price-mode">Price display</label
                ><select id="art-price-mode" name="priceMode">
                  <option value="request">Price on request</option>
                  <option value="listed">Show price</option>
                </select>
              </div>
              <div>
                <label for="art-price">Price (₹ INR)</label
                ><input
                  id="art-price"
                  name="price"
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  placeholder="e.g. 25000"
                />
              </div>
            </div>
            <label for="art-medium">Medium</label
            ><input
              id="art-medium"
              name="medium"
              placeholder="e.g. Acrylic on canvas"
              maxlength="200"
            />
            <div class="form-row dimensions">
              <div>
                <label for="art-height">Height</label
                ><input
                  id="art-height"
                  name="height"
                  type="number"
                  min="0.1"
                  step="0.1"
                  inputmode="decimal"
                />
              </div>
              <div>
                <label for="art-width">Width</label
                ><input
                  id="art-width"
                  name="width"
                  type="number"
                  min="0.1"
                  step="0.1"
                  inputmode="decimal"
                />
              </div>
              <div>
                <label for="art-unit">Unit</label
                ><select id="art-unit" name="unit">
                  <option value="cm">cm</option>
                  <option value="in">inches</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div>
                <label for="art-year">Year (optional)</label
                ><input
                  id="art-year"
                  name="year"
                  type="number"
                  min="1900"
                  max="2100"
                  inputmode="numeric"
                />
              </div>
              <div>
                <label for="art-order">Catalogue order</label
                ><input
                  id="art-order"
                  name="sortOrder"
                  type="number"
                  min="0"
                  step="1"
                />
              </div>
            </div>
            <label class="checkbox-label"
              ><input id="art-featured" name="featured" type="checkbox" />
              Feature on the homepage</label
            >
          </div>
        </div>
        <div class="editor-actions">
          <p id="save-state">
            Changes are not published until you choose Publish.
          </p>
          <div>
            <button
              type="button"
              class="button secondary-button"
              id="preview-painting"
            >
              Preview</button
            ><button
              type="submit"
              class="button secondary-button"
              id="save-draft"
            >
              Save draft</button
            ><button type="button" class="button" id="publish-painting">
              Publish painting
            </button>
          </div>
        </div>
      </form>
      <div class="painting-management">
        <a id="view-published" class="text-link" href="/works" hidden
          >View published painting ↗</a
        ><button id="unpublish-painting" class="text-button" hidden>
          Unpublish painting</button
        ><button id="delete-painting" class="text-button danger-text" hidden>
          Delete painting permanently
        </button>
        <p class="field-help">
          Unpublish keeps the painting as a private draft. Delete is permanent;
          there is no Trash or version history. Unused uploaded photographs can
          be deleted separately in Image library.
        </p>
      </div>
    </section>
    <dialog
      id="painting-preview"
      class="preview-dialog"
      aria-label="Painting preview"
    >
      <button class="text-button dialog-close" id="close-preview">
        Close preview ×
      </button>
      <div id="preview-content"></div>
      <p class="notice">
        Preview only. This painting has not been published by opening this
        preview.
      </p>
    </dialog>
    <dialog id="series-dialog" class="series-dialog" aria-label="Manage series">
      <button class="text-button dialog-close" id="close-series">
        Close ×
      </button>
      <h2>Your series</h2>
      <div id="series-list"></div>
      <form id="series-form">
        <input type="hidden" name="id" /><label for="series-name"
          >Series name</label
        ><input id="series-name" name="name" required maxlength="100" /><label
          for="series-description"
          >Introduction</label
        ><textarea
          id="series-description"
          name="description"
          rows="3"
        ></textarea
        ><button class="button" type="submit">Save series</button>
      </form>
      <p id="series-save-state" role="status" class="field-help"></p>
    </dialog>
    <dialog
      id="library-dialog"
      class="library-dialog"
      aria-label="Image library"
    >
      <button class="text-button dialog-close" id="close-library">
        Close ×
      </button>
      <h2>Image library</h2>
      <p class="field-help">
        Painting uploads and website photos are stored in separate folders.
        Images used by paintings or saved versions cannot be permanently
        deleted.
      </p>
      <div id="image-library"></div>
    </dialog>
  `;
}
