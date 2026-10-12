#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p data/document-manager
if [[ -f data/document-manager/manager.pid ]] && kill -0 "$(<data/document-manager/manager.pid)" 2>/dev/null; then
  echo "Document Manager already running (pid $(<data/document-manager/manager.pid))"
  exit 0
fi
if ss -ltn 'sport = :8765' | grep -q LISTEN; then
  echo "Port 8765 is already in use; refusing to replace another process" >&2
  exit 1
fi
nohup python3 -u document-manager/server.py >> data/document-manager/server.log 2>&1 < /dev/null &
echo "$!" > data/document-manager/manager.pid
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8765/api/health >/dev/null; then
    echo "Second Brain Document Manager ready at http://127.0.0.1:8765 (pid $(<data/document-manager/manager.pid))"
    exit 0
  fi
  sleep 1
done
echo "Manager failed to become ready; see data/document-manager/server.log" >&2
exit 1
