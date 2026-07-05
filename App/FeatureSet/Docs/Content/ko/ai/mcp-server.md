# MCP 서버

OneUptime 모델 컨텍스트 프로토콜(MCP) 서버는 LLM에 OneUptime 인스턴스에 대한 직접 액세스를 제공하여 AI 기반 모니터링, 인시던트 관리 및 관측 가능성 작업을 가능하게 합니다.

## OneUptime MCP 서버란?

OneUptime MCP 서버는 대형 언어 모델(LLM)과 OneUptime 인스턴스 사이의 브릿지입니다. 모델 컨텍스트 프로토콜(MCP)을 구현하여 Claude와 같은 AI 어시스턴트가 모니터링 인프라와 직접 상호 작용할 수 있도록 합니다.

## 작동 방식

MCP 서버는 OneUptime 인스턴스와 함께 호스팅되며 Streamable HTTP 전송을 통해 액세스할 수 있습니다. 로컬 설치가 필요하지 않습니다.

**클라우드 사용자**: `https://oneuptime.com/mcp`
**자체 호스팅 사용자**: `https://your-oneuptime-domain.com/mcp`

## 주요 기능

- **약 155개의 도구**: 22가지 리소스 유형(인시던트, 알림, 모니터, 상태 페이지, 온콜 등)에 대한 완전한 CRUD 도구, 읽기 전용 텔레메트리 도구, 그리고 워크플로 및 헬퍼 도구
- **실시간 작업**: 실시간으로 리소스 생성, 읽기, 업데이트, 삭제
- **타입 안전 인터페이스**: 포괄적인 입력 유효성 검사를 통해 완전히 타입 지정됨
- **안전한 인증**: 적절한 오류 처리가 포함된 요청별 API 키 인증
- **안전성 주석**: 읽기 전용 도구에는 `readOnlyHint`가, 삭제 도구에는 `destructiveHint`가 부여되어 MCP 클라이언트가 안전한 호출은 자동 승인하고 파괴적인 호출은 사전에 확인을 요청할 수 있습니다
- **간편한 통합**: Claude Desktop 및 기타 MCP 호환 클라이언트와 연동
- **설계상 무상태(Stateless)**: 세션 ID가 없음 — 모든 요청이 자체 완결적이므로 로드 밸런서 및 다중 레플리카 배포 환경에서도 서버가 정상 작동합니다

## 할 수 있는 작업

OneUptime MCP 서버를 통해 AI 어시스턴트가 다음을 도울 수 있습니다:

- **모니터 관리**: 모니터 생성 및 구성, 상태 확인, 상태 이력 검토
- **인시던트 대응**: 인시던트 생성, 확인(acknowledge) 및 해결, 내부 또는 공개 노트 추가, 해결 추적
- **팀 운영**: 팀 및 온콜 정책 관리
- **상태 페이지**: 상태 페이지 관리 및 공지 생성
- **알림**: 알림 확인 및 해결, 알림 노트 추가, 알림 상태 및 심각도 관리
- **예정된 유지보수**: 예정된 유지보수 이벤트 생성 및 관리
- **텔레메트리**: 로그, 메트릭, 트레이스, 예외 및 모니터 로그 쿼리 (읽기 전용)

## 요구 사항

- OneUptime 인스턴스 (클라우드 또는 자체 호스팅)
- MCP 호환 클라이언트 (Claude Desktop, GitHub Copilot이 있는 VS Code 등)
- 유효한 OneUptime API 키 (인증이 필요한 작업에만 필요 - 공개 도구는 없이도 작동)

## API 키 발급

1. OneUptime 인스턴스에 로그인합니다
2. **설정** → **API 키**로 이동합니다
3. **API 키 생성**을 클릭합니다
4. 이름을 제공합니다 (예: "MCP 서버")
5. 사용 사례에 적합한 권한을 선택합니다
6. 생성된 API 키를 복사합니다

