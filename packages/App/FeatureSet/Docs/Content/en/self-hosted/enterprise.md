# Enterprise Edition

OneUptime is built from one repository and ships in two editions:

- **Community Edition**: the whole monitoring, incident and observability
  platform, including SAML and OpenID Connect single sign-on, open source under
  the Apache License 2.0 and free to self-host at any scale.
- **Enterprise Edition**: the Community Edition plus the enterprise modules in
  the repository's [`ee/`](https://github.com/OneUptime/oneuptime/tree/master/ee)
  directory. Those modules add SCIM provisioning, governance and
  instance-administration features. They are licensed under the
  [OneUptime Enterprise License](https://github.com/OneUptime/oneuptime/blob/master/ee/LICENSE),
  and production use needs an Enterprise license for your number of users.

The two editions are separate container images. The Community image contains
no code from `ee/`. OneUptime Cloud runs the Enterprise Edition, and on the
cloud your plan decides which of these features you get.

> **Single sign-on is in every edition.** SAML and OIDC sign-in for projects
> and status pages, global SSO and "Require SSO for login" are part of the
> Community Edition, and no license state switches them off. In 14.0.0 to
> 14.0.10 they were Enterprise Edition features that stopped when the license
> lapsed; releases after 14.0.10 serve them in both editions.

This page covers what each edition includes, how to run the Enterprise
Edition, how licensing works, and what happens when you switch editions.

## What each edition includes

| Feature | Community | Enterprise | OneUptime Cloud |
| --- | --- | --- | --- |
| Monitoring, alerts, incidents, on-call, status pages, logs, metrics, traces, exceptions, dashboards, workflows, AI features, API and Terraform | Yes | Yes | Every plan |
| Password sign-in, two-factor authentication, teams, roles and API keys | Yes | Yes | Every plan |
| [SAML SSO and OpenID Connect](/docs/identity/sso) for project sign-in | Yes | Yes | Scale plan and above |
| SAML SSO and OpenID Connect for private status page sign-in | Yes | Yes | Scale plan and above |
| [Global (instance-wide) SSO and OIDC](/docs/identity/global-sso) | Yes | Yes | Not applicable |
| [SCIM provisioning](/docs/identity/scim) for projects and status pages | No | Yes | Scale plan and above |
| Team compliance settings | No | Yes | Scale plan and above |
| Audit logs | No | Yes | Enterprise plan |
| Retention overrides: retention by telemetry type (logs, traces, metrics, profiles, with rules by log severity and trace status), and per-service and per-resource retention | No | Yes | Scale plan and above |
| Admin **Health** dashboards: instance overview, background queues, instance logs, PostgreSQL, Valkey, ClickHouse cluster, diagnostic logs and telemetry ingestion | No | Yes | Not applicable |
| Admin **Query Console** | No | Yes | Not available |
| PostgreSQL and Valkey (Redis) health alerts | No | Yes | Not applicable |
| ClickHouse capacity view, capacity alerts and automatic disk pruning | Yes | Yes | Not applicable |
| Migration status, support bundle and global probes in the Admin Dashboard | Yes | Yes | Not applicable |
| Enterprise license, seat and instance management | No | Yes | Not applicable |

Single sign-on includes "Require SSO for login" for projects, private status
pages and the whole instance, in both editions.

Every edition has the project's default telemetry retention (**Settings >
Telemetry > Telemetry Data Retention**). Retention overrides are what the
Enterprise Edition adds on top of it.

"Not applicable" rows are instance-administration features. On OneUptime
Cloud, OneUptime operates the instance for you.

## Running the Enterprise Edition

Both editions use the same configuration, databases and data. Switching
editions changes the image you run and nothing else. No migration is needed
in either direction.

### Kubernetes with Helm

Set the image type in your `values.yaml`:

```yaml
image:
  type: enterprise-edition
```

Then upgrade as usual:

