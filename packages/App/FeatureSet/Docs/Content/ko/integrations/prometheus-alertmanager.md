# Prometheus Alertmanager 통합

[Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) 알림을 OneUptime 인시던트로 바꿉니다. Prometheus가 알림 규칙을 평가하고, Alertmanager가 라우팅하며, OneUptime이 기록하고 에스컬레이션합니다.

이 통합은 **인바운드** 이며, 구성하는 방법은 두 가지입니다.

| 방식                                                                  | 이럴 때 사용하세요                                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[수신 요청 모니터](/docs/monitor/incoming-request-monitor)** (권장) | 알림이 온콜 에스컬레이션이 붙은 인시던트가 되고, 알림당 인시던트 하나가 생기며, 복구 시 자동으로 해결되길 원할 때. 유지할 커스텀 로직이 없습니다. |
| **[워크플로](/docs/workflows/index) + Webhook 트리거**                | OneUptime이 기본 제공하지 않는 라우팅 로직이 필요할 때 — 다른 시스템 호출, 페이로드 재구성, 조건 분기 등.                                         |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## 사전 요건

- `alertmanager.yml` 을 편집할 수 있는 Prometheus + Alertmanager 환경.
- Alertmanager가 HTTPS로 OneUptime 인스턴스에 도달할 수 있어야 합니다.
- 모니터(또는 워크플로)를 만들 수 있는 OneUptime 프로젝트.

## 옵션 1 — 수신 요청 모니터

### 1단계 — 모니터 만들기

1. **모니터 → 모니터 생성** 으로 이동해 **수신 요청** 을 선택합니다.
2. 모니터를 열고 왼쪽 메뉴에서 **Documentation** 을 클릭합니다. URL을 복사하세요.

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   자체 호스팅 중이라면 자신의 호스트를 사용하세요. 경로의 비밀 키가 유일한 자격 증명입니다.

### 2단계 — Alertmanager가 이 URL을 바라보게 하기

`alertmanager.yml` 에서:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` 는 필수입니다 — 알림이 복구되었음을 OneUptime에 알리는 것이 바로 이 설정입니다. `curl -X POST http://localhost:9093/-/reload` 로 Alertmanager를 다시 로드하거나 재시작하세요.

Alertmanager는 `Content-Type: application/json` 을 보내며, OneUptime이 페이로드에서 필드를 읽으려면 이것이 필요합니다.

### 3단계 — criteria 설정

모니터의 **Criteria** 를 열고 첫 번째 criteria를 편집합니다.

**필터**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  문자열 비교를 하려면 플레이스홀더를 감싸는 따옴표가 필요합니다. 표현식을 쓰고 싶지 않다면 `Request Body` / `Contains` / `"status":"firing"` 필터도 동작합니다.

**액션**

- _When filters match, change monitor status_ 를 켜고 **Offline**(또는 Degraded)으로 설정합니다.
- _When filters match, declare an incident_ 를 켭니다. **Title**, **Severity**, 호출할 **On-Call Policies** 를 설정하세요.
- 그 인시던트의 **Advanced Options** 에서 **Auto Resolve Incident** 를 켭니다. 이것이 없으면 복구 알림이 무시되고 인시던트가 영원히 열려 있습니다.

**Settings → Group incidents and alerts by a payload field**

이 옵션을 켜면 하나의 엔드포인트가 알림당 인시던트 하나가 아니라, 알림마다 하나씩 여러 인시던트를 동시에 유지할 수 있습니다.

