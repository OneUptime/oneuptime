# Private Network Access

OneUptime refuses to send certain outbound requests to hosts that resolve into a private, loopback or link-local range. If you have tried to point a workflow at an internal tool, you have seen the message:

> Webhook URL resolves to a private, loopback, or link-local address and is not allowed

That default is correct for the hosted product, where anyone can sign up and a webhook target is untrusted input. On a self-hosted instance it gets in the way of an ordinary thing: posting an alert to a self-hosted Mattermost, Jira or ticketing system that only exists on your own network.

This page explains how to allow it, deliberately and narrowly. There are two independent halves, configured on different machines:

| What you want to reach internally                  | Where the setting lives          |
| -------------------------------------------------- | -------------------------------- |
| Workflows, project webhooks, on-call user webhooks | The **API server**'s environment |
| Custom JavaScript Code **monitors**                | The **probe**'s own environment  |

**Most monitoring already works.** Every monitor type except Custom JavaScript Code — API, Website, Ping, Port, SSL Certificate, DNS, DNSSEC, SNMP / Network Device, SQL Query, Synthetic, External Status Page, Network Path — already reaches whatever host you point it at, with no address check at all. If you only want to monitor an internal service, deploy a [custom probe](/docs/probe/custom-probe) inside that network and nothing else on this page applies.

## What is blocked, and what can be unblocked

Blocked targets fall into two tiers.

| Tier          | Ranges                                                                                                                                                                                         | Can it be allowed?                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Private**   | RFC-1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`), IPv6 unique-local (`fc00::/7`) and site-local (`fec0::/10`)                                               | Yes                                                                                 |
| **Forbidden** | Loopback (`127.0.0.0/8`, `::1`), the unspecified address, link-local (`169.254.0.0/16`, `fe80::/10`), multicast, reserved, broadcast, and the names `localhost` and `metadata.google.internal` | Only by naming the exact host or CIDR in the webhook allowlist. Never for monitors. |

The cloud metadata endpoint `169.254.169.254` sits in the forbidden tier for a reason. On a cloud VM it hands out the instance's IAM credentials to anything that can make an HTTP request from the machine, so no blanket setting will ever open it.

IPv6 spellings that carry an IPv4 target inside them — IPv4-mapped (`::ffff:10.0.0.5`), NAT64, 6to4, Teredo — are classified by the IPv4 address they reach, so they cannot be used to smuggle a forbidden address past a private-tier allowance.

## Webhooks and workflows

These sinks are covered, because the target is a URL an authenticated member of your project wrote:

- Workflow **API** components (GET / POST / PUT / PATCH / DELETE)
- HTTP requests made by the workflow **Custom JavaScript** component
- Project webhook notifications (incidents, alerts, monitors, on-call, scheduled maintenance, status page events)
- On-call **user webhooks**

**Not** covered, and never will be: **status page subscriber webhooks**. Any visitor to a public status page can register one, so relaxing that sink would let anyone on the internet make your server POST into your private network. This is not configurable.

Outbound connections that are not webhooks — external data sources, LLM providers, SMTP OAuth token endpoints, OIDC discovery and Runbook HTTP steps — are governed separately, by `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES`, and already permit private ranges on self-hosted installs.

### Configuring the API server

Set one or both of these on the API server and restart. They are off by default, so an instance that sets neither behaves exactly as it did before.

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

**Never put `169.254.169.254`, or any range containing it, in the allowlist.** On a cloud VM that gives every project member your instance's IAM credentials.

On Docker Compose, add the lines to your `config.env` and restart:

```
ALLOW_PRIVATE_NETWORK_WEBHOOKS=true
PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=mattermost.internal
```

On Kubernetes:

```yaml
webhooks:
  allowPrivateNetwork: true
  privateNetworkAllowlist: "mattermost.internal,10.20.0.0/16"
```

## Probes and monitors

Only one monitor type is affected: **Custom JavaScript Code**. It runs in the same sandbox as the workflow Custom JavaScript component and inherits that component's SSRF guard, so on a stock install a Custom Code monitor checking `http://10.0.0.5/health` is refused while an API monitor against the same host succeeds.

The switch is read by the **probe process from its own environment**, not from the API server's. Whoever deploys a probe controls its environment, and they are the party who knows which network that probe can see — a custom probe is usually a different machine, often run by a different person, and it never reads the API server's configuration.

```
PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true
```

On Docker Compose, set it in `config.env`; it is applied to both bundled probes. On Kubernetes, set it per probe:

```yaml
probes:
  one:
    allowPrivateNetworkMonitors: true
```

Turning it on does **not** open loopback, link-local or the cloud metadata endpoint. Those stay refused on every probe, which matters most for probes that run in a network the monitor's author does not own.

Leave it off on probes you operate on behalf of other people.

## Verifying it works

Run the workflow or monitor again. If it is still refused, the error message names which gate is closed:

- _"...points to a private network address and is not allowed. Self-hosted instances can allow this by setting `ALLOW_PRIVATE_NETWORK_WEBHOOKS`..."_ — the API server setting is missing.
- _"...points to a private network address and is not allowed. Set `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` on the probe running this monitor to allow it."_ — the probe's setting is missing. Note that this is set on the probe, not on the API server.
- _"...points to a private, loopback, or link-local address and is not allowed."_ — the target is in the forbidden tier. For a webhook, name the exact host or CIDR in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` if you really need it. For a monitor, there is no override.
- _"...hostname could not be resolved via DNS."_ — the container cannot resolve the name. Check that it shares a network with the target.

## Security notes

Opening this up is a real change to what your OneUptime instance can be made to reach, so it is worth being deliberate about:

- **Prefer the allowlist to the blanket boolean.** Naming `mattermost.internal` is a much smaller grant than opening every RFC-1918 address.
- **Anyone who can author a workflow or a monitor can reach anything you allowed.** Treat membership in those projects accordingly.
- **The response body comes back.** A workflow API component returns the status, headers and body into the workflow log, so an allowed host is readable, not just writable.
- **Redirects are never followed** on webhook requests, so an allowed public host cannot bounce the server to an internal one on a second hop.
- **Scope by probe rather than instance-wide where you can.** A probe deployed inside one network is a narrower grant than opening the API server's egress.
