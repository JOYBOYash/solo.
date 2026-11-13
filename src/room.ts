// The room: a dark, focused performance view. It wires the Web Playback SDK,
// the microphone monitor, the duet engine and synced LRCLIB lyrics together.

import { el, artwork, toast, formatTime, dominantTint } from './dom';
import { store, savePrefs, type RoomContext } from './store';
import { PlayerBridge, type PlaybackState, type SdkTrack } from './lib/sdk';
import { MicMonitor, describePitch } from './lib/mic';
import { DuetEngine, type Lead } from './lib/duet';
import { fetchLyrics, activeLineIndex, type Lyrics } from './lib/lrclib';
import { startPlaylist, startTracks, transferPlayback, ApiError } from './lib/api';

interface RoomRefs {
  statusDot: HTMLElement;
  statusText: HTMLElement;
  trackArt: HTMLElement;
  trackTitle: HTMLElement;
  trackArtists: HTMLElement;
  upNext: HTMLElement;
  lyricsPanel: HTMLElement;
  roomGlow: HTMLElement;
  meterFill: HTMLElement;
  pitch: HTMLElement;
  posTime: HTMLElement;
  durTime: HTMLElement;
  progress: HTMLElement;
  progressFill: HTMLElement;
  playBtn: HTMLButtonElement;
  holdBtn: HTMLButtonElement;
  segAuto: HTMLButtonElement;
  segManual: HTMLButtonElement;
  stats: HTMLElement;
  note: HTMLElement;
}

let ctx: RoomContext | null = null;
let onExit: (() => void) | null = null;
let refs: RoomRefs | null = null;

let playback: PlaybackState | null = null;
let lyrics: Lyrics | null = null;
let lyricsToken = 0;
let currentTrackUri = '';
let attributions = new Map<number, Lead>();
let counts = { you: 0, artist: 0 };
let lines: { root: HTMLElement; text: HTMLElement }[] = [];
let lastActive = -2;
let raf = 0;
let micAvailable = false;

/* ------------------------------------------------------------
   Entry / exit
   ------------------------------------------------------------ */

export function renderRoom(context: RoomContext, exitHandler: () => void): void {
  // If a room was somehow already open, tear it down first.
  if (refs) closeRoom();
  ctx = context;
  onExit = exitHandler;
  store.roomActive = true;
  playback = null;
  lyrics = null;
  lyricsToken++;
  currentTrackUri = '';
  attributions = new Map();
  counts = { you: 0, artist: 0 };
  lines = [];
  lastActive = -2;

  const r = buildDom(context);
  refs = r;
  void init(r);
}

export function closeRoom(): void {
  store.roomActive = false;
  cancelAnimationFrame(raf);
  raf = 0;
  lyricsToken++;
  store.duet?.stop();
  store.mic?.stop();
  // Leaving the room should not keep music playing in the background.
  void store.player?.pause();
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  ctx = null;
  onExit = null;
  refs = null;
  playback = null;
  lyrics = null;
}

/* ------------------------------------------------------------
   DOM
   ------------------------------------------------------------ */

