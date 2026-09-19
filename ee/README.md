# OneUptime Enterprise Edition (`ee/`)

This directory holds the OneUptime Enterprise Edition: the code that the
Enterprise image adds on top of the Community Edition. Everything else in the
repository is the Community Edition.

## License

Everything in `ee/` is licensed under the
[OneUptime Enterprise License](./LICENSE), **not** under the Apache License 2.0
that covers the rest of the repository:

- You may read, copy and modify this code for development and testing without
  a subscription.
- Running it in production requires a valid OneUptime Enterprise subscription
  for the correct number of user seats.
- Modifications and patches to `ee/` belong to OneUptime and may only be used
  with a valid subscription.
- You may not copy, distribute, sublicense or sell the code in `ee/`.
- Third-party components keep their own licenses.

Content outside `ee/` stays Apache-2.0, and the root [`LICENSE`](../LICENSE)
file is kept as the verbatim Apache License 2.0 text. Contributions to `ee/` are
covered in [CONTRIBUTING](../.github/CONTRIBUTING.md#licensing-of-contributions).

> **Legal review pending.** The text of `ee/LICENSE` follows the widely used
> PostHog / GitLab enterprise license template, adapted for OneUptime. It is
> pending review by OneUptime's counsel, and the wording may change before the
> first release that ships an Enterprise image built from this directory.

## What lives here

| Path | What it is |
| --- | --- |
| `Server/Index.ts` | The enterprise server module (the default export), assembled from one module per area, in order: License, Identity, TeamCompliance, AuditLog, LicenseServer, AdminHealth, Workers. It implements `EnterpriseServerModule` from `packages/Common/Server/Enterprise/EnterpriseServerModule.ts`. |
| `Server/Identity/` | SAML SSO, OIDC and SCIM for projects, status pages and the whole instance (global SSO). Route paths are byte-identical to the Community Edition paths they replaced, because customer identity providers have them configured. |
| `Server/TeamCompliance/` | Team compliance settings and the compliance status route. |
| `Server/AuditLog/` | The audit-log recorder behind `EnterpriseEdition.getAuditLogRecorder()`. |
| `Server/License/` | The license client: signed-license format (`LicenseToken.ts`), trusted signing keys (`TrustedLicenseKeys.ts`), the license snapshot, activation, refresh, seats and the daily license sync, including the seat arithmetic (`EnterpriseLicenseSeats.ts`) and the license-response mapper (`EnterpriseLicenseSync.ts`). Only the `SeatUsage` type stays in core. |
| `Server/LicenseServer/` | The license server that oneuptime.com runs. Mounted only when billing is enabled. |
| `Server/AdminHealth/` | The admin query console. |
| `Server/Workers/` | Enterprise cron jobs (PostgreSQL and Valkey/Redis health evaluation) and the probes they read: `InstanceHealth/PostgresHealth.ts` and the counter deltas in `InstanceHealth/RedisHealth.ts`. The Redis INFO read stays in core, because the admin health API uses it too. |
| `Dashboard/`, `AdminDashboard/` | The Enterprise UI plugins for the two frontends, each assembled from per-area `Plugins.ts(x)` files. |
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

## Which check to use: loaded vs licensed

`EnterpriseEdition` answers two different questions. Use the right one:

- `EnterpriseEdition.isLoaded()`: is the enterprise code running in this
  process? This governs runtime security behaviour: the SSO, OIDC and SCIM
  protocol routes, SSO enforcement, SCIM team locks and audit-log recording. It
  is **never** tied to the license, so a lapsed license never silently weakens a
  security control.
- `EnterpriseEdition.isFeatureAvailable(feature)` and
  `isFeatureAvailableSync(feature)`: may the enterprise feature be configured
  or used now? This governs creating and updating enterprise configuration, the
  enterprise admin Health dashboards and the query console. With billing on
  (OneUptime Cloud) the answer is always yes and plan gates apply as usual.
  Otherwise the license must be valid or in its grace period.

The model-to-feature map lives in `EnterpriseEdition.getModelFeature()`.

## Working on `ee/`

`ee/` has its own `package.json`, pinned to jest 28.1.3. It links
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
After that, enterprise configuration becomes read-only until a license is
activated. The trial is for evaluation. Production use needs a subscription.

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
stored license columns and the same 14-day grace period. It has to stay on
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

Once it is off, an unverified license classifies as invalid. After the grace
period, enterprise configuration becomes read-only on any install still
holding one.

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
