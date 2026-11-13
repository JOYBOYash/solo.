# Solo — a solo duet player

Solo plays songs from your Spotify playlists in your browser, listens while you
sing, and carries every part you leave behind. When your voice drops, the
original vocals pick the song straight back up — a duet, solo.

```
┌──────────────────────────────────────────────────────────┐
│  Solo is singing          ○── the artist's vocals play     │
│                                                            │
│  you start singing  ──▶  the mix ducks to a backing level  │
│  you stop singing   ──▶  the vocals come straight back     │
└──────────────────────────────────────────────────────────┘
```

## What it actually does

- **Library** — your real Spotify playlists (and Spotify-wide song search) load
  straight into the app. No sample data. Song search runs as you type, with
  "load more" paging. Playlist headers pick up a gradient tint from the
  artwork, Spotify-style. Playlists you follow are playable from the start even
  though Spotify no longer exposes their song lists (see below).
- **Room** — a dark performance stage: the song plays through the Spotify Web
  Playback SDK, time-synced lyrics stream from LRCLIB (free, no key), your live
  mic level and detected note are metered, and the background glows with the
  album art's colour.
- **Duet engine** — while the microphone hears your voice, the artist ducks to
  a backing level (default 12% of your master volume); when you stop, it
  returns. Every lyric line is attributed live: "You" or "Solo", with a
  running session tally.
- **Two modes** — *Auto* listens for your voice (best with headphones:
  the browser's echo cancellation suppresses the song playing from this same
  tab). *Manual* lets you hold the button — or the space bar — to take the
  lead, which is rock-solid on speakers.

### The honest engineering note

Spotify streams playback inside the SDK's cross-origin DRM iframe; that audio
**cannot** be tapped into the Web Audio API, and Spotify's terms require
content to stay "in its original form". So real-time vocal *removal* on the
Spotify stream is not possible. Solo instead drives the duet through the SDK's
**official volume control** — which is what makes the "other half" mechanic
work: the artist's vocals themselves come back the moment you stop, so you
always sing *with* the record, and the record sings back when you rest.

## Requirements

- **Node.js 20.19+ / 22+** (tested on Node 22)
- A **Spotify Premium** account — the Web Playback SDK hard-requires Premium
  for in-browser streaming. The app detects a free account and tells you.
- A **Spotify developer app** whose dashboard settings match the URL Solo is
  served from.

## Run it locally

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:5173** (it will not run from `localhost:5173` —
Spotify only accepts loopback IP redirects, and the dev server is pinned to
`127.0.0.1:5173` for that reason).

## Host it for everyone

Solo is a fully static SPA — no server, no database. Tokens live in each
singer's browser only. `npm run build` produces a `dist/` folder deployable
anywhere, and the redirect URI is computed from wherever the app is served.

### The key thing to know: Spotify's two access models

Spotify apps in **development mode** can only be used by up to **5 explicitly
added users** (dashboard → *User Management*). That is why Solo's default
model is:

**Bring your own Client ID (works for everyone, immediately).**
Each singer creates their own free Spotify app (2 minutes), registers the
redirect URI shown on Solo's setup screen, and pastes their Client ID once.
Their Client ID is stored in their browser only. Nobody needs Spotify's
approval, and the hosted site can be used by unlimited people.

**Shared Client ID (optional, needs Spotify approval).**
If you want visitors to skip setup entirely, request an **extended quota
mode** review from Spotify for your app, then deploy with your Client ID
pre-shared — for example by sending people the URL
`https://your-domain/?client_id=YOUR_CLIENT_ID` (Solo stores it and strips
it from the URL) or by adding the parameter to your landing page. Until
Spotify grants extended quota, a shared dev Client ID still only works for
your 5 added users.

### Deploy targets (configs included)

