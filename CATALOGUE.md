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

Use **Add painting** or **Edit** to manage title, description, photos, photo descriptions, series (or standalone), availability, price or price-on-request, medium, height, width, units, year, homepage selection and catalogue order. The phone keyboard's microphone can dictate descriptions.

Start with **Add painting**, upload photographs and fill in the details, then **Save draft → Preview → Publish painting**. Prices are in Indian rupees. Choose **Show price** to enter an amount or **Price on request** to hide the amount. Choose an existing series or leave **Standalone**; **Manage series**, above search, creates or edits themes. No archive paintings are automatically imported.

Photos can be uploaded, replaced, reordered, made the cover or removed. JPEG, PNG and WebP are resized on the device before upload. For HEIC, export a JPEG first. Uploaded web photos have public URLs even before a painting is published; never upload private documents or private original photos.

**Save draft** changes only the private inventory. **Preview** shows the current form without publishing. **Publish** saves a published snapshot and requests a GitHub Pages rebuild; it does not mean the deployment has finished. The previous website stays visible during the build. The UI reports an acknowledged rebuild, missing configuration or an unconfirmed request. **Update website** retries a rebuild without modifying paintings. A build failure still requires checking GitHub Actions; an acknowledgement is not deployment verification.

**Unpublish painting** in the editor removes a painting from the next public build and keeps its latest saved draft privately. It does not delete photographs. Unsaved form changes are discarded after confirmation, so save them first if needed. Publish again to return the painting to the website.

**Delete painting permanently** removes the inventory record, without Trash or recovery. Unused photographs can then be deleted permanently in **Image library**. A photograph still referenced by any current draft or publication cannot be deleted, including when shared with another painting. No old revision keeps an otherwise unused photograph alive. The library does not track website-template references.

Series names and introductions are managed separately and are included in the next build. Painting titles can change without breaking their URLs. Export inventory downloads current drafts, publications, series and image metadata as JSON; photos remain in R2 and need their own backup. The public header and footer do not link to Studio; use the installed shortcut or private Studio URL.

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

The Pages preview serves only `dist/pages`; it cannot execute the backend. `build:studio` is a dry run, not a deployment. Production `npm run build` requires `CATALOGUE_URL` and `STUDIO_URL`, fetches only `/api/catalogue`, and refuses local `/media` image URLs. It fails instead of substituting old paintings when the inventory service is unavailable.

## Production configuration

1. The dedicated D1 database is `sharmila-catalogue`; its ID is configured in `wrangler.jsonc`. Apply all migrations to binding `DB`. Migration `0003_simplify_inventory.sql` permanently drops saved history and Trash metadata, while preserving current snapshots. Complete the authorized painting reset before this upgrade: former Trash rows would otherwise lose their hidden state. Do not import legacy paintings. Keep `IMAGE_BASE_URL=https://images.vipul.xyz`; do not set `CATALOGUE_PREVIEW`, `STUDIO_PASSWORD` or `SESSION_SECRET` in production.
2. Configure a Cloudflare Access Free application with email one-time PIN, explicit allowed artist/owner emails, and protection for **all three** `/studio`, `/api/studio/*` and `/api/session` paths. Keep `/api/catalogue` publicly readable for builds. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ACCESS_EMAILS` on the Worker. The backend independently validates JWT signature, issuer, audience, expiry and email. Access logout ends the Access browser session; local logout clears only the local session cookie.
3. Deploy the Studio Worker to `studio-sharmila.vipul.xyz`. Keep secrets with Hermes/Cloudflare, never in the public repository or browser. Set the explicit allowlist as secret `ACCESS_EMAILS`. Its `GITHUB_PAGES_TOKEN` must be a durable repo-scoped token capable of dispatching Actions workflows; it is not included in exports or static output. The repository owner can create a fine-grained token restricted to this repository with Actions read/write and Metadata read, and store it privately with Hermes. Do not substitute an expiring installation token or copy a broad personal credential into production.
4. The published catalogue and Studio URLs are configured in `.github/workflows/pages.yml`. Change GitHub Pages publishing from the existing legacy `master`/root build to **GitHub Actions**. That setting requires a repository administrator or a user with permission to manage Pages; pushing the code does not change it.
5. Verify the first full publish/build/deploy and the live public URLs before switching traffic or declaring the deployment complete. The workflow serializes updates, tests before publishing and retains its small Pages artifact for one day. No photos are stored in Actions artifacts.

Deployments, remote migrations, GitHub settings changes and credentials are intentionally not performed by local setup scripts.
