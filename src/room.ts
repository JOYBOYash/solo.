// The room: a dark, focused performance view. It wires the Web Playback SDK,
// the microphone monitor, the duet engine, synced lyrics and the Studio
// recorder together.
//
// Three views share the same playback:
//   • Lyrical — synced words with "You / Solo" attribution.
//   • Theatre — a single full-height visual: wave or lava, no lyrics.
//   • Studio  — teleprompter lyrics plus a live voice-vs-song pitch ribbon and
//               an explicit tab-audio recorder.

import { el, artwork, toast, formatTime, dominantTint } from './dom';
import {
  store,
  savePrefs,
  type RoomContext,
  type RoomView,
  type TheatreStyle,
} from './store';
import { PlayerBridge, type PlaybackState, type SdkTrack } from './lib/sdk';
import { MicMonitor, describePitch, noteName, midiFromHz } from './lib/mic';
import { DuetEngine, type Lead } from './lib/duet';
import { fetchLyrics, activeLineIndex, type Lyrics } from './lib/lrclib';
import { startPlaylist, startTracks, transferPlayback, ApiError } from './lib/api';
import { icon, type IconName } from './icons';
import { TheatreVisualizer } from './lib/visualizer';
import { StudioVisualizer } from './lib/studio-visualizer';
import {
  StudioRecorder,
  recorderSupported,
  type RecorderStatus,
} from './lib/recorder';

const VIEWS: RoomView[] = ['lyrical', 'theatre', 'studio'];

interface RoomRefs {
  root: HTMLElement;
  statusChip: HTMLElement;
  statusIcon: HTMLElement;
  statusText: HTMLElement;
  recordBadge: HTMLButtonElement;
  recordBadgeTime: HTMLElement;
  trackArt: HTMLElement;
  trackTitle: HTMLElement;
  trackArtists: HTMLElement;
  upNext: HTMLElement;
  lyricsPanel: HTMLElement;
  roomGlow: HTMLElement;
  meterRow: HTMLElement;
  meterFill: HTMLElement;
  pitchText: HTMLElement;
  posTime: HTMLElement;
  durTime: HTMLElement;
  progress: HTMLElement;
  progressFill: HTMLElement;
  playBtn: HTMLButtonElement;
  holdBtn: HTMLButtonElement;
  segAuto: HTMLButtonElement;
  segManual: HTMLButtonElement;
  stats: HTMLElement;
  views: Record<RoomView, HTMLElement>;
  viewButtons: Record<RoomView, HTMLButtonElement>;
  theatreStage: HTMLElement;
  theatreCanvas: HTMLCanvasElement;
  theatreStyleButtons: Record<TheatreStyle, HTMLButtonElement>;
  theatreLead: HTMLElement;
  studioStage: HTMLElement;
  studioCanvas: HTMLCanvasElement;
  studioLines: { root: HTMLElement; text: HTMLElement; offset: number }[];
  studioLyricsHint: HTMLElement;
  studioPitchNote: HTMLElement;
  studioPitchTarget: HTMLElement;
  studioPitchTune: HTMLElement;
  studioStatus: HTMLElement;
  studioTimer: HTMLElement;
  studioHint: HTMLElement;
  recordBtn: HTMLButtonElement;
  recordBtnLabel: HTMLElement;
  downloadRow: HTMLElement;
  downloadBtn: HTMLButtonElement;
  mixerBtn: HTMLButtonElement;
  mixerPanel: HTMLElement;
  calibrateBtn: HTMLButtonElement;
  helpModal: HTMLElement;
  helpClose: HTMLButtonElement;
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
let micLevel = 0;

let currentView: RoomView = 'lyrical';
let recorder: StudioRecorder | null = null;
let theatreVis: TheatreVisualizer | null = null;
let studioVis: StudioVisualizer | null = null;
let lastStudioPitchAt = 0;

let helpOpen = false;
let helpReturnFocus: HTMLElement | null = null;

let lastRecorderPhase: RecorderStatus['phase'] = 'idle';
let recordAudioSeen = false;
let recordAudioWarned = false;
let recordAudioCheckAt = 0;

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
  micLevel = 0;
  currentView = store.prefs.view;
  recorder = null;
  theatreVis = null;
  studioVis = null;
  lastStudioPitchAt = 0;
  helpOpen = false;
  helpReturnFocus = null;
  lastRecorderPhase = 'idle';
  recordAudioSeen = false;
  recordAudioWarned = false;
  recordAudioCheckAt = 0;

  const r = buildDom(context);
  refs = r;
  setMode(store.prefs.mode);
  setTheatreStyle(store.prefs.theatreStyle, { persist: false });
  setView(currentView, { persist: false });
  void init(r);
}

export function closeRoom(): void {
  store.roomActive = false;
  cancelAnimationFrame(raf);
  raf = 0;
  lyricsToken++;
  store.duet?.stop();

  // Stop (and save) an in-flight Studio take before releasing the mic.
  const activeRecorder = recorder;
  recorder = null;
  activeRecorder?.dispose();

  store.mic?.stop();
  theatreVis?.stop();
  studioVis?.stop();
  theatreVis = null;
  studioVis = null;

  // Leaving the room should not keep music playing in the background.
  void store.player?.pause();
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);

  if (refs) refs.helpModal.hidden = true;
  helpOpen = false;
  helpReturnFocus = null;
  ctx = null;
  onExit = null;
  refs = null;
  playback = null;
  lyrics = null;
  lines = [];
}

/* ------------------------------------------------------------
   DOM
   ------------------------------------------------------------ */

