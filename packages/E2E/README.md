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

`Tests/` is the default suite: `npm test` runs that whole tree, in every
full-stack CI job, across both browsers. Every other top-level directory is a
focused suite with its own `playwright.<name>.config.ts` and its own npm
script, run by name and never by `npm test`.

```
E2E/
├── Tests/              # The default suite (npm test) - runs in every job
│   ├── Accounts/       # Account-related tests (login, registration)
│   ├── App/            # Main application tests
│   ├── Dashboard/      # Dashboard tests, and the shared Helpers/ they use
│   ├── Home/           # Homepage tests
│   ├── IncomingRequestIngest/
│   ├── ProbeIngest/
│   ├── StatusPage/     # Status page tests
│   ├── PublicDashboard/
│   └── AdminDashboard/
├── Enterprise/         # Enterprise Edition suites (see below)
│   ├── Helpers/        # Shared by both phases
│   ├── Licensed/       # Phase one: a usable Enterprise licence
│   └── Lapsed/         # Phase two: the same stack, licence lapsed
├── Alerts/, Discovery/, LabelRules/, SloBurnRate/, Topology/, ...
│                       # Focused suites, each with its own config + script
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
- **Retries**: 2 retries on failure (see the comment in `playwright.config.ts`
  for why it is not 3: at `workers: 1` each retry costs a full test timeout)
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

## Enterprise Edition suites

Two focused suites cover what only a booted **self-hosted Enterprise** stack
can show: that the published enterprise image, wired by the real
`docker-compose.yml` with billing off, serves the enterprise identity routes
through nginx, ships a Dashboard that renders the enterprise screens, records
audit entries into ClickHouse, accepts enterprise configuration writes — and
that all of it stops, in the right way, when the licence lapses.

```bash
cd packages/E2E
npm run test-enterprise-licensed   # phase one: the licence is usable
npm run test-enterprise-lapsed     # phase two: after the licence has lapsed
```

They are focused suites rather than part of `Tests/` on purpose. The default
suite runs in all three full-stack jobs and in two browsers, and is already
near the 90-minute ceiling its own config says must be read as a hang rather
than raised; these specs apply to one stack only, so they run by name.

### What they need

| Requirement       | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Image             | an **enterprise** tag (`APP_TAG=enterprise-<version>-test`), not `release` |
| `BILLING_ENABLED` | `false`, both on the stack and in the shell that runs the suite            |
| `HOST`            | the booted stack's host, including its port (e.g. `localhost`)             |
| `HTTP_PROTOCOL`   | `http` or `https`                                                          |
| Licence           | none installed: a fresh install is inside its 14-day trial                 |

No other environment variable is involved. In particular the suites do **not**
read `IS_ENTERPRISE_EDITION`: `docker-compose.base.yml` passes that variable
through and no job sets it, so inside the e2e container it is false even
against an enterprise image. The edition is detected at runtime from
`GET /api/global-config/license` instead.

Every spec asserts its stack in a `beforeAll` hook and **fails** — never skips —
when it is pointed at the wrong one, naming the stack it found and the stack it
wanted. A suite that quietly skipped would turn the point of the job into a
green tick.

### Running them locally

Against a stack you have already started (from the repository root, with an
enterprise `APP_TAG` and `BILLING_ENABLED=false` in `config.env`):

```bash
cd packages/E2E
HOST=localhost HTTP_PROTOCOL=http BILLING_ENABLED=false npm run test-enterprise-licensed
```

The licensed suite takes a few minutes; all but one of its specs assert over
HTTP, and the one browser spec signs a fresh user up and opens the Dashboard's
SSO, OIDC, SCIM and Audit Log settings screens.

### Forcing the licence to lapse

The lapsed suite needs a stack whose Enterprise licence is no longer usable.
There is no test-only environment variable or API for this: the trial is
counted from `GlobalConfig.enterpriseEditionFirstSeenAt`, which is stamped once
and never rewritten, so backdating that column is the deterministic way to end
it. Run this against the booted stack, from the repository root:

```bash
set -a; . ./config.env; set +a

docker compose exec -T -e PGPASSWORD="$DATABASE_PASSWORD" postgres \
  psql -U "$DATABASE_USERNAME" -d "$DATABASE_NAME" -c \
  "UPDATE \"GlobalConfig\" SET \"enterpriseEditionFirstSeenAt\" = NOW() - INTERVAL '30 days' WHERE \"_id\" = '00000000-0000-0000-0000-000000000000';"
