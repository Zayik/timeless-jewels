import { sveltekit } from '@sveltejs/kit/vite';

// PoE2 community dataset lives behind the Cloudflare Worker (Neon-backed). By default the dev
// proxy forwards /api/poe2 to the SAME production Worker the overlay writes to
// (overlay/src/main.ts WORKER_BASE) — so the site reads exactly the DB the overlay fills, with
// no risk of a local `wrangler dev` pointing at a different database. Set VITE_POE2_WORKER_URL
// to http://localhost:8787 when you specifically want to iterate on the Worker locally.
// Keep this URL in sync with the overlay's WORKER_BASE.
const POE2_WORKER_URL =
  process.env.VITE_POE2_WORKER_URL ?? 'https://timeless-jewels-proxy.davidleeanderson1991.workers.dev';

/** @type {import('vite').UserConfig} */
const config = {
  server: {
    fs: {
      strict: false
    },
    proxy: {
      '/api/trade': {
        target: 'https://www.pathofexile.com',
        changeOrigin: true,
        secure: true,
        ws: true,
        headers: {
          Origin: 'https://www.pathofexile.com',
          Referer: 'https://www.pathofexile.com/'
        }
      },
      // PoE2 community dataset — forward to the same Worker the overlay uses (see
      // POE2_WORKER_URL above). The proxy is server-side, so the browser sees a same-origin
      // request and CORS never enters into it.
      '/api/poe2': {
        target: POE2_WORKER_URL,
        changeOrigin: true,
        secure: true
      }
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler'
      }
    }
  },
  plugins: [sveltekit()]
};

export default config;
