import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 или новее с плагином Docker Compose v2 на машине, с которой по HTTPS (TCP 443) доступен адрес управления FlashArray",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "Учётная запись администратора на FlashArray, чтобы создать для агента пользователя только для чтения",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Создайте токен **без срока действия**, иначе агент остановится в тот день, когда токен истечёт.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Подключитесь к FlashArray по SSH как администратор. Первая команда запрашивает пароль нового пользователя, вторая выводит его API-токен:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Откройте **Settings → Users and Policies** (в более старых версиях **Settings → Access**).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. В меню ⋮ панели **Users** выберите **Create User…**, назовите пользователя `oneuptime` и назначьте ему роль **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. В меню ⋮ нового пользователя выберите **Create API Token…**, оставьте поле **Expires In** пустым и скопируйте токен.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "Строка `purefa_info{...} 1` означает, что система хранения отдаёт метрики сама: продолжайте. Ответ **404** означает, что версия Purity//FA на ней старее (Pure документирует собственную конечную точку для 6.7.0 и новее; уведомление об устаревании её экспортера называет 6.6.11 и новее): выберите вместо этого **FlashArray, более старая Purity** вверху этого руководства.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "Первая строка скачивает скрипт как `install.sh`, чтобы вы могли прочитать его перед запуском.",
  "The command carries the platform you picked above. The script asks for:":
    "Команда содержит платформу, выбранную выше. Скрипт запрашивает:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- ваш **URL OneUptime** и **ключ приёма**, оба показаны на шаге 1 (выберите там ключ, чтобы они подставились сюда)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- **имя системы хранения**: под ним она отображается в OneUptime. Дайте каждой системе хранения своё имя и не меняйте его: новое имя регистрирует новую систему хранения",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- **адрес управления** FlashArray (имя хоста или IP, без `https://`) и **API-токен** пользователя только для чтения, который скрипт считывает без вывода на экран",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- проверять ли сертификат системы хранения: ответьте **N**, если только на ней не установлен сертификат от CA, которому вы доверяете (системы хранения поставляются с самоподписанным)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Он устанавливается в `/opt/oneuptime-storage-array-agent`, записывает файл `.env`, который можете читать только вы (в нём API-токен), и запускает агент с помощью Docker Compose.",
  "Download the compose file and the three collector configs from this OneUptime into a new folder:":
    "Скачайте файл compose и три конфигурации коллектора из этого OneUptime в новую папку:",
  "Create a `.env` file next to them:": "Создайте рядом с ними файл `.env`:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Замените `my-storage-array` именем этой системы хранения, например `fa-prod-01`. Под этим именем она отображается в OneUptime, поэтому не меняйте его: новое имя регистрирует новую систему хранения.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Задайте в `PURE_FA_ENDPOINT` адрес управления FlashArray (имя хоста или IP, без `https://`), а в `PURE_FA_API_TOKEN` — API-токен пользователя только для чтения. Выполните `chmod 600 .env`: в файле хранится токен.",
  "Start the agent:": "Запустите агент:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить `<YOUR_API_KEY>`.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Найдите в журналах `Everything is ready. Begin running and processing data.`. После первого опроса система хранения автоматически появится в разделе **Системы хранения**, обычно в течение одной-двух минут.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "Скрипт установки записывает их в `/opt/oneuptime-storage-array-agent/.env`; установка через Docker Compose читает их из файла `.env` рядом с `docker-compose.yml`. Изменив любую из них, примените её командой `docker compose up -d` в папке агента.",
  "| Variable | Required | Description |":
    "| Переменная | Обязательна | Описание |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Да | URL вашего экземпляра OneUptime (например, `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Да | Ключ приёма телеметрии, выбранный на шаге 1 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Да | Имя, под которым эта система хранения регистрируется в OneUptime. Ставится на каждую метрику как атрибут ресурса `storage.array.name`. Не меняйте его: при изменении регистрируется новая система хранения |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | Нет | Платформа, проставляемая как атрибут ресурса `storage.system`: `purestorage.flasharray` или `purestorage.flashblade` (по умолчанию: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Нет | Какая из поставляемых конфигураций запускается: `otel-collector-config.yaml` (FlashArray, собственная конечная точка; по умолчанию), `otel-collector-config.flasharray-exporter.yaml` (более старый FlashArray) или `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | Нет | Запускает экспортер, который нужен конфигурации: пусто для собственной конфигурации FlashArray, `flasharray-exporter` или `flashblade` для остальных |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | Адрес управления FlashArray: имя хоста или IP, без `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | API-токен пользователя FlashArray с ролью readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | Адрес управления FlashBlade: имя хоста или IP, без `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | API-токен пользователя FlashBlade с ролью readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | Нет | `true` принимает самоподписанный сертификат системы хранения на собственной конечной точке; `false` проверяет его (по умолчанию: `true`). Экспортеры Pure никогда не проверяют сертификат системы хранения, поэтому к ним это не относится |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | Нет | Имя контейнера агента (по умолчанию: `oneuptime-storage-array-agent`). Агенту второй системы хранения на той же машине нужно собственное имя: если переменная не задана, скрипт установки называет новый агент по его папке и сохраняет это имя при повторном запуске скрипта |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- Коллектор читает собственную конечную точку OpenMetrics FlashArray по HTTPS, передавая токен как учётные данные Bearer: экспортер не запускается.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Одно задание опроса на конечную точку**, каждая читается так часто, как это оправдано: `/metrics/array` каждые 60 секунд; `/metrics/volumes`, `/metrics/hosts` и `/metrics/pods` каждые 2 минуты; `/metrics/directories` каждые 30 минут, так как подсчёт места в каталогах обходится системе хранения дорого.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Каждое задание помечает свои ряды меткой `scrape_endpoint: <endpoint>`**, чтобы OneUptime знал, полным списком каких объектов является пакет: так удалённый объект исчезает из инвентаря. Оставьте метки как есть.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **Задержка по томам и хостам сохраняет три измерения** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); правило `metric_relabel_configs` отбрасывает разбивку по QoS, очереди, SAN и времени обслуживания, которая многократно увеличивает число рядов у большой системы хранения. Разбивка по системе хранения в целом сохраняется.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Без `send_batch_max_size`.** OneUptime перестраивает инвентарь по одному полному опросу, поэтому процессор `batch` никогда его не делит.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Это полный `otel-collector-config.yaml`, который запускает агент; значения `${env:...}` берутся из файла `.env`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "Пока вы не включите syslog-приёмники агента, он отправляет только метрики. Системы хранения пересылают свои оповещения и события аудита как syslog; агент проставляет `storage.array.name` на каждую строку, поэтому они попадают на страницу **Журналы** этой системы хранения.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. В `otel-collector-config.yaml` раскомментируйте приёмники `syslog/tcp` и `syslog/udp` и конвейер `logs`. Классические метки времени BSD syslog не содержат часового пояса: задайте в `location` часовой пояс системы хранения, если только её часы не идут по UTC.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. В `docker-compose.yml` раскомментируйте блок `ports:`, который публикует `5514/tcp` и `5514/udp`, и откройте порт в брандмауэре машины для сети управления системы хранения.",
  "3. Apply both:": "3. Примените оба изменения:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. На FlashArray от имени администратора откройте **Settings → System → Syslog Servers**, добавьте `udp://<agent-host>:5514` (или `tcp://<agent-host>:5514`) и отправьте тестовое сообщение.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Любой атрибут ресурса с префиксом `oneuptime.label.` становится меткой проекта на системе хранения: `oneuptime.label.<dimension>=<value>` даёт метку `<dimension>:<value>`. Добавьте их в процессор `resource` используемой конфигурации коллектора рядом с `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "Затем перезапустите коллектор, чтобы он прочитал новую конфигурацию:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Система хранения появится с метками `team:storage` и `env:production`. Метки сравниваются без учёта регистра, поэтому существующая метка `Production` используется повторно; метки, добавленные в интерфейсе OneUptime, агент никогда не удаляет.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Каждое значение — это gauge, который FlashArray вычисляет сам: задержка на операцию в микросекундах, пропускная способность в секунду. На этом построены страницы систем хранения OneUptime, каталог метрик и шаблоны оповещений:",
  "| Endpoint | Data |": "| Конечная точка | Данные |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Система хранения** (`/metrics/array`) | `purefa_info`, ёмкость и сокращение данных (`purefa_array_space_*`), производительность, открытые оповещения (`purefa_alerts_open`), аппаратные компоненты, диски, контроллеры и сетевые интерфейсы |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Тома** (`/metrics/volumes`) | Задержка, IOPS, пропускная способность, место и сокращение данных по каждому тому |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Хосты** (`/metrics/hosts`) | Подключение, подключённые тома, задержка, IOPS и место по каждому хосту |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Поды** (`/metrics/pods`) | Отставание каналов репликации ActiveCluster и ActiveDR, состояние медиатора, производительность и место |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Каталоги** (`/metrics/directories`) | Место и производительность управляемых каталогов файловых служб FlashArray |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "Один агент читает одну систему хранения. Чтобы отслеживать несколько систем с одной машины, установите каждый агент в отдельную папку с собственным `.env` и собственным именем контейнера, так как два контейнера не могут носить одно имя:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Без `STORAGE_ARRAY_AGENT_CONTAINER_NAME` скрипт называет контейнер по папке. Он записывает имя в `.env` этого агента, поэтому имя сохраняется при повторном запуске скрипта для обновления агента, а агент, чей `container_name` вы когда-то изменили в `docker-compose.yml`, сохраняет это имя. При установке через Docker Compose вместо этого задайте `STORAGE_ARRAY_AGENT_CONTAINER_NAME` в `.env` каждого агента.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "Агент поставляется с юнитом systemd, который рассчитан на папку скрипта установки, `/opt/oneuptime-storage-array-agent`. Скрипт установки его не скачивает, поэтому скачайте его сами:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Обновить**: образ коллектора закреплён в `docker-compose.yml`, а его конфигурации лежат в файлах рядом, поэтому одна загрузка образа агент не обновит. Запустите скрипт установки ещё раз. Он берёт каждое значение из вашего существующего `.env` (ничего не спрашивает снова), скачивает последние `docker-compose.yml` и конфигурации коллектора (изменённый вами файл сохраняется рядом с новым как `<file>.bak.<timestamp>`) и пересоздаёт с ними агент:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "Агенту, установленному не в `/opt/oneuptime-storage-array-agent` (например, агенту второй системы хранения), нужна его папка: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the three collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "Устанавливали через Docker Compose? В папке агента снова скачайте файл compose и три конфигурации коллектора; ваш `.env` остаётся, а изменения, которые вы вносили в любой из этих файлов, придётся внести заново:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Затем загрузите образы и пересоздайте агент, чтобы коллектор прочитал новую конфигурацию:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Конфигурация сообщает версию коллектора, которую она закрепляет, как **Версия агента** системы хранения. Когда этот OneUptime закрепляет более новую, рядом появляется предупреждающий знак, который открывает эти команды.",
  "**Uninstall** the agent:": "**Удалить** агент:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Затем удалите на системе хранения пользователя только для чтения и его API-токен, если они вам больше не нужны.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` проверяет всю цепочку (среду выполнения контейнеров, конечную точку системы хранения ровно так, как её достигает коллектор, то есть собственную конечную точку или экспортер Pure, с DNS, TLS и API-токеном, проставление имени системы хранения, собственные метрики коллектора) и напрямую спрашивает OneUptime, принимает ли он ваш ключ приёма. Последняя проверка важнее всего: конечные точки OTLP в OneUptime отклоняют неверный ключ с `401` или `422`, а коллектор записывает это одной строкой `Exporting failed` на пакет, которую легко пропустить, поэтому скрипт запрашивает у `GET /otlp/v1/validate` прямой ответ 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "В конце он выдаёт вывод с наиболее вероятной причиной.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Проверьте журналы коллектора: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` означает, что система хранения отклонила API-токен, `404` — что у FlashArray нет собственной конечной точки, `x509` — что проверка TLS включена против самоподписанного сертификата системы хранения, `no such host` или `connection refused` — неверный `PURE_FA_ENDPOINT`, а `401` при экспорте — неверный ключ приёма.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Убедитесь, что `STORAGE_ARRAY_NAME` задан: обнаружение опирается на атрибут ресурса `storage.array.name`, и без него коллектор не запускается.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Убедитесь, что `STORAGE_ARRAY_COLLECTOR_CONFIG` и `COMPOSE_PROFILES` указывают одну и ту же платформу.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "У Purity//FA на этом FlashArray нет собственной конечной точки OpenMetrics. Задайте в `.env` `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` и `COMPOSE_PROFILES=flasharray-exporter` и выполните `docker compose up -d` — или снова запустите `install.sh`, выбрав вариант для более старой Purity. После обновления системы хранения до Purity//FA 6.7 или новее вернитесь к собственной конфигурации и уберите профиль.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Проверьте, что вы вставили токен, а не пароль пользователя; что пользователь всё ещё существует и имеет роль readonly; и что срок действия токена не истёк. Создайте новый токен (`pureadmin create --api-token oneuptime` на FlashArray), укажите его в `.env` как `PURE_FA_API_TOKEN` и выполните `docker compose up -d`.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Системы хранения по умолчанию предъявляют самоподписанный сертификат, которому не доверяет ни один образ Docker. Задайте `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (прагматичный выбор в частной сети управления) или установите на систему хранения сертификат от CA, которому доверяет образ коллектора.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` или `pure-fb-exporter` не запущен: `COMPOSE_PROFILES` должен соответствовать `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` для конфигурации с экспортером FlashArray, `flashblade` для конфигурации FlashBlade. Исправьте `.env` и выполните `docker compose up -d`; после этого `docker compose ps` покажет экспортер.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Проверьте, что агент запущен: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Проверьте журналы агента на ошибки: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Убедитесь, что URL OneUptime и ключ приёма указаны верно.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Убедитесь, что с машины агента по сети доступен экземпляр OneUptime.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Идентичность системы хранения задаёт `STORAGE_ARRAY_NAME`, проставляемый на каждую метрику как `storage.array.name`. Исправьте его в `.env` и примените командой `docker compose up -d` в папке агента; учтите, что новое имя регистрирует новую систему хранения.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Он регистрирует систему хранения как **`array-1`** — под именем, которое у неё уже есть в OneUptime.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Это устанавливает агент для **`array-1`**: оставьте `STORAGE_ARRAY_NAME` ровно таким, как есть, иначе данные зарегистрируются как новая система хранения.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Идентичность системы хранения задаёт `STORAGE_ARRAY_NAME`, проставляемый на каждую метрику как `storage.array.name`. Эта система хранения называется **`array-1`**. Исправьте его в `.env` и примените командой `docker compose up -d` в папке агента; учтите, что новое имя регистрирует новую систему хранения.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "Команда уже содержит ваш URL OneUptime, ключ приёма и платформу, выбранную выше. Скрипт запрашивает:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Доступ с этой машины к `quay.io`, откуда Docker загружает образ экспортера Pure",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` запускает `pure-fa-exporter`, экспортер Pure, рядом с коллектором; они должны соответствовать друг другу.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` в папке агента также показывает **`pure-fa-exporter`** — экспортер Pure, через который коллектор читает FlashArray.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Коллектор читает FlashArray через `pure-fa-exporter`, экспортер Pure, который входит в REST API FlashArray с токеном, передаваемым коллектором при каждом опросе. Порт экспортера остаётся внутри сети compose.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 или новее с плагином Docker Compose v2 на машине, с которой по HTTPS (TCP 443) доступен адрес управления FlashBlade",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "Учётная запись администратора на FlashBlade, чтобы создать для агента пользователя только для чтения",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "На FlashBlade от имени администратора создайте пользователя с именем `oneuptime` и ролью **readonly** (в настройках пользователей графического интерфейса FlashBlade или с помощью `pureadmin` в CLI Purity//FB) и создайте для него **API-токен**. Создайте токен **без срока действия**, иначе агент остановится в тот день, когда токен истечёт.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "API-токены FlashBlade начинаются с `T-`. Выпуск Purity//FB без локальных пользователей вместо этого использует учётную запись службы каталогов (LDAP или Active Directory), группа которой сопоставлена с ролью readonly.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- **адрес управления** FlashBlade (имя хоста или IP, без `https://`) и **API-токен** пользователя только для чтения, который скрипт считывает без вывода на экран",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Задайте в `PURE_FB_ENDPOINT` адрес управления FlashBlade (имя хоста или IP, без `https://`), а в `PURE_FB_API_TOKEN` — API-токен пользователя только для чтения. Выполните `chmod 600 .env`: в файле хранится токен.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` в папке агента также показывает **`pure-fb-exporter`** — экспортер Pure, через который коллектор читает FlashBlade.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Коллектор читает FlashBlade через `pure-fb-exporter`, экспортер Pure, который входит в REST API FlashBlade с токеном, передаваемым коллектором при каждом опросе. Порт экспортера остаётся внутри сети compose.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Одно задание опроса на конечную точку**, каждая читается так часто, как это оправдано: `/metrics/array` каждые 60 секунд; `/metrics/filesystems` и `/metrics/objectstore` каждые 5 минут, так как REST API FlashBlade не рассчитан на быстрый отчёт по каждой файловой системе и каждому бакету.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. На FlashBlade от имени администратора добавьте в настройках syslog сервер syslog `udp://<agent-host>:5514` (или `tcp://`).",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Каждое значение — это gauge, который FlashBlade вычисляет сам: задержка на операцию в микросекундах, пропускная способность в секунду. На этом построены страницы систем хранения OneUptime, каталог метрик и шаблоны оповещений:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Система хранения** (`/metrics/array`) | `purefb_info`, ёмкость и сокращение данных (`purefb_array_space_*`), производительность по протоколам, открытые оповещения (`purefb_alerts_open`), состояние оборудования (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **Файловые системы** (`/metrics/filesystems`) | Место, сокращение данных и производительность по каждой файловой системе |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Объектное хранилище** (`/metrics/objectstore`) | Место, квота, число объектов и производительность по каждому бакету |",
};

export default TRANSLATION;
