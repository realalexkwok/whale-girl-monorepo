# M2.1 — Real Live2D Model Integration — Requirements

> Confirmed by the owner (2026-10-20, grouped ask round: requirements / plan /
> validation). Status: planning complete — implementation intentionally paused
> for the owner's V4.1-Flash session-model swap.

## Scope
- Drop in the real **DS鲸鱼娘 (DeepSeek whale girl)** Cubism model at
  whale-girl-frontend/model/whale.model3.json + siblings (moc3, textures,
  physics3, cdi3, motions/, expressions/). Source: the dsh-pet-live2d@3.1.3
  npm package (pets/ds-whale-girl/, also on GitHub A8Chann/dsh-pet-live2d).
  The M1 placeholder whale becomes the failure path.
- Asset validation: new zero-dependency Node script
  whale-girl-server/scripts/validate_model.js — settings file exists + parses,
  Version ≤ 4, every FileReferences path resolves to a real file, moc3 header
  version ≤ 4, total asset size; actionable per-file error list; exit 0/1.
- Frontend load hardening (index.html): staged, actionable errors (404 / not
  found, invalid JSON, loader error e.g. Cubism 5 moc3 or a missing sibling)
  all through the once-only fatal() — exactly ONE console error, and the
  ?debug=1 status line shows the same message.
- Motion/expression playback hooks, frontend API only (window.whaleModel):
  playMotion / playExpression / stopMotion / resetExpression / listMotions /
  listExpressions. No wire-protocol change.
- Stop after the spec trio + branch decision — the owner switches the session
  AI model to V4.1-Flash before code implementation.

## Decisions
- Asset = DS鲸鱼娘, license CC BY-NC-SA 4.0 — personal, non-commercial use;
  attribution chain 上善无形 (OC「溟月」) → ZipZipPipe (DeepSeek maid redesign) →
  氵六青 (Live2D rigging); the bundled LICENSE is kept in the model folder.
- Compatibility verified live (2026-10-20): c_0120.model3.json "Version": 3;
  c_0120.moc3 header MOC3 + version byte 4 — both load in the Cubism 4 runtime
  bundled in pixi-live2d-display 0.4.0 (supports Cubism 2.1/3/4, NOT 5).
  LipSync→ParamMouthOpenY and EyeBlink→ParamEyeLOpen/ROpen groups match the M1
  driver parameters.
- The asset is standalone: the DSH-plugin extras (pet.json, catalog.json,
  voice.json, previews/, 安装说明.md) are host metadata, never consumed by our
  frontend; only the FileReferences files matter.
- Playback hooks = frontend API only; the wire-protocol extension is replanned
  to M3.1.
- Hook semantics (2026-10-20, after live console testing): pixi-live2d-display
  0.4.0 rejects a new motion while one is playing at the same priority (returns
  false, never queues) — playMotion therefore starts motions with FORCE priority,
  and restarts a motion that is already the current one (stop-then-start).
  stopMotion stops the active motion; the idle motion resumes automatically by
  design. A resetPose() hook restores every parameter to its default value and
  clears leftover motion poses.
- Validation tooling = zero-dep Node script — no new npm packages.
- Loader efficiency and diagnostics (2026-10-20, reviewer polish): the parsed
  settings JSON is handed to Live2DModel.from with an explicit url field, so
  whale.model3.json is fetched exactly once per page load and FileReferences
  still resolve relative to model/. When the loader fails, the page HEAD-checks
  every FileReference and names the missing file(s) instead of surfacing a bare
  "Network error".

## Context
- Development on macOS; the model folder stays gitignored (only README.md
  tracked) because the asset is large and licensed.
- Hard constraints (tech-stack.md): no new dependencies, server ≤ 60 MB /
  driver ≤ 30 MB RSS, no per-frame allocations or logging, the pinned CDN
  chain untouched.
- The M1 handoff (specs/features/2026-10-19-m1-pipeline-foundation/validation.md)
  assigns M2.1: the drop-in asset path, Cubism 4.x export validation with
  actionable errors, motion/expression playback hooks.

## Validation criteria (from the ask round)
- Automatic: node --check on the extracted inline script; validate_model.js
  PASS with the asset + actionable exit-1 list without it; curl
  http://localhost:3000/model/whale.model3.json → 200 present / 404 absent;
  ws_probe.js PASS unchanged; ws_role_probe.js close 1008; RSS within budgets.
- Manual (owner, at the close): browser ?debug=1 with the real model (whale
  girl visible, blinks/talks/gazes at ~30 fps, status shows model +
  motion/expression counts); playback hooks via console (one motion e.g.
  Hammer, one expression e.g. 爱心眼; stop/reset works); model removed →
  placeholder + exactly ONE console error; OBS Browser source verified both
  ways.
