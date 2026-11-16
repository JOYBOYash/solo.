// Keyless Audius API client. Audius streams independently released music and
// needs no account, token or backend — every request is public and CORS-enabled.
//
// API guide: https://docs.audius.org/developers/

import type { FreeTrack } from './playback';

const BASE = 'https://api.audius.co/v1';
const APP_NAME = 'Solo';

interface AudiusUser {
  name?: string;
  handle?: string;
}

interface AudiusArtwork {
  '150x150'?: string;
  '480x480'?: string;
  '1000x1000'?: string;
}

interface AudiusTrack {
  id?: string;
  title?: string;
  duration?: number;
  artwork?: AudiusArtwork;
  user?: AudiusUser;
  stream?: { url?: string };
  access?: { stream?: boolean };
}

interface AudiusResponse {
  data?: AudiusTrack[];
}

function streamUrl(track: AudiusTrack): string | undefined {
  if (track.access?.stream === false) return undefined;
  if (track.stream?.url) return track.stream.url;
  if (track.id) return `${BASE}/tracks/${encodeURIComponent(track.id)}/stream?app_name=${APP_NAME}`;
  return undefined;
}

function toFreeTrack(track: AudiusTrack): FreeTrack | null {
  if (!track.id || !track.title) return null;
  const url = streamUrl(track);
  if (!url) return null;
  return {
    id: track.id,
    source: 'audius',
    name: track.title.trim(),
    artist: track.user?.name?.trim() || track.user?.handle || 'Audius artist',
    artworkUrl:
      track.artwork?.['480x480'] ||
      track.artwork?.['1000x1000'] ||
      track.artwork?.['150x150'],
    durationMs: Math.max(0, Number(track.duration) || 0) * 1000,
    streamUrl: url,
  };
}

async function getTracks(path: string): Promise<FreeTrack[]> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Audius could not answer that request (${res.status}). Try again in a moment.`);
  }
  const body = (await res.json()) as AudiusResponse;
  return (body.data ?? [])
    .map(toFreeTrack)
    .filter((track): track is FreeTrack => Boolean(track));
}

/** Trending independent music, refreshed by Audius regularly. */
export function trendingAudius(limit = 40): Promise<FreeTrack[]> {
  return getTracks(`/tracks/trending?app_name=${APP_NAME}&limit=${Math.min(100, limit)}`);
}

/** Full-text song search. Empty queries fall back to trending. */
export function searchAudius(query: string, limit = 40): Promise<FreeTrack[]> {
  const q = query.trim();
  if (!q) return trendingAudius(limit);
  return getTracks(
    `/tracks/search?query=${encodeURIComponent(q)}&app_name=${APP_NAME}&limit=${Math.min(100, limit)}`,
  );
}
