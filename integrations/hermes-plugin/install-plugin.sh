#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  printf 'Usage: %s /absolute/path/to/company/HERMES_HOME\n' "$0" >&2
  exit 2
fi
home=$(realpath -m -- "$1")
if [[ "$home" == / || ! -d "$home" ]]; then
  printf 'Refusing invalid/nonexistent HERMES_HOME: %s\n' "$home" >&2
  exit 2
fi
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/hindsight" && pwd)
target="$home/plugins/hindsight"
if [[ -e "$target" ]]; then
  printf 'Refusing to overwrite existing provider: %s\n' "$target" >&2
  exit 3
fi
install -d -m 0700 -- "$home/plugins"
cp -a -- "$source_dir" "$target"
chmod -R go-rwx -- "$target"
printf 'Installed provider files at %s\n' "$target"
printf 'Provider is NOT activated. Configure company bank, then select memory.provider=hindsight in this isolated profile.\n'
