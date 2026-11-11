{
  const heroPool = document.getElementById("home-hero-pool");
  if (heroPool) {
    const paintings = heroPool.content.children;
    const chosen = paintings[Math.floor(Math.random() * paintings.length)];
    document.querySelector(".hero-work").replaceWith(chosen.cloneNode(true));
  }

  const viewer = document.getElementById("image-viewer");
  const target = document.getElementById("viewer-image");
  document.querySelectorAll("[data-enlarge]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!button.dataset.enlarge) return;
      target.src = button.dataset.enlarge;
      target.alt = button.dataset.alt || "";
      viewer.showModal();
      document.body.classList.add("dialog-open");
    }),
  );
  document
    .getElementById("close-viewer")
    ?.addEventListener("click", () => viewer.close());
  viewer?.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
  viewer?.addEventListener("close", () => {
    document.body.classList.remove("dialog-open");
    target.removeAttribute("src");
  });

  const filters = document.querySelector(".catalogue-filters");
  if (filters) {
    const cards = [...document.querySelectorAll(".catalogue-grid .work")];
    const links = [...filters.querySelectorAll(".filter-links a")];
    const available = filters.querySelector('[name="availability"]');
    const count = document.querySelector(".result-count");
    const archive = Boolean(document.querySelector(".preview-note"));
    function applyFilters() {
      const query = new URLSearchParams(location.search);
      // Keep bookmarked links to the former Standalone selection working.
      const selection = query.get("series") || "";
      const series = selection === "standalone" ? "others" : selection;
      available.checked = query.get("availability") === "available";
      let visible = 0;
      cards.forEach((card) => {
        card.hidden =
          (series && card.dataset.series !== series) ||
          (available.checked && card.dataset.availability !== "available");
        if (!card.hidden) visible++;
      });
      links.forEach((link) => {
        const url = new URL(link.href);
        const selected = (url.searchParams.get("series") || "") === series;
        if (selected) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
        if (available.checked)
          url.searchParams.set("availability", "available");
        else url.searchParams.delete("availability");
        link.href = url.pathname + url.search;
      });
      count.textContent = `${visible} ${visible === 1 ? "work" : "works"}${archive ? " from the archive" : ""}`;
      const empty = document.getElementById("catalogue-empty");
      if (empty) empty.hidden = visible !== 0;
    }
    links.forEach((link) =>
      link.addEventListener("click", (event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        history.pushState(null, "", link.href);
        applyFilters();
      }),
    );
    filters.addEventListener("submit", (event) => {
      event.preventDefault();
      const url = new URL(location.href);
      if (available.checked) url.searchParams.set("availability", "available");
      else url.searchParams.delete("availability");
      history.pushState(null, "", url);
      applyFilters();
    });
    addEventListener("popstate", applyFilters);
    applyFilters();
  }
}
