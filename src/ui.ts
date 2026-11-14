// Shell, connect screen, library (playlists + song search) and playlist view.

import {
  getClientId,
  clearClientId,
  hasDeploymentClientId,
  hasLocalClientIdOverride,
  redirectUri,
  setClientId,
} from './lib/config';
import { login, logout, isLoggedIn } from './lib/auth';
import {
  getPlaylists,
  getPlaylistDetail,
  getPlaylistTracks,
  searchTracks,
  playlistSongCount,
  PlaylistLockedError,
  ApiError,
  type Playlist,
  type PlaylistDetail,
  type Track,
} from './lib/api';
import { formatMs } from './lib/clean';
import { el, artwork, avatar, toast, dominantTint } from './dom';
import { store, type RoomContext } from './store';
import { renderRoom, closeRoom } from './room';
import { PlayerBridge } from './lib/sdk';
import { icon } from './icons';

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
                // product was removed from /me in February 2026; hide the badge
                // when Spotify doesn't return a plan.
                me.product
                  ? el(
                      'span',
                      { class: 'plan-badge' },
                      me.product === 'premium' ? 'Premium' : me.product === 'free' || me.product === 'open' ? 'Free plan' : me.product,
                    )
                  : null,
              )
            : null,
          isLoggedIn()
            ? el('button', {
                class: 'btn btn-small',
                onclick: () => {
                  // Release the Spotify Connect device before dropping the token.
                  store.player?.disconnect();
                  store.player = null;
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
        el('span', {}, 'Solo — a personal duet player. Spotify playback requires Premium. Lyrics come from LRCLIB and lyrics.ovh.'),
        el('span', {}, el('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'Spotify for Developers')),
      ),
    ),
  );
}

/* ------------------------------------------------------------
   Connect screen
   ------------------------------------------------------------ */
export function renderConnectScreen(error?: string, forceSetup = false): void {
  document.body.style.background = '';
  const clientId = forceSetup ? null : getClientId();
  const deploymentId = hasDeploymentClientId();

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
      forceSetup && deploymentId
        ? el(
            'div',
            { class: 'cta-row' },
            el('button', { class: 'btn', onclick: () => renderConnectScreen() }, 'Use the deployment’s Spotify app'),
          )
        : null,
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
            el('button', {
              class: 'btn',
              onclick: () => {
                clearClientId();
                // When the deployment has its own app, offer the override form
                // explicitly; otherwise clearing the local ID already shows it.
                renderConnectScreen(undefined, deploymentId);
              },
            }, 'Change Client ID'),
          )
        : null,
      clientId && deploymentId && !hasLocalClientIdOverride()
        ? el('p', { class: 'muted', style: 'margin-top:12px' }, 'This deployment is preconfigured with its own Spotify app.')
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
        el('p', {}, 'Spotify in-browser playback requires a Premium subscription. Solo tells you if Spotify refuses playback for the connected account.'),
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
        el('span', {}, 'Solo — a personal duet player. Spotify playback requires Premium. Lyrics come from LRCLIB and lyrics.ovh.'),
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
    hasDeploymentClientId()
      ? el('p', { class: 'muted' }, 'This deployment already has a default Client ID. Saving one here overrides it in this browser only.')
      : null,
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
  tracksSeq++;
  prewarmPlayer();
  resetLibraryState();
  playlistsError = '';
  playlistsLoading = !store.playlists.length;
  renderLibraryScreen();
  if (store.playlists.length) {
    refreshLibraryLists();
    return;
  }
  await fetchPlaylists();
}

/** Start the Playback SDK early so entering a room is fast and iOS has a player to unlock. */
function prewarmPlayer(): void {
  if (store.player) return;
  const player = new PlayerBridge();
  store.player = player;
  void player.connect().catch(() => {
    // The room reports a useful error if the retry also fails.
  });
}