function buildDom(context: RoomContext): RoomRefs {
  const statusDot = el('span', { class: 'status-dot' });
  const statusText = el('span', {}, 'Connecting playback…');
  const trackArt = el('span', {});
  const trackTitle = el('strong', {}, 'Loading track…');
  const trackArtists = el('span', {}, '');
  const upNext = el('div', { class: 'room-next', hidden: 'true' });
  const lyricsPanel = el('div', { class: 'lyrics-panel' });
  const meterFill = el('div', { class: 'meter-fill' });
  const pitch = el('span', { class: 'pitch' }, '—');
  const posTime = el('span', { class: 'time' }, '0:00');
  const durTime = el('span', { class: 'time' }, '0:00');
  const progressFill = el('div', { class: 'progress-fill' });
  const progress = el('div', { class: 'progress' });
  const playBtn = el('button', { class: 'btn-dark', disabled: true }, 'Play') as HTMLButtonElement;
  const holdBtn = el('button', { class: 'btn-dark', 'aria-pressed': 'false' }, 'Hold to take the lead') as HTMLButtonElement;
  const segAuto = el('button', { class: 'seg-btn-dark active' }, 'Auto') as HTMLButtonElement;
  const segManual = el('button', { class: 'seg-btn-dark' }, 'Manual') as HTMLButtonElement;
  const stats = el('span', { class: 'session-stats', hidden: 'true' });
  const note = el('p', { class: 'room-note' }, '');

  progress.append(progressFill);
  playBtn.disabled = true;

  const roomGlow = el('div', { class: 'room-glow' });

  const room = el(
    'main',
    { class: 'room' },
    roomGlow,
    el(
      'div',
      { class: 'room-inner' },
      el(
        'div',
        { class: 'room-top' },
        el('button', { class: 'btn-dark', onclick: () => exit() }, 'Exit room'),
        el(
          'div',
          { class: 'room-track' },
          trackArt,
          el(
            'div',
            { class: 'room-track-text' },
            trackTitle,
            trackArtists,
            upNext,
          ),
        ),
        el('span', { class: 'status-chip' }, statusDot, statusText),
      ),
      lyricsPanel,
      el('div', { class: 'meter-row' }, el('span', { class: 'meter-label' }, 'Mic'), el('div', { class: 'meter' }, meterFill), pitch),
      el(
        'div',
        { class: 'progress-row' },
        posTime,
        progress,
        durTime,
      ),
      el(
        'div',
        { class: 'room-controls' },
        el(
          'div',
          { class: 'ctrl-group' },
          el('button', { class: 'btn-dark', onclick: () => void store.player?.previous() }, 'Previous'),
          playBtn,
          el('button', { class: 'btn-dark', onclick: () => void store.player?.next() }, 'Next'),
        ),
        holdBtn,
        el(
          'div',
          { class: 'segmented-dark', role: 'group', 'aria-label': 'Duet mode' },
          segAuto,
          segManual,
        ),
        sliderGroup('Master volume', Math.round(store.prefs.baseVolume * 100), (v) => {
          store.duet?.setBaseVolume(v / 100);
          store.prefs.baseVolume = v / 100;
          savePrefs(store.prefs);
        }),
        sliderGroup('Artist level while you sing', Math.round(store.prefs.backingFactor * 100), (v) => {
          store.duet?.setBackingFactor(v / 100);
          store.prefs.backingFactor = v / 100;
          savePrefs(store.prefs);
        }),
        sliderGroup('Mic sensitivity', Math.round(store.prefs.sensitivity * 100), (v) => {
          if (store.mic) store.mic.sensitivity = v / 100;
          store.prefs.sensitivity = v / 100;
          savePrefs(store.prefs);
        }),
        stats,
      ),
      note,
    ),
  );

  const app = document.getElementById('app') as HTMLElement;
  app.replaceChildren(room);
  window.scrollTo(0, 0);

  // Interactions
  playBtn.addEventListener('click', () => void store.player?.togglePlay());
  holdBtn.addEventListener('pointerdown', () => setHeld(true));
  holdBtn.addEventListener('pointerup', () => setHeld(false));
  holdBtn.addEventListener('pointerleave', () => setHeld(false));
  holdBtn.addEventListener('pointercancel', () => setHeld(false));
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  segAuto.addEventListener('click', () => setMode('auto'));
  segManual.addEventListener('click', () => setMode('manual'));
  progress.addEventListener('click', (e) => {
    if (!playback?.duration) return;
    const rect = progress.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    void store.player?.seek(ratio * playback.duration);
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  setMode(store.prefs.mode);
  if (context.initialTrack) {
    renderTrackBasics(context.initialTrack);
  } else {
    // Followed playlists don't expose their items, so the first track arrives
    // with the SDK's first player-state event.
    trackTitle.textContent = context.playlistName ?? 'Starting playback…';
    trackArtists.textContent = 'Waiting for the first song from Spotify…';
  }

  return {
    statusDot, statusText, trackArt, trackTitle, trackArtists, upNext,
    lyricsPanel, roomGlow, meterFill, pitch, posTime, durTime, progress, progressFill,
    playBtn, holdBtn, segAuto, segManual, stats, note,
  };
}

function sliderGroup(label: string, value: number, onInput: (v: number) => void): HTMLElement {
  const input = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: String(value),
    'aria-label': label,
  }) as HTMLInputElement;
  input.addEventListener('input', () => onInput(Number(input.value)));
  return el('div', { class: 'slider-group' }, el('label', {}, label), input);
}

