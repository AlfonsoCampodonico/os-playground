// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages serves project sites under /<repo>; the deploy workflow sets both.
  site: process.env.SITE,
  base: process.env.BASE_PATH ?? '/',
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()]
  }
});