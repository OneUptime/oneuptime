# Opsgenie 통합

OneUptime 인시던트가 생성될 때마다 [Opsgenie](https://www.atlassian.com/software/opsgenie) 알림을 만들고, OneUptime이 해결하면 닫습니다.

이 통합은 **아웃바운드**: OneUptime이 [Opsgenie Alert API](https://docs.opsgenie.com/docs/alert-api)를 호출합니다. **Incident → On Create** 트리거와 **API 컴포넌트** 를 갖춘 OneUptime **[Workflow](/docs/workflows/index)** 를 사용합니다.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## 사전 요건

- API 통합에서 발급한 Opsgenie **API 키**: **Settings → Integrations → Add → API**. 키를 복사합니다.
- 리전을 확인하세요. 기본 API 호스트는 `https://api.opsgenie.com` 이며, EU 계정은 `https://api.eu.opsgenie.com` 을 사용합니다.
- 워크플로를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — API 키 저장

1. **Workflows → Global Variables → Create** 로 이동합니다.
2. 이름을 `OPSGENIE_KEY` 로 지정하고 API 키를 붙여넣고 **Is Secret** 를 켭니다.

## 2단계 — "알림 생성" 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Incidents → Opsgenie` 로 지정하고 **Builder** 를 엽니다.
2. **Incident** 트리거를 **On Create** 로 설정해 추가합니다. 이름을 `Incident` 로 변경합니다.
3. 트리거에 연결된 **API** 블록을 추가합니다:

   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts` _(EU의 경우 `api.eu.opsgenie.com` 사용)_
   - **Headers**:

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   **`alias`** 는 이 Opsgenie 알림을 OneUptime 인시던트에 연결하므로 나중에 alias로 닫을 수 있습니다. Opsgenie 인증 방식은 리터럴 단어 `GenieKey` 뒤에 공백과 키를 붙입니다.

4. **Save** 하고, 활성화하고, 테스트 인시던트를 만듭니다. 워크플로 로그에서 `202 Accepted` 응답이 나오면 Opsgenie가 알림을 대기열에 넣은 것입니다.

## 3단계 — OneUptime 해결 시 닫기 (권장)

1. **Incident → On Update** 트리거를 가진 **두 번째** 워크플로 `Close Opsgenie` 를 만듭니다.
2. 인시던트가 해결되었는지 확인하는 **Conditions** 블록을 추가합니다(`{{Incident.currentIncidentState.name}}` 으로 분기합니다).
3. **Yes** 에서 **API** 블록을 추가합니다:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: 동일한 `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie가 alias로 알림을 조회해 닫습니다.

## 우선순위 매핑 (선택 사항)

Opsgenie 우선순위는 `P1`–`P5` 입니다. API 블록 앞에서 `{{Incident.incidentSeverity.name}}` 으로 **Conditions** 분기를 추가해 OneUptime 심각도에서 매핑합니다.

## 문제 해결

- **`401`/`403`** — 잘못된 키, 잘못된 리전 호스트, 또는 통합에 알림 생성 권한이 없습니다. **API** 통합 키와 일치하는 `api`/`api.eu` 호스트를 사용하고 있는지 확인하세요.
- **Close가 `404` 반환** — 닫기 호출의 `alias` 가 생성 호출과 정확히 일치해야 하며 쿼리 문자열에 `identifierType=alias` 가 있어야 합니다.
- **아무 일도 일어나지 않습니다** — 워크플로가 **Enabled** 상태인지 확인합니다.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 패턴과 인증 빠른 참조.
- [PagerDuty](/docs/integrations/pagerduty) — PagerDuty에 대한 동일한 아이디어.
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime의 내장 에스컬레이션.