function buildDom(context: RoomContext): RoomRefs {
  const statusIcon = el('span', { class: 'status-icon' });
  const statusText = el('span', { class: 'status-text' }, 'Connecting');
  const statusChip = el(
    'span',
    {
      class: 'status-chip',
      'data-kind': 'connecting',
      role: 'status',
      'aria-live': 'polite',
    },
    statusIcon,
    statusText,
  );

  const recordBadgeTime = el('span', { class: 'record-badge-time' }, '0:00');
  const recordBadge = el(
    'button',
    {
      class: 'record-badge',
      hidden: 'true',
      'aria-label': 'Recording — open Studio',
      title: 'Recording — open Studio',
      onclick: () => setView('studio'),
    },
    icon('record', 12, 'record-badge-icon'),
    recordBadgeTime,
  ) as HTMLButtonElement;

  const trackArt = el('span', { class: 'room-art' });
  const trackTitle = el('strong', {}, 'Loading track…');
  const trackArtists = el('span', {}, '');
  const upNext = el('div', { class: 'room-next', hidden: 'true' });
  const trackPanel = el(
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
  );

  const exitBtn = iconButton('arrowLeft', 'Leave room', () => exit(), 'room-exit');
  const helpBtn = iconButton('help', 'Keyboard shortcuts (?)', () => openHelp());
  const roomActions = el(
    'div',
    { class: 'room-actions' },
    recordBadge,
    statusChip,
    helpBtn,
  );
  const roomTop = el('div', { class: 'room-top' }, exitBtn, trackPanel, roomActions);

  const viewButtons = {} as Record<RoomView, HTMLButtonElement>;
  const viewBar = el('div', {
    class: 'view-bar',
    role: 'tablist',
    'aria-label': 'Playback mode',
  });
  const viewDefs: { view: RoomView; label: string; iconName: IconName; key: string }[] = [
    { view: 'lyrical', label: 'Lyrical', iconName: 'captions', key: '1' },
    { view: 'theatre', label: 'Theatre', iconName: 'audioLines', key: '2' },
    { view: 'studio', label: 'Studio', iconName: 'disc', key: '3' },
  ];
  for (const def of viewDefs) {
    const btn = el(
      'button',
      {
        class: 'view-btn',
        role: 'tab',
        id: `tab-${def.view}`,
        'aria-label': def.label,
        'aria-controls': `view-${def.view}`,
        'aria-selected': 'false',
        tabindex: '-1',
        title: `${def.label} (${def.key})`,
        onclick: () => setView(def.view),
      },
      icon(def.iconName, 18),
      el('span', { class: 'view-label' }, def.label),
    ) as HTMLButtonElement;
    viewButtons[def.view] = btn;
    viewBar.append(btn);
  }
  viewBar.addEventListener('keydown', (e) => {
    const event = e as KeyboardEvent;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const idx = VIEWS.indexOf(currentView);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = VIEWS[(idx + step + VIEWS.length) % VIEWS.length];
    setView(next);
    viewButtons[next].focus();
  });

  const lyricsPanel = el('div', { class: 'lyrics-panel' });
  const lyricsView = el(
    'section',
    { class: 'room-view lyrics-view', role: 'tabpanel', id: 'view-lyrical', 'aria-labelledby': 'tab-lyrical' },
    lyricsPanel,
  );

  const theatreCanvas = el('canvas', {
    class: 'theatre-canvas',
    'aria-hidden': 'true',
  }) as HTMLCanvasElement;
  const theatreStyleButtons = {} as Record<TheatreStyle, HTMLButtonElement>;
  const theatreStyleBar = el('div', {
    class: 'theatre-style',
    role: 'group',
    'aria-label': 'Theatre visual',
  });
  const theatreStyleDefs: { style: TheatreStyle; label: string; iconName: IconName }[] = [
    { style: 'wave', label: 'Wave', iconName: 'waves' },
    { style: 'lava', label: 'Lava', iconName: 'flame' },
  ];
  for (const def of theatreStyleDefs) {
    const btn = el(
      'button',
      {
        class: 'theatre-style-btn',
        'aria-label': `${def.label} visual`,
        'aria-pressed': 'false',
        title: `${def.label} visual`,
        onclick: () => setTheatreStyle(def.style),
      },
      icon(def.iconName, 16),
      el('span', { class: 'theatre-style-label' }, def.label),
    ) as HTMLButtonElement;
    theatreStyleButtons[def.style] = btn;
    theatreStyleBar.append(btn);
  }
  const theatreLead = el('span', { class: 'theatre-lead' }, 'Solo sings');
  const theatreStage = el(
    'div',
    { class: 'theatre-stage', 'data-lead': 'artist' },
    theatreCanvas,
    el(
      'div',
      { class: 'theatre-overlay theatre-overlay-top' },
      el(
        'span',
        { class: 'theatre-kicker' },
        icon('audioLines', 14),
        el('span', {}, 'Theatre'),
      ),
      theatreStyleBar,
    ),
    el(
      'div',
      { class: 'theatre-overlay theatre-overlay-bottom' },
      theatreLead,
      el('span', { class: 'theatre-hint' }, 'V switches the visual'),
    ),
  );
  const theatreView = el(
    'section',
    {
      class: 'room-view theatre-view',
      role: 'tabpanel',
      id: 'view-theatre',
      'aria-labelledby': 'tab-theatre',
      hidden: 'true',
    },
    theatreStage,
  );

  const studioCanvas = el('canvas', {
    class: 'studio-canvas',
    'aria-hidden': 'true',
  }) as HTMLCanvasElement;
  const studioLines = [-2, -1, 0, 1, 2].map((offset) => {
    const text = el('span', { class: 'studio-line-text' }, '');
    const root = el('div', {
      class: 'studio-line',
      'data-offset': String(offset),
      'aria-hidden': 'true',
    }, text);
    return { root, text, offset };
  });
  const studioLyricsHint = el('span', { class: 'studio-lyrics-hint' }, 'Live lyrics');
  const studioPitchNote = el('strong', {}, '—');
  const studioPitchTarget = el('span', {}, '—');
  const studioPitchTune = el('span', { class: 'studio-tune' }, 'Start a take for the pitch guide');
  const studioGuide = el(
    'div',
    { class: 'studio-guide' },
    el(
      'div',
      { class: 'studio-guide-head' },
      el(
        'div',
        { class: 'studio-guide-title' },
        icon('audioLines', 15),
        el('span', {}, 'Pitch guide'),
      ),
      el(
        'div',
        { class: 'studio-pitch-readout' },
        el('span', { class: 'pitch-you' }, icon('mic', 13), studioPitchNote),
        el('span', { class: 'pitch-song' }, icon('music', 13), studioPitchTarget),
        studioPitchTune,
      ),
    ),
    studioCanvas,
  );
  const studioStatus = el(
    'span',
    { class: 'studio-status', role: 'status', 'aria-live': 'polite' },
    'Ready',
  );
  const studioTimer = el('span', { class: 'studio-timer' }, '0:00');
  const recordBtnLabel = el('span', { class: 'record-label' }, 'Record');
  const recordBtn = el(
    'button',
    {
      class: 'record-btn',
      disabled: 'true',
      title: 'Start a Studio take',
      onclick: () => void toggleRecording(),
    },
    icon('record', 20, 'record-icon'),
    recordBtnLabel,
  ) as HTMLButtonElement;
  const downloadBtn = el(
    'button',
    {
      class: 'btn-dark download-btn',
      title: 'Save the last take',
      onclick: () => recorder?.downloadLast(),
    },
    icon('download', 16),
    el('span', {}, 'Save take'),
  ) as HTMLButtonElement;
  const downloadRow = el('div', { class: 'studio-download' }, downloadBtn);
  const studioHint = el(
    'div',
    { class: 'studio-hint' },
    el('span', {}, icon('screen', 15), 'This tab'),
    el('span', {}, icon('volume', 15), 'Share tab audio'),
  );
  const studioStage = el(
    'div',
    { class: 'studio-stage', 'data-lead': 'artist' },
    el(
      'div',
      { class: 'studio-teleprompt' },
      el(
        'div',
        { class: 'studio-lyrics-head' },
        icon('captions', 14),
        el('span', {}, 'Sing along'),
        studioLyricsHint,
      ),
      el('div', { class: 'studio-lyrics' }, ...studioLines.map((line) => line.root)),
    ),
    studioGuide,
    el(
      'div',
      { class: 'studio-controls' },
      recordBtn,
      studioTimer,
      studioStatus,
      downloadRow,
    ),
    studioHint,
  );
  const studioView = el(
    'section',
    {
      class: 'room-view studio-view',
      role: 'tabpanel',
      id: 'view-studio',
      'aria-labelledby': 'tab-studio',
      hidden: 'true',
    },
    studioStage,
  );

  const meterFill = el('div', { class: 'meter-fill' });
  const pitchText = el('span', {}, '—');
  const meterRow = el(
    'div',
    { class: 'meter-row' },
    el('span', { class: 'meter-icon' }, icon('mic', 16)),
    el('div', { class: 'meter' }, meterFill),
    el('span', { class: 'pitch' }, icon('musicNote', 13), pitchText),
  );

  const posTime = el('span', { class: 'time' }, '0:00');
  const durTime = el('span', { class: 'time' }, '0:00');
  const progressFill = el('div', { class: 'progress-fill' });
  const progress = el('div', { class: 'progress' });
  progress.append(progressFill);
  const progressRow = el('div', { class: 'progress-row' }, posTime, progress, durTime);

  const prevBtn = el(
    'button',
    {
      class: 'transport-btn',
      'aria-label': 'Previous track',
      title: 'Previous',
      onclick: () => void store.player?.previous(),
    },
    icon('previous', 20),
  ) as HTMLButtonElement;
  const playBtn = el(
    'button',
    {
      class: 'play-btn',
      disabled: 'true',
      'aria-label': 'Play',
      title: 'Play or pause (Space or K)',
      onclick: () => void store.player?.togglePlay(),
    },
    icon('play', 26),
  ) as HTMLButtonElement;
  const nextBtn = el(
    'button',
    {
      class: 'transport-btn',
      'aria-label': 'Next track',
      title: 'Next',
      onclick: () => void store.player?.next(),
    },
    icon('next', 20),
  ) as HTMLButtonElement;
  const transport = el('div', { class: 'transport' }, prevBtn, playBtn, nextBtn);

  const holdBtn = el(
    'button',
    {
      class: 'lead-btn',
      disabled: 'true',
      'aria-pressed': 'false',
      title: 'Switch to Manual to hold the lead (M)',
    },
    icon('mic', 22),
    el('span', { class: 'lead-label' }, 'Lead'),
  ) as HTMLButtonElement;

  const segAuto = el(
    'button',
    {
      class: 'seg-btn-dark active',
      'aria-pressed': 'true',
      title: 'Auto — detect your voice (A)',
      onclick: () => setMode('auto'),
    },
    icon('radio', 16),
    el('span', {}, 'Auto'),
  ) as HTMLButtonElement;
  const segManual = el(
    'button',
    {
      class: 'seg-btn-dark',
      'aria-pressed': 'false',
      title: 'Manual — hold the lead (M)',
      onclick: () => setMode('manual'),
    },
    icon('hand', 16),
    el('span', {}, 'Manual'),
  ) as HTMLButtonElement;
  const modeGroup = el(
    'div',
    { class: 'segmented-dark', role: 'group', 'aria-label': 'Duet mode' },
    segAuto,
    segManual,
  );

  const mixerBtn = iconButton(
    'sliders',
    'Mixer and microphone settings',
    () => toggleMixer(),
    'mixer-toggle',
  );
  mixerBtn.setAttribute('aria-expanded', 'false');

  const calibrateBtn = el(
    'button',
    {
      class: 'btn-dark calibrate-btn',
      title: 'Measure the room while it is quiet',
      onclick: () => void calibrateMic(),
    },
    icon('audioLines', 16),
    el('span', {}, 'Calibrate room'),
  ) as HTMLButtonElement;

  const mixerPanel = el(
    'div',
    { class: 'mixer-panel', hidden: 'true' },
    sliderGroup('Master volume', Math.round(store.prefs.baseVolume * 100), (v) => {
      store.duet?.setBaseVolume(v / 100);
      store.prefs.baseVolume = v / 100;
      savePrefs(store.prefs);
    }),
    sliderGroup(
      'Song while you sing',
      Math.round(store.prefs.backingFactor * 100),
      (v) => {
        store.duet?.setBackingFactor(v / 100);
        store.prefs.backingFactor = v / 100;
        savePrefs(store.prefs);
      },
      'The whole Spotify mix stays at this level under your voice.',
    ),
    sliderGroup(
      'Mic sensitivity',
      Math.round(store.prefs.sensitivity * 100),
      (v) => {
        if (store.mic) store.mic.sensitivity = v / 100;
        store.prefs.sensitivity = v / 100;
        savePrefs(store.prefs);
      },
      'Raise this if quiet singing is missed in Auto.',
      { min: 50, max: 200 },
    ),
    el('div', { class: 'mixer-actions' }, calibrateBtn),
  );

  const stats = el('span', { class: 'session-stats', hidden: 'true' });
  const note = el('p', { class: 'room-note', hidden: 'true', role: 'status' });

  const roomControls = el(
    'div',
    { class: 'room-controls' },
    transport,
    holdBtn,
    modeGroup,
    mixerBtn,
  );

  const { modal: helpModal, closeBtn: helpClose } = buildHelpModal();
  const roomGlow = el('div', { class: 'room-glow' });
  const room = el(
    'main',
    { class: 'room', 'data-view': currentView },
    roomGlow,
    el(
      'div',
      { class: 'room-inner' },
      roomTop,
      viewBar,
      el('div', { class: 'room-stage' }, lyricsView, theatreView, studioView),
      meterRow,
      progressRow,
      roomControls,
      stats,
      mixerPanel,
      note,
    ),
    helpModal,
  );

  const app = document.getElementById('app') as HTMLElement;
  app.replaceChildren(room);
  window.scrollTo(0, 0);

  // Interactions
  holdBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      holdBtn.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is a nice-to-have */
    }
    setHeld(true);
  });
  const release = () => setHeld(false);
  holdBtn.addEventListener('pointerup', release);
  holdBtn.addEventListener('pointercancel', release);
  holdBtn.addEventListener('lostpointercapture', release);
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  progress.addEventListener('click', (e) => {
    if (!playback?.duration) return;
    const rect = progress.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    void store.player?.seek(ratio * playback.duration);
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  if (!recorderSupported()) {
    studioStatus.textContent = 'Desktop Chrome or Edge needed';
    recordBtn.title = 'Studio recording needs Chrome or Edge on desktop.';
    studioHint.hidden = true;
  }

  if (context.initialTrack) {
    renderTrackBasics(context.initialTrack);
  } else {
    // Followed playlists don't expose their items, so the first track arrives
    // with the SDK's first player-state event.
    trackTitle.textContent = context.playlistName ?? 'Starting playback…';
    trackArtists.textContent = 'Waiting for the first song from Spotify…';
  }

  // Theatre reads the live mic. The song lane uses the real tab-capture signal
  // during a Studio take; otherwise a synthetic ribbon follows the duet level.
  theatreVis = new TheatreVisualizer({
    canvas: theatreCanvas,
    mic: { copy: (out: Float32Array) => store.mic?.copyWaveform(out) ?? false },
    music: { copy: (out: Float32Array) => recorder?.copyMusicWaveform(out) ?? false },
    micLevel: () => micLevel,
    musicLevel: () => musicVisualLevel(),
    playing: () => Boolean(playback && !playback.paused),
    lead: (): Lead => (store.duet?.lead === 'you' ? 'you' : 'artist'),
    style: () => store.prefs.theatreStyle,
  });
  studioVis = new StudioVisualizer({
    canvas: studioCanvas,
    micPitch: () => store.mic?.pitch ?? null,
    musicPitch: () => recorder?.musicPitch() ?? null,
    micLevel: () => micLevel,
    musicLevel: () => Math.min(1, (recorder?.musicRms() ?? 0) * 4),
    recording: () => Boolean(recorder?.isRecording),
    playing: () => Boolean(playback && !playback.paused),
  });
  theatreVis.start();
  studioVis.start();

  return {
    root: room,
    statusChip,
    statusIcon,
    statusText,
    recordBadge,
    recordBadgeTime,
    trackArt,
    trackTitle,
    trackArtists,
    upNext,
    lyricsPanel,
    roomGlow,
    meterRow,
    meterFill,
    pitchText,
    posTime,
    durTime,
    progress,
    progressFill,
    playBtn,
    holdBtn,
    segAuto,
    segManual,
    stats,
    views: {
      lyrical: lyricsView,
      theatre: theatreView,
      studio: studioView,
    },
    viewButtons,
    theatreStage,
    theatreCanvas,
    theatreStyleButtons,
    theatreLead,
    studioStage,
    studioCanvas,
    studioLines,
    studioLyricsHint,
    studioPitchNote,
    studioPitchTarget,
    studioPitchTune,
    studioStatus,
    studioTimer,
    studioHint,
    recordBtn,
    recordBtnLabel,
    downloadRow,
    downloadBtn,
    mixerBtn,
    mixerPanel,
    calibrateBtn,
    helpModal,
    helpClose,
    note,
  };
}

function iconButton(
  iconName: IconName,
  label: string,
  onClick: () => void,
  extraClass = '',
): HTMLButtonElement {
  return el(
    'button',
    {
      class: `icon-btn${extraClass ? ` ${extraClass}` : ''}`,
      'aria-label': label,
      title: label,
      onclick: onClick,
    },
    icon(iconName, 18),
  ) as HTMLButtonElement;
}

function sliderGroup(
  label: string,
  value: number,
  onInput: (v: number) => void,
  hint?: string,
  bounds?: { min: number; max: number },
): HTMLElement {
  const min = bounds?.min ?? 0;
  const max = bounds?.max ?? 100;
  const valueText = el('span', { class: 'slider-value' }, `${value}%`);
  const input = el('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    value: String(value),
    'aria-label': label,
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    valueText.textContent = `${input.value}%`;
    onInput(Number(input.value));
  });
  return el(
    'div',
    { class: 'slider-group' },
    el('div', { class: 'slider-label' }, el('label', {}, label), valueText),
    input,
    hint ? el('span', { class: 'slider-hint' }, hint) : null,
  );
}

