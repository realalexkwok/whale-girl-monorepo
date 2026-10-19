#!/usr/bin/env bash
# Scaffold the spec trio for a Whale Girl roadmap item.
# Usage: scaffold_item.sh M2.1 m21-model-integration
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo "usage: scaffold_item.sh <ITEM-ID> <slug>" >&2
  exit 2
fi
item="$1"
slug="$2"
date_stamp="$(date +%Y-%m-%d)"
item_lc="$(printf '%s' "$item" | tr '[:upper:]' '[:lower:]')"
dir="specs/features/$date_stamp-$item_lc-$slug"
mkdir -p "$dir"
for f in requirements plan validation; do
  if [ ! -f "$dir/$f.md" ]; then
    printf '# %s — %s\n\n> Grouped ask round: PENDING. Status: planning (do not start code).\n' "$item" "$f" > "$dir/$f.md"
  fi
done
echo "created $dir/{requirements,plan,validation}.md"
