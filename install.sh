#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

discover_hermes_home() {
  if [ -n "${HERMES_HOME:-}" ]; then
    printf '%s\n' "$HERMES_HOME"
    return
  fi

  local dir="$SRC_DIR"
  while [ "$dir" != "/" ]; do
    if [ "$(basename "$dir")" = ".hermes" ] && [ -f "$dir/config.yaml" ]; then
      printf '%s\n' "$dir"
      return
    fi
    if [ -f "$dir/.hermes/config.yaml" ]; then
      printf '%s\n' "$dir/.hermes"
      return
    fi
    dir="$(dirname "$dir")"
  done

  local candidates=(
    "$HOME/.hermes"
    "/work/${USER:-}/.hermes"
    "/workspace/${USER:-}/.hermes"
    "/mnt/data/.hermes"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate/config.yaml" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  local roots=("$HOME" "/work/${USER:-}" "/workspace/${USER:-}" "/work" "/workspace" "/mnt/data")
  local root found
  for root in "${roots[@]}"; do
    [ -d "$root" ] || continue
    found="$(find "$root" -maxdepth 3 -type f -path '*/.hermes/config.yaml' -print 2>/dev/null | sort | head -n 1 || true)"
    if [ -n "$found" ]; then
      printf '%s\n' "$(dirname "$found")"
      return
    fi
  done
}

HERMES_HOME="$(discover_hermes_home)"

if [ -z "$HERMES_HOME" ] || [ ! -d "$HERMES_HOME" ]; then
  echo "Hermes home not found: $HERMES_HOME" >&2
  echo "Set HERMES_HOME=/path/to/.hermes if your install uses a custom location." >&2
  echo "Please install Hermes Agent and run: hermes setup" >&2
  exit 1
fi

TARGET_DIR="${HERMES_WEB_UI_TARGET:-$HERMES_HOME/web-ui}"

if [ ! -f "$HERMES_HOME/config.yaml" ]; then
  echo "Hermes config not found: $HERMES_HOME/config.yaml" >&2
  echo "Please run: hermes setup before installing the Web UI." >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DIR")"

if [ -e "$TARGET_DIR" ]; then
  ts="$(date +%Y%m%d_%H%M%S)"
  BACKUP="$TARGET_DIR.backup.$ts"
  echo "Existing Web UI found. Moving it to: $BACKUP"
  mv "$TARGET_DIR" "$BACKUP"
fi

echo "Installing Hermes Web UI to: $TARGET_DIR"
mkdir -p "$TARGET_DIR"

# Copy files without copying node_modules/dist caches from a development tree.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude node_modules --exclude dist --exclude '.git' "$SRC_DIR/" "$TARGET_DIR/"
else
  cp -a "$SRC_DIR/." "$TARGET_DIR/"
  rm -rf "$TARGET_DIR/node_modules" "$TARGET_DIR/dist" "$TARGET_DIR/.git"
fi

chmod +x "$TARGET_DIR/start.sh" "$TARGET_DIR/stop.sh" "$TARGET_DIR/restart.sh" "$TARGET_DIR/install.sh" 2>/dev/null || true

echo "Done. Start it with:"
echo "  cd $TARGET_DIR && ./start.sh"
