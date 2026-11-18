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

/** Shared YouTube Data API key compiled into this deployment, if any. */
declare const __SOLO_YOUTUBE_API_KEY__: string;

/** Shared Spotify Client ID compiled into this deployment, if any. */
declare const __SOLO_SPOTIFY_CLIENT_ID__: string;

/** True when visitors may paste their own API keys (development/self-hosted). */
declare const __SOLO_ALLOW_PERSONAL_KEYS__: boolean;
