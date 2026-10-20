#!/usr/bin/env python3
"""One-shot edge-tts synthesis helper (M2.2).

Runs in a short-lived child process so the long-running driver keeps its RSS
well under the 30 MB budget (importing edge-tts + aiohttp costs ~8-12 MB).

Usage: tts_synth.py <out_file> <voice>
The text is read from stdin (no argument quoting issues).

Prints exactly one JSON line to stdout:
  {"ok": true, "words": [[t0, t1, "word"], ...]}
  {"ok": false, "error": "..."}
"""

import asyncio
import json
import sys


async def synthesize(out_path, voice):
    import edge_tts

    text = sys.stdin.read()
    comm = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    audio = bytearray()
    words = []
    async for chunk in comm.stream():
        kind = chunk["type"]
        if kind == "audio":
            audio.extend(chunk["data"])
        elif kind == "WordBoundary":
            t0 = chunk["offset"] / 10_000_000
            t1 = (chunk["offset"] + chunk["duration"]) / 10_000_000
            words.append([round(t0, 3), round(t1, 3), chunk["text"]])
    if not audio:
        raise RuntimeError("edge-tts returned no audio")
    with open(out_path, "wb") as fh:
        fh.write(audio)
    return words


def fail(message):
    json.dump({"ok": False, "error": message}, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        fail("usage: tts_synth.py <out_file> <voice>")
        sys.exit(2)
    try:
        words = asyncio.run(synthesize(sys.argv[1], sys.argv[2]))
    except Exception as exc:  # the driver falls back to macOS say on failure
        fail(str(exc) or type(exc).__name__)
        sys.exit(1)
    json.dump({"ok": True, "words": words}, sys.stdout)
    sys.stdout.write("\n")
