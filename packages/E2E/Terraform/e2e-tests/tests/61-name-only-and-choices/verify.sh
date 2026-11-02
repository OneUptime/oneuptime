#!/bin/bash
# Verify script for 61-name-only-and-choices.
#
# A probe made from its name alone gets a key from OneUptime, which the
# configuration reads back sensitive, and version 1.0.0. A choice takes one
# of the values it says it takes: a value outside them is refused when the
# configuration is validated, before anything is asked of OneUptime.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Name-only probe and choices Verification"

validation_failed=0

PROBE_ID=$(get_output probe_id)
PROBE_KEY=$(get_output probe_key)
PROBE_VERSION=$(get_output probe_version)
FIELD_ID=$(get_output incident_custom_field_id)

assert_not_empty "$PROBE_ID" "probe id" || validation_failed=1
assert_not_empty "$PROBE_KEY" "probe key read back from OneUptime" || validation_failed=1
assert_equals "1.0.0" "$PROBE_VERSION" "probe version" || validation_failed=1

PROBE_RESPONSE=$(api_get_resource "/api/probe" "$PROBE_ID" \
    '{"_id": true, "name": true, "key": true, "probeVersion": true}')
validate_field "$PROBE_RESPONSE" "name" "TF E2E name-only probe" || validation_failed=1
validate_field "$PROBE_RESPONSE" "key" "$PROBE_KEY" || validation_failed=1
validate_field "$PROBE_RESPONSE" "probeVersion" "1.0.0" || validation_failed=1

# The key is a secret: never printed in a plan, a log or an output.
assert_sensitive "oneuptime_probe.name_only" "key" || validation_failed=1

FIELD_RESPONSE=$(api_get_resource "/api/incident-custom-field" "$FIELD_ID" \
    '{"_id": true, "customFieldType": true}')
validate_field "$FIELD_RESPONSE" "customFieldType" "Dropdown" || validation_failed=1

# A value outside a choice's values: refused by terraform validate, saying
# what was written and what it takes. The configuration lives in a scratch
# folder; the harness's CLI config (dev_overrides) serves the provider.
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/main.tf" << 'EOF'
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "http://localhost:9"
  api_key       = "not-used-by-validate"
}

resource "oneuptime_incident_custom_field" "wrong_case" {
  name              = "Wrong case"
  custom_field_type = "dropdown"
}

resource "oneuptime_cloud_connection" "wrong_cloud" {
  name           = "Wrong cloud"
  provider_value = "AWS"
  secrets        = jsonencode({})
}
EOF

set +e
terraform -chdir="$SCRATCH" validate -no-color > "$SCRATCH/validate.txt" 2>&1
validate_exit=$?
set -e

# The engines wrap long lines: read the output as one line of words.
tr -s '[:space:]' ' ' < "$SCRATCH/validate.txt" > "$SCRATCH/validate-words.txt"

if [ $validate_exit -eq 0 ]; then
    echo "    ✗ FAILED: a choice outside its values was validated"
    validation_failed=1
else
    for expected in \
        'Attribute custom_field_type value must be one of' \
        'got: "dropdown"' \
        '"Dropdown"' \
        'Attribute provider_value value must be one of' \
        'got: "AWS"' \
        '"aws"'; do
        if grep -qF -- "$expected" "$SCRATCH/validate-words.txt"; then
            echo "    ✓ validate says: $expected"
        else
            echo "    ✗ FAILED: validate does not say: $expected"
            validation_failed=1
        fi
    done
fi

if [ $validation_failed -eq 1 ]; then
    cat "$SCRATCH/validate.txt"
fi
rm -rf "$SCRATCH"

if [ $validation_failed -eq 1 ]; then
    print_failed "Name-only probe and choices Verification"
fi

print_passed "Name-only probe and choices Verification"
