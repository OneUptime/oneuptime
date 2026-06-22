# 主机 OpenTelemetry Collector（Linux、macOS、Windows）

## 概述

你可以直接在 Linux、macOS 或 Windows 主机上将 **OpenTelemetry Collector** 作为服务运行，通过 OTLP 将主机遥测数据发送到 OneUptime。本页将逐步介绍如何安装该 collector、为每种操作系统进行配置，以及根据你想采集的内容选择合适的接收器（receiver）：

- 适用于所有操作系统的**主机指标**（CPU、内存、磁盘、文件系统、网络、负载、进程）
- 通过 [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver) 采集 `/var/log/**` 下的**基于文件的日志**（Linux、macOS）
- 通过 [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver) 采集 **systemd journal**（Linux）
- 通过 [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) 包装对 `log stream` 输出的 tail 来采集 **Apple Unified Log**（macOS）
- 通过 [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver) 采集 **Windows 事件日志**
- 通过 [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) 采集 **Windows 服务状态**（为主机的 **Services** 标签页提供数据）—— *未包含在上游预构建的 collector 中；请使用预构建的 **OneUptime Host Collector** 或自定义构建（见下文“Windows 服务（指标）”）*

> **那么 OneUptime 基础设施代理（Infrastructure Agent）呢？** 该代理是一个独立的、轻量级的 Go 守护进程，专注于基础指标和*服务器 / 虚拟机监控器（Server / VM Monitor）*功能（状态、进程、告警）。这里描述的 OpenTelemetry Collector 是独立的，当你希望将日志（文件日志、journald、Windows 事件日志）或更丰富的主机指标作为标准 OTLP 数据接入时，它是合适的工具。两者可以在同一台主机上运行而互不干扰。

## 前提条件

- 一个 **OneUptime 遥测接入令牌（Telemetry Ingestion Token）**——从 *Project Settings → Telemetry Ingestion Keys* 创建一个，并复制 `x-oneuptime-token` 值。
- **OpenTelemetry Collector Contrib** 发行版（`otelcol-contrib`）。默认的 `otelcol` 构建**不**包含诸如 `windowseventlogreceiver`、`journaldreceiver` 或 `hostmetrics` 附加项之类的接收器——请务必使用 `contrib` 发行版。有一个值得提前了解的例外：alpha 阶段的 `windowsservicereceiver`（它为 Windows **Services** 标签页提供数据）**未**打包进上游预构建的 `contrib` 二进制文件中——请使用预构建的 **OneUptime Host Collector**（它已包含该接收器）或自行构建；见下文“Windows 服务（指标）”。
- 主机上的 root / 管理员权限，用于将 collector 安装为服务，并（在适用的情况下）读取需要特权的日志源。

## 第 1 步——安装 OpenTelemetry Collector

选择适合你操作系统的小节。所有示例都假设你从 [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) 安装最新的 `otelcol-contrib` 发布版。

### Linux（Debian / Ubuntu）

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian 软件包会将二进制文件安装到 `/usr/bin/otelcol-contrib`，将默认配置安装到 `/etc/otelcol-contrib/config.yaml`，并将一个 systemd 单元安装到 `/etc/systemd/system/otelcol-contrib.service`。

### Linux（RHEL / CentOS / Fedora / Amazon Linux）

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

路径与 Debian 软件包相同（`/usr/bin/otelcol-contrib`、`/etc/otelcol-contrib/config.yaml`、systemd 单元 `otelcol-contrib`）。

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.154.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

你将在第 2 步中创建 `/etc/otelcol-contrib/config.yaml`，并在第 3 步中创建一个 `launchd` plist。

### Windows

