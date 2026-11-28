import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Ceph mgr 데몬에 포트 9283으로 연결할 수 있는 머신에 설치된 Docker Engine 20.10 이상과 Docker Compose v2 플러그인",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "`ceph` CLI가 관리자 권한으로 동작하는 Ceph 관리 노드의 셸",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "그런 다음 mgr 데몬을 나열합니다. 에이전트에는 활성과 대기를 포함한 **모든** mgr이 필요합니다:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "**활성** mgr만 메트릭을 반환하므로(대기 mgr은 빈 응답을 보냅니다), 모든 mgr을 스크레이프하면 활성 mgr이 장애 조치되어도 메트릭이 계속 들어옵니다.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "스크립트는 OneUptime URL과 수집 키를 묻습니다. 둘 다 1단계에 표시되며, 거기서 키를 선택하면 여기에 채워집니다. 그다음 다음 항목을 묻습니다:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **클러스터 이름**: OneUptime에서 클러스터가 표시되는 이름입니다. 클러스터마다 고유한 이름을 주고 바꾸지 마세요. 새 이름은 새 클러스터로 등록됩니다.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr 엔드포인트**: 이전 단계의 모든 mgr을 쉼표로 구분한 `host:port` 형식으로 입력합니다(예: `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`). 대괄호는 스크립트가 추가합니다.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime AI 에이전트**: 수정을 적용해도 되는지 여부입니다. 읽기 전용으로 두려면 **N**이라고 답하세요. `ceph`가 관리자 권한으로 동작하는 곳에서는 스크립트가 AI 에이전트 전용 Ceph 클라이언트를 만들어 주겠다고 제안합니다.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "`/opt/oneuptime-ceph-agent`에 설치하고, `0600` 권한의 `.env` 파일을 작성한 뒤 Docker Compose로 에이전트를 시작합니다. 스크립트를 다시 실행하면 다시 묻지 않고 그 `.env`의 내용을 모두 재사용하므로, 업그레이드도 이렇게 합니다.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "로그에서 `Everything is ready. Begin running and processing data.`를 찾으세요. 그러면 클러스터가 **Ceph** 섹션에 자동으로 나타나며, 보통 1분 정도 걸립니다.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose는 OneUptime AI 에이전트인 **`oneuptime-ceph-ai-agent`** 컨테이너도 실행합니다. 설치 스크립트가 Ceph 클라이언트를 만들었다면 이미 동작하고 있고, 그렇지 않으면 클라이언트를 기다립니다. 고급의 **OneUptime AI 에이전트**를 참조하세요.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI 에이전트(기본적으로 켜짐, 읽기 전용).** AI 조사가 켜져 있습니다. Ceph 클라이언트가 생기면 OneUptime AI가 읽기 전용 `ceph` 명령으로 이 클러스터의 인시던트와 경고를 조사할 수 있게 하며, 수정을 허용하지 않는 한 아무것도 바꾸지 않습니다.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "설치 스크립트가 이 값들을 `/opt/oneuptime-ceph-agent/.env`에 작성합니다. 값을 바꾼 뒤에는 `/opt/oneuptime-ceph-agent`에서 `docker compose up -d`로 적용하세요.",
  "| Variable | Required | Description |": "| 변수 | 필수 | 설명 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 예 | OneUptime 인스턴스 URL(예: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 예 | 텔레메트리 수집 키, 1단계에서 선택한 키 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | 예 | OneUptime에 표시되는 클러스터 식별자입니다. 모든 메트릭에 리소스 속성 `ceph.cluster.name`으로 붙습니다. 바꾸지 마세요. 바꾸면 새 클러스터가 등록됩니다(기본값: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | 예 | **모든** mgr 데몬의 `host:port`를 쉼표로 구분해 대괄호로 감싼 목록(예: `[ceph-mon-1:9283,ceph-mon-2:9283]`). 대괄호는 설치 스크립트가 추가합니다 |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI 에이전트 자체의 설정은 **OneUptime AI 에이전트**에 있습니다.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **모든 mgr을 스크레이프합니다**(활성과 대기). 그래서 활성 mgr이 장애 조치되어도 메트릭이 유지됩니다.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **30초마다.** mgr의 prometheus 모듈은 스크레이프 결과를 `mgr/prometheus/scrape_interval`(기본 15초) 동안 캐시합니다. 그보다 자주 스크레이프하지 마세요. 캐시를 다시 읽을 뿐입니다.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`**: Ceph가 내보내는 레이블(`ceph_daemon`, `pool_id`)을 그대로 유지하므로, mgr이 장애 조치되어도 시계열이 끊기지 않습니다.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "에이전트가 실행하는 전체 `otel-collector-config.yaml`입니다. `${env:...}` 값은 `.env` 파일이 제공합니다:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "에이전트는 `/var/log/ceph/ceph.log`를 따라가며 OneUptime으로 보낼 수 있고, 이것으로 **클러스터 로그** 페이지가 채워집니다. 에이전트가 클러스터 로그가 있는 호스트(기본적으로 mon 호스트)에서 실행되어야 하므로 기본적으로 꺼져 있습니다.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. `otel-collector-config.yaml`에서 `filelog` 리시버와 `logs` 파이프라인의 주석을 해제합니다.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. `docker-compose.yml`에서 `/var/log/ceph:/var/log/ceph:ro` 볼륨의 주석을 해제합니다.",
  "3. Apply both:": "3. 둘 다 적용합니다:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "줄은 그대로 전송됩니다. OneUptime은 읽을 때 ceph.log 형식(타임스탬프, 데몬, INF/WRN/ERR 수준, 메시지)을 해석하고, `resource` 프로세서가 `ceph.cluster.name`을 붙이므로 로그가 이 클러스터에 들어갑니다.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "`oneuptime.label.` 접두사가 붙은 리소스 속성은 클러스터의 프로젝트 레이블이 됩니다. `oneuptime.label.<dimension>=<value>`는 레이블 `<dimension>:<value>`입니다. `otel-collector-config.yaml`의 `resource` 프로세서에 `ceph.cluster.name` 옆에 추가하세요:",
  "Then restart the collector so it reads the new config:":
    "그런 다음 컬렉터가 새 구성을 읽도록 다시 시작합니다:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "클러스터는 `team:storage`와 `env:production` 레이블이 붙은 채 나타납니다. 레이블은 대소문자를 구분하지 않고 비교하므로 기존 `Production` 레이블이 재사용되며, OneUptime 화면에서 추가한 레이블은 에이전트가 절대 제거하지 않습니다.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "에이전트는 mgr의 prometheus 모듈이 내보내는 모든 것을 보냅니다. OneUptime의 Ceph 페이지, 메트릭 카탈로그, 경고 템플릿은 다음을 기반으로 합니다:",
  "| Category | Data |": "| 범주 | 데이터 |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **클러스터 상태** | `ceph_health_status`(0 = OK, 1 = WARN, 2 = ERR), 모니터 쿼럼, 전체 및 사용 중인 원시 용량 |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | 모든 OSD의 up / in 상태(`ceph_daemon` 레이블별, 예: `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **풀** | 풀별 저장된 바이트, 최대 사용 가능량, 개체 수, 읽기/쓰기 작업과 처리량 |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Group** | 활성, 성능 저하, 크기 미달 PG 수 |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml`은 **`oneuptime-ceph-ai-agent`** 컨테이너도 실행합니다. OneUptime AI가 이 클러스터의 인시던트나 경고를 조사하는 동안 이를 통해 `ceph` 명령(`ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`)을 실행합니다. `CEPH_CLUSTER_NAME`이라는 이름의 클러스터로 등록되며, 클러스터의 **AI → AI 에이전트** 페이지에 나타납니다.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "클러스터의 최소 `ceph.conf`와 그 클라이언트의 키링을 `docker-compose.yml` 옆의 `ceph/` 폴더에 두고, 자체 Ceph 클라이언트 `client.oneuptime-ai`로 연결합니다. 설치 스크립트는 실행하는 머신에서 `ceph`가 관리자 권한으로 동작하면 새로 설치할 때 이 파일들을 만들어 주겠다고 제안합니다. 그렇지 않거나 나중에 추가하려면 Ceph 관리 노드에서 다음을 실행하세요:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "에이전트가 다른 머신에서 실행된다면 같은 방법으로 두 파일을 그 머신의 `ceph/` 폴더에 복사하세요. **관리자 키링은 절대 그곳에 두지 마세요.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **클라이언트의 caps가 절대적인 한도입니다.** 이 읽기 caps로는 에이전트가 실행하는 어떤 것도 클러스터를 바꿀 수 없습니다. 수정(OSD를 다시 in으로 표시, `noout` 해제)에는 `.env`의 `ONEUPTIME_AI_ALLOW_WRITES=true`와 에이전트 README에 있는 수정용 caps도 필요합니다.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 확인: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- OneUptime AI를 쓰지 않는다면 `docker-compose.yml`에서 `oneuptime-ceph-ai-agent` 서비스를 삭제하세요.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "실행할 수 있는 명령과 수정이 동작하는 방식: [인프라 AI 에이전트](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**업그레이드**: 컬렉터 이미지는 `docker-compose.yml`에 고정되어 있고 구성은 그 옆의 파일이므로, 이미지를 가져오는 것만으로는 에이전트가 새로워지지 않습니다. 설치 스크립트를 다시 실행하세요. 기존 `.env`의 모든 값을 재사용하고(아무것도 다시 묻지 않음), 최신 `docker-compose.yml`과 `otel-collector-config.yaml`을 내려받으며(편집한 파일은 새 파일 옆에 `<file>.bak.<timestamp>`로 보관됨), 이미지를 가져와 그것으로 에이전트를 다시 만듭니다. AI 에이전트의 `ceph/` 폴더는 그대로 유지됩니다:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "구성은 고정한 컬렉터 버전을 클러스터의 **에이전트 버전**으로 보고합니다. 이 OneUptime이 더 새 버전을 고정하면 그 옆의 경고 표시에서 이 명령을 열 수 있습니다.",
  "**Uninstall** the agent:": "에이전트 **제거**:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "AI 에이전트의 Ceph 클라이언트를 만들었다면 관리 노드에서 제거하세요: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh`는 전체 경로(컨테이너 런타임, 활성과 대기의 함정을 포함한 모든 mgr 엔드포인트, 클러스터 이름 부여, 토큰 형식, 컬렉터 자체 메트릭)를 확인하고, 수집 키를 받아들이는지 OneUptime에 직접 묻습니다. 마지막 확인이 가장 중요합니다. OneUptime의 OTLP 엔드포인트는 잘못된 키를 `401` 또는 `422`로 거부하는데, 컬렉터는 이를 배치마다 놓치기 쉬운 `Exporting failed` 한 줄로만 기록하므로 스크립트가 `GET /otlp/v1/validate`에 200/401 판정을 직접 요청합니다.",
  "It ends with a verdict naming the most likely cause.":
    "마지막에 가장 가능성 높은 원인을 알려 주는 판정을 표시합니다.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. 컬렉터 로그를 확인하세요: `docker logs oneuptime-ceph-agent`. 내보내기 오류를 찾으세요(`401`은 잘못된 수집 키, 연결 거부는 잘못된 `ONEUPTIME_URL`을 뜻합니다).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. mgr 엔드포인트가 메트릭을 제공하는지 확인하세요: `curl http://<active-mgr>:9283/metrics | head`. `ceph_*` 메트릭 줄이 보여야 합니다. 보이지 않으면 모듈을 활성화하세요: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. `CEPH_MGR_ENDPOINTS`가 대괄호로 감싸져 있는지 확인하세요. 대괄호가 없으면 컬렉터는 쉼표로 구분된 문자열 전체를 하나의 (잘못된) 대상으로 취급합니다.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. 에이전트가 실행 중인지 확인하세요: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. 에이전트 로그에서 오류를 확인하세요: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. OneUptime URL과 수집 키가 올바른지 확인하세요.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 에이전트 머신이 네트워크를 통해 OneUptime 인스턴스에 연결할 수 있는지 확인하세요.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "아마 (이전의) 활성 mgr만 스크레이프하고 있을 것입니다. `CEPH_MGR_ENDPOINTS`에 **모든** mgr 데몬을 나열하세요. 대기 mgr의 스크레이프는 부담이 적고 빈 응답을 반환합니다.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "클러스터에서 `mgr/prometheus/standby_behaviour`가 `error`로 설정되어 있다면 예상된 동작입니다. 이때 대기 mgr은 HTTP 500으로 응답합니다. 활성 mgr의 스크레이프는 여전히 성공하므로 이 오류는 잡음이며, 없애려면 동작을 `default`로 되돌리세요.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "클러스터의 식별자는 `CEPH_CLUSTER_NAME`에서 오며, 모든 메트릭에 `ceph.cluster.name`으로 붙습니다. `.env`에서 고친 뒤 `/opt/oneuptime-ceph-agent`에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **클러스터 이름**: **`ceph-1`** 값을 정확히 입력하세요. 다른 이름은 새 클러스터로 등록됩니다.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "클러스터의 식별자는 `CEPH_CLUSTER_NAME`에서 오며, 모든 메트릭에 `ceph.cluster.name`으로 붙습니다. 이 클러스터의 이름: **`ceph-1`**. `.env`에서 고친 뒤 `/opt/oneuptime-ceph-agent`에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "명령에는 이미 OneUptime URL과 수집 키가 들어 있습니다. 나머지는 스크립트가 묻습니다:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "이 OneUptime에서 `docker-compose.yml`과 `otel-collector-config.yaml`을 새 폴더로 내려받습니다:",
  "Create a `.env` file next to them:": "그 옆에 `.env` 파일을 만듭니다:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- `my-ceph-cluster`를 이 클러스터의 이름(예: `ceph-prod`)으로 바꾸세요. OneUptime에서 클러스터가 이 이름으로 표시되므로 바꾸지 마세요. 새 이름은 새 클러스터로 등록됩니다.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- `CEPH_MGR_ENDPOINTS`에 **모든** mgr 데몬을 쉼표로 구분해 대괄호로 감싸 나열하세요. 대괄호가 없으면 컬렉터는 목록 전체를 하나의 잘못된 대상으로 읽습니다.",
  "Start the agent:": "에이전트를 시작합니다:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose는 OneUptime AI 에이전트인 **`oneuptime-ceph-ai-agent`** 컨테이너도 시작합니다. 이 에이전트는 자체 Ceph 클라이언트를 기다립니다. 고급의 **OneUptime AI 에이전트**를 참조하거나, OneUptime AI를 쓰지 않는다면 `docker-compose.yml`에서 해당 서비스를 삭제하세요.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "에이전트는 `docker-compose.yml` 옆의 `.env` 파일에서 이 값들을 읽습니다. 값을 바꾼 뒤에는 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | 예 | **모든** mgr 데몬의 `host:port`를 쉼표로 구분해 대괄호로 감싼 목록(예: `[ceph-mon-1:9283,ceph-mon-2:9283]`) |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "클러스터의 최소 `ceph.conf`와 그 클라이언트의 키링을 `docker-compose.yml` 옆의 `ceph/` 폴더에 두고, 자체 Ceph 클라이언트 `client.oneuptime-ai`로 연결합니다. Ceph 관리 노드의 에이전트 폴더에서:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "에이전트 폴더, 즉 `docker-compose.yml`이 있는 폴더에서 다음을 실행하세요.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**업그레이드**: 컬렉터 이미지는 `docker-compose.yml`에 고정되어 있고 구성은 그 옆의 파일이므로, 이미지를 가져오는 것만으로는 에이전트가 새로워지지 않습니다. 두 파일을 다시 내려받으세요. `.env`는 그대로 남지만, 두 파일 중 하나에 했던 변경은 다시 해야 합니다:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "그런 다음 이미지를 가져와 에이전트를 다시 만들어, 컬렉터가 새 구성을 읽게 합니다:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "클러스터의 식별자는 `CEPH_CLUSTER_NAME`에서 오며, 모든 메트릭에 `ceph.cluster.name`으로 붙습니다. `.env`에서 고친 뒤 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- 이 명령은 **`ceph-1`** 클러스터용 에이전트를 설치합니다. `CEPH_CLUSTER_NAME`을 정확히 그대로 두세요. 그렇지 않으면 데이터가 새 클러스터로 등록됩니다.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "클러스터의 식별자는 `CEPH_CLUSTER_NAME`에서 오며, 모든 메트릭에 `ceph.cluster.name`으로 붙습니다. 이 클러스터의 이름: **`ceph-1`**. `.env`에서 고친 뒤 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | 아니요 | 컬렉터의 컨테이너 이름(기본값: `oneuptime-ceph-agent`). 같은 머신에 있는 두 번째 클러스터의 에이전트에는 고유한 이름이 필요합니다. 설치 스크립트는 이 값을 설정하지 않으면 새 에이전트의 컨테이너 이름을 폴더 이름을 따서 짓고, 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | 아니요 | AI 에이전트의 컨테이너 이름(기본값: `oneuptime-ceph-ai-agent`). 설치 스크립트는 이 값을 설정하지 않으면 두 번째 클러스터의 AI 에이전트 이름을 그 컬렉터 이름에 맞춰 짓고(`oneuptime-ceph-ai-agent-cluster2`, 컬렉터 `oneuptime-ceph-agent-cluster2`와 나란히), 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "에이전트 하나는 클러스터 하나를 읽습니다. 두 번째 클러스터에는 별도 폴더에 고유한 컨테이너 이름으로 두 번째 에이전트를 설치하세요. 두 컨테이너는 이름을 공유할 수 없습니다:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "변수(예: `CEPH_AGENT_CONTAINER_NAME`)를 설정하지 않으면 스크립트가 폴더 이름을 따서 컨테이너 이름을 짓습니다(예: `oneuptime-ceph-agent-cluster2`). 스크립트는 그 이름을 해당 에이전트의 `.env`에 보관하므로, 같은 `INSTALL_DIR`로 스크립트를 다시 실행해 에이전트를 업그레이드해도 이름이 유지되며, `docker-compose.yml`에서 `container_name`을 직접 수정한 적이 있는 에이전트도 그 이름을 유지합니다.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "폴더마다 고유한 이름을 붙이세요. Docker Compose는 폴더 이름만으로 프로젝트 이름을 짓기 때문에, 스크립트는 다른 곳에서 이미 에이전트를 실행 중인 폴더와 같은 이름의 폴더를 거부합니다. 진단 스크립트에는 `-d`로 폴더를 넘기세요.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | 아니요 | 컬렉터의 컨테이너 이름(기본값: `oneuptime-ceph-agent`). 같은 머신에 있는 두 번째 클러스터의 에이전트에는 고유한 이름이 필요합니다 |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | 아니요 | AI 에이전트의 컨테이너 이름(기본값: `oneuptime-ceph-ai-agent`). 같은 머신에 있는 두 번째 클러스터의 에이전트에는 고유한 이름이 필요합니다 |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "에이전트 하나는 클러스터 하나를 읽습니다. 두 번째 클러스터에는 별도 폴더에 고유한 컨테이너 이름으로 두 번째 에이전트를 구성하세요. 두 컨테이너는 이름을 공유할 수 없습니다. 이름은 그 에이전트의 `.env`에 설정하세요:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "폴더마다 고유한 이름을 붙이세요. Docker Compose는 폴더 이름만으로 프로젝트 이름을 짓기 때문에, 같은 이름의 두 번째 폴더는 첫 번째 에이전트의 컨테이너를 대체합니다. 이름은 `docker-compose.yml`에 넣지 마세요. 업그레이드가 이 파일을 대체합니다.",
};

export default TRANSLATION;
