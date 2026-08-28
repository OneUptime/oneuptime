# Microsoft Dynamics 365 통합

OneUptime 인시던트가 선언될 때마다 [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) 에서 **Case** 를 열고, 인시던트가 진행되는 동안 그 케이스가 보조를 맞추게 하며, Dynamics가 케이스 변경을 다시 OneUptime으로 밀어 넣도록 합니다 — 모두 [Workflow](/docs/workflows/index) 로 처리합니다. 설치해야 할 Dynamics 전용 블록은 없습니다. OneUptime은 [API 컴포넌트](/docs/workflows/components#api) 로 **Dataverse Web API** 와 통신하고, Dynamics는 [Webhook 트리거](/docs/workflows/triggers#webhook) 를 통해 응답해 옵니다.

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

이 페이지는 양방향을 모두 다룹니다. 아웃바운드 절반을 먼저 구성하세요 — Microsoft Entra ID 설정이 필요한 쪽이며, 이것이 동작하고 나면 인바운드 절반은 플로 하나로 끝납니다.

## 사전 요건

- **Case** 테이블이 있는 **Dynamics 365** 환경. 케이스는 Dynamics 365 Customer Service에서 제공되며, 이것이 없는 Dataverse 환경에는 쓸 수 있는 `incident` 테이블이 없습니다.
- 해당 환경의 **Web API 엔드포인트**. [Power Platform 관리 센터](https://admin.powerplatform.microsoft.com/) 에서 환경의 **Settings → Developer resources** 아래, 또는 **make.powerapps.com → Settings → Developer resources** 에서 찾을 수 있습니다. `https://yourorg.crm.dynamics.com/api/data/v9.2/` 와 같은 형태이며 지역 구간이 달라집니다(북미는 `crm`, 남미는 `crm2`, 일본은 `crm7` 등).
- **Microsoft Entra ID** 에 애플리케이션을 등록할 권한과 Dynamics 환경에서 **application user** 를 만들 권한. 보통 이 둘은 서로 다른 관리자입니다.
- 워크플로와 전역 변수를 만들 수 있는 OneUptime 프로젝트.

> 아래 내용은 모두 Dynamics 폼에 표시되는 레이블이 아니라 Dataverse 테이블 이름을 사용합니다. 케이스는 **`incident`** 테이블이고, URL에서의 컬렉션은 **`incidents`**, 기본 키는 **`incidentid`**, 제목 컬럼은 **`title`** 입니다. UI에 보이는 케이스 번호는 **`ticketnumber`** 입니다.

## 1단계 — Microsoft Entra ID에 애플리케이션 등록

OneUptime은 사람이 아니라 애플리케이션으로 인증하므로 OAuth 2.0 **client credentials** 흐름을 사용합니다.

1. Dynamics 환경과 같은 테넌트의 관리자로 [Azure 포털](https://portal.azure.com) 에 로그인하고 **Microsoft Entra ID** 를 엽니다.
2. **App registrations → New registration** 으로 이동합니다. `OneUptime Integration` 같은 이름을 지정하고, **Supported account types** 는 **Accounts in this organizational directory only** 로 둔 다음 **Register** 를 선택합니다.
3. 앱의 **Overview** 페이지에서 **Application (client) ID** 와 **Directory (tenant) ID** 를 복사합니다.
4. **Certificates & secrets → Client secrets → New client secret** 으로 이동합니다. 페이지를 벗어나기 전에 시크릿의 ID가 아닌 **Value** 를 복사하세요. 다시는 표시되지 않습니다. 클라이언트 시크릿의 수명은 최대 24개월이므로, 만료일을 눈에 띄는 곳에 적어 두세요.

여기서 사람들이 추가하지만 실제로는 필요 없는 두 가지:

- **API 권한은 필요 없습니다.** client credentials 흐름에는 로그인한 사용자가 없으므로 위임된 권한은 아무 역할도 하지 않습니다. **Dataverse** 아래의 `user_impersonation` 은 위임된 권한이며 대화형 앱 전용입니다. Microsoft Entra ID는 권한을 전혀 구성하지 않아도 Dataverse용 토큰을 잘 발급합니다 — 접근 여부는 2단계에서 Dynamics 쪽이 결정합니다.
- **관리자 동의 단계도 필요 없습니다.** 이유는 같습니다.

Microsoft는 프로덕션 애플리케이션에서 클라이언트 시크릿보다 인증서를 권장합니다. 그 방식은 호출자가 직접 JWT 어설션을 만들어 서명해야 하는데 워크플로는 그럴 수 없으므로, 여기서는 클라이언트 시크릿이 현실적인 선택입니다 — 그에 맞게 다루세요. 시크릿 변수에 보관하고, 만료 전에 교체하세요.

## 2단계 — Dynamics에 application user 만들기

이 단계가 흔히 누락되며, 누락되면 이 통합 전체에서 가장 헷갈리는 실패가 발생합니다. 토큰 요청은 성공하는데 이후 모든 Dataverse 호출이 `403 Forbidden` 과 오류 코드 `0x80072560` — *"The user isn't a member of the organization."* — 으로 실패합니다. Entra ID는 Dynamics에 대해 아무것도 모른 채 토큰을 발급하고, Dynamics는 그 애플리케이션에 대응하는 사용자 행을 찾는데 그런 행이 없기 때문입니다.

1. [Power Platform 관리 센터](https://admin.powerplatform.microsoft.com/) 를 열고 **Manage → Environments** 를 선택한 다음 해당 환경을 선택합니다.
2. **Settings → Users + permissions → Application users** 를 선택합니다.
3. **+ New app user** 를 선택하고 **+ Add an app** 을 누른 다음, 1단계의 등록을 선택하고 **Add** 를 선택합니다.
4. **Business unit** 을 고르고 **Email address** 를 입력한 다음, **Security roles** 옆의 편집 아이콘을 사용합니다.
5. **Case** 테이블에 대한 생성, 읽기, 쓰기 권한을 가진 **커스텀** 보안 역할을 할당합니다. application user에게는 기본 제공 역할을 부여할 수 없으며 — Microsoft가 커스텀 역할을 요구합니다. 적당한 역할이 없다면 기존 역할을 복사해 필요한 만큼만 남기세요.
6. **Save** 를 선택한 다음 **Create** 를 선택합니다.

한 환경에서 등록된 애플리케이션 하나당 application user는 하나만 둘 수 있습니다. application user는 라이선스가 필요하지 않으며 환경의 보안 그룹 멤버십 규칙에서도 제외됩니다.

## 3단계 — OneUptime에 자격 증명 저장

**워크플로 → 전역 변수 → 만들기** 로 이동해 다음 항목들을 추가하고, 표시된 항목은 **Secret** 를 켭니다:

| 이름                     | 값                                                          | 시크릿 |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | 1단계의 Directory (tenant) ID                               | 아니요 |
| `DYNAMICS_CLIENT_ID`     | 1단계의 Application (client) ID                             | 아니요 |
| `DYNAMICS_CLIENT_SECRET` | 1단계의 클라이언트 시크릿 **Value**                         | 예     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — 끝에 슬래시 없이       | 아니요 |

클라이언트 시크릿은 Entra ID가 준 그대로 붙여넣으세요. OneUptime이 폼 본문을 대신 인코딩하므로 직접 URL 인코딩하지 마세요.

블록에서는 `{{global.variables.DYNAMICS_CLIENT_ID}}` 처럼 참조합니다. 시크릿이 실행 로그에서 어떻게 제거되는지는 [변수](/docs/workflows/variables) 를 참조하세요.

## 4단계 — 액세스 토큰 받기

실행할 때마다 자체 토큰을 가져옵니다. 토큰은 60~90분 동안 유효하고 client credentials 흐름은 리프레시 토큰을 발급하지 않으므로, 캐시할 것도 갱신할 것도 없습니다. 실행당 HTTP 호출 한 번이 전부입니다.

1. **워크플로 → 워크플로 생성** 을 열고, 이름을 `Incidents → Dynamics 365` 로 지정한 다음 **빌더** 를 엽니다.
2. 점선 자리 표시자를 클릭해 **On Create Incident** 트리거를 추가하고, 그 **Select Fields** 에서 전송할 컬럼을 요청합니다:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   **Identifier** 는 `incident-on-create-1` 그대로 두세요.

3. **Add Component** 를 클릭해 **API Post (JSON)** 블록을 추가하고, 트리거의 **Success** 점을 여기에 연결한 다음 설정을 엽니다. **Identifier** 를 `get-token` 으로 설정하고 다음과 같이 채웁니다:

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**헤더 이름은 정확히 그 대소문자대로 `Content-Type` 이라고 입력하세요.** 이것이 OneUptime에게 본문을 JSON이 아니라 폼 게시로 보내라고 알려 주는 신호이며, Microsoft 토큰 엔드포인트가 받아들이는 유일한 형태입니다. 소문자 `content-type` 은 일치하지 않아 요청이 JSON으로 나가고 `400` 이 되돌아옵니다.

`scope` 는 반드시 환경 URL 뒤에 `/.default` 를 붙인 값이어야 합니다 — 이것이 기밀 클라이언트 형식입니다. 여기서 환경 URL이 틀린 것이 `AADSTS70011: The provided value for the input parameter 'scope' is not valid` 의 흔한 원인입니다.

이제 토큰은 이후 블록에서 다음과 같이 사용할 수 있습니다:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## 5단계 — 케이스 만들기

두 번째 **API Post (JSON)** 블록을 추가하고, `get-token` 의 **Success** 점을 여기에 연결한 다음 **Identifier** 를 `create-case` 로 설정합니다.

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

계정 GUID는 이 케이스들이 속할 계정으로 교체하세요. **`customerid` 는 케이스에서 실제로 필수입니다** — 프로그래매틱 쓰기 시 Dataverse가 강제하는 컬럼 중 하나이므로, 이것 없이 생성하면 거부됩니다. 계정이나 연락처 중 어느 쪽이든 가리킬 수 있기 때문에 `customerid@odata.bind` 라고 쓰지 않고, `customerid_account@odata.bind` 또는 `customerid_contact@odata.bind` 라고 쓰며 이 이름들은 대소문자를 구분합니다. `title` 은 다른 종류의 필수 항목입니다. Dynamics 폼은 이를 요구하지만 API는 요구하지 않으므로, 어쨌든 보내세요.

`Prefer: return=representation` 이 있어야 이 호출을 워크플로에서 쓸 수 있습니다. 이것이 없으면 생성이 성공해도 `204 No Content` 를 응답하고 새 레코드의 URI를 `OData-EntityId` 응답 헤더에 담아 주므로, 거기서 GUID를 뽑아내야 합니다. 이것이 있으면 응답은 `201 Created` 이고 레코드 자체를 담고 있어, 다음 블록에서 이렇게 읽을 수 있습니다:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

이제 **개요 → 워크플로 편집 → 활성화됨** 에서 워크플로를 켜고, 테스트 인시던트를 선언한 다음 **실행 및 로그** 에서 실행 내역을 읽으세요. `create-case` 블록에 `201` 과 새 `incidentid` 가 담긴 본문이 표시되어야 합니다. 캔버스의 변경 사항은 자동으로 저장되며, Save 버튼은 없습니다.

### 심각도와 상태 매핑하기

Dynamics의 `severitycode` 는 "Default Value" 하나만 옵션으로 제공하므로, 기본 제공되는 심각도 척도로 매핑할 대상이 없습니다. 대신 **`prioritycode`** 를 사용하고, 심각도별 우선순위를 원한다면 `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` 으로 **If / Else** 블록에서 분기하세요.

| 컬럼             | 값                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` 높음, `2` 보통, `3` 낮음                                                                                                      |
| `caseorigincode` | `1` 전화, `2` 이메일, `3` 웹, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                    |
| `casetypecode`   | `1` 질문, `2` 문제, `3` 요청                                                                                                      |
| `statecode`      | `0` 활성, `1` 해결됨, `2` 취소됨                                                                                                  |
| `statuscode`     | `1` 진행 중, `2` 보류, `3` 세부 정보 대기, `4` 조사 중, `5` 문제 해결됨, `6` 취소됨, `1000` 정보 제공됨, `2000` 병합됨 |

`statuscode` 는 커스터마이징할 수 있으므로 테넌트가 자체 값을 추가했을 수 있습니다. 레이블이 아니라 정수를 보내세요.

## 6단계 — 인시던트와 케이스가 서로를 찾을 수 있게 하기

나중에 무엇을 하든 — 댓글 달기, 해결하기, 다시 동기화하기 — 두 시스템 중 하나가 다른 쪽의 식별자를 보관해야 합니다. Dynamics 쪽에 두세요.

Case 테이블에 **single line of text** 컬럼을 추가하고, 예를 들어 `new_oneuptimeincidentid` 라고 이름 지은 다음, 케이스를 만들 때 설정합니다:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

그러면 이후의 어떤 워크플로든 필터로 케이스를 찾을 수 있습니다:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

이 컬럼을 Case 테이블의 **대체 키(alternate key)** 로 정의하면 조회 자체를 건너뛰고 `incidents(new_oneuptimeincidentid='<id>')` 로 바로 `PATCH` 할 수 있습니다 — 케이스가 없으면 만들고 있으면 업데이트하는 upsert입니다. 키는 생성이 끝나야(상태가 **Active** 가 되어야) 사용할 수 있으며, 대체 키 값에는 `/ < > * % & : \ ? + #` 를 포함할 수 없습니다. OneUptime id는 평범한 UUID이므로 안전합니다.

반대 방향 — Dynamics 케이스 id를 OneUptime 인시던트에 저장하기 — 도 가능하며, `customFields` 에 쓰는 **Update One Incident** 블록을 사용합니다. 다만 주의하세요. `customFields` 는 단일 JSON 컬럼이라서 여기에 쓰면 여러분의 값만이 아니라 해당 인시던트의 모든 커스텀 필드 값이 대체됩니다. 링크를 Dynamics 쪽에 두면 이 문제를 완전히 피할 수 있습니다.

## 7단계 — 인시던트가 해결되면 케이스도 해결하기

이 부분은 **두 번째** 워크플로로 만드세요. 그래야 여기서 실패해도 케이스 생성이 멈추지 않습니다.

1. **워크플로 생성** 으로 이름을 `Incident resolved → Close Dynamics case` 로 지정하고 **On Update Incident** 트리거를 추가합니다.
2. 트리거의 **Listen on** 에 `{"currentIncidentStateId": true}` 를 넣어 모든 편집이 아니라 상태 변경에만 워크플로가 깨어나게 합니다. **Select Fields** 에는 `{"_id": true, "currentIncidentState": {"name": true}}` 를 요청합니다.
3. **If / Else** 블록을 추가합니다. **Input 1** 은 `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** 는 `==`, **Input 2** 는 `Resolved` — 또는 프로젝트에서 해결 상태를 부르는 이름입니다. [인시던트 상태 및 심각도](/docs/incidents/states-and-severities) 를 참조하세요.
4. **Yes** 분기에서 4단계의 `get-token` 블록을 그대로 반복합니다.
5. **API Get (JSON)** 블록을 추가하고 **Identifier** 를 `find-case` 로 설정한 다음 6단계의 `$filter` URL을 지정합니다. Dataverse 쿼리는 `value` 배열로 응답하고 워크플로 참조는 대괄호로 배열을 인덱싱할 수 있으므로, 케이스 id는 `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}` 입니다.
6. 케이스를 닫는 **API Post (JSON)** 블록을 추가합니다:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: 5단계와 동일하되 `Prefer` 는 제외합니다.
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` 는 Resolved 상태에 속하는 `statuscode` 값이며, `5` 는 *Problem Solved* 입니다.

     **의존하기 전에 이 본문을 여러분의 환경에서 직접 테스트하세요.** `CloseIncident` 는 `IncidentResolution` 과 `Status` 두 개의 매개변수를 받지만, Microsoft는 이에 대한 HTTP 예제를 게시하지 않았습니다 — 공식 샘플은 전부 C#입니다. 위 형태는 관례적인 변환입니다. 환경이 이를 거부한다면, `@odata.bind` 형식 대신 평범한 `"incidentid": "<the case id>"` 속성으로 케이스를 식별해 보세요. Microsoft의 다른 액션 예제들이 기존 레코드를 참조하는 방식이 그렇습니다.

**케이스를 그냥 `PATCH` 로 `statecode: 1` 로 바꾸면 안 되나요?** 그래도 됩니다 — Microsoft는 `statecode` 와 `statuscode` 를 `PATCH` 하는 것을 예전 SetState 메시지의 Web API 대응물로 문서화하고 있으며, 케이스를 활성 상태들 사이에서 옮기기에는 그것이 올바른 도구입니다. 다만 그 방식은 Dynamics 365 Customer Service에서 해결된 케이스가 갖추어야 할 **Case Resolution** 활동을 만들지 않으며, 관리자가 커스텀 상태 전환을 구성한 환경에서는 아예 거부됩니다. 해결에는 `CloseIncident` 를, 그 밖의 모든 것에는 `PATCH` 를 사용하세요. 그리고 `statecode` 를 쓸 때는 언제나 같은 요청에서 `statuscode` 도 설정하세요 — 그러지 않으면 Dynamics가 조용히 해당 상태의 기본 status를 적용합니다.

`CloseIncident` 는 기본 Dataverse가 아니라 Dynamics 365 Customer Service에서 제공되며, Dataverse 액션 레퍼런스에는 나오지 않습니다. `404` 가 반환된다면 `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` 를 가져와 `CloseIncident` 를 검색해 환경에 존재하는지 확인하세요.

케이스를 닫는 것 외의 작업 — 메모, 우선순위 상향, 제목 변경 — 에는 `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` 로 향하는 **API Patch (JSON)** 블록을 `If-Match: *` 헤더와 함께 사용하세요. 이 헤더는 실수로 upsert가 일어나 새 케이스가 만들어지는 것을 막아 줍니다. 변경하는 컬럼만 보내세요.

## 인바운드 — Dynamics 365에서 OneUptime으로

이제 반대 방향입니다. 누군가 Dynamics에서 케이스를 닫거나 상담원이 메모를 추가하면 OneUptime이 이를 알아야 합니다.

### 수신 워크플로를 먼저 구성하기

1. **워크플로 생성** 으로 이름을 `Dynamics 365 → OneUptime` 으로 지정하고 **Webhook** 트리거를 추가합니다.
2. 그 워크플로의 **설정** 을 열어 **웹훅 시크릿 키** 를 복사합니다. URL은 다음과 같습니다:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   자체 호스팅 설치에서는 자체 호스트로 바꿔 넣으세요. 이 URL은 비밀번호처럼 다루세요 — 이 URL을 아는 사람은 누구나 워크플로를 시작할 수 있습니다. 같은 페이지에서 키를 재설정할 수 있습니다.

3. 다른 것이 실행되기 전에 공유 시크릿을 확인하는 **If / Else** 블록을 추가합니다. **Input 1** 은 `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** 는 `==`, **Input 2** 는 `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — 여러분이 직접 만들어 시크릿 전역 변수로 저장한 값입니다.
4. **Yes** 분기에서 **Update One Incident** 블록을 추가합니다:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: 케이스 변경이 OneUptime에서 의미해야 할 내용 — 상태 변경, 메모, 라벨 등.

   인시던트를 특정 상태로 옮기려면 그 상태의 id가 필요합니다. `{"name": "Resolved"}` 쿼리를 가진 **Find One Incident State** 블록이 `{{local.components.incident-state-find-one-1.returnValues.model._id}}` 를 제공하므로, 이를 `currentIncidentStateId` 에 씁니다.

워크플로는 활성화된 채로 준비해 두세요. 이제 Dynamics가 호출할 대상을 만들어 줍니다.

### 옵션 A — Power Automate 플로 (권장)

대부분의 팀이 택해야 할 경로입니다. 페이로드를 직접 제어할 수 있고 설치할 것도 없습니다.

1. [Power Automate](https://make.powerautomate.com) 에서 **Automated cloud flow** 를 만듭니다.
2. 트리거: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — 이보다 좁은 범위는 여러분이나 여러분의 사업부가 소유한 행에 대해서만 발동합니다.
   - **Select columns**: `statecode,statuscode`. 이것은 업데이트 전용 필터이며 제대로 지정할 가치가 있습니다. 여기서는 조회(lookup) 컬럼이 지원되지 않으며, 모든 업데이트에 항상 존재하는 컬럼(예: 기본 키)은 절대 나열하지 마세요. 그러면 저장할 때마다 플로가 발동합니다.

3. **Microsoft Dataverse → Get a row by ID** 를 추가하고, 테이블은 `Cases`, 행 id는 트리거에서 가져오며, **Select columns** 는 `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid` 로 지정합니다.

   이 두 번째 호출은 비용을 들일 만합니다. 업데이트 시 트리거는 변경된 컬럼만 담고 있으므로, 매칭에 필요한 식별자가 아예 없을 수 있기 때문입니다.

4. 기본 제공 **HTTP** 액션을 추가합니다:

   - **Method**: `POST`
   - **URI**: 위에서 얻은 OneUptime webhook URL
   - **Headers**: `Content-Type: application/json` 과 `X-OneUptime-Secret: <the same secret>`
   - **Body**: *Get a row by ID* 의 출력으로 구성합니다. 예를 들면

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. 저장하고 플로를 켭니다.

이 경로를 택하기 전에 알아 둘 것:

- **Microsoft Dataverse 커넥터는 프리미엄입니다.** 자동화 플로에서는 케이스와 관련된 모든 사람이 아니라 플로 소유자만 라이선스가 필요합니다 — 다만 소유자의 라이선스가 만료되면 플로가 조용히 멈춥니다.
- Dataverse 트리거는 폴링이 아니라 **푸시** 입니다 — Dynamics가 콜백을 등록하고 이를 발동합니다. 전달은 보통 몇 초 이내이며, 5분을 넘어가면 비동기 서비스가 밀려 있다는 뜻입니다. 관리 센터의 **Settings → System Jobs** 에서 확인할 수 있습니다.
- 커스텀 헤더는 유지됩니다. Power Automate는 HTTP 액션에서 여러 표준 헤더 계열(대부분의 `Accept-*` 와 `Content-*` 헤더, `Host`, `Origin`, `Cookie`)을 제거하지만, `X-OneUptime-Secret` 같은 여러분 고유의 헤더는 그대로 전달됩니다.
- 플로는 감시 대상 테이블과 같은 환경에 있어야 합니다.
- 요청은 테넌트의 Power Platform 요청 할당량에서 차감되며, 커넥터 스로틀링은 플로 실행 안에서 `429` 로 나타납니다.

### 옵션 B — 네이티브 Dataverse webhook

Power Automate를 쓸 수 없다면 Dataverse가 OneUptime을 직접 호출할 수 있습니다. [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook) 로 엔드포인트를 등록합니다. **Register New WebHook** 을 선택해 OneUptime URL을 지정하고, **HttpHeader** 인증을 고른 다음 `X-OneUptime-Secret` 과 여러분의 시크릿을 추가합니다. 그다음 **incident** 테이블에 **Update** 메시지에 대한 step을 등록하며, **Filtering Attributes** 는 관심 있는 컬럼으로 한정하고, 스테이지는 **PostOperation**, 실행 모드는 **Asynchronous** 로 지정합니다.

이 경로는 다음을 충분히 알고 선택하세요:

- **포트 80과 443만 가능합니다.** 다른 포트를 쓰는 자체 호스팅 OneUptime은 등록할 수 없습니다.
- **Dataverse는 여러분의 시크릿을 검증하지 않습니다.** 헤더를 보내 줄 뿐이며, 헤더가 없는 요청을 거부하는 것은 전적으로 워크플로의 몫입니다 — 수신 워크플로의 **If / Else** 블록이 바로 그 역할입니다.
- **페이로드는 친절한 JSON 객체가 아닙니다.** 직렬화된 `RemoteExecutionContext` 이며, 그 안에서 `InputParameters` 는 `{key, value}` 쌍의 *배열* 이고 변경된 행은 `Target` 키 아래에 있으며 그 컬럼들은 다시 `Attributes` 배열에 들어 있습니다. 다른 것이 읽을 수 있도록 이를 평탄화하는 **Run Custom JavaScript** 블록을 추가하게 될 것입니다.
- 업데이트 시에는 **변경된 컬럼만 포함** 되므로, `ticketnumber` 나 OneUptime id 컬럼이 필요하다면 **Post Image** 를 등록하세요.
- **256 KB를 넘으면 정작 필요한 부분이 제거됩니다** — `InputParameters`, `PreEntityImages`, `PostEntityImages` 가 모두 사라지고 요청에 `x-ms-dynamics-msg-size-exceeded` 헤더가 붙습니다. `PrimaryEntityId` 와 `PrimaryEntityName` 은 남으므로, 대안은 Web API로 행을 다시 읽어 오는 것입니다.
- **전달은 거의 관용이 없습니다.** Dataverse는 `2xx` 를 60초 동안 기다리며 재시도는 정확히 한 번, 그것도 `502`, `503`, `504` 에 대해서만 합니다. 그 밖의 모든 것 — 여러분 쪽의 `500` 을 포함해 — 은 재시도되지 않고 실패한 System Job으로 남습니다.
- **Asynchronous** 를 선택하세요. 동기 step은 상담원의 저장 동작을 여러분의 엔드포인트에 묶어 두며, 그 뒤에 트랜잭션이 롤백되더라도 요청은 이미 나갔기 때문에 되돌릴 수 없습니다.

클래식 Dynamics 백그라운드 워크플로에는 HTTP나 webhook 단계가 아예 없으므로, 여기서 세 번째 선택지가 되지 못합니다.

## 알림에 대해 같은 작업 하기

위의 모든 내용은 흔한 사례이기 때문에 인시던트를 중심으로 작성했지만, 알림도 똑같이 동작합니다 — 레코드 유형만 바꾸면 나머지는 그대로입니다:

| 인시던트                                                     | 알림                                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

워크플로에는 트리거가 정확히 하나뿐이므로 인시던트와 알림에는 각각 워크플로가 하나씩 필요합니다. 둘이 같은 일을 한다면 Dynamics 쪽 절반을 한 번만 만들고 **Execute Workflow** 컴포넌트로 양쪽에서 호출하세요.

## 문제 해결

먼저 **실행 및 로그** 에서 실패한 블록을 읽으세요 — 두 Microsoft 엔드포인트 모두 설명이 담긴 JSON 본문을 반환하며, API 컴포넌트는 이를 `response-body` 에 보관합니다.

**토큰 요청이 `400` 과 `invalid_request` 또는 지원되지 않는 grant type으로 실패합니다.** `Content-Type` 헤더가 정확히 `Content-Type: application/x-www-form-urlencoded` 가 아니어서 본문이 JSON으로 나갔습니다. 대소문자를 확인하세요.

**`400` 과 `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** `scope` 가 환경 URL + `/.default` 가 아닙니다. **Developer resources** 에서 URL을 복사하고 끝의 슬래시와 `/api/data/...` 경로를 제거하세요.

**Dynamics에서 `401 Unauthorized`.** `Authorization` 헤더가 없거나 형식이 잘못되었거나, 실행 도중에 토큰이 만료되었습니다. 반드시 공백 하나를 넣어 `Bearer <token>` 형태여야 합니다.

**`0x80072560` 과 함께 "The user isn't a member of the organization" 이 나오는 `403 Forbidden`.** 2단계를 건너뛰었거나 application user가 다른 앱 등록에 연결되어 있습니다. 토큰은 문제없고, Dynamics 쪽 사용자가 없는 것입니다.

**권한 오류와 함께 나오는 `403 Forbidden`.** application user는 존재하지만 그 커스텀 보안 역할에 **Case** 에 대한 Create, Read 또는 Write 권한이 없습니다.

**고객을 언급하는 `400 Bad Request`.** `customerid` 는 필수입니다. `customerid_account@odata.bind` 또는 `customerid_contact@odata.bind` 를 정확한 철자로, `/accounts(<guid>)` 처럼 앞에 슬래시가 붙은 URI로 설정하세요.

**`/CloseIncident` 에 대한 `404 Not Found`.** 이 액션은 Dynamics 365 Customer Service 액션입니다. 사용 가능하다고 단정하기 전에 환경의 `$metadata` 에서 검색해 보세요.

**`DuplicateRecord` 와 함께 나오는 `412 Precondition Failed`.** 중복 감지 규칙에 걸렸습니다. 규칙을 좁히거나, 규칙이 매칭하는 필드를 보내지 마세요.

**`429 Too Many Requests`.** Dataverse의 서비스 보호 한도입니다 — 웹 서버당, 5분 창 안에서 사용자당 대략 6,000 요청과 20분의 실행 시간입니다. 응답에는 초 단위의 `Retry-After` 가 담깁니다. 워크플로가 몰아서 호출한다면 **Delay** 블록을 넣거나, 배치로 처리하는 예약 워크플로로 작업을 옮기세요.

**OneUptime 쪽에 아무것도 도착하지 않습니다.** `curl` 로 직접 webhook URL에 요청을 보내고 워크플로의 **실행 및 로그** 를 확인하세요. 여러분의 요청은 나타나는데 Dynamics의 것이 나타나지 않는다면 문제는 상류에 있습니다. Power Automate라면 플로 자체의 실행 이력을, 네이티브 webhook이라면 실패로 필터링한 **Settings → System Jobs** 를 보세요.

**워크플로는 실행되는데 인시던트가 바뀌지 않습니다.** **Update One Incident** 블록은 쿼리가 아무것도 찾지 못했을 때 `Items Updated: 0` 을 보고합니다 — 이는 오류가 아니라 성공입니다. 페이로드의 id가 OneUptime 인시던트 id인지, 그리고 `_id` 로 쿼리하고 있는지 확인하세요.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 인바운드/아웃바운드 패턴과 인증 빠른 참조.
- [Jira](/docs/integrations/jira) — Jira를 대상으로 한 동일한 양방향 구성.
- [워크플로 개요](/docs/workflows/index) 및 [워크플로 작성](/docs/workflows/authoring) — 캔버스, 식별자, 워크플로 켜기.
- [컴포넌트](/docs/workflows/components) — API 블록, If / Else, OneUptime 데이터 컴포넌트.
- [변수](/docs/workflows/variables) — 시크릿, 그리고 한 블록의 출력을 다음 블록에서 읽기.
- [설정 및 보안](/docs/workflows/configuration) — webhook 보안과 아웃바운드 네트워크 접근.
- [IP 주소](/docs/configuration/ip-addresses) — Dynamics가 허용 목록 뒤에 있는 경우를 위한 OneUptime의 아웃바운드 대역.
