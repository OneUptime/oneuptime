# Private Network Access

OneUptime refuses to send certain outbound requests to hosts that resolve into a private, loopback or link-local range. If you have tried to point a workflow at an internal tool, you have seen the message:

> Webhook URL resolves to a private, loopback, or link-local address and is not allowed

That default is correct for the hosted product, where anyone can sign up and a webhook target is untrusted input. On a self-hosted instance it gets in the way of an ordinary thing: posting an alert to a self-hosted Mattermost, Jira or ticketing system that only exists on your own network.

This page explains how to allow it, deliberately and narrowly. There are two independent halves, configured on different machines:

| What you want to reach internally                  | Where the setting lives          |
| -------------------------------------------------- | -------------------------------- |
| Workflows, project webhooks, on-call user webhooks | The **API server**'s environment |
| API, Website, External Status Page and Custom JavaScript Code **monitors** | The **probe**'s own environment  |

Network-native monitor types such as Ping, Port, SSL Certificate, DNS, DNSSEC, SNMP / Network Device, SQL Query, Database Health, Synthetic and Network Path use their own transports. The setting on this page governs the HTTP transports that return arbitrary response content to a project: API, Website, External Status Page and Custom JavaScript Code monitors.

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

Four monitor types are affected: **API**, **Website**, **External Status Page** and **Custom JavaScript Code**. On a stock probe they can reach public HTTP(S) targets, but refuse private address space. API, Website and External Status Page monitors validate and pin DNS results for every connection and revalidate each redirect; Custom JavaScript Code applies the same address policy in its sandbox bridge.

The switch is read by the **probe process from its own environment**, not from the API server's, and every probe reads it: the ones bundled with Docker Compose, the ones the Helm chart deploys, and any [custom probe](/docs/probe/custom-probe) you run yourself. Whoever deploys a probe controls its environment, and they are the party who knows which network that probe can see — a custom probe is usually a different machine, often run by a different person, and it never reads the API server's configuration.

```
PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true
```

On Docker Compose, `config.env` already has a `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=false` line: change that line to `true` rather than adding a second one, because when a variable appears twice the later line wins. Then run `npm run start`, which recreates the containers with the new value; `docker compose restart` does not re-read `config.env`. Every bundled probe reads that one line, so it applies to `probe-1` and, where your stack runs a second probe, `probe-2`.

On Kubernetes, set it per probe in your values file and upgrade the release. Each entry under `probes:` is a separate probe, so set it on every one that should reach private addresses:

```yaml
probes:
  one:
    allowPrivateNetworkMonitors: true
```

On a custom probe, set `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` in that probe's own environment and restart it. The value must be exactly `true`; anything else, such as `TRUE` or `1`, leaves the switch off and the probe says so in a startup warning, whatever `LOG_LEVEL` is set to.

The bundled probes are **global probes**: they register themselves with the instance's `REGISTER_PROBE_KEY`, and every project on the instance can select them. Turning the switch on for a bundled probe therefore lets monitors from **every project on the instance** reach private addresses through it. That is usually what a single-team install wants. Where projects should not share that reach — separate teams, or customers you host — leave it off on the bundled probes and deploy a private (custom) probe inside each network instead, turned on only there.

There is one exception. A probe that registers itself with `REGISTER_PROBE_KEY` and has `BILLING_ENABLED=true` in its own environment — a global probe of the hosted, open-signup product, where anyone can sign up and every project shares the global probes — stays public-only even with the switch on, and logs a startup warning that it is ignoring it. The probes bundled with Docker Compose and the Helm chart are given the instance's `BILLING_ENABLED` automatically; give it to any other `REGISTER_PROBE_KEY` probe you run for such an instance. A probe cannot tell that it is global in any other way, so a global probe created in the Admin Dashboard and run with `PROBE_ID` and `PROBE_KEY` honors the switch like a private one: do not turn it on there if projects should not share that probe's network. A private probe honors the switch on any instance.

Every probe logs its effective private-network policy when it starts: whether private network monitoring is on or off, and why. A value that is being ignored, and a global probe that the switch opens to every project, are logged as warnings at any `LOG_LEVEL`. The routine on or off line, and the "Probe environment" JSON that records the same decision under `privateNetworkMonitors`, are logged at `LOG_LEVEL=INFO`, the Helm chart's default; Docker Compose ships `LOG_LEVEL=ERROR`, so set `LOG_LEVEL=INFO` to see them there. Check that log first when a monitor on a probe you just changed is still refused.

Turning it on does **not** open loopback, link-local or the cloud metadata endpoint. Those stay refused on every probe, which matters most for probes that run in a network the monitor's author does not own.

Leave it off on probes you operate on behalf of other people.

## Verifying it works

Run the workflow or monitor again. If it is still refused, the error message names which gate is closed:

- _"...points to a private network address and is not allowed. Self-hosted instances can allow this by setting `ALLOW_PRIVATE_NETWORK_WEBHOOKS`..."_ — the API server setting is missing.
- _"...private network address... Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it."_ — a private (custom) probe ran the monitor, and its switch is off. Note that this is set on the probe, not on the API server.
- _"...private network address... Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it (probes.<name>.allowPrivateNetworkMonitors in the Helm chart). This is a global probe, so that allows it for every project on this instance; otherwise, select a private probe deployed on that network."_ — a bundled (global) probe ran the monitor, and its switch is off. Turn it on for that probe as described above if every project on the instance may reach that network; otherwise select a private probe on the monitor.
- _"...Global probes cannot monitor private network addresses. Deploy and select a private probe for this target."_ — a global probe with `BILLING_ENABLED=true` in its environment ran the monitor. Auto-registered global probes stay public-only there, whatever their switch says; deploy a private probe inside the target's network and select it on the monitor.
- _"Monitor target host ... could not be reached."_ — an API, Website or External Status Page monitor whose target is a **hostname** reports this when the name resolves to a refused address as well as when DNS fails, so a monitor cannot be used to map which internal names exist. The error details shown with it mention `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` either way; they do not say which case applied. If the name points at a private address, check the probe's startup log for its private-network policy; when it is off, the fix is the same as for the messages above. With `LOG_LEVEL=DEBUG`, the probe also logs the exact reason for each refused name.
- _"...points to a private, loopback, or link-local address and is not allowed."_ — the target is in the forbidden tier. For a webhook, name the exact host or CIDR in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` if you really need it. For a monitor, there is no override.
- _"...hostname could not be resolved via DNS."_ — the container cannot resolve the name. Check that it shares a network with the target.

## Security notes

Opening this up is a real change to what your OneUptime instance can be made to reach, so it is worth being deliberate about:

- **Prefer the allowlist to the blanket boolean.** Naming `mattermost.internal` is a much smaller grant than opening every RFC-1918 address.
- **Anyone who can author a workflow or an API, Website, External Status Page or Custom JavaScript Code monitor can reach anything you allowed.** Treat membership in those projects accordingly.
- **The response body comes back.** A workflow API component returns the status, headers and body into the workflow log, so an allowed host is readable, not just writable.
- **Redirects are never followed** on webhook requests, so an allowed public host cannot bounce the server to an internal one on a second hop.
- **Scope by probe rather than instance-wide where you can.** A probe deployed inside one network is a narrower grant than opening the API server's egress.
