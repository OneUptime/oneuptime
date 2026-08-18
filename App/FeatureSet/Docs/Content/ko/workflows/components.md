# 구성 요소 (Components)

Component는 트리거 뒤에 추가하는 빌딩 블록입니다. 각 component는 메시지 전송, API 호출, 조건 확인처럼 한 가지 일을 하고, 그다음에 오는 것과 연결됩니다.

이 페이지는 카탈로그입니다. 캔버스에서 추가하고 연결하는 방법은 [워크플로우 작성](/docs/workflows/authoring)을 참고하세요.

## API

어떤 URL로든 HTTP 요청을 보냅니다.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE` 중 하나입니다.
- **URL** — 호출할 주소입니다.
- **Headers** — 함께 보낼 헤더입니다.
- **Body** — `POST` / `PUT` / `PATCH`에 사용할 요청 본문입니다.

**Outputs**:

- **Success** — 호출이 성공했을 때(2xx 응답) 발생합니다. 상태 코드, 헤더, 본문을 함께 전달합니다.
- **Error** — 네트워크 실패나 2xx가 아닌 응답일 때 발생합니다. 오류 메시지를 함께 전달합니다.

이런 경우에 사용하세요: 외부 API, 자체 관리자 엔드포인트, 또는 전용 component가 없는 모든 통합.

## AI

### Generate Text with AI

프롬프트와 선택적인 JSON 컨텍스트로부터 하나의 텍스트 응답을 생성합니다. 이 component는 프로젝트에 설정된 기본 LLM 제공자를 사용하며, 설치본에 전역 제공자가 있는 경우 그쪽으로 대체됩니다. 제공자 자격 증명과 엔드포인트는 중앙에서 설정되며 워크플로 인자가 아닙니다.

**Settings**:

- **System Instructions** — 모델의 역할, 어조, 제약을 위한 선택적 안내입니다.
- **Prompt** — 필수인 작업 내용입니다. 워크플로 변수와 이전 component의 출력을 포함할 수 있습니다.
- **Context** — 요청에 의도적으로 포함시키는 선택적 JSON입니다. 메시지 안에서 명시적인 신뢰 경계 표시 뒤에 덧붙여지며, 메시지의 나머지 부분에서 신뢰할 수 없는 데이터로 취급됩니다.
- **Temperature** — `0`에서 `1` 사이의 변동폭입니다. 기본값은 예측 가능한 자동화를 위해 `0.2`입니다.
- **Maximum Output Tokens** — `1`에서 `4096` 사이입니다. 기본값은 `1024`입니다.

System Instructions, Prompt, 직렬화된 Context를 합친 길이는 50,000자로 제한됩니다. 제공자 요청은 최대 60초까지 허용되며 한 번만 시도됩니다. 프로젝트당 최대 세 개의 워크플로 AI 요청을 동시에 실행할 수 있습니다.

**Outputs**:

- **Response** — 생성된 텍스트입니다.
- **Provider**와 **Model** — 호출에 사용된 설정입니다.
- **Total Tokens**와 **Completion Tokens** — 제공자가 보고한 사용량입니다.
- **LLM Log ID** — 해당 호출의 계측된 AI 로그 항목입니다.
- **Error** — 유효성 검사, 접근 권한, 제공자, 예산, 결제, 타임아웃 오류가 있을 때 표시됩니다.

응답을 사용할 component에는 **Success**를 연결하세요. **Error**는 명확한 대체 경로, 알림, 로그 경로에 연결하세요. 이 component는 도구 정의나 제공자 고유의 capability 필드 없이 하나의 모델 요청만 보냅니다. 즉, 스스로 OneUptime을 조회하거나 API를 호출하거나 프로젝트 데이터를 바꿀 수 없습니다. OneUptime의 고정된 component 안전 지침 외에는 여러분이 설정한 System Instructions, Prompt, Context만 제공자에게 전송되며, 이때도 해당 필드 안의 워크플로 변수가 먼저 해석된 뒤 전송됩니다. 모델이 제공자가 관리하는 고유한 capability를 가질 수 있으므로, 설정된 제공자/모델은 여전히 신뢰 경계로 남습니다.

모델 출력은 신뢰할 수 없는 텍스트입니다. 고객에게 전달되는 커뮤니케이션에 사용하기 전에 검토하고, 자유 형식의 AI 텍스트만으로 파괴적인 워크플로 동작을 승인하지 마세요. 제공자, egress, 로깅, 비용에 대한 자세한 내용은 [워크플로우 설정 및 보안](/docs/workflows/configuration)을 참고하세요.

## Webhook (outbound)

"보내고 신경 쓰지 않는" 경우를 위한 API component의 단순화된 버전입니다. URL로 JSON 본문을 전송합니다.

응답을 읽어야 한다면 **API**를 사용하세요. 알림만 보내고 넘어가고 싶다면 **Webhook**을 사용하세요.

## Slack

Slack 채널에 메시지를 게시합니다.

**Settings**:

- **Channel** — 채널 이름입니다. 봇이 해당 채널에 이미 들어가 있어야 합니다.
- **Message** — 보낼 텍스트입니다. Slack 서식을 지원합니다.

먼저 **Project Settings → Workspace → Slack**에서 Slack을 프로젝트에 연결하세요. [Slack Workspace Connection](/docs/workspace-connections/slack)을 참고하세요.

## Microsoft Teams

Microsoft Teams 채널에 메시지를 게시합니다.

**Settings**:

- **Team and channel** — 게시할 위치입니다.
- **Message** — 보낼 텍스트입니다.

설정 방법은 [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams)을 참고하세요.

## Discord

수신 webhook URL을 통해 Discord 채널에 메시지를 게시합니다.

## Telegram

봇 토큰과 채팅 ID를 사용해 Telegram 채팅으로 메시지를 보냅니다.

## Email

OneUptime을 통해 이메일을 보냅니다.

**Settings**:

- **To** — 수신자의 이메일 주소입니다.
- **Subject** — 제목 줄입니다.
- **Body** — Markdown 또는 HTML로 작성하는 메시지입니다.

이메일은 프로젝트에 설정된 발신자로부터 나갑니다 — [SMTP](/docs/emails/smtp)를 참고하세요.

## Custom Code

다른 블록으로 할 수 없는 작업이 필요할 때 짧은 JavaScript를 실행합니다.

**Settings**:

- **Code** — 여러분의 JavaScript입니다. 마지막 값(또는 async 함수에서 반환한 값)이 블록의 출력이 됩니다.
- **Arguments** — 전달할 수 있는 이름 있는 값입니다.

**Outputs**: success(반환 값)와 error(발생한 예외).

이런 경우에 사용하세요: 두 시스템 사이에서 데이터를 재구성하거나, 간단한 계산을 하거나, 전용 블록을 둘 정도는 아닌 작업. 더 무거운 스크립팅이 필요하다면 [Runbook](/docs/runbooks/index)을 대신 사용하세요.

## JSON

텍스트와 JSON을 서로 변환합니다.

- **JSON → Text** — JSON 객체를 문자열로 바꿉니다. 다음 블록이 텍스트를 기대할 때 유용합니다.
- **Text → JSON** — 문자열을 JSON 객체로 파싱합니다. 텍스트로 들어온 것에서 필드를 읽어야 할 때 유용합니다.

## Conditions

비교를 기반으로 분기합니다. **Add Component** 패널에서는 Conditions 카테고리 아래 **If / Else**라는 이름으로 표시됩니다.

**Settings**:

- **Left value** — 대개 이전 블록에서 온 값입니다.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with` 중 하나입니다.
- **Right value** — 비교 대상입니다.

