import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createFakeMedia } from './fake-media.js';
import { createFakePointer } from './fake-pointer.js';

async function start(opts) {
  const media = createFakeMedia(opts);
  const pointer = opts?.pointer;
  const server = createServer({ media, pointer, token: opts?.token, pollMs: 50, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  return { server, media, pointer, base, call };
}

const AUTH = { authorization: 'Bearer s3cret' };

describe('pointer control', () => {
  let ctx;
  before(async () => { ctx = await start({ token: 's3cret', pointer: createFakePointer() }); });
  after(() => ctx.server.close());

  test('POST /pointer/move sends rounded deltas and returns 204', async () => {
    ctx.pointer.calls.length = 0;
    const res = await ctx.call('POST', '/pointer/move', { dx: 2.6, dy: -4.4 }, AUTH);
    assert.equal(res.status, 204);
    assert.deepEqual(ctx.pointer.calls, [['move', 3, -4]]);
  });

  test('POST /pointer/move rejects invalid deltas without moving', async () => {
    ctx.pointer.calls.length = 0;
    for (const body of [{ dx: '5', dy: 0 }, { dx: 0 }, { dx: 2001, dy: 0 }, { dx: 0, dy: -2001 }, { dx: null, dy: 1 }]) {
      assert.equal((await ctx.call('POST', '/pointer/move', body, AUTH)).status, 400, JSON.stringify(body));
    }
    const infinite = await fetch(ctx.base + '/pointer/move', { method: 'POST', headers: AUTH, body: '{"dx":1e999,"dy":0}' });
    assert.equal(infinite.status, 400);
    assert.deepEqual(ctx.pointer.calls, []);
  });

  test('POST /pointer/click defaults to a left single click', async () => {
    ctx.pointer.calls.length = 0;
    assert.equal((await ctx.call('POST', '/pointer/click', null, AUTH)).status, 204);
    assert.equal((await ctx.call('POST', '/pointer/click', { button: 'right' }, AUTH)).status, 204);
    assert.equal((await ctx.call('POST', '/pointer/click', { button: 'left', count: 2 }, AUTH)).status, 204);
    assert.deepEqual(ctx.pointer.calls, [['click', 'left', 1], ['click', 'right', 1], ['click', 'left', 2]]);
  });

  test('POST /pointer/click rejects unknown buttons and counts', async () => {
    ctx.pointer.calls.length = 0;
    for (const body of [{ button: 'middle' }, { count: 3 }, { count: 0 }, { count: 1.5 }, { button: 1 }]) {
      assert.equal((await ctx.call('POST', '/pointer/click', body, AUTH)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual(ctx.pointer.calls, []);
  });

  test('POST /pointer/scroll sends rounded deltas and validates them', async () => {
    ctx.pointer.calls.length = 0;
    assert.equal((await ctx.call('POST', '/pointer/scroll', { dx: 0, dy: -7.6 }, AUTH)).status, 204);
    assert.equal((await ctx.call('POST', '/pointer/scroll', { dx: 0, dy: 5000 }, AUTH)).status, 400);
    assert.deepEqual(ctx.pointer.calls, [['scroll', 0, -8]]);
  });

  test('pointer actions leave now-playing untouched', async () => {
    const before = await (await ctx.call('GET', '/now-playing', null, AUTH)).json();
    await ctx.call('POST', '/pointer/move', { dx: 10, dy: 10 }, AUTH);
    assert.deepEqual(await (await ctx.call('GET', '/now-playing', null, AUTH)).json(), before);
  });

  test('pointer routes reject missing or wrong token', async () => {
    ctx.pointer.calls.length = 0;
    assert.equal((await ctx.call('POST', '/pointer/click')).status, 401);
    assert.equal((await ctx.call('POST', '/pointer/click', null, { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await ctx.call('POST', '/pointer/click?token=s3cret')).status, 204);
    assert.deepEqual(ctx.pointer.calls, [['click', 'left', 1]]);
  });
});

describe('pointer control without a token', () => {
  let ctx;
  before(async () => { ctx = await start({ pointer: createFakePointer() }); });
  after(() => ctx.server.close());

  test('pointer routes are forbidden but media still works', async () => {
    for (const [path, body] of [['/pointer/move', { dx: 1, dy: 1 }], ['/pointer/click'], ['/pointer/scroll', { dx: 0, dy: 1 }]]) {
      const res = await ctx.call('POST', path, body);
      assert.equal(res.status, 403, path);
      assert.match((await res.json()).error, /REMOTE_CONTROL_TOKEN/);
    }
    assert.deepEqual(ctx.pointer.calls, []);
    assert.equal((await ctx.call('POST', '/play')).status, 200);
  });
});

describe('pointer control when the adapter fails', () => {
  let ctx;
  before(async () => { ctx = await start({ token: 's3cret', pointer: createFakePointer({ failWith: 'grant Accessibility permission' }) }); });
  after(() => ctx.server.close());

  test('returns 503 with the adapter message', async () => {
    const res = await ctx.call('POST', '/pointer/move', { dx: 1, dy: 1 }, AUTH);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'grant Accessibility permission');
  });
});

describe('with an active player', () => {
  let ctx;
  before(async () => { ctx = await start(); });
  after(() => { ctx.server.closeAllConnections(); ctx.server.close(); });

  test('GET / serves the UI', async () => {
    const res = await ctx.call('GET', '/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Mac Remote/);
  });

  test('GET /now-playing returns track, player and volume', async () => {
    const body = await (await ctx.call('GET', '/now-playing')).json();
    assert.equal(body.player, 'Spotify');
    assert.equal(body.track.title, 'First Song');
    assert.equal(body.volume, 40);
  });

  test('POST /play then /pause toggles state', async () => {
    assert.equal((await (await ctx.call('POST', '/play')).json()).state, 'playing');
    assert.equal((await (await ctx.call('POST', '/pause')).json()).state, 'paused');
  });

  test('POST /next and /previous change track', async () => {
    assert.equal((await (await ctx.call('POST', '/next')).json()).track.title, 'Second Song');
    assert.equal((await (await ctx.call('POST', '/previous')).json()).track.title, 'First Song');
  });

  test('POST /volume sets level and validates input', async () => {
    assert.equal((await (await ctx.call('POST', '/volume', { level: 75 })).json()).volume, 75);
    for (const level of [-1, 101, 5.5, '50', undefined]) {
      assert.equal((await ctx.call('POST', '/volume', { level })).status, 400, `level=${level}`);
    }
  });

  test('POST /volume rejects malformed JSON', async () => {
    const res = await fetch(ctx.base + '/volume', { method: 'POST', body: '{nope' });
    assert.equal(res.status, 400);
  });

  test('POST /mute toggles', async () => {
    assert.equal((await (await ctx.call('POST', '/mute')).json()).muted, true);
    assert.equal((await (await ctx.call('POST', '/mute')).json()).muted, false);
  });

  test('POST /seek moves position and validates input', async () => {
    assert.equal((await (await ctx.call('POST', '/seek', { position: 42.4 })).json()).track.position, 42);
    assert.equal((await ctx.call('POST', '/seek', { position: -3 })).status, 400);
  });

  test('GET /artwork 404s when there is none', async () => {
    assert.equal((await ctx.call('GET', '/artwork')).status, 404);
  });

  test('GET /events streams state and pushes after commands', async () => {
    const res = await ctx.call('GET', '/events');
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const reader = res.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /^data: .*"player":"Spotify"/);
    await reader.cancel();
  });

  test('unknown route is 404', async () => {
    assert.equal((await ctx.call('GET', '/nope')).status, 404);
  });
});

describe('with no player open', () => {
  let ctx;
  before(async () => { ctx = await start({ active: false }); });
  after(() => ctx.server.close());

  test('now-playing reports no player instead of failing', async () => {
    const body = await (await ctx.call('GET', '/now-playing')).json();
    assert.equal(body.player, null);
    assert.equal(body.track, null);
  });

  test('transport commands return 409', async () => {
    for (const path of ['/play', '/pause', '/next', '/previous']) {
      assert.equal((await ctx.call('POST', path)).status, 409, path);
    }
    assert.equal((await ctx.call('POST', '/seek', { position: 1 })).status, 409);
  });

  test('volume still works without a player', async () => {
    assert.equal((await ctx.call('POST', '/volume', { level: 10 })).status, 200);
  });
});

describe('with a token', () => {
  let ctx;
  before(async () => { ctx = await start({ token: 's3cret' }); });
  after(() => ctx.server.close());

  test('UI page is public', async () => {
    assert.equal((await ctx.call('GET', '/')).status, 200);
  });

  test('API rejects missing or wrong token', async () => {
    assert.equal((await ctx.call('GET', '/now-playing')).status, 401);
    assert.equal((await ctx.call('GET', '/now-playing', null, { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await ctx.call('GET', '/now-playing?token=wrong')).status, 401);
  });

  test('API accepts bearer header or query token', async () => {
    assert.equal((await ctx.call('GET', '/now-playing', null, { authorization: 'Bearer s3cret' })).status, 200);
    assert.equal((await ctx.call('GET', '/now-playing?token=s3cret')).status, 200);
  });
});
