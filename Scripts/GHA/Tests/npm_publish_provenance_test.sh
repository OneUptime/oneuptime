#!/usr/bin/env bash

# Regression tests for npm release provenance checks. npm and sed are replaced
# with local stubs, so these tests never access the registry or modify packages.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISH_SCRIPT="${SCRIPT_DIR}/../../NPM/PublishAllPackages.sh"

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

assert_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" == *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — '${needle}' not found in output"
	fi
}

assert_not_contains() {
	local haystack="$1" needle="$2" what="$3"
	if [[ "$haystack" != *"$needle"* ]]; then
		pass "$what"
	else
		fail "$what — unexpectedly found '${needle}' in output"
	fi
}

count_calls() {
	local needle="$1"
	awk -v needle="$needle" 'index($0, needle) { count++ } END { print count + 0 }' "$CALL_LOG"
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

FAKE_BIN="${WORK_DIR}/bin"
mkdir -p "$FAKE_BIN"

cat > "${FAKE_BIN}/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -uo pipefail

printf '%s|%s\n' "$PWD" "$*" >> "$NPM_PUBLISH_CALL_LOG"

state_for_package() {
	local package_name="$1" configured_state
	case "$package_name" in
		@oneuptime/common)
			configured_state="${NPM_COMMON_STATE:-absent}"
			if [[ -f "${NPM_PUBLISH_STATE_DIR}/common" ]]; then
				configured_state="exact"
			fi
			;;
		@oneuptime/cli)
			configured_state="${NPM_CLI_STATE:-absent}"
			if [[ -f "${NPM_PUBLISH_STATE_DIR}/cli" ]]; then
				configured_state="exact"
			fi
			;;
		*)
			echo "Unexpected npm package: $package_name" >&2
			exit 90
			;;
	esac
	printf '%s\n' "$configured_state"
}

if [[ "${1:-}" == "view" ]]; then
	spec="${2:-}"
	field="${3:-}"
	case "$spec" in
		"@oneuptime/common@${PACKAGE_VERSION}") package_name="@oneuptime/common" ;;
		"@oneuptime/cli@${PACKAGE_VERSION}") package_name="@oneuptime/cli" ;;
		*)
			echo "Unexpected npm view spec: $spec" >&2
			exit 91
			;;
	esac
	state="$(state_for_package "$package_name")"

	if [[ "$field" == "version" ]]; then
		case "$state" in
			absent)
				echo '{"error":{"code": "E404", "summary":"version not found"}}' >&2
				exit 1
				;;
			legacy_absent)
				echo 'npm ERR! code E404' >&2
				exit 1
				;;
			registry_error)
				echo 'npm error code E500' >&2
				echo 'npm error registry unavailable' >&2
				exit 1
				;;
			*)
				if [[ "${4:-}" == "--json" ]]; then
					printf '"%s"\n' "$PACKAGE_VERSION"
				else
					printf '%s\n' "$PACKAGE_VERSION"
				fi
				exit 0
				;;
		esac
	fi

	if [[ "$field" == "gitHead" ]]; then
		case "$state" in
			exact) printf '%s\n' "$GITHUB_SHA" ;;
			mismatch) printf '%s\n' "$NPM_FOREIGN_SHA" ;;
			uppercase) printf '%s\n' "$GITHUB_SHA" | tr '[:lower:]' '[:upper:]' ;;
			missing_git_head) : ;;
			git_head_error)
				echo 'npm error code ENETUNREACH' >&2
				exit 1
				;;
			*)
				echo "gitHead requested for unexpected state: $state" >&2
				exit 92
				;;
		esac
		exit 0
	fi

	echo "Unexpected npm view field: $field" >&2
	exit 93
fi

case "${1:-}" in
	version|install|run)
		exit 0
		;;
	publish)
		case "$(basename "$PWD")" in
			Common) touch "${NPM_PUBLISH_STATE_DIR}/common" ;;
			CLI) touch "${NPM_PUBLISH_STATE_DIR}/cli" ;;
			*)
				echo "npm publish called outside a fixture package: $PWD" >&2
				exit 94
				;;
		esac
		exit 0
		;;
	*)
		echo "Unexpected npm command: $*" >&2
		exit 95
		;;
esac
FAKE_NPM
chmod +x "${FAKE_BIN}/npm"

cat > "${FAKE_BIN}/sed" <<'FAKE_SED'
#!/usr/bin/env bash
# Package rewriting is unrelated to these provenance tests. Avoid changing the
# fixture and keep the test portable across GNU and BSD sed.
exit 0
FAKE_SED
chmod +x "${FAKE_BIN}/sed"

CURRENT_SHA="0123456789abcdef0123456789abcdef01234567"
FOREIGN_SHA="fedcba9876543210fedcba9876543210fedcba98"
PACKAGE_VERSION_VALUE="9.8.7-test.1"

