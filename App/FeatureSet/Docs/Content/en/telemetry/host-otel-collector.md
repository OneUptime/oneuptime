# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Overview

You can run the **OpenTelemetry Collector** as a service directly on your Linux, macOS, or Windows hosts to ship host telemetry to OneUptime over OTLP. This page walks through installing the collector, configuring it for each OS, and choosing the right receivers for what you want to collect:

- **Host metrics** (CPU, memory, disk, filesystem, network, load, processes) on every OS
- **File-based logs** under `/var/log/**` (Linux, macOS) via the [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) via the [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via the [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) wrapping a tailed `log stream` output
- **Windows Event Logs** via the [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Windows service status** (powers the host **Services** tab) via the [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — bundled in the upstream `otelcol-contrib` build from **v0.155.0** onward (see "Windows Services (metrics)" below)

> **What about the OneUptime Infrastructure Agent?** That agent is a separate, lightweight Go daemon focused on basic metrics and the _Server / VM Monitor_ feature (status, processes, alerting). The OpenTelemetry Collector described here is independent and is the right tool when you want logs (file logs, journald, Windows Event Logs) or richer host metrics ingested as standard OTLP. Both can run on the same host without interfering.

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create one from _Project Settings → Telemetry Ingestion Keys_ and copy the `x-oneuptime-token` value.
- The **OpenTelemetry Collector Contrib** distribution (`otelcol-contrib`). The default `otelcol` build does **not** include receivers like `windowseventlogreceiver`, `journaldreceiver`, or `hostmetrics` extras — make sure to use the `contrib` distribution. The alpha `windowsservicereceiver` that powers the Windows **Services** tab is bundled in `otelcol-contrib` from **v0.155.0** onward, so install a current release; see "Windows Services (metrics)" below.
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

On Windows, download the upstream **`otelcol-contrib`** release — it bundles the `windows_service` receiver that powers the host **Services** tab (from **v0.155.0** onward). From an **elevated** PowerShell prompt:

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _windows_arm64.tar.gz asset on ARM
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_amd64.tar.gz" -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+
```

This unpacks `otelcol-contrib.exe` into `C:\Program Files\otelcol-contrib`. You will create `config.yaml` in the same folder in Step 2 and register a Windows service in Step 3.

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
      process:
        mute_process_name_error: true
        mute_process_user_error: true

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
      process:
        mute_process_name_error: true
        mute_process_user_error: true

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
      # On Windows the 'load' scraper only emulates an average from the
      # Processor Queue Length counter (it starts at 0) — omitted here.
      paging:
      processes:
      process:
        mute_process_name_error: true
        mute_process_user_error: true

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
  DisplayName= "OpenTelemetry Collector (OneUptime)"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

The service runs under `LocalSystem` by default, which has the privileges needed to read the `Security` Windows Event Log channel and every Windows service.

## Step 4 — Verify in OneUptime

1. Generate some signal on the host:
   - **Linux / macOS:** `logger "hello from oneuptime"` (writes to syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` from an elevated prompt.
2. In the OneUptime dashboard, open **Telemetry → Services** and pick the `service.name` you configured.
3. Open **Metrics** — host metrics (CPU, memory, filesystem, etc.) should appear within a minute.
4. Open **Logs** — your file logs / journald entries / Windows Event Logs should be streaming in. Useful searchable attributes include `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id`, and `winlog.provider.name`.

## Reducing the Volume of Data Collected

Because you own the collector config, you decide exactly what leaves the host — nothing is collected unless a receiver you added asks for it. If a host is sending more than you want (which shows up as higher ingest volume, and on OneUptime Cloud, higher cost), tune it here. The two biggest levers are **which log sources you tail** and **how often you scrape metrics**; a `filter` processor handles the rest.

The principle is the same as the config itself: **add only the receivers whose data you will look at**, then trim within them. Each change below is an edit to `config.yaml` — apply it and restart the collector (Step 3).

### Where the volume comes from

| Signal                 | Biggest driver                                       | Turn it down with                                                    |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| **Logs**               | Every line from every file / journald unit / channel | Narrow receivers; `query:` filters; a `filter` processor on severity |
| **Host metrics**       | Scrape frequency × number of series                  | `collection_interval`; drop the `process` scraper; scraper selection |
| **Metric cardinality** | Per-process metrics (one series set per process)     | Omit or scope the `process` scraper                                  |

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
      #   include:
      #     names: [nginx, postgres, node]
      #     match_type: strict
```

### Lever 4 — Drop low-value records with a `filter` processor

When you want the receiver but not all of its output, add a [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) processor — it evaluates an [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) condition and **drops any record that matches**, before anything is exported.

Drop logs below a severity threshold:

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        - "severity_number < SEVERITY_NUMBER_WARN"
```

Drop a specific noisy metric you don't chart:

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "system.paging.faults"'
```

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
- **HTTP 401 from the exporter** — the ingestion token is invalid or revoked. Generate a new one from _Project Settings → Telemetry Ingestion Keys_.
- **`Security` Windows Event Log returns access denied** — the service is not running with sufficient privileges. Recreate it under `LocalSystem` (the default with `sc.exe create`) or grant the service account the _Manage auditing and security log_ user right.
- **`journald` receiver fails to start** — make sure `journalctl` is on the collector's `PATH` and that `/var/log/journal` exists (run `sudo systemd-tmpfiles --create --prefix /var/log/journal` if not).
- **High volume / cost** — see [Reducing the Volume of Data Collected](#reducing-the-volume-of-data-collected): narrow the receivers (specific Windows channels, systemd units, log files), raise the metrics `collection_interval`, drop the per-process scraper, or add a `filter` processor to drop low-severity records before export.

## Next steps

- Add **Logs Monitors** to alert on specific log patterns (for example, alert when more than 5 `winlog.event_id = 4625` failed logons occur in a 5-minute window).
- Add **Metrics Monitors** on host metrics (CPU saturation, low disk space, swap usage).
- Combine this with the [Server / VM Monitor](/docs/monitor/server-monitor) and the [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) for end-to-end host visibility.
- Ship the same configuration to every host via Ansible / Chef / Puppet / Group Policy / Intune / your existing configuration management tooling.
