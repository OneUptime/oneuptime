#!/usr/bin/env bash

# Regression tests for npm-audit-fix.sh, the nightly job that runs
# `npm audit fix` in every project and opens a PR with the result.
#
# A fix can remove an advisory from a project's tree, and the audit gate fails
# on any exception left covering nothing. That is how the job's own PR, and
# then master, went red on GHSA-vcc3-ghjq-m6fr, so the job now prunes those
# exceptions as it goes. These tests pin that down with a fake npm and
# temporary project trees; they never contact the registry.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
FIX_SCRIPT="${REPO_ROOT}/npm-audit-fix.sh"
VALIDATOR="${REPO_ROOT}/Scripts/Security/ValidateNpmAudit.js"

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

# How many npm calls ran in a directory with the given arguments.
count_calls() {
	local directory="$1" arguments="$2"
	grep -cxF "${directory}"$'\t'"${arguments}" "$CALL_LOG"
}

# Whether, in a directory, the first npm call with the first arguments came
# before the first call with the second.
called_before() {
	local directory="$1" first="$2" second="$3"
	local first_line second_line
	first_line="$(grep -nxF "${directory}"$'\t'"${first}" "$CALL_LOG" | head -n 1 | cut -d: -f1)"
	second_line="$(grep -nxF "${directory}"$'\t'"${second}" "$CALL_LOG" | head -n 1 | cut -d: -f1)"
	if [[ -n "$first_line" && -n "$second_line" ]] && (( first_line < second_line )); then
		echo true
	else
		echo false
	fi
}

# The advisories a project's exceptions name, one per line, in file order.
exceptions_for() {
	local file="$1" project="$2"
	node -e '
		const configuration = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
		if (!(process.argv[2] in configuration)) { console.log("<no key>"); process.exit(0); }
		(configuration[process.argv[2]] || []).forEach((entry) => console.log(entry.advisory));
	' "$file" "$project"
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

FAKE_BIN="${WORK_DIR}/bin"
mkdir -p "$FAKE_BIN"

# `npm audit fix` records that it ran, marks the project fixed, and exits
# NPM_FAKE_FIX_STATUS. `npm audit --json` reports GHSA-aaaa-bbbb-cccc for a
# project whose path ends in NPM_FAKE_VULNERABLE_SUFFIX, or ends in
# NPM_FAKE_FIXED_BY_FIX_SUFFIX and has not been fixed yet; prints garbage for
# NPM_FAKE_INVALID_SUFFIX; exits non-zero on an empty report for
# NPM_FAKE_EMPTY_FAILURE_SUFFIX; and otherwise reports a clean tree.
cat > "${FAKE_BIN}/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -uo pipefail

printf '%s\t%s\n' "$PWD" "$*" >> "$NPM_FAKE_CALL_LOG"

if [[ "$*" == "audit fix" ]]; then
	touch .fake-npm-fixed
	exit "${NPM_FAKE_FIX_STATUS:-0}"
fi

vulnerable=false
if [[ -n "${NPM_FAKE_VULNERABLE_SUFFIX:-}" && "$PWD" == *"$NPM_FAKE_VULNERABLE_SUFFIX" ]]; then
	vulnerable=true
fi
if [[ -n "${NPM_FAKE_FIXED_BY_FIX_SUFFIX:-}" && "$PWD" == *"$NPM_FAKE_FIXED_BY_FIX_SUFFIX" && ! -e .fake-npm-fixed ]]; then
	vulnerable=true
fi

if [[ "$*" != "audit --json" ]]; then
	echo "unexpected npm call: $*" >&2
	exit 99
fi

if [[ -n "${NPM_FAKE_INVALID_SUFFIX:-}" && "$PWD" == *"$NPM_FAKE_INVALID_SUFFIX" ]]; then
	echo "npm ERR! network request failed"
	exit 1
fi

if [[ "$vulnerable" == "true" ]]; then
	cat <<'JSON'
{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "fixture-leaf": {
      "name": "fixture-leaf",
      "severity": "moderate",
      "via": [{
        "source": 12345,
        "name": "fixture-leaf",
        "url": "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
        "severity": "moderate"
      }],
      "effects": [],
      "nodes": ["node_modules/fixture-leaf"]
    }
  }
}
JSON
	exit 1
fi

if [[ -n "${NPM_FAKE_EMPTY_FAILURE_SUFFIX:-}" && "$PWD" == *"$NPM_FAKE_EMPTY_FAILURE_SUFFIX" ]]; then
	echo '{"auditReportVersion": 2, "vulnerabilities": {}}'
	exit 1
fi

echo '{"auditReportVersion": 2, "vulnerabilities": {}}'
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

run_fix() {
	local root="$1"
	shift
	(
		cd "$root" || exit 1
		NPM_FAKE_CALL_LOG="$CALL_LOG" PATH="${FAKE_BIN}:$PATH" "$@" bash "$FIX_SCRIPT" 2>&1
	)
}

