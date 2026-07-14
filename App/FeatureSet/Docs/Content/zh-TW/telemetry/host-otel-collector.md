# 主機 OpenTelemetry Collector（Linux、macOS、Windows）

## 概述

您可以直接在 Linux、macOS 或 Windows 主機上將 **OpenTelemetry Collector** 作為服務執行，透過 OTLP 將主機遙測資料傳送至 OneUptime。本頁將逐步說明如何安裝 collector、為每種作業系統進行設定，以及根據您想要收集的內容選擇合適的 receiver：

- 在所有作業系統上收集**主機指標**（CPU、記憶體、磁碟、檔案系統、網路、負載、行程）
- 透過 [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver) 收集 `/var/log/**` 下的**檔案型日誌**（Linux、macOS）
- 透過 [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver) 收集 **systemd journal**（Linux）
- 透過 [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) 包裝 tail 的 `log stream` 輸出來收集 **Apple Unified Log**（macOS）
- 透過 [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver) 收集 **Windows 事件記錄**
- 透過 [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) 收集 **Windows 服務狀態**（用於驅動主機的 **Services** 分頁）— 自 **v0.155.0** 起已內建於上游的 `otelcol-contrib` 建置中（請參閱下方「Windows 服務（指標）」）

> **那 OneUptime Infrastructure Agent 呢？** 該 agent 是一個獨立、輕量的 Go daemon，專注於基本指標與 _Server / VM Monitor_ 功能（狀態、行程、警示）。此處描述的 OpenTelemetry Collector 是獨立的，當您想要將日誌（檔案日誌、journald、Windows 事件記錄）或更豐富的主機指標作為標準 OTLP 擷取時，它是合適的工具。兩者可以在同一台主機上執行而互不干擾。

## 先決條件

- 一個 **OneUptime Telemetry Ingestion Token** — 從 _Project Settings → Telemetry Ingestion Keys_ 建立一個並複製 `x-oneuptime-token` 值。
- **OpenTelemetry Collector Contrib** 發行版（`otelcol-contrib`）。預設的 `otelcol` 建置**不**包含像 `windowseventlogreceiver`、`journaldreceiver` 或 `hostmetrics` 額外功能的 receiver — 請務必使用 `contrib` 發行版。驅動 Windows **Services** 分頁的 alpha 階段 `windowsservicereceiver` 自 **v0.155.0** 起已內建於 `otelcol-contrib` 中，因此請安裝目前的版本；請參閱下方「Windows 服務（指標）」。
- 主機上的 Root / Administrator 權限，以將 collector 安裝為服務並（在適用時）讀取具有權限限制的日誌來源。

## 步驟 1 — 安裝 OpenTelemetry Collector

選擇適合您作業系統的章節。所有範例都假設您正在從 [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) 安裝最新的 `otelcol-contrib` 版本。

### Linux（Debian / Ubuntu）

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.156.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian 套件會將二進位檔安裝在 `/usr/bin/otelcol-contrib`、預設設定在 `/etc/otelcol-contrib/config.yaml`，以及一個 systemd unit 在 `/etc/systemd/system/otelcol-contrib.service`。

### Linux（RHEL / CentOS / Fedora / Amazon Linux）

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.156.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

路徑與 Debian 套件相同（`/usr/bin/otelcol-contrib`、`/etc/otelcol-contrib/config.yaml`、systemd unit `otelcol-contrib`）。

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

您將在步驟 2 中建立 `/etc/otelcol-contrib/config.yaml`，並在步驟 3 中建立 `launchd` plist。

### Windows

