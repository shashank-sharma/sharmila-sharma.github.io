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

### Draft recovery — deployed 10 November 2026

Recovery is deployed to the live Studio, with source and tests included in this update. Save any form still open in the old Studio, then reload to load the update; unsaved edits made before the update cannot be recovered retroactively.

Painting edits are kept in a single current recovery draft per signed-in account, in that browser's local storage. Text is captured as it is edited, with an additional checkpoint when the page is hidden. Reopening Studio after a reload or page termination restores the form after authentication, including completed photo uploads and painting options. It does not publish anything or retain previous versions.

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

The deployed recovery update includes browser tests using the real Studio markup and JavaScript with a mocked API; they do not mutate production inventory. Run them separately from the API tests:

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
- **The owner's subsequent integration check failed:** Studio's **Update website** returned the generic retry message, and no newer `workflow_dispatch` run appeared. Token permission and active secret configuration were verified separately; they do not prove that the deployed Studio can dispatch successfully. Hermes has no authenticated Studio browser session.
- Read-only Hermes investigation `66622135-d46d-4afd-8567-4d8c2a2406a1`, completed at 15:09 UTC, confirmed deployed code sends the untrimmed token to `pages.yml` on `master`, waits at most five seconds and collapses every non-204 response or exception into `failed`. Worker observability is unset, Logpush is disabled, there are no tail consumers, and telemetry searches returned no rebuild events or traces. There is no retained GitHub status or exception to diagnose the actual attempt. Cloudflare secret metadata cannot establish the stored value or compare it with the independently validated token. Token mismatch, GitHub rejection, timeout and transport failure remain hypotheses.
- The diagnostic update, now deployed with the owner's authorization, returns only a safe GitHub HTTP status or `timeout`/`request-error` category and gives a non-circular Studio message. It trims surrounding token whitespace as a precaution, **not a verified fix**. It exposes no raw response bodies, exception strings or credentials and adds no public diagnostic endpoint. A signed-in owner retry must still be correlated with GitHub Actions before claiming publishing is fixed. No secret installation or Hermes job remains pending.

### Recovery work in this checkout

The reported app-switching data loss is reproducible as lost unsaved form state after reloading Studio: previously only JavaScript memory and a desktop unload warning protected edits. The phone's exact suspension behavior was not observed on a real device.

Implemented painting-draft recovery in `public/studio.js`, with browser regressions in `tests/studio.spec.ts`. Recovery is now **deployed**. The earlier documentation-only delivery did not include the recovery implementation. The owner separately authorized deploying recovery and diagnostics during this continuation, then requested “commit push deploy” to deliver the source, tests and updated records as well.

Verification:

- The regression failed on unchanged code because the editor was hidden and the unsaved form was lost after reload.
- All four browser regression scenarios passed after the change, including forced Chromium renderer termination, recovery of text/options/completed photo metadata, save/discard cleanup, expired sessions, account isolation, explicit confirmation when server versions differ and actionable rebuild errors.
- All 34 API tests, TypeScript, JavaScript syntax, formatting, diff checks and the Worker dry run passed. Browser tests use mocked API responses, not live inventory writes.
- Desktop reload and touch-enabled Pixel 7 Chromium simulation were exercised and recorded. The simulation is not a real Android-device test. A separate storage-denied probe displayed the explicit Save draft warning.

Remaining integration check: verify an authenticated live Studio rebuild without creating or deleting real paintings. Deployment and secret-preservation checks are complete below; committing and pushing the source, tests and updated records is now authorized.

### Continuation handoff and verification