function buildHelpModal(): { modal: HTMLElement; closeBtn: HTMLButtonElement } {
  const closeBtn = el(
    'button',
    {
      class: 'icon-btn',
      'aria-label': 'Close keyboard shortcuts',
      title: 'Close (Esc)',
      onclick: () => closeHelp(),
    },
    icon('close', 18),
  ) as HTMLButtonElement;

  const rows: { keys: string[]; label: string; iconName: IconName }[] = [
    { keys: ['Space', 'K'], label: 'Play or pause', iconName: 'play' },
    { keys: ['H'], label: 'Hold to take the lead', iconName: 'mic' },
    { keys: ['A'], label: 'Auto mode', iconName: 'radio' },
    { keys: ['M'], label: 'Manual mode', iconName: 'hand' },
    { keys: ['1', '2', '3'], label: 'Lyrical / Theatre / Studio', iconName: 'captions' },
    { keys: ['V'], label: 'Switch the Theatre visual', iconName: 'waves' },
    { keys: ['R'], label: 'Start or stop a Studio take', iconName: 'record' },
    { keys: ['?'], label: 'Show shortcuts', iconName: 'keyboard' },
    { keys: ['Esc'], label: 'Close this panel', iconName: 'close' },
  ];

  const modal = el(
    'div',
    {
      class: 'shortcut-modal',
      hidden: 'true',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Keyboard shortcuts',
    },
    el(
      'div',
      { class: 'shortcut-card' },
      el(
        'div',
        { class: 'shortcut-head' },
        el(
          'div',
          { class: 'shortcut-title' },
          icon('keyboard', 20),
          el('h2', {}, 'Keyboard shortcuts'),
        ),
        closeBtn,
      ),
      el(
        'div',
        { class: 'shortcut-list' },
        ...rows.map((row) =>
          el(
            'div',
            { class: 'shortcut-row' },
            el(
              'div',
              { class: 'shortcut-keys' },
              ...row.keys.map((key) => el('kbd', {}, key)),
            ),
            el(
              'span',
              { class: 'shortcut-label' },
              icon(row.iconName, 16),
              row.label,
            ),
          ),
        ),
      ),
      el(
        'p',
        { class: 'shortcut-hint' },
        'Shortcuts stay out of the way while you are typing in a field.',
      ),
    ),
  );

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeHelp();
  });

  return { modal, closeBtn };
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
      micLevel = state.level;
      r.meterFill.style.width = `${Math.round(state.level * 100)}%`;
      r.pitchText.textContent =
        state.voiced && state.pitchHz ? describePitch(state.pitchHz) : '—';
      r.meterRow.classList.toggle('voiced', state.voiced);
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
    } catch {
      if (!store.roomActive || refs !== r) return;
      toast('Microphone unavailable — switch to Manual mode and hold the lead button while you sing.', 'error');
      setMode('manual');
      r.segAuto.disabled = true;
      r.segAuto.title = 'Microphone unavailable — Auto mode needs mic access.';
    }

    // Refresh the mode buttons now that we know whether the mic started.
    setMode(store.prefs.mode);

    if (recorderSupported()) {
      recorder = new StudioRecorder();
      recorder.onStatus = (status) => {
        if (!store.roomActive || refs !== r) return;
        applyRecorderStatus(status);
      };
      if (ctx?.initialTrack) {
        recorder.setLabel(ctx.initialTrack.name, ctx.initialTrack.artists.map((a) => a.name));
      }
      applyRecorderStatus({ phase: 'idle', elapsedMs: 0, result: null });
    }

    const player = store.player ?? (store.player = new PlayerBridge());
    player.onState = (state) => handlePlayerState(state);
    player.onError = (error) => handleSdkError(error);

    setStatus('connecting', 'Connecting');
    const deviceId = await player.connect();
    if (!store.roomActive || refs !== r) return;

    const duet = store.duet ?? (store.duet = new DuetEngine());
    duet.setBaseVolume(store.prefs.baseVolume);
    duet.setBackingFactor(store.prefs.backingFactor);
    duet.setMode(store.prefs.mode);
    duet.onLead = () => {
      if (!store.roomActive || refs !== r) return;
      updateStatus();
      updateLead();
    };
    duet.start(player);
    updateLead();

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
    setNote(message);
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
  refs.playBtn.replaceChildren(icon(state.paused ? 'play' : 'pause', 26));
  const action = state.paused ? 'Play' : 'Pause';
  refs.playBtn.setAttribute('aria-label', action);
  refs.playBtn.title = `${action} (Space or K)`;
  refs.durTime.textContent = formatTime(state.duration / 1000);

  if (state.track.uri !== currentTrackUri) {
    currentTrackUri = state.track.uri;
    attributions = new Map();
    counts = { you: 0, artist: 0 };
    lastActive = -2;
    lyrics = null;
    renderTrack(state.track);
    resetStudioLyrics('Finding lyrics…', 'Searching');
    if (recorder && !recorder.isRecording) {
      recorder.setLabel(state.track.name, state.track.artists.map((a) => a.name));
    }
    void loadLyrics(state.track, state.duration);
    updateStats();
  }

  const next = state.nextTracks[0];
  if (next) {
    refs.upNext.hidden = false;
    refs.upNext.replaceChildren(
      icon('next', 12),
      el('span', {}, `Up next: ${next.name}`),
    );
  } else {
    refs.upNext.hidden = true;
  }

  updateStatus();
}