new_case() {
	local name="$1"
	CASE_ROOT="${WORK_DIR}/${name}"
	CALL_LOG="${CASE_ROOT}/npm.calls"
	STATE_DIR="${CASE_ROOT}/registry-state"
	mkdir -p "${CASE_ROOT}/Common" "${CASE_ROOT}/CLI" "$STATE_DIR"
	printf '{"name":"@oneuptime/common"}\n' > "${CASE_ROOT}/Common/package.json"
	printf '{"name":"@oneuptime/cli"}\n' > "${CASE_ROOT}/CLI/package.json"
	: > "$CALL_LOG"
}

run_publish() {
	(
		unset PACKAGE_VERSION GITHUB_SHA NPM_COMMON_STATE NPM_CLI_STATE
		cd "$CASE_ROOT" || exit 98
		PATH="${FAKE_BIN}:$PATH" \
			NPM_PUBLISH_CALL_LOG="$CALL_LOG" \
			NPM_PUBLISH_STATE_DIR="$STATE_DIR" \
			NPM_FOREIGN_SHA="$FOREIGN_SHA" \
			env "$@" bash "$PUBLISH_SCRIPT"
	) 2>&1
}

echo "PublishAllPackages.sh provenance"

# Required release identity is validated before any registry access.
new_case "missing-version"
status=0
output="$(run_publish GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=exact NPM_CLI_STATE=exact)" || status=$?
assert_eq 1 "$status" "rejects a missing package version"
assert_contains "$output" "Package version is required" "explains the missing package version"
assert_eq 0 "$(count_calls "npm")" "does not access npm without a package version"

new_case "missing-sha"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" NPM_COMMON_STATE=exact NPM_CLI_STATE=exact)" || status=$?
assert_eq 1 "$status" "rejects a missing immutable commit"
assert_contains "$output" "GITHUB_SHA is required" "explains the missing release commit"
assert_eq 0 "$(count_calls "npm")" "does not access npm without a release commit"

# A same-commit rerun is safe and performs no package mutation or publish.
new_case "same-sha-rerun"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=exact NPM_CLI_STATE=exact)" || status=$?
assert_eq 0 "$status" "allows a rerun of the exact same commit"
assert_contains "$output" "@oneuptime/common@${PACKAGE_VERSION_VALUE} is already published from GITHUB_SHA ${CURRENT_SHA}. Safely skipping." "reports the verified Common skip"
assert_contains "$output" "@oneuptime/cli@${PACKAGE_VERSION_VALUE} is already published from GITHUB_SHA ${CURRENT_SHA}. Safely skipping." "reports the verified CLI skip"
assert_eq 2 "$(count_calls " gitHead")" "checks gitHead for every existing package"
assert_eq 0 "$(count_calls "publish --access public")" "does not republish verified versions"
assert_eq 0 "$(count_calls "version --allow-same-version")" "does not mutate verified packages"

# A version from any other commit is an immutable collision, including a value
# that differs only in letter case: equality must be exact.
new_case "foreign-common"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=mismatch NPM_CLI_STATE=exact)" || status=$?
assert_eq 1 "$status" "rejects an existing Common version from another commit"
assert_contains "$output" "npm gitHead '${FOREIGN_SHA}' does not exactly match GITHUB_SHA '${CURRENT_SHA}'" "identifies both sides of the provenance mismatch"
assert_not_contains "$(cat "$CALL_LOG")" "@oneuptime/cli@" "stops before inspecting dependent packages after a collision"
assert_eq 0 "$(count_calls "publish --access public")" "does not publish over an immutable collision"

new_case "case-mismatch"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=uppercase NPM_CLI_STATE=exact)" || status=$?
assert_eq 1 "$status" "requires byte-for-byte gitHead equality"
assert_contains "$output" "does not exactly match GITHUB_SHA" "reports a case-only mismatch"
assert_eq 0 "$(count_calls "publish --access public")" "does not normalize and reuse a different gitHead"

# Missing or unreadable registry provenance fails closed.
new_case "missing-git-head"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=missing_git_head NPM_CLI_STATE=exact)" || status=$?
assert_eq 1 "$status" "rejects an existing version without gitHead"
assert_contains "$output" "npm did not return gitHead" "explains that registry provenance is absent"
assert_contains "$output" "provenance cannot be verified" "states why the release cannot continue"
assert_eq 0 "$(count_calls "publish --access public")" "does not publish when gitHead is missing"

new_case "git-head-lookup-error"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=git_head_error NPM_CLI_STATE=exact)" || status=$?
assert_eq 1 "$status" "rejects a failed gitHead lookup"
assert_contains "$output" "Unable to read npm gitHead" "reports the failed provenance lookup"
assert_contains "$output" "Refusing to reuse" "fails closed after the lookup error"
assert_eq 0 "$(count_calls "publish --access public")" "does not publish after a provenance lookup error"

# A registry or network failure is not proof that a version is absent.
new_case "registry-error"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=registry_error NPM_CLI_STATE=exact)" || status=$?
assert_eq 1 "$status" "rejects an indeterminate registry lookup"
assert_contains "$output" "Refusing to publish while registry state is unknown" "distinguishes registry failure from absence"
assert_contains "$output" "npm error code E500" "preserves the registry diagnostic"
assert_eq 0 "$(count_calls "gitHead")" "does not invent provenance after a failed existence lookup"
assert_eq 0 "$(count_calls "publish --access public")" "does not publish during registry uncertainty"

