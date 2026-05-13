# OneUptime에 Syslog 데이터 전송

## 개요

OpenTelemetry 수집 서비스는 이제 네이티브 Syslog 페이로드를 허용합니다. RFC3164 또는 RFC5424 호환 소스에서 직접 HTTPS를 통해 OneUptime으로 메시지를 전달할 수 있습니다. OneUptime은 syslog 우선순위, 시설, 심각도, 구조화된 데이터 및 메시지 본문을 파싱한 후 모든 것을 검색 가능한 로그로 저장합니다.

## 전제 조건

- **텔레메트리 수집 토큰** – *프로젝트 설정 → 텔레메트리 수집 키*에서 생성하고 `x-oneuptime-token` 값을 복사합니다.
- **Syslog 전달자** – HTTP POST 요청을 보낼 수 있는 모든 도구 (예: `curl`, `omhttp`를 통한 `rsyslog` 또는 HTTP 대상 플러그인이 있는 `syslog-ng`).
- **서비스 이름 (선택 사항)** – 특정 텔레메트리 서비스 아래에 수신 로그를 그룹화하려면 `x-oneuptime-service-name` 헤더를 설정합니다. 생략하면 OneUptime은 syslog `APP-NAME`, 호스트 이름 또는 `Syslog`로 폴백합니다.

## 엔드포인트

```
POST https://oneuptime.com/syslog/v1/logs
```

- OneUptime을 자체 호스팅하는 경우 `oneuptime.com`을 호스트로 교체합니다.
- 항상 요청에 `x-oneuptime-token` 헤더를 포함합니다.

## 요청 본문

줄 바꿈으로 구분된 Syslog 문자열 또는 `messages` 배열이 있는 JSON 페이로드를 전송합니다. RFC3164 (BSD)와 RFC5424 형식이 모두 지원됩니다.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### 지원되는 콘텐츠 유형

- `application/json` – 권장.
- `text/plain` – 줄 바꿈으로 구분된 메시지.
- `application/octet-stream` – 원시 페이로드. Gzip 압축 (`Content-Encoding: gzip`)도 허용됩니다.

## curl을 사용한 빠른 테스트

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## rsyslog에서 전달

1. HTTP 출력 모듈을 설치합니다:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. 대상을 `/etc/rsyslog.d/oneuptime.conf`에 추가합니다:
   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```
3. rsyslog를 재시작합니다:
   ```bash
   sudo systemctl restart rsyslog
   ```

## 이미 확인하고 있는 일반적인 사용 사례

### 1. 네트워크 및 보안 어플라이언스

대부분의 네트워크 장비는 여전히 syslog만을 통해 구성 변경, ACL 히트 및 위협 탐지를 노출합니다. 기존 릴레이 (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense 등)를 OneUptime으로 직접 지정하거나 내부 릴레이를 유지하고 HTTPS를 통해 전달합니다:

```bash
# 메시지를 JSON으로 일괄 처리하고 OneUptime에 게시하는 rsyslog 스니펫
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: perimeter-firewall"
  template="OneUptimeJSON"
)
```

### 2. Linux 서버 및 cron 작업

많은 cron 작업과 레거시 데몬은 여전히 커널/syslog 시설을 통해서만 로그합니다. `/var/log/syslog` 또는 journald 항목을 전달하면 운영 흔적을 한 곳에 유지합니다. systemd 호스트는 journald → syslog 브릿지에 의존할 수 있습니다:

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: linux-fleet"
  template="OneUptimeJSON"
)
```

`syslog.severity.name = "error"`로 경고하거나 `syslog.hostname`으로 분할하여 시끄러운 박스를 신속하게 격리할 수 있으므로 심각도 코드를 매핑합니다.

### 3. Kubernetes 인그레스 컨트롤러 및 엣지 노드

이미 Fluent Bit 또는 Fluentd를 실행 중인 경우 컨테이너 로그를 위해 유지하고 엣지의 호스트나 어플라이언스에 가벼운 syslog 싱크를 추가합니다. Fluent Bit의 `syslog` 입력은 HTTP 출력과 결합됩니다:

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name edge-ingress
    tls               On
```

이 설정을 통해 다른 로깅 스택을 만들지 않고 베어 메탈 워커나 하드웨어 로드 밸런서에서 syslog를 수집할 수 있습니다.

### 4. 기다림 없는 컴플라이언스 아카이브

PCI 또는 SOX를 위해 방화벽 로그를 보존해야 하나요? OneUptime으로 직접 전송하고 텔레메트리 서비스에 긴 보존 정책을 적용하고 단일 장소에서 콜드 스토리지로 내보냅니다. 더 이상 여러 syslog 릴레이에서 내보낼 필요가 없습니다.

## 파싱된 속성

OneUptime은 각 로그 항목에 다음 속성을 자동으로 추가합니다:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (평탄화된 RFC5424 구조화된 데이터)
- `syslog.raw` (추적 가능성을 위한 원본 메시지)

이러한 속성은 텔레메트리 → 로그 탐색기 내에서 검색 가능합니다.

## 문제 해결

- **HTTP 401 또는 빈 결과** – `x-oneuptime-token` 헤더가 로그를 수신하는 프로젝트에 속하는지 확인합니다.
- **로그가 나타나지 않음** – 요청 본문에 실제로 syslog 줄이 포함되어 있는지 확인합니다. 빈 본문은 HTTP 400으로 거부됩니다.
- **예상치 못한 서비스 이름** – 기본 감지 로직을 재정의하려면 `x-oneuptime-service-name`을 설정합니다.
- **대량 버스트** – 요청당 최대 1,000줄의 일괄 처리가 지원됩니다. 더 큰 버스트는 대기열에 들어가 비동기적으로 처리됩니다.
