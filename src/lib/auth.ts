// Authorization Code flow with PKCE, fully client-side.
// Spotify requires: HTTPS redirect URIs (loopback http://127.0.0.1 is allowed),
// an exact redirect URI match, and a S256 code challenge.

import { getClientId, redirectUri, SPOTIFY_SCOPES } from './config';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const PKCE_KEY = 'solo.pkce';
const TOKENS_KEY = 'solo.tokens';

let refreshInFlight: Promise<string> | null = null;
let sessionEpoch = 0;

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  /** Unix ms when the access token stops being usable (with safety margin). */
  expiresAt: number;
}

interface PkcePending {
  verifier: string;
  state: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes.buffer);
}

export function getTokens(): Tokens | null {
  const raw = localStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Tokens;
    if (parsed.accessToken && parsed.expiresAt) return parsed;
  } catch {
    /* fall through */
  }
  return null;
}

function saveTokens(tokens: Tokens): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function logout(): void {
  sessionEpoch++;
  refreshInFlight = null;
  localStorage.removeItem(TOKENS_KEY);
  sessionStorage.removeItem(PKCE_KEY);
}

export function isLoggedIn(): boolean {
  return getTokens() !== null;
}

/** Redirect the browser to Spotify's authorize page. */
export async function login(): Promise<void> {
  const clientId = getClientId();
  if (!clientId) throw new AuthError('No Spotify Client ID is configured yet.');

  const verifier = randomString(96);
  const state = randomString(16);
  const hashed = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64url(hashed);

  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state } satisfies PkcePending));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    redirect_uri: redirectUri(),
    state,
  });

  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

/**
 * If the current URL is the OAuth callback, exchange the code for tokens,
 * clean the URL, and return true. Throws a friendly AuthError when Spotify
 * returned an error or the state check fails.
 */
export async function handleCallbackIfPresent(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return false;

  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams) params.set(k, v);
  window.history.replaceState({}, '', url.origin + url.pathname);

  if (error) {
    const friendly =
      error === 'access_denied'
        ? 'Authorization was declined. Solo needs Spotify access to run your duets.'
        : `Spotify sign-in failed (${error}).`;
    throw new AuthError(friendly);
  }
  if (!code || !state) return false;

  const pendingRaw = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  let pending: PkcePending | null = null;
  if (pendingRaw) {
    try {
      pending = JSON.parse(pendingRaw) as PkcePending;
    } catch {
      pending = null;
    }
  }
  if (!pending || pending.state !== state) {
    throw new AuthError('Sign-in could not be verified. Please try connecting again.');
  }

  const clientId = getClientId();
  if (!clientId) throw new AuthError('No Spotify Client ID is configured yet.');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: pending.verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new AuthError(`Spotify rejected the sign-in (${res.status}). ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const previous = getTokens();
  sessionEpoch++;
  saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  });
  return true;
}

/**
 * Returns a valid access token, refreshing silently when needed.
 *
 * `force` skips the expiry check and refreshes even if the stored token still
 * looks valid — used after Spotify rejects a token with 401. Concurrent callers
 * share one refresh request, which matters because Spotify rotates refresh
 * tokens.
 */
export async function ensureToken(force = false): Promise<string> {
  const tokens = getTokens();
  if (!force && tokens && Date.now() < tokens.expiresAt) return tokens.accessToken;
  if (!tokens?.refreshToken) {
    logout();
    throw new AuthError('Your Spotify session has ended. Please connect again.');
  }

  if (refreshInFlight) return refreshInFlight;

  const epoch = sessionEpoch;
  const refreshToken = tokens.refreshToken;
  refreshInFlight = (async () => {
    const clientId = getClientId();
    if (!clientId) throw new AuthError('No Spotify Client ID is configured.');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    // A logout (or a fresh sign-in) happened while this request was in flight.
    if (epoch !== sessionEpoch) {
      throw new AuthError('Your Spotify session changed. Please try again.');
    }

    if (!res.ok) {
      logout();
      throw new AuthError('Your Spotify session has expired. Please connect again.');
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    });
    return data.access_token;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}
