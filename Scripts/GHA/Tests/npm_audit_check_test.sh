#!/usr/bin/env bash

# Regression tests for the repository-wide npm audit gate. The real repository
# has many independent package-lock files, so a root-only audit is a false
# positive. These tests use a fake npm executable and temporary project trees;
# they never contact the registry.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_SCRIPT="${SCRIPT_DIR}/../../../npm-audit-check.sh"

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

count_lines() {
	local file="$1"
	if [[ ! -f "$file" ]]; then
		echo 0
		return
	fi
	wc -l < "$file" | tr -d ' '
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

FAKE_BIN="${WORK_DIR}/bin"
mkdir -p "$FAKE_BIN"

cat > "${FAKE_BIN}/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -uo pipefail

printf '%s\t%s\n' "$PWD" "$*" >> "$NPM_AUDIT_CALL_LOG"

if [[ -n "${NPM_AUDIT_INVALID_SUFFIX:-}" && "$PWD" == *"$NPM_AUDIT_INVALID_SUFFIX" ]]; then
	echo "this is not an npm audit report"
	exit "${NPM_AUDIT_FAIL_CODE:-1}"
fi

if [[ -n "${NPM_AUDIT_FAIL_SUFFIX:-}" && "$PWD" == *"$NPM_AUDIT_FAIL_SUFFIX" ]]; then
	cat <<'JSON'
{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "fixture-leaf": {
      "name": "fixture-leaf",
      "severity": "high",
      "isDirect": false,
      "via": [{
        "source": 12345,
        "name": "fixture-leaf",
        "dependency": "fixture-leaf",
        "title": "Fixture vulnerability",
        "url": "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
        "severity": "high",
        "range": "<2.0.0"
      }],
      "effects": ["fixture-parent"],
      "range": "<2.0.0",
      "nodes": ["node_modules/fixture-leaf"],
      "fixAvailable": false
    },
    "fixture-parent": {
      "name": "fixture-parent",
      "severity": "high",
      "isDirect": true,
      "via": ["fixture-leaf"],
      "effects": [],
      "range": "*",
      "nodes": ["node_modules/fixture-parent"],
      "fixAvailable": false
    }
  },
  "metadata": {
    "vulnerabilities": {"info": 0, "low": 0, "moderate": 0, "high": 2, "critical": 0, "total": 2}
  }
}
JSON
	exit "${NPM_AUDIT_FAIL_CODE:-1}"
fi

