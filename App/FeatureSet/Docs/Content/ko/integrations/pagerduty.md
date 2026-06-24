# PagerDuty 통합

OneUptime 인시던트가 생성될 때마다 [PagerDuty](https://www.pagerduty.com) 인시던트를 트리거하고, OneUptime이 해결하면 함께 해결합니다. PagerDuty가 에스컬레이션과 온콜 일정을 관리하고 OneUptime의 모니터링이 여기로 연결되도록 하고 싶을 때 유용합니다.

이 통합은 **아웃바운드**: OneUptime이 PagerDuty의 [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/)를 호출합니다. **Incident → On Create** 트리거와 **API 컴포넌트** 를 갖춘 OneUptime **[Workflow](/docs/workflows/index)** 를 사용합니다.

> OneUptime에는 자체 온콜 및 에스컬레이션이 내장되어 있습니다 — [On Call](/docs/on-call/incoming-call-policy)을 참조하세요. 이벤트를 PagerDuty에도 전달하고 싶을 때만 이 통합을 사용하세요.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## 사전 요건

- **Events API v2** 통합이 있는 PagerDuty 서비스. PagerDuty에서: **Service → Integrations → Add integration → Events API v2**. **Integration Key** (라우팅 키라고도 함)를 복사합니다.
- 워크플로를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — 라우팅 키 저장

1. **Workflows → Global Variables → Create** 로 이동합니다.
2. 이름을 `PAGERDUTY_ROUTING_KEY` 로 지정하고 통합 키를 붙여넣고 **Is Secret** 를 켭니다.

## 2단계 — "트리거" 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Incidents → PagerDuty` 로 지정하고 **Builder** 를 엽니다.
2. **Incident** 트리거를 **On Create** 로 설정해 추가합니다. 이름을 `Incident` 로 변경합니다.
3. 트리거에 연결된 **API** 블록을 추가합니다:

   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   **`dedup_key`** 는 이 PagerDuty 인시던트를 OneUptime 인시던트에 연결하므로 나중에 해결할 수 있습니다. OneUptime 인시던트 id를 사용하면 고유하고 예측 가능합니다.

4. **Save** 하고, 활성화하고, 테스트 인시던트를 만듭니다. 워크플로 로그에서 `202` 응답이 나오면 PagerDuty가 이벤트를 수락한 것입니다.

## 3단계 — OneUptime 해결 시 함께 해결 (권장)

1. **같은** 워크플로에 두 번째 **Incident** 트리거를 추가하려고 하지 마세요 — 워크플로는 트리거가 하나입니다. 대신 **Incident → On Update** 트리거를 가진 **별도** 워크플로 `Resolve PagerDuty` 를 만듭니다.
2. 인시던트가 이제 해결되었는지 확인하는 **Conditions** 블록을 추가합니다(인시던트 상태/`{{Incident.currentIncidentState.name}}` 이 해결 상태 이름과 같은지 분기합니다).
3. **Yes** 에서 **같은 `dedup_key`** 와 `event_action` 을 `resolve` 로 설정한 **API** 블록을 PagerDuty에 추가합니다:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty가 `dedup_key` 로 원래 인시던트를 찾아 닫습니다.

## 심각도 매핑 (선택 사항)

PagerDuty의 `severity` 는 `critical`, `error`, `warning`, `info` 를 허용합니다. OneUptime 심각도에서 매핑하려면 API 블록 앞에서 `{{Incident.incidentSeverity.name}}` 으로 **Conditions** 분기를 추가하고 각 분기에서 다른 본문을 전송합니다.

## 인바운드 (선택 사항)

반대 방향으로 — PagerDuty 이벤트에서 OneUptime 인시던트를 열려면 — **Webhook** 트리거 워크플로를 추가하고 PagerDuty [V3 webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/)(또는 Events Orchestration)을 해당 URL로 지정한 다음 **Create Incident** 를 사용합니다. [인바운드 패턴](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime)을 참조하세요.

## 문제 해결

- **`400` with `"invalid routing key"`** — 통합은 이전 Events API v1이나 다른 통합 유형이 아닌 반드시 **Events API v2** 여야 합니다. 키를 다시 복사하세요.
- **Resolve가 아무것도 닫지 않습니다** — 해결 호출의 `dedup_key` 가 트리거 호출과 정확히 일치해야 합니다.
- **로그에 아무것도 없습니다** — 워크플로가 **Enabled** 상태이고 트리거가 **On Create** 인지 확인합니다.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 패턴과 인증 빠른 참조.
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime의 내장 에스컬레이션.
- [Opsgenie](/docs/integrations/opsgenie) — Opsgenie에 대한 동일한 아이디어.
