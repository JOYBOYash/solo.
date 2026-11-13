// Shell, connect screen, library (playlists + song search) and playlist view.

import { getClientId, redirectUri, setClientId } from './lib/config';
import { login, logout, isLoggedIn } from './lib/auth';
import {
  getPlaylists,
  getPlaylistDetail,
  getPlaylistTracks,
  searchTracks,
  type Playlist,
  type Track,
} from './lib/api';
import { formatMs } from './lib/clean';
import { el, artwork, avatar, toast, dominantTint } from './dom';
import { store, type RoomContext } from './store';
import { renderRoom, closeRoom } from './room';

const app = document.getElementById('app') as HTMLElement;

function shell(content: HTMLElement): void {
  const me = store.me;
  document.body.style.background = '';
  app.replaceChildren(
    el(
      'header',
      { class: 'nav' },
      el(
        'div',
        { class: 'nav-inner' },
        el('a', { class: 'brand', href: '#', onclick: (e) => { e.preventDefault(); goLibrary(); } },
          'Solo', el('span', { class: 'brand-dot' }, '.')),
        el(
          'div',
          { class: 'nav-user' },
          me
            ? el(
                'div',
                { class: 'user-chip' },
                avatar(me.images, me.display_name ?? me.id),
                el('span', { class: 'user-name' }, me.display_name ?? me.id),
                el(
                  'span',
                  { class: 'plan-badge' },
                  me.product === 'premium' ? 'Premium' : me.product === 'open' ? 'Free plan' : me.product,
                ),
              )
            : null,
          isLoggedIn()
            ? el('button', {
                class: 'btn btn-small',
                onclick: () => {
                  logout();
                  location.reload();
                },
              }, 'Log out')
            : null,
        ),
      ),
    ),
    content,
    el(
      'footer',
      { class: 'footer' },
      el(
        'div',
        { class: 'footer-inner' },
        el('span', {}, 'Solo — a personal duet player. Spotify playback requires Premium. Lyrics come from LRCLIB.'),
        el('span', {}, el('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'Spotify for Developers')),
      ),
    ),
  );
}

/* ------------------------------------------------------------
   Connect screen
   ------------------------------------------------------------ */
export function renderConnectScreen(error?: string): void {
  document.body.style.background = '';
  const clientId = getClientId();

  const content = el(
    'main',
    { class: 'hero' },
    el(
      'div',
      { class: 'container narrow' },
      el('h1', {}, 'Sing with your playlist. The other half is on Solo.'),
      el(
        'p',
        { class: 'lede' },
        'Solo plays songs from your Spotify playlists, listens while you sing, and carries every part you leave behind. When your voice drops, the original vocals pick the song straight back up — a duet, solo.',
      ),
      error ? el('p', { class: 'form-error' }, error) : null,
      el('div', { class: 'cta-row', id: 'cta' }, clientId ? null : setupCard()),
      clientId
        ? el(
            'div',
            { class: 'cta-row' },
            el('button', {
              class: 'btn btn-primary',
              onclick: async (e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.disabled = true;
                btn.textContent = 'Opening Spotify…';
                try {
                  await login();
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Could not start sign-in.', 'error');
                  btn.disabled = false;
                  btn.textContent = 'Connect Spotify';
                }
              },
            }, 'Connect Spotify'),
            el('button', { class: 'btn', onclick: () => renderConnectScreen() }, 'Change Client ID'),
          )
        : null,
      el(
        'ul',
        { class: 'steps' },
        el('li', {}, el('span', { class: 'step-k' }, '01'), el('p', {}, 'Connect your Spotify account — your playlists load straight into the library.')),
        el('li', {}, el('span', { class: 'step-k' }, '02'), el('p', {}, 'Pick a song. The artist starts singing through your browser as a Spotify Connect device.')),
        el('li', {}, el('span', { class: 'step-k' }, '03'), el('p', {}, 'Start singing. Solo hears your voice and ducks the artist so you take the lead; stop, and Solo carries the vocals again.')),
      ),
      el(
        'div',
        { class: 'note-card' },
        el('p', {}, 'Wear headphones for the most reliable duet — Solo separates your voice from the song using echo cancellation. On speakers, switch the room to Manual mode and hold the lead button (or the space bar) while you sing.'),
        el('p', {}, 'Spotify in-browser playback requires a Premium subscription. Your account is checked automatically when you connect.'),
      ),
    ),
  );
  shellConnect(content);
}

function shellConnect(content: HTMLElement): void {
  document.body.style.background = '';
  app.replaceChildren(
    el(
      'header',
      { class: 'nav' },
      el(
        'div',
        { class: 'nav-inner' },
        el('span', { class: 'brand' }, 'Solo', el('span', { class: 'brand-dot' }, '.')),
        el('div', { class: 'nav-user' }),
      ),
    ),
    content,
    el(
      'footer',
      { class: 'footer' },
      el(
        'div',
        { class: 'footer-inner' },
        el('span', {}, 'Solo — a personal duet player. Spotify playback requires Premium. Lyrics come from LRCLIB.'),
      ),
    ),
  );
}

function setupCard(): HTMLElement {
  const input = el('input', {
    class: 'input',
    type: 'text',
    id: 'client-id',
    placeholder: 'e.g. 4c1f2a9b8d7e4f3a9b8c7d6e5f4a3b2c',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  const error = el('p', { class: 'form-error', hidden: 'true' });

  return el(
    'div',
    { class: 'setup-card' },
    el('h2', {}, 'Connect Solo to Spotify'),
    el(
      'p',
      {},
      'Solo uses your own Spotify app, so every singer connects with their own Client ID — no approval queue, and it works on any host. Setup takes about two minutes.',
    ),
    el(
      'ol',
      { class: 'setup-ol' },
      el('li', {}, 'Open the ', el('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'Spotify developer dashboard'), ' and create an app (any name — “Solo” works).'),
      el('li', {}, 'In the app settings, add this exact redirect URI: ', el('code', {}, redirectUri())),
      el('li', {}, 'Under “User Management”, add the email address of the Spotify account you will sing with — development apps can only be used by added users.'),
      el('li', {}, 'Copy the app’s Client ID (a 32-character hex string) into the field below and connect. It is stored only in this browser.' ),
    ),
    el(
      'form',
      {
        class: 'setup-form',
        onsubmit: (e) => {
          e.preventDefault();
          const value = input.value.trim();
          if (!/^[0-9a-f]{32}$/i.test(value)) {
            error.hidden = false;
            error.textContent = 'That does not look like a Spotify Client ID — it is a 32-character hexadecimal string from your dashboard app settings.';
            return;
          }
          error.hidden = true;
          setClientId(value);
          renderConnectScreen();
        },
      },
      el('div', { class: 'field' }, el('label', { for: 'client-id' }, 'Spotify Client ID'), input, error),
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save and continue'),
    ),
  );
}

/* ------------------------------------------------------------
   Library screen — playlists + song search
   ------------------------------------------------------------ */

export async function goLibrary(): Promise<void> {
  leaveRoomIfActive();
  renderLibraryScreen();

  try {
    if (!store.playlists.length) store.playlists = await getPlaylists();
    refreshLibraryLists();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not load your playlists.', 'error');
  }
}

export function renderLibraryScreen(): void {
  const content = el(
    'main',
    { class: 'page' },
    el(
      'div',
      { class: 'page-hero' },
      el(
        'div',
        { class: 'container' },
        el(
          'div',
          { class: 'page-head' },
          el('h2', {}, 'Your playlists'),
          el('span', { class: 'muted', id: 'library-count' }, 'Loading playlists…'),
        ),
        el(
          'div',
          { class: 'search-row' },
          el('input', {
            class: 'input',
            id: 'library-search',
            type: 'search',
            placeholder: 'Filter playlists, or search songs to sing',
            oninput: () => refreshLibraryLists(),
          }),
          el(
            'div',
            { class: 'segmented', role: 'tablist' },
            el('button', { class: 'seg-btn active', 'data-scope': 'playlists', onclick: () => setScope('playlists') }, 'Playlists'),
            el('button', { class: 'seg-btn', 'data-scope': 'songs', onclick: () => setScope('songs') }, 'Songs'),
          ),
        ),
      ),
    ),
    el('div', { class: 'container' }, el('div', { id: 'library-results' }, el('div', { class: 'empty-state' }, el('h3', {}, 'Loading your playlists…')))),
  );
  shell(content);

  const search = document.getElementById('library-search') as HTMLInputElement;
  let debounce = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void maybeSearchSongs(), 350);
  });
  refreshLibraryLists();
}

let scope: 'playlists' | 'songs' = 'playlists';
let songResults: Track[] = [];
let lastQuery = '';

function setScope(next: 'playlists' | 'songs'): void {
  scope = next;
  for (const btn of document.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.scope === scope);
  }
  refreshLibraryLists();
  void maybeSearchSongs();
}

function refreshLibraryLists(): void {
  const results = document.getElementById('library-results');
  const count = document.getElementById('library-count');
  if (!results) return;
  const search = (document.getElementById('library-search') as HTMLInputElement | null)?.value ?? '';
  const query = search.trim().toLowerCase();

  if (scope === 'playlists') {
    const list = store.playlists;
    if (count) count.textContent = list.length ? `${list.length} playlists` : '';
    if (!list.length) {
      results.replaceChildren(
        el(
          'div',
          { class: 'empty-state' },
          el('h3', {}, 'No playlists to sing with yet'),
          el('p', {}, 'Create a playlist in Spotify (or follow one), then come back — it will appear here.'),
        ),
      );
      return;
    }
    const filtered = query ? list.filter((p) => p.name.toLowerCase().includes(query)) : list;
    const grid = el('div', { class: 'playlist-grid' }, ...filtered.map((p) => playlistCard(p)));
    const children: Node[] = [grid];
    if (!filtered.length) {
      children.push(el('div', { class: 'empty-state' }, el('h3', {}, 'No playlist matches that filter')));
    }
    results.replaceChildren(...children);
  } else {
    if (count) count.textContent = 'Search songs across all of Spotify';
    if (!songResults.length) {
      results.replaceChildren(
        el(
          'div',
          { class: 'empty-state' },
          el('h3', {}, 'Search for a song to sing'),
          el('p', {}, 'Type a song name and press enter — results stream straight from Spotify.'),
        ),
      );
    } else {
      results.replaceChildren(trackList(songResults, 'loose'));
    }
  }
}

function playlistCard(playlist: Playlist): HTMLElement {
  return el(
    'button',
    {
      class: 'playlist-card',
      onclick: () => void goTracks(playlist.id),
    },
    artwork(playlist.images, 'playlist-art', `Artwork for ${playlist.name}`),
    el(
      'div',
      { class: 'playlist-card-body' },
      el('h3', {}, playlist.name),
      el('div', { class: 'meta' }, `${playlist.tracks.total} songs`),
    ),
  );
}

async function maybeSearchSongs(): Promise<void> {
  const input = document.getElementById('library-search') as HTMLInputElement | null;
  if (!input || scope !== 'songs') return;
  const query = input.value.trim();
  if (!query) {
    songResults = [];
    refreshLibraryLists();
    return;
  }
  if (query === lastQuery) return;
  lastQuery = query;
  try {
    const results = await searchTracks(query);
    if (query !== input.value.trim()) return; // stale response
    songResults = results;
    refreshLibraryLists();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Song search failed.', 'error');
  }
}

/* ------------------------------------------------------------
   Playlist tracks screen
   ------------------------------------------------------------ */

export async function goTracks(playlistId: string): Promise<void> {
  leaveRoomIfActive();
  renderTracksScreen(null, []);
  try {
    const [detail, tracks] = await Promise.all([getPlaylistDetail(playlistId), getPlaylistTracks(playlistId)]);
    store.playlist = detail;
    store.playlistTracks = tracks;
    renderTracksScreen(detail, tracks);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not load that playlist.', 'error');
    await goLibrary();
  }
}

function renderTracksScreen(
  detail: { name: string; images: { url: string }[]; tracks: { total: number } } | null,
  tracks: Track[],
): void {
  const hero = el(
    'div',
    { class: 'page-hero' },
    el(
      'div',
      { class: 'container' },
      el('a', { class: 'back-link', href: '#', onclick: (e) => { e.preventDefault(); void goLibrary(); } }, '← All playlists'),
      detail
        ? el(
            'div',
            { class: 'playlist-head' },
            artwork(detail.images, '', `Artwork for ${detail.name}`),
            el(
              'div',
              {},
              el('h2', {}, detail.name),
              el('p', { class: 'muted' }, `${detail.tracks.total} songs`),
            ),
          )
        : el('div', { class: 'empty-state' }, el('h3', {}, 'Loading playlist…')),
    ),
  );
  const content = el(
    'main',
    { class: 'page' },
    hero,
    el(
      'div',
      { class: 'container' },
      detail ? premiumBanner() : null,
      detail
        ? (tracks.length
            ? trackList(tracks, 'playlist')
            : el('div', { class: 'empty-state' }, el('h3', {}, 'This playlist has no playable songs'), el('p', {}, 'Local files and podcast episodes cannot be played through the web player.')))
        : null,
    ),
  );
  shell(content);

  if (detail) void applyHeaderTint(hero, detail.images);
}

/** Spotify-style gradient header tinted with the playlist artwork. */
async function applyHeaderTint(hero: HTMLElement, images: { url: string }[] | undefined): Promise<void> {
  const tint = await dominantTint(images?.[0]?.url);
  if (!tint || !hero.isConnected) return;
  hero.style.background = `linear-gradient(180deg, rgb(${tint.r}, ${tint.g}, ${tint.b}) 0%, rgba(18, 18, 18, 0.35) 72%, #121212 100%)`;
}

function premiumBanner(): HTMLElement | null {
  const product = store.me?.product;
  if (product === 'premium') return null;
  return el(
    'div',
    { class: 'banner banner-warn' },
    el('span', {}, 'Spotify Premium is required for in-browser playback. Browsing works without it, but “Sing” needs Premium on the connected account.'),
  );
}

function trackList(tracks: Track[], kind: 'playlist' | 'loose'): HTMLElement {
  return el(
    'div',
    { class: 'track-list' },
    ...tracks.map((track, index) =>
      el(
        'div',
        { class: 'track-row' },
        kind === 'playlist' ? el('span', { class: 'track-idx' }, String(index + 1)) : el('span', {}),
        artwork(track.album?.images, 'track-thumb', `Artwork for ${track.name}`, '—'),
        el(
          'div',
          { class: 'track-main' },
          el('div', { class: 'track-name' }, track.name),
          el('div', { class: 'track-artists' }, track.artists.map((a) => a.name).join(', ')),
        ),
        el('span', { class: 'track-duration' }, formatMs(track.duration_ms)),
        el(
          'button',
          {
            class: 'btn btn-small btn-neutral',
            onclick: (e) =>
              void startDuet(track, kind === 'playlist', e.currentTarget as HTMLButtonElement, kind === 'loose' ? tracks : undefined),
          },
          'Sing',
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------
   Starting a duet
   ------------------------------------------------------------ */

async function startDuet(
  track: Track,
  fromPlaylist: boolean,
  button: HTMLButtonElement,
  allTracks?: Track[],
): Promise<void> {
  if (store.me && store.me.product !== 'premium') {
    toast('Spotify Premium is required for in-browser playback. Connect a Premium account to sing.', 'error');
    return;
  }
  // Synchronous user-gesture work: unlock the SDK's audio element where supported.
  store.player?.activate();
  button.disabled = true;
  button.textContent = 'Preparing…';
  const context: RoomContext = fromPlaylist
    ? {
        kind: 'playlist',
        playlistUri: store.playlist?.uri,
        playlistName: store.playlist?.name,
        startTrackUri: track.uri ?? undefined,
        initialTrack: track,
      }
    : {
        kind: 'loose',
        // Queue the rest of the search results behind the chosen song so the
        // room's "Up next" keeps working after this track ends.
        looseUris: [
          track.uri ?? '',
          ...(allTracks ?? [])
            .filter((t) => t.uri && t.uri !== track.uri)
            .map((t) => t.uri ?? '')
            .slice(0, 49),
        ].filter(Boolean),
        initialTrack: track,
      };
  renderRoom(context, () => void goLibrary());
}

export function leaveRoomIfActive(): void {
  if (store.roomActive) closeRoom();
}
