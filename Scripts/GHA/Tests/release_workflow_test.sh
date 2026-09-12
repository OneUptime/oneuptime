#!/usr/bin/env bash

# Regression coverage for release provenance. A production run used to build
# from the release event but let ncipollo/release-action target moving `master`;
# release 13.0.1 consequently mixed three commits across its Git tag, npm
# packages, and images. The tag must be pinned before downstream publishing,
# every checkout and draft-release attempt must use the immutable event SHA,
# and publication must wait until every mandatory artifact is attached.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW="${SCRIPT_DIR}/../../../.github/workflows/release.yml"

PASS=0
FAIL=0

pass() {
	PASS=$(( PASS + 1 ))
	echo "  ✅ $1"
}

fail() {
	FAIL=$(( FAIL + 1 ))
	echo "  ❌ $1" >&2
}

assert_eq() {
	local expected="$1" actual="$2" what="$3"
	if [[ "$expected" == "$actual" ]]; then
		pass "$what"
	else
		fail "$what — expected '${expected}', got '${actual}'"
	fi
}

echo "release.yml provenance"

release_action_count="$(grep -c 'uses: ncipollo/release-action@v1' "$WORKFLOW" || true)"
pinned_action_count=0

while IFS=: read -r line_number _; do
	[[ -n "$line_number" ]] || continue
	block="$(sed -n "${line_number},$(( line_number + 14 ))p" "$WORKFLOW")"
	if grep -Fq 'commit: "${{ github.sha }}"' <<< "$block"; then
		pinned_action_count=$(( pinned_action_count + 1 ))
	fi
done < <(grep -n 'uses: ncipollo/release-action@v1' "$WORKFLOW" || true)

assert_eq 3 "$release_action_count" "keeps all three idempotent draft-release attempts"
assert_eq "$release_action_count" "$pinned_action_count" "passes the release event SHA to every draft-release attempt"

moving_checkout_count="$(grep -F -c 'ref: ${{ github.ref }}' "$WORKFLOW" || true)"
immutable_checkout_count="$(grep -F -c 'ref: ${{ github.sha }}' "$WORKFLOW" || true)"
checkout_count="$(grep -c 'uses: actions/checkout@v4' "$WORKFLOW" || true)"

assert_eq 0 "$moving_checkout_count" "never checks out the moving release branch"
assert_eq "$checkout_count" "$immutable_checkout_count" "pins every release checkout to the event SHA"

assert_eq 1 "$(grep -F -c 'group: oneuptime-production-release' "$WORKFLOW" || true)" "serializes production release runs"
assert_eq 1 "$(grep -F -c 'cancel-in-progress: false' "$WORKFLOW" || true)" "never cancels a partially published release"
assert_eq 1 "$(grep -F -c 'name: Pin and verify release tag provenance' "$WORKFLOW" || true)" "pins the release tag at runtime"
assert_eq 1 "$(grep -F -c 'run: Scripts/GHA/pin_release_tag.sh "$GITHUB_REPOSITORY" "$RELEASE_TAG" "$EXPECTED_SHA"' "$WORKFLOW" || true)" "passes the immutable release identity to the tested tag pinning helper"
assert_eq 1 "$(grep -F -c 'name: Verify release tag provenance before publication' "$WORKFLOW" || true)" "re-verifies the tag immediately before publication"
assert_eq 1 "$(grep -F -c 'run: Scripts/GHA/verify_release_tag.sh "$GITHUB_REPOSITORY" "$RELEASE_TAG" "$EXPECTED_SHA"' "$WORKFLOW" || true)" "passes the immutable identity to the final tag verifier"
assert_eq 1 "$(grep -F -c 'name: Resolve previous published release tag' "$WORKFLOW" || true)" "resolves changelog history from published releases"
assert_eq 1 "$(grep -F -c 'previous_tag="$(Scripts/GHA/get_latest_published_release_tag.sh "$GITHUB_REPOSITORY")"' "$WORKFLOW" || true)" "uses the tested published-release resolver"
assert_eq 1 "$(grep -F -c 'fromTag: "${{ steps.previous_release.outputs.source_ref }}"' "$WORKFLOW" || true)" "starts changelog generation at the previously shipped source"
assert_eq 1 "$(grep -F -c 'toTag: "${{ needs.read-version.outputs.major_minor }}"' "$WORKFLOW" || true)" "ends changelog generation at the pinned version tag"
assert_eq 1 "$(grep -F -c 'failOnError: true' "$WORKFLOW" || true)" "fails the release when changelog generation fails"
assert_eq 0 "$(grep -F -c 'git rev-list --tags --skip=1' "$WORKFLOW" || true)" "never derives release history from build-number tags"
assert_eq 1 "$(grep -F -c 'commits=$(git log --pretty=format:'"'"'- %s (%h)'"'"' "$FROM_TAG..$TO_TAG")' "$WORKFLOW" || true)" "uses the changelog action's exact range for fallback notes"
assert_eq 1 "$(grep -F -c 'previous_source_ref="9a2f47ddd997f7a6d356da6eb98b9717cc115136"' "$WORKFLOW" || true)" "recovers changelog history from the source actually shipped as 13.0.1"

