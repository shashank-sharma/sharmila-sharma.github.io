{
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const state = {
    artworks: [],
    series: [],
    current: null,
    filter: "all",
    dirty: false,
    uploading: false,
    busy: false,
    history: [],
    replaceIndex: null,
    library: [],
    email: null,
  };
  function message(text, error = false) {
    $("studio-message").textContent = text;
    $("studio-message").classList.toggle("error", error);
    $("studio-message").hidden = !text;
  }
  async function request(path, options = {}) {
    const response = await fetch("/api" + path, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        $("studio-list").hidden = true;
        $("studio-editor").hidden = true;
        $("studio-login").hidden = false;
      }
      const detail =
        data.error ||
        data.message ||
        "The change could not be saved. Please try again.";
      throw new Error(
        typeof detail === "string" ? detail : JSON.stringify(detail),
      );
    }
    return data;
  }
  function siteUpdateMessage(data) {
    if (!data.siteUpdate) return "";
    if (data.siteUpdate.status === "queued")
      return " Website rebuild queued. GitHub Pages will update after the build finishes, usually in a few minutes.";
    if (data.siteUpdate.status === "not-configured")
      return " Saved to inventory. Website publishing has not been configured yet.";
    return " Saved to inventory, but the website rebuild could not be confirmed. Use ‘Update website’ in the inventory to try again.";
  }
  function show(name) {
    ["studio-login", "studio-list", "studio-editor"].forEach(
      (id) => ($(id).hidden = id !== name),
    );
  }
  async function loadInventory() {
    const data = await request("/studio/artworks");
    state.artworks = data.artworks;
    state.series = data.series;
    renderInventory();
    show("studio-list");
  }
  function renderInventory() {
    const query = $("studio-search").value.toLowerCase();
    const works = state.artworks.filter(
      (a) =>
        `${a.title} ${a.id}`.toLowerCase().includes(query) &&
        (state.filter === "trash" ? a.trashed : !a.trashed) &&
        (state.filter === "all" ||
          state.filter === "trash" ||
          (state.filter === "draft" && (!a.published || a.hasDraft)) ||
          (state.filter === "published" && a.published) ||
          (state.filter === "sold" && a.availability === "sold")),
    );
    $("inventory").innerHTML = works.length
      ? works
          .map(
            (a) =>
              `<article class="inventory-row">${a.images[0] ? `<img src="${esc(a.images[0].url)}" alt="${esc(a.title)}" loading="lazy">` : '<div class="image-placeholder">No photo</div>'}<div class="inventory-meta"><h3>${esc(a.title || "Untitled painting")}</h3><p>${esc(a.id)}${a.seriesId ? " / " + esc(state.series.find((s) => s.id === a.seriesId)?.name || "") : ""}</p></div><span class="row-state">${a.trashed ? "In Trash" : a.published ? (a.hasDraft ? "Unpublished changes" : a.availability === "sold" ? "Sold · published" : "Published") : "Draft"}</span>${a.trashed ? `<button type="button" class="text-button" data-undelete="${esc(a.id)}">Restore</button>` : `<button type="button" class="text-button" data-edit="${esc(a.id)}">Edit <span class="sr-only">${esc(a.title)}</span> ↗</button>`}</article>`,
          )
          .join("")
      : '<section class="empty-state"><h2>No paintings here yet.</h2><p>Add your first painting or try another filter.</p></section>';
  }
  function blankArtwork() {
    return {
      id: "",
      slug: "",
      title: "",
      description: "",
      price: null,
      currency: "INR",
      priceMode: "request",
      medium: "",
      width: null,
      height: null,
      unit: "cm",
      year: null,
      availability: "available",
      seriesId: null,
      sortOrder: 0,
      featured: false,
      images: [],
      version: 0,
    };
  }
  function populateEditor(a, data = {}) {
    state.current = a;
    state.history = data.history || [];
    state.dirty = false;
    $("artwork-form").reset();
    $("art-series").innerHTML =
      '<option value="">Standalone</option>' +
      state.series
        .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
        .join("");
    const form = $("artwork-form");
    for (const key of [
      "title",
      "description",
      "price",
      "priceMode",
      "medium",
      "width",
      "height",
      "unit",
      "year",
      "availability",
      "seriesId",
      "sortOrder",
    ])
      form.elements.namedItem(key).value = a[key] ?? "";
    $("art-featured").checked = a.featured;
    $("editor-id").textContent = a.id || "New painting";
    $("editor-heading").textContent = a.title || "Add a painting";
    $("editor-state").textContent = data.published
      ? data.hasDraft
        ? "Unpublished changes"
        : "Published"
      : "Draft · only you can see this";
    $("save-state").textContent =
      "Changes are not published until you choose Publish.";
    $("publish-painting").textContent = data.published
      ? "Publish changes"
      : "Publish painting";
    $("trash-painting").hidden = !a.id;
    $("view-published").hidden = !data.published;
    $("view-published").href = "/works/" + encodeURIComponent(a.slug);
    $("revision-section").hidden = !state.history.length;
    $("revision-list").innerHTML = state.history
      .map(
        (r) =>
          `<div class="revision-row"><span>${esc(r.action || r.kind || "Saved version")} · ${esc(r.createdAt || r.created_at || "")}</span><button type="button" class="text-button" data-restore="${esc(r.id)}">Restore as draft</button></div>`,
      )
      .join("");
    renderImages();
    updatePrice();
    show("studio-editor");
  }
  async function editPainting(id) {
    const data = await request("/studio/artworks/" + encodeURIComponent(id));
    populateEditor(data.artwork, data);
    message("");
    window.scrollTo({ top: 0 });
    $("art-title").focus({ preventScroll: true });
  }
  function readForm() {
    const f = new FormData($("artwork-form"));
    const numeric = (name) =>
      $("artwork-form").elements.namedItem(name).value === ""
        ? null
        : Number($("artwork-form").elements.namedItem(name).value);
    return {
      ...state.current,
      title: String(f.get("title")).trim(),
      description: String(f.get("description")).trim(),
      price: numeric("price"),
      priceMode: f.get("priceMode"),
      medium: String(f.get("medium")).trim(),
      height: numeric("height"),
      width: numeric("width"),
      unit: f.get("unit"),
      year: numeric("year"),
      seriesId: f.get("seriesId") || null,
      availability: f.get("availability"),
      sortOrder: numeric("sortOrder") ?? 0,
      featured: f.has("featured"),
    };
  }
  function renderImages() {
    $("editor-images").innerHTML = state.current.images
      .map(
        (im, i) =>
          `<div class="editor-image"><img src="${esc(im.url)}" alt="${esc(im.alt)}"><label for="alt-${i}">Photo description</label><input id="alt-${i}" data-alt-index="${i}" value="${esc(im.alt)}" placeholder="Describe what this photograph shows"><div class="image-actions"><span class="secondary">${i === 0 ? "Cover photograph" : "Photograph " + (i + 1)}</span><div>${i ? `<button type="button" data-cover="${i}">Make cover</button><button type="button" data-up="${i}" aria-label="Move photograph ${i + 1} earlier">Move up</button>` : ""}<button type="button" data-replace="${i}">Replace</button><button type="button" data-remove="${i}">Remove</button></div></div></div>`,
      )
      .join("");
  }
  function dirty() {
    state.dirty = true;
    $("save-state").textContent = "You have unsaved changes.";
  }
  function updatePrice() {
    const listed = $("art-price-mode").value === "listed";
    $("art-price").disabled = !listed;
  }
  async function save(publish = false) {
    if (state.busy) return;
    if (state.uploading)
      return message(
        "Please wait for your photographs to finish uploading.",
        true,
      );
    if (!$("artwork-form").reportValidity()) return;
    state.busy = true;
    $("save-draft").disabled = $("publish-painting").disabled = true;
    message("");
    try {
      const artwork = readForm();
      if (!state.current.id) {
        delete artwork.id;
        delete artwork.slug;
        delete artwork.version;
      }
      const saved = await request(
        state.current.id
          ? "/studio/artworks/" + encodeURIComponent(state.current.id)
          : "/studio/artworks",
        {
          method: state.current.id ? "PUT" : "POST",
          body: JSON.stringify({ artwork }),
        },
      );
      state.current = saved.artwork || saved;
      state.dirty = false;
      if (publish) {
        const published = await request(
          "/studio/artworks/" +
            encodeURIComponent(state.current.id) +
            "/publish",
          {
            method: "POST",
            body: JSON.stringify({ version: state.current.version }),
          },
        );
        message(
          "Painting marked for publication." + siteUpdateMessage(published),
        );
      } else message("Draft saved. The public website has not changed.");
      const data = await request(
        "/studio/artworks/" + encodeURIComponent(state.current.id),
      );
      populateEditor(data.artwork, data);
      $("save-state").textContent = publish
        ? "Published successfully."
        : "Draft saved successfully.";
    } catch (error) {
      message(error.message, true);
      $("studio-message").scrollIntoView({ block: "nearest" });
    } finally {
      state.busy = false;
      $("save-draft").disabled = $("publish-painting").disabled = false;
    }
  }
  async function optimise(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new Error(
        "Please choose a JPEG, PNG or WebP photograph. For HEIC, export a JPEG from your photo library.",
      );
    if (file.size > 40 * 1024 * 1024)
      throw new Error(
        "This photograph is too large. Please choose one smaller than 40 MB.",
      );
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas
      .getContext("2d")
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.88),
    );
    if (!blob)
      throw new Error(
        "This photograph could not be prepared. Please try a JPEG.",
      );
    return { blob, width: canvas.width, height: canvas.height };
  }
  async function uploadPhotos(event) {
    const files = Array.from(event.target.files);
    if (!files.length || state.uploading) return;
    state.uploading = true;
    try {
      for (let i = 0; i < files.length; i++) {
        $("upload-progress").textContent =
          `Preparing photograph ${i + 1} of ${files.length}…`;
        const prepared = await optimise(files[i]);
        const data = new FormData();
        data.append("file", prepared.blob, "painting.webp");
        data.append("width", String(prepared.width));
        data.append("height", String(prepared.height));
        $("upload-progress").textContent =
          `Uploading photograph ${i + 1} of ${files.length}…`;
        const result = await request("/studio/images", {
          method: "POST",
          body: data,
        });
        const uploaded = result.image || result;
        if (state.replaceIndex !== null) {
          uploaded.alt = state.current.images[state.replaceIndex].alt;
          state.current.images[state.replaceIndex] = uploaded;
        } else state.current.images.push(uploaded);
        renderImages();
        dirty();
      }
      $("upload-progress").textContent =
        "Photographs uploaded. Save your draft to keep them with this painting.";
    } catch (error) {
      message(
        error.message +
          " Your existing photographs are unchanged; choose the failed photograph again to retry.",
        true,
      );
      $("upload-progress").textContent = "Upload stopped. You can try again.";
    } finally {
      state.uploading = false;
      state.replaceIndex = null;
      event.target.value = "";
    }
  }
  $("photo-input").addEventListener("change", (event) => {
    state.replaceIndex = null;
    uploadPhotos(event);
  });
  $("replace-input").addEventListener("change", uploadPhotos);
  $("editor-images").addEventListener("input", (event) => {
    if (event.target.dataset.altIndex !== undefined) {
      state.current.images[Number(event.target.dataset.altIndex)].alt =
        event.target.value;
      dirty();
    }
  });
  $("editor-images").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    const cover = event.target.closest("[data-cover]");
    const replace = event.target.closest("[data-replace]");
    const up = event.target.closest("[data-up]");
    if (state.uploading) return;
    if (replace) {
      state.replaceIndex = Number(replace.dataset.replace);
      $("replace-input").click();
    }
    if (up) {
      const i = Number(up.dataset.up);
      [state.current.images[i - 1], state.current.images[i]] = [
        state.current.images[i],
        state.current.images[i - 1],
      ];
      renderImages();
      dirty();
    }
    if (remove) {
      state.current.images.splice(Number(remove.dataset.remove), 1);
      renderImages();
      dirty();
    }
    if (cover) {
      const [im] = state.current.images.splice(Number(cover.dataset.cover), 1);
      state.current.images.unshift(im);
      renderImages();
      dirty();
    }
  });
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await request("/session", {
        method: "POST",
        body: JSON.stringify({ password: $("password").value }),
      });
      $("password").value = "";
      message("");
      await loadInventory();
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  $("artwork-form").addEventListener("submit", (event) => {
    event.preventDefault();
    save(false);
  });
  $("artwork-form").addEventListener("input", dirty);
  $("art-price-mode").addEventListener("change", updatePrice);
  $("publish-painting").addEventListener("click", () => save(true));
  $("studio-search").addEventListener("input", renderInventory);
  document.querySelectorAll("[data-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      renderInventory();
    }),
  );
  $("inventory").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-edit]");
    const restore = event.target.closest("[data-undelete]");
    if (restore) {
      if (
        !confirm(
          "Restore this painting? Its previously published version, if any, will return to the website.",
        )
      )
        return;
      try {
        const restored = await request(
          "/studio/artworks/" +
            encodeURIComponent(restore.dataset.undelete) +
            "/undelete",
          { method: "POST" },
        );
        await loadInventory();
        message("Painting restored." + siteUpdateMessage(restored));
      } catch (error) {
        message(error.message, true);
      }
    }
    if (button)
      try {
        await editPainting(button.dataset.edit);
      } catch (error) {
        message(error.message, true);
      }
  });
  $("add-painting").addEventListener("click", () => {
    populateEditor(blankArtwork());
    message("");
    $("art-title").focus();
  });
  $("back-to-inventory").addEventListener("click", async () => {
    if (state.uploading)
      return message("Please wait until the upload finishes.", true);
    if (state.dirty && !confirm("Leave without saving your changes?")) return;
    state.dirty = false;
    message("");
    try {
      await loadInventory();
    } catch (error) {
      message(error.message, true);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty || state.uploading) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  $("sign-out").addEventListener("click", async () => {
    try {
      await request("/session", { method: "DELETE" });
      if (state.email && state.email !== "local-studio") {
        location.assign("/cdn-cgi/access/logout");
        return;
      }
      state.current = null;
      state.artworks = [];
      show("studio-login");
      message("Signed out.");
    } catch (error) {
      message(error.message, true);
    }
  });
  $("update-website").addEventListener("click", async (event) => {
    event.target.disabled = true;
    try {
      message(
        siteUpdateMessage(
          await request("/studio/rebuild", { method: "POST" }),
        ).trim(),
      );
    } catch (error) {
      message(error.message, true);
    } finally {
      event.target.disabled = false;
    }
  });
  $("preview-painting").addEventListener("click", () => {
    const a = readForm();
    const amount =
      a.availability === "sold"
        ? "Sold"
        : a.availability === "reserved"
          ? "Reserved"
          : a.priceMode === "listed" && a.price !== null
            ? new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0,
              }).format(a.price)
            : "Price on request";
    $("preview-content").innerHTML =
      `<div class="preview-content-grid"><div>${a.images[0] ? `<img src="${esc(a.images[0].url)}" alt="${esc(a.images[0].alt)}">` : "<p>No photograph yet.</p>"}</div><div><h2>${esc(a.title || "Untitled painting")}</h2><p class="secondary">${esc([a.medium, a.year].filter(Boolean).join(", "))}</p><p>${esc(a.description)}</p>${a.width && a.height ? `<p>${a.height} × ${a.width} ${esc(a.unit)} (H × W)</p>` : ""}<p class="painting-price">${esc(amount)}</p></div></div>`;
    $("painting-preview").showModal();
  });
  $("close-preview").addEventListener("click", () =>
    $("painting-preview").close(),
  );
  $("revision-list").addEventListener("click", async (event) => {
    const b = event.target.closest("[data-restore]");
    if (
      !b ||
      !confirm(
        "Restore this version as a draft? The published painting will stay unchanged.",
      )
    )
      return;
    try {
      await request(
        "/studio/artworks/" + encodeURIComponent(state.current.id) + "/restore",
        {
          method: "POST",
          body: JSON.stringify({ revisionId: b.dataset.restore }),
        },
      );
      await editPainting(state.current.id);
      message(
        "Previous version restored as a draft. Review it before publishing.",
      );
    } catch (error) {
      message(error.message, true);
    }
  });
  function renderSeries() {
    $("series-list").innerHTML = state.series
      .map(
        (s) =>
          `<div class="series-list-row"><span>${esc(s.name)}</span><button type="button" data-series-edit="${esc(s.id)}">Edit</button></div>`,
      )
      .join("");
  }
  $("manage-series").addEventListener("click", () => {
    renderSeries();
    $("series-form").reset();
    $("series-form").elements.id.value = "";
    $("series-dialog").showModal();
  });
  $("close-series").addEventListener("click", () => $("series-dialog").close());
  $("trash-painting").addEventListener("click", async () => {
    if (state.uploading || state.busy) return;
    if (
      !confirm(
        "Move this painting to Trash? It will disappear from the public catalogue. Photographs and previous versions are kept so you can restore it. Unsaved changes will be discarded.",
      )
    )
      return;
    try {
      const removed = await request(
        "/studio/artworks/" + encodeURIComponent(state.current.id),
        {
          method: "DELETE",
          body: JSON.stringify({ version: state.current.version }),
        },
      );
      state.dirty = false;
      await loadInventory();
      message(
        "Painting moved to Trash. You can restore it from the Trash tab." +
          siteUpdateMessage(removed),
      );
    } catch (error) {
      message(error.message, true);
    }
  });
  async function loadLibrary() {
    const data = await request("/studio/images");
    state.library = data.images;
    $("image-library").innerHTML = state.library.length
      ? state.library
          .map(
            (im, i) =>
              `<div class="library-row"><a href="${esc(im.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(im.url)}" alt="Uploaded photograph ${i + 1}" loading="lazy"></a><div><p>${im.key.startsWith("sharmila/site/") ? "Website photo" : "Painting photograph"}</p><span class="secondary">${im.width} × ${im.height} pixels · ${im.used ? "In use / saved history" : "Unused"}</span></div><button class="text-button danger-text" data-delete-image="${i}" ${im.used ? "disabled" : ""}>Delete permanently</button></div>`,
          )
          .join("")
      : "<p>No uploaded photographs yet. Legacy archive files are preserved separately.</p>";
  }
  $("manage-images").addEventListener("click", async () => {
    try {
      await loadLibrary();
      $("library-dialog").showModal();
    } catch (error) {
      message(error.message, true);
    }
  });
  $("close-library").addEventListener("click", () =>
    $("library-dialog").close(),
  );
  $("image-library").addEventListener("click", async (event) => {
    const b = event.target.closest("[data-delete-image]");
    if (!b) return;
    const im = state.library[Number(b.dataset.deleteImage)];
    if (
      !confirm(
        "Permanently delete this unused image file? This cannot be undone.",
      )
    )
      return;
    b.disabled = true;
    try {
      await request("/studio/images", {
        method: "DELETE",
        body: JSON.stringify({ key: im.key }),
      });
      await loadLibrary();
    } catch (error) {
      $("library-dialog").close();
      message(error.message, true);
    }
  });
  $("series-list").addEventListener("click", (event) => {
    const b = event.target.closest("[data-series-edit]");
    if (!b) return;
    const s = state.series.find((s) => s.id === b.dataset.seriesEdit);
    for (const k of ["id", "name", "description"])
      $("series-form").elements.namedItem(k).value = s[k];
    $("series-name").focus();
  });
  $("series-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = new FormData(event.target);
    const existing = state.series.find((s) => s.id === f.get("id"));
    const series = {
      ...(existing || { sortOrder: state.series.length, coverArtworkId: null }),
      name: String(f.get("name")).trim(),
      description: String(f.get("description")).trim(),
    };
    try {
      const saved = await request(
        "/studio/series" +
          (existing ? "/" + encodeURIComponent(existing.id) : ""),
        { method: existing ? "PUT" : "POST", body: JSON.stringify(series) },
      );
      const data = await request("/studio/artworks");
      state.series = data.series;
      renderSeries();
      event.target.reset();
      event.target.elements.id.value = "";
      $("series-save-state").textContent =
        "Series saved." + siteUpdateMessage(saved);
    } catch (error) {
      $("series-dialog").close();
      message(error.message, true);
    }
  });
  (async () => {
    try {
      const session = await request("/session");
      state.email = session.email || null;
      if (session.authenticated) await loadInventory();
      else show("studio-login");
    } catch (error) {
      show("studio-login");
      message(error.message, true);
    }
  })();
}
