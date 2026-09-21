#!/bin/bash
# Common library functions for Terraform / OpenTofu E2E tests
# Source this file in verify.sh scripts: source "$(dirname "$0")/../../scripts/lib.sh"

#######################################
# Engine selection (Terraform / OpenTofu)
#######################################

# The same fixtures run unchanged against both engines — that identity is the
# compatibility claim the suite exists to prove, so nothing under tests/ may
# name a specific binary. TF_CLI selects it ("terraform" or "tofu") and
# defaults to terraform, so an unset environment behaves exactly as before.
#
# `terraform` is defined here as a function that dispatches to $TF_CLI instead
# of rewriting the ~200 `terraform ...` call sites in run-tests.sh and the
# per-test verify.sh scripts. `command` skips function lookup, so the
# TF_CLI=terraform case reaches the real binary rather than recursing. The
# function is exported because the runner spawns each verify.sh as its own bash
# process — including the ones that do not source this file.
: "${TF_CLI:=terraform}"
export TF_CLI

terraform() {
    command "$TF_CLI" "$@"
}
export -f terraform

# The default provider registry each engine resolves bare `namespace/name`
# source addresses against. Used to keep the two engines' locally installed
# provider binaries in separate directories.
tf_registry_host() {
    if [ "$TF_CLI" = "tofu" ]; then
        echo "registry.opentofu.org"
    else
        echo "registry.terraform.io"
    fi
}
export -f tf_registry_host

# First line of `<engine> version`, for the run header. A failure here means the
# selected binary is missing, so surface that instead of an empty string.
tf_cli_version() {
    command "$TF_CLI" version 2>/dev/null | head -1 || echo "$TF_CLI (version unavailable)"
}

