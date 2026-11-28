import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 이상",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "`/run/podman/podman.sock`에 있는 Podman의 Docker 호환 API 소켓. `sudo systemctl enable --now podman.socket`으로 켭니다",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "로그를 수집하려는 컨테이너는 `k8s-file` 로그 드라이버를 사용해야 합니다. rootful Podman의 기본값은 `journald`이며, 에이전트는 이를 읽을 수 없습니다",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "그런 다음 같은 URL, 키, 호스트 이름으로 OneUptime AI 에이전트를 옆에서 시작합니다. **AI 조사는 기본적으로 켜져 있습니다**: OneUptime AI가 이 호스트의 인시던트나 경고를 조사하는 동안 AI 에이전트를 통해 Podman의 Docker 호환 소켓에 읽기 전용 `docker` 명령을 실행하며, 수정을 허용하지 않는 한 아무것도 변경하지 않습니다. 고급의 **OneUptime AI 에이전트**를 참조하세요. AI 조사 없이 컬렉터를 실행하려면 이 명령을 건너뜁니다.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "`my-podman-host`를 이 호스트의 이름(예: `prod-podman-01`)으로 바꿉니다. OneUptime에서 호스트가 이 이름으로 표시되므로 바꾸지 마세요. 새 이름은 새 호스트로 등록됩니다.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "Look for this line in the logs:": "로그에서 다음 줄을 찾습니다:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "에이전트가 연결되면 호스트가 **Podman** 섹션에 자동으로 표시됩니다. 보통 1분 정도 걸립니다. OneUptime AI 에이전트는 호스트의 **AI → AI 에이전트** 페이지와 **개요** 하단에 연결됨으로 표시됩니다.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**메트릭은 있는데 로그가 없나요?** rootful Podman은 기본적으로 컨테이너 로그를 `journald`에 기록하며, 에이전트는 이를 읽을 수 없습니다. 컨테이너를 `--log-driver k8s-file`로 실행하세요. 고급의 **모든 컨테이너에서 로그 수집(k8s-file 로그 드라이버)** 항목을 참조하세요.",
  "| Variable | Required | Description |": "| 변수 | 필수 | 설명 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 예 | OneUptime 인스턴스의 URL(예: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | 예 | 1단계의 텔레메트리 수집 키 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | 아니요 | 이 호스트를 알아보기 쉬운 이름. 기본값은 `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | 아니요 | 에이전트가 Podman 소켓과 통신할 때 사용하는 Docker API 버전. 기본적으로 비어 있으며, 에이전트가 소켓과 협상합니다. 버전을 고정할 때만 설정하세요(문제 해결 참조) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1`~`ONEUPTIME_LOG_OPERATOR_5` | 아니요 | 에이전트가 읽지 못하는 로그 형식을 위해 직접 만든 컬렉터 오퍼레이터로, 하나씩 JSON으로 씁니다 |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "각각을 `-e NAME=value` 형식으로 `podman run`에 전달합니다. 나중에 하나를 바꾸려면 `podman rm -f oneuptime-podman-agent`로 에이전트를 제거하고 새 값으로 명령을 다시 실행합니다.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "에이전트는 Podman의 **`k8s-file`** 로그 드라이버가 쓰는 파일(`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`)을 읽으므로, 이를 사용하는 컨테이너(또는 Podman이 같은 파일 기반 드라이버로 취급하는 `json-file`)의 로그만 봅니다. rootful Podman의 기본값은 **`journald`** 드라이버이며 에이전트는 이를 읽을 수 없고, `syslog` 같은 원격 드라이버도 읽을 수 없습니다.",
  "Check a container's log driver, and Podman's default:":
    "컨테이너의 로그 드라이버와 Podman의 기본값을 확인합니다:",
  "Run a single container with `k8s-file`:":
    "컨테이너 하나를 `k8s-file`로 실행합니다:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Compose 서비스를 로테이션과 함께 `k8s-file`로 전환합니다:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "또는 `containers.conf`(rootful은 `/etc/containers/containers.conf`, rootless는 `~/.config/containers/containers.conf`)에서 이후에 만들어지는 모든 컨테이너의 기본값을 바꿉니다:",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "그런 다음 영향을 받는 컨테이너를 **다시 만드세요**(다시 시작만으로는 안 됩니다). 컨테이너는 만들어질 때의 로그 드라이버를 유지합니다. `journald`를 계속 써야 하나요? 에이전트는 여전히 소켓을 통해 메트릭을 수집하며, 파일 기반 드라이버가 필요한 것은 컨테이너 로그뿐입니다.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`(2단계에서 시작하는 두 번째 컨테이너)는 OneUptime AI가 이 호스트의 인시던트나 경고를 조사하는 동안 요청하는 `docker` 명령을 Podman의 Docker 호환 소켓을 통해 실행합니다. **AI 조사는 기본적으로 켜져 있습니다**: 연결되면 OneUptime AI가 이를 사용해 조사하며, 호스트의 **AI → AI 에이전트** 페이지와 **개요**에 상태가 표시됩니다. 조사를 끄려면 해당 페이지에서 **AI가 할 수 있는 작업**을 사용하고, AI 에이전트 없이 컬렉터를 실행하려면 `podman rm -f oneuptime-podman-ai-agent`로 제거합니다.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **기본적으로 읽기 전용입니다.** `docker ps`, `docker logs --tail 200 NAME`, `docker inspect`, `docker stats --no-stream` 같은 명령을 실행하며 `exec`, `run`, `rm`, `prune`은 절대 실행하지 않습니다. `docker inspect` 출력의 환경 값은 무엇이든 호스트를 떠나기 전에 마스킹됩니다.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **수정은 직접 켜야 합니다.** 명령에 `-e ONEUPTIME_AI_ALLOW_WRITES=true`를 추가하면 이름이 지정된 컨테이너를 다시 시작, 시작, 중지, 일시 중지, 강제 종료하거나 제한을 바꾸도록 허용할 수 있습니다. 옆의 `ONEUPTIME_AI_FIXES`는 각 수정에 승인이 필요한지(`ask-for-approval`, `automatic`, `bypass-approval`) 정하며, 호스트의 **AI → AI 에이전트** 페이지에 표시됩니다. `ONEUPTIME_AI_WRITE_TARGETS`(`web-*,api-*` 같은 쉼표로 구분한 glob)는 대상 컨테이너를 제한하고, `ONEUPTIME_AI_PROTECTED_TARGETS`는 절대 바꾸면 안 되는 컨테이너를 추가합니다. 자기 자신과 컬렉터는 절대 바꾸지 않습니다.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- 컬렉터와 같은 소켓이 필요하며, 소켓의 소유자가 root이므로 root로 실행됩니다. 소켓을 `:ro`로 마운트해도 API가 읽기 전용이 되지는 않습니다. 한계는 에이전트의 명령 정책입니다.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- 로그: `podman logs -f oneuptime-podman-ai-agent`. 실행할 수 있는 작업과 수정의 동작 방식: [인프라용 AI 에이전트](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| 태그 | 설명 |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | 최신 안정 릴리스(community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | 최신 안정 릴리스(enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | 고정된 버전(예: `10.0.31`) |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | GHCR에 미러링된 같은 이미지 |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "`podman run` 명령 끝의 `oneuptime/podman-agent:release` 대신 이 중 하나를 사용합니다.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**업그레이드**: 최신 이미지를 받고 실행 중인 에이전트를 제거합니다:",
  "Then run both `podman run` commands from step 2 again.":
    "그런 다음 2단계의 두 `podman run` 명령을 다시 실행합니다.",
  "**Uninstall:**": "**제거:**",
  "| Category | Data |": "| 범주 | 데이터 |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU 메트릭** | 총 사용량, 사용률, 스로틀링 시간(컨테이너별) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **메모리 메트릭** | 사용량, 한도, 비율, RSS, 캐시(컨테이너별) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **네트워크 메트릭** | 수신/송신 바이트와 패킷(컨테이너별) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **블록 I/O 메트릭** | 읽기/쓰기 바이트와 작업 수(컨테이너별) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **컨테이너 정보** | 가동 시간, 재시작 횟수, 프로세스 수 |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **컨테이너 로그** | `k8s-file` 로그 드라이버를 사용하는 모든 컨테이너의 stdout/stderr 로그 |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    '메트릭은 Podman의 Docker 호환 소켓을 통해 컬렉터의 `docker_stats` 리시버에서 오므로, 이름이 Docker 에이전트와 같습니다. 각 로그 줄은 그 줄이 나타내는 수준(`[ERROR]`, `level=warn`, `{"level":"info"}`)에서 심각도를 얻습니다. 수준이 없는 줄은 스트림에 따라 정해지며, stderr는 `ERROR`, stdout는 `INFO`입니다.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "`/run/podman/podman.sock`을 읽으려면 에이전트가 root로 실행되어야 합니다. `podman run` 명령에 `--user 0:0` 플래그가 있고 소켓이 켜져 있는지 확인하세요:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "이것은 rootful Podman의 소켓으로, 에이전트가 읽는 소켓입니다. Podman을 rootless로 쓰나요? 그렇다면 소켓은 `/run/user/<uid>/podman/podman.sock`(`systemctl --user enable --now podman.socket`으로 켭니다)이고 스토리지는 `~/.local/share/containers/storage`입니다. 대신 이를 에이전트 컨테이너의 `/run/podman/podman.sock`과 `/var/lib/containers/storage`에 마운트하세요. Podman 에이전트 문서를 참조하세요.",
  "The agent's logs show:": "에이전트의 로그에는 다음이 표시됩니다:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "최대값을 강제하는 서버는 더 새로운 클라이언트를 거부하고, 이 때문에 컬렉터가 종료되어 컨테이너가 재시작을 반복합니다. 에이전트는 `DOCKER_API_VERSION`이 버전을 지정할 때만 Docker API 버전을 고정하는데, 이전 에이전트 이미지는 `1.44`를 고정했습니다. 에이전트를 제거하고(`podman rm -f oneuptime-podman-agent`), 최신 이미지를 받은 뒤(`podman pull oneuptime/podman-agent:release`), `-e DOCKER_API_VERSION` 없이 2단계의 명령을 다시 실행하세요. 그러면 에이전트가 소켓과 버전을 협상합니다.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "그래도 버전을 고정하려면 소켓이 보고하는 버전을 넘지 마세요:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "명령에 추가합니다(예: `-e DOCKER_API_VERSION=1.41`). 새 서버도 이전 API 버전을 계속 제공하므로 고정한 버전은 업그레이드한 뒤에도 계속 동작합니다.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. 에이전트가 실행 중인지 확인합니다: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. 에이전트의 로그에서 오류를 확인합니다: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. `podman run` 명령의 OneUptime URL과 수집 키가 올바른지 확인합니다.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. 호스트가 네트워크를 통해 OneUptime 인스턴스에 연결할 수 있는지 확인합니다.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Podman 소켓이 에이전트에 마운트되었는지 확인합니다. 이미지에 셸이 없으므로 같은 마운트를 공유하는 일회용 컨테이너에서 확인합니다:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "그런 다음 에이전트의 로그에서 내보내기 오류를 찾고(`podman logs oneuptime-podman-agent 2>&1 | grep -i error`), 수집 키가 유효하고 만료되지 않았는지 확인합니다.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "메트릭은 들어오는데 **로그** 탭이 비어 있거나 에이전트 자신의 로그만 보이나요? 컨테이너가 파일 기반 로그 드라이버(`k8s-file` 또는 `json-file`)를 사용하지 않을 가능성이 큽니다. rootful Podman의 기본값은 `journald`이며, 에이전트는 이를 읽을 수 없습니다.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "1단계에서 `no files match the configured criteria`가 표시되거나 3단계에서 컨테이너의 파일이 하나도 나오지 않으면, 해당 컨테이너는 `k8s-file`을 사용하지 않습니다. 전환한 다음(고급의 **모든 컨테이너에서 로그 수집(k8s-file 로그 드라이버)** 참조) 하나씩 다시 만드세요. 컨테이너는 만들어질 때의 로그 드라이버를 유지합니다:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "호스트 페이지는 호스트 이름이 그 호스트의 식별자인 데이터를 보여 주며, 에이전트는 이 식별자를 `PODMAN_HOST_NAME`에서 가져옵니다. 호스트가 등록된 뒤 `PODMAN_HOST_NAME`을 바꾸면 OneUptime은 새 이름으로 두 번째 호스트를 등록하고, 로그는 그쪽에 들어갑니다. 에이전트가 보고하는 이름을 확인합니다:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "호스트 이름은 `PODMAN_HOST_NAME`에서 옵니다. 이것 없이 시작한 에이전트는 `podman-host`를 보고하므로, 그렇게 설정한 호스트는 모두 같은 호스트처럼 보입니다. 각 호스트에서 `PODMAN_HOST_NAME`에 고유한 이름을 설정하고 에이전트를 다시 만드세요. `podman rm -f oneuptime-podman-agent`를 실행한 뒤 새 이름으로 2단계의 명령을 실행합니다.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "이 명령은 **`web-1`** 호스트용으로 에이전트를 설치합니다. `PODMAN_HOST_NAME`을 그대로 두세요. 바꾸면 데이터가 새 호스트로 등록됩니다.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "`podman compose`용 Compose 공급자: `podman-compose` 또는 Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "두 번째 서비스는 같은 URL, 키, 호스트 이름을 사용하는 OneUptime AI 에이전트입니다. **AI 조사는 기본적으로 켜져 있습니다**: OneUptime AI가 이 호스트의 인시던트나 경고를 조사하는 동안 AI 에이전트를 통해 Podman의 Docker 호환 소켓에 읽기 전용 `docker` 명령을 실행하며, 수정을 허용하지 않는 한 아무것도 변경하지 않습니다. 고급의 **OneUptime AI 에이전트**를 참조하세요. AI 조사 없이 컬렉터를 실행하려면 `oneuptime-podman-ai-agent` 서비스를 삭제합니다.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "각각을 에이전트의 `environment:` 목록에 설정한 다음 `podman compose up -d`를 실행해 새 값으로 다시 만듭니다.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`(docker-compose.yml의 두 번째 서비스)는 OneUptime AI가 이 호스트의 인시던트나 경고를 조사하는 동안 요청하는 `docker` 명령을 Podman의 Docker 호환 소켓을 통해 실행합니다. **AI 조사는 기본적으로 켜져 있습니다**: 연결되면 OneUptime AI가 이를 사용해 조사하며, 호스트의 **AI → AI 에이전트** 페이지와 **개요**에 상태가 표시됩니다. 조사를 끄려면 해당 페이지에서 **AI가 할 수 있는 작업**을 사용하고, AI 에이전트 없이 컬렉터를 실행하려면 그 서비스를 삭제하고 `podman compose up -d --remove-orphans`를 실행합니다.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **수정은 직접 켜야 합니다.** `environment:` 목록에 `- ONEUPTIME_AI_ALLOW_WRITES=true`를 추가하면 이름이 지정된 컨테이너를 다시 시작, 시작, 중지, 일시 중지, 강제 종료하거나 제한을 바꾸도록 허용할 수 있습니다. 옆의 `ONEUPTIME_AI_FIXES`는 각 수정에 승인이 필요한지(`ask-for-approval`, `automatic`, `bypass-approval`) 정하며, 호스트의 **AI → AI 에이전트** 페이지에 표시됩니다. `ONEUPTIME_AI_WRITE_TARGETS`(`web-*,api-*` 같은 쉼표로 구분한 glob)는 대상 컨테이너를 제한하고, `ONEUPTIME_AI_PROTECTED_TARGETS`는 절대 바꾸면 안 되는 컨테이너를 추가합니다. 자기 자신과 컬렉터는 절대 바꾸지 않습니다.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "에이전트의 `image:` 줄에 있는 `oneuptime/podman-agent:release` 대신 이 중 하나를 사용합니다.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**업그레이드**: docker-compose.yml이 있는 폴더에서 최신 이미지를 받고 컨테이너를 다시 만듭니다:",
  "**Uninstall** — stop and remove everything the file started:":
    "**제거**: 파일이 시작한 모든 것을 중지하고 제거합니다:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    '`/run/podman/podman.sock`을 읽으려면 에이전트가 root로 실행되어야 합니다. docker-compose.yml에서 에이전트 서비스에 `user: "0:0"`이 있고 소켓이 켜져 있는지 확인하세요:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "최대값을 강제하는 서버는 더 새로운 클라이언트를 거부하고, 이 때문에 컬렉터가 종료되어 컨테이너가 재시작을 반복합니다. 에이전트는 `DOCKER_API_VERSION`이 버전을 지정할 때만 Docker API 버전을 고정하는데, 이전 에이전트 이미지는 `1.44`를 고정했습니다. 에이전트의 `environment:` 목록에서 `DOCKER_API_VERSION`을 빼고 `podman compose pull`과 `podman compose up -d`를 실행하세요. 그러면 에이전트가 소켓과 버전을 협상합니다.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "에이전트의 `environment:` 목록에 추가하고(예: `- DOCKER_API_VERSION=1.41`) `podman compose up -d`를 실행합니다. 새 서버도 이전 API 버전을 계속 제공하므로 고정한 버전은 업그레이드한 뒤에도 계속 동작합니다.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. docker-compose.yml의 OneUptime URL과 수집 키가 올바른지 확인합니다.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "호스트 이름은 `PODMAN_HOST_NAME`에서 옵니다. 이것 없이 시작한 에이전트는 `podman-host`를 보고하므로, 그렇게 설정한 호스트는 모두 같은 호스트처럼 보입니다. 각 호스트에서 `PODMAN_HOST_NAME`에 고유한 이름을 설정하고 `podman compose up -d`를 실행해 에이전트를 다시 만드세요.",
};

export default TRANSLATION;
