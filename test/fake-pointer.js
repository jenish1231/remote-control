// Records pointer actions instead of moving the real Mac pointer.
export function createFakePointer({ failWith = null } = {}) {
  const calls = [];
  const record = (name) => async (...args) => {
    if (failWith) throw new Error(failWith);
    calls.push([name, ...args]);
  };
  return { calls, move: record('move'), click: record('click'), scroll: record('scroll') };
}