API 키는 프로젝트 범위로 발급됩니다. MCP 서버가 키로부터 프로젝트를 추론하므로 생성 도구에 `projectId` 인수를 전달할 필요가 전혀 없습니다.

> **경고 — AI 에이전트에 마스터 키를 절대 제공하지 마세요.** OneUptime *마스터* API 키도 이 헤더로 허용되며 인스턴스 전체에 대한 관리자 액세스를 부여합니다. 항상 에이전트에게 필요한 최소 권한의 프로젝트 API 키를 사용하세요 (모든 `get_`/`list_`/`count_` 도구에는 읽기 전용 키로 충분합니다).

## 구성

### Claude Desktop 구성

Claude Desktop 구성 파일을 찾습니다:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### OneUptime 클라우드의 경우

다음 구성을 추가합니다:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### 자체 호스팅 OneUptime의 경우

`oneuptime.com`을 OneUptime 도메인으로 교체합니다:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### 공개 액세스 (API 키 없음)

공개 도구만 사용하려면 (상태 페이지 정보, 도움말) API 키 없이 연결할 수 있습니다:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

이 구성은 인증 없이 공개 상태 페이지 도구 및 도움말 리소스에 대한 액세스를 허용합니다.

### GitHub Copilot이 있는 VS Code

VS Code는 GitHub Copilot (버전 1.99+)을 통해 MCP 서버를 기본적으로 지원합니다. 이를 통해 Copilot이 OneUptime 데이터에 직접 액세스할 수 있습니다.

#### 1단계: 요구 사항

- VS Code 버전 1.99 이상
- GitHub Copilot 확장 프로그램 설치 및 활성화
- GitHub Copilot Chat 활성화

#### 2단계: MCP 구성 열기

1. `Ctrl+Shift+P` (Windows/Linux) 또는 `Cmd+Shift+P` (macOS)를 누릅니다
2. "MCP: Open User Configuration"을 입력하고 Enter를 누릅니다
3. `mcp.json` 구성 파일이 열리거나 생성됩니다

또는 프로젝트별 구성을 위해 작업 공간에 `.vscode/mcp.json`을 생성할 수 있습니다.

#### OneUptime 클라우드의 경우

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### 자체 호스팅 OneUptime의 경우

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### 3단계: MCP 서버 시작

1. `Ctrl+Shift+P` / `Cmd+Shift+P`를 누릅니다
2. "MCP: List Servers"를 입력하여 사용 가능한 서버를 확인합니다
3. "oneuptime"을 클릭하여 서버를 시작합니다
4. 메시지가 표시되면 OneUptime API 키를 입력합니다

#### 4단계: Copilot Chat과 함께 사용

GitHub Copilot Chat을 열고 에이전트 모드를 사용합니다 (`@workspace` 또는 직접 질문):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### 보안 참고사항

위의 구성은 API 키를 일반 텍스트로 저장하는 대신 안전하게 요청하기 위해 `"password": true`가 있는 입력 변수를 사용합니다. VS Code는 처음으로 MCP 서버를 시작할 때 신뢰를 확인하라는 메시지를 표시합니다.

## 사용 가능한 엔드포인트

| 엔드포인트    | 메서드 | 설명                                                                                                                             |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | 도구 호출 및 기타 작업을 위한 JSON-RPC 요청                                                                                       |
| `/mcp`        | GET    | SSE `Accept` 헤더가 없는 경우: 친절한 JSON 디스커버리 페이로드. 있는 경우: `405` — 무상태 서버는 독립적인 SSE 스트림을 제공하지 않습니다 (규격을 준수하는 클라이언트는 이 스트림 없이 계속 진행합니다) |
| `/mcp`        | DELETE | 아무 동작도 하지 않음 (서버가 무상태이므로 종료할 세션이 없습니다)                                                                  |
| `/mcp/health` | GET    | 상태 확인 엔드포인트                                                                                                              |
| `/mcp/tools`  | GET    | 사용 가능한 도구를 나열하는 REST API                                                                                              |

