# Terraform Provider E2E Tests - Implementation Plan

## Executive Summary

This document outlines the implementation plan for comprehensive end-to-end tests for the OneUptime Terraform provider. The tests will validate that Terraform can successfully create, read, update, and delete resources through the OneUptime API.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Files to Create](#files-to-create)
4. [GitHub Actions Workflow](#github-actions-workflow)
5. [Test Setup Scripts](#test-setup-scripts)
6. [Terraform Test Configurations](#terraform-test-configurations)
7. [Resource Test Order](#resource-test-order)
8. [Potential Generator Fixes](#potential-generator-fixes)
9. [Verification Steps](#verification-steps)

---

## Overview

### Goals
1. Start OneUptime services in CI/CD environment
2. Register a test account programmatically
3. Create a project and API key with ProjectOwner permissions
4. Generate the Terraform provider from source
5. Run Terraform tests for: Labels, Monitors, Status Pages, Incidents, Alerts, and related resources

### Test Flow
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Start Services │────▶│  Setup Account  │────▶│ Generate Provider│
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
┌─────────────────┐     ┌─────────────────┐              ▼
│   Run Cleanup   │◀────│  Run TF Tests   │◀────┌─────────────────┐
└─────────────────┘     └─────────────────┘     │ Install Provider │
                                                └─────────────────┘
```

---

## Architecture

### Services Required
The following Docker services must be running:
- `postgres` - Database
- `redis` - Cache/Queue
- `clickhouse` - Analytics database
- `app` - Main API server
- `accounts` - Authentication service
- `ingress` - NGINX reverse proxy
- `worker` - Background jobs

### API Endpoints Used
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/status` | GET | Health check |
| `/api/identity/signup` | POST | Register user |
| `/api/identity/login` | POST | Login user |
| `/api/project` | POST | Create/List projects |
| `/api/api-key` | POST | Create API key |
| `/api/api-key-permission` | POST | Add permissions |

### Provider Authentication
The generated provider uses the `APIKey` header:
```go
// From Scripts/TerraformProvider/Core/ProviderGenerator.ts:248
req.Header.Set("APIKey", c.ApiKey)
```

---

## Files to Create

### Directory Structure
```
E2E/Terraform/
├── e2e-tests/
│   ├── scripts/
│   │   ├── wait-for-services.sh      # Wait for OneUptime to be ready
│   │   ├── setup-test-account.sh     # Register user, create project, API key
│   │   ├── run-tests.sh              # Execute all Terraform tests
│   │   └── cleanup.sh                # Clean up test resources
│   ├── tests/
│   │   ├── 01-label/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   ├── 02-monitor-status/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   ├── 03-incident-severity/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   ├── 04-incident-state/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   ├── 05-status-page/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   ├── 06-alert-severity/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   └── 07-alert-state/
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       └── outputs.tf
│   └── provider.tf                    # Common provider configuration
└── terraform-provider-oneuptime/      # Generated provider (existing)

.github/workflows/
└── terraform-provider-e2e.yml         # New E2E test workflow
```

---

## GitHub Actions Workflow

### File: `.github/workflows/terraform-provider-e2e.yml`

```yaml
name: Terraform Provider E2E Tests

on:
  pull_request:
  push:
    branches:
      - main
      - master
      - develop
  workflow_dispatch:

jobs:
  terraform-e2e-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      CI_PIPELINE_ID: ${{ github.run_number }}
      APP_TAG: latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: latest
          cache: 'npm'

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'
          cache: true

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.6.0"
          terraform_wrapper: false

      - name: Copy config.env
        run: cp config.example.env config.env

      - name: Start OneUptime Services
        run: |
          docker compose -f docker-compose.yml up -d postgres redis clickhouse app accounts ingress worker
          chmod +x ./E2E/Terraform/e2e-tests/scripts/*.sh
          ./E2E/Terraform/e2e-tests/scripts/wait-for-services.sh

      - name: Install Dependencies
        run: |
          npm install
          cd Common && npm install && cd ..
          cd Scripts && npm install && cd ..

      - name: Generate Terraform Provider
        run: npm run generate-terraform-provider

      - name: Setup Test Environment
        run: |
          cd E2E/Terraform/e2e-tests
          ./scripts/setup-test-account.sh

      - name: Run Terraform E2E Tests
        run: |
          cd E2E/Terraform/e2e-tests
          ./scripts/run-tests.sh

      - name: Cleanup
        if: always()
        run: |
          cd E2E/Terraform/e2e-tests
          ./scripts/cleanup.sh || true
          docker compose down -v || true
```

---

## Test Setup Scripts

### 1. Wait for Services Script
**File: `E2E/Terraform/e2e-tests/scripts/wait-for-services.sh`**

```bash
#!/bin/bash
set -e

ONEUPTIME_URL="${ONEUPTIME_URL:-http://localhost}"
MAX_RETRIES=60
RETRY_INTERVAL=5

echo "Waiting for OneUptime services to be ready..."

for i in $(seq 1 $MAX_RETRIES); do
    if curl -sf "${ONEUPTIME_URL}/api/status" > /dev/null 2>&1; then
        echo "OneUptime API is ready!"
        exit 0
    fi
    echo "Attempt $i/$MAX_RETRIES - Services not ready yet, waiting ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL
done

echo "ERROR: OneUptime services failed to start within timeout"
exit 1
```

### 2. Setup Test Account Script
**File: `E2E/Terraform/e2e-tests/scripts/setup-test-account.sh`**

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
ONEUPTIME_URL="${ONEUPTIME_URL:-http://localhost}"

# Generate unique test values
TIMESTAMP=$(date +%s)
TEST_EMAIL="terraform-test-${TIMESTAMP}@test.oneuptime.com"
TEST_PASSWORD="TestPassword123!"
TEST_NAME="Terraform E2E Test User"

echo "=== Setting up test account ==="
echo "Email: $TEST_EMAIL"

# Step 1: Register a new user
echo "Step 1: Registering new user..."
SIGNUP_RESPONSE=$(curl -sf -X POST "${ONEUPTIME_URL}/api/identity/signup" \
    -H "Content-Type: application/json" \
    -d "{
        \"data\": {
            \"email\": \"$TEST_EMAIL\",
            \"password\": \"$TEST_PASSWORD\",
            \"name\": \"$TEST_NAME\",
            \"companyName\": \"Terraform E2E Test Company\",
            \"companyPhoneNumber\": \"+15551234567\"
        }
    }")

echo "User registered successfully"

# Step 2: Login to get session
echo "Step 2: Logging in..."
LOGIN_RESPONSE=$(curl -sf -X POST "${ONEUPTIME_URL}/api/identity/login" \
    -H "Content-Type: application/json" \
    -c "$TEST_DIR/cookies.txt" \
    -d "{
        \"data\": {
            \"email\": \"$TEST_EMAIL\",
            \"password\": \"$TEST_PASSWORD\"
        }
    }")

COOKIES="-b $TEST_DIR/cookies.txt"
echo "Login successful"

# Step 3: Get or create project
echo "Step 3: Fetching project..."
sleep 3  # Wait for automatic project creation

PROJECT_RESPONSE=$(curl -sf -X POST "${ONEUPTIME_URL}/api/project/get-list" \
    -H "Content-Type: application/json" \
    $COOKIES \
    -d "{
        \"query\": {},
        \"select\": {\"_id\": true, \"name\": true},
        \"limit\": 1
    }")

PROJECT_ID=$(echo "$PROJECT_RESPONSE" | jq -r '.data[0]._id // empty')

if [ -z "$PROJECT_ID" ]; then
    echo "Creating new project..."
    PROJECT_CREATE=$(curl -sf -X POST "${ONEUPTIME_URL}/api/project" \
        -H "Content-Type: application/json" \
        $COOKIES \
        -d "{
            \"data\": {
                \"name\": \"Terraform E2E Test Project\"
            }
        }")
    PROJECT_ID=$(echo "$PROJECT_CREATE" | jq -r '.data._id // ._id')
fi

echo "Project ID: $PROJECT_ID"

# Step 4: Create API Key
echo "Step 4: Creating API key..."
EXPIRES_AT=$(date -d "+1 year" -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || \
             date -v+1y -u +"%Y-%m-%dT%H:%M:%S.000Z")

API_KEY_RESPONSE=$(curl -sf -X POST "${ONEUPTIME_URL}/api/api-key" \
    -H "Content-Type: application/json" \
    -H "projectid: $PROJECT_ID" \
    $COOKIES \
    -d "{
        \"data\": {
            \"name\": \"Terraform E2E Test API Key\",
            \"description\": \"API Key for Terraform E2E Tests\",
            \"expiresAt\": \"$EXPIRES_AT\",
            \"projectId\": \"$PROJECT_ID\"
        }
    }")

API_KEY_ID=$(echo "$API_KEY_RESPONSE" | jq -r '.data._id // ._id')
API_KEY=$(echo "$API_KEY_RESPONSE" | jq -r '.data.apiKey // .apiKey')

echo "API Key ID: $API_KEY_ID"
echo "API Key: $API_KEY"

# Step 5: Add ProjectOwner permission
echo "Step 5: Adding ProjectOwner permission..."
PERMISSION_RESPONSE=$(curl -sf -X POST "${ONEUPTIME_URL}/api/api-key-permission" \
    -H "Content-Type: application/json" \
    -H "projectid: $PROJECT_ID" \
    $COOKIES \
    -d "{
        \"data\": {
            \"apiKeyId\": \"$API_KEY_ID\",
            \"projectId\": \"$PROJECT_ID\",
            \"permission\": \"ProjectOwner\",
            \"isBlockPermission\": false
        }
    }")

echo "Permission added"

# Step 6: Write environment file
echo "Step 6: Writing test environment..."
cat > "$TEST_DIR/test-env.sh" << EOF
#!/bin/bash
export ONEUPTIME_URL="$ONEUPTIME_URL"
export ONEUPTIME_API_KEY="$API_KEY"
export ONEUPTIME_PROJECT_ID="$PROJECT_ID"
export TF_VAR_project_id="$PROJECT_ID"
export TF_VAR_api_key="$API_KEY"
export TF_VAR_oneuptime_url="$ONEUPTIME_URL"
EOF

chmod +x "$TEST_DIR/test-env.sh"

# Cleanup cookies
rm -f "$TEST_DIR/cookies.txt"

echo ""
echo "=== Setup Complete ==="
echo "ONEUPTIME_URL: $ONEUPTIME_URL"
echo "PROJECT_ID: $PROJECT_ID"
echo "API_KEY: $API_KEY"
```

### 3. Run Tests Script
**File: `E2E/Terraform/e2e-tests/scripts/run-tests.sh`**

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
PROVIDER_DIR="$TEST_DIR/../terraform-provider-oneuptime"

# Load test environment
source "$TEST_DIR/test-env.sh"

echo "=== Running Terraform E2E Tests ==="
echo "OneUptime URL: $ONEUPTIME_URL"
echo "Project ID: $ONEUPTIME_PROJECT_ID"

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

# Create Terraform CLI override config
cat > "$HOME/.terraformrc" << EOF
provider_installation {
  dev_overrides {
    "oneuptime/oneuptime" = "$INSTALL_DIR"
  }
  direct {}
}
EOF

echo "Provider installed to: $INSTALL_DIR"

# Test directories in order
TEST_DIRS=(
    "01-label"
    "02-monitor-status"
    "03-incident-severity"
    "04-incident-state"
    "05-status-page"
    "06-alert-severity"
    "07-alert-state"
)

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

    # Init
    echo "  [1/4] Initializing..."
    if ! terraform init -upgrade 2>&1; then
        echo "  FAILED: Init failed"
        FAILED+=("$test_name")
        continue
    fi

    # Plan
    echo "  [2/4] Planning..."
    if ! terraform plan -out=tfplan 2>&1; then
        echo "  FAILED: Plan failed"
        FAILED+=("$test_name")
        continue
    fi

    # Apply
    echo "  [3/4] Applying..."
    if ! terraform apply -auto-approve tfplan 2>&1; then
        echo "  FAILED: Apply failed"
        FAILED+=("$test_name")
        # Try to cleanup anyway
        terraform destroy -auto-approve 2>&1 || true
        continue
    fi

    # Show outputs
    echo "  Outputs:"
    terraform output 2>&1 || true

    # Destroy
    echo "  [4/4] Destroying..."
    if ! terraform destroy -auto-approve 2>&1; then
        echo "  WARNING: Destroy failed"
        FAILED+=("$test_name (destroy)")
    fi

    # Cleanup state files
    rm -f tfplan terraform.tfstate terraform.tfstate.backup

    echo "  PASSED: $test_name"
    PASSED+=("$test_name")
done

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Passed: ${#PASSED[@]}"
for t in "${PASSED[@]}"; do echo "  - $t"; done

if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Failed: ${#FAILED[@]}"
    for t in "${FAILED[@]}"; do echo "  - $t"; done
    exit 1
fi

echo ""
echo "All tests passed!"
```

### 4. Cleanup Script
**File: `E2E/Terraform/e2e-tests/scripts/cleanup.sh`**

```bash
#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Cleaning up ==="

# Remove Terraform state files
find "$TEST_DIR/tests" -name "*.tfstate*" -delete 2>/dev/null || true
find "$TEST_DIR/tests" -name ".terraform" -type d -exec rm -rf {} + 2>/dev/null || true
find "$TEST_DIR/tests" -name ".terraform.lock.hcl" -delete 2>/dev/null || true
find "$TEST_DIR/tests" -name "tfplan" -delete 2>/dev/null || true

# Remove test env file
rm -f "$TEST_DIR/test-env.sh"
rm -f "$TEST_DIR/cookies.txt"

# Remove Terraform CLI override
rm -f "$HOME/.terraformrc"

# Remove local provider installation
rm -rf "$HOME/.terraform.d/plugins/registry.terraform.io/oneuptime" 2>/dev/null || true

echo "Cleanup complete"
```

---

## Terraform Test Configurations

### Common Variables File
**File: `E2E/Terraform/e2e-tests/tests/*/variables.tf`** (same for all tests)

```hcl
variable "oneuptime_url" {
  type        = string
  description = "OneUptime API URL"
}

variable "api_key" {
  type        = string
  description = "OneUptime API Key"
  sensitive   = true
}

variable "project_id" {
  type        = string
  description = "OneUptime Project ID"
}
```

### Test 1: Label
**File: `E2E/Terraform/e2e-tests/tests/01-label/main.tf`**

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "oneuptime_label" "test" {
  project_id  = var.project_id
  name        = "terraform-e2e-label-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Label created by Terraform E2E tests"
  color       = "#FF5733"
}

output "label_id" {
  value = oneuptime_label.test.id
}

output "label_name" {
  value = oneuptime_label.test.name
}
```

### Test 2: Monitor Status
**File: `E2E/Terraform/e2e-tests/tests/02-monitor-status/main.tf`**

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "oneuptime_monitor_status" "test" {
  project_id         = var.project_id
  name               = "terraform-e2e-status-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description        = "Monitor status created by Terraform E2E tests"
  color              = "#00FF00"
  priority           = 99
  is_operational_state = true
}

output "monitor_status_id" {
  value = oneuptime_monitor_status.test.id
}
```

### Test 3: Incident Severity
**File: `E2E/Terraform/e2e-tests/tests/03-incident-severity/main.tf`**

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "oneuptime_incident_severity" "test" {
  project_id  = var.project_id
  name        = "terraform-e2e-severity-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Incident severity created by Terraform E2E tests"
  color       = "#FFA500"
  order       = 99
}

output "incident_severity_id" {
  value = oneuptime_incident_severity.test.id
}
```

### Test 4: Incident State
**File: `E2E/Terraform/e2e-tests/tests/04-incident-state/main.tf`**

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "oneuptime_incident_state" "test" {
  project_id  = var.project_id
  name        = "terraform-e2e-state-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Incident state created by Terraform E2E tests"
  color       = "#0000FF"
  order       = 99
}

output "incident_state_id" {
  value = oneuptime_incident_state.test.id
}
```

### Test 5: Status Page
**File: `E2E/Terraform/e2e-tests/tests/05-status-page/main.tf`**

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "oneuptime_status_page" "test" {
  project_id              = var.project_id
  name                    = "terraform-e2e-statuspage-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description             = "Status page created by Terraform E2E tests"
  page_title              = "Terraform Test Status"
  page_description        = "This is a test status page"
  is_public_status_page   = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

output "status_page_id" {
  value = oneuptime_status_page.test.id
}
```

### Test 6: Alert Severity
**File: `E2E/Terraform/e2e-tests/tests/06-alert-severity/main.tf`**

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "oneuptime_alert_severity" "test" {
  project_id  = var.project_id
  name        = "terraform-e2e-alert-sev-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Alert severity created by Terraform E2E tests"
  color       = "#FF0000"
  order       = 99
}

output "alert_severity_id" {
  value = oneuptime_alert_severity.test.id
}
```

### Test 7: Alert State
**File: `E2E/Terraform/e2e-tests/tests/07-alert-state/main.tf`**

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "oneuptime_alert_state" "test" {
  project_id  = var.project_id
  name        = "terraform-e2e-alert-state-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  description = "Alert state created by Terraform E2E tests"
  color       = "#800080"
  order       = 99
}

output "alert_state_id" {
  value = oneuptime_alert_state.test.id
}
```

---

## Resource Test Order

Tests must run in this order to respect dependencies:

| Order | Resource | Dependencies | Purpose |
|-------|----------|--------------|---------|
| 1 | Label | None | Basic CRUD validation |
| 2 | MonitorStatus | None | Required for Monitor tests |
| 3 | IncidentSeverity | None | Required for Incident tests |
| 4 | IncidentState | None | Required for Incident tests |
| 5 | StatusPage | None | Status page CRUD |
| 6 | AlertSeverity | None | Required for Alert tests |
| 7 | AlertState | None | Required for Alert tests |

---

## Potential Generator Fixes

If bugs are discovered during E2E testing, fixes should be made in the generator code, not the generated provider:

| Issue | File to Modify |
|-------|----------------|
| API authentication issues | `Scripts/TerraformProvider/Core/ProviderGenerator.ts` |
| Resource CRUD operations | `Scripts/TerraformProvider/Core/ResourceGenerator.ts` |
| Schema parsing issues | `Scripts/TerraformProvider/Core/OpenAPIParser.ts` |
| Data source issues | `Scripts/TerraformProvider/Core/DataSourceGenerator.ts` |
| Type mapping issues | `Scripts/TerraformProvider/Core/Types.ts` |

### Known Areas to Watch
1. **APIKey Header** (line 248 in ProviderGenerator.ts): Currently uses `APIKey`, verify this matches API expectations
2. **Project ID**: Resources are tenant-scoped; ensure projectId is passed correctly
3. **Response Parsing**: Complex object responses may need special handling

---

## Verification Steps

### Local Testing
```bash
# 1. Start services
cp config.example.env config.env
docker compose up -d postgres redis clickhouse app accounts ingress worker

# 2. Wait for services
./E2E/Terraform/e2e-tests/scripts/wait-for-services.sh

# 3. Setup test account
./E2E/Terraform/e2e-tests/scripts/setup-test-account.sh

# 4. Generate provider
npm run generate-terraform-provider

# 5. Run tests
./E2E/Terraform/e2e-tests/scripts/run-tests.sh

# 6. Cleanup
./E2E/Terraform/e2e-tests/scripts/cleanup.sh
docker compose down -v
```

### CI/CD Verification
1. Push changes to a branch
2. Create a pull request
3. Verify the `terraform-provider-e2e.yml` workflow runs successfully
4. Check that all Terraform resource tests pass

---

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `ONEUPTIME_URL` | OneUptime API base URL | `http://localhost` |
| `ONEUPTIME_API_KEY` | API key for authentication | `abc123...` |
| `ONEUPTIME_PROJECT_ID` | Project ID for resources | `6789...` |
| `TF_VAR_project_id` | Terraform variable | Same as PROJECT_ID |
| `TF_VAR_api_key` | Terraform variable | Same as API_KEY |
| `TF_VAR_oneuptime_url` | Terraform variable | Same as ONEUPTIME_URL |
