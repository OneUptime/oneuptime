# 主机 OpenTelemetry Collector（Linux、macOS、Windows）

## 概述

你可以直接在 Linux、macOS 或 Windows 主机上将 **OpenTelemetry Collector** 作为服务运行，通过 OTLP 将主机遥测数据发送到 OneUptime。本页将逐步介绍如何安装该 collector、为每种操作系统进行配置，以及根据你想采集的内容选择合适的接收器（receiver）：

- 适用于所有操作系统的**主机指标**（CPU、内存、磁盘、文件系统、网络、负载、进程）
- 通过 [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver) 采集 `/var/log/**` 下的**基于文件的日志**（Linux、macOS）
- 通过 [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver) 采集 **systemd journal**（Linux）
- 通过 [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) 包装对 `log stream` 输出的 tail 来采集 **Apple Unified Log**（macOS）
- 通过 [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver) 采集 **Windows 事件日志**
- 通过 [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) 采集 **Windows 服务状态**（为主机的 **Services** 标签页提供数据）—— 从 **v0.155.0** 起已打包进上游的 `otelcol-contrib` 构建中（见下文“Windows 服务（指标）”）

> **那么 OneUptime 基础设施代理（Infrastructure Agent）呢？** 该代理是一个独立的、轻量级的 Go 守护进程，专注于基础指标和*服务器 / 虚拟机监控器（Server / VM Monitor）*功能（状态、进程、告警）。这里描述的 OpenTelemetry Collector 是独立的，当你希望将日志（文件日志、journald、Windows 事件日志）或更丰富的主机指标作为标准 OTLP 数据接入时，它是合适的工具。两者可以在同一台主机上运行而互不干扰。

## 前提条件

- 一个 **OneUptime 遥测接入令牌（Telemetry Ingestion Token）**——从 _Project Settings → Telemetry Ingestion Keys_ 创建一个，并复制 `x-oneuptime-token` 值。
- **OpenTelemetry Collector Contrib** 发行版（`otelcol-contrib`）。默认的 `otelcol` 构建**不**包含诸如 `windowseventlogreceiver`、`journaldreceiver` 或 `hostmetrics` 附加项之类的接收器——请务必使用 `contrib` 发行版。为 Windows **Services** 标签页提供数据的 alpha 阶段 `windowsservicereceiver` 从 **v0.155.0** 起已打包进 `otelcol-contrib` 中，因此请安装较新的发布版；见下文“Windows 服务（指标）”。
- 主机上的 root / 管理员权限，用于将 collector 安装为服务，并（在适用的情况下）读取需要特权的日志源。

## 第 1 步——安装 OpenTelemetry Collector

选择适合你操作系统的小节。所有示例都假设你从 [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) 安装最新的 `otelcol-contrib` 发布版。

### Linux（Debian / Ubuntu）

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.156.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian 软件包会将二进制文件安装到 `/usr/bin/otelcol-contrib`，将默认配置安装到 `/etc/otelcol-contrib/config.yaml`，并将一个 systemd 单元安装到 `/etc/systemd/system/otelcol-contrib.service`。

### Linux（RHEL / CentOS / Fedora / Amazon Linux）

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.156.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

路径与 Debian 软件包相同（`/usr/bin/otelcol-contrib`、`/etc/otelcol-contrib/config.yaml`、systemd 单元 `otelcol-contrib`）。

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

你将在第 2 步中创建 `/etc/otelcol-contrib/config.yaml`，并在第 3 步中创建一个 `launchd` plist。

### Windows

