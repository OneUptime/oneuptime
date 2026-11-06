# Hardening Guide

Lock a self-hosted OneUptime down for a regulated or air-gapped network: run its containers with the least privilege they need, keep its traffic inside your boundary, and turn on the controls that security reviews ask for. Each section names the setting that does it.

There is no DISA STIG for OneUptime. This guide follows what STIG and SRG reviews commonly ask of an application on Kubernetes, and says where a requirement is met by your platform rather than by OneUptime. Your assessor decides what your authorization needs.

:::cards
- [Least privilege](#run-the-containers-with-least-privilege): Security contexts, and which containers run as root and why.
- [Network](#keep-traffic-inside-your-boundary): No connection out on its own, and network policies.
- [Identity](#control-who-signs-in): Single sign-on for everyone, two factors, session limits.
- [FIPS 140](#cryptography-and-fips-140): What OneUptime's images use, and where a validated module goes.
:::

## Run the containers with least privilege

The App, the worker and the telemetry writer run as the image's `node` user, UID 1000. Tell Kubernetes so, and take away what they never use:

```yaml title="values.yaml"
app:
  podSecurityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containerSecurityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop:
        - ALL
```

Set the same under `worker` and `telemetryWriter` when you run them. Each service takes its own `podSecurityContext` and `containerSecurityContext`; the top-level ones apply to every service that sets none. Try the settings on a staging cluster first, with your own admission policies.

Two containers start as root, on purpose:

| Container | Why | What limits it |
| --- | --- | --- |
| Probe | It runs each synthetic browser check as a different low-privilege user, which only root can switch to. | `probeContainerSecurityContext` by default: no privilege escalation, every capability dropped but the six it needs, and the `RuntimeDefault` seccomp profile. |
| Ingress gateway (nginx) | It is the one entry point that serves the install. | Your network policies and the Kubernetes Pod Security level you enforce on its namespace. |

## Keep traffic inside your boundary

- **No connection out on its own.** With the values in [Air-Gapped Installation](/docs/installation/air-gapped#install-from-your-registry), OneUptime makes no connection out of your network until someone sets up an integration. [Connections out of your network](/docs/self-hosted/architecture#forbindelser-ud-af-dit-netværk) lists each one.
- **Network policies.** The chart creates no `NetworkPolicy`. Write your own: allow traffic into the ingress gateway only, allow the services to reach each other, the databases and your DNS, and deny all other egress. Then allow egress for each integration you set up, such as your mail server.
- **Private addresses.** Decide what monitors, webhooks and workflows may reach inside your network. See [Private Network Access](/docs/self-hosted/private-network-access).

## Encrypt traffic in transit

- Terminate TLS for the install's address at your load balancer or ingress, with a certificate from your own certificate authority. The install orders one from Let's Encrypt only when you turn on `ssl.provision`.
- Leave `ssl.skipVerification` off. It turns off certificate checks for every call the install makes; trust your internal certificate authority instead.
- Upload a certificate for each status page on a domain of its own: without one, the install orders it from Let's Encrypt. See [Status page certificates](/docs/status-pages/branding-and-domains#ssl-certifikater).

## Control who signs in

- **Single sign-on.** Sign people in with SAML or OpenID Connect against your identity provider, in every edition: see [SSO](/docs/identity/sso) and, for every project at once, [Global SSO](/docs/identity/global-sso). An identity provider that accepts PIV or CAC credentials brings them to OneUptime this way.
- **Require it.** Turn on **Require SSO for Login** for the whole server in **Admin Dashboard > Settings > Single Sign-On**: every project then requires SSO of everyone but master admins, and the sign-in page offers SSO alone.
- **Sign-in links.** The sign-in page offers to email people a link that signs them in without their password; two-factor authentication still applies. Turn off **Let people sign in with an emailed link** in **Admin Dashboard > Settings > Authentication** to take it off the page and stop links already sent. See [Sign in with an emailed link](/docs/introduction/your-account#log-ind-med-et-link-sendt-på-e-mail).
- **Two factors.** People who sign in with a password can add an authenticator app or a security key as a second factor.
- **Accounts.** Create and remove accounts from your identity provider with [SCIM](/docs/identity/scim) (Enterprise Edition), so someone who leaves loses access when their account goes.
- **Sessions.** Limit how long a sign-in lasts, and how long it may sit unused, with [Session Length](/docs/self-hosted/session-length) (Enterprise Edition).
- **Least privilege.** Give each person, team and API key only the permissions it needs, and an expiry date to each API key. See [Permissions](/docs/permissions/index).

## Record what happens

- Turn on [Audit Logs](/docs/configuration/audit-logs) (Enterprise Edition) in every project. Each entry records who acted, what they did to which resource, and the change; nobody can edit or delete an entry, and it is kept for 7 to 180 days.
- Send entries to your SIEM, syslog receiver or storage as they are recorded, to keep them longer: see [Audit Log Export](/docs/configuration/audit-log-export).
- The Kubernetes audit log, and the logs of your load balancer and nodes, come from your platform.

## Keep secrets in your secret store

Give the chart the passwords and keys it needs as Kubernetes secrets you create, through the chart's `existingSecret` values and `externalSecrets`, rather than in `values.yaml`. Rotate them on your schedule.

## Protect data at rest

OneUptime keeps configuration in PostgreSQL, telemetry in ClickHouse, and the cache and queues in Valkey. Encrypt the volumes they use with your storage platform. Back them up, and test restores: the Enterprise Edition backs up PostgreSQL and ClickHouse to S3-compatible storage you run, as [Backups](/docs/installation/backups) describes.

## Patch

Check each release before it runs, as [Supply Chain Security](/docs/self-hosted/supply-chain-security) shows, and read its notes in [Upgrading](/docs/installation/upgrading). OneUptime publishes its security advisories on GitHub; on a network without internet access, the [update check](/docs/self-hosted/update-checks) can read them from a mirror and tell your master admins when one affects the version you run.

## Cryptography and FIPS 140

OneUptime's images are not FIPS 140-validated builds. Its services run on Node.js, whose cryptography comes from the OpenSSL it is built with: Node.js uses a FIPS 140-validated module only when it is built against one and started in FIPS mode, and OneUptime's images are not built that way. PostgreSQL, ClickHouse and Valkey use their own cryptographic libraries. Running your nodes in FIPS mode does not change what runs inside the containers.

Where FIPS 140-validated cryptography is required:

- Terminate TLS from outside the cluster at a load balancer or ingress controller that uses a validated module, and keep the cluster's internal network inside your boundary.
- Encrypt the databases' volumes with your storage platform's validated module.
- Talk to [OneUptime](mailto:sales@oneuptime.com) about your requirements.

## Checklist

| Requirement | Where it is met |
| --- | --- |
| Containers run without root, without privilege escalation, with capabilities dropped | `app`, `worker` and `telemetryWriter` security contexts, as above; the Probe's defaults |
| No outbound connections that are not needed | The air-gapped values, and your network policies |
| Encrypted transport | TLS at your load balancer or ingress |
| Central sign-in, multi-factor authentication | SSO with **Require SSO for Login**, your identity provider's factors |
| Account lifecycle | SCIM from your identity provider |
| Session limits | Session Length |
| Tamper-proof audit trail, kept centrally | Audit Logs and Audit Log Export |
| Software from a known source | Image and chart signatures, SBOMs, vulnerability reports |
| FIPS 140-validated cryptography | Your load balancer, ingress and storage, as above |

## Next steps

:::cards
- [NIST SP 800-53 Control Mapping](/docs/self-hosted/nist-800-53): Each control family, what OneUptime covers, what stays yours.
- [Supply Chain Security](/docs/self-hosted/supply-chain-security): Check every image and the chart before they run.
- [Air-Gapped Installation](/docs/installation/air-gapped): Carry a release into a network with no internet.
:::
