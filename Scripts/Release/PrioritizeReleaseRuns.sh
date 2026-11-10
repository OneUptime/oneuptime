#!/usr/bin/env bash
#
# Gives a release the GitHub Actions runners: cancels every queued or running
# workflow run that is not the release's own, again and again, so the runs
# that pushes to main and other pull requests start keep landing on cancelled.
#
#   bash Scripts/Release/PrioritizeReleaseRuns.sh release-14.0.106
#   bash Scripts/Release/PrioritizeReleaseRuns.sh release-14.0.106 --once
#
# The release's own runs are the ones whose branch is `release` (the release
# workflow, after the release pull request merges) or the release branch
# named here (its pull request's checks). Everything else - pushes to main,
# other pull requests, scheduled runs - is cancelled, and can be re-run once
# the release is out. RELEASING.md says when to start and stop this.
#
# It runs until it is stopped (Ctrl-C, or kill), checking once a minute; with
# --once it checks once and exits. Each cancel is printed with the run's id,
# branch, event and workflow. It needs the GitHub CLI, signed in to an
# account that may cancel runs on the repository (REPO, OneUptime/oneuptime
# by default).

set -u

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: $0 <release branch, e.g. release-14.0.106> [--once]" >&2
  exit 2
fi

RELEASE_BRANCH=$1
ONCE=${2:-}
REPO=${REPO:-OneUptime/oneuptime}
INTERVAL_SECONDS=${INTERVAL_SECONDS:-60}

is_release_run() {
  [ "$1" = "release" ] || [ "$1" = "$RELEASE_BRANCH" ]
}

list_unfinished_runs() {
  local status
  for status in requested waiting pending queued in_progress; do
    gh api --paginate "repos/$REPO/actions/runs?status=$status&per_page=100" \
      --jq '.workflow_runs[] | [.id, (.head_branch // ""), .event, .name] | @tsv' \
      2>/dev/null || true
  done | sort -u
}

while true; do
  list_unfinished_runs | while IFS=$'\t' read -r id branch event name; do
    [ -n "$id" ] || continue
    if is_release_run "$branch"; then
      continue
    fi
    if gh api -X POST "repos/$REPO/actions/runs/$id/cancel" >/dev/null 2>&1; then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) cancelled $id ($branch, $event): $name"
    fi
  done

  if [ "$ONCE" = "--once" ]; then
    break
  fi
  sleep "$INTERVAL_SECONDS"
done
