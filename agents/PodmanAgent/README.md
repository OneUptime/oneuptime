# OneUptime Podman Agent

Monitor Podman hosts, containers, and container logs with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is published as a container image — `oneuptime/podman-agent` — that bundles a tuned collector config. Just pass a few environment variables and run it.

## Prerequisites

- Podman 4.0+
- The Podman Docker-API compatible socket enabled: at `/run/podman/podman.sock` for rootful Podman (`sudo systemctl enable --now podman.socket`), or `$XDG_RUNTIME_DIR/podman/podman.sock` for rootless Podman (`systemctl --user enable --now podman.socket`). The `docker_stats` metrics receiver speaks the Docker API against this socket. `install.sh` mounts the socket and container storage of the Podman it runs as: run it with `sudo` for rootful Podman, or as the user whose rootless containers you want to watch (it then mounts that user's socket and `~/.local/share/containers/storage`). It stops with the command to run if the socket is not on.
- Containers you want to collect logs from must use a file-based log driver — **`k8s-file`** (or `json-file`). Podman's default driver is **`journald`**, which the agent's filelog receiver cannot read. The agent tails `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` (the k8s-file driver's location) via the OpenTelemetry filelog receiver. See [Log Driver Requirement](#log-driver-requirement) below.

## Quick Start — `podman run`

```bash
podman run -d \
  --name oneuptime-podman-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  -v /var/lib/containers/storage:/var/lib/containers/storage:ro \
  -e ONEUPTIME_URL="https://oneuptime.com" \
  -e ONEUPTIME_SERVICE_TOKEN="your-service-token" \
  -e PODMAN_HOST_NAME="my-podman-host" \
  oneuptime/podman-agent:release
```

That's it. The host will appear automatically in the Podman section of OneUptime.

These are rootful Podman's paths. For **rootless** Podman, mount that user's socket and
storage at the same paths inside the container instead:
`-v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock:ro"` and
`-v "$HOME/.local/share/containers/storage:/var/lib/containers/storage:ro"` (`podman info
--format '{{.Host.RemoteSocket.Path}}'` and `--format '{{.Store.GraphRoot}}'` print them).
`install.sh`, run as that user, does this for you.

## Quick Start — Install Script

```bash
curl -fsSL https://oneuptime.com/install/podman-agent -o install.sh
sudo bash install.sh    # rootful Podman; run it without sudo, as that user, for rootless Podman
```

The script asks for your OneUptime URL, the service token and a name for the host, then starts the agent and the [AI agent](#ai-agent) (`--no-ai-agent` leaves it out). Every OneUptime serves this script and the agent's `docker-compose.yml` for its own release, at `<your OneUptime URL>/install/podman-agent`: on a self-hosted OneUptime, use its URL in place of `https://oneuptime.com`. The first line saves the script as `install.sh`, so you can read it before you run it.

## Quick Start — Compose

Download `docker-compose.yml` from your OneUptime into a new folder:

```bash
mkdir oneuptime-podman-agent && cd oneuptime-podman-agent
curl -fsSLO https://oneuptime.com/install/podman-agent/docker-compose.yml
```

Create a `.env` file next to it:

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_SERVICE_TOKEN=your-service-token
PODMAN_HOST_NAME=my-podman-host
```

Then start the agent:

```bash
podman compose up -d
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_SERVICE_TOKEN` | Yes | Telemetry ingestion service token (Settings → API Keys) |
| `PODMAN_HOST_NAME` | No | Friendly name for this host (default: `podman-host`) |
| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the socket. Empty by default: the agent negotiates it with the socket. Set it only to pin one |

## Image Tags

| Tag | Description |
|-----|-------------|
| `oneuptime/podman-agent:release` | Latest stable release (community) |
| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |
| `oneuptime/podman-agent:<version>` | Pinned version, e.g. `10.0.31` |
| `ghcr.io/oneuptime/podman-agent:release` | Same image mirrored on GHCR |

## Collected Metrics

These metrics come from the `docker_stats` receiver, which works against Podman's Docker-API compatible socket, so the metric names are identical to the Docker agent.

- **CPU**: `container.cpu.usage.total`, `container.cpu.utilization`, `container.cpu.throttling_data.throttled_time`
- **Memory**: `container.memory.usage.total`, `container.memory.usage.limit`, `container.memory.percent`
- **Network**: `container.network.io.usage.rx_bytes`, `container.network.io.usage.tx_bytes`
- **Block I/O**: `container.blockio.io_service_bytes_recursive.read`, `container.blockio.io_service_bytes_recursive.write`
- **Container Info**: `container.uptime`, `container.restarts`, `container.pids.count`

`container.cpu.utilization` is the CPU a container used over each 30-second collection interval, as a percent of one core: 100% is one full core, so a container busy on two cores reads 200%, as `podman stats` counts it. The agent works it out from `container.cpu.usage.total` (see `otel-collector-config.yaml`), so the two always agree. A container has no CPU percent at its first reading after the agent or the container starts. The `docker_stats` receiver's own CPU percent is turned off: Podman's Docker-compatible API sends no previous reading with a stats sample, so that figure is a flat line that does not follow the load.

`container.memory.percent` is the memory in use as a percent of the container's memory limit, or of the host's memory when it has none, sent with the unit `%`.

## Collected Logs

Container logs are automatically collected from `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` (the k8s-file log driver's location) and enriched with container metadata (container id, image, runtime, host name) plus a derived severity. The severity is read from a level keyword in the line itself (`app.INFO:`, `{"level":"warn"}`, `[ERROR]`, `level=error`); only lines with no recognisable level fall back to the stream, where stderr becomes `ERROR` and stdout becomes `INFO`. The keyword is only believed where a level actually sits — in the line's leading preamble, or as the value of a level field (`level`, `lvl`, `severity`, `levelname`, `log.level`) anywhere in the line — so an ordinary message that merely mentions "error" or "panic" in passing is not classified by it and keeps the stream default. Logs are shipped in the native OpenTelemetry log record format, so `severityText`, `severityNumber`, `body`, `attributes`, `traceId`, and `spanId` are all populated.

### Log Driver Requirement

Podman's **default** log driver is **`journald`** (rootful) — and `journald`/`k8s-file` depending on configuration for rootless. The agent's filelog receiver reads CRI-formatted line files written by the **`k8s-file`** driver and **cannot** read `journald` (systemd binary journal) or any remote driver (`syslog`, etc.).

To have container logs ingested you must run your target containers with the **`k8s-file`** log driver (or **`json-file`**, which Podman aliases to the same file-based behavior). With `k8s-file`, Podman writes each container's logs to `ctr.log` in CRI format (`<time> <stream> <P|F> <msg>`), which the agent parses.

**To check a container's current log driver:**

```bash
podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**To check the default log driver:**

```bash
podman info --format '{{.Host.LogDriver}}'
```

**To run a single container with `k8s-file`:**

```bash
podman run --log-driver k8s-file --log-opt max-size=100m ... <image>
```

**To switch a Compose service to a file-based driver with sensible rotation**, add a `logging` block to each service:

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "k8s-file"
      options:
        max-size: "100m"
```

**To switch the default driver** (affects all containers created afterwards), edit `containers.conf` (`/etc/containers/containers.conf` rootful, or `~/.config/containers/containers.conf` rootless):

```toml
[containers]
log_driver = "k8s-file"
log_size_max = 104857600
```

Then recreate (not just restart) the affected containers — the log driver is baked in at container create time, so an existing container will keep its old driver until it is removed and recreated.

> **Note:** If you must keep `journald`, the agent can still collect **metrics** (they go through the Docker-API socket); only the container **logs** pipeline depends on the file-based driver. Alternatively, point the filelog receiver at your journald export if you forward it to a file.

## AI agent

`install.sh` and `docker-compose.yml` also run the **OneUptime AI agent** for this host: a second container, `oneuptime-podman-ai-agent` (image `oneuptime/resource-ai-agent`), that runs the `docker` commands OneUptime AI asks for, through Podman's Docker-compatible socket, while it investigates an incident or alert here. It shares the collector's settings (`ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN`, `PODMAN_HOST_NAME`), so it serves exactly the host the collector reports, and it appears on the host's **AI → AI agent** page in OneUptime.

- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream`, never `exec`, `run`, `rm`, `prune` or docker's global flags (`-H`, `--context`). Environment values in `docker inspect` output are masked before anything leaves the host.
- **Fixes are opt-in.** Set `ONEUPTIME_AI_ALLOW_WRITES=true` (in `.env`, or re-run `install.sh` with it) to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's AI agent page in OneUptime shows it, read-only. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.
- It needs the same socket as the collector (`sudo systemctl enable --now podman.socket`) and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only; the agent's command policy is the limit.
- To leave it out: `install.sh --no-ai-agent` (or `ONEUPTIME_INSTALL_AI_AGENT=false`), or delete the `oneuptime-podman-ai-agent` service from `docker-compose.yml`. To remove it later: `podman rm -f oneuptime-podman-ai-agent`.

Without the installer:

```bash
podman run -d \
  --name oneuptime-podman-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  -e ONEUPTIME_URL="https://oneuptime.com" \
  -e ONEUPTIME_SERVICE_TOKEN="your-service-token" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman \
  -e PODMAN_HOST_NAME="my-podman-host" \
  oneuptime/resource-ai-agent:release
```

Logs: `podman logs -f oneuptime-podman-ai-agent`. Every setting is described in the [resource AI agent README](../ResourceAIAgent/README.md).

## Upgrading

```bash
podman pull oneuptime/podman-agent:release
podman rm -f oneuptime-podman-agent
# Re-run the `podman run` command above
```

Or with Compose:

```bash
podman compose pull
podman compose up -d
```

## Uninstalling

```bash
podman rm -f oneuptime-podman-agent
```

## Building the Image Locally

If you want to build the image yourself (for development or air-gapped environments), from the repo root:

```bash
npm run prerun  # generates Dockerfile from Dockerfile.tpl
podman build -f ./agents/PodmanAgent/Dockerfile -t oneuptime/podman-agent:local .
```

## Troubleshooting

### Podman Socket Permission Denied

The agent must run as root (`--user 0:0`) to access `/run/podman/podman.sock`. Ensure the `--user 0:0` flag (or `user: "0:0"` in Compose) is present, and that the Podman socket is enabled (`sudo systemctl enable --now podman.socket`). For rootless Podman, the socket is the user's own (`systemctl --user enable --now podman.socket`), mounted at `/run/podman/podman.sock` as [above](#quick-start--podman-run); root in the container is that user on the host.

### Container Exits With "client version is too new"

```
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

A Docker-API server that enforces a maximum client version refuses a newer one —
Docker Engine reports it as above — so the receiver fails to start, the collector exits
with it, and the container restart-loops. The image's `DOCKER_API_VERSION` is
**empty**, and empty negotiates the version with the socket (one `HEAD /_ping`, then
the maximum the socket reports). So this means a version is pinned: by
`-e DOCKER_API_VERSION=...` (or the Compose `environment:` list), or by an older image,
which pinned `1.44`. Pull the latest image and start the agent again without the
variable:

```bash
podman pull oneuptime/podman-agent:release
podman rm -f oneuptime-podman-agent
# Re-run the `podman run` command above, without -e DOCKER_API_VERSION
```

To pin a version anyway, use no more than the version the socket reports:

```bash
curl -s -o /dev/null -D - --unix-socket /run/podman/podman.sock http://localhost/_ping | grep -i '^api-version'
podman run -d ... -e DOCKER_API_VERSION=1.41 ...   # or set it in Compose
```

`install.sh` passes `DOCKER_API_VERSION` on to the agent when you run it with one set.
Newer servers still serve older API versions, so a pinned value keeps working after an
upgrade.

### No Container Logs in the Dashboard

If metrics show up but the **Logs** tab is empty (or only shows logs from the agent itself), the most common cause is that your containers are not using a file-based log driver (`k8s-file`/`json-file`) — Podman defaults to `journald`, which the agent cannot read.

**Diagnose:**

```bash
# 1. Check the agent's filelog receiver — this should list each container log it is watching
podman logs oneuptime-podman-agent 2>&1 | grep -E "Started watching file|no files match"

# 2. Check which log driver your containers are actually using
podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'

# 3. Check whether the log file the receiver expects actually exists
podman run --rm --volumes-from oneuptime-podman-agent alpine:3.19 \
  sh -c 'ls /var/lib/containers/storage/overlay-containers/*/userdata/ctr.log 2>&1 | head'
```

If step 1 shows `no files match the configured criteria`, or step 3 returns no files for the containers you care about, those containers are not using `k8s-file`/`json-file`. See [Log Driver Requirement](#log-driver-requirement) for how to switch.

After changing the log driver, you must **recreate** (not just restart) each container, because Podman binds the log driver to the container at create time:

```bash
# For podman compose
podman compose up -d --force-recreate <service>

# For plain podman
podman rm -f <container>
podman run --log-driver k8s-file ... <image>
```

### Logs Are Ingested but Don't Appear on a Specific Podman Host Page

The Podman host page filters by `resource.host.name` equal to the host's `hostIdentifier`. This value is taken from the `PODMAN_HOST_NAME` environment variable passed to the agent. If you change `PODMAN_HOST_NAME` after the host is auto-registered, OneUptime will create a second host row with the new name and logs will appear under that one.

```bash
# Confirm the agent is stamping the expected host name
podman inspect oneuptime-podman-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PODMAN_HOST_NAME
```

### Common Commands

```bash
# Check agent status
podman ps --filter name=oneuptime-podman-agent

# View agent logs
podman logs -f oneuptime-podman-agent

# Verify Podman socket access — the agent image has no shell, so look from a
# throwaway container that shares its mounts
podman run --rm --volumes-from oneuptime-podman-agent alpine:3.19 ls -la /run/podman/podman.sock
```
