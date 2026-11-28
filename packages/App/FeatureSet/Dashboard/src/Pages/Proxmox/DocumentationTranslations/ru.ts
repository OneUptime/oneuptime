import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 или новее с плагином Docker Compose v2 на машине, которой доступен API Proxmox VE каждого узла на порту 8006",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "Оболочка root на любом узле PVE или веб-интерфейс Proxmox, чтобы создать API-токен только для чтения",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "Лучше всего машина вне кластера или ВМ, которую Proxmox HA перезапускает на другом узле: агент читает кластер с другого узла, когда один из них отключается, но не тогда, когда отключается его собственная машина",
  "As root on any PVE node:": "От root на любом узле PVE:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- Первая строка завершается ошибкой, безвредной, только если `monitoring@pam` уже существует. У API-токенов есть собственный секрет, поэтому пользователю не нужны ни пароль, ни системная учётная запись.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` выводит секрет токена: скопируйте его сейчас, он показывается только один раз. ID токена — `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- Роль назначается и пользователю, и токену, потому что токен с разделением привилегий получает только те разрешения, которые есть и у его пользователя. Она должна быть на корневом пути `/`: pve-exporter читает состояние всего кластера, а токен, ограниченный подпутём, получает ошибку `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Перейдите в *Datacenter → Permissions → API Tokens* и нажмите **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Выберите (или создайте) пользователя, задайте токену ID, например `oneuptime`, убедитесь, что флажок **Privilege Separation** установлен, и нажмите **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Скопируйте ID токена (`user@realm!tokenname`) и секрет: секрет показывается только один раз.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. В *Datacenter → Permissions* дважды нажмите **Add**, чтобы назначить пути `/` роль **PVEAuditor**: один раз как **API Token Permission** для токена и один раз как **User Permission** для его пользователя.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "Токен с разделением привилегий получает только те разрешения, которые есть и у его пользователя, поэтому роль нужна обоим. Она должна быть на корневом пути `/`: pve-exporter читает состояние всего кластера, а токен, ограниченный подпутём, получает ошибку `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Скрипт запрашивает URL OneUptime и ключ приёма, оба показаны на шаге 1 (выберите там ключ, чтобы они подставились сюда), а затем:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Имя кластера**: как кластер отображается в OneUptime. Дайте каждому кластеру своё и не меняйте его: новое имя регистрирует новый кластер.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Хост API Proxmox VE**: любой узел, например `192.168.1.10`. Пока его API не отвечает, агент читает кластер со следующего узла из списка ниже.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **Встроенный prometheus-pve-exporter**: ответьте **Y**, если у вас ещё нет своего.",
  "- **API token** — the token id and secret from the previous step.":
    "- **API-токен**: ID и секрет токена из предыдущего шага.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Адрес каждого узла**: собственный адрес каждого узла через запятую, никогда не виртуальный IP. С токеном скрипт предлагает список узлов самого кластера: нажмите Enter, чтобы принять его. Агент также читает кластер с этих узлов, когда первый недоступен.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **ИИ-агент OneUptime**: может ли он применять исправления; ответьте **N**, чтобы оставить его только для чтения.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Он устанавливается в `/opt/oneuptime-proxmox-agent`, записывает файл `.env` с правами `0600` и запускает всё через Docker Compose. Повторный запуск скрипта берёт всё из этого `.env`, а не спрашивает заново, поэтому так же выполняется и обновление.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` показывает коллектор (`oneuptime-proxmox-agent`), переключение между узлами (`oneuptime-pve-api-failover`), встроенный экспортер (`oneuptime-pve-exporter`, если вы не используете свой) и ИИ-агент OneUptime (`oneuptime-proxmox-ai-agent`). В журналах коллектора найдите `Everything is ready. Begin running and processing data.` После этого кластер автоматически появится в разделе **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**ИИ-агент OneUptime (включён по умолчанию, только чтение).** Расследования ИИ включены: он позволяет ИИ OneUptime расследовать инциденты и оповещения этого кластера с помощью запросов `pvesh` только для чтения и ничего не меняет, пока вы не разрешите исправления; см. **ИИ-агент OneUptime** в разделе Расширенный.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Требуется Proxmox VE 8.3 или новее. Выберите ключ приёма на шаге 1, чтобы увидеть две команды: они содержат ключ, который Proxmox VE хранит в добавляемой ими цели webhook.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "Страница каждой гостевой системы затем показывает её последнюю резервную копию, а **Рекомендации** кластера предлагают оповещения **Backup Job Failed** и **Node Fenced**.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "Скрипт установки записывает их в `/opt/oneuptime-proxmox-agent/.env`. Изменив любую из них, примените её командой `docker compose up -d` в `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Переменная | Обязательна | Описание |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Да | URL вашего экземпляра OneUptime (например, `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Да | Ключ приёма телеметрии, выбранный на шаге 1 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Да | Идентификатор кластера, отображаемый в OneUptime. Ставится на каждую метрику как атрибут ресурса `proxmox.cluster.name`. Не меняйте его: при изменении регистрируется новый кластер (по умолчанию: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Да | Узел, через API Proxmox VE которого экспортер читает кластер и к которому обращается ИИ-агент, например `192.168.1.10`. Пока его API не отвечает, оба используют следующий отвечающий узел из `PVE_NODES` |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | В кластере | Собственный API-адрес каждого узла через запятую в квадратных скобках, например `[192.168.1.10,192.168.1.11,192.168.1.12]`. По умолчанию только `PVE_HOST`, чего достаточно для одного узла. Экспортер читает запуск при загрузке (Guest Down), репликацию и подписку только для узла, который опрашивает, поэтому узлы опрашиваются по очереди; пропущенный узел остаётся невидимым. Агент также читает кластер со следующего из них, когда `PVE_HOST` отключается. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | Нет | Адрес (`host:port`, без схемы) prometheus-pve-exporter. По умолчанию встроенный экспортер (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Встроенный экспортер и ИИ-агент | Полный ID API-токена Proxmox, например `monitoring@pam!oneuptime` (PVEAuditor, только чтение) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Встроенный экспортер и ИИ-агент | Секрет API-токена Proxmox |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | Нет | Проверять TLS-сертификат API Proxmox (по умолчанию: `false`; PVE поставляется с самоподписанными сертификатами) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | Нет | Задайте `pve-exporter`, чтобы запустить контейнер встроенного экспортера |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Собственные настройки ИИ-агента OneUptime описаны в разделе **ИИ-агент OneUptime**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "Когда скрипт установки спросит **Run the bundled prometheus-pve-exporter?**, ответьте **n** и укажите адрес своего экспортера (`host:port`, без схемы).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Укажите адрес, доступный контейнеру агента, — IP в локальной сети или DNS-имя хоста: `localhost` внутри контейнера — это сам контейнер. Оставьте `PVE_API_TOKEN_ID` и `PVE_API_TOKEN_SECRET` в `.env`, если используете ИИ-агент OneUptime, который читает API с этим токеном.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "Агент опрашивает экспортер каждые 30 секунд: его кластерные сборщики — один раз, на `PVE_HOST` (или на узле, с которого он читает кластер, пока `PVE_HOST` недоступен), а сборщики узлов — один раз для каждого узла из `PVE_NODES`. Каждый ряд несёт метку `id`, обозначающую ресурс: `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` или `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| Категория | Метрики |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Доступность** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Узел** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Гостевая система (ВМ / LXC)** | `pve_guest_info`, а также ряды CPU, памяти и сети с ID `qemu/*` и `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Хранилище** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (высокая доступность) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Охват резервным копированием** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: гостевые системы, которые не выбирает ни одно задание резервного копирования (выполнялись ли копии и были ли они успешны, не сообщается) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Запуск при загрузке** | `pve_onboot_status` для каждой гостевой системы, который читает **Guest Down** |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Репликация** | Ряды `pve_replication_*` для каждого задания репликации хранилища: их метка `id` — это ID задания (например, `100-0`), а не ресурс |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "Запуск при загрузке и репликация поступают от сборщиков узлов экспортера, которые читают только узел, опрашиваемый экспортером: у узла, отсутствующего в `PVE_NODES`, нет ни того, ни другого.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "Коллектор также разбивает метку `id` на три атрибута точек данных, фильтруемых по равенству (процессор `transform/pve-identity`); по ним сопоставляются критерии мониторов и фильтры панелей:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Атрибут | Значения | Пример для `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` и `lxc` оба становятся `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Всё после первого `/` в `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "Исходная метка `id` сохраняется без изменений.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "Агент читает весь кластер через API одного узла: `PVE_HOST`, пока тот отвечает. Каждые 15 секунд контейнер `oneuptime-pve-api-failover` проверяет этот узел, и когда его API перестаёт отвечать, коллектор читает кластер со следующего отвечающего узла из `PVE_NODES`, пока `PVE_HOST` снова не ответит. С API-токеном в `.env` он также пропускает узел, который отвечает, но отрезан от части кластера с кворумом: с его точки зрения все остальные узлы были бы недоступны. ИИ-агент OneUptime делает то же самое при каждом своём вызове. Поэтому, когда узел отказывает, для него срабатывает **Node Offline**, а остальной кластер продолжает передавать данные.",
  "Its logs say which node the cluster is read from, and why.":
    "Его журналы показывают, с какого узла читается кластер и почему.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "Чего он не может покрыть, так это машину, на которой работает агент: если она отключится, весь кластер замолчит и сработает **Cluster Stopped Reporting**. Запускайте агент вне кластера или в ВМ, которую Proxmox HA перезапускает на другом узле (`ha-manager add vm:<vmid>`, на общем хранилище), и запускайте один агент на кластер: каждый агент читает весь кластер, поэтому второй будет сообщать о каждом ресурсе дважды. См. [Когда узел отключается](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Это полный `otel-collector-config.yaml`, который запускает агент; файл `.env` задаёт значения `${env:...}`. Процессор `transform/pve-identity` выводит атрибуты `pve.scope` / `pve.type` / `pve.id`, на которые опираются встроенные шаблоны оповещений Proxmox и фильтры панелей; сохраните его, если настраиваете конфигурацию:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "По умолчанию агент отправляет только метрики, поэтому вкладка **Журналы** кластера остаётся пустой. Службы PVE пишут журналы в журнал systemd, а поставляемая конфигурация содержит закомментированный приёмник `journald` для `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` и `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Запустите агент на узле PVE.** Журнал у каждого хоста свой, поэтому удалённый агент не может его читать, и каждый узел отправляет только свой. Чтобы агент метрик оставался вне кластера, запустите вместо этого на каждом узле второй коллектор, только для журналов.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Раскомментируйте приёмник `journald` и конвейер `logs` в `otel-collector-config.yaml`, а также два тома журнала в `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Замените образ коллектора.** В стандартном образе нет `journalctl`, и он работает от пользователя, который не может читать журнал. Соберите эту обёртку и укажите её в `image:` в `docker-compose.yml`:",
  "4. Apply it:": "4. Примените это:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "Хотите оставить стандартный образ? В документации есть запасной вариант с `filelog`, который читает `/var/log/syslog`: [Отправка журналов служб Proxmox](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Любой атрибут ресурса с префиксом `oneuptime.label.` становится меткой проекта на кластере: `oneuptime.label.<dimension>=<value>` даёт метку `<dimension>:<value>`. Добавьте их в процессор `resource` в `otel-collector-config.yaml` рядом с `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Затем перезапустите коллектор, чтобы он прочитал новую конфигурацию:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Кластер появится с метками `team:platform` и `env:production`. Метки сравниваются без учёта регистра, поэтому существующая метка `Production` используется повторно; метки, добавленные в интерфейсе OneUptime, агент никогда не удаляет.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` также запускает **`oneuptime-proxmox-ai-agent`**. Пока ИИ OneUptime расследует инцидент или оповещение этого кластера, он выполняет через него команды `pvesh` только для чтения: `pvesh get /cluster/status`, текущее состояние гостевой системы, неудачные задачи узла. Программы `pvesh` в нём нет: каждая команда становится одним вызовом API Proxmox VE на `PVE_HOST`. Он регистрируется как кластер с именем `PROXMOX_CLUSTER_NAME` и отображается на странице кластера **ИИ → ИИ-агент**.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **API-токен — жёсткая граница.** Он читает с токеном PVEAuditor коллектора (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), который может читать и больше ничего. Если вы запускаете свой экспортер и в `.env` нет токена, добавьте его.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- Он работает **только для чтения**, пока вы не зададите `ONEUPTIME_AI_ALLOW_WRITES=true`. Исправлениям (запустить или перезагрузить гостевую систему) нужен ещё и собственный токен, которому разрешено включать и выключать гостевые системы, заданный как `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; в README агента есть команды `pveum`. Если агент работает в гостевой системе этого кластера, укажите её VMID в `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Проверьте его: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- Не используете ИИ OneUptime? Удалите службу `oneuptime-proxmox-ai-agent` из `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "Что ему разрешено выполнять и как работают исправления: [ИИ-агенты для инфраструктуры](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Обновить**: образ коллектора закреплён в `docker-compose.yml`, а его конфигурация лежит в файле рядом, поэтому одна загрузка образа агент не обновит. Запустите скрипт установки ещё раз. Он берёт каждое значение из вашего существующего `.env` (ничего не спрашивает снова), скачивает последние `docker-compose.yml` и `otel-collector-config.yaml` (изменённый вами файл сохраняется рядом с новым как `<file>.bak.<timestamp>`), загружает образы и пересоздаёт с ними агент:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Конфигурация сообщает версию коллектора, которую она закрепляет, как **Версия агента** кластера. Когда этот OneUptime закрепляет более новую, рядом появляется предупреждающий знак, который открывает эти команды.",
  "**Uninstall** the agent:": "**Удалить** агент:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Затем удалите API-токен в *Datacenter → Permissions → API Tokens*, если он вам больше не нужен.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` проверяет всю цепочку (среду выполнения контейнеров, опрос экспортера, проставление имени кластера, вид токена, собственные метрики коллектора) и напрямую спрашивает OneUptime, принимает ли он ваш ключ приёма. Последняя проверка важнее всего: конечные точки OTLP в OneUptime отклоняют неверный ключ с `401` или `422`, а коллектор записывает это одной строкой `Exporting failed` на пакет, которую легко пропустить, поэтому скрипт запрашивает у `GET /otlp/v1/validate` прямой вердикт 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "В конце он выдаёт вывод с наиболее вероятной причиной.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Проверьте, что агент запущен (в `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Проверьте журналы агента на ошибки: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Убедитесь, что URL OneUptime и ключ приёма указаны верно.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Убедитесь, что с машины агента по сети доступен экземпляр OneUptime.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Проверьте, что экспортер отвечает. Встроенный экспортер не публикует свой порт на хосте, поэтому запустите curl в его сетевом пространстве имён: вы должны увидеть строки метрик `pve_*` (для своего экспортера обратитесь к его `host:9221` напрямую через curl):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Убедитесь, что у API-токена есть роль **PVEAuditor** на пути `/`, у токена и у его пользователя.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Проверьте журналы коллектора на ошибки опроса или экспорта (в `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "API-токен неверный или у него нет нужных разрешений. Перепроверьте формат ID токена (`user@realm!tokenname`), секрет и то, что роль **PVEAuditor** выдана на пути `/` токену и его пользователю. Собственные журналы экспортера показывают ответ API: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'Ряды гостевых систем (ID `qemu/*`, `lxc/*`) поступают от кластерного сборщика экспортера. Поставляемая конфигурация включает его (параметр опроса `cluster=1`); если вы меняли конфигурацию, верните параметр `cluster: ["1"]`.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Их флаги запуска при загрузке и задания репликации поступают с узла, на котором они работают, а агент читает только узлы из `PVE_NODES`. Перечислите там собственный адрес каждого узла, например `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, и примените это командой `docker compose up -d` в `/opt/oneuptime-proxmox-agent`. Если коллектор перестал запускаться после правки, список потерял квадратные скобки. `troubleshoot.sh` проверяет каждый узел из списка.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Идентичность кластера задаёт `PROXMOX_CLUSTER_NAME`, проставляемый на каждую метрику как `proxmox.cluster.name`. Исправьте его в `.env` и примените командой `docker compose up -d` в `/opt/oneuptime-proxmox-agent`; учтите, что новое имя регистрирует новый кластер.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Имя кластера**: введите ровно **`pve-1`**; другое имя регистрирует новый кластер.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Идентичность кластера задаёт `PROXMOX_CLUSTER_NAME`, проставляемый на каждую метрику как `proxmox.cluster.name`. Этот кластер называется **`pve-1`**. Исправьте его в `.env` и примените командой `docker compose up -d` в `/opt/oneuptime-proxmox-agent`; учтите, что новое имя регистрирует новый кластер.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Команда уже содержит ваш URL OneUptime и ключ приёма. Остальное скрипт спросит:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Требуется Proxmox VE 8.3 или новее. Первая команда добавляет цель webhook с именем `oneuptime`, которая отправляет каждое уведомление в OneUptime как журнальную запись этого кластера и хранит ключ и имя кластера в своих секретах. Вторая направляет туда все уведомления. Замените `my-proxmox-cluster` именем кластера, которое вы дали агенту, чтобы уведомления попадали в тот же кластер.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "Страница каждой гостевой системы затем показывает её последнюю резервную копию, а **Рекомендации** кластера предлагают оповещения **Backup Job Failed** и **Node Fenced**. Чтобы прекратить отправку:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Требуется Proxmox VE 8.3 или новее. Первая команда добавляет цель webhook с именем `oneuptime`, которая отправляет каждое уведомление в OneUptime как журнальную запись этого кластера и хранит ключ и имя кластера в своих секретах. Вторая направляет туда все уведомления. Команда уже называет **`pve-1`**, поэтому уведомления попадают в этот кластер.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Скачайте `docker-compose.yml` и `otel-collector-config.yaml` из этого OneUptime в новую папку:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Создайте рядом с ними файл `.env`: в нём хранится секрет токена, поэтому закройте к нему доступ командой `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Замените `my-proxmox-cluster` именем этого кластера, например `pve-prod`. Под этим именем кластер отображается в OneUptime, поэтому не меняйте его: новое имя регистрирует новый кластер.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Задайте в `PVE_HOST` любой узел кластера: пока его API не отвечает, агент читает кластер со следующего узла из `PVE_NODES`, поэтому виртуальный IP ему не нужен.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Задайте в `PVE_NODES` собственный адрес каждого узла в квадратных скобках, никогда не виртуальный IP. Экспортер читает запуск при загрузке (Guest Down), репликацию и подписку только для узла, который опрашивает, поэтому узлы опрашиваются по очереди; пропущенный узел остаётся невидимым.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Укажите токен из предыдущего шага. `COMPOSE_PROFILES=pve-exporter` также запускает встроенный prometheus-pve-exporter, который читает API с этим токеном.",
  "Start the agent:": "Запустите агент:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Агент читает их из файла `.env` рядом с `docker-compose.yml`. Изменив любую из них, примените её командой `docker compose up -d` в папке с `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Не указывайте `COMPOSE_PROFILES` в `.env`, а направьте агент на свой экспортер (`host:port`, без схемы):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Выполните это в папке агента, той, где лежит `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Обновить**: образ коллектора закреплён в `docker-compose.yml`, а его конфигурация лежит в файле рядом, поэтому одна загрузка образа агент не обновит. Скачайте оба файла заново; ваш `.env` остаётся, а изменения, которые вы вносили в любой из файлов, придётся внести снова:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Затем загрузите образы и пересоздайте агент, чтобы коллектор прочитал новую конфигурацию:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Убедитесь, что агент запущен (в папке агента): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Проверьте журналы коллектора на ошибки опроса или экспорта (в папке агента): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Их флаги запуска при загрузке и задания репликации поступают с узла, на котором они работают, а агент читает только узлы из `PVE_NODES`. Перечислите там собственный адрес каждого узла, например `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, и примените это командой `docker compose up -d` в папке с `docker-compose.yml`. Если коллектор перестал запускаться после правки, список потерял квадратные скобки. `troubleshoot.sh` проверяет каждый узел из списка.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Идентичность кластера задаёт `PROXMOX_CLUSTER_NAME`, проставляемый на каждую метрику как `proxmox.cluster.name`. Исправьте его в `.env` и примените командой `docker compose up -d` в папке с `docker-compose.yml`; учтите, что новое имя регистрирует новый кластер.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Это устанавливает агент для **`pve-1`**: оставьте `PROXMOX_CLUSTER_NAME` ровно таким, как есть, иначе данные зарегистрируются как новый кластер.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Идентичность кластера задаёт `PROXMOX_CLUSTER_NAME`, проставляемый на каждую метрику как `proxmox.cluster.name`. Этот кластер называется **`pve-1`**. Исправьте его в `.env` и примените командой `docker compose up -d` в папке с `docker-compose.yml`; учтите, что новое имя регистрирует новый кластер.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Без агента, но с меньшим объёмом данных.** Proxmox VE 9.0 и новее сами отправляют метрики каждого узла в OneUptime. Состояние HA, запуск при загрузке (его использует **Guest Down**), охват резервным копированием и репликация не отправляются: используйте скрипт установки или Docker Compose, если они вам нужны. Используйте для кластера что-то одно: если работают оба способа, о каждом ресурсе сообщается дважды.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 или новее**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "Веб-интерфейс Proxmox, чтобы добавить сервер метрик в *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Каждому узлу доступен `<YOUR_ONEUPTIME_HOST>` на порту `443`",
  "| Field | Value |": "| Поле | Значение |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (сервер) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (порт) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (протокол) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (путь) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |": "| **Headers** (заголовки) | JSON ниже |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Добавьте его один раз на уровне Datacenter: после этого каждый узел кластера отправляет свои метрики.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime преобразует эти данные в те же ряды `pve_*`, что отправляет агент. Кластер регистрируется под именем вашего кластера Proxmox (отдельный узел — под именем узла) и появляется в разделе **Proxmox**, где страницы узлов, гостевых систем и хранилищ, графики обзора, каталог метрик и шаблоны оповещений по CPU, памяти и хранилищу работают так же, как с агентом.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Каждый узел отправляет только своё состояние, поэтому отключившийся узел не может сам сообщить о своём отключении; за него сообщают узлы, которые ещё работают:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Примерно через 2 минуты после последнего отчёта он отображается на страницах Proxmox как **Не в сети**, а примерно через 5 минут срабатывает **Node Offline**.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** тоже считает его не в сети; это оповещение срабатывает примерно через 7–9 минут после того, как узел замолчал, когда во всём его 5-минутном окне есть отчёты.",
  "- Its next report brings it back.":
    "- Его следующий отчёт возвращает его обратно.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "«Не в сети» означает «перестал передавать данные»: зависший `pvestatd`, остановленный `pmxcfs` или обрыв сети до OneUptime выглядят одинаково. Если замолкает отдельный хост или весь кластер, сообщить об этом некому, поэтому кластер вместо этого получает статус **Отключено**. Об узле, молчащем дольше 7 дней, больше не сообщается. Такие отчёты помечены `oneuptime.proxmox.inferred=not-reporting` в обозревателе метрик.",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "Кластер регистрируется под именем своего кластера Proxmox; отдельный узел регистрируется под именем узла. Атрибут ресурса `proxmox.cluster.name`, заданный в *Resource Attributes* сервера метрик, по-прежнему используется вместо него.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime преобразует эти данные в ряды `pve_*`, которые отправляет агент, поэтому страницы Proxmox и шаблоны оповещений по CPU, памяти и хранилищу работают без изменений. Исходные ряды `proxmox_*` остаются доступны в обозревателе метрик для всего остального, что сообщает Proxmox VE.",
  "Some alert templates need data only the agent collects:":
    "Некоторым шаблонам оповещений нужны данные, которые собирает только агент:",
  "| Needs the agent | Why |": "| Нужен агент | Почему |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| Состояние HA | Не отправляется: шаблону **HA Resource in Error State** нужен агент |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Флаг запуска при загрузке | Не отправляется: шаблону **Guest Down**, который оповещает только о гостевых системах с запуском при загрузке, нужен агент |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Охват резервным копированием и репликация | Не отправляются: шаблонам **Guest Not Backed Up** и **Replication Failing** нужен агент |",
  "Every node has stopped reporting, or never started.":
    "Ни один узел больше не передаёт данные или так и не начал.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. В *Datacenter → Metric Server* проверьте запись OpenTelemetry: сервер `<YOUR_ONEUPTIME_HOST>`, порт `443`, протокол `https`, путь `/otlp/v1/metrics` и заголовок `x-oneuptime-token` с ключом из шага 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Проверьте, что узлам доступен `<YOUR_ONEUPTIME_HOST>` по сети.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Он перестал передавать данные: отключённый узел, зависший `pvestatd`, остановленный `pmxcfs` или обрыв сети до OneUptime выглядят одинаково. Его следующий отчёт возвращает его обратно. Если вы вывели узел из кластера, нажмите **Удалить узел** на его странице, иначе он останется «Не в сети» до 7 дней.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "Собственная отправка Proxmox VE не передаёт состояние HA, запуск при загрузке, охват резервным копированием и репликацию. Выберите **Скрипт установки** или **Docker Compose** вверху этого руководства, чтобы запустить агент вместо неё, и удалите сервер метрик: если работают оба способа, о каждом ресурсе сообщается дважды.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "В OneUptime этот кластер — **`pve-1`**. Если это не собственное имя кластера Proxmox, задайте `proxmox.cluster.name` равным `pve-1` в *Resource Attributes* сервера метрик, иначе отправка зарегистрирует новый кластер.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Требуется Proxmox VE 8.3 или новее. Первая команда добавляет цель webhook с именем `oneuptime`, которая отправляет каждое уведомление в OneUptime как журнальную запись этого кластера и хранит ключ и имя кластера в своих секретах. Вторая направляет туда все уведомления. Замените `my-proxmox-cluster` именем, под которым кластер отображается в OneUptime: именем его кластера Proxmox или собственным именем отдельного узла.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Нет | Имя контейнера коллектора (по умолчанию — `oneuptime-proxmox-agent`). Агенту второго кластера на той же машине нужны собственные имена: если переменные не заданы, скрипт установки называет контейнеры нового агента по его папке и сохраняет эти имена при повторном запуске скрипта |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Нет | Имя контейнера sidecar для переключения API при отказе (по умолчанию — `oneuptime-pve-api-failover`). Если переменная не задана, скрипт установки называет sidecar для переключения API при отказе второго кластера по его коллектору (`oneuptime-pve-api-failover-cluster2` рядом с `oneuptime-proxmox-agent-cluster2`) и сохраняет это имя при повторном запуске скрипта |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Нет | Имя контейнера встроенного экспортера (по умолчанию — `oneuptime-pve-exporter`). Если переменная не задана, скрипт установки называет встроенный экспортер второго кластера по его коллектору (`oneuptime-pve-exporter-cluster2` рядом с `oneuptime-proxmox-agent-cluster2`) и сохраняет это имя при повторном запуске скрипта |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Нет | Имя контейнера ИИ-агента (по умолчанию — `oneuptime-proxmox-ai-agent`). Если переменная не задана, скрипт установки называет ИИ-агента второго кластера по его коллектору (`oneuptime-proxmox-ai-agent-cluster2` рядом с `oneuptime-proxmox-agent-cluster2`) и сохраняет это имя при повторном запуске скрипта |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Один агент читает один кластер. Для второго кластера установите второй агент в отдельную папку, с собственными именами контейнеров, так как два контейнера не могут носить одно имя:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Скрипт называет контейнеры по папке, например `oneuptime-proxmox-agent-cluster2`, если не заданы их переменные, например `PROXMOX_AGENT_CONTAINER_NAME`. Он записывает имена в `.env` этого агента, поэтому имена сохраняются при повторном запуске скрипта с тем же `INSTALL_DIR` для обновления агента, а агент, чей `container_name` вы когда-то изменили в `docker-compose.yml`, сохраняет это имя.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Дайте каждой папке собственное имя: Docker Compose называет проект только по его папке, поэтому скрипт отказывается от папки с тем же именем, что и папка, в которой где-то уже работает агент. Передайте папку диагностическому скрипту с помощью `-d`.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Нет | Имя контейнера коллектора (по умолчанию — `oneuptime-proxmox-agent`). Агенту второго кластера на той же машине нужно собственное имя |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Нет | Имя контейнера sidecar для переключения API при отказе (по умолчанию — `oneuptime-pve-api-failover`). Агенту второго кластера на той же машине нужно собственное имя |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Нет | Имя контейнера встроенного экспортера (по умолчанию — `oneuptime-pve-exporter`). Агенту второго кластера на той же машине нужно собственное имя |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Нет | Имя контейнера ИИ-агента (по умолчанию — `oneuptime-proxmox-ai-agent`). Агенту второго кластера на той же машине нужно собственное имя |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Один агент читает один кластер. Для второго кластера настройте второй агент в отдельной папке, с собственными именами контейнеров, так как два контейнера не могут носить одно имя. Задайте их в `.env` этого агента:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Дайте каждой папке собственное имя: Docker Compose называет проект только по его папке, поэтому вторая папка с тем же именем заменила бы контейнеры первого агента. Не задавайте имена в `docker-compose.yml`, который заменяется при обновлении.",
};

export default TRANSLATION;
