#!/usr/bin/env bash

# End-to-end tests for Scripts/GHA/scan_sbom_vulnerabilities.sh, driven by a
# fake grype on PATH, so nothing here downloads a vulnerability database.
#
# What matters: one report per SBOM and a summary the release attaches; the
# database updated once, before the scans; a scan that fails leaves no
# partial report behind, never stops the others, and fails the run naming it.
#
# Run with: npm run test-gha-scripts   (or bash Scripts/GHA/Tests/scan_sbom_vulnerabilities_test.sh)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN="${SCRIPT_DIR}/../scan_sbom_vulnerabilities.sh"

export RETRY_WITH_BACKOFF_DELAYS="0 0"

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
		fail "$what — '${needle}' not found"
	fi
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# A fake grype: `db update` is logged; `grype sbom:<file> --output json --quiet`
# prints two High and one Critical finding (one Medium for a probe SBOM), or
# fails for an SBOM whose name holds FAKE_GRYPE_FAIL after printing half a
# report, as a scan cut short would.
setup_fake_grype() {
	local bin_dir="${WORK_DIR}/bin"
	mkdir -p "$bin_dir"

	cat > "${bin_dir}/grype" <<'FAKE_EOF'
#!/usr/bin/env bash
echo "$*" >> "${FAKE_GRYPE_LOG}"
if [[ "$1 $2" == "db update" ]]; then
	exit 0
fi
sbom="${1#sbom:}"
if [[ -n "${FAKE_GRYPE_FAIL:-}" && "$sbom" == *"${FAKE_GRYPE_FAIL}"* ]]; then
	printf '{"matches": ['
	exit 1
fi
case "$sbom" in
	*probe*) printf '{"matches": [{"vulnerability": {"severity": "Medium"}}]}\n' ;;
	*) printf '{"matches": [{"vulnerability": {"severity": "High"}}, {"vulnerability": {"severity": "High"}}, {"vulnerability": {"severity": "Critical"}}]}\n' ;;
esac
FAKE_EOF

	chmod +x "${bin_dir}/grype"
	export PATH="${bin_dir}:${PATH}"
}

setup_fake_grype

make_sboms() {
	local dir="$1"
	mkdir -p "$dir"
	for name in app-14.0.102-linux-amd64 app-14.0.102-linux-arm64 probe-14.0.102-linux-amd64; do
		printf '{"bomFormat": "CycloneDX"}\n' > "${dir}/${name}.cdx.json"
	done
}

echo "── every SBOM ──"
make_sboms "${WORK_DIR}/ok/sbom"
export FAKE_GRYPE_LOG="${WORK_DIR}/ok/grype.log"
: > "$FAKE_GRYPE_LOG"
export GITHUB_STEP_SUMMARY="${WORK_DIR}/ok/summary.md"
FAKE_GRYPE_FAIL="" bash "$SCAN" --input-dir "${WORK_DIR}/ok/sbom" --output-dir "${WORK_DIR}/ok/out" > "${WORK_DIR}/ok/out.log" 2>&1
assert_eq "0" "$?" "scans every SBOM and exits 0"
assert_eq "3" "$(find "${WORK_DIR}/ok/out" -name '*.grype.json' | wc -l | tr -d ' ')" "writes one report per SBOM"
assert_eq "db update" "$(head -n 1 "$FAKE_GRYPE_LOG")" "updates the database first"
assert_eq "1" "$(grep -c '^db update$' "$FAKE_GRYPE_LOG")" "and only once"
assert_eq "sbom:${WORK_DIR}/ok/sbom/app-14.0.102-linux-amd64.cdx.json --output json --quiet" "$(sed -n 2p "$FAKE_GRYPE_LOG")" "reads each SBOM, not the image"
summary="$(cat "${WORK_DIR}/ok/out/vulnerability-summary.md")"
assert_contains "$summary" "| Image | Critical | High | Medium | Low | Negligible | Unknown |" "summarizes by severity"
assert_contains "$summary" "| app-14.0.102-linux-amd64 | 1 | 2 | 0 | 0 | 0 | 0 |" "counts each report's findings"
assert_contains "$summary" "| probe-14.0.102-linux-amd64 | 0 | 0 | 1 | 0 | 0 | 0 |" "counts each image apart"
assert_contains "$(cat "$GITHUB_STEP_SUMMARY")" "| app-14.0.102-linux-arm64 | 1 | 2 | 0 | 0 | 0 | 0 |" "shows the summary on the run's page"
unset GITHUB_STEP_SUMMARY

echo "── a scan that keeps failing ──"
make_sboms "${WORK_DIR}/fails/sbom"
export FAKE_GRYPE_LOG="${WORK_DIR}/fails/grype.log"
: > "$FAKE_GRYPE_LOG"
FAKE_GRYPE_FAIL="linux-arm64" bash "$SCAN" --input-dir "${WORK_DIR}/fails/sbom" --output-dir "${WORK_DIR}/fails/out" > "${WORK_DIR}/fails/out.log" 2>&1
assert_eq "1" "$?" "fails the run"
assert_eq "3" "$(grep -c 'linux-arm64' "$FAKE_GRYPE_LOG")" "retries it twice"
assert_eq "no" "$([[ -e "${WORK_DIR}/fails/out/app-14.0.102-linux-arm64.grype.json" || -e "${WORK_DIR}/fails/out/app-14.0.102-linux-arm64.grype.json.partial" ]] && echo yes || echo no)" "leaves no report, whole or partial, for it"
assert_eq "2" "$(find "${WORK_DIR}/fails/out" -name '*.grype.json' | wc -l | tr -d ' ')" "still writes every other report"
assert_contains "$(cat "${WORK_DIR}/fails/out.log")" "Not scanned (1): app-14.0.102-linux-arm64" "names it"

echo "── nothing to scan ──"
mkdir -p "${WORK_DIR}/empty/sbom"
export FAKE_GRYPE_LOG="${WORK_DIR}/empty/grype.log"
: > "$FAKE_GRYPE_LOG"
bash "$SCAN" --input-dir "${WORK_DIR}/empty/sbom" --output-dir "${WORK_DIR}/empty/out" > "${WORK_DIR}/empty/out.log" 2>&1
assert_eq "1" "$?" "fails when there is no SBOM"
assert_contains "$(cat "${WORK_DIR}/empty/out.log")" "nothing to scan" "and says so"

echo ""
echo "scan_sbom_vulnerabilities: ${PASS} passed, ${FAIL} failed"
(( FAIL == 0 ))
