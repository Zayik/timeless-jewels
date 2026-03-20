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
  plugins: [sveltekit()],
  // TODO: Remove once vite 4.3 is out
  worker: {
    plugins: [
      {
        name: 'remove-manifest',
        configResolved(c) {
          const manifestPlugin = c.worker.plugins.findIndex((p) => p.name === 'vite:manifest');
          c.worker.plugins.splice(manifestPlugin, 1);
          const ssrManifestPlugin = c.worker.plugins.findIndex((p) => p.name === 'vite:ssr-manifest');
          c.plugins.splice(ssrManifestPlugin, 1);
        }
      }
    ]
  }
};

export default config;
