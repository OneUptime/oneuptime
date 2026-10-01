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
- **안전한 인증**: OneUptime 계정으로 로그인(OAuth 2.1)하거나, 무인으로 실행되는 에이전트의 경우 요청별 API 키 전송
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
- 로그인에 사용할 OneUptime 계정, 또는 무인으로 실행되는 에이전트용 OneUptime API 키 (인증이 필요한 작업에만 필요 - 공개 도구는 둘 다 없어도 작동)

## OneUptime 계정으로 로그인

가장 간단한 연결 방법은 MCP 클라이언트에 서버 URL만 제공하는 것입니다. 클라이언트는 사용자의 데이터가 처음 필요해질 때 브라우저에서 OneUptime 페이지를 열며, 사용자는 이 페이지에서 다음을 수행합니다:

1. 아직 로그인하지 않았다면 OneUptime에 로그인합니다
2. 클라이언트가 작업할 프로젝트를 선택합니다
3. 클라이언트에 **읽기 및 쓰기**를 허용할지, **읽기 전용**만 허용할지 선택합니다
4. **승인**을 클릭합니다

그러면 클라이언트는 해당 프로젝트에서 사용자 본인의 자격으로 동작합니다. 생성하거나 복사하거나 교체해야 할 API 키가 없으며, 구성 파일에 비밀 정보가 저장되지도 않습니다.

연결된 클라이언트가 할 수 있는 일:

- **사용자의 권한을 그대로 가지며, 그 이상은 결코 갖지 않습니다.** 프로젝트에서 소속 팀이 사용자에게 허용하는 일이 곧 클라이언트가 할 수 있는 일입니다. 역할이 바뀌거나 프로젝트에서 나가면 그 변경 사항은 클라이언트의 바로 다음 요청부터 적용됩니다.
- **읽기 전용은 말 그대로 읽기 전용입니다.** 읽기 전용으로 승인된 클라이언트는 `get_`, `list_`, `count_` 도구를 사용할 수 있습니다. 생성, 업데이트, 삭제, 확인(acknowledge) 또는 해결을 수행하는 도구는 MCP 서버에서도, 그 뒤에 있는 OneUptime API에서도 거부됩니다. 클라이언트가 요청한 것보다 더 많은 액세스 권한을 부여할 수는 결코 없습니다.
- **하나의 프로젝트에만 적용됩니다.** 다른 프로젝트를 사용하려면 클라이언트를 다시 연결하고 해당 프로젝트를 선택하세요.
- **MCP 서버를 통해서만 작동합니다.** 클라이언트의 액세스 토큰은 MCP 엔드포인트에서만 허용되며 다른 어디에서도 허용되지 않습니다. OneUptime REST API를 직접 호출하는 데에는 사용할 수 없습니다.
- **인스턴스 관리자도 특별 대우를 받지 않습니다.** 마스터 관리자가 연결한 클라이언트는 해당 프로젝트에서 그 사람의 팀이 부여한 권한만 가지며, 인스턴스 전체에 대한 액세스 권한은 갖지 않습니다.

### 연결된 클라이언트 관리

로그인으로 연결된 모든 클라이언트는 **프로젝트 설정** → **MCP 서버** → **Connected MCP Clients**(연결된 MCP 클라이언트)에 나열되며, 누가 연결했는지, 무엇을 할 수 있는지, 마지막으로 사용된 시점이 함께 표시됩니다. 사용자는 자신이 연결한 클라이언트를 볼 수 있고, 프로젝트 소유자와 관리자는 모든 사람의 클라이언트를 볼 수 있습니다.

클라이언트를 로그아웃시키려면 **Disconnect**(연결 해제)를 클릭합니다. 클라이언트는 즉시 작동을 멈춥니다.

클라이언트는 사용되는 동안 계속 연결된 상태로 유지됩니다. 30일 동안 사용되지 않은 클라이언트는 다시 로그인해야 합니다.

### 클라이언트를 연결할 수 있는 사용자 제어

기본적으로 모든 프로젝트 구성원이 MCP 클라이언트를 연결할 수 있습니다. 특정 팀의 구성원이 클라이언트를 연결하지 못하게 하려면 해당 팀을 열고 **권한 차단**으로 이동한 다음 **Authorize MCP Client**(MCP 클라이언트 승인) 권한을 추가합니다. 해당 구성원들이 이미 연결한 클라이언트는 즉시 작동을 멈춥니다.

