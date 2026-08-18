# 변수

워크플로는 데이터를 이동시키는 일이 핵심입니다 — 트리거에서 첫 번째 블록으로, 한 블록에서 다음 블록으로, 그리고 공유 값에서 필요한 어디로든. 변수는 이 데이터가 이동하는 방식입니다.

변수 범위는 두 가지이며, 여기에 run 도중 생성되는 component 출력이 더해집니다.

## 전역 변수 (Global variables)

한 번 저장해 두고 프로젝트 어디에서나 재사용하는 값입니다. API 키, URL, 채널 이름처럼 열 개의 서로 다른 워크플로에 복사해 넣고 싶지 않은 값을 떠올리면 됩니다.

**Workflows → Global Variables**에서 확인할 수 있습니다. 각각은 다음 항목을 가집니다.

- **Name** — 참조에 사용할 이름입니다. 최소 두 글자이며, 공백은 쓸 수 없고 문자, 숫자, 하이픈, 밑줄만 사용할 수 있습니다. 블록 안에서 눈에 잘 띄므로 `UPPER_SNAKE_CASE`가 좋은 습관입니다.
- **Description** — 선택 사항이며, 용도를 상기시키는 자유 형식 텍스트입니다.
- **Secret** — 켜면 run 로그와 단계 추적 정보에서 값이 지워집니다.
- **Content** — 실제 값입니다. 여러 줄 텍스트 필드이므로 여러 줄짜리 값도 사용할 수 있습니다.

전역 변수는 어떤 워크플로에서든 다음과 같이 사용합니다.

```
{{global.variables.NAME}}
```

예를 들어 PagerDuty 키를 `PAGERDUTY_KEY`로 저장했다면, 어떤 블록에서든 `{{global.variables.PAGERDUTY_KEY}}`로 사용할 수 있습니다 — 편집기에는 참조 자체만 저장되며, 워크플로 로그는 해석된 시크릿 값을 지웁니다.

변수는 생성하고 삭제할 뿐, 수정하지는 않습니다. 테이블에 편집 버튼이 없으므로 UI에서 값을 바꾸려면 변수를 삭제한 뒤 다시 만들어야 합니다 — 또는 이 페이지 끝에서 다루는 API로 업데이트할 수 있습니다. 전역 변수와 워크플로 변수는 Growth 플랜 기능입니다.

## 로컬 워크플로 변수

하나의 워크플로에만 범위가 한정된 변수로, 해당 워크플로의 왼쪽 메뉴에 있는 **Workflow Variables**에서 관리합니다. 다음과 같이 참조합니다.

```
{{local.variables.NAME}}
```

## Component 출력 (이전 블록에서 온 데이터)

모든 트리거와 component는 실행 중에 출력을 생성할 수 있습니다. 참조를 직접 입력하기보다는 편집기의 component-value picker를 사용해서 만드세요 — 러너가 기대하는 정확한 id가 삽입됩니다.

