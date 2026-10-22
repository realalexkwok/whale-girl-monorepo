#!/usr/bin/env python3
"""Whale Girl — motion driver (Milestone 1; command surface added in M3.1).

Streams natural-looking facial parameters (blink, talk, gaze, sway) to the
Whale Girl WebSocket proxy at a drift-corrected 30 FPS. In mock mode (the
default) it synthesizes its own talk bursts; in live mode explicit commands
(motion / expression / say / pose / mode) from a DSH session drive the whale.

Design goals: low CPU, low memory, zero per-frame allocations. Python 3.9+.
"""

import asyncio
import json
import math
import os
import random
import re
import sys
import time

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from expr_tags import load_tags

WS_URL = os.environ.get("WHALE_WS", "ws://localhost:3001?role=python")
FPS = 30
FRAME_TIME = 1.0 / FPS
DEBUG = os.environ.get("WHALE_DEBUG") == "1"

# --- M2.2 TTS lip sync -------------------------------------------------------
# edge-tts synthesizes the words (neural voice + word timestamps); macOS
# "say" is the automatic fallback engine (no timestamps -> amplitude path in
# the frontend). WHALE_ENGINE=say forces the fallback (probe / manual test).
WHALE_VOICE = os.environ.get("WHALE_VOICE", "zh-CN-XiaoyiNeural")
WHALE_SAY_VOICE = os.environ.get("WHALE_SAY_VOICE", "Tingting")
SAY_ENGINE = os.environ.get("WHALE_ENGINE", "").strip().lower()
SAY_TEXT = os.environ.get("WHALE_SAY_TEXT", "").strip()
# WHALE_SAY_TEXT is a one-shot trigger per PROCESS (not per connection): a
# driver reconnect must not re-synthesize the same scripted line over and over.
SAY_TEXT_PENDING = bool(SAY_TEXT)
# M3.1: mock synthesis stays the default. live mode pauses the mock talk bursts
# and hands the mouth to explicit commands (say / pose); a mode frame flips it
# at runtime. Anything other than an explicit "live" keeps mock behavior.
MODE = "live" if os.environ.get("WHALE_MODE", "").strip().lower() == "live" else "mock"
# M3.1 fix (2026-10-21): a say owns the speech until it ends — the mock must not
# trigger canned phrases over it. Set by send_say() to the words' end + 0.3 s
# (an estimate for the macOS-say fallback, which has no timeline).
SAY_HOLD_UNTIL = 0.0

# --- M3.2 expression routing ------------------------------------------------
# The LLM tags inline; this table resolves a coarse tag to one of the model's
# expressions (shared with the CLI via expr_tags.py). A tag CHANGE applies
# immediately; the SAME tag is re-applied only after EXPR_COOLDOWN, so chat
# noise cannot flicker the face. With no express command for EXPR_IDLE seconds
# the face returns to neutral (an empty-name expression frame = reset).
def _env_seconds(name, default):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        print("[whale-girl] %s=%r is not a number; using %.1f"
              % (name, raw, default), flush=True)
        return default
    if not math.isfinite(value) or value < 0:
        print("[whale-girl] %s=%r is invalid; using %.1f"
              % (name, raw, default), flush=True)
        return default
    return value


EXPR_TAGS = load_tags()
EXPR_NEUTRAL = EXPR_TAGS.get("neutral", "")
EXPR_COOLDOWN = _env_seconds("WHALE_EXPR_COOLDOWN", 4.0)
EXPR_IDLE = _env_seconds("WHALE_EXPR_IDLE", 30.0)

AUDIO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio")
AUDIO_MAX_AGE = 3600.0  # prune speech files older than 1 h on each synthesis
# edge-tts runs in this short-lived child process: importing it + aiohttp in
# the driver would push RSS past the 30 MB budget (measured 2026-10-21).
TTS_HELPER = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "scripts", "tts_synth.py"
)
# A hung edge-tts child must not block say_task forever: time it out, kill it
# and let synthesize() fall back to macOS say.
TTS_TIMEOUT = 45.0

