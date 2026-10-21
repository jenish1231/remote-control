import { spawn } from 'node:child_process';

// Runs inside one long-lived `osascript -l JavaScript` process: spawning per event is too slow for pointer movement.
// Reads one JSON command per line on stdin, answers "ok" or "err <message>" per line on stdout, in order.
const HELPER = String.raw`
ObjC.import('CoreGraphics');
ObjC.import('ApplicationServices');
ObjC.import('Foundation');
const out = $.NSFileHandle.fileHandleWithStandardOutput;
const reply = (s) => out.writeData($.NSString.alloc.initWithUTF8String(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
const where = () => $.CGEventGetLocation($.CGEventCreate(null));
const post = (e) => $.CGEventPost(0, e);
const BUTTONS = { left: [1, 2, 0], right: [3, 4, 1] };

function run(cmd) {
  if (!$.AXIsProcessTrusted()) throw new Error('grant Accessibility permission to the app running the server (System Settings > Privacy & Security > Accessibility)');
  const p = where();
  if (cmd.op === 'move') {
    post($.CGEventCreateMouseEvent(null, 5, { x: p.x + cmd.dx, y: p.y + cmd.dy }, 0));
  } else if (cmd.op === 'click') {
    // count is this click's position in a multi-click run (field 1 = kCGMouseEventClickState), as macOS reports a real double-click.
    const [down, up, button] = BUTTONS[cmd.button];
    for (const type of [down, up]) {
      const e = $.CGEventCreateMouseEvent(null, type, p, button);
      $.CGEventSetIntegerValueField(e, 1, cmd.count);
      post(e);
    }
  } else if (cmd.op === 'scroll') {
    // Pixel units; positive deltas move content with the finger, like touch scrolling.
    post($.CGEventCreateScrollWheelEvent2(null, 0, 2, cmd.dy, cmd.dx, 0));
  }
}

const input = $.NSFileHandle.fileHandleWithStandardInput;
let buffer = '';
for (;;) {
  const data = input.availableData;
  if (data.length === 0) break;
  buffer += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    try { run(JSON.parse(line)); reply('ok'); } catch (e) { reply('err ' + e.message); }
  }
}
`;

const REPLY_TIMEOUT_MS = 2000;

export function createMacPointer() {
  let helper = null;
  let pending = [];

  function start() {
    const child = spawn('osascript', ['-l', 'JavaScript', '-e', HELPER], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const { resolve, reject } = pending.shift() ?? {};
        if (line === 'ok') resolve?.();
        else reject?.(new Error(line.replace(/^err /, '')));
      }
    });
    const fail = (err) => {
      if (helper !== child) return;
      helper = null;
      child.kill();
      for (const p of pending) p.reject(new Error(`pointer helper failed: ${err?.message ?? 'exited'}`));
      pending = [];
    };
    child.on('exit', () => fail());
    child.on('error', fail);
    child.stdin.on('error', fail);
    return child;
  }

  // ponytail: one global helper, restarted on next use after any failure or timeout; no backoff if it keeps dying.
  function send(cmd) {
    const child = (helper ??= start());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('pointer helper timed out')), REPLY_TIMEOUT_MS);
      pending.push({
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      child.stdin.write(JSON.stringify(cmd) + '\n');
    }).catch((err) => {
      // A hung helper would leave later replies misaligned with the FIFO, so start fresh.
      if (err.message === 'pointer helper timed out' && helper === child) { helper = null; pending = []; child.kill(); }
      throw err;
    });
  }

  return {
    move: (dx, dy) => send({ op: 'move', dx, dy }),
    click: (button, count) => send({ op: 'click', button, count }),
    scroll: (dx, dy) => send({ op: 'scroll', dx, dy }),
    close: () => helper?.kill(),
  };
}
