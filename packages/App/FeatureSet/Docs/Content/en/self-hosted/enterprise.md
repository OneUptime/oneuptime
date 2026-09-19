# Enterprise Edition

OneUptime is built from one repository and ships in two editions:

- **Community Edition**: the whole monitoring, incident and observability
  platform, open source under the Apache License 2.0 and free to self-host at
  any scale.
- **Enterprise Edition**: the Community Edition plus the enterprise modules in
  the repository's [`ee/`](https://github.com/OneUptime/oneuptime/tree/master/ee)
  directory. Those modules add identity, governance and instance-administration
  features. They are licensed under the
  [OneUptime Enterprise License](https://github.com/OneUptime/oneuptime/blob/master/ee/LICENSE),
  and production use needs an Enterprise license for your number of users.

The two editions are separate container images. The Community image contains
no code from `ee/`. OneUptime Cloud runs the Enterprise Edition, and on the
cloud your plan decides which of these features you get.

This page covers what each edition includes, how to run the Enterprise
Edition, how licensing works, and what happens when you switch editions.

## What each edition includes

| Feature | Community | Enterprise | OneUptime Cloud |
| --- | --- | --- | --- |
| Monitoring, alerts, incidents, on-call, status pages, logs, metrics, traces, exceptions, dashboards, workflows, AI features, API and Terraform | Yes | Yes | Every plan |
| Password sign-in, two-factor authentication, teams, roles and API keys | Yes | Yes | Every plan |
| [SAML SSO and OpenID Connect](/docs/identity/sso) for project sign-in | No | Yes | Scale plan and above |
| SAML SSO and OpenID Connect for private status page sign-in | No | Yes | Scale plan and above |
| [Global (instance-wide) SSO and OIDC](/docs/identity/global-sso) | No | Yes | Not applicable |
| [SCIM provisioning](/docs/identity/scim) for projects and status pages | No | Yes | Scale plan and above |
| Team compliance settings | No | Yes | Scale plan and above |
| Audit logs | No | Yes | Enterprise plan |
| Admin **Health** dashboards: instance overview, background queues, instance logs, PostgreSQL, Valkey, ClickHouse cluster, diagnostic logs and telemetry ingestion | No | Yes | Not applicable |
| Admin **Query Console** | No | Yes | Not available |
| PostgreSQL and Valkey (Redis) health alerts | No | Yes | Not applicable |
| ClickHouse capacity view, capacity alerts and automatic disk pruning | Yes | Yes | Not applicable |
| Migration status, support bundle and global probes in the Admin Dashboard | Yes | Yes | Not applicable |
| Enterprise license, seat and instance management | No | Yes | Not applicable |

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

Set `APP_TAG=release` to go back to the Community Edition.

### `IS_ENTERPRISE_EDITION` is deprecated

The image you run decides the edition. `IS_ENTERPRISE_EDITION` no longer turns
anything on or off, and it will be removed in a future release. You can leave
it unset.

Setting `IS_ENTERPRISE_EDITION=true` on the Community image does **not** enable
enterprise features. The server logs a warning at startup, and master admins
see an "Action needed" notice on the edition label, telling you to switch to
the Enterprise image.

`ONEUPTIME_EDITION=community` makes the Enterprise image run as the Community
Edition. This is useful for trying a downgrade before you make it. The
Enterprise image sets `ONEUPTIME_EDITION=enterprise` itself; do not override it
with anything other than `community`.

## Licensing

A new Enterprise Edition install runs as a **14-day trial**, counted from the
first time the install starts the Enterprise Edition. The trial is for
evaluation: production use of the Enterprise Edition needs a subscription under
the OneUptime Enterprise License. Activate a license before the trial ends to
keep enterprise configuration editable. To get a license, contact
[sales@oneuptime.com](mailto:sales@oneuptime.com).

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

Enforcement is soft. Losing a license never locks anyone out and never weakens
a security control.

| State | What happens |
| --- | --- |
| **Valid license** | Every enterprise feature works. New users cannot be added beyond the licensed number of seats. Existing users are never removed. |
| **Trial or grace period** (the first 14 days of an unlicensed install, or 14 days after a license expires) | Every enterprise feature works, and the edition label shows a warning. During the grace period after an expiry, the seat limit still applies. |
| **After the trial or grace period** (expired, missing or invalid license) | Enterprise configuration becomes **read-only**: you can view and delete it, but not create or change it. Two changes always work through the API, so you can respond to an incident: disabling an SSO or OIDC provider (`isEnabled: false` on its own), and replacing a SCIM bearer token (`bearerToken` on its own, at least 32 characters). Audit logging cannot be turned on or widened. The enterprise Health dashboards and the Query Console are locked. The seat limit is no longer enforced. |

What does **not** stop when a license lapses:

- **SSO, OIDC and SCIM keep working** with the configuration you already have.
  That includes "Require SSO for login" enforcement and SCIM deprovisioning, so
  people removed at your identity provider stay locked out.
- **Audit logging continues.**
- **Core monitoring is never affected**: monitors, alerts, incidents, on-call,
  status pages and telemetry all keep working.
- **Master admins can always sign in with their password.**

## Switching from Enterprise to Community

Your configuration stays in the database. Switching back to the Enterprise
image restores everything as it was, including SSO enforcement. On the
Community image:

- **SSO, OIDC and SCIM stop.** Their sign-in and provisioning endpoints no
  longer exist, so "Sign in with SSO" and IdP-driven SCIM calls fail. That
  includes SCIM deprovisioning.
- **"Require SSO for login" is not enforced**, for projects, private status
  pages and the whole instance, because SSO sign-in is no longer available.
  Users sign in with a password instead. Users who only ever signed in with SSO
  can set one with "Forgot password". At startup the server logs which projects
  and status pages had SSO enforcement relaxed.
- **SCIM team locks are lifted**, so teams that were managed by SCIM push groups
  can be edited by hand.
- **Audit logging stops.** Audit logs recorded so far are kept, but the audit
  log pages show an upgrade prompt.
- **Enterprise settings pages show an upgrade prompt.** Through the API you can
  still read and delete enterprise configuration, disable an SSO or OIDC
  provider and reset a SCIM bearer token, but not create or change anything
  else. Audit logging cannot be turned on.
- **The enterprise Health dashboards, the Query Console, and the PostgreSQL and
  Valkey health alerts stop.** ClickHouse capacity monitoring and pruning,
  migration status and the support bundle keep working.

> **Before you switch an install that enforces SSO to the Community image,
> review who has access.** Without SSO enforcement, anyone who still has a
> OneUptime account and can reach its email inbox can set a password and sign
> in, even if they were removed at your identity provider. Remove those users
> first.

## Related

- [Upgrading](/docs/installation/upgrading)
- [SSO](/docs/identity/sso)
- [Global SSO](/docs/identity/global-sso)
- [SCIM](/docs/identity/scim)
