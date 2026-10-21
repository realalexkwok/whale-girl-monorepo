#!/usr/bin/env node
// M3.1 command-surface probe (automatic half).
// Boots the server, headless Chrome at ?debug=1 and the driver in LIVE mode,
// then drives the pipeline through the SAME path a DSH session uses: command
// frames from a ?role=web client (the whale_cmd.py tool for motion), relayed
// raw by the server to the python driver, executed on the frontend hooks.
// Asserts per frame type: motion / expression / pose / mode / say (byte-
// compatible with M2.2), the mock-pause both ways, frame rate and RSS.
// Usage: node scripts/cmd_probe.js [--visible]
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
const SILENCE_MS = 10000;   // a mock burst must have fired in this window
const EXPRESSION = '爱心眼';

const children = [];
function track(child) {
  children.push(child);
  return child;
}
function killAll() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch (err) { /* already gone */ }
  }
}
process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(1); });

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
    return out ? parseInt(out, 10) : 0;
  } catch (err) {
    return 0;
  }
}

async function startServer() {
  const child = track(spawn('node', [SERVER], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), WS_PORT: String(WS_PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  child.stdout.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stdout.write('[server] ' + d); });
  child.stderr.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stderr.write('[server] ' + d); });
  await waitFor(async () => {
    try { return (await fetch('http://localhost:' + PORT + '/')).ok; } catch (err) { return false; }
  }, 10000, 'server on :' + PORT);
  return child;
}

