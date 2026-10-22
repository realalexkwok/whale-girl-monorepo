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
const SILENCE_MS = 10000;   // live mode: no canned line may fire in this window
const MANIFEST = path.join(ROOT, '..', 'whale-girl-frontend', 'model', 'whale.model3.json');
let MOTION = '';
let EXPRESSION = '';
try {
  // The DS model is gitignored: fail with an actionable message, never a
  // generic timeout, when it is missing or has no motions/expressions.
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const refs = manifest.FileReferences || {};
  MOTION = Object.keys(refs.Motions || {})[0] || '';
  EXPRESSION = (refs.Expressions || []).map((e) => e && e.Name).filter(Boolean)[0] || '';
} catch (err) {
  console.error('probe: cannot read the model manifest ' + MANIFEST +
    ' (' + err.message + ') — install the DS model first');
  process.exit(1);
}
if (!MOTION || !EXPRESSION) {
  console.error('probe: the manifest at ' + MANIFEST +
    ' has no motions/expressions — install the DS model first');
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
let serverLogTail = '';

function parseServerCounter(name) {
  const re = new RegExp(name + '=(\\d+)', 'g');
  let last = -1;
  let m;
  while ((m = re.exec(serverLogTail)) !== null) last = Number(m[1]);
  return last;
}
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' — ' + detail);
}

function rssKb(pid) {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'rss=']).toString().trim();
    return out ? parseInt(out, 10) : -1;
  } catch (err) {
    return -1; // unknown: the gate treats <= 0 as a failure
  }
}

