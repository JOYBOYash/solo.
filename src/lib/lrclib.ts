// Lyrics lookup across two free, keyless, CORS-enabled sources:
//
//   • LRCLIB (https://lrclib.net) — synced LRC and plain lyrics.
//   • lyrics.ovh — a plain-text fallback when LRCLIB has no usable record.
//
// Streaming titles are ambiguous ("Mood", "Mood (Remix)", "Mood - Live"), so
// every candidate is scored against the real Spotify title, artists, album,
// duration and version markers. A version-tagged track never falls back to the
// plain version's words: showing no lyrics is better than showing the wrong
// song's lyrics.

import {
  cleanArtist,
  cleanTitle,
  isInstrumentalTitle,
  lyricsTitle,
  normalizeName,
  tokenOverlap,
  versionTags,
  type VersionTag,
} from './clean';

const BASE = 'https://lrclib.net';
const OVH_BASE = 'https://api.lyrics.ovh/v1';
const ITUNES_BASE = 'https://itunes.apple.com/search';
const CLIENT_IDENTITY = 'Solo 1.0.0 (public duet player)';
const MATCH_THRESHOLD = 48;
const MIN_ARTIST_SCORE = 12;
const REQUEST_TIMEOUT_MS = 8000;

/** Abort a stalled third-party request; undefined if the browser lacks it. */
function requestSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

export interface LyricLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface Lyrics {
  synced: LyricLine[] | null;
  plain: string | null;
  source?: 'lrclib' | 'lyrics.ovh';
  /** The track has no words (explicit instrumental / backing track). */
  instrumental?: boolean;
}

interface LrcRecord {
  id?: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

interface ItunesTrack {
  trackName?: string;
  artistName?: string;
  trackTimeMillis?: number;
}

interface MatchTarget {
  rawTitle: string;
  queryTitle: string;
  coreTitle: string;
  artists: string[];
  primary: string;
  artistKeys: string[];
  albumName: string;
  durationSec: number;
  expectedTags: VersionTag[];
}

const cache = new Map<string, Lyrics>();
const inflight = new Map<string, Promise<Lyrics>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lrcFetch(path: string): Promise<Response | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        'Lrclib-Client': CLIENT_IDENTITY,
        'X-User-Agent': CLIENT_IDENTITY,
      },
      signal: requestSignal(),
    });
    if (res.ok) return res;
    if (res.status === 429 || res.status === 503) {
      const retry = Number(res.headers.get('Retry-After') ?? '2');
      await sleep(Math.min(10, Math.max(1, retry)) * 1000);
      const second = await fetch(`${BASE}${path}`, {
        headers: {
          'Lrclib-Client': CLIENT_IDENTITY,
          'X-User-Agent': CLIENT_IDENTITY,
        },
        signal: requestSignal(),
      });
      if (second.ok) return second;
    }
  } catch {
    /* offline, ad-blocked, timed out or CORS failure — treated as "no lyrics" */
  }
  // 404 (no record) and other failures simply mean "no lyrics".
  return null;
}

async function searchLrc(trackName: string, artistName: string): Promise<LrcRecord[]> {
  const params = new URLSearchParams({ track_name: trackName });
  if (artistName) params.set('artist_name', artistName);
  const res = await lrcFetch(`/api/search?${params.toString()}`);
  if (!res) return [];
  try {
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as LrcRecord[]) : [];
  } catch {
    return [];
  }
}

async function searchLrcQuery(query: string): Promise<LrcRecord[]> {
  const res = await lrcFetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!res) return [];
  try {
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as LrcRecord[]) : [];
  } catch {
    return [];
  }
}

