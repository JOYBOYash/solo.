// Runtime configuration. Solo uses the public PKCE flow, so only the Client ID
// is needed — no secret. A public deployment supplies one shared Client ID so
// visitors just connect their own Spotify account. Development builds and
// self-hosted copies can fall back to a Client ID pasted into this browser.
// A ?client_id= URL parameter still works for one-off shares.

import { allowPersonalSources } from './deployment';

const CLIENT_ID_KEY = 'solo.clientId';
const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

const ENV_CLIENT_ID = (
  (typeof __SOLO_SPOTIFY_CLIENT_ID__ === 'string' ? __SOLO_SPOTIFY_CLIENT_ID__ : '') ||
  import.meta.env.VITE_SPOTIFY_CLIENT_ID ||
  ''
).trim();
const ENV_REDIRECT_URI = (import.meta.env.VITE_SPOTIFY_REDIRECT_URI ?? '').trim();

/** True when a valid Client ID is compiled into this deployment. */
export function hasDeploymentClientId(): boolean {
  return CLIENT_ID_PATTERN.test(ENV_CLIENT_ID);
}

/** The Client ID configured for this deployment, if any. */
export function deploymentClientId(): string | null {
  return CLIENT_ID_PATTERN.test(ENV_CLIENT_ID) ? ENV_CLIENT_ID : null;
}

/** The Client ID used for sign-in: the shared app first in public builds, then a browser override. */
export function getClientId(): string | null {
  const deployment = deploymentClientId();
  if (deployment && !allowPersonalSources()) return deployment;
  const id = localStorage.getItem(CLIENT_ID_KEY)?.trim();
  if (id && CLIENT_ID_PATTERN.test(id)) return id;
  return deployment;
}

export function setClientId(id: string): void {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
}

export function clearClientId(): void {
  localStorage.removeItem(CLIENT_ID_KEY);
}

/** True when the browser is overriding a deployment-provided Client ID. */
export function hasLocalClientIdOverride(): boolean {
  if (hasDeploymentClientId() && !allowPersonalSources()) return false;
  return Boolean(localStorage.getItem(CLIENT_ID_KEY)?.trim());
}

/** True when this build can ask for a personal Spotify app Client ID. */
export function allowsPersonalSpotify(): boolean {
  return allowPersonalSources();
}

/**
 * The exact redirect URI Solo answers on — must be registered in the Spotify
 * dashboard. VITE_SPOTIFY_REDIRECT_URI wins when set (custom domains, preview
 * proxies); otherwise it resolves from the current origin, which handles root
 * hosts (https://domain/callback) and sub-path deployments.
 */
export function redirectUri(): string {
  if (ENV_REDIRECT_URI) return ENV_REDIRECT_URI;
  return new URL(`${import.meta.env.BASE_URL}callback`, window.location.href).href;
}

export const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-modify-playback-state',
  'streaming',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

/** Accepts a ?client_id= URL parameter (for one-off shared-Client-ID links). */
export function consumeClientIdParam(): string | null {
  const url = new URL(window.location.href);
  const param = url.searchParams.get('client_id');
  if (!param) return null;
  url.searchParams.delete('client_id');
  window.history.replaceState({}, '', url.origin + url.pathname + (url.searchParams.size ? `?${url.searchParams}` : ''));
  if (CLIENT_ID_PATTERN.test(param)) {
    setClientId(param);
    return param;
  }
  return null;
}
