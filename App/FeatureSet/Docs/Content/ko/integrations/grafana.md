# Grafana 통합

[Grafana](https://grafana.com) 알림을 OneUptime 인시던트로 변환합니다. Grafana가 대시보드의 알림 규칙을 평가하면, OneUptime이 기록하고 에스컬레이션하고 추적합니다.

이 통합은 **인바운드**: Grafana의 알림이 Grafana **Webhook 연락처 포인트** 를 사용해 **Webhook 트리거** 로 시작하는 OneUptime **[Workflow](/docs/workflows/index)** 로 POST합니다.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 사전 요건

- [통합 알림](https://grafana.com/docs/grafana/latest/alerting/)이 활성화된 Grafana 9 이상(최신 Grafana의 기본값).
- Grafana가 HTTPS로 OneUptime 인스턴스에 도달할 수 있어야 합니다.
- 워크플로를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — OneUptime 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Grafana → Incidents` 로 지정하고 **Builder** 를 엽니다.
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

Grafana의 webhook 페이로드는 Alertmanager 형태를 따릅니다 — `status`, `alerts` 배열, `commonLabels`, `commonAnnotations` 를 포함하며, 편리한 최상위 `title` 과 `message` 필드도 있습니다.

## 2단계 — Grafana 연락처 포인트 설정

1. Grafana에서 **Alerting → Contact points → Add contact point** 로 이동합니다.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: 워크플로의 webhook URL을 붙여넣습니다. **HTTP Method**: `POST`.
4. 연락처 포인트를 저장합니다.
5. **Alerting → Notification policies** 로 이동해 원하는 알림(또는 기본 정책)을 **OneUptime** 연락처 포인트로 라우팅합니다.

## 3단계 — 테스트

1. 워크플로를 활성화합니다.
2. 연락처 포인트 화면에서 **Test** 를 사용해 샘플 알림을 보내거나 실제 알림 규칙이 발생하도록 둡니다.
3. 워크플로의 **Logs** 탭과 **Incidents** 목록을 확인합니다.

## 복구 시 해결 (선택 사항)

알림이 해제되면 Grafana는 `status: resolved` 로 다른 알림을 보냅니다. 두 번째 **Conditions** 분기(`status == resolved`)를 추가하고, 일치하는 인시던트를 찾아 **Update Incident** 로 해결 상태로 이동합니다.

## 참고 사항

- **레거시 알림 (Grafana 8 이전)** 은 다른 페이로드(`ruleName`, `state`, `evalMatches`)를 전송합니다. 레거시 알림을 사용하는 경우 `{{Grafana.Request Body.ruleName}}` 과 `{{Grafana.Request Body.state}}` 를 대신 참조하고 `state == alerting` 으로 분기하세요.
- Grafana의 알림을 완전히 건너뛰고 OneUptime이 동일한 메트릭을 직접 모니터링하도록 할 수도 있습니다 — [메트릭 모니터](/docs/monitor/metrics-monitor)를 참조하세요.

## 문제 해결

- **실행이 나타나지 않습니다** — Grafana가 URL에 도달할 수 있는지 확인합니다(Grafana 서버 로그 확인) 그리고 워크플로가 **Enabled** 상태인지 확인합니다.
- **필드가 비어 있습니다** — **Logs** 탭에서 트리거 출력을 검사합니다. 사용 중인 알림 버전에 존재하는 필드를 참조하세요.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 인바운드 패턴.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — 밀접하게 관련된 페이로드.
- [메트릭 모니터](/docs/monitor/metrics-monitor) — OneUptime에서 직접 메트릭 모니터링.
