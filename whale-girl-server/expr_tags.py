"""Whale Girl — M3.2 emotion tag -> expression preset table.

Data-only module shared by the driver (control_whale.py) and the CLI
(scripts/whale_cmd.py) so the two can never disagree. Zero dependencies; the
owner approves the defaults.

Override or add tags at runtime with:

    WHALE_EXPR_TAGS='{"happy":"爱心眼","proud":"双手比耶"}'

(compact JSON merged over the defaults; invalid JSON falls back to the defaults
with a warning). An empty preset name means "reset the face to neutral".
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
    table = dict(DEFAULT_TAGS)
    raw = (environ or os.environ).get("WHALE_EXPR_TAGS", "").strip()
    if raw:
        try:
            extra = json.loads(raw)
        except ValueError:
            print(
                "[whale] WHALE_EXPR_TAGS is not valid JSON; using the defaults",
                flush=True,
            )
            return table
        if isinstance(extra, dict):
            for key, value in extra.items():
                if isinstance(key, str) and isinstance(value, str):
                    table[key] = value
    return table
