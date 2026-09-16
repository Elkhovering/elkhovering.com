import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://elkhovering.com',
  output: 'static',
  integrations: [mdx()],

  // Мягкий редирект со старых /ru/works/* URL — если где-то остались ссылки,
  // они не упадут в 404, а приведут на актуальный единый URL.
  redirects: {
    '/ru': '/',
    '/ru/works': '/works',
    '/ru/works/[slug]': '/works/[slug]',
  },

  vite: {
    build: {
      // three.js — единственный чанк крупнее стандартных 500 КБ (~660 КБ, ~168 КБ в gzip),
      // и грузится он только на главной. Порог чуть выше него: предупреждение
      // остаётся полезным, если в бандл случайно попадёт что-то ещё тяжёлое.
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          // three.js — отдельным чанком со своим хешем. Иначе любая правка сцены
          // лося меняет хеш общего файла, и вернувшийся посетитель заново качает
          // ~168 КБ библиотеки, которая не менялась.
          manualChunks(id) {
            if (id.includes('/node_modules/three/')) return 'three';
          },
        },
      },
    },
  },
});
