# OneUptime XCP-ng Agent

Monitor XCP-ng pools — hosts, VMs, storage repositories and virtual disks — with OneUptime, through the OpenMetrics plugin of the Xen Orchestra that manages them.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container with a tuned config that scrapes Xen Orchestra's own OpenMetrics endpoint once a minute and ships what it reads to OneUptime over OTLP. One Xen Orchestra serves every pool it manages from that one endpoint, so **one agent adds every pool**: each pool becomes its own XCP-ng pool in OneUptime, matched on its XAPI UUID. No XCP-ng host password ever reaches the agent or OneUptime — only the plugin's read-only secret.

## Prerequisites

- **Xen Orchestra 6.9 or later** with its **OpenMetrics plugin** (`xo-server-openmetrics`, version 1.9 or later). Xen Orchestra built from sources includes the plugin; on the Xen Orchestra Appliance (XOA) it needs a Premium licence. 6.9 brings the plugin's scrape memory-leak fixes (6.8 already stopped its secret changing on every restart of xo-server).
- **XCP-ng 8.3 LTS** pools, connected to that Xen Orchestra.
- Docker Engine 20.10+ with the Docker Compose v2 plugin, `curl` and `openssl`, on any machine that reaches Xen Orchestra's web port (443 on an XOA, 80 on Xen Orchestra built from sources unless you gave it HTTPS).
- A **OneUptime ingestion key** — create one from *Project Settings → Telemetry & APM → Ingestion Keys*.

Without the plugin (an XOA without Premium, or a pool with no Xen Orchestra at all) a pool cannot be read this way yet; reading XAPI directly is planned in [#10999](https://github.com/OneUptime/oneuptime/issues/10999).

### Turning on the OpenMetrics plugin

1. In Xen Orchestra, open **Settings → Plugins** and find **openmetrics**.
2. Leave **Prometheus secret** empty (one is generated, and kept, the first time the plugin loads) or set your own long random value (`openssl rand -hex 32`), then **Save** and turn the plugin **on**.
3. Open the plugin again and copy the secret: the agent sends it as a Bearer token. Anyone who has it can read every pool's metrics, so treat it like a password.

Check it from the agent's machine (the health check needs no secret):

```bash
curl -k https://xo.example.com/openmetrics/health
# {"status":"ok"}
```

`-k` skips the certificate check for this one request only: it carries no secret and only asks whether the plugin runs, and Xen Orchestra's certificate may well be the self-signed one [below](#when-xen-orchestra-uses-its-own-self-signed-certificate). The agent never skips the check.

## Xen Orchestra's certificate

The agent checks Xen Orchestra's certificate and never skips the check: the secret would otherwise go to whoever answers in Xen Orchestra's place. It trusts exactly what `xo-ca.pem` (next to `docker-compose.yml`) holds, which `install.sh` writes in one of three ways:

| Your Xen Orchestra has | Set | `xo-ca.pem` holds |
| --- | --- | --- |
| A certificate this machine already trusts (a public CA such as Let's Encrypt, or your own CA installed on this machine) | nothing | This machine's CA bundle |
| A certificate from your own CA | `XO_CA_FILE=/path/to/ca.pem` | That CA bundle |
| A self-signed certificate that names its address | `XO_TLS_FINGERPRINT=<SHA-256 fingerprint>` | Xen Orchestra's certificate itself (pinned) |

With none of them set and a certificate this machine does not trust, `install.sh` shows the certificate and its fingerprint and pins it once you confirm it is Xen Orchestra's; with no one at a terminal to confirm, it stops. Read the fingerprint on Xen Orchestra's machine to compare:

```bash
openssl x509 -noout -fingerprint -sha256 -in <the certificate xo-server uses>
```

A pinned certificate is trusted until it changes: when Xen Orchestra's certificate is renewed, run `install.sh` again with the new `XO_TLS_FINGERPRINT`. Until then the agent reads nothing, and `troubleshoot.sh` says the certificate is no longer the pinned one. A CA bundle survives renewals.

### When Xen Orchestra uses its own self-signed certificate

The certificate Xen Orchestra makes for itself when it has none (`autoCert`) names no host: it has no subjectAltName. The collector, like every current TLS client, checks that a certificate is issued to the address it connects to, from its subjectAltName only, so it can never trust that certificate — not even pinned. `install.sh` stops on it and says so. Give Xen Orchestra a certificate that names its address instead, for example a self-signed one made on Xen Orchestra's machine:

```bash
sudo mkdir -p /etc/ssl/xo
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -subj "/CN=xo.example.com" \
  -addext "subjectAltName=DNS:xo.example.com,IP:10.0.0.5" \
  -keyout /etc/ssl/xo/key.pem -out /etc/ssl/xo/cert.pem
```

Name every address the agent may use in `subjectAltName` (`DNS:` for a name, `IP:` for an address). Point xo-server's HTTPS listener at the two files (readable by the user xo-server runs as, root by default) (in a configuration file of its own: `/etc/xo-server/config.httpscert.toml` on an XOA, or next to xo-server's `config.toml` for Xen Orchestra built from sources), restart xo-server (`systemctl restart xo-server`) and pin the new certificate:

```toml
[http.listen.1]
port = 443
cert = '/etc/ssl/xo/cert.pem'
key = '/etc/ssl/xo/key.pem'
```

Or let Xen Orchestra request a Let's Encrypt certificate itself (XOA supports it, see Xen Orchestra's documentation): it is publicly trusted, so the agent needs nothing set.

