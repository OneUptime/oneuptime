# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Overview

You can run the **OpenTelemetry Collector** as a service directly on your Linux, macOS, or Windows hosts to ship host telemetry to OneUptime over OTLP. This page walks through installing the collector, configuring it for each OS, and choosing the right receivers for what you want to collect:

- **Host metrics** (CPU, memory, disk, filesystem, network, load, processes) on every OS
- **File-based logs** under `/var/log/**` (Linux, macOS) via the [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) via the [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **systemd unit state** (powers the host **Systemd Units** tab) via the [`systemdreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/systemdreceiver) — bundled in the upstream `otelcol-contrib` build from **v0.142.0**, usable from **v0.143.0** onward (see "Linux Services (systemd units)" below)
- **Apple Unified Log** (macOS) via the [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) wrapping a tailed `log stream` output
- **Windows Event Logs** via the [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Windows service status** (powers the host **Services** tab) via the [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — bundled in the upstream `otelcol-contrib` build from **v0.155.0** onward (see "Windows Services (metrics)" below)

> **What about the OneUptime Infrastructure Agent?** That agent is a separate, lightweight Go daemon focused on basic metrics and the _Server / VM Monitor_ feature (status, processes, alerting). The OpenTelemetry Collector described here is independent and is the right tool when you want logs (file logs, journald, Windows Event Logs) or richer host metrics ingested as standard OTLP. Both can run on the same host without interfering.

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the `x-oneuptime-token` value.
- The **OpenTelemetry Collector Contrib** distribution (`otelcol-contrib`). The default `otelcol` build does **not** include receivers like `windowseventlogreceiver`, `journaldreceiver`, or `hostmetrics` extras — make sure to use the `contrib` distribution. The alpha `windowsservicereceiver` that powers the Windows **Services** tab is bundled in `otelcol-contrib` from **v0.155.0** onward, and the alpha `systemdreceiver` that powers the Linux **Systemd Units** tab from **v0.143.0** onward, so install a current release; see "Windows Services (metrics)" and "Linux Services (systemd units)" below.
- Root / Administrator on the host to install the collector as a service and (where applicable) read privileged log sources.

## Step 1 — Install the OpenTelemetry Collector

Pick the section for your OS. All examples assume you are installing the latest `otelcol-contrib` release from [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.156.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

The Debian package installs the binary at `/usr/bin/otelcol-contrib`, the default config at `/etc/otelcol-contrib/config.yaml`, and a systemd unit at `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.156.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Paths match the Debian package (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd unit `otelcol-contrib`).

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.156.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

You will create `/etc/otelcol-contrib/config.yaml` in Step 2 and a `launchd` plist in Step 3.

### Windows

On Windows, download the upstream **`otelcol-contrib`** release — it bundles the `windows_service` receiver that powers the host **Services** tab (from **v0.155.0** onward).

**Download the `contrib` asset, not the core one.** Every release publishes two Windows archives whose names differ by one word, and picking the wrong one is the most common way this install fails:

| Release asset                                    | Unpacks               | Use this?                                             |
| ------------------------------------------------ | --------------------- | ----------------------------------------------------- |
| `otelcol-contrib_<version>_windows_amd64.tar.gz` | `otelcol-contrib.exe` | **Yes** — the contrib distribution                    |
| `otelcol_<version>_windows_amd64.tar.gz`         | `otelcol.exe`         | No — the core build, missing the Windows receivers used below |

The asset name must **start with `otelcol-contrib_`**. The core `otelcol_` build ships no `windowseventlog` or `windows_service` receiver, and renaming `otelcol.exe` to `otelcol-contrib.exe` does not add them — it only swaps one startup failure for another (see [Troubleshooting](#troubleshooting)).

From an **elevated** PowerShell prompt, run this block as a whole — each line depends on the variables set above it:

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$ARCH    = "amd64"                            # use "arm64" on ARM hosts
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"

# Note the "-contrib" in the asset name; otelcol_... is the wrong archive.
$url = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_${ARCH}.tar.gz"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Invoke-WebRequest -Uri $url -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+

Get-ChildItem $dest                            # expect otelcol-contrib.exe, not otelcol.exe
```

Run the whole block rather than lifting a single line out of it: the URL is assembled from `$VERSION` and `$ARCH`, so an `Invoke-WebRequest` pasted on its own into a fresh session fails with a null `-Uri` and downloads nothing. Building the URL into `$url` on its own line is deliberate — interpolating the version straight into the `Invoke-WebRequest` argument turns an unset variable into a silent 404 instead.

This unpacks `otelcol-contrib.exe` — **not** `otelcol.exe` — into `C:\Program Files\otelcol-contrib`; the `Get-ChildItem` line above confirms which one you got. You will create `config.yaml` in the same folder in Step 2 and register a Windows service in Step 3.

> Prefer a native installer? OpenTelemetry also publishes a signed **`.msi`** (`otelcol-contrib_<version>_windows_x64.msi`) on the same [releases page](https://github.com/open-telemetry/opentelemetry-collector-releases/releases), which registers the collector as a Windows service for you. If you use it, point it at the `config.yaml` from Step 2 and make sure the service runs as `LocalSystem` so the **Services** tab can read the Service Control Manager.

## Step 2 — Configure the collector

The configuration file lives at:

| OS      | Path                                                  |
| ------- | ----------------------------------------------------- |
| Linux   | `/etc/otelcol-contrib/config.yaml`                    |
| macOS   | `/etc/otelcol-contrib/config.yaml`                    |
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
        mute_process_user_error: true
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

### Linux Services (systemd units, metrics)

The host **Systemd Units** tab is powered by the [`systemdreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/systemdreceiver) (config type `systemd`), which reports the active state of systemd units as metrics — the Linux counterpart of the **Services** tab on Windows.

**The receiver first shipped in the upstream `otelcol-contrib` binary in v0.142.0, and v0.143.0 is the first release worth running** — on anything older, adding `systemd` fails at startup with `'receivers' unknown type: "systemd"`, and v0.142.0 alone names its CPU metric `systemd.unit.cpu.time` and looks for cgroup statistics on every unit, which logs a scrape error for each non-`.service` unit. v0.143.0 renamed that metric to `systemd.service.cpu.time` and limited the lookup to services. Install a current release (Step 1), then enable the receiver in your `config.yaml` and add it to the metrics pipeline:

```yaml
receivers:
  systemd:
    collection_interval: 30s
    # The service manager to read: "system" (default) or "user".
    scope: system
    # Which units to scrape, as systemctl unit patterns. The default is
    # every service; widen it to include timers, sockets or mounts, or
    # narrow it to cut volume on hosts with hundreds of units:
    units: ["*.service"]
    # units: [nginx.service, postgresql.service, "*.timer"]
    metrics:
      # Per-service CPU time is on by default and doubles this receiver's
      # datapoint count. The Systemd Units tab does not use it, so turn it
      # off unless you chart it. On v0.142.0 the key is
      # systemd.unit.cpu.time — naming a metric the running build does not
      # have stops the collector at startup.
      systemd.service.cpu.time:
        enabled: false

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, systemd]
      processors: [resourcedetection, batch]
```

The receiver emits `systemd.unit.state` as a **state set**: on every scrape each unit gets one datapoint per possible state (`active`, `reloading`, `inactive`, `failed`, `activating`, `deactivating`, `maintenance`, `refreshing`), valued `1` on the state the unit is actually in and `0` on the rest. The unit name travels as the resource attribute `systemd.unit.name` and the state as the datapoint attribute `systemd.unit.active_state`. Because the unit name is a _resource_ attribute, **`resourcedetection` must stay in the metrics pipeline** — it is what stamps `host.name` onto each unit's resource, and without it the samples never attach to a host and the tab stays empty.

The collector reads unit state over the **system D-Bus**, using the same read-only calls `systemctl list-units` makes. systemd allows those unprivileged, so the packaged service — which runs as the `otelcol-contrib` user, not root — can scrape units without extra privileges. What it does need is a reachable bus: a collector running in a container has no `/run/dbus/system_bus_socket` unless you bind-mount the host's, which is why this receiver is for native installs. It is **alpha** and **Linux-only** — it does not build on macOS or Windows.

> **Watch the volume on hosts with many units.** The state set emits eight datapoints per unit per scrape, and the default-on `systemd.service.cpu.time` adds two more (`user` and `system`), so budget ten. A host tracking 300 units at 30s is ~6k datapoints a minute from this receiver alone, or ~4.8k with the CPU metric disabled as above. Narrow `units:` to the services you actually alert on, or raise `collection_interval`, before enabling it fleet-wide.

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
          layout: "%Y-%m-%d %H:%M:%S.%f%j"
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

To read a custom or application-specific channel (anything you can see under _Event Viewer → Applications and Services Logs_), use its exact display name:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows Services (metrics)

The host **Services** tab is powered by the [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (config type `windows_service`), which reports the running state and startup type of Windows services as metrics.

**This receiver ships in the upstream `otelcol-contrib` binary from v0.155.0 onward** — on earlier releases, adding `windows_service` fails at startup with `'receivers' unknown type: "windows_service"`. Install a current release (Step 1), then enable it in your `config.yaml` and add it to the metrics pipeline:

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

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
```

The receiver emits one `windows.service.status` gauge per service — the integer is the Win32 service state (`4` = running, `1` = stopped) — with `name` and `startup_mode` attributes. Run the collector as `LocalSystem` (the `sc.exe` default) so it can read every service; any it can't open is skipped. The receiver is **alpha** and **Windows-only**; known issues include a scrape error that could crash the collector and an `access denied` on one service affecting others — restrict to `include_services` if you hit them.

> **`include_services` has no effect?** The filter can only ever *narrow* the set, so if you list services and still see every one, the edited config almost certainly hasn't reached the running collector. Restart the service after editing (Step 3); make sure `include_services` is a populated list at the same indent as `collection_interval` (not left commented out or empty); and give the **Services** tab a few minutes so services reported before the change age out of its rolling window. The names are exact, case-sensitive Windows service _key_ names (e.g. `Spooler`, `W3SVC`), which you can list with `Get-Service | Select-Object Name`.

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

  # Powers the Systemd Units tab (otelcol-contrib v0.143.0+).
  systemd:
    collection_interval: 30s
    units: ["*.service"]

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  # Stamps host.name / host.id / os.type — this is how OneUptime attaches
  # telemetry to a host. Without it the host tabs stay empty.
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
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
      receivers: [hostmetrics, systemd]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/syslog, journald]
      processors: [resourcedetection, resource, batch]
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
  # Stamps host.name / host.id / os.type — this is how OneUptime attaches
  # telemetry to a host. Without it the host tabs stay empty.
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
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
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/system]
      processors: [resourcedetection, resource, batch]
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
      # On Windows the 'load' scraper only emulates an average from the
      # Processor Queue Length counter (it starts at 0) — omitted here.
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

  # Powers the Services tab (otelcol-contrib v0.155.0+).
  windows_service:
    collection_interval: 30s

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  # Stamps host.name / host.id / os.type — this is how OneUptime attaches
  # telemetry to a host. Without it the host tabs stay empty.
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
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
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
    logs:
      receivers:
        - windowseventlog/system
        - windowseventlog/application
        - windowseventlog/security
      processors: [resourcedetection, resource, batch]
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

The packaged unit runs the collector as the unprivileged `otelcol-contrib` user. That is enough for the `systemd` receiver — it only makes the read-only D-Bus calls systemd already allows any user, the same ones `systemctl list-units` uses.

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
  DisplayName= "OpenTelemetry Collector (OneUptime)"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

The service runs under `LocalSystem` by default, which has the privileges needed to read the `Security` Windows Event Log channel and every Windows service.

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
2. In the OneUptime dashboard, open **Products → Services** and pick the `service.name` you configured.
3. Open **Metrics** — host metrics (CPU, memory, filesystem, etc.) should appear within a minute.
4. Open **Logs** — your file logs / journald entries / Windows Event Logs should be streaming in. Useful searchable attributes include `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id`, and `winlog.provider.name`.
5. If you enabled the `systemd` (Linux) or `windows_service` (Windows) receiver, open **Infrastructure → Hosts**, pick the host, and check the **Systemd Units** / **Services** tab — every scraped unit should be listed with its current state.

## Reducing the Volume of Data Collected

Because you own the collector config, you decide exactly what leaves the host — nothing is collected unless a receiver you added asks for it. If a host is sending more than you want (which shows up as higher ingest volume, and on OneUptime Cloud, higher cost), tune it here. The two biggest levers are **which log sources you tail** and **how often you scrape metrics**; a `filter` processor handles the rest.

The principle is the same as the config itself: **add only the receivers whose data you will look at**, then trim within them. Each change below is an edit to `config.yaml` — apply it and restart the collector (Step 3).

### Where the volume comes from

| Signal                 | Biggest driver                                       | Turn it down with                                                    |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| **Logs**               | Every line from every file / journald unit / channel | Narrow receivers; `query:` filters; a `filter` processor on severity |
| **Host metrics**       | Scrape frequency × number of series                  | `collection_interval`; drop the `process` scraper; scraper selection |
| **Metric cardinality** | Per-process metrics (one series set per process)     | Omit or scope the `process` scraper                                  |
| **systemd units**      | 10 datapoints per unit per scrape (state set + CPU)  | Narrow `units:`; disable the CPU metric; raise `collection_interval` |

### Lever 1 — Tail only the log sources you need

Logs are almost always the largest slice. The collector only reads what you list, so the fix is to list less:

- **Files** — point `filelog` at specific paths, not broad globs. `/var/log/myapp/error.log` instead of `/var/log/**`.
- **journald** — restrict `units:` to the services you care about and raise `priority:` so you drop chatty `info`/`debug` entries at the source:

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Windows Event Logs** — the `Security` channel is by far the highest-volume one. Narrow it to the event IDs you actually audit with a `query:` (as shown in [Windows Event Logs](#windows-event-logs) above), or drop the channel entirely if you don't need it.

### Lever 2 — Slow down the metrics interval

`hostmetrics` volume scales directly with `collection_interval`. If you don't need 30-second resolution, 60s halves the number of data points:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### Lever 3 — Drop the per-process scraper (the cardinality driver)

The `process` scraper emits a separate set of series **for every running process** on the host — on a busy machine that is the single largest source of metric cardinality. Unless you need per-process CPU/memory, leave it out of the `scrapers:` list. Keep `processes` (which is just a handful of aggregate process-count metrics) — it's cheap. If you do want per-process metrics, scope them to the processes that matter:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes: # aggregate counts only — cheap
      # 'process:' (per-process series) intentionally omitted.
      # If you need it, scope it instead of collecting every process:
      # process:
      #   mute_process_name_error: true
      #   mute_process_user_error: true
      #   include:
      #     names: [nginx, postgres, node]
      #     match_type: strict
```

### Lever 4 — Narrow the systemd unit set

The `systemd` receiver emits one datapoint **per state per unit** on every scrape — eight per unit — plus two more for the default-on `systemd.service.cpu.time`, so its volume is set by how many units `units:` matches. The default `["*.service"]` picks up every service on the host, including the dozens of one-shot units that never change state. List the units you actually alert on, and turn off the CPU metric unless you chart it:

```yaml
receivers:
  systemd:
    collection_interval: 60s
    units: [nginx.service, postgresql.service, ssh.service]
    metrics:
      # On otelcol-contrib v0.142.0 this key is systemd.unit.cpu.time.
      systemd.service.cpu.time:
        enabled: false
```

Together those take a 300-unit host from ~6k datapoints a minute to well under 100. Units dropped from the list stop appearing on the **Systemd Units** tab a few minutes later, once their last samples age out of its rolling window.

### Lever 5 — Drop low-value records with a `filter` processor

When you want the receiver but not all of its output, add a [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) processor — it evaluates an [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) condition and **drops any record that matches**, before anything is exported.

Drop logs below a severity threshold:

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        # The UNSPECIFIED guard is required — see the warning below.
        - "severity_number != SEVERITY_NUMBER_UNSPECIFIED and severity_number < SEVERITY_NUMBER_WARN"
```

> **Do not drop the `UNSPECIFIED` guard.** `SEVERITY_NUMBER_UNSPECIFIED` is `0` and `SEVERITY_NUMBER_WARN` is `13`, so a bare `severity_number < SEVERITY_NUMBER_WARN` is `0 < 13` — **true for every record whose severity was never parsed**. A plain `filelog` receiver does not parse severity from the log line: nothing in this page's `filelog` examples sets `operators:`, so those records arrive at the filter with `severity_number: 0`. Without the guard, that condition silently deletes **100% of** `/var/log/syslog`, `/var/log/messages` and `/var/log/auth.log` — with no error anywhere. With the guard, unclassified records are kept and you will see them arrive in OneUptime as severity `Unspecified`, which tells you a severity parser is what you actually need.

To filter file logs by severity *properly*, parse a severity first with a [`severity_parser`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/severity_parser.md) operator on the receiver, so records carry a real level before they reach the filter:

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    operators:
      # Pull a level out of lines like "2026-01-01 ERROR something broke".
      - type: regex_parser
        regex: '(?i)(?P<level>TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)'
        parse_from: body
        # Lines with no recognisable level fall through unparsed rather
        # than being discarded, and are then kept by the guard above.
        on_error: send
      - type: severity_parser
        parse_from: attributes.level
        preset: default
        mapping:
          warn: warning
          error: err
          fatal: panic
```

On systemd hosts you do not need any of this — `journald`'s `priority:` (Lever 1) filters by level in `journalctl` itself, before an OTel record exists.

Drop metrics you don't chart — exact name, or a pattern:

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        # Exact metric name.
        - 'name == "system.paging.faults"'
        # Or a whole family. IsMatch is RE2 and UNANCHORED, so anchor it
        # yourself with ^ when you mean "starts with".
        - 'IsMatch(name, "^system\\.paging\\.")'
```

Send **only** a fixed set of metrics (an allowlist) by inverting the condition — `filter` drops what matches, so `not (...)` drops everything you did not name:

```yaml
processors:
  filter/allowlist:
    error_mode: ignore
    metrics:
      metric:
        - 'not (name == "system.cpu.utilization" or name == "system.memory.utilization" or name == "system.filesystem.utilization")'
```

Keep that condition on **one line**. An allowlist is a big hammer: anything you forget to name is gone, along with the monitors built on it. Prefer dropping the few metrics you don't want, or simply omitting the scraper that produces them (Lever 3) — a metric never collected costs nothing to filter.

Then add the processor to the relevant pipeline — order matters, so put `filter` before `batch`:

```yaml
service:
  pipelines:
    logs:
      receivers: [journald]
      processors: [filter/drop-low-severity, resource, batch]
      exporters: [otlphttp]
    metrics:
      receivers: [hostmetrics]
      processors: [filter/drop-metrics, resource, batch]
      exporters: [otlphttp]
```

> **Editing the config OneUptime generated for you?** The pipeline above matches the complete examples on this page. The config from the dashboard (Hosts → Documentation) names things differently: its processors are `resourcedetection` and `batch` (there is **no** `resource` processor) and its exporter is `otlphttp/oneuptime`. Referencing a processor that isn't defined stops the collector at startup with `references processor "resource" which is not configured`. Add the filter to what is already there rather than pasting this block over it:
>
> ```yaml
> service:
>   pipelines:
>     metrics:
>       receivers: [hostmetrics]
>       processors: [filter/drop-metrics, resourcedetection, batch]
>       exporters: [otlphttp/oneuptime]
> ```
>
> Keep `resourcedetection` — OneUptime matches telemetry to a host using the `host.name` / `host.id` it sets. That generated config is also **metrics-only**: it has no `logs:` pipeline until you add one, so a `filter/drop-low-severity` has nothing to filter until you add a `filelog` or `journald` receiver alongside it.

> **On macOS, use the tarball, not Homebrew.** The Homebrew formula ships the **core** collector, and `filter` is a contrib-only processor — the collector will refuse to start regardless of whether your YAML is correct.

### A lean starting point

A **metrics-only** host — no logs, coarse interval, no per-process series — is the smallest useful footprint:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  # Stamps host.name / host.id / os.type — this is how OneUptime attaches
  # telemetry to a host. Without it the host tabs stay empty.
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
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
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
```

Add a `logs` pipeline back with a narrowly-scoped `filelog` or `journald` receiver when you need it.

> **Watch what you cut.** Log-based alerts need the logs to arrive: if you filter out a severity or a channel, monitors that key on it go quiet. Trim the sources you don't act on, not the ones a monitor is watching. Change one lever at a time and confirm the drop under **Project Settings → Usage History** (usage is aggregated daily, so give it a day or two) before moving to the next.

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
  - **Windows:** look under _Event Viewer → Windows Logs → Application_ for source `otelcol-contrib`.
  - Confirm the host can reach `https://oneuptime.com/otlp` (or your self-hosted endpoint): `curl -v https://oneuptime.com/otlp` from the same machine.
- **HTTP 401 from the exporter** — the ingestion token is invalid or revoked. Generate a new one from _Project Settings → Telemetry & APM → Ingestion Keys_.
- **`Security` Windows Event Log returns access denied** — the service is not running with sufficient privileges. Recreate it under `LocalSystem` (the default with `sc.exe create`) or grant the service account the _Manage auditing and security log_ user right.
- **Windows service fails to start with `Error 2: The system cannot find the file specified`** — the Service Control Manager cannot find the executable the service was registered against. Run `sc.exe qc "otelcol-contrib"` and compare `BINARY_PATH_NAME` with what is actually in `C:\Program Files\otelcol-contrib`. Almost always the core `otelcol_<version>_windows_amd64.tar.gz` archive was downloaded — it unpacks `otelcol.exe` — while Step 3 registers the service against `otelcol-contrib.exe`, which only the `otelcol-contrib_<version>_...` archive contains. Re-download the `contrib` asset from Step 1; do **not** rename `otelcol.exe`, which produces the `1064` below instead. The other cause is an unquoted `binPath=`: a path through `C:\Program Files` splits on the space unless it is quoted exactly as Step 3 shows.
- **Windows service fails to start with `Error 1064: An exception occurred in the service when handling the control request`** — the SCM launched the binary, but the collector exited during startup. Renaming `otelcol.exe` to `otelcol-contrib.exe` makes the path resolve without changing what is inside the binary: the core build has no `windowseventlog` or `windows_service` receiver, so it rejects the Step 2 config and dies before the service ever reports as running. An unquoted `--config` path gives the same `1064` even with the right binary: without the inner quotes the argument splits on the space in `Program Files` and the collector exits over a config file it cannot read. Check what you actually have:
  - `otelcol-contrib.exe --version` should print `otelcol-contrib version ...`. If it prints `otelcol version ...`, it is the core build renamed — re-download the `contrib` asset from Step 1.
  - `otelcol-contrib.exe components` should list `windowseventlog` and `windows_service` among the receivers. Do not test with `hostmetrics` — the core build ships that one too, so seeing it proves nothing. Anything the config references but this command does not list will stop the collector at startup.
  - Run it in the foreground to see the real error instead of the generic `1064`: `& "C:\Program Files\otelcol-contrib\otelcol-contrib.exe" --config="C:\Program Files\otelcol-contrib\config.yaml"`.
  - Check _Event Viewer → Windows Logs → Application_ for source `otelcol-contrib`, which records the startup error the SCM swallowed.
- **`journald` receiver fails to start** — make sure `journalctl` is on the collector's `PATH` and that `/var/log/journal` exists (run `sudo systemd-tmpfiles --create --prefix /var/log/journal` if not).
- **`systemd` receiver reports a D-Bus connection error** — the collector cannot reach the system bus. Confirm `/run/dbus/system_bus_socket` exists and that the collector's user can open it; `systemctl list-units` run as that user is the quickest check. Root is not required. A collector running inside a container sees no bus at all unless you bind-mount the host's socket, so prefer a native install for this receiver.
- **`systemd` receiver logs a scrape error per unit, or the collector refuses to start over an unknown metric** — both are version skew. v0.142.0 looks for cgroup statistics on every unit (one error per non-`.service` unit per scrape) and calls its CPU metric `systemd.unit.cpu.time`; v0.143.0 and later limit that lookup to services and renamed the metric to `systemd.service.cpu.time`. Upgrade to v0.143.0+, and make sure any `metrics:` override names the key your build actually has.
- **The Systemd Units tab is empty even though the receiver is running** — check that `resourcedetection` is in the same metrics pipeline. The receiver attaches only `systemd.unit.name` to each unit's resource, so without `resourcedetection` there is no `host.name` and the samples never attach to a host.
- **High volume / cost** — see [Reducing the Volume of Data Collected](#reducing-the-volume-of-data-collected): narrow the receivers (specific Windows channels, systemd units, log files), raise the metrics `collection_interval`, drop the per-process scraper, or add a `filter` processor to drop low-severity records before export.

## Next steps

- Add **Logs Monitors** to alert on specific log patterns (for example, alert when more than 5 `winlog.event_id = 4625` failed logons occur in a 5-minute window).
- Add **Metrics Monitors** on host metrics (CPU saturation, low disk space, swap usage).
- Combine this with the [Server / VM Monitor](/docs/monitor/server-monitor) and the [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) for end-to-end host visibility.
- Ship the same configuration to every host via Ansible / Chef / Puppet / Group Policy / Intune / your existing configuration management tooling.
