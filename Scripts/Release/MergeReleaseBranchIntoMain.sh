#!/usr/bin/env bash
#
# Merges a release branch into main, so main has every fix made for the
# release as soon as it is pushed:
#
#   bash Scripts/Release/MergeReleaseBranchIntoMain.sh release-14.0.106
#
# It touches no working tree: the merge is computed by `git merge-tree` (git
# 2.38 or newer), committed with `git commit-tree` as "Merge <branch> into
# main" (main first, the release branch second) and pushed to main. If main
# moved while it worked, it fetches and merges again. If the release branch
# is already in main, it says so and pushes nothing. If the two conflict, it
# pushes nothing, prints the conflicts and exits 1: merge them by hand in a
# checkout, keeping both sides' intent.
#
# RELEASING.md says when to run it: after every push to the release branch,
# and once more when its pull request has merged into `release`.

set -euo pipefail

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: $0 <release branch, e.g. release-14.0.106>" >&2
  exit 2
fi

RELEASE_BRANCH=$1
REMOTE=${REMOTE:-origin}

for attempt in 1 2 3 4 5; do
  git fetch --quiet "$REMOTE" main "$RELEASE_BRANCH"
  main=$(git rev-parse "refs/remotes/$REMOTE/main")
  branch=$(git rev-parse "refs/remotes/$REMOTE/$RELEASE_BRANCH")

  if git merge-base --is-ancestor "$branch" "$main"; then
    echo "main already has $RELEASE_BRANCH ($(git rev-parse --short "$branch"))."
    exit 0
  fi

  if ! merged=$(git merge-tree --write-tree --name-only "$main" "$branch"); then
    echo "$RELEASE_BRANCH conflicts with main; nothing was pushed. The conflicts:" >&2
    echo "$merged" | tail -n +2 >&2
    echo "Merge it by hand: git checkout -B merge-$RELEASE_BRANCH $REMOTE/main && git merge --no-ff $REMOTE/$RELEASE_BRANCH" >&2
    exit 1
  fi

  tree=$(echo "$merged" | head -n 1)
  commit=$(git commit-tree "$tree" -p "$main" -p "$branch" \
    -m "Merge $RELEASE_BRANCH into main")

  if git push --quiet "$REMOTE" "$commit:refs/heads/main"; then
    echo "Merged $RELEASE_BRANCH ($(git rev-parse --short "$branch")) into main as $(git rev-parse --short "$commit")."
    exit 0
  fi

  echo "main moved while merging (attempt $attempt); fetching and merging again." >&2
done

echo "Could not push the merge after 5 attempts; nothing is left half-done." >&2
exit 1
