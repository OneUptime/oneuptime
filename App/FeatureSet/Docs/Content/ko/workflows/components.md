# 구성 요소

구성 요소는 트리거 뒤에 배치하는 액션 노드입니다. 각각은 하나의 일을 합니다 — HTTP 요청 보내기, Slack 메시지 전송, 조건 분기, JavaScript 스니펫 실행 — 그리고 다음 노드가 연결할 수 있는 하나 이상의 출력 포트를 노출합니다.

이 페이지는 카탈로그입니다. 배선 규칙과 캔버스 자체에 대해서는 [워크플로우 작성](/docs/workflows/authoring)을 참고하세요.

## API

어떤 URL이든 아웃바운드 HTTP 요청을 보냅니다.

**인자**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — 요청 URL. 보간됩니다.
- **Request Headers** — 헤더의 JSON 객체.
- **Request Body** — `POST` / `PUT` / `PATCH`용 JSON 또는 텍스트 본문.

**출력 포트**:

- `success` — 응답 상태가 2xx일 때 발동. 반환값: `response-status`, `response-headers`, `response-body`.
- `error` — 네트워크 실패 또는 non-2xx 응답일 때 발동. 반환값: `error` 메시지.

사용 시점: 어떤 서드파티 REST API든, 자체 어드민 엔드포인트, 전용 구성 요소가 없는 가벼운 통합.

## 웹훅(아웃바운드)

흔한 "쏘고 잊기" 케이스를 위한 API 구성 요소의 얇은 래퍼. URL에 JSON 본문을 게시하고 단일 `success` / `error` 쌍을 노출합니다.

응답 본문을 하위에서 읽어야 하면 **API**를 선호하세요; 다른 시스템에 알림만 보내고 싶으면 **Webhook**을 선호하세요.

## Slack

프로젝트의 Slack 워크스페이스 연결을 사용해 Slack 채널에 메시지를 게시합니다.

**인자**:

- **Channel name** — 게시할 채널. 봇이 이미 그 채널의 멤버여야 합니다.
- **Message text** — 본문. 보간되며, Slack mrkdwn을 지원합니다.

먼저 **Project Settings → Workspace Connections → Slack**에서 워크스페이스 연결을 설정하세요. [Slack 워크스페이스 연결](/docs/workspace-connections/slack)을 참고하세요.

## Microsoft Teams

프로젝트의 Teams 연결을 사용해 Microsoft Teams 채널에 메시지를 게시합니다.

**인자**:

- **Team & channel** — 대상.
- **Message text** — 본문.

연결 설정은 [Microsoft Teams 워크스페이스 연결](/docs/workspace-connections/microsoft-teams)을 참고하세요.

## Discord

구성 요소에 설정된 인커밍 웹훅 URL을 통해 Discord 채널에 메시지를 게시합니다.

## Telegram

구성 요소에 설정된 봇 토큰과 채팅 ID를 통해 Telegram 채팅에 메시지를 보냅니다.

## Email

OneUptime의 SMTP 설정을 통해 이메일을 보냅니다.

**인자**:

- **To** — 수신자 이메일 주소.
- **Subject** — 보간됩니다.
- **Body** — Markdown 또는 HTML.

이메일은 프로젝트의 설정된 발신자 주소에서 전송됩니다([SMTP](/docs/emails/smtp) 참고).

## Custom Code

워크플로우의 변수와 상위 노드의 반환값에 접근할 수 있는 JavaScript 스니펫을 실행합니다.

**인자**:

- **Code** — JavaScript 본문. 마지막 표현식의 값(또는 `(async () => { ... })()`로부터 반환된 것)이 구성 요소의 반환값이 됩니다.
- **Arguments** — `args`로 전달되는 선택적 이름 붙은 값.

**출력 포트**: `success`(반환값), `error`(잡힌 예외).

사용 시점: 두 시스템 사이의 페이로드 변환, 자체 구성 요소를 가질 만큼은 아닌 작은 계산, JS 전용 로직 호출. 자체 인프라 내에서 실행되어야 하는 무거운 스크립팅은 [Runbook](/docs/runbooks/index)의 Bash 또는 JavaScript 단계에 속합니다.

