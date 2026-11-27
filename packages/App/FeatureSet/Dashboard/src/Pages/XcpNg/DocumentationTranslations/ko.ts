import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "모니터링할 풀에 연결된 Xen Orchestra 6.9 이상. OpenMetrics 플러그인은 XOA에서 Premium 라이선스가 필요하며, 소스에서 빌드한 Xen Orchestra에는 포함되어 있습니다",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "HTTPS로 Xen Orchestra에 연결할 수 있는 머신에 설치된 Docker Engine 20.10 이상과 Docker Compose v2 플러그인",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "에이전트가 연결하는 주소를 이름으로 담은 Xen Orchestra의 인증서. Xen Orchestra가 스스로 만드는 자체 서명 인증서에는 이름이 하나도 없어서 현재의 어떤 TLS 클라이언트도 이를 검증할 수 없습니다. 고급의 **Xen Orchestra 인증서**를 참고하세요",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. Xen Orchestra에서 *Settings → Plugins*를 열고 **openmetrics**를 찾습니다.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. 켭니다. 처음 시작할 때 시크릿을 만들어 보관하며, Xen Orchestra는 재시작한 뒤에도 이를 유지합니다.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. 플러그인 설정을 열고 **Prometheus secret**을 복사합니다. 다음 단계에서 에이전트에 넘겨줍니다. 그곳에서 직접 시크릿을 입력해 저장할 수도 있습니다.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "플러그인은 Xen Orchestra 자체의 주소와 인증서로 `/openmetrics/metrics`에서 응답하며, 시크릿이 담긴 요청에만 응답합니다. Xen Orchestra가 연결된 모든 풀을 제공하므로 에이전트 하나로 모두 다룰 수 있습니다.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "스크립트는 OneUptime URL과 수집 키를 묻습니다. 둘 다 1단계에 표시되며, 거기서 키를 선택하면 여기에 채워집니다. 그다음 다음 항목을 묻습니다:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Xen Orchestra의 주소** — 브라우저에서 여는 주소 그대로입니다. 예: `https://xo.example.com` 또는 `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **OpenMetrics 플러그인의 시크릿** — 이전 단계에서 복사한 값입니다. 입력하는 동안 표시되지 않습니다.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **이 Xen Orchestra를 부를 이름** — 각 풀이 자기 설정에 표시하는 이름입니다. Enter를 누르면 그 주소를 사용합니다.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "그런 다음 스크립트가 Xen Orchestra의 인증서를 읽습니다. 이 머신이 이미 그 인증서를 신뢰하면 에이전트도 같은 CA 번들을 신뢰합니다. 신뢰하지 않으면 스크립트가 인증서의 SHA-256 지문을 보여 줍니다. Xen Orchestra 머신에 있는 지문과 비교한 뒤 **y**로 답하면 그 인증서만 신뢰합니다. 검증을 끄는 일은 절대 없습니다. 무엇이든 설치하기 전에 시크릿으로 플러그인에 메트릭을 요청하고, Xen Orchestra가 보고하는 풀을 알려 줍니다.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "`/opt/oneuptime-xcp-ng-agent`에 설치하고, `0600` 권한의 `.env` 파일을 작성한 뒤 Docker Compose로 에이전트를 시작합니다. 스크립트를 다시 실행하면 다시 묻지 않고 그 `.env`의 내용을 모두 재사용하므로, 업그레이드도 이렇게 합니다.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps`에 `oneuptime-xcp-ng-agent`가 표시됩니다. 로그에서 `Everything is ready. Begin running and processing data.`를 찾으세요. 에이전트는 매분 Xen Orchestra를 읽으며, 보고된 각 풀은 Xen Orchestra가 붙인 이름으로 호스트, VM, 스토리지와 함께 **XCP-ng** 섹션에 나타납니다.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "설치 스크립트가 이 값들을 `/opt/oneuptime-xcp-ng-agent/.env`에 작성합니다. 값을 바꾼 뒤에는 `/opt/oneuptime-xcp-ng-agent`에서 `docker compose up -d`로 적용하세요.",
  "| Variable | Required | Description |": "| 변수 | 필수 | 설명 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 예 | OneUptime 인스턴스 URL(예: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 예 | 텔레메트리 수집 키, 1단계에서 선택한 키 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | 예 | Xen Orchestra의 `host` 또는 `host:port`, 스킴 없이 |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | 아니요 | `https`(기본값). `http`는 실험 환경에서만 쓰세요. 이때 시크릿이 암호화되지 않은 채 네트워크를 지납니다 |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | 예 | OpenMetrics 플러그인의 시크릿으로, Bearer 토큰으로 전송됩니다. 그 안의 `$`는 모두 `$$`로 씁니다 |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | 아니요 | OneUptime에서 이 Xen Orchestra를 부를 이름으로, 각 풀의 설정에 표시됩니다(기본값: 그 주소) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | 아니요 | `XO_ADDRESS`가 인증서에 없는 주소일 때 Xen Orchestra의 인증서를 대조할 이름 |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | 설치 스크립트 | 입력한 그대로의 Xen Orchestra 주소. 스크립트가 여기서 `XO_SCHEME`과 `XO_ADDRESS`를 도출합니다 |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | 설치 스크립트 | 에이전트가 그 인증서만 신뢰할 때 쓰는 Xen Orchestra 자체 인증서의 SHA-256 지문 |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | 설치 스크립트 | Xen Orchestra의 인증서를 발급한 CA 번들로, 스크립트가 `xo-ca.pem`에 복사합니다 |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | 아니요 | 기본 제공 **Read only** 역할의 사본만 가진 Xen Orchestra 사용자의 토큰. 설정하면 XCP-ng AI 에이전트가 실행되고 이 토큰으로 읽습니다 |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | 아니요 | 수정 전용: 수정을 허용하는 역할을 가진 다른 사용자의 토큰. 이것이 없으면 AI 에이전트는 아무것도 변경하지 않습니다 |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | 아니요 | AI 에이전트가 담당하는 풀의 XAPI UUID(기본값: 읽기 토큰이 볼 수 있는 유일한 풀) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | 아니요 | AI 에이전트가 등록할 풀로 `XCP_NG_POOL_ID`를 재정의합니다 |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | 아니요 | `true` 또는 `false`: OneUptime AI가 조사하는 동안 AI 에이전트의 읽기 전용 명령을 실행해도 되는지 여부(기본값: 켜짐) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | 아니요 | `off`, `ask-for-approval`, `automatic` 또는 `bypass-approval`: OneUptime AI가 수정을 적용하는 방식 |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | 아니요 | `true`이면 AI 에이전트가 변경용 토큰으로 수정을 적용할 수 있습니다. 그 밖의 값이면 읽기 전용으로 유지됩니다 |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | 아니요 | 수정이 건드릴 수 있는 대상(`vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` 또는 `schedule/<uuid>`), 쉼표로 구분(기본값: 모두) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | 아니요 | 같은 형식으로, OneUptime AI가 절대 변경하면 안 되는 것: AI 에이전트가 실행되는 VM과 Xen Orchestra 자체의 VM |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | 아니요 | AI 에이전트의 로그 수준: `debug`, `info`(기본값), `warn` 또는 `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | 아니요 | `xcp-ng-ai-agent`이면 AI 에이전트가 시작됩니다. 설치 스크립트는 읽기 토큰이 설정되어 있으면 이 값을 씁니다 |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "에이전트는 `docker-compose.yml` 옆의 `xo-ca.pem`으로 Xen Orchestra의 인증서를 검증합니다.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "에이전트는 읽을 때마다 `xo-ca.pem`만으로 Xen Orchestra의 인증서를 검증합니다. 이 파일에는 다음 세 가지 중 하나가 들어 있습니다:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Xen Orchestra 자체의 인증서**: SHA-256 지문(`XO_TLS_FINGERPRINT`)으로 고정되며, 에이전트는 그 인증서만 신뢰합니다.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **그 인증서를 발급한 CA**(`XO_CA_FILE`): 직접 운영하는 CA의 인증서일 때.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **이 머신의 CA 번들**: 이 머신이 이미 신뢰하는 인증서일 때.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "어느 경우든 인증서에는 에이전트가 연결하는 주소가 이름으로 들어 있어야 합니다. 에이전트는 현재의 모든 TLS 클라이언트처럼 인증서가 발급된 이름을 검증하며, 주체(subject)는 보지 않습니다. Xen Orchestra가 스스로 만드는 자체 서명 인증서에는 이름이 하나도 없어서, 고정하든 안 하든 에이전트가 이를 신뢰할 수 없고 `x509: certificate is not valid for any names`로 실패합니다. [Xen Orchestra 인증서](/docs/telemetry/xcp-ng#xen-orchestras-certificate)에 나온 대로, 그 주소를 이름으로 담은 인증서를 Xen Orchestra에 설정하세요. 직접 운영하는 CA에서 받거나, 주체 대체 이름(subject alternative name)이 있는 자체 서명 인증서를 쓰면 됩니다.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "인증서가 `XO_ADDRESS`의 주소와 다른 이름으로 Xen Orchestra를 가리키면 `XO_TLS_SERVER_NAME`을 그 이름으로 설정하세요. 고정한 인증서가 갱신되면 에이전트는 새 인증서를 신뢰할 때까지 Xen Orchestra 읽기를 멈춥니다. 설치 스크립트를 다시 실행하세요. 새 지문을 보여 주고 아무것도 바꾸지 않은 채 멈춥니다. 그 지문을 Xen Orchestra 머신에서 확인한 뒤, 그 지문으로 스크립트를 한 번 더 실행하세요: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "에이전트는 매분 플러그인을 읽고, 플러그인은 각 호스트의 XAPI 라운드 로빈 데이터베이스를 60초 해상도로 읽습니다. 에이전트는 `xcp_*` 시리즈를 남기고, 각 시리즈의 풀을 보내는 배치로 옮겨 `xcp_ng.pool.id`(바뀌지 않는 풀의 UUID)와 `xcp_ng.pool.name`으로 붙입니다:",
  "| Category | Series |": "| 범주 | 시리즈 |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **풀** | `xcp_pool_connected` — Xen Orchestra가 풀에 연결되어 있는 동안 존재 |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **호스트** | `xcp_host_status`(전원 상태와 활성화 여부), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, 인터페이스별 `xcp_host_network_*`, 스토리지 리포지토리별 `xcp_host_disk_*` |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*`(CPU 경합), `xcp_vm_memory_*`, 인터페이스별 `xcp_vm_network_*`, 디스크별 `xcp_vm_disk_*`, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **스토리지** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | XOSTOR를 실행하는 풀의 `xcp_xostor_*` |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    '컨트롤 도메인은 `is_control_domain="true"`인 VM으로 보고됩니다. 페이지에서는 따로 요청하지 않으면 숨겨집니다.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra는 처리량 시리즈 8개를 카운터로 지정하지만, 각각은 XAPI의 초당 비율을 담고 있습니다: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, 그리고 VM의 네트워크, 네트워크 오류, 디스크 읽기·쓰기 시리즈입니다. 에이전트는 값을 그대로 둔 채 이를 게이지로 바꾸므로, OneUptime은 이를 본래의 비율, 즉 초당 바이트 수나 오류 수로 저장합니다.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime은 풀마다 0/1 시리즈 4개를 추가하며, 경고 템플릿이 이를 읽습니다: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running`, `xcp_ng.vm.stopped_after_running`(지난 하루 안에 실행되었다가 중지되거나 일시 중지된 VM). 또한 모든 포인트에 `xcp_ng.scope`(`pool`, `host`, `vm`, `sr`, `vdi`, `xostor` 중 하나)와 `xcp_ng.id`(그 객체의 UUID)를 붙이며, 모니터와 대시보드는 이것으로 필터링합니다.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "남기지 않는 것: 어떤 풀에도 속하지 않는 Xen Orchestra 자체의 프로세스 시리즈(`xo_*`)와, 플러그인이 풀 없이 보내는 IPMI로 읽은 호스트 전력. 그중 각 VM의 추정 몫은 남깁니다.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with its own `container_name` in its `docker-compose.yml`:":
    "에이전트 하나는 Xen Orchestra 하나와 그것이 관리하는 모든 풀을 읽습니다. 두 번째 Xen Orchestra에는 별도 폴더에 두 번째 에이전트를 설치하고, 그 `docker-compose.yml`에 고유한 `container_name`을 지정하세요:",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "같은 풀을 관리하는 두 Xen Orchestra를 둘 다 읽지 마세요. 그 풀은 UUID로 보아 OneUptime에서 하나의 풀이므로 두 번 보고됩니다.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "`oneuptime.label.` 접두사가 붙은 리소스 속성은 에이전트가 읽는 각 풀의 프로젝트 레이블이 됩니다. `oneuptime.label.<dimension>=<value>`는 레이블 `<dimension>:<value>`입니다. `otel-collector-config.yaml`의 `resource` 프로세서에 `oneuptime.agent.version` 옆에 추가하세요:",
  "Then restart the collector so it reads the new config:":
    "그런 다음 컬렉터가 새 구성을 읽도록 다시 시작합니다:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "풀은 `team:platform`과 `env:production` 레이블이 붙은 채 나타납니다. 레이블은 대소문자를 구분하지 않고 비교하므로 기존 `Production` 레이블이 재사용되며, OneUptime 화면에서 추가한 레이블은 에이전트가 절대 제거하지 않습니다. 설치 스크립트를 다시 실행하면 편집한 `otel-collector-config.yaml`이 교체되고, 편집본은 옆에 `otel-collector-config.yaml.bak.<timestamp>`로 보관됩니다.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**업그레이드** — 컬렉터 이미지는 `docker-compose.yml`에 고정되어 있고 구성은 그 옆의 파일이므로, 이미지를 가져오는 것만으로는 에이전트가 새로워지지 않습니다. 설치 스크립트를 다시 실행하세요. 기존 `.env`의 모든 값을 재사용하고(아무것도 다시 묻지 않음), Xen Orchestra의 인증서를 같은 방식으로 검증하며, 최신 `docker-compose.yml`과 `otel-collector-config.yaml`을 내려받고(편집한 파일은 새 파일 옆에 `<file>.bak.<timestamp>`로 보관됨), 이미지를 가져와 그것으로 에이전트를 다시 만듭니다:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "구성은 고정한 컬렉터 버전을 각 풀의 **에이전트 버전**으로 보고합니다. 이 OneUptime이 더 새 버전을 고정하면, 그 옆의 경고 표시가 이 명령을 엽니다.",
  "**Uninstall** the agent:": "에이전트 **제거**:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "그런 다음 다른 무엇도 읽지 않는다면 Xen Orchestra에서 OpenMetrics 플러그인을 끄세요.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh`는 전체 체인, 즉 컨테이너, `xo-ca.pem`으로 검증하는 Xen Orchestra의 인증서, 플러그인과 그 시크릿, 보고되는 풀을 확인하고, 수집 키를 받아들이는지 OneUptime에 직접 묻습니다. 가장 중요한 것은 이 마지막 확인입니다. OneUptime의 OTLP 엔드포인트는 잘못된 키를 `401` 또는 `422`로 거부하는데, 컬렉터는 이를 배치마다 놓치기 쉬운 `Exporting failed` 한 줄로만 기록하기 때문입니다.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "마지막에 가장 가능성 높은 원인을 알려 주는 판정을 표시합니다. 시크릿은 절대 출력하지 않습니다.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime은 15분 동안 아무것도 읽히지 않은 풀을 '연결 끊김'으로 표시합니다.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. 이 Xen Orchestra의 모든 풀이 '연결 끊김'이면 에이전트를 확인하세요(`/opt/oneuptime-xcp-ng-agent`에서): `docker compose ps`와 `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. 하나만 그렇다면 Xen Orchestra가 그 풀의 보고를 멈춘 것입니다. Xen Orchestra의 *Settings → Servers*에서 그 풀의 서버가 연결되어 있어야 합니다. 풀의 호스트, VM, 스토리지는 Xen Orchestra가 마지막으로 보고한 상태로 남습니다.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "컬렉터 로그에 `server returned HTTP status 401 Unauthorized`가 기록됩니다. *Settings → Plugins → openmetrics*에서 시크릿을 다시 복사해 `.env`의 `XO_OPENMETRICS_SECRET`에 설정하고(작은따옴표로 감싸고, `$`는 모두 `$$`로 씀), `/opt/oneuptime-xcp-ng-agent`에서 `docker compose up -d`로 적용하세요. 6.8 이전의 Xen Orchestra는 재시작할 때마다 새 시크릿을 만들었습니다.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra는 응답하지만 OpenMetrics 플러그인은 응답하지 않습니다. *Settings → Plugins → openmetrics*에서 플러그인을 켜고(XOA에서는 Premium 라이선스가 필요함), Xen Orchestra가 6.9 이상인지 확인하세요. 플러그인이 실행되는 동안 `/openmetrics/health`는 시크릿 없이 `{"status":"ok"}`로 응답합니다.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — 인증서에 이름으로 든 주소가 없습니다. Xen Orchestra 자체의 자체 서명 인증서가 그렇습니다. 그 주소를 이름으로 담은 인증서를 Xen Orchestra에 설정하세요.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — 그 이름 중 하나로 연결하거나, `XO_TLS_SERVER_NAME`을 그중 하나로 설정하세요.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem`에 이 인증서도, 이를 발급한 CA도 들어 있지 않습니다. 인증서가 갱신되었거나 파일에 다른 인증서가 들어 있습니다. 고급의 **Xen Orchestra 인증서**에 나온 대로 다시 작성하세요.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra는 연결된 풀만 보고하고, 에이전트는 그 Xen Orchestra만 읽습니다. Xen Orchestra의 *Settings → Servers*에서 풀의 서버를 연결하면 다음 읽기 때 풀이 OneUptime에 나타납니다. 다른 Xen Orchestra가 읽는 풀에는 그 Xen Orchestra 옆에 별도의 에이전트가 필요합니다.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **이 Xen Orchestra를 부를 이름** — 명령에 이미 **`xo-paris`** 라는 이름이 들어 있으며, 이 풀의 설정에 표시된 그대로입니다.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "명령에는 이미 OneUptime URL과 수집 키가 들어 있습니다. 나머지는 스크립트가 묻습니다:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "이 OneUptime에서 `docker-compose.yml`과 `otel-collector-config.yaml`을 새 폴더로 내려받습니다:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "그 옆에 `.env` 파일을 만드세요. 플러그인의 시크릿이 들어 있으므로 `chmod 600 .env`로 비공개로 유지하세요:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- `XO_ADDRESS`를 Xen Orchestra의 `host` 또는 `host:port`로, `https://` 없이 설정하세요.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- 플러그인의 시크릿은 작은따옴표로 감싸세요. `$`가 들어 있으면 각각 `$$`로 쓰세요. 컬렉터가 값을 한 번 더 읽기 때문입니다.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME`은 각 풀의 설정이 이 Xen Orchestra를 부르는 이름입니다.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "그런 다음 Xen Orchestra의 인증서를 `docker-compose.yml` 옆의 `xo-ca.pem`으로 에이전트에 넘겨주세요. 에이전트는 이 파일만으로 Xen Orchestra를 검증합니다. Xen Orchestra 자체의 인증서를 신뢰하려면 인증서를 읽고, 그 지문을 Xen Orchestra 머신에 있는 지문과 대조하세요:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "직접 운영하는 CA가 발급했다면 대신 그 CA의 인증서를 `xo-ca.pem`에 복사하고, 공개 CA가 발급했다면 이 머신의 CA 번들을 복사하세요(`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "에이전트를 시작합니다:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "에이전트는 `docker-compose.yml` 옆의 `.env` 파일에서 이 값들을 읽습니다. 값을 바꾼 뒤에는 `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "인증서가 `XO_ADDRESS`의 주소와 다른 이름으로 Xen Orchestra를 가리키면 `XO_TLS_SERVER_NAME`을 그 이름으로 설정하세요. `xo-ca.pem`의 인증서가 갱신되면 3단계처럼 다시 읽은 뒤 `docker compose up -d --force-recreate`를 실행하세요.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "에이전트 폴더, 즉 `docker-compose.yml`이 있는 폴더에서 다음을 실행하세요.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**업그레이드** — 컬렉터 이미지는 `docker-compose.yml`에 고정되어 있고 구성은 그 옆의 파일이므로, 이미지를 가져오는 것만으로는 에이전트가 새로워지지 않습니다. 두 파일을 다시 내려받으세요. `.env`와 `xo-ca.pem`은 그대로 남지만, 두 파일 중 하나에 했던 변경은 다시 해야 합니다:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "그런 다음 이미지를 가져와 에이전트를 다시 만들어, 컬렉터가 새 구성을 읽게 합니다:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. 이 Xen Orchestra의 모든 풀이 '연결 끊김'이면 에이전트를 확인하세요(에이전트 폴더에서): `docker compose ps`와 `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "컬렉터 로그에 `server returned HTTP status 401 Unauthorized`가 기록됩니다. *Settings → Plugins → openmetrics*에서 시크릿을 다시 복사해 `.env`의 `XO_OPENMETRICS_SECRET`에 설정하고(작은따옴표로 감싸고, `$`는 모두 `$$`로 씀), `docker-compose.yml`이 있는 폴더에서 `docker compose up -d`로 적용하세요. 6.8 이전의 Xen Orchestra는 재시작할 때마다 새 시크릿을 만들었습니다.",
};

export default TRANSLATION;
