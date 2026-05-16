# 인증

OneUptime CLI는 OneUptime 인스턴스와 인증하는 여러 가지 방법을 지원합니다. 명명된 컨텍스트, 환경 변수를 사용하거나 자격 증명을 플래그로 직접 전달할 수 있습니다.

## 로그인

API 키를 사용하여 OneUptime 인스턴스에 인증합니다:

```bash
oneuptime login <api-key> <instance-url>
```

**인수:**

| 인수 | 설명 |
|----------|-------------|
| `<api-key>` | OneUptime API 키 (예: `sk-your-api-key`) |
| `<instance-url>` | OneUptime 인스턴스 URL (예: `https://oneuptime.com`) |

**옵션:**

| 옵션 | 설명 |
|--------|-------------|
| `--context-name <name>` | 이 컨텍스트의 이름 (기본값: `"default"`) |

**예시:**

```bash
# 기본 컨텍스트로 로그인
oneuptime login sk-abc123 https://oneuptime.com

# 명명된 컨텍스트로 로그인
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# 여러 환경 설정
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## 컨텍스트

컨텍스트를 사용하면 여러 OneUptime 환경(예: 프로덕션, 스테이징, 개발) 간에 저장하고 전환할 수 있습니다.

### 컨텍스트 목록

```bash
oneuptime context list
```

구성된 모든 컨텍스트를 표시합니다. 현재 컨텍스트는 `*`로 표시됩니다.

### 컨텍스트 전환

```bash
oneuptime context use <name>
```

이후 모든 명령에 대해 다른 명명된 컨텍스트로 전환합니다.

```bash
# 스테이징으로 전환
oneuptime context use staging

# 프로덕션으로 전환
oneuptime context use production
```

### 현재 컨텍스트 보기

```bash
oneuptime context current
```

인스턴스 URL과 마스킹된 API 키를 포함하여 현재 활성 컨텍스트를 표시합니다.

### 컨텍스트 삭제

```bash
oneuptime context delete <name>
```

명명된 컨텍스트를 제거합니다. 삭제된 컨텍스트가 현재 컨텍스트인 경우 CLI는 자동으로 남은 첫 번째 컨텍스트로 전환합니다.

## 자격 증명 해결

자격 증명은 다음 우선 순위로 해결됩니다:

1. **CLI 플래그** (`--api-key` 및 `--url`)
2. **환경 변수** (`ONEUPTIME_API_KEY` 및 `ONEUPTIME_URL`)
3. **명명된 컨텍스트** (`--context` 플래그를 통해)
4. **현재 컨텍스트** (저장된 구성에서)

소스를 혼합할 수 있습니다 -- 예를 들어 API 키에는 환경 변수를 사용하고 URL에는 저장된 컨텍스트를 사용합니다.

### CLI 플래그 사용

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### 환경 변수 사용

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### 특정 컨텍스트 사용

```bash
oneuptime --context production incident list
```

## 인증 확인

현재 인증 상태를 확인합니다:

```bash
oneuptime whoami
```

다음을 표시합니다:
- 인스턴스 URL
- 마스킹된 API 키
- 현재 컨텍스트 이름 (저장된 컨텍스트가 활성화된 경우에만 표시)

인증되지 않은 경우 명령은 `oneuptime login`을 실행하도록 제안하는 도움말 메시지를 표시합니다.

## 구성 파일

자격 증명은 제한된 권한(`0600`)으로 `~/.oneuptime/config.json`에 저장됩니다.

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