## JSON

텍스트와 JSON 사이를 변환합니다.

- **JSON → Text** — JSON 객체를 문자열로 직렬화(텍스트를 기대하는 아웃바운드 구성 요소의 `body` 인자로 파이핑하기에 편리).
- **Text → JSON** — 문자열을 JSON 객체로 파싱. 상위 API가 본문을 텍스트로 반환했지만 필드를 읽어야 할 때 유용.

## 조건(Conditions)

비교에 따라 분기합니다. 다음을 설정:

- **Left value** — 일반적으로 `{{Incident.title}}` 같은 보간 참조.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — 비교할 값.

**출력 포트**: `yes`와 `no`. 의도에 맞는 분기로 나머지 워크플로우를 배선하세요.

## 스케줄(지연)

계속하기 전에 설정된 시간 동안 워크플로우를 일시 정지합니다. 외부 시스템이 상태를 확인하기 전에 안정될 시간을 줄 필요가 있을 때 유용합니다.

## Log

워크플로우 실행 로그에 한 줄을 씁니다. 순수한 디버깅 보조; 그 줄은 실행에 캡처되어 **Logs**에서 보입니다. 외부 부작용은 없습니다.

## Execute Workflow

다른 워크플로우를 서브 단계로 호출합니다. 호출된 워크플로우는 독립적으로 실행됩니다(쏘고 잊기) — 호출이 디스패치되는 즉시 호출자에게 제어가 돌아옵니다.

여러 워크플로우 사이에서 공유 로직을 인수할 때 사용합니다: "post-to-incident-channel" 워크플로우를 한 번 만들어 채널 알림이 필요한 모든 다른 워크플로우에서 호출합니다.

재귀 한도가 워크플로우가 무한 루프로 서로를 호출하지 못하게 합니다. [설정 및 보안](/docs/workflows/configuration)을 참고하세요.

## 모델 구성 요소(OneUptime 엔티티에 대한 CRUD)

워크플로우를 지원하는 모든 OneUptime 엔티티(모니터, 인시던트, 알람, 상태 페이지, 온콜 정책 등)에 대해, 팔레트는 자동으로 다음 구성 요소를 노출합니다 — 엔티티 이름으로 검색 가능:

- **Find One {Entity}** — 쿼리로 단일 레코드 조회.
- **Find {Entity}** — 쿼리로 레코드 목록 조회(페이지네이션).
- **Create {Entity}** — 새 레코드 삽입.
- **Update {Entity}** — ID로 레코드 하나 업데이트.
- **Delete {Entity}** — ID로 레코드 하나 삭제.
- **Count {Entity}** — 쿼리에 일치하는 레코드 카운트.

이것이 워크플로우가 플랫폼을 벗어나지 않고 OneUptime 상태를 읽고 쓸 수 있게 하는 방법입니다. 예를 들어: CI 도구의 웹훅이 빌드 실패 메시지로 **Create Incident**를 호출하거나, 스케줄된 워크플로우가 5분마다 **Find Incident**를 실행해 요약을 이메일로 보냅니다.

## 알맞은 구성 요소 고르기

빠른 판단 가이드:

- 원하는 일에 전용 구성 요소가 있다면(Slack, Email, OneUptime 엔티티에 대한 CRUD), 그것을 사용하세요 — 직접 만드는 것보다 더 나은 오류 처리와 명확한 로그를 제공합니다.
- 전용 구성 요소가 없는 외부 HTTP API를 호출해야 한다면 **API**를 사용하세요.
- 두 구성 요소 사이에서 데이터를 *형태화*해야 한다면 **Custom Code** 또는 **JSON**을 사용하세요.
- 값에 따라 다른 액션을 취해야 한다면 **Conditions**를 사용하세요.

## 다음으로 읽을 것

- [변수](/docs/workflows/variables) — 한 구성 요소에서 다음으로 데이터를 공급하는 방법.
- [실행 및 로그](/docs/workflows/runs-and-logs) — 실행 중 각 구성 요소가 반환한 것을 점검하는 방법.
- [설정 및 보안](/docs/workflows/configuration) — 한도, 소유권, 비밀.
