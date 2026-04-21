import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://elkhovering.com',
  output: 'static',

  // Мягкий редирект со старых /ru/works/* URL — если где-то остались ссылки,
  // они не упадут в 404, а приведут на актуальный единый URL.
  redirects: {
    '/ru': '/',
    '/ru/works': '/works',
    '/ru/works/[slug]': '/works/[slug]',
  },

  // <spline-viewer> — это кастомный web-component, Astro не должен пытаться его обрабатывать.
  vite: {
    optimizeDeps: {
      exclude: ['@splinetool/viewer']
    }
  }
});