在 Windows 上，請下載上游的 **`otelcol-contrib`** 版本 — 它內建了驅動主機 **Services** 分頁的 `windows_service` receiver（自 **v0.155.0** 起）。在**提升權限的** PowerShell 提示字元中：

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _windows_arm64.tar.gz asset on ARM
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_amd64.tar.gz" -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+
```

這會將 `otelcol-contrib.exe` 解壓縮到 `C:\Program Files\otelcol-contrib`。您將在步驟 2 中於同一資料夾建立 `config.yaml`，並在步驟 3 中註冊一個 Windows 服務。

> 偏好使用原生安裝程式？OpenTelemetry 也在同一個 [releases 頁面](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) 上發佈一個已簽署的 **`.msi`**（`otelcol-contrib_<version>_windows_x64.msi`），它會為您將 collector 註冊為 Windows 服務。如果您使用它，請將它指向步驟 2 的 `config.yaml`，並確保該服務以 `LocalSystem` 執行，讓 **Services** 分頁能夠讀取 Service Control Manager。

## 步驟 2 — 設定 collector

設定檔位於：

| 作業系統 | 路徑                                                  |
| -------- | ----------------------------------------------------- |
| Linux    | `/etc/otelcol-contrib/config.yaml`                    |
| macOS    | `/etc/otelcol-contrib/config.yaml`                    |
| Windows  | `C:\Program Files\otelcol-contrib\config.yaml` |

每個設定都遵循相同的結構 — 選擇您想要的 receiver、新增一個 `batch` 和 `resource` processor，並透過 OTLP HTTP 匯出至 OneUptime。下方範例為每種作業系統顯示一份完整、可複製貼上的設定，然後逐一說明每個 receiver 區塊，讓您可以自由搭配組合。

替換 `YOUR_TELEMETRY_INGESTION_TOKEN` 和 `service.name` 值以符合您的環境。

### 共用部分（每種作業系統都會用到）

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

- **`batch`** 在匯出前將記錄分組，這樣您就不必為每筆記錄付出一次 HTTP 往返。
- **`resource`** 為每筆記錄標記 `service.name`。如果您希望每台機器在 OneUptime 中以其各自的遙測服務出現，請為每台主機使用不同的值（例如 `prod-web-01`）。
- **`otlphttp`** 透過 HTTPS 傳送至 OneUptime，並附上擷取權杖。

### 主機指標（Linux、macOS、Windows）

適用於所有作業系統。從主機核心收集 CPU、記憶體、磁碟、檔案系統、網路、負載、分頁與行程指標：

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

> 在 Linux 上，collector 會讀取 `/proc` 與 `/sys`。當 collector 在容器中執行時，請掛載主機的 `/proc` 與 `/sys` 並設定 `HOST_PROC` / `HOST_SYS` 環境變數。當它直接作為 systemd 服務執行時（如上方安裝方式），則不需要額外設定。

### 檔案日誌（Linux、macOS）

tail 磁碟上的任何日誌檔。以下是一組常見的入門集合：

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

`start_at: end` 表示從 collector 啟動的那一刻起的新行；改為 `beginning` 可在首次執行時回填。collector 會追蹤檔案偏移量，因此會在重新啟動之間正確地恢復。

**將主機日誌堆疊追蹤轉換為 Exceptions。** OneUptime 會自動掃描 error 和 fatal 日誌行中的堆疊追蹤，並將其彙整到 **Exceptions**（Issues）檢視中，歸屬於此主機 — 不需要額外設定。為了讓分組效果良好，多行堆疊追蹤（Java、Python、.NET、Ruby）必須以**一筆**日誌記錄的形式抵達，而非每行一筆記錄。在 `filelog` receiver 上啟用多行重組，讓追蹤及其框架保持在一起：

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

如果沒有重組，每個框架都會作為獨立的日誌被擷取，而例外狀況將顯示為單行、分組不佳的問題。如果您的應用程式可以直接發出 OpenTelemetry 的 `exception.type` / `exception.message` / `exception.stacktrace` 日誌屬性，請改採此方式 — 這是最可靠的路徑，且不依賴多行解析。

### systemd journal（Linux）

如果您的主機使用 systemd，`journald` receiver 通常比 tail `/var/log/*` 更合適 — 它將所有內容捕捉在一處，並保留結構化欄位：

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

collector 二進位檔必須能夠執行 `journalctl`（Debian / RPM 套件已將其作為相依套件包含在內）。

### Apple Unified Log（macOS）

macOS 已棄用 `/var/log/system.log`，改用 Apple Unified Log，並透過 `log show` / `log stream` 進行查詢。擷取它最簡單的方法是透過 `filelog` receiver 搭配一個小型包裝程式來串流 `log` 輸出。建立 `/usr/local/otelcol-contrib/log-stream.sh`：

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

將其設為可執行，在 launchd 下執行它（或用 `nohup` 進行快速測試），然後將 collector 指向該檔案：

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

（如果您不需要 unified log，請跳過此步驟 — Mac 機群通常只需要主機指標 + 幾個檔案日誌就能良好運作。）

### Windows 事件記錄

透過原生 `wevtapi` 訂閱您關注的頻道：

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

要將高流量的 `Security` 頻道縮小至特定事件 ID：

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

要讀取自訂或應用程式特定的頻道（您在 _Event Viewer → Applications and Services Logs_ 下能看到的任何頻道），請使用其確切的顯示名稱：

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows 服務（指標）

主機 **Services** 分頁由 [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver)（設定類型 `windows_service`）驅動，它會將 Windows 服務的執行狀態與啟動類型以指標形式回報。

**此 receiver 自 v0.155.0 起隨附於上游的 `otelcol-contrib` 二進位檔中** — 在較早的版本上，加入 `windows_service` 會在啟動時失敗並出現 `'receivers' unknown type: "windows_service"`。請安裝目前的版本（步驟 1），然後在您的 `config.yaml` 中啟用它，並將它加入指標管線：

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

該 receiver 會為每個服務發出一個 `windows.service.status` gauge — 該整數是 Win32 服務狀態（`4` = 執行中，`1` = 已停止）— 並帶有 `name` 與 `startup_mode` 屬性。以 `LocalSystem`（`sc.exe` 的預設值）執行該 collector，讓它能夠讀取每個服務；任何無法開啟的服務都會被略過。此 receiver 處於 **alpha** 階段且**僅適用於 Windows**；已知問題包括可能使 collector 當機的抓取錯誤，以及某個服務的 `access denied` 會影響其他服務 — 如果遇到這些問題，請限制使用 `include_services`。

> **`include_services` 沒有作用？** 此篩選器只能*縮小*集合的範圍，因此如果您列出了服務卻仍看到每一個，那麼編輯後的設定幾乎肯定尚未套用到執行中的 collector。編輯後請重新啟動服務（步驟 3）；確保 `include_services` 是一個已填入內容的清單，且與 `collection_interval` 縮排相同（而非保持註解狀態或留空）；並給 **Services** 分頁幾分鐘的時間，讓變更前回報的服務從其滾動視窗中淘汰。這些名稱是精確、區分大小寫的 Windows 服務 _key_ 名稱（例如 `Spooler`、`W3SVC`），您可以使用 `Get-Service | Select-Object Name` 列出它們。

### 完整範例 — Linux 主機

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

### 完整範例 — macOS 主機

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

### 完整範例 — Windows 主機

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

## 步驟 3 — 將 collector 作為服務執行

### Linux（systemd）

Debian / RPM 套件已安裝了一個 systemd unit。只需啟用並啟動它：

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

要追蹤 collector 自身的日誌：

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS（launchd）

建立 `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`：

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

載入它：

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows（Services）

從**提升權限的** PowerShell 提示字元中：

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector (OneUptime)"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

該服務預設在 `LocalSystem` 下執行，它具有讀取 `Security` Windows 事件記錄頻道與每個 Windows 服務所需的權限。

## 步驟 4 — 在 OneUptime 中驗證

1. 在主機上產生一些訊號：
   - **Linux / macOS：** `logger "hello from oneuptime"`（寫入 syslog / journald）。
   - **Windows：** 從提升權限的提示字元執行 `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"`。
2. 在 OneUptime 儀表板中，開啟 **Telemetry → Services** 並選擇您設定的 `service.name`。
3. 開啟 **Metrics** — 主機指標（CPU、記憶體、檔案系統等）應在一分鐘內出現。
4. 開啟 **Logs** — 您的檔案日誌 / journald 項目 / Windows 事件記錄應正在串流進來。實用的可搜尋屬性包括 `log.file.name`、`systemd.unit`、`winlog.channel`、`winlog.event_id` 與 `winlog.provider.name`。

## 減少收集的資料量

由於 collector 設定由您掌控，因此離開主機的內容完全由您決定 — 除非您新增的某個 receiver 要求，否則不會收集任何內容。如果某台主機傳送的資料量超過您的需求（這會呈現為較高的擷取量，且在 OneUptime Cloud 上會導致較高的成本），請在此進行調整。兩個最大的槓桿是**您 tail 哪些日誌來源**與**您多久抓取一次指標**；其餘的則由 `filter` processor 處理。

原則與設定本身相同：**只新增您會查看其資料的 receiver**，然後在其中進行精簡。下方的每項變更都是對 `config.yaml` 的編輯 — 套用後請重新啟動 collector（步驟 3）。

### 資料量的來源

| Signal               | Biggest driver                              | Turn it down with                                                    |
| -------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| **日誌**             | 來自每個檔案 / journald unit / 頻道的每一行 | 縮小 receiver 範圍；`query:` 篩選器；針對嚴重性的 `filter` processor |
| **主機指標**         | 抓取頻率 × series 數量                      | `collection_interval`；捨棄 `process` scraper；scraper 的選擇        |
| **指標 cardinality** | 每個行程的指標（每個行程一組 series）       | 省略或限定 `process` scraper 的範圍                                  |

### 槓桿 1 — 只 tail 您需要的日誌來源

日誌幾乎總是最大的一部分。collector 只讀取您列出的內容，因此解決方法就是列出更少的內容：

- **檔案** — 將 `filelog` 指向特定路徑，而非廣泛的 glob。使用 `/var/log/myapp/error.log` 而非 `/var/log/**`。
- **journald** — 將 `units:` 限制為您關注的服務，並提高 `priority:`，以在來源端捨棄冗長的 `info`/`debug` 項目：

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Windows 事件記錄** — `Security` 頻道是流量遠高於其他頻道的頻道。使用 `query:` 將其縮小至您實際稽核的事件 ID（如上方 [Windows 事件記錄](#windows-event-logs) 所示），或在您不需要時完全捨棄該頻道。

### 槓桿 2 — 放慢指標間隔

`hostmetrics` 的資料量與 `collection_interval` 成正比。如果您不需要 30 秒的解析度，60s 可將資料點數量減半：

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### 槓桿 3 — 捨棄每個行程的 scraper（cardinality 的主因）

`process` scraper 會為主機上**每個執行中的行程**發出一組獨立的 series — 在繁忙的機器上，這是指標 cardinality 的最大單一來源。除非您需要每個行程的 CPU/記憶體，否則請將它排除在 `scrapers:` 清單之外。保留 `processes`（它只是少數幾個彙總的行程計數指標）— 它很廉價。如果您確實想要每個行程的指標，請將其限定在重要的行程上：

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

### 槓桿 4 — 使用 `filter` processor 捨棄低價值記錄

當您想要該 receiver 但不想要它的全部輸出時，請新增一個 [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) processor — 它會評估一個 [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) 條件，並在匯出任何內容之前**捨棄任何符合的記錄**。

捨棄低於嚴重性門檻的日誌：

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        - "severity_number < SEVERITY_NUMBER_WARN"
```

捨棄您不繪製圖表的特定吵雜指標：

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "system.paging.faults"'
```

接著將該 processor 加入相關的管線 — 順序很重要，因此請將 `filter` 放在 `batch` 之前：

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

### 精簡的起點

一台**僅指標**的主機 — 沒有日誌、粗略的間隔、沒有每個行程的 series — 是最小的實用佔用量：

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

當您需要時，可使用範圍狹窄的 `filelog` 或 `journald` receiver 重新加回 `logs` 管線。

> **留意您所刪減的內容。** 基於日誌的警示需要日誌抵達：如果您篩選掉某個嚴重性或某個頻道，以其為依據的 monitor 就會靜默。請精簡您不會採取行動的來源，而非某個 monitor 正在監看的來源。一次變更一個槓桿，並在 **Project Settings → Usage History** 下確認資料量下降（使用量以每日彙總，因此請給它一兩天的時間）後，再進行下一項。

## 自架 OneUptime

如果您自架 OneUptime，請將 exporter 指向您自己的主機：

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

如果您的執行個體僅支援 HTTP，請將 scheme 改為 `http://` 並使用適當的連接埠。

## 在 proxy 後方

OpenTelemetry Collector 遵循標準的 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` 環境變數。在服務上設定它們：

- **systemd（Linux）：** 放入 `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf`，內容為 `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`，然後執行 `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`。
- **launchd（macOS）：** 在 plist 中新增一個 `<EnvironmentVariables>` dict。
- **Windows 服務：** 透過 `sc.exe config` 或登錄檔中 `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment` 下設定服務的環境變數。

## 疑難排解

- **OneUptime 中沒有出現任何遙測資料**
  - 在設定中新增 `service.telemetry.logs.level: debug` 並重新啟動 collector 以取得詳細輸出。
  - **Linux / macOS：** `journalctl -u otelcol-contrib -f`（Linux）或 `tail -f /var/log/otelcol-contrib.err.log`（macOS）。
  - **Windows：** 在 _Event Viewer → Windows Logs → Application_ 下尋找來源 `otelcol-contrib`。
  - 確認主機可以連線到 `https://oneuptime.com/otlp`（或您自架的端點）：從同一台機器執行 `curl -v https://oneuptime.com/otlp`。
- **exporter 傳回 HTTP 401** — 擷取權杖無效或已撤銷。從 _Project Settings → Telemetry Ingestion Keys_ 產生一個新的。
- **`Security` Windows 事件記錄傳回 access denied** — 該服務未以足夠的權限執行。在 `LocalSystem` 下重新建立它（`sc.exe create` 的預設值），或授予服務帳戶 _Manage auditing and security log_ 使用者權限。
- **`journald` receiver 無法啟動** — 確保 `journalctl` 在 collector 的 `PATH` 上，且 `/var/log/journal` 存在（若不存在，請執行 `sudo systemd-tmpfiles --create --prefix /var/log/journal`）。
- **高流量 / 高成本** — 請參閱 [減少收集的資料量](#reducing-the-volume-of-data-collected)：縮小 receiver 範圍（特定 Windows 頻道、systemd units、日誌檔）、提高指標的 `collection_interval`、捨棄每個行程的 scraper，或新增一個 `filter` processor 以在匯出前捨棄低嚴重性記錄。

## 後續步驟

- 新增 **Logs Monitors** 以針對特定日誌模式發出警示（例如，當 5 分鐘視窗內發生超過 5 次 `winlog.event_id = 4625` 登入失敗時發出警示）。
- 在主機指標上新增 **Metrics Monitors**（CPU 飽和、磁碟空間不足、swap 使用量）。
- 將此與 [Server / VM Monitor](/docs/monitor/server-monitor) 和 [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) 結合，以實現端對端的主機可見性。
- 透過 Ansible / Chef / Puppet / Group Policy / Intune / 您現有的設定管理工具，將相同的設定傳送至每台主機。
