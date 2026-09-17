# 리소스 작업

OneUptime CLI는 지원되는 모든 리소스에 대한 전체 CRUD (생성, 읽기, 업데이트, 삭제) 작업을 제공합니다. 리소스는 OneUptime 인스턴스에서 자동으로 검색됩니다.

## 사용 가능한 리소스

다음 명령을 실행하여 사용 가능한 모든 리소스 유형을 확인합니다:

```bash
oneuptime resources
```

유형으로 필터링할 수 있습니다:

```bash
# 데이터베이스 리소스만 표시
oneuptime resources --type database

# 분석 리소스만 표시
oneuptime resources --type analytics
```

일반적인 리소스:

| 리소스               | 명령                                    |
| -------------------- | --------------------------------------- |
| 인시던트             | `oneuptime incident`                    |
| 알림                 | `oneuptime alert`                       |
| 모니터               | `oneuptime monitor`                     |
| 모니터 상태          | `oneuptime monitor-status`              |
| 인시던트 상태        | `oneuptime incident-state`              |
| 상태 페이지          | `oneuptime status-page`                 |
| 온콜 정책            | `oneuptime on-call-policy`              |
| 팀                   | `oneuptime team`                        |
| 예정 유지보수 이벤트 | `oneuptime scheduled-maintenance-event` |

## 리소스 목록

선택적 필터링, 페이지 매김 및 정렬로 리소스 목록을 가져옵니다.

```bash
oneuptime <resource> list [options]
```

**옵션:**

| 옵션                    | 설명                  | 기본값  |
| ----------------------- | --------------------- | ------- |
| `--query <json>`        | JSON 형태의 필터 기준 | 없음    |
| `--limit <n>`           | 최대 결과 수          | `10`    |
| `--skip <n>`            | 건너뛸 결과 수        | `0`     |
| `--sort <json>`         | JSON 형태의 정렬 순서 | 없음    |
| `-o, --output <format>` | 출력 형식             | `table` |

**예시:**

```bash
# 최근 10개의 인시던트 나열
oneuptime incident list

# 상태 ID로 인시던트 필터링
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# 페이지 매김으로 나열
oneuptime incident list --limit 20 --skip 40

# 생성 날짜로 정렬 (내림차순)
oneuptime incident list --sort '{"createdAt":-1}'

# JSON으로 출력
oneuptime incident list -o json
```

## 리소스 가져오기

ID로 단일 리소스를 가져옵니다.

```bash
oneuptime <resource> get <id>
```

**인수:**

| 인수   | 설명             |
| ------ | ---------------- |
| `<id>` | 리소스 ID (UUID) |

**예시:**

```bash
# 특정 인시던트 가져오기
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# JSON으로 모니터 가져오기
oneuptime monitor get abc-123 -o json
```

## 리소스 생성

인라인 JSON 또는 파일에서 새 리소스를 생성합니다.

```bash
oneuptime <resource> create [options]
```

**옵션:**

| 옵션                    | 설명                                  |
| ----------------------- | ------------------------------------- |
| `--data <json>`         | JSON 객체 형태의 리소스 데이터        |
| `--file <path>`         | 리소스 데이터가 포함된 JSON 파일 경로 |
| `-o, --output <format>` | 출력 형식                             |

`--data` 또는 `--file` 중 하나를 반드시 제공해야 합니다.

**예시:**

```bash
# 인라인 JSON으로 인시던트 생성
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# JSON 파일에서 생성
oneuptime incident create --file incident.json

# 생성 후 ID를 캡처하기 위해 JSON으로 출력
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## 리소스 업데이트

ID로 기존 리소스를 업데이트합니다.

```bash
oneuptime <resource> update <id> [options]
```

**인수:**

| 인수   | 설명      |
| ------ | --------- |
| `<id>` | 리소스 ID |

**옵션:**

| 옵션                    | 설명                               |
| ----------------------- | ---------------------------------- |
| `--data <json>`         | JSON 형태의 업데이트할 필드 (필수) |
| `-o, --output <format>` | 출력 형식                          |

**예시:**

```bash
# 인시던트 상태 변경 (예: 해결됨으로)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# 모니터 이름 변경
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## 리소스 삭제

ID로 리소스를 삭제합니다.

```bash
oneuptime <resource> delete <id> [--force]
```

**인수:**

| 인수   | 설명      |
| ------ | --------- |
| `<id>` | 리소스 ID |

**옵션:**

| 옵션      | 설명                   |
| --------- | ---------------------- |
| `--force` | 확인 프롬프트 건너뛰기 |

**예시:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# 확인 건너뛰기
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## 리소스 카운트

선택적 필터 기준과 일치하는 리소스를 카운트합니다.

```bash
oneuptime <resource> count [options]
```

**옵션:**

| 옵션             | 설명                  |
| ---------------- | --------------------- |
| `--query <json>` | JSON 형태의 필터 기준 |

**예시:**

```bash
# 모든 인시던트 카운트
oneuptime incident count

# 상태별 인시던트 카운트
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# 모니터 카운트
oneuptime monitor count
```

## 분석 리소스

분석 리소스는 데이터베이스 리소스에 비해 제한된 작업 세트를 지원합니다:

| 작업     | 지원 여부 |
| -------- | --------- |
| `list`   | 예        |
| `create` | 예        |
| `count`  | 예        |
| `get`    | 아니요    |
| `update` | 아니요    |
| `delete` | 아니요    |

`oneuptime resources --type analytics`를 사용하여 인스턴스에서 사용 가능한 분석 리소스를 확인합니다.
