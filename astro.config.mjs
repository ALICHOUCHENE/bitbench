// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Deployment target. Override with env vars instead of editing this file:
//   GitHub Pages project site: SITE_URL=https://<user>.github.io  BASE_PATH=/bitbench
//   Custom domain / Cloudflare Pages: SITE_URL=https://bitbench.dev  BASE_PATH=/
const site = process.env.SITE_URL ?? 'https://alichouchene.github.io';
const base = process.env.BASE_PATH ?? '/bitbench';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'ignore',
  // Astro's compressor drops the line-break space before inline tags ("Write to<a>").
  // Hosts gzip HTML anyway, so the size cost is negligible.
  compressHTML: false,
  integrations: [sitemap()],
});
