import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react(), { name: 'codelab-directory-index', configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.match(/^\/codelab\/(?:\?|$)/)) req.url = req.url.replace('/codelab/', '/codelab/index.html');
      next();
    });
  } }],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
});
