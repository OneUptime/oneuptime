#!/bin/bash
#
# Validates every "Example Usage" block of the generated provider docs
# against the provider that was just built, with `terraform validate` (or
# `tofu validate`). An example with a renamed attribute, a value of the wrong
# type or a missing required argument fails here instead of in a reader's
# first plan.
#
# All the examples go into one configuration. Each page's example is named
# "example", so an example that refers to another type
# (oneuptime_monitor_status.example.id) refers to that type's own example.
#
# Usage: validate-docs-examples.sh [provider-dir] [terraform|tofu]
#   provider-dir defaults to Terraform/terraform-provider-oneuptime and must
#   hold the built terraform-provider-oneuptime binary and its docs/.

set -euo pipefail

PROVIDER_DIR="$(cd "${1:-Terraform/terraform-provider-oneuptime}" && pwd)"
ENGINE="${2:-terraform}"

if [ ! -x "${PROVIDER_DIR}/terraform-provider-oneuptime" ]; then
    echo "No built provider at ${PROVIDER_DIR}/terraform-provider-oneuptime; generate it first." >&2
    exit 1
fi

if ! command -v "$ENGINE" >/dev/null 2>&1; then
    echo "${ENGINE} is not installed." >&2
    exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

cat > "${WORK_DIR}/dev.tfrc" <<EOF
provider_installation {
  dev_overrides {
    "oneuptime/oneuptime" = "${PROVIDER_DIR}"
  }
  direct {}
}
EOF

CONFIG="${WORK_DIR}/main.tf"

cat > "$CONFIG" <<'EOF'
terraform {
  required_providers {
    oneuptime = {
      source = "oneuptime/oneuptime"
    }
  }
}

provider "oneuptime" {
  api_key = "validate-only"
}
EOF

EXAMPLES=0

for page in "${PROVIDER_DIR}"/docs/resources/*.md "${PROVIDER_DIR}"/docs/data-sources/*.md; do
    # The first terraform block after "## Example Usage".
    example="$(awk '
        /^## Example Usage/ { section = 1; next }
        section && /^```terraform$/ { inside = 1; next }
        inside && /^```$/ { exit }
        inside { print }
    ' "$page")"

    if [ -z "$example" ]; then
        echo "No example usage on ${page#"${PROVIDER_DIR}"/}" >&2
        exit 1
    fi

    printf '\n# --- %s\n%s\n' "${page#"${PROVIDER_DIR}"/}" "$example" >> "$CONFIG"
    EXAMPLES=$((EXAMPLES + 1))
done

echo "Validating ${EXAMPLES} docs examples with $("$ENGINE" version | head -n 1)..."

if ! OUTPUT="$(cd "$WORK_DIR" && TF_CLI_CONFIG_FILE="${WORK_DIR}/dev.tfrc" "$ENGINE" validate -no-color 2>&1)"; then
    echo "$OUTPUT" | grep -v "Provider development overrides\|development overrides are set\|oneuptime/oneuptime in\|may therefore not match\|cause the state to become\|^ *releases\.$" >&2
    exit 1
fi

echo "All ${EXAMPLES} docs examples are valid."