cat <<'JSON'
{
  "auditReportVersion": 2,
  "vulnerabilities": {},
  "metadata": {
    "vulnerabilities": {"info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0, "total": 0}
  }
}
JSON
exit 0
FAKE_NPM
chmod +x "${FAKE_BIN}/npm"

make_package() {
	local root="$1" relative="$2" with_lock="$3"
	local directory="${root}/${relative}"
	mkdir -p "$directory"
	printf '{"name":"fixture"}\n' > "${directory}/package.json"
	if [[ "$with_lock" == "true" ]]; then
		printf '{"lockfileVersion":3}\n' > "${directory}/package-lock.json"
	fi
}

run_audit() {
	local root="$1"
	shift
	NPM_AUDIT_ROOT="$root" \
		NPM_AUDIT_CALL_LOG="$CALL_LOG" \
		PATH="${FAKE_BIN}:$PATH" \
		"$@" bash "$AUDIT_SCRIPT" 2>&1
}

echo "npm-audit-check.sh"

# Every independent lockfile is audited, packages without locks are reported,
# node_modules is ignored, and spaces in a directory name are preserved.
CASE_ROOT="${WORK_DIR}/complete-tree"
make_package "$CASE_ROOT" "." true
make_package "$CASE_ROOT" "packages/api" true
make_package "$CASE_ROOT" "packages/worker with spaces" true
make_package "$CASE_ROOT" "packages/unlocked" false
make_package "$CASE_ROOT" "node_modules/hidden" true
make_package "$CASE_ROOT" ".claude/worktrees/hidden" true
make_package "$CASE_ROOT" ".codex/worktrees/hidden" true
make_package "$CASE_ROOT" "build/hidden" true
make_package "$CASE_ROOT" "dist/hidden" true
make_package "$CASE_ROOT" "coverage/hidden" true
make_package "$CASE_ROOT" ".cache/hidden" true
CALL_LOG="${WORK_DIR}/complete-tree.calls"
status=0
output="$(run_audit "$CASE_ROOT" env)" || status=$?
assert_eq 0 "$status" "passes when every locked project passes"
assert_eq 3 "$(count_lines "$CALL_LOG")" "audits every real lockfile exactly once"
assert_contains "$output" "Auditing ." "labels the root project clearly"
assert_contains "$output" "Auditing ./packages/worker with spaces" "handles spaces in project paths"
assert_contains "$output" "Skipping ./packages/unlocked" "reports packages without lockfiles"
assert_not_contains "$output" "node_modules/hidden" "does not scan installed dependencies"
assert_not_contains "$output" ".claude/worktrees/hidden" "does not scan Claude worktrees"
assert_not_contains "$output" ".codex/worktrees/hidden" "does not scan Codex worktrees"
assert_not_contains "$output" "build/hidden" "does not scan generated build trees"
assert_not_contains "$output" "dist/hidden" "does not scan generated distribution trees"
assert_not_contains "$output" "coverage/hidden" "does not scan coverage output"
assert_not_contains "$output" ".cache/hidden" "does not scan cache output"
assert_contains "$output" "Audited 3 npm project(s); skipped 1" "prints complete scan totals"
assert_contains "$(cat "$CALL_LOG")" "audit --json --audit-level=low" "defaults to the strict low threshold"

# A failure in one project makes the aggregate fail, but does not prevent later
# projects from being checked or hide npm's diagnostic output.
CASE_ROOT="${WORK_DIR}/one-failure"
make_package "$CASE_ROOT" "." true
make_package "$CASE_ROOT" "a-failing" true
make_package "$CASE_ROOT" "z-still-audited" true
CALL_LOG="${WORK_DIR}/one-failure.calls"
status=0
output="$(run_audit "$CASE_ROOT" env NPM_AUDIT_FAIL_SUFFIX="/a-failing" NPM_AUDIT_FAIL_CODE=42)" || status=$?
assert_eq 1 "$status" "returns a stable non-zero status when any audit fails"
assert_eq 3 "$(count_lines "$CALL_LOG")" "continues auditing after a project fails"
assert_contains "$output" "fixture-leaf (high)" "reports the vulnerable dependency"
assert_contains "$output" "fixture-parent (high)" "reports affected parent dependencies"
assert_contains "$output" "Dependency audit failed in 1 project(s): ./a-failing" "names every failing project"
assert_contains "$output" "Audited 3 npm project(s)" "still reports the full aggregate"

# Multiple failing package trees are all named in the final result.
CASE_ROOT="${WORK_DIR}/multiple-failures"
make_package "$CASE_ROOT" "first/broken" true
make_package "$CASE_ROOT" "second/broken" true
CALL_LOG="${WORK_DIR}/multiple-failures.calls"
status=0
output="$(run_audit "$CASE_ROOT" env NPM_AUDIT_FAIL_SUFFIX="/broken")" || status=$?
assert_eq 1 "$status" "fails when multiple package trees are vulnerable"
assert_eq 2 "$(count_lines "$CALL_LOG")" "runs all failing audits"
assert_contains "$output" "Dependency audit failed in 2 project(s):" "reports the number of failures"
assert_contains "$output" "./first/broken" "reports the first failed tree"
assert_contains "$output" "./second/broken" "reports the second failed tree"

# The severity is configurable for emergency or focused use and is passed to
# npm exactly once, without weakening the default used above.
CASE_ROOT="${WORK_DIR}/custom-level"
make_package "$CASE_ROOT" "." true
CALL_LOG="${WORK_DIR}/custom-level.calls"
status=0
output="$(run_audit "$CASE_ROOT" env NPM_AUDIT_LEVEL=critical)" || status=$?
assert_eq 0 "$status" "accepts a supported custom severity"
assert_contains "$(cat "$CALL_LOG")" "audit --json --audit-level=critical" "forwards the custom severity to npm"
assert_contains "$output" "passed at level critical" "reports the active threshold"

# Invalid configuration fails before npm is called, so a typo cannot silently
# turn security checks off.
CASE_ROOT="${WORK_DIR}/invalid-level"
make_package "$CASE_ROOT" "." true
CALL_LOG="${WORK_DIR}/invalid-level.calls"
status=0
output="$(run_audit "$CASE_ROOT" env NPM_AUDIT_LEVEL=urgent)" || status=$?
assert_eq 2 "$status" "rejects an unknown audit severity"
assert_eq 0 "$(count_lines "$CALL_LOG")" "does not call npm with invalid configuration"
assert_contains "$output" "Invalid NPM_AUDIT_LEVEL 'urgent'" "explains the configuration error"

# A reviewed exception is scoped to one project and one GHSA. Its transitive
# parents may pass, but the same advisory in another project remains a failure.
CASE_ROOT="${WORK_DIR}/reviewed-exception"
make_package "$CASE_ROOT" "MobileApp" true
cat > "${CASE_ROOT}/npm-audit-exceptions.json" <<'JSON'
{
  "MobileApp": [{
    "advisory": "GHSA-aaaa-bbbb-cccc",
    "expires": "2999-12-31",
    "reason": "The fixture has no compatible fixed release."
  }]
}
JSON
CALL_LOG="${WORK_DIR}/reviewed-exception.calls"
status=0
output="$(run_audit "$CASE_ROOT" env NPM_AUDIT_FAIL_SUFFIX="/MobileApp")" || status=$?
assert_eq 0 "$status" "allows a reviewed, unexpired project exception"
assert_contains "$output" "allowed 2 dependency node(s) through GHSA-AAAA-BBBB-CCCC" "reports the exception and its transitive impact"
assert_contains "$output" "review by 2999-12-31" "prints the mandatory review deadline"

make_package "$CASE_ROOT" "OtherApp" true
CALL_LOG="${WORK_DIR}/wrong-project.calls"
status=0
output="$(run_audit "$CASE_ROOT" env NPM_AUDIT_FAIL_SUFFIX="App")" || status=$?
assert_eq 1 "$status" "does not apply an exception to another project"
assert_contains "$output" "Dependency audit failed in 1 project(s): ./OtherApp" "identifies the unapproved project"

# Exceptions expire and stale exceptions fail once the advisory disappears,
# forcing the repository to revisit rather than accumulate permanent ignores.
CASE_ROOT="${WORK_DIR}/expired-exception"
make_package "$CASE_ROOT" "MobileApp" true
cat > "${CASE_ROOT}/npm-audit-exceptions.json" <<'JSON'
{
  "MobileApp": [{
    "advisory": "GHSA-aaaa-bbbb-cccc",
    "expires": "2000-01-01",
    "reason": "This exception is intentionally expired."
  }]
}
JSON
CALL_LOG="${WORK_DIR}/expired-exception.calls"
status=0
output="$(run_audit "$CASE_ROOT" env NPM_AUDIT_FAIL_SUFFIX="/MobileApp")" || status=$?
assert_eq 1 "$status" "rejects an expired exception"
assert_contains "$output" "expired on 2000-01-01" "explains why the exception no longer applies"

CASE_ROOT="${WORK_DIR}/stale-exception"
make_package "$CASE_ROOT" "MobileApp" true
cat > "${CASE_ROOT}/npm-audit-exceptions.json" <<'JSON'
{
  "MobileApp": [{
    "advisory": "GHSA-aaaa-bbbb-cccc",
    "expires": "2999-12-31",
    "reason": "This exception should be removed after the fix lands."
  }]
}
JSON
CALL_LOG="${WORK_DIR}/stale-exception.calls"
status=0
output="$(run_audit "$CASE_ROOT" env)" || status=$?
assert_eq 1 "$status" "rejects a stale exception after an advisory disappears"
assert_contains "$output" "remove unused audit exception(s)" "tells maintainers to remove a stale exception"

# Malformed or operational npm output cannot be mistaken for a clean report.
CASE_ROOT="${WORK_DIR}/invalid-report"
make_package "$CASE_ROOT" "." true
CALL_LOG="${WORK_DIR}/invalid-report.calls"
status=0
output="$(run_audit "$CASE_ROOT" env NPM_AUDIT_INVALID_SUFFIX="/invalid-report")" || status=$?
assert_eq 1 "$status" "fails when npm does not return audit JSON"
assert_contains "$output" "cannot parse npm audit output" "reports malformed npm output"

# A missing or empty scan root must not produce a false green result.
CALL_LOG="${WORK_DIR}/missing-root.calls"
status=0
output="$(run_audit "${WORK_DIR}/does-not-exist" env)" || status=$?
assert_eq 2 "$status" "rejects a missing audit root"
assert_eq 0 "$(count_lines "$CALL_LOG")" "does not call npm for a missing root"
assert_contains "$output" "Audit root does not exist" "explains a missing root"

CASE_ROOT="${WORK_DIR}/no-lockfiles"
make_package "$CASE_ROOT" "." false
make_package "$CASE_ROOT" "nested" false
CALL_LOG="${WORK_DIR}/no-lockfiles.calls"
status=0
output="$(run_audit "$CASE_ROOT" env)" || status=$?
assert_eq 1 "$status" "fails instead of passing when no lockfiles were audited"
assert_eq 0 "$(count_lines "$CALL_LOG")" "does not call npm without a lockfile"
assert_contains "$output" "No npm lockfiles were audited" "explains an empty audit"

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
