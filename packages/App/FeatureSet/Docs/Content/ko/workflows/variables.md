# 변수

워크플로가 하는 일은 결국 데이터를 옮기는 것입니다 — 트리거에서 첫 블록으로, 한 블록에서 다음 블록으로, 그리고 공유해 둔 값에서 필요한 곳 어디로든. 변수가 바로 그 데이터를 옮기는 수단입니다.

변수의 범위는 두 가지이고, 여기에 실행 중에 만들어지는 구성 요소 출력이 더해집니다.

## 전역 변수

한 번 저장해 두고 어디서나 재사용하는 프로젝트 전체 값입니다. API 키, URL, 채널 이름처럼 워크플로 열 개에 복사해 넣고 싶지 않은 값을 떠올리면 됩니다.

**워크플로 → 전역 변수**에서 관리합니다. 각 변수에는 다음이 있습니다.

- **이름** — 참조할 때 쓰는 이름입니다. 최소 두 글자, 공백 없이 영문자, 숫자, 하이픈, 밑줄만 사용할 수 있습니다. 블록 안에서 눈에 잘 띄므로 `UPPER_SNAKE_CASE`로 쓰는 습관을 들이면 좋습니다.
- **설명** — 선택 사항이며, 어떤 용도인지 스스로 기억하기 위한 자유 텍스트입니다.
- **시크릿** — 켜 두면 실행 로그와 단계 추적에서 값이 지워집니다.
- **콘텐츠** — 실제 값입니다. 긴 텍스트 필드라 여러 줄 값도 넣을 수 있습니다.

어느 워크플로에서든 전역 변수를 이렇게 사용합니다.

```
{{global.variables.NAME}}
```

예를 들어 PagerDuty 키를 `PAGERDUTY_KEY`로 저장해 두었다면 어떤 블록에서든 `{{global.variables.PAGERDUTY_KEY}}`로 쓸 수 있습니다. 편집기에는 참조만 저장되고, 워크플로 로깅은 해석된 시크릿 값을 지웁니다.

변수는 생성과 삭제만 가능하며 편집은 되지 않습니다. 표에 편집 버튼이 없으므로 UI에서 값을 바꾸려면 변수를 지우고 다시 만들어야 합니다 — 아니면 이 페이지 끝에서 설명하는 API로 갱신하면 됩니다. 전역 변수와 워크플로 변수는 Growth 플랜 기능입니다.

## 워크플로 로컬 변수

워크플로 하나에만 적용되는 변수로, 해당 워크플로의 왼쪽 메뉴에서 **워크플로 변수**로 관리합니다. 참조 방법은 다음과 같습니다.

```
{{local.variables.NAME}}
```

## 구성 요소 출력(앞선 블록에서 온 데이터)

모든 트리거와 구성 요소는 실행 중에 출력을 만들어 낼 수 있습니다. 참조는 직접 입력하지 말고 편집기의 구성 요소 값 선택기로 만드세요. 러너가 기대하는 id를 정확히 넣어 줍니다.