# Canned phrases the mock brain speaks at each talk burst. DSH supplies real
# text in live mode (whale_say); the say path itself is text-agnostic.
CANNED_PHRASES = (
    "你好，我是鲸鱼娘。",
    "今天也要开心哦！",
    "嗯嗯，我在听呢。",
    "要不要一起去看看海？",
    "嘿嘿，被你发现啦。",
)

# Live2D parameter IDs driven by this script (Cubism standard names).
PARAM_MOUTH = "ParamMouthOpenY"
PARAM_EYE_L = "ParamEyeLOpen"
PARAM_EYE_R = "ParamEyeROpen"
PARAM_BALL_X = "ParamEyeBallX"
PARAM_BALL_Y = "ParamEyeBallY"
PARAM_ANGLE_X = "ParamAngleX"
PARAM_ANGLE_Y = "ParamAngleY"
PARAM_ANGLE_Z = "ParamAngleZ"

# The eight parameters synth() rewrites every frame; a pose that targets one of
# them must be re-applied after the synthesis (see POSE_OVERLAP).
SYNTH_KEYS = frozenset((
    PARAM_MOUTH, PARAM_EYE_L, PARAM_EYE_R, PARAM_BALL_X, PARAM_BALL_Y,
    PARAM_ANGLE_X, PARAM_ANGLE_Y, PARAM_ANGLE_Z,
))

# Live2D parameter-id grammar: ASCII identifiers only. CJK/emoji ids would be
# escaped 6x by json.dumps and could push the 30 FPS frame past the proxy cap.
# fullmatch (not match) so a trailing newline can never slip through.
POSE_ID_RE = re.compile(r"[A-Za-z0-9_]{1,64}")
MAX_CMD_NAME = 128    # motion group / expression name cap (bounds the frame)
MAX_MOTION_INDEX = 9999

# Blink timing (seconds).
BLINK_INTERVAL = (2.5, 5.5)
BLINK_CLOSING = 0.09
BLINK_CLOSED = 0.04
BLINK_OPENING = 0.16

# Talk burst timing (seconds).
TALK_RANGE = (1.5, 4.0)
PAUSE_RANGE = (0.5, 2.0)

# Pre-allocated frame dict, mutated in place every tick (no per-frame allocs).
MOTION = {
    "type": "motion",
    "f": 0,
    "p": {
        PARAM_MOUTH: 0.0,
        PARAM_EYE_L: 1.0,
        PARAM_EYE_R: 1.0,
        PARAM_BALL_X: 0.0,
        PARAM_BALL_Y: 0.0,
        PARAM_ANGLE_X: 0.0,
        PARAM_ANGLE_Y: 0.0,
        PARAM_ANGLE_Z: 0.0,
    },
}

# M3.1 pose overlay: values from a pose command win over the synthesized values
# until the next pose command ({} clears) or a mode flip. The frame dict is
# pre-allocated, so every key the overlay writes must be removed when the
# overlay shrinks — a stale key would otherwise ride in every frame forever
# (and enough keys would push the frame past the proxy's 8 KB cap).
POSE_OVERRIDES = {}
POSE_OVERLAP = []  # overlay keys synth() rewrites (re-applied after synth)
POSE_LIMIT = 32    # max overlay entries per command
MAX_SAY_CHARS = 300  # longest accepted say line (TTS + word timeline)
MAX_FRAME_BYTES = 8 * 1024  # the proxy's soft cap for relayed frames
BAD_CMD_AT = 0.0    # rate limit for rejected-frame logging
NOTICE_AT = 0.0     # rate limit for say queue/busy notices


def dump_json(obj):
    """Compact, strict serialization for the wire (no NaN/Infinity)."""
    return json.dumps(obj, separators=(",", ":"), allow_nan=False)