/** Parse an LRC document: `[mm:ss.xx] line` (multiple stamps per line allowed). */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  const stamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of text.split(/\r?\n/)) {
    stamp.lastIndex = 0;
    const times: number[] = [];
    let match: RegExpExecArray | null;
    let end = 0;
    while ((match = stamp.exec(raw)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(match[3].padEnd(3, '0').slice(0, 3)) : 0;
      times.push(minutes * 60 + seconds + fraction / 1000);
      // A failed exec resets lastIndex, so remember the end of the last stamp.
      end = stamp.lastIndex;
    }
    if (!times.length) continue;
    const line = raw.slice(end).trim();
    for (const time of times) out.push({ time, text: line });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function recordToLyrics(record: LrcRecord): Lyrics {
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : null;
  const plain = record.plainLyrics?.trim() || null;
  return {
    synced: synced && synced.length ? synced : null,
    plain,
    source: 'lrclib',
  };
}

function sanitizePlain(raw: string): string {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return '';
  if (/^(?:instrumental|no lyrics|sorry,? no lyrics)/i.test(text)) return '';
  return text.replace(/\n{3,}/g, '\n\n');
}

interface ScoredRecord {
  record: LrcRecord;
  score: number;
  artistScore: number;
}

function wordCount(value: string): number {
  return value ? value.split(' ').filter(Boolean).length : 0;
}

/** True when every meaningful word in `needle` appears in `haystack`. */
function hasEveryWord(needle: string, haystack: string): boolean {
  const words = needle.split(' ').filter(Boolean);
  if (!words.length) return false;
  const set = new Set(haystack.split(' ').filter(Boolean));
  return words.every((word) => set.has(word));
}

function scoreCandidate(record: LrcRecord, target: MatchTarget): ScoredRecord {
  let score = 0;

  const rawTitle = record.trackName ?? '';
  const candidateTitle = normalizeName(rawTitle);
  const candidateLyricsKey = normalizeName(lyricsTitle(rawTitle));
  const candidateCoreKey = normalizeName(cleanTitle(rawTitle));
  const queryKey = normalizeName(target.queryTitle);
  const coreKey = normalizeName(target.coreTitle);

  // Title evidence is a hard gate. Artist and duration alone must never match
  // a different song — especially when both are generic ("Mood" vs "Mood Ring").
  let titleScore = 0;
  if (candidateTitle && candidateTitle === queryKey) titleScore = 36;
  else if (candidateLyricsKey && candidateLyricsKey === queryKey) titleScore = 34;
  else if (candidateCoreKey && candidateCoreKey === queryKey) titleScore = 32;
  else if (candidateTitle && candidateTitle === coreKey) titleScore = 30;
  else if (candidateLyricsKey && candidateLyricsKey === coreKey) titleScore = 28;
  else if (candidateCoreKey && candidateCoreKey === coreKey) titleScore = 26;
  else {
    // Multi-word titles may have extra release words or a different word
    // order. A single-word target must match exactly, not merely be contained
    // in a longer, different title.
    const queryContained =
      wordCount(queryKey) >= 2 && hasEveryWord(queryKey, candidateLyricsKey);
    const coreContained =
      wordCount(coreKey) >= 2 && hasEveryWord(coreKey, candidateCoreKey);
    if (queryContained || coreContained) {
      titleScore = 18;
    } else {
      const overlap = Math.max(
        tokenOverlap(candidateLyricsKey, queryKey),
        tokenOverlap(candidateCoreKey, coreKey),
      );
      if (overlap >= 0.6) titleScore = Math.round(overlap * 12);
    }
  }
  if (!titleScore) score -= 400;
  else score += titleScore;

  const candidateArtist = normalizeName(record.artistName ?? '');
  const primaryKey = normalizeName(target.primary);
  let artistScore = 0;
  if (primaryKey && candidateArtist.includes(primaryKey)) {
    artistScore = 28;
  } else if (primaryKey && tokenOverlap(candidateArtist, primaryKey) >= 0.5) {
    artistScore = 18;
  } else if (
    target.artistKeys.some((key) => key && candidateArtist.includes(key))
  ) {
    artistScore = 14;
  }
  score += artistScore;

  // Featured artists are often only present in one of the two credit fields.
  const credits = normalizeName(`${record.trackName ?? ''} ${record.artistName ?? ''}`);
  for (const key of target.artistKeys.slice(1)) {
    if (key && credits.includes(key)) score += 4;
  }

  const candidateTags = versionTags(record.trackName ?? '');
  // Some databases put the version marker in the album field instead.
  const tagPool = new Set<VersionTag>([
    ...candidateTags,
    ...versionTags(record.albumName ?? ''),
  ]);

  // A version-tagged track must not borrow the words of another version. This
  // is a hard gate, not a soft penalty: no remix lyrics is a better outcome
  // than the original song's lyrics under a remix title.
  if (target.expectedTags.length) {
    const matchesEveryTag = target.expectedTags.every((tag) => tagPool.has(tag));
    if (!matchesEveryTag) score -= 400;
  } else if (tagPool.size > 0) {
    // The Spotify title has no version marker, so a candidate carrying one is
    // a different recording (live, remix, instrumental, …).
    score -= 400;
  }

  for (const tag of target.expectedTags) {
    score += candidateTags.includes(tag) ? 12 : 0;
  }
  for (const tag of candidateTags) {
    if (!target.expectedTags.includes(tag)) {
      score -= tag === 'instrumental' || tag === 'karaoke' ? 35 : 16;
    }
  }
  if (record.instrumental && !target.expectedTags.includes('instrumental')) {
    score -= 200;
  }

  if (record.duration > 0 && target.durationSec > 0) {
    const diff = Math.abs(record.duration - target.durationSec);
    if (diff <= 1.5) score += 30;
    else if (diff <= 3) score += 24;
    else if (diff <= 5) score += 14;
    else if (diff <= 10) score += 2;
    else if (diff <= 16) score -= 10;
    else if (diff <= 25) score -= 20;
    else score -= 32;
  }

  const albumKey = normalizeName(target.albumName);
  const candidateAlbum = normalizeName(record.albumName ?? '');
  if (albumKey && candidateAlbum) {
    if (candidateAlbum === albumKey) score += 8;
    else if (
      candidateAlbum.includes(albumKey) ||
      albumKey.includes(candidateAlbum)
    ) {
      score += 6;
    } else {
      score += Math.round(tokenOverlap(candidateAlbum, albumKey) * 4);
    }
  }

  if (record.syncedLyrics) score += 12;
  else if (record.plainLyrics) score += 2;

  const words = (record.syncedLyrics ?? record.plainLyrics ?? '').trim();
  if (words.length < 20) score -= 90;

  return { record, score, artistScore };
}

function candidateKey(record: LrcRecord): string {
  return [
    normalizeName(record.trackName ?? ''),
    normalizeName(record.artistName ?? ''),
    Math.round(record.duration || 0),
    record.syncedLyrics ? 's' : 'p',
  ].join('|');
}

function dedupe(records: LrcRecord[]): LrcRecord[] {
  const seen = new Set<string>();
  const out: LrcRecord[] = [];
  for (const record of records) {
    if (!record || typeof record.trackName !== 'string') continue;
    const key = candidateKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

function itunesTitleMatches(itemTitle: string, target: MatchTarget): boolean {
  const candidateRaw = normalizeName(itemTitle);
  const candidateLyrics = normalizeName(lyricsTitle(itemTitle));
  const candidateCore = normalizeName(cleanTitle(itemTitle));
  const wanted = Array.from(
    new Set(
      [normalizeName(target.queryTitle), normalizeName(target.coreTitle)].filter(
        Boolean,
      ),
    ),
  );
  if (
    wanted.some(
      (key) =>
        candidateRaw === key || candidateLyrics === key || candidateCore === key,
    )
  ) {
    return true;
  }
  // The same multi-word rule as LRCLIB scoring: extra release words are fine,
  // but a one-word title must match exactly.
  return wanted.some(
    (key) =>
      wordCount(key) >= 2 &&
      (hasEveryWord(key, candidateLyrics) || hasEveryWord(key, candidateCore)),
  );
}

/** Exact-or-collaboration artist credit, e.g. "Adele" or "24kGoldn & iann dior". */
function itunesArtistMatches(candidate: string, primary: string): boolean {
  if (!candidate || !primary) return false;
  if (candidate === primary) return true;
  if (!candidate.startsWith(`${primary} `)) return false;
  const rest = candidate.slice(primary.length + 1);
  return /^(?:and|feat|ft|with|vs|x)\b/.test(rest);
}

/**
 * lyrics.ovh has no metadata and fuzzy-matches unknown titles. Before using it,
 * confirm that the exact song exists in the free iTunes Search catalog, with a
 * compatible artist and duration. If this check cannot run, show no lyrics
 * rather than guessed lyrics.
 */
async function verifySongForOvh(target: MatchTarget): Promise<string | null> {
  const term = `${target.primary} ${target.queryTitle}`.trim();
  if (!term) return null;
  try {
    const res = await fetch(
      `${ITUNES_BASE}?term=${encodeURIComponent(term)}&entity=song&limit=12`,
      { headers: { Accept: 'application/json' }, signal: requestSignal() },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: ItunesTrack[] };
    const primaryKey = normalizeName(target.primary);
    for (const item of data.results ?? []) {
      const title = item.trackName?.trim();
      const artist = item.artistName?.trim();
      if (!title || !artist) continue;
      // The target has no version tag here, so a version-tagged catalog hit is
      // a different recording and must not validate the fallback.
      if (versionTags(title).length) continue;
      if (!itunesTitleMatches(title, target)) continue;
      if (!itunesArtistMatches(normalizeName(artist), primaryKey)) continue;
      if (target.durationSec > 0 && item.trackTimeMillis) {
        const diff = Math.abs(item.trackTimeMillis / 1000 - target.durationSec);
        if (diff > 10) continue;
      }
      return title;
    }
  } catch {
    /* validation unavailable — fall through to no lyrics */
  }
  return null;
}

async function fetchOvh(target: MatchTarget): Promise<Lyrics | null> {
  if (!target.primary) return null;
  // lyrics.ovh returns plain text with no version metadata and will happily
  // serve the original's words for a remix/live/acoustic title. Since that
  // cannot be verified, version-tagged tracks rely on LRCLIB alone.
  if (target.expectedTags.length) return null;

  // lyrics.ovh also fuzzy-matches unknown titles (it returns *something* for a
  // song that does not exist). Confirm the exact recording in the public
  // iTunes catalog before trusting it.
  const verifiedTitle = await verifySongForOvh(target);
  if (!verifiedTitle) return null;

  const titles = Array.from(
    new Set([verifiedTitle, target.queryTitle, target.coreTitle].filter(Boolean)),
  );

  for (const title of titles) {
    if (!title) continue;
    try {
      const res = await fetch(
        `${OVH_BASE}/${encodeURIComponent(target.primary)}/${encodeURIComponent(title)}`,
        { headers: { Accept: 'application/json' }, signal: requestSignal() },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { lyrics?: string };
      const plain = sanitizePlain(data.lyrics ?? '');
      if (plain) return { synced: null, plain, source: 'lyrics.ovh' };
    } catch {
      /* try the next spelling, or give up quietly */
    }
  }
  return null;
}

function pickBest(
  records: LrcRecord[],
  target: MatchTarget,
): ScoredRecord | undefined {
  return dedupe(records)
    .map((record) => scoreCandidate(record, target))
    .sort((a, b) => b.score - a.score)[0];
}

function isConfident(best: ScoredRecord | undefined): best is ScoredRecord {
  return Boolean(
    best &&
      best.score >= MATCH_THRESHOLD &&
      best.artistScore >= MIN_ARTIST_SCORE,
  );
}

async function resolveLyrics(target: MatchTarget): Promise<Lyrics> {
  if (isInstrumentalTitle(target.rawTitle)) {
    return { synced: null, plain: null, source: 'lrclib', instrumental: true };
  }

  const records: LrcRecord[] = [];
  const queries = Array.from(
    new Set([target.queryTitle, target.coreTitle].filter(Boolean)),
  );
  const triedQueries = new Set<string>();

  // The version-preserving title is tried first so a remix search never gets
  // buried under the original version's results.
  for (const query of queries) {
    if (!target.primary) break;
    triedQueries.add(query);
    const found = await searchLrc(query, target.primary);
    records.push(...found);
    if (found.length) break;
  }

  // Free-text search is broader and only needed when the metadata search
  // returned nothing. Try the version-preserving spelling first.
  const broadQueries = Array.from(
    new Set(
      queries.map((query) => `${query} ${target.primary}`.trim()).filter(Boolean),
    ),
  );
  if (!records.length) {
    for (const query of broadQueries) {
      triedQueries.add(query);
      const found = await searchLrcQuery(query);
      records.push(...found);
      if (found.length) break;
    }
  }

  let best = pickBest(records, target);

  // A remix/live title can have its own LRCLIB record that the track_name
  // endpoint does not surface, while the search above still fills up with
  // original-version rows. One bounded free-text pass gives the tagged
  // recording a chance; the version gate still rejects anything else.
  if (!isConfident(best) && target.expectedTags.length && target.primary) {
    const extraQuery = `${target.queryTitle} ${target.primary}`.trim();
    if (extraQuery && !triedQueries.has(extraQuery)) {
      records.push(...(await searchLrcQuery(extraQuery)));
      best = pickBest(records, target);
    }
  }

  if (isConfident(best)) return recordToLyrics(best.record);

  // lyrics.ovh has no metadata and can fuzzy-match a different song. Use it
  // only when LRCLIB knows nothing about this title at all.
  if (dedupe(records).length) return { synced: null, plain: null };

  const fallback = await fetchOvh(target);
  if (fallback) return fallback;

  return { synced: null, plain: null };
}

/**
 * Fetch lyrics for a Spotify track, choosing the best-matching source record.
 * Successful lookups are cached per title/artist/album/duration bucket, and
 * concurrent requests for the same song share one network round-trip.
 */
export async function fetchLyrics(
  trackName: string,
  artists: string[],
  albumName: string,
  durationMs: number,
): Promise<Lyrics> {
  const rawTitle = trackName.trim();
  const primary = cleanArtist(artists);
  const durationSec = Math.max(0, Math.round((durationMs || 0) / 1000));
  const key = [
    normalizeName(rawTitle),
    normalizeName(artists.join(' ')),
    normalizeName(albumName),
    Math.round(durationSec / 5),
  ].join('::');

  const cached = cache.get(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const target: MatchTarget = {
    rawTitle,
    queryTitle: lyricsTitle(rawTitle),
    coreTitle: cleanTitle(rawTitle),
    artists,
    primary,
    artistKeys: artists.map((artist) => normalizeName(artist)).filter(Boolean),
    albumName,
    durationSec,
    expectedTags: versionTags(rawTitle),
  };

  const promise = resolveLyrics(target)
    .then((lyrics) => {
      // Cache real answers and confirmed instrumentals, not transient misses.
      if (lyrics.synced?.length || lyrics.plain || lyrics.instrumental) {
        cache.set(key, lyrics);
      }
      return lyrics;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
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
