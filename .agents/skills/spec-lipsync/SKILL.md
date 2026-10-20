---
name: spec-lipsync
description: Plan the Whale Girl M2.2 TTS-driven lip-sync item — synthesize explicitly specified words (edge-tts primary, macOS say fallback), play the speech in the browser, and animate the mouth from the word timeline. Use when planning M2.2, TTS speech, word-envelope mapping, audio playback, or mouth animation from text.
---

# Spec-Driven TTS Lip-Sync Planning (Whale Girl, M2.2)

This skill ACCELERATES /spec-plan for M2.2. Run /spec-plan for the trio scaffold
and workflow rules; this skill supplies the M2.2 content.
(2026-10-20 replan, owner 1a/2/3a/4a: M2.2 is TTS-DRIVEN — explicit words — the
loopback-RMS draft is retired.)

## 1. Read first
- specs/roadmap.md (M2.2), specs/tech-stack.md (TTS amendments + say command),
  specs/dev-environment.md
- M1 handoff in specs/features/2026-10-19-m1-pipeline-foundation/validation.md
- Frontend: whale-girl-frontend/index.html; brain: whale-girl-server/control_whale.py

## 2. Ask-round additions (fold into the /spec-plan questions)
- TTS ENGINE: edge-tts primary (free Microsoft neural voices, WordBoundary
  metadata; one pip dep, network at synthesis time); macOS "say" as the
  automatic fallback when edge-tts fails (no timestamps -> amplitude-only
  envelope from the generated audio file)
- TEXT FLOW: who decides the words (the mock driver today, DSH in M3.1) and the
  new WS command {"type":"say","audio":"/audio/<id>.mp3","words":[[t0,t1,"word"],...]}
- PLAYBACK: the browser fetches + plays the mp3 via Web Audio (OBS captures
  browser audio); the server serves whale-girl-server/audio/ statically
- SYNC: word boundaries -> ParamMouthOpenY envelope (open on syllables, close
  on pauses), clamp 0..1, attack ~20 ms / release ~120 ms; amplitude envelope
  of the decoded audio as fallback; silence eases back to the mock/idle path
- TIMING: audio-to-mouth offset budget < 100 ms; the existing 30 FPS frame path
  is the update cadence

## 3. Hard constraints (enforce in the plan, do not ask)
- Exactly one new pip dep (edge-tts); no new frontend deps (Web Audio built in)
- No per-frame allocations in the mouth-driving handler; reuse buffers
- Never double-drive ParamMouthOpenY (a say command wins; mock talk otherwise)
- Memory: decoded audio < 10 MB per utterance (measure, M4.1-style)

## 4. Verification design (automatic + manual)
- AUTOMATIC (browser-probe pattern, cf. Anthropic webapp-testing): a scripted
  "say" with a known sentence; the probe asserts (a) the mp3 is served and
  playable, (b) mouth params track the word timeline within tolerance,
  (c) audio-to-mouth latency and RSS measured and within budget
- MANUAL: the streamer triggers a say command -> OBS shows the whale speaking
  the words with her mouth matching; ?debug=1 shows the current word, the mouth
  value, and the engine in use (edge-tts/say)

## 5. Output
- Augmented ask round -> /spec-plan scaffold:
  specs/features/<date>-m22-lipsync/{requirements,plan,validation}.md
