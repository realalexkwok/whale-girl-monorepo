#!/usr/bin/env node
// M3.2 expression-routing probe (automatic half).
// Boots the server, headless Chrome at ?debug=1 and the driver in LIVE mode with
// a 1 s cooldown / 6 s idle (so the timing checks are fast), then drives the
// whale_express path: CLI + raw frames -> the driver table -> the M3.1
// expression frame -> the frontend hooks.
// Asserts: every default tag resolves to its preset, an unknown tag falls back
// to neutral, the same tag inside the cooldown applies once, the M3.1 name
// passthrough still works, a real mode flip and the idle deadline reset the
// face, RSS within budget and ports released.
// Usage: node scripts/expr_probe.js [--visible]
// Exit 0 = PASS, 1 = FAIL. Zero new deps (reuses the pinned ws package).
'use strict';

const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync, spawnSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const CLI = path.join(ROOT, 'scripts', 'whale_cmd.py');
const SERVER = path.join(ROOT, 'server.js');
const DRIVER = path.join(ROOT, 'control_whale.py');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT) || 3000;
const WS_PORT = Number(process.env.WS_PORT) || 3001;
const VISIBLE = process.argv.includes('--visible');
const COOLDOWN_MS = 1000;
const IDLE_MS = 6000;

let TAGS = {};
try {
  TAGS = JSON.parse(execFileSync(PYTHON, [
    '-c', 'import json, expr_tags; print(json.dumps(expr_tags.DEFAULT_TAGS))',
  ], { cwd: ROOT }).toString());
} catch (err) {
  console.error('probe: cannot read expr_tags.py (' + err.message + ')');
  process.exit(1);
}
if (!TAGS || !TAGS.happy || TAGS.neutral === undefined) {
  console.error('probe: expr_tags.py has no happy/neutral entries');
  process.exit(1);
}

const children = [];
let chromeProfile = null;
function track(child) {
  children.push(child);
  return child;
}
function killAll() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch (err) { /* already gone */ }
  }
}
function cleanupProfile() {
  if (chromeProfile) {
    try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch (err) { /* ignore */ }
    chromeProfile = null;
  }
}
process.on('exit', () => { killAll(); cleanupProfile(); });
process.on('SIGINT', () => { killAll(); cleanupProfile(); process.exit(1); });

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

function cliEnv() {
  return Object.assign({}, process.env, {
    WHALE_CMD_WS: 'ws://localhost:' + WS_PORT + '?role=web',
    WHALE_MODEL_MANIFEST: path.join(ROOT, '..', 'whale-girl-frontend', 'model', 'whale.model3.json'),
  });
}

async function startServer() {
  const child = track(spawn('node', [SERVER], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), WS_PORT: String(WS_PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  child.on('error', (err) => fail(err));
  child.stdout.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stdout.write('[server] ' + d); });
  child.stderr.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stderr.write('[server] ' + d); });
  await waitFor(async () => {
    try { return (await fetch('http://localhost:' + PORT + '/')).ok; } catch (err) { return false; }
  }, 10000, 'server on :' + PORT);
  return child;
}

function startDriver() {
  const env = Object.assign({}, process.env, {
    WHALE_MODE: 'live',
    WHALE_WS: 'ws://localhost:' + WS_PORT + '?role=python',
    WHALE_EXPR_COOLDOWN: '1',
    WHALE_EXPR_IDLE: '6',
  });
  // The probe owns the run: never inherit a developer's scripted/override env.
  delete env.WHALE_SAY_TEXT;
  delete env.WHALE_DEBUG;
  delete env.WHALE_ENGINE;
  delete env.WHALE_EXPR_TAGS;
  const child = track(spawn(PYTHON, [DRIVER], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  child.on('error', (err) => fail(err));
  child.stdout.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stdout.write('[driver] ' + d); });
  child.stderr.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stderr.write('[driver] ' + d); });
  return child;
}

