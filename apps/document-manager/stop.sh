#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/data/document-manager/manager.pid"
if [[ ! -f "$PIDFILE" ]]; then echo "Document Manager is not running"; exit 0; fi
pid="$(<"$PIDFILE")"
if ! kill -0 "$pid" 2>/dev/null; then rm -f "$PIDFILE"; echo "Removed stale PID file"; exit 0; fi
cmd="$(ps -p "$pid" -o args= || true)"
if [[ "$cmd" != *"document-manager/server.py"* ]]; then echo "PID $pid is not the Document Manager; refusing to stop it" >&2; exit 1; fi
kill "$pid"
for _ in $(seq 1 15); do
  if ! kill -0 "$pid" 2>/dev/null; then rm -f "$PIDFILE"; echo "Document Manager stopped (pid $pid)"; exit 0; fi
  sleep 1
done
echo "Manager did not stop promptly; inspect pid $pid" >&2
exit 1
