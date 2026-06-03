# ServiceNow 통합

OneUptime 인시던트가 생성될 때마다 자동으로 [ServiceNow](https://www.servicenow.com) 인시던트를 열어 — ITSM과 모니터링이 보조를 맞추도록 합니다.

이 통합은 **아웃바운드**: OneUptime이 ServiceNow [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html)를 호출합니다. **Incident → On Create** 트리거와 **API 컴포넌트** 를 갖춘 OneUptime **[Workflow](/docs/workflows/index)** 를 사용합니다.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## 사전 요건

- ServiceNow 인스턴스(`https://your-instance.service-now.com`).
- `rest_api_explorer` / `itil` 역할이 있거나 `incident` 레코드를 만들 권한이 있는 ServiceNow 사용자. 이 사용자의 자격 증명으로 Basic 인증을 사용하는 것이 가장 간단한 시작 방법입니다. 운영 환경에서는 OAuth를 권장합니다.
- 워크플로를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — 자격 증명을 시크릿으로 저장

ServiceNow의 Table API는 **Basic 인증** 을 허용합니다.

1. `username:password` 를 한 번 Base64 인코딩합니다:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. OneUptime에서 **Workflows → Global Variables → Create** 로 이동하고, 이름을 `SERVICENOW_AUTH` 로 지정하고, base64 문자열을 붙여넣고 **Is Secret** 를 켭니다.

## 2단계 — 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Incidents → ServiceNow` 로 지정하고 **Builder** 를 엽니다.
2. **Incident** 트리거를 **On Create** 로 설정해 추가합니다. 이름을 `Incident` 로 변경합니다.
3. 트리거에 연결된 **API** 블록을 추가합니다:
   - **Method**: `POST`
   - **URL**: `https://your-instance.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` 는 OneUptime 인시던트로 돌아오는 링크를 유지합니다 — 나중에 해결 단계를 추가할 때 유용합니다. ServiceNow `urgency`/`impact` 는 `1` (높음), `2` (보통), `3` (낮음)을 사용합니다.
4. **Save** 하고, 활성화하고, 테스트 인시던트를 만듭니다. 워크플로 로그에서 `201 Created` 응답이 나오면 새 레코드의 `sys_id` 와 `number` (예: `INC0012345`)가 반환됩니다.

## 3단계 — OneUptime 해결 시 해결 (선택 사항)

1. **Incident → On Update** 트리거와 인시던트가 해결되었는지 확인하는 **Conditions** 블록이 있는 **두 번째** 워크플로를 만듭니다.
2. 올바른 ServiceNow 레코드를 업데이트하려면 해당 `sys_id` 가 필요합니다. 2단계에서 OneUptime 인시던트에 저장하거나(`{{CreateRecord.response-body.result.sys_id}}` 를 읽어 **Update Incident** 로 라벨에 기록), `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}` 로 `GET` 요청해 먼저 레코드를 조회합니다.
3. **API** 블록을 추가합니다: **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, 본문 `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = 기본 ITIL 워크플로에서 해결됨).

## 문제 해결

- **`401`** — `printf` (개행이 추가되는 `echo` 가 아닌)로 `username:password` 를 다시 인코딩하고 `SERVICENOW_AUTH` 를 업데이트합니다.
- **`403`** — 사용자에게 `incident` 테이블을 쓸 권한이 없습니다. `itil` 역할을 추가하세요.
- **`400`** — 필드 이름이나 값이 인스턴스의 커스터마이징에 맞지 않습니다. **System Definition → Tables → incident** 에서 필드 이름을 확인하세요.
- **인스턴스가 호출을 거부합니다** — 일부 인스턴스는 Table API를 제한합니다. REST가 활성화되어 있고 IP가 ACL에 의해 차단되지 않았는지 확인하세요.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 패턴과 인증 빠른 참조.
- [Jira](/docs/integrations/jira) — Jira에 대한 동일한 아웃바운드 패턴.
- [API 컴포넌트](/docs/workflows/components#api) — 응답 본문 읽기.
