#!/bin/bash
set -euo pipefail
fixture_dir=$(cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(git -C "$fixture_dir" rev-parse --show-toplevel)
exec env -i PATH="$PATH" HOME="$HOME" docker compose \
  --project-directory "$fixture_dir" --project-name oneuptime-discord-e2e --profile test \
  --env-file "$fixture_dir/config.env" -f "$fixture_dir/compose.yml" -f "$fixture_dir/protocol.yml" "$@"
