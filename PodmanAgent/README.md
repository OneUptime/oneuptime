# OneUptime Podman Agent

Monitor Podman hosts, containers, and container logs with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is published as a container image — `oneuptime/podman-agent` — that bundles a tuned collector config. Just pass a few environment variables and run it.

## Prerequisites

- Podman 4.0+
- The Podman Docker-API compatible socket enabled at `/run/podman/podman.sock`. Enable it with `sudo systemctl enable --now podman.socket` (rootful) or `systemctl --user enable --now podman.socket` (rootless). The `docker_stats` metrics receiver and the inventory poller both speak the Docker API against this socket.
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

## Quick Start — Compose

Create a `.env` file:

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

## Image Tags

| Tag | Description |
|-----|-------------|
| `oneuptime/podman-agent:release` | Latest stable release (community) |
| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |
| `oneuptime/podman-agent:<version>` | Pinned version, e.g. `10.0.31` |
| `ghcr.io/oneuptime/podman-agent:release` | Same image mirrored on GHCR |

## Collected Metrics

These metrics come from the `docker_stats` receiver, which works against Podman's Docker-API compatible socket, so the metric names are identical to the Docker agent.

- **CPU**: `container.cpu.usage.total`, `container.cpu.percent`, `container.cpu.throttling_data.throttled_time`
- **Memory**: `container.memory.usage.total`, `container.memory.usage.limit`, `container.memory.percent`
- **Network**: `container.network.io.usage.rx_bytes`, `container.network.io.usage.tx_bytes`
- **Block I/O**: `container.blockio.io_service_bytes_recursive.read`, `container.blockio.io_service_bytes_recursive.write`
- **Container Info**: `container.uptime`, `container.restarts`, `container.pids.count`

## Collected Logs

Container logs are automatically collected from `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` (the k8s-file log driver's location) and enriched with container metadata (container id, image, runtime, host name) plus a derived severity — lines written to stderr become `ERROR` and lines written to stdout become `INFO`. Logs are shipped in the native OpenTelemetry log record format, so `severityText`, `severityNumber`, `body`, `attributes`, `traceId`, and `spanId` are all populated.

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

> **Note:** If you must keep `journald`, the agent can still collect **metrics** and **inventory** (both go through the Docker-API socket); only the container **logs** pipeline depends on the file-based driver. Alternatively, point the filelog receiver at your journald export if you forward it to a file.

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
podman build -f ./PodmanAgent/Dockerfile -t oneuptime/podman-agent:local .
```

## Troubleshooting

### Podman Socket Permission Denied

The agent must run as root (`--user 0:0`) to access `/run/podman/podman.sock`. Ensure the `--user 0:0` flag (or `user: "0:0"` in Compose) is present, and that the Podman socket is enabled (`systemctl enable --now podman.socket`).

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

# Verify Podman socket access
podman exec oneuptime-podman-agent ls -la /run/podman/podman.sock
```
