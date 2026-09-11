#!/usr/bin/env bash

set -o nounset
set -o pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_ROOT="${NPM_AUDIT_ROOT:-$SCRIPT_ROOT}"
AUDIT_LEVEL="${NPM_AUDIT_LEVEL:-low}"
AUDIT_EXCEPTIONS_FILE="${NPM_AUDIT_EXCEPTIONS_FILE:-$AUDIT_ROOT/npm-audit-exceptions.json}"
AUDIT_VALIDATOR="${SCRIPT_ROOT}/Scripts/Security/ValidateNpmAudit.js"

case "$AUDIT_LEVEL" in
	info|low|moderate|high|critical) ;;
	*)
		echo "Invalid NPM_AUDIT_LEVEL '${AUDIT_LEVEL}'. Expected info, low, moderate, high, or critical." >&2
		exit 2
		;;
esac

if [[ ! -d "$AUDIT_ROOT" ]]; then
	echo "Audit root does not exist: $AUDIT_ROOT" >&2
	exit 2
fi

AUDIT_ROOT="$(cd "$AUDIT_ROOT" && pwd)"
AUDITED=0
SKIPPED=0
FAILED=()
RESULTS_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$RESULTS_DIRECTORY"' EXIT

display_directory() {
	local directory="$1"
	if [[ "$directory" == "$AUDIT_ROOT" ]]; then
		echo "."
	else
		echo ".${directory#"$AUDIT_ROOT"}"
	fi
}

while IFS= read -r -d '' package_json; do
	project_directory="$(dirname "$package_json")"
	display_directory="$(display_directory "$project_directory")"

	if [[ ! -f "$project_directory/package-lock.json" && ! -f "$project_directory/npm-shrinkwrap.json" ]]; then
		echo "Skipping ${display_directory}: no package-lock.json or npm-shrinkwrap.json"
		SKIPPED=$(( SKIPPED + 1 ))
		continue
	fi

	echo "Auditing ${display_directory}"
	AUDITED=$(( AUDITED + 1 ))
	audit_result="${RESULTS_DIRECTORY}/${AUDITED}.json"

	audit_status=0
	(
		cd "$project_directory" || exit 2
		npm audit --json --audit-level="$AUDIT_LEVEL" > "$audit_result"
	) || audit_status=$?

	# npm exits non-zero for both genuine findings and operational failures.
	# The validator distinguishes those cases from the JSON report and applies
	# only reviewed, project-scoped, non-expired advisory exceptions.
	if ! node "$AUDIT_VALIDATOR" \
		--audit-result "$audit_result" \
		--exceptions "$AUDIT_EXCEPTIONS_FILE" \
		--project "$display_directory" \
		--audit-level "$AUDIT_LEVEL" \
		--npm-status "$audit_status"; then
		FAILED+=("$display_directory")
	fi
done < <(
	find "$AUDIT_ROOT" \
		-name package.json \
		-not -path '*/node_modules/*' \
		-not -path '*/.git/*' \
		-not -path '*/.claude/*' \
		-not -path '*/.codex/*' \
		-not -path '*/build/*' \
		-not -path '*/dist/*' \
		-not -path '*/coverage/*' \
		-not -path '*/.cache/*' \
		-print0
)

if (( AUDITED == 0 )); then
	echo "No npm lockfiles were audited under $AUDIT_ROOT." >&2
	exit 1
fi

echo "Audited ${AUDITED} npm project(s); skipped ${SKIPPED} package(s) without a lockfile."

if (( ${#FAILED[@]} > 0 )); then
	echo "Dependency audit failed in ${#FAILED[@]} project(s): ${FAILED[*]}" >&2
	exit 1
fi

echo "All npm dependency audits passed at level ${AUDIT_LEVEL}."
