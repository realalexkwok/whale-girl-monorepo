# M2.1 — Real Live2D Model Integration — Plan

> Confirmed by the owner (2026-10-20) before implementation; the approved
> plan-mode plan is the source of truth for this file. Status: planning
> complete — implementation paused for the V4.1-Flash swap.

## Task groups
0. Spec trio + branch: this folder; branch proposal
   feature/whale-girl-m2-model-integration from main, created only on owner
   confirmation (agents never git commit / push).
1. Group A — whale-girl-frontend/index.html: hardened load path (404 / JSON
   parse / loader errors → once-only fatal), window.whaleModel playback hooks,
   ?debug=1 status line showing the model name + motion/expression counts.
   Hook semantics per live testing: playMotion uses MotionPriority.FORCE and
   restarts the currently-playing motion; stopMotion stops the active motion
   (idle resumes); resetPose() restores parameter defaults. The parsed settings
   JSON is passed to Live2DModel.from with an explicit url (single fetch); on
   loader failure a HEAD-check of every FileReference names the missing files,
   while network-level HEAD failures are reported as an incomplete check.
   Preserve
   autoInteract:false, motionPreload:'NONE', the placeholder failure path, and
   the no-closures/no-spreads WS hot path.
2. Group B — whale-girl-server/scripts/validate_model.js (zero-dep) +
   whale-girl-frontend/model/README.md refresh (drop-in commands, minimum
   required file set, CC BY-NC-SA attribution block, Cubism ≤4.x constraint,
   gitignored note).
3. Group D — branch feature/whale-girl-m2-model-integration (on owner
   confirmation).
4. Verification — automatic half first, then the owner's manual half (see
   validation.md).

## Research findings baked into the plan (all verified live 2026-10-20)
- dsh-pet-live2d@3.1.3 pets/ds-whale-girl/: 65 files; c_0120.model3.json
  ("Version": 3); model/c_0120.moc3 (2,119,552 B; header MOC3 + version byte 4
  — hexdump verified); 2 textures (texture_00.png 1.7 MB, texture_01.png
  90 KB); physics3; cdi3; 8 motions (Idle / Hammer / BubbleGum / SprayWater /
  OpenCase / Selfie / SelfieQuick / Ketchup); 44 expressions.
- Groups: EyeBlink (ParamEyeLOpen/ROpen) and LipSync (ParamMouthOpenY) —
  the model is M2.2-ready.
- License: CC BY-NC-SA 4.0 (非商业); attribution 上善无形 / ZipZipPipe /
  氵六青; commercial use needs each author's separate permission.
- Drop-in: rename ONLY c_0120.model3.json → whale.model3.json; FileReferences
  are relative to the settings file's directory, so all siblings keep their
  paths (verified against the JSON).
- pixi-live2d-display 0.4.0 API notes (verify against the shipped bundle
  during implementation, never assume): model.motion(group, index?,
  priority?); model.expression(nameOrIndex);
  internalModel.motionManager.definitions / stopAllMotions();
  internalModel.expressionManager.definitions / resetExpression().

## Files
- whale-girl-frontend/index.html (Group A)
- whale-girl-server/scripts/validate_model.js (Group B)
- whale-girl-frontend/model/README.md (Group B)
- specs/features/2026-10-20-m2.1-model-integration/
  {requirements,plan,validation}.md (this trio)
- NOT touched: server.js, control_whale.py, package.json, requirements.txt,
  the wire protocol.

## Memory & quality gates
- No new dependencies anywhere; budgets server ≤ 60 MB / driver ≤ 30 MB RSS;
  no per-frame allocations or logging; node --check on the inline script;
  CDN pins untouched.
