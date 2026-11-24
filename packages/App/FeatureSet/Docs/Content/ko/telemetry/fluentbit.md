# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual)는 파일, systemd, 컨테이너, syslog, HTTP 등 많은 소스에서 로그를 모으는 가벼운 에이전트입니다. [OpenTelemetry 출력](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry)이 모은 데이터를 OneUptime의 OpenTelemetry(OTLP) 엔드포인트로 보내면, 로그를 **제품 → 로그**에서 검색할 수 있습니다.

:::cards
- [Fluent Bit 구성](#fluent-bit-구성): OpenTelemetry 출력을 추가하고 서비스 이름을 정합니다.
- [전체 예시](#전체-예시): 바로 시작할 수 있는 구성 파일 전체.
- [자체 호스팅 OneUptime](#자체-호스팅-oneuptime): Fluent Bit가 직접 운영하는 인스턴스로 보내게 합니다.
:::

## 작동 방식

```mermaid title="Fluent Bit에서 OneUptime까지"
flowchart TB
    sources["파일, 컨테이너, syslog, HTTP"] --> inputs["Fluent Bit 입력"]
    inputs --> envelope["opentelemetry_envelope 프로세서"]
    envelope --> name["content_modifier가 service.name 설정"]
    name --> output["opentelemetry 출력"]
    output -->|"OTLP/HTTP + 수집 키"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["로그"]
```

Fluent Bit는 각 레코드를 OpenTelemetry 봉투로 감싸 `service.name` 같은 리소스 속성을 담을 수 있게 합니다. 그런 다음 OpenTelemetry 출력이 `x-oneuptime-token` 헤더에 수집 키를 넣어 레코드를 OneUptime으로 보냅니다. OneUptime은 `service.name`이 가리키는 서비스 아래에 레코드를 저장하고, 처음 보낼 때 그 서비스를 만듭니다.

## 시작하기 전에

- **Fluent Bit 설치**: [설치 가이드](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)를 참고하세요. 이 페이지의 구성은 Fluent Bit의 YAML 형식과 `opentelemetry_envelope` 프로세서를 사용하므로 최신 릴리스를 쓰세요.
- **OneUptime 프로젝트.** OneUptime Cloud에서 텔레메트리는 수집된 GB당 과금되며([요금](https://oneuptime.com/pricing) 참고), Free 플랜의 프로젝트는 텔레메트리를 보내기 전에 결제 수단이 있어야 합니다.
- **텔레메트리 수집 키.** 아직 없다면 다음과 같이 만듭니다.

:::steps
### 수집 키 열기

**제품 → 프로젝트 설정**으로 이동해 사이드 메뉴에서 **텔레메트리 및 APM**을 열고 **수집 키**를 선택합니다.

![‘수집 키’ 목록, ‘수집 키 생성’ 강조 표시됨](screen:ingestion-keys)

### 키 만들기

**수집 키 생성**을 클릭합니다. 대화 상자에는 키 이름이 이미 채워져 있고 **서버**(애플리케이션이나 Collector가 데이터를 보낼 때 쓰는 키 유형)가 선택되어 있으므로, **수집 키 생성**을 클릭해 만들거나 먼저 이름을 바꿉니다.

### 시크릿 복사

새 키는 자체 페이지에서 열립니다. 키의 **시크릿 키**를 복사하세요. 이것이 아래 구성의 `YOUR_TELEMETRY_INGESTION_TOKEN`입니다.

![시크릿 키가 표시된 텔레메트리 수집 키 페이지](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Fluent Bit 구성

Fluent Bit는 `/etc/fluent-bit/fluent-bit.yaml` 같은 파일에서 YAML 구성을 읽습니다.

:::steps
### OpenTelemetry 출력 추가

OneUptime으로 보내는 `opentelemetry` 출력을 추가합니다. 레코드를 로컬에서 보고 싶다면 테스트하는 동안 `stdout` 출력을 남겨 두세요.

```yaml title="fluent-bit.yaml"
service:
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`retry_limit: 8640`은 OneUptime이 바쁘거나(`429`) 다시 시작하는 중일 때(`502`, `503`, `504`) 청크를 약 30초마다(`scheduler.base`와 `scheduler.cap`) 약 72시간 동안 다시 보냅니다. Fluent Bit의 기본값은 한 번 더 시도한 뒤 버리는 것입니다. `storage.path`는 아직 보내지 않은 청크를 디스크에 보관하므로, Fluent Bit를 다시 시작해도 하나도 잃지 않습니다. 다음 단계처럼 `storage.type: filesystem`이 있는 입력마다 적용됩니다. Fluent Bit가 그 폴더에 쓸 수 있어야 합니다. 패키지의 서비스는 root로 실행되며, 직접 실행할 때는 `sudo`로 실행하세요. `storage.total_limit_size: 512M`은 출력마다 최대 512MB까지 보관하며, 가득 차면 가장 오래된 청크부터 버립니다.

### 로그를 OpenTelemetry 봉투로 감싸고 서비스 이름 정하기

각 입력에 `opentelemetry_envelope` 프로세서를 추가하고, 그 뒤에 `service.name`을 설정하는 `content_modifier`를 둡니다. `YOUR_SERVICE_NAME`은 OneUptime에서 로그가 표시될 이름으로 바꿉니다.

```yaml title="fluent-bit.yaml"
pipeline:
  inputs:
    - name: tail # or any other input
      path: /var/log/my-app/*.log
      # Keep its place in each file, so a restart reads on from there
      db: /var/lib/fluent-bit/tail.db
      # Keep its chunks on disk until OneUptime takes them
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME
```

`db`는 각 파일에서 tail의 위치를 보관하므로, 다시 시작해도 거기서부터 이어서 읽습니다. 이것이 없으면 Fluent Bit는 각 파일의 끝에서 다시 시작하고, 멈춰 있는 동안 쓰인 줄은 보내지 않습니다. `storage.type: filesystem`은 입력의 청크를 `storage.path`에 보관합니다.

### Fluent Bit 다시 시작

`fluent-bit` 패키지의 서비스는 이 파일이 아니라 패키지 자체 예시인 `/etc/fluent-bit/fluent-bit.conf`를 읽습니다. drop-in으로 서비스를 `/etc/fluent-bit/fluent-bit.yaml`에 맞추고, 지금 그리고 부팅할 때마다 시작되게 하세요.

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

빈 `ExecStart=`는 패키지 자체의 시작 줄을 지웁니다. 먼저 포그라운드에서 파일을 시험하려면 `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`을 실행하세요. 패키지는 프로그램을 `/opt/fluent-bit/bin`에 두는데, 이 경로는 `PATH`에 없습니다. 몇 초 안에 로그가 **제품 → 로그**에 나타나고, 서비스가 **제품 → 서비스**에 표시됩니다.
:::

## 전체 예시

이 구성은 포트 `8888`에서 HTTP로 이 호스트에서만 로그를 받아 OneUptime으로 전달합니다.

```yaml title="fluent-bit.yaml"
service:
  flush: 1
  log_level: info
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  inputs:
    - name: http
      # This host alone may send here
      listen: 127.0.0.1
      port: 8888
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`listen: 127.0.0.1`은 이 호스트에서만 로그를 받습니다. `http` 입력은 키를 요구하지 않으므로, `listen: 0.0.0.0`이면 포트에 닿을 수 있는 누구나 여러분의 수집 키로 OneUptime에 로그를 보낼 수 있습니다. `http` 입력은 필요한 입력으로 바꾸세요(예: 로그 파일은 `tail`, 저널은 `systemd`). 각 입력에는 두 프로세서와 `storage.type: filesystem`을 그대로 둡니다.

## HTTP 출력으로 보내기

Fluent Bit의 [HTTP 출력](https://docs.fluentbit.io/manual/pipeline/outputs/http)으로 OneUptime의 Fluentd 엔드포인트에 보낼 수도 있습니다. 각 레코드는 [Fluentd 페이지](/docs/telemetry/fluentd)에서 설명하는 대로 읽힙니다. `format`을 아래처럼 `json_lines`로, 또는 `json`으로 설정하세요. OneUptime은 둘 다 읽으며, `compress: gzip`으로 압축했든 안 했든 같습니다. Fluent Bit의 기본 형식인 `msgpack`은 거부됩니다.

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: http
      match: "*"
      host: "oneuptime.com"
      port: 443
      uri: "/fluentd/logs"
      format: json_lines
      # Send each record's time where OneUptime reads it
      json_date_key: timestamp
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
        - x-oneuptime-service-name YOUR_SERVICE_NAME
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## 자체 호스팅 OneUptime

`host`를 OneUptime 인스턴스의 호스트로 설정합니다. HTTPS가 아니라 일반 HTTP로 제공한다면 `port`도 수신 포트(보통 `80`)로 설정하고 `tls`를 제거합니다.

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "your-oneuptime-instance.com"
      port: 80
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## 문제 해결

:::details Fluent Bit가 OpenTelemetry 출력에서 `401`을 기록함
수집 키가 없거나, 알 수 없거나, 만료되었습니다. `header` 줄을 확인하세요. `x-oneuptime-token`, 공백 하나, 그리고 키의 **시크릿 키** 순서입니다.
:::

:::details Fluent Bit가 `402` 또는 `422`를 기록함
`402`: OneUptime Cloud에서 프로젝트가 Free 플랜이고 결제 수단이 없습니다. **프로젝트 설정 → 결제 및 청구서 → 결제**에서 추가하세요. `422`: 키가 비활성화되었거나 브라우저 키입니다. 키 설정에서 **활성화됨**을 다시 켜거나 **서버** 키를 만드세요.
:::

:::details 로그가 예상하지 못한 서비스로 들어옴
서비스는 `service.name`에서 정해집니다. 모든 입력에 `opentelemetry_envelope` 프로세서가 있고, 그 뒤에 서비스 이름을 설정하는 `content_modifier`가 있는지 확인하세요.
:::

:::details 아무것도 들어오지 않고 Fluent Bit가 연결 오류를 기록함
HTTPS 엔드포인트에 `tls: On`과 `port: 443`이 설정되어 있는지, 그리고 Fluent Bit를 실행하는 호스트가 그 포트로 OneUptime 호스트에 닿을 수 있는지 확인하세요.
:::

:::details Fluent Bit가 `cannot be retried`를 기록함
Fluent Bit가 보내지 못한 청크를 버렸습니다. 위 구성처럼 `retry_limit: 8640`이 있으면, OneUptime이 `429`, `502`, `503` 또는 `504`로 답한 청크를 약 30초마다 약 72시간 동안 다시 보냅니다. Fluent Bit의 기본값으로는 한 번만 더 시도합니다. `400`, `401`, `402`, `413`, `422` 또는 `500`은 매번 같은 답이 오므로 바로 버려집니다. 키, 요금제, 요청 크기를 확인하세요.
:::

구성에 대해 질문이 있거나 도움이 필요하면 support@oneuptime.com으로 문의하세요.

## 다음 단계

:::cards
- [로그 파이프라인](/docs/telemetry/log-pipelines): Fluent Bit가 보내는 로그를 파싱하고 보강합니다.
- [검색 구문](/docs/telemetry/search-syntax): 로그 탐색기에서 로그를 찾습니다.
- [OpenTelemetry](/docs/telemetry/open-telemetry): 모든 텔레메트리의 엔드포인트, 키, 한도.
- [Fluentd](/docs/telemetry/fluentd): 대신 Fluentd를 사용합니다.
:::
