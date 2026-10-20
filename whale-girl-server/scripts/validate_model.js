#!/usr/bin/env node
// Asset check for the Whale Girl Live2D model — zero dependencies.
// Usage: node scripts/validate_model.js [modelDir]
// Default modelDir: <repo>/whale-girl-frontend/model (resolved from this script).
// Exit 0 = PASS (asset ready for the Cubism 4 runtime), 1 = FAIL with a
// per-file, actionable list.
'use strict';

const fs = require('fs');
const path = require('path');

const PASSES = [];
const PROBLEMS = [];

function pass(msg) { PASSES.push(msg); }
function fail(msg) { PROBLEMS.push(msg); }

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (err) { return false; }
}

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch (err) { return 0; }
}

function printResults() {
  for (const p of PASSES) console.log('[PASS] ' + p);
  for (const p of PROBLEMS) console.log('[FAIL] ' + p);
}

function finish(totalBytes) {
  console.log('');
  if (totalBytes > 0) {
    console.log('[INFO] total referenced size: ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB');
  }
  printResults();
  console.log('');
  if (PROBLEMS.length) {
    console.log('FAIL: ' + PROBLEMS.length + ' problem(s). Fix the paths above or re-export the model for Cubism 4.x.');
    process.exitCode = 1;
  } else {
    console.log('PASS: asset is ready for the Cubism 4 runtime.');
  }
}

function main() {
  const arg = process.argv[2];
  const modelDir = path.resolve(arg || path.join(__dirname, '..', '..', 'whale-girl-frontend', 'model'));
  const settingsName = 'whale.model3.json';
  const settingsPath = path.join(modelDir, settingsName);

  console.log('validate_model.js — Whale Girl asset check');
  console.log('Model dir: ' + modelDir);

  if (!isFile(settingsPath)) {
    fail('missing ' + settingsName + ' — drop the Cubism 4.x export into ' + modelDir +
      ' (see whale-girl-frontend/model/README.md).');
    finish(0);
    return;
  }

  let json;
  try {
    json = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    fail(settingsName + ' is not valid JSON: ' + err.message);
    finish(0);
    return;
  }

  const version = json.Version;
  if (typeof version !== 'number') {
    fail(settingsName + ' has no numeric "Version" field (expected 3 or 4).');
  } else if (version > 4) {
    fail(settingsName + ' declares Version ' + version + ' — the Cubism 4 runtime in ' +
      'pixi-live2d-display 0.4.0 cannot load it. Re-export the asset for Cubism 4.x.');
  } else {
    pass(settingsName + ' parses (Version ' + version + ')');
  }

  const refs = json.FileReferences || {};
  const refsToCheck = [];
  function addRef(relPath, why) {
    if (typeof relPath !== 'string' || !relPath) {
      fail(why + ': empty or missing file reference.');
      return;
    }
    refsToCheck.push({ relPath: relPath, why: why });
  }

  addRef(refs.Moc, 'FileReferences.Moc');

  if (Array.isArray(refs.Textures) && refs.Textures.length) {
    for (let i = 0; i < refs.Textures.length; i++) {
      addRef(refs.Textures[i], 'FileReferences.Textures[' + i + ']');
    }
  } else {
    fail('FileReferences.Textures is missing or empty (at least one texture is required).');
  }

  if (refs.Physics) addRef(refs.Physics, 'FileReferences.Physics');
  if (refs.DisplayInfo) addRef(refs.DisplayInfo, 'FileReferences.DisplayInfo');

  let motionCount = 0;
  if (refs.Motions && typeof refs.Motions === 'object' && !Array.isArray(refs.Motions)) {
    for (const group of Object.keys(refs.Motions)) {
      const list = refs.Motions[group];
      if (!Array.isArray(list)) {
        fail('FileReferences.Motions.' + group + ' is not an array.');
        continue;
      }
      for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        if (!entry || typeof entry.File !== 'string') {
          fail('FileReferences.Motions.' + group + '[' + i + '].File is missing.');
          continue;
        }
        addRef(entry.File, 'FileReferences.Motions.' + group + '[' + i + ']');
        motionCount++;
      }
    }
    if (motionCount === 0) {
      fail('FileReferences.Motions is empty (the playback hooks need at least one motion group).');
    }
  } else {
    fail('FileReferences.Motions is missing (the playback hooks need at least one motion group).');
  }

  let expressionCount = 0;
  if (refs.Expressions !== undefined) {
    if (!Array.isArray(refs.Expressions)) {
      fail('FileReferences.Expressions is not an array.');
    } else {
      for (let i = 0; i < refs.Expressions.length; i++) {
        const entry = refs.Expressions[i];
        if (!entry || typeof entry.File !== 'string') {
          fail('FileReferences.Expressions[' + i + '].File is missing.');
          continue;
        }
        addRef(entry.File, 'FileReferences.Expressions[' + i + '] (' + (entry.Name || 'unnamed') + ')');
        expressionCount++;
      }
    }
  }

  let totalBytes = sizeOf(settingsPath);
  let moc3Checked = false;
  const seen = new Set([settingsPath]);

  for (const ref of refsToCheck) {
    const resolved = path.resolve(modelDir, ref.relPath);
    const inside = resolved === modelDir || resolved.startsWith(modelDir + path.sep);
    if (!inside) {
      fail(ref.why + ': path escapes the model folder (' + ref.relPath + ').');
      continue;
    }
    if (!isFile(resolved)) {
      fail(ref.why + ': missing file ' + ref.relPath + ' (resolved to ' + resolved + ').');
      continue;
    }
    if (!seen.has(resolved)) {
      seen.add(resolved);
      totalBytes += sizeOf(resolved);
    }
    if (!moc3Checked && ref.why === 'FileReferences.Moc') {
      moc3Checked = true;
      let buf;
      try {
        buf = fs.readFileSync(resolved);
      } catch (err) {
        fail('FileReferences.Moc: unreadable (' + err.message + ').');
        continue;
      }
      if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'MOC3') {
        fail('FileReferences.Moc: ' + ref.relPath + ' has no MOC3 magic — not a valid moc3 file.');
      } else {
        const mocVersion = buf[4];
        if (mocVersion > 4) {
          fail('FileReferences.Moc: moc3 version ' + mocVersion + ' in ' + ref.relPath +
            ' — Cubism 5 models are not supported; re-export for Cubism 4.x.');
        } else {
          pass('moc3 header MOC3 v' + mocVersion + ' (' + ref.relPath + ', ' +
            (buf.length / 1024 / 1024).toFixed(2) + ' MB)');
        }
      }
    }
  }

  if (motionCount > 0) pass(motionCount + ' motion file reference(s) present');
  if (expressionCount > 0) pass(expressionCount + ' expression reference(s) present');

  finish(totalBytes);
}

main();