프로젝트가 싱글 사인온(SSO)을 요구하는 경우, 클라이언트를 승인하기 전에 브라우저에서 SSO로 프로젝트에 로그인하세요. 클라이언트의 연결은 해당 SSO 로그인이 유지되는 동안에만 지속됩니다. SSO 로그인이 만료되면 클라이언트를 다시 연결하세요.

OneUptime 클라우드에서는 API 키와 동일한 요금제(Growth 이상)에서 MCP 클라이언트 연결을 사용할 수 있습니다.

Enterprise Edition에서는 연결된 클라이언트가 수행한 모든 변경 사항이 해당 클라이언트를 연결한 사람의 이름으로, 클라이언트 이름과 함께 감사 로그에 기록됩니다. API 키로 수행한 변경 사항에는 키 이름이 표시됩니다.

## API 키 발급

예약된 작업이나 CI 파이프라인처럼 로그인할 사람이 없는 상태에서 무인으로 실행되는 에이전트에는 API 키를 사용하세요.

1. OneUptime 인스턴스에 로그인합니다
2. **프로젝트 설정** → **API 키**로 이동합니다
3. **API 키 생성**을 클릭합니다
4. 이름을 제공합니다 (예: "MCP 서버")
5. 사용 사례에 적합한 권한을 선택합니다
6. 생성된 API 키를 복사합니다

API 키는 프로젝트 범위로 발급됩니다. MCP 서버가 키로부터 프로젝트를 추론하므로 생성 도구에 `projectId` 인수를 전달할 필요가 전혀 없습니다.

> **경고 — AI 에이전트에 마스터 키를 절대 제공하지 마세요.** OneUptime *마스터* API 키도 이 헤더로 허용되며 인스턴스 전체에 대한 관리자 액세스를 부여합니다. 항상 에이전트에게 필요한 최소 권한의 프로젝트 API 키를 사용하세요 (모든 `get_`/`list_`/`count_` 도구에는 읽기 전용 키로 충분합니다).

## 구성

### 로그인으로 연결

자격 증명 없이 서버 URL만 클라이언트에 추가합니다. 자체 호스팅 인스턴스의 경우 `https://your-oneuptime-domain.com/mcp`를 사용합니다.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

그런 다음 Claude Code 안에서 `/mcp`를 실행하고 **oneuptime**을 선택하여 로그인합니다.

**Claude (웹 및 데스크톱)**

**Customize** → **Connectors**를 열고 **Add custom connector**를 선택한 다음 `https://oneuptime.com/mcp`를 입력합니다. Claude는 사용자의 데이터가 처음 필요해질 때 OneUptime에 로그인하라고 요청합니다.

**GitHub Copilot이 있는 VS Code**