function handleSdkError(error: { kind: string; message: string }): void {
  if (!store.roomActive) return;
  toast(error.message, 'error');
  if (error.kind === 'account') {
    setNote(
      'Spotify Premium is required for in-browser playback. Close the room and connect with a Premium account.',
    );
  }
}

/* ------------------------------------------------------------
   Track + lyrics rendering
   ------------------------------------------------------------ */

function renderTrackBasics(track: {
  name: string;
  artists: { name: string }[];
  album?: { images: { url: string }[] };
}): void {
  if (!refs) return;
  refs.trackArt.replaceChildren(
    artwork(track.album?.images, 'room-art', `Artwork for ${track.name}`),
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

function setLyricsMessage(
  title: string,
  body: string | null,
  iconName: IconName = 'captions',
): void {
  if (!refs) return;
  refs.lyricsPanel.replaceChildren(
    el(
      'div',
      { class: 'lyrics-empty' },
      el('span', { class: 'lyrics-empty-icon' }, icon(iconName, 30)),
      el('strong', {}, title),
      body ? el('p', {}, body) : null,
    ),
  );
}

async function loadLyrics(track: SdkTrack, durationMs: number): Promise<void> {
  const token = ++lyricsToken;
  setLyricsMessage('Looking up lyrics…', null, 'search');
  resetStudioLyrics('Finding lyrics…', 'Searching');
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

  if (lyrics.instrumental) {
    refs.stats.hidden = true;
    setLyricsMessage(
      'Instrumental track',
      'No words to follow — the duet still works.',
      'music',
    );
    resetStudioLyrics('Instrumental track', 'Feel the melody');
    return;
  }

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
    updateStudioLyrics(Math.max(0, lastActive));
    return;
  }

  refs.stats.hidden = true;

  if (lyrics.plain) {
    const pre = el('div', { class: 'plain-lyrics' }, lyrics.plain.trim());
    refs.lyricsPanel.replaceChildren(pre);
    updateStudioLyrics(-1);
    return;
  }

  setLyricsMessage(
    'No lyrics found for this version',
    'The duet still works — this version simply is not in the lyrics databases yet.',
    'captions',
  );
  resetStudioLyrics('Lyrics unavailable', 'Follow the melody');
}

function resetStudioLyrics(title: string, hint: string): void {
  if (!refs) return;
  refs.studioLyricsHint.textContent = hint;
  for (const line of refs.studioLines) {
    line.text.textContent = '';
    line.root.classList.remove('active', 'past', 'next', 'plain', 'message');
    line.root.removeAttribute('title');
    if (line.offset === 0) {
      line.text.textContent = title;
      line.root.classList.add('message');
    }
  }
}

function updateStudioLyrics(idx: number): void {
  if (!refs) return;

  const synced = lyrics?.synced;
  if (!synced || !synced.length) {
    const plainLines = lyrics?.plain
      ?.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, refs.studioLines.length);
    if (!plainLines?.length) return;

    refs.studioLyricsHint.textContent = 'Not timed';
    refs.studioLines.forEach((slot, i) => {
      slot.text.textContent = plainLines[i] ?? '';
      slot.root.classList.remove('active', 'past', 'next', 'message');
      slot.root.classList.add('plain');
      slot.root.removeAttribute('title');
    });
    return;
  }

  refs.studioLyricsHint.textContent = 'Live lyrics';
  // Before the first timestamp, preview the opening line instead of leaving a
  // blank teleprompter.
  const center = idx >= 0 ? idx : 0;
  for (const slot of refs.studioLines) {
    const target = center + slot.offset;
    const line = synced[target];
    slot.text.textContent = line?.text || (line ? '♪' : '');
    slot.root.classList.remove('plain', 'message');
    slot.root.classList.toggle('active', slot.offset === 0 && Boolean(line));
    slot.root.classList.toggle('past', slot.offset < 0);
    slot.root.classList.toggle('next', slot.offset > 0);
    slot.root.title = line?.text ?? '';
  }
}

