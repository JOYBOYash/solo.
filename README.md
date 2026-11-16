# Solo — a solo duet player

Solo plays songs from **Audius**, **your own audio files**, or a **Spotify
playlist**, listens while you sing, and carries every part you leave behind. When
your voice drops, the original vocals pick the song straight back up — a duet,
solo.

Audius and local files need no account, no subscription and no setup. Spotify is
optional, and the whole app installs as a PWA.

```
┌──────────────────────────────────────────────────────────┐
│  Solo is singing          ○── the artist's vocals play     │
│                                                            │
│  you start singing  ──▶  the mix ducks to a backing level  │
│  you stop singing   ──▶  the vocals come straight back     │
└──────────────────────────────────────────────────────────┘
```

## What it actually does

- **Free music from Audius** — search independent music or start with what is
  trending, all through Audius's keyless public API. Playback runs through a
  Web Audio graph inside the page, so the duet, live pitch, Theatre visuals and
  Studio takes all work without an account, a tab picker or Spotify.
- **Your own audio files** — drop MP3s, M4As, WAVs, FLACs, OGG or OPUS files
  from this device. They stay in the browser; nothing is uploaded. Best for
  songs that are not on a streaming service.
- **Spotify playlists (optional)** — connect your own Spotify app to load real
  playlists and Spotify-wide song search. Search runs as you type with a small
  debounce, and pages with **Load more results**. Playlist headers pick up a
  gradient tint from the artwork, Spotify-style.
- **Playlists you follow** — Spotify's February 2026 API only exposes the songs
  of playlists you own or collaborate on. Solo still shows followed playlists
  and offers **Play from the start**; the room picks up each song from the
  Playback SDK as Spotify plays it.
- **Room** — a dark, icon-first performance stage: time-synced lyrics arrive from
  LRCLIB (with a lyrics.ovh fallback), your live mic level and detected note are
  metered, and the background glows with the artwork's colour.
- **Duet engine** — while the microphone hears your voice, the song drops to a
  backing level (default 60% of your master volume); when you stop, it returns
  to full volume. The live **Song level while you sing** slider lets you keep
  the record clearly audible under your voice. Every lyric line is attributed
  live: "You" or "Solo", with a running session tally.
- **Auto and Manual** — *Auto* listens for your voice with an adaptive noise
  floor, voice-band/pitch evidence and hold-over, so quiet singing still takes
  the lead (best with headphones: the browser's echo cancellation suppresses
  the song playing from this same tab). *Manual* lets you hold the button — or
  the **H** key — to take the lead, which is rock-solid on speakers. **Calibrate
  room** samples a quiet moment when Auto needs a tighter baseline.
- **Three views, same performance** — **Lyrical** for synced words, **Theatre**
  for one full-bleed wave or lava visual with no lyrics, and **Studio** for a
  lyric teleprompter with a live pitch guide and an explicit take recorder.
  Switching views never interrupts playback or the duet.
- **Studio takes** — explicitly start a recording to save your voice plus the
  ducked song to your device. The pitch guide compares your live note with the
  song while you sing. Nothing is uploaded.
- **Installable PWA** — a manifest, app icons, an offline app shell and the
  browser's native install prompt. Install Solo from the home page or your
  browser menu; it opens full-screen like a native app.

### The honest engineering note

Audius and local files are ordinary `<audio>` sources, so Solo wires them into
the Web Audio API: it can analyse the song, draw its real waveform, show its
detected pitch, and record the exact mix the singer hears.

Spotify is different. Its Web Playback SDK streams inside a cross-origin DRM
iframe; that audio **cannot** be tapped into the Web Audio API, and Spotify's
terms require content to stay "in its original form". So real-time vocal
*removal* on the Spotify stream is not possible, and there is no vocals-only
stem to lower. Solo instead drives the Spotify duet through the SDK's **official
volume control** — which is what makes the "other half" mechanic work: the
artist's vocals themselves come back the moment you stop, so you always sing
*with* the record, and the record sings back when you rest. The room slider
controls the whole mix, so you can choose how present the record stays while you
sing.

## Requirements

- **Node.js 20.19+ / 22+** (tested on Node 22) for local development.
- **Any modern browser** for Audius and local files. Chrome, Edge, Firefox and
  Safari all work; recording needs `MediaRecorder`.
- **Spotify is optional.** If you connect it, in-browser playback needs a
  **Spotify Premium** account and a **Spotify developer app** whose dashboard
  settings match the URL Solo is served from. Free Spotify accounts can browse,
  but cannot stream through the Web Playback SDK.

