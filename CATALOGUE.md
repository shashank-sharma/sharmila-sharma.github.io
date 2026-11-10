# Sharmila Sharma catalogue

The catalogue uses a static GitHub Pages build, not Jekyll. The original theme and archive photographs remain in the repository for reference; they are not included in the deployed Pages artifact.

## Hosting

- **GitHub Pages:** generated public HTML, CSS, JavaScript and fonts. Each painting and series has its own directly accessible page, including with JavaScript disabled. JavaScript adds catalogue filters and the image viewer; visitors never query D1 or a live inventory API.
- **Cloudflare Worker:** private `/studio`, authenticated inventory API and R2 uploads. In production, public-page requests redirect to the Pages site. `CATALOGUE_PREVIEW=true` enables an orb-only design preview and must remain unset in production.
- **D1:** painting metadata, series and independent current draft/published snapshots. No previous-version history or Trash is retained. The working version number only prevents conflicting edits.
- **R2:** existing `blog` bucket, using `https://images.vipul.xyz`. New painting images use `sharmila/artworks/uploads/`. Website-only images use `sharmila/site/`; they cannot be attached as painting photos. The owner requested a fresh inventory and deletion of the existing painting objects, including legacy derivatives. Old repository photos are not shipped in the Pages artifact, imported or used as fallbacks.

GitHub Pages and standard public-repository Actions runners are free. Keep the inventory services on Workers/D1/Access free plans; do not upgrade automatically. R2's account-wide allowances are shared with other projects and are not a hard spending cap. No checkout, payment processing, paid CMS, image-transformation subscription or paid email service is required.

## Mother's workflow

### Set up once on her phone