async function startServer() {
  const child = track(spawn('node', [SERVER], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), WS_PORT: String(WS_PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  child.on('error', (err) => fail(err));
  child.stdout.on('data', (d) => {
    serverLogTail = (serverLogTail + d.toString()).slice(-4096);
    if (process.env.PROBE_DEBUG) process.stdout.write('[server] ' + d);
  });
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
  });
  // The probe owns the run: never inherit a developer's scripted say or logs,
  // and always talk to THIS probe's proxy (PORT/WS_PORT are env knobs).
  delete env.WHALE_SAY_TEXT;
  delete env.WHALE_DEBUG;
  delete env.WHALE_ENGINE;
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

function cliEnv() {
  return Object.assign({}, process.env, {
    WHALE_CMD_WS: 'ws://localhost:' + WS_PORT + '?role=web',
    WHALE_MODEL_MANIFEST: MANIFEST, // never trust a developer's override
  });
}

async function startChrome() {
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cmd-probe-'));
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
  if (chromeProfile) {
    try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  }
  process.exit(1);
}

// Collected wire frames (rare events only — no per-frame arrays).
const sayFrames = [];
const modeFrames = [];
let lastMotion = null;
let motionCount = 0;
let maxMotionBytes = 0;

function collect(data) {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch (err) { return; }
  if (msg.type === 'say') sayFrames.push(msg);
  else if (msg.type === 'mode') modeFrames.push(msg);
  else if (msg.type === 'motion' && msg.p) {
    lastMotion = msg;
    motionCount++;
    if (data.length > maxMotionBytes) maxMotionBytes = data.length;
  }
}

async function waitSay(predicate, timeoutMs, label) {
  await waitFor(() => sayFrames.some(predicate), timeoutMs, label);
  return sayFrames.filter(predicate).pop();
}

// (waitSay is used for the canned mock frame; the DSH say waits for a NEW one.)

async function waitModeAfter(mock, baseline, timeoutMs) {
  await waitFor(() => modeFrames.some((m, i) => i >= baseline && m.mock === mock),
    timeoutMs, 'mode frame mock=' + mock);
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
  console.log('probe: server boot RSS ' + rssKb(server.pid) +
    ' KB ~1 s after spawn (startup transient, not gated)');

  // The server must refuse commands with no brain and reject foreign origins.
  const noBrainCode = await new Promise((resolve) => {
    const c = new WebSocket('ws://localhost:' + WS_PORT + '?role=web');
    const timer = setTimeout(() => { try { c.terminate(); } catch (e) { /* ignore */ } resolve(0); }, 5000);
    c.on('open', () => c.send('{"type":"motion","group":"Idle"}'));
    c.on('close', (code) => { clearTimeout(timer); resolve(code); });
    c.on('error', () => { /* close follows */ });
  });
  record('command without a driver is refused', noBrainCode === 4002,
    'close code ' + noBrainCode + ' (expected 4002)');
  const badOriginCode = await new Promise((resolve) => {
    const c = new WebSocket('ws://localhost:' + WS_PORT + '?role=web',
      { origin: 'http://evil.example' });
    const timer = setTimeout(() => { try { c.terminate(); } catch (e) { /* ignore */ } resolve(0); }, 5000);
    c.on('close', (code) => { clearTimeout(timer); resolve(code); });
    c.on('error', () => { /* close follows */ });
  });
  record('foreign origin is rejected', badOriginCode === 1008,
    'close code ' + badOriginCode + ' (expected 1008)');
  // Loopback aliases are the same machine: a 127.0.0.1 page must be allowed.
  const aliasCode = await new Promise((resolve) => {
    const c = new WebSocket('ws://localhost:' + WS_PORT + '?role=web',
      { origin: 'http://127.0.0.1:' + PORT });
    const timer = setTimeout(() => { try { c.terminate(); } catch (e) { /* ignore */ } resolve('open'); }, 3000);
    c.on('open', () => { clearTimeout(timer); try { c.close(); } catch (e) { /* ignore */ } resolve('open'); });
    c.on('close', (code) => { clearTimeout(timer); resolve(code === 1000 ? 'open' : code); });
    c.on('error', () => { /* close follows */ });
  });
  record('loopback alias is allowed', aliasCode === 'open',
    'origin http://127.0.0.1:' + PORT + ' -> ' + aliasCode);

  const chrome = await startChrome();
  await waitFor(async () => (await chrome.evaluate(
    '!!(window.whaleSpeech && window.whaleSpeech.state().wsState === 1)'
  )) === true, 30000, 'page ready (whaleSpeech + ws connected)');
  await waitFor(async () => (await chrome.evaluate(
    '!!(window.whaleModel && window.whaleModel.cmdState)'
  )) === true, 30000, 'whaleModel cmdState present');

  const probeWs = await openWeb();
  probeWs.on('message', collect);
  probeWs.on('error', (err) => fail(err));

  // Start the driver only after both web clients are connected so every
  // frame (say/mode/motion) is delivered to the probe and to the page.
  const driver = startDriver();
  const serverSamples = [];
  const driverSamples = [];
  let driverProc = driver;
  function sampleRss() {
    serverSamples.push(rssKb(server.pid));
    if (driverProc) driverSamples.push(rssKb(driverProc.pid));
  }

  // 1) WHALE_MODE=live boot: the mock talk bursts stay silent.
  await waitFor(() => motionCount > 0, 5000, 'driver streaming before the silence check');
  await sleep(SILENCE_MS);
  record('live boot: mock speech paused', sayFrames.length === 0,
    sayFrames.length + ' say frames in ' + (SILENCE_MS / 1000) + ' s (expected 0)');
  sampleRss();

  // 2) motion through the CLI tool end to end.
  let cli = spawnSync(PYTHON, [CLI, 'motion', MOTION], {
    cwd: ROOT, timeout: 15000, env: cliEnv(),
  });
  record('CLI motion exits 0', cli.status === 0,
    'status=' + cli.status + ' out=' + String(cli.stdout || '').trim());
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.last === 'motion: ' + MOTION && st.ok === true;
  }, 8000, 'frontend applied motion ' + MOTION);
  record('motion applied on the frontend', true,
    'cmdState.last="motion: ' + MOTION + '", ok=true (after the hook resolved)');
  const cliBad = spawnSync(PYTHON, [CLI, 'motion', 'Nope'],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI rejects an unknown motion group', cliBad.status === 2,
    'exit ' + cliBad.status);
  const cliBadIndex = spawnSync(PYTHON, [CLI, 'motion', MOTION, '999'],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI rejects an out-of-range motion index', cliBadIndex.status === 2,
    'exit ' + cliBadIndex.status);
  const cliLongGroup = spawnSync(PYTHON, [CLI, 'motion', 'g'.repeat(129)],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI rejects an over-long motion group', cliLongGroup.status === 2,
    'exit ' + cliLongGroup.status);
  // The v1 motion index field must reach the frontend too.
  probeWs.send(JSON.stringify({ type: 'motion', group: MOTION, index: 0 }));
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.last === 'motion: ' + MOTION + '/0' && st.ok === true;
  }, 8000, 'motion command with an index');
  record('motion index is forwarded and applied', true,
    'cmdState.last="motion: ' + MOTION + '/0"');
  const cliNoServer = spawnSync(PYTHON, [CLI, 'say', 'x'], {
    cwd: ROOT, timeout: 15000,
    env: Object.assign({}, process.env, { WHALE_CMD_WS: 'ws://localhost:1?role=web' }),
  });
  record('CLI reports an unreachable server', cliNoServer.status === 1,
    'exit ' + cliNoServer.status);
  const cliPose = spawnSync(PYTHON, [CLI, 'pose', '{"ParamBrowLY":1}'],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI pose exits 0', cliPose.status === 0, 'exit ' + cliPose.status);
  await waitFor(() => lastMotion && lastMotion.p.ParamBrowLY === 1, 5000, 'CLI pose applied');
  const cliPoseClear = spawnSync(PYTHON, [CLI, 'pose', '{}'],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  await waitFor(() => lastMotion && !('ParamBrowLY' in lastMotion.p), 5000, 'CLI pose cleared');
  record('CLI pose applied and cleared', cliPoseClear.status === 0,
    'pose {} exit ' + cliPoseClear.status);
  const longText = 'x'.repeat(301);
  const cliLongSay = spawnSync(PYTHON, [CLI, 'say', longText],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI rejects an over-long say', cliLongSay.status === 2, 'exit ' + cliLongSay.status);
  const manyKeysCli = {};
  for (let i = 0; i < 33; i++) manyKeysCli['ParamP' + i] = 1;
  const cliManyPose = spawnSync(PYTHON, [CLI, 'pose', JSON.stringify(manyKeysCli)],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI rejects an oversized pose', cliManyPose.status === 2, 'exit ' + cliManyPose.status);
  // 'mode live' is idempotent here (the driver boots live), so this CLI call
  // must not flip the driver before the mode tests below.
  const cliMode = spawnSync(PYTHON, [CLI, 'mode', 'live'],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI mode exits 0', cliMode.status === 0, 'exit ' + cliMode.status);
  const cliWrongRole = spawnSync(PYTHON, [CLI, 'mode', 'mock'], {
    cwd: ROOT, timeout: 15000,
    env: Object.assign({}, process.env, {
      WHALE_CMD_WS: 'ws://localhost:' + WS_PORT + '?role=cmd',
    }),
  });
  record('CLI reports a rejected role (1008)', cliWrongRole.status === 1,
    'exit ' + cliWrongRole.status);
  const cliSayBase = sayFrames.length;
  const cliSay = spawnSync(PYTHON, [CLI, 'say', '命令行测试'],
    { cwd: ROOT, timeout: 30000, env: cliEnv() });
  record('CLI say exits 0', cliSay.status === 0, 'exit ' + cliSay.status);
  await waitFor(() => sayFrames.some((m, i) => i >= cliSayBase && m.src === 'cmd'),
    60000, 'a cmd say frame from the CLI');
  record('CLI say produces a cmd say frame', true, 'new src:"cmd" frame');
  // The frontend failure path: a bad motion/expression must report ok=false.
  probeWs.send(JSON.stringify({ type: 'motion', group: 'Nope' }));
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.last === 'motion: Nope' && st.ok === false;
  }, 8000, 'a bad motion reports a failure');
  record('a bad motion reports ok=false', true,
    'cmdState.ok=false (the console lists the motions)');
  probeWs.send(JSON.stringify({ type: 'expression', name: 'NoSuch' }));
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.last === 'expression: NoSuch' && st.ok === false;
  }, 8000, 'a bad expression reports a failure');
  record('a bad expression reports ok=false', true,
    'cmdState.ok=false (the console lists the expressions)');

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

  // A parameter the synthesis never rewrites must leave the frame dict on {}.
  probeWs.send(JSON.stringify({ type: 'pose', p: { ParamBrowLY: 1 } }));
  await waitFor(() => lastMotion && lastMotion.p.ParamBrowLY === 1, 5000,
    'non-synthesized pose key in motion frames');
  probeWs.send(JSON.stringify({ type: 'pose', p: {} }));
  await waitFor(() => lastMotion && !('ParamBrowLY' in lastMotion.p), 5000,
    'non-synthesized pose key removed');
  record('pose clears non-synthesized keys', true,
    'ParamBrowLY present while held, absent from the frames after {}');
  await sleep(250);
  const brow = await chrome.evaluate(
    '(function(){var c=window.whaleModel.model.internalModel.coreModel;' +
    'var i=c.getParameterIndex("ParamBrowLY"); if (i < 0) return null;' +
    'return {v:c.getParameterValueById("ParamBrowLY"), d:c.getParameterDefaultValue(i)};})()'
  );
  record('pose {} restores the model default', !!brow && Math.abs(brow.v - brow.d) < 0.05,
    brow === null ? 'FAIL — ParamBrowLY is not in this model' :
      'ParamBrowLY=' + brow.v + ' (default ' + brow.d + ')');
  // A new pose replaces the overlay: keys it omits disappear from the frames.
  probeWs.send(JSON.stringify({ type: 'pose', p: { ParamBrowLY: 0.5, ParamBrowRY: 0.25 } }));
  await waitFor(() => lastMotion && lastMotion.p.ParamBrowLY === 0.5
    && lastMotion.p.ParamBrowRY === 0.25, 5000, 'two-key pose');
  probeWs.send(JSON.stringify({ type: 'pose', p: { ParamBrowLY: 0.25 } }));
  await waitFor(() => lastMotion && lastMotion.p.ParamBrowLY === 0.25
    && !('ParamBrowRY' in lastMotion.p), 5000, 'pose replacement');
  record('pose replaces the previous overlay', true,
    'ParamBrowRY dropped when the next pose omits it');
  probeWs.send(JSON.stringify({ type: 'pose', p: {} }));

  // 5) mode commands: an idempotent one is a no-op; a real flip clears the pose.
  probeWs.send(JSON.stringify({ type: 'pose', p: { ParamBrowLY: 1 } }));
  await waitFor(() => lastMotion && lastMotion.p.ParamBrowLY === 1, 5000,
    'pose held for the mode test');
  const modeHeldBase = modeFrames.length;
  probeWs.send(JSON.stringify({ type: 'mode', mock: false })); // already live
  await sleep(500);
  record('idempotent mode keeps a held pose',
    !!lastMotion && lastMotion.p.ParamBrowLY === 1 && modeFrames.length === modeHeldBase,
    'no mode frame and ParamBrowLY=' + (lastMotion && lastMotion.p.ParamBrowLY));
  const modeMockBase = modeFrames.length;
  probeWs.send(JSON.stringify({ type: 'mode', mock: true })); // real flip
  await waitModeAfter(true, modeMockBase, 5000);
  await waitFor(() => lastMotion && !('ParamBrowLY' in lastMotion.p), 5000,
    'flip clears the pose overlay');
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.mode === 'mock';
  }, 5000, 'frontend cmdState mode mock');
  record('mode mock: flip frame + frontend state + pose cleared', true,
    'mode frame {"mock":true}, cmdState.mode="mock", ParamBrowLY gone');
  const cannedSay = await waitSay((m) => typeof m.audio === 'string', 25000, 'canned say frame (mock resumed)');
  const cannedOk = typeof cannedSay.audio === 'string'
    && cannedSay.audio.indexOf('/audio/') === 0
    && Array.isArray(cannedSay.words);
  record('mode mock: canned speech resumes', cannedOk,
    'audio=' + cannedSay.audio + ' words=' + (Array.isArray(cannedSay.words) ? cannedSay.words.length : 'none'));
  // A valid motion must work in mock mode too (say > motion-frame mouth only
  // constrains the mouth, not body motions).
  probeWs.send(JSON.stringify({ type: 'motion', group: MOTION }));
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.last === 'motion: ' + MOTION && st.ok === true;
  }, 8000, 'a motion in mock mode');
  record('motion works in mock mode too', true,
    'cmdState.last="motion: ' + MOTION + '" while the mock talks');

  // 6) mode live again, then a real DSH say command (byte-compat with M2.2).
  const modeLiveBase = modeFrames.length;
  probeWs.send(JSON.stringify({ type: 'mode', mock: false }));
  await waitModeAfter(false, modeLiveBase, 5000);
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
  sampleRss(); // audio active

  // Two commanded lines in quick succession: the second is queued behind the
  // in-flight synthesis (one slot) and both eventually send, in order.
  const queueBase = sayFrames.length;
  probeWs.send(JSON.stringify({ type: 'say', text: sayText }));
  probeWs.send(JSON.stringify({ type: 'say', text: '第二句测试' }));
  await waitFor(() => sayFrames.slice(queueBase).filter((m) => m.src === 'cmd').length >= 2,
    90000, 'two commanded say frames');
  const queued = sayFrames.slice(queueBase).filter((m) => m.src === 'cmd');
  record('two rapid commands both send (one-slot queue)',
    queued[0].audio !== queued[1].audio,
    'audio ' + queued[0].audio + ' then ' + queued[1].audio);
  await waitFor(async () => {
    const say = await chrome.evaluate('window.whaleSpeech.probeStats().say');
    return !!say && say.audio === queued[1].audio;
  }, 30000, 'the second commanded line plays');
  record('the queued command plays last (latest)', true,
    'page plays ' + queued[1].audio);

  // 7) mock mode must never cut a commanded line (M3.1 fix: src + hold).
  const modeMockBase2 = modeFrames.length;
  probeWs.send(JSON.stringify({ type: 'mode', mock: true }));
  await waitModeAfter(true, modeMockBase2, 5000);
  const cannedBefore = sayFrames.length;
  await waitFor(() => sayFrames.some((m, i) => i >= cannedBefore && m.src === 'mock'),
    25000, 'canned say in mock mode');
  const canned2 = sayFrames.filter((m, i) => i >= cannedBefore && m.src === 'mock').pop();
  record('say frames carry src', canned2.src === 'mock' && dshSay.src === 'cmd',
    'canned src="mock", commanded src="' + dshSay.src + '"');

  const cutBefore = sayFrames.length;
  probeWs.send(JSON.stringify({ type: 'say', text: sayText }));
  let cmd2 = null;
  await waitFor(() => {
    for (let i = cutBefore; i < sayFrames.length; i++) {
      if (sayFrames[i].src === 'cmd') { cmd2 = sayFrames[i]; return true; }
    }
    return false;
  }, 120000, 'commanded say in mock mode');
  await waitFor(async () => {
    const st = await chrome.evaluate('window.whaleSpeech.state()');
    const say = await chrome.evaluate('window.whaleSpeech.probeStats().say');
    return !!st && st.active === true && !!say && say.audio === cmd2.audio;
  }, 20000, 'commanded say playback (mock mode)');
  await sleep(1000); // sample mid-line, while the mock is muted by the hold
  const midState = await chrome.evaluate('window.whaleSpeech.state()');
  const midSay = await chrome.evaluate('window.whaleSpeech.probeStats().say');
  record('mock does not cut the commanded line',
    !!midState && midState.active === true && !!midSay && midSay.audio === cmd2.audio,
    '1 s into the line: active=' + (midState && midState.active) +
    ' audio=' + (midSay && midSay.audio));
  // The hold's own contract: no mock line may be sent after the commanded one.
  const midMockFrames = sayFrames.slice(sayFrames.indexOf(cmd2) + 1)
    .filter((m) => m.src === 'mock').length;
  record('driver hold suppresses mock lines during the command',
    midMockFrames === 0, midMockFrames + ' mock frames after the commanded frame');
  // The frontend rule: a mock say must not replace a playing commanded line.
  const startsBeforeInject = (await chrome.evaluate('window.whaleSpeech.state()')).starts;
  await chrome.evaluate('window.whaleSpeech.testSay(' + JSON.stringify({
    type: 'say', audio: canned2.audio, words: canned2.words || [], src: 'mock',
  }) + ')');
  await sleep(400);
  const afterInject = await chrome.evaluate('window.whaleSpeech.state()');
  const afterInjectSay = await chrome.evaluate('window.whaleSpeech.probeStats().say');
  record('frontend ignores a mock say while a line plays',
    !!afterInject && afterInject.active === true && !!afterInjectSay &&
      afterInjectSay.audio === cmd2.audio && afterInject.starts === startsBeforeInject,
    'injected src:"mock" — the page still plays ' + (afterInjectSay && afterInjectSay.audio) +
    ', no new start (' + afterInject.starts + ')');
  let endSnapshot = null;
  await waitFor(async () => {
    endSnapshot = await chrome.evaluate(
      '(function(){var s=window.whaleSpeech.state(); var p=window.whaleSpeech.probeStats().say;' +
      'return {active:s.active, audio:p?p.audio:null};})()'
    );
    return !!endSnapshot && endSnapshot.active === false;
  }, 20000, 'commanded line finished (mock mode)');
  record('commanded line plays to its end',
    !!endSnapshot && endSnapshot.audio === cmd2.audio,
    'after the line: last say ' + (endSnapshot && endSnapshot.audio));

  // 8) malformed frames must be rejected without killing the pipeline.
  const bigKey = 'k' + 'x'.repeat(300);                 // > the driver's 64-char cap
  const manyKeys = {};
  for (let i = 0; i < 33; i++) manyKeys['ParamP' + i] = 1;  // > the 32-key cap
  const unicodeKeys = {};
  for (let i = 0; i < 32; i++) unicodeKeys['参数' + i] = 1;  // CJK ids: 6x escaped
  const badFrames = [
    'not json at all',                                              // invalid JSON
    '[]',                                                           // non-object
    'null',                                                         // non-object
    '{"type":"pose","p":{"ParamBrowLY":1e999}}',                    // non-finite
    '{"type":"pose","p":{"ParamBrowLY":' + '9'.repeat(400) + '}}',  // int overflow
    '{"type":"pose","p":{"' + bigKey + '":1}}',                     // key too long
    '{"type":"pose","p":' + JSON.stringify(manyKeys) + '}',         // too many keys
    '{"type":"pose","p":' + JSON.stringify(unicodeKeys) + '}',      // non-ASCII ids
    '{"type":"motion","group":"' + '語'.repeat(5000) + '"}',        // > 8 KB UTF-8: relay cap
    '{"type":"web_connected","count":0}',                           // spoofed event
    '{"type":"motion","group":' + '['.repeat(1500) + ']'.repeat(1500) + '}'  // deep nesting
  ];
  const mcBefore = motionCount;
  for (const frame of badFrames) probeWs.send(frame);
  await sleep(700);
  const lastP = lastMotion ? lastMotion.p : {};
  const badKeysAbsent = !('ParamBrowLY' in lastP) && !(bigKey in lastP)
    && !('ParamP0' in lastP) && !('参数0' in lastP);
  record('bad pose frames are rejected', badKeysAbsent,
    'non-finite / 400-digit / long-key / 33-key / CJK-key poses left the frames clean');
  record('observed motion frame stays under the 8 KB cap',
    maxMotionBytes > 0 && maxMotionBytes < 8192,
    'max observed ' + maxMotionBytes + ' bytes (the server drops larger frames first)');
  probeWs.send(JSON.stringify({ type: 'expression', name: EXPRESSION }));
  await waitFor(async () => {
    const st = await cmdState(chrome);
    return st && st.last === 'expression: ' + EXPRESSION;
  }, 8000, 'pipeline alive after malformed frames');
  await sleep(400);
  const mcAfter = motionCount;
  record('malformed frames are ignored safely', mcAfter - mcBefore > 10,
    badFrames.length + ' bad frames (invalid JSON, non-object, non-finite, huge int, ' +
    'long key, 33 keys, CJK keys, >8 KB multibyte, spoofed web_connected, deep ' +
    'nesting); the expression applied and the motion stream kept flowing (' +
    (mcAfter - mcBefore) + ' frames)');
  sampleRss();

  // The relay's fixed-window cap: a 150-frame burst must be partially dropped.
  const droppedBefore = parseServerCounter('dropped');
  for (let i = 0; i < 150; i++) probeWs.send('{"type":"mode","mock":true}');
  await sleep(5200);
  probeWs.send('{"type":"mode","mock":true}'); // force a fresh aggregate log line
  await sleep(600);
  const droppedAfter = parseServerCounter('dropped');
  record('command flood is rate-capped',
    droppedBefore >= 0 && droppedAfter > droppedBefore,
    'dropped ' + droppedBefore + ' -> ' + droppedAfter + ' after a 150-frame burst');

  // 9) a live flip during mock activity silences the canned lines at once.
  const canned3Base = sayFrames.length;
  await waitFor(() => sayFrames.some((m, i) => i >= canned3Base && m.src === 'mock'),
    25000, 'canned say before the live flip');
  const canned3 = sayFrames.filter((m, i) => i >= canned3Base && m.src === 'mock').pop();
  // The page must actually be PLAYING that line before the flip (M2 fix).
  await waitFor(async () => {
    const st = await chrome.evaluate('window.whaleSpeech.state()');
    const say = await chrome.evaluate('window.whaleSpeech.probeStats().say');
    return !!st && st.active === true && !!say && say.audio === canned3.audio;
  }, 15000, 'canned line playing before the flip');
  const liveFlipBase = sayFrames.length;
  const liveFlipModeBase = modeFrames.length;
  probeWs.send(JSON.stringify({ type: 'mode', mock: false }));
  await waitModeAfter(false, liveFlipModeBase, 5000);
  await sleep(150);
  const flipped = await chrome.evaluate('window.whaleSpeech.state()');
  record('live flip stops a playing canned line', !!flipped && flipped.active === false,
    'active=' + (flipped && flipped.active));
  // A mock say arriving after the flip must not start (decode-time guard).
  const startsBeforeFlipInject = (await chrome.evaluate('window.whaleSpeech.state()')).starts;
  await chrome.evaluate('window.whaleSpeech.testSay(' + JSON.stringify({
    type: 'say', audio: canned3.audio, words: canned3.words || [], src: 'mock',
  }) + ')');
  await sleep(800);
  const afterFlipInject = await chrome.evaluate('window.whaleSpeech.state()');
  record('mock say after a live flip is ignored',
    !!afterFlipInject && afterFlipInject.active === false
      && afterFlipInject.starts === startsBeforeFlipInject,
    'injected src:"mock" — active=' + (afterFlipInject && afterFlipInject.active) +
    ', no new start');
  await sleep(2000);
  const stayedOff = await chrome.evaluate('window.whaleSpeech.state()');
  record('live stays silent after the flip',
    !!stayedOff && stayedOff.active === false,
    'active=' + (stayedOff && stayedOff.active));

  // Decode-time race: a mock say still decoding when the flip lands must not start.
  const raceMockBase = modeFrames.length;
  probeWs.send(JSON.stringify({ type: 'mode', mock: true }));
  await waitModeAfter(true, raceMockBase, 5000);
  await sleep(300);
  const startsBeforeRace = (await chrome.evaluate('window.whaleSpeech.state()')).starts;
  // A 600 ms decode delay makes the race deterministic: the flip always lands
  // while the mock line is still "pending" (test-only parameter).
  await chrome.evaluate('window.whaleSpeech.testSay(' + JSON.stringify({
    type: 'say', audio: dshSay.audio, words: dshSay.words || [], src: 'mock',
  }) + ', 600)');
  const raceLiveBase = modeFrames.length;
  probeWs.send(JSON.stringify({ type: 'mode', mock: false }));
  await waitModeAfter(false, raceLiveBase, 5000);
  await sleep(1500);
  const raceState = await chrome.evaluate('window.whaleSpeech.state()');
  record('a mock say decoding during the live flip does not start',
    !!raceState && raceState.active === false && raceState.starts === startsBeforeRace,
    'active=' + (raceState && raceState.active) + ', starts ' +
    startsBeforeRace + ' -> ' + (raceState && raceState.starts));
  const silenceBase = sayFrames.length;
  await sleep(SILENCE_MS);
  const leaked = sayFrames.length - silenceBase;
  record('live flip silences canned speech', leaked === 0,
    leaked + ' say frames in ' + (SILENCE_MS / 1000) + ' s after the flip');

  // 10) a page that joins AFTER the driver must learn the current mode.
  const oldOrigin = await chrome.evaluate('performance.timeOrigin');
  try { await chrome.evaluate('location.reload()'); } catch (err) { /* teardown */ }
  await waitFor(async () => {
    try {
      const origin = await chrome.evaluate('performance.timeOrigin');
      return typeof origin === 'number' && origin !== oldOrigin;
    } catch (err) {
      return false;
    }
  }, 20000, 'a new document after the reload');
  await waitFor(async () => {
    try {
      return (await chrome.evaluate(
        'window.whaleModel && window.whaleModel.cmdState ? window.whaleModel.cmdState.mode : null'
      )) === 'live';
    } catch (err) {
      return false;
    }
  }, 20000, 'the NEW page learned the live mode');
  record('page joining after the driver learns the live mode', true,
    'a new document (timeOrigin changed) has cmdState.mode="live"');

  // CLI mode flip end to end (the DSH's only ingress for mode).
  const cliFlipBase = modeFrames.length;
  const cliFlip = spawnSync(PYTHON, [CLI, 'mode', 'mock'],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI mode flip exits 0', cliFlip.status === 0, 'exit ' + cliFlip.status);
  await waitModeAfter(true, cliFlipBase, 5000);
  record('CLI mode flip produces a mode frame', true, '{"mock":true} via the CLI');
  const cliRestoreBase = modeFrames.length;
  spawnSync(PYTHON, [CLI, 'mode', 'live'],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  await waitModeAfter(false, cliRestoreBase, 5000);
  record('CLI mode flip restores live', true, '{"mock":false} via the CLI');

  // 11) the motion stream is still healthy at ~30 fps.
  const beforeCount = motionCount;
  const beforeAt = Date.now();
  await sleep(2000);
  const rate = (motionCount - beforeCount) / ((Date.now() - beforeAt) / 1000);
  record('motion stream 25-35 fps', rate >= 25 && rate <= 35, rate.toFixed(1) + ' fps over 2.00 s');

  // 12) RSS budgets: EVERY sample must fit (unknown/0 is a failure).
  sampleRss();
  const srvMax = Math.max.apply(null, serverSamples);
  const drvMax = Math.max.apply(null, driverSamples);
  record('server RSS <= 60 MB (every sample)',
    serverSamples.every((v) => v > 0 && v <= 60 * 1024),
    'samples ' + serverSamples.join(', ') + ' KB — max ' + srvMax);
  record('driver RSS <= 30 MB (every sample)',
    driverSamples.every((v) => v > 0 && v <= 30 * 1024),
    'samples ' + driverSamples.join(', ') + ' KB — max ' + drvMax);

  // CLI with no driver: the server answers 4002 and the tool exits 1.
  driver.kill('SIGTERM');
  await waitFor(() => serverLogTail.indexOf('python disconnected') !== -1, 8000,
    'the server sees the driver disconnect');
  const cliNoBrain = spawnSync(PYTHON, [CLI, 'motion', MOTION],
    { cwd: ROOT, timeout: 15000, env: cliEnv() });
  record('CLI exits 1 with no driver', cliNoBrain.status === 1,
    'exit ' + cliNoBrain.status);

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