async function fetchPlaylists(): Promise<void> {
  const seq = ++playlistsSeq;
  playlistsLoading = true;
  refreshLibraryLists();
  try {
    const list = await getPlaylists();
    if (seq !== playlistsSeq) return;
    store.playlists = list;
    playlistsError = '';
  } catch (err) {
    if (seq !== playlistsSeq) return;
    if (handleSessionError(err)) return;
    playlistsError = err instanceof Error ? err.message : 'Could not load your playlists.';
    toast(playlistsError, 'error');
  } finally {
    if (seq === playlistsSeq) {
      playlistsLoading = false;
      refreshLibraryLists();
    }
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
          el(
            'div',
            { class: 'page-head-actions' },
            el('span', { class: 'muted', id: 'library-count' }, 'Loading playlists…'),
            el('button', {
              class: 'btn btn-small',
              id: 'library-refresh',
              disabled: playlistsLoading,
              onclick: () => void fetchPlaylists(),
            }, icon('refresh', 16), el('span', {}, 'Refresh')),
          ),
        ),
        el(
          'div',
          { class: 'search-row' },
          el('input', {
            class: 'input',
            id: 'library-search',
            type: 'search',
            placeholder: 'Filter playlists, or search songs to sing',
          }),
          el(
            'div',
            { class: 'segmented', role: 'tablist' },
            el('button', { class: 'seg-btn active', 'data-scope': 'playlists', onclick: () => setScope('playlists') }, icon('music', 16), el('span', {}, 'Playlists')),
            el('button', { class: 'seg-btn', 'data-scope': 'songs', onclick: () => setScope('songs') }, icon('search', 16), el('span', {}, 'Songs')),
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
    refreshLibraryLists();
    // Songs stream in as you type; playlists filter instantly.
    if (scope === 'songs') {
      if (!search.value.trim()) {
        void maybeSearchSongs();
      } else {
        debounce = window.setTimeout(() => void maybeSearchSongs({ fresh: true }), 300);
      }
    }
  });
  refreshLibraryLists();
}

let scope: 'playlists' | 'songs' = 'playlists';
let songResults: Track[] = [];
let songTotal = 0;
let searching = false;
let searchSeq = 0;
let lastQuery = '';
let playlistsLoading = false;
let playlistsError = '';
let playlistsSeq = 0;
let tracksSeq = 0;

/** A dead Spotify session drops back to the connect screen instead of looping errors. */
function handleSessionError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 401) return false;
  playlistsSeq++;
  tracksSeq++;
  searchSeq++;
  store.player?.disconnect();
  store.player = null;
  store.me = null;
  store.playlists = [];
  store.playlist = null;
  store.playlistTracks = [];
  logout();
  renderConnectScreen('Your Spotify session has ended. Please connect again.');
  return true;
}

function resetLibraryState(): void {
  scope = 'playlists';
  songResults = [];
  songTotal = 0;
  searching = false;
  searchSeq++;
  lastQuery = '';
}

function setScope(next: 'playlists' | 'songs'): void {
  if (scope !== next) {
    scope = next;
    searchSeq++;
    searching = false;
  }
  for (const btn of document.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.scope === scope);
  }
  refreshLibraryLists();
  const input = document.getElementById('library-search') as HTMLInputElement | null;
  if (scope === 'songs' && input?.value.trim()) void maybeSearchSongs({ fresh: true });
}

function refreshLibraryLists(): void {
  const results = document.getElementById('library-results');
  const count = document.getElementById('library-count');
  if (!results) return;
  const refreshBtn = document.getElementById('library-refresh') as HTMLButtonElement | null;
  if (refreshBtn) refreshBtn.disabled = playlistsLoading;
  const search = (document.getElementById('library-search') as HTMLInputElement | null)?.value ?? '';
  const query = search.trim().toLowerCase();

  if (scope === 'playlists') {
    const list = store.playlists;
    if (!list.length) {
      if (count) count.textContent = playlistsLoading ? 'Loading playlists…' : '';
      if (playlistsLoading) {
        results.replaceChildren(
          el('div', { class: 'empty-state' }, el('h3', {}, 'Loading your playlists…'), el('p', {}, 'Fetching real playlists from Spotify.')),
        );
      } else if (playlistsError) {
        results.replaceChildren(
          el(
            'div',
            { class: 'empty-state' },
            el('h3', {}, 'Could not load your playlists'),
            el('p', {}, playlistsError),
            el('button', { class: 'btn btn-primary', onclick: () => void fetchPlaylists() }, icon('refresh', 16), el('span', {}, 'Try again')),
          ),
        );
      } else {
        results.replaceChildren(
          el(
            'div',
            { class: 'empty-state' },
            el('h3', {}, 'No playlists to sing with yet'),
            el('p', {}, 'Create a playlist in Spotify (or follow one), then press Refresh — it will appear here.'),
          ),
        );
      }
      return;
    }
    const filtered = query ? list.filter((p) => (p.name ?? '').toLowerCase().includes(query)) : list;
    if (count) {
      count.textContent = playlistsLoading
        ? 'Refreshing playlists…'
        : query
          ? `${filtered.length} of ${list.length} playlists`
          : `${list.length} playlists`;
    }
    if (filtered.length) {
      results.replaceChildren(el('div', { class: 'playlist-grid' }, ...filtered.map((p) => playlistCard(p))));
      return;
    }
    results.replaceChildren(
      el(
        'div',
        { class: 'empty-state' },
        el('h3', {}, 'No playlist matches that filter'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => { setScope('songs'); void maybeSearchSongs({ fresh: true }); },
        }, `Search songs for “${search.trim()}”`),
      ),
    );
    return;
  }

  if (count) {
    count.textContent = searching
      ? 'Searching Spotify…'
      : songResults.length
        ? `${songResults.length} of ${songTotal} songs`
        : 'Search songs across all of Spotify';
  }

  if (searching && !songResults.length) {
    results.replaceChildren(
      el('div', { class: 'empty-state' }, el('h3', {}, 'Searching…'), el('p', {}, 'Spotify is matching your search.')),
    );
    return;
  }

  if (!songResults.length) {
    const typed = search.trim();
    results.replaceChildren(
      el(
        'div',
        { class: 'empty-state' },
        el('h3', {}, typed ? `No songs found for “${typed}”` : 'Search for a song to sing'),
        el('p', {}, typed
          ? 'Try a different spelling, another song title, or the artist’s name.'
          : 'Results appear as you type — no need to press Enter.'),
      ),
    );
    return;
  }

  const children: Node[] = [trackList(songResults, 'loose')];
  if (songResults.length < songTotal) {
    children.push(
      el(
        'div',
        { class: 'cta-row' },
        el('button', {
          class: 'btn',
          disabled: searching,
          onclick: (e) => {
            (e.currentTarget as HTMLButtonElement).disabled = true;
            void maybeSearchSongs({ append: true });
          },
        }, searching ? 'Loading more…' : 'Load more results'),
      ),
    );
  }
  results.replaceChildren(...children);
}