`XO_TLS_SERVER_NAME` is the name the certificate is checked against when `XO_URL` uses an address the certificate does not list (an IP address, say). `install.sh` fills it from the certificate's subjectAltName when `XO_URL`'s address is not in it.

### http:// in a lab

`XO_URL=http://...` works, with a warning: the secret and everything Xen Orchestra reports then cross the network in clear. Use it in a lab only.

## Quick Start — Install Script

```bash
curl -fsSL https://oneuptime.com/install/xcp-ng-agent -o install.sh
bash install.sh
```

Every OneUptime serves this script and the agent's files for its own release, at `<your OneUptime URL>/install/xcp-ng-agent`: on a self-hosted OneUptime, use its URL in place of `https://oneuptime.com` in the commands here. The first line saves the script as `install.sh`, so you can read it before you run it.

The script asks for your OneUptime URL and ingestion key, Xen Orchestra's address (`XO_URL`), the plugin's secret (not echoed) and what to call this Xen Orchestra in OneUptime. Before it writes or starts anything it reads Xen Orchestra's certificate and decides how to trust it (above), then asks Xen Orchestra for its metrics with the secret and tells you which pools it reports. Then it installs to `/opt/oneuptime-xcp-ng-agent`, writes `xo-ca.pem` and a `0600` `.env`, and starts the agent with Docker Compose. Values are quoted for Docker Compose as they are written, and the secret is also written with every `$` doubled, because the collector expands `$` once more. Re-running the script reuses everything in an existing `.env` instead of asking again, which is how you [upgrade](#upgrading).

Without a terminal (Ansible, a CI job), give everything in the environment:

```bash
ONEUPTIME_URL=https://oneuptime.com \
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key \
XO_URL=https://xo.example.com \
XO_OPENMETRICS_SECRET=your-plugin-secret \
XO_NAME=xo-prod \
XO_TLS_FINGERPRINT=AB:CD:...:EF \
bash install.sh
```

## Quick Start — Docker Compose

Download `docker-compose.yml` and `otel-collector-config.yaml` from your OneUptime into a folder:

```bash
curl -fsSLO https://oneuptime.com/install/xcp-ng-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/xcp-ng-agent/otel-collector-config.yaml
```

Save the certificates the agent trusts for Xen Orchestra as `xo-ca.pem` next to them — your CA's bundle, or Xen Orchestra's own certificate once you have checked its fingerprint:

