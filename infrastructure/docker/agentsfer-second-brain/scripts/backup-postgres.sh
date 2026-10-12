#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  printf 'Usage: %s [OUTPUT_DIR]\n' "$0" >&2
}
fail() { printf 'backup-postgres: %s\n' "$*" >&2; exit 1; }

[[ $# -le 1 ]] || { usage; exit 2; }

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
project_dir=$(cd -- "$script_dir/.." && pwd -P)
compose_file="$project_dir/compose.yaml"
out_dir=${1:-"$project_dir/backups"}
command -v docker >/dev/null 2>&1 || fail 'docker is required'
[[ -f "$compose_file" ]] || fail "Compose file not found: $compose_file"
db_name=$(docker compose --project-name agentsfer-second-brain -f "$compose_file" \
  exec -T postgres sh -c 'printf %s "$POSTGRES_DB"') || fail 'cannot read configured database name'
[[ "$db_name" =~ ^[A-Za-z0-9_]+$ ]] || fail 'configured database name contains unexpected characters'
mkdir -p -- "$out_dir" || fail "cannot create output directory: $out_dir"
out_dir=$(cd -- "$out_dir" && pwd -P)

stamp=$(date -u +%Y%m%dT%H%M%SZ)
base="${db_name}-${stamp}-$$.dump"
target="$out_dir/$base"
[[ ! -e "$target" ]] || fail "refusing to overwrite existing file: $target"
tmp="$out_dir/.${base}.tmp"
[[ ! -e "$tmp" ]] || fail "temporary path already exists: $tmp"
cleanup() { rm -f -- "$tmp"; }
trap cleanup EXIT HUP INT TERM

if docker compose --project-name agentsfer-second-brain -f "$compose_file" \
  exec -T postgres sh -c 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' >"$tmp"; then
  [[ -s "$tmp" ]] || fail 'pg_dump produced an empty artifact'
  # Hard-link publication is atomic and fails rather than replacing a target.
  ln -- "$tmp" "$target" || fail "cannot publish backup without clobbering: $target"
  rm -- "$tmp"
else
  fail 'pg_dump failed; incomplete artifact removed'
fi
printf '%s\n' "$target"