## Run it locally

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Audius and local files work on any host; use
`127.0.0.1` rather than `localhost` if you also connect Spotify, because Spotify
only accepts loopback IP redirects. The dev server is pinned to
`127.0.0.1:5173` for that reason.

No environment variables are required locally. Free sources need no setup at
all. To skip the Spotify Client ID step, optionally run:

```bash
copy .env.example .env.local
# then set VITE_SPOTIFY_CLIENT_ID=your-32-character-client-id
```

## Deploy on Vercel

Solo is a fully static SPA — no server, no database, no secrets. Tokens live in
each singer's browser only.

1. Push this repository to GitHub (already done).
2. In Vercel, **Add New → Project** and import the repository.
3. Vercel auto-detects Vite. Confirm:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
   - **Install command:** `npm ci`
4. Add environment variables (optional — only needed if you want this deployment
   to use **your** Spotify app rather than each visitor's own app):

   | Variable | Value | Why |
   | --- | --- | --- |
   | `VITE_SPOTIFY_CLIENT_ID` | your 32-character Spotify Client ID | Lets visitors press **Connect Spotify** without pasting an ID. It is public and safe to expose. Development-mode apps can only serve the users you allowlist (max 5). |
   | `VITE_SPOTIFY_REDIRECT_URI` | e.g. `https://your-domain.com/callback` | Only needed when the public URL differs from the browser's origin. Leave empty normally. |

   Vite inlines these values at **build time**, so redeploy after changing them.
   Never add a Client Secret — Solo uses PKCE and has no backend.

   Leave `VITE_SPOTIFY_CLIENT_ID` empty for a public deployment where every
   singer brings their own Spotify app. That is the only way to serve unlimited
   people: Spotify extended-quota access is restricted to established
   organizations, so a personal app can't be approved for public use.

5. Deploy. Vercel gives you a production URL such as
   `https://solo-yourname.vercel.app`.
6. Optional, only if you connect Spotify: in the Spotify developer dashboard,
   add the redirect URI below (see the exact Spotify setup next). Audius and
   local files need no dashboard at all.

`vercel.json` rewrites unknown paths to `index.html`, so `/callback` works as an
SPA route. `public/sw.js` and `public/manifest.webmanifest` are served from the
site root, with no extra configuration.

## Install as an app (PWA)

Solo ships a manifest, 192/512/maskable PNG icons from the supplied logos, an
Apple touch icon and a small hand-written service worker. Installation is
optional — the site works normally in a tab.

- **Chrome or Edge on desktop:** press **Install app** on the home page, or use
  the install icon in the address bar.
- **Android:** use the browser menu → **Install app** / **Add to Home screen**.
- **iPhone or iPad:** Share → **Add to Home Screen**.

The service worker caches the app shell and hashed Vite assets, so an installed
Solo opens with no connection. Audius streams, Spotify playback and lyrics still
need the network; once files are chosen, local playback and Studio takes work
offline. The worker uses a network-first navigation strategy so a new deployment
appears on the next online load, and it never caches Spotify, Audius or LRCLIB
requests.

### Vercel preview deployments

Spotify redirect URIs do not support wildcards. Preview URLs look like
`https://solo-git-branch-yourname.vercel.app`, and each one must be added to the
dashboard separately if you want to sign in there. The simplest setup is to test
Spotify sign-in on the production domain.

## Spotify developer setup (inside the dashboard)

Create one Spotify app for your deployment. These are the values Solo expects:

| Setting | Value |
| --- | --- |
| App name | Solo (any name is fine) |
| APIs / SDKs | Web API + Web Playback SDK |
| Redirect URI (production) | `https://your-vercel-domain/callback` (exact, no trailing slash) |
| Redirect URI (local) | `http://127.0.0.1:5173/callback` |
| Client ID | Put it in `VITE_SPOTIFY_CLIENT_ID`, or paste it into Solo's setup screen |
| Client Secret | **Not used.** Do not put it in the frontend or in Vercel. |

The app requests these scopes at sign-in:

- `user-read-private` — display name and profile image
- `playlist-read-private` — private playlists
- `playlist-read-collaborative` — collaborative playlists
- `user-modify-playback-state` — start/pause/seek playback
- `streaming` — Spotify Web Playback SDK

Enable the **Web Playback SDK** for the app if the dashboard presents it as a
separate option.

### Development mode vs. public use

Spotify apps in **development mode** can only be used by explicitly added
accounts (currently up to **5 users**), and the app owner must have Spotify
Premium. In the dashboard, open **User Management** and add the email address of
every Spotify account that will sign in, including your own.

This is also what a `Spotify request failed (403)` usually means. A
Development-Mode app refuses every account that is not on its allowlist, and
in-browser playback additionally needs Premium. The browser cannot bypass
either check: the app owner adds the account in the dashboard, or the singer
uses Audius or local files instead. Solo's connect screen explains this and
keeps both free sources one tap away.

For a public deployment you have two options:

**Bring your own Client ID (works immediately, no approval).**
Leave `VITE_SPOTIFY_CLIENT_ID` empty. Each visitor creates their own Spotify
app, adds the redirect URI shown on Solo's setup screen, and pastes their Client
ID. It is stored in their browser only. This is Solo's default model and works
for unlimited people.

**Shared Client ID (personal / small group).**
Set `VITE_SPOTIFY_CLIENT_ID` to your app's Client ID. Only the users in your
User Management allowlist (max 5) can sign in. Spotify no longer grants
extended quota to individuals — since May 2025 that review is limited to
established organizations — so this route is for you and a few friends, not for
a public launch. Use the bring-your-own-Client-ID model for public use.

### After deploying

1. Note your live URL, e.g. `https://your-domain`.
2. In the Spotify dashboard, add the redirect URI shown on Solo's setup screen —
   for a root deploy that is `https://your-domain/callback`.
   One app can hold several redirect URIs, so local and production can share it.
3. Add the Spotify accounts you'll sing with under **User Management**.
4. Visit the site, connect, pick a song, and sing.

## The duet mechanics

1. Pick a source: **Audius** trending/search, **Local files**, or a Spotify
   playlist. Pick a song → **Sing** (or **Play from the start** for Spotify).
2. Put headphones on (recommended) and watch the mic meter.
3. Sing. The status chip flips between **Solo sings** and **Your turn**; lyric
   lines are labelled as they happen.
4. No headphones? Switch the room to **Manual** and hold **Lead** (or **H**)
   while you sing.
5. Open the sliders button beside the mode switch for master volume, the song
   level under your voice, mic sensitivity, and **Calibrate room**.

Playback controls (previous/pause/next, click-to-seek) live in the room; when
a song ends, the next one in the playlist or search queue starts and its
lyrics load.

## Views

The three view tabs (or **1** / **2** / **3**) all run on the same playback and
duet state. Solo remembers the last view you used, and whether Theatre was on
**Wave** or **Lava**.

| View | What it shows |
| --- | --- |
| **Lyrical** | The synced words, with each line attributed to **You** or **Solo**. Plain lyrics appear when no synced version exists. |
| **Theatre** | One full-bleed visual with no scrolling: layered green and warm-white **Wave** ribbons, or a slow **Lava** plasma field. The active lead glows. Switch styles with the Wave/Lava buttons or **V**. |
| **Studio** | A five-line lyric teleprompter with the current line centred, a scrolling **pitch guide** (your voice against the song), then the recorder, timer, status, and **Save take**. |

### What the visuals show

The green voice is always the real microphone signal. The song lane depends on
the source:

- **Audius and local files** run through Solo's own Web Audio graph, so the
  Theatre waveform, Studio pitch ribbon and level strip read the actual song at
  all times.
- **Spotify** audio lives inside the SDK's cross-origin DRM iframe. During a
  Studio take the visuals use the real captured tab audio; otherwise the
  Theatre's warm layer is a calm synthetic ribbon whose amplitude follows the
  actual playback volume, including pauses and duet ducking.

The Studio pitch guide is literal: your live note is the green contour, the
warm dashed line is the song's detected note folded into the octave nearest your
voice, and the shaded band is a comfortable ±0.8 semitones. The mirrored strip
underneath shows your loudness above the line and the song's below it. With
Audius or local files the song reference is live whenever music plays; with
Spotify it exists only during a take, because that is the only time the browser
lets Solo hear the tab. Before then the guide says **Guide in takes** and your
note is placed on an absolute pitch window instead of being judged against a
target. During a take (or during inline playback), ±45 cents reads **In tune**,
up to ±90 cents reads **A little sharp/flat**, and beyond that
**Sharp ↑ / Flat ↓**.

## Studio recording

Studio records **your microphone plus the song as you hear it**, including the
duet's volume changes, and saves the mix on your device. While the take runs,
the pitch guide and the note readout show how your voice sits against the song.

**Audius and local files** record directly from Solo's Web Audio graph — no tab
picker, and it works in any browser with `MediaRecorder` (Chrome, Edge, Firefox
and Safari). **Spotify** audio still needs desktop tab capture.

1. Open **Studio** and press **Record** (or **R**).
2. For Spotify, choose **This tab** in the browser picker and switch on
   **Share tab audio**. Chrome and Edge on desktop are the supported target.
   Without shared tab audio Solo refuses the take and explains; if the track
   stays silent, a warning asks you to stop and retry. Audius and local files
   skip this step entirely.
3. Sing. The teleprompter keeps the current line centred, the pitch guide draws
   your voice against the song, and the timer and red badge show that a take is
   running. The badge stays visible in every view.
4. Press **Stop**. Solo finalises the file and downloads it automatically; the
   latest take can be downloaded again with **Save take**.
5. Leaving the room while recording finalises and downloads the take as well.

Recording is opt-in on every take, and audio never leaves the browser. Spotify's
stream cannot be captured directly (DRM/cross-origin), which is why Spotify
needs tab audio. Mobile browsers generally cannot capture tab audio, but they
can still record Audius and local-file takes.

## Keyboard shortcuts

Shortcuts are ignored while you are typing in a search field or any other input.
Press **?** in the room to see this list.

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
- **[lyrics.ovh](https://lyrics.ovh)** as a plain-text fallback when LRCLIB has
  no usable record.

Streaming titles are ambiguous, so candidates are scored against the real
source title, all credited artists, album, duration, synced availability and
version markers (remix, live, acoustic, instrumental, karaoke, demo, cover,
sped-up/slowed, extended). Name local files `Artist - Song.mp3` to give the
matcher both halves. Version markers and title evidence are hard gates,
not soft penalties: a remix or live version never silently falls back to the
original version's words, and a one-word title is never accepted for a longer,
different title. A bounded second search runs for version-tagged songs when the
first query only returns the original recording.

Because lyrics.ovh has no metadata and fuzzy-matches unknown titles, Solo uses
it only when LRCLIB has no candidates at all, and only after confirming the
exact song in the free [iTunes Search API](https://performance-partners.apple.com/search-api)
with compatible artist and duration. If that validation cannot run, Solo shows
no lyrics rather than guessed ones. Successful lookups are cached for the
session; misses are retried on the next visit.

## Project layout

```
public/
  manifest.webmanifest  PWA manifest (standalone, icons, theme colour)
  sw.js                 offline app-shell service worker
  icons/                generated 192/512/maskable + Apple touch icons
  Solo_*.svg            supplied logo variants used by the app and favicons
src/
  main.ts            boot, OAuth callback handling, ?client_id= support, PWA init
  ui.ts              home/source chooser, Spotify library, Audius + local libraries
  room.ts            the performance view: playback wiring, views, controls, recording
  store.ts           cross-screen session state + persisted preferences
  dom.ts             tiny DOM helpers, artwork/avatar placeholders, colour tinting
  icons.ts           inline SVG icon set (Lucide-style, no dependency)
  style.css          the Spotify-inspired design system
  lib/
    auth.ts          Authorization Code + PKCE (S256), token refresh
    api.ts           Spotify Web API client (only endpoints available to new apps)
    sdk.ts           Web Playback SDK loader + Spotify SoloPlayer bridge
    playback.ts      shared player/source/queue types
    inline-player.ts Web Audio player for Audius streams and local files
    audius.ts        keyless Audius search + trending client
    local.ts         local audio-file parsing and track metadata
    duet.ts          the ducking engine (auto + manual modes)
    mic.ts           microphone VAD: adaptive floor, band/pitch evidence, hold-over
    recorder.ts      mic + song Studio recorder (Web Audio + MediaRecorder)
    pwa.ts           install prompt capture and service-worker registration
    visualizer.ts    full-bleed Theatre wave / lava canvas
    studio-visualizer.ts  Studio pitch ribbon and mirrored level strip
    lrclib.ts        LRCLIB + lyrics.ovh lookup, scoring, LRC parser
    clean.ts         version-aware title/artist cleanup for lyrics matching
    config.ts        Client ID storage, env defaults, portable redirect URI
```

Free sources use **Audius**'s public API (`api.audius.co`) and the browser's
File API. Both are keyless and CORS-enabled; no proxy, backend or uploaded file
is involved. The service worker only caches Solo's own shell and hashed assets.

Notes on API choices: Spotify's **February 2026 Dev Mode changes** reshaped
what a new app can read. Solo is built around the new rules:

- Search returns at most **10** results per request (the old maximum was 50),
  so song search pages with `offset` and a **Load more results** button.
- A playlist's songs now live at `GET /playlists/{id}/items` (the old
  `/tracks` endpoint was removed), and Spotify only exposes items for playlists
  the user **owns or collaborates on**. Followed playlists show their metadata
  and a **Play from the start** action instead; Solo reads the now-playing track
  from the Playback SDK and keeps the duet/lyrics flow running.
- Playlist song counts come from `items.total`; followed playlists often omit
  it, so their cards fall back to the owner's name.
- `GET /me` no longer returns `product`; the Premium badge and warning banner
  are hidden when Spotify doesn't report a plan. Playback itself still requires
  a Premium account, and the SDK reports any account limitation when you start.

Spotify deprecated `audio-features`, `audio-analysis`, `recommendations` and
related endpoints for new apps in November 2024 — Solo uses none of them.
Everything (voice detection, lyric sync, progress) is computed live from the
mic and the playback state instead.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Spotify says "redirect URI invalid" | The dashboard entry must match exactly what Solo's setup screen shows (no trailing slash, correct domain, `https://`), e.g. `https://your-domain/callback`. |
| `Spotify request failed (403)` | The connected account is not on the Spotify app's **User Management** allowlist (Development Mode) or the account cannot use in-browser playback. Add the account in the dashboard, use a Premium account, or switch to **Free music** / **Local files**. |
| Spotify says the app has no access / user not found | Add your Spotify account email under **User Management** in the dashboard. Development apps are limited to 5 users. |
| Connect screen keeps asking for a Client ID | `VITE_SPOTIFY_CLIENT_ID` is empty or not a 32-character hex ID. Set it in Vercel for the correct environment and redeploy. |
| Playlists load but a followed playlist has no songs | This is Spotify's February 2026 API rule. Use **Play from the start**; Solo will follow the playback. |
| Room opens but no sound, "Premium required" | The connected account is a free plan. In-browser Spotify playback requires Premium — or sing with Audius or local files instead. |
| Audius shows "could not be reached" | Audius is a public API and occasionally rate-limits or 503s. Press **Trending** / **Try again**, or search again in a moment. |
| An Audius song will not play | Audius stream URLs expire. Solo retries once through Audius's stable endpoint; if it still fails, pick another track. |
| A local file will not play | The browser lacks that codec. MP3 and M4A are the safest across browsers; WAV/FLAC/OGG support varies. |
| Mic meter never moves | The browser blocked the microphone — allow it for the site in the address bar, then reload and re-enter the room. |
| Auto mode misses quiet singing | Open the sliders panel and raise **Mic sensitivity**, press **Calibrate room** while the room is quiet, or switch to Manual. Headphones improve separation. |
| App ducks constantly on speakers | Use headphones, or lower *Mic sensitivity*, or switch to Manual mode. |
| Spotify Studio says "Choose This tab" or captures no song | In the share picker choose **This tab** and enable **Share tab audio**. Chrome or Edge on desktop is required; mobile browsers usually cannot capture tab audio. |
| Studio recording is unavailable | Audius/local recording needs `MediaRecorder` (Chrome, Edge, Firefox, Safari). Spotify recording additionally needs desktop tab capture over HTTPS (Vercel) or `http://127.0.0.1`. |
| "Install app" does nothing | Before installing, the browser needs one online visit and a moment for the service worker. Use the browser's own **Install** menu; on iOS use Share → **Add to Home Screen**. |
| The installed app shows an old version | Reopen it online once — navigation is network-first and updates automatically. If needed, close all app windows and reopen. |
| Playback stalls on first song | Some browsers block autoplay once per session — press **Play** in the room once. |

## Fair-use notes

Solo is a personal, non-commercial tool. Spotify's developer terms limit
streaming integrations to non-commercial use and require keeping content in
its original form — Solo therefore uses only official Spotify playback controls
(transport + volume) and never modifies or extracts Spotify audio.

Free music is streamed from [Audius](https://audius.co), an artist-first
platform with a public API; tracks remain the property of their artists and can
disappear when an artist removes them. Local files never leave the device.
Lyrics are provided by [LRCLIB](https://lrclib.net) and
[lyrics.ovh](https://lyrics.ovh), free community databases. The visual style is
inspired by Spotify's design language; Solo is not affiliated with Spotify AB,
Audius or LRCLIB.