def log_bad_cmd(detail):
    """Rate-limited (1 Hz) log for rejected or malformed command frames."""
    global BAD_CMD_AT
    now = time.monotonic()
    if now - BAD_CMD_AT >= 1.0:
        BAD_CMD_AT = now
        print("[whale-girl] bad command ignored: %s" % detail, flush=True)


def log_notice(detail):
    """Rate-limited (1 Hz) informational log for command handling."""
    global NOTICE_AT
    now = time.monotonic()
    if now - NOTICE_AT >= 1.0:
        NOTICE_AT = now
        print("[whale-girl] %s" % detail, flush=True)


def clear_pose():
    """Drop the overlay and every parameter key it wrote into the frame dict."""
    for key in POSE_OVERRIDES:
        MOTION["p"].pop(key, None)
    POSE_OVERRIDES.clear()
    del POSE_OVERLAP[:]


def set_pose(overrides):
    """Replace the overlay; keys the new overlay does not set are removed.

    Values are written into the pre-allocated frame dict once, so the 30 FPS
    loop does no per-frame overlay iteration; only keys synth() rewrites are
    re-applied after the synthesis.
    """
    for key in list(POSE_OVERRIDES):
        if key not in overrides:
            POSE_OVERRIDES.pop(key, None)
            MOTION["p"].pop(key, None)
    POSE_OVERRIDES.update(overrides)
    MOTION["p"].update(overrides)
    del POSE_OVERLAP[:]
    for key in POSE_OVERRIDES:
        if key in SYNTH_KEYS:
            POSE_OVERLAP.append(key)


def clamp(value, low, high):
    if value < low:
        return low
    if value > high:
        return high
    return value


class BlinkController:
    """Cosine-eased eye blink envelope, driven by absolute wall-clock time."""

    __slots__ = ("state", "state_start", "next_interval")

    def __init__(self, now):
        self.state = "open"
        self.state_start = now
        self.next_interval = random.uniform(*BLINK_INTERVAL)

    def value(self, now):
        elapsed = now - self.state_start
        state = self.state
        if state == "open":
            if elapsed < self.next_interval:
                return 1.0
            self.state, self.state_start = "closing", now
            return 1.0
        if state == "closing":
            if elapsed >= BLINK_CLOSING:
                self.state, self.state_start = "closed", now
                return 0.0
            return 0.5 + 0.5 * math.cos(math.pi * elapsed / BLINK_CLOSING)
        if state == "closed":
            if elapsed >= BLINK_CLOSED:
                self.state, self.state_start = "opening", now
                return 0.0
            return 0.0
        # "opening"
        if elapsed >= BLINK_OPENING:
            self.state = "open"
            self.state_start = now
            self.next_interval = random.uniform(*BLINK_INTERVAL)
            return 1.0
        return 0.5 - 0.5 * math.cos(math.pi * elapsed / BLINK_OPENING)


class TalkEnvelope:
    """Random talk/pause bursts; amplitude 1 while talking, 0 while pausing."""

    __slots__ = ("talking", "started", "duration")

    def __init__(self, now):
        self.talking = random.getrandbits(1) == 1
        self.started = now
        self.duration = self._roll()

    def _roll(self):
        rng = TALK_RANGE if self.talking else PAUSE_RANGE
        return random.uniform(*rng)

    def amplitude(self, now):
        if now - self.started >= self.duration:
            self.talking = not self.talking
            self.started = now
            self.duration = self._roll()
        return 1.0 if self.talking else 0.0


def _audio_name(ext):
    return "say-%d-%04d.%s" % (int(time.time() * 1000), random.randint(0, 9999), ext)