从[发布页面](https://github.com/open-telemetry/opentelemetry-collector-releases/releases)下载最新的 `otelcol-contrib_*_windows_amd64.zip`（或 `arm64`）。在**提升权限的** PowerShell 提示符下：

```powershell
$dest = "C:\Program Files\otelcol-contrib"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path "$env:USERPROFILE\Downloads\otelcol-contrib_*_windows_amd64.zip" -DestinationPath $dest
```

你将在第 2 步中创建 `C:\Program Files\otelcol-contrib\config.yaml`，并在第 3 步中注册一个 Windows 服务。

## 第 2 步——配置 collector

配置文件位于：

| 操作系统 | 路径 |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

每份配置都遵循相同的结构——选择你想要的接收器，添加一个 `batch` 和 `resource` 处理器，并通过 OTLP HTTP 导出到 OneUptime。下面的示例为每种操作系统展示了一份完整的、可复制粘贴的配置，然后逐一介绍各个接收器块，以便你可以混合搭配。

替换 `YOUR_TELEMETRY_INGESTION_TOKEN` 和 `service.name` 值以适应你的环境。

### 通用部分（每种操作系统都会用到）

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

- **`batch`** 在导出前将记录分组，这样你就不必为每条记录支付一次 HTTP 往返。
- **`resource`** 为每条记录打上 `service.name` 标记。如果你希望每台机器在 OneUptime 中显示为各自独立的遥测服务，请为每台主机使用不同的值（例如 `prod-web-01`）。
- **`otlphttp`** 通过 HTTPS 并附带接入令牌将数据发送到 OneUptime。

### 主机指标（Linux、macOS、Windows）

适用于所有操作系统。从主机内核采集 CPU、内存、磁盘、文件系统、网络、负载、分页（paging）和进程指标：

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

> 在 Linux 上，collector 会读取 `/proc` 和 `/sys`。当 collector 在容器中运行时，请挂载主机的 `/proc` 和 `/sys`，并设置 `HOST_PROC` / `HOST_SYS` 环境变量。当它直接作为 systemd 服务运行时（如上文所安装的那样），则无需额外设置。

### 文件日志（Linux、macOS）

tail 磁盘上的任何日志文件。下面是一个常见的起始集合：

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

`start_at: end` 表示从 collector 启动那一刻起的新行；改为 `beginning` 可在首次运行时回填历史数据。collector 会跟踪文件偏移量，因此在重启后能够正确恢复。

**将主机日志堆栈跟踪转换为异常（Exceptions）。** OneUptime 会自动扫描 error 和 fatal 日志行中的堆栈跟踪，并将它们汇总到归属于此主机的 **Exceptions**（Issues）视图中——无需额外配置。为了使其分组良好，多行堆栈跟踪（Java、Python、.NET、Ruby）必须作为**一条**日志记录到达，而不是每行一条记录。在 `filelog` 接收器上启用多行重组（multiline recombination），以便堆栈跟踪及其各帧保持在一起：

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

如果不进行重组，每一帧都会作为单独的日志被接入，异常将显示为单行、分组不佳的问题。如果你的应用程序可以直接发出 OpenTelemetry 的 `exception.type` / `exception.message` / `exception.stacktrace` 日志属性，那就改用这种方式——它是最可靠的途径，并且不依赖于多行解析。

### systemd journal（Linux）

如果你的主机使用 systemd，那么 `journald` 接收器通常比 tail `/var/log/*` 更合适——它将所有内容捕获到一处，并保留结构化字段：

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

collector 二进制文件必须能够执行 `journalctl`（Debian / RPM 软件包已将其作为依赖项包含在内）。

### Apple Unified Log（macOS）

macOS 已弃用 `/var/log/system.log`，转而使用 Apple Unified Log，可通过 `log show` / `log stream` 查询。接入它最简单的方式是借助一个小型包装脚本，通过 `filelog` 接收器流式传输 `log` 的输出。创建 `/usr/local/otelcol-contrib/log-stream.sh`：

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

赋予它可执行权限，将其在 launchd 下运行（或用 `nohup` 进行快速测试），然后将 collector 指向该文件：

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

（如果你不需要 unified log，可跳过此项——Mac 机群通常仅靠主机指标 + 几个文件日志就能良好运行。）

### Windows 事件日志

通过原生的 `wevtapi` 订阅你关心的通道：

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

要将高流量的 `Security` 通道缩小到特定的事件 ID：

```yaml
  windowseventlog/security:
    channel: Security
    start_at: end
    query: "*[System[(EventID=4625 or EventID=4740)]]"
```

要读取自定义或特定于应用程序的通道（任何你能在 *Event Viewer → Applications and Services Logs* 下看到的内容），请使用其确切的显示名称：

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Windows 服务（指标）

主机的 **Services** 标签页由 [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver)（配置类型 `windows_service`）提供数据，它以指标形式报告 Windows 服务的运行状态和启动类型。

> **该接收器_未_包含在上游预构建的 `otelcol-contrib` 二进制文件中。** 尽管其元数据声明了 `contrib` 发行版，但它尚未被加入 contrib 的发布清单，因此你在第 1 步安装的官方预构建 collector 并不包含它。向该 collector 添加 `windows_service` 会在启动时失败，并报 `'receivers' unknown type: "windows_service"`——而且**升级版本也无法解决这个问题**，因为它没有随任何已发布的 `otelcol-contrib` 构建一起提供。该接收器还处于 **alpha** 阶段，且**仅支持 Windows**。

要获得包含它的 collector，你有两种方式。如果你不需要按服务粒度的状态，可完全跳过本节——主机指标、Windows 事件日志以及其他所有内容都能在标准 collector 上正常工作。

#### Option A——使用 OneUptime Host Collector（推荐）

OneUptime 发布了一个预构建的 collector——**OneUptime Host Collector**——它已经包含 `windows_service`（以及 `hostmetrics`、`windowseventlog`、`filelog` 和 OTLP 导出器）。无需 Go 工具链，也无需自行构建。

1. 从 [OneUptime 发布页面](https://github.com/OneUptime/oneuptime/releases)下载 Windows 资产——可以是 `oneuptime-host-collector_windows_amd64.zip`（或 `_arm64.zip`），也可以是 `oneuptime-host-collector-amd64.msi` 安装程序。
2. 解压到 `C:\Program Files\OneUptimeHostCollector\`（MSI 会为你安装到那里）。压缩包中附带的 `config.yaml` 已经启用了 `windows_service`。
3. 编辑 `config.yaml` 并设置你的 `x-oneuptime-token`（如果你自托管，还需设置端点）。
4. 从**提升权限的** PowerShell 提示符下将其注册为 Windows 服务并启动：

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe start "OneUptimeHostCollector"
```

它以 `LocalSystem` 身份运行（`sc.exe` 的默认设置），因此能够读取每个服务。一旦指标到达，**Services** 标签页便会自动填充。这同样是适用于 Linux/macOS 的 collector（那些资产只是省略了仅支持 Windows 的接收器）。

#### Option B——用 `ocb` 自行构建

如果你更愿意自行构建 collector（或者已经在运行自定义发行版），请用 [OpenTelemetry Collector Builder（`ocb`）](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder) 编译一个。

**1. 用 `ocb` 构建自定义 collector。** 创建 `builder-config.yaml`（让每个版本都保持在同一个 collector 发布版上）：

```yaml
dist:
  name: otelcol-oneuptime
  description: OpenTelemetry Collector with the Windows service receiver
  output_path: ./otelcol-oneuptime
  otelcol_version: 0.154.0

receivers:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/hostmetricsreceiver v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/windowseventlogreceiver v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/windowsservicereceiver v0.154.0

processors:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourcedetectionprocessor v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourceprocessor v0.154.0
  - gomod: go.opentelemetry.io/collector/processor/batchprocessor v0.154.0

exporters:
  - gomod: go.opentelemetry.io/collector/exporter/otlphttpexporter v0.154.0
```

然后构建它（需要 Go）——输出是单个 `otelcol-oneuptime.exe`，你可用它来代替 `otelcol-contrib` 运行：

```powershell
go install go.opentelemetry.io/collector/cmd/builder@v0.154.0
builder --config builder-config.yaml
```

**2. 启用该接收器**，在你的 `config.yaml` 中添加它，并将它加入指标流水线：

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

该接收器为每个服务发出一个 `windows.service.status` 量规（gauge）——其整数值为 Win32 服务状态（`4` = 正在运行，`1` = 已停止）——并带有 `name` 和 `startup_mode` 属性。以 `LocalSystem` 身份运行该 collector（`sc.exe create` 的默认设置），它便能读取每个服务；任何无法打开的服务都会被跳过。由于该接收器处于 alpha 阶段，请在投入生产前固定并测试版本——已知问题包括一个可能导致 collector 崩溃的抓取错误，以及某一个服务上的 `access denied` 会影响到其他服务；如果遇到这些问题，请用 `include_services` 加以限制。

### 完整示例——Linux 主机

`/etc/otelcol-contrib/config.yaml`：

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

### 完整示例——macOS 主机

`/etc/otelcol-contrib/config.yaml`：

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

### 完整示例——Windows 主机

`C:\Program Files\otelcol-contrib\config.yaml`：

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

  # Windows service status (the Services tab) needs the windows_service
  # receiver, which is NOT in the prebuilt collector — see
  # "Windows Services (metrics)" above to build a collector that includes it.

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
      receivers: [hostmetrics]
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

## 第 3 步——将 collector 作为服务运行

### Linux（systemd）

Debian / RPM 软件包已经安装了一个 systemd 单元。只需启用并启动它：

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

要跟踪 collector 自身的日志：

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS（launchd）

创建 `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`：

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

加载它：

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows（Services）

从**提升权限的** PowerShell 提示符下：

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

该服务默认以 `LocalSystem` 身份运行，它拥有读取 `Security` Windows 事件日志通道所需的权限。

## 第 4 步——在 OneUptime 中验证

1. 在主机上产生一些信号：
   - **Linux / macOS：** `logger "hello from oneuptime"`（写入 syslog / journald）。
   - **Windows：** 从提升权限的提示符下执行 `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"`。
2. 在 OneUptime 仪表板中，打开 **Telemetry → Services** 并选择你配置的 `service.name`。
3. 打开 **Metrics**——主机指标（CPU、内存、文件系统等）应在一分钟内出现。
4. 打开 **Logs**——你的文件日志 / journald 条目 / Windows 事件日志应正在流式传入。有用的可搜索属性包括 `log.file.name`、`systemd.unit`、`winlog.channel`、`winlog.event_id` 和 `winlog.provider.name`。

## 自托管 OneUptime

如果你正在自托管 OneUptime，请将导出器指向你自己的主机：

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

如果你的实例仅支持 HTTP，请将协议方案改为 `http://` 并使用相应的端口。

## 在代理后面

OpenTelemetry Collector 遵循标准的 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` 环境变量。在服务上设置它们：

- **systemd（Linux）：** 放入 `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf`，内容为 `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`，然后执行 `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`。
- **launchd（macOS）：** 在 plist 中添加一个 `<EnvironmentVariables>` 字典。
- **Windows 服务：** 通过 `sc.exe config` 或注册表中 `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment` 下的项在服务上设置环境变量。

## 故障排查

- **OneUptime 中未出现任何遥测数据**
  - 向配置中添加 `service.telemetry.logs.level: debug` 并重启 collector 以获得详细输出。
  - **Linux / macOS：** `journalctl -u otelcol-contrib -f`（Linux）或 `tail -f /var/log/otelcol-contrib.err.log`（macOS）。
  - **Windows：** 在 *Event Viewer → Windows Logs → Application* 下查找来源为 `otelcol-contrib` 的条目。
  - 确认主机能够访问 `https://oneuptime.com/otlp`（或你的自托管端点）：从同一台机器执行 `curl -v https://oneuptime.com/otlp`。
- **导出器返回 HTTP 401**——接入令牌无效或已被吊销。从 *Project Settings → Telemetry Ingestion Keys* 生成一个新令牌。
- **`Security` Windows 事件日志返回拒绝访问（access denied）**——该服务未以足够的权限运行。在 `LocalSystem` 身份下重新创建它（`sc.exe create` 的默认设置），或为服务账户授予 *Manage auditing and security log* 用户权限。
- **`journald` 接收器无法启动**——确保 `journalctl` 在 collector 的 `PATH` 中，并且 `/var/log/journal` 存在（如不存在，请运行 `sudo systemd-tmpfiles --create --prefix /var/log/journal`）。
- **流量 / 成本过高**——缩小接收器范围（特定的 Windows 通道、特定的 systemd 单元、特定的日志文件），在 Windows 事件日志接收器上添加 `query:` 过滤器，或添加一个 `filter` 处理器以在导出前丢弃低严重性事件。

## 后续步骤

- 添加 **Logs Monitors（日志监控器）**以针对特定日志模式告警（例如，当 5 分钟窗口内发生超过 5 次 `winlog.event_id = 4625` 登录失败时告警）。
- 在主机指标上添加 **Metrics Monitors（指标监控器）**（CPU 饱和、磁盘空间不足、交换空间使用率）。
- 将其与[服务器 / 虚拟机监控器（Server / VM Monitor）](/docs/monitor/server-monitor)以及 [OneUptime 基础设施代理（Infrastructure Agent）](/docs/monitor/server-monitor)结合，以实现端到端的主机可见性。
- 通过 Ansible / Chef / Puppet / 组策略（Group Policy）/ Intune / 你现有的配置管理工具，将相同的配置分发到每台主机。
