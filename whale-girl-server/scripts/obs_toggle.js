'use strict';

// scripts/obs_toggle.js — M4.1 TG1 measurement helper.
//
// Toggles the whale Browser source in OBS via the built-in obs-websocket server
// (localhost, auth from the plugin config). Used by the memory soak to switch
// between Phase A (source visible) and Phase B (source hidden → CEF renderer
// unloads because "Shutdown source when not visible" is on).
//
// Usage: node scripts/obs_toggle.js info|on|off [--scene NAME] [--source NAME]
//   env: OBS_WS_PORT (default 4455), OBS_WS_PASSWORD (default from the OBS config),
//        OBS_SCENE / OBS_SOURCE (defaults: the current program scene / "浏览器")
// Exit: 0 ok, 2 cannot connect or identify, 3 scene/item not found.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const CFG = path.join(process.env.HOME || '',
  'Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (err) { /* defaults below */ }
const PORT = Number(process.env.OBS_WS_PORT || cfg.server_port || 4455);
const PASSWORD = process.env.OBS_WS_PASSWORD || cfg.server_password || '';

const action = process.argv[2] || 'info';
const rest = process.argv.slice(3);
function opt(name, def) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
}
const SCENE = opt('--scene', process.env.OBS_SCENE || '');
const SOURCE = opt('--source', process.env.OBS_SOURCE || '浏览器');

let nextId = 0;
const pending = new Map();
let ws;

function fail(msg) {
  console.error('[obs] ' + msg);
  process.exit(2);
}

function req(requestType, requestData) {
  return new Promise((resolve, reject) => {
    const id = String(++nextId);
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ op: 6, d: { requestType, requestId: id, requestData: requestData || {} } }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(requestType + ' timed out')); }
    }, 5000);
  });
}

let identified = false;
ws = new WebSocket('ws://127.0.0.1:' + PORT, { handshakeTimeout: 5000 });
ws.on('error', (err) => fail('websocket error: ' + err.message + ' — is OBS running with the WebSocket server enabled?'));
// A close BEFORE identification means the handshake failed (e.g. 4009 = wrong
// password). Without this handler node would exit 0 and the caller would believe
// the source was toggled.
ws.on('close', (code, reason) => {
  if (identified) return;
  const why = reason ? String(reason) : '';
  fail('connection closed before identification (code ' + code + (why ? ', ' + why : '') + ')' +
    (code === 4009 ? ' — check the password in OBS Tools → WebSocket Server Settings' : ''));
});
ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw); } catch (err) { return; }
  if (msg.op === 0) { // Hello → Identify
    const auth = msg.d && msg.d.authentication;
    let authentication;
    if (auth) {
      const secret = crypto.createHash('sha256').update(PASSWORD + auth.salt).digest('base64');
      authentication = crypto.createHash('sha256').update(secret + auth.challenge).digest('base64');
    }
    ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication, eventSubscriptions: 0 } }));
    return;
  }
  if (msg.op === 2) { // Identified
    identified = true;
    run().then(() => process.exit(0), (err) => fail(err.message));
    return;
  }
  if (msg.op === 7) { // RequestResponse
    const p = pending.get(msg.d.requestId);
    if (p) {
      pending.delete(msg.d.requestId);
      if (msg.d.requestStatus && msg.d.requestStatus.result === false) {
        p.reject(new Error(msg.d.requestType + ': ' + JSON.stringify(msg.d.requestStatus)));
      } else {
        p.resolve(msg.d.responseData);
      }
    }
  }
});

function failNotFound(message) {
  console.error('[obs] ' + message);
  process.exit(3); // header contract: 3 = scene/item not found
}

async function findItem() {
  const list = await req('GetSceneList');
  const scenes = (list.scenes || []).map((s) => s.sceneName);
  let scene = list.currentProgramSceneName;
  if (SCENE) {
    if (scenes.indexOf(SCENE) < 0) {
      failNotFound('scene "' + SCENE + '" not found (available: ' + (scenes.join(', ') || 'none') + ')');
    }
    scene = SCENE;
  }
  const items = (await req('GetSceneItemList', { sceneName: scene })).sceneItems || [];
  // NEVER fall back to another item: hiding the wrong source in a live scene is
  // exactly the kind of silent mistake this helper must refuse to make.
  const item = items.find((i) => i.sourceName === SOURCE);
  if (!item) {
    failNotFound('source "' + SOURCE + '" not found in scene "' + scene + '" (items: ' +
      (items.map((i) => i.sourceName).join(', ') || 'none') + ')');
  }
  return { scene, scenes, items, item };
}

async function run() {
  const version = await req('GetVersion');
  const found = await findItem();
  if (!found.item) throw new Error('no scene item found in ' + found.scene);
  const state = found.items.map((i) => i.sourceName + '=' + (i.sceneItemEnabled ? 'visible' : 'hidden'));
  console.log('[obs] ' + version.obsVersion + ' / obs-websocket ' + version.obsWebSocketVersion +
    ' | scene=' + found.scene + ' item=' + found.item.sourceName +
    ' (' + (found.item.sceneItemEnabled ? 'visible' : 'hidden') + ')');
  console.log('[obs] items: ' + state.join(', '));
  if (action === 'info') return;
  if (action === 'shutdown-on-hide') {
    // Ensure the browser source unloads its page when hidden (fresh OBS sources
    // default to keeping the page alive): the Phase B delta must exclude the page.
    await req('SetInputSettings', {
      inputName: found.item.sourceName,
      inputSettings: { shutdown: true },
      overlay: true,
    });
    console.log('[obs] ' + found.item.sourceName + ' → shutdown when not visible');
    return;
  }
  if (action !== 'on' && action !== 'off') throw new Error('unknown action: ' + action + ' (use info|on|off|shutdown-on-hide)');
  if (action === 'on' && found.item.sceneItemEnabled) { console.log('[obs] already visible'); return; }
  if (action === 'off' && !found.item.sceneItemEnabled) { console.log('[obs] already hidden'); return; }
  await req('SetSceneItemEnabled', {
    sceneName: found.scene,
    sceneItemId: found.item.sceneItemId,
    sceneItemEnabled: action === 'on',
  });
  console.log('[obs] ' + found.item.sourceName + ' → ' + (action === 'on' ? 'visible' : 'hidden'));
}
