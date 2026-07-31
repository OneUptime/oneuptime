#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
PROVIDER_DIR="$TEST_DIR/../../../Terraform/terraform-provider-oneuptime"

# Load test environment and shared helpers
source "$TEST_DIR/test-env.sh"
source "$SCRIPT_DIR/lib.sh"

echo "=== Running Terraform E2E Tests ==="
echo "OneUptime URL: $ONEUPTIME_URL"

# Build and install provider locally
echo ""
echo "=== Building Terraform Provider ==="
cd "$PROVIDER_DIR"
go mod tidy
go build -o terraform-provider-oneuptime

# Install provider
OS=$(go env GOOS)
ARCH=$(go env GOARCH)
INSTALL_DIR="$HOME/.terraform.d/plugins/registry.terraform.io/oneuptime/oneuptime/1.0.0/${OS}_${ARCH}"
mkdir -p "$INSTALL_DIR"
cp terraform-provider-oneuptime "$INSTALL_DIR/"

# Pre-download the random provider before setting up dev_overrides — running
# `terraform init` after dev_overrides is configured can silently no-op
# (Terraform prints "Skip terraform init when using provider development
# overrides"), leaving the lock file empty and breaking subsequent tests.
echo ""
echo "=== Downloading Random Provider ==="
RANDOM_PROVIDER_DIR="/tmp/tf-random-provider"
rm -rf "$RANDOM_PROVIDER_DIR"
mkdir -p "$RANDOM_PROVIDER_DIR"
cat > "$RANDOM_PROVIDER_DIR/main.tf" << 'TFEOF'
terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "3.8.0"
    }
  }
}
TFEOF
# Use an empty CLI config so the user's dev_overrides cannot interfere.
(cd "$RANDOM_PROVIDER_DIR" && TF_CLI_CONFIG_FILE=/dev/null terraform init -input=false -upgrade)

if [ ! -s "$RANDOM_PROVIDER_DIR/.terraform.lock.hcl" ] || \
   ! grep -q "hashicorp/random" "$RANDOM_PROVIDER_DIR/.terraform.lock.hcl"; then
    echo "ERROR: Failed to pre-download random provider — lock file missing or empty"
    exit 1
fi
echo "Random provider downloaded"

# Back up any pre-existing ~/.terraformrc so a local developer's CLI config
# survives a test run. Do not clobber an existing backup — that would replace
# the user's real file with our generated one after a crashed previous run.
TERRAFORMRC_BACKUP="$HOME/.terraformrc.oneuptime-e2e-backup"
if [ -f "$HOME/.terraformrc" ] && [ ! -f "$TERRAFORMRC_BACKUP" ]; then
    cp "$HOME/.terraformrc" "$TERRAFORMRC_BACKUP"
    echo "Backed up existing ~/.terraformrc to $TERRAFORMRC_BACKUP"
fi

# Create Terraform CLI override config (after the pre-download so the
# dev_override doesn't interfere with registry resolution above).
cat > "$HOME/.terraformrc" << EOF
provider_installation {
  dev_overrides {
    "oneuptime/oneuptime" = "$INSTALL_DIR"
  }
  direct {}
}
EOF

echo "Provider installed to: $INSTALL_DIR"

# The update phase stashes update.tf (so the initial apply only sees main.tf)
# and copies it over main.tf. Track the in-flight test so an unexpected exit
# still restores the checked-in fixture files.
CURRENT_STASH_DIR=""
CURRENT_TEST_PATH=""

restore_current_fixture() {
    if [ -n "$CURRENT_STASH_DIR" ] && [ -d "$CURRENT_STASH_DIR" ] && [ -n "$CURRENT_TEST_PATH" ]; then
        if [ -f "$CURRENT_STASH_DIR/main.tf.orig" ]; then
            cp "$CURRENT_STASH_DIR/main.tf.orig" "$CURRENT_TEST_PATH/main.tf"
        fi
        if [ -f "$CURRENT_STASH_DIR/update.tf" ]; then
            mv "$CURRENT_STASH_DIR/update.tf" "$CURRENT_TEST_PATH/update.tf"
        fi
        rm -rf "$CURRENT_STASH_DIR"
    fi
    CURRENT_STASH_DIR=""
    CURRENT_TEST_PATH=""
}

on_exit() {
    restore_current_fixture
    restore_terraformrc
}
trap on_exit EXIT

#######################################
# API Helper Functions (for verify.sh scripts)
#######################################

# These functions are exported for use by verify.sh scripts

