# Feature 3 — Voice commands (whale girl listens)

## Requirements (product view)
3.1 有什么会话还在跑？ — list ongoing sessions (spoken reply).
3.2 有什么会话未处理？ — DSH-ONLY: sessions untouched after their last
    round finished; sorted by last-finished time.
3.3 停止会话%名字% — interrupt the session by name; if not found say
    没有这个会话哦; otherwise say 正在停止会话%名字%.

## Voice pipeline — MUST live in a host process
Research finding (decisive): OBS browser sources (CEF 103/127) deny
getUserMedia with NO permission prompt (obs-browser registers no permission
handler; older OBS lacks navigator.mediaDevices entirely). The Web Speech
API is additionally blocked in mainland China. -> Recognition runs in the
Python driver (or a tiny sibling process); results travel over the existing
WS to the server/frontend.

## Recognizer options (comparison from research)
| Option | zh quality | RAM/CPU | Offline | Verdict |
| --- | --- | --- | --- | --- |
| sherpa-onnx KWS (zipformer zh-en 3M) | good on fixed phrases | ~60-120MB RSS est., streaming | yes | PRIMARY — open-vocabulary KWS: no training, just list the phrases (incl. 停止会话一…十 digit enumeration) |
| VOSK small-cn-0.22 + grammar | good, WER ~17-23% | official ~300MB runtime | yes | FALLBACK — must ps-verify RAM before adoption |
| macOS SFSpeechRecognizer (pyobjc) | good (network); on-device varies by Mac | ~0MB in-process | conditional | ZERO-DEP SPIKE worth half a day: no grammar -> fuzzy matching needed |
| Web Speech API | good but Google-blocked in CN | 0 | no | REJECTED (blocked + OBS mic) |
| whisper.cpp tiny/base | poor zh at tiny/base | 273-388MB | yes | REJECTED (budget) |
| Porcupine KWS | good | few MB | yes | REJECTED for v0: needs online phrase training; cannot extract the X slot |

Recommended MVP: sherpa-onnx KWS in the driver venv
  1. .venv/bin/pip install sherpa-onnx sounddevice   (owner approval -> tech-stack)
  2. Model: sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2 (32.9MB)
  3. Keywords file: 有什么会话还在跑 / 有什么会话未处理 / 停止会话一 … 停止会话十
  4. 16kHz mic stream -> KeywordSpotter -> hit -> WS event to server
  5. Verify: ps RSS delta (target < 150MB total voice path); real-speech hit
     rate; macOS TCC mic permission for the terminal running the driver.

## Command router -> data (DSH reference)
- 还在跑: registry "running" set. DSH: session.list summaries have a
  first-class running flag (api/session-controller list.ts:112-125) or SDK
  session.status notifications. Spoken reply: 正在跑的有：%名1%、%名2% /
  现在没有会话在跑哦.
- 未处理 (DSH-only): derived — lastPromptAt < last turn/end time (no
  first-class unread flag; evidence: sessionListMetadata.lastPromptAt,
  summary.updatedAt = max(createdAt, lastPromptAt)). Sorted by
  last-finished desc. Spoken: %名字%，上次完成于 %时间% / 没有未处理的会话哦.
- 停止会话X: DSH session.cancel (web API :3080, auth = cookie token +
  Host/Origin trust — daemon auth must be prototyped; alternative ACP
  cancel; SDK has NO cancel). Claude Code: claude stop <id> (map name->id
  via registry). Not found -> 没有这个会话哦; found -> 正在停止会话%名字%
  then cancel.

## Cross-agent note
- "Running" is reliably observable only for DSH (first-class flag) in v0;
  for Claude Code/Codex the registry can approximate from hook events
  (SessionStart=started, Stop=finished, StopFailure/Interrupt=aborted).
- "Untouched" (3.2) is DSH-only by requirement; other agents lack the
  notion entirely (no equivalent unread semantics).

## Risks (from research)
- OBS mic blocked (solved: host process); TCC mic permission; similar-phrase
  confusion between the two 有什么会话… commands (test; add VAD + threshold,
  prefix wake-word if needed); VOSK RAM ceiling; sherpa-onnx brings
  onnxruntime (~tens of MB) — measure; OBS + ASR capturing the same mic in
  CoreAudio usually works, verify.

## Acceptance sketch
1. All three phrases recognized in a quiet room (>= 90% hit rate).
2. 停止会话 with an unknown name speaks 没有这个会话哦 (no crash).
3. 未处理 list is correct and sorted by last-finished time (DSH fixture).
4. Voice path RSS measured and within budget.

## Decisions & TBD
- DECIDED (owner 2026-10-21): sherpa-onnx KWS is the MVP; slot = digits
  一…十; registry lives in whale-girl-server.
- TBD at N3 planning: always-on vs push-to-talk; VOSK/SFSpeechRecognizer
  spikes; cooldown between spoken replies.
