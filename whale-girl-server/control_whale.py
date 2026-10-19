#!/usr/bin/env python3
"""Whale Girl — mock motion driver (Milestone 1).

Streams natural-looking mock facial parameters (blink, talk, gaze, sway) to
the Whale Girl WebSocket proxy at a drift-corrected 30 FPS.

Design goals: low CPU, low memory, zero per-frame allocations. Python 3.9+.
"""

import asyncio
import json
import math
import os
import random

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

WS_URL = os.environ.get("WHALE_WS", "ws://localhost:3001?role=python")
FPS = 30
FRAME_TIME = 1.0 / FPS
DEBUG = os.environ.get("WHALE_DEBUG") == "1"

# Live2D parameter IDs driven by this script (Cubism standard names).
PARAM_MOUTH = "ParamMouthOpenY"
PARAM_EYE_L = "ParamEyeLOpen"
PARAM_EYE_R = "ParamEyeROpen"
PARAM_BALL_X = "ParamEyeBallX"
PARAM_BALL_Y = "ParamEyeBallY"
PARAM_ANGLE_X = "ParamAngleX"
PARAM_ANGLE_Y = "ParamAngleY"
PARAM_ANGLE_Z = "ParamAngleZ"

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


def dump_json(obj):
    """Compact serialization for the wire."""
    return json.dumps(obj, separators=(",", ":"))


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


async def run_driver(ws):
    """30 FPS drift-corrected send loop; idles while no web client is connected."""
    loop = asyncio.get_running_loop()
    web_count = 1  # optimistic start; the server corrects this via events

    async def read_events():
        nonlocal web_count
        try:
            async for raw in ws:
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                if event.get("type") == "web_connected":
                    web_count = max(0, int(event.get("count", 0)))
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

    try:
        while True:
            if web_count > 0:
                synth(loop.time(), blink, talk, MOTION)
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
                    "[whale-girl] driver: %d fps, web clients: %d"
                    % (rate, web_count),
                    flush=True,
                )
                if DEBUG and payload:
                    print("[whale-girl] sample: %s" % payload, flush=True)
    finally:
        reader.cancel()
        try:
            await reader
        except asyncio.CancelledError:
            pass


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
