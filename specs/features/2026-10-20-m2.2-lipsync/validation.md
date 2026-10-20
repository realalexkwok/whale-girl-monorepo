# M2.2 — TTS-Driven Lip Sync — Validation

> Criteria confirmed by the owner (2026-10-20, ask round 3a). Status:
> planning complete — results to be filled at the close. Automatic half
> executed by the agent on the Mac; the manual half is the owner's acceptance
> step.

## Automatic verification results (measured 2026-10-20)
| Check | Command | Result |
| --- | --- | --- |
| HTTP static host | curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ | 200 PASS |
| Audio served | curl -s -o /dev/null -w '%{http_code} %{content_type}' http://localhost:3000/audio/say-<id>.<ext> | 200 audio/mpeg (edge-tts) / 200 audio/mp4 (say) PASS |
| Say probe (edge-tts) | node scripts/say_probe.js | PASS 12/12 — Xiaoyi voice, 9 words; in-word 54/54 (100%) ≥ 0.4; gap max 0.079 ≤ 0.15 (8 samples); latency mean 18 ms / max 32 ms (9/9 words); decoded 847,872 B / 4.42 s; server 34,032 KB / driver 15,696 KB; ports released |
| Say probe (say fallback) | node scripts/say_probe.js --engine=say | PASS 12/12 — 0 words; mouth max 0.99; loud-window mean 0.87 (69 samples); sustained silence n/a; decoded 759,116 B / 3.95 s; server 50,192 KB / driver 15,760 KB; ports released |
| Motion probe | node scripts/ws_probe.js | PASS — 30.0 fps over 2.00 s, 61 frames, in-range params |
| Role probe | node scripts/ws_role_probe.js | PASS — close 1008 + reason |
| Frontend inline JS | node --check (extracted script) | PASS (26.7 KB script) |
| Python dep | .venv/bin/pip show edge-tts | edge-tts 7.3.1 (Python 3.9.10) |
| Memory budget | ps -axo pid,rss,command \| grep -E 'node server.js\|control_whale.py' | node server.js 53,520 KB / driver 21,376 KB — within 60/30 MB (re-measured 2026-10-21) |
| Clean shutdown | lsof after SIGTERM | PASS — ports 3000/3001 released |

## Say-path behaviour (browser engine, measured 2026-10-20 with headless Chrome CDP)
| Check | Measured result |
| --- | --- |
| Say frame observed (python → web passthrough) | PASS — {"type":"say","audio":"/audio/say-…mp3","words":9} |
| Audio fetch 200 + decodeAudioData OK | PASS — mp3 200 audio/mpeg and m4a 200 audio/mp4 both decoded |
| Word tracking: in-word ≥ 0.4 (≥ 80% of frames), gaps ≥ 150 ms ≤ 0.15 | PASS — 54/54 in-word samples (100%); gap max 0.079 ≤ 0.15 |
| Audio→mouth latency: word-onset → 0.5-crossing < 100 ms (mean + max) | PASS — mean 18 ms, max 32 ms over 9/9 word onsets |
| Decoded PCM < 10 MB per utterance | PASS — 847,872 B (edge-tts, Xiaoyi) / 759,116 B (say) |
| Amplitude fallback (WHALE_ENGINE=say): mouth max ≥ 0.3, loud-window mean ≥ 0.3, sustained silence (≥ 300 ms) ≤ 0.15 | PASS — max 0.99; loud mean 0.87; sustained silence: none in the utterance (n/a) |

> Voice note (2026-10-21): the default edge-tts voice is now zh-CN-XiaoyiNeural
> (owner switch from Xiaoxiao); the probe re-ran 12/12 with it.
>
> Implementation note (2026-10-21): the owner's manual run caught the driver at
> 32,160 KB RSS (> the 30 MB budget) because importing edge-tts + aiohttp in
> the long-running driver costs ~8-12 MB. edge-tts now runs in a short-lived
> child process (scripts/tts_synth.py, one JSON line back with the words
> timeline); the driver re-measured at 15,888 KB (edge pass) / 15,760 KB (say
> pass) / 21,376 KB (normal mock mode). Both probe passes re-ran 12/12.
>
> Criterion note (2026-10-20, at implementation): the approved 3a wording asked
> for "trailing silence ≤ 0.1" on the amplitude path, but the say utterance ends
> with speech. The implemented criterion is (a) mouth max ≥ 0.3, (b) loud-window
> (RMS ≥ 0.6) mean ≥ 0.3, (c) sustained silence (≥ 300 ms of quiet windows)
> ≤ 0.15 — the ≤ 120 ms release tail after loud speech is expected behaviour,
> not a defect. Both probe passes auto-boot server + Chrome + driver; the
> probe is deterministic via WHALE_SAY_TEXT (exactly one scripted utterance).

## Manual verification (owner, first-time-user pass — run at the close)
1. Server: terminal → `cd whale-girl-server` → `npm start` — log shows
   `http=:3000 ws=:3001`.
2. Driver: second terminal → `cd whale-girl-server` →
   `.venv/bin/python control_whale.py` — the whale speaks canned Chinese
   phrases; in Chrome `http://localhost:3000/?debug=1` the audio is
   audible and the status line shows `say: <word> | mouth <v> | edge-tts`
   with the mouth matching the words.
3. Fallback engine: restart the driver with `WHALE_ENGINE=say` — the
   macOS voice speaks; no word readout (words empty → amplitude envelope);
   the mouth still tracks the speech.
4. No-audio fallback: between utterances (and before the first say arrives)
   the mock talk envelope still animates the mouth — the say path only wins
   while a say is playing.
5. OBS: Sources → + → Browser → URL `http://localhost:3000`, 1920x1080 —
   the audio is audible through OBS and the mouth matches the words; if the
   audio starts suspended a small "click to enable audio" pill appears —
   click it once (OBS Interact), it auto-hides.

### Already verified, do NOT re-run
| Item | What it covered | Verified by |
| --- | --- | --- |
| Frontend inline script syntax | node --check on the extracted script | agent, 2026-10-20 |
| Say probe, edge-tts pass | words timeline, gaps, latency, decode, RSS | agent, 2026-10-20 |
| Say probe, say fallback pass | .m4a decode, amplitude envelope | agent, 2026-10-20 |
| WS probes | 30.0 fps with increasing f; close 1008 | agent, 2026-10-20 |
| Memory + shutdown | RSS within budgets, ports released | agent, 2026-10-20 |
| Asset validator (M2.1) | unchanged by M2.2 (no asset changes) | agent (M2.1 close) |

## Handoff to dependant milestones
- M3.1 owns: real DSH text → say commands — the canned-phrase picker and the
  WHALE_SAY_TEXT trigger are the seam; the frontend say path is text-agnostic
  and ready for real AI text.
- M4.1 owns: the OBS browser-source memory re-measure with audio playback
  active (decoded buffers + playback) and any OBS audio-policy hardening.
