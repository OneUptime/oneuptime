# Terraform Provider E2E Tests

End-to-end tests for the OneUptime Terraform Provider. These tests validate that the generated Terraform provider works correctly against a running OneUptime instance.

## Directory Structure

```
e2e-tests/
├── scripts/
│   ├── index.sh              # Main entry point - orchestrates the full test flow
│   ├── setup-test-account.sh # Creates test user, project, and API key
│   ├── run-tests.sh          # Builds provider and runs all test cases
│   └── cleanup.sh            # Cleans up test artifacts and state files
└── tests/
    ├── 01-label/             # Label resource tests
    ├── 02-monitor-status/    # Monitor status resource tests
    ├── 03-incident-severity/ # Incident severity resource tests
    ├── 04-incident-state/    # Incident state resource tests
    ├── 05-status-page/       # Status page resource tests
    ├── 06-alert-severity/    # Alert severity resource tests
    └── 07-alert-state/       # Alert state resource tests
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

Each test case in `tests/` follows this pattern:
1. `terraform init` - Initialize the Terraform configuration
2. `terraform plan` - Create an execution plan
3. `terraform apply` - Create the resources
4. `terraform output` - Display created resource information
5. `terraform destroy` - Clean up created resources

## Environment Variables

The following environment variables are used:

| Variable | Default | Description |
|----------|---------|-------------|
| `ONEUPTIME_URL` | `http://localhost` | OneUptime instance URL |
| `ONEUPTIME_API_KEY` | (generated) | API key for authentication |
| `ONEUPTIME_PROJECT_ID` | (generated) | Project ID for resources |

## CI/CD

Tests run automatically via GitHub Actions on:
- Pull requests
- Pushes to `main`, `master`, or `develop` branches
- Manual workflow dispatch

See `.github/workflows/terraform-provider-e2e.yml` for the workflow configuration.

## Adding New Tests

1. Create a new directory in `tests/` with the naming convention `XX-resource-name/`
2. Add `main.tf` with the Terraform configuration
3. Add `variables.tf` with required variables
4. Add the test directory name to the `TEST_DIRS` array in `scripts/run-tests.sh`