```
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

The chart then pulls the `enterprise-` variant of every image tag, for example
`oneuptime/app:enterprise-release`, or `enterprise-<version>` when you pin
`image.tag`. Set `image.type: community-edition` (the default) to run the
Community Edition.

### Docker Compose

Set `APP_TAG` in your `config.env`:

```
APP_TAG=enterprise-release
```

Use `enterprise-<version>` to pin a release. Then pull the images and restart:

```
npm run update
```

To go back to the Community Edition, set `APP_TAG=release` **and**
`IS_ENTERPRISE_EDITION=false`. While `IS_ENTERPRISE_EDITION=true`,
`npm run update` moves `APP_TAG` back to `enterprise-release`, and the
Community image refuses to start.

### `IS_ENTERPRISE_EDITION` is deprecated

The image you run decides the edition. `IS_ENTERPRISE_EDITION` no longer turns
enterprise features on, and it will be removed in a future release. You can
leave it unset.

Setting `IS_ENTERPRISE_EDITION=true` on the Community image does **not** enable
enterprise features. The App **refuses to start** instead, so an upgrade that
lands on the Community image can never silently stop SCIM provisioning
(deprovisioning included) and audit logging. The error tells you what to set:
`APP_TAG=enterprise-<version>` to keep the Enterprise Edition, or
`IS_ENTERPRISE_EDITION=false` to run the Community Edition. With Helm this
cannot happen: the chart derives the variable from `image.type`.

`ONEUPTIME_EDITION=community` makes the Enterprise image run as the Community
Edition. This is useful for trying a downgrade before you make it. The
Enterprise image sets `ONEUPTIME_EDITION=enterprise` itself; do not override it
with anything other than `community`.

## Licensing

The repository's root
[`LICENSE`](https://github.com/OneUptime/oneuptime/blob/master/LICENSE) file
sets out which license covers what: everything in the `ee/` directory is under
the [OneUptime Enterprise License](https://github.com/OneUptime/oneuptime/blob/master/ee/LICENSE),
third-party components keep the licenses their owners provide them under, and
everything else is under the Apache License 2.0.

A new Enterprise Edition install runs as a **14-day trial**, counted from the
first time the install starts the Enterprise Edition. The trial is for
evaluation: production use of the Enterprise Edition needs a subscription under
the OneUptime Enterprise License. Activate a license before the trial ends:
after it, SCIM, audit logging and retention overrides stop and enterprise
configuration becomes read-only (see
[When a license expires or is missing](#when-a-license-expires-or-is-missing)).
To get a license, contact [sales@oneuptime.com](mailto:sales@oneuptime.com).

The license is managed from the **edition label**, which master admins see in
the Admin Dashboard header and in the footer of the Dashboard. It shows the
license status, the seat usage and, for master admins, the instance ID.

### Online activation (license key)

1. Sign in as a master admin and open the edition label.
2. Enter your license key and validate it.

The install checks the key with OneUptime and stores the license it receives.
From then on it keeps the license current with a daily sync. Use **Refresh
license** on the edition label to fetch changes, such as extra seats or a
renewal, straight away.

Online activation needs outbound HTTPS from the OneUptime server to
`https://oneuptime.com`. If the server reaches the internet only through a
relay, set `ENTERPRISE_LICENSE_SERVER_URL` to the relay's `https://` address.
The relay must forward `/api/enterprise-license/` to oneuptime.com.

### Offline activation (air-gapped installs)

An install with no route to the internet can use a **signed license token**
instead of a key:

1. Sign in as a master admin, open the edition label and note the
   **instance ID**.
2. Ask OneUptime ([sales@oneuptime.com](mailto:sales@oneuptime.com)) for an
   offline license token for that instance ID.
3. Paste the token into the edition label's token field and activate it.

The install verifies the token itself, against the OneUptime signing keys
built into your release. It never contacts OneUptime. A token issued for one
instance ID is refused by every other install, and a token issued for no
instance ID (such as the token an install activated online receives) is
refused too. To renew or add seats, activate a new token before the current
one expires.

> **Offline activation needs a release that trusts OneUptime's license signing
> key.** If your release does not include that key yet, activation fails with
> "this build does not trust the key that signed this token". In that case,
> activate online, or upgrade to a release that includes the key.

### What the daily license sync sends

An install that was activated online sends one report to OneUptime a day. It
contains:

- the license key;
- the instance ID (a random identifier generated by the install) and the host
  name the install is configured with (`HOST`);
- the OneUptime version the install runs;
- the number of users on the install;
- a **SHA-256 hash** of each user's email address, lower-cased. OneUptime uses
  the hashes to count a person who has accounts on several of your installs as
  one seat. Raw email addresses of ordinary users are never sent;
- the email addresses of the install's **master admins**, so OneUptime can
  contact you about renewals and seat limits.

The response carries the license as OneUptime knows it that day: company name,
expiry, seat limit, the combined user count across your installs, and the
installs registered to the license. Other replicas of the install pick up a
change within about a minute.

When you activate or refresh the license, the install sends only the license
key, the instance ID, the host name and the version.

Nothing else is sent. No monitoring data, telemetry, logs or configuration
leave the install. The Community Edition sends none of this, and neither does
an install activated offline.

### When a license expires or is missing

Every enterprise feature keeps working during the 14-day trial, and for 30
days after a license expires (the grace period). The edition label warns
before either one ends. After that, **SCIM, audit logging and retention
overrides stop** until a
license is activated, the same as on the Community Edition, and enterprise
configuration becomes read-only. Single sign-on is not an enterprise feature:
SAML and OIDC sign-in, global SSO and "Require SSO for login" work the same in
every license state.