**Outputs**: **Yes**와 **No**입니다. 원하는 분기 쪽에 다음 블록을 연결하세요.

## Delay

계속 진행하기 전에 정해진 시간만큼 워크플로를 일시 정지합니다. 다른 시스템이 따라올 시간을 줘야 할 때 유용합니다.

## Log

run 로그에 한 줄을 기록합니다. 외부에 아무 영향도 주지 않습니다 — 여러분이 읽을 수 있도록 워크플로의 로그에 표시될 뿐입니다. 디버깅에 유용합니다.

## Execute Workflow

이 워크플로에서 다른 워크플로를 호출합니다. 호출된 워크플로는 독립적으로 실행됩니다 — 여러분의 워크플로는 그것이 끝나기를 기다리지 않고 계속 진행됩니다.

공통 로직을 공유할 때 사용하세요. "인시던트 채널에 게시" 워크플로를 한 번만 만들어 두고, 채널에 알려야 하는 다른 모든 워크플로에서 호출하면 됩니다.

워크플로끼리 서로를 계속 호출하며 루프에 빠지지 않도록 안전 한도가 있습니다. [워크플로우 설정 및 보안](/docs/workflows/configuration)을 참고하세요.

## OneUptime 데이터 component

OneUptime의 모든 종류의 레코드(모니터, 인시던트, 알림, 상태 페이지, 온콜 정책 등 다수)에 대해 **Add Component** 패널에는 다음과 같은 component가 있습니다 — 타입의 이름으로 검색하세요. 각 제목은 레코드 타입으로부터 생성되므로, Monitor 세트는 다음과 같습니다.

