#!/usr/bin/env node
// M5.1 notifier probe (automatic half).
// Boots the server (with the notifier hub) + the python driver, opens one
// ?role=web client, then drives the hub the way the DSH plugin does: MCP
// attach/detach/rename + POST /notify. Asserts the announcement frame carries
// the verbatim session name in 主人，%会话名%有任务完成啦, the unattached /
// detached / session-end / TTL rules, one announcement per turn/end reason,
// the plugin's goal suppression + idle dedupe + disposal hook, latency, RSS and
// port release. Usage: node scripts/notify_probe.js
// Exit 0 = PASS, 1 = FAIL. Zero new deps (reuses the pinned ws package).
'use strict';

const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const SERVER = path.join(ROOT, 'server.js');
const DRIVER = path.join(ROOT, 'control_whale.py');
const PLUGIN = path.join(ROOT, 'notifier', 'index.mjs');
// Dedicated ports by default: the developer's ssh -L tunnel (or a dev stack)
// may legitimately hold 3000/3001, and this probe must still prove its OWN
// server released its OWN ports. PORT / WS_PORT / WHALE_MCP_PORT override.
let PORT = Number(process.env.PORT) || 0;
let WS_PORT = Number(process.env.WS_PORT) || 0;
let MCP_PORT = Number(process.env.WHALE_MCP_PORT) || 0;
let HUB = '';
const REGISTRY = path.join(os.tmpdir(), 'whale-notify-probe-' + process.pid + '.json');
const HUB_ACCEPT_GATE_MS = 100;
const REASONS = ['completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked'];
const SILENCE_MS = 1500;   // window in which a say frame must NOT arrive

const children = [];
let serverLogTail = '';
const sayFrames = [];
let web = null;

function track(child) {
  children.push(child);
  return child;
}
function killAll() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch (err) { /* already gone */ }
  }
}
process.on('exit', () => { killAll(); try { fs.rmSync(REGISTRY, { force: true }); } catch (err) { /* ignore */ } });
process.on('SIGINT', () => { killAll(); try { fs.rmSync(REGISTRY, { force: true }); } catch (err) { /* ignore */ } process.exit(1); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}
function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => { sock.end(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.setTimeout(400, () => { sock.destroy(); resolve(false); });
  });
}
async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await sleep(100);
  }
  throw new Error('timeout waiting for ' + label);
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' — ' + detail);
}
function rssKb(pid) {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'rss=']).toString().trim();
    return out ? parseInt(out, 10) : -1;
  } catch (err) {
    return -1;
  }
}
function assert(cond, name, detail) {
  record(name, Boolean(cond), detail);
  return Boolean(cond);
}

async function startServer(envExtra) {
  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    WS_PORT: String(WS_PORT),
    WHALE_MCP_PORT: String(MCP_PORT),
    WHALE_REGISTRY_FILE: REGISTRY,
  }, envExtra || {});
  const child = track(spawn('node', [SERVER], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }));
  child.stdout.on('data', (d) => {
    serverLogTail = (serverLogTail + d.toString()).slice(-8192);
    if (process.env.PROBE_DEBUG) process.stdout.write('[server] ' + d);
  });
  child.stderr.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stderr.write('[server] ' + d); });
  await waitFor(async () => {
    try { return (await fetch('http://localhost:' + PORT + '/')).ok; } catch (err) { return false; }
  }, 10000, 'page server on :' + PORT);
  await waitFor(async () => {
    try { return (await fetch(HUB + '/health')).ok; } catch (err) { return false; }
  }, 10000, 'notifier hub on :' + MCP_PORT);
  return child;
}

function startDriver() {
  const env = Object.assign({}, process.env, {
    WHALE_MODE: 'live',
    WHALE_WS: 'ws://localhost:' + WS_PORT + '?role=python',
  });
  delete env.WHALE_SAY_TEXT;
  delete env.WHALE_ENGINE;
  const child = track(spawn(PYTHON, [DRIVER], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }));
  child.stdout.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stdout.write('[driver] ' + d); });
  child.stderr.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stderr.write('[driver] ' + d); });
  return child;
}

