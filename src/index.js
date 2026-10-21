import { spawn, execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createMacMedia } from './media.js';
import { createMacPointer } from './pointer.js';
import { createServer } from './server.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const token = process.env.REMOTE_CONTROL_TOKEN || '';
const priority = (process.env.PLAYER_PRIORITY || 'Spotify,Music').split(',').map((s) => s.trim());
const serviceName = process.env.SERVICE_NAME || 'Mac Remote';

const pointer = createMacPointer();
const server = createServer({ media: createMacMedia({ priority }), pointer, token });

server.listen(port, host, () => {
  const lan = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;
  const hostname = execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim();
  const query = token ? `/?token=${encodeURIComponent(token)}` : '/';

  // Advertise over Bonjour so the Mac shows up as an HTTP service on the LAN; dns-sd exits when we do.
  const bonjour = spawn('dns-sd', ['-R', serviceName, '_http._tcp', 'local', String(port), 'path=/'], { stdio: 'ignore' });
  const stop = () => { bonjour.kill(); pointer.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`remote-control running. Open on your phone (same Wi-Fi):`);
  console.log(`  http://${hostname}.local:${port}${query}`);
  if (lan) console.log(`  http://${lan}:${port}${query}`);
  console.log(`Advertised on Bonjour as "${serviceName}" (_http._tcp)`);
  if (!token) {
    console.log('warning: REMOTE_CONTROL_TOKEN not set; anyone on your network can control playback');
    console.log('trackpad disabled: set REMOTE_CONTROL_TOKEN to enable pointer control');
  }
});