# Map output name to API endpoint
# e.g., "label_id" -> "/api/label", "monitor_status_id" -> "/api/monitor-status"
get_api_endpoint() {
    local output_name="$1"
    # Remove "_id" suffix and convert underscores to hyphens
    local resource_type="${output_name%_id}"
    resource_type="${resource_type//_/-}"
    echo "/api/${resource_type}"
}

# Verify resource was deleted via API.
# The get-item endpoint returns HTTP 200 with an empty JSON object ({}) for
# missing or deleted items — never 404 — so on a 2xx, deletion is judged by
# whether the response body still carries the item's _id. A 404 (unknown
# route) also counts as verified-deleted. Anything else (400, auth errors,
# 5xx, timeouts) means we could NOT confirm deletion and is a hard failure.
validate_resource_deleted() {
    local endpoint="$1"
    local resource_id="$2"

    echo "    Verifying deletion via API: POST ${ONEUPTIME_URL}${endpoint}/${resource_id}/get-item"

    local response
    local http_code
    local body
    if ! response=$(curl -s --max-time 30 -w $'\n%{http_code}' -X POST "${ONEUPTIME_URL}${endpoint}/${resource_id}/get-item" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d '{"select": {"_id": true}}' 2>&1); then
        echo "    ✗ Deletion verification FAILED: could not reach API (curl error/timeout)"
        return 1
    fi
    http_code="${response##*$'\n'}"
    body="${response%$'\n'*}"

    if [ "$http_code" -ge 200 ] 2>/dev/null && [ "$http_code" -lt 300 ]; then
        if echo "$body" | grep -q '"_id"'; then
            echo "    ✗ Deletion verification FAILED: Resource still exists (HTTP $http_code, body: $body)"
            return 1
        fi
        echo "    ✓ Deletion verified: Resource no longer exists (HTTP $http_code, empty body)"
        return 0
    elif [ "$http_code" -eq 404 ] 2>/dev/null; then
        echo "    ✓ Deletion verified: Resource no longer exists (HTTP 404)"
        return 0
    else
        echo "    ✗ Deletion verification FAILED: unexpected HTTP status '$http_code' — cannot confirm deletion (body: $body)"
        return 1
    fi
}

# Validate all resources were deleted
validate_all_deleted() {
    local test_path="$1"
    local saved_ids="$2"  # Format: "output_name=id\noutput_name2=id2\n..."
    local validation_failed=0

    echo "  Verifying resources were deleted via API..."

    while IFS= read -r output; do
        if [ -z "$output" ]; then
            continue
        fi

        local output_name="${output%%=*}"
        local resource_id="${output#*=}"

        if [ -z "$resource_id" ] || [ "$resource_id" = "null" ]; then
            continue
        fi

        local endpoint
        endpoint=$(get_api_endpoint "$output_name")

        if ! validate_resource_deleted "$endpoint" "$resource_id"; then
            validation_failed=1
        fi
    done <<< "$saved_ids"

    return $validation_failed
}

# Export functions and variables for verify.sh scripts
export -f get_api_endpoint
export ONEUPTIME_URL
export TF_VAR_api_key
export TF_VAR_project_id

#######################################
# Runner Phases
#######################################

# Post-apply drift gate: `terraform plan -detailed-exitcode` must exit 0.
# Every test inherits this — per-test verify.sh scripts must not re-implement
# (or weaken) it.
run_drift_gate() {
    local label="$1"
    local plan_output
    local plan_exit=0

    echo "  Running drift gate ($label)..."
    plan_output=$(terraform plan -detailed-exitcode -input=false 2>&1) || plan_exit=$?

    if [ "$plan_exit" -eq 0 ]; then
        echo "  ✓ No drift detected ($label)"
        return 0
    elif [ "$plan_exit" -eq 2 ]; then
        echo "  ✗ FAILED: drift detected after apply ($label)"
        echo "$plan_output"
        return 1
    else
        echo "  ✗ FAILED: terraform plan errored during drift gate ($label)"
        echo "$plan_output"
        return 1
    fi
}

