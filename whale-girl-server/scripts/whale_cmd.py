#!/usr/bin/env python3
"""whale_cmd.py — DSH tool: send a v1 command to the Whale Girl pipeline (M3.1).

A DSH session (Web or TUI) calls this script as a native tool. It connects to
the server's WebSocket as a web client (the server tags and relays the frame to
the python driver), sends ONE command frame and exits. No new process stays
behind; the pipeline is the already-running server + driver.

Tool names a DSH/MCP wrapper should use map to the subcommands:
    whale_motion(group, index)  ->  motion <group> [index]
    whale_say(text)             ->  say <text>
    whale_pose(p)               ->  pose '<json object>'   ({} clears)
    whale_mode(mock)            ->  mode mock|live
    whale_express(tag, text)    ->  express <tag> [text...]   (M3.2)

Usage (the venv holds websockets; the system Python does not):
    .venv/bin/python scripts/whale_cmd.py motion Hammer
    .venv/bin/python scripts/whale_cmd.py motion Hammer 0
    .venv/bin/python scripts/whale_cmd.py say 你好，我是鲸鱼娘
    .venv/bin/python scripts/whale_cmd.py pose '{"ParamEyeLOpen":0,"ParamEyeROpen":0}'
    .venv/bin/python scripts/whale_cmd.py pose '{}'      # clear the overlay
    .venv/bin/python scripts/whale_cmd.py mode live       # pause mock talk
    .venv/bin/python scripts/whale_cmd.py mode mock
    .venv/bin/python scripts/whale_cmd.py express happy 今天特别开心
    .venv/bin/python scripts/whale_cmd.py express neutral

Exit codes: 0 sent (not acknowledged — the server may still drop the frame on
its python-buffer cap), 1 connection error OR reachable with no driver (4002),
2 validation error.
Env: WHALE_CMD_WS (default ws://localhost:3001?role=web),
     WHALE_MODEL_MANIFEST (default ../whale-girl-frontend/model/whale.model3.json).
"""

import argparse
import json
import math
import os
import re
import sys

# expr_tags.py lives one level up (whale-girl-server/); this CLI lives in scripts/
# so both the driver and the tool read the SAME tag table.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from expr_tags import load_tags  # noqa: E402
from websockets.exceptions import ConnectionClosed, WebSocketException
from websockets.sync.client import connect

WS_URL = os.environ.get("WHALE_CMD_WS", "ws://localhost:3001?role=web")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MANIFEST = os.path.join(
    ROOT, "..", "whale-girl-frontend", "model", "whale.model3.json"
)
MANIFEST = os.environ.get("WHALE_MODEL_MANIFEST", DEFAULT_MANIFEST)
MAX_FRAME_BYTES = 8 * 1024   # the server's soft cap for relayed frames
MAX_POSE_KEYS = 32           # keep the 30 FPS frame well under that cap
MAX_SAY_CHARS = 300          # longest say line the driver accepts
POSE_ID_RE = re.compile(r"[A-Za-z0-9_]{1,64}")  # Live2D parameter-id grammar
MAX_CMD_NAME = 128     # motion group / expression name cap (mirrors the driver)
MAX_MOTION_INDEX = 9999  # driver-side motion index cap