| State | What happens |
| --- | --- |
| **Valid license** | Every enterprise feature works. New users cannot be added beyond the licensed number of seats. Existing users are never removed. |
| **Trial or grace period** (the first 14 days of an unlicensed install, or 30 days after a license expires), or an install that holds a license whose expiry was never recorded | Every enterprise feature works, and the edition label shows a warning. During the grace period after an expiry, the seat limit still applies. An install holding a license with no recorded expiry runs the same 14-day trial as an unlicensed install, and the seat limit is not enforced, because the license record it holds is already incomplete. |
| **After the trial or grace period** (expired, missing or invalid license, or a license that does not include the feature) | SCIM provisioning, audit logging and retention overrides **stop** (see below). Enterprise configuration becomes **read-only**: you can view and delete it, but not create or change it. One change always works, so you can respond to an incident: replacing a SCIM bearer token. The SCIM settings pages offer it while everything else is read-only: **Reset Bearer Token** on a SCIM configuration, which shows the new token once. Through the API, send `bearerToken` on its own (at least 32 characters). Audit logging cannot be turned on or widened. The enterprise Health dashboards and the Query Console are locked. The seat limit is no longer enforced. |

What stops when a license lapses:

- **SCIM provisioning stops.** Your identity provider's SCIM requests are
  refused, including deprovisioning, and SCIM team locks are lifted, so teams
  managed by SCIM push groups can be edited by hand.
- **Audit logging stops recording.** Audit logs recorded so far are kept.
- **Retention overrides stop applying.** New telemetry is kept for the
  project's default retention. Telemetry already stored keeps the retention it
  was written with. You can still clear an override through the API, but not
  set one.

What does **not** stop:

- **Single sign-on.** SAML and OIDC sign-in for projects, private status
  pages, the whole instance (global SSO) and the mobile apps, and "Require SSO
  for login", are part of every edition. A lapsed license changes none of it,
  and single sign-on configuration stays editable.
- **Core monitoring is never affected**: monitors, alerts, incidents, on-call,
  status pages and telemetry all keep working.
- **Master admins can always sign in with their password.**
- **Nothing is deleted.** SCIM configuration, audit logs and retention
  overrides stay as they are.

**Everything resumes as soon as a license is activated**, without a restart:
SCIM provisioning, audit logging and retention overrides come back with the
configuration you have. OneUptime only switches them off when it knows the
license has lapsed. While it cannot read the license state, for example for a
moment while the server starts, SCIM, audit logging and retention overrides
stay on.

> **If your identity provider deprovisions users through SCIM, activate a
> license before the trial or grace period ends.** After that, SCIM no longer
> deprovisions the people you remove at your identity provider: their
> OneUptime accounts stay, and unless "Require SSO for login" applies to them,
> anyone who can still reach such an account's email inbox can set a password
> and sign in. If you let the license lapse, remove those users in OneUptime
> yourself.

## Switching from Enterprise to Community

Your configuration stays in the database. Switching back to the Enterprise
image restores everything as it was, as long as the install has a valid
license or is still in its trial or grace period. Single sign-on does not
change: SAML and OIDC sign-in, global SSO and "Require SSO for login" work the
same on both images. On the Community image:

- **SCIM stops.** Its provisioning endpoints no longer exist, so IdP-driven
  SCIM calls fail. That includes SCIM deprovisioning.
- **SCIM team locks are lifted**, so teams that were managed by SCIM push groups
  can be edited by hand. At startup the server logs which projects had their
  SCIM team locks lifted.
- **Audit logging stops.** Audit logs recorded so far are kept, but the audit
  log pages show an upgrade prompt.
- **Retention overrides stop applying.** New telemetry is kept for the
  project's default retention, and the retention cards on Settings >
  Telemetry and on every service and resource Settings page show an upgrade
  prompt. The overrides stay in the database and apply again when you switch
  back.
- **Enterprise settings pages show an upgrade prompt.** Through the API you can
  still read and delete enterprise configuration and reset a SCIM bearer token,
  but not create or change anything else. Audit logging cannot be turned on.
- **The enterprise Health dashboards, the Query Console, and the PostgreSQL and
  Valkey health alerts stop.** ClickHouse capacity monitoring and pruning,
  migration status and the support bundle keep working.

> **Before you switch an install whose identity provider deprovisions users
> through SCIM to the Community image, review who has access.** Without SCIM,
> the people you remove at your identity provider keep their OneUptime
> accounts, and unless "Require SSO for login" applies to them, anyone who can
> still reach such an account's email inbox can set a password and sign in.
> Remove those users first.

## Related

- [Upgrading](/docs/installation/upgrading)
- [SSO](/docs/identity/sso)
- [Global SSO](/docs/identity/global-sso)
- [SCIM](/docs/identity/scim)
