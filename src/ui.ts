// Shell, home/source chooser, Spotify connect screen, Spotify library, free
// Audius and local-file libraries, and the shared track lists.

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
import { searchAudius, trendingAudius } from './lib/audius';
import { localTracksFromFiles } from './lib/local';
import type { FreeSource, FreeTrack } from './lib/playback';
import { installApp, isStandalone } from './lib/pwa';
import { icon, type IconName } from './icons';

const app = document.getElementById('app') as HTMLElement;

type NavSection = 'home' | 'spotify' | 'audius' | 'local';

/* ------------------------------------------------------------
   Shell
   ------------------------------------------------------------ */

function brandLink(): HTMLElement {
  return el(
    'a',
    {
      class: 'brand',
      href: '#',
      'aria-label': 'Solo home',
      onclick: (e) => {
        e.preventDefault();
        goHome();
      },
    },
    el('img', {
      class: 'brand-mark',
      src: '/Solo_white.svg',
      alt: '',
      width: 32,
      height: 32,
    }),
    el('span', { class: 'brand-word' }, 'Solo', el('span', { class: 'brand-dot' }, '.')),
  );
}

function navLink(
  label: string,
  iconName: IconName,
  active: boolean,
  onClick: () => void,
): HTMLButtonElement {
  return el(
    'button',
    {
      class: `nav-link${active ? ' active' : ''}`,
      'aria-label': label,
      title: label,
      onclick: onClick,
    },
    icon(iconName, 16),
    el('span', { class: 'nav-label' }, label),
  ) as HTMLButtonElement;
}

