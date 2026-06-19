import { sveltekit } from '@sveltejs/kit/vite';

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
      // PoE2 community dataset is only reachable through the Cloudflare Worker
      // (Neon-backed). In dev, forward to a local `wrangler dev` on :8787.
      '/api/poe2': {
        target: 'http://localhost:8787',
        changeOrigin: true
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
