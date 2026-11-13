#!/usr/bin/env bash
set -euo pipefail

# Running without --apply is entirely local and does not create a backup or delete files.
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != '--apply' ) ]]; then
  printf '%s\n' 'Usage: bash scripts/maintenance-daily.sh [--apply]' >&2
  exit 2
fi
maintenance_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$maintenance_root"
umask 077
maintenance_command=(node "$maintenance_root/node_modules/tsx/dist/cli.mjs" "$maintenance_root/scripts/class-maintenance.ts")
maintenance_target=(--project wooriban-2027 --class-id 2027-1-11)
maintenance_execute=()
if [[ "${1:-}" == '--apply' ]]; then
  maintenance_execute=(--apply --confirm wooriban-2027/2027-1-11)
fi
"${maintenance_command[@]}" backup "${maintenance_target[@]}" --reason scheduled "${maintenance_execute[@]}"
"${maintenance_command[@]}" prune-local "${maintenance_target[@]}" --keep-last 30 --older-than-days 30 "${maintenance_execute[@]}"
"${maintenance_command[@]}" cleanup-login-limits "${maintenance_target[@]}" "${maintenance_execute[@]}"
