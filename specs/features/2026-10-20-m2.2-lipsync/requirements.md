# M2.2 — TTS-Driven Lip Sync — Requirements

> Confirmed by the owner (2026-10-20, grouped ask round: requirements / plan /
> validation; answers 1a / 2a / 3a). Status: planning complete — implementation
> intentionally paused for the owner's V4.1-Flash session-model swap.

## Scope
- The brain speaks explicitly specified words: TTS synthesis in the driver
  (edge-tts primary, macOS "say" fallback), the new say WS command, browser
  playback via Web Audio (OBS hears it), and mouth animation from the word
  timeline (word-level envelope + amplitude fallback). The mock talk envelope
  stays as the no-audio fallback. The loopback-RMS draft is RETIRED
  (replan 2026-10-20, commit c579c43).
- Driver (whale-girl-server/control_whale.py): synthesize phrases to
  whale-girl-server/audio/say-<id>.mp3 with edge-tts and collect WordBoundary
  word timestamps; send
  {"type":"say","audio":"/audio/say-<id>.mp3","words":[[t0,t1,"word"],...]}
  over the existing python WS; automatic macOS say fallback (.m4a, words
  empty) when edge-tts fails; prune audio files older than 1 h.
- Server (whale-girl-server/server.js): static mount /audio →
  whale-girl-server/audio (gitignored). No protocol/parsing changes — say
  frames pass through the raw-text proxy like motion frames.
- Frontend (whale-girl-frontend/index.html): say handling (latest wins),
  lazy AudioContext + gesture resume + tiny auto-hiding pill, fetch →
  decodeAudioData → AudioBufferSourceNode playback, word envelope applied on
  the motion-frame cadence (attack ~20 ms / release ~120 ms, clamp 0..1),
  amplitude-envelope fallback when words is empty, priority rule (say wins
  over the motion-frame ParamMouthOpenY; mock otherwise), ?debug=1 readout,
  window.whaleSpeech console hooks, zero per-frame allocations.
- Probe: whale-girl-server/scripts/say_probe.js (zero new deps — reuses the
  pinned ws; Chrome CDP; two passes: edge-tts and forced say fallback).
- Stop after the spec trio + branch — the owner switches the session AI model
  to V4.1-Flash before code implementation.

## Decisions (ask round 2026-10-20, owner 1a)
- Voice: default zh-CN-XiaoyiNeural (env override WHALE_VOICE) — matches
  the 鲸鱼娘 model; M3.1 picks any voice later. (Owner switch 2026-10-21:
  Xiaoxiao → Xiaoyi.)
- Words today: the mock driver picks a random phrase from a small built-in
  Chinese list (~5 short lines) at each talk burst; DSH supplies real text in
  M3.1. WHALE_SAY_TEXT env = one-shot synthesis of that exact text at startup
  (probe + manual trigger). WHALE_ENGINE=say forces the fallback engine
  (probe pass 2).
- Say-while-saying: latest wins — a new say stops the current playback and
  replaces it (no queue, no drop).
- Audio lifecycle: whale-girl-server/audio/ gitignored; the driver prunes
  files older than 1 h on each synthesis (asyncio.to_thread, no new deps).
- Exactly one new pip dep: edge-tts (pinned; the Python 3.9-compatible
  version verified live). No new frontend/npm deps.
- Envelope constants: target 1 inside a word [t0,t1], 0 in gaps; amplitude
  fallback = RMS per ~50 ms window precomputed at decode, linear-normalized
  with a noise floor; smoothing attack ~20 ms / release ~120 ms; audio→mouth
  latency budget < 100 ms.
- Engine shown in ?debug=1 by file extension (.mp3 = edge-tts, .m4a = say) —
  no protocol change.

## Context
- Replan 2026-10-20 (owner 1a/2/3a/4a, commit c579c43): M2.2 is TTS-DRIVEN —
  the words are explicitly specified; the loopback-device capture approach is
  retired. All handoffs (M1, M2.1) were updated to TTS wording by the replan
  commit.
- M1 handoff: M2.2 owns replacing the mock talk envelope with TTS-driven
  mouth values (the mock envelope stays as the no-audio fallback). M2.1
  handoff: edge-tts primary / macOS say fallback → ParamMouthOpenY; the
  model's LipSync group already exists.
- Hard constraints (tech-stack.md): no new deps outside the one pip pin; server
  ≤ 60 MB / driver ≤ 30 MB RSS; no per-frame allocations or logging; the wire
  protocol is frozen except the already-specced say command.
- edge-tts needs network at synthesis time; offline → automatic say fallback;
  both engines failing → no say frame → mock envelope (unchanged behavior).

## Validation criteria (from the ask round, owner 3a)
- Automatic: say_probe PASS — say frame observed; audio URL 200 + audio/*
  content type and decodeAudioData succeeds; mouth ≥ 0.4 during ≥ 80% of
  in-word frames (window [t0+100 ms, t1]) and ≤ 0.15 in gaps ≥ 150 ms;
  word-onset → mouth-0.5-crossing latency < 100 ms (mean AND max); decoded
  PCM < 10 MB per utterance; fallback pass (WHALE_ENGINE=say: .m4a 200, words
  empty, amplitude-driven mouth ≥ 0.3 mid-utterance and ≤ 0.1 trailing
  silence); node --check; ws_probe 20–40 fps; role probe close 1008; RSS
  server ≤ 60 MB / driver ≤ 30 MB; ports released after shutdown.
- Manual (owner, at the close): OBS hears the whale speak canned Chinese
  phrases with the mouth matching the words; ?debug=1 shows the current word,
  mouth value and engine (edge-tts/say); forced edge-tts failure → say
  fallback still speaks; no say active → the old mock talk envelope still
  animates the mouth; pill path if OBS suspends audio.
