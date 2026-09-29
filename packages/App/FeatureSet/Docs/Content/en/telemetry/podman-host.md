# OneUptime Podman Agent

## Overview

The OneUptime Podman Agent is a pre-built container image that ships with a tuned OpenTelemetry Collector configuration. Run it next to your existing containers and it auto-discovers every container on the host, collects CPU / memory / network / block I/O metrics plus container logs, and forwards everything to OneUptime over OTLP. Single image, single command — plus, if you want OneUptime AI to look into this host, the [AI agent](#ai-agent) as a second container beside it.

This page is the **installation guide**. For configuring Podman monitors and alerts on top of the data the agent collects, see [Podman Monitor](/docs/monitor/podman-monitor).

## Prerequisites

- Podman 4.0+
- Access to `/run/podman/podman.sock` on the host
- A **OneUptime Telemetry Ingestion Token** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the value

## Quick Start (One Command)

Replace `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN`, and the host name with values for your environment. The host name is how this Podman host will appear in OneUptime — pick something like `prod-podman-01`.

```bash
podman run -d \
  --name oneuptime-podman-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  -v /var/lib/containers:/var/lib/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e PODMAN_HOST_NAME="my-podman-host" \
  oneuptime/podman-agent:release
```

That is it. Once the agent connects, your Podman host will appear automatically in the **Podman** section of the OneUptime dashboard.

## Alternative — Podman Compose

If you prefer Podman Compose, drop the following into a `docker-compose.yml`:

```yaml
services:
  oneuptime-podman-agent:
    image: oneuptime/podman-agent:release
    container_name: oneuptime-podman-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /run/podman/podman.sock:/run/podman/podman.sock:ro
      - /var/lib/containers:/var/lib/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - PODMAN_HOST_NAME=my-podman-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Start it:

```bash
podman compose up -d
```

## Environment Variables

| Variable                  | Required | Description                                                                                                                                                                                   |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | Yes      | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host)                                                                                                    |
| `ONEUPTIME_SERVICE_TOKEN` | Yes      | Telemetry ingestion token from _Project Settings → Telemetry & APM → Ingestion Keys_                                                                                                          |
| `PODMAN_HOST_NAME`        | No       | Friendly name for this host. Defaults to `podman-host`. Set it to something stable per host (e.g. `prod-podman-01`)                                                                           |
| `DOCKER_API_VERSION`      | No       | Docker Engine API version the agent speaks to the Podman socket. Defaults to `1.44`; lower it if the socket reports an older maximum, or set it empty to auto-negotiate (see Troubleshooting) |

## Verify the Installation

Check that the agent is running:

```bash
podman ps --filter name=oneuptime-podman-agent
```

Check the agent logs:

```bash
podman logs -f oneuptime-podman-agent
```

Look for: `"Everything is ready. Begin running and processing data."`

Within a minute or so the host should appear in the OneUptime dashboard with metrics and logs flowing.

## Upgrading the Agent

```bash
podman pull oneuptime/podman-agent:release
podman rm -f oneuptime-podman-agent
# Re-run the `podman run` command above
```

Or with Podman Compose:

```bash
podman compose pull
podman compose up -d
```

## Uninstalling the Agent

```bash
podman rm -f oneuptime-podman-agent
# and the AI agent, if you started it
podman rm -f oneuptime-podman-ai-agent
```

If you used Podman Compose:

```bash
podman compose down
```

## What Gets Collected

| Category              | Data                                                           |
| --------------------- | -------------------------------------------------------------- |
| **CPU Metrics**       | Usage total, usage percentage, throttling time (per container) |
| **Memory Metrics**    | Usage, limit, percentage, RSS, cache (per container)           |
| **Network Metrics**   | Bytes and packets received / transmitted (per container)       |
| **Block I/O Metrics** | Read / write bytes and operations (per container)              |
| **Container Info**    | Uptime, restart count, process count                           |
| **Container Logs**    | stdout / stderr logs from all containers                       |

## Self-hosted OneUptime

If you are self-hosting OneUptime, set `ONEUPTIME_URL` to your own instance:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

If your instance is HTTP-only, use `http://` and the appropriate port.

## Troubleshooting

### Podman Socket Permission Denied

The agent container must run as root (`--user 0:0`) to access `/run/podman/podman.sock`. Ensure the `--user 0:0` flag (or `user: "0:0"` in Compose) is present.

### Podman Socket / Log Driver

The Podman API socket must be enabled and reachable at `/run/podman/podman.sock`. On rootful systemd hosts, enable it with `systemctl enable --now podman.socket`. Container logs are read from `/var/lib/containers`, so make sure that path is mounted into the agent and that Podman is using a file-based log driver (for example `--log-driver=k8s-file` or `json-file`). If you run Podman rootless, the socket lives under `/run/user/<uid>/podman/podman.sock` instead — mount that path and adjust the volume accordingly.

### Agent Restarts With "client version is too new"

```
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

A Docker-API server that enforces a maximum client version refuses a newer one
(Docker Engine reports it as above), so the receiver never starts and the collector
exits with it. Check the API version the Podman socket reports and pass it to the agent:

```bash
curl -s -o /dev/null -D - --unix-socket /run/podman/podman.sock http://localhost/_ping | grep -i '^api-version'
```

Then add `-e DOCKER_API_VERSION=1.41` (or the value you got) to `podman run`, or set
`DOCKER_API_VERSION` in Compose. Newer servers still serve older API versions, so the
setting stays valid after an upgrade.

If you would rather not look the number up, set `DOCKER_API_VERSION` to the **empty
string**. The agent then negotiates the version with the socket (one `HEAD /_ping`,
then the maximum the socket reports) instead of pinning one:

```bash
podman run -d ... -e DOCKER_API_VERSION= ...
```

### Agent Shows as Disconnected

1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`
2. Check the agent logs: `podman logs oneuptime-podman-agent | grep -i error`
3. Verify your OneUptime URL and service token are correct
4. Ensure your Podman host can reach the OneUptime instance over the network

### No Metrics Appearing

1. Verify the Podman socket is accessible inside the agent: `podman exec oneuptime-podman-agent ls -la /run/podman/podman.sock`
2. Check the collector logs for export errors: `podman logs oneuptime-podman-agent | tail -100`
3. Ensure your service token is valid and not expired

### Host Name Shows as a Container ID

Set the `PODMAN_HOST_NAME` environment variable to a friendly name and recreate the container.

## AI agent

The Podman agent's `install.sh` and the `docker-compose.yml` in its [PodmanAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/PodmanAgent) also run the **Podman AI agent**: a second container, `oneuptime-podman-ai-agent` (image `oneuptime/resource-ai-agent:release`), that runs the read-only commands OneUptime AI asks for while it investigates an incident or alert on this host — through Podman's Docker-compatible API, with the `docker` CLI: `docker ps -a`, `docker logs --tail 200 web`, `docker container inspect web` — and, only if you allow it, applies fixes such as restarting a named container. It reads the same `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` and `PODMAN_HOST_NAME` as the collector, so it serves exactly this host, and it shows up on the host's **AI → AI agent** page in OneUptime.

The `podman run` command and the Podman Compose file above start the collector only. To add the AI agent, start it beside the collector with the same values (it needs the same socket: `sudo systemctl enable --now podman.socket`) — with Podman Compose, add the `oneuptime-podman-ai-agent` service from that `docker-compose.yml` to yours instead:

```bash
podman run -d \
  --name oneuptime-podman-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman \
  -e PODMAN_HOST_NAME="my-podman-host" \
  oneuptime/resource-ai-agent:release
```

- It is **read-only** unless you start it with `ONEUPTIME_AI_ALLOW_WRITES=true`; `ONEUPTIME_AI_WRITE_TARGETS` (for example `web-*,api-*`) limits which containers a fix may touch. Then choose on the AI agent page whether each fix needs a person's approval.
- It runs as root with the Podman socket mounted, because the socket is root-owned — and for rootful Podman whoever can use the socket is root on this host, `:ro` or not. The agent's command policy is the limit: it never runs `exec`, `run`, `rm` or `prune`, and it never changes itself, the collector or anything in `ONEUPTIME_AI_PROTECTED_TARGETS` (container name globs).
- `install.sh --no-ai-agent` leaves it out; `podman rm -f oneuptime-podman-ai-agent` removes it. Upgrade it like the collector: `podman pull oneuptime/resource-ai-agent:release`, remove it, and start it again.

What it may run, how fixes work and how to troubleshoot it: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).

## Next steps

- Configure **Podman Monitors** to alert on container CPU / memory / restart conditions — see [Podman Monitor](/docs/monitor/podman-monitor).
- Database containers on the host (PostgreSQL, MySQL, Redis, MongoDB and many more engines, recognised by image) are detected automatically and get their own pages — see [Databases](/docs/telemetry/databases).
- For Kubernetes clusters instead of standalone Podman hosts, use the [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- For non-containerized hosts (Linux / macOS / Windows VMs and bare metal), use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
