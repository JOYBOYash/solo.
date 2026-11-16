# Solo — a solo duet player

Solo plays a song, listens while you sing, and carries every part you leave
behind. When your voice drops, the original vocals pick the song straight back
up — a duet, solo.

Two sources, both played by their official web players:

- **YouTube** — free. Search and trending with your own Google Data API key.
- **Spotify** — optional. Your playlists with your own Spotify app Client ID and
  a Premium account.

No backend, no database, no secrets. Every key stays in your browser.

```
┌──────────────────────────────────────────────────────────┐
│  Solo is singing          ○── the artist's vocals play     │
│                                                            │
│  you start singing  ──▶  the mix ducks to a backing level  │
│  you stop singing   ──▶  the vocals come straight back     │
└──────────────────────────────────────────────────────────┘
```

## What it does

- **YouTube mode** — live search and trending music through the YouTube Data
  API v3, with a visual thumbnail grid. Playback uses the official YouTube
  IFrame player, which stays visible in a small dock inside the room.
- **Spotify mode** — connect your own Spotify app with PKCE, browse your
  playlists, search Spotify-wide, and play through the Web Playback SDK.
- **Room** — a dark, icon-first stage. Time-synced lyrics from LRCLIB (with a
  lyrics.ovh fallback), a live mic meter, and artwork-tinted ambience.
- **Duet engine** — while the mic hears your voice, the song drops to a backing
  level (60% by default). Stop, and the record comes back. Auto mode listens
  with an adaptive noise floor; Manual mode lets you hold the lead.
- **Three views** — **Lyrical** for synced words, **Theatre** for one full-bleed
  wave or lava visual, **Studio** for a lyric teleprompter, pitch guide and an
  explicit take recorder.
- **Studio takes** — record your microphone plus the song into one file on your
  device. Nothing is uploaded.
- **Installable PWA** — manifest, icons, offline shell and the browser's native
  install prompt.
- **Setup guides** — short in-app modals plus full articles at `#/guides`,
  `#/guides/youtube` and `#/guides/spotify`.

### The honest engineering note

Both sources render audio inside cross-origin iframes. That audio cannot be
tapped into the Web Audio API, so Solo controls the duet with each player's
**official volume control**. During a Studio take, the song is captured from
this browser tab instead. No vocals are removed and no stream is modified — you
always sing *with* the record, and the record sings back when you rest.

## Requirements

- **Node.js 20.19+ / 22+** for local development.
- **A modern browser.** Chrome or Edge on desktop for Studio recording.
- **YouTube mode:** a Google Cloud project with the YouTube Data API v3 enabled
  and an API key. The free daily quota is 10,000 units; a search costs 100 and
  trending costs 1.
- **Spotify mode:** a Spotify developer app Client ID, your account on the app's
  User Management allowlist in Development Mode, and Spotify Premium for
  playback. No client secret is used.

## Run it locally

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Spotify only accepts loopback IP redirect URIs,
so use `127.0.0.1` rather than `localhost` if you plan to connect Spotify.

No environment variables are required. Each visitor brings their own keys. To
offer a shared Spotify Client ID from this deployment, optionally run:

```bash
copy .env.example .env.local
# then set VITE_SPOTIFY_CLIENT_ID=your-32-character-client-id
```

`VITE_SPOTIFY_REDIRECT_URI` is only needed when the public URL differs from the
browser's origin. Vite inlines these at build time. Never add a Spotify client
secret.

## Deploy on Vercel

Solo is a fully static SPA.

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project** and import it.
3. Confirm **Framework preset: Vite**, **Build command: `npm run build`**,
   **Output directory: `dist`**.
4. Deploy. `vercel.json` rewrites unknown paths to `index.html`, so `/callback`
   works as an SPA route.

Add the production redirect URI shown in Solo's Spotify setup screen to your
Spotify app. YouTube keys need no deployment configuration: each visitor pastes
their own.

## Keys and setup

### YouTube

Open **YouTube → Add your YouTube key → How to get a key** in Solo. The full
article is at `#/guides/youtube`. In short:

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **YouTube Data API v3**.
3. Create an **API key** under Credentials.
4. Restrict it to Websites (this site and `http://localhost:5173`) and to the
   YouTube Data API v3.
5. Paste it into Solo. It is stored in this browser only.

The key is sent directly to `googleapis.com`. Quota errors, disabled APIs and
website restrictions produce friendly messages with a **Change key** action.

### Spotify

Open **Spotify → Add your app key → How to get your key**. The full article is at
`#/guides/spotify`. In short:

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Add the exact redirect URI Solo shows (`http://127.0.0.1:5173/callback`
   locally, `https://your-domain/callback` in production).
