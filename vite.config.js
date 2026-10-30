import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the build also works from https://<user>.github.io/<repo>/
  base: './',
  server: { port: 5179, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
