#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s BACKUP.dump\nRequired env: PGRESTORE_TEST_DATABASE\n' "$0" >&2
}
fail() { printf 'restore-postgres-test: %s\n' "$*" >&2; exit 1; }

[[ $# -eq 1 ]] || { usage; exit 2; }
: "${PGRESTORE_TEST_DATABASE:?PGRESTORE_TEST_DATABASE is required}"
backup=$1
test_db=$PGRESTORE_TEST_DATABASE
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
project_dir=$(cd -- "$script_dir/.." && pwd -P)
compose_file="$project_dir/compose.yaml"
[[ -f "$backup" && -r "$backup" ]] || fail "backup file is not readable: $backup"
[[ "$test_db" =~ ^restore_test_[a-zA-Z0-9_]+$ ]] || fail 'target must be an explicitly provisioned disposable database named restore_test_<suffix>'
command -v docker >/dev/null 2>&1 || fail 'docker is required'
[[ -f "$compose_file" ]] || fail "Compose file not found: $compose_file"

# No destructive restore options or database creation are used. Target
# must already exist, be empty/disposable, and be isolated from production.
if ! docker compose --project-name agentsfer-second-brain -f "$compose_file" \
  exec -T postgres sh -c 'exec pg_restore --username="$POSTGRES_USER" --dbname="$1" --exit-on-error --no-owner --no-privileges' sh "$test_db" <"$backup"; then
  fail 'restore failed; inspect the isolated test database; no automatic cleanup performed'
fi
printf 'Restored %s into isolated test target %s; verify application data before discarding it.\n' "$backup" "$test_db"