function playlistCard(playlist: Playlist): HTMLElement {
  const count = playlistSongCount(playlist);
  // Spotify hides items for followed playlists, so fall back to the owner.
  const meta = count != null
    ? `${count} songs`
    : playlist.owner?.display_name
      ? `Playlist by ${playlist.owner.display_name}`
      : 'Playlist';
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
      el('h3', { title: playlist.name }, playlist.name),
      el('div', { class: 'meta' }, meta),
    ),
  );
}

async function maybeSearchSongs(opts?: { fresh?: boolean; append?: boolean }): Promise<void> {
  const input = document.getElementById('library-search') as HTMLInputElement | null;
  if (!input || scope !== 'songs') return;
  const query = input.value.trim();
  if (!query) {
    searchSeq++;
    songResults = [];
    songTotal = 0;
    searching = false;
    lastQuery = '';
    refreshLibraryLists();
    return;
  }
  const append = Boolean(opts?.append);
  if (!append && !opts?.fresh && query === lastQuery && songResults.length) return;
  lastQuery = query;
  const seq = ++searchSeq;
  if (!append) {
    songResults = [];
    songTotal = 0;
  }
  searching = true;
  refreshLibraryLists();
  try {
    const result = await searchTracks(query, append ? songResults.length : 0);
    if (seq !== searchSeq) return; // a newer keystroke superseded this search
    const current = (document.getElementById('library-search') as HTMLInputElement | null)?.value.trim() ?? '';
    if (scope !== 'songs' || current !== query) {
      searching = false;
      return;
    }
    songResults = append ? [...songResults, ...result.tracks] : result.tracks;
    songTotal = result.total;
    searching = false;
    refreshLibraryLists();
  } catch (err) {
    if (seq !== searchSeq) return;
    if (handleSessionError(err)) return;
    searching = false;
    lastQuery = '';
    refreshLibraryLists();
    toast(err instanceof Error ? err.message : 'Song search failed.', 'error');
  }
}

/* ------------------------------------------------------------
   Playlist tracks screen
   ------------------------------------------------------------ */

export async function goTracks(playlistId: string): Promise<void> {
  leaveRoomIfActive();
  const seq = ++tracksSeq;
  renderTracksScreen(null, []);
  try {
    // Fetch sequentially: the detail request always succeeds, while the items
    // request is refused for playlists the user only follows.
    const detail = await getPlaylistDetail(playlistId);
    if (seq !== tracksSeq) return;
    store.playlist = detail;
    try {
      const tracks = await getPlaylistTracks(playlistId);
      if (seq !== tracksSeq) return;
      store.playlistTracks = tracks;
      // A followed playlist may answer with an empty page instead of a 403.
      // An owned empty playlist reports total 0, so only treat a non-zero or
      // missing count as "Spotify hid the songs".
      const count = playlistSongCount(detail);
      renderTracksScreen(detail, tracks, { locked: tracks.length === 0 && count !== 0 });
    } catch (err) {
      if (seq !== tracksSeq) return;
      if (!(err instanceof PlaylistLockedError)) throw err;
      store.playlistTracks = [];
      renderTracksScreen(detail, [], { locked: true });
    }
  } catch (err) {
    if (seq !== tracksSeq) return;
    if (handleSessionError(err)) return;
    toast(err instanceof Error ? err.message : 'Could not load that playlist.', 'error');
    await goLibrary();
  }
}

