# Datadog 통합

[Datadog](https://www.datadoghq.com) 모니터 알림을 OneUptime 인시던트로 변환하여 Datadog의 감지가 OneUptime의 인시던트 대응과 상태 페이지로 연결되도록 합니다.

이 통합은 **인바운드**: Datadog의 [Webhooks 통합](https://docs.datadoghq.com/integrations/webhooks/)이 **Webhook 트리거** 로 시작하는 OneUptime **[Workflow](/docs/workflows/index)** 로 POST합니다.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 사전 요건

- 통합과 모니터를 설정할 수 있는 Datadog 계정.
- 워크플로를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — OneUptime 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Datadog → Incidents` 로 지정하고 **Builder** 를 엽니다.
2. **Webhook** 트리거를 추가하고 **URL을 복사합니다**. 블록 이름을 `Datadog` 으로 변경합니다.
3. 트리거에 연결된 **Conditions** 블록을 추가합니다:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. **Yes** 에서 **Create Incident** 블록을 추가합니다:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: 하나를 선택합니다.
5. **Save** 합니다(테스트 전까지 비활성 상태 유지).

## 2단계 — Datadog webhook 만들기

1. Datadog에서 **Integrations → Webhooks** 로 이동합니다(아직 설치하지 않은 경우 **Webhooks** 통합을 설치합니다).
2. **webhook을 추가합니다**:

   - **Name**: `oneuptime` (이것이 `@webhook-oneuptime` 이 됩니다).
   - **URL**: 워크플로의 webhook URL.
   - **Payload** — Datadog에서 [템플릿 변수](https://docs.datadoghq.com/integrations/webhooks/#usage)를 사용해 JSON 본문을 정의할 수 있습니다:

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. webhook을 저장합니다.

## 3단계 — 모니터의 알림을 webhook으로 전송

전달하려는 각 모니터의 **알림 메시지** 에 webhook 핸들을 추가합니다:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

이렇게 하면 알림과 복구 모두 OneUptime으로 전송됩니다. (모든 것을 전달하려면 `@webhook-oneuptime` 을 모니터에 무조건 추가할 수도 있습니다.)

## 4단계 — 테스트

1. 워크플로를 활성화합니다.
2. 모니터에서 **Test Notifications → Alert** 를 사용하거나 실제 모니터가 발동되도록 합니다.
3. 워크플로의 **Logs** 탭과 **Incidents** 목록을 확인합니다.

## 복구 시 해결 (선택 사항)

모니터가 해제되면 `$ALERT_TRANSITION` 이 `Recovered` 가 됩니다. 두 번째 **Conditions** 분기(`transition == Recovered`)를 추가하고, 일치하는 인시던트를 찾아(전송한 `id` 로 매칭) **Update Incident** 로 해결 상태로 이동합니다.

## 문제 해결

- **실행이 나타나지 않습니다** — 모니터 메시지에 `@webhook-oneuptime` 이 포함되어 있고 워크플로가 **Enabled** 상태인지 확인합니다.
- **필드가 비어 있습니다** — Datadog은 이벤트에 해당하는 템플릿 변수만 치환합니다. **Logs** 탭에서 트리거 출력을 검사하고 webhook 페이로드를 조정하세요.
- **중복 인시던트** — 재알림(renotify) 모니터는 여러 `Triggered` 이벤트를 보냅니다. 생성 전에 `id` 로 **Find Incident** 검사를 해 중복을 제거하세요.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 인바운드 패턴.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) 및 [Grafana](/docs/integrations/grafana) — 다른 인바운드 소스.
- [Webhook 트리거](/docs/workflows/triggers#webhook) — 수신 URL의 동작 방식.
