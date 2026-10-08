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

`Tests/` is the default suite: `npm test` runs that whole tree on the SaaS and
Community stacks, across both browsers (the self-hosted Enterprise job runs the
Enterprise suites instead). Every other top-level directory is a
focused suite with its own `playwright.<name>.config.ts` and its own npm
script, run by name and never by `npm test`.

```
E2E/
├── Tests/              # The default suite (npm test) - SaaS and Community jobs
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

### Sharding the suite

The release workflows (`.github/workflows/test-release.yaml` on every push to
master, `release.yml` for a release) do not run the default suite on one
runner. They split it into shards - four for the SaaS stack, three for the
self-hosted one - and each shard boots its own stack and runs its part with
`workers: 1`, exactly as an unsharded run does. A job selects its shard with
`E2E_SHARD`:

```bash
E2E_SHARD=2/4 npx playwright test
```

A shard is a set of **whole spec files** per browser project
(`Sharding/Sharding.ts`). Playwright's own `--shard` splits by test count in
file order, which for this suite meant shards of 3, 28, 5 and 21 minutes; whole
files are instead packed longest-first using the per-file durations in
`Sharding/ShardWeights.json`. A spec file that has no weight yet still runs, in
exactly one shard, at the median weight - the weights only decide where a file
runs, never whether it does. `npm run test-sharding` checks that against
Playwright's own `--list`: the shards the workflows use must list disjoint sets
of tests that add up to exactly the unsharded suite. The Compile workflow runs
it on every pull request.

#### Refreshing the weights

`Sharding/ShardTimingReporter.ts` writes how long each spec file took in each
project to `test-results/shard-timings.json`, and every shard uploads it as an
`e2e-shard-timings-*` artifact. When the shards drift apart (one regularly
finishing minutes after the others), download those artifacts from a green run
of `test-release.yaml` and merge them over the current weights:

```bash
gh run download <run-id> --pattern 'e2e-shard-timings-*' --dir /tmp/e2e-timings
jq -S -s 'reduce .[] as $timings ({}; . * $timings)' \
  Sharding/ShardWeights.json /tmp/e2e-timings/*/shard-timings.json \
  > /tmp/ShardWeights.json && mv /tmp/ShardWeights.json Sharding/ShardWeights.json
npm run test-sharding
```

Where two timing files cover the same spec and project (a SaaS shard and a
self-hosted one, say), the one merged last wins.

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

## Color picker UI regression tests

Run the color field checks without starting the app or database:

```bash
cd packages/E2E
CI=1 npm run test-color-picker-ui
```

The fixture (`ColorPicker/Fixture`, port 4262) renders the production color field
inside the real Modal and BasicForm (the Create Label dialog), a custom field's
options, and a page, with the app's Tailwind, theme and font. Chromium and Firefox
at a desktop size, and Chromium at a small phone's width, check that Custom color
opens inside the dialog body above its buttons, that a row's popover stays inside
the dialog and the window, a real drag on the saturation square, typed codes, the
keyboard path, the dark theme, and the swatches wrapping on a phone. See
`ColorPicker/README.md`. Failure traces are written to
`output/playwright/color-picker-ui/test-results/` at the repository root.

## Workflow builder UI regression tests

Run the workflow builder canvas checks without starting the app or database:

```bash
cd packages/E2E
CI=1 npm run test-workflow-builder-ui
```

The fixture (`WorkflowBuilder/Fixture`, port 4237) renders the real builder:
react-flow, the Add Component picker, the step cards and the step settings
dialog, with the real component catalog. `?scenario=graph`, `trigger-only` and
`empty` pick the starting graph, and `&theme=dark` the dark theme. Desktop and
Pixel 7 checks cover adding a step: its settings stay closed, it is selected,
focused and in view (clear of the minimap and zoom buttons) at the zoom you
chose, it says "Click to set up", and a click or Enter opens it. They also
cover the Add Component and Add Trigger picker over the whole catalog
(`ComponentPicker.spec.ts`): it opens on a short list, a resource opens onto
its steps, "incident" ranks Incident's steps before Incident State's, one click
or Enter adds a step, typing a search never holds the page up, and it fits a
phone and the dark theme. Failure traces are written to
`output/playwright/workflow-builder-ui/test-results/` at the repository root.

## Push registration UI regression tests

Run Register Device (User Settings > Notification Methods > Push Notifications)
in Chromium without starting the app or database:

```bash
cd packages/E2E
CI=1 npm run test-push-registration-ui
```

The fixture (`PushRegistration/Fixture`, port 4281) serves the real Push
component, the Dashboard's real service worker and the service worker script
from `views/index.ejs`, and records what the page sends. It covers the first
registration installing the worker without reloading the page, the project sent
as a plain id, "This browser" in the device list, the test notification offered
afterwards, registering again, registering after a hard refresh, a dismissed or
blocked permission prompt, and a newer worker still reloading the page. See
`PushRegistration/README.md`. Screenshots and failure traces are written to
`output/playwright/push-registration-ui/` at the repository root.

## Single sign-on on every stack

Single sign-on — SAML and OIDC sign-in for projects, for the whole instance
and for status pages, and "Require SSO for login" — is core: every edition
serves it, and no licence decides whether it works. So it is asserted the same
way on every stack:

- `Tests/App/SingleSignOn.spec.ts`, in the default suite (the Community and
  SaaS stacks), probes every core SSO router through nginx on both identity
  prefixes (`/identity` and `/api/identity`) and on the status page's own
  prefix, and expects the one answer `Tests/Helpers/SsoRoutes.ts` pins for
  every stack — never a 404, never a 402/403. With billing off it also
  configures a SAML provider as a brand new project owner, checks that both
  sign-in listings offer it and that its start route redirects to the identity
  provider with the right ACS URL and Entity ID, and switches "Require SSO for
  login" on and sees it enforced (a 406 for a password session). With billing
  on that half skips: OneUptime Cloud sells SSO configuration on the Scale
  plan. It is API only, never a page navigation.
- `Enterprise/Licensed/IdentityRoutesThroughNginx.spec.ts` sends the same
  probes to the Enterprise image, and `Enterprise/Lapsed/SsoUnaffectedByLapse.spec.ts`
  sends them, and runs the same configuration steps, after its licence has
  lapsed.

The requests are chosen so that each one ends on one of its route's own early
answers — a missing email, `SAMLResponse` or OIDC login session, a provider id
that exists on no stack — so none of them needs a fixture.

## Enterprise Edition suites

Two focused suites cover what only a booted **self-hosted Enterprise** stack
can show: that the published enterprise image, wired by the real
`docker-compose.yml` with billing off, serves the SCIM routes through nginx,
ships a Dashboard that renders the enterprise screens, records audit entries
into ClickHouse, accepts enterprise configuration writes — and that all of it
stops, in the right way, when the licence lapses, while single sign-on keeps
answering exactly as before.

```bash
cd packages/E2E
npm run test-enterprise-licensed   # phase one: the licence is usable
npm run test-enterprise-lapsed     # phase two: after the licence has lapsed
```

They are focused suites rather than part of `Tests/` on purpose. The default
suite runs on the SaaS and Community stacks, in two browsers, and is already
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
SCIM and Audit Log settings screens — and its SSO and OIDC screens, which must
render as core screens with no licence notice.

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

| Assertion                                                      | Needs from the handoff      |
| -------------------------------------------------------------- | --------------------------- |
| a further audited write records nothing                        | the project (audit logs on) |
| the trail recorded while licensed is still readable            | the recorded entry          |
| configuration made while licensed is readable but unchangeable | the `ProjectSCIM` row       |
| password sign-in still works                                   | the owner account           |

With no handoff file, `Lapsed/EnterpriseWritesAndAuditRecorder.spec.ts`
registers its own owner and project (sign-up and project creation are core, so
they still work with a dead licence) and turns audit logging on itself. Only
the assertions that need a row created **while licensed** are then skipped, with
that as the reason. `Lapsed/DashboardLapseNotices.spec.ts` never uses the
handoff: the notices are decided by the installation's licence, not by anything
a project holds, so it registers a throwaway project and deletes it again.
`Lapsed/SsoUnaffectedByLapse.spec.ts` does not use it either: it signs its own
owner up over the API, because the SAML provider it enables and the project it
locks behind "Require SSO for login" must not change what the other lapsed
specs do with the handoff project.

That suite addresses the row **both ways**: by the id the create response
hands back, which is how it issues the `PUT` that must be refused with the
licence message, and by the unique name it gave the row, which is how it shows
the row is still listed where an administrator would look for it.

For a while it could only do the second. A per-class column-metadata cache in
`Common/Types/Database/TableColumn.ts` was built from whichever model instance
asked first, and `BaseAPI.createItem` deleted `_id` off the instance it handed
the service — so after one create, every serialized response for that model
came back without a key, including a `get-list` that selected `_id`. The
ordinary-update assertion was dropped rather than left permanently skipped. It
is back, together with an explicit assertion that the create response carries
an id: if that regresses, this suite fails instead of quietly testing less.

The absence of a recorded entry is bounded by `AUDIT_LOG_ENTRY_TIMEOUT_MS` from
`Enterprise/Helpers/AuditLogs.ts` — the same budget the licensed phase gives a
recorded entry to appear. Waiting exactly that long means the negative outlasts
the whole window the positive was allowed on this stack, and raising the
constant tightens both at once.

### The Community Edition negative control

`Tests/App/CommunityEditionEnterpriseSurface.spec.ts` is the other half of the
enterprise job: it asserts that the **Community** image serves none of what the
suites above prove an Enterprise one does — the SCIM routes answer 404 with
the App's catch-all body (not the lapsed stack's 403), the licence endpoint
reports `edition` `community` with `features` `null`, `POST /global-config/license`
does not exist at all, an enterprise configuration write is refused with the
_Community Edition_ message rather than the licence one, and audit logging
cannot even be switched on (`enableAuditLogs` is enterprise configuration, so
the `PUT` is refused with that same message) and records nothing. Single
sign-on is not part of that surface: the Community image serves it like every
other stack, which `Tests/App/SingleSignOn.spec.ts` proves on the same stack.

It lives in `Tests/` rather than beside the enterprise suites because the
community stack is booted by `test-e2e-test-self-hosted`, which runs the whole
`./Tests` tree across its shards. A focused suite runs there only when the job
is given a step for it, as the live label rule suite (`LabelRules/`) is. That
tree also runs on the SaaS stack, which boots the enterprise image, so the spec
detects the edition at runtime from `GET /api/global-config/license` and
**skips** (the pattern `Tests/Dashboard/BillingPaidUsage.spec.ts` uses) when it
is not `community`. It never reads `IS_ENTERPRISE_EDITION`, which is false
inside the e2e container on every stack. It reuses the same `Enterprise/Helpers/`
tables the enterprise suites read, asserting their `community` column, so the
two cannot drift; keep them in step in one commit.

### Shared helpers

`Enterprise/Helpers/` holds everything both suites share, so the licensed and
lapsed expectations for a route or a write live side by side and cannot drift:

| Helper                       | What it gives you                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `LicenseState.ts`            | reads `/api/global-config/license`; `waitForEnterpriseLicenseState` polls it           |
| `StackGuard.ts`              | `assertLicensedEnterpriseStack()` / `assertLapsedEnterpriseStack()`                    |
| `IdentityRoutes.ts`          | every unauthenticated SCIM probe, with its licensed, lapsed and community expectation  |
| `EnterpriseConfiguration.ts` | enterprise configuration writes, and the two 402 messages that tell the stacks apart   |
| `AuditLogs.ts`               | the project switch, the audited write, and a bounded wait for the entry                |
| `FrontendEnvironment.ts`     | what the stack tells its own bundles: the effective edition, and whether billing is on |
| `Handoff.ts`                 | the licensed suite's leftovers, for the lapsed suite                                   |

Single sign-on is core, so its helpers live in `Tests/Helpers/` and both the
default suite and the enterprise suites use them:

| Helper                | What it gives you                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `SsoRoutes.ts`        | the identity prefixes, and every unauthenticated SSO probe with the one answer every stack gives |
| `SsoConfiguration.ts` | a SAML provider configured, offered, started and required end to end, with its assertions        |
| `ApiSignup.ts`        | a brand new project owner, signed up over the API alone                                          |
