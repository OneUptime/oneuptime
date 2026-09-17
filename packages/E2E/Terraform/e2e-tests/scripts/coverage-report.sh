#!/bin/bash
# Terraform E2E resource-type coverage report.
#
# Compares the set of resource types the generated provider ships (one docs
# page per resource under docs/resources/) against the set of resource types
# exercised by the E2E fixtures (every `resource "oneuptime_*"` block in
# tests/*/main.tf and tests/*/update.tf) and prints counts, a percentage and
# the sorted list of untested types.
#
# Usage:
#   coverage-report.sh [--provider-dir DIR] [--min-count N]
#
#   --provider-dir DIR  Path to the generated provider tree (defaults to
#                       Terraform/terraform-provider-oneuptime relative to the
#                       repo root). Its docs/resources/*.md filenames are the
#                       authoritative list of shipped resource types.
#   --min-count N       Coverage gate: exit 1 if fewer than N resource types
#                       are exercised by the fixtures. Without this flag the
#                       script always exits 0 (report-only mode).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"

PROVIDER_DIR="$TEST_DIR/../../../Terraform/terraform-provider-oneuptime"
MIN_COUNT=""

while [ $# -gt 0 ]; do
    case "$1" in
        --provider-dir)
            PROVIDER_DIR="$2"
            shift 2
            ;;
        --min-count)
            MIN_COUNT="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1" >&2
            echo "Usage: $0 [--provider-dir DIR] [--min-count N]" >&2
            exit 2
            ;;
    esac
done

DOCS_DIR="$PROVIDER_DIR/docs/resources"
if [ ! -d "$DOCS_DIR" ]; then
    echo "ERROR: provider docs directory not found: $DOCS_DIR" >&2
    echo "Generate the provider first (npm run generate-terraform-provider)" >&2
    echo "or pass --provider-dir." >&2
    exit 2
fi

# (a) Resource types the provider ships: docs/resources/<name>.md -> oneuptime_<name>
PROVIDER_TYPES=$(find "$DOCS_DIR" -maxdepth 1 -name '*.md' -exec basename {} .md \; \
    | sed 's/^/oneuptime_/' | sort -u)

# (b) Resource types exercised across all fixtures (main.tf + update.tf)
TESTED_TYPES=$(grep -rhoE 'resource "oneuptime_[a-z0-9_]+"' \
    "$TEST_DIR"/tests/*/main.tf "$TEST_DIR"/tests/*/update.tf 2>/dev/null \
    | sed 's/resource "//; s/"//' | sort -u)

PROVIDER_COUNT=$(printf '%s\n' "$PROVIDER_TYPES" | grep -c . || true)
TESTED_COUNT=$(printf '%s\n' "$TESTED_TYPES" | grep -c . || true)

# Fixtures referencing types the provider no longer ships (renamed/removed
# resources) — these would fail at plan time, so surface them here too.
UNKNOWN_TYPES=$(comm -23 <(printf '%s\n' "$TESTED_TYPES") <(printf '%s\n' "$PROVIDER_TYPES") || true)

# Shipped types with no fixture coverage.
UNTESTED_TYPES=$(comm -23 <(printf '%s\n' "$PROVIDER_TYPES") <(printf '%s\n' "$TESTED_TYPES") || true)
UNTESTED_COUNT=$(printf '%s\n' "$UNTESTED_TYPES" | grep -c . || true)

if [ "$PROVIDER_COUNT" -gt 0 ]; then
    PERCENT=$(awk -v t="$TESTED_COUNT" -v p="$PROVIDER_COUNT" 'BEGIN { printf "%.1f", (t / p) * 100 }')
else
    PERCENT="0.0"
fi

echo "=== Terraform E2E Resource Coverage ==="
echo "Provider resource types: $PROVIDER_COUNT"
echo "Tested resource types:   $TESTED_COUNT ($PERCENT%)"
echo ""

if [ -n "$UNKNOWN_TYPES" ]; then
    echo "WARNING: fixtures reference types the provider does not ship:"
    printf '%s\n' "$UNKNOWN_TYPES" | sed 's/^/  - /'
    echo ""
fi

echo "Untested resource types ($UNTESTED_COUNT):"
if [ -n "$UNTESTED_TYPES" ]; then
    printf '%s\n' "$UNTESTED_TYPES" | sed 's/^/  - /'
else
    echo "  (none)"
fi

if [ -n "$MIN_COUNT" ]; then
    echo ""
    if [ "$TESTED_COUNT" -lt "$MIN_COUNT" ]; then
        echo "✗ COVERAGE GATE FAILED: $TESTED_COUNT tested resource types is below the baseline of $MIN_COUNT."
        echo "  Coverage may only ratchet up. If you removed a fixture on purpose,"
        echo "  lower scripts/coverage-baseline.txt in the same change and justify it."
        exit 1
    fi
    echo "✓ Coverage gate passed: $TESTED_COUNT tested resource types (baseline: $MIN_COUNT)"
fi

exit 0
