// Spotify track and artist names are messy: "Song (feat. X) - Remastered 2011".
// LRCLIB matches much better on a cleaned title and the primary artist.

const DASH_KEYWORDS =
  /(remaster|remaster|version|edit|mix|deluxe|anniversary|bonus|mono|stereo|feat|ft\.?|featuring|single|radio|session|instrumental|karaoke)/i;

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

/** Primary artist for lyrics matching ("A feat. B" -> "A", multi-artist lists -> first). */
export function cleanArtist(artists: string[]): string {
  const primary = (artists[0] ?? '').trim();
  if (!primary) return '';
  const cut = primary.split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?)\s+/i)[0];
  return cut.trim() || primary;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
