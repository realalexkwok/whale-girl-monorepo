#!/usr/bin/env node
// M4.1 perf probe (TG4 automatic half).
// Boots the server, headless Chrome at ?debug=1 and the driver, waits for the real
// model + a connected WS, injects an allocation-free ticker sampler via CDP (no
// production hook in index.html), then measures over --seconds:
//   - rendered frames / wall time (mean FPS),
//   - per-frame time p95 and max (30 FPS budget: 33.3 ms, gate p95 <= 40 ms),
//   - JS heap growth (performance.memory),
//   - an optional server/driver RSS soak with live traffic (--rss-minutes N).
// Usage: node scripts/perf_probe.js [--seconds 60] [--rss-minutes 0] [--visible]
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
const SERVER = path.join(ROOT, 'server.js');
const DRIVER = path.join(ROOT, 'control_whale.py');
const CLI = path.join(ROOT, 'scripts', 'whale_cmd.py');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT) || 3000;
const WS_PORT = Number(process.env.WS_PORT) || 3001;
const VISIBLE = process.argv.includes('--visible');

function argNum(flag, def) {
  const eq = process.argv.find((x) => x.startsWith(flag + '='));
  if (eq) return Number(eq.split('=')[1]);
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def;
}
const SECONDS = Math.max(5, argNum('--seconds', 60));
const RSS_MINUTES = Math.max(0, argNum('--rss-minutes', 0));

const children = [];
function track(child) { children.push(child); return child; }
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
    await sleep(200);
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
  const env = Object.assign({}, process.env, {
    WHALE_WS: 'ws://localhost:' + WS_PORT + '?role=python',
    WHALE_MODE: 'live',
  });
  delete env.WHALE_SAY_TEXT;
  delete env.WHALE_ENGINE;
  const child = track(spawn(PYTHON, [DRIVER], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  child.stdout.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stdout.write('[driver] ' + d); });
  child.stderr.on('data', (d) => { if (process.env.PROBE_DEBUG) process.stderr.write('[driver] ' + d); });
  return child;
}

async function startChrome() {
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-perf-probe-'));
  const args = [
    '--remote-debugging-port=' + debugPort,
    '--autoplay-policy=no-user-gesture-required',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1920,1080',
    'http://localhost:' + PORT + '/?debug=1&ws=' +
      encodeURIComponent('ws://localhost:' + WS_PORT),
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
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      cdp.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('CDP ' + method + ' timeout')); }
      }, 15000).unref();
    });
  }
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
      }, 15000).unref();
    });
  }
  return {
    evaluate,
    send,
    close: () => { try { cdp.close(); } catch (err) { /* ignore */ } },
    profile,
  };
}

function fail(error) {
  console.error('probe: ' + (error && error.message ? error.message : error));
  killAll();
  process.exit(1);
}

const INJECT = `(function () {
  var t = window.PIXI && window.PIXI.Ticker && window.PIXI.Ticker.shared;
  if (!t) return 'no ticker';
  window.__m41 = {
    i: 0, n: 0, dts: new Float32Array(30000),
    t0: performance.now(), last: performance.now(),
    heap0: (performance.memory ? performance.memory.usedJSHeapSize : 0)
  };
  t.add(function () {
    var s = window.__m41;
    var now = performance.now();
    s.dts[s.i < s.dts.length ? s.i++ : s.dts.length - 1] = now - s.last;
    s.last = now;
    s.n++;
  });
  return 'ok';
})()`;

const COLLECT = `(function () {
  var s = window.__m41;
  if (!s) return null;
  var dts = new Array(s.i);
  for (var k = 0; k < s.i; k++) dts[k] = s.dts[k];
  return {
    frames: s.n,
    samples: s.i,
    wall: (performance.now() - s.t0) / 1000,
    heap0: s.heap0,
    heap1: (performance.memory ? performance.memory.usedJSHeapSize : 0),
    tickerFps: (window.PIXI && window.PIXI.Ticker && window.PIXI.Ticker.shared)
      ? window.PIXI.Ticker.shared.FPS : 0,
    dts: dts
  };
})()`;

async function trafficCommand() {
  // One mixed command per RSS-soak tick, mirrored from traffic_mix.sh.
  const pick = RSS_MINUTES > 0 ? Math.floor(Date.now() / 1000) % 4 : 0;
  const args = [CLI];
  if (pick === 0) args.push('say', '大家好，我是鲸鱼娘，内存测试进行中');
  else if (pick === 1) args.push('motion', 'Hammer');
  else if (pick === 2) args.push('express', 'happy', '内存测试');
  else args.push('pose', '{"ParamEyeLOpen":0.4,"ParamEyeROpen":0.4}');
  spawnSync(PYTHON, args, { cwd: ROOT, stdio: 'ignore', timeout: 30000 });
}

