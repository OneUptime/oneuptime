# OneUptime Docker Agent

## Overview

The OneUptime Docker Agent is a pre-built container image that ships with a tuned OpenTelemetry Collector configuration. Run it next to your existing containers and it auto-discovers every container on the host, collects CPU / memory / network / block I/O metrics plus container logs, and forwards everything to OneUptime over OTLP. Single image, single command — plus, if you want OneUptime AI to look into this host, the [AI agent](#ai-agent) as a second container beside it.

This page is the **installation guide**. For configuring Docker monitors and alerts on top of the data the agent collects, see [Docker Monitor](/docs/monitor/docker-monitor).

## Prerequisites

- Docker Engine 20.10+
- Access to `/var/run/docker.sock` on the host
- A **OneUptime Telemetry Ingestion Token** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the value

## Quick Start (One Command)

Replace `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN`, and the host name with values for your environment. The host name is how this Docker host will appear in OneUptime — pick something like `prod-docker-01`.

```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

That is it. Once the agent connects, your Docker host will appear automatically in the **Docker** section of the OneUptime dashboard.

## Alternative — Docker Compose

If you prefer Docker Compose, drop the following into a `docker-compose.yml`:

```yaml
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Start it:

```bash
docker compose up -d
```

## Environment Variables

| Variable                  | Required | Description                                                                                                                                                     |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | Yes      | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host)                                                                      |
| `ONEUPTIME_SERVICE_TOKEN` | Yes      | Telemetry ingestion token from _Project Settings → Telemetry & APM → Ingestion Keys_                                                                            |
| `DOCKER_HOST_NAME`        | No       | Friendly name for this host. Defaults to `docker-host`. Set it to something stable per host (e.g. `prod-docker-01`)                                             |
| `DOCKER_API_VERSION`      | No       | Docker Engine API version the agent speaks. Defaults to `1.44`; lower it on hosts with an older daemon, or set it empty to auto-negotiate (see Troubleshooting) |

## Verify the Installation

Check that the agent is running:

```bash
docker ps --filter name=oneuptime-docker-agent
```

Check the agent logs:

```bash
docker logs -f oneuptime-docker-agent
```

Look for: `"Everything is ready. Begin running and processing data."`

Within a minute or so the host should appear in the OneUptime dashboard with metrics and logs flowing.

## Upgrading the Agent

When the agent is older than your OneUptime, a warning sign appears beside **Agent Version** on the Docker host's **Overview**. Select it to see these commands.

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Re-run the `docker run` command above
```

Or with Docker Compose:

```bash
docker compose pull
docker compose up -d
```

## Uninstalling the Agent

```bash
docker rm -f oneuptime-docker-agent
# and the AI agent, if you started it
docker rm -f oneuptime-docker-ai-agent
```

If you used Docker Compose:

```bash
docker compose down
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

### Docker Socket Permission Denied

The agent container must run as root (`--user 0:0`) to access `/var/run/docker.sock`. Ensure the `--user 0:0` flag (or `user: "0:0"` in Compose) is present.

### Agent Restarts With "client version is too new"

```
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

A daemon refuses a client newer than its own maximum, so the receiver never starts
and the collector exits with it. Check the daemon's maximum and pass it to the agent:

```bash
docker version --format '{{ .Server.APIVersion }}'
```

Then add `-e DOCKER_API_VERSION=1.41` (or the value you got) to `docker run`, or set
`DOCKER_API_VERSION` in Compose. Newer daemons still serve older API versions, so the
setting stays valid after an upgrade.

If you would rather not look the number up, set `DOCKER_API_VERSION` to the **empty
string**. The agent then asks the Docker SDK to negotiate the version with the daemon
(one `HEAD /_ping`, then the daemon's own maximum), which works against both old and
new daemons:

```bash
docker run -d ... -e DOCKER_API_VERSION= ...
```

### Agent Shows as Disconnected

1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`
2. Check the agent logs: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`
3. Verify your OneUptime URL and service token are correct
4. Ensure your Docker host can reach the OneUptime instance over the network

### No Metrics Appearing

1. Verify the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts: `docker run --rm --volumes-from oneuptime-docker-agent alpine:3.19 ls -la /var/run/docker.sock`
2. Check the collector logs for export errors: `docker logs oneuptime-docker-agent 2>&1 | tail -100`
3. Ensure your service token is valid and not expired

### Host Name Shows as a Container ID

Set the `DOCKER_HOST_NAME` environment variable to a friendly name and recreate the container.

## AI agent

The Docker agent's `install.sh` and the `docker-compose.yml` in its [DockerAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/DockerAgent) also run the **Docker AI agent**: a second container, `oneuptime-docker-ai-agent` (image `oneuptime/resource-ai-agent:release`), that runs the read-only `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host — `docker ps -a`, `docker logs --tail 200 web`, `docker container inspect web`, `docker stats --no-stream` — and, only if you allow it, applies fixes such as restarting a named container. It reads the same `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` and `DOCKER_HOST_NAME` as the collector, so it serves exactly this host, and it shows up on the host's **AI → AI agent** page in OneUptime.

The `docker run` command and the Docker Compose file above start the collector only. To add the AI agent, start it beside the collector with the same values — with Docker Compose, add the `oneuptime-docker-ai-agent` service from that `docker-compose.yml` to yours instead:

```bash
docker run -d \
  --name oneuptime-docker-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/resource-ai-agent:release
```

- It is **read-only** unless you start it with `ONEUPTIME_AI_ALLOW_WRITES=true`; `ONEUPTIME_AI_WRITE_TARGETS` (for example `web-*,api-*`) limits which containers a fix may touch. Start it with `ONEUPTIME_AI_FIXES` too, to say how fixes run — `ask-for-approval` (a person approves each one), `automatic` or `bypass-approval` — and the AI agent page shows it read-only ([What AI may do, set by the agent](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)).
- It runs as root with the Docker socket mounted, because the socket is root-owned — and whoever can use the socket is root on this host, `:ro` or not. The agent's command policy is the limit: it never runs `exec`, `run`, `rm` or `prune`, and it never changes itself, the collector or anything in `ONEUPTIME_AI_PROTECTED_TARGETS` (container name globs).
- `install.sh --no-ai-agent` leaves it out; `docker rm -f oneuptime-docker-ai-agent` removes it. Upgrade it like the collector: `docker pull oneuptime/resource-ai-agent:release`, remove it, and start it again.

What it may run, how fixes work and how to troubleshoot it: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).

## Next steps

- Configure **Docker Monitors** to alert on container CPU / memory / restart conditions — see [Docker Monitor](/docs/monitor/docker-monitor).
- Database containers on the host (PostgreSQL, MySQL, Redis, MongoDB and many more engines, recognised by image) are detected automatically and get their own pages — see [Databases](/docs/telemetry/databases).
- For Kubernetes clusters instead of standalone Docker hosts, use the [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- For non-containerized hosts (Linux / macOS / Windows VMs and bare metal), use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
