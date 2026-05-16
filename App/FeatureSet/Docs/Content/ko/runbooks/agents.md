# Runbook 에이전트

**Runbook 에이전트**는 Runbook의 Bash *및* JavaScript 단계를 **여러분의 자체 인프라 안에서** 실행하는 작은 자체 호스팅 프로세스입니다. OneUptime 워커는 여러분의 스크립트를 직접 실행하지 않습니다 — 큐에 적재할 뿐이고, 여러분이 환경에 설치한 Runbook 에이전트가 그것을 가져가서 실행하고 결과를 회신합니다.

JavaScript는 여전히 `isolated-vm` 샌드박스에서 실행됩니다; 차이는 그 샌드박스가 우리 쪽이 아니라 여러분의 에이전트 호스트 위에서 산다는 점입니다.

이 페이지에서는 에이전트를 설치하고, Bash와 JavaScript 단계를 그쪽으로 라우팅하고, 일상적으로 운영하는 방법을 설명합니다.

## 에이전트가 존재하는 이유

이전 OneUptime 버전은 Bash와 JavaScript 단계를 워커에서 실행했습니다. JavaScript는 샌드박스(`isolated-vm`)에 있었고 Bash는 그렇지 않았습니다. 둘 다 싱글 테넌트 자체 호스팅 설정을 넘어서면 문제였습니다:

- **신뢰 경계**: Runbook을 작성할 수 있는 사람이라면 누구나 워커에서 코드를 실행할 수 있었고, 워커가 가진 모든 환경 변수와 파일시스템에 접근할 수 있었습니다. JavaScript 샌드박스는 명백한 것을 차단했지만, 결연한 사용자가 우리 네트워크에서 무엇에 닿을 수 있는지 탐색하는 것을 막을 수는 없었습니다.
- **도달 범위**: 유용한 단계의 대부분은 *고객 측* 인프라에서 동작하길 원합니다 ("이 서비스 재시작", "우리 클러스터에 kubectl", "내부 DB에서 레코드 조회") — OneUptime 측이 아닙니다.

Runbook 에이전트는 이를 뒤집습니다. Bash와 JavaScript 단계는 우리 쪽에서 돌지 않습니다. 여러분이 통제하는 호스트에서 돌고, 그 호스트가 무엇을 할 수 있는지는 여러분이 결정합니다.

## 동작 방식

1. OneUptime에서 Runbook 에이전트를 생성합니다. OneUptime이 ID와 비밀 키를 생성합니다.
2. 그 ID/키와 OneUptime URL로 인프라 내 호스트에서 에이전트 컨테이너를 실행합니다.
3. 에이전트는 몇 초마다 OneUptime에 "나에게 할 일 있나요?"라고 물어봅니다.
4. Bash 또는 JavaScript 단계가 실행되면, 워커는 그 단계의 **Agent Tag**와 단계 유형(Bash 또는 JavaScript)이 표시된 작업 행을 삽입하고 상태를 `Pending`으로 설정합니다.
5. 같은 프로젝트에서 그 태그를 가진 건강한 임의의 에이전트가 작업을 원자적으로 차지하고 (두 에이전트가 같은 작업을 동시에 실행하는 일은 없습니다) 로컬에서 실행합니다 — Bash는 `bash -c <스크립트>`, JavaScript는 `isolated-vm` 샌드박스에서 — 결과를 캡처해 회신합니다.
6. 워커는 그 결과로 Runbook을 이어갑니다.

에이전트는 OneUptime 인스턴스로의 **아웃바운드 HTTPS**만 필요합니다. 인바운드 연결은 일절 받지 않습니다.

## 에이전트 설치

### 1. 에이전트 레코드 생성

**Runbooks → Agents → 새로 만들기**로 이동해 채워 넣습니다:

| 필드 | 설명 |
| --- | --- |
| **이름** | 친근한 이름 — 보통 `어디서-실행되고-무엇을-할-수-있는지`, 예: `prod-eu-west-1`. |
| **설명** | 선택. 이 호스트가 무엇에 도달할 수 있는지에 대한 한 문장. 미래의 당신이 고마워합니다. |
| **태그** | 쉼표로 구분. Bash와 JavaScript 단계는 태그를 지정하고, 프로젝트에서 그 태그를 가진 임의의 에이전트가 실행할 수 있습니다. 흔한 패턴: `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. 설치 명령 복사

에이전트를 만든 후, 그 행의 **설정 지침 보기**를 클릭합니다. 이 에이전트의 ID와 키가 미리 채워진 `docker run` 명령이 표시됩니다. **지금 키를 저장하세요** — 나중에 재설정할 수는 있지만, 모달을 닫은 후 동일한 값을 다시 볼 수는 없습니다.

### 3. 인프라 내 호스트에서 실행

다음을 할 수 있는 환경 내 임의의 호스트에서 Docker 명령을 실행합니다:

- HTTPS로 OneUptime 인스턴스에 도달할 수 있고,
- Bash 단계가 해야 할 일을 할 수 있어야 합니다 (예: 다른 호스트로의 SSH, `kubectl`, 데이터베이스 접근).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.your-domain.com \
  -d oneuptime/runbook-agent:release
```