## 인증

MCP 서버는 두 가지 운영 모드를 지원합니다:

### 공개 도구 (인증 불필요)

API 키 없이 MCP 서버에 연결하여 공개 도구에 액세스할 수 있습니다:

- **`oneuptime_help`**: OneUptime MCP 기능에 대한 도움말 및 안내 얻기
- **`oneuptime_list_resources`**: 사용 가능한 리소스 및 작업 나열
- **`get_public_status_page_overview`**: 공개 상태 페이지 개요 가져오기
- **`get_public_status_page_incidents`**: 공개 상태 페이지의 인시던트 가져오기
- **`get_public_status_page_scheduled_maintenance`**: 예정된 유지보수 이벤트 가져오기
- **`get_public_status_page_announcements`**: 공개 상태 페이지의 공지 가져오기

공개 상태 페이지 도구는 상태 페이지 ID(UUID) 또는 상태 페이지 도메인 이름을 허용합니다.

### 인증된 도구 (API 키 필요)

다른 모든 작업(모니터, 인시던트, 팀 관리 등)의 경우 다음 헤더 중 하나를 통해 인증이 필요합니다:

- `x-api-key`: OneUptime API 키
- `Authorization`: API 키가 포함된 Bearer 토큰 (예: `Bearer your-api-key-here`)

`Bearer` 스킴은 대소문자를 구분하지 않습니다. 도구 오류는 MCP 프로토콜 오류가 아니라 `statusCode`, 세부 정보 및 제안이 포함된 인밴드 도구 결과(`isError: true`)로 반환되므로, 에이전트가 실패 내용을 읽고 스스로 수정할 수 있습니다.

## 워크플로 도구

리소스별 CRUD 도구 외에도, 서버는 인시던트 및 알림 대응을 위해 특별히 설계된 워크플로 도구를 제공합니다:

- **`acknowledge_incident`** / **`resolve_incident`**: 인시던트를 프로젝트의 확인됨(Acknowledged) 또는 해결됨(Resolved) 상태로 이동 — 대시보드에서 버튼을 누르는 것과 동일합니다
- **`acknowledge_alert`** / **`resolve_alert`**: 알림에 대한 동일한 작업
- **`add_incident_note`**: `visibility: "internal"`(팀 전용, 기본값) 또는 `visibility: "public"`(상태 페이지에 게시)로 인시던트에 노트 추가. Markdown이 지원됩니다
- **`add_alert_note`**: 알림에 내부 노트 추가

일반적인 흐름: `list_incidents` → `acknowledge_incident` → `list_logs`로 조사 → `add_incident_note` (공개) → `resolve_incident`.

## 내 정보 확인 (Who Am I)

**`oneuptime_whoami`** 도구는 API 키가 속한 프로젝트(ID 및 이름)를 반환합니다. 에이전트가 자신의 상황을 파악하기 위한 유용한 첫 번째 호출이며, 생성 도구는 API 키로부터 `projectId`를 추론하므로 에이전트가 프로젝트 ID를 전달할 필요가 전혀 없습니다.

## 텔레메트리 쿼리

로그, 메트릭, 트레이스(스팬), 예외 및 모니터 로그는 읽기 전용 `list_` 및 `count_` 도구(`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` 및 해당하는 `count_` 도구)로 제공됩니다. 텔레메트리는 OpenTelemetry를 통해 수집되므로 생성 도구가 없습니다.

텔레메트리는 항상 시간 범위 필터와 함께 쿼리하세요. 쿼리 필드는 직접 값 또는 연산자 객체를 허용합니다:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

지원되는 연산자: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. 정렬 값은 `"ASC"` 또는 `"DESC"`입니다.

## 필드 선택 및 페이지네이션

