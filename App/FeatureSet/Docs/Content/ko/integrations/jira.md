# Jira 통합

OneUptime 인시던트가 생성될 때마다 자동으로 [Jira](https://www.atlassian.com/software/jira) 이슈를 열어 — 개발자들이 이미 사용하는 곳에서 엔지니어링 작업을 추적하고, 인시던트로 돌아오는 링크도 유지합니다.

이 통합은 **아웃바운드**: OneUptime이 Jira의 REST API를 호출합니다. **Incident → On Create** 트리거와 **API 컴포넌트** 를 갖춘 OneUptime **[Workflow](/docs/workflows/index)** 를 사용합니다. 선택적으로 Jira 이슈를 닫으면 OneUptime 인시던트도 해결되는 **인바운드** 경로를 추가할 수 있습니다.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## 사전 요건

- Jira Cloud 사이트(`https://your-domain.atlassian.net`)와 이슈를 제출할 프로젝트 — **프로젝트 키** 를 확인해 두세요(예: `OPS`).
- 이슈를 만들 수 있는 Jira 계정과 [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)에서 발급한 **API 토큰**.
- 워크플로를 만들 수 있는 OneUptime 프로젝트.

> **Jira Data Center / Server (자체 관리형)** 를 사용하고 있나요? 흐름은 동일합니다 — 자체 기본 URL을 사용하고 Basic 인증 대신 `Bearer` 인증 헤더와 함께 [개인 액세스 토큰](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html)을 사용하세요. `/rest/api/2/issue` 엔드포인트는 일반 텍스트 설명을 허용하므로 템플릿 작성이 더 간단합니다.

## 1단계 — Jira 자격 증명을 시크릿으로 저장

Jira Cloud는 이메일과 API 토큰을 base64 인코딩한 **Basic 인증** 을 사용합니다.

1. `email:api_token` 을 한 번 Base64 인코딩합니다. macOS/Linux에서:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. OneUptime에서 **Workflows → Global Variables → Create** 로 이동합니다.
3. 이름을 `JIRA_AUTH` 로 지정하고 base64 문자열을 값으로 붙여넣고 **Is Secret** 를 켭니다.

이제 `Basic {{variable.JIRA_AUTH}}` 를 인증 헤더로 사용할 수 있으며, 토큰은 워크플로나 로그에 절대 노출되지 않습니다.

## 2단계 — 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Incidents → Jira` 로 지정하고 **Builder** 를 엽니다.
2. **Incident** 트리거를 캔버스에 끌어다 놓고 **On Create** 이벤트를 선택합니다. 이름을 `Incident` 로 변경합니다.
3. **API** 블록을 끌어다 트리거에 연결합니다. 다음과 같이 설정합니다:

   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3는 설명에 Atlassian Document Format을 사용합니다):

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   `OPS` 를 프로젝트 키로, `Bug` 를 해당 프로젝트에 있는 이슈 유형으로 교체하세요.

4. **Save** 합니다. 테스트 전까지 워크플로를 비활성 상태로 유지합니다.

## 3단계 — 테스트

1. 워크플로 **Enabled** 를 켭니다.
2. OneUptime에서 테스트 인시던트를 만듭니다(또는 모니터에서 하나 트리거합니다).
3. 워크플로의 **Logs** 탭을 엽니다. **API** 블록에서 `201` 상태와 새 이슈의 `key` 가 포함된 응답 본문(예: `OPS-1234`)을 확인합니다.
4. Jira를 확인합니다 — 이슈가 생성되어 있습니다.

