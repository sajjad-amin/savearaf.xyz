import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://savearaf.xyz',
  output: 'server',
  security: {
    checkOrigin: false,
  },
  adapter: node({
    mode: 'standalone',
  }),
  integrations: [tailwind()],
  i18n: {
    defaultLocale: 'bn',
    locales: ['bn', 'en'],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: true,
    },
  },
});
