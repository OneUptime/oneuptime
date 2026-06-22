# 호스트 OpenTelemetry Collector (Linux, macOS, Windows)

## 개요

**OpenTelemetry Collector**를 Linux, macOS 또는 Windows 호스트에서 서비스로 직접 실행하여 호스트 텔레메트리를 OTLP를 통해 OneUptime으로 전송할 수 있습니다. 이 페이지에서는 Collector를 설치하고, 각 OS에 맞게 구성하며, 수집하려는 항목에 적합한 receiver를 선택하는 과정을 안내합니다:

- 모든 OS에서의 **호스트 메트릭** (CPU, 메모리, 디스크, 파일 시스템, 네트워크, 로드, 프로세스)
- [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)를 통한 `/var/log/**` 아래의 **파일 기반 로그** (Linux, macOS)
- [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)를 통한 **systemd journal** (Linux)
- 테일링된 `log stream` 출력을 래핑하는 [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor)를 통한 **Apple Unified Log** (macOS)
- [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)를 통한 **Windows Event Logs**
- [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver)를 통한 **Windows 서비스 상태** (호스트 **Services** 탭을 구동) — *업스트림 사전 빌드 Collector에는 포함되어 있지 않습니다. 사전 빌드된 **OneUptime Host Collector** 또는 사용자 지정 빌드를 사용하세요 (아래의 "Windows Services (메트릭)" 참조)*

> **OneUptime Infrastructure Agent는 어떤가요?** 그 에이전트는 기본 메트릭과 *Server / VM Monitor* 기능(상태, 프로세스, 알림)에 중점을 둔 별도의 경량 Go 데몬입니다. 여기에서 설명하는 OpenTelemetry Collector는 독립적이며, 로그(파일 로그, journald, Windows Event Logs)나 표준 OTLP로 수집되는 더 풍부한 호스트 메트릭을 원할 때 적합한 도구입니다. 둘 다 서로 간섭하지 않고 동일한 호스트에서 실행할 수 있습니다.

## 사전 요구 사항

- **OneUptime Telemetry Ingestion Token** — *Project Settings → Telemetry Ingestion Keys*에서 생성하고 `x-oneuptime-token` 값을 복사합니다.
- **OpenTelemetry Collector Contrib** 배포판(`otelcol-contrib`). 기본 `otelcol` 빌드에는 `windowseventlogreceiver`, `journaldreceiver` 또는 `hostmetrics` 추가 기능과 같은 receiver가 **포함되어 있지 않습니다** — 반드시 `contrib` 배포판을 사용하세요. 미리 알아두면 좋은 예외가 하나 있습니다: Windows **Services** 탭을 구동하는 alpha `windowsservicereceiver`는 업스트림 사전 빌드 `contrib` 바이너리에 번들로 포함되어 있지 **않습니다** — 이를 포함하는 사전 빌드된 **OneUptime Host Collector**를 사용하거나 직접 빌드하세요. 아래의 "Windows Services (메트릭)"를 참조하세요.
- Collector를 서비스로 설치하고 (해당되는 경우) 권한이 필요한 로그 소스를 읽으려면 호스트에 대한 Root / Administrator 권한이 필요합니다.

## 1단계 — OpenTelemetry Collector 설치

사용 중인 OS에 해당하는 섹션을 선택하세요. 모든 예제는 [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases)에서 최신 `otelcol-contrib` 릴리스를 설치한다고 가정합니다.

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian 패키지는 바이너리를 `/usr/bin/otelcol-contrib`에, 기본 구성을 `/etc/otelcol-contrib/config.yaml`에, systemd 유닛을 `/etc/systemd/system/otelcol-contrib.service`에 설치합니다.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

