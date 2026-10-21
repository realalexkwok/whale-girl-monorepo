# M2.2 — TTS-Driven Lip Sync — Plan

> Confirmed by the owner (2026-10-20) before implementation; the approved
> plan-mode plan is the source of truth for this file. Status: planning
> complete — implementation paused for the V4.1-Flash swap.

## Task groups
0. Spec trio + branch: this folder; branch feature/whale-girl-m22-lipsync
   from main (c579c43) — created on owner confirmation (agents never git
   commit / push).
1. Group B — driver TTS (whale-girl-server/control_whale.py +
   requirements.txt): lazy edge-tts import (pinned; version + Python 3.9
   support verified live); WHALE_SAY_TEXT one-shot, WHALE_VOICE,
   WHALE_ENGINE=say; one synthesis per mock talk burst (canned Chinese
   phrase list ~5 lines); WordBoundary → words list (100-ns ticks → seconds);
   say fallback (.m4a, words empty); prune > 1 h on each synthesis; send the
   say frame over the existing python WS (compact JSON separators).
   Check: driver runs clean on websockets 15.0.1 / Python 3.9, RSS ≤ 30 MB
   with edge-tts loaded.
2. Group C — server (whale-girl-server/server.js + root .gitignore):
   app.use('/audio', express.static(<server>/audio, {maxAge: 0, etag: true}))
   — same pattern as the frontend dir; no parsing changes.
   Check: curl /audio/<file> → 200 + audio/*; ws_probe / ws_role_probe
   unchanged.
3. Group D — frontend (whale-girl-frontend/index.html): say branch in
   ws.onmessage (latest wins: stop + replace the AudioBufferSourceNode); lazy
   AudioContext + resume on first pointerdown/keydown + tiny auto-hiding pill
   shown only while suspended/blocked; fetch → decodeAudioData → playback;
   amplitude envelope precomputed at decode when words empty (one
   Float32Array, reused); per motion frame: say active → skip the frame's
   ParamMouthOpenY and apply clamp(v, 0, 1) from the word envelope (target 1
   in-word / 0 in-gap, one-pole attack 20 ms / release 120 ms, dt from
   audioContext.currentTime); after playback end → ease to 0, clear active,
   mock resumes; ?debug=1 "say: <word> | mouth <v> | <engine>"; window.whaleSpeech
   = { state(), probeStats() } with a preallocated sample ring; zero per-frame
   allocations in the hot path.
   Check: node --check on the extracted inline script.
4. Group E — probe + docs: whale-girl-server/scripts/say_probe.js (Node,
   reuses the pinned ws dep): free ports → start server + driver with
   WHALE_SAY_TEXT=<known sentence> → probe connects as role=web and captures
   the say frame → Chrome CDP (Chrome 155, --autoplay-policy=no-user-gesture-required)
   at http://localhost:3000/?debug=1 → asserts: audio 200 + audio/* content
   type; decodeAudioData OK; whaleSpeech.state() active, bufferBytes < 10 MB;
   probeStats() → in-word mouth ≥ 0.4 in ≥ 80% of samples within [t0+100 ms,
   t1], ≤ 0.15 in gaps ≥ 150 ms; word-onset → mouth-0.5-crossing latency
   < 100 ms (mean + max reported); RSS server ≤ 60 MB / driver ≤ 30 MB; clean
   shutdown, ports released. Pass 2 with WHALE_ENGINE=say → .m4a 200, words
   empty, amplitude-driven mouth (≥ 0.3 mid-utterance, ≤ 0.1 trailing
   silence). Docs: specs/dev-environment.md TTS section (audio dir, env
   knobs, fallback semantics, OBS audio note, pill).
5. Group F — verification & close (owner-instructed only): full automatic
   half; first-time-user manual pass (validation.md); roadmap tick + history
   archive + SESSION-CONTEXT update; merge into main → push → delete local
   branch.

## Research findings (verify live during implementation — never assume)
- edge-tts Communicate stream exposes WordBoundary events (offset/duration in
  100-ns ticks) → convert to seconds for the words list; exact pip version
  pinned by requirements.txt and verified with .venv/bin/pip show + a real
  synthesis on Python 3.9.
- macOS say AAC output: "say -o file.m4a --file-format m4af --data-format
  aac" — flags verified live; afconvert is the backup if unsupported.
  Chrome decodeAudioData handles mp3 and m4a/aac.
- Headless Chrome Web Audio: currentTime advances without audio hardware; if
  it stalls, the probe falls back to a visible Chrome window (recorded in
  validation.md if used).

## Files
- whale-girl-server/control_whale.py, requirements.txt (Group B)
- whale-girl-server/server.js, root .gitignore (Group C)
- whale-girl-frontend/index.html (Group D)
- whale-girl-server/scripts/say_probe.js (Group E)
- specs/dev-environment.md (Group E)
- specs/features/2026-10-20-m2.2-lipsync/
  {requirements,plan,validation}.md (this trio)
- NOT touched: package.json, the wire protocol (the say command is already
  specced in tech-stack.md), the model assets, ws_probe.js / ws_role_probe.js.

## Memory & quality gates
- Exactly one new pip dep (edge-tts); no new frontend/npm deps; budgets
  server ≤ 60 MB / driver ≤ 30 MB RSS; decoded PCM < 10 MB per utterance;
  no per-frame allocations in the mouth handler or the driver loop; no
  per-frame logging; node --check on the inline script; CDN pins untouched.

## Implementation notes (2026-10-21)
- Default edge-tts voice switched to zh-CN-XiaoyiNeural on owner instruction
  (was zh-CN-XiaoxiaoNeural); WHALE_VOICE still overrides it.
- Group B refinement: edge-tts runs in a short-lived child process
  (scripts/tts_synth.py) instead of an in-process import. Reason: the owner's
  manual run measured the driver at 32,160 KB RSS with edge-tts + aiohttp
  loaded — over the 30 MB budget. The parent driver stays at ~16-21 MB and the
  child exits after each utterance.
- The say probe samples RSS after playback completes, so it catches
  steady-state memory from the TTS path.
- Review round (2026-10-21): the edge-tts child is wrapped in a 45 s timeout
  (kill + macOS say fallback on hang); the frontend keeps a say generation
  counter so the newest say wins even when an older decode resolves later;
  ws_probe ignores say frames to keep its output clean.
