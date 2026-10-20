import { createServer } from '../src/server.js';
import { createFakeMedia } from './fake-media.js';

const media = createFakeMedia({ active: process.env.FAKE_ACTIVE !== '0' });
createServer({ media, token: process.env.REMOTE_CONTROL_TOKEN, pollMs: 200, log: () => {} })
  .listen(Number(process.env.PORT), '127.0.0.1');