```

`GlobalConfig` is a singleton row whose id is all zeroes. 30 days is
comfortably past the 14-day trial, and the column is only ever stamped when it
is empty, so a backdated value sticks. `DATABASE_USERNAME`, `DATABASE_NAME` and
`DATABASE_PASSWORD` come from `config.env` (`postgres` and `oneuptimedb` by
default).

The app notices **without a restart**, but not instantly: the licence inputs
are cached for 60 seconds and the snapshot the gates read is served
synchronously while a reload runs behind it. So do not assert immediately after
the `UPDATE` — poll `GET /api/global-config/license` until `licenseValid` turns
false. The suite's stack guard does exactly that (up to four minutes), which is
why the lapsed suite can be started as soon as the `UPDATE` returns:

```bash
cd packages/E2E
HOST=localhost HTTP_PROTOCOL=http BILLING_ENABLED=false npm run test-enterprise-lapsed
```

### State the licensed suite leaves behind

The two suites run against the **same** stack, in order, and the second one
depends on what the first left there. `Enterprise/Licensed/
AuditRecorderAndEnterpriseWrites.spec.ts` deliberately does **not** delete its
project: it leaves

- the project with **audit logging enabled** and one recorded entry,
- a `ProjectSCIM` row created while the licence was usable,
- the owner account, whose password is the shared `E2E_SIGNUP_PASSWORD` from
  `Config.ts`,

so the lapsed suite can show that a further audited write records nothing while
the existing trail stays readable, that changing that SCIM row is refused, and
that a lapsed licence does not break password sign-in. Recreating that state
after the lapse would prove less, because the point is that it was created
while the licence was alive.

The ids are written to `packages/E2E/test-results/enterprise/licensed-handoff.json`
(git-ignored) by the licensed suite and read back with
`readLicensedSuiteHandoff()` from `Enterprise/Helpers/Handoff.ts`. Its absence
is not a failure: a lapsed spec run on its own creates whatever it needs.

### What the lapsed suite assumes

Two different things, and they fail differently on purpose.

**About the stack, which must be exactly right.** Every spec calls
`assertLapsedEnterpriseStack()` in its `beforeAll`, which **fails** (never
skips) unless billing is off, the edition is `enterprise` and the licence has
turned unusable — polling up to four minutes for the last one, because the
running app serves its previous licence inputs for up to a minute after the
`UPDATE`. `Lapsed/LapsedStackGuard.spec.ts` then pins the exact payload the
documented lapse produces: `status` `missing`, `licenseValid` false, `features`
an **empty list** rather than the Community Edition's `null`, and a `graceEndsAt`
that is already in the past.

**About the fixtures, which it can do without.** The specs prefer what the
licensed phase left on this same stack, because state created under a live
licence surviving the lapse is part of what they assert:

| Assertion                                           | Needs from the handoff      |
| --------------------------------------------------- | --------------------------- |
| a further audited write records nothing             | the project (audit logs on) |
| the trail recorded while licensed is still readable | the recorded entry          |
| configuration made while licensed is still readable | the `ProjectSCIM` row       |
| password sign-in still works                        | the owner account           |

With no handoff file, `Lapsed/EnterpriseWritesAndAuditRecorder.spec.ts`
registers its own owner and project (sign-up and project creation are core, so
they still work with a dead licence) and turns audit logging on itself. Only
the assertions that need a row created **while licensed** are then skipped, with
that as the reason. `Lapsed/DashboardLapseNotices.spec.ts` never uses the
handoff: the notices are decided by the installation's licence, not by anything
a project holds, so it registers a throwaway project and deletes it again.

One assertion is deliberately absent: that an **ordinary update** of an
enterprise configuration row is refused while a tighten-only one (disabling a
provider, rotating a leaked token) is not. Neither the `ProjectSCIM` create
response nor a `get-list` that selects `_id` hands a project-owner session the
row's key, so a spec cannot address the row for a `PUT`. That half of the rule
is pinned by `EditionPermission`'s unit tests and the tighten-only UI tests
under `ee/Tests`, and these suites find their row by the unique name they gave
it instead.

The absence of a recorded entry is bounded by `AUDIT_LOG_ENTRY_TIMEOUT_MS` from
`Enterprise/Helpers/AuditLogs.ts` — the same budget the licensed phase gives a
recorded entry to appear. Waiting exactly that long means the negative outlasts
the whole window the positive was allowed on this stack, and raising the
constant tightens both at once.

### The Community Edition negative control

`Tests/App/CommunityEditionEnterpriseSurface.spec.ts` is the other half of the
enterprise job: it asserts that the **Community** image serves none of what the
suites above prove an Enterprise one does — the identity routes answer 404 with
the App's catch-all body (not the lapsed stack's 402/403), the licence endpoint
reports `edition` `community` with `features` `null`, `POST /global-config/license`
does not exist at all, an enterprise configuration write is refused with the
_Community Edition_ message rather than the licence one, and audit logging
cannot even be switched on (`enableAuditLogs` is enterprise configuration, so
the `PUT` is refused with that same message) and records nothing.

It lives in `Tests/` rather than beside the enterprise suites because the
community stack is booted by `test-e2e-test-self-hosted`, which runs the whole
`./Tests` tree and nothing else — a focused suite would never run there. That
tree also runs on both enterprise stacks, so the spec detects the edition at
runtime from `GET /api/global-config/license` and **skips** (the pattern
`Tests/Dashboard/BillingPaidUsage.spec.ts` uses) when it is not `community`. It
never reads `IS_ENTERPRISE_EDITION`, which is false inside the e2e container on
every stack. It reuses the same `Enterprise/Helpers/` tables the enterprise
suites read, asserting their `community` column, so the two cannot drift; keep
them in step in one commit.

### Shared helpers

`Enterprise/Helpers/` holds everything both suites share, so the licensed and
lapsed expectations for a route or a write live side by side and cannot drift:

| Helper                       | What it gives you                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `LicenseState.ts`            | reads `/api/global-config/license`; `waitForEnterpriseLicenseState` polls it              |
| `StackGuard.ts`              | `assertLicensedEnterpriseStack()` / `assertLapsedEnterpriseStack()`                       |
| `IdentityRoutes.ts`          | every unauthenticated identity probe, with its licensed, lapsed and community expectation |
| `EnterpriseConfiguration.ts` | enterprise configuration writes, and the two 402 messages that tell the stacks apart      |
| `AuditLogs.ts`               | the project switch, the audited write, and a bounded wait for the entry                   |
| `FrontendEnvironment.ts`     | what the stack tells its own bundles: the effective edition, and whether billing is on    |
| `Handoff.ts`                 | the licensed suite's leftovers, for the lapsed suite                                      |
