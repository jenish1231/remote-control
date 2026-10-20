// In-memory stand-in for createMacMedia so tests don't drive the real Mac's audio.
export function createFakeMedia({ active = true } = {}) {
  const tracks = [
    { title: 'First Song', artist: 'Artist A', album: 'Album A', duration: 200 },
    { title: 'Second Song', artist: 'Artist B', album: 'Album B', duration: 180 },
  ];
  const s = { active, index: 0, state: 'paused', position: 0, volume: 40, muted: false };
  const guard = (fn) => async () => (s.active ? (fn(), true) : false);

  return {
    _state: s,
    async nowPlaying() {
      if (!s.active) return { player: null, state: 'stopped', track: null, volume: s.volume, muted: s.muted };
      const t = tracks[s.index];
      return { player: 'Spotify', state: s.state, volume: s.volume, muted: s.muted, track: { ...t, position: s.position, hasArtwork: false } };
    },
    play: guard(() => { s.state = 'playing'; }),
    pause: guard(() => { s.state = 'paused'; }),
    next: guard(() => { s.index = (s.index + 1) % tracks.length; s.position = 0; }),
    previous: guard(() => { s.index = (s.index - 1 + tracks.length) % tracks.length; s.position = 0; }),
    seek: (sec) => guard(() => { s.position = sec; })(),
    async setVolume(level) { s.volume = level; s.muted = false; return true; },
    async toggleMute() { s.muted = !s.muted; return true; },
    async artwork() { return null; },
  };
}
