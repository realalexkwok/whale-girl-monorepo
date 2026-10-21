// Smoke probe: connects as a web client and measures the motion frame rate.
// Usage: node scripts/ws_probe.js
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001?role=web');
let frames = 0;
let first = null;
let last = null;
const deadline = setTimeout(() => { console.error('probe: TIMEOUT, no frames'); process.exit(1); }, 6000);
ws.on('open', () => console.log('probe: connected'));
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'web_connected') { console.log('probe: event ' + JSON.stringify(msg)); return; }
  // v1 (M3.1): only v0 motion frames carry p (and f); commands, say and mode
  // frames are not motion frames — ignore them instead of counting or printing.
  if (msg.type !== 'motion' || !msg.p) return;
  frames += 1;
  if (!first) first = { t: Date.now(), f: msg.f };
  last = { t: Date.now(), f: msg.f, p: msg.p };
  if (frames === 1) {
    setTimeout(() => {
      const secs = (last.t - first.t) / 1000;
      const rate = secs > 0 ? (last.f - first.f) / secs : 0;
      console.log('probe: rate=' + rate.toFixed(1) + ' fps over ' + secs.toFixed(2) + 's, frames=' + frames);
      console.log('probe: sample=' + JSON.stringify(last.p));
      const ok = rate > 20 && rate < 40;
      console.log('probe: ' + (ok ? 'PASS' : 'FAIL'));
      clearTimeout(deadline);
      ws.close();
      process.exit(ok ? 0 : 1);
    }, 2000);
  }
});
ws.on('error', (err) => { console.error('probe: error ' + err.message); process.exit(1); });
