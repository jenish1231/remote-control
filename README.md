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
- Accessibility permission for the app running the server (Terminal, iTerm, or `node`): System Settings > Privacy & Security > Accessibility.

Gestures: drag to move, tap to click, double tap to double-click, two-finger tap to right-click, two-finger drag to scroll.

## Usage

```bash
npm start
```
