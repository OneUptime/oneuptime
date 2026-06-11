# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Overview

You can run the **OpenTelemetry Collector** as a service directly on your Linux, macOS, or Windows hosts to ship host telemetry to OneUptime over OTLP. This page walks through installing the collector, configuring it for each OS, and choosing the right receivers for what you want to collect:

- **Host metrics** (CPU, memory, disk, filesystem, network, load, processes) on every OS
- **File-based logs** under `/var/log/**` (Linux, macOS) via the [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) via the [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via the [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) wrapping a tailed `log stream` output
- **Windows Event Logs** via the [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Windows service status** (powers the host **Services** tab) via the [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver)

> **What about the OneUptime Infrastructure Agent?** That agent is a separate, lightweight Go daemon focused on basic metrics and the *Server / VM Monitor* feature (status, processes, alerting). The OpenTelemetry Collector described here is independent and is the right tool when you want logs (file logs, journald, Windows Event Logs) or richer host metrics ingested as standard OTLP. Both can run on the same host without interfering.

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create one from *Project Settings → Telemetry Ingestion Keys* and copy the `x-oneuptime-token` value.
- The **OpenTelemetry Collector Contrib** distribution (`otelcol-contrib`). The default `otelcol` build does **not** include receivers like `windowseventlogreceiver`, `journaldreceiver`, or `hostmetrics` extras — make sure to use the `contrib` distribution.
- Root / Administrator on the host to install the collector as a service and (where applicable) read privileged log sources.

## Step 1 — Install the OpenTelemetry Collector

Pick the section for your OS. All examples assume you are installing the latest `otelcol-contrib` release from [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.107.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

The Debian package installs the binary at `/usr/bin/otelcol-contrib`, the default config at `/etc/otelcol-contrib/config.yaml`, and a systemd unit at `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.107.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Paths match the Debian package (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd unit `otelcol-contrib`).

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.107.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

You will create `/etc/otelcol-contrib/config.yaml` in Step 2 and a `launchd` plist in Step 3.

### Windows

Download the latest `otelcol-contrib_*_windows_amd64.zip` (or `arm64`) from the [releases page](https://github.com/open-telemetry/opentelemetry-collector-releases/releases). From an **elevated** PowerShell prompt:

```powershell
$dest = "C:\Program Files\otelcol-contrib"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path "$env:USERPROFILE\Downloads\otelcol-contrib_*_windows_amd64.zip" -DestinationPath $dest
```

You will create `C:\Program Files\otelcol-contrib\config.yaml` in Step 2 and register a Windows service in Step 3.

## Step 2 — Configure the collector

The configuration file lives at:

| OS | Path |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

Every config follows the same shape — pick the receivers you want, add a `batch` and `resource` processor, and export to OneUptime over OTLP HTTP. The examples below show a complete, copy-pasteable config per OS, then walk through each receiver block so you can mix-and-match.

Replace `YOUR_TELEMETRY_INGESTION_TOKEN` and the `service.name` value to suit your environment.

### Common pieces (used by every OS)

```yaml
processors:
  batch:
    send_batch_size: 512
    timeout: 5s

  resource:
    attributes:
      - key: service.name
        value: host-telemetry
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

- **`batch`** groups records before export so you do not pay one HTTP round trip per record.
- **`resource`** stamps every record with `service.name`. Use a different value per host (e.g. `prod-web-01`) if you want each machine to appear as its own telemetry service in OneUptime.
- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached.

### Host metrics (Linux, macOS, Windows)

Works on every OS. Picks up CPU, memory, disk, filesystem, network, load, paging, and process metrics from the host kernel:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:
      process:
        mute_process_name_error: true
```

> On Linux, the collector reads `/proc` and `/sys`. When the collector runs in a container, mount the host's `/proc` and `/sys` and set the `HOST_PROC` / `HOST_SYS` environment variables. When it runs directly as a systemd service (as installed above), no extra setup is needed.

### File logs (Linux, macOS)

Tail any log file on disk. Below is a common starter set:

```yaml
receivers:
  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
    start_at: end

  filelog/auth:
    include:
      - /var/log/auth.log
      - /var/log/secure
    start_at: end
```

`start_at: end` means new lines from the moment the collector starts; change to `beginning` to backfill on first run. The collector tracks file offsets, so it resumes correctly across restarts.

**Turning host log stack traces into Exceptions.** OneUptime automatically scans error and fatal log lines for stack traces and rolls them up into the **Exceptions** (Issues) view, attributed to this host — no extra configuration needed. For this to group well, a multi-line stack trace (Java, Python, .NET, Ruby) must arrive as **one** log record, not one record per line. Enable multiline recombination on the `filelog` receiver so a trace and its frames stay together:

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    multiline:
      # A new log entry starts with a timestamp; continuation lines (the
      # "at ...", "File ...", "Caused by: ..." frames) are folded into it.
      line_start_pattern: '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}'
```

Without recombination, each frame is ingested as a separate log and the exception will appear as a one-line, poorly-grouped issue. If your application can emit the OpenTelemetry `exception.type` / `exception.message` / `exception.stacktrace` log attributes directly, do that instead — it is the most reliable path and is independent of multiline parsing.

### systemd journal (Linux)

If your host uses systemd, the `journald` receiver is often a better fit than tailing `/var/log/*` — it captures everything in one place and preserves structured fields:

```yaml
receivers:
  journald:
    directory: /var/log/journal
    units:
      # Drop this list to ingest everything; restrict it to limit volume.
      - ssh.service
      - cron.service
      - nginx.service
    priority: info
```

The collector binary must be able to execute `journalctl` (the Debian / RPM packages already include it as a dependency).

### Apple Unified Log (macOS)

macOS deprecated `/var/log/system.log` in favor of the Apple Unified Log, which is queried with `log show` / `log stream`. The simplest way to ingest it is to stream `log` output via the `filelog` receiver with a small wrapper. Create `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Make it executable, run it under launchd (or `nohup` for a quick test), then point the collector at the file:

```yaml
receivers:
  filelog/apple-unified:
    include:
      - /var/log/apple-unified.log
    start_at: end
    operators:
      - type: json_parser
        timestamp:
          parse_from: attributes.timestamp
          layout: '%Y-%m-%d %H:%M:%S.%f%j'
```

(If you do not need the unified log, skip this — Mac fleets often run fine with just host metrics + a few file logs.)

### Windows Event Logs

Subscribe to the channels you care about via the native `wevtapi`:

```yaml
receivers:
  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end
```

To narrow the high-volume `Security` channel to specific event IDs:

```yaml
  windowseventlog/security:
    channel: Security
    start_at: end
    query: "*[System[(EventID=4625 or EventID=4740)]]"
```

To read a custom or application-specific channel (anything you can see under *Event Viewer → Applications and Services Logs*), use its exact display name:

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Windows Services (metrics)

Report the running state and startup type of Windows services via the [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver). This is what populates the **Services** tab on the host in OneUptime. It is a *metrics* receiver, so it belongs in the metrics pipeline (not logs):

```yaml
receivers:
  windows_service:
    collection_interval: 30s
    # Collect every service by default. To cut volume — and avoid the
    # "access denied" noise from services the collector can't open —
    # list just the ones you care about:
    # include_services: [Spooler, W3SVC, MSSQLSERVER]
    # Or collect everything except a few:
    # exclude_services: [TrustedInstaller]
```

The receiver emits one `windows.service.status` gauge per service — the integer is the Win32 service state (`4` = running, `1` = stopped) — with `name` and `startup_mode` attributes. It is **Windows-only** (the collector fails to start if you enable it on Linux or macOS) and is currently **alpha**, so pin a recent `otelcol-contrib` release. Running the service as `LocalSystem` (the default with `sc.exe create`) lets it read every service.

### Complete example — Linux host

`/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
      - /var/log/auth.log
    start_at: end

  journald:
    directory: /var/log/journal
    priority: info

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: linux-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/syslog, journald]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### Complete example — macOS host

`/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/system:
    include:
      - /var/log/install.log
      - /var/log/wifi.log
    start_at: end

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: macos-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/system]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### Complete example — Windows host

`C:\Program Files\otelcol-contrib\config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      # 'load' is not supported on Windows — omit it or the scraper errors.
      paging:
      processes:

  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end

  windows_service:
    collection_interval: 30s

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: windows-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers:
        - windowseventlog/system
        - windowseventlog/application
        - windowseventlog/security
      processors: [resource, batch]
      exporters: [otlphttp]
```

## Step 3 — Run the collector as a service

### Linux (systemd)

The Debian / RPM packages already install a systemd unit. Just enable and start it:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

To follow the collector's own logs:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.oneuptime.otelcol-contrib</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/otelcol-contrib</string>
    <string>--config=/etc/otelcol-contrib/config.yaml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/otelcol-contrib.out.log</string>
  <key>StandardErrorPath</key><string>/var/log/otelcol-contrib.err.log</string>
</dict>
</plist>
```

Load it:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

From an **elevated** PowerShell prompt:

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

The service runs under `LocalSystem` by default, which has the privileges needed to read the `Security` Windows Event Log channel.

### Docker / Docker Compose

If you prefer to run the collector as a container rather than installing it as a system service, use the official `otel/opentelemetry-collector-contrib` image. The container needs access to host namespaces so it can read `/proc`, `/sys`, and log files.

Create `docker-compose.yml` alongside a `config.yaml` (see Step 2 for the config content):

```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.107.0
    command: ["--config=/etc/otelcol-contrib/config.yaml"]
    volumes:
      - ./config.yaml:/etc/otelcol-contrib/config.yaml:ro
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /var/log:/var/log:ro
    environment:
      - HOST_PROC=/host/proc
      - HOST_SYS=/host/sys
    restart: unless-stopped
    # host network gives accurate network interface metrics; remove if not needed
    network_mode: host
```

Start it:

```bash
docker compose up -d
docker compose logs -f otel-collector
```

**Key points for the containerized collector:**

- `HOST_PROC` and `HOST_SYS` tell the `hostmetrics` receiver where to find the host's `/proc` and `/sys` trees instead of the container's own view.
- Mount `/var/log` read-only so `filelog` receivers can tail host log files.
- `mute_process_name_error: true` and `mute_process_user_error: true` are strongly recommended on the `process` scraper (see [Host metrics](#host-metrics-linux-macos-windows)) — inside a container `/etc/passwd` is the container's user database, not the host's, so user lookups for host processes fail unless you suppress these errors.
- The `journald` receiver requires `journalctl` in the image and the journal directory mounted; the contrib image includes `journalctl`, so mount `/var/log/journal:/var/log/journal:ro` and the host's `/run/log/journal:/run/log/journal:ro` if you need journal support.
- Remove `network_mode: host` if you only need metrics and logs (not accurate per-interface network metrics) or if your security policy forbids host networking.

## Step 4 — Verify in OneUptime

1. Generate some signal on the host:
   - **Linux / macOS:** `logger "hello from oneuptime"` (writes to syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` from an elevated prompt.
2. In the OneUptime dashboard, open **Telemetry → Services** and pick the `service.name` you configured.
3. Open **Metrics** — host metrics (CPU, memory, filesystem, etc.) should appear within a minute.
4. Open **Logs** — your file logs / journald entries / Windows Event Logs should be streaming in. Useful searchable attributes include `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id`, and `winlog.provider.name`.

## Self-hosted OneUptime

If you are self-hosting OneUptime, point the exporter at your own host:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

If your instance is HTTP-only, change the scheme to `http://` and use the appropriate port.

## Behind a proxy

The OpenTelemetry Collector respects the standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` environment variables. Set them on the service:

- **systemd (Linux):** drop in `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` with `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`, then `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** add an `<EnvironmentVariables>` dict to the plist.
- **Windows service:** set environment variables on the service via `sc.exe config` or the registry under `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Troubleshooting

- **No telemetry appears in OneUptime**
  - Add `service.telemetry.logs.level: debug` to the config and restart the collector for verbose output.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) or `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** look under *Event Viewer → Windows Logs → Application* for source `otelcol-contrib`.
  - Confirm the host can reach `https://oneuptime.com/otlp` (or your self-hosted endpoint): `curl -v https://oneuptime.com/otlp` from the same machine.
- **HTTP 401 from the exporter** — the ingestion token is invalid or revoked. Generate a new one from *Project Settings → Telemetry Ingestion Keys*.
- **`Security` Windows Event Log returns access denied** — the service is not running with sufficient privileges. Recreate it under `LocalSystem` (the default with `sc.exe create`) or grant the service account the *Manage auditing and security log* user right.
- **`journald` receiver fails to start** — make sure `journalctl` is on the collector's `PATH` and that `/var/log/journal` exists (run `sudo systemd-tmpfiles --create --prefix /var/log/journal` if not).
- **High volume / cost** — narrow the receivers (specific Windows channels, specific systemd units, specific log files), add a `query:` filter on the Windows Event Log receiver, or add a `filter` processor to drop low-severity events before export.

## Next steps

- Add **Logs Monitors** to alert on specific log patterns (for example, alert when more than 5 `winlog.event_id = 4625` failed logons occur in a 5-minute window).
- Add **Metrics Monitors** on host metrics (CPU saturation, low disk space, swap usage).
- Combine this with the [Server / VM Monitor](/docs/monitor/server-monitor) and the [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) for end-to-end host visibility.
- Ship the same configuration to every host via Ansible / Chef / Puppet / Group Policy / Intune / your existing configuration management tooling.