function renderTracksScreen(
  detail: PlaylistDetail | null,
  tracks: Track[],
  opts?: { locked?: boolean },
): void {
  const locked = Boolean(opts?.locked);
  const count = detail ? playlistSongCount(detail) : null;
  const meta = detail
    ? count != null
      ? `${count} songs`
      : detail.owner?.display_name
        ? `Playlist by ${detail.owner.display_name}`
        : 'Playlist'
    : '';
  const hero = el(
    'div',
    { class: 'page-hero' },
    el(
      'div',
      { class: 'container' },
      el('a', { class: 'back-link', href: '#', onclick: (e) => { e.preventDefault(); void goLibrary(); } }, icon('arrowLeft', 16), el('span', {}, 'All playlists')),
      detail
        ? el(
            'div',
            { class: 'playlist-head' },
            artwork(detail.images, '', `Artwork for ${detail.name}`),
            el(
              'div',
              {},
              el('h2', {}, detail.name),
              el('p', { class: 'muted' }, meta),
              locked
                ? null
                : el(
                    'div',
                    { class: 'cta-row' },
                    el('button', {
                      class: 'btn btn-primary',
                      onclick: () => startPlaylistRoom(detail),
                    }, icon('play', 16), el('span', {}, 'Play from the start')),
                  ),
            ),
          )
        : el('div', { class: 'empty-state' }, el('h3', {}, 'Loading playlist…')),
    ),
  );

  let body: HTMLElement | null = null;
  if (detail) {
    if (locked) {
      body = el(
        'div',
        { class: 'empty-state' },
        el('h3', {}, 'Spotify keeps this playlist’s songs private'),
        el(
          'p',
          {},
          'Since February 2026, Spotify only lists the songs of playlists you own or collaborate on. Followed playlists can still be played from the start — Solo picks up each song as Spotify plays it.',
        ),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => startPlaylistRoom(detail),
        }, icon('play', 16), el('span', {}, 'Play from the start')),
      );
    } else if (tracks.length) {
      body = trackList(tracks, 'playlist');
    } else {
      body = el(
        'div',
        { class: 'empty-state' },
        el('h3', {}, 'This playlist has no playable songs'),
        el('p', {}, 'Local files and podcast episodes cannot be played through the web player.'),
      );
    }
  }

  const content = el(
    'main',
    { class: 'page' },
    hero,
    el('div', { class: 'container' }, detail ? premiumBanner() : null, body),
  );
  shell(content);

  if (detail) void applyHeaderTint(hero, detail.images);
}

/** Start a playlist at its first song without knowing its track list up front. */
function startPlaylistRoom(detail: PlaylistDetail): void {
  // `product` is no longer returned by GET /me, so only block on a known free plan.
  if (store.me?.product && store.me.product !== 'premium') {
    toast('Spotify Premium is required for in-browser playback. Connect a Premium account to sing.', 'error');
    return;
  }
  prewarmPlayer();
  store.player?.activate();
  renderRoom(
    {
      kind: 'playlist',
      playlistUri: detail.uri,
      playlistName: detail.name,
    },
    () => void goLibrary(),
  );
}

/** Spotify-style gradient header tinted with the playlist artwork. */
async function applyHeaderTint(hero: HTMLElement, images: { url: string }[] | undefined): Promise<void> {
  const tint = await dominantTint(images?.[0]?.url);
  if (!tint || !hero.isConnected) return;
  hero.style.background = `linear-gradient(180deg, rgb(${tint.r}, ${tint.g}, ${tint.b}) 0%, rgba(18, 18, 18, 0.35) 72%, #121212 100%)`;
}

function premiumBanner(): HTMLElement | null {
  const product = store.me?.product;
  // `product` was removed from GET /me in February 2026 — unknown means we
  // can't tell, so don't nag; playback will report any account limitation.
  if (!product || product === 'premium') return null;
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
        el('span', { class: 'track-idx' }, kind === 'playlist' ? String(index + 1) : ''),
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
          icon('mic', 15),
          el('span', {}, 'Sing'),
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
  if (store.me?.product && store.me.product !== 'premium') {
    toast('Spotify Premium is required for in-browser playback. Connect a Premium account to sing.', 'error');
    return;
  }
  // Synchronous user-gesture work: unlock the SDK's audio element where supported.
  prewarmPlayer();
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