echo "npm-audit-fix.sh"

# The incident: MobileApp reports the advisory until `npm audit fix` runs, and
# not after. Its exception goes - which only happens if the audit that decides
# is the one after the fix. An exception whose advisory is still present
# elsewhere stays, and so does the rest of the file.
CASE_ROOT="${WORK_DIR}/stale-after-fix"
make_package "$CASE_ROOT" "." true
make_package "$CASE_ROOT" "MobileApp" true
make_package "$CASE_ROOT" "Dashboard" true
cat > "${CASE_ROOT}/npm-audit-exceptions.json" <<'JSON'
{
  "MobileApp": [
    {
      "advisory": "GHSA-aaaa-bbbb-cccc",
      "expires": "2999-12-31",
      "reason": "Fixed by the lockfile change this job makes."
    }
  ],
  "Dashboard": [
    {
      "advisory": "GHSA-aaaa-bbbb-cccc",
      "expires": "2999-12-31",
      "reason": "Still in this tree."
    }
  ]
}
JSON
CALL_LOG="${WORK_DIR}/stale-after-fix.calls"
status=0
output="$(run_fix "$CASE_ROOT" env NPM_FAKE_VULNERABLE_SUFFIX="/Dashboard" NPM_FAKE_FIXED_BY_FIX_SUFFIX="/MobileApp")" || status=$?
assert_eq 0 "$status" "succeeds when it prunes an exception"
assert_eq "<no key>" "$(exceptions_for "${CASE_ROOT}/npm-audit-exceptions.json" MobileApp)" "removes the project key once its last exception is stale"
assert_eq "GHSA-aaaa-bbbb-cccc" "$(exceptions_for "${CASE_ROOT}/npm-audit-exceptions.json" Dashboard)" "keeps an exception whose advisory is still reported"
assert_contains "$output" "MobileApp: removed audit exception(s) no longer in the dependency tree: GHSA-AAAA-BBBB-CCCC." "says which exception it removed"
for project in "." "MobileApp" "Dashboard"; do
	directory="$CASE_ROOT"
	[[ "$project" != "." ]] && directory="${CASE_ROOT}/${project}"
	assert_eq 1 "$(count_calls "$directory" "audit fix")" "runs npm audit fix once inside ${project}"
	assert_eq 1 "$(count_calls "$directory" "audit --json")" "audits ${project} once"
	assert_eq true "$(called_before "$directory" "audit fix" "audit --json")" "audits ${project} only after fixing it"
done

# The pruned file is what a reviewer sees in the PR: stable formatting, a
# trailing newline, and the untouched project left exactly as it was.
expected_file="$(cat <<'JSON'
{
  "Dashboard": [
    {
      "advisory": "GHSA-aaaa-bbbb-cccc",
      "expires": "2999-12-31",
      "reason": "Still in this tree."
    }
  ]
}
JSON
)"
assert_eq "$expected_file" "$(cat "${CASE_ROOT}/npm-audit-exceptions.json")" "rewrites the file as two-space JSON"
assert_eq "" "$(tail -c 1 "${CASE_ROOT}/npm-audit-exceptions.json" | tr -d '\n')" "ends the file with a newline"

# The audit gate accepts what the job leaves behind for the project it pruned.
CLEAN_REPORT="${WORK_DIR}/clean-report.json"
echo '{"auditReportVersion": 2, "vulnerabilities": {}}' > "$CLEAN_REPORT"
status=0
node "$VALIDATOR" \
	--audit-result "$CLEAN_REPORT" \
	--exceptions "${CASE_ROOT}/npm-audit-exceptions.json" \
	--project ./MobileApp --audit-level low --npm-status 0 >/dev/null 2>&1 || status=$?
assert_eq 0 "$status" "leaves nothing for the audit gate to reject in the pruned project"

# Nothing stale: the file is not rewritten at all, not even reformatted.
CASE_ROOT="${WORK_DIR}/still-needed"
make_package "$CASE_ROOT" "MobileApp" true
printf '{"MobileApp":[{"advisory":"ghsa-aaaa-bbbb-cccc","expires":"2999-12-31","reason":"Still needed."}]}' > "${CASE_ROOT}/npm-audit-exceptions.json"
before="$(cat "${CASE_ROOT}/npm-audit-exceptions.json")"
CALL_LOG="${WORK_DIR}/still-needed.calls"
status=0
output="$(run_fix "$CASE_ROOT" env NPM_FAKE_VULNERABLE_SUFFIX="/MobileApp")" || status=$?
assert_eq 0 "$status" "succeeds when every exception is still needed"
assert_eq "$before" "$(cat "${CASE_ROOT}/npm-audit-exceptions.json")" "leaves a still-needed exception byte-for-byte alone, whatever its case"

