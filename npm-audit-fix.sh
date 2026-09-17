#!/bin/bash

set -o nounset
set -o pipefail

ROOT_DIR="$(pwd)"
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_EXCEPTIONS_FILE="${NPM_AUDIT_EXCEPTIONS_FILE:-$ROOT_DIR/npm-audit-exceptions.json}"
PRUNE_EXCEPTIONS="${SCRIPT_ROOT}/Scripts/Security/PruneNpmAuditExceptions.js"
EXIT_CODE=0
RESULTS_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$RESULTS_DIRECTORY"' EXIT

while IFS= read -r -d '' package_json; do
    PROJECT_DIR="$(dirname "$package_json")"
    DISPLAY_DIR="${PROJECT_DIR#./}"

    echo "Running npm audit fix in ${DISPLAY_DIR:-.}"

    if ! cd "$PROJECT_DIR"; then
        echo "Skipping ${DISPLAY_DIR:-.}: cannot change directory" >&2
        EXIT_CODE=1
        continue
    fi

    if [ ! -f "package-lock.json" ] && [ ! -f "npm-shrinkwrap.json" ]; then
        echo "Skipping ${DISPLAY_DIR:-.}: no package-lock.json or npm-shrinkwrap.json"
        cd "$ROOT_DIR"
        continue
    fi

    if ! npm audit fix; then
        echo "npm audit fix failed in ${DISPLAY_DIR:-.}" >&2
        # In this case do not do anyting, just report the error
    fi

    # A fix can take an advisory out of the tree, and the audit gate then
    # fails on the exception that covered it. Drop those exceptions here so
    # the removal is part of the same change and this job's PR stays green.
    audit_result="${RESULTS_DIRECTORY}/audit.json"
    audit_status=0
    npm audit --json > "$audit_result" || audit_status=$?
    if ! node "$PRUNE_EXCEPTIONS" \
        --audit-result "$audit_result" \
        --exceptions "$AUDIT_EXCEPTIONS_FILE" \
        --project "${DISPLAY_DIR:-.}" \
        --npm-status "$audit_status"; then
        echo "::warning::Could not prune audit exceptions for ${DISPLAY_DIR:-.}" >&2
    fi

    cd "$ROOT_DIR"
done < <(find . -name package.json -not -path '*/node_modules/*' -print0)

exit $EXIT_CODE