```bash
openssl s_client -connect xo.example.com:443 -servername xo.example.com </dev/null 2>/dev/null \
  | openssl x509 > xo-ca.pem
openssl x509 -in xo-ca.pem -noout -fingerprint -sha256
```

Then create a `.env` file next to them. Write `XO_ADDRESS` (host:port) yourself (and `XO_SCHEME=http` only for a lab: it defaults to `https`), and every `$` in the secret as `$$`:

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
XO_SCHEME=https
XO_ADDRESS=xo.example.com:443
XO_OPENMETRICS_SECRET='your-plugin-secret'
XO_NAME=xo-prod
```

Then start the agent:

```bash
docker compose up -d
```

Without `xo-ca.pem`, `docker compose up` stops with `bind source path does not exist`: the agent never runs without knowing what to trust.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Ingestion key (*Project Settings → Telemetry & APM → Ingestion Keys*) |
| `XO_URL` | Yes (install script) | Xen Orchestra's address with its scheme, e.g. `https://xo.example.com`, `https://10.0.0.5:8443` or `https://[fd00::5]`. No path. `install.sh` writes `XO_SCHEME` and `XO_ADDRESS` from it |
| `XO_SCHEME` | No | `https`, or `http` in a lab (default: `https`) |
| `XO_ADDRESS` | Yes (Compose) | Xen Orchestra's `host:port`, an IPv6 address in brackets (`[fd00::5]:443`) |
| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret (*Settings → Plugins → openmetrics*), every `$` written as `$$` |
| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, stamped on every pool as `xen_orchestra.name` and shown on the pool's Settings (default: `XO_URL`'s host) |
| `XO_TLS_FINGERPRINT` | No | The SHA-256 fingerprint of Xen Orchestra's certificate, as `openssl x509 -fingerprint -sha256` prints it (colons optional): `install.sh` pins that certificate, and refuses any other |
| `XO_CA_FILE` | No | A PEM CA bundle to trust for Xen Orchestra instead: `install.sh` checks Xen Orchestra's certificate against it and copies it to `xo-ca.pem` |
| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against when `XO_URL` uses an address it does not list (`install.sh` fills it from the certificate) |
| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the **Read only** role and nothing else: the [OneUptime AI agent](#oneuptime-ai-agent) runs when it is set |
| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them (see [Fixes](#fixes)) |
| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool the read token can see) |
| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run read-only commands while it investigates (default: on) |
| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval` (default: `ask-for-approval` when writes are allowed, else `off`) |
| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes (with the token for changes). Anything else keeps it read-only |
| `ONEUPTIME_AI_WRITE_TARGETS` | No | Comma-separated `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` fixes may touch (`*` matches any run of characters; empty: all) |
| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change, whoever approves it |
| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent: `install.sh` writes it when the read token is set |
| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own ([Reading several Xen Orchestras](#reading-several-xen-orchestras)): `install.sh` names a new agent after its directory unless you set it, and keeps it on every re-run |
| `XCP_NG_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-xcp-ng-ai-agent`). `install.sh` names a second agent's AI agent after its collector (`oneuptime-xcp-ng-ai-agent-lab` beside `oneuptime-xcp-ng-agent-lab`) unless you set it, and keeps it on every re-run |

## What the agent sends

Every minute the agent reads `GET <XO_URL>/openmetrics/metrics` and:

- **keeps the pools' series** (`xcp_*`: hosts, VMs, storage repositories, virtual disks, XOSTOR) and drops Xen Orchestra's own (`xo_*`) and the scrape's (`up`, `scrape_*`), which belong to no pool;
- **turns eight rate series into gauges.** Xen Orchestra types `xcp_host_network_{receive,transmit}_bytes_total`, `xcp_vm_network_{receive,transmit}_bytes_total`, `xcp_vm_network_{receive,transmit}_errors_total` and `xcp_vm_disk_{read,write}_bytes_total` as `counter`, but each holds XAPI's per-second rate over the last minute, which goes down as often as up. Read as counters, every network and disk throughput chart would be wrong, so they arrive as gauges, with their names and values as Xen Orchestra sends them (bytes or errors per second);
- **sends one OTLP resource per pool**: the series are grouped by their `pool_id` and `pool_name` labels, which become the resource attributes `xcp_ng.pool.id` (the pool's XAPI UUID, which OneUptime matches the pool on, so renaming a pool keeps its history) and `xcp_ng.pool.name` (absent for a pool XAPI names nothing: OneUptime then calls it `Pool <first 8 characters of its UUID>`). Each also carries `xen_orchestra.name` and `oneuptime.agent.version`;
- **drops what belongs to no pool.** The plugin labels the host power it reads over IPMI (`xcp_host_power_consumption_watts{source="ipmi"}`) from the host alone, without `pool_id`, so the agent cannot tell which pool it belongs to and drops it. Each VM's estimated share of that power (`xcp_vm_power_consumption_watts`) carries its pool and is kept.

Samples keep the times Xen Orchestra gave them (the RRD minute they belong to), except `xcp_pool_connected`, which Xen Orchestra serves without one. A pool Xen Orchestra loses stops being reported (`xcp_pool_connected` is absent, never 0), and its pool in OneUptime turns Disconnected.

What the plugin does not report yet — alarms (except XOSTOR's), HA, the pool master, missing patches, backup results, snapshots — comes from Xen Orchestra's REST API in [#10997](https://github.com/OneUptime/oneuptime/issues/10997).

## Reading several Xen Orchestras

Run one agent per Xen Orchestra: each reads every pool its Xen Orchestra manages, so two agents on the same Xen Orchestra report every pool twice. To read a second Xen Orchestra from the same machine, install it into another directory with a container name of its own — two containers cannot share a name:

```bash
INSTALL_DIR=/opt/oneuptime-xcp-ng-agent-lab \
XCP_NG_AGENT_CONTAINER_NAME=oneuptime-xcp-ng-agent-lab \
bash install.sh
```

Without `XCP_NG_AGENT_CONTAINER_NAME`, `install.sh` names the container after its directory (`oneuptime-xcp-ng-agent-lab` here too). Either way the name is written to that agent's `.env`, which `docker-compose.yml` reads it from (`container_name: ${XCP_NG_AGENT_CONTAINER_NAME:-oneuptime-xcp-ng-agent}`), so re-running `install.sh` to upgrade the agent keeps it. Leave `container_name` in `docker-compose.yml` as it is: an upgrade replaces that file. An agent set up before `.env` held the name, by editing `container_name` there, keeps that name on its next upgrade — `install.sh` reads it from the old file (or the container it runs, or the copy an earlier upgrade kept) and writes it to `.env`. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env`. Give each agent its own `XO_NAME`, and pass its directory to the doctor script with `-d`.

Where to run it: anywhere that reaches Xen Orchestra. A machine outside the pools it watches (or Xen Orchestra's own VM, if it runs off them) keeps reporting when a pool goes down; inside the container, `localhost` is the container itself, so `XO_URL` must be Xen Orchestra's address on the network.

## OneUptime AI agent

The XCP-ng AI agent lets OneUptime AI look at a pool while it investigates an incident or an alert on it: its hosts, VMs, storage repositories and their PBDs, alarms, tasks, backup jobs and logs. Only if you allow it does it apply a fix, and then each fix goes through the pool's AI settings in OneUptime, with a person's approval unless you choose otherwise. It is OneUptime's resource AI agent (`oneuptime/resource-ai-agent`, the same image as every other one), the `oneuptime-xcp-ng-ai-agent` service of this `docker-compose.yml`, under the `xcp-ng-ai-agent` profile, which `install.sh` turns on when it has a read token.

It reads Xen Orchestra's REST API (Xen Orchestra 6.9 or later), over HTTPS only, trusting exactly the `xo-ca.pem` the collector trusts: the certificate Xen Orchestra makes for itself, which names no address, is refused here too, and [the same fix](#when-xen-orchestra-uses-its-own-self-signed-certificate) works for both. OneUptime never sends it a credential: it has the tokens you give it, which never leave it, are never logged, and are sent to Xen Orchestra only in its `authenticationToken` cookie. Everything it reads has secrets masked before it leaves the agent, and again in OneUptime.

### A read-only token

1. In Xen Orchestra, create a user for OneUptime AI. Not an administrator: Xen Orchestra lets an administrator change anything, whatever their roles.
2. Give it a copy of the built-in **Read only** role and nothing else. The built-in roles are templates: copy one, then give the copy to the user, on the pools it should read.
3. Create a token for that user (signed in as it, its profile's authentication tokens, or `xo-cli create-token`) and give it to the agent. The first line reads it without showing it or keeping it in your shell history: paste the token, then press Enter.

```bash
read -rs ONEUPTIME_AI_XO_READ_TOKEN && export ONEUPTIME_AI_XO_READ_TOKEN
bash install.sh
```

`install.sh` asks Xen Orchestra whether it knows the token before it installs anything, writes it to the mode-600 `.env`, and starts the agent. Run without it at a terminal, a first install asks for it (not echoed); Enter skips it. Before the agent runs a command, and again every 5 minutes, it asks Xen Orchestra who the token belongs to and what that user may do: the token of an administrator, or of a user whose roles allow any change, runs nothing, and the pool's AI agent page in OneUptime says why.

### Which pool

An AI agent serves one pool: `XCP_NG_POOL_ID`, its XAPI UUID, shown on the pool's Settings in OneUptime. Left empty, the agent serves the one pool its token can see, and refuses to guess between several. For a Xen Orchestra with several pools, set `XCP_NG_POOL_ID`, and run one more AI agent per pool from a `docker-compose.override.yml` next to `docker-compose.yml`, which `install.sh` leaves alone:

```yaml
services:
  oneuptime-xcp-ng-ai-agent-lab:
    extends:
      file: docker-compose.yml
      service: oneuptime-xcp-ng-ai-agent
    container_name: oneuptime-xcp-ng-ai-agent-lab
    environment:
      - XCP_NG_POOL_ID=<the other pool's UUID>
```

### A pool a probe reads

A pool OneUptime reads through a probe (Collection Method: Probe, on the pool's Settings) needs no XCP-ng Agent, but OneUptime AI still reaches it through this AI agent. Run the AI agent alone: put this directory's `docker-compose.yml` on a machine that reaches Xen Orchestra, with a `.env` beside it holding `ONEUPTIME_URL`, `ONEUPTIME_TELEMETRY_INGESTION_KEY`, `XO_ADDRESS`, `XCP_NG_POOL_ID` and the tokens, and an `xo-ca.pem` holding the certificates Xen Orchestra's certificate chains to (for a publicly trusted one, a copy of the machine's CA bundle, such as `/etc/ssl/certs/ca-certificates.crt`). Then start it, and nothing else:

```bash
docker compose --profile xcp-ng-ai-agent up -d oneuptime-xcp-ng-ai-agent
```

### Fixes

Fixes are off until you allow them twice over: `ONEUPTIME_AI_ALLOW_WRITES=true` with a token for changes, `ONEUPTIME_AI_XO_WRITE_TOKEN`, of another user. The read token in its place is refused. The token for changes is used for the change itself and for nothing else, so a mistake in what OneUptime AI reads can never change anything. Give that user a copy of the built-in **VMs power state manager** role, which holds the privileges of the first two rows, add the others, and give it the copy on the pools it may fix:

| Privilege | For |
| --- | --- |
| `vm:start`, `vm:resume`, `vm:unpause` | Starting a halted VM, resuming a suspended one, unpausing a paused one (safe changes) |
| `vm:reboot`, `vm:shutdown`, `vm:suspend`, `vm:pause` | Clean or hard reboots and shutdowns, suspending and pausing a VM (riskier changes) |
| `vm:snapshot` | A snapshot of a VM before a riskier fix (riskier) |
| `vm:migrate-send`, `host:migrate-receive` | Moving a VM to another host of the pool, which always asks a person |
| `host:allow-vm` | Starting a VM on a host it names |
| `host:enable` | Enabling a host that was disabled (riskier) |
| `host:restart-toolstack` | Restarting a host's toolstack, which always asks a person |
| `pbd:plug` | Plugging a storage repository's PBD that did not plug (safe) |
| `schedule:run` | Running a backup schedule now (safe) |

Then set both in `.env` and run `install.sh` again:

```bash
ONEUPTIME_AI_ALLOW_WRITES=true
ONEUPTIME_AI_XO_WRITE_TOKEN=<a token of the user above>
```

Before a change the agent reads the object with the read token: one of another pool is refused, a change already made is not made again, and one the object's state does not allow says what to run instead. Then it sends the one request, follows Xen Orchestra's task within the command's time limit, and reads the object again, so what OneUptime shows ends with the object's state after the change. It never edits, deletes, reverts or clones anything, never acts on a pool or a storage repository, never shuts down, reboots, evacuates or disables a host, and never migrates to another pool or storage repository. That user's role is the hard limit.

The agent protects nothing of its own accord: put the UUIDs of the VM it runs in, and of Xen Orchestra's own VM, in `ONEUPTIME_AI_PROTECTED_TARGETS` (`vm/<uuid>`, or a bare UUID). The pool's AI agent page in OneUptime shows what the agent may do, and whether its token for changes works.

### Check it

```bash
cd /opt/oneuptime-xcp-ng-agent
docker compose logs --tail=100 oneuptime-xcp-ng-ai-agent
docker compose exec oneuptime-xcp-ng-ai-agent wget -qO- http://127.0.0.1:3877/status
```

| The agent says | What to do |
| --- | --- |
| `ONEUPTIME_AI_XO_READ_TOKEN belongs to a Xen Orchestra administrator` or `... to a user ... whose roles allow changes` | Give the token's user a copy of the Read only role and nothing else. |
| `did not accept ONEUPTIME_AI_XO_READ_TOKEN, which is wrong or has expired` | Make a new token for the same user, set it in `.env` and run `install.sh` again. |
| `the certificate names no address` | Give Xen Orchestra [a certificate that names its address](#when-xen-orchestra-uses-its-own-self-signed-certificate) and run `install.sh` again. |
| `manages 2 pools ...: set XCP_NG_POOL_ID` | Set `XCP_NG_POOL_ID` to the pool's UUID ([Which pool](#which-pool)). |
| `HTTPS only` | The AI agent never reads Xen Orchestra over `http://`: give it a certificate. |

## Auto-tag with Project Labels

Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to every pool the agent reports. Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml` (next to `oneuptime.agent.version`):

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.env
        value: production
        action: upsert
```

## Run as a systemd Service

```bash
sudo curl -fsSL https://oneuptime.com/install/xcp-ng-agent/systemd/oneuptime-xcp-ng-agent.service -o /etc/systemd/system/oneuptime-xcp-ng-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-xcp-ng-agent
```

The unit assumes the agent lives in `/opt/oneuptime-xcp-ng-agent` (the install script default).

## Upgrading

The collector image is pinned in `docker-compose.yml`, and `otel-collector-config.yaml` reports that pin to OneUptime as the agent's version (`oneuptime.agent.version`). When a newer OneUptime release pins a newer collector, a warning sign appears beside the **Agent Version** on each pool's Overview and Settings; select it to see these commands.

Re-run `install.sh`: it reuses every value in your existing `.env` (nothing is asked again; an exported variable still overrides it), checks Xen Orchestra's certificate the same way again (a pinned certificate that changed stops the upgrade, leaving the running agent as it was; a Xen Orchestra that does not answer keeps the `xo-ca.pem` you have), refreshes `docker-compose.yml` and `otel-collector-config.yaml`, pulls the image and recreates the agent so the collector reads its new config. A file you edited since `install.sh` installed it is kept next to the new one as `<file>.bak.<timestamp>`, and the script names it at the end. An agent installed outside `/opt/oneuptime-xcp-ng-agent` needs its directory (`INSTALL_DIR=<directory> bash install.sh`), and keeps its container name.

```bash
curl -fsSL https://oneuptime.com/install/xcp-ng-agent -o install.sh
bash install.sh
```

Installed it with Docker Compose instead? Download both files again, then pull and recreate the agent (re-apply any change you made to the two files):

```bash
curl -fsSLO https://oneuptime.com/install/xcp-ng-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/xcp-ng-agent/otel-collector-config.yaml
docker compose pull
docker compose up -d --force-recreate
```

## Uninstalling

```bash
cd /opt/oneuptime-xcp-ng-agent
docker compose down
```

## Troubleshooting

### Run the doctor script first

`troubleshoot.sh` walks the chain in the order data travels it, from the agent's own network, and names the first step that fails: the container, Xen Orchestra answering, its OpenMetrics plugin (`/openmetrics/health`), its certificate against `xo-ca.pem` (and whether it is still the pinned one), the secret (Xen Orchestra's own reason when it refuses it), the pools it reports, the ingestion key — with a **definitive server-side token validation** — and the collector's recent log. Neither the secret nor the key is ever printed or put on a command line.

```bash
curl -fsSL https://oneuptime.com/install/xcp-ng-agent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh                 # add -d <dir> if you installed outside /opt/oneuptime-xcp-ng-agent
```

### What the collector logs, and what to do

| `docker logs oneuptime-xcp-ng-agent` shows | What to do |
|--------------|------------|
| `server returned HTTP status 401 Unauthorized` | The secret is not the plugin's: copy it again from *Settings → Plugins → openmetrics* and re-run `install.sh` with `XO_OPENMETRICS_SECRET` set to it. |
| `server returned HTTP status 500 Internal Server Error` | The OpenMetrics plugin is not loaded (Xen Orchestra's proxy answers `There was a problem proxying this request.`): turn it on. |
| `x509: certificate signed by unknown authority` | Xen Orchestra's certificate is not what `xo-ca.pem` trusts: it changed since you pinned it, or your CA did not issue it. Re-run `install.sh` (with the new `XO_TLS_FINGERPRINT` once you have checked it). |
| `x509: certificate is not valid for any names` | Xen Orchestra uses the self-signed certificate it makes for itself, which names no host: see [When Xen Orchestra uses its own self-signed certificate](#when-xen-orchestra-uses-its-own-self-signed-certificate). |
| `x509: cannot validate certificate for <IP> because it doesn't contain any IP SANs` | `XO_URL` uses an address the certificate does not list: set `XO_TLS_SERVER_NAME` to a name it does (or re-run `install.sh`, which does). |
| `unable to read CA cert` | `xo-ca.pem` is missing or unreadable: re-run `install.sh`. |
| `context deadline exceeded` | Xen Orchestra took longer than 50 seconds to gather the metrics, usually because a host does not answer it. |
| `Exporting failed` | OneUptime refuses the ingestion key or cannot be reached: `troubleshoot.sh` tells which. |

### No pool appears in OneUptime

1. Run `troubleshoot.sh`: every step should pass, and step 6 lists the pools Xen Orchestra reports.
2. Xen Orchestra reports only the pools it is connected to (*Settings → Servers*): a disconnected pool has no series.
3. Give it two minutes: a pool appears after the agent's first scrape, and one that is already there turns Connected on the next.

### Common Commands

```bash
# Check agent status
docker compose ps

# View collector logs
docker logs -f oneuptime-xcp-ng-agent

# Read what Xen Orchestra serves, as the agent does (the secret on stdin, not on the command line)
printf 'Authorization: Bearer %s\n' "$XO_OPENMETRICS_SECRET" \
  | curl -s --cacert /opt/oneuptime-xcp-ng-agent/xo-ca.pem -H @- https://xo.example.com/openmetrics/metrics | head
```