`get_` 및 `list_` 도구는 선택적으로 필드 이름의 `select` 배열을 허용합니다. 기본적으로 무거운 필드(JSON, 매우 긴 텍스트 및 HTML 컬럼)를 제외한 모든 읽기 가능한 필드가 반환되며, 무거운 필드는 `select`에서 명시적으로 요청해야 합니다.

목록 도구는 `limit`(기본값 10, 최대 100) 및 `skip`으로 페이지네이션하며, 모든 목록 응답은 반환된 내용을 정확히 보고합니다:

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## 검증

MCP 서버가 실행 중인지 확인합니다:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

사용 가능한 도구를 나열합니다:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## 사용 예시

### 기본 정보 쿼리

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### 모니터 관리

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### 인시던트 관리

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### 팀 및 온콜

```
"List the teams in this project"
"Show me our on-call policies"
```

### 상태 페이지 관리

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### 공개 상태 페이지 쿼리 (API 키 불필요)

이 쿼리는 공개 상태 페이지 도구만 사용하여 인증 없이 작동합니다:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### 고급 작업

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API 키 권한

### 읽기 전용 액세스

데이터만 조회하려면 API 키에 읽기 권한을 추가합니다.

### 전체 액세스

리소스를 생성, 업데이트, 삭제하기 위한 전체 액세스를 위해서는 API 키에 프로젝트 관리자 권한이 있는지 확인합니다.

### 모범 사례

- 특정 권한 사용: 필요한 최소한의 권한만 부여합니다
- API 키 교체: API 키를 정기적으로 교체합니다
- 사용량 모니터링: OneUptime에서 API 키 사용량을 추적합니다
- 키 분리: 다른 환경에는 다른 API 키를 사용합니다

## 문제 해결

### 권한 오류

API 키에 필요한 권한이 있는지 확인합니다:

- 리소스 나열에 대한 읽기 액세스
- 리소스 생성/업데이트에 대한 쓰기 액세스
- 리소스를 제거하려면 삭제 액세스

### 연결 문제

1. OneUptime URL이 올바른지 확인합니다
2. API 키가 유효한지 확인합니다
3. OneUptime 인스턴스에 액세스할 수 있는지 확인합니다
4. 상태 확인 엔드포인트를 테스트합니다

### 잘못된 API 키

- OneUptime 설정에서 API 키를 확인합니다
- 추가 공백이나 문자가 있는지 확인합니다
- 키가 만료되지 않았는지 확인합니다

### 세션 오류

세션 관련 오류가 발생하는 경우:

- MCP 서버는 무상태입니다 — 세션 ID를 발급하거나 추적하지 않으므로 모든 요청이 어떤 서버 레플리카에서도 작동합니다
- 이전 서버 버전의 `mcp-session-id` 헤더를 전송하는 클라이언트는 해당 헤더를 생략하면 됩니다. 이 헤더는 무시됩니다
- 서버가 세션 ID를 반환할 것으로 기대하는 오래된 MCP 클라이언트 구성을 업데이트하세요

## 사용 가능한 리소스

MCP 서버는 다음 리소스에 대한 도구를 제공합니다:

**모니터링**: Monitor, Monitor Status, Monitor Status Event
**인시던트**: Incident, Incident State, Incident Severity, Incident State Timeline, Incident Public Note, Incident Internal Note
**알림**: Alert, Alert State, Alert Severity, Alert State Timeline, Alert Internal Note
**상태 페이지**: Status Page, Status Page Announcement
**예정된 유지보수**: Scheduled Maintenance Event, Scheduled Maintenance State, Scheduled Maintenance State Timeline
**팀 및 온콜**: Team, On-Call Policy
**레이블**: Label
**텔레메트리 (읽기 전용)**: Log, Metric, Span, Exception Instance, Monitor Log

각 데이터베이스 리소스는 snake_case 도구를 통해 생성, 조회, 목록 조회, 업데이트, 삭제 및 카운트를 지원합니다 — 예: `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. 텔레메트리 리소스는 `list_` 및 `count_` 도구만 제공합니다 (예: `list_logs`, `count_spans`).