在 Windows 上，请下载上游的 **`otelcol-contrib`** 发布版——它打包了为主机的 **Services** 标签页提供数据的 `windows_service` 接收器（从 **v0.155.0** 起）。在**提升权限的** PowerShell 提示符下：

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _windows_arm64.tar.gz asset on ARM
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_amd64.tar.gz" -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+
```

这会将 `otelcol-contrib.exe` 解压到 `C:\Program Files\otelcol-contrib`。你将在第 2 步中在同一文件夹里创建 `config.yaml`，并在第 3 步中注册一个 Windows 服务。

> 更偏好原生安装程序？OpenTelemetry 还在同一个[发布页面](https://github.com/open-telemetry/opentelemetry-collector-releases/releases)上发布了一个已签名的 **`.msi`**（`otelcol-contrib_<version>_windows_x64.msi`），它会为你将 collector 注册为一个 Windows 服务。如果你使用它，请让它指向第 2 步中的 `config.yaml`，并确保该服务以 `LocalSystem` 身份运行，这样 **Services** 标签页才能读取服务控制管理器（Service Control Manager）。

## 第 2 步——配置 collector

配置文件位于：

| 操作系统 | 路径                                                  |
| -------- | ----------------------------------------------------- |
| Linux    | `/etc/otelcol-contrib/config.yaml`                    |
| macOS    | `/etc/otelcol-contrib/config.yaml`                    |
| Windows  | `C:\Program Files\otelcol-contrib\config.yaml` |

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
          layout: "%Y-%m-%d %H:%M:%S.%f%j"
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

要读取自定义或特定于应用程序的通道（任何你能在 _Event Viewer → Applications and Services Logs_ 下看到的内容），请使用其确切的显示名称：

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows 服务（指标）

主机的 **Services** 标签页由 [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver)（配置类型 `windows_service`）提供数据，它以指标形式报告 Windows 服务的运行状态和启动类型。

**从 v0.155.0 起，该接收器已随上游的 `otelcol-contrib` 二进制文件一起提供**——在更早的发布版上，添加 `windows_service` 会在启动时失败并报 `'receivers' unknown type: "windows_service"`。请安装一个较新的发布版（第 1 步），然后在你的 `config.yaml` 中启用它，并将它加入指标流水线：

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

该接收器为每个服务发出一个 `windows.service.status` 量规（gauge）——其整数值为 Win32 服务状态（`4` = 正在运行，`1` = 已停止）——并带有 `name` 和 `startup_mode` 属性。以 `LocalSystem` 身份运行该 collector（`sc.exe` 的默认设置），它便能读取每个服务；任何无法打开的服务都会被跳过。该接收器处于 **alpha** 阶段，且**仅支持 Windows**；已知问题包括一个可能导致 collector 崩溃的抓取错误，以及某一个服务上的 `access denied` 会影响到其他服务——如果遇到这些问题，请用 `include_services` 加以限制。

> **`include_services` 不起作用？** 该过滤器只会*缩小*集合，所以如果你列出了一些服务却仍然看到每一个服务，那么编辑后的配置几乎肯定还没有到达正在运行的 collector。编辑后请重启该服务（第 3 步）；确保 `include_services` 是一个已填充内容的列表，且与 `collection_interval` 保持相同的缩进（不要将它注释掉或留空）；并给 **Services** 标签页几分钟时间，让在更改之前上报的服务从其滚动窗口中过期消失。这些名称是精确的、区分大小写的 Windows 服务_键_名称（例如 `Spooler`、`W3SVC`），你可以用 `Get-Service | Select-Object Name` 将它们列出。

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
  DisplayName= "OpenTelemetry Collector (OneUptime)"

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

## 减少采集的数据量

由于 collector 配置由你掌控，你可以精确决定哪些数据离开主机——除非你添加的某个接收器主动请求，否则不会采集任何数据。如果某台主机发送的数据超出了你的需要（表现为更高的接入量，在 OneUptime Cloud 上还意味着更高的成本），请在此进行调优。两个最大的调节杠杆是**你 tail 哪些日志源**以及**你抓取指标的频率**；其余的交给 `filter` 处理器。

其原则与配置本身相同：**只添加你会查看其数据的接收器**，然后在这些接收器内部进行削减。下面的每项更改都是对 `config.yaml` 的一次编辑——应用它并重启 collector（第 3 步）。

### 数据量的来源

| 信号         | 最大来源                                | 如何降低                                                      |
| ------------ | --------------------------------------- | ------------------------------------------------------------- |
| **日志**     | 每个文件 / journald 单元 / 通道的每一行 | 缩小接收器范围；`query:` 过滤器；针对严重性的 `filter` 处理器 |
| **主机指标** | 抓取频率 × 时间序列数量                 | `collection_interval`；丢弃 `process` 抓取器；抓取器选择      |
| **指标基数** | 每进程指标（每个进程一组时间序列）      | 省略或限定 `process` 抓取器                                   |

### 杠杆 1——只 tail 你需要的日志源

日志几乎总是最大的一块。collector 只读取你列出的内容，所以解决办法就是少列一些：

- **文件**——将 `filelog` 指向具体路径，而不是宽泛的通配符。用 `/var/log/myapp/error.log` 而不是 `/var/log/**`。
- **journald**——将 `units:` 限制为你关心的服务，并提高 `priority:`，从而在源头丢弃啰嗦的 `info`/`debug` 条目：

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Windows 事件日志**——`Security` 通道的流量远高于其他通道。用 `query:` 将其缩小到你确实会审计的事件 ID（如上文 [Windows 事件日志](#windows-事件日志) 所示），如果不需要则直接丢弃整个通道。

### 杠杆 2——放慢指标的采集间隔

`hostmetrics` 的数据量与 `collection_interval` 直接成正比。如果你不需要 30 秒的分辨率，60s 可将数据点数量减半：

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### 杠杆 3——丢弃每进程抓取器（基数的驱动因素）

`process` 抓取器会为主机上**每一个正在运行的进程**发出一组独立的时间序列——在繁忙的机器上，这是指标基数的最大单一来源。除非你需要每进程的 CPU/内存，否则请将它从 `scrapers:` 列表中省去。保留 `processes`（它只是少数几个聚合的进程计数指标）——它很廉价。如果你确实想要每进程指标，请将它们限定到真正重要的进程：

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

### 杠杆 4——用 `filter` 处理器丢弃低价值记录

当你想要某个接收器但不想要它的全部输出时，添加一个 [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) 处理器——它会评估一个 [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) 条件，并在导出任何内容之前**丢弃任何匹配的记录**。

丢弃低于某个严重性阈值的日志：

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

> **不要去掉 `UNSPECIFIED` 保护条件。** `SEVERITY_NUMBER_UNSPECIFIED` 是 `0`，而 `SEVERITY_NUMBER_WARN` 是 `13`，因此裸写的 `severity_number < SEVERITY_NUMBER_WARN` 就是 `0 < 13`——**对于每一条严重性从未被解析过的记录都为真**。一个普通的 `filelog` 接收器并不会从日志行中解析严重性：本页的 `filelog` 示例都没有设置 `operators:`，因此这些记录到达过滤器时带着 `severity_number: 0`。没有该保护条件，这个条件会悄悄删除 `/var/log/syslog`、`/var/log/messages` 和 `/var/log/auth.log` 的 **100%** 内容——而且任何地方都不会报错。有了该保护条件，未被分类的记录会被保留，你会看到它们以严重性 `Unspecified` 的形式到达 OneUptime，这会告诉你：你真正需要的其实是一个严重性解析器。

要*正确地*按严重性过滤文件日志，请先在接收器上用一个 [`severity_parser`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/severity_parser.md) 算子解析出严重性，这样记录在到达过滤器之前就带有真实的级别：

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

在 systemd 主机上，你完全不需要这些——`journald` 的 `priority:`（杠杆 1）会在 `journalctl` 内部、在 OTel 记录存在之前就按级别过滤。

丢弃你不绘制图表的指标——按精确名称，或者按模式：

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

通过反转条件来**只**发送一组固定的指标（一个允许列表）——`filter` 会丢弃匹配的内容，因此 `not (...)` 会丢弃你没有点名的所有内容：

```yaml
processors:
  filter/allowlist:
    error_mode: ignore
    metrics:
      metric:
        - 'not (name == "system.cpu.utilization" or name == "system.memory.utilization" or name == "system.filesystem.utilization")'
```

请把该条件保持在**一行**内。允许列表是一把大锤：你忘记点名的任何内容都会消失，构建在其之上的监控器也会随之消失。请优先丢弃你不想要的少数几个指标，或者干脆省去产生它们的抓取器（杠杆 3）——从不采集的指标，过滤起来毫无开销。

然后将该处理器添加到相关的流水线中——顺序很重要，所以要把 `filter` 放在 `batch` 之前：

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

> **正在编辑 OneUptime 为你生成的配置？** 上面的流水线与本页的完整示例相匹配。而来自仪表板（Hosts → Documentation）的配置对各项的命名有所不同：它的处理器是 `resourcedetection` 和 `batch`（**没有** `resource` 处理器），它的导出器是 `otlphttp/oneuptime`。引用一个未定义的处理器会让 collector 在启动时停止，并报出 `references processor "resource" which is not configured`。请把 filter 添加到已有的内容中，而不是把这个代码块粘贴上去覆盖它：
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
> 请保留 `resourcedetection`——OneUptime 会使用它所设置的 `host.name` / `host.id` 将遥测数据与主机进行匹配。那份生成的配置也是**仅指标**的：在你添加之前，它没有 `logs:` 流水线，因此在你在其旁边添加一个 `filelog` 或 `journald` 接收器之前，`filter/drop-low-severity` 没有任何可过滤的内容。

> **在 macOS 上，请使用 tarball，而不是 Homebrew。** Homebrew formula 提供的是**核心版（core）** collector，而 `filter` 是仅存在于 contrib 版中的处理器——无论你的 YAML 是否正确，collector 都会拒绝启动。

### 一个精简的起点

一个**仅指标**的主机——没有日志、粗粒度的间隔、没有每进程时间序列——是最小的有用占用：

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

当你需要时，再用一个范围狭窄的 `filelog` 或 `journald` 接收器把 `logs` 流水线加回来。

> **注意你所削减的内容。** 基于日志的告警需要日志能够到达：如果你过滤掉某个严重性或某个通道，那么以它为依据的监控器就会陷入沉默。请削减你不采取行动的日志源，而不是监控器正在监视的那些。每次只改动一个杠杆，并在 **Project Settings → Usage History** 下确认数据量下降（用量按天聚合，因此请等待一两天）后再进行下一步。

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
  - **Windows：** 在 _Event Viewer → Windows Logs → Application_ 下查找来源为 `otelcol-contrib` 的条目。
  - 确认主机能够访问 `https://oneuptime.com/otlp`（或你的自托管端点）：从同一台机器执行 `curl -v https://oneuptime.com/otlp`。
- **导出器返回 HTTP 401**——接入令牌无效或已被吊销。从 _Project Settings → Telemetry Ingestion Keys_ 生成一个新令牌。
- **`Security` Windows 事件日志返回拒绝访问（access denied）**——该服务未以足够的权限运行。在 `LocalSystem` 身份下重新创建它（`sc.exe create` 的默认设置），或为服务账户授予 _Manage auditing and security log_ 用户权限。
- **`journald` 接收器无法启动**——确保 `journalctl` 在 collector 的 `PATH` 中，并且 `/var/log/journal` 存在（如不存在，请运行 `sudo systemd-tmpfiles --create --prefix /var/log/journal`）。
- **流量 / 成本过高**——参见[减少采集的数据量](#减少采集的数据量)：缩小接收器范围（特定的 Windows 通道、特定的 systemd 单元、特定的日志文件），提高指标的 `collection_interval`，丢弃每进程抓取器，或添加一个 `filter` 处理器以在导出前丢弃低严重性记录。

## 后续步骤

- 添加 **Logs Monitors（日志监控器）**以针对特定日志模式告警（例如，当 5 分钟窗口内发生超过 5 次 `winlog.event_id = 4625` 登录失败时告警）。
- 在主机指标上添加 **Metrics Monitors（指标监控器）**（CPU 饱和、磁盘空间不足、交换空间使用率）。
- 将其与[服务器 / 虚拟机监控器（Server / VM Monitor）](/docs/monitor/server-monitor)以及 [OneUptime 基础设施代理（Infrastructure Agent）](/docs/monitor/server-monitor)结合，以实现端到端的主机可见性。
- 通过 Ansible / Chef / Puppet / 组策略（Group Policy）/ Intune / 你现有的配置管理工具，将相同的配置分发到每台主机。