1. Open [Sharmila Studio](https://studio-sharmila.vipul.xyz/studio) in Chrome or Safari. After the Pages deployment, [sharmila.me/studio](https://sharmila.me/studio) also forwards there.
2. Enter the approved email address, `sharmila.sharma31@gmail.com`, on the Cloudflare Access sign-in screen, then enter the one-time code sent to that inbox. Check spam if it does not arrive. There is no new Studio password to remember. A different email must first be added to the Access policy and backend allowlist by the site administrator.
3. Optional: in Android Chrome, use **⋮ → Add to Home screen**; in iPhone Safari, use **Share → Add to Home Screen**. Name it “Sharmila Studio”. The phone may ask her to sign in again when a session expires.

She needs access to her email and permission for the browser to choose photos from her phone. She does **not** need GitHub, Cloudflare, R2 or Amp accounts to manage inventory. Amp is optional for requesting design or code changes, not for adding paintings.

### Add, edit and publish

Use **Add painting** or **Edit** to manage title, one painting description, photos, series (or standalone), availability, price or price-on-request, medium, height, width, units, year, homepage selection and catalogue order. The separate photo-description input has been removed; existing image accessibility metadata is preserved. The phone keyboard's microphone can dictate descriptions.

Start with **Add painting**, upload photographs and fill in the details, then **Save draft → Preview → Publish painting**. Prices are in Indian rupees. Choose **Show price** to enter an amount or **Price on request** to hide the amount. Choose an existing series or leave **Standalone**; **Manage series**, above search, creates or edits themes. No archive paintings are automatically imported.

Photos can be uploaded, replaced, reordered, made the cover or removed. JPEG, PNG and WebP are resized on the device before upload. For HEIC, export a JPEG first. Uploaded web photos have public URLs even before a painting is published; never upload private documents or private original photos.

Selecting several photographs adds views of **one painting**, not separate painting records. To add separate paintings, use **Add painting** for each. Batch creation was discussed and deferred.

**Feature on the homepage** selects published paintings in catalogue order: one large hero, then up to five more in a grid. There is no carousel. If no painting is featured, the first six published paintings are used instead. Further published works remain accessible in Works. Change catalogue order to choose which featured work appears first.

Studio's upload optimization runs on the device, not through Hermes: orientation-aware resizing, no upscaling, longest edge at most 1920px, one WebP at quality 0.88. It does not generate multiple sizes or enforce a target byte budget. Do not assume it is the same pipeline as historical Hermes image processing.

**Save draft** changes only the private inventory. **Preview** shows the current form without publishing. **Publish** saves a published snapshot and requests a GitHub Pages rebuild; it does not mean the deployment has finished. The previous website stays visible during the build. The UI reports an acknowledged rebuild, missing configuration or an unconfirmed request. **Update website** retries a rebuild without modifying paintings. A build failure still requires checking GitHub Actions; an acknowledgement is not deployment verification.

**Unpublish painting** in the editor removes a painting from the next public build and keeps its latest saved draft privately. It does not delete photographs. Unsaved form changes are discarded after confirmation, so save them first if needed. Publish again to return the painting to the website.

**Delete painting permanently** removes the inventory record, without Trash or recovery. Unused photographs can then be deleted permanently in **Image library**. A photograph still referenced by any current draft or publication cannot be deleted, including when shared with another painting. No old revision keeps an otherwise unused photograph alive. The library does not track website-template references.

Series names and introductions are managed separately and are included in the next build. Painting titles can change without breaking their URLs. Export inventory downloads current drafts, publications, series and image metadata as JSON; photos remain in R2 and need their own backup. The public header and footer do not link to Studio; use the installed shortcut or private Studio URL.

### Draft recovery update — deployment pending

The local recovery change in this working tree has not yet been committed, pushed or deployed. The live Studio still requires **Save draft** to protect unsaved work against a phone killing the page.

After this update is deployed, painting edits are kept in a single current recovery draft per signed-in account, in that browser's local storage. Text is captured as it is edited, with an additional checkpoint when the page is hidden. Reopening Studio after a reload or page termination restores the form after authentication, including completed photo uploads and painting options. It does not publish anything or retain previous versions.

**Save draft**, confirmed discard, successful unpublish/delete and sign-out clear the recovery draft. A deleted painting is not recreated from recovery. If the server painting changed since the local edits, Studio asks before restoring them over the newer draft. Another signed-in account does not see the saved form.

This is device-local recovery, not a server backup or offline Studio. It cannot survive clearing browser data or recover a photo whose upload never finished. Storage failures display a warning to use **Save draft** before leaving. Continue using **Save draft** for durable inventory storage.

## Local development

Use Node 22 or newer and Python 3 for the static preview server.

```sh
npm ci
node scripts/prepare-dev.mjs
npm run db:migrate
npm run dev
```

`prepare-dev.mjs` creates local-only random credentials in ignored `.dev.vars`, mode 0600, without printing them or overwriting existing configuration. Password authentication is for local development only. A fresh database starts empty. Local Worker previews read only the published catalogue; the static `build:preview` starts empty too. There is no automatic archive fallback or legacy importer.

```sh
npm run build:preview
npm run preview:pages
npm run check
npm test
npm run build:studio
```

The pending recovery update includes browser tests using the real Studio markup and JavaScript with a mocked API; they do not mutate production inventory. These tests are still local and are not included in the documentation-only commit. Once the recovery code is committed, run:

```sh
npx playwright install chromium
npx playwright test tests/studio.spec.ts --workers=1
```

If Chrome is already installed, skip the download and set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable. `npm test` runs the API/D1/R2 suite; it does not run these browser tests.

The Pages preview serves only `dist/pages`; it cannot execute the backend. `build:studio` is a dry run, not a deployment. Production `npm run build` requires `CATALOGUE_URL` and `STUDIO_URL`, fetches only `/api/catalogue`, and refuses local `/media` image URLs. It fails instead of substituting old paintings when the inventory service is unavailable.

## Production configuration

1. The dedicated D1 database is `sharmila-catalogue`; its ID is configured in `wrangler.jsonc`. Apply all migrations to binding `DB`. Migration `0003_simplify_inventory.sql` permanently drops saved history and Trash metadata, while preserving current snapshots. Complete the authorized painting reset before this upgrade: former Trash rows would otherwise lose their hidden state. Do not import legacy paintings. Keep `IMAGE_BASE_URL=https://images.vipul.xyz`; do not set `CATALOGUE_PREVIEW`, `STUDIO_PASSWORD` or `SESSION_SECRET` in production.
2. Configure a Cloudflare Access Free application with email one-time PIN, explicit allowed artist/owner emails, and protection for **all three** `/studio`, `/api/studio/*` and `/api/session` paths. Keep `/api/catalogue` publicly readable for builds. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ACCESS_EMAILS` on the Worker. The backend independently validates JWT signature, issuer, audience, expiry and email. Access logout ends the Access browser session; local logout clears only the local session cookie.
3. Deploy the Studio Worker to `studio-sharmila.vipul.xyz`. Keep secrets with Hermes/Cloudflare, never in the public repository or browser. Set the explicit allowlist as secret `ACCESS_EMAILS`. Its `GITHUB_PAGES_TOKEN` must be a durable repo-scoped token capable of dispatching Actions workflows; it is not included in exports or static output. The repository owner can create a fine-grained token restricted to this repository with Actions read/write and Metadata read. In Cloudflare, open **Workers & Pages → sharmila-catalogue → Settings → Variables and Secrets → Add**, select **Secret**, name it `GITHUB_PAGES_TOKEN`, and **Save and deploy**. An Amp project secret called `GH_KEY` is a separate store; adding it there does not configure the Worker. A Text variable or pending setting is not an active encrypted Secret. Verify the active binding names without returning values. Do not substitute an expiring installation token or copy a broad personal credential into production.
4. The published catalogue and Studio URLs are configured in `.github/workflows/pages.yml`. Keep GitHub Pages Source set to **GitHub Actions**, not legacy `master`/root. The owner changed this successfully on 10 November 2026. The old branch publisher could overwrite successful catalogue deployments with legacy HTML; ordered reruns were only a temporary workaround. This setting requires a repository administrator or a user with permission to manage Pages; pushing code does not change it.
5. Verify the first full publish/build/deploy and the live public URLs before switching traffic or declaring the deployment complete. The workflow serializes updates, tests before publishing and retains its small Pages artifact for one day. No photos are stored in Actions artifacts.

Deployments, remote migrations, GitHub settings changes and credentials are intentionally not performed by local setup scripts.

## Session record — 10 November 2026

Source discussion: [catalogue redesign and Studio operations](https://ampcode.com/threads/T-01a1c513-93ce-72de-8472-23e4f2e187ba).

### Delivered before the recovery update

- Replaced the public Jekyll deployment with a generated catalogue, using R2 photographs, series/standalone grouping and painting detail pages with prices and enquiry links.
- Added the private, installable Studio, restricted editing through Cloudflare Access and removed Studio/install navigation from the public site. The mother's installed shortcut continues to open the private Studio; no reinstall is needed for normal updates.
- Completed the explicitly authorized fresh-inventory reset earlier in the session: 108 paintings, 112 old revisions and 216 painting R2 objects removed. School/Puppet series and unrelated bucket objects were preserved. **Do not repeat this reset:** the artist has since added new paintings.
- Removed revision history and Trash, added unpublish and permanent deletion, and preserved safety checks for photos shared by current painting snapshots.
- Slimmed navigation/footer, reduced heading gaps, moved series controls above inventory search and kept the footer at the viewport bottom on short pages without a fixed overlay.
- Deployed compact series-page spacing and removal of the redundant photo-description input in [626a2c4](https://github.com/shashank-sharma/sharmila-sharma.github.io/commit/626a2c4530949cd269b4f9790c7c84ed723c82cc). The painting description and existing image metadata remain intact.
- Preserved the Delhi-based biography and subsequent homepage/portrait/frame changes from the parallel owner-requested work. Remote `master` at the start of this update is [5f02647](https://github.com/shashank-sharma/sharmila-sharma.github.io/commit/5f02647b9073ce35c75266b00ea5bbca1bb8af78).

### Publishing diagnosis and verified state

Two independent problems delayed paintings appearing publicly: the legacy Pages publisher overwrote the generated site, and Studio lacked an active publishing token. An image existing in R2 or a painting appearing in `/api/catalogue` does not prove that Pages has rebuilt.

- Pages Source is now confirmed `workflow` after the owner's manual setting change. The redesigned homepage, stylesheet and series routes were checked live without cache-busting.
- The owner added `GH_KEY` in Amp, then handled Cloudflare installation manually. Automated installation attempts stopped without changing the Worker; no secret values were logged or committed.
- The supplied token successfully dispatched `pages.yml` with HTTP 204. [Verification run 42839684108](https://github.com/shashank-sharma/sharmila-sharma.github.io/actions/runs/42839684108) completed successfully. The public Works listing and Three Puppet detail page were checked HTTP 200 with the title present.
- At 14:59 UTC the token was only a pending plain-text setting. The owner changed it to **Secret** and deployed it. At 15:03 UTC, the active deployment `4ebe2f44-c8fd-4a43-abb3-e1d664d1ee69` was verified to include the publishing secret: version `55db66c8-b9cb-4808-8dc4-57cac5b924f9`, serving 100% of traffic. There is no remaining token-deployment step. No secret value is included in this record.
- **Final integration check remains with the signed-in owner:** tap Studio's **Update website**, expect **Website rebuild queued**, then confirm the resulting GitHub workflow and live catalogue. Hermes has no authenticated Studio browser session. Token permission and active secret configuration were verified separately; an authenticated request through the Studio rebuild endpoint was not exercised.

### Recovery work in this checkout

The reported app-switching data loss is reproducible as lost unsaved form state after reloading Studio: previously only JavaScript memory and a desktop unload warning protected edits. The phone's exact suspension behavior was not observed on a real device.

Implemented local painting-draft recovery in `public/studio.js`, with browser regressions in `tests/studio.spec.ts`. The recovery code and tests remain **local, uncommitted and undeployed**. The owner authorized committing and pushing the README and this session guide separately; that documentation-only delivery does not include the recovery implementation.

Verification:

- The regression failed on unchanged code because the editor was hidden and the unsaved form was lost after reload.
- All three browser regression scenarios passed after the change, including forced Chromium renderer termination, recovery of text/options/completed photo metadata, save/discard cleanup, expired sessions, account isolation and explicit confirmation when server versions differ.
- All 34 API tests, TypeScript, JavaScript syntax, formatting, diff checks and the Worker dry run passed. Browser tests use mocked API responses, not live inventory writes.
- Desktop reload and touch-enabled Pixel 7 Chromium simulation were exercised and recorded. The simulation is not a real Android-device test. A separate storage-denied probe displayed the explicit Save draft warning.

Remaining delivery: obtain commit/push/deploy authorization for recovery, preserve active Cloudflare secrets during deployment, update this pending status after delivery, and verify the live Studio without creating or deleting real paintings.
