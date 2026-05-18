# Runbook 에이전트

**Runbook 에이전트**는 Runbook의 Bash *및* JavaScript 단계를 **자신의 인프라 안에서** 실행하는 작은 자체 호스팅 프로세스입니다. OneUptime 워커는 절대 여러분의 스크립트를 직접 실행하지 않습니다 — 큐에 넣을 뿐이고, 단계 작성자가 선택한 Runbook 에이전트가 그것을 가져가서 실행하고 결과를 회신합니다.

JavaScript는 여전히 `isolated-vm` 샌드박스에서 실행됩니다. 차이는 그 샌드박스가 우리 쪽이 아니라 여러분의 에이전트 호스트 위에 있다는 점입니다.

이 페이지에서는 에이전트를 설치하는 법, Bash와 JavaScript 단계를 그 에이전트에 향하게 하는 법, 그리고 일상 운영을 설명합니다.

## 에이전트가 존재하는 이유

이전 버전의 OneUptime은 Bash와 JavaScript 단계를 워커에서 실행했습니다. JavaScript는 (`isolated-vm`으로) 샌드박스 되었지만 Bash는 그렇지 않았습니다. 둘 다 단일 테넌트 자체 호스팅을 벗어나는 모든 상황에서 문제가 있었습니다:

- **신뢰 경계.** Runbook을 작성할 수 있는 사람은 누구나 워커에서 코드를 실행할 수 있었고, 워커가 가진 환경 변수와 파일 시스템에 접근할 수 있었습니다. JavaScript 샌드박스는 명백한 것을 막았지만, 결심한 사용자가 우리 네트워크에서 닿을 수 있는 것을 탐색하는 것까지는 막을 수 없었습니다.
- **도달 범위.** 유용한 단계 대부분은 *고객의* 인프라에서 동작하길 원합니다("이 서비스 재시작", "우리 클러스터에서 kubectl", "내부 DB에서 레코드 조회") — OneUptime이 아니라.

Runbook 에이전트는 이를 뒤집습니다. Bash와 JavaScript 단계는 우리 쪽이 아니라 여러분이 통제하는 호스트에서 실행되며, 그 호스트가 무엇을 할 수 있는지는 여러분이 결정합니다.

## 동작 방식

1. OneUptime에서 Runbook 에이전트를 만듭니다. OneUptime이 ID와 시크릿 키를 생성합니다.
2. 그 ID/키와 OneUptime URL을 사용해 인프라 내부 호스트에서 에이전트 컨테이너를 실행합니다.
3. 에이전트는 몇 초마다 OneUptime을 폴링하며 "내가 할 일 있어?"라고 묻습니다.
4. Bash 또는 JavaScript 단계를 작성할 때, 드롭다운에서 에이전트를 선택합니다 — 단계는 그 특정 에이전트에 묶입니다.
5. 단계가 실행될 때, 워커는 `targetAgentId`를 그 에이전트로 설정한 작업 행을 삽입합니다. 그 에이전트만이 작업을 가져갈 수 있습니다.
6. 에이전트가 스크립트를 로컬에서 실행 — Bash는 `bash -c <script>`, JavaScript는 `isolated-vm` 샌드박스 — 결과를 캡처해 다시 게시합니다. 워커는 그 결과로 Runbook을 이어갑니다.

에이전트는 OneUptime 인스턴스로의 **아웃바운드 HTTPS**만 필요합니다. 인바운드 연결은 일절 받지 않습니다.

## 에이전트 설치

### 1. 에이전트 레코드 만들기

**Runbooks → 설정 → 에이전트**로 가서 새 에이전트를 만듭니다. 입력 항목:

| 필드 | 메모 |
| --- | --- |
| **이름** | 친근한 이름 — 보통 `어디서 돌고 무엇을 할 수 있는지`, 예: `prod-eu-west-1`. 단계 작성 시 드롭다운에 표시되는 이름입니다. |
| **설명** | 선택. 이 호스트가 닿을 수 있는 곳을 한 문장으로. 미래의 자신이 고마워합니다. |

### 2. 설치 명령 복사