다음을 MCP 구성에 추가합니다 (해당 파일의 위치는 [GitHub Copilot이 있는 VS Code](#github-copilot이-있는-vs-code) 참고). 서버를 시작하면 VS Code가 로그인할 수 있도록 OneUptime을 엽니다:

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

**Cursor**

```json
{
  "mcpServers": {
    "oneuptime": {
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

MCP 인가(authorization)를 지원하는 다른 모든 클라이언트도 같은 방식으로 작동합니다. URL만 제공하면 나머지는 클라이언트가 스스로 찾아냅니다. 프로토콜에 대한 자세한 내용은 [로그인 (OAuth 2.1)](#로그인-oauth-21)을 참고하세요.

이 섹션의 나머지 부분에서는 동일한 클라이언트를 로그인 대신 API 키로 구성하는 방법을 보여 줍니다.

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

로그인하는 MCP 클라이언트는 아래의 OAuth 엔드포인트도 사용합니다. 클라이언트가 이 엔드포인트들을 스스로 찾아내므로, 여기에는 클라이언트를 작성하거나 프록시를 구성하는 사람을 위해 나열해 둡니다.

| 엔드포인트                                    | 메서드 | 설명 |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | 보호된 리소스 메타데이터 (RFC 9728). `/.well-known/oauth-protected-resource/mcp`에서도 제공 |
| `/.well-known/oauth-authorization-server/mcp` | GET    | 인가 서버 메타데이터 (RFC 8414). `/mcp/.well-known/oauth-authorization-server`에서도 제공 |
| `/mcp/oauth/authorize`                        | GET    | 인가 엔드포인트: 클라이언트가 로그인을 위해 브라우저를 보내는 곳 |
| `/mcp/oauth/token`                            | POST   | 토큰 엔드포인트: 인가 코드 또는 리프레시 토큰을 교환 |
| `/mcp/oauth/register`                         | POST   | 동적 클라이언트 등록 (RFC 7591) |
| `/mcp/oauth/revoke`                           | POST   | 토큰 폐기 (RFC 7009) |

## 인증

MCP 서버는 세 가지 운영 모드를 지원합니다:

### 공개 도구 (인증 불필요)

API 키 없이 MCP 서버에 연결하여 공개 도구에 액세스할 수 있습니다:

- **`oneuptime_help`**: OneUptime MCP 기능에 대한 도움말 및 안내 얻기
- **`oneuptime_list_resources`**: 사용 가능한 리소스 및 작업 나열
- **`get_public_status_page_overview`**: 공개 상태 페이지 개요 가져오기
- **`get_public_status_page_incidents`**: 공개 상태 페이지의 인시던트 가져오기
- **`get_public_status_page_scheduled_maintenance`**: 예정된 유지보수 이벤트 가져오기
- **`get_public_status_page_announcements`**: 공개 상태 페이지의 공지 가져오기

공개 상태 페이지 도구는 상태 페이지 ID(UUID) 또는 상태 페이지 도메인 이름을 허용합니다.

### 로그인 (OAuth 2.1)

다른 모든 작업(모니터, 인시던트, 팀 관리 등)의 경우 호출자가 누구인지 식별되어야 합니다. 자격 증명을 보내지 않고 이러한 도구 중 하나를 호출하는 클라이언트는 `401 Unauthorized` 응답과 함께, 서버의 보호된 리소스 메타데이터를 가리키는 `WWW-Authenticate` 헤더를 받습니다. 이것이 MCP 클라이언트가 사용자를 로그인시키기 위해 반응하는 신호입니다. `initialize`, `tools/list` 및 공개 도구는 결코 로그인을 요구하지 않습니다.

서버는 [MCP 인가 사양](https://modelcontextprotocol.io/specification/latest/basic/authorization)을 구현합니다:

- **흐름**: PKCE(`S256`만 지원)를 사용하는 OAuth 2.1 인가 코드 방식. 액세스 토큰은 `Authorization: Bearer`로 전송됩니다.
- **디스커버리**: 보호된 리소스 메타데이터(RFC 9728) 및 인가 서버 메타데이터(RFC 8414). 발급자(issuer)와 리소스는 모두 `https://<host>/mcp`입니다.
- **클라이언트 신원**: Client ID Metadata Document(클라이언트 ID가 서버가 가져오는 `https` URL임) 또는 동적 클라이언트 등록(Dynamic Client Registration, RFC 7591). 어떤 클라이언트도 관리자가 등록할 필요가 없습니다.
- **스코프**: `mcp:read`는 `get_`, `list_`, `count_` 도구를 위한 스코프입니다. `mcp:write`는 무언가를 변경하는 모든 도구를 추가하며 `mcp:read`를 포함합니다. 읽기 전용 토큰으로 쓰기 도구를 호출하면 `403`과 `error="insufficient_scope"`가 응답으로 반환됩니다.
- **토큰 수명**: 액세스 토큰은 1시간 동안 유효합니다. 리프레시 토큰은 30일 동안 유효하며 사용할 때마다 교체됩니다. 이미 교체된 리프레시 토큰을 사용하면 연결이 종료됩니다.
- **리소스 표시자** (RFC 8707): 토큰은 `https://<host>/mcp`를 대상으로 발급되며 다른 어디에서도 허용되지 않습니다.
- **폐기** (RFC 7009): 두 토큰 중 어느 것이든 폐기하면 연결이 종료됩니다.

### API 키

무인으로 실행되는 에이전트는 다음 헤더 중 하나에 OneUptime API 키를 담아 인증합니다:

- `x-api-key`: OneUptime API 키
- `Authorization`: API 키가 포함된 Bearer 토큰 (예: `Bearer your-api-key-here`)

`Bearer` 스킴은 대소문자를 구분하지 않습니다. API 키가 포함된 요청에는 결코 로그인을 요구하지 않습니다.

도구 오류는 MCP 프로토콜 오류가 아니라 `statusCode`, 세부 정보 및 제안이 포함된 인밴드 도구 결과(`isError: true`)로 반환되므로, 에이전트가 실패 내용을 읽고 스스로 수정할 수 있습니다.

## 워크플로 도구

리소스별 CRUD 도구 외에도, 서버는 인시던트 및 알림 대응을 위해 특별히 설계된 워크플로 도구를 제공합니다:

- **`acknowledge_incident`** / **`resolve_incident`**: 인시던트를 프로젝트의 확인됨(Acknowledged) 또는 해결됨(Resolved) 상태로 이동 — 대시보드에서 버튼을 누르는 것과 동일합니다
- **`acknowledge_alert`** / **`resolve_alert`**: 알림에 대한 동일한 작업
- **`add_incident_note`**: `visibility: "internal"`(팀 전용, 기본값) 또는 `visibility: "public"`(상태 페이지에 게시)로 인시던트에 노트 추가. Markdown이 지원됩니다
- **`add_alert_note`**: 알림에 내부 노트 추가

일반적인 흐름: `list_incidents` → `acknowledge_incident` → `list_logs`로 조사 → `add_incident_note` (공개) → `resolve_incident`.

## 내 정보 확인 (Who Am I)

**`oneuptime_whoami`** 도구는 자격 증명이 속한 프로젝트(ID 및 이름)를 반환합니다. 로그인한 클라이언트의 경우 누구로 로그인되어 있는지와 변경 작업을 수행할 수 있는지도 함께 반환합니다. 에이전트가 자신의 상황을 파악하기 위한 유용한 첫 번째 호출이며, 생성 도구는 자격 증명으로부터 `projectId`를 추론하므로 에이전트가 프로젝트 ID를 전달할 필요가 전혀 없습니다.

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

## 자체 호스팅 구성

자체 호스팅 인스턴스에서 로그인은 별도 설정 없이 바로 작동합니다. 다음 두 가지 설정을 사용할 수 있습니다:

| 환경 변수 | Helm 값 | 역할 |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | `true`로 설정하면 로그인이 꺼집니다. OAuth 엔드포인트가 더 이상 제공되지 않으며 MCP 서버는 API 키만 허용합니다. 아무것도 삭제되지 않으며, 설정을 되돌리면 연결된 클라이언트가 다시 작동합니다. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | 인터넷에 연결할 수 없는 인스턴스에서 `true`로 설정합니다. 클라이언트는 OneUptime이 가져오는 URL로 자신을 식별할 수 있는데, 이 값을 설정하면 클라이언트가 그 대신 인스턴스에 직접 등록하므로 아웃바운드 요청이 필요하지 않습니다. |

OneUptime 앞에 자체 리버스 프록시를 운영하는 경우, `/mcp`와 함께 `/.well-known/oauth-protected-resource` 및 `/.well-known/oauth-authorization-server`(그리고 그 아래의 모든 경로)를 OneUptime으로 전달하세요. 번들로 제공되는 인그레스는 이미 그렇게 합니다.

서버는 모든 OAuth URL을 `HOST` 및 `HTTP_PROTOCOL` 설정으로부터 만들므로, 이 설정들은 사람들이 인스턴스에 접속할 때 사용하는 주소와 일치해야 합니다.

## 문제 해결

### 로그인 문제

- **클라이언트가 로그인하라고 전혀 요청하지 않습니다**: 클라이언트가 MCP 인가를 지원하지 않거나, 우선 적용되는 API 키 헤더와 함께 구성되어 있을 수 있습니다. 로그인을 사용하려면 해당 헤더를 제거하세요.
- **승인 페이지에서 내 프로젝트가 회색으로 비활성화되어 있습니다**: 페이지의 프로젝트 이름 옆에 이유가 표시됩니다. 프로젝트의 요금제에 MCP 클라이언트 연결이 포함되어 있지 않거나, 프로젝트가 SSO를 요구하는데 이 브라우저에서 SSO로 해당 프로젝트에 로그인하지 않았거나, 소속 팀이 클라이언트를 연결하지 못하도록 차단된 경우입니다.
- **도구가 "read-only" 메시지와 함께 거부됩니다**: 클라이언트가 읽기 전용으로 승인되었습니다. 클라이언트를 다시 연결하고 **읽기 및 쓰기**를 선택하세요.
- **클라이언트가 작동을 멈췄습니다**: 연결이 해제되었거나, 30일 동안 사용되지 않았거나, 사용자가 프로젝트에서 제거되었거나, 프로젝트의 SSO 로그인이 만료된 경우입니다. 클라이언트를 다시 연결하세요.
- **자체 호스팅 - 클라이언트가 인가 서버를 찾을 수 없다고 보고합니다**: `HOST` 및 `HTTP_PROTOCOL`이 공개 주소와 일치하는지, 그리고 프록시가 `/.well-known/oauth-*` 경로를 전달하는지 확인하세요.

### 권한 오류

API 키에, 또는 로그인한 클라이언트의 경우 본인 계정에 필요한 권한이 있는지 확인합니다:

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
