import { defineConfig, loadEnv } from 'vite';

const YOUTUBE_KEY_NAMES = [
  'VITE_YOUTUBE_API_KEY',
  'YOUTUBE_API_KEY',
  'GOOGLE_API_KEY',
  'YT_API_KEY',
];

const SPOTIFY_ID_NAMES = ['VITE_SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_ID'];

function firstValue(env: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = (env[name] ?? '').trim();
    if (value) return value;
  }
  return '';
}

// The dev server binds a fixed loopback port so the Spotify redirect URI
// (http://127.0.0.1:5173/callback) stays stable. Spotify requires an exact
// match with the URI registered in the developer dashboard.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const youtubeKey = firstValue(env, YOUTUBE_KEY_NAMES);
  const spotifyClientId = firstValue(env, SPOTIFY_ID_NAMES);
  const allowPersonalKeys =
    mode !== 'production' || env.VITE_ALLOW_PERSONAL_KEYS === '1';

  if (mode === 'production' && !youtubeKey && !allowPersonalKeys) {
    console.warn(
      '\n[solo] No shared YouTube key found. Set VITE_YOUTUBE_API_KEY (or YOUTUBE_API_KEY) ' +
        'in the hosting environment and redeploy. Public builds will not ask visitors for a key.\n',
    );
  }
  if (mode === 'production' && !spotifyClientId && !allowPersonalKeys) {
    console.warn(
      '\n[solo] No shared Spotify Client ID found. Set VITE_SPOTIFY_CLIENT_ID ' +
        '(or SPOTIFY_CLIENT_ID) in the hosting environment and redeploy. ' +
        'Public builds hide the Spotify setup screen without it.\n',
    );
  }
  if (mode === 'production' && spotifyClientId && !/^[0-9a-f]{32}$/i.test(spotifyClientId)) {
    console.warn(
      '\n[solo] The shared Spotify Client ID does not look like 32 hexadecimal characters. ' +
        'Spotify will be unavailable until it is fixed.\n',
    );
  }

  return {
    define: {
      __SOLO_YOUTUBE_API_KEY__: JSON.stringify(youtubeKey),
      __SOLO_SPOTIFY_CLIENT_ID__: JSON.stringify(spotifyClientId),
      __SOLO_ALLOW_PERSONAL_KEYS__: JSON.stringify(allowPersonalKeys),
    },
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
  };
});
