# E2E Tests

End-to-end tests for OneUptime using [Playwright](https://playwright.dev/).

## Prerequisites

- Node.js (v18 or higher recommended)
- npm

## Installation

```bash
cd packages/E2E
npm install
```

This will automatically install Playwright browsers and dependencies via the `preinstall` script.

## Configuration

The tests use environment variables for configuration. Set the following variables before running tests in config.env:

| Variable                            | Description                               | Default     |
| ----------------------------------- | ----------------------------------------- | ----------- |
| `HOST`                              | The hostname to test against              | `localhost` |
| `HTTP_PROTOCOL`                     | Protocol to use (`http` or `https`)       | `http`      |
| `BILLING_ENABLED`                   | Enable billing-related tests              | `false`     |
| `E2E_TEST_IS_USER_REGISTERED`       | Whether a test user is already registered | `false`     |
| `E2E_TEST_REGISTERED_USER_EMAIL`    | Email of the registered test user         | -           |
| `E2E_TEST_REGISTERED_USER_PASSWORD` | Password of the registered test user      | -           |
| `E2E_TEST_STATUS_PAGE_URL`          | URL of a status page to test              | -           |
| `E2E_TESTS_FAILED_WEBHOOK_URL`      | Webhook URL to call on test failure       | -           |

### Example

```bash
export HOST=staging.oneuptime.com
export HTTP_PROTOCOL=https
export BILLING_ENABLED=true
```

Billing-enabled feature tests require Stripe **test-mode** keys on the server.
The shared project fixture adds Stripe's test Visa through the billing UI and
confirms paid usage is enabled before creating monitors or telemetry keys.
It refuses payment setup unless the dashboard's publishable key starts with
`pk_test_`. Billing tests can pass `enablePaidUsage: false` to
`registerAndCreateProject` to exercise the initial state without a card.

### ClickHouse access for exception fixtures

`Tests/Dashboard/ExceptionDetailPages.spec.ts` seeds an exception occurrence by
writing straight to ClickHouse over HTTP, using `CLICKHOUSE_USER`,
`CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` and `CLICKHOUSE_HOST` from
config.env. With `HOST=localhost` and `CLICKHOUSE_HOST=clickhouse` it connects to
`127.0.0.1:8189`, which `Scripts/Dev/docker-compose.dev.yml` publishes. `docker-compose.yml`
publishes no ClickHouse port, with or without the billing overlay, so start
those stacks with the test-only loopback overlay, as CI does (from the
repository root):

```bash
docker compose -f docker-compose.yml -f packages/E2E/docker-compose.e2e-clickhouse.yml up -d
```

Every `packages/E2E/docker-compose.*.yml` is an overlay: pass it after
`-f docker-compose.yml`, never on its own, because its paths resolve against
the repository root. `docker-compose.billing.yml` turns the stack into the SaaS
CI stack (adds `home`, leaves out `runner`), and `docker-compose.e2e.yml` runs
the released e2e image. Remove that container with `rm -sfv e2e`, not `down`,
which would tear down the whole stack.

Set `E2E_CLICKHOUSE_URL` (for example `http://127.0.0.1:8189`) to point the
fixture anywhere else.

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
│   ├── PublicDashboard/
│   └── AdminDashboard/
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

## Pencil button UI regression tests

Run the shared pencil icon and button checks without starting the app or database:

```bash
cd packages/E2E
npm run test-pencil-button-ui
```

The fixture renders the production components with the shared theme and bundled
Tailwind. Desktop and mobile checks cover the pencil's proportions, label
alignment, button sizes, and keyboard activation. Screenshots and failure traces
are written to `output/playwright/pencil-button/test-results/` at the repository root.