경로는 Debian 패키지와 동일합니다(`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd 유닛 `otelcol-contrib`).

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

2단계에서 `/etc/otelcol-contrib/config.yaml`을, 3단계에서 `launchd` plist를 생성하게 됩니다.

### Windows

Windows에서는 **OneUptime Host Collector**를 설치하세요 — 이것은 `windows_service` receiver(호스트 **Services** 탭을 구동하며 업스트림 `otelcol-contrib` 빌드에는 *포함되어 있지 않음*)를 번들로 포함하는 OneUptime의 사전 빌드 Collector입니다. **권한이 상승된** PowerShell 프롬프트에서:

```powershell
$dest = "C:\Program Files\OneUptimeHostCollector"
$zip  = "$env:TEMP\oneuptime-host-collector.zip"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _arm64.zip asset on ARM
Invoke-WebRequest -Uri "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-host-collector_windows_amd64.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dest -Force
```

2단계에서 `C:\Program Files\OneUptimeHostCollector\config.yaml`을 생성하고 3단계에서 Windows 서비스를 등록하게 됩니다.

> 업스트림 `otelcol-contrib`를 선호하시나요? 대신 [OpenTelemetry 릴리스 페이지](https://github.com/open-telemetry/opentelemetry-collector-releases/releases)에서 `otelcol-contrib_*_windows_amd64.zip`을 다운로드하세요 — 아래의 모든 내용이 동일하게 작동하지만, `windows_service`(업스트림 빌드에 없음. "Windows Services (메트릭)" 참조)를 필요로 하는 호스트 **Services** 탭만은 **예외**입니다.

## 2단계 — Collector 구성

구성 파일은 다음 위치에 있습니다:

| OS | 경로 |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
| Windows | `C:\Program Files\OneUptimeHostCollector\config.yaml` |

모든 구성은 동일한 형태를 따릅니다 — 원하는 receiver를 선택하고, `batch` 및 `resource` 프로세서를 추가한 다음, OTLP HTTP를 통해 OneUptime으로 내보냅니다. 아래 예제는 OS별로 완전하고 복사하여 붙여넣을 수 있는 구성을 보여준 다음, 자유롭게 조합할 수 있도록 각 receiver 블록을 설명합니다.

`YOUR_TELEMETRY_INGESTION_TOKEN`과 `service.name` 값을 환경에 맞게 바꾸세요.

### 공통 부분 (모든 OS에서 사용)

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

- **`batch`**는 내보내기 전에 레코드를 그룹화하여 레코드당 한 번의 HTTP 왕복 비용을 지불하지 않도록 합니다.
- **`resource`**는 모든 레코드에 `service.name`을 스탬프로 찍습니다. 각 머신이 OneUptime에서 자체 텔레메트리 서비스로 나타나기를 원한다면 호스트마다 다른 값(예: `prod-web-01`)을 사용하세요.
- **`otlphttp`**는 ingestion token을 첨부하여 HTTPS를 통해 OneUptime으로 전송합니다.

### 호스트 메트릭 (Linux, macOS, Windows)

모든 OS에서 작동합니다. 호스트 커널에서 CPU, 메모리, 디스크, 파일 시스템, 네트워크, 로드, 페이징 및 프로세스 메트릭을 가져옵니다:

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

> Linux에서 Collector는 `/proc`와 `/sys`를 읽습니다. Collector가 컨테이너에서 실행될 때는 호스트의 `/proc`와 `/sys`를 마운트하고 `HOST_PROC` / `HOST_SYS` 환경 변수를 설정하세요. 위에서 설치한 것처럼 systemd 서비스로 직접 실행되는 경우에는 추가 설정이 필요하지 않습니다.

### 파일 로그 (Linux, macOS)

디스크의 모든 로그 파일을 테일링합니다. 아래는 일반적인 시작 세트입니다:

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

`start_at: end`는 Collector가 시작되는 순간부터의 새 줄을 의미합니다. 첫 실행 시 백필하려면 `beginning`으로 변경하세요. Collector는 파일 오프셋을 추적하므로 재시작 후에도 올바르게 재개합니다.

**호스트 로그 스택 트레이스를 Exceptions로 변환하기.** OneUptime은 error 및 fatal 로그 줄에서 스택 트레이스를 자동으로 스캔하여 이 호스트에 귀속된 **Exceptions**(Issues) 보기로 통합합니다 — 추가 구성이 필요하지 않습니다. 이것이 잘 그룹화되려면 다중 줄 스택 트레이스(Java, Python, .NET, Ruby)가 줄당 한 레코드가 아니라 **하나의** 로그 레코드로 도착해야 합니다. 트레이스와 그 프레임이 함께 유지되도록 `filelog` receiver에서 다중 줄 재결합을 활성화하세요:

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

재결합이 없으면 각 프레임이 별도의 로그로 수집되어 예외가 한 줄로 된 제대로 그룹화되지 않은 이슈로 나타납니다. 애플리케이션이 OpenTelemetry `exception.type` / `exception.message` / `exception.stacktrace` 로그 속성을 직접 내보낼 수 있다면 대신 그렇게 하세요 — 가장 신뢰할 수 있는 경로이며 다중 줄 파싱과 무관합니다.

### systemd journal (Linux)

호스트가 systemd를 사용하는 경우, `journald` receiver가 `/var/log/*`를 테일링하는 것보다 종종 더 적합합니다 — 모든 것을 한곳에서 캡처하고 구조화된 필드를 보존합니다:

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

Collector 바이너리는 `journalctl`을 실행할 수 있어야 합니다(Debian / RPM 패키지는 이미 이를 종속성으로 포함합니다).

### Apple Unified Log (macOS)

macOS는 `/var/log/system.log`를 폐기하고 Apple Unified Log를 사용하며, 이는 `log show` / `log stream`으로 쿼리됩니다. 이를 수집하는 가장 간단한 방법은 작은 래퍼를 사용하여 `filelog` receiver를 통해 `log` 출력을 스트리밍하는 것입니다. `/usr/local/otelcol-contrib/log-stream.sh`를 생성하세요:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

실행 가능하게 만들고 launchd(또는 빠른 테스트의 경우 `nohup`)에서 실행한 다음, Collector가 해당 파일을 가리키도록 하세요:

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

(unified log가 필요하지 않다면 이를 건너뛰세요 — Mac 플릿은 호스트 메트릭과 몇 개의 파일 로그만으로도 종종 잘 작동합니다.)

### Windows Event Logs

네이티브 `wevtapi`를 통해 관심 있는 채널을 구독하세요:

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

대용량 `Security` 채널을 특정 이벤트 ID로 좁히려면:

```yaml
  windowseventlog/security:
    channel: Security
    start_at: end
    query: "*[System[(EventID=4625 or EventID=4740)]]"
```

사용자 지정 또는 애플리케이션별 채널(*Event Viewer → Applications and Services Logs*에서 볼 수 있는 모든 것)을 읽으려면 정확한 표시 이름을 사용하세요:

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Windows Services (메트릭)

호스트 **Services** 탭은 [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver)(구성 유형 `windows_service`)에 의해 구동되며, 이는 Windows 서비스의 실행 상태와 시작 유형을 메트릭으로 보고합니다.

> **이 receiver는 업스트림 사전 빌드 `otelcol-contrib` 바이너리에 포함되어 있지 _않습니다_.** 메타데이터가 `contrib` 배포판을 선언하고 있지만, contrib 릴리스 매니페스트에는 추가되지 않았으므로 1단계에서 설치한 공식 사전 빌드 Collector에는 포함되어 있지 않습니다. 해당 Collector에 `windows_service`를 추가하면 `'receivers' unknown type: "windows_service"` 오류와 함께 시작에 실패합니다 — 그리고 **어떤 버전 업그레이드로도 이 문제는 해결되지 않는데**, 출시된 어떤 `otelcol-contrib` 빌드에도 포함되어 있지 않기 때문입니다. 또한 이 receiver는 **alpha** 단계이며 **Windows 전용**입니다.

이를 포함하는 Collector를 얻는 방법은 두 가지입니다. 서비스별 상태가 필요하지 않다면 이 섹션 전체를 건너뛰어도 됩니다 — 호스트 메트릭, Windows Event Logs 및 그 외 모든 것은 표준 Collector로 작동합니다.

#### Option A — OneUptime Host Collector 사용 (권장)

OneUptime은 `windows_service`(그리고 `hostmetrics`, `windowseventlog`, `filelog` 및 OTLP exporter)를 이미 포함하는 사전 빌드 Collector인 **OneUptime Host Collector**를 게시합니다. Go 툴체인이나 빌드가 필요하지 않습니다.

1. [OneUptime 릴리스 페이지](https://github.com/OneUptime/oneuptime/releases)에서 Windows 자산을 다운로드하세요 — `oneuptime-host-collector_windows_amd64.zip`(또는 `_arm64.zip`)이나 `oneuptime-host-collector-amd64.msi` 설치 프로그램 중 하나입니다.
2. `C:\Program Files\OneUptimeHostCollector\`에 압축을 푸세요(MSI는 거기에 설치해 줍니다). 아카이브에는 `windows_service`가 이미 활성화된 `config.yaml`이 포함되어 있습니다.
3. `config.yaml`을 편집하여 `x-oneuptime-token`(그리고 자체 호스팅하는 경우 엔드포인트)을 설정하세요.
4. **권한이 상승된** PowerShell 프롬프트에서 Windows 서비스로 등록하고 시작하세요:

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe start "OneUptimeHostCollector"
```

이는 `LocalSystem`(`sc.exe` 기본값)으로 실행되므로 모든 서비스를 읽을 수 있습니다. 메트릭이 도착하면 **Services** 탭이 자동으로 채워집니다. 이것은 Linux/macOS용으로도 동일한 Collector입니다(해당 자산은 Windows 전용 receiver만 생략합니다).

#### Option B — `ocb`로 직접 빌드하기

직접 Collector를 빌드하거나(또는 이미 사용자 지정 배포판을 실행 중인 경우), [OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder)로 하나를 컴파일하세요.

**1. `ocb`로 사용자 지정 Collector를 빌드합니다.** `builder-config.yaml`을 생성하세요(모든 버전을 동일한 Collector 릴리스로 유지하세요):

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

그런 다음 빌드하세요(Go 필요) — 출력은 `otelcol-contrib` 대신 실행하는 단일 `otelcol-oneuptime.exe`입니다:

```powershell
go install go.opentelemetry.io/collector/cmd/builder@v0.154.0
builder --config builder-config.yaml
```

**2. receiver를 활성화**하려면 `config.yaml`에 추가하고 메트릭 파이프라인에 추가하세요:

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

receiver는 서비스당 하나의 `windows.service.status` 게이지를 내보냅니다 — 정수는 Win32 서비스 상태(`4` = 실행 중, `1` = 중지됨)입니다 — `name` 및 `startup_mode` 속성과 함께. 모든 서비스를 읽을 수 있도록 Collector를 `LocalSystem`(`sc.exe create`의 기본값)으로 실행하세요. 열 수 없는 서비스는 건너뜁니다. 이 receiver는 alpha 단계이므로 프로덕션 전에 버전을 고정하고 테스트하세요 — 알려진 문제로는 Collector를 충돌시킬 수 있는 스크레이프 오류와 한 서비스의 `access denied`가 다른 서비스에 영향을 미치는 문제가 있습니다. 이러한 문제가 발생하면 `include_services`로 제한하세요.

### 완전한 예제 — Linux 호스트

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

### 완전한 예제 — macOS 호스트

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

### 완전한 예제 — Windows 호스트

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

## 3단계 — Collector를 서비스로 실행

### Linux (systemd)

Debian / RPM 패키지는 이미 systemd 유닛을 설치합니다. 활성화하고 시작하기만 하면 됩니다:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

Collector 자체 로그를 따라가려면:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

`/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`를 생성하세요:

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

로드하세요:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

**권한이 상승된** PowerShell 프롬프트에서:

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

서비스는 기본적으로 `LocalSystem`으로 실행되며, 이는 `Security` Windows Event Log 채널을 읽는 데 필요한 권한을 가지고 있습니다.

## 4단계 — OneUptime에서 확인

1. 호스트에서 일부 신호를 생성하세요:
   - **Linux / macOS:** `logger "hello from oneuptime"` (syslog / journald에 기록).
   - **Windows:** 권한이 상승된 프롬프트에서 `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"`.
2. OneUptime 대시보드에서 **Telemetry → Services**를 열고 구성한 `service.name`을 선택하세요.
3. **Metrics**를 여세요 — 호스트 메트릭(CPU, 메모리, 파일 시스템 등)이 1분 이내에 나타나야 합니다.
4. **Logs**를 여세요 — 파일 로그 / journald 항목 / Windows Event Logs가 스트리밍되어 들어와야 합니다. 유용한 검색 가능 속성으로는 `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id`, `winlog.provider.name`이 있습니다.

## 자체 호스팅 OneUptime

OneUptime을 자체 호스팅하는 경우, exporter가 자신의 호스트를 가리키도록 하세요:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

인스턴스가 HTTP 전용인 경우, 스키마를 `http://`로 변경하고 적절한 포트를 사용하세요.

## 프록시 뒤에서

OpenTelemetry Collector는 표준 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` 환경 변수를 따릅니다. 서비스에 설정하세요:

- **systemd (Linux):** `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf`에 `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`를 드롭인한 다음, `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** plist에 `<EnvironmentVariables>` dict를 추가합니다.
- **Windows 서비스:** `sc.exe config` 또는 레지스트리의 `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`를 통해 서비스에 환경 변수를 설정합니다.

## 문제 해결

- **OneUptime에 텔레메트리가 나타나지 않음**
  - 자세한 출력을 위해 구성에 `service.telemetry.logs.level: debug`를 추가하고 Collector를 재시작하세요.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) 또는 `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** *Event Viewer → Windows Logs → Application*에서 소스 `otelcol-contrib`를 찾으세요.
  - 호스트가 `https://oneuptime.com/otlp`(또는 자체 호스팅 엔드포인트)에 도달할 수 있는지 확인하세요: 동일한 머신에서 `curl -v https://oneuptime.com/otlp`.
- **exporter에서 HTTP 401** — ingestion token이 유효하지 않거나 취소되었습니다. *Project Settings → Telemetry Ingestion Keys*에서 새로 생성하세요.
- **`Security` Windows Event Log가 access denied를 반환함** — 서비스가 충분한 권한으로 실행되고 있지 않습니다. `LocalSystem`(`sc.exe create`의 기본값)으로 다시 생성하거나 서비스 계정에 *Manage auditing and security log* 사용자 권한을 부여하세요.
- **`journald` receiver가 시작에 실패함** — `journalctl`이 Collector의 `PATH`에 있고 `/var/log/journal`이 존재하는지 확인하세요(존재하지 않으면 `sudo systemd-tmpfiles --create --prefix /var/log/journal`을 실행).
- **대용량 / 비용** — receiver를 좁히거나(특정 Windows 채널, 특정 systemd 유닛, 특정 로그 파일), Windows Event Log receiver에 `query:` 필터를 추가하거나, 내보내기 전에 낮은 심각도 이벤트를 삭제하도록 `filter` 프로세서를 추가하세요.

## 다음 단계

- 특정 로그 패턴에 대해 알림을 보내려면 **Logs Monitors**를 추가하세요(예: 5분 창에서 `winlog.event_id = 4625` 실패한 로그온이 5개를 초과할 때 알림).
- 호스트 메트릭에 대해 **Metrics Monitors**를 추가하세요(CPU 포화, 디스크 공간 부족, 스왑 사용량).
- 엔드투엔드 호스트 가시성을 위해 이를 [Server / VM Monitor](/docs/monitor/server-monitor) 및 [OneUptime Infrastructure Agent](/docs/monitor/server-monitor)와 결합하세요.
- Ansible / Chef / Puppet / Group Policy / Intune / 기존 구성 관리 도구를 통해 모든 호스트에 동일한 구성을 배포하세요.