3. Add every singing account under **User Management** (Development Mode allows
   up to 5 users).
4. Copy the **Client ID** (32 hex characters). The Client secret is never used.
5. Paste it into Solo and connect with a Premium account.

A redirect mismatch shows `INVALID_CLIENT` or `redirect_uri mismatch`. A 403
usually means the account is not allowlisted, or lacks Premium.

## Recording

Studio records **your microphone plus the song as you hear it**.

1. Open **Studio** and press **Record** (or **R**).
2. Choose **This tab** in the browser picker and switch on **Share tab audio**.
3. Sing. The pitch guide compares your live note with the captured song.
4. Press **Stop**. The file downloads automatically; **Save take** re-downloads
   the latest one.

Tab capture requires desktop Chrome or Edge. Without shared tab audio Solo
refuses the take and explains why. Audio never leaves the browser.

## The room

1. Pick a source, then a song. For YouTube, tap any video card. For Spotify,
   press **Sing** or **Sing from the start**.
2. Headphones are recommended. Watch the mic meter and status chip.
3. Sing. The chip flips between **Solo sings** and **Your turn**, and lyric
   lines are attributed as they happen.
4. On speakers, switch to **Manual** and hold **Lead** (or **H**).
5. Open the sliders button for master volume, song level under your voice, mic
   sensitivity, and **Calibrate room**.

Playback controls (previous/pause/next, click-to-seek) live in the room. When a
song ends, the next queue item starts and its lyrics load.

### Views

| View | What it shows |
| --- | --- |
| **Lyrical** | Synced words, each line attributed to **You** or **Solo**. Plain lyrics when no synced version exists. |
| **Theatre** | One full-bleed visual: layered **Wave** ribbons or a slow **Lava** field. The active lead glows. |
| **Studio** | A five-line teleprompter, a live pitch guide, then the recorder, timer, status and **Save take**. |

### Visuals and pitch

The green voice lane is always the real microphone signal. YouTube and Spotify
audio live in cross-origin players, so the song lane uses the captured tab audio
during a take and the actual playback volume otherwise. The Studio pitch guide
shows your live note against the song's detected note folded into the nearest
octave; the shaded band is a comfortable ±0.8 semitones. Before a take the guide
says **Guide in takes** because that is the only time the browser lets Solo hear
the song.

## Keyboard shortcuts

Shortcuts are ignored while typing in a field. Press **?** in the room.

| Keys | Action |
| --- | --- |
| **Space** / **K** | Play or pause |
| **A** | Auto mode |
| **M** | Manual mode |
| **H** (hold) | Take the lead in Manual mode |
| **1** / **2** / **3** | Lyrical / Theatre / Studio |
| **R** | Start or stop a Studio take |
| **V** | Switch Theatre between Wave and Lava |
| **?** | Open the shortcut panel |
| **Esc** | Close the shortcut panel or mixer |

## Lyrics matching

Solo queries two free, keyless, CORS-enabled sources:

