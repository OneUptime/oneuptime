#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(git rev-parse --show-toplevel)
fixture_dir="$repo_dir/.scratch/discord-e2e"
source_dir="$repo_dir/packages/E2E/Discord/Fixture"
cd "$repo_dir"
case "${1:-help}" in
  prepare)
    if [[ -f "$fixture_dir/config.env" ]]; then
      echo "Existing fixture found; retain its credentials and evidence. Use existing scripts." >&2
      exit 1
    fi
    mkdir -p "$fixture_dir"
    cp -R "$source_dir/LocalStack/." "$fixture_dir/"
    printf '*\n' > "$fixture_dir/.gitignore"
    cp "$repo_dir/packages/E2E/Discord/FAILURES.md" "$fixture_dir/FAILURES.md"
    bash "$fixture_dir/setup.sh"
    ;;
  build)
    bash "$fixture_dir/build.sh" App
    bash "$fixture_dir/build.sh" E2E
    BUILDX_CONFIG="$fixture_dir/buildx" docker build -t oneuptime-discord-e2e-ingress:local "$fixture_dir/ingress"
    BUILDX_CONFIG="$fixture_dir/buildx" docker build -f "$source_dir/Dockerfile.runner" -t oneuptime-discord-e2e-trusted-tests:local "$source_dir"
    node "$fixture_dir/setup-protocol.cjs"
    ;;
  start) bash "$fixture_dir/compose.sh" up -d --no-build app ingress discord-fixture ;;
  test)
    shift
    bash "$fixture_dir/compose.sh" run --rm --no-deps \
      -e PLAYWRIGHT_HTML_REPORT=/evidence/discord/html \
      -e PLAYWRIGHT_JSON_OUTPUT_NAME=/evidence/discord/results.json \
      -e DISCORD_E2E_OUTPUT=/evidence/discord/test-results \
      e2e npx playwright test --config playwright.discord.config.ts "$@"
    ;;
  stop) bash "$fixture_dir/compose.sh" stop ;;
  *) echo "Usage: bash packages/E2E/Discord/Fixture/local-stack.sh prepare|build|start|test [Playwright args]|stop" ;;
esac
