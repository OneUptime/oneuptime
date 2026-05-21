# 변수

워크플로는 데이터를 이동시키는 것이 핵심입니다. 트리거에서 첫 번째 블록으로, 한 블록에서 다음 블록으로, 공유 값에서 필요한 어디로든 데이터가 흘러갑니다. 변수는 이 데이터가 이동하는 방법입니다.

두 가지 종류가 있으며, 동일한 구문을 사용합니다.

## 전역 변수

프로젝트 전체에서 한 번 저장하고 어디에서나 재사용하는 값입니다. API 키, URL, 채널 이름 등 10개의 다른 워크플로에 복사하고 싶지 않은 모든 것이 해당됩니다.

**Workflows → Global Variables**에서 찾을 수 있습니다. 각 변수에는 다음이 있습니다.

- **Name** — 참조 방법입니다. 블록에서 눈에 띄도록 `UPPER_SNAKE_CASE`를 사용하시기 바랍니다.
- **Value** — 실제 값입니다. 여러 줄 값도 가능합니다.
- **Is Secret** — 켜면 저장 후 UI에서 값이 숨겨지고 실행 로그에서도 숨겨집니다.

워크플로에서 전역 변수를 사용하려면 다음과 같이 작성합니다.

```
{{variable.NAME}}
```

예를 들어, PagerDuty 키를 `PAGERDUTY_KEY`로 저장했다면 모든 블록에서 `{{variable.PAGERDUTY_KEY}}`로 사용할 수 있으며, 실제 키는 워크플로나 로그에 절대 표시되지 않습니다.

## 로컬 변수(이전 블록의 데이터)

로컬 변수는 현재 실행에서 이미 동작한 블록의 출력입니다. 모든 트리거와 모든 컴포넌트는 읽을 수 있는 출력을 생성합니다.

이전 블록의 출력은 다음과 같이 참조합니다.

```
{{BlockName.fieldName}}
```

`BlockName`은 캔버스에 있는 트리거나 컴포넌트의 이름입니다(짧고 명확한 이름으로 변경할 수 있습니다). `fieldName`은 해당 블록이 생성하는 모든 항목입니다.

예시:

- `LookupUser`라는 이름의 **API** 블록이 실행된 후, 상태 코드를 `{{LookupUser.response-status}}`로, 본문을 `{{LookupUser.response-body}}`로 읽을 수 있습니다.
- `Incident`라는 이름의 **Incident → On Create** 트리거 다음에는 `{{Incident.title}}`, `{{Incident.description}}` 및 인시던트의 다른 필드를 읽을 수 있습니다.
- `Transform`이라는 이름의 **Custom Code** 블록 다음에는 반환된 값을 `{{Transform.value}}`로 읽을 수 있습니다.

로컬 변수는 현재 실행 중에만 존재합니다. 새 실행은 모두 처음부터 다시 시작됩니다.

## 변수가 동작하는 곳

거의 모든 텍스트 필드는 변수를 받습니다.

- API 블록의 URL.
- Slack, Teams, Discord, Telegram, Email의 메시지 텍스트.
- 이메일의 제목과 본문.
- 헤더와 본문 필드(문자열 값 내부).
- Conditions 블록의 양쪽 값.

순수 JSON 필드는 문자열 값 내부에서 변수를 받지만, 변수를 키로 사용할 수는 없습니다. 구조를 동적으로 빌드해야 한다면 **Custom Code** 블록을 사용해 빌드한 다음 그 출력을 다음 블록에 전달하세요.

**Custom Code** 블록은 변수를 다르게 읽습니다. 전역 변수는 `args.variables`로 들어오며, 어떤 이전 출력을 인수로 전달할지 직접 결정합니다.

## 예시

### Webhook에서 페이로드 빌드하기

webhook이 `{ "service": "checkout", "status": "failed" }`와 같은 본문으로 도착합니다. 이를 OneUptime 인시던트로 변환하려면 다음과 같이 합니다.

1. `CIWebhook`이라는 이름의 **Webhook** 트리거.
2. **Conditions** 블록: left `{{CIWebhook.Request Body.status}}`, operator `==`, right `failed`.
3. **Yes** 분기에서 **Create Incident** 블록을 다음과 같이 설정합니다.
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the logs.`

### API 호출에서 시크릿 사용

PagerDuty를 호출하는 워크플로의 예시입니다.

1. `PAGERDUTY_KEY`를 시크릿 전역 변수로 저장합니다.
2. **API** 블록에서 `Authorization` 헤더를 `Token token={{variable.PAGERDUTY_KEY}}`로 설정합니다.

키는 워크플로와 로그에 노출되지 않습니다.

### 두 개의 API 호출 연결

첫 번째 호출이 두 번째 호출에 필요한 ID를 제공합니다.

1. **API** 블록 `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API** 블록 `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

`LookupOrder`가 실패하면 **success** 대신 **error** 출력이 발생합니다. 실패가 무시되지 않도록 이를 Email 또는 Slack 블록에 연결하시기 바랍니다.

## 주의사항

- **블록의 이름을 변경하면 참조가 끊어집니다.** 블록의 이름을 변경하면 사용된 모든 위치를 업데이트해야 합니다. 실행 로그에서는 미해결 참조가 `{{BlockName.field}}` 텍스트 그대로 표시됩니다.
- **변수 이름은 대소문자를 구분합니다.** `{{variable.MyKey}}`와 `{{variable.mykey}}`는 다릅니다.
- **누락된 필드는 빈 값이 됩니다.** 존재하지 않는 필드를 참조하면 오류 대신 빈 문자열을 반환합니다. 편리하지만 버그를 숨길 수 있으므로, 중요한 필드는 계속 진행하기 전에 **Conditions** 블록으로 확인하시기 바랍니다.

## 다음에 읽어 볼 내용

- [컴포넌트](/docs/workflows/components) — 각 블록이 생성하는 출력의 전체 목록.
- [실행 및 로그](/docs/workflows/runs-and-logs) — 실행 후 모든 변수의 실제 값 보기.
- [구성 및 안전](/docs/workflows/configuration) — 전역 변수에 넣어도 안전한 것.