def motion_groups(path):
    """Read the manifest's motion groups -> [(name, count), ...] (shape-safe)."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    refs = data.get("FileReferences") if isinstance(data, dict) else None
    motions = refs.get("Motions") if isinstance(refs, dict) else None
    groups = []
    if isinstance(motions, dict):
        for name, entries in motions.items():
            if isinstance(name, str) and isinstance(entries, list):
                groups.append((name, len(entries)))
    return groups


def fail(message, code=2):
    print("whale_cmd: " + message, file=sys.stderr)
    return code


def send(payload):
    """Send one pre-serialized frame; 0 sent, 1 connection error."""
    try:
        with connect(WS_URL, open_timeout=5, close_timeout=2) as ws:
            ws.send(payload)
            try:
                # Commands are one-way: no reply is normal. A 4002 close means
                # the server has no python writer and dropped the command.
                ws.recv(timeout=0.4)
            except TimeoutError:
                return 0
            except ConnectionClosed as exc:
                if exc.code == 4002:
                    return fail(
                        "the server has no brain connected (driver not running) "
                        "— command dropped", 1
                    )
                raise
    except ConnectionClosed as exc:
        return fail(
            "the server closed the connection (%s %s) — check WHALE_CMD_WS "
            "and the ?role=web suffix" % (exc.code, exc.reason), 1
        )
    except (OSError, WebSocketException) as exc:
        return fail(
            "cannot reach the server at %s (%s). Is 'npm start' running?"
            % (WS_URL, exc),
            1,
        )
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="whale_cmd.py",
        description="Send a Whale Girl v1 command (M3.1).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    motion = sub.add_parser("motion", help="play a Live2D motion")
    motion.add_argument("group", help="motion group name (e.g. Hammer)")
    motion.add_argument("index", nargs="?", type=int, help="motion index (optional)")

    say = sub.add_parser("say", help="speak a line (TTS + lip sync)")
    say.add_argument("text", nargs="+", help="the words to speak")

    pose = sub.add_parser("pose", help="hold parameter overrides (JSON; {} clears)")
    pose.add_argument(
        "p", help='JSON object, e.g. \'{"ParamEyeLOpen":0,"ParamEyeROpen":0}\''
    )

    mode = sub.add_parser("mode", help="flip mock/live mode")
    mode.add_argument("mode", choices=("live", "mock"))

    express = sub.add_parser("express",
                             help="show the preset for an emotion tag (M3.2)")
    express.add_argument(
        "tag",
        help="emotion tag (one of: %s)" % ", ".join(sorted(load_tags())),
    )
    express.add_argument("text", nargs="*", help="optional source text (logged)")
    return parser


def check_pose(overrides):
    """Return an error message for a bad pose object, else None."""
    for key, value in overrides.items():
        if not isinstance(key, str) or not POSE_ID_RE.fullmatch(key):
            return ("pose keys must be Live2D parameter ids "
                    "([A-Za-z0-9_]{1,64}); got %r" % (str(key)[:32],))
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return "pose values must be numbers (got %s for %r)" % (
                type(value).__name__, key)
        try:
            finite = math.isfinite(float(value))
        except (OverflowError, ValueError):
            finite = False
        if not finite:
            return "pose values must be finite numbers (got %r for %r)" % (value, key)
    if len(overrides) > MAX_POSE_KEYS:
        return "pose has %d keys; at most %d are accepted" % (
            len(overrides), MAX_POSE_KEYS
        )
    return None


def main(argv):
    args = build_parser().parse_args(argv)
    groups = None

    if args.cmd == "motion":
        if len(args.group) > MAX_CMD_NAME:
            return fail("motion group is %d chars; at most %d are accepted"
                        % (len(args.group), MAX_CMD_NAME))
        if args.index is not None and args.index > MAX_MOTION_INDEX:
            return fail("motion index must be <= %d" % MAX_MOTION_INDEX)
        try:
            groups = motion_groups(MANIFEST)
        except (OSError, ValueError, TypeError) as exc:
            print(
                "whale_cmd: model manifest not readable (%s) — sending without "
                "name validation." % exc,
                file=sys.stderr,
            )
        else:
            names = [name for name, _count in groups]
            if args.group not in names:
                listing = ", ".join(
                    "%s (%d)" % (name, count) for name, count in groups
                )
                return fail(
                    "unknown motion group '%s'. Available groups: %s"
                    % (args.group, listing)
                )
        frame = {"type": "motion", "group": args.group}
        if args.index is not None:
            if args.index < 0:
                return fail("motion index must be >= 0")
            counts = dict(groups) if groups else {}
            count = counts.get(args.group)
            if count is not None and args.index >= count:
                return fail(
                    "motion index %d is out of range for '%s' (%d motion(s), "
                    "index 0..%d)" % (args.index, args.group, count, count - 1)
                )
            frame["index"] = args.index
    elif args.cmd == "say":
        text = " ".join(args.text).strip()
        if not text:
            return fail("say text is empty")
        if len(text) > MAX_SAY_CHARS:
            return fail(
                "say text is %d chars; at most %d are accepted"
                % (len(text), MAX_SAY_CHARS)
            )
        frame = {"type": "say", "text": text}
    elif args.cmd == "pose":
        try:
            overrides = json.loads(args.p)
        except (ValueError, RecursionError) as exc:
            return fail(
                "pose expects a JSON object, e.g. "
                "'{\"ParamEyeLOpen\":0,\"ParamEyeROpen\":0}' (%s)" % exc
            )
        if not isinstance(overrides, dict):
            return fail(
                "pose expects a JSON object, e.g. "
                "'{\"ParamEyeLOpen\":0,\"ParamEyeROpen\":0}'"
            )
        problem = check_pose(overrides)
        if problem:
            return fail(problem)
        frame = {"type": "pose", "p": overrides}
    elif args.cmd == "express":
        tag = args.tag.strip()
        if not tag or len(tag) > 32:
            return fail("express tag must be 1-32 characters")
        try:
            tags = load_tags()
        except Exception:  # a broken override must not block the command
            tags = None
        if tags is not None and tag not in tags:
            return fail("unknown emotion tag '%s'. Valid tags: %s"
                        % (tag, ", ".join(sorted(tags))))
        frame = {"type": "expression", "tag": tag}
        text = " ".join(args.text).strip()
        if text:
            frame["text"] = text
    else:  # mode
        frame = {"type": "mode", "mock": args.mode == "mock"}

    payload = json.dumps(frame, ensure_ascii=False, separators=(",", ":"))
    size = len(payload.encode("utf-8"))
    if size > MAX_FRAME_BYTES:
        return fail(
            "command frame is %d bytes; the server relays at most %d — "
            "shorten it" % (size, MAX_FRAME_BYTES)
        )

    code = send(payload)
    if code == 0:
        try:
            print("whale_cmd: sent " + payload)
        except UnicodeEncodeError:
            print("whale_cmd: sent (non-ASCII payload omitted)")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
