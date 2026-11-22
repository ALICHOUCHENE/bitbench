# BitBench

*Precision calculators for embedded systems engineers.*

A free, fast, ad-free website of calculators for embedded systems engineers: LTE-M/NB-IoT PSM & eDRX timers,
LoRa airtime, STM32 timers, UART baud rates, CRC, IEEE-754, fixed-point, ADC, NTC, I²C pull-ups and more.
Everything runs in the browser. There's no backend, no database, no cookies and no tracking.

- Static site built with [Astro](https://astro.build), all calculation logic in TypeScript
- Every formula lives in a pure, unit-tested module in `src/lib/` ([Vitest](https://vitest.dev))
- Every tool has its own URL, and its inputs are mirrored in the query string so results can be shared
- Works offline after the first visit (service worker), light and dark themes

## Local development

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev        # http://localhost:4321/bitbench/
npm test           # run all unit tests once
npm run test:watch # re-run tests on change
npm run build      # static site in dist/
npm run preview    # serve dist/ locally
```

## Owner details

Edit **`src/config.ts`**: name, role, GitHub, LinkedIn, repository URL and optional analytics.

There is deliberately no contact form and no email address on the site: the contact page, the About page and the
homepage's author section link to GitHub and LinkedIn only.

### Analytics (optional, off by default)

Set `goatcounterCode` in `src/config.ts` to enable [GoatCounter](https://www.goatcounter.com), which is cookie-free
and needs no consent banner. Leave it empty to ship no analytics at all.
[Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) is another privacy-friendly option if you host on
Cloudflare Pages.

## Project structure

```
src/
├─ config.ts            # owner details and site settings
├─ tools.ts             # registry of every tool: slug, name, title, description, category, keywords
├─ lib/                 # pure calculation logic, no DOM access (unit tested)
├─ scripts/
│  ├─ tool-client.ts    # bindForm(), setResult(), setError(): DOM wiring shared by tool pages
│  └─ site.ts           # theme toggle, copy buttons, service-worker registration
├─ components/          # ToolLayout, NumberInput, SelectInput, Segmented, Toggle, ResultRow, CodeOutput, …
├─ layouts/BaseLayout.astro
├─ pages/
│  ├─ index.astro       # tool directory with filter
│  ├─ tools/<slug>.astro
│  ├─ about.astro, contact.astro, 404.astro
│  └─ robots.txt.ts, manifest.webmanifest.ts
├─ styles/tokens.css    # design tokens
├─ styles/global.css
└─ utils/paths.ts       # url(): base-path-aware internal links
tests/                  # Vitest specs for src/lib
public/                 # favicon, icons, og-image, service worker
```

## Adding a new tool

1. **Logic first.** Write pure functions in `src/lib/<topic>.ts`, in SI units, with no DOM access. Cite the spec or
   datasheet in a comment next to every constant and formula. If a value can't be verified, leave
   `// TODO: verify against <spec>` rather than guessing.
2. **Tests.** Add `tests/<topic>.test.ts` with known reference values from the spec or datasheet, plus edge cases.
3. **Register it** in `src/tools.ts` (slug, name, search-friendly title, one-sentence description, category,
   keywords). The homepage, page title, meta description and related links all come from there.
4. **Page.** Create `src/pages/tools/<slug>.astro`. Copy `rc-filter.astro` as a template:
   - wrap it in `<ToolLayout slug="…" references={[…]}>`
   - put the inputs in a `<form id="…" class="panel">` built from `NumberInput`, `SelectInput`, `Segmented`, `Toggle`
   - put the readout in `<dl class="results">` built from `ResultRow`, and generated code in `CodeOutput`
   - fill the `formula` slot ("How it's calculated") and the `explainer` slot (practical notes for readers)
   - in the page `<script>`, call `bindForm(formId, values => { … })`, which restores inputs from the URL, recomputes
     on every change and keeps the URL in sync. Show results with `setResult(name, text)` and specific errors with
     `setError(name, message)`.
5. Internal links must use `url()` / `toolUrl()` from `src/utils/paths.ts` so they work under a sub-path.
6. Run `npm test && npm run build`.

## Deploying

### GitHub Pages (default)

1. Push the repository to GitHub (for example `github.com/<you>/bitbench`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. `.github/workflows/deploy.yml` runs the tests, builds and publishes the site to
   `https://<you>.github.io/<repo>/`.

The workflow sets `SITE_URL` and `BASE_PATH` from the repository owner and name, so nothing needs editing. Also update
`url` in `src/config.ts`.

**Custom domain on GitHub Pages:** add `public/CNAME` containing your domain, configure DNS, and change the workflow's
env to `SITE_URL: https://yourdomain.dev` and `BASE_PATH: /`.

### Cloudflare Pages (alternative)

1. In the Cloudflare dashboard, open **Workers & Pages → Create → Pages → Connect to Git** and pick the repository.
2. Build command `npm run build`, output directory `dist`.
3. Environment variables: `SITE_URL=https://<project>.pages.dev` (or your domain), `BASE_PATH=/`, and
   `NODE_VERSION=22`.

Both options are free. A custom domain (about €10–15/year) is recommended for a public site: it reads better in search
results and keeps your ranking if you ever change host.

## Design system

The site should feel calm and professional: easy on the eyes for long sessions, with tools grouped into category boxes. The tokens live in `src/styles/tokens.css`.

| Token | Role |
|---|---|
| `--bg` blue-grey / deep grey | Page ground behind white panels; dark mode is deep grey, not black, to reduce glare |
| `--surface` | Panels and inputs, one step off the ground |
| `--ink`, `--ink-muted` | Text and labels |
| `--rule`, `--shadow` | Light borders and a very soft shadow give panels depth without noise |
| `--cat-*` | One muted hue per category (steel blue, violet, teal, copper), used only on icon tiles, chip icons and a thin box top line |
| `--accent` deep blue | The only saturated colour, reserved for actions: focus rings, links, set bits, the main result |
| `--ok`, `--warn`, `--error` | Status only, never decoration |

- **Type:** Inter for prose and JetBrains Mono for values, both self-hosted from npm (`@fontsource-variable/*`) so there are no third-party requests. Monospace with
  tabular figures is used for every value, bit string and code sample, so digits line up in columns.
- **Spacing:** a 4 px-based scale (`--s1` … `--s8`).
- **The memorable element:** the clickable bit-field visualiser on the binary tool, plus the bit-cell logo. Everything
  else stays quiet.
- Light and dark themes follow `prefers-color-scheme`, with a manual toggle (stored in `localStorage`).

## Licence

Code: MIT. Content (explanations): CC BY 4.0. Replace with your preference.