function startDriver() {
  const child = track(spawn(PYTHON, [DRIVER], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { WHALE_MODE: 'live' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cmd-probe-'));
  const args = [
    '--remote-debugging-port=' + debugPort,
    '--autoplay-policy=no-user-gesture-required',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1280,900',
    'http://localhost:' + PORT + '/?debug=1',
  ];
  if (!VISIBLE) args.unshift('--headless=new');
  const child = track(spawn(CHROME, args, { stdio: 'ignore' }));
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
  process.exit(1);
}

// Collected wire frames (rare events only — no per-frame arrays).
const sayFrames = [];
const modeFrames = [];
let lastMotion = null;
let motionCount = 0;

function collect(data) {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch (err) { return; }
  if (msg.type === 'say') sayFrames.push(msg);
  else if (msg.type === 'mode') modeFrames.push(msg);
  else if (msg.type === 'motion' && msg.p) { lastMotion = msg; motionCount++; }
}

async function waitSay(predicate, timeoutMs, label) {
  await waitFor(() => sayFrames.some(predicate), timeoutMs, label);
  return sayFrames.filter(predicate).pop();
}

// (waitSay is used for the canned mock frame; the DSH say waits for a NEW one.)

async function waitMode(mock, timeoutMs) {
  await waitFor(() => modeFrames.some((m) => m.mock === mock), timeoutMs, 'mode frame mock=' + mock);
  return modeFrames.filter((m) => m.mock === mock).pop();
}

async function cmdState(chrome) {
  return await chrome.evaluate(
    'window.whaleModel && window.whaleModel.cmdState ? window.whaleModel.cmdState : null'
  );
}

(async () => {
  console.log('probe: driver LIVE boot, CLI=' + CLI);
  if (await portOpen(PORT)) throw new Error('port ' + PORT + ' already in use — stop the running server first');
  if (await portOpen(WS_PORT)) throw new Error('port ' + WS_PORT + ' already in use — stop the running server first');

  const server = await startServer();
  const chrome = await startChrome();
  await waitFor(async () => (await chrome.evaluate(
    '!!(window.whaleSpeech && window.whaleSpeech.state().wsState === 1)'
  )) === true, 30000, 'page ready (whaleSpeech + ws connected)');
  await waitFor(async () => (await chrome.evaluate(
    '!!(window.whaleModel && window.whaleModel.cmdState)'
  )) === true, 30000, 'whaleModel cmdState present');

  const probeWs = await openWeb();
  probeWs.on('message', collect);

  // Start the driver only after both web clients are connected so every
  // frame (say/mode/motion) is delivered to the probe and to the page.
  const driver = startDriver();

  // 1) WHALE_MODE=live boot: the mock talk bursts stay silent.
  await sleep(SILENCE_MS);
  record('live boot: mock speech paused', sayFrames.length === 0,
    sayFrames.length + ' say frames in ' + (SILENCE_MS / 1000) + ' s (expected 0)');

  // 2) motion through the CLI tool end to end.
  let cli = spawnSync(PYTHON, [CLI, 'motion', 'Hammer'], { cwd: ROOT, timeout: 15000 });
  record('CLI motion exits 0', cli.status === 0,
    'status=' + cli.status + ' out=' + String(cli.stdout || '').trim());
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.last === 'motion: Hammer' && st.ok === true;
  }, 8000, 'frontend applied motion Hammer');
  record('motion applied on the frontend', true, 'cmdState.last="motion: Hammer", ok=true');

  // 3) expression on the same transport.
  probeWs.send(JSON.stringify({ type: 'expression', name: EXPRESSION }));
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.last === 'expression: ' + EXPRESSION && st.ok === true;
  }, 8000, 'frontend applied the expression');
  record('expression applied on the frontend', true, 'cmdState.last="expression: ' + EXPRESSION + '", ok=true');

  // 4) pose held inside the motion frames, then cleared.
  probeWs.send(JSON.stringify({ type: 'pose', p: { ParamEyeBallX: 0.9 } }));
  await waitFor(() => lastMotion && Math.abs(lastMotion.p.ParamEyeBallX - 0.9) < 0.02,
    5000, 'pose value in motion frames');
  record('pose overlay held in motion frames', true,
    'ParamEyeBallX=' + lastMotion.p.ParamEyeBallX.toFixed(3) + ' (commanded 0.9)');
  probeWs.send(JSON.stringify({ type: 'pose', p: {} }));
  await waitFor(() => lastMotion && Math.abs(lastMotion.p.ParamEyeBallX - 0.9) > 0.05,
    5000, 'pose cleared');
  record('pose {} clears the overlay', true,
    'ParamEyeBallX=' + lastMotion.p.ParamEyeBallX.toFixed(3) + ' (mock gaze resumes)');

  // 5) mode mock: the flip frame arrives and the canned speech resumes.
  probeWs.send(JSON.stringify({ type: 'mode', mock: true }));
  await waitMode(true, 5000);
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.mode === 'mock';
  }, 5000, 'frontend cmdState mode mock');
  record('mode mock: flip frame + frontend state', true,
    'mode frame {"mock":true}, cmdState.mode="mock"');
  const cannedSay = await waitSay((m) => typeof m.audio === 'string', 25000, 'canned say frame (mock resumed)');
  const cannedOk = typeof cannedSay.audio === 'string'
    && cannedSay.audio.indexOf('/audio/') === 0
    && Array.isArray(cannedSay.words);
  record('mode mock: canned speech resumes', cannedOk,
    'audio=' + cannedSay.audio + ' words=' + (Array.isArray(cannedSay.words) ? cannedSay.words.length : 'none'));

  // 6) mode live again, then a real DSH say command (byte-compat with M2.2).
  probeWs.send(JSON.stringify({ type: 'mode', mock: false }));
  await waitMode(false, 5000);
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.mode === 'live';
  }, 5000, 'frontend cmdState mode live');
  record('mode live: flip frame + frontend state', true,
    'mode frame {"mock":false}, cmdState.mode="live"');

  const sayText = '测试一下语音命令';
  probeWs.send(JSON.stringify({ type: 'say', text: sayText }));
  // Wait for a NEW say frame (not the canned one above): the audio path must differ.
  await waitFor(() => sayFrames.some((m) => m.audio !== cannedSay.audio),
    120000, 'say frame from the say command');
  const dshSay = sayFrames.filter((m) => m.audio !== cannedSay.audio).pop();
  const shapeOk = dshSay.type === 'say'
    && typeof dshSay.audio === 'string' && dshSay.audio.indexOf('/audio/') === 0
    && Array.isArray(dshSay.words)
    && dshSay.words.every((w) => Array.isArray(w) && typeof w[0] === 'number'
      && typeof w[1] === 'number' && typeof w[2] === 'string');
  record('say command: byte-compatible frame', shapeOk,
    dshSay.audio + ' words=' + dshSay.words.length + ' (schema == M2.2)');

  const audioRes = await fetch('http://localhost:' + PORT + dshSay.audio);
  const ctype = audioRes.headers.get('content-type') || '';
  record('say audio served 200 + audio/*', audioRes.status === 200 && /^audio\//.test(ctype),
    'HTTP ' + audioRes.status + ' content-type=' + ctype);

  await waitFor(async () => {
    const st = await chrome.evaluate(
      'window.whaleSpeech.probeStats().say ? window.whaleSpeech.probeStats().say.audio : null'
    );
    return st === dshSay.audio;
  }, 20000, 'page playing the commanded say');
  await waitFor(async () => {
    const st = await chrome.evaluate('window.whaleSpeech.probeStats().say');
    return st && st.bufferBytes > 0;
  }, 20000, 'page decoded the commanded say');
  const pageSay = await chrome.evaluate('window.whaleSpeech.probeStats().say');
  record('page played the commanded say', !!pageSay && pageSay.audio === dshSay.audio,
    'engine=' + (pageSay && pageSay.engine) + ' decoded=' + (pageSay && pageSay.bufferBytes) + ' bytes, duration ' +
    (pageSay && pageSay.duration ? pageSay.duration.toFixed(2) : '?') + ' s');

  // 7) the motion stream is still healthy at ~30 fps.
  const beforeCount = motionCount;
  const beforeAt = Date.now();
  await sleep(2000);
  const rate = (motionCount - beforeCount) / ((Date.now() - beforeAt) / 1000);
  record('motion stream 25-35 fps', rate >= 25 && rate <= 35, rate.toFixed(1) + ' fps over 2.00 s');

  // 8) RSS budgets with commands active.
  const serverRss = rssKb(server.pid);
  const driverRss = rssKb(driver.pid);
  record('server RSS <= 60 MB', serverRss <= 60 * 1024, serverRss + ' KB');
  record('driver RSS <= 30 MB', driverRss <= 30 * 1024, driverRss + ' KB');

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
