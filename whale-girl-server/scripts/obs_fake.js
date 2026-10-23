#!/usr/bin/env node
// scripts/obs_fake.js — test double for the obs-websocket 5.x server.
//
// Exercises scripts/obs_toggle.js without OBS (validation.md, review round 1):
//   MODE=missing   PORT=4555 node scripts/obs_fake.js   # only '摄像头' exists
//   MODE=present   PORT=4555 node scripts/obs_fake.js   # '浏览器' exists
//   MODE=authfail  PORT=4555 node scripts/obs_fake.js   # Hello with auth, close 4009
// Then: OBS_WS_PORT=4555 node scripts/obs_toggle.js off --source 浏览器
// Expected: exit 3 / 0 toggles (missing), exit 0 / 1 toggle (present), exit 2 (auth).
'use strict';

const { WebSocketServer } = require('ws');
const MODE = process.env.MODE || 'present';
const PORT = Number(process.env.PORT || 4555);
const wss = new WebSocketServer({ port: PORT });
let toggles = 0;
wss.on('connection', (ws) => {
  if (MODE === 'authfail') {
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.7.4', rpcVersion: 1,
      authentication: { challenge: 'abc', salt: 'def' } } }));
    setTimeout(() => ws.close(4009, 'Authentication failed'), 150);
    return;
  }
  ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.7.4', rpcVersion: 1 } }));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.op === 1) { ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })); return; }
    if (m.op !== 6) return;
    const t = m.d.requestType;
    let data = {};
    if (t === 'GetVersion') data = { obsVersion: '32.2.2', obsWebSocketVersion: '5.7.4' };
    else if (t === 'GetSceneList') data = { scenes: [{ sceneName: '场景' }], currentProgramSceneName: '场景' };
    else if (t === 'GetSceneItemList') data = { sceneItems: MODE === 'missing'
      ? [{ sceneItemId: 7, sourceName: '摄像头', sceneItemEnabled: true }]
      : [{ sceneItemId: 9, sourceName: '浏览器', sceneItemEnabled: true }] };
    else if (t === 'SetSceneItemEnabled') { toggles++; console.log('TOGGLE ' + JSON.stringify(m.d.requestData)); data = {}; }
    else if (t === 'SetInputSettings') data = {};
    ws.send(JSON.stringify({ op: 7, d: { requestType: t, requestId: m.d.requestId,
      requestStatus: { result: true, code: 100 }, responseData: data } }));
  });
});
setTimeout(() => { console.log('TOGGLES ' + toggles); process.exit(0); }, 9000);