앞선 블록의 출력은 이렇게 참조합니다.

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID`는 블록의 **Identifier** — 블록에 표시되는 이름이 아니라 블록에 적힌 짧은 id입니다. 새 블록에는 `api-get-1` 같은 id가 붙고, 블록의 **ID** 영역에서 바꿀 수 있습니다. 이름을 바꾸면 변수 이름을 바꿀 때와 마찬가지로 이미 그 블록을 가리키던 참조가 모두 깨집니다. `FIELD_ID`는 선택한 반환값의 id입니다.

예를 들면 이렇습니다.

- ID가 `lookup-user`인 **API** 구성 요소가 실행되고 나면, 상태 코드는 `{{local.components.lookup-user.returnValues.response-status}}`이고 본문은 `{{local.components.lookup-user.returnValues.response-body}}`입니다.
- ID가 `transform`인 **Run Custom JavaScript** 구성 요소가 실행되고 나면, 반환된 값은 `{{local.components.transform.returnValues.returnValue}}`입니다.
- 레코드 유형 트리거 — **On Create Incident**와 그 형제들 — 는 `model`이라는 값 하나만 반환하며, 그 안으로 파고들어 원하는 필드를 읽습니다. ID가 `incident-on-create-1`인 트리거라면 인시던트의 제목은 `{{local.components.incident-on-create-1.returnValues.model.title}}`입니다.

로컬 변수는 현재 실행 동안에만 존재합니다. 새 실행은 매번 빈 상태에서 시작합니다.

## 변수를 쓸 수 있는 곳

거의 모든 텍스트 필드가 변수를 받습니다.

- API 블록의 URL.
- Slack, Teams, Discord, Telegram, 이메일의 메시지 텍스트.
- 이메일의 제목과 본문.
- 헤더와 본문 필드(문자열 값 안에서).
- **If / Else** 블록의 양쪽 값(조건 범주에 있습니다).

JSON 필드에서는 문자열 값 안에 변수를 넣을 수 있지만 키로는 쓸 수 없습니다. 참조 하나가 값 전체를 차지하면 그대로 치환되므로, 그런 식으로 객체 전체를 JSON 필드에 넣을 수 있습니다. 구조를 동적으로 만들어야 한다면 **Run Custom JavaScript** 블록에서 만든 다음 그 출력을 다음 블록으로 넘기세요.

**Run Custom JavaScript** 블록은 변수를 자동으로 받지 않습니다 — 샌드박스에는 아무것도 주입되지 않습니다. 블록의 **Arguments** JSON 필드에 `{{global.variables.NAME}}`(또는 임의의 구성 요소 참조)을 넣으세요. 그 값들은 스크립트가 실행되기 전에 치환되어 `args`로 전달됩니다.

## 배열 순회하기

텍스트 필드 안에서는 `{{#each path}}…{{/each}}`로 배열을 순회할 수 있습니다. 블록 안에서 `{{property}}`는 현재 요소의 값을 읽고, `{{@index}}`는 0부터 시작하는 위치이며, `{{this}}`는 단순 값의 배열일 때 요소 자체를 뜻합니다. `{{#each}}` 블록 안의 이름은 공백이 잘리므로, 다른 곳과 달리 여기서는 공백이 섞여도 문제가 없습니다.

## 예제

### 웹훅으로 페이로드 구성하기

`{ "service": "checkout", "status": "failed" }` 같은 본문으로 웹훅이 도착했다고 해 봅시다. 이를 OneUptime 인시던트로 만들려면 이렇게 합니다.

1. id가 `ci-webhook`인 **Webhook** 트리거.
2. **If / Else** 블록: 웹훅의 Request Body 출력을 고르고 그 `status` 속성을 사용해, 연산자는 `==`, 오른쪽 값은 `failed`로 둡니다.
3. **예** 분기에서 **Create One Incident** 블록을 다음과 같이 설정합니다.
   - 제목: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - 설명: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### API 호출에서 시크릿 사용하기

PagerDuty를 호출하는 워크플로입니다.

1. `PAGERDUTY_KEY`를 시크릿 전역 변수로 저장합니다.
2. **API** 블록에서 `Authorization` 헤더를 `Token token={{global.variables.PAGERDUTY_KEY}}`로 설정합니다.

키는 워크플로에도 로그에도 남지 않습니다.

### API 호출 두 개 이어 붙이기

첫 번째 호출이 두 번째 호출에 필요한 ID를 알려 주는 경우입니다.

1. **API** 구성 요소 `lookup-order`: 선택기를 사용해 Manual 트리거의 JSON email 필드를 `GET /orders?email=...`에 넣습니다.
2. **API** 구성 요소 `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

`lookup-order`가 실패하면 **Success**가 아니라 **Error** 출력이 발생합니다. 실패를 놓치지 않도록 이 출력을 Email이나 Slack 블록에 연결해 두세요.

## 워크플로에서 변수 갱신하기

자주 쓰이는 방식 하나는 자격 증명을 일정에 맞춰 교체하는 것입니다. 외부에서 새 토큰을 받아 와 변수에 다시 저장해 두면 다음 실행이 그 값을 사용합니다. OneUptime API를 호출하는 **API** 블록으로 하면 됩니다.

`ApiKey` 헤더를 붙여 `PUT /api/workflow-variable/<variable-id>`를 호출하되, 여기서 많이들 걸려 넘어지는 부분은 바꾸려는 필드를 **`data` 객체로 감싸야** 한다는 점입니다.

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

`data` 래퍼 없이 평평한 본문을 보내면 400으로 거부됩니다. 실제로 바꾸려는 필드만 보내면 되고, `name`과 `description`은 페이로드에서 빼도 됩니다.

API 키에는 **Edit Workflow Variables** 권한이 필요합니다. 읽기 권한은 필요 없습니다 — 갱신할 때 해당 행을 다시 읽지 않기 때문입니다.

두 가지를 조심하세요.

- **참조하고 있는 변수의 이름을 바꾸지 마세요.** `name`은 `{{local.variables.NAME}}`의 일부입니다. 이름을 바꾸면 기존 참조가 모두 해석되지 않은 채로 남고, 해석되지 않은 참조는 문자 그대로 전달됩니다 — 아래 주의 사항을 보세요.
- **이 방법으로 변수에 쓸 수는 있어도 다시 읽어 올 수는 없습니다.** `content`는 시크릿이든 아니든 모든 변수에서 API 기준 쓰기 전용입니다. 그래서 변수는 교체되는 토큰을 안전하게 넣어 두기 좋은 자리입니다. 시크릿으로 표시하면 실행 로그와 단계 추적에서도 값이 가려집니다.

## 주의 사항

- **선택기를 사용하세요.** 러너가 기대하는 구성 요소 id, 반환값 id, 변수 id를 정확히 넣어 주고, 화면에 표시되는 라벨과 무관하게 참조를 유지해 줍니다.
- **변수 이름은 대소문자를 구분합니다.** `{{global.variables.MyKey}}`와 `{{global.variables.mykey}}`는 서로 다릅니다.
- **해석되지 않은 참조는 비워지지 않고 그대로 남습니다.** 없는 것을 참조해도 오류가 되지 않고, 빈 문자열이 되지도 않습니다. 중괄호가 그대로 통과되므로, 단계 id를 잘못 적은 `{{local.components.api-get-1.returnValues.body}}`는 Slack 메시지나 URL, 요청 본문에 글자 그대로 실려 나가고 실행은 여전히 **Executed**로 보고됩니다. 실행 로그에는 그렇게 빠져나간 참조를 알려 주는 경고 줄이 남습니다.
- **빌더는 변수 이름을 검사할 수 없습니다.** 알 수 없는 단계 id, 알 수 없는 반환값, 잘못된 루트처럼 대응되는 대상을 찾을 수 없는 구성 요소 참조는 저장 전에 잡아냅니다. 하지만 변수가 존재하는지는 알 수 없어서, 이름이 바뀐 변수는 실행 로그에서만 드러납니다.
- **중괄호 안의 공백은 잘리지 않습니다.** `{{ local.variables.NAME }}`은 `{{local.variables.NAME}}`과 다른 조회이며 절대 해석되지 않습니다. 유일한 예외는 `{{#each}}` 블록 안으로, 여기서는 이름의 공백이 잘립니다.

## 다음으로 읽을거리

- [워크플로우 구성 요소](/docs/workflows/components) — 각 블록이 만들어 내는 출력의 전체 목록.
- [워크플로우 실행 및 로그](/docs/workflows/runs-and-logs) — 실행 후 모든 변수의 실제 값 확인하기.
- [워크플로우 설정 및 보안](/docs/workflows/configuration) — 전역 변수에 넣어도 안전한 것.