Continuation: [publishing diagnosis and draft recovery](https://ampcode.com/threads/T-01a1c606-2cf4-7412-9391-93f2925f87ed). The receiving checkout started clean at documentation commit [5fb64ad](https://github.com/shashank-sharma/sharmila-sharma.github.io/commit/5fb64ad46ee9b0aca87baf3fcdce88038ddb0042). The exact 19,485-byte patch was downloaded from the source thread, inspected and applied after `git apply --check` passed. It changes only `public/studio.js`, `src/api.ts`, `tests/api.test.ts` and the new `tests/studio.spec.ts`; existing biography, homepage, portrait and frame work is preserved.

The receiving orb reran `npm run check`, `npm test` (34 passed), `npm run build:studio` (dry run only), Prettier and `git diff --check` successfully. Using installed Chromium, `npx playwright test tests/studio.spec.ts --workers=1 --reporter=line` passed all four scenarios. These browser tests use mocked API responses; they do not verify a live GitHub dispatch. The terminal Hermes investigation result above was also retrieved directly and checked. No production writes, rebuild requests, authentication changes or deployments were performed during the initial handoff verification.

### Authorized recovery and diagnostics deployment

The owner then explicitly authorized: “Deploy recovery and diagnostics, preserving all existing secrets and inventory.” Hermes completed deployment job `f5cc7463-8914-4acf-9ff5-f1c91a7acc22` at 15:48 UTC (21:18 IST). Active deployment `f112bccb-c81a-40ee-85e1-7f2c54237d12` serves version `a5572259-c698-4d9f-b8d6-30b772610cee` at **100% traffic**.

The first artifact download was inaccessible centrally and stopped without changes. A scoped orb portal transferred the credential-free artifact successfully. Comparison found that the repository bundle also contained earlier portrait/frame/About-page changes absent from the live Worker; that attempt also stopped without changes. To preserve unrelated production content, Hermes exported the live Worker module and public assets. The orb changed only the compiled `rebuildSite` function and `public/studio.js`. All remaining module bytes and asset hashes matched production exactly. Existing repository and public Pages biography/homepage/portrait/frame work was left untouched.

The scoped function exactly matched the locally compiled and tested source. Additional artifact probes passed for missing configuration, whitespace trimming and HTTP 204, eight non-204 statuses, transport failure and the real five-second timeout. All four browser scenarios passed again. Hermes uploaded the scoped module without bundling, preserving active settings, bindings and secrets. No migrations, inventory/R2 data writes, secret replacements, Access changes, independent workflow dispatches, Pages deployments or Git pushes were performed.

Verification:

- Deployed module fetched through `/content/v2` matched SHA256 `e6918c3a89d56542e585e0334672e0e0a5facd335e864e34b33982bc3ae440e8`.
- Served `studio.js` matched SHA256 `58e256ad8b6dd6c69455839605401f6f6df1d7366abaf0d286b5142dd8141fd7`; all nine served assets matched the scoped artifact. The orb independently checked all nine live hashes.
- `GITHUB_PAGES_TOKEN` and `ACCESS_EMAILS` remain `secret_text`, with existing values retained without reading or reinstalling them. All plain variables and bindings, including D1, R2 and ASSETS, were preserved. Access policies, asset-serving behavior and disabled workers.dev/previews were unchanged.
- Hermes and the orb independently checked `/studio`, `/api/session` and `/api/studio/artworks` redirect to Access (HTTP 302), while `/api/catalogue` and `sharmila.me` return HTTP 200. The catalogue contained seven published paintings at verification; artist uploads remain active.

The owner subsequently requested committing and pushing recovery, publishing diagnostics, browser tests and these record corrections. The push to `master` triggers the existing Pages workflow; it is not evidence that Studio's authenticated dispatch works. Production Worker deployment is complete, but **publishing through Studio is not yet confirmed fixed**. The owner should save any open form, reload Studio and tap **Update website** once, then report the exact new message. Confirm a resulting GitHub workflow and actual public catalogue before closing the incident. Do not reset inventory or replace secrets speculatively.

### Owner retry: unsupported Worker redirect mode identified

Recovery and diagnostics were committed and pushed in [bff08ed](https://github.com/shashank-sharma/sharmila-sharma.github.io/commit/bff08ed703e267dfc79923dabc395727c63f6f50). [Pages run 42854069814](https://github.com/shashank-sharma/sharmila-sharma.github.io/actions/runs/42854069814) succeeded; the public listing and all seven published painting pages were verified. A subsequent read-only Worker check confirmed the deployed version and all secret/resource bindings remained unchanged.

The owner's next screenshot showed: “Studio's request to GitHub failed before an acknowledgement.” This corresponds to `reason: "request-error"`, not a returned GitHub HTTP error or the five-second timeout. Reproduction using the installed Cloudflare workerd runtime and the production compatibility date (`2026-11-01`) identified a deterministic code error: `redirect: "error"` throws `TypeError: Invalid redirect value, must be one of "follow" or "manual"` before any outbound request. The publishing code deployed at that time used this unsupported option. This explains why the secret could be active yet no workflow dispatch appeared; the token was not reached by this code path.

The follow-up changes the option to `manual`. Redirect responses remain failures with their HTTP status; the request is never followed to another host, preventing credential forwarding. The existing authenticated rebuild test now constructs a real Cloudflare `Request` at its mocked transport boundary. It failed before the fix with the same `{status: "failed", reason: "request-error"}` result and passes after the fix. Earlier tests replaced `fetch` outright and therefore bypassed runtime option validation.

Additional validation used the compiled `rebuildSite` function in real workerd with a controlled outbound service, not a JavaScript `fetch` spy: the old mode returned `request-error` with **zero outbound calls**, while `manual` reached the service once and returned `queued` on HTTP 204. Separate HTTP 301, 302, 307 and 308 cases each returned their failure status with exactly one call and never contacted the redirect target. No production credentials, GitHub dispatches or inventory writes were used in these probes. All 34 API tests, TypeScript, Worker dry run and diff checks passed after the fix.

The owner approved committing, pushing and deploying this follow-up. Hermes deployment job `519f804e-070b-4905-85e2-a2d0a18db777` completed at 16:54 UTC (22:24 IST), deploying version `4a26f7fe-9a6d-40be-9b78-e3f38b42a0cf` through deployment `80806039-634a-4a83-85b4-11925d276fd2` at **100% traffic**. Only the literal redirect block in the active compiled module was patched; reversing it reproduced the prior module byte-for-byte. Deployed source read through `/content/v2` matched SHA256 `8a876bbfa8ea7667675f84fd1778205a9c671887413457b49b71bfba4c7d76ed`.

All nine static assets remained byte-identical. All existing secret/resource bindings, plain variables, Access policies and asset-serving behavior were preserved; `GITHUB_PAGES_TOKEN` and `ACCESS_EMAILS` values were neither read nor replaced. Private routes still redirect to Access, while the public catalogue and site return HTTP 200. The orb also independently checked unchanged Studio JavaScript/stylesheet hashes, private-route protection and the seven-painting public catalogue. No migrations, inventory/R2 writes, independent workflow dispatches or unrelated source/asset changes were made.

The source fix, strengthened regression and updated records are included in the authorized Git delivery. An authenticated Studio retry must still confirm GitHub's actual response and the resulting workflow; removing this deterministic request-construction failure does not independently validate the stored token. Keep the active secrets and inventory unchanged rather than replacing them speculatively.
