#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=Scripts/GHA/retry.sh
source "${SCRIPT_DIR}/retry.sh"

usage() {
	cat <<'EOF'
Usage: scan_sbom_vulnerabilities.sh [options]

Writes a vulnerability report for each CycloneDX SBOM generate_sboms.sh wrote,
with Grype, which matches the packages an SBOM lists against its vulnerability
database: no image is pulled again. Each <name>.cdx.json gets a
<name>.grype.json beside the others in the output folder, and
vulnerability-summary.md counts each report's findings by severity. The
release attaches all of them, so a security reviewer reads what each image
carried on the day it shipped.

It reports, and fails on nothing it finds: a finding is for the reader to
judge, and the next release is where it gets fixed. It fails only when an SBOM
could not be scanned, naming each.

Optional flags:
	--input-dir <path>    Where the SBOMs are (default: ./sbom)
	--output-dir <path>   Where the reports go (default: ./vulnerabilities)
EOF
}

INPUT_DIR="./sbom"
OUTPUT_DIR="./vulnerabilities"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--input-dir)
			INPUT_DIR="$2"
			shift 2
			;;
		--output-dir)
			OUTPUT_DIR="$2"
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage
			exit 1
			;;
	esac
done

for tool in grype python3; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "${tool} not found on PATH. (anchore/scan-action/download-grype installs grype in CI.)" >&2
		exit 1
	fi
done

SBOMS=()
while IFS= read -r file; do
	SBOMS+=("$file")
done < <(find "$INPUT_DIR" -maxdepth 1 -type f -name '*.cdx.json' | sort)

if (( ${#SBOMS[@]} == 0 )); then
	echo "❌ No *.cdx.json in ${INPUT_DIR}: nothing to scan" >&2
	exit 1
fi

mkdir -p "$OUTPUT_DIR"

# The database once, retried, so each scan below only reads it.
retry_with_backoff "Grype vulnerability database update" grype db update

# One scan, written to a temporary file and moved into place, so a scan that
# fails partway leaves no report behind for the release to attach. Each step
# returns on failure itself: retry_with_backoff runs this in a condition,
# where bash ignores set -e.
scan() {
	local sbom="$1"
	local out="$2"

	rm -f "$out" "${out}.partial"
	if ! grype "sbom:${sbom}" --output json --quiet >"${out}.partial"; then
		rm -f "${out}.partial"
		return 1
	fi
	mv "${out}.partial" "$out"
}

FAILED=()

for sbom in "${SBOMS[@]}"; do
	name="$(basename "$sbom" .cdx.json)"
	out="${OUTPUT_DIR}/${name}.grype.json"

	if retry_with_backoff "Grype scan of ${name}" scan "$sbom" "$out"; then
		echo "✅ ${name}"
	else
		FAILED+=("$name")
	fi
done

python3 - "$OUTPUT_DIR" >"${OUTPUT_DIR}/vulnerability-summary.md" <<'PYTHON'
import glob
import json
import os
import sys

SEVERITIES = ["Critical", "High", "Medium", "Low", "Negligible", "Unknown"]

print("# Vulnerabilities by image")
print()
print("Grype's findings for each image's CycloneDX SBOM, by severity.")
print()
print("| Image | " + " | ".join(SEVERITIES) + " |")
print("| --- | " + " | ".join("---:" for _ in SEVERITIES) + " |")

for report in sorted(glob.glob(os.path.join(sys.argv[1], "*.grype.json"))):
    with open(report) as handle:
        matches = json.load(handle).get("matches", [])
    counts = {severity: 0 for severity in SEVERITIES}
    for match in matches:
        severity = (match.get("vulnerability") or {}).get("severity") or "Unknown"
        counts[severity if severity in counts else "Unknown"] += 1
    name = os.path.basename(report)[: -len(".grype.json")]
    print("| " + name + " | " + " | ".join(str(counts[s]) for s in SEVERITIES) + " |")
PYTHON

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
	cat "${OUTPUT_DIR}/vulnerability-summary.md" >>"$GITHUB_STEP_SUMMARY"
fi

if (( ${#FAILED[@]} > 0 )); then
	echo "❌ Not scanned (${#FAILED[@]}): ${FAILED[*]}" >&2
	exit 1
fi

echo "✅ Wrote ${#SBOMS[@]} vulnerability reports to ${OUTPUT_DIR}"
