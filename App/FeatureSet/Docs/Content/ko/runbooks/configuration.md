# Runbook 설정과 안전성

## 출력 한도

- 단계별 출력: **50KB**. 더 큰 출력은 마커와 함께 잘립니다.
- 단계별 기본 타임아웃: JavaScript, Bash, HTTP 모두 **30초**. 단계별로 설정 가능.
- Bash 단계의 **Claim 타임아웃** 기본값: **2분** — Worker가 Runbook 에이전트가 작업을 가져갈 때까지 기다리는 시간. 초과 시 단계는 실패합니다.

## 권한

Runbook 권한은 `Runbook` 권한 그룹에 있습니다:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — Runbook 템플릿 관리.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — 실행 시작, 체크, 조회.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — 자동 트리거 규칙 관리.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — 자신의 인프라에서 Bash 단계를 실행하는 Runbook 에이전트 관리.
- `RunbookManager` (역할) — 위 모두를 묶음. 팀에 부여하면 Runbook 전반을 다룰 수 있습니다.

## 큐 & 워커

Runbook 실행은 BullMQ의 `Runbook` 큐에서 동작합니다. 워커 동시성은 25 — 동시 실행이 많은 배포에서는 조정하세요.

Manual 단계가 API로 체크되면 실행은 다음 단계부터 이어가도록 다시 큐에 들어갑니다. 이는 Runbook 나머지를 빠르게 처리할 수 있도록 워커를 따뜻하게 유지합니다.

## 강화 노트

- **JavaScript 단계**는 `isolated-vm`에서 샌드박스 강화 프리앰블과 함께 실행됩니다(프로토타입 체인 차단, `Function` 및 `eval` 제거, 빌트인 프로토타입 동결).
- **Bash 단계**는 OneUptime Worker에서 절대 실행되지 않습니다. 당신이 자신의 인프라에 설치한 [Runbook 에이전트](/docs/runbooks/agents)에 job으로 디스패치됩니다. Worker는 단계의 **Agent Tag**를 단 작업을 큐에 넣고, 에이전트가 원자적으로 그것을 차지해 로컬에서 `bash -c <스크립트>`를 실행한 뒤 결과를 회신합니다. Worker 프로세스 자체는 당신의 환경에 셸 접근 권한이 없습니다.
- **HTTP 단계**는 관대한 상태 검증기를 사용해 4xx/5xx 응답을 던지지 않고 실패한 단계로 기록합니다. 캡처된 출력은 상대가 실제로 반환한 내용을 그대로 반영합니다.

## 데이터베이스 테이블

- `Runbook` — 템플릿(이름, slug, 설명, isEnabled, 단계 JSON).
- `RunbookExecution` — 실행 1개당 1행. null 가능 외래키 `incidentId`, `alertId`, `scheduledMaintenanceId`와 단계 및 단계별 상태를 스냅샷하는 JSON 배열 `stepExecutions`.
- `RunbookRule` — `triggerEntityType` 구분자(Incident, Alert, ScheduledMaintenance)와 시작할 Runbook들과의 many-to-many 관계를 갖는 자동 트리거 규칙.
- `RunbookAgent` — 설치된 에이전트당 1행: 이름, 태그, 비밀 키, `lastAlive`, `connectionStatus`, 호스트 정보.
- `RunbookAgentJob` — 디스패치된 Bash 단계당 1행: 요구 태그, 스크립트, 상태(Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim 마감, 리스, 출력, 종료 코드.

## 운영 팁

- **표적으로 삼는 태그마다 최소 1개의 에이전트를 운영**하고, 고가용성을 위해 2개가 이상적입니다. 같은 태그를 가진 두 에이전트가 있으면 어느 쪽이든 작업을 차지할 수 있어 — runbook을 깨뜨리지 않고 롤링 재시작을 할 수 있습니다.
- **URL을 캡처하고 blob은 캡처하지 말 것.** 단계가 몇 KB를 초과하는 출력을 생성하면 S3나 로그 스택에 쓰고 URL을 반환하세요.
- **멱등성이 중요.** 자동 단계(HTTP, JavaScript, Bash)는 워커가 단계 중간에 재시작되거나 스크립트가 실행 중인 동안 에이전트의 lease가 만료되면 두 번 이상 실행될 수 있습니다. 재시도해도 안전하도록 설계하세요.
