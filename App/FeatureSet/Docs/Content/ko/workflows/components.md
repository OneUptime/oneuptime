# 컴포넌트

컴포넌트는 트리거 뒤에 추가하는 빌딩 블록입니다. 각각은 하나의 작업(메시지 전송, API 호출, 조건 확인 등)을 수행하며, 다음 블록과 연결됩니다.

이 페이지는 카탈로그입니다. 캔버스에서 끌어다 놓고 연결하는 방법은 [워크플로 작성하기](/docs/workflows/authoring)를 참조하세요.

## API

임의의 URL로 HTTP 요청을 만듭니다.

**설정**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` 또는 `DELETE`.
- **URL** — 호출할 주소.
- **Headers** — 전송할 헤더.
- **Body** — `POST` / `PUT` / `PATCH`의 요청 본문.

**출력**:

- **Success** — 호출이 정상적으로 동작한 경우(2xx 응답) 발생합니다. 상태, 헤더, 본문을 전달합니다.
- **Error** — 네트워크 오류 또는 2xx가 아닌 응답에서 발생합니다. 오류 메시지를 전달합니다.

용도: 외부 API, 자체 관리 엔드포인트, 또는 전용 컴포넌트가 없는 통합에 사용합니다.

## Webhook(아웃바운드)

"보내고 잊어버리는" 경우를 위한 더 간단한 API 컴포넌트입니다. URL에 JSON 본문을 전송합니다.

응답을 읽어야 한다면 **API**를 사용하세요. 단순히 알림을 보내고 다음으로 넘어가려면 **Webhook**을 사용하세요.

## Slack

Slack 채널에 메시지를 게시합니다.

**설정**:

- **Channel** — 채널 이름. 봇이 이미 해당 채널에 있어야 합니다.
- **Message** — 보낼 텍스트. Slack 서식을 지원합니다.

먼저 **Project Settings → Workspace Connections → Slack**에서 Slack을 프로젝트에 연결하세요. [Slack 워크스페이스 연결](/docs/workspace-connections/slack)을 참조하시기 바랍니다.

## Microsoft Teams

Microsoft Teams 채널에 메시지를 게시합니다.

**설정**:

- **Team and channel** — 게시할 위치.
- **Message** — 보낼 텍스트.

설정 방법은 [Microsoft Teams 워크스페이스 연결](/docs/workspace-connections/microsoft-teams)을 참조하시기 바랍니다.

## Discord

들어오는 webhook URL을 통해 Discord 채널에 메시지를 게시합니다.

## Telegram

봇 토큰과 채팅 ID를 사용해 Telegram 채팅에 메시지를 보냅니다.

## Email

OneUptime을 통해 이메일을 전송합니다.

**설정**:

- **To** — 수신자의 이메일 주소.
- **Subject** — 제목.
- **Body** — Markdown 또는 HTML 형식의 메시지.

이메일은 프로젝트에 구성된 발신자로 전송됩니다. [SMTP](/docs/emails/smtp)를 참조하시기 바랍니다.

## Custom Code

다른 블록으로 처리할 수 없는 작업이 필요할 때 작은 JavaScript 조각을 실행합니다.

**설정**:

- **Code** — JavaScript 코드입니다. 마지막 값(또는 async 함수에서 반환한 값)이 블록의 출력이 됩니다.
- **Arguments** — 전달할 명명된 값.

**출력**: success(반환 값)와 error(발생한 예외).

용도: 두 시스템 간의 데이터 재구성, 간단한 계산, 별도 블록이 필요 없는 작업 등. 더 복잡한 스크립트가 필요하다면 [런북](/docs/runbooks/index)을 사용하시기 바랍니다.

## JSON

텍스트와 JSON 간 변환합니다.

- **JSON → Text** — JSON 객체를 문자열로 변환합니다. 다음 블록이 텍스트를 기대할 때 유용합니다.
- **Text → JSON** — 문자열을 JSON 객체로 파싱합니다. 텍스트로 도착한 데이터의 필드를 읽어야 할 때 유용합니다.

## Conditions

비교 결과에 따라 분기합니다.

**설정**:

- **Left value** — 보통 이전 블록의 값입니다.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — 비교할 대상.

**출력**: **Yes**와 **No**. 원하는 분기에 다음 블록을 연결하시면 됩니다.

## Delay

계속 진행하기 전에 설정된 시간 동안 워크플로를 일시 중지합니다. 다른 시스템이 따라잡을 시간이 필요할 때 유용합니다.

## Log

실행 로그에 한 줄을 기록합니다. 외부 효과는 없으며, 워크플로의 로그에 표시되어 사용자가 읽을 수 있습니다. 디버깅에 편리합니다.

## Execute Workflow

이 워크플로에서 다른 워크플로를 호출합니다. 호출된 워크플로는 자체적으로 실행되며, 현재 워크플로는 완료를 기다리지 않고 계속 진행합니다.

공통 로직을 공유할 때 사용합니다. "인시던트 채널에 게시" 워크플로를 한 번 만들어 두면, 채널에 알림을 보내야 하는 다른 모든 워크플로에서 호출할 수 있습니다.

워크플로가 서로 무한히 호출하는 것을 방지하는 안전 한도가 있습니다. [구성 및 안전](/docs/workflows/configuration)을 참조하시기 바랍니다.

## OneUptime 데이터 컴포넌트

OneUptime의 모든 종류의 레코드(모니터, 인시던트, 알림, 상태 페이지, 온콜 정책 등)에 대해 팔레트에서 다음 컴포넌트를 제공합니다. 유형 이름으로 검색하세요.

- **Find One** — ID 또는 필터로 레코드 하나를 가져옵니다.
- **Find** — 레코드 목록을 가져옵니다.
- **Create** — 새 레코드를 추가합니다.
- **Update** — 레코드 하나를 변경합니다.
- **Delete** — 레코드 하나를 제거합니다.
- **Count** — 필터와 일치하는 레코드 수를 셉니다.

이 컴포넌트들을 통해 워크플로에서 OneUptime 데이터를 읽고 변경할 수 있습니다. 예를 들어, CI 도구의 webhook에서 **Create Incident**를 사용해 실패 세부 정보가 포함된 인시던트를 열 수 있습니다.

## 어떤 컴포넌트를 사용해야 할까요?

몇 가지 간단한 규칙은 다음과 같습니다.

- 원하는 작업에 대한 전용 블록(Slack, Email, OneUptime 레코드)이 있다면 그것을 사용하세요. 더 나은 오류 처리와 명확한 로그를 얻을 수 있습니다.
- 그 외 외부 API의 경우 **API**를 사용하세요.
- 블록 간 데이터를 재구성하려면 **Custom Code** 또는 **JSON**을 사용하세요.
- 값에 따라 다른 동작을 수행하려면 **Conditions**를 사용하세요.

## 다음에 읽어 볼 내용

- [변수](/docs/workflows/variables) — 블록 간 데이터 전달.
- [실행 및 로그](/docs/workflows/runs-and-logs) — 실행 중 각 블록이 무엇을 했는지 확인하기.
- [구성 및 안전](/docs/workflows/configuration) — 한도, 소유자, 시크릿.