| Host | How |
| --- | --- |
| **Vercel** | Import the repo — `vercel.json` handles the SPA fallback for `/callback`. |
| **Netlify** | Connect the repo — `netlify.toml` sets `npm run build`, publishes `dist/`, and adds the `/callback` fallback. |
| **Firebase Hosting** | `npm i -g firebase-tools && firebase login && firebase use --add`, then `npm run build && firebase deploy` — `firebase.json` includes the rewrite. |
| **GitHub Pages** | Push to `master` — the workflow in `.github/workflows/deploy.yml` runs `npm run build:pages` (relative base, `index.html` copied to `404.html` so `/callback` resolves) and deploys `dist/` through GitHub Actions. Pages must be enabled for the repo; the workflow asks GitHub to create the site on its first run. |

### After deploying

This repo deploys automatically from `master` to
**https://joyboyash.github.io/solo./**; its redirect URI is
`https://joyboyash.github.io/solo./callback`. For any other host:

1. Note your live URL, e.g. `https://your-domain`.
2. In your Spotify dashboard app settings, add the redirect URI shown on
   Solo's setup screen — for a root deploy that is
   `https://your-domain/callback` (for GitHub Pages it is
   `https://user.github.io/repo/callback`). One dashboard app can hold
   several redirect URIs, so local and production can share one app.
3. Add the Spotify accounts you'll sing with under *User Management*.
4. Visit the site, paste the Client ID, connect, sing.

## The duet mechanics

1. Pick a playlist → pick a song → **Sing**.
2. Put headphones on (recommended) and watch the mic meter.
3. Sing. The status chip flips between **Solo is singing** and
   **Your turn — mic is live**; lyric lines are labelled as they happen.
4. No headphones? Switch the room to **Manual** and hold **Hold to take the
   lead** (or the space bar) while you sing.

Playback controls (previous/pause/next, click-to-seek) live in the room; when
a song ends, the next one in the playlist or search queue starts and its
lyrics load.

## Project layout

```
src/
  main.ts            boot, OAuth callback handling, ?client_id= support
  ui.ts              connect screen, library (playlists + song search), playlist view
  room.ts            the performance view: playback wiring, lyrics, controls
  store.ts           cross-screen session state + persisted preferences
  dom.ts             tiny DOM helpers, artwork/avatar placeholders, colour tinting
  style.css          the Spotify-inspired design system
  lib/
    auth.ts          Authorization Code + PKCE (S256), token refresh
    api.ts           Spotify Web API client (only endpoints available to new apps)
    sdk.ts           Web Playback SDK loader + typed Player bridge
    duet.ts          the ducking engine (auto + manual modes)
    mic.ts           microphone VAD: RMS + voice-band ratio, hold-over, pitch
    lrclib.ts        LRCLIB lyrics (synced LRC + plain), LRC parser
    clean.ts         title/artist cleanup for accurate lyrics matching
    config.ts        Client ID storage, portable redirect URI
```

Notes on API choices: Spotify's **February 2026 Dev Mode changes** reshaped
what a new app can read. Solo is built around the new rules:

- Search returns at most **10** results per request (the old maximum was 50),
  so song search pages with `offset` and a "Load more results" button.
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
| Spotify says "redirect URI invalid" | The dashboard entry must match exactly what Solo's setup screen shows (no trailing slash), e.g. `https://your-domain/callback`. |
| Spotify says the app has no access / user not found | Add your Spotify account email under **User Management** in the dashboard. |
| Room opens but no sound, "Premium required" | The connected account is a free plan. In-browser playback requires Premium. |
| Mic meter never moves | The browser blocked the microphone — allow it for the site in the address bar, then reload and re-enter the room. |
| App ducks constantly on speakers | Use headphones, or lower *Mic sensitivity*, or switch to Manual mode. |
| Playback stalls on first song | Some browsers block autoplay once per session — press **Play** in the room once. |

## Fair-use notes

Solo is a personal, non-commercial tool. Spotify's developer terms limit
streaming integrations to non-commercial use and require keeping content in
its original form — Solo therefore uses only official playback controls
(transport + volume) and never modifies or extracts Spotify audio. Lyrics are
provided by [LRCLIB](https://lrclib.net), a free community database. The
visual style is inspired by Spotify's design language; Solo is not affiliated
with Spotify AB.