### 4. 에이전트 연결 확인

**Runbooks → Agents**로 돌아갑니다. 약 60초 이내에 에이전트 행이 새로운 **Last seen** 타임스탬프와 함께 `Connected`로 바뀌어야 합니다. 계속 `Disconnected`라면:

- 컨테이너 로그(`docker logs oneuptime-runbook-agent`)에서 인증 오류나 네트워크 오류를 확인하세요.
- 호스트가 `curl`로 OneUptime URL에 도달하는지 확인하세요.
- ID와 키가 공백 없이 복사되었는지 확인하세요.

## 태그와 라우팅

태그는 Bash 또는 JavaScript 단계가 에이전트를 찾는 방법입니다. 몇 가지 패턴:

- **환경당 하나의 태그**: prod 에이전트에 `prod`, staging에 `staging`. `prod`를 지정한 Bash 단계는 prod에서만 실행됩니다.
- **리전당 하나의 태그**: `eu-west-1`, `us-east-1`. 어떤 단계가 다루는 리소스 근처에서 실행되어야 할 때 유용합니다.
- **같은 태그의 여러 에이전트**: 둘 다 `prod`로 태깅된 에이전트 두 개를 운영. 어느 쪽이든 작업을 차지할 수 있어 — 고가용성을 얻고, Runbook을 망가뜨리지 않고 롤링 재시작을 할 수 있습니다.
- **에이전트당 여러 태그**: prod EU 클러스터의 에이전트가 `prod`, `eu-west-1`, `kubernetes`를 가질 수 있습니다. Bash 단계는 그중 어떤 것이든 지정할 수 있습니다.

Bash와 JavaScript 단계는 각각 정확히 하나의 에이전트 태그를 **반드시** 지정해야 합니다. 다중 태그 라우팅 (`prod` AND `db`를 모두 가진 임의의 에이전트에서 실행) 은 로드맵에 있지만 이번 릴리스에는 없습니다.

## 단계를 에이전트로 지정

Runbook에 Bash 또는 JavaScript 단계를 추가하면 폼이 **Agent Tag**를 묻습니다:

- 실행시키고 싶은 에이전트(들)에 매치되는 태그를 입력하세요.
- 아래 에디터에 스크립트를 작성하세요.

Runbook이 실행되어 단계에 도달하면 워커는 그 태그와 단계 유형으로 작업을 큐에 넣습니다. 그 태그를 가진 건강한 에이전트가 최소 하나 온라인이라면 작업은 몇 초 안에 차지되어 실행됩니다. Bash는 `bash -c`로 실행되고, JavaScript는 에이전트의 `isolated-vm` 샌드박스 안에서 실행됩니다 (파일시스템 없음, 네트워크 없음, `Function`/`eval` 없음).

## 운영 메모

### 타임아웃

모든 Bash 또는 JavaScript 단계에 두 개의 타임아웃이 적용됩니다:

| 타임아웃 | 기본값 | 제어 대상 |
| --- | --- | --- |
| **Claim 타임아웃** | 2분 | 워커가 *어떤* 에이전트라도 작업을 차지할 때까지 기다리는 시간. 시간 내에 아무도 가져가지 않으면 단계는 `TimedOut`으로 실패하고 Runbook은 (**실패 시 계속**에 따라) 계속하거나 멈춥니다. |
| **실행 타임아웃** | 30초 | 에이전트가 스크립트를 종료하기 전까지 실행하게 두는 시간. 단계별 구성 가능. (Bash는 `SIGKILL`을 받고, JavaScript의 아이솔레이트는 해체됩니다.) |

워커의 총 대기 창은 `claim 타임아웃 + 실행 타임아웃 + 몇 초 여유`입니다. 단계에 맞는 값을 고르세요.

### 리스와 하트비트

에이전트가 작업을 차지하면 짧은 리스 (기본 30초) 를 받습니다. 스크립트가 실행되는 동안 에이전트는 10초마다 리스를 갱신합니다. 스크립트 도중 에이전트가 죽거나 네트워크를 잃으면 리스가 만료되고 워커는 영원히 기다리지 않고 작업을 `TimedOut`으로 표시합니다.

