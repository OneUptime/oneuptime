# Grafana 통합

[Grafana](https://grafana.com) 알림을 OneUptime 인시던트로 바꿉니다. Grafana는 대시보드의 알림 규칙을 평가하고, OneUptime은 이를 기록하고 에스컬레이션하며 추적합니다.

이 통합은 **인바운드** 입니다. Grafana의 **Webhook 연락처 포인트** 가 OneUptime으로 POST합니다. 이를 받는 방법은 두 가지입니다.

| 방식                                                                  | 이럴 때 사용하세요                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **[수신 요청 모니터](/docs/monitor/incoming-request-monitor)** (권장) | 알림이 온콜 에스컬레이션이 붙은 인시던트가 되고, 알림당 인시던트 하나가 생기며, 복구 시 자동으로 해결되길 원할 때. |
| **[워크플로](/docs/workflows/index) + Webhook 트리거**                | OneUptime이 기본 제공하지 않는 라우팅 로직이 필요할 때 — 다른 시스템 호출, 페이로드 재구성, 조건 분기 등.          |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Grafana의 webhook 페이로드는 Alertmanager 형태를 따릅니다 — `status`, `alerts` 배열, `commonLabels`, `commonAnnotations` 를 포함하며, 편리한 최상위 `title` 과 `message` 필드도 있습니다.

## 사전 요건

- [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) 이 활성화된 Grafana 9 이상(최신 Grafana의 기본값).
- Grafana가 HTTPS로 OneUptime 인스턴스에 도달할 수 있어야 합니다.
- 모니터(또는 워크플로)를 만들 수 있는 OneUptime 프로젝트.

## 옵션 1 — 수신 요청 모니터

1. **모니터 → 모니터 생성** 으로 이동해 **수신 요청** 을 선택합니다. 모니터를 열고 왼쪽 메뉴에서 **Documentation** 을 클릭해 URL을 복사하세요.
2. 모니터의 **Criteria** 를 열고 **Filter Type** 을 `JavaScript Expression`, **Value** 를 `"{{requestBody.status}}" === "firing"` 으로 설정합니다.
3. 일치 시 인시던트를 선언하고, 호출할 **On-Call Policies** 를 선택한 뒤, **Advanced Options** 에서 **Auto Resolve Incident** 를 켭니다.
4. **Settings** 에서 **Group incidents and alerts by a payload field** 를 켜고 다음을 설정합니다.

   | 필드                               | 값                                  |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. 인시던트 제목을 `{{requestBody.commonLabels.alertname}}` 으로 하고, 설명에는 `{{requestBody.message}}` 또는 `{{requestBody.commonAnnotations.summary}}` 를 사용하세요. (`{{fingerprint}}` 에는 그룹화 키 자체가 담기지만 해시라서 대응자에게 보여줄 값은 아닙니다.)
6. Grafana 연락처 포인트를 모니터의 URL로 지정하세요(아래 연락처 포인트 단계 참고).

**서로 다른** 그룹화 값마다 각자의 인시던트가 되고, Grafana가 해결되었다고 알리면 각각 닫힙니다. Grafana의 알림별 `fingerprint` 는 알림의 레이블 집합에 대해 고유하므로 위에서 그룹화 경로로 쓴 것입니다. [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) 페이지가 같은 구성을 더 자세히 다룹니다 — 페이로드 형태가 같으므로 그곳의 모든 단계가 여기에도 적용됩니다.

> **Warning:** 알림 전체에서 값이 고정된 레이블로 그룹화하지 마세요. Grafana의 기본 알림 정책은 `grafana_folder` 와 `alertname` 으로 그룹화하므로, 하나의 webhook에 담긴 모든 알림이 같은 alertname을 공유합니다 — `requestBody.alerts[*].labels.alertname` 으로 그룹화하면 페이로드 전체가 하나의 인시던트로 합쳐집니다. 또한 그룹화 경로는 리터럴 `requestBody.` 로 시작해야 하며, 경로에서 와일드카드로 동작하는 것은 첫 번째 `[*]` 뿐입니다. 이 모두가 조용히 실패합니다.

## 옵션 2 — 워크플로

"알림이 인시던트가 된다"를 넘어서는 로직이 필요할 때 사용하세요.

### 1단계 — OneUptime 워크플로 구성

1. **워크플로 → 워크플로 생성** 을 열고, 이름을 `Grafana → Incidents` 로 지정하고 **빌더** 를 엽니다.
2. **Webhook** 트리거를 추가하고 **URL을 복사합니다**. 블록 이름을 `Grafana` 로 변경합니다.
3. 트리거에 연결된 **Conditions** 블록을 추가합니다:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **Yes** 에서 **Create Incident** 블록을 추가합니다:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: 하나를 선택합니다(또는 `{{Grafana.Request Body.commonLabels.severity}}` 로 분기합니다).
5. **Save** 합니다(테스트 전까지 비활성 상태 유지).

## Grafana 연락처 포인트 설정

1. Grafana에서 **Alerting → Contact points → Add contact point** 로 이동합니다.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: 옵션 1의 모니터 URL 또는 옵션 2의 워크플로 webhook URL을 붙여넣습니다. **HTTP Method**: `POST`.
4. 연락처 포인트를 저장합니다.
5. **Alerting → Notification policies** 로 이동해 원하는 알림(또는 기본 정책)을 **OneUptime** 연락처 포인트로 라우팅합니다.

## 테스트

1. 워크플로를 만들었다면 활성화합니다.
2. 연락처 포인트 화면에서 **Test** 로 샘플 알림을 보내거나, 실제 알림 규칙이 발생하도록 둡니다.
3. **인시던트** 목록을 확인하세요 — 옵션 2를 사용했다면 워크플로의 **Logs** 탭도 확인합니다.

## 복구 시 해결

알림이 해소되면 Grafana는 `status: resolved` 가 담긴 알림을 한 번 더 보냅니다.

**옵션 1** 에서는 위에서 설정한 복구 필드와 값이 해당 인시던트를 자동으로 닫습니다 — **Auto Resolve Incident** 가 켜져 있다면요.

**옵션 2** 에서는 두 번째 **Conditions** 분기(`status == resolved`)를 추가해 해당 인시던트를 찾고 **Update Incident** 로 해결 상태로 옮기세요.

## 참고 사항

- **레거시 알림(Grafana 8 이하)** 은 다른 페이로드(`ruleName`, `state`, `evalMatches`)를 보냅니다. 레거시 알림을 쓴다면 `{{Grafana.Request Body.ruleName}}` 과 `{{Grafana.Request Body.state}}` 를 대신 참조하고 `state == alerting` 으로 분기하세요.
- Grafana의 알림 기능을 아예 건너뛰고 OneUptime이 같은 메트릭을 직접 모니터링하게 할 수도 있습니다 — [메트릭 모니터](/docs/monitor/metrics-monitor) 를 참고하세요.

## 문제 해결

- **아무것도 도착하지 않음** — Grafana가 URL에 도달할 수 있는지 확인하고(Grafana 서버 로그 확인), 옵션 2라면 워크플로가 **활성** 인지 확인하세요. OneUptime은 검증하기 전에 모든 수신 요청에 빈 `200` 으로 응답하므로, Grafana 로그의 `200` 은 페이로드가 수락되었음을 보장하지 않습니다.
- **인시던트가 열리지만 닫히지 않음** — criteria의 복구 필드와 값, 그리고 인시던트의 **Advanced Options** 에서 **Auto Resolve Incident** 가 켜져 있는지 확인하세요. 비교는 대소문자를 구분합니다.
- **알림이 가득한 페이로드인데 인시던트가 하나뿐임** — 알림 안에서 값이 달라지지 않는 레이블로 그룹화했습니다. 대신 `requestBody.alerts[*].fingerprint` 로 그룹화하세요.
- **인시던트 텍스트에 원본 `{{...}}` 플레이스홀더가 보임** — 경로가 해석되지 않았고, 해석되지 않은 플레이스홀더는 비워지지 않고 그대로 남습니다. 사용 중인 알림 버전에 존재하는 필드를 참조하세요. 옵션 2를 사용했다면 **Logs** 탭에서 트리거 출력을 확인하세요.

## 다음에 읽어 볼 내용

- [수신 요청 모니터](/docs/monitor/incoming-request-monitor) — 모니터 유형, criteria, 인시던트 그룹화 전체.
- [통합 개요](/docs/integrations/index) — 인바운드 패턴.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — 매우 유사한 페이로드.
- [메트릭 모니터](/docs/monitor/metrics-monitor) — OneUptime에서 메트릭을 직접 모니터링.
