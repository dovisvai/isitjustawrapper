// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync } from 'node:fs';

// Each product page's sitemap <lastmod> is the date a human last reviewed it, so
// search engines re-crawl exactly the pages whose figures changed.
const reviewed = Object.fromEntries(
  readdirSync('data/apps')
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`data/apps/${f}`, 'utf8')))
    .map((app) => [app.slug, app.lastReviewed]),
);
const latest = Object.values(reviewed).sort().at(-1);

// `site` drives canonical URLs, the sitemap, and the UTM tags on sponsor links.
// Changing it means changing SITE_ORIGIN in wrangler.toml and the Sitemap line
// in public/robots.txt to match.
export default defineConfig({
  site: 'https://isitjustawrapper.com',
  output: 'static',
  trailingSlash: 'ignore',

  build: {
    format: 'directory',
  },

  devToolbar: {
    enabled: false,
  },

  integrations: [
    sitemap({
      serialize(item) {
        const slug = item.url.match(/\/app\/([^/]+)\/?$/)?.[1];
        const lastmod = slug ? reviewed[slug] : latest;
        return lastmod ? { ...item, lastmod: new Date(lastmod).toISOString() } : item;
      },
    }),
  ],
});