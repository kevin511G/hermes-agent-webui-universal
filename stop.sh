#!/usr/bin/env bash
set -euo pipefail

PROXY_HOST="${HERMES_WEB_HOST:-127.0.0.1}"
PROXY_PORT="${HERMES_WEB_PORT:-3001}"
WEB_HOST="${HERMES_WEB_UI_HOST:-127.0.0.1}"
WEB_PORT="${HERMES_WEB_UI_PORT:-3000}"

kill_port() {
  local port="$1"
  local label="$2"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  fi

  if [ -z "$pids" ] && command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "$port/tcp" 2>/dev/null || true)"
  fi

  if [ -z "$pids" ]; then
    echo "$label: no listener on port $port"
    return 0
  fi

  echo "$label: stopping PID(s) $pids on port $port"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1

  local still_running=""
  for pid in $pids; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      still_running="$still_running $pid"
    fi
  done

  if [ -n "$still_running" ]; then
    echo "$label: force stopping PID(s)$still_running"
    # shellcheck disable=SC2086
    kill -9 $still_running 2>/dev/null || true
  fi
}

echo "Stopping Hermes Web UI services..."
echo "Proxy target: $PROXY_HOST:$PROXY_PORT"
echo "Web UI target: $WEB_HOST:$WEB_PORT"

kill_port "$WEB_PORT" "Web UI"
kill_port "$PROXY_PORT" "REST proxy"

echo "Done."
