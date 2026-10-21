import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const INDEX_HTML = readFileSync(new URL('../public/index.html', import.meta.url));
const POLL_MS = 2000;

const sha = (s) => createHash('sha256').update(s).digest();
const MAX_DELTA = 2000;
const isDelta = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_DELTA;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1024) throw new Error('body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

export function createServer({ media, pointer, token = '', pollMs = POLL_MS, log = console.log }) {
  const clients = new Set();
  let timer = null;

  function authorized(req, url) {
    if (!token) return true;
    const header = req.headers.authorization ?? '';
    // EventSource can't set headers, so the UI passes the token as a query param too.
    const given = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token') ?? '';
    return timingSafeEqual(sha(given), sha(token));
  }

  async function broadcast() {
    if (!clients.size) return;
    const state = await media.nowPlaying().catch((err) => ({ error: err.message }));
    const msg = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  function subscribe(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    clients.add(res);
    // ponytail: one shared poll for all clients; per-client cadence if anyone ever needs it
    timer ??= setInterval(broadcast, pollMs);
    broadcast();
    req.on('close', () => {
      clients.delete(res);
      if (!clients.size) {
        clearInterval(timer);
        timer = null;
      }
    });
  }

  async function command(res, fn) {
    if (!(await fn())) return send(res, 409, { error: 'no active media player' });
    const state = await media.nowPlaying();
    broadcast();
    send(res, 200, state);
  }

  // Unlike media commands, pointer actions change no state worth rendering: 204 on success, 503 if the OS refused.
  async function pointerAction(res, fn) {
    try {
      await fn();
    } catch (err) {
      return send(res, 503, { error: err.message });
    }
    res.writeHead(204).end();
  }

  async function pointerDelta(req, res, fn) {
    const { dx, dy } = await readJson(req);
    if (!isDelta(dx) || !isDelta(dy)) return send(res, 400, { error: `dx and dy must be numbers within ±${MAX_DELTA}` });
    return pointerAction(res, () => fn(Math.round(dx), Math.round(dy)));
  }

  const routes = {
    'GET /now-playing': async (req, res) => send(res, 200, await media.nowPlaying()),
    'GET /events': subscribe,
    'POST /play': (req, res) => command(res, media.play),
    'POST /pause': (req, res) => command(res, media.pause),
    'POST /next': (req, res) => command(res, media.next),
    'POST /previous': (req, res) => command(res, media.previous),
    'POST /mute': (req, res) => command(res, media.toggleMute),
    'POST /volume': async (req, res) => {
      const { level } = await readJson(req);
      if (!Number.isInteger(level) || level < 0 || level > 100) return send(res, 400, { error: 'level must be an integer 0-100' });
      return command(res, () => media.setVolume(level));
    },
    'POST /seek': async (req, res) => {
      const { position } = await readJson(req);
      if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) return send(res, 400, { error: 'position must be a number of seconds >= 0' });
      return command(res, () => media.seek(Math.round(position)));
    },
    'POST /pointer/move': (req, res) => pointerDelta(req, res, pointer?.move),
    'POST /pointer/scroll': (req, res) => pointerDelta(req, res, pointer?.scroll),
    'POST /pointer/click': async (req, res) => {
      const { button = 'left', count = 1 } = await readJson(req);
      if (button !== 'left' && button !== 'right') return send(res, 400, { error: 'button must be "left" or "right"' });
      if (count !== 1 && count !== 2) return send(res, 400, { error: 'count must be 1 or 2' });
      return pointerAction(res, () => pointer.click(button, count));
    },
    'GET /artwork': async (req, res) => {
      const art = await media.artwork();
      if (!art) return send(res, 404, { error: 'no artwork' });
      if (art.redirect) {
        res.writeHead(302, { location: art.redirect, 'cache-control': 'no-store' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': art.type, 'cache-control': 'no-store' });
      res.end(art.body);
    },
  };

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const isPointer = url.pathname.startsWith('/pointer/');
    // Pointer moves arrive many times a second; only log their failures.
    res.on('finish', () => {
      if (!isPointer || res.statusCode >= 400) log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    });

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(INDEX_HTML);
    }

    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'not found' });
    if (isPointer && (!token || !pointer)) return send(res, 403, { error: 'pointer control requires REMOTE_CONTROL_TOKEN' });
    if (!authorized(req, url)) return send(res, 401, { error: 'unauthorized' });

    try {
      await handler(req, res);
    } catch (err) {
      if (res.headersSent) return res.end();
      send(res, err instanceof SyntaxError || err.message === 'body too large' ? 400 : 500, { error: err.message });
    }
  });

  server.on('close', () => clearInterval(timer));
  return server;
}
