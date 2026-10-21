'use strict';

/*
 * Whale Girl — server.js (Milestone 1)
 *
 * - express: serves ../whale-girl-frontend statically on PORT (default 3000)
 * - ws:      WebSocket proxy on WS_PORT (default 3001)
 *
 * Design notes:
 * - The proxy relays Python payloads to web clients as RAW TEXT. The server
 *   never parses JSON, so CPU and allocation churn per frame are near zero.
 * - ?role=web    : many allowed, receives forwarded motion frames
 * - ?role=python : single writer; a newer instance replaces the old one (4001)
 * - v1 (M3.1): web-client text frames are relayed RAW to the python writer,
 *   tagged as {"relay":"<frame>"} (string concatenation, no parsing), so the
 *   driver can tell commands from server events. The driver validates and
 *   executes them (motion / expression / say / pose / mode).
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const WS_PORT = Number(process.env.WS_PORT) || 3001;
const FRONTEND_DIR = path.resolve(__dirname, '..', 'whale-girl-frontend');
// M2.2: TTS speech files written by the driver (gitignored, pruned by the driver).
const AUDIO_DIR = path.resolve(__dirname, 'audio');

const MAX_FRAME_BYTES = 8 * 1024;        // soft cap for forwarded frames
const MAX_BUFFERED_BYTES = 256 * 1024;   // per-client backpressure threshold
const HEARTBEAT_MS = 30_000;             // ping sweep interval
const LOG_INTERVAL_MS = 5_000;           // aggregate logging cadence

const app = express();
app.disable('x-powered-by');
// maxAge 0: assets are revalidated every time (handy while swapping model files in dev)
app.use(express.static(FRONTEND_DIR, { maxAge: 0, etag: true }));
fs.mkdirSync(AUDIO_DIR, { recursive: true }); // the driver creates it too; keep the mount valid at boot
app.use('/audio', express.static(AUDIO_DIR, { maxAge: 0, etag: true }));

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ port: WS_PORT, maxPayload: 64 * 1024 });

const webClients = new Set();
let pythonClient = null;

let framesRelayed = 0;
let framesDropped = 0;
let cmdsRelayed = 0;
let lastLogAt = 0;

function broadcastToWeb(text) {
  for (const ws of webClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      framesDropped++;
      continue; // slow consumer (e.g. stalled OBS): skip this frame, keep the client
    }
    ws.send(text);
  }
  framesRelayed++;
}

function sendToPython(obj) {
  if (pythonClient && pythonClient.readyState === WebSocket.OPEN) {
    pythonClient.send(JSON.stringify(obj));
  }
}

function notifyWebCount() {
  sendToPython({ type: 'web_connected', count: webClients.size });
}

// v1 (M3.1): relay a web-client command to the python writer verbatim.
// Raw text only — the proxy never parses frames (tech-stack.md invariant).
function relayCommandToPython(data, isBinary) {
  if (isBinary) { framesDropped++; return; }
  const text = data.toString();
  if (text.length > MAX_FRAME_BYTES) { framesDropped++; return; }
  if (pythonClient && pythonClient.readyState === WebSocket.OPEN) {
    // Tag the frame so the driver can tell commands apart from server events
    // (a web client must not be able to impersonate web_connected). String
    // concatenation only — the proxy still never parses JSON.
    pythonClient.send('{"relay":' + JSON.stringify(text) + '}');
    cmdsRelayed++;
  } else {
    framesDropped++; // no brain connected: the command goes nowhere
  }
}

function maybeLog(force) {
  const now = Date.now();
  if (force || now - lastLogAt >= LOG_INTERVAL_MS) {
    lastLogAt = now;
    console.log(
      '[whale-girl] http=:' + PORT + ' ws=:' + WS_PORT +
      ' web=' + webClients.size +
      ' python=' + (pythonClient ? 1 : 0) +
      ' relayed=' + framesRelayed +
      ' cmds=' + cmdsRelayed +
      ' dropped=' + framesDropped
    );
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'ws://localhost');
  const role = url.searchParams.get('role') || 'unknown';

  if (role === 'web') {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // v1 (M3.1): command frames go to the python writer (raw passthrough).
    ws.on('message', (data, isBinary) => relayCommandToPython(data, isBinary));
    ws.on('error', () => {});
    ws.on('close', () => {
      webClients.delete(ws);
      notifyWebCount();
    });
    webClients.add(ws);
    console.log('[whale-girl] web connected (total ' + webClients.size + ')');
    notifyWebCount();
    return;
  }

  if (role === 'python') {
    if (pythonClient) {
      // single-writer policy: kick the previous instance with a clear reason
      try { pythonClient.close(4001, 'replaced by a newer instance'); } catch (err) { /* ignore */ }
    }
    pythonClient = ws;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) { framesDropped++; return; }
      const text = data.toString();
      if (text.length > MAX_FRAME_BYTES) { framesDropped++; return; }
      broadcastToWeb(text);
      maybeLog(false);
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (pythonClient === ws) pythonClient = null;
      console.log('[whale-girl] python disconnected');
    });
    console.log('[whale-girl] python connected');
    return;
  }

  ws.close(1008, 'unknown role (use ?role=web or ?role=python)');
});

// Keepalive: terminate sockets that miss a pong so dead clients cannot leak.
const heartbeat = setInterval(() => {
  for (const ws of webClients) {
    if (ws.isAlive === false) {
      ws.terminate();
      webClients.delete(ws);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  if (pythonClient) {
    if (pythonClient.isAlive === false) {
      pythonClient.terminate();
      pythonClient = null;
    } else {
      pythonClient.isAlive = false;
      pythonClient.ping();
    }
  }
  maybeLog(false);
}, HEARTBEAT_MS);

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('[whale-girl] port ' + PORT + ' is in use — set PORT to another value and restart.');
    process.exit(1);
  }
  throw err;
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('[whale-girl] websocket port ' + WS_PORT + ' is in use — set WS_PORT to another value and restart.');
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log('[whale-girl] serving ' + FRONTEND_DIR + ' on http://localhost:' + PORT);
  console.log('[whale-girl] websocket proxy on ws://localhost:' + WS_PORT);
});

function shutdown() {
  console.log('[whale-girl] shutting down...');
  clearInterval(heartbeat);
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
