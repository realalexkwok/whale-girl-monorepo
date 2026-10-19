// Smoke probe: unknown roles must be rejected with close code 1008.
// Usage: node scripts/ws_role_probe.js
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001?role=attacker');
ws.on('open', () => console.log('roleprobe: unexpectedly open'));
ws.on('close', (code, reason) => {
  console.log('roleprobe: closed code=' + code + ' reason=' + reason.toString());
  process.exit(code === 1008 ? 0 : 1);
});
ws.on('error', () => {});
setTimeout(() => { console.log('roleprobe: TIMEOUT'); process.exit(1); }, 5000);
