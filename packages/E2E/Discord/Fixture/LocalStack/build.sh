#!/bin/bash
set -euo pipefail
fixture_dir=$(cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(git -C "$fixture_dir" rev-parse --show-toplevel)
export BUILDX_CONFIG="$fixture_dir/buildx"
mkdir -p "$BUILDX_CONFIG"
target=${1:?Use App or E2E}
case "$target" in App) image=oneuptime-discord-e2e-app:local; target_args=(--target community);; E2E) image=oneuptime-discord-e2e-tests:local; target_args=();; *) exit 2;; esac
source_sha=$(node -p "require('$fixture_dir/source.json').head")
source_version=$(node -p "require('$fixture_dir/source.json').appVersion")
set +e
docker run --rm --network none -v oneuptime-discord-e2e_source:/source:ro redis:7-bookworm tar -C /source -cf - . \
  | docker build --progress plain "${target_args[@]}" --build-arg "GIT_SHA=$source_sha" --build-arg "APP_VERSION=$source_version" -f ".fixture/$target.Dockerfile" -t "$image" - 2>&1 \
  | docker run --rm -i --network none -v oneuptime-discord-e2e_evidence:/evidence redis:7-bookworm sh -c 'cat > "/evidence/$1-build.log"' sh "$target"
build_status=$?
set -e
printf '%s build exit=%s image=%s source=%s\n' "$target" "$build_status" "$image" "$source_sha"
exit "$build_status"
