import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The DockerSwarm setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/DockerSwarm/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Docker Swarm **manager** node to run it on — the inventory poller calls manager-only API endpoints (`/nodes`, `/services`, `/tasks`)":
    "실행할 Docker Swarm **manager** 노드. 인벤토리 폴러는 manager만 가진 API 엔드포인트(`/nodes`, `/services`, `/tasks`)를 호출합니다",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin":
    "Docker Compose v2 플러그인이 있는 Docker Engine 20.10 이상",
  "When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and a name for the cluster, such as `prod-swarm`. The name is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "물어보면 1단계에 표시된 OneUptime URL과 수집 키, 그리고 클러스터 이름(예: `prod-swarm`)을 입력합니다. OneUptime에서 클러스터가 이 이름으로 표시되므로 바꾸지 마세요. 새 이름은 새 클러스터로 등록됩니다.",
  "The script puts the agent in `/opt/oneuptime-docker-swarm-agent` and starts it with Docker Compose.":
    "스크립트는 에이전트를 `/opt/oneuptime-docker-swarm-agent`에 두고 Docker Compose로 시작합니다.",
  "`docker compose ps` lists three containers: the collector (`oneuptime-docker-swarm-agent`), the inventory poller (`oneuptime-docker-swarm-inventory`) and the OneUptime AI agent (`oneuptime-docker-swarm-ai-agent`). The cluster appears in the **Docker Swarm** section within a few minutes, and its Nodes, Services, Tasks, Stacks, Networks, Secrets, Configs and Volumes pages fill in after the first inventory snapshot (≤ 5 minutes).":
    "`docker compose ps`에 컨테이너 세 개가 나옵니다: 컬렉터(`oneuptime-docker-swarm-agent`), 인벤토리 폴러(`oneuptime-docker-swarm-inventory`), OneUptime AI 에이전트(`oneuptime-docker-swarm-ai-agent`). 클러스터는 몇 분 안에 **Docker Swarm** 섹션에 나타나고, 첫 인벤토리 스냅샷(≤ 5분) 뒤에 노드, 서비스, 작업, 스택, 네트워크, 시크릿, 구성, 볼륨 페이지가 채워집니다.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only docker commands such as `docker node ls` and `docker service ps`, and changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced.":
    "**OneUptime AI 에이전트(기본적으로 켜짐, 읽기 전용).** AI 조사가 켜져 있습니다: 이 에이전트로 OneUptime AI는 `docker node ls`, `docker service ps` 같은 읽기 전용 docker 명령을 써서 이 클러스터의 인시던트와 경고를 조사하며, 수정을 허용하지 않는 한 아무것도 바꾸지 않습니다. 고급의 **OneUptime AI 에이전트**를 참조하세요.",
  "Run the agent on a **manager** node: the inventory poller and the OneUptime AI agent call manager-only API endpoints. The collector reports the containers of the node it runs on, so for per-node container metrics run the collector on every node, all with the same `DOCKER_SWARM_CLUSTER_NAME`; the inventory poller only needs to run on one manager. Run the install script on a node that is not a manager, and it leaves the OneUptime AI agent out there.":
    "에이전트는 **manager** 노드에서 실행하세요. 인벤토리 폴러와 OneUptime AI 에이전트는 manager만 가진 API 엔드포인트를 호출합니다. 컬렉터는 자신이 실행되는 노드의 컨테이너를 보고하므로, 노드별 컨테이너 메트릭이 필요하면 모든 노드에서 같은 `DOCKER_SWARM_CLUSTER_NAME`으로 컬렉터를 실행합니다. 인벤토리 폴러는 manager 한 대에서만 실행하면 됩니다. manager가 아닌 노드에서 설치 스크립트를 실행하면 그 노드에는 OneUptime AI 에이전트를 넣지 않습니다.",
  "Deploying the agent as a swarm stack rather than with Compose? Pin the inventory poller and the AI agent to managers — docker-compose.yml carries this block, commented out, on both services:":
    "Compose 대신 swarm 스택으로 에이전트를 배포하나요? 인벤토리 폴러와 AI 에이전트를 manager에 고정하세요. docker-compose.yml의 두 서비스 모두에 이 블록이 주석 처리되어 있습니다:",
  "| Variable | Required | Description |": "| 변수 | 필수 | 설명 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 예 | OneUptime 인스턴스의 URL(예: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | 예 | 1단계의 텔레메트리 수집 키 |",
  "| `DOCKER_SWARM_CLUSTER_NAME` | Yes | The cluster's name in OneUptime, and its join key: stamped on every signal as the `docker.swarm.cluster.name` resource attribute. Defaults to `docker-swarm` |":
    "| `DOCKER_SWARM_CLUSTER_NAME` | 예 | OneUptime에서의 클러스터 이름이자 연결 키입니다. 모든 신호에 리소스 속성 `docker.swarm.cluster.name`으로 붙습니다. 기본값은 `docker-swarm` |",
  "| `DOCKER_SWARM_NODE_NAME` | No | This node's name, stamped on its containers' metrics and logs as `docker.swarm.node.name` — what a Docker Swarm monitor's **Node Name** filter matches. The install script sets it to the node's hostname, the name `docker node ls` shows. Empty: no node name is stamped |":
    "| `DOCKER_SWARM_NODE_NAME` | 아니요 | 이 노드의 이름으로, 컨테이너의 메트릭과 로그에 `docker.swarm.node.name`으로 붙습니다. Docker Swarm 모니터의 **노드 이름** 필터가 이것과 일치합니다. 설치 스크립트는 노드의 호스트 이름(`docker node ls`가 보여 주는 이름)으로 설정합니다. 비어 있으면 노드 이름이 붙지 않습니다 |",
  "| `DOCKER_INVENTORY_INTERVAL_SECONDS` | No | How often the poller refreshes the inventory snapshot (default `300`) |":
    "| `DOCKER_INVENTORY_INTERVAL_SECONDS` | 아니요 | 폴러가 인벤토리 스냅샷을 새로 고치는 주기(기본값 `300`) |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the collector and the inventory poller speak. Empty by default: they use the daemon's own, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | 아니요 | 컬렉터와 인벤토리 폴러가 사용하는 Docker Engine API 버전. 기본적으로 비어 있으며 데몬 자체의 버전을 쓰므로 20.10 이상의 모든 Docker Engine에서 동작합니다. 버전을 고정할 때만 설정하세요(문제 해결 참조) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1`~`ONEUPTIME_LOG_OPERATOR_5` | 아니요 | 에이전트가 읽지 못하는 로그 형식을 위해 직접 만든 컬렉터 오퍼레이터로, 하나씩 JSON으로 씁니다 |",
  "The install script writes the first four to `/opt/oneuptime-docker-swarm-agent/.env`. Add or change any of them there, then run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` to recreate the containers with the new values.":
    "설치 스크립트는 처음 네 개를 `/opt/oneuptime-docker-swarm-agent/.env`에 씁니다. 거기서 추가하거나 바꾼 다음 `/opt/oneuptime-docker-swarm-agent`에서 `docker compose up -d`를 실행해 새 값으로 컨테이너를 다시 만듭니다.",
  "The agent's docker-compose.yml also runs the OneUptime AI agent, `oneuptime-docker-swarm-ai-agent`. It runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this cluster, and it appears on the cluster's **AI → AI agent** page. Like the inventory poller it must run on a manager node — on a worker it runs nothing.":
    "에이전트의 docker-compose.yml은 OneUptime AI 에이전트 `oneuptime-docker-swarm-ai-agent`도 실행합니다. 이 에이전트는 OneUptime AI가 이 클러스터의 인시던트나 경고를 조사하는 동안 요청하는 `docker` 명령을 실행하며, 클러스터의 **AI → AI 에이전트** 페이지에 나타납니다. 인벤토리 폴러처럼 manager 노드에서 실행해야 하며, worker에서는 아무것도 실행하지 않습니다.",
  "- **Read-only by default.** It runs commands such as `docker node ls`, `docker service ls`, `docker service ps NAME` and `docker service logs --tail 200 NAME` — never `service create`/`rm`, `stack deploy`/`rm`, secrets, configs or `exec`. Environment values in `docker service inspect` output are masked before anything leaves the node.":
    "- **기본적으로 읽기 전용입니다.** `docker node ls`, `docker service ls`, `docker service ps NAME`, `docker service logs --tail 200 NAME` 같은 명령을 실행하며 `service create`/`rm`, `stack deploy`/`rm`, 시크릿, config, `exec`은 절대 실행하지 않습니다. `docker service inspect` 출력의 환경 값은 무엇이든 노드를 떠나기 전에 마스킹됩니다.",
  "- **Fixes are opt-in.** Set `ONEUPTIME_AI_ALLOW_WRITES=true` in `/opt/oneuptime-docker-swarm-agent/.env` and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` to let it roll a named service (`docker service update --force`), roll it back or scale it. `ONEUPTIME_AI_FIXES` in the same file says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the cluster's **AI → AI agent** page shows it. Draining a node always needs a person's approval. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs of service and node names) limits what fixes may touch; `ONEUPTIME_AI_PROTECTED_TARGETS` adds services it must never change. It never changes itself, the collector or the inventory poller.":
    "- **수정은 직접 켜야 합니다.** `/opt/oneuptime-docker-swarm-agent/.env`에 `ONEUPTIME_AI_ALLOW_WRITES=true`를 설정하고 `/opt/oneuptime-docker-swarm-agent`에서 `docker compose up -d`를 실행하면, 이름이 지정된 서비스를 다시 배포(`docker service update --force`)하거나 롤백하거나 확장하도록 허용할 수 있습니다. 같은 파일의 `ONEUPTIME_AI_FIXES`는 각 수정에 승인이 필요한지(`ask-for-approval`, `automatic`, `bypass-approval`) 정하며, 클러스터의 **AI → AI 에이전트** 페이지에 표시됩니다. 노드를 비우는 작업에는 항상 사람의 승인이 필요합니다. `ONEUPTIME_AI_WRITE_TARGETS`(서비스 이름과 노드 이름을 쉼표로 구분한 glob)는 수정이 건드릴 수 있는 대상을 제한하고, `ONEUPTIME_AI_PROTECTED_TARGETS`는 절대 바꾸면 안 되는 서비스를 추가합니다. 자기 자신, 컬렉터, 인벤토리 폴러는 절대 바꾸지 않습니다.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Docker 소켓의 소유자가 root이므로 root로 실행됩니다. 소켓을 `:ro`로 마운트해도 Docker API가 읽기 전용이 되지는 않습니다. 한계는 에이전트의 명령 정책입니다.",
  "- To leave it out, run the install script with `--no-ai-agent`: `sh install.sh --no-ai-agent`.":
    "- 빼려면 설치 스크립트를 `--no-ai-agent`와 함께 실행합니다: `sh install.sh --no-ai-agent`.",
  "- Its logs: `docker compose logs -f oneuptime-docker-swarm-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters).":
    "- 로그: `docker compose logs -f oneuptime-docker-swarm-ai-agent`. 실행할 수 있는 작업과 수정의 동작 방식: [인프라용 AI 에이전트](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters).",
  "The agent is three containers, all defined in its docker-compose.yml:":
    "에이전트는 세 개의 컨테이너로 이루어지며, 모두 docker-compose.yml에 정의되어 있습니다:",
  "1. **Collector** (`oneuptime-docker-swarm-agent`) — the stock `otel/opentelemetry-collector-contrib` image with a tuned config. It scrapes `docker_stats` for per-container CPU and memory, tails container logs, and tails the inventory snapshot file — stamping everything with `docker.swarm.cluster.name`, and each task's metrics with its service and node, before shipping it to OneUptime over OTLP.":
    "1. **컬렉터**(`oneuptime-docker-swarm-agent`) — 조정된 설정을 넣은 기본 `otel/opentelemetry-collector-contrib` 이미지입니다. 컨테이너별 CPU와 메모리를 위해 `docker_stats`를 수집하고, 컨테이너 로그와 인벤토리 스냅샷 파일을 따라가며, 모든 것에 `docker.swarm.cluster.name`을, 각 작업의 메트릭에는 그 서비스와 노드를 붙인 뒤 OTLP로 OneUptime에 보냅니다.",
  "2. **Inventory poller** (`oneuptime-docker-swarm-inventory`) — a small `alpine` + `curl` + `jq` sidecar that every 5 minutes walks the Swarm manager API (`/nodes`, `/services`, `/tasks`, `/networks`, `/secrets`, `/configs`, `/volumes`) and derives stacks from the `com.docker.stack.namespace` service label, writing one JSON line per object for the collector to forward.":
    "2. **인벤토리 폴러**(`oneuptime-docker-swarm-inventory`) — `alpine` + `curl` + `jq`로 된 작은 사이드카로, 5분마다 Swarm manager API(`/nodes`, `/services`, `/tasks`, `/networks`, `/secrets`, `/configs`, `/volumes`)를 훑고 서비스 레이블 `com.docker.stack.namespace`에서 스택을 도출해, 객체마다 JSON 한 줄을 씁니다. 컬렉터가 이를 전달합니다.",
  "3. **OneUptime AI agent** (`oneuptime-docker-swarm-ai-agent`) — runs the commands OneUptime AI asks for; see **The OneUptime AI agent** above.":
    "3. **OneUptime AI 에이전트**(`oneuptime-docker-swarm-ai-agent`) — OneUptime AI가 요청하는 명령을 실행합니다. 위의 **OneUptime AI 에이전트**를 참조하세요.",
  "**Upgrade** — run the install script again. It downloads the latest docker-compose.yml, collector config and inventory poller into `/opt/oneuptime-docker-swarm-agent`, pulls the images and restarts the agent; answer its questions with the same URL, key and cluster name:":
    "**업그레이드**: 설치 스크립트를 다시 실행합니다. 최신 docker-compose.yml, 컬렉터 설정, 인벤토리 폴러를 `/opt/oneuptime-docker-swarm-agent`에 내려받고, 이미지를 받아 에이전트를 다시 시작합니다. 질문에는 같은 URL, 키, 클러스터 이름으로 답하세요:",
  "It rewrites `.env` from your answers and keeps only the AI agent's target lists and what AI may do (`ONEUPTIME_AI_INVESTIGATION`, `ONEUPTIME_AI_FIXES`): add back any variable you set yourself, such as `DOCKER_API_VERSION`. Turned on AI fixes? Run it as `ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh` to keep them on. Left the AI agent out? Pass `--no-ai-agent` again.":
    "답변으로 `.env`를 다시 쓰고, AI 에이전트의 대상 목록과 AI가 할 수 있는 작업(`ONEUPTIME_AI_INVESTIGATION`, `ONEUPTIME_AI_FIXES`)만 유지합니다. `DOCKER_API_VERSION`처럼 직접 설정한 변수는 다시 추가하세요. AI 수정을 켜 두었나요? 켜 둔 채로 두려면 `ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh`로 실행합니다. AI 에이전트를 뺐나요? `--no-ai-agent`를 다시 넘기세요.",
  "**Uninstall:**": "**제거:**",
  "| Signal | Source | Powers |": "| 신호 | 출처 | 용도 |",
  "| Node / Service / Task / Stack / Network / Secret / Config / Volume inventory | inventory poller → Swarm manager API | the cluster's resource list + detail pages |":
    "| 노드 / 서비스 / 작업 / 스택 / 네트워크 / 시크릿 / config / 볼륨 인벤토리 | 인벤토리 폴러 → Swarm manager API | 클러스터의 리소스 목록과 상세 페이지 |",
  "| Cluster counts (nodes ready, tasks running, services, stacks, …) | derived from the same snapshot | the overview cards + sidebar badges |":
    "| 클러스터 개수(준비된 노드, 실행 중인 작업, 서비스, 스택, …) | 같은 스냅샷에서 도출 | 개요 카드와 사이드바 배지 |",
  "| Container CPU / memory / pids / uptime | `docker_stats` receiver | the Metrics tab |":
    "| 컨테이너 CPU / 메모리 / PID / 가동 시간 | `docker_stats` 리시버 | 메트릭 탭 |",
  "| Container stdout/stderr logs | `filelog` receiver | the Logs tab |":
    "| 컨테이너 stdout/stderr 로그 | `filelog` 리시버 | 로그 탭 |",
  "Each task's metrics carry its container (`container.name`, `container.image.name`, and `container.runtime=docker`, which the `docker_stats` receiver adds), its service (`docker.swarm.service.name`) and its node (`docker.swarm.node.id`, and `docker.swarm.node.name` from `DOCKER_SWARM_NODE_NAME`). The agent stamps `docker.swarm.cluster.name` on everything and never `host.name`, so OneUptime attributes the telemetry to this swarm cluster rather than registering each node as a standalone Host or Docker Host.":
    "각 작업의 메트릭에는 그 컨테이너(`container.name`, `container.image.name`, 그리고 `docker_stats` 리시버가 붙이는 `container.runtime=docker`), 서비스(`docker.swarm.service.name`), 노드(`docker.swarm.node.id`, 그리고 `DOCKER_SWARM_NODE_NAME`에서 오는 `docker.swarm.node.name`)가 붙습니다. 에이전트는 모든 것에 `docker.swarm.cluster.name`을 붙이고 `host.name`은 절대 붙이지 않으므로, OneUptime은 각 노드를 독립된 호스트나 Docker 호스트로 등록하지 않고 텔레메트리를 이 swarm 클러스터에 귀속시킵니다.",
  "Run the diagnostic script on the manager node. It checks the containers, that the inventory poller is on a manager, the snapshot file, the cluster name and the key — and asks OneUptime directly whether it accepts the ingestion key. A rejected key (`401` or `422`) otherwise shows only as an easy-to-miss `Exporting failed` line in the collector's logs.":
    "manager 노드에서 진단 스크립트를 실행합니다. 컨테이너, 인벤토리 폴러가 manager에 있는지, 스냅샷 파일, 클러스터 이름과 키를 확인하고, 수집 키를 받아들이는지 OneUptime에 직접 묻습니다. 그러지 않으면 거부된 키(`401` 또는 `422`)는 컬렉터 로그의 놓치기 쉬운 `Exporting failed` 줄로만 드러납니다.",
  "Otherwise, check the collector's logs (`docker compose logs oneuptime-docker-swarm-agent` in `/opt/oneuptime-docker-swarm-agent`), that `ONEUPTIME_SERVICE_TOKEN` and `ONEUPTIME_URL` in `/opt/oneuptime-docker-swarm-agent/.env` are correct, and that the manager can reach your OneUptime instance.":
    "그 밖에는 컬렉터의 로그(`/opt/oneuptime-docker-swarm-agent`에서 `docker compose logs oneuptime-docker-swarm-agent`), `/opt/oneuptime-docker-swarm-agent/.env`의 `ONEUPTIME_SERVICE_TOKEN`과 `ONEUPTIME_URL`이 올바른지, manager가 OneUptime 인스턴스에 연결할 수 있는지 확인하세요.",
  "Confirm the poller runs on a manager: `docker node ls` must succeed there. Then look for `failed to emit ...` lines in its logs:":
    "폴러가 manager에서 실행되는지 확인합니다. 거기서 `docker node ls`가 성공해야 합니다. 그런 다음 로그에서 `failed to emit ...` 줄을 찾습니다:",
  "The cluster is marked disconnected after 15 minutes without telemetry. Make sure the collector container (`oneuptime-docker-swarm-agent`) stays running — `docker compose ps` in `/opt/oneuptime-docker-swarm-agent` shows it.":
    "텔레메트리가 15분 동안 없으면 클러스터는 연결 끊김으로 표시됩니다. 컬렉터 컨테이너(`oneuptime-docker-swarm-agent`)가 계속 실행되는지 확인하세요. `/opt/oneuptime-docker-swarm-agent`에서 `docker compose ps`를 실행하면 보입니다.",
  "The collector's logs show:": "컬렉터의 로그에는 다음이 표시됩니다:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The collector pins a version only when `DOCKER_API_VERSION` names one, and older agent files pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Run the install script again: it downloads the current files, which leave the version empty. Then take any `DOCKER_API_VERSION=` line with a version out of `/opt/oneuptime-docker-swarm-agent/.env`, or set it empty — `DOCKER_API_VERSION=` — and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent`, on every node the collector runs on. The collector then negotiates the version with the daemon.":
    "데몬은 자신의 최대값보다 새로운 클라이언트를 거부하고, 이 때문에 컬렉터가 종료되어 컨테이너가 재시작을 반복합니다. 컬렉터는 `DOCKER_API_VERSION`이 버전을 지정할 때만 버전을 고정하는데, 이전 에이전트 파일은 `1.44`를 고정했고 Docker Engine 20.10부터 24까지는 이를 거부합니다. 설치 스크립트를 다시 실행하세요. 버전을 비워 둔 현재 파일을 내려받습니다. 그런 다음 `/opt/oneuptime-docker-swarm-agent/.env`에서 버전이 적힌 `DOCKER_API_VERSION=` 줄을 빼거나 비우고(`DOCKER_API_VERSION=`), 컬렉터가 실행되는 모든 노드에서 `/opt/oneuptime-docker-swarm-agent`에서 `docker compose up -d`를 실행합니다. 그러면 컬렉터가 데몬과 버전을 협상합니다.",
  "To pin a version anyway, use no more than the daemon's maximum, such as `DOCKER_API_VERSION=1.41`:":
    "그래도 버전을 고정하려면 데몬의 최대값을 넘지 마세요(예: `DOCKER_API_VERSION=1.41`):",
  "Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "새 데몬도 이전 API 버전을 계속 제공하므로 고정한 버전은 Docker를 업그레이드한 뒤에도 계속 동작합니다.",
  "The cluster's name comes from `DOCKER_SWARM_CLUSTER_NAME`. Change it in `/opt/oneuptime-docker-swarm-agent/.env` and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` — note that a new name registers a new cluster.":
    "클러스터 이름은 `DOCKER_SWARM_CLUSTER_NAME`에서 옵니다. `/opt/oneuptime-docker-swarm-agent/.env`에서 바꾸고 `/opt/oneuptime-docker-swarm-agent`에서 `docker compose up -d`를 실행합니다. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and **`swarm-1`** as the cluster name — exactly, or the data registers as a new cluster.":
    "물어보면 1단계에 표시된 OneUptime URL과 수집 키를 입력하고, 클러스터 이름에는 **`swarm-1`** 값을 정확히 그대로 입력합니다. 다르면 데이터가 새 클러스터로 등록됩니다.",
  "Replace `my-swarm` with a name for this cluster, such as `prod-swarm`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-swarm`을 이 클러스터의 이름(예: `prod-swarm`)으로 바꿉니다. OneUptime에서 클러스터가 이 이름으로 표시되므로 바꾸지 마세요. 새 이름은 새 클러스터로 등록됩니다.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "Add this node's name to it. The collector puts it on the node's container metrics, and a Docker Swarm monitor's **Node Name** filter matches it:":
    "여기에 이 노드의 이름을 추가합니다. 컬렉터는 이를 노드의 컨테이너 메트릭에 붙이고, Docker Swarm 모니터의 **노드 이름** 필터가 이것과 일치합니다:",
  "Then start it:": "그런 다음 시작합니다:",
  "Run the agent on a **manager** node: the inventory poller and the OneUptime AI agent call manager-only API endpoints. The collector reports the containers of the node it runs on, so for per-node container metrics run the collector on every node, all with the same `DOCKER_SWARM_CLUSTER_NAME`; the inventory poller only needs to run on one manager.":
    "에이전트는 **manager** 노드에서 실행하세요. 인벤토리 폴러와 OneUptime AI 에이전트는 manager만 가진 API 엔드포인트를 호출합니다. 컬렉터는 자신이 실행되는 노드의 컨테이너를 보고하므로, 노드별 컨테이너 메트릭이 필요하면 모든 노드에서 같은 `DOCKER_SWARM_CLUSTER_NAME`으로 컬렉터를 실행합니다. 인벤토리 폴러는 manager 한 대에서만 실행하면 됩니다.",
  "| `DOCKER_SWARM_NODE_NAME` | No | This node's name, stamped on its containers' metrics and logs as `docker.swarm.node.name` — what a Docker Swarm monitor's **Node Name** filter matches. Set it to the node's hostname, the name `docker node ls` shows: `echo \"DOCKER_SWARM_NODE_NAME=$(docker info --format '{{.Name}}')\" >> .env`. Empty: no node name is stamped |":
    "| `DOCKER_SWARM_NODE_NAME` | 아니요 | 이 노드의 이름으로, 컨테이너의 메트릭과 로그에 `docker.swarm.node.name`으로 붙습니다. Docker Swarm 모니터의 **노드 이름** 필터가 이것과 일치합니다. 노드의 호스트 이름(`docker node ls`가 보여 주는 이름)으로 설정하세요: `echo \"DOCKER_SWARM_NODE_NAME=$(docker info --format '{{.Name}}')\" >> .env`. 비어 있으면 노드 이름이 붙지 않습니다 |",
  "Set them in the `.env` next to docker-compose.yml, then run `docker compose up -d` to recreate the containers with the new values.":
    "docker-compose.yml 옆의 `.env`에 설정한 다음 `docker compose up -d`를 실행해 새 값으로 컨테이너를 다시 만듭니다.",
  "- **Fixes are opt-in.** Set `ONEUPTIME_AI_ALLOW_WRITES=true` in the `.env` next to docker-compose.yml and run `docker compose up -d` in the agent's folder to let it roll a named service (`docker service update --force`), roll it back or scale it. `ONEUPTIME_AI_FIXES` in the same file says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the cluster's **AI → AI agent** page shows it. Draining a node always needs a person's approval. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs of service and node names) limits what fixes may touch; `ONEUPTIME_AI_PROTECTED_TARGETS` adds services it must never change. It never changes itself, the collector or the inventory poller.":
    "- **수정은 직접 켜야 합니다.** docker-compose.yml 옆의 `.env`에 `ONEUPTIME_AI_ALLOW_WRITES=true`를 설정하고 에이전트 폴더에서 `docker compose up -d`를 실행하면, 이름이 지정된 서비스를 다시 배포(`docker service update --force`)하거나 롤백하거나 확장하도록 허용할 수 있습니다. 같은 파일의 `ONEUPTIME_AI_FIXES`는 각 수정에 승인이 필요한지(`ask-for-approval`, `automatic`, `bypass-approval`) 정하며, 클러스터의 **AI → AI 에이전트** 페이지에 표시됩니다. 노드를 비우는 작업에는 항상 사람의 승인이 필요합니다. `ONEUPTIME_AI_WRITE_TARGETS`(서비스 이름과 노드 이름을 쉼표로 구분한 glob)는 수정이 건드릴 수 있는 대상을 제한하고, `ONEUPTIME_AI_PROTECTED_TARGETS`는 절대 바꾸면 안 되는 서비스를 추가합니다. 자기 자신, 컬렉터, 인벤토리 폴러는 절대 바꾸지 않습니다.",
  "- To leave it out, delete the `oneuptime-docker-swarm-ai-agent` service from docker-compose.yml.":
    "- 빼려면 docker-compose.yml에서 `oneuptime-docker-swarm-ai-agent` 서비스를 삭제합니다.",
  "**Upgrade** — the collector image is pinned in docker-compose.yml and its config is a file next to it, so pulling alone does not move the agent forward. Download the three files again (the commands in step 2 — then re-apply any change you made to docker-compose.yml), and in the agent's folder:":
    "**업그레이드**: 컬렉터 이미지는 docker-compose.yml에 고정되어 있고 설정은 옆에 있는 파일이므로, 이미지를 받기만 해서는 에이전트가 새로워지지 않습니다. 세 파일을 다시 내려받고(2단계의 명령. 그런 다음 docker-compose.yml에 했던 변경을 다시 적용합니다) 에이전트 폴더에서:",
  "**Uninstall** — in the agent's folder:": "**제거**: 에이전트 폴더에서:",
  "Otherwise, check the collector's logs (`docker compose logs oneuptime-docker-swarm-agent` in the agent's folder), that `ONEUPTIME_SERVICE_TOKEN` and `ONEUPTIME_URL` in the `.env` next to docker-compose.yml are correct, and that the manager can reach your OneUptime instance.":
    "그 밖에는 컬렉터의 로그(에이전트 폴더에서 `docker compose logs oneuptime-docker-swarm-agent`), docker-compose.yml 옆의 `.env`에 있는 `ONEUPTIME_SERVICE_TOKEN`과 `ONEUPTIME_URL`이 올바른지, manager가 OneUptime 인스턴스에 연결할 수 있는지 확인하세요.",
  "The cluster is marked disconnected after 15 minutes without telemetry. Make sure the collector container (`oneuptime-docker-swarm-agent`) stays running — `docker compose ps` in the agent's folder shows it.":
    "텔레메트리가 15분 동안 없으면 클러스터는 연결 끊김으로 표시됩니다. 컬렉터 컨테이너(`oneuptime-docker-swarm-agent`)가 계속 실행되는지 확인하세요. 에이전트 폴더에서 `docker compose ps`를 실행하면 보입니다.",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The collector pins a version only when `DOCKER_API_VERSION` names one, and older agent files pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Download the agent's files again (step 2), which leave the version empty. Then take any `DOCKER_API_VERSION=` line with a version out of the `.env` next to docker-compose.yml, or set it empty — `DOCKER_API_VERSION=` — and run `docker compose up -d` in the agent's folder, on every node the collector runs on. The collector then negotiates the version with the daemon.":
    "데몬은 자신의 최대값보다 새로운 클라이언트를 거부하고, 이 때문에 컬렉터가 종료되어 컨테이너가 재시작을 반복합니다. 컬렉터는 `DOCKER_API_VERSION`이 버전을 지정할 때만 버전을 고정하는데, 이전 에이전트 파일은 `1.44`를 고정했고 Docker Engine 20.10부터 24까지는 이를 거부합니다. 에이전트 파일을 다시 내려받으세요(2단계). 버전은 비워 둡니다. 그런 다음 docker-compose.yml 옆의 `.env`에서 버전이 적힌 `DOCKER_API_VERSION=` 줄을 빼거나 비우고(`DOCKER_API_VERSION=`), 컬렉터가 실행되는 모든 노드에서 에이전트 폴더에서 `docker compose up -d`를 실행합니다. 그러면 컬렉터가 데몬과 버전을 협상합니다.",
  "The cluster's name comes from `DOCKER_SWARM_CLUSTER_NAME`. Change it in the `.env` next to docker-compose.yml and run `docker compose up -d` in the agent's folder — note that a new name registers a new cluster.":
    "클러스터 이름은 `DOCKER_SWARM_CLUSTER_NAME`에서 옵니다. docker-compose.yml 옆의 `.env`에서 바꾸고 에이전트 폴더에서 `docker compose up -d`를 실행합니다. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "This installs the agent for **`swarm-1`** — keep `DOCKER_SWARM_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "이 명령은 **`swarm-1`** 클러스터용으로 에이전트를 설치합니다. `DOCKER_SWARM_CLUSTER_NAME`을 그대로 두세요. 바꾸면 데이터가 새 클러스터로 등록됩니다.",
};

export default TRANSLATION;