| 필드                               | 값                                  |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` 는 Alertmanager의 `alerts` 배열 위로 펼쳐지며, 추출된 값이 **서로 다를** 때마다 인시던트를 하나씩 엽니다. 두 경로 모두 `[*]` 를 쓰므로 복구는 알림 단위로 판단됩니다. 하나는 해결되고 둘은 아직 발생 중인 페이로드에서는 해결된 것만 닫힙니다.

> **Warning:** 알림마다 진짜로 고유한 값으로 그룹화하세요. Alertmanager의 `fingerprint` 는 알림의 전체 레이블 집합에 대한 해시이므로 언제나 고유합니다. 레이블은 하나의 알림 **안에서** 값이 달라질 때만 쓸 수 있는데, 라우트의 `group_by` 에 들어 있는 레이블은 바로 그것이 집계 그룹을 정의하기 때문에 절대 달라지지 않습니다. 위의 `group_by: ["alertname", "instance"]` 에서 `requestBody.alerts[*].labels.alertname` 으로 그룹화하면 페이로드의 모든 알림에서 같은 값이 추출되어 전부 하나의 인시던트로 합쳐집니다. 더 나쁜 것은 값이 중복되면 **첫 번째** 항목만 남는다는 점입니다. 첫 알림이 `resolved` 인 페이로드는 나머지가 아직 발생 중인데도 그 인시던트를 닫아 버립니다.

### 4단계 — 인시던트 제목과 설명 작성

그룹화 키는 경로의 마지막 세그먼트 이름을 딴 변수로 제공되므로 `requestBody.alerts[*].fingerprint` 는 `{{fingerprint}}` 를 줍니다. 이것은 해시라서 대응자에게 보여줄 만한 값이 아닙니다. 대신 알림 전체가 공유하는 레이블로 인시던트 제목을 지으세요. `commonLabels` 에는 라우트의 `group_by` 에 있는 모든 레이블이 담기므로, 위 구성에서는 `alertname` 과 `instance` 를 모두 쓸 수 있습니다.

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` 와 `commonAnnotations` 에는 알림 전체가 공유하는 필드가 들어 있습니다. `requestBody.alerts[0].annotations.summary` 같은 알림 단위 경로는 항상 페이로드의 _첫 번째_ 알림을 읽으며, 이 인시던트가 열린 대상 알림이 아닙니다. 각 인시던트가 자신의 어노테이션 텍스트를 갖게 하려면 `group_by` 를 좁게 유지하세요. 해석되지 않는 경로는 비워지지 않고 중괄호까지 그대로 출력됩니다. 전체 변수 목록은 [인시던트 및 알림 동적 템플릿](/docs/monitor/incident-alert-templating) 을 참고하세요.

### 5단계 — 모니터를 Operational로 되돌리기 (선택 사항)

criteria는 일치할 때만 동작하므로, 모든 것이 정리된 뒤 모니터가 Offline으로 남지 않도록 두 번째 criteria를 추가하세요.

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational** 로 두고, 인시던트는 선언하지 않습니다.

### 6단계 — 테스트

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

`fingerprint` 마다 하나씩, 인시던트 두 개가 생겨야 합니다. 두 알림의 `status` 를 `resolved` 로 바꿔 다시 보내면 둘 다 닫혀야 합니다.

`amtool` 로 실제 알림을 발생시킬 수도 있습니다.

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## 옵션 2 — 워크플로

"알림이 인시던트가 된다"를 넘어서는 로직이 필요할 때 사용하세요.

1. **워크플로 → 워크플로 생성** 을 열고, 이름을 `Alertmanager → Incidents` 로 지정하고 **빌더** 를 엽니다.
2. **Webhook** 트리거를 추가하고 **URL을 복사합니다**. 블록 이름을 `Alertmanager` 로 변경합니다.
3. 트리거에 연결된 **Conditions** 블록을 추가합니다:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **Yes** 에서 **Create Incident** 블록을 추가합니다:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: 하나를 선택합니다(또는 먼저 `{{Alertmanager.Request Body.commonLabels.severity}}` 로 분기합니다).
5. **Save** 한 뒤, 위 2단계의 `webhook_configs` URL을 워크플로의 URL로 바꿔 지정하세요.

알림마다 인시던트를 하나씩 만들려면 `Request Body.alerts` 를 반복하는 [Custom Code](/docs/workflows/components#custom-code) 블록을 추가하세요. `send_resolved: true` 를 쓴다면 `status == resolved` 에 대한 두 번째 **Conditions** 분기를 추가해 해당 인시던트를 찾아 **Update Incident** 로 해결 상태로 옮기세요.

## 데드맨 스위치

두 옵션 모두 Prometheus 자체가 멈췄을 때는 알려주지 않습니다 — 알림이 오지 않는 상태는 아무 문제가 없는 상태와 똑같아 보이니까요. 흔한 해법은 항상 발생하는 알림을 만들어, 그것을 일정에 맞춰 기다리는 모니터로 라우팅하는 것입니다. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) 에는 `Watchdog` 이라는 것이 포함되어 있습니다. 순수 Prometheus라면 항상 참인 표현식(`vector(1)`)으로 알림 규칙을 추가하세요.

