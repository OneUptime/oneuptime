import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 или новее, подключённый к пулам, которые вы хотите отслеживать. Его плагину OpenMetrics на XOA нужна лицензия Premium; Xen Orchestra, собранный из исходного кода, уже включает его",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 или новее с плагином Docker Compose v2 на машине, с которой Xen Orchestra доступен по HTTPS",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Сертификат на Xen Orchestra, в котором указан адрес, к которому подключается агент. Самоподписанный сертификат, который Xen Orchestra создаёт для себя, не указывает ни одного, поэтому ни один современный TLS-клиент не может его проверить — см. **Сертификат Xen Orchestra** в разделе Расширенный",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. В Xen Orchestra откройте *Settings → Plugins* и найдите **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Включите его. При первом запуске он создаёт секрет и сохраняет его, а Xen Orchestra хранит его и после перезапусков.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Откройте настройки плагина и скопируйте его **Prometheus secret** — вы передадите его агенту на следующем шаге. Там же можно ввести собственный секрет и сохранить его.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "Плагин отвечает на собственном адресе Xen Orchestra и с его собственным сертификатом, по пути `/openmetrics/metrics`, и только на запрос, в котором есть его секрет. Он отдаёт каждый пул, к которому подключён Xen Orchestra, поэтому одного агента хватает на все.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Скрипт запрашивает URL OneUptime и ключ приёма, оба показаны на шаге 1 (выберите там ключ, чтобы они подставились сюда), а затем:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Адрес Xen Orchestra** — так, как вы открываете его в браузере, например `https://xo.example.com` или `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **Секрет плагина OpenMetrics** — с предыдущего шага. При вводе он не отображается.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Как назвать этот Xen Orchestra** — имя, которое каждый из его пулов показывает в своих настройках. Нажмите Enter, чтобы использовать его адрес.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Затем скрипт читает сертификат Xen Orchestra. Если эта машина уже доверяет ему, агент доверяет тому же пакету CA. Если нет, скрипт показывает отпечаток SHA-256 сертификата: сравните его с отпечатком на машине Xen Orchestra и ответьте **y**, чтобы доверять этому сертификату и ничему другому. Проверку он никогда не отключает. Затем он запрашивает у плагина метрики с секретом и сообщает, какие пулы передаёт Xen Orchestra, прежде чем что-либо установить.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Он устанавливается в `/opt/oneuptime-xcp-ng-agent`, записывает файл `.env` с правами `0600` и запускает агент через Docker Compose. При повторном запуске скрипт берёт всё из этого `.env`, а не спрашивает снова, поэтому так же выполняется и обновление.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` показывает `oneuptime-xcp-ng-agent`. В его журналах найдите `Everything is ready. Begin running and processing data.` Агент читает Xen Orchestra каждую минуту, и каждый пул, о котором он сообщает, затем появляется в разделе **XCP-ng** под именем, которое ему даёт Xen Orchestra, вместе с его хостами, ВМ и хранилищем.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "Скрипт установки записывает их в `/opt/oneuptime-xcp-ng-agent/.env`. Изменив любую из них, примените её командой `docker compose up -d` в `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Переменная | Обязательна | Описание |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Да | URL вашего экземпляра OneUptime (например, `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Да | Ключ приёма телеметрии, выбранный на шаге 1 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Да | `host` или `host:port` Xen Orchestra, без схемы |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | Нет | `https` (по умолчанию). `http` только в тестовой среде: секрет тогда идёт по сети в открытом виде |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Да | Секрет плагина OpenMetrics, отправляемый как токен Bearer. Каждый `$` в нём записывается как `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | Нет | Как назвать этот Xen Orchestra в OneUptime; показывается в настройках каждого из его пулов (по умолчанию — его адрес) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | Нет | Имя, по которому проверяется сертификат Xen Orchestra, когда `XO_ADDRESS` — адрес, которого нет в сертификате |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | Нет | Имя контейнера агента (по умолчанию — `oneuptime-xcp-ng-agent`). Агенту второго Xen Orchestra на той же машине нужно собственное имя: если переменная не задана, скрипт установки называет новый агент по его папке и сохраняет это имя при повторном запуске скрипта |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Скрипт установки | Адрес Xen Orchestra в том виде, в каком его ввели; скрипт выводит из него `XO_SCHEME` и `XO_ADDRESS` |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Скрипт установки | Отпечаток SHA-256 собственного сертификата Xen Orchestra, когда агент доверяет этому сертификату и ничему другому |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Скрипт установки | Пакет CA, выпустивший сертификат Xen Orchestra; скрипт копирует его в `xo-ca.pem` |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | Нет | Токен пользователя Xen Orchestra с копией встроенной роли **Read only** и ничем больше: ИИ-агент XCP-ng работает, когда он задан, и читает с ним |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | Нет | Только для исправлений: токен другого пользователя, чья роль их разрешает. Без него ИИ-агент ничего не меняет |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | Нет | UUID XAPI пула, который обслуживает ИИ-агент (по умолчанию — единственный пул, который видит его токен чтения) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | Нет | Заменяет `XCP_NG_POOL_ID` как пул, под которым регистрируется ИИ-агент |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | Нет | `true` или `false`: может ли OneUptime AI выполнять команды ИИ-агента только для чтения во время расследования (по умолчанию — включено) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | Нет | `off`, `ask-for-approval`, `automatic` или `bypass-approval`: как OneUptime AI может применять исправление |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | Нет | `true` позволяет ИИ-агенту применять исправления с токеном для изменений. Любое другое значение оставляет его только для чтения |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | Нет | `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` или `schedule/<uuid>`, которые может затрагивать исправление, через запятую (по умолчанию — все) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | Нет | То же для того, что OneUptime AI никогда не должен менять: ВМ, в которой работает ИИ-агент, и собственная ВМ Xen Orchestra |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | Нет | Уровень журналирования ИИ-агента: `debug`, `info` (по умолчанию), `warn` или `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | Нет | `xcp-ng-ai-agent` запускает ИИ-агента; скрипт установки записывает это значение, когда задан токен чтения |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "Агент проверяет сертификат Xen Orchestra по `xo-ca.pem` рядом с `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "Агент проверяет сертификат Xen Orchestra при каждом чтении, по `xo-ca.pem` и ничему другому. Этот файл содержит одно из трёх:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Собственный сертификат Xen Orchestra**, закреплённый по его отпечатку SHA-256 (`XO_TLS_FINGERPRINT`): агент доверяет этому сертификату и никакому другому.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **CA, выпустивший его** (`XO_CA_FILE`), для сертификата от вашего собственного CA.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **Пакет CA этой машины**, для сертификата, которому эта машина уже доверяет.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "В любом случае сертификат должен указывать адрес, к которому подключается агент: агент проверяет имена, на которые выпущен сертификат, как это делает любой современный TLS-клиент, а не его субъект. Самоподписанный сертификат, который Xen Orchestra создаёт для себя, не указывает ни одного, поэтому агент не может ему доверять, закреплён он или нет, и завершается ошибкой `x509: certificate is not valid for any names`. Выдайте Xen Orchestra сертификат, в котором указан его адрес, — от вашего CA или самоподписанный с альтернативным именем субъекта (subject alternative name), — как показано в разделе [Сертификат Xen Orchestra](/docs/telemetry/xcp-ng#xen-orchestras-certificate).",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "Если сертификат называет Xen Orchestra иначе, чем адрес в `XO_ADDRESS`, задайте в `XO_TLS_SERVER_NAME` это имя. Когда закреплённый сертификат обновляется, агент перестаёт читать Xen Orchestra, пока не начнёт доверять новому. Запустите скрипт установки ещё раз: он показывает новый отпечаток и останавливается, ничего не меняя. Проверьте этот отпечаток на машине Xen Orchestra, а затем запустите скрипт ещё раз с ним: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "Каждую минуту агент читает плагин, который читает через XAPI циклические базы данных (round-robin) каждого хоста с разрешением 60 секунд. Он оставляет ряды `xcp_*` и переносит пул каждого ряда в пакет, который отправляет, как `xcp_ng.pool.id` (UUID пула, который никогда не меняется) и `xcp_ng.pool.name`:",
  "| Category | Series |": "| Категория | Ряды |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Пул** | `xcp_pool_connected` — присутствует, пока Xen Orchestra подключён к пулу |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Хосты** | `xcp_host_status` (состояние питания и включён ли он), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` для каждого интерфейса, `xcp_host_disk_*` для каждого репозитория хранения |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **ВМ** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (конкуренция за CPU), `xcp_vm_memory_*`, `xcp_vm_network_*` для каждого интерфейса, `xcp_vm_disk_*` для каждого диска, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Хранилище** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, на пулах, где работает XOSTOR |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'Управляющие домены передаются как ВМ с `is_control_domain="true"`; страницы скрывают их, если вы их не запросите.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra помечает восемь рядов пропускной способности как счётчики, хотя каждый содержит скорость XAPI в секунду: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, а также ряды сети, сетевых ошибок, чтения и записи дисков ВМ. Агент превращает их в gauge, не трогая значения, поэтому OneUptime хранит их как скорости, которыми они и являются, в байтах или ошибках в секунду.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime добавляет для каждого пула четыре ряда 0/1, которые читают шаблоны оповещений: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` и `xcp_ng.vm.stopped_after_running` (ВМ, остановленная или приостановленная, которая работала в последние сутки). Он также помечает каждую точку атрибутами `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` или `xostor`) и `xcp_ng.id` (UUID этого объекта), по которым фильтруют мониторы и панели.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "Не сохраняются: собственные ряды процессов Xen Orchestra (`xo_*`), которые не относятся ни к одному пулу, и мощность хоста, считываемая через IPMI, которую плагин отправляет без её пула. Оценочная доля каждой ВМ в ней сохраняется.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "Один агент читает один Xen Orchestra и каждый пул, которым он управляет. Для второго Xen Orchestra установите второй агент в отдельную папку, с собственным именем контейнера, так как два контейнера не могут носить одно имя:",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Без `XCP_NG_AGENT_CONTAINER_NAME` скрипт называет контейнер по папке. Он записывает имя в `.env` этого агента, поэтому имя сохраняется при повторном запуске скрипта для обновления агента, а агент, чей `container_name` вы когда-то изменили в `docker-compose.yml`, сохраняет это имя. При установке через Docker Compose вместо этого задайте `XCP_NG_AGENT_CONTAINER_NAME` в `.env` каждого агента.",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "Не допускайте, чтобы читались два Xen Orchestra, управляющих одним и тем же пулом: в OneUptime это один пул по его UUID, и о нём сообщалось бы дважды.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Любой атрибут ресурса с префиксом `oneuptime.label.` становится меткой проекта на каждом пуле, который читает агент: `oneuptime.label.<dimension>=<value>` даёт метку `<dimension>:<value>`. Добавьте их в процессор `resource` в `otel-collector-config.yaml` рядом с `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "Затем перезапустите коллектор, чтобы он прочитал новую конфигурацию:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "Пулы появятся с метками `team:platform` и `env:production`. Метки сравниваются без учёта регистра, поэтому существующая метка `Production` используется повторно; метки, добавленные в интерфейсе OneUptime, агент никогда не удаляет. Повторный запуск скрипта установки заменяет изменённый `otel-collector-config.yaml` и сохраняет ваш рядом как `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Обновить** — образ коллектора закреплён в `docker-compose.yml`, а его конфигурация лежит в файле рядом, поэтому одна загрузка образа агент не обновит. Запустите скрипт установки ещё раз. Он берёт каждое значение из вашего существующего `.env` (ничего не спрашивает снова), так же проверяет сертификат Xen Orchestra, скачивает последние `docker-compose.yml` и `otel-collector-config.yaml` — изменённый вами файл сохраняется рядом с новым как `<file>.bak.<timestamp>`, — загружает образ и пересоздаёт с ним агент:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Конфигурация сообщает закреплённую в ней версию коллектора как **Версия агента** каждого пула. Когда этот OneUptime закрепляет более новую, значок предупреждения рядом с ней открывает эти команды.",
  "**Uninstall** the agent:": "**Удалить** агент:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Затем отключите плагин OpenMetrics в Xen Orchestra, если его больше ничто не читает.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` проверяет всю цепочку — контейнер, сертификат Xen Orchestra по `xo-ca.pem`, плагин и его секрет, пулы, о которых он сообщает, — и напрямую спрашивает OneUptime, принимает ли он ваш ключ приёма. Последняя проверка важнее всего: конечные точки OTLP в OneUptime отклоняют неверный ключ с `401` или `422`, а коллектор записывает это одной строкой `Exporting failed` на пакет, которую легко пропустить.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "В конце он выдаёт вывод с наиболее вероятной причиной. Секрет он никогда не выводит.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime помечает пул как «Отключено», если за 15 минут для него ничего не было прочитано.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Если все пулы этого Xen Orchestra в состоянии «Отключено», проверьте агент (в `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` и `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Если только один, Xen Orchestra перестал о нём сообщать: в *Settings → Servers* в Xen Orchestra сервер этого пула должен быть подключён. Хосты, ВМ и хранилище пула остаются такими, какими Xen Orchestra сообщил о них в последний раз.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Коллектор записывает в журнал `server returned HTTP status 401 Unauthorized`. Скопируйте секрет заново из *Settings → Plugins → openmetrics*, задайте его в `XO_OPENMETRICS_SECRET` в `.env` — в одинарных кавычках, каждый `$` записан как `$$` — и примените командой `docker compose up -d` в `/opt/oneuptime-xcp-ng-agent`. До версии 6.8 Xen Orchestra создавал новый секрет при каждом перезапуске.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra отвечает, а его плагин OpenMetrics — нет. Включите плагин в *Settings → Plugins → openmetrics* (для XOA нужна лицензия Premium) и убедитесь, что версия Xen Orchestra — 6.9 или новее. `/openmetrics/health` отвечает `{"status":"ok"}` без секрета, пока плагин работает.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — в сертификате не указан ни один адрес, как в собственном самоподписанном сертификате Xen Orchestra. Выдайте Xen Orchestra сертификат, в котором указан его адрес.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — подключайтесь по одному из этих имён или задайте одно из них в `XO_TLS_SERVER_NAME`.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` не содержит ни этот сертификат, ни CA, который его выпустил. Сертификат обновили, или в файле не тот сертификат: запишите его заново, как описано в **Сертификат Xen Orchestra** в разделе Расширенный.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra сообщает только о пулах, к которым подключён, а агент читает только этот Xen Orchestra. Подключите сервер пула в *Settings → Servers* в Xen Orchestra; пул появится в OneUptime при следующем чтении. Пулу, который читает другой Xen Orchestra, нужен собственный агент рядом с тем Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Как назвать этот Xen Orchestra** — команда уже называет его **`xo-paris`**, как это показывают настройки этого пула.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Команда уже содержит ваш URL OneUptime и ключ приёма. Остальное скрипт спросит:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Скачайте `docker-compose.yml` и `otel-collector-config.yaml` из этого OneUptime в новую папку:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Создайте рядом с ними файл `.env`: в нём хранится секрет плагина, поэтому закройте к нему доступ командой `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Задайте в `XO_ADDRESS` `host` или `host:port` Xen Orchestra, без `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Заключите секрет плагина в одинарные кавычки. Если в нём есть `$`, запишите каждый как `$$`: коллектор читает значение ещё раз.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` — это то, как настройки каждого пула называют этот Xen Orchestra.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Затем передайте агенту сертификат Xen Orchestra в виде `xo-ca.pem` рядом с `docker-compose.yml` — агент проверяет Xen Orchestra по этому файлу и ничему другому. Чтобы доверять собственному сертификату Xen Orchestra, прочитайте его и сверьте его отпечаток с отпечатком на машине Xen Orchestra:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Если его выпустил ваш собственный CA, вместо этого скопируйте сертификат этого CA в `xo-ca.pem`; если публичный CA — скопируйте пакет CA этой машины (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Запустите агент:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Агент читает их из файла `.env` рядом с `docker-compose.yml`. Изменив любую из них, примените её командой `docker compose up -d` в папке с `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "Если сертификат называет Xen Orchestra иначе, чем адрес в `XO_ADDRESS`, задайте в `XO_TLS_SERVER_NAME` это имя. Когда сертификат в `xo-ca.pem` обновляется, прочитайте его заново, как на шаге 3, а затем выполните `docker compose up -d --force-recreate`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Выполните это в папке агента, той, где лежит `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Обновить** — образ коллектора закреплён в `docker-compose.yml`, а его конфигурация лежит в файле рядом, поэтому одна загрузка образа агент не обновит. Скачайте оба файла заново; ваши `.env` и `xo-ca.pem` остаются, а изменения, которые вы вносили в любой из файлов, придётся внести снова:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Затем загрузите образ и пересоздайте агент, чтобы коллектор прочитал новую конфигурацию:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Если все пулы этого Xen Orchestra в состоянии «Отключено», проверьте агент (в папке агента): `docker compose ps` и `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Коллектор записывает в журнал `server returned HTTP status 401 Unauthorized`. Скопируйте секрет заново из *Settings → Plugins → openmetrics*, задайте его в `XO_OPENMETRICS_SECRET` в `.env` — в одинарных кавычках, каждый `$` записан как `$$` — и примените командой `docker compose up -d` в папке с `docker-compose.yml`. До версии 6.8 Xen Orchestra создавал новый секрет при каждом перезапуске.",
};

export default TRANSLATION;
