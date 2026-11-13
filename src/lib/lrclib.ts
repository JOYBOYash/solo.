// LRCLIB (https://lrclib.net) — a free, open lyrics database with a
// CORS-enabled API that needs no key. Used for time-synced karaoke lyrics.
// The client identifies itself via the Lrclib-Client header (browser JS cannot
// set the User-Agent header) and honors Retry-After on 429/503.

import { cleanArtist, cleanTitle } from './clean';

const BASE = 'https://lrclib.net';
const CLIENT_IDENTITY = 'Solo 1.0.0 (public duet player)';

export interface LyricLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface Lyrics {
  synced: LyricLine[] | null;
  plain: string | null;
}

interface LrcRecord {
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

const cache = new Map<string, Lyrics>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lrcFetch(path: string): Promise<Response | null> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Lrclib-Client': CLIENT_IDENTITY, 'X-User-Agent': CLIENT_IDENTITY },
  });
  if (res.ok) return res;
  if (res.status === 429 || res.status === 503) {
    const retry = Number(res.headers.get('Retry-After') ?? '2');
    await sleep(Math.min(10, Math.max(1, retry)) * 1000);
    const second = await fetch(`${BASE}${path}`, {
      headers: { 'Lrclib-Client': CLIENT_IDENTITY, 'X-User-Agent': CLIENT_IDENTITY },
    });
    if (second.ok) return second;
  }
  // 404 (no record) and other failures simply mean "no lyrics".
  return null;
}

/** Parse an LRC document: `[mm:ss.xx] line` (multiple stamps per line allowed). */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  const stamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of text.split(/\r?\n/)) {
    stamp.lastIndex = 0;
    const times: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = stamp.exec(raw)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(match[3].padEnd(3, '0').slice(0, 3)) : 0;
      times.push(minutes * 60 + seconds + fraction / 1000);
    }
    if (!times.length) continue;
    const line = raw.slice(stamp.lastIndex).trim();
    for (const time of times) out.push({ time, text: line });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function recordToLyrics(record: LrcRecord): Lyrics {
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : null;
  return {
    synced: synced && synced.length ? synced : null,
    plain: record.plainLyrics ?? null,
  };
}

/**
 * Fetch lyrics for a Spotify track. Tries the exact-match endpoint first
 * (with duration, which improves matching), then a fuzzy search.
 */
export async function fetchLyrics(
  trackName: string,
  artists: string[],
  albumName: string,
  durationMs: number,
): Promise<Lyrics> {
  const title = cleanTitle(trackName);
  const artist = cleanArtist(artists);
  const key = `${title}::${artist}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const headers = { 'Lrclib-Client': CLIENT_IDENTITY, 'X-User-Agent': CLIENT_IDENTITY };
  const duration = Math.round(durationMs / 1000);

  let lyrics: Lyrics = { synced: null, plain: null };

  if (title && artist) {
    const exactPath =
      `/api/get?track_name=${encodeURIComponent(title)}` +
      `&artist_name=${encodeURIComponent(artist)}` +
      `&album_name=${encodeURIComponent(albumName)}` +
      (duration >= 1 && duration <= 3600 ? `&duration=${duration}` : '');
    const res = await fetch(`${BASE}${exactPath}`, { headers });
    if (res.ok) {
      lyrics = recordToLyrics((await res.json()) as LrcRecord);
    } else if (res.status === 429 || res.status === 503) {
      const retry = Number(res.headers.get('Retry-After') ?? '2');
      await sleep(Math.min(10, Math.max(1, retry)) * 1000);
      const second = await fetch(`${BASE}${exactPath}`, { headers });
      if (second.ok) lyrics = recordToLyrics((await second.json()) as LrcRecord);
    }

    if (!lyrics.synced && !lyrics.plain) {
      const searchRes = await lrcFetch(
        `/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`,
      );
      if (searchRes) {
        const records = (await searchRes.json()) as LrcRecord[];
        const withSync = records.filter((r) => r.syncedLyrics);
        const withPlain = records.filter((r) => r.plainLyrics && !r.instrumental);
        const pickClosest = (pool: LrcRecord[]): LrcRecord | undefined =>
          pool
            .slice()
            .sort(
              (a, b) =>
                Math.abs((a.duration - duration)) - Math.abs((b.duration - duration)),
            )[0];
        const best = pickClosest(withSync) ?? pickClosest(withPlain);
        if (best) lyrics = recordToLyrics(best);
      }
    }
  }

  cache.set(key, lyrics);
  return lyrics;
}

/** Index of the active line for a playback position (-1 before the first line). */
export function activeLineIndex(lines: LyricLine[], positionSec: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= positionSec) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx;
}