이전 블록의 출력은 다음과 같이 참조합니다.

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID`는 블록의 **Identifier**입니다 — 블록에 표시된 짧은 id이며, 블록에 표시되는 이름이 아닙니다. 새 블록은 `api-get-1`처럼 자동으로 id를 받으며, 블록의 **ID** 섹션에서 이름을 바꿀 수 있습니다. 이름을 바꾸면 변수 이름을 바꿀 때와 마찬가지로 이미 그곳을 가리키던 모든 참조가 깨집니다. `FIELD_ID`는 선택한 return-value id입니다.

예시입니다.

- ID가 `lookup-user`인 **API** component가 실행된 후, 상태 코드는 `{{local.components.lookup-user.returnValues.response-status}}`이고 본문은 `{{local.components.lookup-user.returnValues.response-body}}`입니다.
- ID가 `transform`인 **Run Custom JavaScript** component가 실행된 후, 반환 값은 `{{local.components.transform.returnValues.returnValue}}`입니다.
- 레코드 타입에 대한 트리거 — **On Create Incident**와 그 계열 — 는 정확히 하나의 값 `model`을 반환하며, 그 안으로 파고들어 접근합니다. ID가 `incident-on-create-1`인 트리거의 경우, incident의 제목은 `{{local.components.incident-on-create-1.returnValues.model.title}}`입니다.

로컬 변수는 현재 run 동안에만 존재합니다. 새 run이 시작될 때마다 초기화됩니다.

## 변수를 사용할 수 있는 곳

거의 모든 텍스트 필드가 변수를 받아들입니다.

- API 블록의 URL.
- Slack, Teams, Discord, Telegram, Email의 메시지 텍스트.
- 이메일의 제목과 본문.
- 헤더와 본문 필드(문자열 값 안).
- **If / Else** 블록(Conditions 카테고리에 속함)의 양쪽 값.

JSON 필드 안에서는 문자열 값 안에서 변수를 쓸 수 있지만, key로는 쓸 수 없습니다. 값 하나를 통째로 차지하는 참조는 그 자체로 대체되므로, 이런 방식으로 전체 객체를 JSON 필드에 넣을 수도 있습니다. 구조를 동적으로 만들어야 한다면 **Run Custom JavaScript** 블록으로 만든 뒤, 그 출력을 다음 블록에 전달하세요.

**Run Custom JavaScript** 블록에는 변수가 자동으로 주입되지 않습니다 — 샌드박스에는 아무것도 자동으로 들어가지 않습니다. `{{global.variables.NAME}}`(또는 다른 component 참조)을 블록의 **Arguments** JSON 필드에 넣으세요. 이 값들은 스크립트가 실행되기 전에 치환되어 `args`로 전달됩니다.

## 배열 순회하기

텍스트 필드 안에서는 `{{#each path}}…{{/each}}`로 배열을 순회할 수 있습니다. 블록 안에서 `{{property}}`는 현재 요소의 값을 읽고, `{{@index}}`는 0부터 시작하는 위치이며, `{{this}}`는 단순 값으로 이루어진 배열에서 요소 자체를 가리킵니다. `{{#each}}` 블록 안의 이름은 앞뒤 공백이 제거되므로, 다른 곳과 달리 여기서는 불필요한 공백이 있어도 문제가 되지 않습니다.

## 예시

### webhook으로 payload 구성하기

`{ "service": "checkout", "status": "failed" }` 같은 본문으로 webhook이 들어옵니다. 이것을 OneUptime incident로 바꾸려면 다음과 같이 합니다.

1. id가 `ci-webhook`인 **Webhook** 트리거.
2. **If / Else** 블록: webhook의 Request Body 출력을 선택하고 `status` 속성을 사용, 연산자는 `==`, 오른쪽 값은 `failed`.
3. **Yes** 분기에서, 다음 값을 가진 **Create One Incident** 블록.
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### API 호출에서 시크릿 사용하기

PagerDuty를 호출하는 워크플로입니다.

1. `PAGERDUTY_KEY`를 시크릿 전역 변수로 저장합니다.
2. **API** 블록에서 `Authorization` 헤더를 `Token token={{global.variables.PAGERDUTY_KEY}}`로 설정합니다.

키는 워크플로와 로그 밖에 그대로 남아 있습니다.

### 두 개의 API 호출 연결하기

첫 번째 호출이 두 번째 호출에 필요한 ID를 줍니다.

1. **API** component `lookup-order`: picker를 사용해 manual 트리거의 JSON email 필드를 `GET /orders?email=...`에 삽입합니다.
2. **API** component `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

`lookup-order`가 실패하면 **Success** 대신 **Error** 출력이 발생합니다. 이를 Email이나 Slack 블록에 연결해서 실패가 눈에 띄지 않고 지나가지 않도록 하세요.

## 워크플로에서 변수 업데이트하기

자격 증명을 스케줄에 따라 회전시키는 것이 흔한 패턴입니다. 서드파티에서 새 토큰을 가져온 뒤, 다음 run이 그것을 쓸 수 있도록 변수에 다시 저장합니다. OneUptime API를 호출하는 **API** 블록으로 이를 수행합니다.

`PUT /api/workflow-variable/<variable-id>`를 `ApiKey` 헤더와 함께 호출하며 — 여기서 사람들이 자주 실수하는 부분인데 — 바꾸고 싶은 필드는 **`data` 객체로 감싸야** 합니다.

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

`data` 래퍼 없이 평평한 본문을 보내면 400으로 거부됩니다. 실제로 바꾸고 싶은 필드만 보내세요. `name`과 `description`은 payload에서 빼도 됩니다.

API 키에는 **Edit Workflow Variables** 권한이 필요합니다. 읽기 권한은 필요 없습니다 — 업데이트는 해당 행을 다시 읽어 들이지 않습니다.

주의할 점이 두 가지 있습니다.

- **참조 중인 변수의 이름을 바꾸지 마세요.** `name`은 `{{local.variables.NAME}}`의 일부입니다. 이름을 바꾸면 기존의 모든 참조가 해석되지 않게 되며, 해석되지 않은 참조는 아래의 문제점에서 설명하듯 그대로 문자로 통과됩니다.
- **이런 방식으로 쓸 수는 있지만 다시 읽어올 수는 없는 변수도 있습니다.** `content`는 시크릿 여부와 상관없이 모든 변수에 대해 API에서 쓰기 전용입니다. 이 때문에 변수는 회전하는 토큰을 안전하게 보관하는 장소가 됩니다. secret으로 표시하면 추가로 run 로그와 단계 추적 정보에서도 값이 빠집니다.

## 문제점

- **picker를 사용하세요.** picker는 러너가 기대하는 정확한 component, return-value, 변수 id를 삽입하며, 참조를 화면에 표시되는 이름과 무관하게 유지해 줍니다.
- **변수 이름은 대소문자를 구분합니다.** `{{global.variables.MyKey}}`와 `{{global.variables.mykey}}`는 서로 다른 변수입니다.
- **해석되지 않은 참조는 지워지지 않고 그대로 남습니다.** 존재하지 않는 대상을 참조해도 오류가 발생하지 않으며, 빈 문자열이 되지도 않습니다. 중괄호가 그대로 통과되므로, 오타가 있는 step id를 가진 `{{local.components.api-get-1.returnValues.body}}`는 그대로 Slack 메시지, URL, 요청 본문에 남게 되고, run은 여전히 **Executed**로 표시됩니다. run 로그에는 해석되지 않고 지나간 참조를 알려주는 경고 줄이 남습니다.
- **빌더는 변수 이름을 검사할 수 없습니다.** 빌더는 저장하기 전에 일치하지 않는 component 참조 — 알 수 없는 step id, 알 수 없는 return value, 잘못된 루트 — 를 잡아냅니다. 하지만 변수가 실제로 존재하는지는 알 수 없으므로, 이름이 바뀐 변수는 run 로그로만 알아챌 수 있습니다.
- **중괄호 안의 공백은 제거되지 않습니다.** `{{ local.variables.NAME }}`은 `{{local.variables.NAME}}`과 다른 조회이며 절대 해석되지 않습니다. 유일한 예외는 `{{#each}}` 블록 안이며, 그 안에서는 이름의 공백이 제거됩니다.

## 다음에 읽을 문서

- [워크플로우 구성 요소](/docs/workflows/components) — 각 블록이 생성하는 출력의 전체 목록.
- [워크플로우 실행 및 로그](/docs/workflows/runs-and-logs) — run 이후 모든 변수의 실제 값을 확인하는 방법.
- [워크플로우 설정 및 보안](/docs/workflows/configuration) — 전역 변수에 안전하게 넣을 수 있는 것.