function updateStudioPitch(): void {
  if (!refs || currentView !== 'studio') return;
  const now = performance.now();
  if (now - lastStudioPitchAt < 120) return;
  lastStudioPitchAt = now;

  const micHz = store.mic?.pitch ?? null;
  const songHz = recorder?.musicPitch() ?? null;
  const recording = Boolean(recorder?.isRecording);

  refs.studioPitchNote.textContent = micHz ? noteName(micHz) : '—';
  refs.studioPitchTarget.textContent = songHz ? noteName(songHz) : '—';
  refs.studioPitchNote.title = micHz ? describePitch(micHz) : 'Waiting for your voice';
  refs.studioPitchTarget.title = songHz
    ? describePitch(songHz)
    : recording
      ? 'Listening to the shared song audio'
      : 'The song guide appears while a take is running';

  const tune = refs.studioPitchTune;
  tune.classList.remove('in-tune', 'sharp', 'flat', 'waiting');
  if (!micHz) {
    tune.textContent = 'Listening…';
    tune.classList.add('waiting');
    tune.title = 'Sing a note and the live pitch appears here';
    return;
  }
  if (!songHz) {
    tune.textContent = recording ? 'Finding song note…' : 'Guide in takes';
    tune.classList.add('waiting');
    tune.title = recording
      ? 'Waiting for a clear note from the shared tab audio'
      : 'Record a take to compare your pitch with the song';
    return;
  }

  let songMidi = midiFromHz(songHz);
  const micMidi = midiFromHz(micHz);
  while (songMidi - micMidi > 6) songMidi -= 12;
  while (micMidi - songMidi > 6) songMidi += 12;
  const cents = Math.round((micMidi - songMidi) * 100);
  const absolute = Math.abs(cents);
  tune.title = `${cents > 0 ? '+' : ''}${cents} cents from the song`;

  if (absolute <= 45) {
    tune.textContent = 'In tune';
    tune.classList.add('in-tune');
  } else if (absolute <= 90) {
    tune.textContent = cents > 0 ? 'A little sharp' : 'A little flat';
    tune.classList.add(cents > 0 ? 'sharp' : 'flat');
  } else {
    tune.textContent = cents > 0 ? 'Sharp ↑' : 'Flat ↓';
    tune.classList.add(cents > 0 ? 'sharp' : 'flat');
  }
}

