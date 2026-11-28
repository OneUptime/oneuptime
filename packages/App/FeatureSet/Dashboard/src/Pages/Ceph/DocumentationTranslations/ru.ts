import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 или новее с плагином Docker Compose v2 на машине, с которой доступны ваши демоны Ceph mgr на порту 9283",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Оболочка на узле администрирования Ceph, где CLI `ceph` работает с правами администратора",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "Затем выведите список демонов mgr: агенту нужны **все**, активный и резервные:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Метрики возвращает только **активный** mgr (резервные отвечают пустым ответом), поэтому опрос каждого mgr сохраняет поток метрик, когда активный переключается.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Скрипт запрашивает URL OneUptime и ключ приёма, оба показаны на шаге 1 (выберите там ключ, чтобы они подставились сюда), а затем:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Имя кластера**: как кластер отображается в OneUptime. Дайте каждому кластеру своё и не меняйте его: новое имя регистрирует новый кластер.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **Конечные точки mgr**: каждый mgr из предыдущего шага в виде `host:port` через запятую, например `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. Квадратные скобки скрипт добавит сам.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **ИИ-агент OneUptime**: может ли он применять исправления; ответьте **N**, чтобы оставить его только для чтения. Если `ceph` работает с правами администратора, скрипт также предложит создать собственный клиент Ceph для ИИ-агента.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Он устанавливается в `/opt/oneuptime-ceph-agent`, записывает файл `.env` с правами `0600` и запускает агент через Docker Compose. При повторном запуске скрипт берёт всё из этого `.env`, а не спрашивает снова, поэтому так же выполняется и обновление.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Найдите в журналах `Everything is ready. Begin running and processing data.`. После этого кластер автоматически появится в разделе **Ceph**, обычно примерно в течение минуты.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose также запускает **`oneuptime-ceph-ai-agent`**, ИИ-агент OneUptime. Если скрипт установки создал его клиент Ceph, он уже работает; иначе он ждёт клиента; см. **ИИ-агент OneUptime** в разделе Расширенный.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**ИИ-агент OneUptime (включён по умолчанию, только чтение).** Расследования ИИ включены: как только у агента появится клиент Ceph, он позволит ИИ OneUptime расследовать инциденты и оповещения этого кластера с помощью команд `ceph` только для чтения и ничего не изменит, пока вы не разрешите исправления.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "Скрипт установки записывает их в `/opt/oneuptime-ceph-agent/.env`. Изменив любую из них, примените её командой `docker compose up -d` в `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Переменная | Обязательна | Описание |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Да | URL вашего экземпляра OneUptime (например, `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Да | Ключ приёма телеметрии, выбранный на шаге 1 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Да | Идентификатор кластера, отображаемый в OneUptime. Ставится на каждую метрику как атрибут ресурса `ceph.cluster.name`. Не меняйте его: при изменении регистрируется новый кластер (по умолчанию: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Да | Список `host:port` **всех** демонов mgr через запятую в квадратных скобках, например `[ceph-mon-1:9283,ceph-mon-2:9283]`. Скрипт установки добавит скобки за вас |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Собственные настройки ИИ-агента OneUptime описаны в разделе **ИИ-агент OneUptime**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Опрашиваются все mgr** (активный и резервные), поэтому метрики переживают переключение активного mgr.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **Каждые 30 секунд.** Модуль prometheus в mgr кэширует результат опроса на `mgr/prometheus/scrape_interval` (по умолчанию 15 секунд): не опрашивайте чаще, вы будете лишь перечитывать кэш.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** сохраняет метки, которые экспортирует Ceph (`ceph_daemon`, `pool_id`), как есть, поэтому ряды остаются непрерывными при переключениях mgr.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Это полный `otel-collector-config.yaml`, который запускает агент; значения `${env:...}` берутся из файла `.env`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "Агент может отслеживать `/var/log/ceph/ceph.log` и отправлять его в OneUptime, что заполняет страницу **Журнал кластера**. По умолчанию это выключено, потому что агент должен работать на хосте, где есть журнал кластера, по умолчанию на хосте mon.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. В `otel-collector-config.yaml` раскомментируйте приёмник `filelog` и конвейер `logs`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. В `docker-compose.yml` раскомментируйте том `/var/log/ceph:/var/log/ceph:ro`.",
  "3. Apply both:": "3. Примените оба изменения:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "Строки отправляются как есть; OneUptime разбирает формат ceph.log (метка времени, демон, уровень INF/WRN/ERR, сообщение) при чтении, а процессор `resource` проставляет `ceph.cluster.name`, чтобы журнал попал в этот кластер.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Любой атрибут ресурса с префиксом `oneuptime.label.` становится меткой проекта на кластере: `oneuptime.label.<dimension>=<value>` даёт метку `<dimension>:<value>`. Добавьте их в процессор `resource` в `otel-collector-config.yaml` рядом с `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Затем перезапустите коллектор, чтобы он прочитал новую конфигурацию:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Кластер появится с метками `team:storage` и `env:production`. Метки сравниваются без учёта регистра, поэтому существующая метка `Production` используется повторно; метки, добавленные в интерфейсе OneUptime, агент никогда не удаляет.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "Агент отправляет всё, что экспортирует модуль prometheus в mgr. Страницы Ceph, каталог метрик и шаблоны оповещений OneUptime построены на:",
  "| Category | Data |": "| Категория | Данные |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Состояние кластера** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), кворум мониторов, общая и занятая сырая ёмкость |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | Состояние up / in каждого OSD (по метке `ceph_daemon`, например `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Пул** | Сохранённые байты, максимум доступного, число объектов, операции чтения и записи и пропускная способность по каждому пулу |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | Число активных, деградированных и недоукомплектованных PG |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` также запускает **`oneuptime-ceph-ai-agent`**. Пока ИИ OneUptime расследует инцидент или оповещение этого кластера, он выполняет через него команды `ceph`: `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Он регистрируется как кластер с именем `CEPH_CLUSTER_NAME` и отображается на странице кластера **ИИ → ИИ-агент**.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Он подключается как собственный клиент Ceph, `client.oneuptime-ai`, с минимальным `ceph.conf` кластера и связкой ключей этого клиента в папке `ceph/` рядом с `docker-compose.yml`. Скрипт установки предлагает создать их при новой установке, если `ceph` работает с правами администратора на машине, где вы его запускаете. В остальных случаях или чтобы добавить их позже выполните на узле администрирования Ceph:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Если агент работает на другой машине, скопируйте эти два файла в его папку `ceph/` так же. **Никогда не кладите туда связку ключей администратора.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **Права (caps) клиента задают жёсткую границу.** С этими правами на чтение ничто из того, что он выполняет, не может изменить кластер. Для исправлений (вернуть OSD в состояние in, снять `noout`) нужны также `ONEUPTIME_AI_ALLOW_WRITES=true` в `.env` и права на исправления из README агента.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Проверьте его: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- Не используете ИИ OneUptime? Удалите службу `oneuptime-ceph-ai-agent` из `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "Что ему разрешено выполнять и как работают исправления: [ИИ-агенты для инфраструктуры](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Обновить**: образ коллектора закреплён в `docker-compose.yml`, а его конфигурация лежит в файле рядом, поэтому одна загрузка образа агент не обновит. Запустите скрипт установки ещё раз. Он берёт каждое значение из вашего существующего `.env` (ничего не спрашивает снова), скачивает последние `docker-compose.yml` и `otel-collector-config.yaml` (изменённый вами файл сохраняется рядом с новым как `<file>.bak.<timestamp>`), загружает образы и пересоздаёт с ними агент. Папка `ceph/` ИИ-агента остаётся как есть:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Конфигурация сообщает версию коллектора, которую она закрепляет, как **Версия агента** кластера. Когда этот OneUptime закрепляет более новую, рядом появляется предупреждающий знак, который открывает эти команды.",
  "**Uninstall** the agent:": "**Удалить** агент:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Если вы создавали клиент Ceph для ИИ-агента, удалите его на узле администрирования: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` проверяет всю цепочку (среду выполнения контейнеров, каждую конечную точку mgr, включая ловушку «активный или резервный», проставление имени кластера, вид токена, собственные метрики коллектора) и напрямую спрашивает OneUptime, принимает ли он ваш ключ приёма. Последняя проверка важнее всего: конечные точки OTLP в OneUptime отклоняют неверный ключ с `401` или `422`, а коллектор записывает это одной строкой `Exporting failed` на пакет, которую легко пропустить, поэтому скрипт запрашивает у `GET /otlp/v1/validate` прямой ответ 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "В конце он выдаёт вывод с наиболее вероятной причиной.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Проверьте журналы коллектора: `docker logs oneuptime-ceph-agent`; ищите ошибки экспорта (`401` означает неверный ключ приёма, connection refused означает неверный `ONEUPTIME_URL`).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Убедитесь, что конечная точка mgr отдаёт метрики: `curl http://<active-mgr>:9283/metrics | head`; вы должны увидеть строки метрик `ceph_*`. Если нет, включите модуль: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Убедитесь, что `CEPH_MGR_ENDPOINTS` заключён в квадратные скобки: без них коллектор считает всю строку через запятую одной (недопустимой) целью.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Проверьте, что агент запущен: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Проверьте журналы агента на ошибки: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Убедитесь, что URL OneUptime и ключ приёма указаны верно.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Убедитесь, что с машины агента по сети доступен экземпляр OneUptime.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Вероятно, вы опрашиваете только (бывший) активный mgr. Перечислите **каждый** демон mgr в `CEPH_MGR_ENDPOINTS`: опрос резервных mgr ничего не стоит и возвращает пустые ответы.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "Это ожидаемо, если на вашем кластере `mgr/prometheus/standby_behaviour` равен `error`: тогда резервные отвечают HTTP 500. Опрос активного mgr всё равно проходит, так что ошибки являются шумом; верните поведение к `default`, чтобы их заглушить.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Идентичность кластера задаёт `CEPH_CLUSTER_NAME`, проставляемый на каждую метрику как `ceph.cluster.name`. Исправьте его в `.env` и примените командой `docker compose up -d` в `/opt/oneuptime-ceph-agent`; учтите, что новое имя регистрирует новый кластер.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Имя кластера**: введите ровно **`ceph-1`**; другое имя регистрирует новый кластер.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Идентичность кластера задаёт `CEPH_CLUSTER_NAME`, проставляемый на каждую метрику как `ceph.cluster.name`. Этот кластер называется **`ceph-1`**. Исправьте его в `.env` и примените командой `docker compose up -d` в `/opt/oneuptime-ceph-agent`; учтите, что новое имя регистрирует новый кластер.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Команда уже содержит ваш URL OneUptime и ключ приёма. Остальное скрипт спросит:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Скачайте `docker-compose.yml` и `otel-collector-config.yaml` из этого OneUptime в новую папку:",
  "Create a `.env` file next to them:": "Создайте рядом с ними файл `.env`:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Замените `my-ceph-cluster` именем этого кластера, например `ceph-prod`. Под этим именем кластер отображается в OneUptime, поэтому не меняйте его: новое имя регистрирует новый кластер.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- Перечислите **каждый** демон mgr в `CEPH_MGR_ENDPOINTS` через запятую и в квадратных скобках: без скобок коллектор читает весь список как одну недопустимую цель.",
  "Start the agent:": "Запустите агент:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить `<YOUR_API_KEY>`.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose также запускает **`oneuptime-ceph-ai-agent`**, ИИ-агент OneUptime. Он ждёт собственный клиент Ceph; см. **ИИ-агент OneUptime** в разделе Расширенный или удалите его службу из `docker-compose.yml`, если вы не пользуетесь ИИ OneUptime.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Агент читает их из файла `.env` рядом с `docker-compose.yml`. Изменив любую из них, примените её командой `docker compose up -d` в папке с `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Да | Список `host:port` **всех** демонов mgr через запятую в квадратных скобках, например `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Он подключается как собственный клиент Ceph, `client.oneuptime-ai`, с минимальным `ceph.conf` кластера и связкой ключей этого клиента в папке `ceph/` рядом с `docker-compose.yml`. На узле администрирования Ceph, в папке агента:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Выполните это в папке агента, той, где лежит `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Обновить**: образ коллектора закреплён в `docker-compose.yml`, а его конфигурация лежит в файле рядом, поэтому одна загрузка образа агент не обновит. Скачайте оба файла заново; ваш `.env` остаётся, а изменения, которые вы вносили в любой из файлов, придётся внести снова:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Затем загрузите образы и пересоздайте агент, чтобы коллектор прочитал новую конфигурацию:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Идентичность кластера задаёт `CEPH_CLUSTER_NAME`, проставляемый на каждую метрику как `ceph.cluster.name`. Исправьте его в `.env` и примените командой `docker compose up -d` в папке с `docker-compose.yml`; учтите, что новое имя регистрирует новый кластер.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Это устанавливает агент для **`ceph-1`**: оставьте `CEPH_CLUSTER_NAME` ровно таким, как есть, иначе данные зарегистрируются как новый кластер.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Идентичность кластера задаёт `CEPH_CLUSTER_NAME`, проставляемый на каждую метрику как `ceph.cluster.name`. Этот кластер называется **`ceph-1`**. Исправьте его в `.env` и примените командой `docker compose up -d` в папке с `docker-compose.yml`; учтите, что новое имя регистрирует новый кластер.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Нет | Имя контейнера коллектора (по умолчанию — `oneuptime-ceph-agent`). Агенту второго кластера на той же машине нужны собственные имена: если переменные не заданы, скрипт установки называет контейнеры нового агента по его папке и сохраняет эти имена при повторном запуске скрипта |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Нет | Имя контейнера ИИ-агента (по умолчанию — `oneuptime-ceph-ai-agent`). Если переменная не задана, скрипт установки называет ИИ-агента второго кластера по его коллектору (`oneuptime-ceph-ai-agent-cluster2` рядом с `oneuptime-ceph-agent-cluster2`) и сохраняет это имя при повторном запуске скрипта |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Один агент читает один кластер. Для второго кластера установите второй агент в отдельную папку, с собственными именами контейнеров, так как два контейнера не могут носить одно имя:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Скрипт называет контейнеры по папке, например `oneuptime-ceph-agent-cluster2`, если не заданы их переменные, например `CEPH_AGENT_CONTAINER_NAME`. Он записывает имена в `.env` этого агента, поэтому имена сохраняются при повторном запуске скрипта с тем же `INSTALL_DIR` для обновления агента, а агент, чей `container_name` вы когда-то изменили в `docker-compose.yml`, сохраняет это имя.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Дайте каждой папке собственное имя: Docker Compose называет проект только по его папке, поэтому скрипт отказывается от папки с тем же именем, что и папка, в которой где-то уже работает агент. Передайте папку диагностическому скрипту с помощью `-d`.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Нет | Имя контейнера коллектора (по умолчанию — `oneuptime-ceph-agent`). Агенту второго кластера на той же машине нужно собственное имя |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Нет | Имя контейнера ИИ-агента (по умолчанию — `oneuptime-ceph-ai-agent`). Агенту второго кластера на той же машине нужно собственное имя |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Один агент читает один кластер. Для второго кластера настройте второй агент в отдельной папке, с собственными именами контейнеров, так как два контейнера не могут носить одно имя. Задайте их в `.env` этого агента:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Дайте каждой папке собственное имя: Docker Compose называет проект только по его папке, поэтому вторая папка с тем же именем заменила бы контейнеры первого агента. Не задавайте имена в `docker-compose.yml`, который заменяется при обновлении.",
};

export default TRANSLATION;
