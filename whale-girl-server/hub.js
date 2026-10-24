'use strict';

/*
 * Whale Girl — M5.1 notifier hub (hub.js)
 *
 * The single source of truth for agent-session attachments:
 *   - POST /notify   fire-and-forget lifecycle hook (agent -> hub)
 *   - POST /mcp      MCP streamable HTTP (JSON-RPC 2.0, hand-rolled, no deps)
 *   - GET  /health   tiny readiness probe
 *
 * Announcements ride the EXISTING v1 command relay: the hub builds the say
 * command frame text and hands it to server.js's relay (string concatenation,
 * no frame parsing added). The proxy's "never parse frames" invariant holds.
 *
 * Loopback-only by default: WHALE_MCP_HOST / WHALE_MCP_PORT (default
 * 127.0.0.1:3200). Registry: in-memory Map + a small JSON file
 * (WHALE_REGISTRY_FILE, default data/registry.json, gitignored).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.WHALE_MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.WHALE_MCP_PORT) || 3200;
const REGISTRY_FILE = process.env.WHALE_REGISTRY_FILE || path.join(__dirname, 'data', 'registry.json');
const SESS_TTL_MS = Math.max(1, Number(process.env.WHALE_SESS_TTL) || 86_400) * 1000;
const SWEEP_MS = 5 * 60 * 1000;
const MAX_NOTIFY_BYTES = 8 * 1024;
const MAX_MCP_BYTES = 64 * 1024;
const SESSION_ID_MAX = 256;
const NAME_MAX = 100;
const ANNOUNCE_WINDOW_MS = 60_000;
const ANNOUNCE_CAP = 10;
// Bounded notification history (M5.1 writes it; M5.4 adds the context-menu UI).
const NOTIFY_LOG_CAP = 50;
const SERVER_INFO = { name: 'whale-girl-notifier', version: '0.1.0' };
const DEFAULT_PROTOCOL_VERSION = '2025-11-25';

const entries = new Map(); // sessionId -> {agent, sessionId, name, lastFinishedAt, updatedAt}
const notifications = [];  // newest last: {ts, sessionId, name, text}
let relay = null;           // (frameText) => boolean, injected by server.js
let announceWindowStart = 0;
let announceCount = 0;
let lastMissLogAt = 0;
let lastWarnLogAt = 0;
let announceSeq = 0;

function warn(message) {
  const now = Date.now();
  if (now - lastWarnLogAt < 5_000) return; // aggregate: never log per request
  lastWarnLogAt = now;
  console.error('[notifier] ' + message);
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sessionId = raw.sessionId;
  const name = raw.name;
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > SESSION_ID_MAX) return null;
  if (typeof name !== 'string' || name.length === 0 || name.length > NAME_MAX) return null;
  return {
    agent: typeof raw.agent === 'string' && raw.agent ? raw.agent.slice(0, 64) : 'dsh',
    sessionId,
    name,
    lastFinishedAt: Number(raw.lastFinishedAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

function loadRegistry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    const list = Array.isArray(parsed && parsed.entries) ? parsed.entries : [];
    for (const raw of list) {
      const entry = sanitizeEntry(raw);
      if (entry) entries.set(entry.sessionId, entry);
    }
    const notif = Array.isArray(parsed && parsed.notifications) ? parsed.notifications : [];
    for (const item of notif) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.text !== 'string' || item.text.length === 0 || item.text.length > NAME_MAX + 32) continue;
      notifications.push({
        ts: Number(item.ts) || 0,
        sessionId: typeof item.sessionId === 'string' ? item.sessionId.slice(0, SESSION_ID_MAX) : '',
        name: typeof item.name === 'string' ? item.name.slice(0, NAME_MAX) : '',
        text: item.text,
      });
    }
    if (notifications.length > NOTIFY_LOG_CAP) notifications.splice(0, notifications.length - NOTIFY_LOG_CAP);
  } catch (err) {
    if (err.code !== 'ENOENT') warn('registry unreadable, starting empty: ' + err.message);
  }
}

function saveRegistry() {
  try {
    fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
    const tmp = REGISTRY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ entries: [...entries.values()], notifications }), 'utf8');
    fs.renameSync(tmp, REGISTRY_FILE);
  } catch (err) {
    warn('registry write failed: ' + err.message);
  }
}

// Drop entries whose last lifecycle touch is older than the TTL (an agent that
// died without a session-end hook). Returns true when something was removed.
function expire(now) {
  let removed = false;
  for (const [sessionId, entry] of entries) {
    if (now - entry.updatedAt > SESS_TTL_MS) {
      entries.delete(sessionId);
      removed = true;
    }
  }
  if (removed) console.log('[notifier] expired stale registry entries');
  return removed;
}

function removeEntry(sessionId) {
  const existed = entries.delete(sessionId);
  if (existed) saveRegistry();
  return existed;
}

function announce(entry, now) {
  if (now - announceWindowStart >= ANNOUNCE_WINDOW_MS) {
    announceWindowStart = now;
    announceCount = 0;
  }
  if (announceCount >= ANNOUNCE_CAP) {
    warn('announcement rate cap reached (' + ANNOUNCE_CAP + '/min) — dropping "' + entry.name + '"');
    return { announced: false, throttled: true };
  }
  announceCount++;
  announceSeq++;
  const text = '主人，' + entry.name + '有任务完成啦';
  const frame = JSON.stringify({ type: 'say', text });
  const speakable = typeof relay === 'function' && relay(frame);
  entry.lastFinishedAt = now;
  entry.updatedAt = now;
  if (speakable) {
    // The history is what she has SPOKEN (M5.4); an unspeakable line is not a
    // notification the user ever heard.
    notifications.push({ ts: now, sessionId: entry.sessionId, name: entry.name, text });
    if (notifications.length > NOTIFY_LOG_CAP) notifications.splice(0, notifications.length - NOTIFY_LOG_CAP);
  }
  saveRegistry();
  if (!speakable) {
    warn('announcement accepted but no brain connected (say dropped): "' + entry.name + '"');
    return { announced: false, unspeakable: true };
  }
  console.log('[notifier] #' + announceSeq + ' announce "' + entry.name + '" (session ' + entry.sessionId + ')');
  return { announced: true };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8' }, extraHeaders || {}));
  res.end(body);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // CLIs and the DSH SDK client send no Origin
  let host;
  try { host = new URL(origin).hostname; } catch (err) { return false; }
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

function rpcText(payload, isError) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: Boolean(isError),
  };
}

function rpcError(code, message) {
  const err = new Error(message);
  err.rpcCode = code;
  return err;
}

function requireString(value, field, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw rpcError(-32602, field + ' must be a non-empty string of at most ' + max + ' characters');
  }
  return value;
}

const TOOLS = [
  {
    name: 'whale_attach',
    description: 'Attach this agent session to the whale girl. While attached, she speaks '
      + '"主人，<name>有任务完成啦" whenever this session finishes a round. Call it again to rename.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'The agent session id. In a DSH session: the DSH_SESSION_ID environment variable.' },
        name: { type: 'string', description: 'Display name the whale speaks verbatim (max 100 characters).' },
        agent: { type: 'string', description: 'Agent kind (default "dsh").' },
      },
      required: ['session_id', 'name'],
    },
  },
  {
    name: 'whale_detach',
    description: 'Detach this agent session: announcements stop for it. Safe to call twice.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'The agent session id.' } },
      required: ['session_id'],
    },
  },
  {
    name: 'whale_sessions',
    description: 'List the agent sessions currently attached to the whale girl.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function callTool(toolName, args) {
  const now = Date.now();
  if (toolName === 'whale_attach') {
    const sessionId = requireString(args && args.session_id, 'session_id', SESSION_ID_MAX);
    const name = requireString(args && args.name, 'name', NAME_MAX);
    const prev = entries.get(sessionId);
    const agentArg = args && args.agent;
    const entry = {
      agent: typeof agentArg === 'string' && agentArg ? agentArg.slice(0, 64) : (prev ? prev.agent : 'dsh'),
      sessionId,
      name,
      lastFinishedAt: prev ? prev.lastFinishedAt : 0,
      updatedAt: now,
    };
    entries.set(sessionId, entry);
    saveRegistry();
    console.log('[notifier] attach "' + name + '" (session ' + sessionId + ')' + (prev ? ' [renamed]' : ''));
    return rpcText({ ok: true, entry });
  }
  if (toolName === 'whale_detach') {
    const sessionId = requireString(args && args.session_id, 'session_id', SESSION_ID_MAX);
    const removed = removeEntry(sessionId);
    console.log('[notifier] detach (session ' + sessionId + ') removed=' + removed);
    return rpcText({ ok: true, removed });
  }
  if (toolName === 'whale_sessions') {
    return rpcText({ ok: true, sessions: [...entries.values()] });
  }
  throw rpcError(-32602, 'unknown tool: ' + toolName);
}

function handleJsonRpc(request, headers) {
  const id = request && Object.prototype.hasOwnProperty.call(request, 'id') ? request.id : undefined;
  if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0') {
    return { error: { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code: -32600, message: 'invalid JSON-RPC 2.0 request' } } };
  }
  if (id === undefined) {
    // Notification: no response. notifications/initialized and anything else.
    return { notification: true };
  }
  const method = request.method;
  if (method === 'initialize') {
    const requested = request.params && request.params.protocolVersion;
    const protocolVersion = typeof requested === 'string' && requested ? requested : DEFAULT_PROTOCOL_VERSION;
    if (headers) headers['mcp-session-id'] = 'whale-' + Date.now().toString(36);
    return {
      response: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      },
    };
  }
  if (method === 'ping') return { response: { jsonrpc: '2.0', id, result: {} } };
  if (method === 'tools/list') return { response: { jsonrpc: '2.0', id, result: { tools: TOOLS } } };
  if (method === 'tools/call') {
    const params = request.params || {};
    try {
      const result = callTool(params.name, params.arguments || {});
      return { response: { jsonrpc: '2.0', id, result } };
    } catch (err) {
      const code = err && err.rpcCode ? err.rpcCode : -32603;
      return { response: { jsonrpc: '2.0', id, error: { code, message: err && err.message ? err.message : 'internal error' } } };
    }
  }
  return { response: { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } } };
}

async function handleMcp(req, res) {
  let raw;
  try { raw = await readBody(req, MAX_MCP_BYTES); } catch (err) {
    res.writeHead(413); res.end('request body too large'); return;
  }
  let payload;
  try { payload = JSON.parse(raw); } catch (err) {
    sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  const extra = {};
  if (Array.isArray(payload)) {
    const out = [];
    for (const item of payload) {
      const handled = handleJsonRpc(item, extra);
      if (handled.response) out.push(handled.response);
    }
    if (out.length === 0) { res.writeHead(202, extra); res.end(); return; }
    sendJson(res, 200, out, extra);
    return;
  }
  const handled = handleJsonRpc(payload, extra);
  if (handled.notification) { res.writeHead(202, extra); res.end(); return; }
  if (handled.error) { sendJson(res, 400, handled.error, extra); return; }
  sendJson(res, 200, handled.response, extra);
}

async function handleNotify(req, res) {
  let raw;
  try { raw = await readBody(req, MAX_NOTIFY_BYTES); } catch (err) {
    res.writeHead(413); res.end('notify body too large'); return;
  }
  let body;
  try { body = JSON.parse(raw); } catch (err) {
    sendJson(res, 400, { ok: false, error: 'invalid JSON' });
    return;
  }
  const sessionId = body && body.session_id;
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > SESSION_ID_MAX) {
    sendJson(res, 400, { ok: false, error: 'session_id must be a non-empty string' });
    return;
  }
  const now = Date.now();
  if (expire(now)) saveRegistry();
  const entry = entries.get(sessionId);
  if (!entry) {
    // Unknown session (or expired): never announce, never attach implicitly.
    if (now - lastMissLogAt >= 5_000) {
      lastMissLogAt = now;
      console.log('[notifier] notify ignored: session ' + sessionId + ' is not attached');
    }
    sendJson(res, 200, { ok: true, announced: false, reason: 'not-attached' });
    return;
  }
  if (body.event === 'session_end') {
    removeEntry(sessionId);
    console.log('[notifier] session ended, detached (session ' + sessionId + ')');
    sendJson(res, 202, { ok: true, removed: true });
    return;
  }
  const outcome = announce(entry, now);
  sendJson(res, 202, Object.assign({ ok: true, name: entry.name }, outcome));
}

const server = http.createServer((req, res) => {
  if (!originAllowed(req)) {
    res.writeHead(403); res.end('origin not allowed (loopback clients only)'); return;
  }
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch (err) { res.writeHead(400); res.end(); return; }
  if (req.method === 'POST' && url.pathname === '/notify') { handleNotify(req, res); return; }
  if (req.method === 'POST' && url.pathname === '/mcp') { handleMcp(req, res); return; }
  if (url.pathname === '/mcp' && req.method === 'GET') {
    res.writeHead(405, { allow: 'POST' }); res.end('this MCP endpoint offers no SSE stream'); return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, attached: entries.size, notifications: notifications.length });
    return;
  }
  res.writeHead(404); res.end('not found');
});

function start(options) {
  const opts = options || {};
  relay = typeof opts.relayCommand === 'function' ? opts.relayCommand : null;
  loadRegistry();
  const timer = setInterval(() => {
    if (expire(Date.now())) saveRegistry();
  }, SWEEP_MS);
  timer.unref();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('[notifier] port ' + PORT + ' is in use — notifier hub disabled this boot '
        + '(set WHALE_MCP_PORT to another value). The page server keeps running.');
      clearInterval(timer);
      return;
    }
    console.error('[notifier] hub error: ' + (err && err.message ? err.message : String(err)));
  });
  server.listen(PORT, HOST, () => {
    console.log('[notifier] hub on http://' + HOST + ':' + PORT + ' (mcp /mcp, notify /notify, '
      + entries.size + ' attached, ttl ' + Math.round(SESS_TTL_MS / 1000) + 's)');
  });
  return {
    stop() {
      clearInterval(timer);
      try { server.close(); } catch (err) { /* already closed */ }
    },
  };
}

module.exports = { start };
