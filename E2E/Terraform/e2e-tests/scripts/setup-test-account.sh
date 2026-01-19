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
            \"email\": {\"_type\": \"Email\", \"value\": \"$TEST_EMAIL\"},
            \"password\": {\"_type\": \"HashedString\", \"value\": \"$TEST_PASSWORD\"},
            \"name\": {\"_type\": \"Name\", \"value\": \"$TEST_NAME\"},
            \"companyName\": \"Terraform E2E Test Company\",
            \"companyPhoneNumber\": {\"_type\": \"Phone\", \"value\": \"+15551234567\"}
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
            \"email\": {\"_type\": \"Email\", \"value\": \"$TEST_EMAIL\"},
            \"password\": {\"_type\": \"HashedString\", \"value\": \"$TEST_PASSWORD\"}
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
# Extract the value from the ObjectID object (apiKey is returned as {_type: "ObjectID", value: "..."})
API_KEY=$(echo "$API_KEY_RESPONSE" | jq -r '(.data.apiKey.value // .apiKey.value) // (.data.apiKey // .apiKey)')

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
