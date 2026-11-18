// Shell, home, YouTube search, Spotify setup/library, and the setup guides.
// The app is deliberately spare: two visual source cards on the home screen,
// short labels everywhere, and the long instructions live in the guides.

import {
  getClientId,
  deploymentClientId,
  clearClientId,
  hasDeploymentClientId,
  hasLocalClientIdOverride,
  redirectUri,
  setClientId,
  allowsPersonalSpotify,
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
import {
  clearYouTubeKey,
  getYouTubeKey,
  hasDeploymentYouTubeKey,
  hasYouTubeKey,
  looksLikeYouTubeKey,
  searchYouTube,
  setYouTubeKey,
  trendingYouTube,
} from './lib/youtube';
import type { YouTubeTrack } from './lib/playback';
import { installApp, isStandalone } from './lib/pwa';
import { allowPersonalSources } from './lib/deployment';
import { icon, type IconName } from './icons';

const app = document.getElementById('app') as HTMLElement;

type NavSection = 'home' | 'youtube' | 'spotify' | 'guides';
type GuideSlug = 'youtube' | 'spotify' | 'recording';

/* ------------------------------------------------------------
   Shell
   ------------------------------------------------------------ */

function clearHash(): void {
  if (location.hash) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

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
  const spotifyReady = loggedIn && Boolean(getClientId());
  const active = opts?.active;
  document.body.style.background = '';

  const installBtn = isStandalone()
    ? null
    : navLink('Install', 'download', false, () => void installApp());

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
          navLink('YouTube', 'youtube', active === 'youtube', () => goYouTube()),
          navLink(
            spotifyReady ? 'Playlists' : 'Spotify',
            'spotify',
            active === 'spotify',
            () => (spotifyReady ? void goLibrary() : renderConnectScreen()),
          ),
          navLink('Guides', 'book', active === 'guides', () => goGuides()),
        ),
        el(
          'div',
          { class: 'nav-user' },
          installBtn,
          me
            ? el(
                'div',
                { class: 'user-chip', title: me.display_name ?? me.id },
                avatar(me.images, me.display_name ?? me.id),
                el('span', { class: 'user-name' }, me.display_name ?? me.id),
              )
            : null,
          loggedIn
            ? el(
                'button',
                {
                  class: 'btn btn-small btn-ghost',
                  title: 'Log out of Spotify',
                  onclick: () => {
                    store.player?.disconnect();
                    store.player = null;
                    logout();
                    location.reload();
                  },
                },
                icon('close', 15),
                el('span', { class: 'logout-label' }, 'Log out'),
              )
            : null,
        ),
      ),
    ),
    content,
    el(
      'footer',
      { class: 'footer m-footer' },
      el(
        'div',
        { class: 'footer-inner' },
        el(
          'span',
          {},
          'Solo · YouTube + Spotify · Lyrics by LRCLIB · Nothing you sing is uploaded.',
        ),
        el(
          'span',
          { class: 'footer-links' },
          el('a', { href: '#/guides', onclick: (e) => { e.preventDefault(); goGuides(); } }, 'Setup guides'),
          el(
            'a',
            { href: 'https://lrclib.net', target: '_blank', rel: 'noopener' },
            'LRCLIB',
          ),
          allowsPersonalSpotify()
            ? el(
                'a',
                { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' },
                'Spotify Developers',
              )
            : null,
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------
   Home
   ------------------------------------------------------------ */

export function goHome(): void {
  leaveRoomIfActive();
  clearHash();
  renderHome();
}

export function renderHome(): void {
  document.title = 'Solo — sing with any song';
  const ytReady = hasYouTubeKey();
  const ytShared = hasDeploymentYouTubeKey();
  const ytPersonal = allowPersonalSources();
  const spotifyReady = Boolean(getClientId());
  const spotifyPersonal = allowsPersonalSpotify();
  const spotifyConnected = spotifyReady && isLoggedIn();
  const nothingReady = !ytReady && !spotifyReady && !ytPersonal && !spotifyPersonal;

  const content = el(
    'main',
    { class: 'page m-home' },
    el(
      'section',
      { class: 'm-hero' },
      el(
        'div',
        { class: 'container m-hero-inner' },
        el('img', {
          class: 'm-hero-mark',
          src: '/Solo_white.svg',
          alt: '',
          width: 64,
          height: 64,
        }),
        el('h1', {}, 'Sing. ', el('span', {}, 'Solo answers.')),
        el('p', { class: 'm-hero-sub' }, 'Pick a source. Take the lead.'),
        el(
          'div',
          { class: 'm-source-grid' },
          homeSourceCard({
            source: 'youtube',
            tag: ytShared
              ? 'Free · ready'
              : ytReady
                ? 'Key saved'
                : ytPersonal
                  ? 'Free · your key'
                  : 'Unavailable',
            title: 'YouTube',
            meta: ytShared
              ? 'No sign-in'
              : ytReady
                ? 'Trending & search'
                : ytPersonal
                  ? '2-minute setup'
                  : 'Not configured',
            iconName: 'youtube',
            onClick: () => goYouTube(),
          }),
          homeSourceCard({
            source: 'spotify',
            tag: spotifyConnected
              ? 'Connected'
              : spotifyReady
                ? 'Premium · ready'
                : spotifyPersonal
                  ? 'Premium · your app'
                  : 'Unavailable',
            title: 'Spotify',
            meta: spotifyConnected
              ? 'Your playlists'
              : spotifyReady
                ? 'Connect Spotify'
                : spotifyPersonal
                  ? '2-minute setup'
                  : 'Not configured',
            iconName: 'spotify',
            onClick: () => (spotifyConnected ? void goLibrary() : renderConnectScreen()),
          }),
        ),
        nothingReady
          ? el(
              'p',
              { class: 'm-hero-note' },
              'Solo has no sources set up yet.',
            )
          : null,
      ),
    ),
    el(
      'section',
      { class: 'container m-home-lower' },
      el(
        'div',
        { class: 'm-steps', 'aria-label': 'How Solo works' },
        el(
          'div',
          { class: 'm-step' },
          el('span', { class: 'm-step-icon' }, icon('search', 18)),
          el('span', {}, 'Pick'),
        ),
        el('span', { class: 'm-step-line', 'aria-hidden': 'true' }),
        el(
          'div',
          { class: 'm-step' },
          el('span', { class: 'm-step-icon' }, icon('mic', 18)),
          el('span', {}, 'Sing'),
        ),
        el('span', { class: 'm-step-line', 'aria-hidden': 'true' }),
        el(
          'div',
          { class: 'm-step' },
          el('span', { class: 'm-step-icon' }, icon('waves', 18)),
          el('span', {}, 'Solo answers'),
        ),
      ),
      el(
        'div',
        { class: 'm-home-links' },
        el(
          'button',
          { class: 'm-text-link', onclick: () => goGuides() },
          icon('book', 15),
          el('span', {}, 'Setup guides'),
        ),
        isStandalone()
          ? null
          : el(
              'button',
              { class: 'm-text-link', onclick: () => void installApp() },
              icon('download', 15),
              el('span', {}, 'Install app'),
            ),
      ),
    ),
  );
  shell(content, { active: 'home' });
}

function homeSourceCard(opts: {
  source: 'youtube' | 'spotify';
  tag: string;
  title: string;
  meta: string;
  iconName: IconName;
  onClick: () => void;
}): HTMLButtonElement {
  return el(
    'button',
    {
      class: 'm-source-card',
      'data-source': opts.source,
      onclick: opts.onClick,
    },
    el('span', { class: 'm-source-top' }, el('span', { class: 'm-source-tag' }, opts.tag)),
    el('span', { class: 'm-source-icon' }, icon(opts.iconName, 36)),
    el('span', { class: 'm-source-title' }, opts.title),
    el('span', { class: 'm-source-meta' }, opts.meta),
    el('span', { class: 'm-source-arrow' }, icon('arrowRight', 18)),
  ) as HTMLButtonElement;
}

/* ------------------------------------------------------------
   YouTube — free mode with a shared or personal Data API key
   ------------------------------------------------------------ */

let ytTrending: YouTubeTrack[] = [];
let ytTracks: YouTubeTrack[] = [];
let ytMode: 'trending' | 'search' = 'trending';
let ytQuery = '';
let ytLoading = false;
let ytError = '';
let ytSeq = 0;
let ytEditingKey = false;

export function goYouTube(): void {
  leaveRoomIfActive();
  clearHash();
  ytSeq++;
  ytTracks = [];
  ytLoading = false;
  ytError = '';
  ytMode = 'trending';
  ytQuery = '';
  ytEditingKey = !hasYouTubeKey() && allowPersonalSources();
  renderYouTubeScreen();
  if (!ytEditingKey) {
    if (ytTrending.length) {
      ytTracks = ytTrending;
      refreshYouTubeResults();
    } else {
      void loadYouTubeTrending();
    }
  }
}

function renderYouTubeScreen(): void {
  document.title = 'YouTube — Solo';
  const hasKey = hasYouTubeKey();
  const sharedKey = hasDeploymentYouTubeKey();
  const personal = allowPersonalSources();
  const showSetup = personal && (!hasKey || ytEditingKey);
  const showResults = hasKey && !ytEditingKey;
  const canChangeKey = personal && hasKey && !ytEditingKey && !sharedKey;
  const kicker = !hasKey && !personal ? 'Unavailable' : 'Free mode';
  const content = el(
    'main',
    { class: 'page m-page' },
    el(
      'section',
      { class: 'container m-page-head' },
      el(
        'a',
        { class: 'm-back', href: '#', onclick: (e) => { e.preventDefault(); goHome(); } },
        icon('arrowLeft', 16),
        el('span', {}, 'Home'),
      ),
      el(
        'div',
        { class: 'm-title-row' },
        el('span', { class: 'm-title-icon', 'data-source': 'youtube' }, icon('youtube', 30)),
        el(
          'div',
          { class: 'm-title-text' },
          el('span', { class: 'm-kicker' }, kicker),
          el('h2', {}, 'YouTube'),
        ),
        canChangeKey
          ? el(
              'button',
              {
                class: 'm-icon-link',
                title: 'Change the YouTube API key',
                'aria-label': 'Change the YouTube API key',
                onclick: () => {
                  ytEditingKey = true;
                  renderYouTubeScreen();
                },
              },
              icon('key', 16),
              el('span', {}, 'Key'),
            )
          : null,
      ),
      showResults
        ? el(
            'div',
            { class: 'm-searchbar' },
            el('span', { class: 'm-search-icon' }, icon('search', 18)),
            el('input', {
              class: 'm-search-input',
              id: 'yt-search',
              type: 'search',
              placeholder: 'Search songs, artists or videos',
              autocomplete: 'off',
              spellcheck: 'false',
            }),
            el(
              'button',
              {
                class: 'm-search-trending',
                id: 'yt-trending',
                title: 'Load trending music',
                'aria-label': 'Load trending music',
                onclick: () => void loadYouTubeTrending(),
              },
              icon('refresh', 17),
              el('span', {}, 'Trending'),
            ),
          )
        : null,
    ),
    el(
      'section',
      { class: 'container m-body' },
      showResults
        ? el(
            'div',
            { class: 'm-toolbar' },
            el('span', { class: 'm-count', id: 'yt-count' }),
            el(
              'a',
              { class: 'm-toolbar-link', href: '#/guides/youtube' },
              icon('book', 14),
              el('span', {}, 'Guide'),
            ),
          )
        : null,
      showSetup
        ? youtubeSetupCard()
        : showResults
          ? el(
              'div',
              { id: 'yt-results' },
              el('div', { class: 'm-state' }, el('span', { class: 'm-spinner' })),
            )
          : youtubeUnavailableCard(),
      showResults
        ? el(
            'p',
            { class: 'm-attrib' },
            sharedKey
              ? 'Music and thumbnails from YouTube.'
              : 'Music and thumbnails from YouTube. Searches use your Google quota.',
          )
        : null,
    ),
  );
  shell(content, { active: 'youtube' });

  if (!showResults) return;

  const search = document.getElementById('yt-search') as HTMLInputElement | null;
  if (!search) return;

  let debounce = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    const query = search.value.trim();
    if (!query) {
      debounce = window.setTimeout(() => void loadYouTubeTrending(), 120);
      return;
    }
    if (query.length < 2) return;
    debounce = window.setTimeout(() => void runYouTubeSearch(query), 500);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    window.clearTimeout(debounce);
    void runYouTubeSearch(search.value.trim());
  });

  refreshYouTubeResults();
}

function youtubeUnavailableCard(): HTMLElement {
  return el(
    'div',
    { class: 'm-state m-state-wide' },
    el('span', { class: 'm-state-icon' }, icon('alert', 28)),
    el('h3', {}, 'YouTube is unavailable here'),
    el(
      'p',
      {},
      hasDeploymentClientId()
        ? 'This copy of Solo does not include YouTube. Spotify is ready when you connect.'
        : 'This copy of Solo does not include YouTube.',
    ),
    hasDeploymentClientId()
      ? el(
          'div',
          { class: 'm-state-actions' },
          el(
            'button',
            {
              class: 'btn btn-primary',
              onclick: () => renderConnectScreen(),
            },
            icon('spotify', 16),
            el('span', {}, 'Use Spotify'),
          ),
        )
      : null,
  );
}

function youtubeSetupCard(): HTMLElement {
  const current = getYouTubeKey() ?? '';
  const input = el('input', {
    class: 'm-key-input',
    id: 'yt-key',
    type: 'text',
    placeholder: 'AIza…',
    autocomplete: 'off',
    spellcheck: 'false',
    value: current,
  }) as HTMLInputElement;
  const error = el('p', { class: 'form-error', hidden: 'true' });

  return el(
    'div',
    { class: 'm-setup' },
    el(
      'div',
      { class: 'm-setup-head' },
      el('span', { class: 'm-setup-icon' }, icon('key', 26)),
      el(
        'div',
        {},
        el('h3', {}, 'Add your YouTube key'),
        el('p', {}, 'Saved in this browser. Sent only to Google.'),
      ),
    ),
    el(
      'form',
      {
        class: 'm-key-form',
        onsubmit: (e) => {
          e.preventDefault();
          const value = input.value.trim();
          if (!looksLikeYouTubeKey(value)) {
            error.hidden = false;
            error.textContent = 'That does not look like a Google API key. It normally starts with AIza.';
            return;
          }
          error.hidden = true;
          setYouTubeKey(value);
          ytEditingKey = false;
          toast('YouTube key saved.');
          goYouTube();
        },
      },
      input,
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save key'),
    ),
    error,
    el(
      'div',
      { class: 'm-setup-actions' },
      el(
        'button',
        {
          class: 'btn btn-small',
          onclick: () => openGuideModal('youtube'),
        },
        icon('book', 15),
        el('span', {}, 'How to get a key'),
      ),
      el('a', { class: 'm-toolbar-link', href: '#/guides/youtube' }, 'Full guide'),
      current
        ? el(
            'button',
            {
              class: 'm-toolbar-link danger',
              onclick: () => {
                clearYouTubeKey();
                ytEditingKey = false;
                ytTrending = [];
                toast('YouTube key removed.');
                goYouTube();
              },
            },
            'Remove',
          )
        : null,
    ),
  );
}

async function loadYouTubeTrending(): Promise<void> {
  const seq = ++ytSeq;
  ytMode = 'trending';
  ytQuery = '';
  ytLoading = true;
  ytError = '';
  refreshYouTubeResults();
  const input = document.getElementById('yt-search') as HTMLInputElement | null;
  if (input) input.value = '';
  try {
    const tracks = await trendingYouTube(24);
    if (seq !== ytSeq) return;
    ytTrending = tracks;
    ytTracks = tracks;
  } catch (err) {
    if (seq !== ytSeq) return;
    ytError = err instanceof Error ? err.message : 'YouTube could not be reached.';
  } finally {
    if (seq === ytSeq) {
      ytLoading = false;
      refreshYouTubeResults();
    }
  }
}

async function runYouTubeSearch(query: string): Promise<void> {
  if (!query) {
    await loadYouTubeTrending();
    return;
  }
  if (query === ytQuery && ytMode === 'search' && (ytTracks.length || ytLoading)) return;

  const seq = ++ytSeq;
  ytMode = 'search';
  ytQuery = query;
  ytLoading = true;
  ytError = '';
  ytTracks = [];
  refreshYouTubeResults();
  try {
    const tracks = await searchYouTube(query, 24);
    if (seq !== ytSeq) return;
    const current = (document.getElementById('yt-search') as HTMLInputElement | null)?.value.trim() ?? '';
    if (current !== query) return;
    ytTracks = tracks;
  } catch (err) {
    if (seq !== ytSeq) return;
    ytError = err instanceof Error ? err.message : 'YouTube search failed.';
  } finally {
    if (seq === ytSeq) {
      ytLoading = false;
      refreshYouTubeResults();
    }
  }
}

function refreshYouTubeResults(): void {
  const results = document.getElementById('yt-results');
  const count = document.getElementById('yt-count');
  const trendingBtn = document.getElementById('yt-trending') as HTMLButtonElement | null;
  if (!results) return;
  if (trendingBtn) trendingBtn.disabled = ytLoading;

  if (count) {
    count.textContent = ytLoading
      ? ytMode === 'search'
        ? 'Searching…'
        : 'Loading…'
      : ytMode === 'search'
        ? ytTracks.length
          ? `${ytTracks.length} results`
          : ''
        : ytTracks.length
          ? 'Trending now'
          : '';
  }

  if (ytLoading && !ytTracks.length) {
    results.replaceChildren(
      el(
        'div',
        { class: 'm-video-grid' },
        ...Array.from({ length: 8 }, () =>
          el(
            'div',
            { class: 'm-video-card skeleton' },
            el('span', { class: 'm-video-thumb' }),
            el(
              'span',
              { class: 'm-video-info' },
              el('span', { class: 'm-skeleton-line' }),
              el('span', { class: 'm-skeleton-line short' }),
            ),
          ),
        ),
      ),
    );
    return;
  }

  if (ytError) {
    results.replaceChildren(
      el(
        'div',
        { class: 'm-state' },
        el('span', { class: 'm-state-icon' }, icon('alert', 28)),
        el('h3', {}, 'YouTube needs a hand'),
        el('p', {}, ytError),
        el(
          'div',
          { class: 'm-state-actions' },
          el(
            'button',
            {
              class: 'btn btn-primary',
              onclick: () => void (ytMode === 'search' ? runYouTubeSearch(ytQuery) : loadYouTubeTrending()),
            },
            icon('refresh', 16),
            el('span', {}, 'Try again'),
          ),
          hasDeploymentYouTubeKey() || !allowPersonalSources()
            ? null
            : el(
                'button',
                {
                  class: 'btn',
                  onclick: () => {
                    ytEditingKey = true;
                    renderYouTubeScreen();
                  },
                },
                icon('key', 16),
                el('span', {}, 'Change key'),
              ),
        ),
      ),
    );
    return;
  }

  if (!ytTracks.length) {
    results.replaceChildren(
      el(
        'div',
        { class: 'm-state' },
        el('span', { class: 'm-state-icon' }, icon('search', 28)),
        el('h3', {}, ytMode === 'search' ? `Nothing for “${ytQuery}”` : 'No trending music'),
        el('p', {}, ytMode === 'search' ? 'Try a different title or artist.' : 'Try again in a moment.'),
      ),
    );
    return;
  }

  results.replaceChildren(
    el(
      'div',
      { class: 'm-video-grid' },
      ...ytTracks.map((track, index) => youtubeCard(track, index)),
    ),
  );
}

function youtubeCard(track: YouTubeTrack, index: number): HTMLButtonElement {
  return el(
    'button',
    {
      class: 'm-video-card',
      title: `Sing ${track.name}`,
      onclick: () => startYouTubeRoom(index),
    },
    el(
      'span',
      { class: 'm-video-thumb' },
      artwork(
        track.artworkUrl ? [{ url: track.artworkUrl }] : undefined,
        'm-video-img',
        '',
        '▶',
      ),
      el('span', { class: 'm-video-play' }, icon('play', 20)),
      track.durationMs
        ? el('span', { class: 'm-video-time' }, formatMs(track.durationMs))
        : null,
    ),
    el(
      'span',
      { class: 'm-video-info' },
      el('span', { class: 'm-video-title' }, track.name),
      el('span', { class: 'm-video-artist' }, track.artist),
    ),
  ) as HTMLButtonElement;
}

function startYouTubeRoom(index: number): void {
  if (!ytTracks.length) return;
  renderRoom(
    {
      source: 'youtube',
      kind: 'loose',
      playlistName: ytMode === 'search' ? `YouTube · ${ytQuery}` : 'YouTube · trending',
      youtubeTracks: ytTracks,
      youtubeIndex: index,
    },
    () => goYouTube(),
  );
}

/* ------------------------------------------------------------
   Spotify — connect with a shared or personal app Client ID
   ------------------------------------------------------------ */

export function renderConnectScreen(error?: string, forceSetup = false): void {
  document.title = 'Spotify — Solo';
  leaveRoomIfActive();
  clearHash();
  const deploymentId = deploymentClientId();
  const personal = allowsPersonalSpotify();
  const clientId = forceSetup && personal ? null : getClientId();
  const usingDeployment = Boolean(clientId && deploymentId && !hasLocalClientIdOverride());

  const content = el(
    'main',
    { class: 'page m-page' },
    el(
      'section',
      { class: 'container m-page-head' },
      el(
        'a',
        { class: 'm-back', href: '#', onclick: (e) => { e.preventDefault(); goHome(); } },
        icon('arrowLeft', 16),
        el('span', {}, 'Home'),
      ),
      el(
        'div',
        { class: 'm-title-row' },
        el('span', { class: 'm-title-icon', 'data-source': 'spotify' }, icon('spotify', 30)),
        el(
          'div',
          { class: 'm-title-text' },
          el('span', { class: 'm-kicker' }, 'Premium mode'),
          el('h2', {}, 'Spotify'),
        ),
      ),
      el('p', { class: 'm-page-sub' }, 'Your playlists, in the room.'),
    ),
    el(
      'section',
      { class: 'container m-body' },
      error ? el('p', { class: 'form-error m-connect-error' }, error) : null,
      clientId
        ? spotifyConnectCard(usingDeployment || !personal)
        : personal
          ? spotifySetupCard(Boolean(deploymentId))
          : spotifyUnavailableCard(),
      forceSetup && deploymentId && personal
        ? el(
            'div',
            { class: 'm-inline-actions' },
            el(
              'button',
              { class: 'm-toolbar-link', onclick: () => renderConnectScreen() },
              'Use the shared Spotify app',
            ),
          )
        : null,
      clientId && deploymentId && !usingDeployment && personal
        ? el('p', { class: 'm-attrib' }, 'This browser uses its own Spotify app.')
        : null,
      hasYouTubeKey()
        ? el(
            'div',
            { class: 'm-escape' },
            el(
              'div',
              { class: 'm-escape-copy' },
              el('span', { class: 'm-escape-icon' }, icon('youtube', 20)),
              el('p', {}, 'No Spotify Premium? YouTube mode is free.'),
            ),
            el(
              'button',
              {
                class: 'btn btn-small',
                onclick: () => goYouTube(),
              },
              icon('youtube', 15),
              el('span', {}, 'Use YouTube'),
            ),
          )
        : null,
    ),
  );
  shell(content, { active: 'spotify' });
}

function spotifyConnectCard(shared: boolean): HTMLElement {
  return el(
    'div',
    { class: 'm-connect-card' },
    el('span', { class: 'm-connect-icon' }, icon(shared ? 'spotify' : 'check', 24)),
    el(
      'div',
      { class: 'm-connect-copy' },
      el('h3', {}, shared ? 'Connect Spotify' : 'Spotify app ready'),
      el(
        'p',
        {},
        shared
          ? 'Sign in with a Premium account. Your playlists and playback appear here.'
          : 'Connect a Premium account to load your playlists.',
      ),
    ),
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
      icon('spotify', 17),
      el('span', {}, 'Connect Spotify'),
    ),
    el(
      'div',
      { class: 'm-inline-actions' },
      shared
        ? el(
            'button',
            { class: 'm-toolbar-link', onclick: () => openGuideModal('spotify') },
            'How it works',
          )
        : el(
            'button',
            {
              class: 'm-toolbar-link',
              onclick: () => {
                clearClientId();
                renderConnectScreen();
              },
            },
            'Change key',
          ),
      shared
        ? null
        : el(
            'button',
            { class: 'm-toolbar-link', onclick: () => openGuideModal('spotify') },
            'Setup guide',
          ),
      el('a', { class: 'm-toolbar-link', href: '#/guides/spotify' }, 'Full guide'),
    ),
  );
}

function spotifyUnavailableCard(): HTMLElement {
  return el(
    'div',
    { class: 'm-state m-state-wide' },
    el('span', { class: 'm-state-icon' }, icon('alert', 28)),
    el('h3', {}, 'Spotify is unavailable here'),
    el(
      'p',
      {},
      'This copy of Solo does not include Spotify. YouTube is free and needs no account.',
    ),
    hasYouTubeKey()
      ? el(
          'div',
          { class: 'm-state-actions' },
          el(
            'button',
            {
              class: 'btn btn-primary',
              onclick: () => goYouTube(),
            },
            icon('youtube', 16),
            el('span', {}, 'Use YouTube'),
          ),
        )
      : null,
  );
}

function spotifySetupCard(deploymentId: boolean): HTMLElement {
  const input = el('input', {
    class: 'm-key-input',
    type: 'text',
    id: 'client-id',
    placeholder: '32-character Client ID',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  const error = el('p', { class: 'form-error', hidden: 'true' });

  return el(
    'div',
    { class: 'm-setup' },
    el(
      'div',
      { class: 'm-setup-head' },
      el('span', { class: 'm-setup-icon spotify' }, icon('key', 26)),
      el(
        'div',
        {},
        el('h3', {}, 'Add your app key'),
        el('p', {}, 'Spotify calls it a Client ID. It is public, not a secret.'),
      ),
    ),
    el(
      'form',
      {
        class: 'm-key-form',
        onsubmit: (e) => {
          e.preventDefault();
          const value = input.value.trim();
          if (!/^[0-9a-f]{32}$/i.test(value)) {
            error.hidden = false;
            error.textContent = 'A Client ID is 32 hexadecimal characters from your Spotify app settings.';
            return;
          }
          error.hidden = true;
          setClientId(value);
          renderConnectScreen();
        },
      },
      input,
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save key'),
    ),
    error,
    el(
      'div',
      { class: 'm-setup-actions' },
      el(
        'button',
        {
          class: 'btn btn-small',
          onclick: () => openGuideModal('spotify'),
        },
        icon('book', 15),
        el('span', {}, 'How to get your key'),
      ),
      el('a', { class: 'm-toolbar-link', href: '#/guides/spotify' }, 'Full article'),
      el(
        'span',
        { class: 'm-premium-chip' },
        icon('spotify', 13),
        el('span', {}, 'Premium required'),
      ),
    ),
    deploymentId
      ? el('p', { class: 'm-attrib' }, 'This deployment has a default key. Yours overrides it in this browser.')
      : null,
  );
}

/* ------------------------------------------------------------
   Spotify library — playlists + song search
   ------------------------------------------------------------ */

export async function goLibrary(): Promise<void> {
  leaveRoomIfActive();
  clearHash();
  if (!isLoggedIn() || !getClientId()) {
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

function renderLibraryScreen(): void {
  document.title = 'Playlists — Solo';
  const content = el(
    'main',
    { class: 'page m-page' },
    el(
      'section',
      { class: 'container m-page-head' },
      el(
        'a',
        { class: 'm-back', href: '#', onclick: (e) => { e.preventDefault(); goHome(); } },
        icon('arrowLeft', 16),
        el('span', {}, 'Home'),
      ),
      el(
        'div',
        { class: 'm-title-row' },
        el('span', { class: 'm-title-icon', 'data-source': 'spotify' }, icon('spotify', 30)),
        el(
          'div',
          { class: 'm-title-text' },
          el('span', { class: 'm-kicker' }, 'Your library'),
          el('h2', {}, 'Playlists'),
        ),
        el(
          'div',
          { class: 'm-title-actions' },
          el(
            'button',
            {
              class: 'm-icon-link',
              title: 'Refresh playlists',
              'aria-label': 'Refresh playlists',
              id: 'library-refresh',
              onclick: () => void fetchPlaylists(),
            },
            icon('refresh', 16),
            el('span', {}, 'Refresh'),
          ),
          el(
            'button',
            {
              class: 'm-icon-link',
              title: 'Use YouTube instead',
              'aria-label': 'Use YouTube instead',
              onclick: () => goYouTube(),
            },
            icon('youtube', 16),
            el('span', {}, 'YouTube'),
          ),
        ),
      ),
      el(
        'div',
        { class: 'm-searchbar' },
        el('span', { class: 'm-search-icon' }, icon('search', 18)),
        el('input', {
          class: 'm-search-input',
          id: 'library-search',
          type: 'search',
          placeholder: 'Filter playlists or search songs',
          autocomplete: 'off',
        }),
        el(
          'div',
          { class: 'm-scope', role: 'tablist' },
          el(
            'button',
            { class: 'm-scope-btn active', 'data-scope': 'playlists', onclick: () => setScope('playlists') },
            icon('music', 15),
            el('span', {}, 'Playlists'),
          ),
          el(
            'button',
            { class: 'm-scope-btn', 'data-scope': 'songs', onclick: () => setScope('songs') },
            icon('search', 15),
            el('span', {}, 'Songs'),
          ),
        ),
      ),
    ),
    el(
      'section',
      { class: 'container m-body' },
      el(
        'div',
        { class: 'm-toolbar' },
        el('span', { class: 'm-count', id: 'library-count' }, 'Loading…'),
        premiumBanner(),
      ),
      el(
        'div',
        { id: 'library-results' },
        el('div', { class: 'm-state' }, el('span', { class: 'm-spinner' })),
      ),
    ),
  );
  shell(content, { active: 'spotify' });

  const search = document.getElementById('library-search') as HTMLInputElement;
  let debounce = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    refreshLibraryLists();
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
  for (const btn of document.querySelectorAll('.m-scope-btn')) {
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
      if (count) count.textContent = playlistsLoading ? 'Loading…' : '';
      if (playlistsLoading) {
        results.replaceChildren(
          el('div', { class: 'm-video-grid' },
            ...Array.from({ length: 6 }, () =>
              el('div', { class: 'm-playlist-card skeleton' },
                el('span', { class: 'm-playlist-art skeleton-block' }),
                el('span', { class: 'm-skeleton-line' }),
                el('span', { class: 'm-skeleton-line short' }),
              ),
            ),
          ),
        );
      } else if (playlistsError) {
        results.replaceChildren(
          el(
            'div',
            { class: 'm-state' },
            el('span', { class: 'm-state-icon' }, icon('alert', 28)),
            el('h3', {}, 'Could not load playlists'),
            el('p', {}, playlistsError),
            el(
              'div',
              { class: 'm-state-actions' },
              el('button', { class: 'btn btn-primary', onclick: () => void fetchPlaylists() },
                icon('refresh', 16), el('span', {}, 'Try again')),
              el('button', { class: 'btn', onclick: () => goYouTube() },
                icon('youtube', 16), el('span', {}, 'Use YouTube')),
            ),
          ),
        );
      } else {
        results.replaceChildren(
          el(
            'div',
            { class: 'm-state' },
            el('span', { class: 'm-state-icon' }, icon('music', 28)),
            el('h3', {}, 'No playlists yet'),
            el('p', {}, 'Create or follow a playlist in Spotify, then refresh.'),
            el(
              'button',
              { class: 'btn btn-primary', onclick: () => goYouTube() },
              icon('youtube', 16),
              el('span', {}, 'Browse YouTube'),
            ),
          ),
        );
      }
      return;
    }
    const filtered = query ? list.filter((p) => (p.name ?? '').toLowerCase().includes(query)) : list;
    if (count) {
      count.textContent = playlistsLoading
        ? 'Refreshing…'
        : query
          ? `${filtered.length} of ${list.length}`
          : `${list.length} playlists`;
    }
    if (filtered.length) {
      results.replaceChildren(el('div', { class: 'm-playlist-grid' }, ...filtered.map((p) => playlistCard(p))));
      return;
    }
    results.replaceChildren(
      el(
        'div',
        { class: 'm-state' },
        el('span', { class: 'm-state-icon' }, icon('search', 28)),
        el('h3', {}, 'No playlist matches'),
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
      ? 'Searching…'
      : songResults.length
        ? `${songResults.length} of ${songTotal} songs`
        : '';
  }

  if (searching && !songResults.length) {
    results.replaceChildren(
      el('div', { class: 'm-state' }, el('span', { class: 'm-spinner' }), el('p', {}, 'Searching Spotify…')),
    );
    return;
  }

  if (!songResults.length) {
    const typed = search.trim();
    results.replaceChildren(
      el(
        'div',
        { class: 'm-state' },
        el('span', { class: 'm-state-icon' }, icon('search', 28)),
        el('h3', {}, typed ? `Nothing for “${typed}”` : 'Search Spotify'),
        el('p', {}, typed ? 'Try another title or artist.' : 'Results appear as you type.'),
      ),
    );
    return;
  }

  const children: Node[] = [trackList(songResults, 'loose')];
  if (songResults.length < songTotal) {
    children.push(
      el(
        'div',
        { class: 'm-inline-actions' },
        el('button', {
          class: 'btn',
          disabled: searching,
          onclick: (e) => {
            (e.currentTarget as HTMLButtonElement).disabled = true;
            void maybeSearchSongs({ append: true });
          },
        }, searching ? 'Loading…' : 'Load more'),
      ),
    );
  }
  results.replaceChildren(...children);
}

function playlistCard(playlist: Playlist): HTMLElement {
  const count = playlistSongCount(playlist);
  const meta = count != null
    ? `${count} songs`
    : playlist.owner?.display_name
      ? `By ${playlist.owner.display_name}`
      : 'Playlist';
  return el(
    'button',
    {
      class: 'm-playlist-card',
      onclick: () => void goTracks(playlist.id),
    },
    artwork(playlist.images, 'm-playlist-art', `Artwork for ${playlist.name}`),
    el(
      'span',
      { class: 'm-playlist-body' },
      el('strong', { title: playlist.name }, playlist.name),
      el('span', { class: 'm-playlist-meta' }, meta),
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
    if (seq !== searchSeq) return;
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

async function goTracks(playlistId: string): Promise<void> {
  leaveRoomIfActive();
  const seq = ++tracksSeq;
  renderTracksScreen(null, []);
  try {
    const detail = await getPlaylistDetail(playlistId);
    if (seq !== tracksSeq) return;
    store.playlist = detail;
    try {
      const tracks = await getPlaylistTracks(playlistId);
      if (seq !== tracksSeq) return;
      store.playlistTracks = tracks;
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
        ? `By ${detail.owner.display_name}`
        : 'Playlist'
    : '';
  document.title = detail ? `${detail.name} — Solo` : 'Playlist — Solo';
  const heroInner = el(
    'div',
    { class: 'container m-page-head m-track-head' },
    el(
      'a',
      { class: 'm-back', href: '#', onclick: (e) => { e.preventDefault(); void goLibrary(); } },
      icon('arrowLeft', 16),
      el('span', {}, 'Playlists'),
    ),
    detail
      ? el(
          'div',
          { class: 'm-playlist-hero' },
          artwork(detail.images, 'm-playlist-big', `Artwork for ${detail.name}`),
          el(
            'div',
            { class: 'm-playlist-hero-text' },
            el('span', { class: 'm-kicker' }, meta),
            el('h2', {}, detail.name),
            locked
              ? null
              : el(
                  'button',
                  {
                    class: 'btn btn-primary',
                    onclick: () => startPlaylistRoom(detail),
                  },
                  icon('play', 16),
                  el('span', {}, 'Sing from the start'),
                ),
          ),
        )
      : el('div', { class: 'm-state' }, el('span', { class: 'm-spinner' })),
  );
  const hero = el('section', { class: 'm-track-hero' }, heroInner);

  let body: HTMLElement | null = null;
  if (detail) {
    if (locked) {
      body = el(
        'div',
        { class: 'm-state' },
        el('span', { class: 'm-state-icon' }, icon('music', 28)),
        el('h3', {}, 'Spotify hides these songs'),
        el('p', {}, 'Followed playlists can still be played from the start — Solo picks up each song as it plays.'),
        el(
          'button',
          {
            class: 'btn btn-primary',
            onclick: () => startPlaylistRoom(detail),
          },
          icon('play', 16),
          el('span', {}, 'Sing from the start'),
        ),
      );
    } else if (tracks.length) {
      body = trackList(tracks, 'playlist');
    } else {
      body = el(
        'div',
        { class: 'm-state' },
        el('span', { class: 'm-state-icon' }, icon('music', 28)),
        el('h3', {}, 'No playable songs'),
        el('p', {}, 'Podcast episodes and local files cannot play through the web player.'),
      );
    }
  }

  const content = el(
    'main',
    { class: 'page m-page' },
    hero,
    el('section', { class: 'container m-body' }, premiumBanner(), body),
  );
  shell(content, { active: 'spotify' });

  if (detail) void applyHeaderTint(hero, detail.images);
}

/** Start a playlist at its first song without knowing its track list up front. */
function startPlaylistRoom(detail: PlaylistDetail): void {
  if (store.me?.product && store.me.product !== 'premium') {
    toast('Spotify Premium is required for in-browser playback. YouTube mode is free.', 'error');
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

/** Soft gradient header tinted with the playlist artwork. */
async function applyHeaderTint(hero: HTMLElement, images: { url: string }[] | undefined): Promise<void> {
  const tint = await dominantTint(images?.[0]?.url);
  if (!tint || !hero.isConnected) return;
  hero.style.background = `linear-gradient(180deg, rgb(${tint.r}, ${tint.g}, ${tint.b}) 0%, rgba(18, 18, 18, 0.35) 72%, #121212 100%)`;
}

function premiumBanner(): HTMLElement | null {
  const product = store.me?.product;
  if (!product || product === 'premium') return null;
  return el(
    'div',
    { class: 'banner banner-warn' },
    el('span', {}, 'Spotify Premium is required for playback. Browsing still works.'),
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
    toast('Spotify Premium is required for in-browser playback. YouTube mode is free.', 'error');
    return;
  }
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
   Guides — index, articles, and the setup modal
   ------------------------------------------------------------ */

interface GuideStep {
  icon: IconName;
  title: string;
  body: string;
  code?: string;
  link?: { label: string; href: string };
}

interface Guide {
  slug: GuideSlug;
  icon: IconName;
  kicker: string;
  title: string;
  lede: string;
  steps: GuideStep[];
  notes: string[];
  cta: { label: string; action: () => void };
}

const GUIDES: Record<GuideSlug, Guide> = {
  youtube: {
    slug: 'youtube',
    icon: 'youtube',
    kicker: 'Free mode',
    title: 'Sing with YouTube',
    lede: 'YouTube has nearly every song. Solo searches it with your own Google key and plays the official YouTube player inside the room.',
    steps: [
      {
        icon: 'book',
        title: 'Open Google Cloud',
        body: 'Go to Google Cloud Console and create a project — or pick one you already use.',
        link: { label: 'console.cloud.google.com', href: 'https://console.cloud.google.com/' },
      },
      {
        icon: 'youtube',
        title: 'Enable YouTube Data API v3',
        body: 'Open “APIs & Services” → “Library”, search for “YouTube Data API v3”, and press Enable.',
        link: {
          label: 'Open the API library',
          href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
        },
      },
      {
        icon: 'key',
        title: 'Create an API key',
        body: 'Open “Credentials” → “Create credentials” → “API key”. Copy the key that starts with AIza.',
        link: {
          label: 'Open credentials',
          href: 'https://console.cloud.google.com/apis/credentials',
        },
      },
      {
        icon: 'music',
        title: 'Restrict the key',
        body: 'Under “Application restrictions”, choose Websites and add this site plus http://localhost:5173 if you develop locally. Under “API restrictions”, allow YouTube Data API v3.',
      },
      {
        icon: 'check',
        title: 'Paste it into Solo',
        body: 'Open YouTube in Solo and paste the key. It is stored in this browser only and sent straight to Google — never to a Solo server.',
      },
    ],
    notes: [
      'Every Google project gets 10,000 free quota units per day. A search costs 100 units; loading trending costs 1.',
      '“API not enabled” usually clears a minute after you press Enable. Reload the page and try again.',
      'Some videos cannot be embedded. Solo detects this and skips to the next song automatically.',
      'An unrestricted key works, but website + API restrictions stop someone else using it if it leaks.',
    ],
    cta: { label: 'Open YouTube', action: () => goYouTube() },
  },
  spotify: {
    slug: 'spotify',
    icon: 'spotify',
    kicker: 'Premium mode',
    title: 'Sing with Spotify',
    lede: 'Solo uses your own Spotify app. You never share a password or a client secret — only the public Client ID.',
    steps: [
      {
        icon: 'spotify',
        title: 'Open the developer dashboard',
        body: 'Sign in at developer.spotify.com/dashboard. A free account can create an app; playback needs Spotify Premium.',
        link: { label: 'developer.spotify.com/dashboard', href: 'https://developer.spotify.com/dashboard' },
      },
      {
        icon: 'music',
        title: 'Create an app',
        body: 'Press “Create app”, name it Solo, and add the exact Redirect URI below. A mismatch blocks sign-in.',
        code: redirectUri(),
      },
      {
        icon: 'user',
        title: 'Add your Spotify account',
        body: 'In the app, open “User Management” and add the email of every Spotify account that will sing. Development Mode allows up to 5 users.',
      },
      {
        icon: 'key',
        title: 'Copy the Client ID',
        body: 'Open the app → Settings and copy the Client ID (32 hexadecimal characters). Never copy the Client secret into Solo — it is not used.',
      },
      {
        icon: 'check',
        title: 'Paste and connect',
        body: 'Paste the Client ID into Solo and sign in. Your playlists and search appear once Spotify approves the connection.',
      },
    ],
    notes: [
      'A redirect mismatch shows “INVALID_CLIENT” or “redirect_uri mismatch”. Copy the URI above character for character.',
      'A 403 usually means the account is missing from User Management, or the account has no Premium.',
      'The Client ID is public by design. The Client secret is not — keep it out of Solo, screenshots, and source code.',
      'Development Mode apps need every singer added to the allowlist. Publish your app only if you want other Spotify accounts to use it.',
    ],
    cta: { label: 'Connect Spotify', action: () => renderConnectScreen() },
  },
  recording: {
    slug: 'recording',
    icon: 'record',
    kicker: 'Studio',
    title: 'Save a take',
    lede: 'Studio records your microphone and the song into one file on your device. Nothing is uploaded anywhere.',
    steps: [
      {
        icon: 'screen',
        title: 'Use desktop Chrome or Edge',
        body: 'Tab-audio capture is a desktop browser feature. Mobile browsers do not share the sound of a tab.',
      },
      {
        icon: 'record',
        title: 'Start a take',
        body: 'Open Studio in the room and press Record. When the picker appears, choose “This tab”.',
      },
      {
        icon: 'volume',
        title: 'Switch on “Share tab audio”',
        body: 'This is the switch that puts the song into the recording. Without it the take contains your voice only.',
      },
      {
        icon: 'download',
        title: 'Sing, stop, save',
        body: 'Press Stop when the take ends. The file downloads automatically and stays available in Studio until you leave the room.',
      },
    ],
    notes: [
      'Headphones keep the microphone from re-recording the song and give Auto mode a cleaner signal.',
      'YouTube and Spotify both play through protected embedded players, so tab capture is the only way to record the song.',
      'Leaving the room stops an active take and saves what has been recorded so far.',
    ],
    cta: { label: 'Start singing', action: () => goHome() },
  },
};

const SHARED_YOUTUBE_GUIDE: Guide = {
  slug: 'youtube',
  icon: 'youtube',
  kicker: 'Free mode',
  title: 'Sing with YouTube',
  lede: 'YouTube is already set up. Search any song or start from trending — no key, no account.',
  steps: [
    {
      icon: 'search',
      title: 'Pick a song',
      body: 'Open YouTube and search by song, artist or video. The trending shelf is the fastest start.',
    },
    {
      icon: 'play',
      title: 'Sing',
      body: 'Pick a video to enter the room. Solo plays the official YouTube player and follows your voice.',
    },
    {
      icon: 'record',
      title: 'Record a take',
      body: 'On desktop Chrome or Edge, open Studio and press Record. Choose “This tab” and share tab audio.',
    },
  ],
  notes: [
    'Search is shared by everyone using this copy of Solo. The free Google quota allows roughly 100 searches a day; trending costs much less.',
    'Some videos cannot be embedded. Solo detects this and moves to the next song automatically.',
    'YouTube and Spotify both play through protected players, so Studio records tab audio.',
  ],
  cta: { label: 'Open YouTube', action: () => goYouTube() },
};

const SHARED_SPOTIFY_GUIDE: Guide = {
  slug: 'spotify',
  icon: 'spotify',
  kicker: 'Premium mode',
  title: 'Sing with Spotify',
  lede: 'Connect your Spotify account and Solo brings your playlists and playback into the room.',
  steps: [
    {
      icon: 'spotify',
      title: 'Premium is required',
      body: 'Playback runs through Spotify’s player. A free account can sign in, but Spotify will not stream the song in Solo.',
    },
    {
      icon: 'user',
      title: 'Connect your account',
      body: 'Press Connect Spotify and approve access on Spotify’s page. Solo never sees your password.',
    },
    {
      icon: 'music',
      title: 'Pick a playlist or song',
      body: 'Your playlists and search appear in the library. Open any track to start the room.',
    },
  ],
  notes: [
    'Your playlists, queue and listening history stay in your Spotify account.',
    'Solo stores only your Spotify access token in this browser. Log out any time to remove it.',
    'No Premium? YouTube mode is free and needs no account.',
  ],
  cta: { label: 'Connect Spotify', action: () => renderConnectScreen() },
};

function guideFor(slug: GuideSlug): Guide | null {
  if (slug === 'youtube') {
    if (hasDeploymentYouTubeKey()) return SHARED_YOUTUBE_GUIDE;
    return allowPersonalSources() ? GUIDES.youtube : null;
  }
  if (slug === 'spotify') {
    if (hasDeploymentClientId()) return SHARED_SPOTIFY_GUIDE;
    return allowsPersonalSpotify() ? GUIDES.spotify : null;
  }
  return GUIDES.recording;
}

function isGuideSlug(value: string | undefined): value is GuideSlug {
  return value === 'youtube' || value === 'spotify' || value === 'recording';
}

export function goGuides(slug?: GuideSlug): void {
  leaveRoomIfActive();
  const hash = slug ? `#/guides/${slug}` : '#/guides';
  if (location.hash === hash) {
    handleGuideRoute();
    return;
  }
  location.hash = hash;
}

export function handleGuideRoute(): boolean {
  if (!location.hash.startsWith('#/guides')) return false;
  leaveRoomIfActive();
  const raw = location.hash.split('/')[2];
  if (isGuideSlug(raw)) renderGuidePage(raw);
  else renderGuidesIndex();
  return true;
}

function renderGuidesIndex(): void {
  document.title = 'Setup guides — Solo';
  const order: GuideSlug[] = ['youtube', 'spotify', 'recording'];
  const guides = order
    .map((slug) => guideFor(slug))
    .filter((guide): guide is Guide => guide !== null);
  const content = el(
    'main',
    { class: 'page m-page' },
    el(
      'section',
      { class: 'container m-page-head' },
      el(
        'a',
        { class: 'm-back', href: '#', onclick: (e) => { e.preventDefault(); goHome(); } },
        icon('arrowLeft', 16),
        el('span', {}, 'Home'),
      ),
      el(
        'div',
        { class: 'm-title-row' },
        el('span', { class: 'm-title-icon', 'data-source': 'guide' }, icon('book', 30)),
        el(
          'div',
          { class: 'm-title-text' },
          el('span', { class: 'm-kicker' }, 'Read'),
          el('h2', {}, 'Setup guides'),
        ),
      ),
      el('p', { class: 'm-page-sub' }, 'Everything the short screens leave out.'),
    ),
    el(
      'section',
      { class: 'container m-body' },
      el(
        'div',
        { class: 'm-guide-grid' },
        ...guides.map((guide) =>
          el(
            'button',
            {
              class: 'm-guide-card',
              'data-source': guide.slug,
              onclick: () => goGuides(guide.slug),
            },
            el('span', { class: 'm-guide-card-icon' }, icon(guide.icon, 32)),
            el('span', { class: 'm-guide-card-kicker' }, guide.kicker),
            el('strong', {}, guide.title),
            el('span', { class: 'm-guide-card-meta' }, `${guide.steps.length} steps`),
            el('span', { class: 'm-guide-card-arrow' }, icon('arrowRight', 18)),
          ),
        ),
      ),
    ),
  );
  shell(content, { active: 'guides' });
  window.scrollTo(0, 0);
}

function renderGuidePage(slug: GuideSlug): void {
  const guide = guideFor(slug);
  if (!guide) {
    renderGuidesIndex();
    return;
  }
  document.title = `${guide.title} — Solo`;
  const content = el(
    'main',
    { class: 'page m-page m-article' },
    el(
      'article',
      { class: 'container m-article-inner' },
      el(
        'a',
        { class: 'm-back', href: '#/guides', onclick: (e) => { e.preventDefault(); goGuides(); } },
        icon('arrowLeft', 16),
        el('span', {}, 'All guides'),
      ),
      el(
        'header',
        { class: 'm-article-head', 'data-source': slug },
        el('span', { class: 'm-article-icon' }, icon(guide.icon, 36)),
        el('span', { class: 'm-kicker' }, guide.kicker),
        el('h1', {}, guide.title),
        el('p', { class: 'm-article-lede' }, guide.lede),
      ),
      el(
        'ol',
        { class: 'm-guide-steps' },
        ...guide.steps.map((step, index) =>
          el(
            'li',
            {},
            el('span', { class: 'm-guide-step-k' }, String(index + 1).padStart(2, '0')),
            el(
              'div',
              { class: 'm-guide-step-body' },
              el('div', { class: 'm-guide-step-title' }, icon(step.icon, 18), el('h2', {}, step.title)),
              el('p', {}, step.body),
              step.code ? el('code', {}, step.code) : null,
              step.link
                ? el(
                    'a',
                    {
                      class: 'm-guide-step-link',
                      href: step.link.href,
                      target: '_blank',
                      rel: 'noopener',
                    },
                    el('span', {}, step.link.label),
                    icon('externalLink', 14),
                  )
                : null,
            ),
          ),
        ),
      ),
      el(
        'aside',
        { class: 'm-guide-notes' },
        el('h2', {}, 'Good to know'),
        el(
          'ul',
          {},
          ...guide.notes.map((note) => el('li', {}, note)),
        ),
      ),
      el(
        'div',
        { class: 'm-article-cta' },
        el('button', { class: 'btn btn-primary', onclick: guide.cta.action }, guide.cta.label),
        el(
          'a',
          { class: 'btn', href: '#/guides', onclick: (e) => { e.preventDefault(); goGuides(); } },
          'More guides',
        ),
      ),
    ),
  );
  shell(content, { active: 'guides' });
  window.scrollTo(0, 0);
}

function openGuideModal(slug: 'youtube' | 'spotify'): void {
  const guide = guideFor(slug);
  if (!guide) return;
  let close = (): void => {};

  const overlay = el('div', {
    class: 'm-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': guide.title,
  });
  const closeBtn = el(
    'button',
    {
      class: 'icon-btn',
      'aria-label': 'Close guide',
      title: 'Close (Esc)',
      onclick: () => close(),
    },
    icon('close', 18),
  ) as HTMLButtonElement;

  const card = el(
    'div',
    { class: 'm-modal-card', 'data-source': slug },
    el(
      'div',
      { class: 'm-modal-head' },
      el(
        'div',
        { class: 'm-modal-title' },
        el('span', { class: 'm-modal-icon' }, icon(guide.icon, 26)),
        el(
          'div',
          {},
          el('span', { class: 'm-kicker' }, guide.kicker),
          el('h2', {}, guide.title),
        ),
      ),
      closeBtn,
    ),
    el(
      'ol',
      { class: 'm-modal-steps' },
      ...guide.steps.slice(0, 4).map((step, index) =>
        el(
          'li',
          {},
          el('span', { class: 'm-modal-k' }, String(index + 1)),
          el(
            'div',
            {},
            el('strong', {}, step.title),
            el('p', {}, step.body),
            step.code ? el('code', {}, step.code) : null,
          ),
        ),
      ),
    ),
    el(
      'div',
      { class: 'm-modal-actions' },
      el(
        'a',
        {
          class: 'btn btn-primary',
          href: `#/guides/${slug}`,
          onclick: () => close(),
        },
        icon('book', 16),
        el('span', {}, 'Read the full guide'),
      ),
      el('button', { class: 'btn', onclick: () => close() }, 'Close'),
    ),
  );
  overlay.append(card);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  close = (): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    closeBtn.focus();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  requestAnimationFrame(() => closeBtn.focus());
}

/* ------------------------------------------------------------
   Shared
   ------------------------------------------------------------ */

export function leaveRoomIfActive(): void {
  if (store.roomActive) closeRoom();
}
