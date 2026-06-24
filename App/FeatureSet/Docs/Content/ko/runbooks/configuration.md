# Runbook 설정과 안전성

## Bash와 JavaScript가 실제로 어떻게 실행되는가

Bash와 JavaScript 단계는 **OneUptime 워커에서 절대 실행되지 않습니다**. 이들은 특정 [Runbook 에이전트](/docs/runbooks/agents) — 자체 인프라 내부 호스트에 설치하는 작은 프로세스 — 에 작업으로 디스패치됩니다.

디스패치 모델:

1. Runbook 단계 작성자가 단계를 쓸 때 드롭다운에서 Runbook 에이전트를 선택합니다.
2. 단계가 실행되면 워커가 `RunbookAgentJob`에 `targetAgentId`를 그 에이전트의 ID로, 상태를 `Pending`으로 설정한 행을 삽입합니다.
3. 그 특정 에이전트(그 에이전트만)가 작업을 원자적으로 가져가, 스크립트를 로컬에서 실행 — Bash는 `bash -c <script>`, JavaScript는 `isolated-vm` 샌드박스 — 결과를 다시 게시합니다.
4. 워커는 그 결과로 Runbook을 이어갑니다.

이제 `RUNBOOK_BASH_ENABLED` 환경 변수 플래그는 없습니다. 배포에서 Bash나 JavaScript 단계가 동작하는지는 전적으로 프로젝트에 적어도 하나의 연결된 Runbook 에이전트가 있는지에 달려 있습니다.

## 출력 한도와 타임아웃

- 단계별 출력: **50&nbsp;KB**. 더 큰 출력은 마커와 함께 잘립니다.
- 단계별 실행 타임아웃 기본값: JavaScript, Bash, HTTP 모두 **30초**. 단계별 설정 가능.
- Bash와 JavaScript 단계의 **클레임 타임아웃**: **2분** — 워커가 실패 처리하기 전 선택된 에이전트가 작업을 가져가기까지 기다리는 시간.

## 권한

Runbook 권한은 `Runbook` 권한 그룹에 있습니다:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — Runbook 템플릿 관리.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — 실행 시작, 체크, 조회.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — 자동 트리거 규칙 관리.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — 자체 인프라에서 Bash와 JavaScript 단계를 실행하는 Runbook 에이전트 관리.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer`(역할) — 팀에 할당하여 각각 전체 제어, 일상 사용, 읽기 전용 접근 부여. `RunbookAdmin`은 위의 세분 권한을 모두 묶은 것.

## 큐 & 워커

Runbook 실행은 `Runbook` BullMQ 큐에서 돕니다. 워커 동시성은 25 — 동시 실행이 많다면 배포에서 조정하세요.

API로 수동 단계에 체크가 들어가면 실행이 큐에 다시 들어가 다음 단계부터 계속됩니다. 나머지 Runbook을 위해 워커를 따뜻하게 유지합니다.

## 하드닝 메모

- **JavaScript와 Bash**는 OneUptime 워커가 아닌, 여러분이 통제하는 Runbook 에이전트 호스트에서 실행됩니다. JavaScript는 평소의 프렐류드(`프로토타입 체인을 끊고, `Function`/`eval`을 제거하고, 내장 프로토타입을 동결)와 함께 `isolated-vm`샌드박스로 감쌉니다. Bash는 에이전트에서 타임아웃 강제와 함께`bash -c`로 실행됩니다.
- **HTTP 단계**는 너그러운 상태 검증기를 써서 4xx나 5xx 응답이 던지지 않고 실패 단계로 기록됩니다. 캡처된 출력이 상류가 실제로 반환한 것을 그대로 반영합니다.
- **에이전트 인증**은 에이전트 컨테이너의 환경 변수로 설정한 ID + 시크릿 키로 합니다. 서버 측에서는 제시된 ID/키를 키로 DB 행에서 권위 있는 에이전트 정체성을 가져옵니다 — 키가 유출돼도 클라이언트가 다른 에이전트를 가장할 수 없습니다.

## 데이터베이스 테이블

- `Runbook` — 템플릿(name, slug, description, isEnabled, steps JSON).
- `RunbookExecution` — 실행당 한 행. nullable한 `incidentId`, `alertId`, `scheduledMaintenanceId` 외래 키와, 단계와 단계별 상태를 스냅샷한 JSON `stepExecutions` 배열.
- `RunbookRule` — 자동 트리거 규칙. `triggerEntityType` 식별자(Incident, Alert, ScheduledMaintenance)와 시작할 Runbook에 대한 다대다 관계.
- `RunbookAgent` — 설치된 에이전트당 한 행: name, secret key, `lastAlive`, `connectionStatus`, 호스트 정보.
- `RunbookAgentJob` — 디스패치된 Bash 또는 JavaScript 단계당 한 행: `targetAgentId`(단계 작성자가 선택한 에이전트), 단계 타입, 스크립트, 상태(`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), 클레임 마감, 리스, 출력, exit code.

## 운영 팁

- **단계에서 선택한 에이전트가 건강한지 확인하세요.** 이중화가 필요하면 두 번째 에이전트를 돌려 단계를 나누거나, 다른 에이전트를 대상으로 하는 백업 Runbook을 유지하세요.
- **블랍이 아니라 URL을 캡처하세요.** 단계가 몇 KB 이상의 출력을 만들면 S3나 로깅 스택에 쓰고 URL을 반환하세요.
- **멱등성이 중요합니다.** 자동 단계(HTTP, JavaScript, Bash)는 워커가 단계 중간에 재시작되거나 스크립트가 도는 동안 에이전트의 리스가 만료되면 한 번 이상 실행될 수 있습니다. 재시도해도 안전하게 설계하세요.
