#!/usr/bin/env node
// M2.2 say probe (automatic half).
// Boots the server, opens headless Chrome at ?debug=1, starts the driver with a
// scripted WHALE_SAY_TEXT, captures the say frame as a web client, then asserts:
//   - the audio URL serves 200 with an audio/* content type and decodes,
//   - the mouth tracks the word timeline (>= 0.4 in-word, <= 0.15 in gaps),
//   - word-onset -> mouth-0.5 latency < 100 ms (mean and max),
//   - decoded PCM < 10 MB; server <= 60 MB / driver <= 30 MB RSS.
// With --engine=say the macOS fallback is forced and the amplitude envelope is
// checked instead of the word timeline.
// Usage: node scripts/say_probe.js [--engine=say] [--visible]
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
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT) || 3000;
const WS_PORT = Number(process.env.WS_PORT) || 3001;
const SENTENCE = '你好，我是鲸鱼娘。今天也要开心哦！';
const ENGINE_ARG = process.argv.find((a) => a.startsWith('--engine='));
const ENGINE = ENGINE_ARG ? ENGINE_ARG.split('=')[1] : '';
const VISIBLE = process.argv.includes('--visible');

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
  // The probe owns the run: always talk to THIS probe's proxy and never inherit
  // a developer's mode/engine (WHALE_SAY_TEXT is set here, overriding any).
  const env = Object.assign({}, process.env, {
    WHALE_SAY_TEXT: SENTENCE,
    WHALE_WS: 'ws://localhost:' + WS_PORT + '?role=python',
  });
  delete env.WHALE_MODE;
  delete env.WHALE_ENGINE;
  if (ENGINE) env.WHALE_ENGINE = ENGINE;
  const child = track(spawn(PYTHON, [DRIVER], {
    cwd: ROOT,
    env,
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-say-probe-'));
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

(async () => {
  console.log('probe: engine=' + (ENGINE || 'edge-tts') + ' sentence=' + SENTENCE);
  if (await portOpen(PORT)) throw new Error('port ' + PORT + ' already in use — stop the running server first');
  if (await portOpen(WS_PORT)) throw new Error('port ' + WS_PORT + ' already in use — stop the running server first');

  const server = await startServer();
  const chrome = await startChrome();
  await waitFor(async () => (await chrome.evaluate(
    '!!(window.whaleSpeech && window.whaleSpeech.state().wsState === 1)'
  )) === true, 30000, 'page ready (whaleSpeech + ws connected)');

  const probeWs = await openWeb();
  const sayPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no say frame within 120 s (edge-tts unreachable?)')), 120000);
    probeWs.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (err) { return; }
      if (msg.type === 'say') { clearTimeout(timer); resolve(msg); }
    });
  });
  // Start the driver only after both web clients (page + probe) are connected,
  // so the first say frame is delivered to both.
  const driver = startDriver();
  const sayFrame = await sayPromise;

  record('say frame', true,
    'audio=' + sayFrame.audio + ' words=' + (Array.isArray(sayFrame.words) ? sayFrame.words.length : 'none'));

  await waitFor(async () => (await chrome.evaluate(
    '(function(){return window.whaleSpeech.state().samples > 0;})()'
  )) === true, 20000, 'mouth samples (playback started)');

  // M4.1 regression guard: a motion that lists ParamMouthOpenY (Ketchup — the
  // largest mouth curve, 5 s) must not mask the speech mouth while a say plays.
  // The model marks ParamMouthOpenY as the LipSync group, so the say wins.
  probeWs.send(JSON.stringify({ type: 'motion', group: 'Ketchup', index: 0 }));
  // cmdState.last is set before playMotion resolves; wait for the OUTCOME too so a
  // rejected motion cannot make this guard pass vacuously. (The lip-sync numbers
  // below remain the real guard for the mouth itself.)
  let motionOk = false;
  try {
    await waitFor(async () => {
      const st = await chrome.evaluate(
        '(window.whaleModel && window.whaleModel.cmdState) ? ' +
        'JSON.stringify({ last: window.whaleModel.cmdState.last, ok: window.whaleModel.cmdState.ok }) : ""'
      );
      if (!st) return false;
      const s = JSON.parse(st);
      motionOk = s.last === 'motion: Ketchup/0' && s.ok === true;
      return motionOk;
    }, 8000, 'Ketchup command accepted during the say');
  } catch (err) { /* recorded as a failure below */ }
  await waitFor(async () => (await chrome.evaluate(
    '!window.whaleSpeech.state().active'
  )) === true, 30000, 'say playback finished');

  const stats = await chrome.evaluate('window.whaleSpeech.probeStats()');
  const say = stats.say || {};
  // Fetch the audio the page actually played (latest-wins makes this explicit).
  const audioRes = await fetch('http://localhost:' + PORT + (say.audio || sayFrame.audio));
  const ctype = audioRes.headers.get('content-type') || '';
  record('audio served 200 + audio/*', audioRes.status === 200 && /^audio\//.test(ctype),
    'HTTP ' + audioRes.status + ' content-type=' + ctype);
  record('page played the captured say', say.audio === sayFrame.audio,
    'page=' + say.audio + ' frame=' + sayFrame.audio);
  const t = stats.t || [];
  const m = stats.mouth || [];
  const words = Array.isArray(say.words) ? say.words : [];
  const duration = say.duration || 0;
  record('decoded PCM < 10 MB', (say.bufferBytes || 0) < 10 * 1024 * 1024,
    (say.bufferBytes || 0) + ' bytes, duration ' + duration.toFixed(2) + ' s');
  record('motion command applied during the say', motionOk,
    'cmdState = motion: Ketchup/0, ok=' + motionOk);
  record('page say matches frame', say.engine === (ENGINE === 'say' ? 'say' : 'edge-tts'),
    'engine=' + say.engine);
  record('words timeline present', ENGINE === 'say' ? words.length === 0 : words.length > 0,
    words.length + ' words');

  if (ENGINE === 'say') {
    const amp = Array.isArray(say.amp) ? say.amp : [];
    const WIN = 0.05; // buildAmp window width
    let maxMouth = 0;
    let loudSum = 0;
    let loudN = 0;
    let quietMax = 0;
    let quietN = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] < 0 || t[i] > duration) continue;
      if (m[i] > maxMouth) maxMouth = m[i];
      if (!amp.length) continue;
      const idx = Math.min(amp.length - 1, Math.floor(t[i] / WIN));
      if (amp[idx] >= 0.6) { loudSum += m[i]; loudN++; }
      // Sustained silence only (>= 300 ms of quiet windows): the 120 ms
      // release lag after loud speech is expected and must not count.
      let quiet = true;
      const from = Math.max(0, idx - 6);
      for (let k = from; k <= idx; k++) {
        if (amp[k] > 0.1) { quiet = false; break; }
      }
      if (quiet) { quietN++; if (m[i] > quietMax) quietMax = m[i]; }
    }
    record('amplitude mouth (max >= 0.3)', maxMouth >= 0.3, 'max mouth ' + maxMouth.toFixed(2));
    record('loud windows mouth (mean >= 0.3)', loudN > 0 && loudSum / loudN >= 0.3,
      'mean ' + (loudN ? (loudSum / loudN).toFixed(2) : 'n/a') + ' over ' + loudN + ' samples');
    record('sustained-silence mouth <= 0.15', quietN === 0 ? true : quietMax <= 0.15,
      quietN === 0 ? 'no sustained silence (n/a)' : 'max ' + quietMax.toFixed(3) + ' over ' + quietN + ' samples');
  } else {
    let inTotal = 0;
    let inPass = 0;
    for (let i = 0; i < t.length; i++) {
      for (let j = 0; j < words.length; j++) {
        if (t[i] >= words[j][0] + 0.1 && t[i] <= words[j][1]) {
          inTotal++;
          if (m[i] >= 0.4) inPass++;
          break;
        }
      }
    }
    const ratio = inTotal ? inPass / inTotal : 0;
    record('in-word mouth >= 0.4', inTotal > 0 && ratio >= 0.8,
      inPass + '/' + inTotal + ' samples (' + (ratio * 100).toFixed(0) + '%)');

    let gapMax = 0;
    let gapN = 0;
    for (let j = 1; j < words.length; j++) {
      const start = words[j - 1][1] + 0.25;
      const end = words[j][0] - 0.05;
      if (end - start < 0.1) continue;
      for (let i = 0; i < t.length; i++) {
        if (t[i] >= start && t[i] <= end) { gapN++; if (m[i] > gapMax) gapMax = m[i]; }
      }
    }
    record('gap mouth <= 0.15', gapN === 0 ? true : gapMax <= 0.15,
      gapN === 0 ? 'no gap >= 150 ms (n/a)' : 'max ' + gapMax.toFixed(3) + ' over ' + gapN + ' samples');

    const lat = [];
    for (let j = 0; j < words.length; j++) {
      const onset = words[j][0];
      for (let i = 0; i < t.length; i++) {
        if (t[i] >= onset && t[i] <= onset + 0.5 && m[i] >= 0.5) { lat.push(t[i] - onset); break; }
      }
    }
    const mean = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 1;
    const max = lat.length ? Math.max.apply(null, lat) : 1;
    record('word-onset latency < 100 ms', lat.length === words.length && max < 0.1,
      'mean ' + (mean * 1000).toFixed(0) + ' ms, max ' + (max * 1000).toFixed(0) +
      ' ms over ' + lat.length + '/' + words.length + ' words');
  }

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