# Installs hashicorp/random <version> for the selected engine into <dir>, as
# <dir>/.terraform/providers/... plus <dir>/.terraform.lock.hcl. run-tests.sh
# plants both into every test that uses the provider, because a test directory
# cannot run `init` itself (see the [init] phase there).
#
# Where the provider comes from:
#
#   * TF_E2E_PROVIDER_MIRROR set (CI): from that directory only. It is a
#     packed-layout provider mirror --
#       <mirror>/<registry host>/hashicorp/random/terraform-provider-random_<version>_<platform>.zip
#     -- holding one zip per engine, because Terraform resolves hashicorp/random
#     against registry.terraform.io and OpenTofu against registry.opentofu.org.
#     The workflow stages it from sha256-pinned copies kept in the Actions
#     cache. The registry is excluded outright rather than left as a fallback:
#     OpenTofu's registry serves this provider from GitHub's release CDN, and
#     tofu's own retry (2 attempts, ~11s) lost to that CDN's 500/504 bursts
#     three times in two weeks. A mirror missing the file fails here, naming
#     it, instead of quietly going back to the network. Installing from the
#     mirror makes `init` warn "Incomplete lock file information for
#     providers": expected, since a mirror has no registry checksums, and
#     harmless -- the lock file records the h1: hash for the one platform the
#     run uses, which is what the tests' `plan` checks the planted provider
#     against.
#   * Unset (local runs): straight from the engine's default registry.
#
# Returns non-zero, having said why, when the provider could not be installed.
tf_prepare_random_provider() { # dir version platform (e.g. linux_amd64)
    local dir="$1"
    local version="$2"
    local platform="$3"
    local host
    host="$(tf_registry_host)"

    rm -rf "$dir"
    mkdir -p "$dir" || return 1
    cat > "$dir/main.tf" << TFEOF
terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "$version"
    }
  }
}
TFEOF

    # The harness's own CLI config, so a developer's ~/.terraformrc or
    # ~/.tofurc (dev_overrides, a mirror of their own) cannot interfere. A real
    # file rather than /dev/null because OpenTofu expects the path handed to
    # TF_CLI_CONFIG_FILE to be a regular *.tfrc file.
    local cli_config="$dir/random-provider.tfrc"
    if [ -n "${TF_E2E_PROVIDER_MIRROR:-}" ]; then
        local mirror="$TF_E2E_PROVIDER_MIRROR"
        # run-tests.sh has changed directory by the time this runs, so a
        # relative path would quietly point somewhere else.
        case "$mirror" in
            /*) ;;
            *)
                echo "ERROR: TF_E2E_PROVIDER_MIRROR must be an absolute path, got '$mirror'."
                return 1
                ;;
        esac
        local package="$mirror/$host/hashicorp/random/terraform-provider-random_${version}_${platform}.zip"
        if [ ! -s "$package" ]; then
            echo "ERROR: TF_E2E_PROVIDER_MIRROR=$mirror has no hashicorp/random $version for $TF_CLI ($platform)."
            echo "       Expected: $package"
            echo "       Provider zips it does have:"
            find "$mirror" -name '*.zip' 2>/dev/null | sed 's/^/         /'
            echo "       In CI the \"pinned Terraform, OpenTofu and providers\" steps of"
            echo "       .github/workflows/terraform-provider-e2e.yml stage this mirror; its"
            echo "       RANDOM_PROVIDER_VERSION must equal the version run-tests.sh requires ($version)."
            return 1
        fi
        echo "Installing hashicorp/random $version for $TF_CLI from the local mirror $mirror (no registry access)"
        cat > "$cli_config" << EOF
provider_installation {
  filesystem_mirror {
    path    = "$mirror"
    include = ["registry.terraform.io/hashicorp/random", "registry.opentofu.org/hashicorp/random"]
  }
  direct {
    exclude = ["registry.terraform.io/hashicorp/random", "registry.opentofu.org/hashicorp/random"]
  }
}
EOF
    else
        echo "Installing hashicorp/random $version for $TF_CLI from $host (TF_E2E_PROVIDER_MIRROR is not set)"
        : > "$cli_config"
    fi

    if ! (
        cd "$dir" &&
            export TF_CLI_CONFIG_FILE="$cli_config" &&
            terraform init -input=false -upgrade
    ); then
        echo "ERROR: $TF_CLI init failed to install hashicorp/random $version"
        return 1
    fi

    # What the [init] phase of run-tests.sh copies into each test.
    local lock="$dir/.terraform.lock.hcl"
    if [ ! -s "$lock" ] || ! grep -q "hashicorp/random" "$lock"; then
        echo "ERROR: Failed to pre-download random provider — lock file missing or empty"
        return 1
    fi
    if [ ! -d "$dir/.terraform/providers/$host/hashicorp/random/$version/$platform" ]; then
        echo "ERROR: $TF_CLI init did not install hashicorp/random $version for $platform under $dir/.terraform/providers/$host"
        return 1
    fi
    echo "Random provider installed"
}

#######################################
# Helper Functions
#######################################

# Unwrap API values that might be in wrapper format
# e.g., {"_type": "Color", "value": "#FF5733"} -> "#FF5733"
# Usage: unwrap_value "$raw_json_value"
unwrap_value() {
    local raw_value="$1"
    if echo "$raw_value" | jq -e '.value' > /dev/null 2>&1; then
        echo "$raw_value" | jq -r '.value'
    else
        echo "$raw_value" | jq -r '.'
    fi
}

# Get a Terraform output value safely (returns empty string if not found)
# Usage: get_output "output_name"
get_output() {
    local output_name="$1"
    terraform output -raw "$output_name" 2>/dev/null || echo ""
}

# Assert that a value is not empty
# Usage: assert_not_empty "$value" "Resource name"
assert_not_empty() {
    local value="$1"
    local name="$2"
    if [ -z "$value" ] || [ "$value" = "null" ]; then
        echo "    ✗ FAILED: $name is empty or null"
        return 1
    fi
    echo "    ✓ $name exists: $value"
    return 0
}

# Assert two values are equal
# Usage: assert_equals "$expected" "$actual" "Field name"
assert_equals() {
    local expected="$1"
    local actual="$2"
    local name="$3"
    if [ "$expected" != "$actual" ]; then
        echo "    ✗ FAILED: $name mismatch - Expected: '$expected', Got: '$actual'"
        return 1
    fi
    echo "    ✓ $name matches: $actual"
    return 0
}

# Make an API call to get a resource
# Usage: api_get_resource "endpoint" "resource_id" "select_fields"
# Example: api_get_resource "/api/label" "$LABEL_ID" '{"_id": true, "name": true}'
api_get_resource() {
    local endpoint="$1"
    local resource_id="$2"
    local select_fields="${3:-'{\"_id\": true}'}"

    curl -s -X POST "${ONEUPTIME_URL}${endpoint}/${resource_id}/get-item" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d "{\"select\": $select_fields}"
}

# Verify a resource exists in the API
# Usage: verify_resource_exists "endpoint" "resource_id"
verify_resource_exists() {
    local endpoint="$1"
    local resource_id="$2"

    local response
    response=$(api_get_resource "$endpoint" "$resource_id" '{"_id": true}')

    local api_id
    api_id=$(echo "$response" | jq -r '._id // empty')

    if [ -z "$api_id" ] || [ "$api_id" = "null" ]; then
        echo "    ✗ FAILED: Resource not found in API"
        echo "    Response: $response"
        return 1
    fi
    echo "    ✓ Resource exists in API"
    return 0
}

# Legacy healing only. The harness no longer touches ~/.terraformrc — it writes
# its dev_overrides to a temp file and points TF_CLI_CONFIG_FILE at it, which
# both Terraform and OpenTofu honour. This restores a backup left behind by a
# crashed run from before that change. It deliberately never deletes
# ~/.terraformrc: without a backup we cannot tell a stale harness file from a
# developer's own dev_overrides for this provider.
restore_terraformrc() {
    local backup="$HOME/.terraformrc.oneuptime-e2e-backup"
    if [ -f "$backup" ]; then
        mv "$backup" "$HOME/.terraformrc"
        echo "Restored original ~/.terraformrc from a pre-TF_CLI_CONFIG_FILE run"
    fi
}

# Validate a field from API response against expected value
# Handles wrapper object unwrapping automatically
# Usage: validate_field "$response" "field_name" "$expected_value"
validate_field() {
    local response="$1"
    local field_name="$2"
    local expected_value="$3"

    local raw_value
    raw_value=$(echo "$response" | jq ".$field_name")

    local actual_value
    actual_value=$(unwrap_value "$raw_value")

    assert_equals "$expected_value" "$actual_value" "$field_name"
}

# Print test header
# Usage: print_header "Test Name"
print_header() {
    local test_name="$1"
    echo ""
    echo "=========================================="
    echo "$test_name"
    echo "=========================================="
}

# Print test passed message
# Usage: print_passed "Test Name"
print_passed() {
    local test_name="$1"
    echo ""
    echo "=== $test_name PASSED ==="
}

# Print test failed message and exit
# Usage: print_failed "Test Name"
print_failed() {
    local test_name="$1"
    echo ""
    echo "=== $test_name FAILED ==="
    exit 1
}

#######################################
# Export functions for subshells
#######################################
export -f unwrap_value
export -f get_output
export -f assert_not_empty
export -f assert_equals
export -f api_get_resource
export -f verify_resource_exists
export -f restore_terraformrc
export -f validate_field
export -f tf_cli_version
export -f print_header
export -f print_passed
export -f print_failed