API 블록에서 오류가 반환되면 로그에서 확장합니다 — Jira의 응답에 어떤 필드가 거부되었는지 정확히 설명됩니다. [문제 해결](#문제-해결)을 참조하세요.

## 4단계 — 인시던트에 이슈 링크 추가 (권장)

인시던트에 Jira 이슈 키를 저장해 두면 서로 이동하기 편리합니다.

- API 블록의 응답은 `{{CreateIssue.response-body.key}}` 로 사용할 수 있습니다(블록 이름을 `CreateIssue` 로 지정한 경우).
- 이후에 **Update Incident** 블록을 추가해 키를 라벨, 커스텀 필드, 또는 인시던트 메모에 기록합니다.

이 작업은 아래의 선택적 양방향 동기화도 가능하게 합니다.

## 양방향 동기화 (선택 사항)

누군가 Jira 이슈를 닫으면 OneUptime 인시던트도 해결되도록 하려면 **인바운드** 워크플로를 추가합니다:

1. **Webhook** 트리거로 시작하는 두 번째 워크플로를 만들고 URL을 복사합니다.
2. Jira에서 **Project settings → Automation → Create rule** 로 이동합니다:

   - **트리거**: _Issue transitioned_ to **Done** (또는 _Issue resolved_).
   - **액션**: _Send web request_ → 방식 `POST`, URL = 워크플로 webhook URL, 본문에 이슈 키와 OneUptime 인시던트 id 포함, 예:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. 워크플로에서 **Find Incident** 블록을 사용해 저장된 키로 인시던트를 찾고, **Update Incident** 블록으로 해결 상태로 이동합니다.

4단계에서 인시던트에 Jira 키를 저장했다면 매칭이 간단합니다. [컴포넌트 → OneUptime 데이터 컴포넌트](/docs/workflows/components#oneuptime-data-components)를 참조하시기 바랍니다.

## 이슈 커스터마이징

API 블록 본문에 대한 몇 가지 일반적인 조정:

- **Priority** — `fields` 안에 `"priority": { "name": "High" }` 를 추가합니다. **Conditions** 를 사용해 `{{Incident.incidentSeverity.name}}` 으로 분기하여 OneUptime 심각도를 Jira 우선순위로 매핑할 수 있습니다.
- **Labels** — `"labels": ["oneuptime", "incident"]` 를 추가합니다.
- **Assignee** — `"assignee": { "id": "<accountId>" }` 를 추가합니다(Jira Cloud는 사용자 이름 대신 계정 ID를 사용합니다).
- **커스텀 필드** — Jira 관리자에서 필드 ID를 사용해 `"customfield_XXXXX": "..."` 를 추가합니다.

프로젝트에서 예상하는 정확한 필드 이름을 알려면 브라우저나 `curl` 에서 Jira의 `GET /rest/api/3/issue/createmeta` 엔드포인트를 한 번 호출해 보세요.

## 문제 해결

**`401 Unauthorized`.**

- `email:api_token` 을 다시 인코딩하고 `JIRA_AUTH` 변수를 업데이트합니다. 줄 끝 개행 문자가 주요 원인입니다 — 인코딩 시 `echo` 대신 `printf` 를 사용하세요.
- API 토큰을 소유한 계정이 해당 프로젝트에서 이슈를 만들 수 있는지 확인합니다.

**`400 Bad Request` (필드 언급).**

- 이슈 유형이나 필수 필드가 잘못되었습니다. 프로젝트의 **이슈 유형** 이름과 필수 커스텀 필드가 있는지 확인합니다. `createmeta` (위 참조)를 사용해 필수 항목을 확인하세요.

**`404 Not Found`.**

- 기본 URL과 `/rest/api/3/issue` (Cloud) 또는 `/rest/api/2/issue` (Server/Data Center)를 사용하고 있는지 다시 확인합니다.

**설명이 한 줄로 보이거나 이상합니다.**

- v3는 위에 표시된 Atlassian Document Format이 필요합니다. 일반 텍스트를 보내려면 `/rest/api/2/issue` 엔드포인트와 함께 `"description": "{{Incident.description}}"` 을 일반 문자열로 사용하세요.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 인바운드/아웃바운드 패턴과 인증 빠른 참조.
- [API 컴포넌트](/docs/workflows/components#api) — 메서드, 헤더, 응답 읽기.
- [변수](/docs/workflows/variables) — 시크릿과 인시던트 필드.
- [PagerDuty](/docs/integrations/pagerduty) 및 [ServiceNow](/docs/integrations/servicenow) — 다른 도구에 대한 동일한 아웃바운드 패턴.
