#!/bin/bash

set -o nounset
set -o pipefail

ROOT_DIR="$(pwd)"
EXIT_CODE=0

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

    cd "$ROOT_DIR"
done < <(find . -name package.json -not -path '*/node_modules/*' -print0)

exit $EXIT_CODE
