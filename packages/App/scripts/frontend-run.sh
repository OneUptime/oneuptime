#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <FrontendDirName> <NpmScript> [script args...]" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd "${script_dir}/.." && pwd)"

frontend_dir_name="$1"
shift

frontend_script="$1"
shift

if [ -d "${app_dir}/${frontend_dir_name}" ]; then
  frontend_dir="${app_dir}/${frontend_dir_name}"
elif [ -d "${app_dir}/../${frontend_dir_name}" ]; then
  frontend_dir="${app_dir}/../${frontend_dir_name}"
else
  echo "Frontend directory not found for ${frontend_dir_name}" >&2
  exit 1
fi

if ! npm --prefix "$frontend_dir" ls --depth=0 >/dev/null 2>&1; then
  echo "Installing missing dependencies for ${frontend_dir_name}..."
  npm --prefix "$frontend_dir" install
fi

if [ "$#" -gt 0 ]; then
  npm --prefix "$frontend_dir" run "$frontend_script" -- "$@"
else
  npm --prefix "$frontend_dir" run "$frontend_script"
fi