(async () => {
  console.log('probe: perf ' + SECONDS + 's' + (RSS_MINUTES ? ' + rss soak ' + RSS_MINUTES + 'min' : '') +
    (VISIBLE ? ' (visible)' : ' (headless)'));
  if (await portOpen(PORT)) throw new Error('port ' + PORT + ' already in use — stop the running server first');
  if (await portOpen(WS_PORT)) throw new Error('port ' + WS_PORT + ' already in use — stop the running server first');

  const server = await startServer();
  const chrome = await startChrome();
  await waitFor(async () => (await chrome.evaluate(
    '!!(window.whaleModel && window.whaleSpeech && window.whaleSpeech.state().wsState === 1)'
  )) === true, 30000, 'page ready (model + whaleSpeech + ws connected)');
  record('real model loaded', (await chrome.evaluate('!!window.whaleModel')) === true, 'window.whaleModel present');

  const driver = startDriver();
  await sleep(1000);
  // Force a collection first: the heap metric must be RETAINED memory, not
  // uncollected garbage (the page JSON-parses 30 frames/s by design).
  await chrome.send('HeapProfiler.collectGarbage', {});
  const t0 = Date.now();
  const injected = await chrome.evaluate(INJECT);
  if (injected !== 'ok') throw new Error('ticker sampler injection failed: ' + injected);

  // Sample the driver's first motion frames so the 30 FPS stream is live.
  await sleep(2000);
  console.log('probe: measuring ' + SECONDS + ' s ...');
  await sleep(SECONDS * 1000);

  await chrome.send('HeapProfiler.collectGarbage', {});
  const stats = await chrome.evaluate(COLLECT);
  if (!stats || !stats.samples) throw new Error('no ticker samples collected');
  const wall = stats.wall || SECONDS;
  const fps = stats.frames / wall;
  const sorted = stats.dts.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const maxDt = sorted[sorted.length - 1];
  const heapGrowthMb = (stats.heap1 - stats.heap0) / (1024 * 1024);

  record('mean FPS >= 25', fps >= 25, fps.toFixed(1) + ' fps over ' + wall.toFixed(1) + ' s (' +
    stats.frames + ' frames, ticker ' + Number(stats.tickerFps).toFixed(1) + ')');
  record('frame-time p95 <= 40 ms', p95 <= 40, 'p95 ' + p95.toFixed(1) + ' ms, max ' + maxDt.toFixed(1) + ' ms');
  record('JS heap growth <= 5 MB', heapGrowthMb <= 5, heapGrowthMb.toFixed(2) + ' MB (' +
    (stats.heap0 / 1048576).toFixed(1) + ' → ' + (stats.heap1 / 1048576).toFixed(1) + ' MB)');

  if (RSS_MINUTES > 0) {
    console.log('probe: rss soak ' + RSS_MINUTES + ' min (traffic every 10 s) ...');
    const samples = { server: [], driver: [] };
    const end = Date.now() + RSS_MINUTES * 60000;
    while (Date.now() < end) {
      samples.server.push(rssKb(server.pid));
      samples.driver.push(rssKb(driver.pid));
      await trafficCommand();
      await sleep(10000);
    }
    const summarize = (arr) => {
      const vals = arr.filter((v) => v > 0).sort((a, b) => a - b);
      if (!vals.length) return null;
      return {
        min: vals[0], max: vals[vals.length - 1],
        mean: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
        n: vals.length
      };
    };
    const srv = summarize(samples.server);
    const drv = summarize(samples.driver);
    record('server RSS mean <= 60 MB', !!srv && srv.mean <= 60 * 1024,
      srv ? 'min ' + Math.round(srv.min / 1024) + ' / mean ' + Math.round(srv.mean / 1024) +
        ' / max ' + Math.round(srv.max / 1024) + ' MB over ' + srv.n + ' samples' : 'no samples');
    record('driver RSS mean <= 30 MB', !!drv && drv.mean <= 30 * 1024,
      drv ? 'min ' + Math.round(drv.min / 1024) + ' / mean ' + Math.round(drv.mean / 1024) +
        ' / max ' + Math.round(drv.max / 1024) + ' MB over ' + drv.n + ' samples' : 'no samples');
  } else {
    const srv = rssKb(server.pid);
    const drv = rssKb(driver.pid);
    // A 0 KB reading means the process is already gone: fail instead of passing 0.
    record('server RSS <= 60 MB', srv > 0 && srv <= 60 * 1024, srv + ' KB (alive: ' + (srv > 0) + ')');
    record('driver RSS <= 30 MB', drv > 0 && drv <= 30 * 1024, drv + ' KB (alive: ' + (drv > 0) + ')');
  }

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
