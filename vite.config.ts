import { defineConfig } from 'vite';

// The dev server binds a fixed loopback port so the Spotify redirect URI
// (http://127.0.0.1:5173/callback) stays stable. Spotify requires an exact
// match with the URI registered in the developer dashboard.
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
