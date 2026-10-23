// Smoke probe: connects as a web client and measures the motion frame rate.
// Usage: node scripts/ws_probe.js
//   WS_URL=<ws/wss url>   override the endpoint (M4.2 split: wss://<domain>/ws?role=web)
//   WS_ORIGIN=<url>       send an Origin header (the server compares its host with Host)
//   WS_EXPECT=reject      expect the origin guard to reject with close code 1008
const WebSocket = require('ws');
// WS_ORIGIN (optional) sets the Origin header: the server's origin guard compares it
// with the Host header, so a mismatched origin must be rejected with close code 1008.
const WS_OPTIONS = process.env.WS_ORIGIN ? { headers: { Origin: process.env.WS_ORIGIN } } : undefined;
const ws = new WebSocket(process.env.WS_URL || 'ws://localhost:3001?role=web', WS_OPTIONS);
let frames = 0;
let first = null;
let last = null;
let finished = false;
const expectReject = process.env.WS_EXPECT === 'reject';
const deadline = setTimeout(() => {
  if (finished) return;
  finished = true;
  console.error('probe: TIMEOUT, no frames');
  process.exit(1);
}, 6000);
ws.on('open', () => console.log('probe: connected'));
ws.on('close', (code, reason) => {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  console.log('probe: closed code=' + code + ' reason=' + (reason ? reason.toString() : ''));
  if (expectReject) {
    const ok = code === 1008;
    console.log('probe: ' + (ok ? 'PASS (expected rejection)' : 'FAIL (expected 1008)'));
    process.exit(ok ? 0 : 1);
  }
  process.exit(1);
});
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'web_connected') { console.log('probe: event ' + JSON.stringify(msg)); return; }
  // v1 (M3.1): say/mode frames and motion *command* frames (group, no p) are
  // expected; only truly unknown types are reported.
  if (msg.type === 'say' || msg.type === 'mode') return;
  if (msg.type === 'motion' && msg.group) return;
  if (msg.type !== 'motion' || !msg.p) {
    console.log('probe: unexpected ' + JSON.stringify(msg).slice(0, 120));
    return;
  }
  frames += 1;
  if (!first) first = { t: Date.now(), f: msg.f };
  last = { t: Date.now(), f: msg.f, p: msg.p };
  if (frames === 1) {
    setTimeout(() => {
      if (finished) return;
      finished = true;
      const secs = (last.t - first.t) / 1000;
      const rate = secs > 0 ? (last.f - first.f) / secs : 0;
      console.log('probe: rate=' + rate.toFixed(1) + ' fps over ' + secs.toFixed(2) + 's, frames=' + frames);
      console.log('probe: sample=' + JSON.stringify(last.p));
      const ok = !expectReject && rate > 20 && rate < 40;
      console.log('probe: ' + (ok ? 'PASS' : 'FAIL'));
      clearTimeout(deadline);
      ws.close();
      process.exit(ok ? 0 : 1);
    }, 2000);
  }
});
ws.on('error', (err) => {
  if (finished) return;
  finished = true;
  console.error('probe: error ' + err.message);
  process.exit(1);
});