/* ------------------------------------------------------------
   Bootstrap
   ------------------------------------------------------------ */

async function init(r: RoomRefs): Promise<void> {
  try {
    // Microphone first — it must be requested while the user's click gesture is
    // still fresh so the AudioContext starts unsuspended. Manual mode still
    // works even if the microphone is unavailable.
    const mic = store.mic ?? (store.mic = new MicMonitor());
    mic.onState = (state) => {
      if (!store.roomActive || refs !== r) return;
      r.meterFill.style.width = `${Math.round(state.level * 100)}%`;
      r.pitch.textContent =
        state.voiced && state.pitchHz ? describePitch(state.pitchHz) : '—';
      store.duet?.setMicVoiced(state.voiced);
    };
    try {
      await mic.start();
      if (!store.roomActive || refs !== r) {
        // The room was closed while the permission prompt was open. If no newer
        // room is using this shared monitor, release the microphone; otherwise
        // the new room owns it.
        if (!store.roomActive) mic.stop();
        return;
      }
      mic.sensitivity = store.prefs.sensitivity;
      micAvailable = true;
    } catch {
      if (!store.roomActive || refs !== r) return;
      micAvailable = false;
      toast('Microphone unavailable — switch to Manual mode and hold the lead button while you sing.', 'error');
      setMode('manual');
      r.segAuto.disabled = true;
    }

    // Refresh the note now that we know whether the mic actually started.
    setMode(store.prefs.mode);

    const player = store.player ?? (store.player = new PlayerBridge());
    player.onState = (state) => handlePlayerState(state);
    player.onError = (error) => handleSdkError(error);

    setStatus('connecting', 'Connecting playback…');
    const deviceId = await player.connect();
    if (!store.roomActive || refs !== r) return;

    const duet = store.duet ?? (store.duet = new DuetEngine());
    duet.setBaseVolume(store.prefs.baseVolume);
    duet.setBackingFactor(store.prefs.backingFactor);
    duet.setMode(store.prefs.mode);
    duet.onLead = () => {
      if (!store.roomActive || refs !== r) return;
      updateStatus();
      r.holdBtn.setAttribute('aria-pressed', duet.lead === 'you' ? 'true' : 'false');
    };
    duet.start(player);

    raf = requestAnimationFrame(tick);

    await startPlayback(deviceId);

    // The user may have left while the start request was in flight. Do not let
    // that request leave music playing after the room is gone (but never pause
    // a newer room that has taken over the shared player).
    if (!store.roomActive) await player.pause();
  } catch (err) {
    if (!store.roomActive || refs !== r) return;
    const message = err instanceof Error ? err.message : 'Playback could not start.';
    setStatus('paused', 'Playback unavailable');
    toast(message, 'error');
    if (refs) refs.note.textContent = message;
  }
}

async function startPlayback(deviceId: string): Promise<void> {
  const context = ctx;
  if (!context) return;
  try {
    if (context.kind === 'playlist' && context.playlistUri) {
      await startPlaylist(deviceId, context.playlistUri, context.startTrackUri);
    } else {
      const uris = (context.looseUris ?? []).filter(Boolean);
      if (uris.length) await startTracks(deviceId, uris);
      else throw new Error('Nothing queued to play.');
    }
  } catch (err) {
    // Device not active yet — transfer explicitly and retry once.
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      await transferPlayback(deviceId, false);
      if (context.kind === 'playlist' && context.playlistUri) {
        await startPlaylist(deviceId, context.playlistUri, context.startTrackUri);
      } else {
        const uris = (context.looseUris ?? []).filter(Boolean);
        if (uris.length) await startTracks(deviceId, uris);
      }
    } else {
      throw err;
    }
  }
}

function exit(): void {
  const done = onExit;
  closeRoom();
  done?.();
}

/* ------------------------------------------------------------
   Player state
   ------------------------------------------------------------ */

