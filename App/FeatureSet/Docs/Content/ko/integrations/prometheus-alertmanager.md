# Prometheus Alertmanager 통합

[Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) 알림을 OneUptime 인시던트로 변환합니다. Prometheus가 알림 규칙을 평가하고, Alertmanager가 라우팅하면, OneUptime이 기록하고 에스컬레이션합니다.

이 통합은 **인바운드**: Alertmanager가 **Webhook 트리거** 로 시작하는 OneUptime **[Workflow](/docs/workflows/index)** 로 POST합니다.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 사전 요건

- `alertmanager.yml` 을 편집할 수 있는 Prometheus + Alertmanager 설정.
- Alertmanager가 HTTPS로 OneUptime 인스턴스에 도달할 수 있어야 합니다.
- 워크플로를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — OneUptime 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Alertmanager → Incidents` 로 지정하고 **Builder** 를 엽니다.
2. **Webhook** 트리거를 추가하고 **URL을 복사합니다**. 블록 이름을 `Alertmanager` 로 변경합니다.
3. 트리거에 연결된 **Conditions** 블록을 추가합니다:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **Yes** 에서 **Create Incident** 블록을 추가합니다:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: 하나를 선택합니다(또는 먼저 `{{Alertmanager.Request Body.commonLabels.severity}}` 로 분기합니다).
5. **Save** 합니다(테스트 전까지 비활성 상태 유지).

> **그룹화된 알림에 대해.** Alertmanager는 알림을 그룹화하여 `alerts` **배열** 로 전송합니다. 위의 `commonLabels` 와 `commonAnnotations` 는 그룹 전체에서 공유되는 필드입니다 — 알림당 인시던트 하나를 만들기에 적합합니다. **알림마다 인시던트를 하나씩** 만들려면 `Request Body.alerts` 를 반복하며 각각 인시던트를 만드는 [Custom Code](/docs/workflows/components#custom-code) 블록을 추가하세요. 라우트의 `group_by` 로 그룹화를 조정하세요.

## 2단계 — Alertmanager 설정

워크플로 URL을 가리키는 webhook 수신자를 추가하고 알림을 라우팅합니다. `alertmanager.yml` 에서:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Alertmanager를 다시 로드합니다(`curl -X POST http://localhost:9093/-/reload` 또는 재시작).

## 3단계 — 테스트

1. 워크플로를 활성화합니다.
2. 테스트 알림을 발생시킵니다 — 예를 들어 `amtool` 로:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. 워크플로의 **Logs** 탭과 **Incidents** 목록을 확인합니다.

## 복구 시 해결 (선택 사항)

`send_resolved: true` 설정으로 Alertmanager는 알림이 해제될 때도 POST하며, 이번에는 `status: resolved` 로 옵니다. 두 번째 **Conditions** 분기(`status == resolved`)를 추가하고, 일치하는 인시던트를 찾아(`commonLabels.alertname` 으로 매칭), **Update Incident** 로 해결 상태로 이동합니다.

## 문제 해결

- **실행이 나타나지 않습니다** — Alertmanager가 URL에 도달할 수 있는지 확인합니다(로그에서 전달 오류를 확인) 그리고 워크플로가 **Enabled** 상태인지 확인합니다.
- **인시던트 필드가 비어 있습니다** — 규칙마다 다른 어노테이션을 설정합니다. **Logs** 탭에서 트리거 출력을 검사하고 실제로 존재하는 필드를 참조합니다(`commonAnnotations` vs 알림별 `annotations`).
- **인시던트가 너무 많습니다** — `group_by`/`group_interval` 을 늘려 Alertmanager가 관련 알림을 배치 처리하도록 합니다.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 인바운드 패턴.
- [Grafana](/docs/integrations/grafana) — 동일한 아이디어, Grafana 알림.
- [Webhook 트리거](/docs/workflows/triggers#webhook) — 수신 URL의 동작 방식.