function openWeb() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:' + WS_PORT + '?role=web');
    ws.on('message', (data) => {
      try {
        const frame = JSON.parse(data.toString());
        if (frame && frame.type === 'say') sayFrames.push({ frame, at: Date.now() });
      } catch (err) { /* not JSON: ignore */ }
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function httpJson(method, url, body) {
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (err) { /* empty body */ }
  return { status: res.status, json, headers: res.headers, ms: Date.now() - started };
}

let rpcId = 0;
async function rpc(method, params) {
  return httpJson('POST', HUB + '/mcp', { jsonrpc: '2.0', id: ++rpcId, method, params });
}
async function toolCall(name, args) {
  const res = await rpc('tools/call', { name, arguments: args });
  const result = res.json && res.json.result;
  if (!result) return { error: res.json && res.json.error, res };
  let payload = null;
  try { payload = JSON.parse(result.content[0].text); } catch (err) { /* keep null */ }
  return { payload, isError: result.isError, res };
}
async function notify(body) {
  return httpJson('POST', HUB + '/notify', body);
}
async function awaitSay(cursor, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (sayFrames.length > cursor) return sayFrames[cursor];
    await sleep(25);
  }
  return null;
}
async function expectSilence(cursor, ms) {
  await sleep(ms);
  return sayFrames.length === cursor;
}

const TEMPLATE = (name) => '主人，' + name + '有任务完成啦';

async function main() {
  if (!PORT) PORT = await freePort();
  if (!WS_PORT) WS_PORT = await freePort();
  if (!MCP_PORT) MCP_PORT = await freePort();
  HUB = 'http://127.0.0.1:' + MCP_PORT;
  console.log('notifier probe — hub ' + HUB + ', page :' + PORT + ', ws :' + WS_PORT + ', registry ' + REGISTRY);
  const server = await startServer();
  const driver = startDriver();
  await waitFor(() => serverLogTail.includes('python connected'), 15000, 'driver connected to the proxy');
  web = await openWeb();
  await sleep(800); // let the first frames flow

  // --- hub basics -------------------------------------------------------
  const health = await httpJson('GET', HUB + '/health');
  assert(health.status === 200 && health.json && health.json.ok === true,
    'hub health', 'GET /health -> ' + health.status + ' attached=' + (health.json && health.json.attached));

  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'notify_probe', version: '0' } });
  assert(init.status === 200 && init.json && init.json.result && init.json.result.serverInfo
    && init.json.result.serverInfo.name === 'whale-girl-notifier',
    'mcp initialize', 'serverInfo=' + JSON.stringify(init.json && init.json.result && init.json.result.serverInfo)
      + ' session-id=' + (init.headers && init.headers.get('mcp-session-id') ? 'set' : 'absent'));

  const list = await rpc('tools/list', {});
  const toolNames = ((list.json && list.json.result && list.json.result.tools) || []).map((t) => t.name).sort();
  assert(toolNames.join(',') === 'whale_attach,whale_detach,whale_sessions',
    'mcp tools/list', 'tools=' + toolNames.join(','));

  // --- attach / rename / announce --------------------------------------
  const attach1 = await toolCall('whale_attach', { session_id: 'probe-alpha', name: 'Alpha' });
  assert(attach1.payload && attach1.payload.ok === true && attach1.payload.entry.name === 'Alpha',
    'whale_attach registers', JSON.stringify(attach1.payload && attach1.payload.entry));
  let sessions = await toolCall('whale_sessions', {});
  const alpha = sessions.payload && sessions.payload.sessions.find((s) => s.sessionId === 'probe-alpha');
  assert(alpha && alpha.name === 'Alpha' && sessions.payload.sessions.length === 1,
    'whale_sessions lists the attachment', JSON.stringify(sessions.payload && sessions.payload.sessions));

  const attach2 = await toolCall('whale_attach', { session_id: 'probe-alpha', name: 'Beta' });
  sessions = await toolCall('whale_sessions', {});
  assert(attach2.payload && attach2.payload.ok && sessions.payload.sessions.length === 1
    && sessions.payload.sessions[0].name === 'Beta',
    'duplicate attach latest-wins (rename)', 'one entry, name=' + (sessions.payload.sessions[0] || {}).name);

  let cursor = sayFrames.length;
  const notifySentAt = Date.now();
  const notif1 = await notify({ agent: 'dsh', session_id: 'probe-alpha', reason: 'completed' });
  const say1 = await awaitSay(cursor, 15000);
  assert(say1 && say1.frame.text === TEMPLATE('Beta'),
    'announcement carries the verbatim name',
    say1 ? 'text=' + JSON.stringify(say1.frame.text) + ' audio=' + say1.frame.audio + ' src=' + say1.frame.src : 'no say frame');
  const hubAcceptMs = notif1.ms;
  const endToEndMs = say1 ? say1.at - notifySentAt : -1;

  // --- special characters round-trip verbatim --------------------------
  const attachSpecial = await toolCall('whale_attach', { session_id: 'probe-special', name: '构建%1号"x' });
  cursor = sayFrames.length;
  const notifSpecial = await notify({ session_id: 'probe-special' });
  const saySpecial = await awaitSay(cursor, 15000);
  assert(attachSpecial.payload && attachSpecial.payload.ok && saySpecial
    && saySpecial.frame.text === TEMPLATE('构建%1号"x'),
    'special characters spoken verbatim',
    saySpecial ? 'text=' + JSON.stringify(saySpecial.frame.text) : 'no say frame');

  // --- unattached sessions never announce ------------------------------
  cursor = sayFrames.length;
  const notifUnknown = await notify({ session_id: 'probe-unknown' });
  const silentUnknown = await expectSilence(cursor, SILENCE_MS);
  assert(notifUnknown.status === 200 && notifUnknown.json && notifUnknown.json.announced === false
    && notifUnknown.json.reason === 'not-attached' && silentUnknown,
    'unattached session ignored', 'status=' + notifUnknown.status + ' body=' + JSON.stringify(notifUnknown.json));

  // --- detach stops announcements --------------------------------------
  const detach = await toolCall('whale_detach', { session_id: 'probe-alpha' });
  cursor = sayFrames.length;
  const notifDetached = await notify({ session_id: 'probe-alpha' });
  const silentDetached = await expectSilence(cursor, SILENCE_MS);
  assert(detach.payload && detach.payload.removed === true && notifDetached.json
    && notifDetached.json.announced === false && silentDetached,
    'detach stops announcements', 'removed=' + (detach.payload && detach.payload.removed)
      + ' notify=' + JSON.stringify(notifDetached.json));

  // --- invalid attach is rejected --------------------------------------
  const badName = await toolCall('whale_attach', { session_id: 'probe-bad', name: '' });
  const longName = await toolCall('whale_attach', { session_id: 'probe-bad', name: 'x'.repeat(101) });
  const badSession = await toolCall('whale_attach', { session_id: '', name: 'Nope' });
  sessions = await toolCall('whale_sessions', {});
  assert(badName.error && badName.error.code === -32602
    && longName.error && longName.error.code === -32602
    && badSession.error && badSession.error.code === -32602
    && !sessions.payload.sessions.some((s) => s.sessionId === 'probe-bad'),
    'invalid attach rejected (-32602)', 'errors=' + [badName.error && badName.error.code,
      longName.error && longName.error.code, badSession.error && badSession.error.code].join(','));

  // --- one announcement per turn/end reason ----------------------------
  await toolCall('whale_attach', { session_id: 'probe-reasons', name: 'Reason' });
  const reasonResults = [];
  const endToEndSamples = [endToEndMs];
  for (const reason of REASONS) {
    cursor = sayFrames.length;
    const sentAt = Date.now();
    const res = await notify({ session_id: 'probe-reasons', reason });
    const say = await awaitSay(cursor, 15000);
    if (say) endToEndSamples.push(say.at - sentAt);
    const extra = await expectSilence(cursor + 1, 200);
    reasonResults.push(reason + ':' + (say && say.frame.text === TEMPLATE('Reason') && extra ? 'ok' : 'FAIL'));
  }
  assert(reasonResults.every((r) => r.endsWith(':ok')),
    'per-reason announcements (' + REASONS.length + ')', reasonResults.join(' '));
  let logOk = false;
  try {
    const saved = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
    const last = (saved.notifications || [])[(saved.notifications || []).length - 1];
    logOk = Boolean(last && last.text === TEMPLATE('Reason') && last.sessionId === 'probe-reasons');
  } catch (err) { /* stay false */ }
  assert(logOk, 'notification log persisted for M5.4',
    'registry notifications last entry matches ' + JSON.stringify(TEMPLATE('Reason')));
  await toolCall('whale_detach', { session_id: 'probe-reasons' });

  // --- session_end hook removes the entry ------------------------------
  await toolCall('whale_attach', { session_id: 'probe-end', name: 'End' });
  cursor = sayFrames.length;
  const ended = await notify({ session_id: 'probe-end', event: 'session_end' });
  const silentEnded = await expectSilence(cursor, SILENCE_MS);
  sessions = await toolCall('whale_sessions', {});
  assert(ended.status === 202 && ended.json && ended.json.removed === true && silentEnded
    && !sessions.payload.sessions.some((s) => s.sessionId === 'probe-end'),
    'session_end detaches without speaking', 'status=' + ended.status + ' body=' + JSON.stringify(ended.json));

  // --- plugin state machine fixtures -----------------------------------
  const plugin = await import(PLUGIN);
  const posted = [];
  const notifier = plugin.createNotifier({
    hubUrl: 'http://127.0.0.1:1', // fixtures must not reach the hub
    post: (payload) => { posted.push(payload); return Promise.resolve(); },
  });
  const turnEnd = (kind) => ({ type: 'turn/end', data: { turn: 1, reason: { kind } } });
  const goalChange = (operation, phase) => ({
    type: 'goal/change',
    data: operation === 'clear'
      ? { kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'g1' } }
      : { kind: 'goal/change', version: 1, operation, goal: { id: 'g1', revision: 1, objective: 'x', phase, maxGoalRounds: 5 } },
  });

  posted.length = 0;
  for (const reason of REASONS) notifier.handleSessionEvent('fx-1', turnEnd(reason), 1000);
  const perReason = posted.length === REASONS.length && posted.every((p) => p.session_id === 'fx-1');
  posted.length = 0;
  notifier.handleSessionEvent('fx-2', goalChange('create', 'active'), 2000);
  notifier.handleSessionEvent('fx-2', turnEnd('completed'), 2001);
  const suppressed = posted.length === 0;
  notifier.handleSessionEvent('fx-2', goalChange('complete', 'complete'), 2002);
  notifier.handleSessionEvent('fx-2', turnEnd('completed'), 2003);
  const announcedAfterGoal = posted.length === 1;
  posted.length = 0;
  notifier.handleSessionEvent('fx-3', turnEnd('completed'), 3000);
  notifier.handleAgentStatus('fx-3', 'idle', 3500);   // inside the 2 s dedupe window
  const deduped = posted.length === 1;
  notifier.handleAgentStatus('fx-3', 'idle', 5500);   // outside it: fallback fires
  const idleFallback = posted.length === 2;
  posted.length = 0;
  notifier.handleSessionDisposed('fx-4', 6000);
  const disposed = posted.length === 1 && posted[0].event === 'session_end';
  let contained = true;
  try {
    plugin.createNotifier({ hubUrl: 'http://127.0.0.1:1', post: () => { throw new Error('boom'); } })
      .handleSessionEvent('fx-5', turnEnd('completed'), 7000);
  } catch (err) { contained = false; }
  // apply() must wire the four harness hooks and contain their callbacks.
  const handlers = {};
  let wired = true;
  try {
    plugin.apply({ on: (hook, fn) => { handlers[hook] = fn; } }, { hub: 'http://127.0.0.1:1', autoAttach: false });
    wired = typeof handlers['session/created'] === 'function'
      && typeof handlers['session/event'] === 'function'
      && typeof handlers['agent/status'] === 'function'
      && typeof handlers['session/disposed'] === 'function';
    handlers['session/created']({ id: 'fx-apply', header: { cwd: '/x' } });
    handlers['session/event']({ id: 'fx-apply' }, turnEnd('completed'));
    handlers['agent/status']({ agent: { session: { id: 'fx-apply' } }, status: 'idle' });
    handlers['session/disposed']({ id: 'fx-apply' });
  } catch (err) {
    wired = false;
  }
  assert(perReason && suppressed && announcedAfterGoal && deduped && idleFallback && disposed && contained && wired,
    'plugin fixtures (reasons/goal/dedupe/dispose/wiring)', 'perReason=' + perReason + ' goalSuppressed=' + suppressed
      + ' afterGoal=' + announcedAfterGoal + ' idleDeduped=' + deduped + ' idleFallback=' + idleFallback
      + ' disposed=' + disposed + ' contained=' + contained + ' wired=' + wired);

  // --- auto-attach: no ids for users -----------------------------------
  const attachCalls = [];
  const recorder = (payload) => { attachCalls.push(payload); return Promise.resolve(); };
  const auto = plugin.createNotifier({
    hubUrl: 'http://127.0.0.1:1', post: () => Promise.resolve(), attach: recorder,
    query: () => Promise.resolve([]),
  });
  auto.handleSessionCreated({ id: 'probe-auto-a', header: { cwd: '/tmp/probe/my-proj' } });
  auto.handleSessionCreated({ id: 'probe-auto-b', header: { cwd: '/tmp/probe', parentSession: 'p', origin: 'subagent' } });
  auto.handleSessionCreated({ id: 'probe-auto-c', header: { cwd: '/tmp/probe', delegationDepth: 1 } });
  const kept = plugin.createNotifier({
    hubUrl: 'http://127.0.0.1:1', post: () => Promise.resolve(), attach: recorder,
    query: () => Promise.resolve([{ sessionId: 'probe-auto-kept' }]),
  });
  kept.handleSessionCreated({ id: 'probe-auto-kept', header: { cwd: '/tmp/renamed-by-hand' } });
  const autoOff = plugin.createNotifier({
    hubUrl: 'http://127.0.0.1:1', post: () => Promise.resolve(), attach: recorder, autoAttach: false,
  });
  autoOff.handleSessionCreated({ id: 'probe-auto-d', header: { cwd: '/tmp/probe' } });
  await sleep(80); // auto-attach resolves its hub lookup first
  const autoFixtures = attachCalls.length === 1 && attachCalls[0].session_id === 'probe-auto-a'
    && attachCalls[0].name === 'my-proj';
  // Live: the plugin's own HTTP lookup + attach against the real hub, and a
  // second session/created must NOT overwrite the registered name.
  const liveAuto = plugin.createNotifier({ hubUrl: HUB });
  liveAuto.handleSessionCreated({ id: 'probe-auto-live', header: { cwd: '/tmp/probe-live-workspace' } });
  await sleep(400);
  sessions = await toolCall('whale_sessions', {});
  const autoLive = sessions.payload.sessions.some((s) => s.sessionId === 'probe-auto-live'
    && s.name === 'probe-live-workspace');
  liveAuto.handleSessionCreated({ id: 'probe-auto-live', header: { cwd: '/tmp/other-name' } });
  await sleep(300);
  sessions = await toolCall('whale_sessions', {});
  const nameKept = sessions.payload.sessions.some((s) => s.sessionId === 'probe-auto-live'
    && s.name === 'probe-live-workspace');
  await toolCall('whale_detach', { session_id: 'probe-auto-live' });
  assert(autoFixtures && autoLive && nameKept, 'plugin auto-attach (cwd name, subagent skip, off switch, keeps manual rename)',
    'fixtures=' + autoFixtures + ' liveHub=' + autoLive + ' nameKept=' + nameKept
      + ' calls=' + JSON.stringify(attachCalls));

  // --- stale TTL entries are swept -------------------------------------
  const staleSession = 'probe-stale';
  fs.writeFileSync(REGISTRY, JSON.stringify({ entries: [{ agent: 'dsh', sessionId: staleSession, name: 'Stale', lastFinishedAt: 0, updatedAt: Date.now() - 60000 }] }), 'utf8');
  const ttlPorts = [await freePort(), await freePort(), await freePort()];
  const ttlChild = track(spawn('node', [SERVER], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(ttlPorts[0]), WS_PORT: String(ttlPorts[1]), WHALE_MCP_PORT: String(ttlPorts[2]),
      WHALE_REGISTRY_FILE: REGISTRY, WHALE_SESS_TTL: '1',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  ttlChild.stdout.on('data', () => {});
  ttlChild.stderr.on('data', () => {});
  await waitFor(async () => {
    try { return (await fetch('http://127.0.0.1:' + ttlPorts[2] + '/health')).ok; } catch (err) { return false; }
  }, 10000, 'ttl hub');
  const ttlNotify = await httpJson('POST', 'http://127.0.0.1:' + ttlPorts[2] + '/notify', { session_id: staleSession });
  const ttlHealth = await httpJson('GET', 'http://127.0.0.1:' + ttlPorts[2] + '/health');
  assert(ttlNotify.status === 200 && ttlNotify.json && ttlNotify.json.reason === 'not-attached'
    && ttlHealth.json && ttlHealth.json.attached === 0,
    'stale TTL entry swept', 'notify=' + JSON.stringify(ttlNotify.json) + ' attached=' + (ttlHealth.json && ttlHealth.json.attached));
  try { ttlChild.kill('SIGTERM'); } catch (err) { /* ignore */ }

  // --- latency + memory + port release --------------------------------
  const sorted = endToEndSamples.filter((n) => n >= 0).sort((a, b) => a - b);
  const mean = sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : -1;
  const max = sorted.length ? sorted[sorted.length - 1] : -1;
  assert(hubAcceptMs < HUB_ACCEPT_GATE_MS,
    'hub accept latency < ' + HUB_ACCEPT_GATE_MS + ' ms', 'POST /notify -> ' + hubAcceptMs + ' ms');
  assert(mean >= 0 && mean < 3000,
    'end-to-end announce latency sane (< 3 s, TTS included)',
    'n=' + sorted.length + ' mean=' + mean + ' ms max=' + max + ' ms (POST /notify -> say frame)');

  await sleep(1500);
  const serverRss = rssKb(server.pid);
  const driverRss = rssKb(driver.pid);
  assert(serverRss > 0 && serverRss <= 60 * 1024,
    'server RSS <= 60 MB (hub included)', (serverRss / 1024).toFixed(1) + ' MB');
  assert(driverRss > 0 && driverRss <= 30 * 1024,
    'driver RSS <= 30 MB', (driverRss / 1024).toFixed(1) + ' MB');

  // --- shutdown + port release ----------------------------------------
  try { web.close(); } catch (err) { /* ignore */ }
  killAll();
  // The TTL instance got its SIGTERM earlier; wait for every port, including
  // its hub, so the check cannot race a normal 2 s shutdown.
  await waitFor(async () => !(await portOpen(PORT)) && !(await portOpen(WS_PORT)) && !(await portOpen(MCP_PORT))
    && !(await portOpen(ttlPorts[2])), 10000, 'ports released').catch(() => {});
  const states = [];
  for (const port of [PORT, WS_PORT, MCP_PORT, ttlPorts[2]]) {
    states.push(port + ':' + ((await portOpen(port)) ? 'open' : 'closed'));
  }
  const released = states.every((state) => state.endsWith(':closed'));
  assert(released, 'ports released after shutdown', states.join(' '));

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed'
    + (failed.length ? ' — FAILED: ' + failed.map((r) => r.name).join('; ') : ''));
  if (failed.length) process.exitCode = 1;
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('probe: ' + (err && err.stack ? err.stack : String(err)));
  killAll();
  process.exit(1);
});