- **Find One Monitor** — 쿼리와 일치하는 레코드 하나를 읽습니다.
- **Find Many Monitors** — 쿼리와 일치하는 레코드 목록을 읽습니다.
- **Create One Monitor** — JSON 객체로부터 레코드 하나를 추가합니다.
- **Create Many Monitors** — JSON 배열로부터 여러 레코드를 추가합니다.
- **Update One Monitor** — 일치하는 레코드 하나에 쓰기 payload를 적용합니다.
- **Update Many Monitors** — Limit까지, 일치하는 레코드들에 쓰기 payload를 적용합니다.
- **Delete One Monitor** — 일치하는 레코드 하나를 삭제합니다.
- **Delete Many Monitors** — Limit까지, 일치하는 레코드들을 삭제합니다.

같은 세트는 세 개의 트리거도 제공합니다 — **On Create Monitor**, **On Update Monitor**, **On Delete Monitor**입니다. [Triggers](/docs/workflows/triggers)를 참고하세요.

타입은 해당 모델이 허용하는 component만 제공합니다. 읽기 전용 타입에는 두 개의 Find component만 있으므로, 패널에서 **Delete One Monitor**를 찾을 수 없다면 그 타입은 삭제를 허용하지 않는 것입니다.

이것이 워크플로가 OneUptime 데이터를 읽고 바꿀 수 있는 방법입니다. 예를 들어 CI 도구에서 온 webhook이 **Create One Incident**를 사용해 실패 세부 정보를 담은 인시던트를 열 수 있습니다.

## 레코드 다루기

데이터 component의 모든 필드는 레코드 자체의 **column** 이름으로 키가 지정됩니다 — 대시보드 양식에 표시되는 레이블이 아니라 API가 사용하는 것과 같은 이름입니다. ID 컬럼은 `_id`입니다. `id` 표기도 column 이름을 입력할 수 있는 곳이면 어디서나 별칭으로 허용되지만, 레코드가 실제로 돌려주는 것은 `_id`이므로 결과를 읽을 때는 이것을 확인해야 합니다.

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query**는 component가 어떤 레코드에 작용할지 결정합니다. key는 column이고, value는 일치시킬 대상입니다.

```json
{ "monitorType": "Website", "isEnabled": true }
```

쿼리는 항상 워크플로가 실행되는 프로젝트로 범위가 제한됩니다. 다른 프로젝트의 레코드에는 접근할 수 없으며, 프로젝트를 직접 쿼리에 추가할 필요도 없습니다.

Create One의 **JSON Object**, Create Many의 **JSON Array**, Update component의 **Data (JSON Object)**는 쓸 필드를 담으며, 같은 방식으로 key가 지정됩니다.

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

column이 아닌 key는 거부되지 않고 무시됩니다 — run 로그에 어떤 key가 제외되었는지 표시되므로, 필드가 반영되지 않을 때는 거기서 확인하세요. Find component와 트리거에 있는 **Select Fields**는 같은 column key를 `true` 값과 함께 사용합니다. 예: `{"_id": true, "name": true}`.

**Skip**과 **Limit**은 Find Many, Update Many, Delete Many에 있는 두 개의 숫자 필드입니다 — `Skip: 0`과 `Limit: 100`은 처음 백 개의 일치 항목을 가져옵니다. Limit의 기본값은 `10`이며, Update Many와 Delete Many에서는 돌아오는 개수뿐 아니라 실제로 쓰여지는 레코드 개수도 제한합니다. 따라서 `Items Deleted: 10`은 열 개가 일치했다는 뜻이 아니라 열 개가 삭제되었다는 뜻입니다. 열 개보다 많이 바꾸려면 Limit을 올리세요.

**Success**와 **Error**는 쿼리가 실행되었는지를 알려줄 뿐, 무엇을 찾았는지는 알려주지 않습니다. 아무것도 일치하지 않는 쿼리도 `0`을 반환하며 Success로 빠져나갑니다 — 이것은 실패가 아닙니다. 무언가 일치했는지에 따라 분기하려면 반환된 개수를 **If / Else** 블록에서 읽으세요.

## 어떤 component를 사용해야 하나요?

몇 가지 간단한 규칙입니다.

- 원하는 것에 전용 블록(Slack, Email, OneUptime 레코드)이 있다면 그것을 사용하세요 — 더 나은 오류 처리와 더 명확한 로그를 얻을 수 있습니다.
- 그 밖의 외부 API에는 **API**를 사용하세요.
- 명시적으로 선택한 워크플로 데이터를 요약, 분류, 초안 작성하려면 **Generate Text with AI**를 사용하세요.
- 블록 사이에서 데이터를 재구성하려면 **Custom Code**나 **JSON**을 사용하세요.
- 값에 따라 다른 동작을 하려면 **Conditions**를 사용하세요.

## 다음에 읽을 문서

- [워크플로우 변수](/docs/workflows/variables) — 블록 간에 데이터를 전달하는 방법.
- [워크플로우 실행 및 로그](/docs/workflows/runs-and-logs) — run에서 각 블록이 무엇을 했는지 확인하는 방법.
- [워크플로우 설정 및 보안](/docs/workflows/configuration) — 한도, 소유자, 시크릿.
