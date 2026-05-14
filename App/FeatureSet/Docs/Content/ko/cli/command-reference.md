# 명령 참조

모든 OneUptime CLI 명령에 대한 전체 참조입니다.

## 인증 명령

### `oneuptime login`

OneUptime 인스턴스에 인증합니다.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| 매개변수 | 유형 | 필수 여부 | 설명 |
|-----------|------|----------|-------------|
| `<api-key>` | 인수 | 예 | 인증을 위한 API 키 |
| `<instance-url>` | 인수 | 예 | OneUptime 인스턴스 URL |
| `--context-name` | 옵션 | 아니요 | 컨텍스트 이름 (기본값: `"default"`) |

---

### `oneuptime context list`

저장된 모든 컨텍스트를 나열합니다.

```bash
oneuptime context list
```

---

### `oneuptime context use`

명명된 컨텍스트로 전환합니다.

```bash
oneuptime context use <name>
```

| 매개변수 | 유형 | 필수 여부 | 설명 |
|-----------|------|----------|-------------|
| `<name>` | 인수 | 예 | 활성화할 컨텍스트 이름 |

---

### `oneuptime context current`

마스킹된 API 키와 함께 활성 컨텍스트를 표시합니다.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

저장된 컨텍스트를 제거합니다.

```bash
oneuptime context delete <name>
```

| 매개변수 | 유형 | 필수 여부 | 설명 |
|-----------|------|----------|-------------|
| `<name>` | 인수 | 예 | 삭제할 컨텍스트 이름 |

---

## 리소스 명령

모든 리소스 명령은 동일한 패턴을 따릅니다. `<resource>`를 지원되는 리소스 이름으로 교체합니다 (예: `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

필터링 및 페이지 매김으로 리소스를 나열합니다.

```bash
oneuptime <resource> list [options]
```

| 옵션 | 유형 | 기본값 | 설명 |
|--------|------|---------|-------------|
| `--query <json>` | 문자열 | 없음 | JSON 형태의 필터 기준 |
| `--limit <n>` | 숫자 | `10` | 최대 결과 수 |
| `--skip <n>` | 숫자 | `0` | 건너뛸 결과 수 |
| `--sort <json>` | 문자열 | 없음 | JSON 형태의 정렬 순서 |
| `-o, --output` | 문자열 | `table` | 출력 형식 |

---

### `oneuptime <resource> get`

ID로 단일 리소스를 가져옵니다.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| 매개변수 | 유형 | 필수 여부 | 설명 |
|-----------|------|----------|-------------|
| `<id>` | 인수 | 예 | 리소스 ID (UUID) |
| `-o, --output` | 옵션 | 아니요 | 출력 형식 |

---

### `oneuptime <resource> create`

새 리소스를 생성합니다.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| 옵션 | 유형 | 필수 여부 | 설명 |
|--------|------|----------|-------------|
| `--data <json>` | 문자열 | `--data` 또는 `--file` 중 하나 | JSON 형태의 리소스 데이터 |
| `--file <path>` | 문자열 | `--data` 또는 `--file` 중 하나 | JSON 파일 경로 |
| `-o, --output` | 문자열 | 아니요 | 출력 형식 |

---

### `oneuptime <resource> update`

기존 리소스를 업데이트합니다.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| 매개변수 | 유형 | 필수 여부 | 설명 |
|-----------|------|----------|-------------|
| `<id>` | 인수 | 예 | 리소스 ID |
| `--data <json>` | 옵션 | 예 | JSON 형태의 업데이트할 필드 |
| `-o, --output` | 옵션 | 아니요 | 출력 형식 |

---

### `oneuptime <resource> delete`

리소스를 삭제합니다.

```bash
oneuptime <resource> delete <id> [--force]
```

| 매개변수 | 유형 | 필수 여부 | 설명 |
|-----------|------|----------|-------------|
| `<id>` | 인수 | 예 | 리소스 ID |
| `--force` | 옵션 | 아니요 | 확인 프롬프트 건너뛰기 |

---

### `oneuptime <resource> count`

필터와 일치하는 리소스를 카운트합니다.

```bash
oneuptime <resource> count [--query <json>]
```

| 옵션 | 유형 | 기본값 | 설명 |
|--------|------|---------|-------------|
| `--query <json>` | 문자열 | 없음 | JSON 형태의 필터 기준 |

---

## 유틸리티 명령

### `oneuptime version`

CLI 버전을 표시합니다.

```bash
oneuptime version
```

---

### `oneuptime whoami`

현재 인증 세부 정보를 표시합니다.

```bash
oneuptime whoami
```

인스턴스 URL과 마스킹된 API 키를 표시합니다. 저장된 컨텍스트가 활성화된 경우 컨텍스트 이름도 표시됩니다.

---

### `oneuptime resources`

사용 가능한 모든 리소스 유형을 나열합니다.

```bash
oneuptime resources [--type <type>]
```

| 옵션 | 유형 | 기본값 | 설명 |
|--------|------|---------|-------------|
| `--type <type>` | 문자열 | 없음 | `database` 또는 `analytics`로 필터링 |

---

## 전역 옵션

이 플래그는 모든 명령에서 사용할 수 있습니다:

| 옵션 | 설명 |
|--------|-------------|
| `--api-key <key>` | API 키 재정의 |
| `--url <url>` | 인스턴스 URL 재정의 |
| `--context <name>` | 특정 컨텍스트 사용 |
| `-o, --output <format>` | 출력 형식: `json`, `table`, `wide` |
| `--no-color` | 색상 출력 비활성화 |
| `--help` | 도움말 표시 |
| `--version` | 버전 표시 |

## API 라우트

참조를 위해 CLI는 명령을 다음 API 엔드포인트에 매핑합니다:

| 명령 | 메서드 | 엔드포인트 |
|---------|--------|----------|
| `list` | POST | `/api/<resource>/get-list` |
| `get` | POST | `/api/<resource>/<id>/get-item` |
| `create` | POST | `/api/<resource>` |
| `update` | PUT | `/api/<resource>/<id>/` |
| `delete` | DELETE | `/api/<resource>/<id>/` |
| `count` | POST | `/api/<resource>/count` |

모든 요청에는 인증을 위한 `APIKey` 헤더가 포함됩니다.