**두 번째** 수신 요청 모니터를 만들고, 짧은 `repeat_interval` 로 `Watchdog` 을 그쪽으로 라우팅한 다음, 그 모니터에 **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes** criteria를 지정하세요. 요청 누락 criteria가 알림 수신용 모니터에 어울리는 유일한 경우입니다.

다음은 2단계 구성에 watchdog 라우트와 receiver를 합친 것입니다. 하위 라우트가 상위 라우트 자신의 receiver보다 먼저 매칭되므로, `Watchdog` 은 두 번째 모니터로 가고 나머지는 여전히 첫 번째 모니터로 갑니다.

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## 문제 해결

- **아무것도 도착하지 않음** — Alertmanager가 URL에 도달할 수 있는지 확인하고, 전달 오류가 있는지 로그를 확인하세요. OneUptime은 아무것도 검증하기 전에 모든 요청에 빈 `200` 으로 응답하므로 `200` 은 페이로드가 수락되었음을 보장하지 않습니다. 대신 모니터의 타임라인을 확인하세요.
- **인시던트가 열리지만 닫히지 않음** — Alertmanager의 `send_resolved: true`, criteria의 복구 필드와 값(비교는 대소문자를 구분합니다), 인시던트의 **Advanced Options** 에 있는 **Auto Resolve Incident** 를 확인하세요. 더 미묘한 원인이 둘 있습니다. **Max incidents per request** 보다 많은 서로 다른 키를 담은 페이로드에서는 상한을 넘은 키가 복구에서도 보이지 않습니다. 그리고 인제스트 병합(아래)으로 버려진 것이 하필 `resolved` 알림이라면, Alertmanager는 발생 알림은 반복해도 해결 알림은 반복하지 않기 때문에 그 인시던트는 영구히 남습니다. 그런 인시던트는 손으로 닫으세요.
- **인시던트가 전혀 없고 모니터 상태도 그대로임** — 그룹화 경로는 리터럴 `requestBody.` 로 시작해야 하며, 경로에서 와일드카드로 동작하는 것은 첫 번째 `[*]` 뿐입니다. 두 실수 모두 조용히 실패합니다.
- **인시던트 텍스트에 원본 `{{...}}` 플레이스홀더가 보임** — 경로가 해석되지 않았고, OneUptime은 해석되지 않은 플레이스홀더를 비우지 않고 그대로 둡니다. 규칙마다 설정하는 어노테이션이 다르므로, 여러분의 규칙에 실제로 존재하는 필드를 참조하세요(`commonAnnotations` 대 알림별 `annotations`).
- **알림이 가득한 페이로드인데 인시던트가 하나뿐임** — 알림 안에서 값이 달라지지 않는 레이블, 대개 라우트의 `group_by` 에도 들어 있는 레이블로 그룹화했습니다. 대신 `requestBody.alerts[*].fingerprint` 로 그룹화하세요.
- **인시던트가 너무 많음** — `group_by` / `group_interval` 을 넓혀 Alertmanager가 관련 알림을 묶게 하세요. **Max incidents per request** 를 낮추면 개수는 줄지만, 상한을 넘은 키가 복구에서도 보이지 않게 됩니다.
- **급격한 폭주 시 일부 알림이 건너뛰어진 것처럼 보임** — 한 발신자가 모니터를 압도하지 못하도록 같은 모니터로 가는 요청은 인제스트 단계에서 병합되며, 알림이 연달아 도착하면 중간 페이로드가 버려질 수 있습니다. `group_wait` 과 `group_interval` 을 늘리면 간격이 벌어집니다. 병합은 앱 컨테이너의 환경 변수 `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` 로 제어되며 기본값은 켜짐입니다. 모든 페이로드를 평가해야 하는 자체 호스팅 운영자는 해당 컨테이너에서 `false` 로 설정할 수 있습니다.

## 다음에 읽어 볼 내용

- [수신 요청 모니터](/docs/monitor/incoming-request-monitor) — 모니터 유형, criteria, 인시던트 그룹화 전체.
- [통합 개요](/docs/integrations/index) — 인바운드와 아웃바운드 패턴.
- [Grafana](/docs/integrations/grafana) — 같은 개념을 Grafana 알림으로.
- [Webhook 트리거](/docs/workflows/triggers#webhook) — 워크플로의 수신 URL이 동작하는 방식.