# An audit that failed proves nothing about the tree, so it removes nothing -
# whether npm printed garbage or exited non-zero on an empty report.
for variant in NPM_FAKE_INVALID_SUFFIX NPM_FAKE_EMPTY_FAILURE_SUFFIX; do
	CASE_ROOT="${WORK_DIR}/broken-audit-${variant}"
	make_package "$CASE_ROOT" "MobileApp" true
	cat > "${CASE_ROOT}/npm-audit-exceptions.json" <<'JSON'
{
  "MobileApp": [
    {
      "advisory": "GHSA-aaaa-bbbb-cccc",
      "expires": "2999-12-31",
      "reason": "Cannot be judged from a broken audit."
    }
  ]
}
JSON
	before="$(cat "${CASE_ROOT}/npm-audit-exceptions.json")"
	CALL_LOG="${WORK_DIR}/broken-audit-${variant}.calls"
	status=0
	output="$(run_fix "$CASE_ROOT" env "${variant}=/MobileApp")" || status=$?
	assert_eq 0 "$status" "does not fail the job over an unusable audit (${variant})"
	assert_eq "$before" "$(cat "${CASE_ROOT}/npm-audit-exceptions.json")" "keeps exceptions when the audit is unusable (${variant})"
	assert_contains "$output" "MobileApp: kept audit exceptions unchanged" "explains why nothing was pruned (${variant})"
done

# The repository root is keyed ".", and a fix that fails does not stop the
# prune: the tree may still have changed.
CASE_ROOT="${WORK_DIR}/root-project"
make_package "$CASE_ROOT" "." true
cat > "${CASE_ROOT}/npm-audit-exceptions.json" <<'JSON'
{
  ".": [
    {
      "advisory": "GHSA-aaaa-bbbb-cccc",
      "expires": "2000-01-01",
      "reason": "Expired and stale; both are reasons to go."
    }
  ]
}
JSON
CALL_LOG="${WORK_DIR}/root-project.calls"
status=0
output="$(run_fix "$CASE_ROOT" env NPM_FAKE_FIX_STATUS=1)" || status=$?
assert_eq 0 "$status" "keeps reporting, not failing, a broken fix"
assert_contains "$output" "npm audit fix failed in ." "still reports the broken fix"
assert_eq "{}" "$(cat "${CASE_ROOT}/npm-audit-exceptions.json")" "prunes the root project's expired, stale exception"

# Projects without a lockfile are skipped before any npm call, and a
# repository with no exceptions file is left without one.
CASE_ROOT="${WORK_DIR}/no-exceptions-file"
make_package "$CASE_ROOT" "." true
make_package "$CASE_ROOT" "unlocked" false
CALL_LOG="${WORK_DIR}/no-exceptions-file.calls"
status=0
output="$(run_fix "$CASE_ROOT" env)" || status=$?
assert_eq 0 "$status" "succeeds without an exceptions file"
assert_eq "false" "$([[ -e "${CASE_ROOT}/npm-audit-exceptions.json" ]] && echo true || echo false)" "does not create an exceptions file"
assert_eq 0 "$(grep -cF "${CASE_ROOT}/unlocked" "$CALL_LOG")" "does not call npm for a project without a lockfile"

# A malformed exceptions file is surfaced as a warning and left for a human;
# the job keeps going so the lockfile fixes still reach a PR.
CASE_ROOT="${WORK_DIR}/malformed-file"
make_package "$CASE_ROOT" "." true
make_package "$CASE_ROOT" "MobileApp" true
printf '{ not json' > "${CASE_ROOT}/npm-audit-exceptions.json"
CALL_LOG="${WORK_DIR}/malformed-file.calls"
status=0
output="$(run_fix "$CASE_ROOT" env)" || status=$?
assert_eq 0 "$status" "does not fail the job over a malformed exceptions file"
assert_eq "{ not json" "$(cat "${CASE_ROOT}/npm-audit-exceptions.json")" "leaves a malformed exceptions file untouched"
# find's order is the filesystem's, so check every project rather than
# whichever one happens to come after the first failure.
for project in "." "MobileApp"; do
	directory="$CASE_ROOT"
	[[ "$project" != "." ]] && directory="${CASE_ROOT}/${project}"
	assert_contains "$output" "::warning::Could not prune audit exceptions for ${project}" "warns about the unreadable file for ${project}"
	assert_eq 1 "$(count_calls "$directory" "audit fix")" "still fixes ${project} after a prune failure"
	assert_eq 1 "$(count_calls "$directory" "audit --json")" "still audits ${project} after a prune failure"
done

echo ""
if (( FAIL > 0 )); then
	echo "❌ ${FAIL} failed, ${PASS} passed" >&2
	exit 1
fi

echo "✅ ${PASS} passed"