Bash의 자식 프로세스는 리스 만료 시 자동으로 취소되지 **않습니다** (JavaScript 아이솔레이트도 끝나면 끝날 때까지 그냥 계속됩니다) — 다만 워커는 더 이상 그것을 기다리지 않고, 다른 클레임이 인계받은 뒤에는 에이전트가 결과를 제출할 수 없습니다. exactly-once가 중요하면 스크립트를 재실행 안전하게 설계하세요.

### 온라인 에이전트가 없을 때

단계 실행 시점에 그 단계의 태그를 가진 건강한 에이전트가 하나도 온라인이 아니면, 작업은 claim 타임아웃이 경과할 때까지 `Pending` 상태로 있다가 "no agent claimed the job"이라는 명확한 메시지로 실패합니다. Agents 페이지는 Runbook을 본격적으로 실행하기 전에 커버리지를 확인하는 곳입니다.

### 출력 상한

stdout + stderr 합계는 단계당 **50KB**로 제한됩니다. 그보다 큰 출력은 마커와 함께 잘립니다. 전체 로그가 필요하면 스크립트 안에서 S3나 로그 스토어에 쓰고 URL을 `echo`하세요.

### 취소

Runbook 실행을 취소하면 (실행 보기나 API에서) 그 `Pending`/`Claimed`/`Running` Bash 작업 모두가 즉시 `Cancelled`로 표시됩니다. 이미 스크립트 중인 에이전트는 작업을 마치지만, 서버는 그 결과를 받아들이지 않습니다.

### 동시성

각 에이전트는 기본적으로 한 번에 하나의 작업을 실행합니다. 더 허용하려면 에이전트 컨테이너에 `RUNBOOK_AGENT_CONCURRENCY`를 설정하세요 — 다만 에이전트는 그 호스트의 다른 모든 것과 자원을 공유한다는 점을 기억하세요.

## 환경 변수

에이전트는 시작 시 다음을 읽습니다:

| 변수 | 필수 | 기본 | 메모 |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | 예 | — | OneUptime 인스턴스의 베이스 URL, 예: `https://oneuptime.your-domain.com`. |
| `RUNBOOK_AGENT_ID` | 예 | — | 에이전트 설정 모달에 표시된 UUID. |
| `RUNBOOK_AGENT_KEY` | 예 | — | 에이전트 설정 모달에 표시된 비밀 값. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | 아니오 | `5000` | 에이전트가 새 작업을 폴링하는 주기. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | 아니오 | `60000` | 에이전트가 생존을 보고하는 주기. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | 아니오 | `10000` | 에이전트가 실행 중인 작업의 리스를 갱신하는 주기. |
| `RUNBOOK_AGENT_CONCURRENCY` | 아니오 | `1` | 이 에이전트에서의 최대 동시 작업 수. |

## 에이전트 키 로테이션

키가 유출되었다면 OneUptime에서 에이전트를 열고 키를 재설정하세요. 기존 키는 즉시 동작하지 않게 됩니다. 새 키로 에이전트 컨테이너를 갱신하고 재시작하세요.

## 권한

에이전트 관리는 기존 Runbooks 권한 그룹에 속합니다:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — 에이전트 레코드 관리.
- `RunbookAdmin` (역할) — 위의 모든 것을 묶음.

Runbook을 *트리거*하는 (따라서 Bash 단계를 디스패치하는) 권한은 여전히 `CreateRunbookExecution` / `EditRunbookExecution`입니다.

## 에이전트용 API

궁금하신 분들을 위해 — 에이전트는 `/runbook-agent-ingest` 아래에 마운트된 다음 엔드포인트를 사용합니다. JSON 본문 내 에이전트 ID + 키 (또는 `x-agent-id` / `x-agent-key` 헤더) 로 인증됩니다.

| 엔드포인트 | 목적 |
| --- | --- |
| `POST /heartbeat` | 생존 보고; `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion` 갱신. |
| `POST /claim-next-job` | 이 에이전트의 태그 중 하나에 매치되는 가장 오래된 `Pending` 작업을 원자적으로 차지. 할 일이 없으면 `{ job: null }` 반환. |
| `POST /job/:jobId/heartbeat` | 작업의 리스 갱신. 리스가 만료되었거나 작업이 종결 상태면 404 반환. |
| `POST /job/:jobId/result` | 최종 결과 제출. 리스가 이미 다른 곳으로 넘어갔다면 무시. |

수동으로 호출할 필요는 없습니다 — 동봉된 에이전트가 처리합니다. 우리 에이전트가 여러분의 제약에 맞지 않아 직접 에이전트를 만들 경우를 대비해 여기 문서화해 두었습니다.
