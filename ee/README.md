# OneUptime Enterprise Edition (`ee/`)

This directory holds the OneUptime Enterprise Edition: the code that the
Enterprise image adds on top of the Community Edition. Everything else in the
repository is the Community Edition.

## License

Everything in `ee/` is licensed under the
[OneUptime Enterprise License](./LICENSE), **not** under the Apache License 2.0
that covers the rest of the repository:

- You may copy and modify this code for development and testing without a
  subscription.
- Running it in production requires agreeing to the
  [OneUptime Terms of Service](https://oneuptime.com/legal/terms) (or another
  agreement with OneUptime) and a valid OneUptime Enterprise license for the
  correct number of user seats.
- You may modify it and publish patches, but modifications and patches to
  `ee/` belong to OneUptime and may only be used with a valid Enterprise
  license.
- Otherwise, you may not copy, merge, publish, distribute, sublicense or sell
  the code in `ee/`.
- Third-party components keep their own licenses.

Content outside `ee/` stays Apache-2.0. The preamble of the root
[`LICENSE`](../LICENSE) file sets out this split: `ee/` is under `ee/LICENSE`,
third-party components keep their own licenses, and everything else is under
the Apache License 2.0, whose unmodified text follows the preamble. The root
[`NOTICE`](../NOTICE) file repeats the split. Contributions to `ee/` are
covered in [CONTRIBUTING](../.github/CONTRIBUTING.md#licensing-of-contributions).

## What lives here

| Path | What it is |
| --- | --- |
| `Server/Index.ts` | The enterprise server module (the default export), assembled from one module per area, in order: License, Identity, TeamCompliance, AuditLog, LicenseServer, AdminHealth, Workers. It implements `EnterpriseServerModule` from `packages/Common/Server/Enterprise/EnterpriseServerModule.ts`. |
| `Server/Identity/` | SAML SSO, OIDC and SCIM for projects, status pages and the whole instance (global SSO). Route paths are byte-identical to the Community Edition paths they replaced, because customer identity providers have them configured. Every route starts with a license gate (`Middleware/LicensedFeatureGate.ts`), so it refuses while its feature is not active. |
| `Server/TeamCompliance/` | Team compliance settings and the compliance status route. |
| `Server/AuditLog/` | The audit-log recorder behind `EnterpriseEdition.getAuditLogRecorder()`. |
| `Server/License/` | The license client: signed-license format (`LicenseToken.ts`), trusted signing keys (`TrustedLicenseKeys.ts`), the license snapshot, activation, refresh, seats and the daily license sync, including the seat arithmetic (`EnterpriseLicenseSeats.ts`) and the license-response mapper (`EnterpriseLicenseSync.ts`). Only the `SeatUsage` type stays in core. |
| `Server/LicenseServer/` | The license server that oneuptime.com runs. Mounted only when billing is enabled. |
| `Server/AdminHealth/` | The live OneUptime Health dashboards (overview, queues, Valkey, logs, ClickHouse cluster, telemetry ingestion, Postgres cluster and activity) and the query console, served by one router mounted ahead of core's. Core keeps the every-edition routes, the probes they share (`App/API/AdminHealthProbes.ts`) and a 402 fallback for each enterprise path. |
| `Server/Workers/` | Enterprise cron jobs (PostgreSQL and Valkey/Redis health evaluation) and the probes they read: `InstanceHealth/PostgresHealth.ts` and the counter deltas in `InstanceHealth/RedisHealth.ts`. The Redis INFO read stays in core, because the admin health API uses it too. |
| `Dashboard/`, `AdminDashboard/` | The Enterprise UI plugins for the two frontends, each assembled from per-area `Plugins.ts(x)` files. Two areas are shared across the frontends by relative import: the license manager (`AdminDashboard/License/`, also used by the Dashboard) and the read-only incident actions (`Dashboard/SSO/TightenOnly/`, also used by the Admin Dashboard). |
| `Scripts/` | Operator scripts, such as `GenerateLicenseSigningKey.ts`. |
| `Tests/Server`, `Tests/UI` | The two jest projects in `jest.config.js`. |

Models, migrations, CRUD services, the audit-log table, the license columns
and every enforcement site stay in core (Apache-2.0). `ee/` holds behaviour,
not schema, so switching editions never needs a migration.

## How core finds `ee/`

Core never imports `ee/`. `ee/` imports core only through the package
specifiers `Common/...` and `App/...` (server) and `@oneuptime/dashboard/...` /
`@oneuptime/admin-dashboard/...` (UI), never through `../packages/...` paths.
An eslint rule and `packages/App/Tests/EnterpriseImportGuard.test.ts` enforce
the boundary in both directions.

### Server: the loader

`packages/App/Utils/EnterpriseLoader.ts` runs at boot in every App role (app,
worker, telemetry writer), before any router is mounted:

1. It looks for `Server/Index.ts` (or `Server/Index.js`) in
   `<App root>/../../ee` (the repository layout) and then `<App root>/../ee`
   (the image layout, `/usr/src/ee`). `ONEUPTIME_EE_DIR` replaces both with one
   directory.
2. It `require()`s the file, unwraps the default export, checks it against the
   `EnterpriseServerModule` contract and registers it with
   `EnterpriseEdition` (`packages/Common/Server/Enterprise/EnterpriseEdition.ts`).
   From then on core asks `EnterpriseEdition` for anything edition-dependent.
3. It runs `init()` and waits for the first license snapshot, both bounded by
   a timeout.

`ONEUPTIME_EDITION` chooses what happens:

| Value | Behaviour |
| --- | --- |
| `auto` (default) | Load `ee/` when it is on disk, otherwise run the Community Edition. |
| `community` | Never load `ee/`, even when it is present. |
| `enterprise` | `ee/` must load. A missing or broken `ee/` stops the boot. The Enterprise image sets this, so a broken image can never run silently as the Community Edition. |

Failure policy: a broken build fails fast (the process exits). That covers an
`ee/` whose `require()` fails (usually because `npm ci --ignore-scripts` was
not run in `ee/`), a module that does not match the contract, an unknown
`ONEUPTIME_EDITION`, `ONEUPTIME_EDITION=enterprise` with no `ee/`, and billing
without `ee/` (see below). Runtime problems are only logged and the boot
continues: `init()` throwing or hanging, or the first license load failing.
The enterprise module must never take core monitoring down.

The boot also stops when `IS_ENTERPRISE_EDITION=true` asks for the Enterprise
Edition but `ee/` did not load, for example an old Enterprise `config.env` on
the Community image (`APP_TAG=release`). Running on would silently stop
enforcing "Require SSO", SSO, SCIM and audit logging. The error says what to
set: `APP_TAG=enterprise-<version>` to keep the Enterprise Edition, or
`IS_ENTERPRISE_EDITION=false` for the Community Edition. An explicit
`ONEUPTIME_EDITION=community` only logs a warning. Both the guard and the
admin UI's "requested but not loaded" notice use `isEnterpriseEditionRequested`
in `packages/Common/Server/EnvironmentConfig.ts`. While
`IS_ENTERPRISE_EDITION=true`, `npm run update` (`Scripts/Install/MergeEnvTemplate.js`)
switches `APP_TAG` to its `enterprise-` tag and says so.

`packages/App/Migrate.ts` does not run the loader. Migrations run with
Community Edition defaults and record no audit-log rows.

Enterprise routers contain routes only, with no router-level `use()` layers:
an ee router mounted at `/`, or ahead of a core router, would otherwise shadow
core routes. `Tests/Server/ModuleShape.test.ts` enforces this.

### Frontends: the plugins

The Dashboard and the Admin Dashboard each import their Enterprise UI through
one bare specifier, from one file (`src/Enterprise/Plugins.ts`):

| Frontend | Specifier | Resolves to |
| --- | --- | --- |
| Dashboard | `@oneuptime/ee-dashboard` | `ee/Dashboard/Index.tsx` |
| Admin Dashboard | `@oneuptime/ee-admin-dashboard` | `ee/AdminDashboard/Index.tsx` |

`packages/Common/UI/esbuild-enterprise.js` decides what the specifier means
for each build, using the same `ONEUPTIME_EDITION` and `ONEUPTIME_EE_DIR`
settings as the server:

- **Enterprise:** when `ee/<Frontend>/Index.tsx` exists (in the repository or
  in the image) and `ONEUPTIME_EDITION` is not `community`.
- **Community:** the frontend's own empty stub, `src/Enterprise/CommunityPlugins.ts`.
  Type-checking and jest always use this stub.
- **Build error:** `ONEUPTIME_EDITION=enterprise` and the plugin file is missing.

Each plugin exports a sentinel string (`ONEUPTIME_EE_DASHBOARD_PLUGIN_v1`,
`ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1`). The Enterprise image build fails when
it is missing from the bundle, and the Community build fails when it is present.
Core reads plugins only inside render or function bodies, through
`getDashboardPlugins()` / `getAdminDashboardPlugins()`. Reading them at module
load creates an import cycle that crashes the Enterprise bundle.

## Which check to use: loaded, active or available

`EnterpriseEdition` answers three different questions. Use the right one:

- `EnterpriseEdition.isLoaded()`: is the enterprise code present in this
  process? It says nothing about the license. It decides which enterprise
  routers and jobs exist and which edition operators are told they run.
- `EnterpriseEdition.isFeatureActive(feature)`: does the feature's runtime
  behaviour run right now? This governs SSO sign-in (SAML and OIDC, for
  projects, status pages and the whole instance, including the mobile flows),
  "Require SSO for login" enforcement and the SSO provider listings (`SSO`),
  SCIM provisioning and the SCIM Push Groups team locks (`SCIM`), and
  audit-log recording (`AuditLogs`). Core reads the first two through
  `packages/Common/Server/Utils/EditionEnforcement.ts`.
- `EnterpriseEdition.isFeatureAvailable(feature)` and
  `isFeatureAvailableSync(feature)`: may enterprise configuration be created
  or changed now? This governs enterprise configuration writes (including the
  tighten-only updates allowed without a license), the enterprise admin Health
  dashboards and the query console. It fails closed.

With billing on (OneUptime Cloud) both license questions answer yes whenever
`ee/` is loaded, and plan tiers gate the features. Self-hosted, a feature is
active and available while the license covers it: valid, in the 30-day grace
period after it expired, or, with no license at all, inside the 14-day trial.
The two lengths are `ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS` and
`ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS`
(`packages/Common/Types/EnterpriseLicense/EnterpriseLicensePeriods.ts`), which
the license classifier takes as `graceDays` and `trialDays`.

### When the license lapses

A self-hosted license has lapsed for a feature when the trial is over and no
license is installed, when the license expired more than 30 days ago, when it
is invalid, or when its feature list leaves the feature out. That is exactly
what `isFeatureAvailableSync` treats as unavailable. Then:

- **SSO stops**, the same as on the Community Edition. Every SSO route
  refuses per request: browser flows show the Identity message page, logins
  the mobile app started end on its failure deep link, and the JSON discovery
  routes answer 402. Provider listings are empty, and "Require SSO for login"
  (project, instance-wide and status page) is no longer enforced, because
  enforcing it with SSO switched off would lock every user out. Users sign in
  with their password; users who only ever signed in with SSO use password
  reset. Reads made for a caller report a project's or status page's
  requirement as off, and a caller's write can neither switch the stored
  requirement off nor set one (`EditionEnforcement.guardSsoRequirementWrite`:
  a write of the masked value is dropped, anything else is refused with a
  402), so a settings form saved while SSO is stopped never loses the
  requirement.
- **SCIM stops.** Every SCIM endpoint (project and status page) answers 403
  with a SCIM error body naming the lapsed license, and the SCIM Push Groups
  team locks relax so teams can be managed in OneUptime.
- **Audit logging stops recording.**
- Enterprise configuration becomes read-only (`isFeatureAvailable`). The
  Health dashboards and team compliance keep their own rules.

Nothing is deleted or changed. When a license is activated, everything resumes
without a restart. `isFeatureActive` logs a warning once when features stop
and an info line when they resume, and the relaxed SSO requirements and SCIM
locks are listed by `packages/Common/Server/Utils/CommunityEditionSsoReport.ts`.

An **unknown** license state never locks anyone out or relaxes SSO: before the
first license snapshot has loaded, when reading the cached snapshot throws, or
when no license is installed and the start of the trial has not been recorded
yet (the first-run stamp could not be written, or the GlobalConfig row does
not exist yet, so nobody can tell whether the trial is over),
`isFeatureActive` answers "active" (keep enforcing, serving and recording) and
warns once per process. The loader waits, bounded, for the first snapshot
before any router is mounted, so this window is small. `isFeatureAvailable`
fails closed instead.

The identity routers are mounted once at boot, but the license changes at
runtime, and an ee router may not have `router.use()` layers. So every
identity route starts with a gate from `Server/Identity/Middleware/LicensedFeatureGate.ts`
that asks per request. `Tests/Server/Identity/IdentityLicenseGates.test.ts`
checks every route has the gate for its feature. Because the license is asked
on every such request, the license provider reuses a computed snapshot for at
most a second (`LICENSE_SNAPSHOT_REUSE_IN_MS`), and never past an expiry, grace
or trial boundary, so it does not verify a signed license on every request.

The model-to-feature map lives in `EnterpriseEdition.getModelFeature()`.

## Working on `ee/`

`ee/` has its own `package.json`, on the same jest major as `packages/Common`
(28 today; `Tests/Server/ModuleShape.test.ts` checks they match). It links
`packages/Common` and `packages/App` with `file:` dependencies, so install those
two packages first:

```bash
cd ee
npm ci --ignore-scripts   # always --ignore-scripts: it would otherwise run the linked packages' lifecycle scripts
npm test                  # both jest projects, with ../config.env exported like App's tests
npm run compile           # tsc for the server, then the Dashboard and Admin Dashboard UI
```

- `npm run compile` also type-checks the two UI tsconfigs
  (`Dashboard/tsconfig.json`, `AdminDashboard/tsconfig.json`), which take their
  types from `packages/App/FeatureSet/Dashboard/node_modules` and
  `packages/App/FeatureSet/AdminDashboard/node_modules`. Install those frontends
  too before compiling.
- Run one project or one file with
  `node node_modules/.bin/jest --selectProjects server Tests/Server/ModuleShape.test.ts`
  (or `--selectProjects ui`). Never use the repository root's jest 30.
- Core CI jobs run with `ee/` deleted, so core tests must never depend on it.
  Tests for code in `ee/` live in `ee/Tests`.
- Tests that touch edition-dependent code must pin both the billing flag and the
  edition state. CI's `config.env` sets `BILLING_ENABLED=true`, and without the
  pin every test exercises the OneUptime Cloud path. The helpers are in
  `packages/Common/Tests/Server/Enterprise/` (`FakeEnterpriseModule.ts`,
  `TestBillingFlag.ts`).

### Running the Enterprise Edition from a checkout

A checkout that contains `ee/` runs as the Enterprise Edition once
`npm ci --ignore-scripts` has been run in `ee/` (`ONEUPTIME_EDITION=auto`).
Set `ONEUPTIME_EDITION=community` to run the Community Edition from the same
checkout. `ONEUPTIME_EE_DIR=/path/to/ee` points the server loader and the
frontend builds at another directory.

An unlicensed Enterprise install gets a 14-day trial, counted from the first
time it ran the Enterprise Edition (`GlobalConfig.enterpriseEditionFirstSeenAt`).
After that, enterprise configuration becomes read-only and SSO, SCIM and audit
logging stop until a license is activated (see
[When the license lapses](#when-the-license-lapses)). The trial is for
evaluation. Production use needs a subscription.

### End-to-end CI for the Enterprise stack

`ee/`'s own jest suites run in-process: they mount Express directly, fake the
license and never build an image. Three CI jobs boot a whole stack from
`docker-compose.yml` with published images instead, and only one of them is the
self-hosted Enterprise Edition:

| job (`test-release.yaml` on master, `release.yml` on a release) | App tag | billing | what it is |
| --- | --- | --- | --- |
| `test-e2e-{test,release}-saas` | `enterprise-<version>` | on | OneUptime Cloud. `EnterpriseEdition` answers "cloud" to every check, so the license decides nothing. |
| `test-e2e-{test,release}-self-hosted` | `<version>` | off | Community Edition. No `ee/` in the image at all, so every enterprise route 404s. |
| `test-e2e-{test,release}-enterprise` | `enterprise-<version>` | off | Self-hosted Enterprise. The **license** decides whether SSO, SCIM and audit logging run. |

The enterprise job runs the suite twice against one booted stack:

- **Phase A, licensed** (`npm run test-enterprise-licensed`). A fresh Enterprise
  install is inside its unlicensed trial, so everything is on. This is what only
  a booted stack can prove: the identity routes answer **through nginx** (jest
  mounts Express directly and never exercises `location /identity` or its
  rewrite), the **shipped UI bundles** really carry the ee plugins so the
  dashboard renders the SSO/OIDC/SCIM and audit-log screens instead of the
  upsell, and the audit recorder in the real image writes a real row to
  ClickHouse.
- **Phase B, lapsed** (`npm run test-enterprise-lapsed`). Same stack, same data,
  lapsed license: the gates refuse with 402/403 rather than 404 — the routes are
  still mounted, which is what tells "no `ee/`" apart from "`ee/` with a dead
  license" — enterprise configuration becomes read-only, and password sign-in
  still works.

Between the phases the job makes the license lapse. There is deliberately **no
test hook, env var or API** for faking a license state: a switch that could say
"pretend this install is licensed" is a switch an unlicensed install could flip.
So the job reaches the lapsed state the way a real install does, by letting the
trial run out — it backdates `GlobalConfig.enterpriseEditionFirstSeenAt` with
`psql` inside the compose `postgres` service. That is stable because
[`Server/License/LicenseStore.ts`](Server/License/LicenseStore.ts) stamps the
column **only when it is missing**, so a backdated value is never overwritten.
The app notices without a restart, but not instantly: the license inputs are
cached (`LICENSE_INPUTS_CACHE_TTL_IN_MS`) and the synchronous
`getCachedSnapshot()` the gates use serves the old inputs while it reloads in the
background. So the job then polls `GET /api/global-config/license` until it
reports `status: "missing"` and `licenseValid: false` before starting phase B.

`Tests/Ops/ReleaseImageEditionChecks.test.js` pins that shape — both phases, in
order, with the expiry step between them and the poll after it — and
`Tests/Ops/EnterpriseEditionBuild.test.js` pins that these jobs stay on an
enterprise tag with billing off. A phase that quietly stopped running would
otherwise leave the job green.

## The license-signing key ceremony

Licenses are compact JWS tokens signed with Ed25519 (`Server/License/LicenseToken.ts`).
An install trusts only the public keys compiled into its own build
(`Server/License/TrustedLicenseKeys.ts`). The list is **empty** until the first
ceremony. Until then every license classifies as "unverified" and is accepted
only because legacy acceptance is on (next section), so the signed format does
not protect anything yet.

Do the steps in this order:

1. **Generate the key pair** on a trusted machine, writing the private key
   outside the repository:

   ```bash
   cd ee
   node ../packages/App/node_modules/.bin/ts-node --transpile-only \
     Scripts/GenerateLicenseSigningKey.ts --out /secure/place/license-signing-key.pem
   ```

   The script refuses any output path inside the repository, because the whole
   of `ee/` is copied into the public Enterprise image. It creates the file with
   mode `0600` and never overwrites an existing file. It prints only the key id
   (the RFC 7638 thumbprint), the public key and the `TrustedLicenseKeys.ts`
   entry to paste.
2. **Add the public key** to `TrustedLicenseKeys.ts`, merge it and publish a
   release. `Tests/Server/License/LicenseToken.test.ts` checks that every entry
   parses, is Ed25519 and has `kid` equal to its thumbprint.
3. **Deploy that release to oneuptime.com.**
4. **Set `ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY`** on oneuptime.com: on the
   app deployment only, from a secret. The value can be a PEM, a PEM with
   literal `\n` escapes, or base64. The license server reads it at boot and
   removes it from the environment. It signs with EdDSA only when the derived
   key id is in its own build's `TrustedLicenseKeys`. Otherwise it logs a
   warning and keeps issuing legacy HS256 tokens.

The order matters. Installs verify licenses offline against the keys in their
own build, so a key must ship in a release before anything is signed with it.
Installs refuse to replace a stored license with one that classifies worse
("never downgrade"), and the license server refuses to sign with a key its own
build does not trust. Together these keep a mistake in the ceremony from
switching off enterprise features on customer installs.

To rotate a key, add the new key next to the old one, and remove a key only
once no supported release trusts that key alone.

## Sunsetting unverified legacy licenses

`ACCEPT_UNVERIFIED_LEGACY_LICENSES` (in `Server/License/LicenseSettings.ts`,
also called "AcceptUnverifiedLegacyLicenses") is `true`. While it is on, legacy
HS256 licenses and tokens signed by a key this build does not trust are
accepted as "unverified", with their expiry and seat limit taken from the
stored license columns and the same 30-day grace period. It has to stay on
until the ceremony above has shipped: until then there is nothing else to
accept.

Turn it off only in a separate, announced release, after:

1. a release that trusts the production signing key has shipped, and
   oneuptime.com signs with it;
2. enough time has passed for online installs to pick up signed tokens through
   the daily license sync or a refresh, and every supported release trusts the
   key;
3. the date is published in the upgrade notes, with guidance for offline
   installs, which need a new signed token.

Once it is off, an unverified license classifies as invalid, with no grace
period. On any install still holding one, enterprise configuration becomes
read-only and SSO, SCIM and audit logging stop (see
[When the license lapses](#when-the-license-lapses)) until a signed license is
activated. The upgrade notes must say so.

## oneuptime.com must run the Enterprise image

OneUptime Cloud (`BILLING_ENABLED=true`) must run the Enterprise image.

- The Community image has no SSO, SCIM or audit logging, and no license server,
  so every self-hosted activation would fail.
- The boot therefore refuses billing without `ee/`.
  `ALLOW_BILLING_WITHOUT_ENTERPRISE=true` overrides this, but only for local
  development.
- The SaaS end-to-end jobs run the `enterprise-<version>` tag for the same
  reason.
- With billing on, the license server routes (`/api/enterprise-license/...`)
  are mounted, and plan checks (not the license) gate enterprise features.

## Contributing

Contributions to `ee/` are licensed under `ee/LICENSE` and require agreeing
that OneUptime may use them commercially. See
[CONTRIBUTING](../.github/CONTRIBUTING.md#licensing-of-contributions).
