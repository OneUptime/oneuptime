import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "FlashArray의 관리 주소에 HTTPS(TCP 443)로 연결할 수 있는 머신에 설치된 Docker Engine 20.10 이상과 Docker Compose v2 플러그인",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "에이전트의 읽기 전용 사용자를 만들 FlashArray 관리자 계정",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "토큰은 **만료 없이** 만드세요. 그렇지 않으면 토큰이 만료되는 날 에이전트가 멈춥니다.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "관리자로 FlashArray에 SSH로 접속합니다. 첫 번째 명령은 새 사용자의 비밀번호를 묻고, 두 번째 명령은 그 사용자의 API 토큰을 출력합니다:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. **Settings → Users and Policies**를 엽니다(이전 릴리스에서는 **Settings → Access**).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. **Users** 패널의 ⋮ 메뉴에서 **Create User…** 항목을 선택하고, 이름을 `oneuptime`으로 지정한 뒤 **readonly** 역할을 부여합니다.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. 새 사용자의 ⋮ 메뉴에서 **Create API Token…** 항목을 선택하고, **Expires In**은 비워 둔 채 토큰을 복사합니다.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "`purefa_info{...} 1` 줄이 나오면 어레이가 메트릭을 자체적으로 제공하는 것이니 계속 진행하세요. **404**가 나오면 그 Purity//FA가 이전 버전입니다(Pure는 기본 엔드포인트를 6.7.0 이상으로 문서화하고, 익스포터의 지원 중단 공지는 6.6.11 이상이라고 합니다). 이 경우 이 가이드 위쪽에서 **FlashArray, 이전 버전 Purity**를 선택하세요.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "첫 줄은 스크립트를 `install.sh`로 내려받으므로 실행하기 전에 읽어 볼 수 있습니다.",
  "The command carries the platform you picked above. The script asks for:":
    "명령에는 위에서 선택한 플랫폼이 들어 있습니다. 스크립트는 다음을 묻습니다:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- **OneUptime URL**과 **수집 키**: 둘 다 1단계에 표시되며, 거기서 키를 선택하면 여기에 채워집니다",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- **어레이 이름**: OneUptime에서 어레이가 표시되는 이름입니다. 어레이마다 고유한 이름을 주고 바꾸지 마세요. 새 이름은 새 스토리지 어레이로 등록됩니다",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashArray의 **관리 주소**(호스트 이름 또는 IP, `https://` 없이)와 읽기 전용 사용자의 **API 토큰**: 토큰은 화면에 표시하지 않고 읽습니다",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- 어레이 인증서를 검증할지 여부: 어레이에 신뢰하는 CA의 인증서가 없다면 **N**으로 답하세요(어레이는 자체 서명 인증서와 함께 출고됩니다)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "`/opt/oneuptime-storage-array-agent`에 설치하고, 본인만 읽을 수 있는 `.env` 파일(API 토큰이 들어 있음)을 쓴 뒤 Docker Compose로 에이전트를 시작합니다.",
  "Download the compose file and the three collector configs from this OneUptime into a new folder:":
    "이 OneUptime에서 compose 파일과 컬렉터 구성 세 개를 새 폴더로 내려받습니다:",
  "Create a `.env` file next to them:": "그 옆에 `.env` 파일을 만듭니다:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- `my-storage-array`를 이 어레이의 이름(예: `fa-prod-01`)으로 바꾸세요. OneUptime에서 어레이가 이 이름으로 표시되므로 바꾸지 마세요. 새 이름은 새 스토리지 어레이로 등록됩니다.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- `PURE_FA_ENDPOINT`에는 FlashArray의 관리 주소(호스트 이름 또는 IP, `https://` 없이)를, `PURE_FA_API_TOKEN`에는 읽기 전용 사용자의 API 토큰을 설정하세요. 파일에 토큰이 들어 있으므로 `chmod 600 .env`를 실행하세요.",
  "Start the agent:": "에이전트를 시작합니다:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "로그에서 `Everything is ready. Begin running and processing data.`를 찾으세요. 그러면 첫 스크레이프 후 어레이가 **스토리지 어레이** 섹션에 자동으로 나타나며, 보통 1~2분 걸립니다.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "설치 스크립트는 이 값들을 `/opt/oneuptime-storage-array-agent/.env`에 씁니다. Docker Compose로 설치했다면 `docker-compose.yml` 옆의 `.env` 파일에서 읽습니다. 값을 바꾼 뒤에는 에이전트 폴더에서 `docker compose up -d`로 적용하세요.",
  "| Variable | Required | Description |": "| 변수 | 필수 | 설명 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 예 | OneUptime 인스턴스 URL(예: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 예 | 텔레메트리 수집 키, 1단계에서 선택한 키 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | 예 | 이 어레이가 OneUptime에 등록되는 이름입니다. 모든 메트릭에 리소스 속성 `storage.array.name`으로 붙습니다. 바꾸지 마세요. 바꾸면 새 스토리지 어레이가 등록됩니다 |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | 아니요 | 플랫폼이며, 리소스 속성 `storage.system`으로 붙습니다: `purestorage.flasharray` 또는 `purestorage.flashblade`(기본값: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | 아니요 | 실행할 기본 제공 구성: `otel-collector-config.yaml`(FlashArray 기본 엔드포인트, 기본값), `otel-collector-config.flasharray-exporter.yaml`(이전 FlashArray) 또는 `otel-collector-config.flashblade.yaml`(FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | 아니요 | 구성에 필요한 익스포터를 시작합니다. FlashArray 기본 구성에는 비워 두고, 나머지에는 `flasharray-exporter` 또는 `flashblade`를 씁니다 |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | FlashArray의 관리 주소: 호스트 이름 또는 IP, `https://` 없이 |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | readonly 역할을 가진 FlashArray 사용자의 API 토큰 |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | FlashBlade의 관리 주소: 호스트 이름 또는 IP, `https://` 없이 |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | readonly 역할을 가진 FlashBlade 사용자의 API 토큰 |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | 아니요 | `true`는 기본 엔드포인트에서 어레이의 자체 서명 인증서를 허용하고, `false`는 검증합니다(기본값: `true`). Pure의 익스포터는 어레이 인증서를 검증하지 않으므로 익스포터에는 적용되지 않습니다 |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | 아니요 | 에이전트의 컨테이너 이름(기본값: `oneuptime-storage-array-agent`). 같은 머신에 있는 두 번째 어레이의 에이전트에는 고유한 이름이 필요합니다. 설치 스크립트는 이 값을 설정하지 않으면 새 에이전트의 이름을 폴더 이름을 따서 짓고, 스크립트를 다시 실행해도 그 이름을 유지합니다 |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- 컬렉터는 토큰을 Bearer 자격 증명으로 사용해 HTTPS로 FlashArray 자체의 OpenMetrics 엔드포인트를 읽습니다. 익스포터는 실행되지 않습니다.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **엔드포인트마다 스크레이프 작업 하나**, 각각 필요한 만큼 자주 읽습니다: `/metrics/array`는 60초마다, `/metrics/volumes`, `/metrics/hosts`, `/metrics/pods`는 2분마다, `/metrics/directories`는 30분마다 읽습니다. 디렉터리 용량은 어레이가 계산하기에 부담이 크기 때문입니다.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **모든 작업은 시리즈에 `scrape_endpoint: <endpoint>` 레이블을 붙입니다**. 그래서 OneUptime은 배치가 어떤 객체의 전체 목록인지 압니다. 삭제된 객체가 인벤토리에서 빠지는 방식입니다. 레이블은 기본 제공된 그대로 두세요.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **볼륨별·호스트별 지연 시간은 세 가지 차원을 유지합니다**(`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`). `metric_relabel_configs` 규칙이 QoS, 큐, SAN, 서비스 시간 분석을 버리는데, 이 분석은 큰 어레이의 시리즈 수를 몇 배로 늘리기 때문입니다. 어레이 전체의 분석은 유지됩니다.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **`send_batch_max_size`는 쓰지 않습니다.** OneUptime은 한 번의 전체 스크레이프로 인벤토리를 다시 만들므로, `batch` 프로세서는 스크레이프를 나누지 않습니다.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "에이전트가 실행하는 전체 `otel-collector-config.yaml`입니다. `${env:...}` 값은 `.env` 파일이 제공합니다:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "에이전트는 syslog 리시버를 켜기 전까지 메트릭만 보냅니다. 어레이는 경고와 감사 이벤트를 syslog로 전달하며, 에이전트가 모든 줄에 `storage.array.name`을 붙이므로 이 어레이의 **로그** 페이지에 도착합니다.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. `otel-collector-config.yaml`에서 `syslog/tcp`, `syslog/udp` 리시버와 `logs` 파이프라인의 주석을 해제합니다. 기존 BSD syslog 타임스탬프에는 시간대가 없으므로, 어레이의 시계가 UTC로 동작하지 않는다면 `location`을 어레이의 시간대로 설정하세요.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. `docker-compose.yml`에서 `5514/tcp`와 `5514/udp`를 게시하는 `ports:` 블록의 주석을 해제하고, 어레이 관리 네트워크에 대해 머신 방화벽에서 포트를 여세요.",
  "3. Apply both:": "3. 둘 다 적용합니다:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. FlashArray에서 관리자로 **Settings → System → Syslog Servers**를 열고 `udp://<agent-host>:5514`(또는 `tcp://<agent-host>:5514`)를 추가한 뒤 테스트 메시지를 보냅니다.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "`oneuptime.label.` 접두사가 붙은 리소스 속성은 어레이의 프로젝트 레이블이 됩니다. `oneuptime.label.<dimension>=<value>`는 레이블 `<dimension>:<value>`입니다. 사용하는 컬렉터 구성의 `resource` 프로세서에 `storage.array.name` 옆에 추가하세요:",
  "Then restart the collector so it reads the new config:":
    "그런 다음 컬렉터가 새 구성을 읽도록 다시 시작합니다:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "어레이는 `team:storage`와 `env:production` 레이블이 붙은 채 나타납니다. 레이블은 대소문자를 구분하지 않고 비교하므로 기존 `Production` 레이블이 재사용되며, OneUptime 화면에서 추가한 레이블은 에이전트가 절대 제거하지 않습니다.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "모든 값은 FlashArray가 직접 계산하는 게이지입니다. 지연 시간은 작업당 마이크로초, 처리량은 초당 값입니다. OneUptime의 스토리지 어레이 페이지, 메트릭 카탈로그, 경고 템플릿은 다음을 바탕으로 합니다:",
  "| Endpoint | Data |": "| 엔드포인트 | 데이터 |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **어레이** (`/metrics/array`) | `purefa_info`, 용량과 데이터 절감(`purefa_array_space_*`), 성능, 열린 경고(`purefa_alerts_open`), 하드웨어 구성 요소, 드라이브, 컨트롤러, 네트워크 인터페이스 |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **볼륨** (`/metrics/volumes`) | 볼륨별 지연 시간, IOPS, 대역폭, 용량, 데이터 절감 |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **호스트** (`/metrics/hosts`) | 호스트별 연결 상태, 연결된 볼륨, 지연 시간, IOPS, 용량 |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pod** (`/metrics/pods`) | ActiveCluster와 ActiveDR 복제본 링크 지연, 미디에이터 상태, 성능, 용량 |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **디렉터리** (`/metrics/directories`) | FlashArray 파일 서비스의 관리 디렉터리 용량과 성능 |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "에이전트 하나는 어레이 하나를 읽습니다. 같은 머신에서 여러 어레이를 모니터링하려면 각각을 자체 `.env`와 고유한 컨테이너 이름을 가진 별도 폴더에 설치하세요. 두 컨테이너가 같은 이름을 쓸 수는 없습니다:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "`STORAGE_ARRAY_AGENT_CONTAINER_NAME`을 지정하지 않으면 스크립트가 폴더 이름을 따서 컨테이너 이름을 짓습니다. 스크립트는 그 이름을 해당 에이전트의 `.env`에 보관하므로, 에이전트를 업그레이드하려고 스크립트를 다시 실행해도 이름이 유지되며, `docker-compose.yml`에서 `container_name`을 직접 수정한 적이 있는 에이전트도 그 이름을 유지합니다. Docker Compose로 설치했다면 대신 각 에이전트의 `.env`에 `STORAGE_ARRAY_AGENT_CONTAINER_NAME`을 설정하세요.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "에이전트에는 설치 스크립트의 폴더인 `/opt/oneuptime-storage-array-agent`를 전제로 하는 systemd 유닛이 들어 있습니다. 설치 스크립트는 이 유닛을 내려받지 않으므로 직접 가져오세요:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**업그레이드**: 컬렉터 이미지는 `docker-compose.yml`에 고정되어 있고 구성은 그 옆의 파일들이므로, 이미지를 가져오는 것만으로는 에이전트가 새로워지지 않습니다. 설치 스크립트를 다시 실행하세요. 기존 `.env`의 모든 값을 재사용하고(아무것도 다시 묻지 않음), 최신 `docker-compose.yml`과 컬렉터 구성을 내려받으며(편집한 파일은 새 파일 옆에 `<file>.bak.<timestamp>`로 보관됨), 그것으로 에이전트를 다시 만듭니다:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "`/opt/oneuptime-storage-array-agent` 밖에 설치한 에이전트(예: 두 번째 어레이용)는 폴더를 지정해야 합니다: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the three collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "Docker Compose로 설치했다면 에이전트 폴더에서 compose 파일과 컬렉터 구성 세 개를 다시 내려받으세요. `.env`는 그대로 남지만, 이 파일들에 직접 한 변경은 다시 해야 합니다:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "그런 다음 이미지를 가져와 에이전트를 다시 만들어, 컬렉터가 새 구성을 읽게 합니다:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "구성은 고정한 컬렉터 버전을 어레이의 **에이전트 버전**으로 보고합니다. 이 OneUptime이 더 새 버전을 고정하면 그 옆의 경고 표시에서 이 명령을 열 수 있습니다.",
  "**Uninstall** the agent:": "에이전트 **제거**:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "그런 다음 더 이상 필요 없다면 어레이에서 읽기 전용 사용자와 그 API 토큰을 삭제하세요.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh`는 전체 경로(컨테이너 런타임, 컬렉터가 도달하는 그대로의 어레이 엔드포인트, 즉 기본 엔드포인트 또는 Pure의 익스포터와 DNS, TLS, API 토큰, 어레이 이름 부여, 컬렉터 자체 메트릭)를 확인하고, 수집 키를 받아들이는지 OneUptime에 직접 묻습니다. 마지막 확인이 가장 중요합니다. OneUptime의 OTLP 엔드포인트는 잘못된 키를 `401` 또는 `422`로 거부하는데, 컬렉터는 이를 배치마다 놓치기 쉬운 `Exporting failed` 한 줄로만 기록하므로 스크립트가 `GET /otlp/v1/validate`에 200/401 판정을 직접 요청합니다.",
  "It ends with a verdict naming the most likely cause.":
    "마지막에 가장 가능성 높은 원인을 알려 주는 판정을 표시합니다.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. 컬렉터 로그를 확인하세요: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401`은 어레이가 API 토큰을 거부했다는 뜻이고, `404`는 FlashArray에 기본 엔드포인트가 없다는 뜻, `x509`는 어레이의 자체 서명 인증서에 대해 TLS 검증이 켜져 있다는 뜻, `no such host` 또는 `connection refused`는 `PURE_FA_ENDPOINT`가 잘못되었다는 뜻, 내보내기의 `401`은 수집 키가 잘못되었다는 뜻입니다.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. `STORAGE_ARRAY_NAME`이 설정되어 있는지 확인하세요. 검색은 리소스 속성 `storage.array.name`을 기준으로 하며, 이 값이 없으면 컬렉터가 시작되지 않습니다.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. `STORAGE_ARRAY_COLLECTOR_CONFIG`와 `COMPOSE_PROFILES`가 같은 플랫폼을 가리키는지 확인하세요.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "이 FlashArray의 Purity//FA에는 기본 OpenMetrics 엔드포인트가 없습니다. `.env`에서 `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml`과 `COMPOSE_PROFILES=flasharray-exporter`를 설정하고 `docker compose up -d`를 실행하거나, 이전 버전 Purity 선택지로 `install.sh`를 다시 실행하세요. 어레이를 Purity//FA 6.7 이상으로 업그레이드한 뒤에는 기본 구성으로 돌아가고 프로필을 빼세요.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "사용자 비밀번호가 아니라 토큰을 붙여 넣었는지, 사용자가 아직 존재하고 readonly 역할을 가지고 있는지, 토큰이 만료되지 않았는지 확인하세요. 새 토큰을 만들고(FlashArray에서는 `pureadmin create --api-token oneuptime`), `.env`에 `PURE_FA_API_TOKEN`으로 넣은 뒤 `docker compose up -d`를 실행하세요.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "어레이는 기본적으로 자체 서명 인증서를 제시하며, 어떤 Docker 이미지도 이를 신뢰하지 않습니다. `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true`를 설정하거나(사설 관리 네트워크에서 현실적인 선택), 컬렉터 이미지가 신뢰하는 CA의 인증서를 어레이에 설치하세요.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` 또는 `pure-fb-exporter`가 실행되고 있지 않습니다. `COMPOSE_PROFILES`는 `STORAGE_ARRAY_COLLECTOR_CONFIG`와 일치해야 합니다. FlashArray 익스포터 구성에는 `flasharray-exporter`, FlashBlade 구성에는 `flashblade`입니다. `.env`를 고치고 `docker compose up -d`를 실행하면 `docker compose ps`에 익스포터가 나타납니다.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. 에이전트가 실행 중인지 확인하세요: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. 에이전트 로그에서 오류를 확인하세요: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. OneUptime URL과 수집 키가 올바른지 확인하세요.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 에이전트 머신이 네트워크를 통해 OneUptime 인스턴스에 연결할 수 있는지 확인하세요.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "어레이의 식별자는 `STORAGE_ARRAY_NAME`에서 오며, 모든 메트릭에 `storage.array.name`으로 붙습니다. `.env`에서 고친 뒤 에이전트 폴더에서 `docker compose up -d`로 적용하세요. 새 이름은 새 스토리지 어레이로 등록된다는 점에 유의하세요.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "어레이를 **`array-1`** 이름으로 등록합니다. 이 어레이가 OneUptime에서 이미 쓰고 있는 이름입니다.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- 이 명령은 **`array-1`** 어레이용 에이전트를 설치합니다. `STORAGE_ARRAY_NAME`을 정확히 그대로 두세요. 그렇지 않으면 데이터가 새 스토리지 어레이로 등록됩니다.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "어레이의 식별자는 `STORAGE_ARRAY_NAME`에서 오며, 모든 메트릭에 `storage.array.name`으로 붙습니다. 이 어레이의 이름: **`array-1`**. `.env`에서 고친 뒤 에이전트 폴더에서 `docker compose up -d`로 적용하세요. 새 이름은 새 스토리지 어레이로 등록된다는 점에 유의하세요.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "명령에는 이미 OneUptime URL, 수집 키, 위에서 선택한 플랫폼이 들어 있습니다. 스크립트는 다음을 묻습니다:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "그 머신에서 `quay.io`(Docker가 Pure의 익스포터 이미지를 가져오는 곳)에 대한 접근",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter`는 Pure의 익스포터인 `pure-fa-exporter`를 컬렉터 옆에서 시작합니다. 둘은 일치해야 합니다.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "에이전트 폴더에서 `docker compose ps`를 실행하면 **`pure-fa-exporter`** 컨테이너도 나열됩니다. 컬렉터가 FlashArray를 읽을 때 거치는 Pure의 익스포터입니다.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- 컬렉터는 Pure의 익스포터인 `pure-fa-exporter`를 거쳐 FlashArray를 읽습니다. 익스포터는 컬렉터가 스크레이프할 때마다 보내는 토큰으로 FlashArray의 REST API에 로그인합니다. 익스포터의 포트는 compose 네트워크 안에 머뭅니다.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "FlashBlade의 관리 주소에 HTTPS(TCP 443)로 연결할 수 있는 머신에 설치된 Docker Engine 20.10 이상과 Docker Compose v2 플러그인",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "에이전트의 읽기 전용 사용자를 만들 FlashBlade 관리자 계정",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "FlashBlade에서 관리자로 **readonly** 역할을 가진 `oneuptime` 사용자를 만들고(FlashBlade GUI의 사용자 설정 또는 Purity//FB CLI의 `pureadmin`으로), 이 사용자의 **API 토큰**을 만드세요. 토큰은 **만료 없이** 만드세요. 그렇지 않으면 토큰이 만료되는 날 에이전트가 멈춥니다.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "FlashBlade API 토큰은 `T-`로 시작합니다. 로컬 사용자가 없는 Purity//FB 릴리스에서는 대신 그룹이 readonly 역할에 매핑된 디렉터리 서비스(LDAP 또는 Active Directory) 계정을 사용합니다.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashBlade의 **관리 주소**(호스트 이름 또는 IP, `https://` 없이)와 읽기 전용 사용자의 **API 토큰**: 토큰은 화면에 표시하지 않고 읽습니다",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- `PURE_FB_ENDPOINT`에는 FlashBlade의 관리 주소(호스트 이름 또는 IP, `https://` 없이)를, `PURE_FB_API_TOKEN`에는 읽기 전용 사용자의 API 토큰을 설정하세요. 파일에 토큰이 들어 있으므로 `chmod 600 .env`를 실행하세요.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "에이전트 폴더에서 `docker compose ps`를 실행하면 **`pure-fb-exporter`** 컨테이너도 나열됩니다. 컬렉터가 FlashBlade를 읽을 때 거치는 Pure의 익스포터입니다.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- 컬렉터는 Pure의 익스포터인 `pure-fb-exporter`를 거쳐 FlashBlade를 읽습니다. 익스포터는 컬렉터가 스크레이프할 때마다 보내는 토큰으로 FlashBlade의 REST API에 로그인합니다. 익스포터의 포트는 compose 네트워크 안에 머뭅니다.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **엔드포인트마다 스크레이프 작업 하나**, 각각 필요한 만큼 자주 읽습니다: `/metrics/array`는 60초마다, `/metrics/filesystems`와 `/metrics/objectstore`는 5분마다 읽습니다. FlashBlade REST API는 모든 파일 시스템과 버킷을 빠르게 보고하도록 만들어지지 않았기 때문입니다.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. FlashBlade에서 관리자로 syslog 설정에 syslog 서버 `udp://<agent-host>:5514`(또는 `tcp://`)를 추가합니다.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "모든 값은 FlashBlade가 직접 계산하는 게이지입니다. 지연 시간은 작업당 마이크로초, 처리량은 초당 값입니다. OneUptime의 스토리지 어레이 페이지, 메트릭 카탈로그, 경고 템플릿은 다음을 바탕으로 합니다:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **어레이** (`/metrics/array`) | `purefb_info`, 용량과 데이터 절감(`purefb_array_space_*`), 프로토콜별 성능, 열린 경고(`purefb_alerts_open`), 하드웨어 상태(`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **파일 시스템** (`/metrics/filesystems`) | 파일 시스템별 용량, 데이터 절감, 성능 |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **오브젝트 스토어** (`/metrics/objectstore`) | 버킷별 용량, 할당량, 오브젝트 수, 성능 |",
};

export default TRANSLATION;