pin_tag_line="$(grep -n 'name: Pin and verify release tag provenance' "$WORKFLOW" | cut -d: -f1)"
first_release_action_line="$(grep -n 'uses: ncipollo/release-action@v1' "$WORKFLOW" | head -n 1 | cut -d: -f1)"
if [[ -n "$pin_tag_line" && -n "$first_release_action_line" ]] && (( pin_tag_line < first_release_action_line )); then
	pass "pins the tag before creating the draft release"
else
	fail "pins the tag before creating the draft release — ordering is unsafe"
fi

read_version_line="$(grep -n '^  read-version:' "$WORKFLOW" | cut -d: -f1)"
helm_job_line="$(grep -n '^  helm-chart-deploy:' "$WORKFLOW" | cut -d: -f1)"
read_version_block="$(sed -n "${read_version_line},$(( helm_job_line - 1 ))p" "$WORKFLOW")"
if grep -Fq 'contents: write' <<< "$read_version_block"; then
	pass "grants the gating version job permission to create the tag"
else
	fail "grants the gating version job permission to create the tag — contents write is missing"
fi

draft_job_line="$(grep -n '^  draft-github-release:' "$WORKFLOW" | cut -d: -f1)"
sbom_job_line="$(grep -n '^  generate-sboms:' "$WORKFLOW" | cut -d: -f1)"
draft_job_block="$(sed -n "${draft_job_line},$(( sbom_job_line - 1 ))p" "$WORKFLOW")"
if grep -Fq 'fetch-depth: 0' <<< "$draft_job_block"; then
	pass "fetches full history for fallback release notes"
else
	fail "fetches full history for fallback release notes — draft checkout is shallow"
fi

finalizer_line="$(grep -n '^  finalize-github-release:' "$WORKFLOW" | cut -d: -f1)"
finalizer_needs="$(sed -n "${finalizer_line},$(( finalizer_line + 20 ))p" "$WORKFLOW")"

final_verify_line="$(grep -n 'name: Verify release tag provenance before publication' "$WORKFLOW" | cut -d: -f1)"
publish_release_line="$(grep -n 'name: Publish release' "$WORKFLOW" | cut -d: -f1)"
if [[ -n "$final_verify_line" && -n "$publish_release_line" ]] && (( final_verify_line < publish_release_line )); then
	pass "checks tag provenance before making the release public"
else
	fail "checks tag provenance before making the release public — ordering is unsafe"
fi

for dependency in \
	"infrastructure-agent-deploy" \
	"generate-sboms" \
	"mobile-app-android-deploy" \
	"mobile-app-ios-deploy" \
	"publish-terraform-provider"; do
	if grep -Fq -- "- ${dependency}" <<< "$finalizer_needs"; then
		pass "publishes only after ${dependency}"
	else
		fail "publishes only after ${dependency} — dependency missing from finalizer"
	fi
done

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
