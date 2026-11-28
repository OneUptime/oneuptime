import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "모든 노드의 Proxmox VE API에 포트 8006으로 연결할 수 있는 머신에 설치된 Docker Engine 20.10 이상과 Docker Compose v2 플러그인",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "읽기 전용 API 토큰을 만들기 위한 아무 PVE 노드의 root 셸 또는 Proxmox 웹 UI",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "가능하면 클러스터 밖의 머신, 또는 Proxmox HA가 다른 노드에서 다시 시작하는 VM. 노드 하나가 다운되면 에이전트는 다른 노드에서 클러스터를 읽지만, 에이전트 자신의 머신이 다운되면 그렇게 할 수 없습니다",
  "As root on any PVE node:": "아무 PVE 노드에서 root로:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- 첫 번째 줄은 `monitoring@pam`이 이미 있을 때만 실패하며, 해는 없습니다. API 토큰은 자체 시크릿을 가지므로 사용자에게는 비밀번호도 시스템 계정도 필요 없습니다.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add`는 토큰 시크릿을 출력합니다. 한 번만 표시되므로 지금 복사하세요. 토큰 ID는 `monitoring@pam!oneuptime`입니다.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- 권한이 분리된 토큰은 사용자에게도 있는 권한만 얻으므로, 역할은 토큰뿐 아니라 사용자에게도 부여합니다. 역할은 루트 경로 `/`에 있어야 합니다. pve-exporter는 클러스터 전체의 상태를 읽으므로, 하위 경로로 제한된 토큰은 `Permission check failed (/, Sys.Audit)`로 실패합니다.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. *Datacenter → Permissions → API Tokens*로 이동해 **Add**를 클릭합니다.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. 사용자를 선택하거나 만들고, 토큰에 `oneuptime` 같은 ID를 지정한 다음, **Privilege Separation**이 선택되어 있는지 확인하고 **Add**를 클릭합니다.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. 토큰 ID(`user@realm!tokenname`)와 시크릿을 복사합니다. 시크릿은 한 번만 표시됩니다.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. *Datacenter → Permissions*에서 **Add**를 두 번 클릭해 경로 `/`에 **PVEAuditor** 역할을 부여합니다. 한 번은 토큰의 **API Token Permission**으로, 한 번은 그 사용자의 **User Permission**으로 부여합니다.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "권한이 분리된 토큰은 사용자에게도 있는 권한만 얻으므로, 둘 다 역할이 필요합니다. 역할은 루트 경로 `/`에 있어야 합니다. pve-exporter는 클러스터 전체의 상태를 읽으므로, 하위 경로로 제한된 토큰은 `Permission check failed (/, Sys.Audit)`로 실패합니다.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "스크립트는 OneUptime URL과 수집 키를 묻습니다. 둘 다 1단계에 표시되며, 거기서 키를 선택하면 여기에 채워집니다. 그다음 다음 항목을 묻습니다:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **클러스터 이름**: OneUptime에서 클러스터가 표시되는 이름입니다. 클러스터마다 고유한 이름을 주고 바꾸지 마세요. 새 이름은 새 클러스터로 등록됩니다.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox VE API 호스트**: 아무 노드(예: `192.168.1.10`). 그 API가 응답하지 않는 동안 에이전트는 아래 목록의 다음 노드에서 클러스터를 읽습니다.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **번들 prometheus-pve-exporter**: 이미 실행 중인 것이 없다면 **Y**로 답하세요.",
  "- **API token** — the token id and secret from the previous step.":
    "- **API 토큰**: 이전 단계의 토큰 ID와 시크릿입니다.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **모든 노드의 주소**: 각 노드 자체의 주소를 쉼표로 구분해 입력하며, 가상 IP는 쓰지 않습니다. 토큰이 있으면 스크립트가 클러스터 자체의 목록을 제시하므로 Enter 키를 눌러 그대로 사용하세요. 첫 번째 노드가 다운되어 있을 때도 에이전트는 이 노드들에서 클러스터를 읽습니다.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI 에이전트**: 수정을 적용해도 되는지입니다. 읽기 전용으로 유지하려면 **N**으로 답하세요.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "`/opt/oneuptime-proxmox-agent`에 설치되고, `0600` 권한의 `.env` 파일을 쓰며, Docker Compose로 모든 것을 시작합니다. 스크립트를 다시 실행하면 다시 묻지 않고 그 `.env`의 내용을 모두 재사용하므로, 업그레이드도 이렇게 합니다.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps`에는 컬렉터(`oneuptime-proxmox-agent`), 노드 장애 조치(`oneuptime-pve-api-failover`), 번들 익스포터(`oneuptime-pve-exporter`, 직접 운영하는 익스포터를 쓰지 않는 경우), OneUptime AI 에이전트(`oneuptime-proxmox-ai-agent`)가 표시됩니다. 컬렉터 로그에서 `Everything is ready. Begin running and processing data.`를 찾으세요. 그러면 클러스터가 **Proxmox** 섹션에 자동으로 나타납니다.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**OneUptime AI 에이전트(기본적으로 켜짐, 읽기 전용).** AI 조사가 켜져 있습니다. OneUptime AI가 읽기 전용 `pvesh` 요청으로 이 클러스터의 인시던트와 경고를 조사할 수 있게 하며, 수정을 허용하지 않는 한 아무것도 바꾸지 않습니다. 고급의 **OneUptime AI 에이전트**를 참고하세요.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Proxmox VE 8.3 이상이 필요합니다. 1단계에서 수집 키를 선택하면 두 명령이 표시됩니다. 명령에는 키가 들어 있으며, Proxmox VE는 명령이 추가하는 웹훅 대상에 그 키를 보관합니다.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "그러면 각 게스트의 페이지에 마지막 백업이 표시되고, 클러스터의 **권장 사항**에서 **Backup Job Failed**와 **Node Fenced** 경고를 제안합니다.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "설치 스크립트가 이 값들을 `/opt/oneuptime-proxmox-agent/.env`에 작성합니다. 값을 바꾼 뒤에는 `/opt/oneuptime-proxmox-agent`에서 `docker compose up -d`로 적용하세요.",
  "| Variable | Required | Description |": "| 변수 | 필수 | 설명 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 예 | OneUptime 인스턴스 URL(예: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 예 | 텔레메트리 수집 키, 1단계에서 선택한 키 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | 예 | OneUptime에 표시되는 클러스터 식별자입니다. 모든 메트릭에 리소스 속성 `proxmox.cluster.name`으로 붙습니다. 바꾸지 마세요. 바꾸면 새 클러스터가 등록됩니다(기본값: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | 예 | 익스포터가 그 Proxmox VE API로 클러스터를 읽고 AI 에이전트가 질의하는 노드(예: `192.168.1.10`). 그 API가 응답하지 않는 동안에는 둘 다 `PVE_NODES`에서 응답하는 다음 노드를 사용합니다 |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | 클러스터인 경우 | 각 노드 자체의 API 주소를 쉼표로 구분해 대괄호로 묶은 값(예: `[192.168.1.10,192.168.1.11,192.168.1.12]`). 기본값은 `PVE_HOST` 하나뿐이며, 단일 노드라면 이것으로 충분합니다. 익스포터는 부팅 시 시작(Guest Down), 복제, 구독을 질의한 노드에 대해서만 읽으므로 각 노드에 차례로 질의합니다. 빠진 노드는 보이지 않습니다. `PVE_HOST`가 다운되면 에이전트는 이 중 다음 노드에서도 클러스터를 읽습니다. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | 아니요 | prometheus-pve-exporter의 주소(`host:port`, 스킴 없음). 기본값은 번들 익스포터(`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | 번들 익스포터와 AI 에이전트 | Proxmox API 토큰의 전체 ID(예: `monitoring@pam!oneuptime`, PVEAuditor, 읽기 전용) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | 번들 익스포터와 AI 에이전트 | Proxmox API 토큰 시크릿 |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | 아니요 | Proxmox API의 TLS 인증서 확인(기본값: `false`. PVE는 자체 서명 인증서로 제공됨) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | 아니요 | `pve-exporter`로 설정하면 번들 익스포터 컨테이너를 시작합니다 |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI 에이전트 자체의 설정은 **OneUptime AI 에이전트**에 있습니다.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "설치 스크립트가 **Run the bundled prometheus-pve-exporter?** 라고 물으면 **n**으로 답하고 익스포터의 주소(`host:port`, 스킴 없음)를 입력하세요.",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "에이전트의 컨테이너가 연결할 수 있는 주소, 즉 호스트의 LAN IP나 DNS 이름을 사용하세요. 컨테이너 안의 `localhost`는 컨테이너 자신입니다. OneUptime AI 에이전트를 사용한다면 `PVE_API_TOKEN_ID`와 `PVE_API_TOKEN_SECRET`을 `.env`에 남겨 두세요. AI 에이전트는 그 토큰으로 API를 읽습니다.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "에이전트는 30초마다 익스포터를 스크레이프합니다. 클러스터 컬렉터는 `PVE_HOST`에서(`PVE_HOST`가 다운된 동안에는 클러스터를 읽고 있는 노드에서) 한 번, 노드 컬렉터는 `PVE_NODES`의 각 노드마다 한 번입니다. 모든 시리즈에는 리소스를 식별하는 `id` 레이블(`node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, `storage/<node>/<storage>`)이 붙습니다:",
  "| Category | Metrics |": "| 범주 | 메트릭 |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **가용성** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **노드** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **게스트(VM / LXC)** | `pve_guest_info`와 `qemu/*`, `lxc/*` ID의 CPU / 메모리 / 네트워크 시리즈 |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **스토리지** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |": "| **HA**(고가용성) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **백업 적용 범위** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: 어떤 백업 작업에도 선택되지 않은 게스트(백업이 실행되었는지, 성공했는지는 드러나지 않음) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **부팅 시 시작** | 게스트별 `pve_onboot_status`. **Guest Down**이 읽습니다 |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **복제** | 스토리지 복제 작업별 `pve_replication_*` 시리즈. 그 `id` 레이블은 리소스가 아니라 작업 ID(예: `100-0`)입니다 |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "부팅 시 시작과 복제는 익스포터의 노드 컬렉터에서 오며, 노드 컬렉터는 익스포터가 질의한 노드만 읽습니다. `PVE_NODES`에 없는 노드에는 둘 다 없습니다.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "컬렉터는 `id` 레이블을 동등 비교로 필터링할 수 있는 데이터 포인트 속성 세 개로도 나눕니다(`transform/pve-identity` 프로세서). 모니터 조건과 대시보드 필터는 이 속성으로 일치시킵니다:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| 속성 | 값 | `qemu/100`의 예 |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster`(`qemu`와 `lxc`는 모두 `guest`가 됨) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | `id`에서 첫 번째 `/` 뒤의 모든 것(`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "원래의 `id` 레이블은 그대로 유지됩니다.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "에이전트는 노드 하나의 API를 통해 클러스터 전체를 읽습니다. 응답하는 동안에는 `PVE_HOST`의 API입니다. `oneuptime-pve-api-failover` 컨테이너가 15초마다 그 노드를 확인하고, 그 API가 응답을 멈추면 컬렉터는 `PVE_HOST`가 다시 응답할 때까지 `PVE_NODES`에서 응답하는 다음 노드로부터 클러스터를 읽습니다. `.env`에 API 토큰이 있으면, 응답은 하지만 클러스터에서 쿼럼을 가진 쪽과 끊어진 노드도 건너뜁니다. 그 노드의 관점에서는 다른 모든 노드가 다운된 것으로 보이기 때문입니다. OneUptime AI 에이전트도 호출할 때마다 같은 일을 합니다. 그래서 노드가 장애를 일으키면 그 노드에 대해 **Node Offline**이 발생하고, 나머지 클러스터는 계속 보고합니다.",
  "Its logs say which node the cluster is read from, and why.":
    "로그에는 클러스터를 어느 노드에서 읽고 있는지와 그 이유가 나옵니다.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "이것이 감당할 수 없는 것은 에이전트가 실행되는 머신입니다. 그 머신이 다운되면 클러스터 전체가 조용해지고 **Cluster Stopped Reporting**이 발생합니다. 에이전트는 클러스터 밖에서, 또는 Proxmox HA가 다른 노드에서 다시 시작하는 VM(`ha-manager add vm:<vmid>`, 공유 스토리지)에서 실행하고, 클러스터마다 하나만 실행하세요. 각 에이전트가 클러스터 전체를 읽으므로, 두 번째 에이전트가 있으면 모든 리소스가 두 번 보고됩니다. [노드가 다운되면](/docs/telemetry/proxmox#when-a-node-goes-down)을 참고하세요.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "이것은 에이전트가 실행하는 전체 `otel-collector-config.yaml`이며, `${env:...}` 값은 `.env` 파일이 제공합니다. `transform/pve-identity` 프로세서는 기본 제공 Proxmox 경고 템플릿과 대시보드 필터가 의존하는 `pve.scope` / `pve.type` / `pve.id` 속성을 만들어 냅니다. 구성을 사용자 지정할 때도 그대로 두세요:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "기본적으로 에이전트는 메트릭만 보내므로 클러스터의 **로그** 탭은 비어 있습니다. PVE 서비스는 systemd 저널에 로그를 쓰며, 제공되는 구성에는 `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd`, `qmeventd`용 `journald` 리시버가 주석 처리된 채 들어 있습니다.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **에이전트를 PVE 노드에서 실행하세요.** 저널은 호스트마다 있으므로 원격 에이전트는 읽을 수 없고, 각 노드는 자기 저널만 보냅니다. 메트릭 에이전트를 클러스터 밖에 두려면, 대신 각 노드에서 로그 전용 컬렉터를 하나 더 실행하세요.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. `otel-collector-config.yaml`의 `journald` 리시버와 `logs` 파이프라인, 그리고 `docker-compose.yml`의 저널 볼륨 두 개의 주석을 해제합니다.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **컬렉터 이미지를 바꾸세요.** 기본 이미지에는 `journalctl`이 없고, 저널을 읽을 수 없는 사용자로 실행됩니다. 이 래퍼를 빌드하고 `docker-compose.yml`의 `image:`가 그것을 가리키게 하세요:",
  "4. Apply it:": "4. 적용합니다:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "기본 이미지를 그대로 쓰고 싶다면, 문서에 `/var/log/syslog`를 따라 읽는 `filelog` 대안이 있습니다: [Proxmox 서비스 로그 보내기](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "`oneuptime.label.` 접두사가 붙은 리소스 속성은 클러스터의 프로젝트 레이블이 됩니다. `oneuptime.label.<dimension>=<value>`는 레이블 `<dimension>:<value>`입니다. `otel-collector-config.yaml`의 `resource` 프로세서에 `proxmox.cluster.name` 옆에 추가하세요:",
  "Then restart the collector so it reads the new config:":
    "그런 다음 컬렉터가 새 구성을 읽도록 다시 시작합니다:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "클러스터는 `team:platform`와 `env:production` 레이블이 붙은 채 나타납니다. 레이블은 대소문자를 구분하지 않고 비교하므로 기존 `Production` 레이블이 재사용되며, OneUptime 화면에서 추가한 레이블은 에이전트가 절대 제거하지 않습니다.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml`은 **`oneuptime-proxmox-ai-agent`** 컨테이너도 실행합니다. OneUptime AI가 이 클러스터의 인시던트나 경고를 조사하는 동안 이를 통해 읽기 전용 `pvesh` 명령(`pvesh get /cluster/status`, 게스트의 현재 상태, 노드의 실패한 작업)을 실행합니다. 그 안에 `pvesh` 바이너리는 없으며, 각 명령은 `PVE_HOST`의 Proxmox VE API에 대한 호출 한 번이 됩니다. `PROXMOX_CLUSTER_NAME`이라는 이름의 클러스터로 등록되며, 클러스터의 **AI → AI 에이전트** 페이지에 나타납니다.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **API 토큰이 확실한 한계입니다.** 컬렉터의 PVEAuditor 토큰(`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`)으로 읽으며, 이 토큰은 읽기 외에는 아무것도 할 수 없습니다. 직접 운영하는 익스포터를 쓰고 `.env`에 토큰이 없다면 하나 추가하세요.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- `ONEUPTIME_AI_ALLOW_WRITES=true`를 설정하지 않는 한 **읽기 전용**입니다. 수정(게스트 시작 또는 재부팅)에는 게스트의 전원을 다룰 수 있는 별도의 토큰도 필요하며, `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`으로 설정합니다. `pveum` 명령은 에이전트의 README에 있습니다. 에이전트가 이 클러스터의 게스트에서 실행된다면 그 게스트의 VMID를 `ONEUPTIME_AI_PROTECTED_TARGETS`에 넣으세요.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 확인: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- OneUptime AI를 쓰지 않는다면 `docker-compose.yml`에서 `oneuptime-proxmox-ai-agent` 서비스를 삭제하세요.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "실행할 수 있는 명령과 수정이 동작하는 방식: [인프라 AI 에이전트](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**업그레이드**: 컬렉터 이미지는 `docker-compose.yml`에 고정되어 있고 구성은 그 옆의 파일이므로, 이미지를 가져오는 것만으로는 에이전트가 새로워지지 않습니다. 설치 스크립트를 다시 실행하세요. 기존 `.env`의 모든 값을 재사용하고(아무것도 다시 묻지 않음), 최신 `docker-compose.yml`과 `otel-collector-config.yaml`을 내려받으며(편집한 파일은 새 파일 옆에 `<file>.bak.<timestamp>`로 보관됨), 이미지를 가져와 그것으로 에이전트를 다시 만듭니다:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "구성은 고정한 컬렉터 버전을 클러스터의 **에이전트 버전**으로 보고합니다. 이 OneUptime이 더 새 버전을 고정하면 그 옆의 경고 표시에서 이 명령을 열 수 있습니다.",
  "**Uninstall** the agent:": "에이전트 **제거**:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "그런 다음 더 이상 필요 없다면 *Datacenter → Permissions → API Tokens*에서 API 토큰을 삭제하세요.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh`는 전체 경로(컨테이너 런타임, 익스포터 스크레이프, 클러스터 이름 부여, 토큰 형식, 컬렉터 자체 메트릭)를 확인하고, 수집 키를 받아들이는지 OneUptime에 직접 묻습니다. 마지막 확인이 가장 중요합니다. OneUptime의 OTLP 엔드포인트는 잘못된 키를 `401` 또는 `422`로 거부하는데, 컬렉터는 이를 배치마다 놓치기 쉬운 `Exporting failed` 한 줄로만 기록하므로 스크립트가 `GET /otlp/v1/validate`에 200/401 판정을 직접 요청합니다.",
  "It ends with a verdict naming the most likely cause.":
    "마지막에 가장 가능성 높은 원인을 알려 주는 판정을 표시합니다.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. 에이전트가 실행 중인지 확인하세요(`/opt/oneuptime-proxmox-agent`에서): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. 에이전트 로그에서 오류를 확인하세요: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. OneUptime URL과 수집 키가 올바른지 확인하세요.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 에이전트 머신이 네트워크를 통해 OneUptime 인스턴스에 연결할 수 있는지 확인하세요.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. 익스포터가 응답하는지 확인하세요. 번들 익스포터는 포트를 호스트에 게시하지 않으므로, 그 네트워크 네임스페이스 안에서 curl을 실행하세요. `pve_*` 메트릭 줄이 보여야 합니다(직접 운영하는 익스포터라면 그 `host:9221`에 바로 curl을 실행하세요):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. API 토큰이 경로 `/`에서 **PVEAuditor** 역할을 가지고 있는지 토큰과 그 사용자 모두에서 확인하세요.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. 컬렉터 로그에서 스크레이프나 내보내기 오류를 확인하세요(`/opt/oneuptime-proxmox-agent`에서): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "API 토큰이 잘못되었거나 권한이 부족합니다. 토큰 ID 형식(`user@realm!tokenname`), 시크릿, 그리고 경로 `/`에서 **PVEAuditor** 역할이 토큰과 그 사용자에게 부여되어 있는지 다시 확인하세요. 익스포터 자체의 로그에 API의 응답이 나옵니다: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    '게스트 시리즈(`qemu/*`, `lxc/*` ID)는 익스포터의 클러스터 컬렉터에서 옵니다. 제공되는 구성은 이를 켜 둡니다(`cluster=1` 스크레이프 매개변수). 구성을 사용자 지정했다면 `cluster: ["1"]` 매개변수를 되돌리세요.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "게스트의 부팅 시 시작 플래그와 복제 작업은 게스트가 실행되는 노드에서 오며, 에이전트는 `PVE_NODES`의 노드만 읽습니다. 거기에 각 노드 자체의 주소를 `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`처럼 나열하고, `/opt/oneuptime-proxmox-agent`에서 `docker compose up -d`로 적용하세요. 편집 후 컬렉터가 시작되지 않으면 목록의 대괄호가 빠진 것입니다. `troubleshoot.sh`는 목록의 모든 노드를 확인합니다.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "클러스터의 식별자는 `PROXMOX_CLUSTER_NAME`에서 오며, 모든 메트릭에 `proxmox.cluster.name`으로 붙습니다. `.env`에서 고친 뒤 `/opt/oneuptime-proxmox-agent`에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **클러스터 이름**: **`pve-1`** 값을 정확히 입력하세요. 다른 이름은 새 클러스터로 등록됩니다.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "클러스터의 식별자는 `PROXMOX_CLUSTER_NAME`에서 오며, 모든 메트릭에 `proxmox.cluster.name`으로 붙습니다. 이 클러스터의 이름: **`pve-1`**. `.env`에서 고친 뒤 `/opt/oneuptime-proxmox-agent`에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "명령에는 이미 OneUptime URL과 수집 키가 들어 있습니다. 나머지는 스크립트가 묻습니다:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Proxmox VE 8.3 이상이 필요합니다. 첫 번째 명령은 `oneuptime`이라는 이름의 웹훅 대상을 추가합니다. 이 대상은 각 알림을 이 클러스터의 로그로 OneUptime에 보내고, 키와 클러스터 이름을 시크릿에 보관합니다. 두 번째 명령은 모든 알림을 그 대상으로 보냅니다. 알림이 같은 클러스터에 도착하도록 `my-proxmox-cluster`를 에이전트에 지정한 클러스터 이름으로 바꾸세요.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "그러면 각 게스트의 페이지에 마지막 백업이 표시되고, 클러스터의 **권장 사항**에서 **Backup Job Failed**와 **Node Fenced** 경고를 제안합니다. 전송을 중단하려면:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Proxmox VE 8.3 이상이 필요합니다. 첫 번째 명령은 `oneuptime`이라는 이름의 웹훅 대상을 추가합니다. 이 대상은 각 알림을 이 클러스터의 로그로 OneUptime에 보내고, 키와 클러스터 이름을 시크릿에 보관합니다. 두 번째 명령은 모든 알림을 그 대상으로 보냅니다. 명령에 이미 **`pve-1`** 값이 들어 있으므로 알림은 이 클러스터에 도착합니다.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "이 OneUptime에서 `docker-compose.yml`과 `otel-collector-config.yaml`을 새 폴더로 내려받습니다:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "그 옆에 `.env` 파일을 만드세요. 토큰 시크릿이 들어 있으므로 `chmod 600 .env`로 비공개로 유지하세요:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- `my-proxmox-cluster`를 이 클러스터의 이름(예: `pve-prod`)으로 바꾸세요. OneUptime에서 클러스터가 이 이름으로 표시되므로 바꾸지 마세요. 새 이름은 새 클러스터로 등록됩니다.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- `PVE_HOST`를 클러스터의 아무 노드로 설정하세요. 그 API가 응답하지 않는 동안 에이전트는 `PVE_NODES`의 다음 노드에서 클러스터를 읽으므로 가상 IP가 필요 없습니다.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- `PVE_NODES`를 각 노드 자체의 주소로 대괄호 안에 설정하세요. 가상 IP는 쓰지 않습니다. 익스포터는 부팅 시 시작(Guest Down), 복제, 구독을 질의한 노드에 대해서만 읽으므로 각 노드에 차례로 질의합니다. 빠진 노드는 보이지 않습니다.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- 이전 단계의 토큰을 입력하세요. `COMPOSE_PROFILES=pve-exporter`는 번들 prometheus-pve-exporter도 시작하며, 이 익스포터는 그 토큰으로 API를 읽습니다.",
  "Start the agent:": "에이전트를 시작합니다:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "에이전트는 `docker-compose.yml` 옆의 `.env` 파일에서 이 값들을 읽습니다. 값을 바꾼 뒤에는 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "`.env`에서 `COMPOSE_PROFILES`를 빼고, 대신 에이전트가 직접 운영하는 익스포터(`host:port`, 스킴 없음)를 가리키게 하세요:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "에이전트 폴더, 즉 `docker-compose.yml`이 있는 폴더에서 다음을 실행하세요.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**업그레이드**: 컬렉터 이미지는 `docker-compose.yml`에 고정되어 있고 구성은 그 옆의 파일이므로, 이미지를 가져오는 것만으로는 에이전트가 새로워지지 않습니다. 두 파일을 다시 내려받으세요. `.env`는 그대로 남지만, 두 파일 중 하나에 했던 변경은 다시 해야 합니다:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "그런 다음 이미지를 가져와 에이전트를 다시 만들어, 컬렉터가 새 구성을 읽게 합니다:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. 에이전트가 실행 중인지 확인하세요(에이전트 폴더에서): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. 컬렉터 로그에서 스크레이프나 내보내기 오류를 확인하세요(에이전트의 폴더에서): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "게스트의 부팅 시 시작 플래그와 복제 작업은 게스트가 실행되는 노드에서 오며, 에이전트는 `PVE_NODES`의 노드만 읽습니다. 거기에 각 노드 자체의 주소를 `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`처럼 나열하고, `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요. 편집 후 컬렉터가 시작되지 않으면 목록의 대괄호가 빠진 것입니다. `troubleshoot.sh`는 목록의 모든 노드를 확인합니다.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "클러스터의 식별자는 `PROXMOX_CLUSTER_NAME`에서 오며, 모든 메트릭에 `proxmox.cluster.name`으로 붙습니다. `.env`에서 고친 뒤 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- 이 명령은 **`pve-1`** 클러스터용 에이전트를 설치합니다. `PROXMOX_CLUSTER_NAME`을 정확히 그대로 두세요. 그렇지 않으면 데이터가 새 클러스터로 등록됩니다.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "클러스터의 식별자는 `PROXMOX_CLUSTER_NAME`에서 오며, 모든 메트릭에 `proxmox.cluster.name`으로 붙습니다. 이 클러스터의 이름: **`pve-1`**. `.env`에서 고친 뒤 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요. 새 이름은 새 클러스터로 등록된다는 점에 유의하세요.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**에이전트는 없지만 데이터는 적습니다.** Proxmox VE 9.0 이상은 각 노드의 메트릭을 직접 OneUptime으로 푸시합니다. HA 상태, 부팅 시 시작(**Guest Down**이 사용), 백업 적용 범위, 복제는 푸시되지 않으므로, 필요하다면 설치 스크립트나 Docker Compose를 사용하세요. 한 클러스터에는 둘 중 하나만 사용하세요. 둘 다 실행하면 모든 리소스가 두 번 보고됩니다.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 이상**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "*Datacenter → Metric Server*에서 메트릭 서버를 추가하기 위한 Proxmox 웹 UI",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "모든 노드가 포트 `443`으로 `<YOUR_ONEUPTIME_HOST>`에 연결할 수 있어야 함",
  "| Field | Value |": "| 필드 | 값 |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server**(서버) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port**(포트) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol**(프로토콜) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path**(경로) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |": "| **Headers**(헤더) | 아래의 JSON |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "데이터센터에 한 번만 추가하면 클러스터의 모든 노드가 각자 자기 메트릭을 푸시합니다.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime은 푸시를 에이전트가 보내는 것과 같은 `pve_*` 시리즈로 변환합니다. 클러스터는 Proxmox 클러스터 이름으로(독립형 노드는 노드 이름으로) 스스로 등록되어 **Proxmox** 섹션에 나타나며, 그곳의 노드, 게스트, 스토리지 페이지, 개요 차트, 메트릭 카탈로그, CPU / 메모리 / 스토리지 경고 템플릿은 에이전트를 쓸 때와 똑같이 동작합니다.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "각 노드는 자기 상태만 푸시하므로, 다운된 노드는 자신이 다운되었다고 보고할 수 없습니다. 아직 살아 있는 노드들이 대신 보고합니다:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- 마지막 보고 후 약 2분이 지나면 Proxmox 페이지에 **오프라인**으로 표시되고, 약 5분 후 **Node Offline**이 발생합니다.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk**도 그 노드를 오프라인으로 셉니다. 노드가 조용해진 지 약 7–9분 후, 5분 창 전체에 보고가 채워졌을 때 발생합니다.",
  "- Its next report brings it back.": "- 다음 보고가 오면 다시 돌아옵니다.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    '오프라인은 "보고 중단"을 뜻합니다. 멈춘 `pvestatd`, 중지된 `pmxcfs`, OneUptime으로 가는 네트워크 단절은 모두 똑같이 보입니다. 독립형 호스트나 클러스터 전체가 조용해지면 이를 보고할 노드가 남지 않으므로, 대신 클러스터가 **연결 끊김**이 됩니다. 7일이 넘게 조용한 노드는 더 이상 보고되지 않습니다. 이런 보고에는 메트릭 탐색기에서 `oneuptime.proxmox.inferred=not-reporting` 표시가 붙습니다.',
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "클러스터는 Proxmox 클러스터 이름으로 등록되고, 독립형 노드는 노드 이름으로 등록됩니다. 메트릭 서버의 *Resource Attributes*에 `proxmox.cluster.name` 리소스 속성을 설정해 두었다면 대신 그 값이 계속 사용됩니다.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime은 푸시를 에이전트가 보내는 `pve_*` 시리즈로 변환하므로, Proxmox 페이지와 CPU / 메모리 / 스토리지 경고 템플릿은 그대로 동작합니다. 원래의 `proxmox_*` 시리즈도 Proxmox VE가 보고하는 그 밖의 모든 것을 위해 메트릭 탐색기에서 계속 사용할 수 있습니다.",
  "Some alert templates need data only the agent collects:":
    "일부 경고 템플릿에는 에이전트만 수집하는 데이터가 필요합니다:",
  "| Needs the agent | Why |": "| 에이전트 필요 | 이유 |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA 상태 | 푸시되지 않음. **HA Resource in Error State** 템플릿에는 에이전트가 필요함 |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| 부팅 시 시작 플래그 | 푸시되지 않음. 부팅 시 시작하도록 설정된 게스트에 대해서만 호출하는 **Guest Down**에는 에이전트가 필요함 |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| 백업 적용 범위와 복제 | 푸시되지 않음. **Guest Not Backed Up**과 **Replication Failing**에는 에이전트가 필요함 |",
  "Every node has stopped reporting, or never started.":
    "모든 노드가 보고를 멈췄거나 한 번도 시작하지 않았습니다.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. *Datacenter → Metric Server*에서 OpenTelemetry 항목을 확인하세요. 서버 `<YOUR_ONEUPTIME_HOST>`, 포트 `443`, 프로토콜 `https`, 경로 `/otlp/v1/metrics`, 그리고 1단계의 키가 들어간 `x-oneuptime-token` 헤더입니다.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. 노드가 네트워크를 통해 `<YOUR_ONEUPTIME_HOST>`에 연결할 수 있는지 확인하세요.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "보고가 멈췄습니다. 다운된 노드, 멈춘 `pvestatd`, 중지된 `pmxcfs`, OneUptime으로 가는 네트워크 단절은 모두 똑같이 보입니다. 다음 보고가 오면 다시 돌아옵니다. 노드를 클러스터에서 뺐다면 그 페이지에서 **노드 제거**를 사용하세요. 그렇지 않으면 최대 7일 동안 오프라인으로 남습니다.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "네이티브 푸시는 HA 상태, 부팅 시 시작, 백업 적용 범위, 복제를 보내지 않습니다. 대신 에이전트를 실행하려면 이 가이드 상단에서 **설치 스크립트** 또는 **Docker Compose**를 선택하고, 메트릭 서버는 제거하세요. 둘 다 실행하면 모든 리소스가 두 번 보고됩니다.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "이 클러스터는 OneUptime에서 **`pve-1`** 입니다. 그것이 Proxmox 클러스터 자체의 이름이 아니라면 메트릭 서버의 *Resource Attributes*에서 `proxmox.cluster.name`을 `pve-1`로 설정하세요. 그렇지 않으면 푸시가 새 클러스터를 등록합니다.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Proxmox VE 8.3 이상이 필요합니다. 첫 번째 명령은 `oneuptime`이라는 이름의 웹훅 대상을 추가합니다. 이 대상은 각 알림을 이 클러스터의 로그로 OneUptime에 보내고, 키와 클러스터 이름을 시크릿에 보관합니다. 두 번째 명령은 모든 알림을 그 대상으로 보냅니다. `my-proxmox-cluster`를 OneUptime에서 클러스터가 표시되는 이름, 즉 Proxmox 클러스터 이름이나 독립형 노드 자체의 이름으로 바꾸세요.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | 아니요 | 컬렉터의 컨테이너 이름(기본값: `oneuptime-proxmox-agent`). 같은 머신에 있는 두 번째 클러스터의 에이전트에는 고유한 이름이 필요합니다. 설치 스크립트는 이 값을 설정하지 않으면 새 에이전트의 컨테이너 이름을 폴더 이름을 따서 짓고, 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | 아니요 | API 장애 조치 사이드카의 컨테이너 이름(기본값: `oneuptime-pve-api-failover`). 설치 스크립트는 이 값을 설정하지 않으면 두 번째 클러스터의 API 장애 조치 사이드카 이름을 그 컬렉터 이름에 맞춰 짓고(`oneuptime-pve-api-failover-cluster2`, 컬렉터 `oneuptime-proxmox-agent-cluster2`와 나란히), 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | 아니요 | 번들 익스포터의 컨테이너 이름(기본값: `oneuptime-pve-exporter`). 설치 스크립트는 이 값을 설정하지 않으면 두 번째 클러스터의 번들 익스포터 이름을 그 컬렉터 이름에 맞춰 짓고(`oneuptime-pve-exporter-cluster2`, 컬렉터 `oneuptime-proxmox-agent-cluster2`와 나란히), 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | 아니요 | AI 에이전트의 컨테이너 이름(기본값: `oneuptime-proxmox-ai-agent`). 설치 스크립트는 이 값을 설정하지 않으면 두 번째 클러스터의 AI 에이전트 이름을 그 컬렉터 이름에 맞춰 짓고(`oneuptime-proxmox-ai-agent-cluster2`, 컬렉터 `oneuptime-proxmox-agent-cluster2`와 나란히), 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "에이전트 하나는 클러스터 하나를 읽습니다. 두 번째 클러스터에는 별도 폴더에 고유한 컨테이너 이름으로 두 번째 에이전트를 설치하세요. 두 컨테이너는 이름을 공유할 수 없습니다:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "변수(예: `PROXMOX_AGENT_CONTAINER_NAME`)를 설정하지 않으면 스크립트가 폴더 이름을 따서 컨테이너 이름을 짓습니다(예: `oneuptime-proxmox-agent-cluster2`). 스크립트는 그 이름을 해당 에이전트의 `.env`에 보관하므로, 같은 `INSTALL_DIR`로 스크립트를 다시 실행해 에이전트를 업그레이드해도 이름이 유지되며, `docker-compose.yml`에서 `container_name`을 직접 수정한 적이 있는 에이전트도 그 이름을 유지합니다.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "폴더마다 고유한 이름을 붙이세요. Docker Compose는 폴더 이름만으로 프로젝트 이름을 짓기 때문에, 스크립트는 다른 곳에서 이미 에이전트를 실행 중인 폴더와 같은 이름의 폴더를 거부합니다. 진단 스크립트에는 `-d`로 폴더를 넘기세요.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | 아니요 | 컬렉터의 컨테이너 이름(기본값: `oneuptime-proxmox-agent`). 같은 머신에 있는 두 번째 클러스터의 에이전트에는 고유한 이름이 필요합니다 |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | 아니요 | API 장애 조치 사이드카의 컨테이너 이름(기본값: `oneuptime-pve-api-failover`). 같은 머신에 있는 두 번째 클러스터의 에이전트에는 고유한 이름이 필요합니다 |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | 아니요 | 번들 익스포터의 컨테이너 이름(기본값: `oneuptime-pve-exporter`). 같은 머신에 있는 두 번째 클러스터의 에이전트에는 고유한 이름이 필요합니다 |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | 아니요 | AI 에이전트의 컨테이너 이름(기본값: `oneuptime-proxmox-ai-agent`). 같은 머신에 있는 두 번째 클러스터의 에이전트에는 고유한 이름이 필요합니다 |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "에이전트 하나는 클러스터 하나를 읽습니다. 두 번째 클러스터에는 별도 폴더에 고유한 컨테이너 이름으로 두 번째 에이전트를 구성하세요. 두 컨테이너는 이름을 공유할 수 없습니다. 이름은 그 에이전트의 `.env`에 설정하세요:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "폴더마다 고유한 이름을 붙이세요. Docker Compose는 폴더 이름만으로 프로젝트 이름을 짓기 때문에, 같은 이름의 두 번째 폴더는 첫 번째 에이전트의 컨테이너를 대체합니다. 이름은 `docker-compose.yml`에 넣지 마세요. 업그레이드가 이 파일을 대체합니다.",
};

export default TRANSLATION;