async def _edge_tts(text):
    """Synthesize with edge-tts in a short-lived child process.

    The child isolates edge-tts + aiohttp (~8-12 MB RSS) from the 30 FPS
    driver, whose budget is <= 30 MB (tech-stack.md). The child prints one
    JSON line with the word timeline; a missing package or a network failure
    raises here so synthesize() can fall back to macOS say.
    """
    os.makedirs(AUDIO_DIR, exist_ok=True)
    name = _audio_name("mp3")
    path = os.path.join(AUDIO_DIR, name)
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        TTS_HELPER,
        path,
        WHALE_VOICE,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(
            proc.communicate(text.encode("utf-8")), timeout=TTS_TIMEOUT
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
        try:
            os.unlink(path)
        except OSError:
            pass
        raise RuntimeError("edge-tts timed out after %.0f s" % TTS_TIMEOUT)
    try:
        payload = json.loads(out.decode("utf-8", "replace").strip() or "{}")
    except ValueError:
        raise RuntimeError("tts helper returned invalid JSON")
    if proc.returncode != 0 or not payload.get("ok"):
        detail = payload.get("error") or err.decode("utf-8", "replace").strip()
        raise RuntimeError(detail or "tts helper exited %d" % proc.returncode)
    return name, payload.get("words") or []


async def _say_tts(text):
    """Fallback engine: macOS say -> AAC .m4a (no word timestamps)."""
    os.makedirs(AUDIO_DIR, exist_ok=True)
    name = _audio_name("m4a")
    path = os.path.join(AUDIO_DIR, name)
    proc = await asyncio.create_subprocess_exec(
        "say",
        "-v", WHALE_SAY_VOICE,
        "-o", path,
        "--file-format=m4af",
        "--data-format=aac",
        text,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            "say failed: %s" % (err.decode("utf-8", "replace").strip() or proc.returncode)
        )
    return name, []


async def synthesize(text):
    """edge-tts first (unless WHALE_ENGINE=say), then the macOS say fallback."""
    os.makedirs(AUDIO_DIR, exist_ok=True)
    if SAY_ENGINE != "say":
        try:
            name, words = await _edge_tts(text)
            return name, words, "edge-tts"
        except Exception as exc:
            print(
                "[whale-girl] edge-tts failed (%s); using macOS say" % exc,
                flush=True,
            )
    try:
        name, words = await _say_tts(text)
        return name, words, "say"
    except Exception as exc:
        print(
            "[whale-girl] TTS failed entirely (%s); mock envelope continues" % exc,
            flush=True,
        )
        return None


def _prune_audio_sync(now):
    try:
        for entry in os.scandir(AUDIO_DIR):
            if entry.is_file() and now - entry.stat().st_mtime > AUDIO_MAX_AGE:
                try:
                    os.unlink(entry.path)
                except OSError:
                    pass
    except OSError:
        pass


def say_duration(text, words):
    """Playback length: exact from the word timeline, else ~0.25 s per char."""
    if words:
        return words[-1][1]
    return 0.25 * len(text) + 0.5


async def send_say(ws, text, src="cmd"):
    """Synthesize + send the say frame (src: "cmd" | "mock").

    Synthesis failures are swallowed (the mock envelope stays the fallback);
    send errors propagate to the caller. The frame keeps the M2.2 shape and adds
    an additive "src" field so the frontend can let a mock line never interrupt
    a playing line while an explicit command still does.
    """
    global SAY_HOLD_UNTIL
    result = await synthesize(text)
    if not result:
        return
    if src == "mock" and MODE == "live":
        # The mode flipped while this canned line was synthesizing: drop it so
        # live mode really is silent (the hold is not extended either).
        print("[whale-girl] mock line dropped (mode is live)", flush=True)
        return
    name, words, engine = result
    await asyncio.to_thread(_prune_audio_sync, time.time())
    payload = dump_json({
        "type": "say",
        "audio": "/audio/" + name,
        "words": words,
        "src": src,
    })
    size = len(payload.encode("utf-8"))
    if size > MAX_FRAME_BYTES:
        print(
            "[whale-girl] say frame too large (%d bytes, limit %d); dropped"
            % (size, MAX_FRAME_BYTES),
            flush=True,
        )
        return
    await ws.send(payload)
    SAY_HOLD_UNTIL = time.monotonic() + say_duration(text, words) + 0.3
    print(
        "[whale-girl] say: %s (%d words, %s, %s)"
        % (name, len(words), engine, src),
        flush=True,
    )


def synth(now, blink, talk, frame):
    """Fill the pre-allocated frame dict in place (no per-frame allocations)."""
    p = frame["p"]

    eye = blink.value(now)
    p[PARAM_EYE_L] = eye
    p[PARAM_EYE_R] = eye

    amp = talk.amplitude(now)
    p[PARAM_MOUTH] = clamp(
        amp
        * (
            0.55
            + 0.25 * math.sin(2 * math.pi * 2.6 * now)
            + 0.15 * math.sin(2 * math.pi * 5.1 * now + 1.7)
            + 0.10 * math.sin(2 * math.pi * 1.2 * now + 0.6)
            + 0.08 * random.uniform(-1.0, 1.0)
        ),
        0.0,
        1.0,
    )

    p[PARAM_BALL_X] = clamp(
        0.65 * math.sin(2 * math.pi * 0.11 * now)
        + 0.05 * math.sin(2 * math.pi * 0.70 * now),
        -1.0,
        1.0,
    )
    p[PARAM_BALL_Y] = clamp(
        0.30 * math.sin(2 * math.pi * 0.09 * now + 1.2)
        + 0.04 * math.sin(2 * math.pi * 0.50 * now + 0.4),
        -1.0,
        1.0,
    )

    p[PARAM_ANGLE_X] = 2.0 * math.sin(2 * math.pi * 0.13 * now)
    p[PARAM_ANGLE_Y] = 1.5 * math.sin(2 * math.pi * 0.17 * now + 0.8)
    p[PARAM_ANGLE_Z] = 0.8 * math.sin(2 * math.pi * 0.21 * now + 1.5)

    if MODE == "live":
        p[PARAM_MOUTH] = 0.0  # explicit commands own the mouth in live mode
    if POSE_OVERLAP:
        for pid in POSE_OVERLAP:
            p[pid] = POSE_OVERRIDES[pid]


async def run_driver(ws):
    """30 FPS drift-corrected send loop; idles while no web client is connected."""
    global SAY_TEXT_PENDING
    loop = asyncio.get_running_loop()
    web_count = 1  # optimistic start; the server corrects this via events

    # M3.2 expression state (one-shot commands; no per-frame work). The idle
    # check rides the 1 s log block below.
    expr_tag = ""
    expr_at = 0.0
    expr_deadline = 0.0
    # expr_tags.load_tags() guarantees the neutral tag is the reset (""); the
    # fallback below is therefore a constant, not an env-dependent preset.
    expr_neutral = EXPR_NEUTRAL

    async def forward(frame):
        """Send a v1 frame to the frontend over the python connection."""
        try:
            await ws.send(dump_json(frame))
        except ConnectionClosed:
            pass

    async def dispatch(event):
        """Execute one v1 command frame (already unwrapped from the relay)."""
        global MODE
        nonlocal expr_tag, expr_at, expr_deadline
        kind = event.get("type")
        if kind == "motion":
            group = event.get("group")
            if not isinstance(group, str) or not group:
                return
            if len(group) > MAX_CMD_NAME:
                log_bad_cmd("motion group too long (%d chars)" % len(group))
                return
            frame = {"type": "motion", "group": group}
            index = event.get("index")
            if index is None:
                pass
            elif (isinstance(index, (int, float))
                  and not isinstance(index, bool)
                  and float(index).is_integer()
                  and 0 <= int(index) <= MAX_MOTION_INDEX):
                # Integral floats (1.0 from a float-typed MCP wrapper) are ints.
                frame["index"] = int(index)
            else:
                log_bad_cmd("motion index out of range: %r" % (index,))
                return
            await forward(frame)
        elif kind == "expression":
            # M3.2: a coarse tag resolves through the table; the M3.1 direct
            # name passthrough keeps working (old CLI/probe clients).
            tag = event.get("tag")
            if isinstance(tag, str) and tag:
                forced = False  # malformed/unknown -> neutral, bypass the cooldown
                if len(tag) > 32:
                    log_bad_cmd("expression tag too long (%d chars); using "
                                "neutral (valid: %s)"
                                % (len(tag), ", ".join(sorted(EXPR_TAGS))))
                    tag = "neutral"
                    forced = True
                now = time.monotonic()
                preset = EXPR_TAGS.get(tag)
                if preset is None:
                    log_bad_cmd("unknown expression tag %r (valid: %s)"
                                % (tag[:32], ", ".join(sorted(EXPR_TAGS))))
                    tag = "neutral"
                    preset = expr_neutral
                    forced = True
                elif len(preset) > MAX_CMD_NAME:
                    log_bad_cmd("expression preset too long (%d chars) for %r"
                                % (len(preset), tag[:32]))
                    tag = "neutral"
                    preset = expr_neutral
                    forced = True
                elif (not forced and tag == expr_tag
                      and now - expr_at < EXPR_COOLDOWN):
                    # A repeat still counts as activity: keep the face alive.
                    expr_deadline = now + EXPR_IDLE
                    log_notice("express %r within the cooldown, skipped"
                               % (tag,))
                    return
                expr_tag = tag
                expr_at = now
                expr_deadline = now + EXPR_IDLE
                text = event.get("text")
                detail = ""
                if isinstance(text, str) and text.strip():
                    detail = " (%s)" % text.strip()[:30]
                await forward({"type": "expression", "name": preset})
                log_notice("express: %s -> %r%s" % (tag, preset, detail))
                return
            name = event.get("name")
            if not isinstance(name, str) or not name:
                # Neither a tag nor a name: behave like an unknown tag.
                log_bad_cmd("expression frame without a tag or name "
                            "(valid tags: %s)"
                            % ", ".join(sorted(EXPR_TAGS)))
                expr_tag = "neutral"
                expr_at = time.monotonic()
                expr_deadline = expr_at + EXPR_IDLE
                await forward({"type": "expression", "name": expr_neutral})
                return
            if len(name) > MAX_CMD_NAME:
                log_bad_cmd("expression name too long (%d chars)" % len(name))
                return
            expr_deadline = time.monotonic() + EXPR_IDLE
            await forward({"type": "expression", "name": name})
        elif kind == "say":
            text = event.get("text")
            if isinstance(text, str) and text.strip():
                text = text.strip()
                if len(text) > MAX_SAY_CHARS:
                    log_bad_cmd("say text too long (%d chars, limit %d)"
                                % (len(text), MAX_SAY_CHARS))
                    return
                trigger_say(text, "cmd")
        elif kind == "pose":
            overrides = event.get("p")
            if not isinstance(overrides, dict):
                return
            clean = {}
            for pid, value in overrides.items():
                if (not isinstance(pid, str)
                        or isinstance(value, bool)
                        or not isinstance(value, (int, float))):
                    log_bad_cmd("bad pose value for %r" % (str(pid)[:32],))
                    return
                if not POSE_ID_RE.fullmatch(pid):
                    log_bad_cmd("invalid pose id %r" % (pid[:32],))
                    return
                try:
                    number = float(value)
                except (OverflowError, ValueError):
                    log_bad_cmd("pose value too large for %r" % (pid,))
                    return
                if not math.isfinite(number):
                    log_bad_cmd("non-finite pose value for %r" % (pid,))
                    return
                clean[pid] = number
            if len(clean) > POSE_LIMIT:
                log_bad_cmd("pose has %d keys (limit %d)"
                            % (len(clean), POSE_LIMIT))
                return
            # Bound the escaped frame size before accepting the overlay: the
            # id grammar already keeps ids ASCII, so this is a safety net.
            sample = {"type": "motion", "f": 0, "p": dict(MOTION["p"])}
            sample["p"].update(clean)
            if len(dump_json(sample).encode("utf-8")) > MAX_FRAME_BYTES - 64:
                log_bad_cmd("pose would exceed the frame cap")
                return
            if clean:
                set_pose(clean)
            else:
                clear_pose()
        elif kind == "mode":
            mock = event.get("mock")
            if isinstance(mock, bool):
                wanted = "mock" if mock else "live"
                if wanted != MODE:
                    MODE = wanted
                    clear_pose()
                    # M3.2: a real flip also clears the expression state and
                    # resets the face (the frontend maps "" to resetExpression).
                    expr_tag = ""
                    expr_at = 0.0
                    expr_deadline = 0.0
                    await forward({"type": "expression", "name": ""})
                    await forward({"type": "mode", "mock": MODE == "mock"})
                    log_notice("mode: %s" % MODE)
            else:
                log_bad_cmd("mode command without a boolean 'mock'")

    async def read_events():
        """Server events + v1 command frames (rare events, never per-frame work)."""
        nonlocal web_count
        try:
            async for raw in ws:
                try:
                    event = json.loads(raw)
                except (ValueError, RecursionError):
                    log_bad_cmd("invalid JSON")
                    continue
                if not isinstance(event, dict):
                    continue
                relayed = event.get("relay")
                if isinstance(relayed, str):
                    # Commands arrive wrapped by the server ({"relay":"<frame>"})
                    # so a web client cannot impersonate a server event such as
                    # web_connected. Only command frames are accepted here.
                    try:
                        command = json.loads(relayed)
                    except (ValueError, RecursionError):
                        log_bad_cmd("invalid relayed frame")
                        continue
                    if not isinstance(command, dict):
                        log_bad_cmd("non-object relayed frame")
                        continue
                    try:
                        await dispatch(command)
                    except Exception as exc:  # one bad frame must never kill commands
                        log_bad_cmd("handler error: %r" % (exc,))
                    continue
                if "relay" in event:
                    continue
                if event.get("type") == "web_connected":
                    try:
                        count = max(0, int(event.get("count", 0)))
                    except (TypeError, ValueError):
                        continue
                    web_count = count
                    # Announce the current mode on every (re)connect so a page
                    # that joined after the driver boot learns it too.
                    await forward({"type": "mode", "mock": MODE == "mock"})
                    continue
                # Anything else at the top level is not a server event: ignore.
        except ConnectionClosed:
            pass

    reader = asyncio.create_task(read_events())
    payload = ""
    sent = 0
    last_log = loop.time()
    logged_sent = 0

    start = loop.time()
    blink = BlinkController(start)
    talk = TalkEnvelope(start)
    next_t = start + FRAME_TIME

    say_task = None
    pending_say = None  # (text, src) queued behind an in-flight synthesis

    def start_say(text, src):
        nonlocal say_task
        say_task = asyncio.create_task(run_say(text, src))

    async def run_say(text, src):
        nonlocal pending_say
        cancelled = False
        try:
            await send_say(ws, text, src)
        except asyncio.CancelledError:
            cancelled = True  # shutdown: do not chain the queued say
            raise
        except ConnectionClosed:
            pass
        except Exception as exc:  # TTS must never kill the 30 FPS loop
            print("[whale-girl] say error: %s" % exc, flush=True)
        finally:
            if not cancelled and pending_say is not None:
                next_text, next_src = pending_say
                pending_say = None
                start_say(next_text, next_src)

    def trigger_say(text, src):
        nonlocal pending_say
        if say_task is not None and not say_task.done():
            if src == "cmd":
                # An explicit command must not be lost while a synthesis runs
                # (the mock's canned line is the usual in-flight one).
                pending_say = (text, src)
                log_notice("say queued: %s" % text[:40])
            else:
                log_notice("say busy, dropped: %s" % text[:40])
            return
        start_say(text, src)

    # Announce the mode once on connect so a page that was already open (or a
    # reconnect) shows the real state without waiting for a mode command.
    await forward({"type": "mode", "mock": MODE == "mock"})

    try:
        while True:
            if web_count > 0:
                now = loop.time()
                if SAY_TEXT_PENDING and (say_task is None or say_task.done()):
                    # One-shot per process (probe / manual test): never re-fired
                    # by a reconnect.
                    SAY_TEXT_PENDING = False
                    trigger_say(SAY_TEXT, "cmd")
                talking_before = talk.talking
                synth(now, blink, talk, MOTION)
                if (MODE == "mock" and talk.talking and not talking_before
                        and not SAY_TEXT and now >= SAY_HOLD_UNTIL):
                    # One synthesis per talk burst; the say frame then drives the
                    # mouth in the frontend while the mock pulse keeps the rest.
                    # A say owns the speech until it ends: the hold window keeps
                    # the mock from cutting a playing line (M3.1 fix).
                    trigger_say(random.choice(CANNED_PHRASES), "mock")
                MOTION["f"] = sent
                payload = dump_json(MOTION)
                await ws.send(payload)
                sent += 1

            # Drift-corrected pacing: sleep only the remainder of this frame.
            next_t += FRAME_TIME
            delay = next_t - loop.time()
            if delay > 0:
                await asyncio.sleep(delay)
            else:
                # Fell behind (system stall): resync, never busy-spin.
                next_t = loop.time()

            now = loop.time()
            if now - last_log >= 1.0:
                rate = sent - logged_sent
                logged_sent = sent
                last_log = now
                print(
                    "[whale-girl] driver: %d fps, web clients: %d, mode: %s"
                    % (rate, web_count, MODE),
                    flush=True,
                )
                if DEBUG and payload:
                    print("[whale-girl] sample: %s" % payload, flush=True)
                # A dead reader would freeze commands while the frames continue:
                # surface it and restart it on the live connection.
                if reader.done() and not reader.cancelled():
                    reader_exc = reader.exception()
                    if reader_exc is not None:
                        log_notice("event reader stopped (%r); restarting"
                                   % (reader_exc,))
                        reader = asyncio.create_task(read_events())
                # M3.2: an expression goes back to neutral after EXPR_IDLE.
                if expr_deadline and now >= expr_deadline:
                    expr_deadline = 0.0
                    expr_tag = ""
                    expr_at = 0.0
                    await forward({"type": "expression", "name": ""})
                    log_notice("expression idle -> neutral")
    finally:
        reader.cancel()
        if say_task is not None:
            say_task.cancel()
        try:
            await reader
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # reader already logs per event; never crash it
            print("[whale-girl] event reader stopped: %r" % (exc,), flush=True)


async def main():
    backoff = 1.0
    while True:
        try:
            async with connect(WS_URL, ping_interval=20, ping_timeout=20) as ws:
                backoff = 1.0
                print("[whale-girl] connected: %s" % WS_URL, flush=True)
                await run_driver(ws)
        except ConnectionClosed as exc:
            if exc.code == 4001:
                print(
                    "[whale-girl] replaced by a newer instance; exiting.",
                    flush=True,
                )
                return
            print(
                "[whale-girl] connection lost (%s); retrying in %.1fs"
                % (exc.code, backoff),
                flush=True,
            )
        except OSError as exc:
            print(
                "[whale-girl] cannot reach server (%s); retrying in %.1fs"
                % (exc, backoff),
                flush=True,
            )
        await asyncio.sleep(backoff + random.uniform(0.0, backoff * 0.25))
        backoff = min(backoff * 2.0, 10.0)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[whale-girl] stopped by user.", flush=True)