function handlePlayerState(state: PlaybackState): void {
  playback = state;
  if (!refs) return;

  refs.playBtn.disabled = false;
  refs.playBtn.textContent = state.paused ? 'Play' : 'Pause';
  refs.durTime.textContent = formatTime(state.duration / 1000);

  if (state.track.uri !== currentTrackUri) {
    currentTrackUri = state.track.uri;
    attributions = new Map();
    counts = { you: 0, artist: 0 };
    lastActive = -2;
    lyrics = null;
    renderTrack(state.track);
    void loadLyrics(state.track, state.duration);
    updateStats();
  }

  const next = state.nextTracks[0];
  if (next) {
    refs.upNext.hidden = false;
    refs.upNext.textContent = `Up next: ${next.name}`;
  } else {
    refs.upNext.hidden = true;
  }

  updateStatus();
}

function handleSdkError(error: { kind: string; message: string }): void {
  if (!store.roomActive) return;
  toast(error.message, 'error');
  if (error.kind === 'account' && refs) {
    refs.note.textContent =
      'Spotify Premium is required for in-browser playback. Close the room and connect with a Premium account.';
  }
}

/* ------------------------------------------------------------
   Track + lyrics rendering
   ------------------------------------------------------------ */

function renderTrackBasics(track: { name: string; artists: { name: string }[]; album?: { images: { url: string }[] } }): void {
  if (!refs) return;
  refs.trackArt.replaceChildren(
    artwork(track.album?.images, '', `Artwork for ${track.name}`),
  );
  refs.trackTitle.textContent = track.name;
  refs.trackArtists.textContent = track.artists.map((a) => a.name).join(', ');
}

function renderTrack(track: SdkTrack): void {
  renderTrackBasics({
    name: track.name,
    artists: track.artists,
    album: { images: track.album?.images ?? [] },
  });
  void applyRoomGlow(track.album?.images);
}

/** Spotify Now-Playing style ambience: a soft radial tint from the artwork. */
async function applyRoomGlow(images: { url: string }[] | undefined): Promise<void> {
  const tint = await dominantTint(images?.[0]?.url);
  if (!refs || !refs.roomGlow.isConnected) return;
  refs.roomGlow.style.background = tint
    ? `radial-gradient(55% 42% at 50% 0%, rgba(${tint.r}, ${tint.g}, ${tint.b}, 0.5) 0%, rgba(18, 18, 18, 0) 72%)`
    : '';
}

function setLyricsMessage(title: string, body: string | null): void {
  if (!refs) return;
  refs.lyricsPanel.replaceChildren(
    el(
      'div',
      { class: 'lyrics-empty' },
      el('strong', {}, title),
      body ? el('p', {}, body) : null,
    ),
  );
}

async function loadLyrics(track: SdkTrack, durationMs: number): Promise<void> {
  const token = ++lyricsToken;
  setLyricsMessage('Looking up lyrics…', 'Fetching time-synced lyrics from LRCLIB.');
  try {
    const result = await fetchLyrics(
      track.name,
      track.artists.map((a) => a.name),
      track.album?.name ?? '',
      durationMs || track.duration_ms || 0,
    );
    if (token !== lyricsToken || !store.roomActive) return;
    lyrics = result;
    lastActive = -2;
    renderLyrics();
  } catch {
    if (token !== lyricsToken || !store.roomActive) return;
    lyrics = { synced: null, plain: null };
    renderLyrics();
  }
}

function renderLyrics(): void {
  if (!refs || !lyrics) return;

  if (lyrics.synced && lyrics.synced.length) {
    attributions = new Map();
    counts = { you: 0, artist: 0 };
    lines = lyrics.synced.map((line) => {
      const text = el('span', {}, line.text || '·');
      const root = el('div', { class: 'lyric-line' }, text);
      return { root, text };
    });
    refs.lyricsPanel.replaceChildren(
      el('div', { class: 'lyrics-scroll' }, ...lines.map((l) => l.root)),
    );
    updateStats();
    return;
  }

  if (lyrics.plain) {
    setLyricsMessage('Unsynced lyrics', null);
    const pre = el('div', { class: 'plain-lyrics' }, lyrics.plain.trim());
    refs.lyricsPanel.replaceChildren(pre);
    return;
  }

  setLyricsMessage(
    'No lyrics found for this track',
    'The duet still works — Solo ducks the artist while you sing. These words just are not in the lyrics database yet.',
  );
}

/* ------------------------------------------------------------
   Ticker (position, active line, progress)
   ------------------------------------------------------------ */