- **[LRCLIB](https://lrclib.net)** for synced LRC and plain lyrics.
- **[lyrics.ovh](https://lyrics.ovh)** as a plain-text fallback.

Streaming titles are ambiguous, so candidates are scored against title, credited
artists, album, duration, synced availability and version markers (remix, live,
acoustic, instrumental, karaoke, demo, cover, sped-up/slowed, extended). Version
markers are hard gates: a remix never silently receives the original's words.
lyrics.ovh is used only when LRCLIB has no candidates and the exact song is
confirmed through the free iTunes Search API. If validation cannot run, Solo
shows no lyrics rather than guessed ones.

## Install as an app (PWA)

Solo ships a manifest, 192/512/maskable icons, an Apple touch icon and a small
hand-written service worker. Installation is optional.

- **Chrome or Edge desktop:** **Install app** on the home page or the address-bar
  install icon.
- **Android:** browser menu → **Install app**.
- **iPhone/iPad:** Share → **Add to Home Screen**.

The service worker caches the app shell and hashed Vite assets, so an installed
Solo opens offline. YouTube search, Spotify playback and lyrics still need the
network. Navigation is network-first, so a new deployment appears on the next
online load.

## Project layout

```
public/
  manifest.webmanifest  PWA manifest (standalone, icons, theme colour)
  sw.js                 offline app-shell service worker
  icons/                generated 192/512/maskable + Apple touch icons
  Solo_*.svg            supplied logo variants
src/
  main.ts               boot, OAuth callback, guide hash routing, PWA init
  ui.ts                 home, YouTube search, Spotify library, guides/modal
  room.ts               playback wiring, views, controls, recording
  store.ts              cross-screen state + persisted preferences
  dom.ts                DOM helpers, artwork/avatar placeholders, tinting
  icons.ts              inline SVG icon set (Lucide-style)
  style.css             base design system
  minimal.css           minimal visual UI, guides and video dock
  lib/
    auth.ts             Authorization Code + PKCE (S256), token refresh
    api.ts              Spotify Web API client
    sdk.ts              Web Playback SDK loader + Spotify SoloPlayer bridge
    youtube.ts          YouTube Data API client + key storage
    youtube-player.ts   official IFrame player + SoloPlayer bridge
    playback.ts         shared player/source/queue types
    duet.ts             ducking engine (auto + manual modes)
    mic.ts              microphone VAD and pitch detection
    recorder.ts         mic + tab-audio Studio recorder
    pwa.ts              install prompt and service-worker registration
    visualizer.ts       full-bleed Theatre wave / lava canvas
    studio-visualizer.ts Studio pitch ribbon and level strip
    lrclib.ts           LRCLIB + lyrics.ovh lookup, scoring, LRC parser
    clean.ts            version-aware title/artist cleanup
    config.ts           Client ID storage, env defaults, redirect URI
```

## Notes on the APIs

- YouTube search uses `search.list` (100 quota units) and trending uses
  `videos.list?chart=mostPopular` (1 unit) with `videoCategoryId=10`. A second
  `videos.list` call adds durations and filters out videos whose owners disabled
  embedding.
- YouTube playback uses the official IFrame Player API with `controls: 0`. The
  player remains visible in the room as the terms require. If autoplay is
  blocked, press **Play** once.
- Spotify search returns at most **10** results per request, so song search
  paginates with **Load more**. Since February 2026, playlist items are exposed
  only for playlists the user owns or collaborates on; followed playlists offer
  **Sing from the start** instead.
- `GET /me` no longer returns `product`, so the Premium badge is hidden when
  Spotify does not report a plan. Playback still requires Premium.
- Solo never uses Spotify's deprecated audio-features or recommendations
  endpoints. Everything is computed live from the mic and playback state.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| YouTube says the API is disabled | Enable **YouTube Data API v3** in Google Cloud, wait a minute, then retry. |
| YouTube key is rejected | Copy the whole key (usually starts with `AIza`). If it is restricted, allow this website and the YouTube Data API v3. |
| YouTube quota exhausted | The key used its free daily quota. Wait for the reset or use another Google project/key. |
| A video will not play | The owner disabled embedding. Solo skips it automatically; pick another result. |
| Spotify `INVALID_CLIENT` / redirect mismatch | The dashboard redirect URI must match Solo's exactly, including scheme and no trailing slash. |
| Spotify 403 / user not found | Add the account email under **User Management** in the Spotify app, and use a Premium account for playback. |
| Connect screen keeps asking for a Client ID | `VITE_SPOTIFY_CLIENT_ID` is empty or invalid, or the local key was cleared. Paste a 32-character Client ID. |
| Followed playlist has no songs | Spotify's 2026 API rule. Use **Sing from the start**; Solo follows playback. |
| Room opens but no sound | Press **Play** once (autoplay policy) and check the source player's volume. |
| Studio captures no song | Choose **This tab** and enable **Share tab audio**. Chrome or Edge on desktop is required. |
| Mic meter never moves | Allow microphone access for the site, reload, and re-enter the room. |
| Auto mode misses quiet singing | Raise **Mic sensitivity**, press **Calibrate room** in silence, or use Manual mode. |
| App ducks constantly on speakers | Use headphones, lower mic sensitivity, or switch to Manual. |
| "Install app" does nothing | Visit online once, then use the browser's install menu. On iOS use Share → **Add to Home Screen**. |
| Installed app shows an old version | Reopen it online once; navigation is network-first and updates automatically. |

## Fair-use notes

Solo is a personal, non-commercial tool. Spotify's developer terms limit
streaming integrations to non-commercial use and require keeping content in its
original form; Solo therefore uses only official playback controls and never
modifies or extracts Spotify audio. YouTube playback uses the official embedded
player with its branding and visibility requirements intact.

Music and thumbnails belong to their creators. Lyrics come from
[LRCLIB](https://lrclib.net) and [lyrics.ovh](https://lyrics.ovh). The visual
style is inspired by Spotify's design language; Solo is not affiliated with
YouTube, Google, Spotify AB or LRCLIB.
