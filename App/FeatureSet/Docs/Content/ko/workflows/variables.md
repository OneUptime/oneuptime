# 변수

워크플로우는 데이터가 그 안을 흐를 때만 유용합니다. 변수는 그 데이터가 이동하는 방법입니다 — 트리거에서 첫 구성 요소로, 한 구성 요소의 출력에서 다음 구성 요소의 입력으로, 그리고 프로젝트 단위 비밀에서 그것이 참조되는 어디로든.

OneUptime은 두 종류의 변수와 둘 다 작동하는 하나의 보간 구문을 가지고 있습니다.

## 글로벌 변수

**워크플로우 → 글로벌 변수** 아래에서 한 번 정의되는 프로젝트 단위 값. API 키, 베이스 URL, 채널 이름, 열 개의 워크플로우에 하드코딩하고 싶지 않은 모든 것을 생각해 보세요.

글로벌 변수는 다음을 가집니다:

- **Name** — 참조하는 식별자. 템플릿에서 명백하도록 `UPPER_SNAKE_CASE`를 사용하세요.
- **Value** — 문자열 값. 다중 라인 값이 지원됩니다.
- **Is Secret** — 켜져 있을 때, 값은 저장 후 UI에서 쓰기 전용이며 실행 로그에서 가려집니다.

어디서든 어떤 워크플로우에서든 글로벌 변수를 다음과 같이 참조합니다:

```
{{variable.NAME}}
```

예를 들어, `PAGERDUTY_KEY`를 비밀 변수로 정의했다면, PagerDuty를 호출하는 모든 API 구성 요소는 워크플로우 JSON에 실제 키가 보이지 않은 채 `{{variable.PAGERDUTY_KEY}}`로 읽을 수 있습니다.

## 로컬 변수

로컬 변수는 이번 실행에서 이미 실행된 노드의 반환값입니다. 모든 트리거와 모든 구성 요소가 하나를 게시합니다 — 노드별 목록은 [트리거](/docs/workflows/triggers)와 [구성 요소](/docs/workflows/components)를 참고하세요.

로컬 변수는 다음과 같이 참조합니다:

```
{{NodeId.fieldName}}
```

`NodeId`는 캔버스 위 트리거 또는 구성 요소의 이름입니다(가독성을 위해 이름을 바꿀 수 있습니다 — 참조가 깨끗하게 유지되도록 짧고 `PascalCase`로 유지하세요). `fieldName`은 그 노드가 게시하는 무엇이든 입니다.

예시:

- `LookupUser`라는 이름의 **API** 구성 요소가 성공적으로 반환된 후, 하위 노드는 상태 코드를 `{{LookupUser.response-status}}`로, 파싱된 본문을 `{{LookupUser.response-body}}`로 읽을 수 있습니다.
- `Incident`라는 이름의 **Incident → On Create** 트리거 후, `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}`, 그리고 인시던트의 다른 어떤 컬럼이든 읽을 수 있습니다.
- `Transform`이라는 이름의 **Custom Code** 구성 요소 후, 반환된 값은 `{{Transform.value}}`로 노출됩니다.

로컬 변수는 단일 실행에 한정됩니다. 다음 실행은 새로운 슬레이트로 시작합니다.

## 보간이 작동하는 곳

거의 모든 텍스트 스타일 인자가 보간을 지원합니다:

- API 구성 요소의 URL 필드
- Slack / Teams / Discord / Telegram / Email의 메시지 텍스트
- Email의 제목과 본문
- 헤더와 본문 필드(JSON 값 안에서 사용)
- 조건의 왼쪽과 오른쪽 피연산자

순수 JSON 인자는 문자열 값 안에서 보간을 허용합니다; 키를 보간할 수는 없습니다. 동적 구조를 만들어야 한다면, **Custom Code**를 사용해 페이로드를 조립한 다음 그 반환값을 다음 노드에 파이핑하세요.

**Custom Code** 구성 요소는 변수를 다르게 읽습니다 — 글로벌 변수는 `args.variables`에 노출되고, 상위 반환값은 구성 요소에 설정한 이름 붙은 인자로 전달됩니다.

## 예시

### 트리거에서 페이로드 만들기

웹훅이 CI 빌드 결과를 받습니다. 본문은 `{ "service": "checkout", "status": "failed" }` 같은 JSON입니다. 그것을 OneUptime 인시던트로 바꾸려면:

1. `CIWebhook`이라는 이름의 **Webhook** 트리거.
2. **Conditions** 구성 요소: 왼쪽 `{{CIWebhook.Request Body.status}}`, 연산자 `==`, 오른쪽 `failed`.
3. `yes` 포트에서 **Create Incident** 구성 요소를 다음과 함께:
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the build logs.`

### 아웃바운드 API 호출에서 비밀 사용

PagerDuty를 호출하는 워크플로우:

1. `PAGERDUTY_KEY`를 비밀 글로벌 변수로 정의합니다.
2. **API** 구성 요소에서 `Authorization` 헤더를 `Token token={{variable.PAGERDUTY_KEY}}`로 설정합니다.

키는 워크플로우 JSON이나 실행 로그에 절대 나타나지 않습니다.

### 두 API 호출 체이닝

첫 번째 호출이 두 번째 호출에 필요한 ID를 반환합니다:

1. **API** 구성 요소 `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API** 구성 요소 `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

`LookupOrder`가 non-2xx 응답을 반환하면, `success` 대신 `error` 포트가 발동합니다 — 실패가 소리 없이 일어나지 않도록 그 분기를 Email 또는 Slack 구성 요소에 배선하세요.

## 몇 가지 주의 사항

- **노드 이름의 오타는 참조를 소리 없이 깨뜨립니다.** `{{OldName.field}}`를 하위에 배선한 후 노드 이름을 바꾸면, 모든 참조를 업데이트하세요. 실행 로그를 보세요 — 캡처된 인자에 리터럴 `{{OldName.field}}`가 보인다면, 조회가 해결되지 않은 것입니다.
- **비밀은 대소문자를 구분합니다.** `{{variable.MyKey}}`와 `{{variable.mykey}}`는 다른 변수입니다.
- **누락된 필드는 빈 값입니다.** `{{Foo.nonexistent}}`를 참조하면 오류가 아니라 빈 문자열을 만듭니다. 유용하지만, 버그를 가릴 수 있습니다 — 다음 단계에 필드가 필요하다면 **Conditions** 노드로 존재를 단언하세요.

## 다음으로 읽을 것

- [구성 요소](/docs/workflows/components) — 반환값 이름의 전체 카탈로그.
- [실행 및 로그](/docs/workflows/runs-and-logs) — 실행 후 모든 보간된 인자의 리터럴 값을 점검.
- [설정 및 보안](/docs/workflows/configuration) — 글로벌 변수에 두기에 안전한 것.
