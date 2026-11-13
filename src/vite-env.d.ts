/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional shared Spotify Client ID compiled into a deployment. */
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
  /** Optional explicit redirect URI; defaults to <origin>/callback. */
  readonly VITE_SPOTIFY_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