/* ------------------------------------------------------------
   Ticker (position, active line, progress, recording check)
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
  if (currentView === 'studio') updateStudioPitch();

  if (lyrics?.synced && lines.length) {
    const idx = activeLineIndex(lyrics.synced, position / 1000);
    if (idx !== lastActive) {
      lastActive = idx;
      applyActive(idx);
    }
  }

  if (recorder?.isRecording && playback && !playback.paused) {
    if (!recordAudioSeen) {
      if (!recordAudioCheckAt) recordAudioCheckAt = now;
      if (recorder.musicRms() > 0.0008) recordAudioSeen = true;
      else if (!recordAudioWarned && now - recordAudioCheckAt > 6000) {
        recordAudioWarned = true;
        toast(
          'No song audio is reaching the take. Stop, retry, and enable “Share tab audio”.',
          'error',
        );
      }
    }
  } else if (playback?.paused) {
    recordAudioCheckAt = 0;
  }
}

function applyActive(idx: number): void {
  if (!refs) return;
  lines.forEach((line, i) => {
    line.root.classList.toggle('active', i === idx);
    line.root.classList.toggle('sung', i < idx);
  });
  updateStudioLyrics(idx);

  if (idx >= 0 && !attributions.has(idx) && store.duet) {
    const lead = store.duet.lead;
    attributions.set(idx, lead);
    counts[lead] += 1;
    const chip = el(
      'span',
      { class: `who who-${lead}` },
      icon(lead === 'you' ? 'mic' : 'music', 11),
      el('span', {}, lead === 'you' ? 'You' : 'Solo'),
    );
    lines[idx].root.prepend(chip);
    updateStats();
  }

  const active = idx >= 0 ? lines[idx] : null;
  if (active && currentView === 'lyrical') {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    active.root.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }
}

function updateStats(): void {
  if (!refs) return;
  if (!lyrics?.synced) {
    refs.stats.hidden = true;
    refs.stats.replaceChildren();
    return;
  }
  refs.stats.hidden = false;
  refs.stats.replaceChildren(
    icon('mic', 13),
    el('strong', {}, String(counts.you)),
    icon('music', 13),
    el('strong', {}, String(counts.artist)),
  );
  refs.stats.setAttribute(
    'aria-label',
    `You sang ${counts.you} lines, Solo sang ${counts.artist} lines`,
  );
}

/* ------------------------------------------------------------
   Controls
   ------------------------------------------------------------ */