function shell(content: HTMLElement, opts?: { active?: NavSection }): void {
  const me = store.me;
  const loggedIn = isLoggedIn();
  const active = opts?.active;
  document.body.style.background = '';

  const installBtn = isStandalone()
    ? null
    : navLink('Install app', 'download', false, () => void installApp());

  app.replaceChildren(
    el(
      'header',
      { class: 'nav' },
      el(
        'div',
        { class: 'nav-inner' },
        brandLink(),
        el(
          'nav',
          { class: 'nav-links', 'aria-label': 'Music sources' },
          navLink('Free music', 'globe', active === 'audius', () => goAudius()),
          navLink('Local files', 'folder', active === 'local', () => goLocal()),
          navLink(
            loggedIn ? 'My playlists' : 'Spotify',
            'music',
            active === 'spotify',
            () => (loggedIn ? void goLibrary() : renderConnectScreen()),
          ),
        ),
        el(
          'div',
          { class: 'nav-user' },
          installBtn,
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
                      me.product === 'premium'
                        ? 'Premium'
                        : me.product === 'free' || me.product === 'open'
                          ? 'Free plan'
                          : me.product,
                    )
                  : null,
              )
            : null,
          loggedIn
            ? el(
                'button',
                {
                  class: 'btn btn-small btn-ghost',
                  onclick: () => {
                    // Release the Spotify Connect device before dropping the token.
                    store.player?.disconnect();
                    store.player = null;
                    logout();
                    location.reload();
                  },
                },
                'Log out',
              )
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
        el(
          'span',
          {},
          'Solo — a personal duet player. Free music from Audius, your own audio files, and optional Spotify playlists. Lyrics from LRCLIB. Nothing you sing is uploaded.',
        ),
        el(
          'span',
          { class: 'footer-links' },
          el('a', { href: 'https://audius.co', target: '_blank', rel: 'noopener' }, 'Audius'),
          el('a', { href: 'https://lrclib.net', target: '_blank', rel: 'noopener' }, 'LRCLIB'),
          el(
            'a',
            { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' },
            'Spotify for Developers',
          ),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------
   Home — pick a music source
   ------------------------------------------------------------ */

export function goHome(): void {
  leaveRoomIfActive();
  renderHome();
}

export function renderHome(): void {
  const loggedIn = isLoggedIn();
  const content = el(
    'main',
    { class: 'page home' },
    el(
      'section',
      { class: 'home-hero' },
      el(
        'div',
        { class: 'container narrow' },
        el('img', {
          class: 'home-mark',
          src: '/Solo_white.svg',
          alt: '',
          width: 72,
          height: 72,
        }),
        el('span', { class: 'eyebrow' }, icon('mic', 14), 'A duet with yourself'),
        el('h1', {}, 'You bring the voice. Solo brings the other half.'),
        el(
          'p',
          { class: 'lede' },
          'Play a song, start singing, and Solo ducks the artist so you take the lead. Stop, and the record sings straight back. Start with free music — no account, no subscription.',
        ),
        el(
          'div',
          { class: 'cta-row' },
          el(
            'button',
            { class: 'btn btn-primary', onclick: () => goAudius() },
            icon('globe', 17),
            el('span', {}, 'Browse free music'),
          ),
          el(
            'button',
            { class: 'btn', onclick: () => goLocal() },
            icon('folder', 17),
            el('span', {}, 'Open local files'),
          ),
          el(
            'button',
            {
              class: 'btn btn-ghost',
              onclick: () => (loggedIn ? void goLibrary() : renderConnectScreen()),
            },
            'Spotify playlists',
          ),
        ),
        el(
          'p',
          { class: 'home-note' },
          'Audius and local files need no Spotify account. Spotify is optional and requires Premium for in-browser playback.',
        ),
      ),
    ),
    el(
      'section',
      { class: 'container' },
      el('div', { class: 'source-grid' }, sourceCard({
        source: 'audius',
        iconName: 'globe',
        tag: 'Free · no account',
        title: 'Audius',
        body: 'Stream independent music from Audius, search millions of tracks, and sing along with a live pitch guide.',
        onClick: () => goAudius(),
      }), sourceCard({
        source: 'local',
        iconName: 'folder',
        tag: 'Private · on-device',
        title: 'Your music',
        body: 'Choose MP3s, WAVs or any audio files from this device. Nothing is uploaded, and takes save straight back to your downloads.',
        onClick: () => goLocal(),
      }), sourceCard({
        source: 'spotify',
        iconName: 'music',
        tag: loggedIn ? 'Connected · Premium' : 'Optional · Premium',
        title: loggedIn ? 'Your playlists' : 'Spotify playlists',
        body: loggedIn
          ? 'Open your Spotify library, or search every track Spotify exposes to your app.'
          : 'Connect your own Spotify app for playlists and Spotify-wide search. Development Mode also needs your account on the app allowlist.',
        onClick: () => (loggedIn ? void goLibrary() : renderConnectScreen()),
      })),
    ),
    el(
      'section',
      { class: 'container home-section' },
      el(
        'div',
        { class: 'section-head' },
        el('h2', {}, 'How a duet works'),
        el('p', { class: 'muted' }, 'Headphones recommended. Manual mode works on speakers.'),
      ),
      el(
        'ul',
        { class: 'steps home-steps' },
        el(
          'li',
          {},
          el('span', { class: 'step-k' }, '01'),
          el('p', {}, 'Pick any song from Audius, your files, or Spotify. The music starts inside Solo.'),
        ),
        el(
          'li',
          {},
          el('span', { class: 'step-k' }, '02'),
          el('p', {}, 'Sing. Solo hears your voice and ducks the artist to a comfortable backing level.'),
        ),
        el(
          'li',
          {},
          el('span', { class: 'step-k' }, '03'),
          el('p', {}, 'Stop and the vocals come straight back. Save a Studio take if you want to keep it.'),
        ),
      ),
    ),
    isStandalone()
      ? null
      : el(
          'section',
          { class: 'container home-section' },
          el(
            'div',
            { class: 'install-card' },
            el('span', { class: 'install-icon' }, icon('download', 22)),
            el(
              'div',
              { class: 'install-copy' },
              el('h3', {}, 'Take Solo with you'),
              el(
                'p',
                {},
                'Install Solo as an app for a full-screen room, home-screen icon and an offline shell. Local files keep working offline.',
              ),
            ),
            el(
              'button',
              { class: 'btn btn-primary', onclick: () => void installApp() },
              'Install app',
            ),
          ),
        ),
    el(
      'section',
      { class: 'container home-section' },
      el(
        'div',
        { class: 'note-card' },
        el(
          'p',
          {},
          'Solo never uploads your voice. Free-source recordings mix the song and mic directly in your browser; Spotify recordings capture this tab’s audio. Both save to your device.',
        ),
        el(
          'p',
          {},
          'Spotify playback is only available in Chrome or Edge on desktop with a Premium account. Audius and local files work in more browsers and record without a tab picker.',
        ),
      ),
    ),
  );
  shell(content, { active: 'home' });
}

function sourceCard(opts: {
  source: NavSection;
  iconName: IconName;
  tag: string;
  title: string;
  body: string;
  onClick: () => void;
}): HTMLButtonElement {
  return el(
    'button',
    {
      class: 'source-card',
      'data-source': opts.source,
      onclick: opts.onClick,
    },
    el('span', { class: 'source-arrow' }, icon('arrowRight', 18)),
    el('span', { class: 'source-icon' }, icon(opts.iconName, 24)),
    el('span', { class: 'source-tag' }, opts.tag),
    el('h3', {}, opts.title),
    el('p', {}, opts.body),
  ) as HTMLButtonElement;
}

/* ------------------------------------------------------------
   Spotify connect screen
   ------------------------------------------------------------ */

export function renderConnectScreen(error?: string, forceSetup = false): void {
  leaveRoomIfActive();
  const clientId = forceSetup ? null : getClientId();
  const deploymentId = hasDeploymentClientId();

  const content = el(
    'main',
    { class: 'hero spotify-hero' },
    el(
      'div',
      { class: 'container narrow' },
      el(
        'a',
        { class: 'back-link', href: '#', onclick: (e) => { e.preventDefault(); goHome(); } },
        icon('arrowLeft', 16),
        el('span', {}, 'All music sources'),
      ),
      el('span', { class: 'eyebrow' }, icon('music', 14), 'Spotify · optional'),
      el('h1', {}, 'Connect Spotify for playlists and search.'),
      el(
        'p',
        { class: 'lede' },
        'Solo can play your Spotify playlists through the Web Playback SDK. Spotify is entirely optional — Audius and local files need no account and no Premium plan.',
      ),
      error ? el('p', { class: 'form-error connect-error' }, error) : null,
      el(
        'div',
        { class: 'free-escape' },
        el(
          'div',
          {},
          el('strong', {}, 'Spotify blocking you?'),
          el(
            'p',
            {},
            'Development-Mode apps only allow accounts added to their User Management list, and in-browser playback needs Premium. Keep singing with a free source instead.',
          ),
        ),
        el(
          'div',
          { class: 'cta-row' },
          el(
            'button',
            { class: 'btn btn-primary', onclick: () => goAudius() },
            icon('globe', 16),
            el('span', {}, 'Free music'),
          ),
          el(
            'button',
            { class: 'btn', onclick: () => goLocal() },
            icon('folder', 16),
            el('span', {}, 'Local files'),
          ),
        ),
      ),
      el('div', { class: 'cta-row', id: 'cta' }, clientId ? null : setupCard()),
      forceSetup && deploymentId
        ? el(
            'div',
            { class: 'cta-row' },
            el(
              'button',
              { class: 'btn', onclick: () => renderConnectScreen() },
              'Use the deployment’s Spotify app',
            ),
          )
        : null,
      clientId
        ? el(
            'div',
            { class: 'cta-row' },
            el(
              'button',
              {
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
              },
              'Connect Spotify',
            ),
            el(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  clearClientId();
                  // When the deployment has its own app, offer the override form
                  // explicitly; otherwise clearing the local ID already shows it.
                  renderConnectScreen(undefined, deploymentId);
                },
              },
              'Change Client ID',
            ),
          )
        : null,
      clientId && deploymentId && !hasLocalClientIdOverride()
        ? el('p', { class: 'muted', style: 'margin-top:12px' }, 'This deployment is preconfigured with its own Spotify app.')
        : null,
      el(
        'ul',
        { class: 'steps' },
        el(
          'li',
          {},
          el('span', { class: 'step-k' }, '01'),
          el('p', {}, 'Create a Spotify app, then add this exact redirect URI: ', el('code', {}, redirectUri())),
        ),
        el(
          'li',
          {},
          el('span', { class: 'step-k' }, '02'),
          el('p', {}, 'In the app’s User Management, add the email of every Spotify account that will sing. Development Mode blocks everyone else.'),
        ),
        el(
          'li',
          {},
          el('span', { class: 'step-k' }, '03'),
          el('p', {}, 'Connect a Premium account for in-browser playback. Browsing playlists works without Premium.'),
        ),
      ),
      el(
        'div',
        { class: 'note-card' },
        el(
          'p',
          {},
          'A 403 from Spotify almost always means the connected account is not on the app’s allowlist, or that playback needs Premium. The app owner can fix the allowlist in the Spotify dashboard; nobody can bypass it from the browser.',
        ),
        el(
          'p',
          {},
          'Prefer not to set up Spotify? Audius and local files work right now. Wear headphones for the most reliable Auto duet.',
        ),
      ),
    ),
  );
  shell(content, { active: 'spotify' });
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
    el('h2', {}, 'Use your own Spotify app'),
    el(
      'p',
      {},
      'Solo uses the public PKCE flow, so each singer can bring their own Client ID — no approval queue and no secret. Setup takes about two minutes.',
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
      el('li', {}, 'Copy the app’s Client ID (a 32-character hex string) into the field below and connect. It is stored only in this browser.'),
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
   Spotify library — playlists + song search
   ------------------------------------------------------------ */

export async function goLibrary(): Promise<void> {
  leaveRoomIfActive();
  if (!isLoggedIn()) {
    renderConnectScreen();
    return;
  }
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
  if (store.player instanceof PlayerBridge) return;
  store.player?.disconnect();
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
          'a',
          { class: 'back-link', href: '#', onclick: (e) => { e.preventDefault(); goHome(); } },
          icon('arrowLeft', 16),
          el('span', {}, 'All music sources'),
        ),
        el(
          'div',
          { class: 'page-head' },
          el('h2', {}, 'Your Spotify playlists'),
          el(
            'div',
            { class: 'page-head-actions' },
            el('span', { class: 'muted', id: 'library-count' }, 'Loading playlists…'),
            el(
              'button',
              {
                class: 'btn btn-small btn-ghost',
                onclick: () => goAudius(),
                title: 'Sing with free music instead',
              },
              icon('globe', 16),
              el('span', {}, 'Free music'),
            ),
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
  shell(content, { active: 'spotify' });

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
            el(
              'div',
              { class: 'cta-row' },
              el('button', { class: 'btn btn-primary', onclick: () => void fetchPlaylists() }, icon('refresh', 16), el('span', {}, 'Try again')),
              el('button', { class: 'btn', onclick: () => goAudius() }, icon('globe', 16), el('span', {}, 'Use free music')),
            ),
          ),
        );
      } else {
        results.replaceChildren(
          el(
            'div',
            { class: 'empty-state' },
            el('h3', {}, 'No playlists to sing with yet'),
            el('p', {}, 'Create a playlist in Spotify (or follow one), then press Refresh — it will appear here.'),
            el('button', { class: 'btn btn-primary', onclick: () => goAudius() }, icon('globe', 16), el('span', {}, 'Browse free music instead')),
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
        el('button', { class: 'btn', onclick: () => goAudius() }, icon('globe', 16), el('span', {}, 'Search Audius instead')),
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
   Spotify playlist tracks
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
                    { class: 'cta-row start-row' },
                    el('button', {
                      class: 'btn btn-primary',
                      onclick: () => startPlaylistRoom(detail),
                    }, icon('play', 16), el('span', {}, 'Play from the start')),
                    el('button', {
                      class: 'btn btn-ghost',
                      onclick: () => goAudius(),
                    }, icon('globe', 16), el('span', {}, 'Free music')),
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
  shell(content, { active: 'spotify' });

  if (detail) void applyHeaderTint(hero, detail.images);
}

/** Start a playlist at its first song without knowing its track list up front. */
function startPlaylistRoom(detail: PlaylistDetail): void {
  // `product` is no longer returned by GET /me, so only block on a known free plan.
  if (store.me?.product && store.me.product !== 'premium') {
    toast('Spotify Premium is required for in-browser playback. Connect a Premium account — or sing with Audius or local files.', 'error');
    return;
  }
  prewarmPlayer();
  store.player?.activate();
  renderRoom(
    {
      source: 'spotify',
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
   Starting a Spotify duet
   ------------------------------------------------------------ */

async function startDuet(
  track: Track,
  fromPlaylist: boolean,
  button: HTMLButtonElement,
  allTracks?: Track[],
): Promise<void> {
  if (store.me?.product && store.me.product !== 'premium') {
    toast('Spotify Premium is required for in-browser playback. Connect a Premium account — or use Audius or local files.', 'error');
    return;
  }
  // Synchronous user-gesture work: unlock the SDK's audio element where supported.
  prewarmPlayer();
  store.player?.activate();
  button.disabled = true;
  button.textContent = 'Preparing…';
  const context: RoomContext = fromPlaylist
    ? {
        source: 'spotify',
        kind: 'playlist',
        playlistUri: store.playlist?.uri,
        playlistName: store.playlist?.name,
        startTrackUri: track.uri ?? undefined,
        initialTrack: track,
      }
    : {
        source: 'spotify',
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

/* ------------------------------------------------------------
   Audius — free, keyless streaming
   ------------------------------------------------------------ */

let audiusTracks: FreeTrack[] = [];
let audiusTrending: FreeTrack[] = [];
let audiusLoading = false;
let audiusError = '';
let audiusMode: 'trending' | 'search' = 'trending';
let audiusSeq = 0;
let audiusQuery = '';

export function goAudius(): void {
  leaveRoomIfActive();
  audiusSeq++;
  audiusTracks = [];
  audiusLoading = false;
  audiusError = '';
  audiusMode = 'trending';
  audiusQuery = '';
  renderAudiusScreen();
  if (audiusTrending.length) {
    audiusTracks = audiusTrending;
    refreshAudiusResults();
  } else {
    void loadAudiusTrending();
  }
}

function renderAudiusScreen(): void {
  const content = el(
    'main',
    { class: 'page free-page' },
    el(
      'section',
      { class: 'page-hero free-hero', 'data-source': 'audius' },
      el(
        'div',
        { class: 'container' },
        el(
          'a',
          { class: 'back-link', href: '#', onclick: (e) => { e.preventDefault(); goHome(); } },
          icon('arrowLeft', 16),
          el('span', {}, 'All music sources'),
        ),
        el(
          'div',
          { class: 'free-head' },
          el('span', { class: 'free-icon' }, icon('globe', 30)),
          el(
            'div',
            { class: 'free-head-text' },
            el('span', { class: 'eyebrow' }, 'Audius · free · no account'),
            el('h2', {}, 'Independent music, ready to sing.'),
            el(
              'p',
              { class: 'lede' },
              'Audius streams music from independent artists straight into Solo. Search anything or start with what is trending — no sign-in, no subscription.',
            ),
          ),
        ),
        el(
          'div',
          { class: 'search-row free-search' },
          el('input', {
            class: 'input',
            id: 'audius-search',
            type: 'search',
            placeholder: 'Search Audius — songs, artists, moods',
            autocomplete: 'off',
          }),
          el(
            'button',
            {
              class: 'btn',
              id: 'audius-refresh',
              title: 'Refresh trending music',
              onclick: () => void loadAudiusTrending(),
            },
            icon('refresh', 16),
            el('span', {}, 'Trending'),
          ),
        ),
      ),
    ),
    el(
      'div',
      { class: 'container' },
      el('div', { class: 'free-toolbar' }, el('span', { class: 'muted', id: 'audius-count' }, 'Loading Audius…')),
      el('div', { id: 'audius-results' }, el('div', { class: 'empty-state' }, el('h3', {}, 'Loading free music…'))),
      el(
        'p',
        { class: 'free-attrib' },
        'Music powered by ',
        el('a', { href: 'https://audius.co', target: '_blank', rel: 'noopener' }, 'Audius'),
        '. Audius is a free, artist-first streaming platform; some tracks may disappear when an artist removes them.',
      ),
    ),
  );
  shell(content, { active: 'audius' });

  const search = document.getElementById('audius-search') as HTMLInputElement;
  let debounce = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    const query = search.value.trim();
    debounce = window.setTimeout(() => void runAudiusSearch(query), 320);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    window.clearTimeout(debounce);
    void runAudiusSearch(search.value.trim());
  });
  refreshAudiusResults();
}

async function loadAudiusTrending(): Promise<void> {
  const seq = ++audiusSeq;
  audiusMode = 'trending';
  audiusQuery = '';
  audiusLoading = true;
  audiusError = '';
  refreshAudiusResults();
  try {
    const tracks = await trendingAudius(40);
    if (seq !== audiusSeq) return;
    audiusTrending = tracks;
    audiusTracks = tracks;
    if (!tracks.length) audiusError = 'Audius returned no playable tracks right now. Try refresh in a moment.';
  } catch (err) {
    if (seq !== audiusSeq) return;
    audiusError = err instanceof Error ? err.message : 'Audius could not be reached.';
  } finally {
    if (seq === audiusSeq) {
      audiusLoading = false;
      refreshAudiusResults();
    }
  }
}

async function runAudiusSearch(query: string): Promise<void> {
  if (query === audiusQuery && audiusMode === 'search' && (audiusTracks.length || audiusLoading)) return;
  if (!query) {
    audiusMode = 'trending';
    audiusQuery = '';
    audiusTracks = audiusTrending;
    audiusError = audiusTrending.length ? '' : audiusError;
    refreshAudiusResults();
    if (!audiusTrending.length && !audiusLoading) void loadAudiusTrending();
    return;
  }

  const seq = ++audiusSeq;
  audiusMode = 'search';
  audiusQuery = query;
  audiusLoading = true;
  audiusError = '';
  audiusTracks = [];
  refreshAudiusResults();
  try {
    const tracks = await searchAudius(query, 40);
    if (seq !== audiusSeq) return;
    audiusTracks = tracks;
    if (!tracks.length) audiusError = `No Audius tracks matched “${query}”. Try a different spelling or a broader search.`;
  } catch (err) {
    if (seq !== audiusSeq) return;
    audiusError = err instanceof Error ? err.message : 'Audius search failed.';
  } finally {
    if (seq === audiusSeq) {
      audiusLoading = false;
      refreshAudiusResults();
    }
  }
}

function refreshAudiusResults(): void {
  const results = document.getElementById('audius-results');
  const count = document.getElementById('audius-count');
  if (!results) return;
  const refreshBtn = document.getElementById('audius-refresh') as HTMLButtonElement | null;
  if (refreshBtn) refreshBtn.disabled = audiusLoading;

  if (count) {
    count.textContent = audiusLoading
      ? audiusMode === 'search'
        ? 'Searching Audius…'
        : 'Loading trending music…'
      : audiusMode === 'search'
        ? audiusTracks.length
          ? `${audiusTracks.length} results for “${audiusQuery}”`
          : 'No results'
        : audiusTracks.length
          ? `${audiusTracks.length} trending tracks`
          : 'Trending on Audius';
  }

  if (audiusLoading && !audiusTracks.length) {
    results.replaceChildren(
      el('div', { class: 'empty-state' }, el('h3', {}, audiusMode === 'search' ? 'Searching Audius…' : 'Finding free music…'), el('p', {}, 'This usually takes a second.')),
    );
    return;
  }

  if (audiusError) {
    results.replaceChildren(
      el(
        'div',
        { class: 'empty-state' },
        el('h3', {}, audiusMode === 'search' ? 'That search did not work' : 'Could not load Audius'),
        el('p', {}, audiusError),
        el(
          'div',
          { class: 'cta-row' },
          el('button', {
            class: 'btn btn-primary',
            onclick: () => void (audiusMode === 'search' ? runAudiusSearch(audiusQuery) : loadAudiusTrending()),
          }, icon('refresh', 16), el('span', {}, 'Try again')),
          el('button', { class: 'btn', onclick: () => goLocal() }, icon('folder', 16), el('span', {}, 'Use local files')),
        ),
      ),
    );
    return;
  }

  if (!audiusTracks.length) {
    results.replaceChildren(
      el('div', { class: 'empty-state' }, el('h3', {}, 'No playable free tracks yet'), el('p', {}, 'Search for another song, or load trending music again.')),
    );
    return;
  }

  results.replaceChildren(freeTrackList(audiusTracks, 'audius'));
}

/* ------------------------------------------------------------
   Local audio files
   ------------------------------------------------------------ */

let localTracks: FreeTrack[] = [];

export function goLocal(): void {
  leaveRoomIfActive();
  renderLocalScreen();
}

function renderLocalScreen(): void {
  const input = el('input', {
    type: 'file',
    id: 'local-files',
    accept: 'audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.oga,.opus,.webm',
    multiple: true,
    hidden: 'true',
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    if (input.files) addLocalFiles(input.files);
    input.value = '';
  });

  const dropZone = el(
    'div',
    {
      class: 'drop-zone',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Choose audio files from this device',
      onclick: () => input.click(),
      onkeydown: (e) => {
        const event = e as KeyboardEvent;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          input.click();
        }
      },
      ondragover: (e) => {
        e.preventDefault();
        dropZone.classList.add('dragging');
      },
      ondragleave: () => dropZone.classList.remove('dragging'),
      ondrop: (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragging');
        const files = (e as DragEvent).dataTransfer?.files;
        if (files) addLocalFiles(files);
      },
    },
    el('span', { class: 'drop-icon' }, icon('upload', 28)),
    el('h3', {}, 'Drop songs here'),
    el('p', {}, 'or click to choose audio files from this device'),
    el('span', { class: 'drop-formats' }, 'MP3 · M4A · WAV · FLAC · OGG · OPUS'),
  );

  const content = el(
    'main',
    { class: 'page free-page' },
    el(
      'section',
      { class: 'page-hero free-hero', 'data-source': 'local' },
      el(
        'div',
        { class: 'container' },
        el(
          'a',
          { class: 'back-link', href: '#', onclick: (e) => { e.preventDefault(); goHome(); } },
          icon('arrowLeft', 16),
          el('span', {}, 'All music sources'),
        ),
        el(
          'div',
          { class: 'free-head' },
          el('span', { class: 'free-icon' }, icon('folder', 30)),
          el(
            'div',
            { class: 'free-head-text' },
            el('span', { class: 'eyebrow' }, 'Local files · private · on-device'),
            el('h2', {}, 'Your music, on your device.'),
            el(
              'p',
              { class: 'lede' },
              'Pick audio files from this device and sing with them. The files are read in your browser only — Solo never uploads them. Studio takes save straight to your downloads.',
            ),
          ),
        ),
        input,
        dropZone,
      ),
    ),
    el(
      'div',
      { class: 'container' },
      el(
        'div',
        { class: 'free-toolbar' },
        el('span', { class: 'muted', id: 'local-count' }, 'No files chosen yet'),
        localTracks.length
          ? el(
              'button',
              {
                class: 'btn btn-small btn-ghost',
                onclick: () => {
                  localTracks = [];
                  refreshLocalResults();
                },
              },
              icon('close', 15),
              el('span', {}, 'Clear all'),
            )
          : null,
      ),
      el('div', { id: 'local-results' }),
      el(
        'div',
        { class: 'note-card local-note' },
        el(
          'p',
          {},
          'Tip: name files “Artist - Song.mp3” and Solo uses that as the artist and title when it looks up lyrics. If lyrics are missing, the duet and Studio still work.',
        ),
        el(
          'p',
          {},
          'Audio formats depend on your browser’s codecs. MP3 and M4A are the safest choices across Chrome, Edge, Firefox and Safari.',
        ),
      ),
    ),
  );
  shell(content, { active: 'local' });
  refreshLocalResults();
}

function addLocalFiles(files: FileList | File[]): void {
  const incoming = localTracksFromFiles(files);
  if (!incoming.length) {
    toast('No audio files found. Choose an MP3, WAV, M4A, FLAC, OGG or OPUS file.', 'error');
    return;
  }
  const seen = new Set(
    localTracks
      .map((track) => (track.file ? `${track.file.name}:${track.file.size}` : ''))
      .filter(Boolean),
  );
  const fresh = incoming.filter((track) => {
    const key = track.file ? `${track.file.name}:${track.file.size}` : '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  localTracks = [...localTracks, ...fresh];
  refreshLocalResults();
  toast(
    fresh.length
      ? `${fresh.length} ${fresh.length === 1 ? 'song' : 'songs'} ready. Nothing was uploaded.`
      : 'Those files are already in the list.',
  );
}

function refreshLocalResults(): void {
  const results = document.getElementById('local-results');
  const count = document.getElementById('local-count');
  if (!results) return;
  if (count) {
    count.textContent = localTracks.length
      ? `${localTracks.length} ${localTracks.length === 1 ? 'file' : 'files'} ready`
      : 'No files chosen yet';
  }
  if (!localTracks.length) {
    results.replaceChildren(
      el(
        'div',
        { class: 'empty-state' },
        el('h3', {}, 'Choose a song to start'),
        el('p', {}, 'Files stay on this device. You can add more at any time.'),
      ),
    );
    return;
  }
  results.replaceChildren(freeTrackList(localTracks, 'local'));
}

/* ------------------------------------------------------------
   Shared free track list + room
   ------------------------------------------------------------ */

function freeTrackList(tracks: FreeTrack[], source: FreeSource): HTMLElement {
  return el(
    'div',
    { class: 'track-list free-track-list' },
    ...tracks.map((track, index) =>
      el(
        'div',
        { class: 'track-row' },
        el('span', { class: 'track-idx' }, String(index + 1)),
        artwork(
          track.artworkUrl ? [{ url: track.artworkUrl }] : undefined,
          'track-thumb',
          `Artwork for ${track.name}`,
          '♪',
        ),
        el(
          'div',
          { class: 'track-main' },
          el('div', { class: 'track-name' }, track.name),
          el(
            'div',
            { class: 'track-artists' },
            track.artist,
            el('span', { class: 'source-chip' }, source === 'audius' ? 'Audius' : 'Local'),
          ),
        ),
        el(
          'span',
          { class: 'track-duration' },
          track.durationMs
            ? formatMs(track.durationMs)
            : track.file
              ? formatBytes(track.file.size)
              : '—',
        ),
        el(
          'button',
          {
            class: 'btn btn-small btn-neutral',
            onclick: () => startFreeRoom(source, tracks, index),
          },
          icon('mic', 15),
          el('span', {}, 'Sing'),
        ),
      ),
    ),
  );
}

function startFreeRoom(source: FreeSource, tracks: FreeTrack[], index: number): void {
  if (!tracks.length) return;
  renderRoom(
    {
      source,
      kind: 'loose',
      playlistName: source === 'audius' ? 'Audius · free music' : 'Local files',
      freeTracks: tracks,
      freeIndex: index,
    },
    () => (source === 'audius' ? goAudius() : goLocal()),
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function leaveRoomIfActive(): void {
  if (store.roomActive) closeRoom();
}
