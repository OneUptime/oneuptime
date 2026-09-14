# Jira 통합

OneUptime 인시던트가 선언될 때마다 [Jira](https://www.atlassian.com/software/jira) 이슈를 열고, 인시던트가 진행되는 동안 보조를 맞추며, Jira가 상태 변경을 다시 OneUptime으로 밀어 넣도록 합니다 — 모두 [Workflow](/docs/workflows/index) 로 처리합니다. 설치해야 할 Jira 전용 블록은 없습니다. OneUptime은 [API 컴포넌트](/docs/workflows/components#api) 로 Jira의 REST API를 호출하고, Jira는 [Webhook 트리거](/docs/workflows/triggers#webhook) 로 다시 호출해 옵니다.

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

이 페이지는 양방향을 모두 구성합니다. 인바운드 섹션 이전의 모든 내용은 **Jira Cloud** 기준으로 작성되었으며, 끝부분의 한 섹션에서 **Jira Data Center** 에서 달라지는 점을 정리합니다.

> Atlassian은 Jira Cloud의 용어를 계속 바꾸고 있습니다. UI 상당 부분에서 **project**(프로젝트)는 이제 **space** 이고, **issue** 는 **work item** 입니다. 테넌트마다 두 용어 체계가 섞여 있으므로, 표현이 중요한 곳에서는 아래에 두 가지를 모두 적어 두었습니다.

## 사전 요건

- Jira Cloud 사이트(`https://your-domain.atlassian.net`)와 이슈를 제출할 프로젝트. **프로젝트 키** 를 확인해 두세요 — `OPS-1234` 의 `OPS` 부분입니다.
- 해당 프로젝트에서 이슈를 만들 수 있는 Jira 계정과, [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) 에서 발급한 그 계정의 **API 토큰**. 개인 계정보다 서비스 계정을 사용하세요 — 이렇게 생성된 이슈는 토큰 소유자의 이름으로 기록됩니다.
- 인바운드 절반을 위해, 해당 프로젝트에서 automation rule을 만들 수 있는 권한.
- 워크플로와 전역 변수를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — Jira 자격 증명을 시크릿으로 저장

Jira Cloud의 REST API는 Atlassian 계정 이메일과 API 토큰을 함께 base64 인코딩한 **Basic 인증** 을 사용합니다.

1. `email:api_token` 을 한 번 인코딩합니다:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   `echo` 가 아니라 `printf` 를 사용하세요. `echo` 는 개행 문자를 덧붙이고, 그 개행 문자까지 함께 인코딩되며, Jira는 붙여넣은 문자열만 봐서는 알 수 없는 이유로 `401` 을 응답합니다.

2. OneUptime에서 **워크플로 → 전역 변수 → 만들기** 로 이동합니다. 이름을 `JIRA_AUTH` 로 지정하고, base64 문자열을 **Content** 에 붙여넣고, **Secret** 를 켭니다.
3. 두 번째로, 시크릿이 아닌 변수 `JIRA_URL` 을 추가하고 끝에 슬래시 없이 `https://your-domain.atlassian.net` 을 넣습니다.

이제 어떤 블록이든 `Authorization` 헤더로 `Basic {{global.variables.JIRA_AUTH}}` 를 사용할 수 있으며, 토큰은 워크플로나 실행 로그에 절대 노출되지 않습니다. [변수](/docs/workflows/variables) 를 참조하시기 바랍니다.

Atlassian API 토큰에 대해, 아무도 지켜보지 않는 통합에서 언젠가는 문제가 되는 두 가지가 있습니다.

- **만료됩니다.** 토큰은 1일에서 1년 사이의 수명으로 생성되며 기본값은 1년이고, 갱신 수단은 없습니다 — 만료된 토큰은 같은 페이지에서 직접 새로 발급해 `JIRA_AUTH` 에 다시 인코딩해 넣어야 합니다. 만료일을 어딘가 캘린더에 적어 두세요. 몇 달 동안 잘 동작하던 워크플로가 갑자기 `401` 을 응답하기 시작한다면 이것이 원인입니다.
- **스코프가 지정된 토큰은 다른 기본 URL이 필요합니다.** 토큰 페이지에는 기존의 **Create API token** 과 함께 **Create API token with scopes** 도 제공됩니다. 스코프 토큰이 더 안전한 선택이지만, 이 토큰은 여러분의 사이트 주소로 보내지 않습니다. `https://api.atlassian.com/ex/jira/<cloudId>` 로 보내야 하므로 `JIRA_URL` 이 그 주소가 되고, 아래의 모든 경로는 그대로 그 뒤에 붙습니다. `cloudId` 는 `https://your-domain.atlassian.net/_edge/tenant_info` 의 JSON에 있습니다. 스코프 토큰을 `your-domain.atlassian.net` 으로 보내면 그냥 실패합니다.

조직이 Atlassian의 중앙 집중식 사용자 관리를 사용한다면, 만료 문제를 우회하는 세 번째 선택지가 있습니다. [서비스 계정용 OAuth 2.0 자격 증명](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/) 입니다. 토큰 대신 클라이언트 id와 시크릿을 받게 되며, 워크플로가 실행을 시작할 때마다 이를 단기 액세스 토큰으로 교환합니다 — [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) 페이지에서 쓰는 것과 같은 두 블록 구조로, **API Post (JSON)** 블록이 토큰을 가져오고 그 이후 모든 블록이 `Bearer <token>` 을 보냅니다. 1년 뒤에 손으로 교체할 것이 아무것도 없습니다. 정확한 토큰 요청 형식은 Atlassian 문서에 있으며, API 기본 URL은 `https://api.atlassian.com` 입니다.

## 2단계 — 모든 인시던트에 대해 Jira 이슈 열기

1. **워크플로 → 워크플로 생성** 을 열고, 이름을 `Incidents → Jira` 로 지정한 다음 **빌더** 를 엽니다.
2. 점선 자리 표시자 블록을 클릭하고 **On Create Incident** 트리거를 추가합니다. 그 **Select Fields** 에서 전송할 컬럼을 요청합니다:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   **Identifier** 는 `incident-on-create-1` 그대로 두세요 — 이후 블록들이 이 트리거를 가리킬 때 쓰는 이름입니다.

3. **Add Component** 를 클릭해 **API Post (JSON)** 블록을 추가하고, 트리거의 **Success** 점에서 새 블록의 입력 점으로 드래그합니다. 블록을 열고 **Identifier** 를 `create-issue` 로 설정한 다음 다음과 같이 채웁니다:

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   `OPS` 를 여러분의 프로젝트 키로, `Bug` 를 해당 프로젝트에 존재하는 이슈 유형으로 교체하세요. 둘 다 id로 지정할 수도 있으며 — `{"id": "10000"}` — Atlassian의 자체 예제가 그렇게 하고 있고, 사이트 안에서 이름이 같은 이슈 유형이 둘 있다면 id 쪽을 선호해야 합니다. 아래에 나오는 `createmeta` 호출이 그 id들을 알려 줍니다.

설명(description)이 무거워 보이는 이유는 Jira Cloud의 v3 API가 리치 텍스트를 문자열이 아니라 문서 트리인 **Atlassian Document Format** 으로 받기 때문입니다. 위 형태는 유효한 최소 문서입니다. 텍스트 노드 하나를 담은 문단 하나입니다. `environment` 와 여러 줄 텍스트 커스텀 필드에도 동일하게 적용됩니다. 한 줄 텍스트 커스텀 필드는 여전히 일반 문자열을 받습니다.

이제 **개요 → 워크플로 편집 → 활성화됨** 에서 워크플로를 켜고, 테스트 인시던트를 선언한 다음 **실행 및 로그** 를 엽니다. `create-issue` 블록에 `201` 과 새 이슈의 `id`, `key`, `self` 가 담긴 본문이 표시되어야 합니다. 캔버스의 변경 사항은 자동으로 저장됩니다 — Save 버튼은 없으며, 비활성화된 워크플로는 손으로도 전혀 실행할 수 없습니다.

새 이슈 키는 이 블록 이후의 어떤 블록에서든 사용할 수 있습니다:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### 더 많은 필드 채우기

`fields` 안에 자주 추가하는 항목 몇 가지:

- **Priority** — `"priority": { "id": "20000" }`, 사이트의 우선순위 id를 사용합니다. OneUptime 심각도를 Jira 우선순위로 매핑하려면 트리거와 API 블록 사이에 **If / Else** 블록을 넣고 `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` 으로 분기하세요.
- **Assignee** — `"assignee": { "id": "<accountId>" }`. Jira Cloud는 사람을 Atlassian 계정 id로 식별합니다. `username` 과 `userKey` 는 몇 년 전에 Cloud API에서 제거되었습니다.
- **Labels** — `"labels": ["oneuptime", "sev1"]`, 문자열의 평면 배열입니다. 라벨에는 공백을 넣을 수 없습니다.
- **Components** — `"components": [{ "id": "10000" }]`.
- **커스텀 필드** — `"customfield_10034": "..."`, 해당 필드 고유의 id를 사용합니다. 값의 형태는 필드 유형을 따릅니다. 단일 선택은 `{"value": "red"}` 를, 다중 선택은 id 배열을, 여러 줄 텍스트 필드는 Atlassian Document Format 문서를 받습니다.

프로젝트가 실제로 무엇을 요구하는지 알려면 추측하지 말고 Jira에 물어보세요. 프로젝트의 이슈 유형을 나열한 다음, 그중 하나의 필드를 나열합니다:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

두 번째 호출은 그 이슈 유형이 받는 모든 필드와 그중 필수 항목, 그리고 정확한 `customfield_NNNNN` id를 나열합니다. 이미 존재하는 이슈에서 id를 읽으려면 `?expand=names` 로 가져오세요.

## 3단계 — 인시던트 id를 Jira로 전달하기

양방향 동기화의 두 절반 모두 한쪽 시스템이 다른 쪽의 식별자를 보관해야 하며, 보관하기에는 Jira 쪽이 낫습니다. OneUptime의 `customFields` 컬럼은 단일 JSON 덩어리라서, 워크플로에서 값 하나를 쓰면 해당 인시던트의 모든 커스텀 필드가 대체됩니다.

**Jira 관리자가 있는 경우.** 짧은 텍스트 커스텀 필드를 — 예를 들어 *OneUptime Incident ID* 라는 이름으로 — 프로젝트의 생성 화면에 추가하고, `createmeta` 로 id를 찾은 다음, 다른 필드들과 함께 설정합니다:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**관리자가 없는 경우.** 대신 라벨에 넣으세요. 라벨에는 공백을 넣을 수 없고 OneUptime id는 평범한 UUID이므로, `oneuptime-<id>` 는 유효한 라벨입니다:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

이 경우 인바운드 워크플로가 목록에서 해당 라벨을 골라내야 하는데, 이는 **Run Custom JavaScript** 블록의 코드 두어 줄이면 됩니다. 가능하다면 커스텀 필드 쪽이 더 깔끔합니다.

여기까지 왔다면, Jira 이슈에 인시던트로 돌아오는 링크를 추가해 두는 것도 좋습니다. `create-issue` 뒤에 **API Post (JSON)** 블록을 두고 `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink` 를 가리키게 한 다음, 다음 내용을 넣으면:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

Jira의 모든 사람이 한 번의 클릭으로 되돌아올 수 있습니다. 이를 위해 트리거의 **Select Fields** 에 `projectId` 를 추가하세요. 이 호출을 반복해도 안전한 이유는 `globalId` 덕분입니다. Jira는 링크를 하나 더 추가하는 대신 그 id를 가진 기존 링크를 업데이트합니다. 업데이트는 빠뜨린 항목을 null로 만들기도 하므로, 일부만 담은 패치가 아니라 항상 `object` 전체를 보내세요.

## 4단계 — 인시던트가 진행될 때 댓글 달기와 전환하기

이 부분은 **두 번째** 워크플로로 만드세요. 그래야 여기서 실패해도 이슈 생성이 멈추지 않습니다.

1. **워크플로 생성** 으로 이름을 `Incident updates → Jira` 로 지정하고 **On Update Incident** 트리거를 추가합니다.
2. **Listen on** 에 `{"currentIncidentStateId": true}` 를 넣습니다. 그러면 트리거는 모든 편집이 아니라 상태 변경에만 발동합니다. **Select Fields** 에는 `{"_id": true, "currentIncidentState": {"name": true}}` 를 요청합니다.
3. **If / Else** 블록을 추가합니다: **Input 1** 은 `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** 는 `==`, **Input 2** 는 `Resolved` — 또는 프로젝트에서 해결 상태를 부르는 이름입니다. [인시던트 상태 및 심각도](/docs/incidents/states-and-severities) 를 참조하세요.

**Yes** 분기에서는 먼저 2단계에서 연 이슈를 찾아야 합니다. 3단계에서 저장한 id로 Jira에 조회하며, **Identifier** 가 `find-issue` 인 **API Post (JSON)** 블록을 사용합니다:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  라벨 대신 커스텀 필드를 사용했다면, 해당 절은 여러분의 필드 id를 넣은 `cf[10050] ~ \"...\"` 가 됩니다.

이슈 id는 `{{local.components.find-issue.returnValues.response-body.issues[0].id}}` 이며, 아래의 모든 엔드포인트는 키와 마찬가지로 id도 그대로 받습니다.

이 엔드포인트에 대해 알아 둘 것이 세 가지 있습니다. **JQL은 URL이 아니라 본문으로 보내세요** — 값 안에 `=` 가 들어 있는 쿼리 문자열은 워크플로를 빠져나가면서 잘려 나가는데, JQL은 온통 `=` 기호뿐입니다. **쿼리는 범위가 한정되어야 합니다.** 아무 조건 없는 `order by key desc` 는 `400` 으로 거부되며, `project =` 절이 있는 이유가 바로 이것입니다. 그리고 `/rest/api/3/search/jql` 이 현재 엔드포인트입니다 — 예전의 `/rest/api/3/search` 는 더 이상 사용되지 않고 곧 없어질 예정이니 손대지 마세요.

**댓글 남기기** 는 `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment` 로 향하는 **API Post (JSON)** 블록 하나면 되며, 본문은 설명과 마찬가지로 Atlassian Document Format입니다:

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**이슈 이동하기** 는 두 번의 호출이 필요합니다. 전환(transition)은 워크플로마다, 그리고 일부 보드에서는 이슈마다 달라지는 id로 식별되기 때문입니다.

1. `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` 에 대한 **API Get (JSON)** 블록은 *이슈의 현재 상태에서* 사용할 수 있는 전환들을 반환하며, 각각 `id` 와 `name`, 그리고 어떤 상태로 이어지는지 알려 주는 `to` 객체를 가집니다.
2. 같은 URL로 향하는 **API Post (JSON)** 블록이 전환을 수행합니다:

   ```json
   { "transition": { "id": "31" } }
   ```

전환이 성공하면 본문 없이 `204` 를 응답합니다. 실행 시점에 목록을 읽고 싶지 않다면, 올바른 상태의 이슈에 대해 한 번 직접 호출해 보고 id를 하드코딩해도 됩니다 — 다만 그 id는 해당 워크플로에 묶여 있으므로, 관리자가 Jira 워크플로를 편집하면 조용히 망가질 수 있다는 점을 기억하세요.

## 인바운드 — Jira에서 OneUptime으로

이제 반대 방향입니다. 누군가 이슈를 Done으로 옮기면 OneUptime 인시던트도 따라가야 합니다.

### 수신 워크플로를 먼저 구성하기

1. **워크플로 생성** 으로 이름을 `Jira → OneUptime` 으로 지정하고 **Webhook** 트리거를 추가합니다.
2. 그 워크플로의 **설정** 을 열어 **웹훅 시크릿 키** 를 복사합니다. URL은 다음과 같습니다:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   자체 호스팅 설치는 자체 호스트를 사용합니다. 이 URL은 비밀번호처럼 다루세요 — 이 URL을 아는 사람은 누구나 워크플로를 시작할 수 있습니다 — 유출되면 같은 페이지에서 키를 재설정하세요.

3. 다른 것이 실행되기 전에 공유 시크릿을 확인하는 **If / Else** 블록을 추가합니다. **Input 1** 은 `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** 는 `==`, **Input 2** 는 `{{global.variables.JIRA_WEBHOOK_SECRET}}` — 여러분이 직접 만들어 시크릿 전역 변수로 저장한 값입니다.
4. **Yes** 분기에서 **Update One Incident** 블록을 추가합니다:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: Jira의 변경이 여기서 의미해야 할 내용 — 보통은 상태 변경입니다.

   인시던트를 이동하려면 대상 상태의 id가 필요하며, `{"name": "Resolved"}` 쿼리를 가진 **Find One Incident State** 블록이 이를 `{{local.components.incident-state-find-one-1.returnValues.model._id}}` 로 제공합니다. 이 값을 `currentIncidentStateId` 에 씁니다.

워크플로는 활성화된 채로 두세요. 이제 Jira가 호출할 대상을 만들어 줍니다.

### Jira automation rule에서 이벤트 보내기

1. Jira에서 프로젝트의 automation rule을 엽니다. 최신 테넌트에서는 **Space settings → Automation**, 이전 테넌트에서는 **Project settings → Automation** 입니다. 여러 프로젝트에 걸친 규칙에는 **Settings → System → Global automation** 을 사용하며, *Administer Jira* 전역 권한이 필요합니다.
2. **Create rule** 을 선택하고 **Work item transitioned** 트리거를 고릅니다 — 이전 테넌트에서는 **Issue transitioned** 입니다. 상태가 **Done** *으로* 이동할 때 실행되도록 설정합니다.

   *Work item updated* 가 아니라 이 트리거를 사용하세요. update 트리거는 의도적으로 상태 변경을 제외합니다.

3. **Send web request** 액션을 추가하고 다음과 같이 설정합니다:

   - **Web request URL**: 위에서 얻은 OneUptime webhook URL.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, 그리고 `X-OneUptime-Secret` / 여러분의 공유 시크릿. 다른 규칙 편집자가 읽지 못하도록 시크릿 값에는 **Hide** 옵션을 사용하세요 — 다만 해당 값에 대해 숨김은 되돌릴 수 없으며, 규칙을 내보내거나 복제하면 숨겨진 값은 사라집니다.
   - **Web request body**: **Custom format** 을 선택해 형태를 직접 제어합니다:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     3단계에서 커스텀 필드 대신 라벨을 사용했다면 `"labels": "{{issue.labels}}"` 를 보내고, OneUptime 쪽에서 **Run Custom JavaScript** 블록으로 id를 뽑아내세요.

4. 규칙을 켜고, 테스트 이슈를 Done으로 옮긴 다음 양쪽을 확인합니다. Jira의 규칙 자체 감사 로그와 OneUptime의 **실행 및 로그** 입니다.

이 방식에 의존하기 전에 알아 두면 좋은 것들:

- **대상 포트가 제한되어 있습니다.** Send web request는 포트 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900, 9900 에만 도달합니다. OneUptime Cloud는 443이며, 특이한 포트를 쓰는 자체 호스팅 설치는 이 방식으로 호출할 수 없습니다.
- **요청 서명이 없습니다.** 이 액션에는 HMAC 옵션이 없으므로, HTTPS 위에서 헤더에 담은 공유 시크릿이 Atlassian이 문서화한 방식입니다. 수신 워크플로 3단계의 **If / Else** 검사가 이를 의미 있게 만들어 줍니다.
- **규칙 실행량은 계량됩니다.** Jira Cloud는 성공한 규칙 실행 횟수를 플랜에 따른 월간 허용량에서 차감합니다 — Free 100회, Standard 1,700회, Premium은 1,000 × 사용자 수, Enterprise는 무제한입니다. 바쁜 프로젝트에서 모든 전환마다 발동하는 규칙은 금세 쌓입니다.
- **값은 URL 인코딩되지 않습니다.** 이는 폼 인코딩 본문을 보낼 때만 문제가 됩니다. 위의 JSON은 괜찮습니다.
- OneUptime 설치가 허용 목록 뒤에 있다면 **Atlassian이 공개하는 이그레스 대역** 이 [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com) 에 있습니다. 대역은 바뀌므로 주소를 고정하지 말고 피드를 주기적으로 조회하세요.

### 또는 Jira webhook 사용하기

Jira 관리자는 **Settings → System → Advanced → WebHooks** 에서 webhook을 직접 등록할 수 있으며, 보낼 이벤트와 선택적으로 어떤 이슈가 발동할지 좁히는 JQL 쿼리를 지정할 수 있습니다. automation rule과 비교하면:

- 페이로드는 여러분의 것이 아니라 Jira 자체 형식입니다. `webhookEvent`, `issue_event_type_name`, 전체 `issue`, 그리고 변경된 모든 필드의 변경 전후를 `items` 배열에 담은 `changelog` 입니다. 상태 변경이라면 `field` 가 `status` 인 항목을 봐야 합니다. 워크플로 안에서 이를 읽으려면 보통 **Run Custom JavaScript** 블록이 필요합니다.
- webhook은 서명할 **수** 있지만 — webhook에 시크릿을 지정하면 Jira가 요청 본문의 HMAC을 담은 `X-Hub-Signature` 헤더를 보냅니다 — 워크플로는 이를 검증할 수 없습니다. 서명은 Jira가 보낸 정확한 바이트를 대상으로 하는데, Webhook 트리거는 이미 JSON으로 파싱된 본문을 워크플로에 넘겨주므로 해시할 대상이 남아 있지 않습니다. 요청을 인증하고 싶다면 공유 시크릿 헤더를 쓰는 automation rule을 대신 사용하세요.
- URL은 Jira 자체 목록에 있는 포트의 HTTPS여야 하며, 이 목록은 automation 액션이 쓰는 목록과 *같지 않습니다* — 여기서는 포트 80이 허용되지 않습니다.
- 전달은 5분에서 15분의 백오프로 최대 다섯 번까지 재시도되므로, 같은 이벤트가 두 번 도착해도 워크플로가 견딜 수 있어야 합니다.

앱이 `/rest/api/3/webhook` 을 통해 등록한 webhook은 또 다른 이야기입니다. 갱신하지 않으면 등록 후 30일이 지나 만료됩니다. 위의 관리자 등록 방식은 만료되지 않습니다.

## Jira Data Center

자체 관리형 Jira도 몇 가지만 바꾸면 동일하게 동작합니다. **Jira Server** 는 2024년 2월에 지원이 종료되어 수정 사항을 받지 못하므로, 자체 관리형 대상은 Data Center로 보는 것이 좋습니다.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — Data Center에는 v3가 없습니다                            |
| Atlassian Document Format 문서인 `description`    | wiki 마크업의 일반 문자열인 `description`                                    |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| id.atlassian.com에서 발급한 API 토큰              | 본인 Jira 계정의 **Profile → Personal access tokens → Create token**         |
| Automation 액션 **Send web request**              | Automation 액션 **Send outgoing web request**                                |

따라서 이슈 생성 블록은 `/rest/api/2/issue` 로의 `POST` 가 되며 내용은 다음과 같습니다:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

문서 트리가 없으므로 템플릿을 만들기가 더 간단합니다.

그 밖에 대비해야 할 차이점:

- **개인 액세스 토큰** 은 Jira Core 및 Jira Software 8.14, Jira Service Management 4.15부터 사용할 수 있습니다. 이 토큰은 만료되며 — 기본값은 365일 — UI는 만료 5일 전부터 *Expires soon* 으로 표시합니다. Data Center에서는 사용자 이름과 비밀번호를 쓰는 Basic 인증도 여전히 동작하지만, 로그인이 몇 번 실패하면 CAPTCHA가 발동해 사람이 브라우저에서 해제할 때까지 해당 계정이 REST API에서 완전히 잠깁니다. 오타를 발견하는 방법치고는 좋지 않으니 토큰을 사용하세요.
- **Automation은 기본 포함** 되어 있습니다. Jira Data Center 10.0부터이며, 그 이전에는 별도로 설치하는 Automation for Jira 앱이었습니다. 발신 요청의 기본 타임아웃은 3000 ms이며, `outgoing.webhook.timeout.ms` 속성으로 조정할 수 있습니다.
- **Webhook** 은 **Administration → System → Advanced → WebHooks** 에서 등록하며 JQL 범위 지정을 지원합니다. 이 필터는 좁게 유지하세요. Jira는 등록된 모든 webhook의 JQL을 이벤트를 발생시킨 스레드에서 평가하므로, 느슨한 필터가 여럿 있으면 이를 촉발한 사용자 동작 자체가 느려집니다.
- **Data Center 10.0부터 webhook 전달은 비동기** 이며 동기 옵션이 없으므로, 이벤트가 순서와 다르게 도착할 수 있습니다. 수신 워크플로를 멱등하게 만드세요.
- **Jira 10은 webhook URL 변수에서 `$` 를 없앴고** — `${issue.id}` 가 `{issue.id}` 가 되었습니다 — webhook REST 리소스를 `/rest/webhooks/1.0/webhook` 에서 `/rest/jira-webhook/1.0/webhooks` 로 옮겼습니다.

## 알림에 대해 같은 작업 하기

위의 모든 내용은 흔한 사례이기 때문에 인시던트를 중심으로 작성했지만, 알림도 똑같이 동작합니다 — 레코드 유형만 바꾸면 나머지는 그대로입니다:

| 인시던트                                 | 알림                                        |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

워크플로에는 트리거가 정확히 하나뿐이므로 인시던트와 알림에는 각각 워크플로가 하나씩 필요합니다. 둘이 같은 일을 한다면 Jira 쪽 절반을 한 번만 만들고 **Execute Workflow** 컴포넌트로 양쪽에서 호출하세요.

## 문제 해결

먼저 **실행 및 로그** 에서 실패한 블록을 여세요. Jira는 무엇을 거부했는지 정확히 알려 주는 JSON 본문을 반환하며, API 컴포넌트는 이를 `response-body` 에 보관합니다.

**`401 Unauthorized`.** `printf` 로 `email:api_token` 을 다시 인코딩하고 `JIRA_AUTH` 를 업데이트하세요. `echo` 때문에 붙은 끝의 개행 문자가 흔한 원인입니다. 그다음 토큰을 소유한 계정이 해당 프로젝트에서 이슈를 만들 수 있는지 확인하세요. Data Center에서는 `Basic` 이 아니라 `Bearer` 를 보내고 있는지 확인하세요.

**필드 이름이 담긴 `400 Bad Request`.** 프로젝트에 그 이슈 유형이 없거나, 프로젝트에 여러분이 보내지 않은 필수 필드가 있습니다. 위의 `createmeta` 호출을 해당 프로젝트와 이슈 유형에 대해 실행하고 비교하세요.

**`description` 에 대해 불평하는 `400`.** Cloud v3에서 설명은 문자열이 아니라 Atlassian Document Format 문서여야 합니다. 위에 표시된 문서를 보내거나, 해당 블록을 `/rest/api/2/issue` 로 바꾸고 일반 텍스트를 보내세요.

**`404 Not Found`.** 기본 URL과 API 버전을 확인하세요 — Cloud는 `/rest/api/3/...`, Data Center는 `/rest/api/2/...` 입니다.

**`429 Too Many Requests`.** Jira가 속도를 제한하고 있습니다. 응답에는 초 단위의 `Retry-After` 와 어떤 한도에 걸렸는지 알려 주는 `RateLimit-Reason` 이 담깁니다. 단일 이슈에 대한 쓰기는 매우 빡빡하게 제한되므로 — 2초에 스무 번 정도 — 짧은 간격으로 댓글을 달고 전환하는 워크플로는 이슈 하나만으로도 한도에 걸릴 수 있습니다. 호출 사이에 **Delay** 블록을 넣거나, 대량 작업은 예약 워크플로로 옮기세요.

**전환 호출이 `400` 을 반환합니다.** 전환 id가 이슈의 *현재* 상태에서 유효하지 않습니다. 그 이슈의 `/transitions` 를 가져와 응답에 있는 id를 사용하세요.

**automation rule은 성공으로 표시되는데 OneUptime에는 아무것도 도착하지 않습니다.** 먼저 포트를 확인하세요 — 위의 제한 목록을 참조합니다. 그다음 `curl` 로 직접 webhook URL에 요청을 보내 **실행 및 로그** 에 나타나는지 보세요. 여러분의 요청은 도착하는데 Jira의 것은 도착하지 않는다면 문제는 Jira 쪽에 있습니다.

**워크플로는 실행되는데 인시던트가 바뀌지 않습니다.** **Update One Incident** 블록은 쿼리가 아무것도 찾지 못했을 때 `Items Updated: 0` 을 보고하며, 이는 오류가 아니라 성공으로 계산됩니다. 페이로드의 id가 정말 OneUptime 인시던트 id인지, 그리고 `_id` 로 쿼리하고 있는지 확인하세요.

**Jira 이슈에 `{{...}}` 참조가 문자 그대로 표시됩니다.** 해석되지 않은 참조는 비워지는 대신 텍스트로 그대로 전달됩니다. 실행 로그에는 해석되지 않은 참조가 표시됩니다 — 대개 블록 식별자를 잘못 입력했거나 변수 이름이 바뀐 경우입니다.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 인바운드/아웃바운드 패턴과 인증 빠른 참조.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — Dynamics를 대상으로 한 동일한 양방향 구성.
- [워크플로 개요](/docs/workflows/index) 및 [워크플로 작성](/docs/workflows/authoring) — 캔버스, 식별자, 워크플로 켜기.
- [컴포넌트](/docs/workflows/components) — API 블록, If / Else, OneUptime 데이터 컴포넌트.
- [변수](/docs/workflows/variables) — 시크릿, 그리고 한 블록의 출력을 다음 블록에서 읽기.
- [설정 및 보안](/docs/workflows/configuration) — webhook 보안과 아웃바운드 네트워크 접근.
- [ServiceNow](/docs/integrations/servicenow) 및 [PagerDuty](/docs/integrations/pagerduty) — 다른 도구에 대한 동일한 아웃바운드 패턴.
