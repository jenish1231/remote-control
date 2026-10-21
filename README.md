# remote-control

Control macOS media playback from any browser on your network.

## Requirements

- Node.js >= 22.9
- macOS (uses AppleScript for Spotify/Music)

### Optional: system-wide Now Playing

For Now Playing from any app or browser tab (not just Spotify/Music):

```bash
brew install ungive/media-control/media-control
```

Without it, only Spotify and Music are supported.

### Trackpad (pointer control)

The Trackpad view moves the Mac's pointer from your phone. It needs:

- `REMOTE_CONTROL_TOKEN` set (pointer control is disabled without it), and the page opened with `?token=YOUR_TOKEN`.
- Accessibility permission for the app you run `npm start` from (see below).

Gestures: drag to move, tap to click, double tap to double-click, two-finger tap to right-click, two-finger drag to scroll.

#### Granting Accessibility permission

Without it, trackpad requests return `503` with a "grant Accessibility permission" error.

1. Open System Settings > Privacy & Security > Accessibility, or run:
   ```bash
   open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
   ```
2. Turn on the app you start the server from: Terminal, iTerm, Warp, and so on. If it isn't listed, click **+** and add it from `/Applications`. Terminal is in `/Applications/Utilities`.
3. Quit that app completely (`Cmd+Q`), reopen it and run `npm start` again. A server that is already running keeps the old permission.

If you get a `503`:

- If you use the VS Code integrated terminal, grant the permission to **VS Code**, not Terminal.
- If you still get a `503` after restarting, remove the app with **−** and add it again. macOS can keep a stale entry after an app updates.

This permission lets anything run from that app control your keyboard and mouse. That's why the trackpad only works when `REMOTE_CONTROL_TOKEN` is set.

## Usage

```bash
npm start
```
