import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "모니터링하려는 호스트에 설치된 Docker",
  "Network access from the host to your OneUptime instance":
    "호스트에서 OneUptime 인스턴스로의 네트워크 접근",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "`docker run`을 실행할 디렉터리에 이 내용을 `config.yaml`로 저장하세요. 3단계에서 이 파일을 컨테이너에 마운트합니다.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host`, `/hostfs` 바인드 마운트 덕분에 `hostmetrics`와 `process` 스크레이퍼가 컨테이너가 아닌 호스트 커널에서 CPU, 메모리, 디스크, 프로세스별 정보를 읽습니다. 이것이 없으면 컬렉터 컨테이너 자체의 메트릭만 보입니다.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "OneUptime에서 **호스트** 목록을 여세요. 첫 메트릭 배치가 도착하면(보통 30초 안에) 호스트가 자동으로 나타납니다. 보이지 않나요? 컬렉터를 확인하세요:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI 조사는 모든 호스트에서 기본적으로 켜져 있습니다**. 호스트 AI 에이전트가 호스트에서 실행되면 OneUptime AI는 `systemctl status`, `df -h`, `free -m`, `ps aux` 같은 읽기 전용 명령으로 그 호스트의 인시던트와 경고를 조사하며, 수정을 허용하지 않는 한 아무것도 바꾸지 않습니다. 자체 설치 프로그램이 있는 Linux 컨테이너입니다. 그러니 Linux 호스트에만 추가하세요. Compose 플러그인이 있는 Docker(rootless Docker가 아닌 시스템 엔진)가 필요합니다:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "첫 줄은 스크립트를 `install.sh`로 내려받으므로 실행하기 전에 읽어 볼 수 있습니다. 스크립트는 OneUptime URL, 수집 키, 호스트 이름을 묻습니다. 이름을 비워 두면 이 컬렉터가 보고하는 호스트 이름을 씁니다. 연결되면 호스트의 **AI → AI 에이전트** 페이지와 **개요** 아래쪽에 연결됨으로 표시됩니다. 실행할 수 있는 명령과 수정이 동작하는 방식: [인프라 AI 에이전트](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "구성은 이미 머신의 IP 주소, MAC 주소, 아키텍처, 머신 ID, OS 설명, OS 버전을 **인벤토리**에 있는 머신 항목에 채웁니다. CMDB 내보내기가 읽는 것이 이 항목입니다. 일련번호, 제조사, 모델, 펌웨어(BIOS / UEFI) 버전은 다릅니다. **어떤 리소스 검출기도 이 값을 만들 수 없습니다.** 이 값은 DMI를 통해 머신의 펌웨어에서 나옵니다. 프로비저닝할 때 한 번 읽어 리소스에 기록하세요. 이 프로세서를 컨테이너에 마운트한 `config.yaml`에 추가하고 메트릭 파이프라인에서 지정하세요. 구성에 이미 있는 섹션에 합치세요. `processors:`나 `service:` 키를 하나 더 추가하지 마세요.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "그런 다음 편집한 파일을 읽도록 컨테이너를 다시 만드세요. 컨테이너를 제거하고 3단계의 `docker run` 명령을 다시 실행합니다:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "이 값은 머신 고유의 것이므로 머신을 프로비저닝하는 쪽에서 한 번 기록합니다. Linux에서는 root로 읽으세요(`bios_version`은 누구나 읽을 수 있습니다):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "몇 분 안에 **인벤토리**에 있는 머신 항목의 **세부 정보** 아래에 값이 표시됩니다. 값은 검출된 것이 아니라 기록된 것이므로, 메인보드를 교체하거나 펌웨어를 업데이트한 뒤에는 다시 실행하세요.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version`, `host.bios.version`도 다른 표기로 받아들여져 위의 `device.*` 키 아래에 저장되므로(`device.serial_number`는 `host.serial_number` 아래에), 어느 쪽으로 쓴 구성이든 한곳에 모입니다.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **같은 구성에서 모바일 앱의 리소스와 호스트의 리소스에 모두 `device.manufacturer`를 설정하지 마세요.** `host.name`이나 `host.id`가 없는 리소스에서는 `device.manufacturer`가 여전히 배치를 모바일 Real User Monitoring으로 표시합니다.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "`oneuptime.label.` 접두사가 붙은 리소스 속성은 프로젝트 레이블로 승격되어 호스트(그리고 이 컬렉터가 내보내는 텔레메트리 서비스)에 붙습니다. 패턴: `oneuptime.label.<dimension>=<value>`는 `<dimension>:<value>`라는 레이블이 됩니다.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`resource` 프로세서를 컨테이너에 마운트한 `config.yaml`에 추가하고 메트릭 파이프라인에서 참조하세요. 구성에 이미 있는 섹션에 합치세요. `processors:`나 `service:` 키를 하나 더 추가하지 마세요.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "호스트에 `team:payments`, `env:production`, `region:us-east-1` 태그가 붙어 표시됩니다. 레이블은 대소문자를 구분하지 않고 비교하므로, 직접 만든 기존 `Production` 레이블은 중복되지 않고 재사용됩니다. OneUptime UI에서 직접 추가한 레이블은 컬렉터가 절대 지우지 않습니다.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "호스트는 `resourcedetection` 프로세서가 설정하는 OTel 리소스 속성 `host.name`으로 자동 발견됩니다. OneUptime은 `host.name`을 담은 배치가 다음 중 하나도 담고 있으면 호스트를 등록합니다:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- `hostmetrics` 리시버 메트릭(CPU, 메모리, 디스크, 파일 시스템, 네트워크, 부하, 프로세스), 또는",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- `process` 스크레이퍼 메트릭(프로세스별 CPU/메모리/스레드), 또는",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- 메트릭, 로그, 트레이스에 붙은 `os.type` 또는 `container.runtime` 리소스 속성",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…그리고 개요, 메트릭, 프로세스, 로그 탭을 채우기 시작합니다. `host.id`나 `host.arch`만으로는 호스트가 등록되지 않으며, Kubernetes ID(`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …)를 담은 텔레메트리는 대신 해당 Kubernetes 클러스터 아래에 분류됩니다.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**OpenStack에서 실행하나요?** `detectors: [nova, system, env]`를 사용하면 `host.id`가 인스턴스의 UUID가 되어 OneUptime이 이 호스트를 인스턴스에 연결합니다. 또한 `nova: resource_attributes:` 아래에서 `host.name`을 `enabled: false`로 설정하면 이름이 `system`이 보고하는 그대로 유지됩니다.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "같은 리소스 속성이 **인벤토리**의 머신 항목이 되며, CMDB 내보내기가 읽는 것이 이 항목입니다. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description`, `os.version`은 모두 `resourcedetection` 프로세서에서 오고, 일련번호, 제조사, 모델, 펌웨어 버전은 검출기가 없어 따로 기록합니다(**일련번호, 제조사, 모델, 펌웨어 버전 기록** 참고).",
  "Once the host is reporting:": "호스트가 보고를 시작하면:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- **메트릭** 탭에 `system.*` 시계열이 표시됩니다.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- `process` 스크레이퍼를 켜면 **프로세스** 탭에 프로세스가 CPU 순으로 나열됩니다.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- **로그** 탭에는 리소스 속성에 `host.name`이 포함된 모든 로그가 실시간으로 표시됩니다.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "구성은 자신이 대상으로 하는 컬렉터 릴리스(`oneuptime.agent.version`)를 호스트의 **에이전트 버전**으로 보고합니다. 이 OneUptime이 더 새로운 릴리스를 고정하면 그 옆의 경고 표시가 이 단계들을 엽니다.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. 2단계의 구성을 같은 수집 키로 다시 저장하세요. 새 버전을 보고합니다. 직접 바꾼 내용은 모두 옮겨 오세요.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. 구성이 있는 폴더에서 새 릴리스를 설치하고 컬렉터를 다시 시작하세요:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. 컬렉터 로그에서 내보내기 오류를 확인하세요: `docker logs -f otel-collector`. HTTP `401`은 키가 없거나 잘못되었거나 만료되었다는 뜻이고, `422`는 키가 비활성화되었다는(또는 호스트 텔레메트리를 보낼 수 없는 브라우저 키라는) 뜻입니다. 1단계에서 작동하는 키를 선택하고 컨테이너에 마운트한 `config.yaml`의 `x-oneuptime-token`을 업데이트하세요.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. 호스트가 OneUptime에 연결할 수 있는지 확인하세요: 같은 머신에서 `curl -v <YOUR_ONEUPTIME_URL>/otlp`.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. 메트릭 파이프라인에 `resourcedetection`을 유지하세요. 이것이 `host.name`을 설정하며, OneUptime은 이 값으로 호스트를 알아봅니다.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "컬렉터가 자기 컨테이너의 커널 뷰를 읽고 있습니다. 3단계에 나온 그대로 `--network host`, `--pid host`, `/:/hostfs` 바인드 마운트, `HOST_*` 변수를 붙여 실행하세요. 이것이 없으면 `hostmetrics`와 `process` 스크레이퍼는 컬렉터 컨테이너 자체만 봅니다.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "`sudo`를 쓸 수 있는 Debian 또는 Ubuntu 호스트(amd64 또는 arm64)",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "현재 디렉터리에 이 내용을 `config.yaml`로 저장하세요. 3단계에서 설치합니다.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **네이티브 설치 참고:** Docker와 달리 패키지 설치는 `/proc`와 `/sys`를 직접 읽으므로 `HOST_PROC` 환경 변수나 `/hostfs` 마운트가 필요 없습니다. 패키지와 함께 제공되는 systemd 유닛은 권한 없는 `otelcol-contrib` 사용자로 실행됩니다. `process` 스크레이퍼가 다른 사용자의 프로세스를 보게 하려면 `CAP_SYS_PTRACE`를 부여하거나 root로 실행하세요.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib`에는 **v0.142.0**부터 `systemd` 리시버가 포함되어 있습니다. CPU 메트릭이 지금의 이름으로 정착하고 서비스가 아닌 유닛을 더 이상 조회하지 않는 **v0.143.0 이상**을 실행하세요. `/etc/otelcol-contrib/config.yaml`과 메트릭 파이프라인에 추가하면 켜집니다. 구성에 이미 있는 섹션에 합치세요. `processors:`나 `service:` 키를 하나 더 추가하지 마세요.",
  "Then restart the service:": "그런 다음 서비스를 다시 시작하세요:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "이 리시버는 **Linux 전용**이며 **알파** 단계입니다. `systemctl list-units`와 같은 읽기 전용 호출로 시스템 D-Bus에서 유닛 상태를 읽으며, systemd는 이를 권한 없이 허용하므로 `otelcol-contrib` 사용자로 실행되는 패키지 서비스에는 추가 권한이 필요 없습니다. 컨테이너로 실행한 컬렉터는 호스트의 버스에 연결할 수 없으므로 네이티브 설치를 사용하세요. 메트릭이 도착하면 호스트의 **Systemd 유닛** 탭에 수집된 모든 유닛과 현재 상태(`active`, `failed`, `inactive`, ...)가 채워집니다.",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "유닛마다 수집할 때마다 상태 집합에 데이터 포인트 8개, CPU 메트릭을 켜 두면 2개가 더 듭니다. 그러니 유닛이 수백 개인 호스트에서는 모두 수집하지 말고 `units:`를 좁히거나 `collection_interval`을 늘리세요.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI 조사는 모든 호스트에서 기본적으로 켜져 있습니다**. 호스트 AI 에이전트가 호스트에서 실행되면 OneUptime AI는 `systemctl status`, `df -h`, `free -m`, `ps aux` 같은 읽기 전용 명령으로 그 호스트의 인시던트와 경고를 조사하며, 수정을 허용하지 않는 한 아무것도 바꾸지 않습니다. 자체 설치 프로그램이 있는 Linux 컨테이너입니다. Compose 플러그인이 있는 Docker(rootless Docker가 아닌 시스템 엔진)가 필요합니다:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "구성은 이미 머신의 IP 주소, MAC 주소, 아키텍처, 머신 ID, OS 설명, OS 버전을 **인벤토리**에 있는 머신 항목에 채웁니다. CMDB 내보내기가 읽는 것이 이 항목입니다. 일련번호, 제조사, 모델, 펌웨어(BIOS / UEFI) 버전은 다릅니다. **어떤 리소스 검출기도 이 값을 만들 수 없습니다.** 이 값은 DMI를 통해 머신의 펌웨어에서 나오는데, 패키지 컬렉터는 권한 없이 실행되므로 직접 읽을 수 없습니다. 프로비저닝할 때 한 번 읽어 리소스에 기록하세요. 이 프로세서를 `/etc/otelcol-contrib/config.yaml`에 추가하고 메트릭 파이프라인에서 지정하세요. 구성에 이미 있는 섹션에 합치세요. `processors:`나 `service:` 키를 하나 더 추가하지 마세요.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`resource` 프로세서를 `/etc/otelcol-contrib/config.yaml`에 추가하고 메트릭 파이프라인에서 참조하세요. 구성에 이미 있는 섹션에 합치세요. `processors:`나 `service:` 키를 하나 더 추가하지 마세요.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- `systemd` 리시버를 켜면 **Systemd 유닛** 탭에 유닛 상태가 나열됩니다(**Systemd 유닛 탭 사용 설정** 참고).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. 컬렉터 로그에서 내보내기 오류를 확인하세요: `sudo journalctl -u otelcol-contrib -f`. HTTP `401`은 키가 없거나 잘못되었거나 만료되었다는 뜻이고, `422`는 키가 비활성화되었다는(또는 호스트 텔레메트리를 보낼 수 없는 브라우저 키라는) 뜻입니다. 1단계에서 작동하는 키를 선택하고 `/etc/otelcol-contrib/config.yaml`의 `x-oneuptime-token`을 업데이트하세요.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. `resourcedetection`을 `systemd` 리시버와 같은 메트릭 파이프라인에 두세요. 리시버는 각 유닛에 `systemd.unit.name`만 붙이므로, `host.name`이 없으면 샘플이 호스트에 연결되지 않습니다.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. `otelcol-contrib` v0.143.0 이상을 실행하세요. 이전 빌드는 시작할 때 `'receivers' unknown type: \"systemd\"`로 멈추거나 CPU 메트릭 이름을 다르게 붙입니다(**Systemd 유닛 탭 사용 설정** 참고).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. 컬렉터가 시스템 D-Bus에 연결할 수 있는지 확인하세요. `/run/dbus/system_bus_socket`이 있어야 하며, 컬렉터 사용자로 `systemctl list-units`를 실행해 보는 것이 가장 빠른 확인 방법입니다. root는 필요 없습니다.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "`sudo`를 쓸 수 있는 RHEL, CentOS, Fedora 또는 Amazon Linux 호스트(x86_64 또는 aarch64)",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "systemd를 실행하고 `sudo`를 쓸 수 있는 Linux 호스트(x86_64 또는 aarch64)",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "`/etc/systemd/system/otelcol-contrib.service`에 systemd 유닛을 두세요:",
  "Then enable and start it:": "그런 다음 사용 설정하고 시작하세요:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "패키지를 쓸 수 없을 때 사용하세요. 예를 들어 잠긴 서버나, 밖에서 계측하려는 컨테이너 기본 이미지입니다. `HOST_PROC` 환경 변수나 `/hostfs` 마운트는 필요 없습니다. 컬렉터는 커널 상태를 직접 읽으며, `User=root`로 `process` 스크레이퍼가 다른 사용자의 프로세스도 볼 수 있습니다(대신 `CAP_SYS_PTRACE`를 부여해도 됩니다).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "이 리시버는 **Linux 전용**이며 **알파** 단계입니다. `systemctl list-units`와 같은 읽기 전용 호출로 시스템 D-Bus에서 유닛 상태를 읽으며, systemd는 이를 권한 없이 허용하므로 추가 권한이 필요 없습니다. 컨테이너로 실행한 컬렉터는 호스트의 버스에 연결할 수 없으므로 네이티브 설치를 사용하세요. 메트릭이 도착하면 호스트의 **Systemd 유닛** 탭에 수집된 모든 유닛과 현재 상태(`active`, `failed`, `inactive`, ...)가 채워집니다.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "구성은 이미 머신의 IP 주소, MAC 주소, 아키텍처, 머신 ID, OS 설명, OS 버전을 **인벤토리**에 있는 머신 항목에 채웁니다. CMDB 내보내기가 읽는 것이 이 항목입니다. 일련번호, 제조사, 모델, 펌웨어(BIOS / UEFI) 버전은 다릅니다. **어떤 리소스 검출기도 이 값을 만들 수 없습니다.** 이 값은 DMI를 통해 머신의 펌웨어에서 나옵니다. 프로비저닝할 때 한 번 읽어 리소스에 기록하세요. 이 프로세서를 `/opt/otelcol-contrib/config.yaml`에 추가하고 메트릭 파이프라인에서 지정하세요. 구성에 이미 있는 섹션에 합치세요. `processors:`나 `service:` 키를 하나 더 추가하지 마세요.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "Mac(Apple 실리콘 또는 Intel)과 `sudo`용 관리자 계정",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "`/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`를 만드세요:",
  "Load it:": "불러오세요:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **위와 같이 contrib 빌드를 설치하세요.** core `otelcol` 빌드에는 `resourcedetection` 프로세서가 없어 이 구성으로는 시작하지 않습니다.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "구성은 이미 머신의 IP 주소, MAC 주소, 아키텍처, 머신 ID, OS 설명, OS 버전을 **인벤토리**에 있는 머신 항목에 채웁니다. CMDB 내보내기가 읽는 것이 이 항목입니다. 일련번호, 제조사, 모델, 펌웨어(BIOS / UEFI) 버전은 다릅니다. **어떤 리소스 검출기도 이 값을 만들 수 없습니다.** 이 값은 머신의 펌웨어에서 나옵니다. 프로비저닝할 때 한 번 읽어 리소스에 기록하세요. 이 프로세서를 `/etc/otelcol-contrib/config.yaml`에 추가하고 메트릭 파이프라인에서 지정하세요. 구성에 이미 있는 섹션에 합치세요. `processors:`나 `service:` 키를 하나 더 추가하지 마세요.",
  "Then restart the collector:": "그런 다음 컬렉터를 다시 시작하세요:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "이 값은 머신 고유의 것이므로 머신을 프로비저닝하는 쪽에서 한 번 기록합니다. Mac에서는 이렇게 읽으세요. 제조사는 `Apple Inc.`입니다:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model`은 모델 *식별자*(`MacBookPro18,3`)이지 판매명이 아닙니다. 그래도 `device.model.name`에 넣으세요. `device.model.identifier`는 배치를 모바일 앱으로 표시합니다.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803 이상 또는 Windows Server 2019 이상(내장 `tar.exe` 때문)",
  "An elevated PowerShell prompt (Run as administrator)":
    "관리자 권한으로 실행한 PowerShell 프롬프트",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "PowerShell 명령을 실행할 폴더에 이 내용을 `config.yaml`로 저장하세요. 3단계에서 이 파일을 제자리에 복사합니다.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "Windows에서는 업스트림 **`otelcol-contrib`** 컬렉터를 설치하세요. **v0.155.0**부터 호스트의 **서비스** 탭을 채우는 `windows_service` 리시버가 포함되어 있습니다. 관리자 권한으로 실행한 PowerShell 프롬프트에서 실행하세요:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **참고:** 서비스는 모든 Windows 서비스를 읽을 수 있도록 `LocalSystem`으로 실행됩니다. Windows에서 `load` 스크레이퍼는 *Processor Queue Length* 카운터로 부하 평균을 흉내 낼 뿐이며(0에서 시작), 카운터를 읽을 수 없으면 로그에 남기고 건너뛰고 나머지 `hostmetrics` 구성은 그대로 실행됩니다. [호스트용 OpenTelemetry Collector 문서](/docs/telemetry/host-otel-collector)에는 서명된 `.msi` 설치 프로그램도 나와 있습니다.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "로그는 Windows 응용 프로그램 이벤트 로그에 기록됩니다. **Event Viewer → Windows Logs → Application**(원본 `otelcol-contrib`)에서 확인하세요.",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "**v0.155.0**부터 `otelcol-contrib`에는 `windows_service` 리시버가 포함되어 있습니다. `C:\\Program Files\\otelcol-contrib\\config.yaml`과 메트릭 파이프라인에 추가하면 켜집니다. 구성에 이미 있는 섹션에 합치세요. `processors:`나 `service:` 키를 하나 더 추가하지 마세요.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "이 리시버는 **Windows 전용**이며 **알파** 단계입니다. 메트릭이 도착하면 호스트의 **서비스** 탭에 각 서비스의 실행 상태와 시작 유형이 자동으로 채워집니다.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "구성은 이미 머신의 IP 주소, MAC 주소, 아키텍처, 머신 ID, OS 설명, OS 버전을 **인벤토리**에 있는 머신 항목에 채웁니다. CMDB 내보내기가 읽는 것이 이 항목입니다. 일련번호, 제조사, 모델, 펌웨어(BIOS / UEFI) 버전은 다릅니다. **어떤 리소스 검출기도 이 값을 만들 수 없습니다.** 이 값은 WMI를 통해 머신의 펌웨어에서 나옵니다.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "머신에서 관리자 권한으로 실행한 PowerShell 프롬프트로 이것을 실행하세요. WMI를 조회해 *이 머신*에 맞는 정확한 YAML을 출력합니다:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "이미 들여쓰기된 프로세서 항목 하나를 출력합니다. `config.yaml`에 이미 있는 `processors:` 블록 안에 `resourcedetection:`, `resource:`, `batch:`와 나란히 추가하고(두 번째 `processors:` 키로 추가하지 마세요) 메트릭 파이프라인에서 지정하세요:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "더 이상 쓰이지 않는 `Get-WmiObject`가 아니라 `Get-CimInstance`를 사용하세요. 전자는 PowerShell 7 이상에는 없습니다. 값은 작은따옴표로 감싸고 안에 든 따옴표는 두 번 써서 출력하므로, 문장 부호가 든 일련번호나 모델도 올바른 YAML로 남습니다. 펌웨어가 비워 둔 필드는 `''`로 출력됩니다. 빈 값을 보내지 말고 그 속성을 빼세요.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "몇 분 안에 **인벤토리**에 있는 머신 항목의 **세부 정보** 아래에, 검출기가 이미 제공하는 IP 주소, MAC 주소, 머신 ID와 함께 `host.serial_number`, `device.manufacturer`, `device.model.name`, `device.firmware.version`이 표시됩니다. 값은 검출된 것이 아니라 기록된 것이라 스스로 업데이트되지 않으므로, 메인보드를 교체하거나 BIOS를 업데이트한 뒤에는 다시 실행하세요.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- `windows_service` 리시버를 켜면 **서비스** 탭에 각 서비스의 상태가 나열됩니다(**Windows 서비스 탭 사용 설정** 참고).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. 컬렉터 로그에서 내보내기 오류를 확인하세요: **Event Viewer → Windows Logs → Application**(원본 `otelcol-contrib`). HTTP `401`은 키가 없거나 잘못되었거나 만료되었다는 뜻이고, `422`는 키가 비활성화되었다는(또는 호스트 텔레메트리를 보낼 수 없는 브라우저 키라는) 뜻입니다. 1단계에서 작동하는 키를 선택하고 `C:\\Program Files\\otelcol-contrib\\config.yaml`의 `x-oneuptime-token`을 업데이트하세요.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. 일반적인 `Error 1064` 대신 실제 오류를 보려면 컬렉터를 포그라운드로 실행하세요:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified`는 서비스가 없는 파일을 가리킨다는 뜻입니다. `sc.exe qc "otelcol-contrib"`의 `BINARY_PATH_NAME`을 `C:\\Program Files\\otelcol-contrib`의 내용과 비교하세요. 압축 파일은 `otelcol-contrib.exe`를 풀어 주는 `otelcol-contrib_` 압축 파일이어야 합니다.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application**(원본 `otelcol-contrib`)에는 서비스 관리자가 삼켜 버린 시작 오류가 기록됩니다.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "`include_services`를 설정했는데도 모든 서비스가 보이면 컬렉터가 변경을 반영하지 않은 것입니다. 서비스를 다시 시작하고(`Restart-Service otelcol-contrib`) 서비스 탭이 이동 창을 새로 고칠 때까지 몇 분 기다리세요.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes 노드는 호스트 컬렉터가 아니라 **OneUptime Kubernetes 에이전트**가 모니터링합니다. 각 노드는 **호스트** 목록이 아니라 **Kubernetes** → 해당 클러스터 → **노드** 아래에 파드와 워크로드 옆에 표시됩니다. 아래 단계는 표준 클러스터에 에이전트를 설치합니다. Amazon EKS, Google GKE, Azure AKS, GKE Autopilot, EKS Fargate용 단계는 **Kubernetes** 섹션의 설치 가이드에 있습니다.",
  "A Kubernetes cluster running v1.23 or later":
    "v1.23 이상에서 실행되는 Kubernetes 클러스터",
  "`kubectl` and `helm` (v3) installed on your machine":
    "컴퓨터에 설치된 `kubectl`과 `helm`(v3)",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "클러스터가 다른가요? `kubectl config use-context <context-name>`으로 전환하세요.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-cluster`를 이 클러스터의 이름(예: `prod-us-east-1`)으로 바꾸세요. OneUptime에서 클러스터가 이 이름으로 표시되므로 바꾸지 마세요. 새 이름은 새 클러스터로 등록됩니다.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true`는 chart의 기본값대로 **AI 조사**를 켭니다. OneUptime AI는 Kubernetes AI 에이전트를 통해 읽기 전용 kubectl로 이 클러스터의 인시던트와 경고를 조사합니다.",
  "You should see:": "다음과 같이 보여야 합니다:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "컬렉터와 Kubernetes AI 에이전트, 그리고 노드마다 `-logs` Pod와 `-ebpf` Pod가 하나씩 있습니다. 모두 `Running` 상태가 되면 클러스터가 **Kubernetes** 섹션에 자동으로 나타나며, 보통 1~2분 걸립니다.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI 에이전트(기본적으로 켜짐, 읽기 전용).** `kubernetes-agent-ai-agent` Pod는 같은 API 키를 사용해 읽기 전용 kubectl(`get`, `describe`, `logs`, `events`, `top`)로 OneUptime AI가 이 클러스터의 인시던트와 경고를 조사할 수 있게 하며, 나중에 쓰기 권한을 주지 않는 한 아무것도 바꿀 수 없습니다. 클러스터를 열고 **AI → 에이전트** 로 이동하면 볼 수 있습니다. 필요 없나요? `--set aiAgent.enabled=true` 대신 `--set aiAgent.enabled=false`로 설치하세요.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "네임스페이스 규칙은 에이전트가 각 네임스페이스에서 무엇을 수집할지 정합니다. `default`, `production`, `staging`에서만 Pod 로그와 eBPF 데이터를 수집하려면:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "모두 유지하되 시끄러운 네임스페이스의 로그만 멈추려면, 해당 네임스페이스를 `podLogs`에서만 제외하세요:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **범위:** `podLogs`(컨테이너 stdout/stderr), `ebpfDiscovery`(eBPF 트레이스와 메트릭), `metrics`(네임스페이스가 있는 메트릭), `traces`(모든 스팬).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **패턴** 은 네임스페이스 이름 전체와 일치하며, `team-*`처럼 `*`를 쓸 수 있습니다. `exclude` 규칙은 항상 `include` 규칙보다 우선합니다.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **규칙을 설정하면 기본 규칙이 대체됩니다**. 기본 규칙은 `kube-system`을 `podLogs`와 `ebpfDiscovery`에서 제외합니다. 여전히 필요하다면 두 번째 예처럼 목록에 남겨 두세요.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- 노드와 클러스터 메트릭에는 네임스페이스가 없으므로 항상 유지됩니다.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json`에는 Helm 3.10 이상이 필요합니다.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**중요한 줄만 보내기.** 클러스터를 떠나기 전에 일정 심각도 미만의 Pod 로그 줄을 버립니다:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`을 받습니다. `WARN`은 경고, 오류, 치명적인 줄을 남깁니다. 심각도는 로그 줄 자체(`[ERROR]`, `level=warn`, `"level":"info"`)에서 읽습니다. 이 설정으로 Kubernetes 이벤트가 버려지는 일은 없습니다.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Pod 로그 끄기.** 메트릭은 영향을 받지 않습니다. 노드 컬렉터는 kubelet과 cAdvisor 메트릭을 위해 계속 실행되고, Pod 로그 읽기만 멈춥니다:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**로그를 읽는 방식 바꾸기.** 프리셋이 알아서 고르지만, 명시한 `logs.mode`가 항상 우선합니다:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: 각 노드의 `/var/log/pods`를 hostPath로 읽습니다(오버헤드가 가장 낮음, hostPath 필요).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: Deployment가 Kubernetes API를 통해 Pod 로그를 따라갑니다(어떤 클러스터에서도 동작).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: Pod 로그를 수집하지 않습니다.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "이렇게 하면 클러스터 안에서 응답하는 API 서버를 읽습니다. etcd, 스케줄러, 컨트롤러 관리자는 컨트롤 플레인 노드에서 응답하는데, 에이전트의 Pod가 이를 추측할 수 없으므로 각 노드의 주소를 지정하면 읽어 옵니다:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **스케줄러와 컨트롤러 관리자** 는 HTTPS를 제공하고 에이전트의 토큰을 받지만, kubeadm이 이들을 `127.0.0.1`에 바인딩합니다. 에이전트의 Pod가 도달할 수 있는 `--bind-address`를 지정하세요.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** 는 위와 같이 kubeadm의 `--listen-metrics-urls`(포트 2381, 노드의 주소를 추가하기 전까지 `127.0.0.1`에 바인딩)에서 일반 HTTP로 메트릭을 제공합니다. 또는 요구하는 클라이언트 인증서로 HTTPS 클라이언트 포트 2379를 수집하세요. `ca.crt`, `tls.crt`, `tls.key`를 `oneuptime-agent`의 Secret에 넣고 `controlPlane.etcd.clientCertSecret`에 그 이름을 지정합니다.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "자체 관리형 클러스터만 해당: 관리형 서비스(EKS, GKE, AKS)는 컨트롤 플레인 메트릭을 노출하지 않습니다.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "비용 모니터링은 기본적으로 켜져 있습니다. 에이전트에는 오픈 소스 OpenCost 엔진(과 그에 필요한 작은 Prometheus)이 포함되어 있으며, 클라우드 제공업체의 공개 정가로 노드와 볼륨의 가격을 매기고(자격 증명은 필요 없습니다) 각 네임스페이스와 워크로드의 비용을 보냅니다. 첫 한 시간이 지나면 클러스터의 개요와 비용 페이지에 첫 데이터가 나타납니다.",
  "On an agent installed before it was on by default, upgrade it:":
    "기본으로 켜지기 전에 설치한 에이전트라면 업그레이드하세요:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **끄기:** 같은 업그레이드에 `--set cost.enabled=false`를 추가하세요.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **이미 Kubecost나 OpenCost를 쓰고 있나요?** 에이전트가 그것을 찾아 함께 설치되는 엔진 대신 읽으며, 클러스터의 개요에도 그렇게 표시됩니다. 두 번째 엔진을 함께 설치하지 않으려면 `--set cost.engine.url=auto`를 추가하세요.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **온프레미스나 베어 메탈인가요?** `--set cost.opencost.customPricing.enabled=true`로 요금표를 설정하세요(리소스 시간당 USD, chart의 `values.yaml` 참조).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "전체 가이드: [Kubernetes 비용 관측성](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "에이전트는 모든 노드에서 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)을 실행합니다. Go, .NET, Java, Node.js, Python, Ruby, Rust 서비스의 HTTP/HTTPS, gRPC, SQL/Redis 트래픽을 SDK나 사이드카 없이 캡처하고, 트레이스, 요청(RED) 메트릭, 서비스 그래프 데이터를 컬렉터를 통해 보냅니다.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**요구 사항:** BTF가 있는 Linux 커널 **5.8+**(Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+에서 기본). eBPF Pod는 eBPF 프로그램을 로드하기 위해 **특권** 모드로 실행됩니다.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "노드의 커널이 오래되었거나, 특권 Pod가 허용되지 않거나, 서비스가 이미 OpenTelemetry SDK로 트레이스를 보내고 있어 중복을 원하지 않는다면 **끄세요**:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**신호 고르기.** 각 패밀리는 `--set ebpf.features.<name>=false`(또는 `=true`)로 켜고 끕니다:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | 기본값 | 추가되는 것 |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | 켜짐 | 서비스별 HTTP/gRPC 요청률, 오류, 지연 시간 |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | 켜짐 | 스팬 호출 수와 소요 시간(`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | 켜짐 | 호출자 → 피호출자 간선. 서비스 맵을 만듭니다 |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | 켜짐 | Pod 간 TCP/UDP 플로우 카운터 |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | 꺼짐 | 영역 간 네트워크 메트릭(카디널리티가 두 배가 됨) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | 켜짐 | 노드 수준 TCP RTT, 연결 실패와 재전송 카운터 |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**서비스 간 트레이스 전파**(Pod A → Pod B로 넘어가는 요청을 다른 노드에서도 하나의 트레이스로 잇는 것)는 **기본적으로 켜져** 있습니다. 이미 오가는 트래픽을 다시 써서 동작하는데(커널에서 평문 HTTP 요청을 넓히고, TLS와 원시 TCP에 TCP 옵션을 덧붙임), 이 바이트 계산에 실수가 있으면 스트림이 어긋납니다. 보고된 증상은 nginx 같은 L7 프록시를 거치는 전송이 응답이 ~64KB를 넘는 순간 멈추는 것입니다. 이런 증상이 보이거나 서비스 메시에서 Pod가 실패하기 시작하면 `--set ebpf.contextPropagation=false`로 끄세요. OpenTelemetry SDK는 이런 일 없이 사용자 공간에서 `traceparent`를 전파합니다.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "각 `oneuptime.labels.<key>=<value>`는 클러스터와, 클러스터가 보고하는 서비스와 호스트의 레이블 `<key>:<value>`가 됩니다. 레이블은 대소문자를 구분하지 않고 비교하므로 기존 `Production` 레이블이 재사용되며, OneUptime 화면에서 추가한 레이블은 에이전트가 절대 제거하지 않습니다.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "최신 chart로 **업그레이드** 하세요. `--reset-then-reuse-values`(Helm 3.14+)는 설정한 값(프리셋, 클러스터 이름, 필터)을 유지하고 나머지는 모두 새 chart에서 가져옵니다. 새 `--set` 플래그는 그 위에 추가하세요:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Helm 3.13 이하에서는 대신 설정한 값으로 업그레이드하세요:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "`--reuse-values`는 쓰지 마세요. 업그레이드하기 전 chart의 기본값까지 유지하기 때문에 새 chart의 기본값(eBPF 이미지 포함)이 절대 적용되지 않습니다.",
  "**Uninstall** the agent and its namespace:":
    "에이전트와 그 네임스페이스를 **제거** 하세요:",
  "| Category | Data |": "| 범주 | 데이터 |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **노드 메트릭** | CPU, 메모리, 파일 시스템, 네트워크 사용량 |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod와 컨테이너 메트릭** | CPU, 메모리, 네트워크 I/O, 재시작 |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **클러스터 메트릭** | 노드 상태, 할당 가능한 리소스, Pod와 워크로드 수 |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes 이벤트** | 경고, 오류, 스케줄링 이벤트 |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod 로그** | 각 노드에서 읽는 모든 컨테이너의 stdout/stderr |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **애플리케이션 트레이스** *(eBPF)* | 모든 Pod의 HTTP, gRPC, SQL/Redis 스팬. SDK나 코드 변경 불필요 |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **요청 메트릭과 서비스 그래프** *(eBPF)* | 서비스별 요청률, 오류, 지연 시간과 서비스 맵을 위한 호출자 → 피호출자 간선 |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **네트워크 플로우** *(eBPF)* | Pod 간 TCP/UDP 바이트와 패킷 카운터 |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **워크로드 비용** *(기본적으로 켜짐)* | 네임스페이스, 워크로드, Pod별 지출과 유휴 용량 및 효율. 경고를 설정할 수 있는 메트릭으로도 제공 |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "클러스터가 `hostPath` 볼륨이나 특권 Pod를 막고 있습니다. **GKE Autopilot** 과 **EKS Fargate** 에서는 정상입니다. 이 가이드 상단에서 해당 플랫폼을 고르고 그 단계를 따르세요. 반면 **OpenShift** 에서는 설치가 성공하지만 에이전트의 노드 Pod가 시작되지 않습니다. **Red Hat OpenShift** 를 고르세요.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "제한적인 Pod Security 정책이 있는 다른 클러스터에서는 실패한 릴리스를 제거하세요:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "그런 다음 `--set preset=gke-autopilot`을 추가해 설치 명령을 다시 실행하세요. 이 프리셋은 hostPath 대신 Kubernetes API로 Pod 로그를 읽고, 강화된 보안 컨텍스트를 적용하며, 특권이 필요한 eBPF와 프로파일링 Pod를 빼 둡니다.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. 에이전트의 Pod가 실행 중인지 확인하세요: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. 컬렉터 로그를 확인하세요: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. 설치 명령의 OneUptime URL과 수집 키가 올바른지 확인하세요.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. 클러스터가 네트워크를 통해 OneUptime 인스턴스에 연결할 수 있는지 확인하세요.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. AI 에이전트의 Pod를 확인하세요: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. 그 로그를 확인하세요: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Pod가 없나요? chart를 업그레이드하고(고급의 **에이전트 업그레이드 또는 제거** 참조) `--set aiAgent.enabled=true`를 추가하세요.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. 클러스터 이름이 일치하는지 확인하세요. 이 가이드가 설치하는 클러스터: **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. 에이전트의 RBAC 권한을 확인하세요: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 컬렉터 로그에서 내보내기 오류를 찾으세요: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **커널이 오래되었거나 BTF가 없음.** eBPF에는 BTF가 있는 Linux 5.8+가 필요합니다. 노드에서 `uname -r`로 확인하세요. 업그레이드할 수 없다면 `--set ebpf.enabled=false`로 eBPF를 끄세요.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **특권 Pod가 차단됨.** 잠금이 강한 일부 클러스터는 특권 Pod를 거부합니다. eBPF를 끄세요.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **호스트에서 `debugfs` / `tracefs` 를 쓸 수 없음.** TCP 통계 패밀리만 끄세요: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. eBPF Pod가 정상인지 확인하세요: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. OBI의 디버그 출력을 켜서 트래픽을 보는지 확인하세요: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`를 설정한 뒤 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`을 읽습니다.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 스팬이 그곳에는 나타나지만 OneUptime에는 없다면, 컬렉터 로그에서 내보내기 오류를 확인하세요: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
