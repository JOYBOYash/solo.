// Spotify track and artist names are messy: "Song (feat. X) - Remastered 2011".
// Lyrics databases match much better on a cleaned title and the primary artist.

const DASH_KEYWORDS =
  /(remaster|version|edit|mix|deluxe|anniversary|bonus|mono|stereo|feat|ft\.?|featuring|single|radio|session|instrumental|karaoke)/i;

export function cleanTitle(raw: string): string {
  let t = raw.trim();
  if (!t) return raw;

  // Remove bracketed annotations like "(feat. Someone)" or "[Live]" or "{...}".
  const bracket = /\s*[([{][^)\]}]*[)\]}]/g;
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(bracket, ' ');
  }

  // Drop dash-separated suffixes such as "- 2011 Remaster" / "- Live Version".
  const parts = t.split(/\s+[-–—]\s+/);
  if (parts.length > 1) {
    const kept = parts.filter((p) => !DASH_KEYWORDS.test(p));
    t = kept.length ? kept.join(' - ') : parts[0];
  }

  t = t.replace(/\s+/g, ' ').trim();
  return t || raw.trim();
}

/**
 * A version-preserving query title for lyrics databases.
 *
 * Streaming titles often carry a feature credit that lyrics sites omit, while
 * words such as "Remix", "Live" or "Acoustic" identify an entirely different
 * set of lyrics and must stay. This strips only credits and pure release
 * metadata (remaster, explicit, deluxe, …).
 */
export function lyricsTitle(raw: string): string {
  let t = raw.trim();
  if (!t) return raw;

  const featureGroup =
    /\s*[([{]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]}]*[)\]}]/gi;
  const metadataGroup =
    /\s*[([{]\s*[^)\]}]*\b(?:remaster(?:ed)?|explicit|clean|deluxe|bonus|anniversary|mono|stereo)\b[^)\]}]*[)\]}]/gi;

  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(featureGroup, ' ').replace(metadataGroup, ' ');
  }

  // "- feat. X" at the end of a title.
  t = t.replace(
    /\s+[-–—]\s+(?:feat\.?|ft\.?|featuring|with)\s+.*$/i,
    ' ',
  );

  // Dash-separated release metadata: "- 2011 Remaster", "- Radio Edit".
  t = t.replace(
    /\s+[-–—]\s+(?:(?:19|20)\d{2}\s+)?(?:digital\s+)?(?:remaster(?:ed)?|radio\s+edit|album\s+version|single\s+version|explicit|clean)\b.*$/i,
    ' ',
  );

  t = t.replace(/\s+/g, ' ').trim();
  return t || raw.trim();
}

/** Primary artist for lyrics matching ("A feat. B" -> "A", multi-artist lists -> first). */
export function cleanArtist(artists: string[]): string {
  const primary = (artists[0] ?? '').trim();
  if (!primary) return '';
  const cut = primary.split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?)\s+/i)[0];
  return cut.trim() || primary;
}

export type VersionTag =
  | 'remix'
  | 'live'
  | 'acoustic'
  | 'instrumental'
  | 'karaoke'
  | 'demo'
  | 'cover'
  | 'spedup'
  | 'slowed'
  | 'extended';

const VERSION_RULES: { tag: VersionTag; pattern: RegExp }[] = [
  { tag: 'remix', pattern: /\bremix\b|\brmx\b|\bbootleg\b|\bmash-?up\b/i },
  { tag: 'live', pattern: /\blive\b|\bin concert\b|\bconcert\b/i },
  { tag: 'acoustic', pattern: /\bacoustic\b|\bunplugged\b|\bstripped\b/i },
  {
    tag: 'instrumental',
    pattern: /\binstrumental\b|\bbacking track\b|\bminus one\b/i,
  },
  { tag: 'karaoke', pattern: /\bkaraoke\b/i },
  { tag: 'demo', pattern: /\bdemo\b/i },
  { tag: 'cover', pattern: /\bcover\b|\btribute\b/i },
  { tag: 'spedup', pattern: /\bsped\s*up\b|\bnightcore\b/i },
  { tag: 'slowed', pattern: /\bslowed\b|\breverb\b/i },
  { tag: 'extended', pattern: /\bextended\b|\bclub mix\b/i },
];

/**
 * The part of a title that can carry a version marker: bracketed groups,
 * dash-separated suffixes, and a trailing version word ("Mood Remix"). Version
 * words that are simply part of the song's name ("Live Forever", "Cover Me")
 * must not turn a normal track into a version-gated one.
 */
function versionTagSource(raw: string): string {
  const parts: string[] = [];
  const bracket = /[([{]([^)\]}]*)[)\]}]/g;
  let match: RegExpExecArray | null;
  while ((match = bracket.exec(raw)) !== null) parts.push(match[1]);

  const dashed = raw.split(/\s+[-–—]\s+/);
  if (dashed.length > 1) parts.push(...dashed.slice(1));

  const trailing = raw.match(
    /\b(?:remix|rmx|live|acoustic|unplugged|instrumental|karaoke|demo|cover|sped\s*up|nightcore|slowed|extended)\s*$/i,
  );
  if (trailing?.index !== undefined && raw.slice(0, trailing.index).trim()) {
    parts.push(trailing[0]);
  }

  return parts.join(' | ');
}

/** Meaningful version markers in a track title. Remasters are ignored. */
export function versionTags(raw: string): VersionTag[] {
  const source = versionTagSource(raw);
  const tags: VersionTag[] = [];
  for (const { tag, pattern } of VERSION_RULES) {
    if (pattern.test(source)) tags.push(tag);
  }
  return tags;
}

/** True for an explicitly instrumental title (karaoke can still carry lyrics). */
export function isInstrumentalTitle(raw: string): boolean {
  const tags = versionTags(raw);
  return tags.includes('instrumental') && !tags.includes('karaoke');
}

/** Lowercase, accent-free, punctuation-free text for fuzzy comparisons. */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Share of meaningful words two titles have in common (Jaccard, 0..1). */
export function tokenOverlap(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      normalizeName(s)
        .split(' ')
        .filter((w) => w.length > 1 || /^\d+$/.test(w)),
    );
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