에이전트를 만든 뒤 그 행에서 **설치 안내 보기**를 클릭합니다. 이 에이전트의 ID와 키가 들어간 `docker run` 명령이 보입니다. **지금 키를 저장하세요** — 나중에 재설정할 수는 있지만, 모달을 닫은 뒤에는 같은 키 값을 다시 볼 수 없습니다.

### 3. 인프라 내부 호스트에서 실행

다음 두 가지가 가능한, 환경 내 임의의 호스트에서 Docker 명령을 실행합니다:

- HTTPS로 OneUptime 인스턴스에 도달할 수 있고,
- Bash/JavaScript 단계로 하고 싶은 일을 할 수 있어야 합니다 (다른 호스트로 SSH, `kubectl`, 데이터베이스와 통신 등).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. 에이전트 연결 확인

**Runbooks → 설정 → 에이전트**로 돌아갑니다. 약 60초 안에 에이전트의 행이 `Connected`로 바뀌고 **마지막 확인** 시각이 갱신되어야 합니다. 계속 `Disconnected`라면:

- 컨테이너 로그(`docker logs oneuptime-runbook-agent`)에서 인증 오류나 네트워크 실패를 확인.
- 호스트에서 `curl`로 OneUptime URL에 닿는지 확인.
- ID와 키가 공백 없이 복사됐는지 확인.

## 단계를 에이전트에 향하게 하기

Runbook에서 Bash 또는 JavaScript 단계를 추가합니다. 폼에는 현재 프로젝트의 모든 에이전트(연결/끊김 표시 포함)가 나열된 **Runbook 에이전트** 드롭다운이 있습니다:

- 이 단계를 실행해야 할 에이전트를 선택합니다.
- 아래 에디터에 스크립트를 작성합니다.

Runbook이 실행돼 그 단계에 닿으면, 워커는 그 에이전트 ID를 대상으로 한 작업을 큐에 넣습니다. 그 에이전트만이 작업을 가져갈 수 있습니다. Bash는 `bash -c`로 실행되고, JavaScript는 에이전트 위의 `isolated-vm` 샌드박스 안에서 실행됩니다(파일 시스템 없음, 네트워크 없음, `Function`/`eval` 없음).

에이전트가 둘 이상 필요한가요? 만들어 두고, 개별 단계를 거기에 맞는 것으로 향하게 하세요. 이중화가 필요하면 두 개의 Runbook(에이전트별 하나)을 작성하거나, 단계를 에이전트 사이에서 나눌 수 있습니다.

## 운영 메모

### 타임아웃

모든 Bash 또는 JavaScript 단계에 두 가지 타임아웃이 적용됩니다:

| 타임아웃 | 기본값 | 제어하는 것 |
| --- | --- | --- |
| **클레임 타임아웃** | 2분 | 선택한 에이전트가 작업을 가져갈 때까지 워커가 기다리는 시간. 에이전트가 제때 가져가지 못하면 단계는 `TimedOut`으로 실패하고, Runbook은 다음으로 진행하거나(또는 멈추거나, **실패 시 계속** 설정에 따라) 합니다. |
| **실행 타임아웃** | 30초 | 에이전트가 스크립트를 종료시키기 전까지 허용하는 시간. 단계별 설정 가능. (Bash는 `SIGKILL`. JavaScript의 isolate는 분해됨.) |

워커의 전체 대기 창은 `클레임 타임아웃 + 실행 타임아웃 + 약간의 여유`입니다. 단계에 맞는 숫자를 골라주세요.

### 리스와 하트비트

에이전트가 작업을 가져가면 짧은 리스(기본 30초)를 얻습니다. 스크립트가 도는 동안 에이전트는 10초마다 리스를 갱신합니다. 스크립트 도중에 에이전트가 죽거나 네트워크를 잃으면 리스가 만료되고, 워커는 영원히 기다리는 대신 작업을 `TimedOut`으로 표시합니다.

리스가 만료돼도 Bash 자식 프로세스는 **자동으로 취소되지 않습니다**(JavaScript isolate 역시 끝날 때까지 둡니다) — 단, 워커가 그들을 기다리지 않게 되고, 다른 클레임이 가져간 후엔 에이전트가 결과를 제출할 수 없습니다. 정확히 한 번이 중요하다면 다시 실행해도 안전하게 스크립트를 설계하세요.

### 온라인인 에이전트가 없을 때

