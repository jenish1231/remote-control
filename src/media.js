import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const SEP = '\u001f';

// Scripts differ per app, so only known players are allowed (also keeps env input out of AppleScript).
const KNOWN_PLAYERS = ['Spotify', 'Music'];

async function osascript(script) {
  const { stdout } = await run('osascript', ['-e', script], { timeout: 3000 });
  return stdout.trim();
}

// `tell application "X"` compiles X's dictionary and pops a "Where is X?" dialog if X isn't installed,
// so every tell block must be guarded by this check first.
async function isRunning(app) {
  try {
    return (await osascript(`application "${app}" is running`)) === 'true';
  } catch {
    return false;
  }
}

function trackScript(app) {
  const durationExpr = app === 'Spotify' ? '(duration of t) / 1000' : 'duration of t';
  const artworkExpr = app === 'Spotify' ? 'artwork url of t' : '""';
  return `
    set US to character id 31
    tell application "${app}"
      if player state is stopped then return "stopped"
      set t to current track
      set info to (player state as text) & US & (name of t) & US & (artist of t) & US & (album of t) & US & ${artworkExpr}
      set p to player position
      set d to ${durationExpr}
    end tell
    -- round must run outside the tell, otherwise it receives an app reference instead of a number
    return info & US & (round p) & US & (round d)`;
}

async function readVolume() {
  try {
    const [volume, muted] = (await osascript(
      'set s to get volume settings\nreturn ((output volume of s) as text) & "," & ((output muted of s) as text)'
    )).split(',');
    return { volume: Number.isFinite(+volume) ? +volume : null, muted: muted === 'true' };
  } catch {
    return { volume: null, muted: false };
  }
}

async function mediaControl(args) {
  const { stdout } = await run('media-control', args, { timeout: 3000, maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout.trim() || 'null');
}

const appNames = new Map();
async function appName(pid, bundleId) {
  if (!appNames.has(pid)) {
    const { stdout } = await run('ps', ['-o', 'comm=', '-p', String(pid)]).catch(() => ({ stdout: '' }));
    appNames.set(pid, stdout.match(/([^/]+)\.app\//)?.[1] ?? bundleId);
  }
  return appNames.get(pid);
}

export function createMacMedia({ priority = KNOWN_PLAYERS } = {}) {
  const players = priority.filter((p) => KNOWN_PLAYERS.includes(p));
  let lastArtworkUrl = '';
  let hasMediaControl = true;

  // System-wide Now Playing (any app or browser tab) via the media-control CLI; null when unavailable or idle.
  async function systemNowPlaying() {
    if (!hasMediaControl) return null;
    try {
      const d = await mediaControl(['get', '--now', '--no-artwork']);
      if (!d) return null;
      return {
        player: await appName(d.processIdentifier, d.bundleIdentifier),
        state: d.playing ? 'playing' : 'paused',
        track: {
          title: d.title ?? '',
          artist: d.artist ?? '',
          album: d.album ?? '',
          position: Math.round(d.elapsedTimeNow ?? d.elapsedTime ?? 0),
          duration: Math.round(d.duration ?? 0),
          hasArtwork: true,
        },
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        hasMediaControl = false;
        console.log('media-control not found; only Spotify and Music are supported (brew install ungive/media-control/media-control)');
      }
      return null;
    }
  }

  async function control(systemArgs, appleCommand) {
    if (await systemNowPlaying()) {
      await run('media-control', systemArgs, { timeout: 3000 });
      return true;
    }
    return tell(appleCommand);
  }

  async function activePlayer() {
    let fallback = null;
    for (const app of players) {
      if (!(await isRunning(app))) continue;
      const raw = await osascript(trackScript(app)).catch(() => 'stopped');
      if (raw !== 'stopped') return { app, raw };
      fallback ??= { app, raw };
    }
    return fallback;
  }

  async function tell(command) {
    const found = await activePlayer();
    if (!found) return false;
    await osascript(`tell application "${found.app}" to ${command}`);
    return true;
  }

  return {
    async nowPlaying() {
      const [system, vol] = await Promise.all([systemNowPlaying(), readVolume()]);
      if (system) return { ...system, ...vol };
      const found = await activePlayer();
      const base = { player: found?.app ?? null, state: 'stopped', track: null, ...vol };
      if (!found || found.raw === 'stopped') return base;
      const [state, title, artist, album, artworkUrl, position, duration] = found.raw.split(SEP);
      lastArtworkUrl = artworkUrl;
      return {
        ...base,
        state,
        track: { title, artist, album, position: +position || 0, duration: +duration || 0, hasArtwork: found.app === 'Music' || !!artworkUrl },
      };
    },
    play: () => control(['play'], 'play'),
    pause: () => control(['pause'], 'pause'),
    next: () => control(['next-track'], 'next track'),
    previous: () => control(['previous-track'], 'previous track'),
    seek: (seconds) => control(['seek', String(seconds)], `set player position to ${seconds}`),
    async setVolume(level) {
      await osascript(`set volume output volume ${level} without output muted`);
      return true;
    },
    async toggleMute() {
      await osascript('set volume output muted (not (output muted of (get volume settings)))');
      return true;
    },
    // Returns { redirect } for Spotify's https art, { body, type } for embedded art, or null.
    async artwork() {
      if (hasMediaControl) {
        const d = await mediaControl(['get']).catch(() => null);
        if (d) return d.artworkData ? { body: Buffer.from(d.artworkData, 'base64'), type: d.artworkMimeType || 'image/jpeg' } : null;
      }
      const found = await activePlayer();
      if (!found || found.raw === 'stopped') return null;
      if (found.app === 'Spotify') return lastArtworkUrl ? { redirect: lastArtworkUrl } : null;
      const path = join(tmpdir(), `remote-control-art-${process.pid}`);
      try {
        await osascript(`
          tell application "Music" to set d to raw data of artwork 1 of current track
          set f to open for access (POSIX file "${path}") with write permission
          set eof f to 0
          write d to f
          close access f`);
        const body = await readFile(path);
        const type = body[0] === 0x89 ? 'image/png' : 'image/jpeg';
        return { body, type };
      } catch {
        return null;
      } finally {
        await rm(path, { force: true });
      }
    },
  };
}