function openWeb() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:' + WS_PORT + '?role=web');
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function startChrome() {
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-expr-probe-'));
  chromeProfile = profile;
  const args = [
    '--remote-debugging-port=' + debugPort,
    '--autoplay-policy=no-user-gesture-required',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1280,900',
    'http://localhost:' + PORT + '/?debug=1&ws=' +
      encodeURIComponent('ws://localhost:' + WS_PORT),
  ];
  if (!VISIBLE) args.unshift('--headless=new');
  const child = track(spawn(CHROME, args, { stdio: 'ignore' }));
  child.on('error', (err) => fail(err));
  let target = null;
  await waitFor(async () => {
    try {
      const list = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.url.indexOf('localhost:' + PORT) !== -1);
    } catch (err) { target = null; }
    return !!target;
  }, 20000, 'chrome page target');
  const cdp = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { cdp.on('open', resolve); cdp.on('error', reject); });
  let seq = 0;
  const pending = new Map();
  cdp.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (err) { return; }
    if (!msg.id || !pending.has(msg.id)) return;
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else if (msg.result && msg.result.exceptionDetails) {
      entry.reject(new Error(msg.result.exceptionDetails.text || 'evaluate failed'));
    } else {
      entry.resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
    }
  });
  function evaluate(expression) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      cdp.send(JSON.stringify({
        id, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('CDP evaluate timeout')); }
      }, 8000).unref();
    });
  }
  return {
    evaluate,
    close: () => { try { cdp.close(); } catch (err) { /* ignore */ } },
    profile,
  };
}

function fail(error) {
  console.error('probe: ' + (error && error.message ? error.message : error));
  killAll();
  cleanupProfile();
  process.exit(1);
}

const modeFrames = [];
function collect(data) {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch (err) { return; }
  if (msg.type === 'mode') modeFrames.push(msg);
}

async function waitModeAfter(mock, baseline, timeoutMs) {
  await waitFor(() => modeFrames.some((m, i) => i >= baseline && m.mock === mock),
    timeoutMs, 'mode frame mock=' + mock);
}

