# Private Network Webhooks

By default OneUptime refuses to send an outbound request to any host that resolves into a private, loopback or link-local range. If you have tried to point a workflow at an internal tool, you have seen the message:

> Webhook URL resolves to a private, loopback, or link-local address and is not allowed

That default is correct for the hosted product, where anyone can sign up and a webhook target is untrusted input. On a self-hosted instance it gets in the way of an ordinary thing: posting an alert to a self-hosted Mattermost, Jira or ticketing system that only exists on your own network.

This page explains how to allow it, deliberately and narrowly.

## What Is Blocked, And What Can Be Unblocked

Blocked targets fall into two tiers.

| Tier          | Ranges                                                                                                                                                                                         | Can it be allowed?                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Private**   | RFC-1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`), IPv6 unique-local (`fc00::/7`) and site-local (`fec0::/10`)                                               | Yes — with `ALLOW_PRIVATE_NETWORK_WEBHOOKS`, or by naming the host |
| **Forbidden** | Loopback (`127.0.0.0/8`, `::1`), the unspecified address, link-local (`169.254.0.0/16`, `fe80::/10`), multicast, reserved, broadcast, and the names `localhost` and `metadata.google.internal` | Only by naming the exact host or CIDR in the allowlist             |

The cloud metadata endpoint `169.254.169.254` sits in the forbidden tier for a reason. On a cloud VM it hands out the instance's IAM credentials to anything that can make an HTTP request from the machine, so no blanket setting will ever open it.

IPv6 spellings that carry an IPv4 target inside them — IPv4-mapped (`::ffff:10.0.0.5`), NAT64, 6to4, Teredo — are classified by the IPv4 address they reach, so they cannot be used to smuggle a forbidden address past a private-tier allowance.

## Which Webhooks Are Covered

Covered — the target is a URL an authenticated member of your project wrote:

- Workflow **API** components (GET / POST / PUT / PATCH / DELETE)
- HTTP requests made by the workflow **Custom JavaScript** component
- Project webhook notifications (incidents, alerts, monitors, on-call, scheduled maintenance, status page events)
- On-call **user webhooks**

**Not** covered, and never will be: **status page subscriber webhooks**. Any visitor to a public status page can register one, so relaxing that sink would let anyone on the internet make your server POST into your private network. This is not configurable.

Outbound connections that are not webhooks — external data sources, LLM providers, SMTP OAuth token endpoints, OIDC discovery and Runbook HTTP steps — are governed separately, by `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES`, and already permit private ranges on self-hosted installs.

## Turning It On

Both halves are required. The instance decides what is reachable; each project decides whether to use it. A project can never widen your instance's egress policy on its own.

### Step 1 — Configure The Instance

Set one or both of these and restart. They are off by default, so an instance that sets neither behaves exactly as it did before.

`ALLOW_PRIVATE_NETWORK_WEBHOOKS` permits the whole private tier:

```
ALLOW_PRIVATE_NETWORK_WEBHOOKS=true
```

`PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` names specific hosts and CIDRs, which are then allowed regardless of tier:

```
PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=mattermost.internal,*.svc.cluster.local,10.20.0.0/16
```

Entries may be separated by commas, spaces or newlines, and each one may be:

- a hostname — `mattermost.internal`
- a wildcard — `*.svc.cluster.local` (matches subdomains, not the bare suffix)
- an IPv4 or IPv6 address — `10.20.30.40`, `fd00::1`
- a CIDR — `10.20.0.0/16`, `fd12:3456::/32`

A scheme, port, path or userinfo on an entry is stripped, so pasting the webhook URL you already have works.

A hostname named in the allowlist is trusted **without a DNS check** — that is the point of naming it, since it is expected to resolve somewhere the blocklist would refuse. An address entry is matched against the literal in the URL and against every address DNS returns for it.

**Never put `169.254.169.254`, or any range containing it, in the allowlist.** On a cloud VM that gives every member of an opted-in project your instance's IAM credentials.

### On Docker Compose

Add both lines to your `config.env` and restart:

```
ALLOW_PRIVATE_NETWORK_WEBHOOKS=true
PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=mattermost.internal
```

### On Kubernetes / Helm

```yaml
webhooks:
  allowPrivateNetwork: true
  privateNetworkAllowlist: "mattermost.internal,10.20.0.0/16"
```

### Step 2 — Opt The Project In

Once the instance is configured, a **Private Network Webhooks** card appears under **Settings > Project** in the dashboard. A Project Owner or Admin turns it on there. Until they do, that project's webhooks keep the strict policy.

The card is hidden on instances that configured neither setting, because the toggle would grant nothing.

## Verifying It Works

Create a workflow with an API component pointing at your internal service and run it. If it is still refused, the error message names which gate is closed:

- _"...points to a private network address and is not allowed. Self-hosted instances can allow this by setting `ALLOW_PRIVATE_NETWORK_WEBHOOKS`..."_ — either the instance setting is missing, or the project has not been opted in.
- _"...points to a private, loopback, or link-local address and is not allowed."_ — the target is in the forbidden tier. Name the exact host or CIDR in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` if you really need it.
- _"Webhook URL hostname could not be resolved via DNS."_ — the OneUptime container cannot resolve the name. Check that it shares a network with the target.

## Security Notes

Opening this up is a real change to what your OneUptime instance can be made to reach, so it is worth being deliberate about:

- **Prefer the allowlist to the blanket boolean.** Naming `mattermost.internal` is a much smaller grant than opening every RFC-1918 address.
- **Anyone who can author a workflow in an opted-in project can reach anything you allowed.** Treat project membership in those projects accordingly.
- **The response body comes back.** An API component returns the status, headers and body into the workflow log, so an allowed host is readable, not just writable.
- **Redirects are never followed** on these requests, so an allowed public host cannot bounce the server to an internal one on a second hop.
- **Turn it off per project when it is no longer needed.** The instance setting can stay; the project toggle is the cheaper thing to revoke.
