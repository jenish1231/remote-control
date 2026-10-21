import http from 'node:http';
import { createServer } from '../src/server.js';
import { createFakeMedia } from './fake-media.js';
import { createFakePointer } from './fake-pointer.js';

const media = createFakeMedia({ active: process.env.FAKE_ACTIVE !== '0' });
const pointer = createFakePointer();
const app = createServer({ media, pointer, token: process.env.REMOTE_CONTROL_TOKEN, pollMs: 200, log: () => {} });
const handle = app.listeners('request')[0];

// Test-only: lets Playwright read (GET) and reset (DELETE) what reached the fake pointer.
http.createServer((req, res) => {
  if (req.url !== '/__pointer-calls') return handle(req, res);
  if (req.method === 'DELETE') pointer.calls.length = 0;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(pointer.calls));
}).listen(Number(process.env.PORT), '127.0.0.1');
