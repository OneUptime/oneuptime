# 출력 형식

OneUptime CLI는 **테이블**, **JSON**, **와이드**의 세 가지 출력 형식을 지원합니다. 어느 명령에서나 `-o` 또는 `--output` 플래그로 형식을 설정할 수 있습니다.

## 테이블 (기본값)

대화형 터미널에서 실행할 때의 기본 형식입니다. 지능적으로 선택된 열로 결과를 ASCII 테이블로 표시합니다.

```bash
oneuptime incident list
```

```
┌──────────────────┬───────────────────────┬─────────────────────┬─────────────────────┐
│ _id              │ title                 │ createdAt           │ updatedAt           │
├──────────────────┼───────────────────────┼─────────────────────┼─────────────────────┤
│ abc-123          │ API Outage            │ 2025-01-15T10:30:00 │ 2025-01-15T12:00:00 │
│ def-456          │ Database Slowdown     │ 2025-01-14T08:15:00 │ 2025-01-14T09:30:00 │
└──────────────────┴───────────────────────┴─────────────────────┴─────────────────────┘
```

테이블 형식 동작:
- `_id`, `name`, `title`, `createdAt`, `updatedAt`를 우선시하여 최대 6개의 열을 선택합니다
- 60자보다 긴 값은 `...`로 잘립니다
- 색상 코드 헤더를 사용합니다 (`--no-color`로 비활성화 가능)

## JSON

2칸 들여쓰기로 보기 좋게 출력된 원시 JSON입니다. 스크립팅 및 다른 도구로 파이핑하기에 가장 좋은 형식입니다.

```bash
oneuptime incident list -o json
```

```json
[
  {
    "_id": "abc-123",
    "title": "API Outage",
    "currentIncidentStateId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-01-15T10:30:00Z"
  }
]
```

출력이 다른 명령으로 파이핑될 때 JSON 형식이 자동으로 사용됩니다 (비-TTY 모드):

```bash
# 파이핑 시 JSON이 자동으로 사용됨
oneuptime incident list | jq '.[].title'
```

## 와이드

잘림 없이 모든 열을 표시합니다. 상세한 검사에 유용하지만 매우 넓은 출력이 생성될 수 있습니다.

```bash
oneuptime incident list -o wide
```

## 색상 비활성화

색상 출력은 여러 방법으로 비활성화할 수 있습니다:

```bash
# --no-color 플래그 사용
oneuptime --no-color incident list

# NO_COLOR 환경 변수 사용
NO_COLOR=1 oneuptime incident list
```

## 특수 출력 사례

| 시나리오 | 출력 |
|----------|--------|
| 빈 결과 집합 | `"No results found."` |
| 반환된 데이터 없음 | `"No data returned."` |
| 단일 객체 (예: `get`) | 키-값 테이블 형식 |
| `count` 명령 | 일반 숫자 값 |
