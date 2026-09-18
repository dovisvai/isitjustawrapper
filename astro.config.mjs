// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

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

  integrations: [sitemap()],
});