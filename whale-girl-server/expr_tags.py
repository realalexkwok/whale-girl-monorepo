"""Whale Girl — M3.2 emotion tag -> expression preset table.

Data-only module shared by the driver (control_whale.py) and the CLI
(scripts/whale_cmd.py). Zero dependencies; the owner approves the defaults.

Set WHALE_EXPR_TAGS for BOTH processes (they read the same variable from their
own environments): a tag known to the driver only is rejected by the CLI
(exit 2), and a tag known to the CLI only is treated as unknown by the driver
(neutral fallback). The variable overrides or adds tags:

    WHALE_EXPR_TAGS='{"happy":"爱心眼","proud":"双手比耶"}'

(compact JSON merged over the defaults; invalid JSON/non-object falls back to
the defaults with a warning). An empty preset name means "reset the face".
"""

import json
import os

DEFAULT_TAGS = {
    "happy": "开心兴奋",
    "sad": "悲伤",
    "angry": "生气",
    "surprised": "感叹号",
    "confused": "问号",
    "love": "爱心眼",
    "neutral": "",  # empty preset = reset the face
}


def load_tags(environ=None):
    """Return the effective tag -> preset table (defaults + a JSON env merge)."""
    env = os.environ if environ is None else environ
    table = dict(DEFAULT_TAGS)
    raw = env.get("WHALE_EXPR_TAGS", "").strip()
    if raw:
        try:
            extra = json.loads(raw)
        except ValueError:
            print(
                "[whale] WHALE_EXPR_TAGS is not valid JSON; using the defaults",
                flush=True,
            )
            return table
        if not isinstance(extra, dict):
            print(
                "[whale] WHALE_EXPR_TAGS must be a JSON object; using the defaults",
                flush=True,
            )
            return table
        for key, value in extra.items():
            if isinstance(key, str) and isinstance(value, str):
                table[key] = value
    return table
