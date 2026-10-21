Status: ready-for-agent

# Spec: Remote Trackpad

## Problem Statement

The remote can pause a song or change the volume, but anything beyond that still means walking back to the Mac: dismissing a dialog, clicking "Skip Intro" in a browser tab, picking the next episode, scrolling a page, or waking a video that a media key can't reach. The user is already holding their phone with the remote open, but it can't move the Mac's pointer.

## Solution

Add a trackpad to the existing web UI. The user switches from the media view to a trackpad view, a large touch surface that works like a laptop trackpad. Dragging one finger moves the Mac's pointer, a tap clicks, a two-finger tap right-clicks, and a two-finger drag scrolls. The server turns these gestures into real macOS pointer events. It reuses the same server, the same token auth and the same page, so there is nothing new to install on the phone.

## User Stories

1. As a user, I want a trackpad area in the remote UI, so that I can control the Mac's pointer from my phone.
2. As a user, I want to switch between the media controls and the trackpad, so that each gets enough screen space on a small phone.
3. As a user, I want the app to remember which view I last used, so that reopening the page takes me back where I was.
4. As a user, I want dragging one finger on the trackpad to move the pointer by the same relative distance, so that it feels like a laptop trackpad and not a touchscreen.
5. As a user, I want the pointer to keep moving smoothly while I drag, so that I can aim at small targets.
6. As a user, I want faster finger movement to move the pointer further, so that I can cross a large screen without many swipes.
7. As a user, I want a sensitivity setting, so that I can tune pointer speed for my screen size and phone.
8. As a user, I want a single tap to left-click, so that I can press buttons and links.
9. As a user, I want a double tap to double-click, so that I can open files or select words.
10. As a user, I want a two-finger tap to right-click, so that I can open context menus.
11. As a user, I want a two-finger vertical drag to scroll, so that I can read long pages and lists.
12. As a user, I want a two-finger horizontal drag to scroll sideways, so that I can move through carousels and wide content.
13. As a user, I want visible Left and Right click buttons under the trackpad, so that I can click reliably when tap gestures misfire.
14. As a user, I want a resting finger or a tiny accidental movement not to count as a drag, so that taps register as clicks.
15. As a user, I want the page itself not to scroll, zoom or bounce while I use the trackpad, so that my gestures only reach the Mac.
16. As a user, I want the trackpad to work in mobile Safari and Chrome on Android, so that any phone on my network can use it.
17. As a user on a desktop browser, I want mouse dragging on the trackpad to work too, so that I can test or use it from another computer.
18. As a user, I want clear feedback when the Mac hasn't granted input-control permission, so that I know to fix it in System Settings and don't assume the remote is broken.
19. As a user, I want the trackpad to show when the connection to the Mac is lost, so that I don't keep swiping into nothing.
20. As a user on slow Wi-Fi, I want pointer movement to stay responsive and not build up a backlog, so that the pointer doesn't keep drifting after I lift my finger.
21. As the Mac owner, I want pointer control to require the access token, so that someone else on my network can't take over my mouse.
22. As the Mac owner, I want a clear message on startup and in the UI when pointer control is disabled because no token is set, so that I know how to enable it.
23. As the Mac owner, I want the server to reject malformed or absurdly large movement values, so that a buggy or hostile client can't fling the pointer around.
24. As the Mac owner, I want pointer control to have no effect on media control, so that the existing remote keeps working when the trackpad is unavailable.
25. As a keyboard or screen-reader user of the remote page, I want the view switch and the click buttons to be labelled and focusable, so that the new controls are accessible.
26. As a user, I want the trackpad to follow the page's light and dark theme, so that it matches the rest of the remote.

## Implementation Decisions

- **New pointer module, parallel to the media module.** A macOS-only pointer adapter exposes a small interface: `move(dx, dy)`, `click(button, count)` and `scroll(dx, dy)`, where `button` is `left` or `right` and `count` is 1 or 2. Each call resolves to success, or throws an error whose message the server can pass on. The entrypoint creates it next to the media adapter and passes it to the server.
- **Server gets an optional `pointer` dependency.** `createServer({ media, pointer, token, ... })`. If `pointer` is missing, the pointer routes behave as disabled. Media routes are unchanged.
- **API contract** (all POST, JSON body, the same auth as the existing API):
  - `POST /pointer/move` `{ dx, dy }`: relative move in pixels. Both are finite numbers with absolute value ≤ 2000, rounded to integers.
  - `POST /pointer/click` `{ button, count }`: `button` is `"left"` or `"right"` (default `"left"`), `count` is 1 or 2 (default 1).
  - `POST /pointer/scroll` `{ dx, dy }`: scroll deltas in lines or pixels with the same bounds as move.
  - Success returns `204` with no body. A pointer action doesn't change media state, so there is nothing to render and no SSE broadcast.
  - Invalid input returns `400` with `{ error }`, as the existing validation does.
  - No token configured returns `403` with `{ error: "pointer control requires REMOTE_CONTROL_TOKEN" }`.
  - Adapter failure, such as missing Accessibility permission, returns `503` with the adapter's message.