# Import round-trip: for every oneuptime_* resource in state, drop it from
# state and re-import it by id, then require a clean plan. Catches broken or
# missing Read/import implementations. Addresses listed in the test's
# skip-import.txt (one per line, e.g. resources whose API has no read
# endpoint) are skipped.
run_import_phase() {
    local test_path="$1"
    local addrs
    local addr
    local id
    local show_json

    addrs=$(terraform state list 2>/dev/null | grep '^oneuptime_' || true)
    if [ -z "$addrs" ]; then
        echo "  No oneuptime_* resources in state — skipping import phase"
        return 0
    fi

    if ! show_json=$(terraform show -json 2>/dev/null); then
        echo "  ✗ FAILED: terraform show -json failed"
        return 1
    fi

    local imported=0
    while IFS= read -r addr; do
        [ -z "$addr" ] && continue

        if [ -f "$test_path/skip-import.txt" ] && grep -Fxq "$addr" "$test_path/skip-import.txt"; then
            echo "    Skipping import round-trip for $addr (listed in skip-import.txt)"
            continue
        fi

        id=$(echo "$show_json" | jq -r --arg addr "$addr" \
            '.values.root_module.resources[] | select(.address == $addr) | .values.id // empty')
        if [ -z "$id" ]; then
            echo "  ✗ FAILED: could not extract id for $addr from terraform show -json"
            return 1
        fi

        echo "    Import round-trip: $addr (id: $id)"
        if ! terraform state rm "$addr"; then
            echo "  ✗ FAILED: terraform state rm $addr"
            return 1
        fi
        if ! terraform import -input=false "$addr" "$id"; then
            echo "  ✗ FAILED: terraform import $addr $id"
            return 1
        fi
        imported=$((imported + 1))
    done <<< "$addrs"

    if [ "$imported" -eq 0 ]; then
        echo "  All resources skipped — no post-import plan needed"
        return 0
    fi

    if ! run_drift_gate "post-import"; then
        echo "  ✗ FAILED: plan not clean after import round-trip"
        return 1
    fi

    echo "  ✓ Import round-trip passed for $imported resource(s)"
    return 0
}

#######################################
# Main Test Runner
#######################################

# Discover all test directories dynamically (sorted by name)
TEST_DIRS=()
while IFS= read -r dir; do
    TEST_DIRS+=("$(basename "$dir")")
done < <(find "$TEST_DIR/tests" -mindepth 1 -maxdepth 1 -type d | sort)

echo "Discovered ${#TEST_DIRS[@]} test directories"

PASSED=()
FAILED=()