function setStatus(
  kind: 'you' | 'artist' | 'paused' | 'connecting',
  text: string,
): void {
  if (!refs) return;
  const iconName: IconName =
    kind === 'you'
      ? 'mic'
      : kind === 'artist'
        ? 'music'
        : kind === 'paused'
          ? 'pause'
          : 'audioLines';
  refs.statusIcon.replaceChildren(icon(iconName, 14));
  refs.statusChip.dataset.kind = kind;
  refs.statusText.textContent = text;
}

function updateStatus(): void {
  if (!refs) return;
  if (!playback) {
    setStatus('connecting', 'Connecting');
    return;
  }
  if (playback.paused) {
    setStatus('paused', 'Paused');
    return;
  }
  if (store.duet?.lead === 'you') {
    setStatus('you', 'Your turn');
  } else {
    setStatus('artist', 'Solo sings');
  }
}

function updateLead(): void {
  if (!refs) return;
  const you = store.duet?.lead === 'you';
  refs.theatreStage.dataset.lead = you ? 'you' : 'artist';
  refs.studioStage.dataset.lead = you ? 'you' : 'artist';
  refs.theatreLead.textContent = you ? 'Your turn' : 'Solo sings';
  refs.theatreLead.dataset.kind = you ? 'you' : 'artist';
  refs.holdBtn.setAttribute('aria-pressed', you ? 'true' : 'false');
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
  refs.segAuto.setAttribute('aria-pressed', mode === 'auto' ? 'true' : 'false');
  refs.segManual.setAttribute('aria-pressed', mode === 'manual' ? 'true' : 'false');
  refs.holdBtn.disabled = mode !== 'manual';
  refs.holdBtn.title =
    mode === 'manual'
      ? 'Hold to take the lead (H)'
      : 'Switch to Manual to hold the lead (M)';
  if (mode === 'auto') refs.holdBtn.setAttribute('aria-pressed', 'false');
  updateStatus();
}

function setView(view: RoomView, opts?: { persist?: boolean }): void {
  if (!refs) return;
  currentView = view;
  refs.root.dataset.view = view;
  for (const key of VIEWS) {
    const active = key === view;
    refs.views[key].hidden = !active;
    refs.viewButtons[key].classList.toggle('active', active);
    refs.viewButtons[key].setAttribute('aria-selected', active ? 'true' : 'false');
    refs.viewButtons[key].tabIndex = active ? 0 : -1;
  }
  theatreVis?.setActive(view === 'theatre');
  studioVis?.setActive(view === 'studio');
  if (view === 'studio') updateStudioPitch();
  if (opts?.persist !== false) {
    store.prefs.view = view;
    savePrefs(store.prefs);
  }
}