- **Pointer control requires a token.** This changes the existing "token optional" rule for this feature only. Media control without a token is an annoyance, but pointer control without a token on a shared network gives anyone control of the Mac. The startup log says pointer control is disabled when no token is set.
- **Native event posting, no new npm dependency.** The adapter posts CoreGraphics mouse events. It does not spawn a process per event, because an `osascript` spawn costs tens of milliseconds and pointer movement arrives many times per second. It runs one long-lived helper process, such as JXA with the ObjC bridge to CoreGraphics, and writes commands to it on stdin. The helper is started lazily on first use and restarted if it exits. Relative moves read the current pointer location and post a move event to the new location, which the OS clamps to the screen bounds. Clicks post down and up events at the current location, with the click-count field set for double-clicks. Scrolls post a scroll-wheel event.
- **macOS permission.** Posting events needs Accessibility permission for the process that runs the server, such as Terminal or the node binary. When permission is missing, the adapter reports a clear error naming System Settings, Privacy & Security, Accessibility. The README documents this.
- **Client-side coalescing.** The UI adds up pointer deltas and sends at most one move request at a time. While a request is in flight, new movement collects into the next one. This keeps the pointer from drifting after the finger lifts on a slow network. Acceleration and sensitivity are applied on the client before sending, so the server only sees final pixel deltas.
- **Gesture handling uses Pointer Events** (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) on the trackpad surface, with `touch-action: none` so the browser doesn't scroll or zoom the page. The number of active pointers decides the gesture: one finger moves or taps, two fingers scroll or tap for a right-click. A tap is a press and release within a short time and a small movement distance. A double tap is two taps close together and sends `count: 2`.
- **UI structure.** The single page gains a two-option view switch, Media and Trackpad, as a labelled segmented control. The trackpad view has the touch surface, Left and Right buttons under it, and a sensitivity slider. The chosen view and sensitivity are stored in `localStorage`, wrapped in try/catch. Errors go to the existing status message element. The trackpad surface looks disabled when SSE reports a lost connection.
- **Vocabulary.** "Pointer" is the macOS cursor being controlled. "Trackpad" is the touch surface in the UI. Endpoints and the adapter use "pointer", not "mouse", because the target is the system pointer whatever the input device.

## Testing Decisions

- **Good tests check behaviour you can see from outside**: HTTP status codes, response bodies, and which pointer actions reached the adapter. They don't check gesture-detection internals or helper-process wiring.
- **API tests (main seam)** extend the existing node:test HTTP suite with a fake pointer adapter. The fake records calls in order and can be told to fail. Cases:
  - Move, click and scroll pass validated, rounded values to the adapter and return 204.
  - Defaults: click without a body is a left single-click.
  - Validation: non-numbers, `NaN` and `Infinity`, values over the bound, unknown buttons, and counts other than 1 or 2 all return 400, and the adapter is not called.
  - No token configured: all pointer routes return 403, and media routes still work.
  - Token configured: pointer routes return 401 without the token or with a wrong one, and accept a bearer header or a query token.
  - Adapter failure returns 503 with the adapter's message.
  - Pointer calls don't change `now-playing`.
- **UI tests** extend the existing Playwright suite against the fake-backed test server, using the same per-port setup with a token-enabled instance. Cases:
  - Switching to Trackpad shows the surface, switching back shows the media controls, and the choice survives a reload.
  - A synthesised drag on the surface produces one or more move calls whose summed deltas match the drag direction.
  - A tap sends a left click, and the Left and Right buttons send the matching clicks.
  - A two-finger gesture sends scroll or right-click, where the browser can synthesise multi-touch. Otherwise this case is skipped and the case is covered by the button tests.
  - With no token configured, the trackpad shows the disabled message.
  - The test server needs the fake pointer to report its recorded calls back to the test. The simplest way is a test-only read endpoint in the UI test server, not in production code.
- **The real CoreGraphics adapter is not unit-tested**, the same as the real media adapter. It is checked by hand on a Mac with Accessibility permission granted.
- **Prior art:** the existing API test suite with its fake media adapter, and the existing Playwright suite with its fake-backed UI test server.

## Out of Scope

- Keyboard input or text typing from the phone.
- Absolute positioning or a screen mirror or preview of the Mac display.
- Drag and drop or click-and-hold (tap-and-drag drag-lock).
- Three-finger gestures, pinch-to-zoom, Mission Control, or app switching.
- Multi-monitor awareness beyond the OS clamping to the screen bounds.
- A WebSocket or other low-latency transport. HTTP with coalescing is the baseline, and a new transport is worth considering only if latency proves unacceptable.
- Non-macOS hosts.

## Further Notes

- This is the first feature that can do real damage if the remote is exposed, which is why it requires a token. A later change could apply the same rule to the whole app.
- If HTTP round-trip latency on a typical LAN makes the pointer feel laggy even with coalescing, the next step is a persistent bidirectional channel, such as a WebSocket or a streamed POST, behind the same pointer adapter interface. The adapter and its tests would stay the same.
- The README needs a short section on granting Accessibility permission.