function tick(): void {
  raf = requestAnimationFrame(tick);
  if (!refs || !playback) return;

  const now = performance.now();
  const position = playback.paused
    ? playback.position
    : Math.min(playback.duration, playback.position + (now - playback.updatedAt));

  refs.posTime.textContent = formatTime(position / 1000);
  if (playback.duration > 0) {
    refs.progressFill.style.width = `${((position / playback.duration) * 100).toFixed(2)}%`;
  }

  if (lyrics?.synced && lines.length) {
    const idx = activeLineIndex(lyrics.synced, position / 1000);
    if (idx !== lastActive) {
      lastActive = idx;
      applyActive(idx);
    }
  }
}

function applyActive(idx: number): void {
  if (!refs) return;
  lines.forEach((line, i) => {
    line.root.classList.toggle('active', i === idx);
    line.root.classList.toggle('sung', i < idx);
  });

  if (idx >= 0 && !attributions.has(idx) && store.duet) {
    const lead = store.duet.lead;
    attributions.set(idx, lead);
    counts[lead] += 1;
    const chip = el('span', { class: `who who-${lead}` }, lead === 'you' ? 'You' : 'Solo');
    lines[idx].root.prepend(chip);
    updateStats();
  }

  const active = idx >= 0 ? lines[idx] : null;
  if (active) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    active.root.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }
}

function updateStats(): void {
  if (!refs) return;
  if (!lyrics?.synced) {
    refs.stats.hidden = true;
    return;
  }
  refs.stats.hidden = false;
  refs.stats.replaceChildren(
    'You sang ', el('strong', {}, String(counts.you)),
    ' · Solo sang ', el('strong', {}, String(counts.artist)),
  );
}

/* ------------------------------------------------------------
   Controls
   ------------------------------------------------------------ */

function setStatus(kind: 'you' | 'artist' | 'paused' | 'connecting', text: string): void {
  if (!refs) return;
  refs.statusDot.className = `status-dot${kind === 'you' ? ' you' : ''}${kind === 'paused' || kind === 'connecting' ? ' paused' : ''}`;
  refs.statusText.textContent = text;
}

function updateStatus(): void {
  if (!refs) return;
  if (!playback) {
    setStatus('connecting', 'Connecting playback…');
    return;
  }
  if (playback.paused) {
    setStatus('paused', 'Paused');
    return;
  }
  if (store.duet?.lead === 'you') {
    setStatus('you', 'Your turn — mic is live');
  } else {
    setStatus('artist', 'Solo is singing');
  }
}

function setHeld(held: boolean): void {
  if (!store.duet || store.duet.mode !== 'manual' || !refs) return;
  store.duet.setManualHeld(held);
  refs.holdBtn.setAttribute('aria-pressed', held ? 'true' : 'false');
}

function setMode(mode: 'auto' | 'manual'): void {
  if (!refs) return;
  store.duet?.setMode(mode);
  store.prefs.mode = mode;
  savePrefs(store.prefs);
  refs.segAuto.classList.toggle('active', mode === 'auto');
  refs.segManual.classList.toggle('active', mode === 'manual');
  refs.holdBtn.disabled = mode !== 'manual';
  if (mode === 'auto') {
    refs.holdBtn.setAttribute('aria-pressed', 'false');
    refs.note.textContent = micAvailable
      ? 'Auto — Solo ducks the artist whenever it hears your voice. Headphones give the cleanest detection.'
      : 'Auto is unavailable without a microphone. Hold the button (or space bar) while you sing in Manual mode.';
  } else {
    refs.note.textContent = 'Manual — hold the button (or space bar) while you sing; release to let Solo sing again.';
  }
  updateStatus();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.code !== 'Space' || !store.roomActive) return;
  const target = e.target as HTMLElement | null;
  // Typing and sliders keep the space key; everywhere else in the room it is
  // the manual "take the lead" control (including when a button has focus).
  if (
    target &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  ) {
    return;
  }
  e.preventDefault();
  if (!e.repeat) setHeld(true);
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code !== 'Space' || !store.roomActive) return;
  setHeld(false);
}

/** Releasing focus (tab switch, notification) must not leave the artist ducked. */
function onBlur(): void {
  if (store.roomActive) setHeld(false);
}