단계가 실행될 시점에 선택된 에이전트가 오프라인이면 작업은 클레임 타임아웃이 끝날 때까지 `Pending`으로 머물다가 "작업을 가져간 에이전트 없음"이라는 명확한 메시지로 실패합니다. 본격적으로 Runbook을 돌리기 전에 에이전트 페이지에서 커버리지를 확인하세요.

### 출력 한도

stdout + stderr 합계는 단계별 **50 KB**로 제한됩니다. 더 큰 출력은 마커와 함께 잘립니다. 전체 로그가 필요하면 스크립트 안에서 S3나 로그 스토어에 쓰고 URL을 `echo` 하세요.

### 취소

Runbook 실행을 (실행 뷰나 API에서) 취소하면 `Pending`/`Claimed`/`Running` 상태의 모든 Bash/JavaScript 작업이 즉시 `Cancelled`로 표시됩니다. 이미 스크립트 도중인 에이전트는 일을 끝마치지만, 그 결과는 서버에서 받아들이지 않습니다.

### 동시성

각 에이전트는 기본적으로 한 번에 한 작업만 실행합니다. 더 허용하려면 에이전트 컨테이너에 `RUNBOOK_AGENT_CONCURRENCY`를 설정하세요 — 단, 에이전트가 그 호스트의 다른 것과 자원을 공유한다는 점을 잊지 마세요.

## 환경 변수

에이전트는 시작 시 다음을 읽습니다:

| 변수 | 필수 | 기본값 | 메모 |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | 예 | — | OneUptime 인스턴스의 베이스 URL, 예: `https://oneuptime.yourdomain.com`. |
| `RUNBOOK_AGENT_ID` | 예 | — | 에이전트의 설치 모달에 나오는 UUID. |
| `RUNBOOK_AGENT_KEY` | 예 | — | 에이전트의 설치 모달에 나오는 시크릿. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | 아니오 | `5000` | 새 작업을 폴링하는 주기. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | 아니오 | `60000` | 에이전트가 생존을 보고하는 주기. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | 아니오 | `10000` | 실행 중인 작업의 리스를 갱신하는 주기. |
| `RUNBOOK_AGENT_CONCURRENCY` | 아니오 | `1` | 이 에이전트의 동시 작업 수 상한. |

## 에이전트 키 교체

키가 유출되면 OneUptime에서 에이전트를 열어 키를 재설정합니다. 이전 키는 즉시 동작을 멈춥니다. 에이전트 컨테이너를 새 키로 갱신하고 재시작하세요.

## 권한

에이전트 관리는 기존 Runbooks 권한 그룹 아래에 있습니다:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — 에이전트 레코드를 관리.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer`(역할) — 팀에 할당하여 각각 전체 제어, 일상 사용, 읽기 전용 접근을 부여. `RunbookAdmin`은 위의 세분 권한을 모두 묶은 것.

Runbook을 *트리거*하는 (따라서 Bash와 JavaScript 단계가 디스패치되도록 하는) 권한은 여전히 `CreateRunbookExecution` / `EditRunbookExecution`입니다.

## 에이전트 대상 API

궁금한 분을 위해 — 에이전트는 다음 엔드포인트를 사용합니다. 모두 `/runbook-agent-ingest` 아래 마운트되며, JSON 본문의 에이전트 ID + 키(또는 `x-agent-id` / `x-agent-key` 헤더)로 인증됩니다.

| 엔드포인트 | 목적 |
| --- | --- |
| `POST /heartbeat` | 생존 확인. `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`을 업데이트. |
| `POST /claim-next-job` | 이 에이전트 ID를 대상으로 한 가장 오래된 `Pending` 작업을 원자적으로 가져옴. 할 일이 없으면 `{ job: null }` 반환. |
| `POST /job/:jobId/heartbeat` | 작업 리스를 갱신. 리스가 끝났거나 작업이 종료 상태이면 404 반환. |
| `POST /job/:jobId/result` | 최종 결과 제출. 리스가 이미 넘어갔다면 무시됨. |

이 API를 손으로 부를 일은 없을 겁니다 — 번들된 에이전트가 합니다. 우리 에이전트가 맞지 않는 제약이 있다면 직접 에이전트를 만들 수 있도록 여기에 기록해 둡니다.
