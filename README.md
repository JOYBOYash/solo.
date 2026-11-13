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
  straight into the app. No sample data. Search runs as you type with a small
  debounce, and pages with **Load more results**. Playlist headers pick up a
  gradient tint from the artwork, Spotify-style.
- **Playlists you follow** — Spotify's February 2026 API only exposes the songs
  of playlists you own or collaborate on. Solo still shows followed playlists
  and offers **Play from the start**; the room picks up each song from the
  Playback SDK as Spotify plays it.
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
  for in-browser streaming. Playback reports the account limitation if it is a
  free plan.
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

No environment variables are required locally. The setup screen asks for a
Spotify Client ID and stores it in your browser. If you want to skip that step:

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
6. In the Spotify developer dashboard, add the redirect URI below (see the
   exact Spotify setup next).

`vercel.json` rewrites unknown paths to `index.html`, so `/callback` works as an
SPA route.

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

1. Pick a playlist → pick a song → **Sing** (or **Play from the start**).
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
    config.ts        Client ID storage, env defaults, portable redirect URI
```

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
| Spotify says the app has no access / user not found | Add your Spotify account email under **User Management** in the dashboard. Development apps are limited to 5 users. |
| Connect screen keeps asking for a Client ID | `VITE_SPOTIFY_CLIENT_ID` is empty or not a 32-character hex ID. Set it in Vercel for the correct environment and redeploy. |
| Playlists load but a followed playlist has no songs | This is Spotify's February 2026 API rule. Use **Play from the start**; Solo will follow the playback. |
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
