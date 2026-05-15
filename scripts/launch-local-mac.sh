#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4173}"
LOCAL_HEALTH_URL="http://127.0.0.1:${PORT}/"
URL="http://localhost:${PORT}/#autostart"
STDOUT="${ROOT}/.tmp-serve.log"
STDERR="${ROOT}/.tmp-serve.err.log"

find_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return
  fi

  for candidate in "${HOME}/.bun/bin/bun" "${HOME}/.hermes/node/bin/bun"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  return 1
}

curl_local() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    curl --noproxy "*" -fsS --max-time 1 "$@"
}

app_ready() {
  curl_local "$LOCAL_HEALTH_URL" 2>/dev/null | grep -q "简单GTO"
}

port_open() {
  nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1
}

BUN="$(find_bun)" || {
  echo "未找到 Bun。请先安装 Bun，或确认 bun 在 PATH 中。"
  exit 1
}

if port_open && ! app_ready; then
  echo "端口 ${PORT} 已被其他程序占用。请关闭占用程序后再打开简单GTO。"
  exit 1
fi

if app_ready; then
  open "$URL"
  exit 0
fi

(
  cd "$ROOT"
  PORT="$PORT" "$BUN" run serve >"$STDOUT" 2>"$STDERR" &
  server_pid=$!

  cleanup() {
    if kill -0 "$server_pid" >/dev/null 2>&1; then
      kill "$server_pid" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup EXIT INT TERM

  ready=false
  for _ in $(seq 1 20); do
    sleep 0.25
    if app_ready; then
      ready=true
      break
    fi
    if ! kill -0 "$server_pid" >/dev/null 2>&1; then
      break
    fi
  done

  if [ "$ready" != true ]; then
    echo "本地服务未能启动，请查看：${STDERR}"
    exit 1
  fi

  open "$URL"
  echo "简单GTO 已打开。保持此终端运行；停止服务请按 Ctrl+C。"
  wait "$server_pid"
)