function setTheatreStyle(style: TheatreStyle, opts?: { persist?: boolean }): void {
  if (!refs) return;
  store.prefs.theatreStyle = style;
  for (const key of ['wave', 'lava'] as TheatreStyle[]) {
    const active = key === style;
    refs.theatreStyleButtons[key].classList.toggle('active', active);
    refs.theatreStyleButtons[key].setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (opts?.persist !== false) savePrefs(store.prefs);
}

function toggleMixer(open?: boolean): void {
  if (!refs) return;
  const next = open ?? refs.mixerPanel.hidden;
  refs.mixerPanel.hidden = !next;
  refs.mixerBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
  refs.mixerBtn.classList.toggle('active', next);
}

function openHelp(): void {
  if (!refs || helpOpen) return;
  helpOpen = true;
  helpReturnFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  refs.helpModal.hidden = false;
  requestAnimationFrame(() => refs?.helpClose.focus());
}

function closeHelp(restoreFocus = true): void {
  if (!refs) return;
  helpOpen = false;
  refs.helpModal.hidden = true;
  if (restoreFocus) {
    const target = helpReturnFocus;
    helpReturnFocus = null;
    target?.focus();
  }
}

function setNote(message: string | null): void {
  if (!refs) return;
  refs.note.hidden = !message;
  refs.note.textContent = message ?? '';
}

function musicVisualLevel(): number {
  if (!playback || playback.paused) return 0;
  const relative = store.duet?.relativeVolume ?? 1;
  return Math.min(1, store.prefs.baseVolume * relative);
}

async function calibrateMic(): Promise<void> {
  if (!refs) return;
  const mic = store.mic;
  if (!mic?.running) {
    toast('Allow microphone access before calibrating.', 'error');
    return;
  }
  const button = refs.calibrateBtn;
  button.disabled = true;
  toast('Stay quiet for a moment — measuring the room.');
  try {
    await mic.calibrate(1600);
    toast('Microphone calibrated for this room.');
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Calibration failed.', 'error');
  } finally {
    if (refs) refs.calibrateBtn.disabled = false;
  }
}

/* ------------------------------------------------------------
   Studio recording
   ------------------------------------------------------------ */

async function toggleRecording(): Promise<void> {
  if (!refs) return;
  if (!recorderSupported()) {
    toast('Studio recording needs Chrome or Edge on desktop with tab audio.', 'error');
    return;
  }
  setView('studio');
  if (!recorder) return;

  const phase = recorder.phase;
  if (phase === 'requesting' || phase === 'finalizing') return;
  if (phase === 'recording') {
    await recorder.stop();
    return;
  }

  const mic = store.mic;
  if (!mic?.running) {
    try {
      await mic?.start();
      if (refs) {
        refs.segAuto.disabled = false;
        refs.segAuto.title = 'Auto — detect your voice (A)';
      }
      if (mic) mic.sensitivity = store.prefs.sensitivity;
      setMode(store.prefs.mode);
    } catch {
      toast('The microphone is needed for a Studio take. Allow mic access and try again.', 'error');
      return;
    }
  }
  if (!mic?.mediaStream) {
    toast('The microphone is not available.', 'error');
    return;
  }

  recordAudioSeen = false;
  recordAudioWarned = false;
  recordAudioCheckAt = 0;

  const track = playback?.track;
  try {
    recorder.setLabel(
      track?.name ?? 'Solo take',
      track?.artists.map((a) => a.name) ?? [],
    );
    await recorder.start(mic.mediaStream);
  } catch (err) {
    if (store.roomActive) {
      toast(err instanceof Error ? err.message : 'Recording could not start.', 'error');
    }
  }
}

function applyRecorderStatus(status: RecorderStatus): void {
  if (!refs) return;
  const { phase, elapsedMs, result } = status;

  const recording = phase === 'recording';
  const busy = phase === 'requesting' || phase === 'finalizing';
  refs.recordBtn.classList.toggle('is-recording', recording);
  // Stay clickable without the mic so a previously denied permission can be
  // retried from Studio; toggleRecording() requests it when needed.
  refs.recordBtn.disabled = busy || !recorder;
  refs.recordBtn.replaceChildren(
    icon(recording ? 'stop' : 'record', 20, 'record-icon'),
    refs.recordBtnLabel,
  );

  const labels: Record<RecorderStatus['phase'], string> = {
    idle: 'Record',
    requesting: 'Allow…',
    recording: 'Stop',
    finalizing: 'Saving…',
    saved: 'New take',
    error: 'Try again',
  };
  refs.recordBtnLabel.textContent = labels[phase];

  const statusLabels: Record<RecorderStatus['phase'], string> = {
    idle: 'Ready',
    requesting: 'Choose This tab',
    recording: 'Recording',
    finalizing: 'Saving take',
    saved: 'Saved',
    error: 'Try again',
  };
  refs.studioStatus.textContent = statusLabels[phase];
  refs.studioStatus.dataset.phase = phase;
  refs.studioStatus.title = status.message ?? '';

  const timerMs =
    phase === 'recording' || phase === 'finalizing'
      ? elapsedMs
      : result?.durationMs ?? 0;
  refs.studioTimer.textContent = formatTime(timerMs / 1000);

  refs.downloadRow.hidden = !result || busy || recording;
  if (result) {
    refs.downloadBtn.title = result.filename;
    refs.downloadBtn.setAttribute('aria-label', `Save ${result.filename}`);
  }

  refs.recordBadge.hidden = !recording;
  if (recording) refs.recordBadgeTime.textContent = formatTime(elapsedMs / 1000);
  refs.viewButtons.studio.classList.toggle('has-recording', recording);

  if (phase === 'saved' && lastRecorderPhase !== 'saved') {
    toast('Studio take saved to your device.');
  }
  if (phase === 'recording' && lastRecorderPhase !== 'recording') {
    studioVis?.reset();
    lastStudioPitchAt = 0;
    updateStudioPitch();
  } else if (lastRecorderPhase === 'recording' && phase !== 'recording') {
    // Once the take ends there is no song reference any more. Clear the
    // guide-relative ribbon rather than leaving an unanchored contour behind.
    studioVis?.reset();
    lastStudioPitchAt = 0;
    updateStudioPitch();
  }
  lastRecorderPhase = phase;
}

/* ------------------------------------------------------------
   Keyboard
   ------------------------------------------------------------ */

function isTypingTarget(target: HTMLElement | null): boolean {
  return Boolean(
    target &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'),
  );
}

function onKeyDown(e: KeyboardEvent): void {
  if (!store.roomActive || !refs) return;

  if (helpOpen) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeHelp();
    } else if (e.key === 'Tab') {
      trapHelpFocus(e);
    }
    return;
  }

  if (e.key === 'Escape') {
    if (!refs.mixerPanel.hidden) {
      e.preventDefault();
      toggleMixer(false);
    }
    return;
  }

  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (isTypingTarget(e.target as HTMLElement | null)) return;

  if (e.key === '?') {
    e.preventDefault();
    openHelp();
    return;
  }

  if (e.code === 'Space' || e.code === 'KeyK') {
    e.preventDefault();
    if (!e.repeat) void store.player?.togglePlay();
    return;
  }

  if (e.repeat) return;

  switch (e.code) {
    case 'KeyA':
      if (!refs.segAuto.disabled) {
        e.preventDefault();
        setMode('auto');
      }
      break;
    case 'KeyM':
      e.preventDefault();
      setMode('manual');
      break;
    case 'KeyH':
      if (store.duet?.mode === 'manual') {
        e.preventDefault();
        setHeld(true);
      }
      break;
    case 'KeyR':
      e.preventDefault();
      void toggleRecording();
      break;
    case 'KeyV':
      e.preventDefault();
      setTheatreStyle(store.prefs.theatreStyle === 'wave' ? 'lava' : 'wave');
      break;
    case 'Digit1':
    case 'Numpad1':
      e.preventDefault();
      setView('lyrical');
      break;
    case 'Digit2':
    case 'Numpad2':
      e.preventDefault();
      setView('theatre');
      break;
    case 'Digit3':
    case 'Numpad3':
      e.preventDefault();
      setView('studio');
      break;
    default:
      break;
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (!store.roomActive) return;
  if (e.code === 'KeyH' && store.duet?.mode === 'manual') setHeld(false);
}

/** Releasing focus (tab switch, notification) must not leave the artist ducked. */
function onBlur(): void {
  if (store.roomActive) setHeld(false);
}

function trapHelpFocus(e: KeyboardEvent): void {
  if (!refs) return;
  const focusables = Array.from(
    refs.helpModal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
