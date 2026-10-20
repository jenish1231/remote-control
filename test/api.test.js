import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createFakeMedia } from './fake-media.js';

async function start(opts) {
  const media = createFakeMedia(opts);
  const server = createServer({ media, token: opts?.token, pollMs: 50, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  return { server, media, base, call };
}

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
