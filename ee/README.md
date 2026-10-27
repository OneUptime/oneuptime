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
| `Server/Index.ts` | The enterprise server module (the default export), assembled from one module per area, in order: License, Identity, TeamCompliance, AuditLog, LicenseServer, AdminHealth, Workers, WhiteLabel, Marketplace, AuditLogExport, Billing, CloudMarketplace. It implements `EnterpriseServerModule` from `packages/Common/Server/Enterprise/EnterpriseServerModule.ts`. |
| `Server/Identity/` | SCIM provisioning for projects and status pages. Route paths are byte-identical to the Community Edition paths they replaced, because customer identity providers have them configured. Every route starts with a license gate (`Middleware/LicensedFeatureGate.ts`, SCIM only), so it refuses while SCIM is not active. Single sign-on (SAML, OIDC, global SSO and "Require SSO for login") is not here: it is core, Apache-2.0, in `packages/App/FeatureSet/Identity`, and served in every edition. |
| `Server/TeamCompliance/` | Team compliance settings and the compliance status route. |
| `Server/AuditLog/` | The audit-log recorder behind `EnterpriseEdition.getAuditLogRecorder()`. |
| `Server/AuditLogExport/` | Audit log export: the exporter (`AuditLogExporter.ts`), run every minute by `Jobs/ExportAuditLogs.ts`, which sends every enabled export (a project's, or the whole instance's) the entries recorded since its cursor; the six destinations in `Destinations/` (Amazon S3 and S3-compatible storage, Google Cloud Storage, Azure Blob Storage, a webhook, syslog); the NDJSON files the file destinations write (`AuditLogExportFiles.ts`); and the routes that test a destination before it is saved (`API/`). The `AuditLogExport` model, its migration, `AuditLogExportService` and the destination catalog (`packages/Common/Types/AuditLog/Export/`) stay in core. |
| `Server/License/` | The license client: signed-license format (`LicenseToken.ts`), trusted signing keys (`TrustedLicenseKeys.ts`), the license snapshot, activation, refresh, seats and the daily license sync, including the seat arithmetic (`EnterpriseLicenseSeats.ts`) and the license-response mapper (`EnterpriseLicenseSync.ts`). The license of an installation bought on a cloud marketplace is `MarketplaceLicense.ts`. Only the `SeatUsage` type stays in core. |
| `Server/LicenseServer/` | The license server that oneuptime.com runs. Mounted only when billing is enabled. |
| `Server/AdminHealth/` | The live OneUptime Health dashboards (overview, queues, Valkey, logs, ClickHouse cluster, telemetry ingestion, Postgres cluster and activity) and the query console, served by one router mounted ahead of core's. Core keeps the every-edition routes, the probes they share (`App/API/AdminHealthProbes.ts`) and a 402 fallback for each enterprise path. |
| `Server/WhiteLabel/` | White-labelling: whether the license allows it, the settings, their routes and the branding handed to core. See [White-labelling](#white-labelling). |
| `Server/Marketplace/` | Billing of installations bought on a cloud marketplace: the `EnterpriseMarketplace:ReportUsage` job (`Jobs/`), the hourly billing state machine (`MarketplaceBilling.ts`), the run that drives it (`MarketplaceUsageRun.ts`) and its store. See [Cloud marketplace installations](#cloud-marketplace-installations). |
| `Server/Workers/` | Enterprise cron jobs (PostgreSQL and Valkey/Redis health evaluation) and the probes they read: `InstanceHealth/PostgresHealth.ts` and the counter deltas in `InstanceHealth/RedisHealth.ts`. The Redis INFO read stays in core, because the admin health API uses it too. |
| `Server/CustomNotificationChannels/` | Custom notification channels: the sender core hands every request for a channel to (`CustomChannelSender.ts`, served at `/api/notification/custom-channel/send` by `API/CustomChannelSendAPI.ts`), and the job that adds a channel paging everyone to everybody's on-call rules (`Jobs/AddCustomChannelToEveryonesRules.ts`). The `CustomNotificationChannel` model, its migrations, `CustomNotificationChannelService`, the payload (`packages/Common/Types/CustomNotificationChannel/`), the signed request and its retries (`packages/App/FeatureSet/Notification/Utils/SignedWebhookPost.ts`, shared with the Community Edition's SMS and call gateway), the action links and every place a channel is read stay in core, which asks `packages/Common/Server/Utils/Notification/CustomChannelEdition.ts` before anything reaches a channel. |
| `Server/Billing/` | OneUptime Cloud's card billing: the Stripe client core's `BillingService` hands every payment-provider call to, and the subscription and metered plan jobs. Only with billing on. See [OneUptime Cloud billing](#oneuptime-cloud-billing). |
| `Server/CloudMarketplace/` | OneUptime Cloud sold on AWS Marketplace, Microsoft Marketplace, Google Cloud Marketplace and Vercel Marketplace: routes, purchases, the hourly usage report and the jobs. Only with billing on. See [OneUptime Cloud billing](#oneuptime-cloud-billing). |
| `Dashboard/`, `AdminDashboard/` | The Enterprise UI plugins for the two frontends, each assembled from per-area `Plugins.ts(x)` files. `Dashboard/TelemetryRetention/` holds the retention override cards (retention by telemetry type on Settings > Telemetry, and the retention cards of every service and resource Settings page) and the form and summary they share. `Dashboard/Identity/` holds the SCIM screens, their license banner and the one read-only incident action (**Reset Bearer Token**); its license-mode hooks are also used by `Dashboard/AuditLogs/` and `Dashboard/AuditLogExport/`. `Dashboard/AuditLogExport/` holds Settings > Audit Logs > Export (a project's exports), and its table, form and test are shared with `AdminDashboard/AuditLogExport/`, Settings > Audit Log Export (the instance's exports). `Dashboard/CustomRoles/` holds the custom role screens (Teams > Settings > Roles, a role's page, and the custom roles of a team and of an API key), `Dashboard/IpAllowlists/` the IP allowlist card that status pages, public dashboards and forms share, `Dashboard/StatusPageAccessControls/` a status page's reader session limit and subscriber restrictions, and `Dashboard/StatusPageBranding/` its Powered by OneUptime switch; `Dashboard/EnterpriseSettings/` holds the license notice those four show. Core keeps a shell for each (the Roles pages, `IpAllowlistSettings`, `StatusPageSessionLengthSettings`, `SubscriberRestrictionsSettings`, `StatusPagePoweredBySettings`, `TeamCustomRolesSettings`, `ApiKeyCustomRolesSettings`), which draws the upsell and, while a record still holds the setting, a card with the one move every edition allows: removing it. One area is shared across the frontends by relative import: the license manager (`AdminDashboard/License/`, also used by the Dashboard). `AdminDashboard/WhiteLabel/` holds Settings > White Label, and `AdminDashboard/CustomChannels/` Settings > Custom Channels. |
| `Scripts/` | Operator scripts, such as `GenerateLicenseSigningKey.ts`. |
| `Tests/Server`, `Tests/UI` | The two jest projects in `jest.config.js`. |

Models, migrations, CRUD services, the audit-log table, the license columns
and every enforcement site stay in core (Apache-2.0). That includes the
retention overrides: the columns stay on core models, the write gate is core's
`EditionPermissions.checkEnterpriseColumnPermissions`, and ingest drops the
overrides in `OpenTelemetryIngestService.applyRetentionOverrideEdition` while
the feature is not active. The same goes for custom roles, IP allowlists and a status page's access
controls: their tables and columns stay in core, core enforces what is set in
every edition (a custom role's permissions are copied onto the teams and API
keys that have it), and `EditionPermissions` gates only the writes. `ee/` holds behaviour,
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
the Community image (`APP_TAG=release`). Running on would silently stop SCIM
provisioning (deprovisioning included) and audit logging. The error says what
to set: `APP_TAG=enterprise-<version>` to keep the Enterprise Edition, or
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
  behaviour run right now? This governs SCIM provisioning and the SCIM Push
  Groups team locks (`SCIM`), audit-log recording (`AuditLogs`), whether
  ingest applies retention overrides (`TelemetryRetention`) and whether a
  status page may hide "Powered by OneUptime" (`StatusPageBranding`, read in
  `packages/Common/Server/Utils/StatusPage/StatusPagePoweredBy.ts`) and
  whether anything reaches a custom notification channel
  (`CustomNotificationChannels`, read through
  `packages/Common/Server/Utils/Notification/CustomChannelEdition.ts`). Core reads
  the SCIM team locks through
  `packages/Common/Server/Utils/EditionEnforcement.ts`.
- `EnterpriseEdition.isFeatureAvailable(feature)` and
  `isFeatureAvailableSync(feature)`: may enterprise configuration be created
  or changed now? This governs enterprise configuration writes (including the
  one tighten-only update allowed without a license, a SCIM bearer-token
  rotation), the enterprise admin Health dashboards and the query console. It
  fails closed.

Single sign-on asks none of these questions. SAML and OIDC sign-in (projects,
status pages, the whole instance and the mobile flows), the provider listings
and "Require SSO for login" (project, instance-wide and status page) are core,
so they behave the same in every edition and every license state.

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

- **SCIM stops.** Every SCIM endpoint (project and status page) answers 403
  with a SCIM error body naming the lapsed license, and the SCIM Push Groups
  team locks relax so teams can be managed in OneUptime.
- **Audit logging stops recording, and audit log export stops sending.**
  Each export keeps its place and carries on from it once a license that
  includes audit logs is active.
- **Retention overrides stop applying.** New telemetry gets the project's
  default retention; rows already written keep theirs.
- **Status pages show "Powered by OneUptime" again**, whatever their switch
  says. The switch is kept, so the line goes again with a license.
- **Custom channels stop.** Nothing is sent to a custom notification
  channel, and none is offered or counted (readiness, the fallback). The
  channels and the on-call rules that use them are kept.
- Enterprise configuration becomes read-only (`isFeatureAvailable`). For the
  retention overrides, which are columns of core models
  (`EnterpriseEdition.getEnterpriseColumnsForTableName`), that means a write
  that sets one is refused, and one that clears it is not. Custom roles
  (`CustomRoles`), IP allowlists (`IpAllowlists`) and a status page's access
  controls (`StatusPageAccessControls`) work the same way, and what is set
  keeps applying. The Health dashboards and team compliance keep their own
  rules.

Single sign-on is not affected: its routes have no license gate, and "Require
SSO for login" stays enforced whatever the license state.

Nothing is deleted or changed. When a license is activated, everything resumes
without a restart. `isFeatureActive` logs a warning once when features stop
and an info line when they resume, and the relaxed SCIM team locks are listed
by `packages/Common/Server/Utils/RelaxedScimTeamLocksReport.ts`.

An **unknown** license state never stops SCIM or audit logging or relaxes the
SCIM team locks: before the first license snapshot has loaded, when reading
the cached snapshot throws, or when no license is installed and the start of
the trial has not been recorded yet (the first-run stamp could not be
written, or the GlobalConfig row does not exist yet, so nobody can tell
whether the trial is over), `isFeatureActive` answers "active" (keep serving,
enforcing and recording) and warns once per process. The loader waits,
bounded, for the first snapshot before any router is mounted, so this window
is small. `isFeatureAvailable` fails closed instead.

The SCIM routers are mounted once at boot, but the license changes at
runtime, and an ee router may not have `router.use()` layers. So every SCIM
route starts with a gate from `Server/Identity/Middleware/LicensedFeatureGate.ts`
that asks per request. `Tests/Server/Identity/IdentityLicenseGates.test.ts`
checks every route has the gate, and that no core single sign-on route carries
one; `Tests/Server/Identity/RoutePathsUnchanged.test.ts` pins the SCIM route
paths. Core pins and probes the single sign-on routes itself, in
`packages/App/Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts` and
`SsoRoutesServedInEveryEdition.test.ts`. Because the license is asked on every such
request, the license provider reuses a computed snapshot for at most a second
(`LICENSE_SNAPSHOT_REUSE_IN_MS`), and never past an expiry, grace or trial
boundary, so it does not verify a signed license on every request.

The model-to-feature map lives in `EnterpriseEdition.getModelFeature()`.

A license names the features it entitles with the `EnterpriseFeature` values
(`packages/Common/Server/Enterprise/EnterpriseFeature.ts`), or `*` for all of
them. `sso` is retired (`RETIRED_ENTERPRISE_FEATURE_VALUES`): single sign-on
moved to core, and a license that still lists `sso` parses as before, but the
name grants nothing and must never name another feature. The license server
(`Server/LicenseServer/LicenseSigner.ts`) keeps issuing `*`, because releases
up to 14.0.10 gate single sign-on on the `sso` claim (or `*`); a narrower
feature list must keep `sso` while those releases are supported.

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
- For the same reason a core guard that scans the repository's files never
  sees `ee/` in CI. To hold `ee/` to one, share its detector from
  `packages/Common/Tests/Helpers/` and run it over `ee/` from an ee suite, as
  `Tests/Server/TestTagStripGuard.test.ts` (`TagStripScan.ts`) and
  `Tests/Server/FrontendRequestsUseRefreshAwareApi.test.ts`
  (`RefreshAwareApiScan.ts`) do, or run the core guard with `ee/` present from
  a step of `.github/workflows/test.ee.yaml`.
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
After that, enterprise configuration becomes read-only and SCIM and audit
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
| `test-e2e-{test,release}-self-hosted` | `<version>` | off | Community Edition. No `ee/` in the image at all, so every enterprise route (SCIM included) 404s, while the single sign-on routes, which are core, answer as on every other stack. |
| `test-e2e-{test,release}-enterprise` | `enterprise-<version>` | off | Self-hosted Enterprise. The **license** decides whether SCIM and audit logging run. |

The enterprise job runs the suite twice against one booted stack:

- **Phase A, licensed** (`npm run test-enterprise-licensed`). A fresh Enterprise
  install is inside its unlicensed trial, so everything is on. This is what only
  a booted stack can prove: the identity routes answer **through nginx** (jest
  mounts Express directly and never exercises `location /identity` or its
  rewrite), the **shipped UI bundles** really carry the ee plugins so the
  dashboard renders the SCIM and audit-log screens instead of the upsell, and
  the audit recorder in the real image writes a real row to ClickHouse.
- **Phase B, lapsed** (`npm run test-enterprise-lapsed`). Same stack, same data,
  lapsed license: the SCIM gates refuse with 403 rather than 404 — the routes
  are still mounted, which is what tells "no `ee/`" apart from "`ee/` with a
  dead license" — while the single sign-on routes answer exactly as in phase A,
  enterprise configuration becomes read-only, and password sign-in still
  works.

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
(`Server/License/TrustedLicenseKeys.ts`).

**Step 1 of the ceremony has shipped:** the list holds the OneUptime Cloud
signing key (`kid` `vvbOO2N2qmM6A7D1L5NK7NHaAEauC42jGJcqO6mdLmM`), so a release
built from this commit onwards can verify a license signed with it. Licenses
issued before the matching private key is set on oneuptime.com still classify as
"unverified" and are accepted only because legacy acceptance is on (next
section).

The steps, in this order (1 and 2 are done; 3 and 4 are the deploy):

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
read-only and SCIM and audit logging stop (see
[When the license lapses](#when-the-license-lapses)) until a signed license is
activated. The upgrade notes must say so.

## oneuptime.com must run the Enterprise image

OneUptime Cloud (`BILLING_ENABLED=true`) must run the Enterprise image.

- The Community image has no SCIM or audit logging, and no license server, so
  every self-hosted activation would fail.
- The boot therefore refuses billing without `ee/`.
  `ALLOW_BILLING_WITHOUT_ENTERPRISE=true` overrides this, but only for local
  development.
- The SaaS end-to-end jobs run the `enterprise-<version>` tag for the same
  reason.
- With billing on, the license server routes (`/api/enterprise-license/...`)
  are mounted, and plan checks (not the license) gate enterprise features.
- OneUptime Cloud's own billing is in `ee/` as well (next section): a billing
  process without `ee/` would have no Stripe client, no marketplace routes and
  no billing jobs.

## OneUptime Cloud billing

OneUptime Cloud (`BILLING_ENABLED=true`) bills its customers from `ee/`. None
of it is in the Community image, and with billing off the Enterprise Edition
switches all of it off: no route, no job, no Stripe client.

| Path | What it is |
| --- | --- |
| `Server/Billing/` | The Stripe client (`StripeBillingProvider.ts`): customers, subscriptions, plan changes, trials, payment methods, invoices and the invoice webhook. The jobs that keep projects in step with it (`Jobs/`): `PaymentProvider:CheckSubscriptionStatus`, `PaymentProvider:PopulatePlanNameInProject`, `PaymentProvider:UpdateTeamMembersIfNull` (seat counts), `PaymentProvider:SendDailyEmailsToOwnersIfSubscriptionIsOverdue` and `MeteredPlan:ReportTelemetryMeteredPlan` (metered usage). `stripe` is ee's runtime dependency (`package.json`). |
| `Server/CloudMarketplace/` | OneUptime Cloud sold on AWS Marketplace, Microsoft Marketplace, Google Cloud Marketplace and Vercel Marketplace: each marketplace's client, adapter and inbound handling (`AWS/`, `Azure/`, `GoogleCloud/`, `Vercel/`), the routes (`API/`: landing pages, webhooks, the purchase page's routes, the provider API Vercel calls and sign-in from Vercel), what records, claims, links and unlinks a purchase (`MarketplacePurchases.ts`), the hourly usage report, and the `Marketplace:ReportUsage`, `Marketplace:SyncPurchases` and `Marketplace:VercelBilling` jobs (`Jobs/`). The guides are [RELEASING.md](../packages/Common/Server/Utils/Marketplace/RELEASING.md) and [VERCEL_RELEASING.md](../packages/Common/Server/Utils/Marketplace/VERCEL_RELEASING.md). |

Core never imports them. It asks `EnterpriseEdition`, whose getters answer
null on the Community Edition, for a module without the member, when the
module answers null (billing off) and when it throws - never an error:

- **`getBillingProvider()`** (the `BillingProvider` interface in
  `packages/Common/Server/Types/Billing/BillingProvider.ts`). Core keeps
  `BillingService` as a facade with the same singleton, method names and
  signatures, so its callers, and the core tests that spy on it, are
  unchanged. Each method hands its call to the provider. Without one it
  answers as a server without billing does - `BILLING_NOT_ENABLED` for
  anything that reads or changes a payment provider's records,
  `shouldSendInvoicesByEmail` false, `handleWebhookEvent` ignoring the event -
  and never reaches a payment provider. `isBillingEnabled`,
  `isSubscriptionActive`, `isTestEnvironment` and the metered price ids stay
  in core, so plan gating (`ProjectService.getCurrentPlan` reads
  `SubscriptionStatusUtil`) and the metered plans never need `ee/`.
- **`getProjectBillingHooks()`** (`ProjectBillingHooks` in
  `EnterpriseServerModule.ts`). With billing on, ProjectService tells the
  marketplaces what happens to projects: `beforeProjectsDelete` (a
  marketplace-billed project's last usage is reported while it is still
  there), `afterProjectsDelete` (a Vercel resource is deleted on Vercel, and
  every deleted project's purchase is unlinked) and
  `afterMarketplacePlanChange` (a Vercel resource's plan follows). A hook that
  fails is logged and never fails the delete or the plan change.
- **Routes and jobs**, through the usual area hooks and with billing on only:
  the marketplace routes through `getApiRouters`, sign-in from Vercel through
  `getIdentityRouters` (after single sign-on, whose paths do not change), and
  the jobs through `registerWorkerJobs`. Their names are in core's
  `ENTERPRISE_OWNED_JOB_NAMES`, so a repeatable definition an earlier release
  left in Redis gets a no-op placeholder where `ee/` does not register it.

What every edition uses stays in core: the HTTP client and the token verifier
Sign in with Microsoft is built on (`MarketplaceHttp.ts`,
`RemoteJwtVerifier.ts`), the Vercel log drain and its signature check
(`VercelSignature.ts`), the models, migrations and CRUD services
(`MarketplaceSubscriptionService` keeps its lookups), the plan limits, and the
balance and pay-as-you-go services, which reach Stripe only through
`BillingService`. Tests: `Tests/Server/Billing`, `Tests/Server/CloudMarketplace`,
and core's `BillingServiceFacade.test.ts`, `ProjectServiceBillingHooks.test.ts`
and `CloudBillingLivesInEe.test.ts`.

## Cloud marketplace installations

Self-hosted OneUptime Enterprise is also sold on AWS Marketplace (Amazon EKS),
Microsoft Marketplace (AKS) and Google Cloud Marketplace (GKE), billed per
user-hour through the marketplace, with no license key. The marketplace
editions of the Helm chart set `ENTERPRISE_MARKETPLACE` (`aws`, `azure` or
`google-cloud`) and what that marketplace needs. The listings, the packaging
and the release steps are in
[the self-hosted marketplace guide](../packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md).

- **Billing (`Server/Marketplace/`).** The job
  `EnterpriseMarketplace:ReportUsage` is registered only on a self-hosted
  installation that names a marketplace. It runs every 15 minutes and at
  startup, under a Valkey lock: it notes the installation's user count and
  reports each clock hour once, at the most users seen, through the reporters
  in `Server/Marketplace/Reporters`. Its state is the
  root-only license column `GlobalConfig.enterpriseMarketplaceBilling`. Each
  report is claimed before it is sent and carries an idempotency key derived
  from the installation and the hour, so no hour is billed twice.
- **Licensing (`Server/License/MarketplaceLicense.ts`).** An accepted report
  is the marketplace's word that the buyer is subscribed. It classifies as a
  valid license for 72 hours (`MARKETPLACE_LICENSE_RENEWAL_IN_MS`), with every
  feature and no seat limit, then as the usual grace period, then as expired.
  A refusal (the buyer is not subscribed) classifies as expired at once.
  Nothing in the environment grants it: `ENTERPRISE_MARKETPLACE` only says
  which marketplace to ask. The license provider runs on whichever of a
  license key and the marketplace license classifies better
  (`LicenseRanking`), so a refused purchase never takes away a valid key.
  White-labelling still needs a verified key that grants it.
- **What operators see.** The edition label names the marketplace ("Licensed
  through AWS Marketplace", "Marketplace Reports Failing", "Marketplace
  Subscription Ended"), master admins get `marketplaceBilling` from
  `GET /api/global-config/license`, and the license manager has no **Refresh
  license** button for a marketplace license, which has no key to refresh.

## White-labelling

A license can let the customer white-label their own installation: replace
OneUptime's name and logo with theirs. It is for resellers, and it is not
advertised anywhere - no public docs, no Home site, no release notes, no
mention in the product of an installation whose license does not allow it.
This section is the documentation. `Tests/Server/WhiteLabel/WhiteLabelStaysInEnterprise.test.ts`
keeps it that way: outside `ee/`, the words for it appear only in the schema
of the license switch.

### On oneuptime.com (the license server)

**Can be white-labelled** on the license form (Admin Dashboard > Enterprise
Licenses, create or edit) is `EnterpriseLicense.canBeWhiteLabelled`, off by
default. The license list shows a **White-label** badge beside the license
type.

The switch travels in the signed license token only, as the claim
`canBeWhiteLabelled: true`: the token `/validate` and `/report-user-count`
return, and the offline token. A license without the switch gets exactly the
token it got before the switch existed - no claim at all, not even `false` -
and the JSON answers never name it, on or off. So an installation learns it
only by verifying a token signed for a license that has it, and nobody can
grant it without the signing key.

That means it needs EdDSA signing (see the key ceremony below): a license
server still issuing legacy HS256 tokens cannot give anyone white-labelling,
because no installation can verify those. The switch reaches a customer's
installation at its next license refresh: the daily usage report, or
**Refresh license** in its edition dialog. An offline installation needs a new
offline token.

### On the customer's installation

`Server/WhiteLabel/WhiteLabelEntitlement.ts` decides, synchronously and on
every ask, from the license this process holds. Allowed only when ALL hold:

- self-hosted (billing off): OneUptime Cloud is never white-labelled;
- the license token is **verified** - signed by a key this build trusts.
  An unverified legacy license, a token signed by an unknown key, a tampered
  or malformed token, a token bound to another instance and the unlicensed
  trial never allow it;
- the license is usable: valid, or expired and inside its 30-day grace
  period (nothing changes until grace ends, as for every enterprise feature);
- the token carries `canBeWhiteLabelled: true`.

Everything else is no, and an unknown license state (not read yet) is no.

While it is allowed, **Admin Dashboard > Settings > White Label** (master
admins) sets:

| Setting | What it changes |
| --- | --- |
| Product name (up to 50 characters, no line breaks or `< > { }`) | Every place the product names itself: page titles, the sign-in pages, the product's own sentences in every language (the Dashboard, Accounts and status pages replace "OneUptime" as a word in every translated string, interpolated values included), emails (header, footer, sign-off, subjects, the templates' own sentences), SMS, voice calls and push notifications, "Powered by" on status pages and public dashboards, `llms.txt`, server-rendered pages, the web app manifest. With a name set, the Dashboard footer and the sign-in page also drop OneUptime's support and legal links and the edition pill. |
| Website (optional, http or https) | Where "Powered by <name>" links, in emails and on status pages and public dashboards. Without it the line has no link. |
| Logo for light backgrounds (PNG, JPEG, GIF, WebP or SVG, up to 512 KB) | The Dashboard and Admin Dashboard headers, the sign-in pages, form pages without a logo of their own, server-rendered pages, and the top of emails when it is a PNG, JPEG or GIF (many mail clients draw neither SVG nor WebP; the product name stands in). |
| Logo for dark backgrounds (optional, same rules) | The headers in dark mode; without it the light-background logo is used. |
| Browser tab icon (PNG, JPEG, GIF, WebP, SVG or ICO, up to 128 KB) | The favicon of every frontend and server-rendered page, the web app manifest's icon, and web push notifications' icon. |

Uploads are typed from their own bytes, never from the browser's claim; an SVG
with scripts, event handlers, embedded HTML, `javascript:` or entity
declarations is refused. Stored values are read back under the same rules, so
a value that would not pass today is never served.

What deliberately stays OneUptime: the Admin Dashboard's own sentences and its
edition dialog (where the installation's operators manage the OneUptime
license - a license notice names its licensor), the public docs and the API
reference served at `/docs` and `/reference`, the license emails oneuptime.com
sends, the mobile app, Slack, Microsoft Teams and other workspace messages,
WhatsApp messages (their templates are approved with Meta under the operator's
own account), and every command, package, image and URL (`oneuptime`,
`ONEUPTIME_*`, `oneuptime.com`).

### How it is wired

- **Schema (core):** `EnterpriseLicense.canBeWhiteLabelled`, and
  `GlobalConfig.branding*` (name, website, the three images as `data:` URLs,
  the time of the last change). `GlobalConfigService` refuses writes to the
  branding columns from anyone but OneUptime itself and drops them from every
  read that is not, so a value stored while white-labelling was allowed is
  never served by the generic API once it is not.
- **The routes (`Server/WhiteLabel/API/WhiteLabelAPI.ts`):**
  `GET`/`PUT /api/branding/settings` (master admins) and the public image
  routes `/api/branding/logo`, `/dark-logo` and `/favicon`. Every route starts
  with the license gate, which passes a request on (`next("route")`) before
  anything else looks at it, so an installation whose license does not allow
  white-labelling answers exactly what it answers for a path that does not
  exist. An image that is not set answers the same.
- **What core shows:** the module's `getProductBranding()` hands core a
  neutral `ProductBranding` (`packages/Common/Types/Branding/ProductBranding.ts`),
  or `null` while it is not allowed. Core puts it in env.js
  (`PRODUCT_BRANDING`, absent while `null`), in the index pages and
  server-rendered pages (`ProductBrandingViewVariables`), in emails
  (`EmailBranding.ts`, the `brandName` helpers) and in paging messages
  (`ProductBrandingText`). Core never says what the branding is for.
- **The settings page (`AdminDashboard/WhiteLabel/`):** an Enterprise settings
  page (`SettingsPages`, `SettingsSideMenuItems`). It knows whether white-labelling
  is allowed from env.js alone, so an installation whose license does not
  allow it never sends a request that names it. Its text is English only: it
  stays out of the shared locale files, which ship to every installation.
- **Caching:** the settings are read at boot and cached for 30 seconds per
  process (`WhiteLabelProvider.ts`); a save refreshes the process that served
  it at once, and every other process within 30 seconds. Pages pick changes up
  on their next load.

### When the license changes

Turning the switch off on oneuptime.com takes effect at the installation's
next license refresh: the new token has no claim, so white-labelling stops,
and the product shows OneUptime's name and logo again at once - pages on
their next load, emails and messages from the next one sent. The settings are
kept, not deleted, and come back as they were if the license gets the switch
again. The same happens when the license lapses past its grace period, and
comes back when it is renewed.

## Contributing

Contributions to `ee/` are licensed under `ee/LICENSE` and require agreeing
that OneUptime may use them commercially. See
[CONTRIBUTING](../.github/CONTRIBUTING.md#licensing-of-contributions).