(async () => {
  console.log('probe: tags=' + Object.keys(TAGS).sort().join(','));
  if (await portOpen(PORT)) throw new Error('port ' + PORT + ' already in use — stop the running server first');
  if (await portOpen(WS_PORT)) throw new Error('port ' + WS_PORT + ' already in use — stop the running server first');

  const server = await startServer();
  const chrome = await startChrome();
  await waitFor(async () => (await chrome.evaluate(
    '!!(window.whaleSpeech && window.whaleSpeech.state().wsState === 1)'
  )) === true, 30000, 'page ready (ws connected)');
  await waitFor(async () => (await chrome.evaluate(
    '!!(window.whaleModel && window.whaleModel.cmdState)'
  )) === true, 30000, 'whaleModel cmdState present');

  const probeWs = await openWeb();
  probeWs.on('message', collect);
  probeWs.on('error', (err) => fail(err));
  const driver = startDriver();
  // The driver announces the mode on connect: wait for it so the CLI's first
  // command has a python writer (otherwise the server answers 4002).
  await waitFor(() => modeFrames.length > 0, 8000, 'driver connected (mode announce)');

  const cmdState = () => chrome.evaluate(
    'window.whaleModel && window.whaleModel.cmdState ? window.whaleModel.cmdState : null'
  );
  async function waitState(pred, timeoutMs, label) {
    await waitFor(async () => {
      const st = await cmdState();
      return !!st && pred(st);
    }, timeoutMs, label);
    return await cmdState();
  }
  function tagFrame(tag) {
    probeWs.send(JSON.stringify({ type: 'expression', tag: tag }));
  }

  // 1) the CLI path (the DSH's ingress) for one tag.
  const cli = spawnSync(PYTHON, [CLI, 'express', 'happy', '今天特别开心'],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI express exits 0', cli.status === 0, 'exit ' + cli.status);
  let st = await waitState(
    (s) => s.last === 'expression: ' + TAGS.happy && s.ok === true, 8000, 'happy via CLI');
  const cliExprN = st.exprN;
  record('happy -> ' + TAGS.happy + ' (CLI)', true, 'exprN=' + cliExprN);
  const cliBad = spawnSync(PYTHON, [CLI, 'express', 'banana'],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI rejects an unknown tag', cliBad.status === 2, 'exit ' + cliBad.status);

  // 2) every remaining default tag resolves through the table.
  for (const tag of ['sad', 'angry', 'surprised', 'confused', 'love']) {
    const before = (await cmdState()).exprN;
    tagFrame(tag);
    st = await waitState(
      (s) => s.last === 'expression: ' + TAGS[tag] && s.ok === true && s.exprN > before,
      8000, tag);
    record(tag + ' -> ' + TAGS[tag], true, 'exprN ' + before + ' -> ' + st.exprN);
  }

  // 3) unknown tag -> neutral reset.
  let before = (await cmdState()).exprN;
  tagFrame('banana');
  st = await waitState(
    (s) => s.last === 'expression: reset' && s.exprN > before, 8000, 'unknown tag');
  record('unknown tag -> neutral reset', true, 'exprN ' + before + ' -> ' + st.exprN);

  // 4) the neutral tag resets too.
  tagFrame('happy');
  await waitState((s) => s.last === 'expression: ' + TAGS.happy, 8000, 'happy again');
  before = (await cmdState()).exprN;
  tagFrame('neutral');
  st = await waitState(
    (s) => s.last === 'expression: reset' && s.exprN > before, 8000, 'neutral tag');
  record('neutral tag -> reset', true, 'exprN ' + before + ' -> ' + st.exprN);

  // 5) cooldown: the same tag inside the window applies once.
  before = (await cmdState()).exprN;
  tagFrame('happy');
  await waitState((s) => s.exprN > before, 8000, 'happy (cooldown first)');
  tagFrame('happy'); // immediately: must be skipped
  await sleep(COOLDOWN_MS / 2);
  st = await cmdState();
  record('same tag inside the cooldown is skipped', st.exprN === before + 1,
    'exprN=' + st.exprN + ' (expected ' + (before + 1) + ')');
  await sleep(COOLDOWN_MS + 300);
  tagFrame('happy');
  st = await waitState((s) => s.exprN > before + 1, 8000, 'happy after the cooldown');
  record('same tag applies again after the cooldown', true, 'exprN=' + st.exprN);

  // 6) M3.1 name passthrough stays compatible.
  before = (await cmdState()).exprN;
  probeWs.send(JSON.stringify({ type: 'expression', name: '脸红' }));
  st = await waitState(
    (s) => s.last === 'expression: 脸红' && s.exprN > before, 8000, 'name passthrough');
  record('M3.1 name passthrough still works', true, 'exprN ' + before + ' -> ' + st.exprN);

  // 7) a real mode flip resets the face.
  tagFrame('love');
  await waitState((s) => s.last === 'expression: ' + TAGS.love, 8000, 'love before the flip');
  before = (await cmdState()).exprN;
  let modeBase = modeFrames.length;
  probeWs.send(JSON.stringify({ type: 'mode', mock: true }));
  await waitModeAfter(true, modeBase, 5000);
  st = await waitState((s) => s.exprN > before, 8000, 'mode flip reset');
  record('a real mode flip resets the expression', true, 'exprN ' + before + ' -> ' + st.exprN);
  modeBase = modeFrames.length;
  probeWs.send(JSON.stringify({ type: 'mode', mock: false }));
  await waitModeAfter(false, modeBase, 5000);

  // 8) idle -> neutral (probe env WHALE_EXPR_IDLE=6 s).
  tagFrame('sad');
  await waitState((s) => s.last === 'expression: ' + TAGS.sad, 8000, 'sad before idle');
  before = (await cmdState()).exprN;
  st = await waitState(
    (s) => s.last === 'expression: reset' && s.exprN > before, 15000, 'idle neutral');
  record('idle returns the face to neutral', true,
    'exprN ' + before + ' -> ' + st.exprN + ' after ~' + (IDLE_MS / 1000) + ' s');

  // 9) RSS (every steady-state sample) + shutdown.
  const serverRss = rssKb(server.pid);
  const driverRss = rssKb(driver.pid);
  record('server RSS <= 60 MB', serverRss > 0 && serverRss <= 60 * 1024, serverRss + ' KB');
  record('driver RSS <= 30 MB', driverRss > 0 && driverRss <= 30 * 1024, driverRss + ' KB');

  probeWs.close();
  chrome.close();
  killAll();
  try {
    await waitFor(async () => !(await portOpen(PORT)) && !(await portOpen(WS_PORT)), 8000, 'ports released');
    record('ports released', true, ':' + PORT + ' and :' + WS_PORT + ' free');
  } catch (err) {
    record('ports released', false, err.message);
  }
  try { fs.rmSync(chrome.profile, { recursive: true, force: true }); } catch (err) { /* ignore */ }

  const failed = results.filter((r) => !r.ok);
  console.log('probe: ' + (failed.length ? 'FAIL (' + failed.length + ' checks)' : 'PASS (' + results.length + ' checks)'));
  process.exit(failed.length ? 1 : 0);
})().catch(fail);
