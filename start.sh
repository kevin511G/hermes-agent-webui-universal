#!/usr/bin/env bash
set -euo pipefail

WEB_UI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

discover_hermes_home() {
  if [ -n "${HERMES_HOME:-}" ]; then
    printf '%s\n' "$HERMES_HOME"
    return
  fi

  local dir="$WEB_UI_DIR"
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

discover_hermes_agent_dir() {
  if [ -n "${HERMES_AGENT_DIR:-}" ]; then
    printf '%s\n' "$HERMES_AGENT_DIR"
    return
  fi

  local candidates=(
    "$HERMES_HOME/hermes-agent"
    "$(dirname "$HERMES_HOME")/hermes-agent"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
}

HERMES_HOME="$(discover_hermes_home)"
HERMES_AGENT_DIR="$(discover_hermes_agent_dir)"
export PATH="$HERMES_HOME/node/bin:$PATH"

PROXY_HOST="${HERMES_WEB_HOST:-127.0.0.1}"
PROXY_PORT="${HERMES_WEB_PORT:-3001}"
WEB_HOST="${HERMES_WEB_UI_HOST:-127.0.0.1}"
WEB_PORT="${HERMES_WEB_UI_PORT:-3000}"

if [ -z "$HERMES_HOME" ] || [ ! -d "$HERMES_HOME" ]; then
  echo "Hermes home not found: $HERMES_HOME" >&2
  echo "Set HERMES_HOME=/path/to/.hermes if your install uses a custom location." >&2
  echo "Please install Hermes Agent and run: hermes setup" >&2
  exit 1
fi

if [ ! -f "$HERMES_HOME/config.yaml" ]; then
  echo "Hermes config not found: $HERMES_HOME/config.yaml" >&2
  echo "Please run: hermes setup" >&2
  exit 1
fi

if [ ! -d "$HERMES_AGENT_DIR" ]; then
  echo "Hermes Agent source directory not found: $HERMES_AGENT_DIR" >&2
  echo "Set HERMES_AGENT_DIR=/path/to/hermes-agent if your install uses a different location." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Please install Node.js LTS first." >&2
  exit 1
fi

export HERMES_HOME
export HERMES_AGENT_DIR
export HERMES_WEB_HOST="$PROXY_HOST"
export HERMES_WEB_PORT="$PROXY_PORT"
export HERMES_PROXY_TARGET="http://$PROXY_HOST:$PROXY_PORT"
export PYTHONPATH="$HERMES_AGENT_DIR:${PYTHONPATH:-}"

# Keep frontend calls relative by default so Vite can proxy /api to the backend.
export VITE_HERMES_API_URL="${VITE_HERMES_API_URL:-/api}"

PYTHON_BIN="python3"
if [ -f "$HERMES_AGENT_DIR/venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source "$HERMES_AGENT_DIR/venv/bin/activate"
  PYTHON_BIN="python"
fi

cleanup() {
  if [ -n "${PROXY_PID:-}" ] && kill -0 "$PROXY_PID" >/dev/null 2>&1; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "$WEB_UI_DIR"

if [ ! -d node_modules ]; then
  echo "Installing Web UI dependencies..."
  npm install
fi

echo "Starting Hermes REST proxy on http://$PROXY_HOST:$PROXY_PORT"
"$PYTHON_BIN" "$WEB_UI_DIR/backend/hermes_rest_proxy.py" --host "$PROXY_HOST" --port "$PROXY_PORT" &
PROXY_PID=$!

# Give the proxy a moment to bind; if it exits immediately, fail clearly.
sleep 1
if ! kill -0 "$PROXY_PID" >/dev/null 2>&1; then
  echo "Hermes REST proxy failed to start." >&2
  wait "$PROXY_PID" || true
  exit 1
fi

echo "Starting Hermes Web UI on http://$WEB_HOST:$WEB_PORT"
echo "Hermes home: $HERMES_HOME"
echo "Hermes agent: $HERMES_AGENT_DIR"
echo "Press Ctrl+C to stop both services."

npm run dev -- --host "$WEB_HOST" --port "$WEB_PORT"
