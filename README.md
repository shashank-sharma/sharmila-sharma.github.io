# Sharmila Sharma

A painting catalogue for Sharmila Sharma, a Delhi-based contemporary artist. Visitors can explore standalone paintings and series, open a painting for its description, dimensions, availability and price, and enquire directly with the artist.

- **Website:** [sharmila.me](https://sharmila.me)
- **Private inventory:** [Sharmila Studio](https://studio-sharmila.vipul.xyz/studio)
- **Operating guide and session record:** [CATALOGUE.md](CATALOGUE.md)

## How it works

The public website is static HTML generated from published inventory and deployed through **GitHub Actions to GitHub Pages**. It does not use Jekyll or query the inventory API in visitors' browsers.

The private, phone-friendly Studio runs on a **Cloudflare Worker**, with **D1** for painting metadata and **R2** for images. Cloudflare Access restricts editing to approved artist/owner emails. Studio can be added to the phone's home screen; no GitHub, Cloudflare or Amp account is needed for day-to-day inventory management. Public navigation does not link to Studio.

### Inventory

- Create a painting with title, one description, photographs, price, availability, medium, dimensions and year.
- Assign a series, create one through **Manage series**, or keep a painting standalone.
- Multiple uploaded photographs belong to **one painting**. Batch creation of separate paintings is not implemented.
- **Save draft** is private. **Publish painting** saves the public snapshot and requests a website rebuild. The site changes only after that build deploys successfully.
- **Unpublish** keeps the painting as a draft. **Delete permanently** has no Trash or revision history. Unused photos can be deleted separately from **Image library**.
- Homepage selection displays the first featured painting as a hero and up to five more below it, not a carousel. Catalogue order controls selection order; all published paintings remain in Works.

Studio prepares uploads in the browser: orientation-aware resize to a maximum of 1920px and a single WebP at quality 0.88. This is not the separate Hermes image-optimization workflow.

## Local development

Requires Node.js 22+ and Python 3 for the static preview server.

```sh
npm ci
node scripts/prepare-dev.mjs
npm run db:migrate
npm run dev
```

Local credentials are generated in ignored `.dev.vars`; existing values are not overwritten. The local inventory starts empty. Do not put production credentials in this file or commit them.

For an empty static preview:

```sh
npm run build:preview
npm run preview:pages
```

Production builds read only the public, published catalogue:

```sh
CATALOGUE_URL=https://studio-sharmila.vipul.xyz/api/catalogue \
STUDIO_URL=https://studio-sharmila.vipul.xyz/studio \
npm run build
```

Output is `dist/pages`. Original Jekyll files and archive photos remain in Git for reference but are not imported or included in the generated site.

## Verification

```sh
npm run check
npm test
npm run build:studio
```

`build:studio` is a Worker dry run, not a deployment. A local, not-yet-committed recovery update adds browser regression tests using the real Studio HTML/JavaScript with a mocked API, without changing live paintings. Once that update lands, run:

```sh
npx playwright install chromium
npx playwright test tests/studio.spec.ts --workers=1
```

When Chrome is already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable instead of downloading another browser. The recovery tests cover renderer termination, session expiry, account isolation, save/discard cleanup and newer server edits.

## Publishing configuration

GitHub **Settings → Pages → Source** must be **GitHub Actions**, not the legacy branch publisher. The workflow is [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

Automatic Studio publishing also requires an **encrypted, deployed Cloudflare Worker secret** named `GITHUB_PAGES_TOKEN`. Use a fine-grained token owned by the repository owner, restricted to this repository, with **Actions: read and write**. An Amp secret named `GH_KEY` does not automatically create the Cloudflare secret. A pending Text variable is not a deployed Secret.

Install it through **Cloudflare → Workers & Pages → sharmila-catalogue → Settings → Variables and Secrets**, choose type **Secret**, and **Save and deploy**. Keep credentials out of Git, screenshots, logs and chat. After setup, **Update website** retries a rebuild without modifying inventory. Confirm the workflow and actual public pages; a queued rebuild is not a completed deployment.

See [CATALOGUE.md](CATALOGUE.md) for Access configuration, deployment boundaries, recovery behavior and the dated implementation/deployment record.

## Attribution

The original site was based on [Photorama](https://github.com/sunbliss/photorama) by Anna Prigkipaki, using Clean Blog. Legacy theme materials retain their original attribution. See [LICENSE](LICENSE) for the MIT license.

Original theme notice: Copyright (c) 2014 Filippo Oretti, Dario Andrei.
