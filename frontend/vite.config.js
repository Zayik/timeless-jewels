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
  plugins: [sveltekit()]
};

export default config;