for test_name in "${TEST_DIRS[@]}"; do
    test_path="$TEST_DIR/tests/$test_name"

    if [ ! -d "$test_path" ]; then
        echo "SKIP: $test_name (not found)"
        continue
    fi

    echo ""
    echo "=========================================="
    echo "Testing: $test_name"
    echo "=========================================="

    cd "$test_path"
    # Wipe any state left over from a previous local run of this checkout.
    rm -rf tfplan terraform.tfstate terraform.tfstate.backup .terraform .terraform.lock.hcl

    # Stash update.tf before init: it redefines the same resources as main.tf,
    # so Terraform must not see both during the initial apply. The runner
    # copies it over main.tf for the update phase and restores the original
    # fixture afterwards (or on unexpected exit, via the EXIT trap).
    has_update=0
    if [ -f "$test_path/update.tf" ]; then
        has_update=1
        CURRENT_STASH_DIR=$(mktemp -d)
        CURRENT_TEST_PATH="$test_path"
        cp "$test_path/main.tf" "$CURRENT_STASH_DIR/main.tf.orig"
        mv "$test_path/update.tf" "$CURRENT_STASH_DIR/update.tf"
    fi

    # Phases (later phases are skipped once the test has failed; destroy and
    # deletion verification always run so resources don't leak):
    # 1. Init          5. Update (optional: update.tf / verify-update.sh)
    # 2. Plan + Apply  6. Import round-trip
    # 3. verify.sh     7. Destroy
    # 4. Drift gate    8. Verify deletion via API

    test_failed=0
    applied=0
    saved_ids=""

    # Init. We can't run `terraform init` here because the oneuptime provider
    # isn't published to the public registry — even with dev_overrides, init
    # still queries the registry for available versions and fails. So we plant
    # the pre-downloaded random provider and lock file directly into the
    # test's .terraform directory.
    echo "  [init]"
    if grep -q "hashicorp/random" "$test_path"/*.tf 2>/dev/null || \
       { [ "$has_update" -eq 1 ] && grep -q "hashicorp/random" "$CURRENT_STASH_DIR/update.tf" 2>/dev/null; }; then
        mkdir -p "$test_path/.terraform/providers/registry.terraform.io"
        cp -r "$RANDOM_PROVIDER_DIR/.terraform/providers/registry.terraform.io/hashicorp" "$test_path/.terraform/providers/registry.terraform.io/"
        cp "$RANDOM_PROVIDER_DIR/.terraform.lock.hcl" "$test_path/.terraform.lock.hcl"
    fi

    # Plan
    echo "  [plan]"
    if ! terraform plan -input=false -out=tfplan 2>&1; then
        echo "  ✗ FAILED: Plan failed"
        test_failed=1
    fi

    # Apply
    if [ $test_failed -eq 0 ]; then
        echo "  [apply]"
        if terraform apply -auto-approve tfplan 2>&1; then
            applied=1
        else
            echo "  ✗ FAILED: Apply failed"
            test_failed=1
            # Apply may have partially created resources; still destroy below.
            applied=1
        fi
    fi

    if [ $applied -eq 1 ]; then
        # Show outputs
        echo ""
        echo "  Terraform Outputs:"
        terraform output 2>&1 || true
        echo ""

        # Save resource IDs for deletion verification later
        saved_ids=$(terraform output -json 2>/dev/null | jq -r 'to_entries[] | select(.key | endswith("_id")) | "\(.key)=\(.value.value)"' 2>/dev/null || true)
    fi

    # verify.sh (API validation)
    if [ $test_failed -eq 0 ]; then
        echo "  [verify] Running API validation (verify.sh)..."
        if [ -f "$test_path/verify.sh" ]; then
            chmod +x "$test_path/verify.sh"
            if ! "$test_path/verify.sh"; then
                echo "  ✗ API validation failed"
                test_failed=1
            else
                echo "  ✓ API validation passed"
            fi
        else
            echo "  ⚠ No verify.sh found, skipping API validation"
        fi
        cd "$test_path"
    fi

    # Runner-level drift gate after the initial apply
    if [ $test_failed -eq 0 ]; then
        echo "  [drift]"
        if ! run_drift_gate "post-apply"; then
            test_failed=1
        fi
    fi

    # Update phase
    if [ $test_failed -eq 0 ] && [ $has_update -eq 1 ]; then
        echo "  [update] Applying update.tf..."
        cp "$CURRENT_STASH_DIR/update.tf" "$test_path/main.tf"
        if ! terraform apply -input=false -auto-approve 2>&1; then
            echo "  ✗ FAILED: Update apply failed"
            test_failed=1
        else
            # Outputs may have changed with the updated config
            saved_ids=$(terraform output -json 2>/dev/null | jq -r 'to_entries[] | select(.key | endswith("_id")) | "\(.key)=\(.value.value)"' 2>/dev/null || true)

            if [ -f "$test_path/verify-update.sh" ]; then
                echo "  [verify-update] Running post-update API validation (verify-update.sh)..."
                chmod +x "$test_path/verify-update.sh"
                if ! "$test_path/verify-update.sh"; then
                    echo "  ✗ Post-update API validation failed"
                    test_failed=1
                else
                    echo "  ✓ Post-update API validation passed"
                fi
                cd "$test_path"
            fi

            if [ $test_failed -eq 0 ] && ! run_drift_gate "post-update"; then
                test_failed=1
            fi
        fi
    fi

    # Import round-trip phase
    if [ $test_failed -eq 0 ] && [ $applied -eq 1 ]; then
        echo "  [import]"
        if ! run_import_phase "$test_path"; then
            test_failed=1
        fi
    fi

    # Destroy (always attempted once an apply ran)
    if [ $applied -eq 1 ]; then
        echo ""
        echo "  [destroy]"
        cd "$test_path"
        if ! terraform destroy -auto-approve 2>&1; then
            echo "  ✗ FAILED: Destroy failed"
            test_failed=1
        fi

        # Verify deletion via API — a failure here means resources leaked (or
        # the API could not confirm deletion) and fails the test.
        echo ""
        echo "  [verify-deletion]"
        if [ -n "$saved_ids" ]; then
            if ! validate_all_deleted "$test_path" "$saved_ids"; then
                echo "  ✗ FAILED: Deletion verification failed"
                test_failed=1
            fi
        fi
    fi

    # Restore fixture files mutated by the update phase
    restore_current_fixture

    # Cleanup state files
    rm -rf tfplan terraform.tfstate terraform.tfstate.backup .terraform .terraform.lock.hcl

    # Mark test result
    if [ $test_failed -eq 0 ]; then
        echo ""
        echo "  ✓ PASSED: $test_name"
        PASSED+=("$test_name")
    else
        FAILED+=("$test_name")
    fi
done

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Passed: ${#PASSED[@]}"
for t in "${PASSED[@]}"; do echo "  ✓ $t"; done

if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Failed: ${#FAILED[@]}"
    for t in "${FAILED[@]}"; do echo "  ✗ $t"; done
    exit 1
fi

echo ""
echo "All tests passed!"
