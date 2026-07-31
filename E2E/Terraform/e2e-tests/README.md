# Terraform Provider E2E Tests

End-to-end tests for the OneUptime Terraform Provider. These tests validate that the generated Terraform provider works correctly against a running OneUptime instance.

## Directory Structure

```
e2e-tests/
├── scripts/
│   ├── index.sh              # Main entry point - orchestrates the full test flow
│   ├── setup-test-account.sh # Creates test user, project, and API key
│   ├── run-tests.sh          # Builds provider and runs all test cases
│   ├── lib.sh                # Shared library with common test utilities
│   └── cleanup.sh            # Cleans up test artifacts and state files
└── tests/
    ├── 01-label/             # Label resource tests
    ├── 02-monitor-status/    # Monitor status resource tests
    ├── 03-incident-severity/ # Incident severity resource tests
    ├── ...                   # More test directories
    └── XX-resource-name/     # Each test has main.tf, variables.tf, and verify.sh
```

## Running Tests

### Full E2E Test Suite (CI/CD)

The `index.sh` script runs the complete test flow:

```bash
./scripts/index.sh
```

This will:

1. Set up `config.env` from the example file
2. Start OneUptime services via Docker Compose
3. Wait for services to be ready
4. Install npm dependencies
5. Generate the Terraform provider
6. Create a test account with API key
7. Run all Terraform tests
8. Clean up on exit

### Running Individual Scripts

If you already have OneUptime running locally:

```bash
# Set up test account and API key
./scripts/setup-test-account.sh

# Run the Terraform tests
./scripts/run-tests.sh

# Clean up after testing
./scripts/cleanup.sh
```

## Test Flow

The runner (`run-tests.sh`) drives every test through the same phases:

1. **Init** - Plant the pre-downloaded providers (the oneuptime provider uses a dev_override)
2. **Plan + Apply** - Create the resources
3. **verify.sh** - API-side validation of created resources
4. **Drift gate** - `terraform plan -detailed-exitcode` must exit 0. Every test inherits this; verify.sh scripts must NOT re-implement (or weaken) plan checks.
5. **Update phase** (only if the test dir contains `update.tf`) - The runner copies `update.tf` over `main.tf` (other `.tf` files are kept), re-applies, runs `verify-update.sh` if present, then requires a clean plan again. `update.tf` is a full config that redefines the same resources with 2-3 mutable fields changed; the runner stashes it before the initial apply so Terraform never sees both files at once.
6. **Import round-trip** - For every `oneuptime_*` address in state: `terraform state rm`, then `terraform import` by id, then a final clean plan. Resources listed in the test's optional `skip-import.txt` (one address per line, e.g. resources whose API has no read endpoint) are skipped.
7. **Destroy**
8. **Deletion verification** - Each `*_id` output is checked via the API. Only an empty 2xx body or a 404 counts as deleted; a body still carrying `_id` or any other status (400/auth errors/5xx/timeout) fails the test.

### Fixture rules

- Use **static names** — the suite runs against a fresh test account per run, so collisions are not a concern. Never use `timestamp()`/`formatdate()` in resource arguments; they make every subsequent plan dirty by construction.
- Do not use `lifecycle { ignore_changes = [...] }` to mask drift. Server-normalized date fields should use fixed future RFC3339 timestamps so regressions in the provider's semantic date equality are caught.

## Shared Library (lib.sh)

The `scripts/lib.sh` file provides common utility functions for verify.sh scripts:

### Helper Functions

| Function                                                    | Description                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `unwrap_value "$json"`                                      | Unwrap API values from wrapper format (e.g., `{"_type": "Color", "value": "#FF5733"}` → `#FF5733`) |
| `get_output "name"`                                         | Get a Terraform output value safely (returns empty string if not found)                            |
| `assert_not_empty "$value" "name"`                          | Assert that a value is not empty                                                                   |
| `assert_equals "$expected" "$actual" "name"`                | Assert two values are equal                                                                        |
| `api_get_resource "/api/endpoint" "$id" '{"select": true}'` | Make an API call to get a resource                                                                 |
| `verify_resource_exists "/api/endpoint" "$id"`              | Verify a resource exists in the API                                                                |
| `validate_field "$response" "field" "$expected"`            | Validate a field from API response (handles wrapper unwrapping)                                    |
| `print_header "Test Name"`                                  | Print test header                                                                                  |
| `print_passed "Test Name"`                                  | Print test passed message                                                                          |
| `print_failed "Test Name"`                                  | Print test failed message and exit                                                                 |

### Example verify.sh

```bash
#!/bin/bash
set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "My Resource Verification"

# Get terraform outputs
RESOURCE_ID=$(get_output resource_id)
EXPECTED_NAME=$(get_output resource_name)

# Verify resource exists
if ! verify_resource_exists "/api/my-resource" "$RESOURCE_ID"; then
    print_failed "My Resource Verification"
fi

# Get full resource for validation
RESPONSE=$(api_get_resource "/api/my-resource" "$RESOURCE_ID" '{"_id": true, "name": true}')

# Validate fields
validation_failed=0
validate_field "$RESPONSE" "name" "$EXPECTED_NAME" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "My Resource Verification"
fi

print_passed "My Resource Verification"
```

Note: verify.sh scripts are for API-side assertions only. Drift/idempotency
is enforced centrally by the runner's plan gate — do not run `terraform plan`
from verify.sh.

## Environment Variables

The following environment variables are used:

| Variable            | Default            | Description                |
| ------------------- | ------------------ | -------------------------- |
| `ONEUPTIME_URL`     | `http://localhost` | OneUptime instance URL     |
| `TF_VAR_api_key`    | (generated)        | API key for authentication |
| `TF_VAR_project_id` | (generated)        | Project ID for resources   |

## CI/CD

Tests run automatically via GitHub Actions on:

- Pull requests
- Pushes to `main`, `master`, or `develop` branches
- Manual workflow dispatch
- `workflow_call` from other workflows (the release pipeline uses this workflow as a gate)

The workflow pins Terraform to 1.9.8, runs `go vet` / `go test` on the
generated provider, and runs the test suite exactly once (only the flaky
services bring-up step is retried).

See `.github/workflows/terraform-provider-e2e.yml` for the workflow configuration.

## Local Development Notes

- `run-tests.sh` writes a dev_overrides config to `~/.terraformrc`. A pre-existing file is backed up to `~/.terraformrc.oneuptime-e2e-backup` and restored on exit (and by `cleanup.sh`).
- Session cookies are written to a temp file, never into the repo.

## Adding New Tests

1. Create a new directory in `tests/` with the naming convention `XX-resource-name/`
2. Add `main.tf` with the Terraform configuration
3. Add `variables.tf` with required variables
4. Add `verify.sh` for API validation (source the shared library)
5. Optionally add `update.tf` (full config with 2-3 mutable fields changed) and `verify-update.sh` for update coverage
6. Optionally add `skip-import.txt` listing resource addresses that cannot be imported
7. Test directories are auto-discovered by `run-tests.sh`

### Test Naming Convention

- `01-XX` - Basic resource creation tests
- `09-XX-crud` - Full CRUD operation tests
- `XX-server-defaults` - Tests for server-computed default values
- `XX-idempotency` - Tests for idempotency verification
