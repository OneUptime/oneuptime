# E2E Tests

End-to-end tests for OneUptime using [Playwright](https://playwright.dev/).

## Prerequisites

- Node.js (v18 or higher recommended)
- npm

## Installation

```bash
cd E2E
npm install
```

This will automatically install Playwright browsers and dependencies via the `preinstall` script.

## Configuration

The tests use environment variables for configuration. Set the following variables before running tests in config.env:

| Variable | Description | Default |
|----------|-------------|---------|
| `HOST` | The hostname to test against | `localhost` |
| `HTTP_PROTOCOL` | Protocol to use (`http` or `https`) | `http` |
| `BILLING_ENABLED` | Enable billing-related tests | `false` |
| `E2E_TEST_IS_USER_REGISTERED` | Whether a test user is already registered | `false` |
| `E2E_TEST_REGISTERED_USER_EMAIL` | Email of the registered test user | - |
| `E2E_TEST_REGISTERED_USER_PASSWORD` | Password of the registered test user | - |
| `E2E_TEST_STATUS_PAGE_URL` | URL of a status page to test | - |
| `E2E_TESTS_FAILED_WEBHOOK_URL` | Webhook URL to call on test failure | - |

### Example

```bash
export HOST=staging.oneuptime.com
export HTTP_PROTOCOL=https
export BILLING_ENABLED=true
```

## Running Tests

### Run all tests

```bash
npm test
```

### Run tests in debug mode

```bash
npm run debug-tests
```

### Run specific test file

```bash
npx playwright test Tests/Home/Landing.spec.ts
```

### Run tests for a specific browser

```bash
# Chromium only
npx playwright test --project=chromium

# Firefox only
npx playwright test --project=firefox
```

### Run tests with UI mode

```bash
npx playwright test --ui
```

### Run a specific test by name

```bash
npx playwright test -g "oneUptime link navigate to homepage"
```

## Test Structure

```
E2E/
├── Tests/
│   ├── Accounts/       # Account-related tests (login, registration)
│   ├── App/            # Main application tests
│   ├── Home/           # Homepage tests
│   ├── IncomingRequestIngest/
│   ├── ProbeIngest/
│   ├── StatusPage/     # Status page tests
│   └── TelemetryIngest/
├── Config.ts           # Environment configuration
├── playwright.config.ts # Playwright configuration
└── package.json
```

## Viewing Test Reports

After running tests, an HTML report is generated. Open it with:

```bash
npx playwright show-report
```

## Test Configuration

The Playwright configuration (`playwright.config.ts`) includes:

- **Timeout**: 240 seconds per test
- **Retries**: 3 retries on failure
- **Browsers**: Chromium and Firefox
- **Tracing**: Enabled for debugging failed tests

## Debugging

### View traces

When tests fail, traces are collected. View them with:

```bash
npx playwright show-trace test-results/<test-name>/trace.zip
```

### Run in headed mode

```bash
npx playwright test --headed
```

### Slow down execution

```bash
npx playwright test --headed --slow-mo=1000
```

## CI/CD

For CI environments, the `CI` environment variable is automatically detected:
- `test.only` usage will fail the build
- Parallel test execution is disabled (workers: 1)

## Troubleshooting

### Playwright browsers not installed

```bash
npx playwright install
npx playwright install-deps
```

### Clear and reinstall dependencies

```bash
npm run clear-modules
```
