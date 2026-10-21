Status: ready-for-agent

# Spec: Remote Mac Media Control Web App

## Problem Statement

When away from the Mac (in another room, on a phone, or on a tablet), there is no easy way to control media playback — pause a song, skip a track, adjust volume — without walking back to the machine. Existing solutions require installing proprietary apps or don't surface the currently playing track clearly.

## Solution

A lightweight web app with two parts: a server that runs on the Mac and exposes an HTTP API for media control, and a browser-based UI that any device on the same network (or over the internet) can open to control playback. The UI shows what is currently playing and provides one-tap controls for the most common actions.

## User Stories

1. As a user, I want to open the web app from my phone browser, so that I can control my Mac media without installing any native app.
2. As a user, I want to see the currently playing track title, artist, and album, so that I know what is playing before I interact with it.
3. As a user, I want to see album art for the current track, so that I can visually confirm what is playing.
4. As a user, I want to tap a play/pause button, so that I can start or stop playback without going to my Mac.
5. As a user, I want to skip to the next track, so that I can move past a song I do not want to hear.
6. As a user, I want to go back to the previous track, so that I can replay a song I liked.
7. As a user, I want to adjust the system volume up or down, so that I can change how loud the audio is without touching the Mac.
8. As a user, I want to mute and unmute the Mac, so that I can silence audio instantly.
9. As a user, I want the now-playing information to update automatically, so that I do not have to manually refresh the page when the track changes.
10. As a user, I want the UI to work on small phone screens, so that I can use it comfortably on any device.
11. As a user, I want the UI to work in dark mode, so that it is comfortable to use at night.
12. As a user, I want to see a playback progress bar, so that I know how far through the current track I am.
13. As a user, I want to seek to a position in the current track, so that I can jump to a specific point.
14. As a user, I want to see the current volume level, so that I know what I am adjusting from.
15. As a user, I want to find the app on my local network by a `.local` name or Bonjour, so that I do not need to know my Mac's IP address.
16. As a user, I want to see a clear error state when no media is playing, so that the UI does not show stale or confusing information.
17. As a user, I want the app to detect and show the name of the active media player (Spotify, Apple Music, etc.), so that I know which app is being controlled.
18. As a user, I want the controls to be disabled when no media player is active, so that I do not tap buttons that do nothing.
19. As a developer, I want the server to expose a documented HTTP API, so that I can build alternative clients or automate control via scripts.
20. As a developer, I want the server to log incoming requests, so that I can debug issues without attaching a debugger.

## Implementation Decisions

- **Server**: Node.js HTTP server (Fastify or Express) running on the Mac on a configurable port (default `3000`). Chosen for fast startup, no runtime dependency beyond Node, and easy cross-platform JSON tooling.
- **Media control backend**: `osascript` (AppleScript) called via `child_process.execSync`. Targets the frontmost media-capable app or a prioritised list (Spotify → Apple Music → system). No third-party media CLI dependency — AppleScript is available on every Mac.
- **Now-playing polling**: server-sent events (SSE) on `GET /events` pushes now-playing state to connected clients every 2 seconds. Simpler than WebSockets for a one-way push; no extra library needed.
- **API surface** (all JSON):
  - `GET  /now-playing` — current track, artist, album, artwork URL, position, duration, volume, player name, playing state
  - `POST /play` — resume playback
  - `POST /pause` — pause playback
  - `POST /next` — skip to next track
  - `POST /previous` — go to previous track
  - `POST /volume` body `{ "level": 0–100 }` — set absolute volume
  - `POST /mute` — toggle mute
  - `POST /seek` body `{ "position": seconds }` — seek within track
  - `GET  /events` — SSE stream of now-playing updates
- **Client**: single-page app served as static files from the same Node server (no separate CDN or dev server in production). Vanilla JS or a minimal framework (Preact). No build step required for initial version — one HTML file + inline script is acceptable.
- **Album art**: proxied through the server at `GET /artwork` to avoid CORS issues when the artwork URL is a local file or a protected endpoint.
- **Auth**: optional bearer token configured via environment variable `REMOTE_CONTROL_TOKEN`. If set, all endpoints require `Authorization: Bearer <token>`. Off by default for local network use.
- **Manual start, LAN discovery**: the user starts the server manually (`npm start`, which loads `.env`); there is no auto-start on login. On start the server advertises itself over Bonjour (`_http._tcp`, via the built-in `dns-sd`) and prints its `<LocalHostName>.local` URL.
- **Browser and any-app media**: the system Now Playing (via the `media-control` CLI) is the primary backend, covering browser tabs and any app; the Spotify/Music AppleScript path is the fallback.

## Testing Decisions

- **What makes a good test**: test observable HTTP behaviour — response status codes, response body shapes, and side effects visible through subsequent `GET /now-playing` calls. Do not mock `osascript`; if no media player is running during tests, the server should return a clear "no player" state rather than throwing.
- **API tests**: integration tests using a real running server instance started in the test process. One test per endpoint covering the happy path and the "no player active" error path.
- **UI tests**: Playwright tests that open the served HTML in a real browser, interact with buttons (play, pause, next, previous, volume slider), and assert DOM state changes. The Playwright tests run against the same local server as the API tests.
- **Prior art**: none in this repo yet (greenfield). Structure tests after the conventional `tests/` directory with `api.test.js` and `ui.spec.js` (or `.test.ts` if TypeScript is adopted).

## Out of Scope

- Controlling multiple Macs simultaneously.
- Streaming audio from the Mac to the browser.
- Playlist browsing or queue management.
- Native iOS/Android app.
- Cross-platform support (Windows, Linux) — macOS-only via AppleScript.
- User accounts or multi-user access control beyond a single shared token.
- Wake-on-LAN or waking a sleeping Mac.

## Further Notes

- The server must run as a user process (not root) to access AppleScript and the logged-in user's media apps.
- If Spotify and Apple Music are both open, Spotify takes priority in the player selection list; this order should be configurable via an env var `PLAYER_PRIORITY`.
- Album artwork for Apple Music tracks may be a `file://` URI; the `/artwork` proxy endpoint handles this case.
- For remote access outside the local network, the user is expected to set up their own tunnel (Tailscale, Cloudflare Tunnel, etc.); this is out of scope for the app itself.