# Preflight is atomic across the package set: discovering that Common is absent
# must not publish it before CLI's existing provenance has also been verified.
new_case "absent-common-foreign-cli"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=absent NPM_CLI_STATE=mismatch)" || status=$?
assert_eq 1 "$status" "rejects a foreign CLI before publishing absent Common"
assert_contains "$output" "@oneuptime/common@${PACKAGE_VERSION_VALUE} is not published on npm (E404)" "preflights Common absence"
assert_contains "$output" "@oneuptime/cli@${PACKAGE_VERSION_VALUE}: npm gitHead '${FOREIGN_SHA}'" "finds the later immutable collision"
assert_eq 0 "$(count_calls "version --allow-same-version")" "does not mutate Common before all preflight checks pass"
assert_eq 0 "$(count_calls "publish --access public")" "publishes nothing when later package provenance collides"

# The same atomicity guarantee applies when CLI's registry state is unknown.
new_case "absent-common-cli-lookup-error"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=absent NPM_CLI_STATE=registry_error)" || status=$?
assert_eq 1 "$status" "stops when CLI lookup fails after confirmed Common absence"
assert_contains "$output" "@oneuptime/common@${PACKAGE_VERSION_VALUE} is not published on npm (E404)" "records Common as missing without publishing it"
assert_contains "$output" "Unable to determine whether @oneuptime/cli@${PACKAGE_VERSION_VALUE} is published" "names the later indeterminate package"
assert_contains "$output" "npm error code E500" "preserves the CLI lookup diagnostic"
assert_eq 0 "$(count_calls "version --allow-same-version")" "does not mutate Common during later registry uncertainty"
assert_eq 0 "$(count_calls "publish --access public")" "publishes nothing when a later lookup is uncertain"

# A confirmed E404 remains the only path to a new publish. The fake registry
# records each publish so the Common propagation check can also complete.
new_case "new-release"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=absent NPM_CLI_STATE=absent)" || status=$?
assert_eq 0 "$status" "publishes packages after confirmed E404 responses"
assert_contains "$output" "@oneuptime/common@${PACKAGE_VERSION_VALUE} is not published on npm (E404). It will be published from GITHUB_SHA ${CURRENT_SHA} after all package preflight checks pass." "reports the verified Common absence"
assert_contains "$output" "@oneuptime/cli@${PACKAGE_VERSION_VALUE} is not published on npm (E404). It will be published from GITHUB_SHA ${CURRENT_SHA} after all package preflight checks pass." "reports the verified CLI absence"
assert_eq 2 "$(count_calls "version --allow-same-version ${PACKAGE_VERSION_VALUE}")" "versions both new packages"
assert_eq 2 "$(count_calls "publish --access public")" "publishes both new packages"
assert_contains "$(cat "$CALL_LOG")" "${CASE_ROOT}/Common|publish --access public" "publishes Common from its package directory"
assert_contains "$(cat "$CALL_LOG")" "${CASE_ROOT}/CLI|publish --access public" "publishes CLI from its package directory"

# A partial rerun verifies the completed package and publishes only the missing
# dependent package. This is the recovery path for an interrupted release.
new_case "partial-rerun"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=exact NPM_CLI_STATE=absent)" || status=$?
assert_eq 0 "$status" "resumes a same-commit partial release"
assert_contains "$output" "@oneuptime/common@${PACKAGE_VERSION_VALUE} is already published from GITHUB_SHA ${CURRENT_SHA}. Safely skipping." "verifies the completed package before resuming"
assert_eq 1 "$(count_calls "publish --access public")" "publishes only the missing package"
assert_not_contains "$(cat "$CALL_LOG")" "${CASE_ROOT}/Common|publish --access public" "does not republish Common"
assert_contains "$(cat "$CALL_LOG")" "${CASE_ROOT}/CLI|publish --access public" "publishes the missing CLI package"

# Provenance is enforced independently for later packages as well.
new_case "foreign-cli"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=exact NPM_CLI_STATE=mismatch)" || status=$?
assert_eq 1 "$status" "rejects an existing CLI version from another commit"
assert_contains "$output" "@oneuptime/cli@${PACKAGE_VERSION_VALUE}: npm gitHead '${FOREIGN_SHA}'" "names the colliding dependent package"
assert_eq 2 "$(count_calls " gitHead")" "checks provenance on both packages before detecting the CLI collision"
assert_eq 0 "$(count_calls "publish --access public")" "does not publish anything during a partial collision"

# npm 6 and earlier used the legacy error prefix; it is still an explicit 404,
# so interrupted releases remain recoverable across supported npm output forms.
new_case "legacy-e404"
status=0
output="$(run_publish PACKAGE_VERSION="$PACKAGE_VERSION_VALUE" GITHUB_SHA="$CURRENT_SHA" NPM_COMMON_STATE=legacy_absent NPM_CLI_STATE=exact)" || status=$?
assert_eq 0 "$status" "recognizes the legacy npm E404 format"
assert_eq 1 "$(count_calls "publish --access public")" "publishes only the legacy-E404 package"

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"

if [[ "$FAIL" -gt 0 ]]; then
	exit 1
fi
