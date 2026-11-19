import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker, установленный на хосте, который нужно отслеживать",
  "Network access from the host to your OneUptime instance":
    "Сетевой доступ с хоста к вашему экземпляру OneUptime",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Сохраните это как `config.yaml` в каталоге, из которого будете запускать `docker run`, — шаг 3 смонтирует файл в контейнер.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить `<YOUR_API_KEY>`.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` и монтирование `/hostfs` позволяют скрейперам `hostmetrics` и `process` читать сведения о ЦП, памяти, дисках и каждом процессе из ядра хоста, а не контейнера. Без них вы увидите только метрики самого контейнера коллектора.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Откройте список **Хосты** в OneUptime — ваш хост появится автоматически, как только придёт первый пакет метрик (обычно в течение 30 секунд). Его нет? Проверьте коллектор:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**Расследования ИИ включены по умолчанию** для каждого хоста: как только на нём запущен ИИ-агент хоста, ИИ OneUptime расследует там инциденты и оповещения командами только для чтения, такими как `systemctl status`, `df -h`, `free -m` и `ps aux`, и ничего не меняет, пока вы не разрешите исправления. Это Linux-контейнер с собственным установщиком, поэтому добавляйте его только на хосты Linux; ему нужен Docker (системный движок, а не rootless Docker) с плагином Compose:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "Первая строка скачивает скрипт как `install.sh`, чтобы вы могли прочитать его перед запуском. Он спрашивает URL OneUptime, ключ приёма и имя хоста — оставьте имя пустым, чтобы использовать имя хоста, которое и сообщает этот коллектор. После подключения агент отображается как подключённый на странице хоста **ИИ → ИИ-агент** и внизу его вкладки **Обзор**. Что ему разрешено выполнять и как работают исправления: [ИИ-агенты для инфраструктуры](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Конфигурация уже заносит IP-адреса, MAC-адреса, архитектуру, идентификатор машины, описание и версию ОС в элемент машины в разделе **Инвентарь** — именно его читает экспорт в CMDB. Серийный номер, производитель, модель и версия прошивки (BIOS / UEFI) — другое дело: **ни один детектор ресурсов не может их получить.** Они берутся из прошивки машины через DMI. Прочитайте их один раз при подготовке машины и закрепите на ресурсе — добавьте этот процессор в `config.yaml`, который вы смонтировали в контейнер, и укажите его в конвейере метрик. Объедините его с разделами, которые уже есть в вашей конфигурации, — не добавляйте второй ключ `processors:` или `service:`.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Затем пересоздайте контейнер, чтобы он прочитал изменённый файл: удалите его и снова выполните команду `docker run` из шага 3:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "Эти значения принадлежат самой машине, поэтому их один раз записывает то, что её подготавливает. В Linux читайте их от root (`bios_version` доступен для чтения всем):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "Через несколько минут значения появятся в элементе машины в разделе **Инвентарь**, в блоке **Подробности**. Они закреплены, а не обнаружены, поэтому повторите это после замены материнской платы или обновления прошивки.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` и `host.bios.version` принимаются как альтернативные написания и сохраняются под ключами `device.*` выше (а `device.serial_number` — под `host.serial_number`), так что конфигурация, написанная тем или иным способом, попадает в одно место.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **Не задавайте `device.manufacturer` из одной и той же конфигурации и для ресурса мобильного приложения, и для ресурса хоста.** На ресурсе без `host.name` и `host.id` атрибут `device.manufacturer` всё равно помечает пакет как мобильный Real User Monitoring.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Любой атрибут ресурса с префиксом `oneuptime.label.` становится меткой проекта, привязанной к хосту (и к службе телеметрии, которую отправляет этот коллектор). Шаблон: `oneuptime.label.<dimension>=<value>` превращается в метку с именем `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Добавьте процессор `resource` в `config.yaml`, который вы смонтировали в контейнер, и сошлитесь на него из конвейера метрик. Объедините его с разделами, которые уже есть в вашей конфигурации, — не добавляйте второй ключ `processors:` или `service:`.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "Хост появится с метками `team:payments`, `env:production` и `region:us-east-1`. Метки сравниваются без учёта регистра, поэтому существующая метка `Production`, созданная вручную, используется повторно, а не дублируется. Метки, добавленные вручную в интерфейсе OneUptime, коллектор никогда не удаляет.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Хосты обнаруживаются автоматически по атрибуту ресурса OTel `host.name`, который задаёт процессор `resourcedetection`. OneUptime регистрирует хост, как только пакет с `host.name` содержит также что-либо из следующего:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- метрики приёмника `hostmetrics` (ЦП, память, диск, файловая система, сеть, нагрузка, процессы), ИЛИ",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- метрики скрейпера `process` (ЦП/память/потоки по каждому процессу), ИЛИ",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- атрибут ресурса `os.type` или `container.runtime` в метриках, журналах или трассировках",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…и начинает заполнять вкладки «Обзор», «Метрики», «Процессы» и «Журналы». Одних `host.id` или `host.arch` для регистрации хоста недостаточно, а телеметрия с идентичностью Kubernetes (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) попадает в свой кластер Kubernetes.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**Работаете в OpenStack?** Используйте `detectors: [nova, system, env]`, чтобы `host.id` был UUID экземпляра и OneUptime связал этот хост с его экземпляром, и задайте для `host.name` значение `enabled: false` в `nova: resource_attributes:`, чтобы его имя осталось тем, что сообщает `system`.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "Те же атрибуты ресурса становятся элементом машины в разделе **Инвентарь** — именно его читает экспорт в CMDB. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` и `os.version` берутся из процессора `resourcedetection`; у серийного номера, производителя, модели и версии прошивки детектора нет, и они закрепляются отдельно (см. **Записать серийный номер, производителя, модель и версию прошивки**).",
  "Once the host is reporting:": "Когда хост начнёт отправлять данные:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- Вкладка **Метрики** показывает временные ряды `system.*`.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- Вкладка **Процессы** перечисляет процессы, упорядоченные по ЦП, как только включён скрейпер `process`.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- Вкладка **Журналы** в реальном времени показывает все журналы, атрибуты ресурса которых содержат `host.name`.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "Конфигурация сообщает выпуск коллектора, для которого она написана (`oneuptime.agent.version`), в поле **Версия агента** хоста. Когда этот OneUptime закрепляет более новый выпуск, значок предупреждения рядом с ней открывает эти шаги.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Снова сохраните конфигурацию из шага 2 с тем же ключом приёма: она сообщит новую версию. Перенесите в неё все изменения, которые вы вносили в свою.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. В папке, где она лежит, установите новый выпуск и перезапустите коллектор:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Проверьте журналы коллектора на ошибки экспорта: `docker logs -f otel-collector`. HTTP `401` означает, что ключа нет, он неверен или истёк; `422` — что он отключён (или это ключ браузера, который не может отправлять телеметрию хостов). Выберите рабочий ключ на шаге 1 и обновите `x-oneuptime-token` в `config.yaml`, который вы смонтировали в контейнер.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Убедитесь, что хост достаёт до OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` с той же машины.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Оставьте `resourcedetection` в конвейере метрик — он задаёт `host.name`, по которому OneUptime узнаёт хост.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "Коллектор читает ядро глазами собственного контейнера. Запустите его с `--network host`, `--pid host`, монтированием `/:/hostfs` и переменными `HOST_*` точно так, как показано в шаге 3, — без них скрейперы `hostmetrics` и `process` видят только сам контейнер коллектора.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "Хост Debian или Ubuntu (amd64 или arm64) с `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Сохраните это как `config.yaml` в текущем каталоге — шаг 3 его установит.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Примечание для нативных установок:** в отличие от Docker, установка из пакета читает `/proc` и `/sys` напрямую — переменные окружения `HOST_PROC` и монтирование `/hostfs` не нужны. Юнит systemd из пакета работает от непривилегированного пользователя `otelcol-contrib`; если нужно, чтобы скрейпер `process` видел процессы других пользователей, выдайте ему `CAP_SYS_PTRACE` или запускайте его от root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` содержит приёмник `systemd` начиная с **v0.142.0**; используйте **v0.143.0 или новее** — в ней его метрика ЦП получила нынешнее имя, и он перестал опрашивать юниты, не являющиеся службами. Включите его, добавив в `/etc/otelcol-contrib/config.yaml` и в конвейер метрик. Объедините его с разделами, которые уже есть в вашей конфигурации, — не добавляйте второй ключ `processors:` или `service:`.",
  "Then restart the service:": "Затем перезапустите службу:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Приёмник работает **только в Linux** и находится в стадии **альфа**. Он читает состояние юнитов через системную шину D-Bus теми же вызовами только для чтения, что и `systemctl list-units`, которые systemd разрешает без привилегий, поэтому служба из пакета, работающая от пользователя `otelcol-contrib`, не нуждается в дополнительных правах. Коллектор в контейнере не может достучаться до шины хоста, поэтому используйте нативную установку. Как только придут метрики, вкладка **Юниты systemd** хоста заполнится всеми собранными юнитами и их текущим состоянием (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Каждый юнит стоит восемь точек данных за опрос для набора состояний и ещё две, если оставить метрику ЦП включённой, поэтому на хосте с сотнями юнитов сузьте `units:` или увеличьте `collection_interval`, а не собирайте всё.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**Расследования ИИ включены по умолчанию** для каждого хоста: как только на нём запущен ИИ-агент хоста, ИИ OneUptime расследует там инциденты и оповещения командами только для чтения, такими как `systemctl status`, `df -h`, `free -m` и `ps aux`, и ничего не меняет, пока вы не разрешите исправления. Это Linux-контейнер с собственным установщиком; ему нужен Docker (системный движок, а не rootless Docker) с плагином Compose:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Конфигурация уже заносит IP-адреса, MAC-адреса, архитектуру, идентификатор машины, описание и версию ОС в элемент машины в разделе **Инвентарь** — именно его читает экспорт в CMDB. Серийный номер, производитель, модель и версия прошивки (BIOS / UEFI) — другое дело: **ни один детектор ресурсов не может их получить.** Они берутся из прошивки машины через DMI, а коллектор из пакета работает без привилегий и не может прочитать их сам. Прочитайте их один раз при подготовке машины и закрепите на ресурсе — добавьте этот процессор в `/etc/otelcol-contrib/config.yaml` и укажите его в конвейере метрик. Объедините его с разделами, которые уже есть в вашей конфигурации, — не добавляйте второй ключ `processors:` или `service:`.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Добавьте процессор `resource` в `/etc/otelcol-contrib/config.yaml` и сошлитесь на него из конвейера метрик. Объедините его с разделами, которые уже есть в вашей конфигурации, — не добавляйте второй ключ `processors:` или `service:`.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- Вкладка **Юниты systemd** показывает состояние юнитов, как только включён приёмник `systemd` (см. **Включить вкладку «Юниты systemd»**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Проверьте журналы коллектора на ошибки экспорта: `sudo journalctl -u otelcol-contrib -f`. HTTP `401` означает, что ключа нет, он неверен или истёк; `422` — что он отключён (или это ключ браузера, который не может отправлять телеметрию хостов). Выберите рабочий ключ на шаге 1 и обновите `x-oneuptime-token` в `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Держите `resourcedetection` в том же конвейере метрик, что и приёмник `systemd`, — приёмник прикрепляет к каждому юниту только `systemd.unit.name`, так что без `host.name` выборки никогда не привяжутся к хосту.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Используйте `otelcol-contrib` v0.143.0 или новее: более старые сборки останавливаются при запуске с `'receivers' unknown type: \"systemd\"` или называют метрику ЦП иначе (см. **Включить вкладку «Юниты systemd»**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Проверьте, что коллектор достаёт до системной шины D-Bus: `/run/dbus/system_bus_socket` должен существовать, а `systemctl list-units`, запущенный от пользователя коллектора, — самая быстрая проверка. Root не нужен.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "Хост RHEL, CentOS, Fedora или Amazon Linux (x86_64 или aarch64) с `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "Хост Linux (x86_64 или aarch64) с systemd и `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Положите юнит systemd в `/etc/systemd/system/otelcol-contrib.service`:",
  "Then enable and start it:": "Затем включите и запустите его:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Используйте этот способ, когда пакеты недоступны, — на закрытых серверах или для базовых образов контейнеров, которые вы хотите инструментировать снаружи. Переменные окружения `HOST_PROC` и монтирование `/hostfs` не нужны: коллектор читает состояние ядра напрямую, а `User=root` позволяет скрейперу `process` видеть процессы других пользователей (выдача `CAP_SYS_PTRACE` тоже подойдёт).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Приёмник работает **только в Linux** и находится в стадии **альфа**. Он читает состояние юнитов через системную шину D-Bus теми же вызовами только для чтения, что и `systemctl list-units`, которые systemd разрешает без привилегий, поэтому ему не нужны дополнительные права. Коллектор в контейнере не может достучаться до шины хоста, поэтому используйте нативную установку. Как только придут метрики, вкладка **Юниты systemd** хоста заполнится всеми собранными юнитами и их текущим состоянием (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Конфигурация уже заносит IP-адреса, MAC-адреса, архитектуру, идентификатор машины, описание и версию ОС в элемент машины в разделе **Инвентарь** — именно его читает экспорт в CMDB. Серийный номер, производитель, модель и версия прошивки (BIOS / UEFI) — другое дело: **ни один детектор ресурсов не может их получить.** Они берутся из прошивки машины через DMI. Прочитайте их один раз при подготовке машины и закрепите на ресурсе — добавьте этот процессор в `/opt/otelcol-contrib/config.yaml` и укажите его в конвейере метрик. Объедините его с разделами, которые уже есть в вашей конфигурации, — не добавляйте второй ключ `processors:` или `service:`.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "Mac (Apple Silicon или Intel) и учётная запись администратора для `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Создайте `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:",
  "Load it:": "Загрузите его:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Установите сборку contrib, как показано выше.** В сборке core `otelcol` нет процессора `resourcedetection`, поэтому с этой конфигурацией она не запускается.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Конфигурация уже заносит IP-адреса, MAC-адреса, архитектуру, идентификатор машины, описание и версию ОС в элемент машины в разделе **Инвентарь** — именно его читает экспорт в CMDB. Серийный номер, производитель, модель и версия прошивки (BIOS / UEFI) — другое дело: **ни один детектор ресурсов не может их получить.** Они берутся из прошивки машины. Прочитайте их один раз при подготовке машины и закрепите на ресурсе — добавьте этот процессор в `/etc/otelcol-contrib/config.yaml` и укажите его в конвейере метрик. Объедините его с разделами, которые уже есть в вашей конфигурации, — не добавляйте второй ключ `processors:` или `service:`.",
  "Then restart the collector:": "Затем перезапустите коллектор:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "Эти значения принадлежат самой машине, поэтому их один раз записывает то, что её подготавливает. На Mac читайте их так (производитель — `Apple Inc.`):",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` — это *идентификатор* модели (`MacBookPro18,3`), а не её торговое название. Всё равно укажите его в `device.model.name`: `device.model.identifier` помечает пакет как мобильное приложение.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ или Windows Server 2019+ (для встроенного `tar.exe`)",
  "An elevated PowerShell prompt (Run as administrator)":
    "Командная строка PowerShell с повышенными правами («Запуск от имени администратора»)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Сохраните это как `config.yaml` в папке, из которой будете запускать команды PowerShell, — шаг 3 скопирует файл на место.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "В Windows установите исходный коллектор **`otelcol-contrib`** — начиная с **v0.155.0** в нём есть приёмник `windows_service`, который наполняет вкладку **Сервисы** хоста. Выполните в командной строке PowerShell с повышенными правами:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Примечание:** служба работает как `LocalSystem`, чтобы читать все службы Windows. В Windows скрейпер `load` лишь эмулирует среднюю нагрузку по счётчику *Processor Queue Length* (он начинается с 0); если счётчик прочитать не удаётся, это записывается в журнал и пропускается, а остальная конфигурация `hostmetrics` работает без изменений. [Документация по OpenTelemetry Collector для хостов](/docs/telemetry/host-otel-collector) описывает и подписанный установщик `.msi`.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "Журналы пишутся в журнал событий Windows «Приложение»; смотрите их в **Event Viewer → Windows Logs → Application** (источник `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Начиная с **v0.155.0** `otelcol-contrib` содержит приёмник `windows_service` — включите его, добавив в `C:\\Program Files\\otelcol-contrib\\config.yaml` и в конвейер метрик. Объедините его с разделами, которые уже есть в вашей конфигурации, — не добавляйте второй ключ `processors:` или `service:`.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "Приёмник работает **только в Windows** и находится в стадии **альфа**. Как только придут метрики, вкладка **Сервисы** хоста автоматически заполнится состоянием и типом запуска каждой службы.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "Конфигурация уже заносит IP-адреса, MAC-адреса, архитектуру, идентификатор машины, описание и версию ОС в элемент машины в разделе **Инвентарь** — именно его читает экспорт в CMDB. Серийный номер, производитель, модель и версия прошивки (BIOS / UEFI) — другое дело: **ни один детектор ресурсов не может их получить.** Они берутся из прошивки машины через WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Выполните это в командной строке PowerShell с повышенными правами на самой машине — скрипт опрашивает WMI и выводит точный YAML для *этой* машины:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Он выводит одну запись процессора, уже с отступами. Добавьте её внутрь блока `processors:`, который уже есть в вашем `config.yaml`, — рядом с `resourcedetection:`, `resource:` и `batch:`, а не вторым ключом `processors:`, — затем укажите её в конвейере метрик:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Используйте `Get-CimInstance`, а не устаревший `Get-WmiObject` — его нет в PowerShell 7 и новее. Значения выводятся в одинарных кавычках с удвоенными внутренними кавычками, поэтому серийный номер или модель со знаками препинания остаются корректным YAML. Поле, которое прошивка оставляет пустым, выводится как `''`; уберите этот атрибут, а не отправляйте пустой.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "Через несколько минут элемент машины в разделе **Инвентарь** покажет в блоке **Подробности** `host.serial_number`, `device.manufacturer`, `device.model.name` и `device.firmware.version` рядом с IP- и MAC-адресами и идентификатором машины, которые уже даёт детектор. Повторите это после замены материнской платы или обновления BIOS — значения закреплены, а не обнаружены, поэтому сами не обновляются.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- Вкладка **Сервисы** показывает состояние каждой службы, как только включён приёмник `windows_service` (см. **Включить вкладку «Службы Windows»**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Проверьте журналы коллектора на ошибки экспорта: **Event Viewer → Windows Logs → Application** (источник `otelcol-contrib`). HTTP `401` означает, что ключа нет, он неверен или истёк; `422` — что он отключён (или это ключ браузера, который не может отправлять телеметрию хостов). Выберите рабочий ключ на шаге 1 и обновите `x-oneuptime-token` в `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Запустите коллектор на переднем плане, чтобы увидеть настоящую ошибку вместо общей `Error 1064`:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` означает, что служба указывает на несуществующий файл, — сравните `BINARY_PATH_NAME` из `sc.exe qc "otelcol-contrib"` с содержимым `C:\\Program Files\\otelcol-contrib`. Архив должен быть именно `otelcol-contrib_`, из которого распаковывается `otelcol-contrib.exe`.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (источник `otelcol-contrib`) записывает ошибку запуска, которую проглотил диспетчер служб.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Если вы задали `include_services`, но по-прежнему видите все службы, коллектор не подхватил изменение — перезапустите службу (`Restart-Service otelcol-contrib`) и дайте вкладке «Сервисы» несколько минут, чтобы обновить скользящее окно.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Узлы Kubernetes отслеживает **агент Kubernetes от OneUptime**, а не коллектор хоста: каждый узел появляется в разделе **Kubernetes** → ваш кластер → **Узлы**, рядом со своими подами и рабочими нагрузками, а не в списке **Хосты**. Шаги ниже устанавливают агент в стандартный кластер; в руководстве по установке в разделе **Kubernetes** есть шаги для Amazon EKS, Google GKE, Azure AKS, GKE Autopilot и EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "Кластер Kubernetes версии v1.23 или новее",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` и `helm` (v3), установленные на вашем компьютере",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Не тот кластер? Переключитесь командой `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Замените `my-cluster` именем этого кластера, например `prod-us-east-1`. Под этим именем кластер отображается в OneUptime, поэтому не меняйте его: новое имя регистрирует новый кластер.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` включает **расследования ИИ**, как и делает chart по умолчанию: ИИ OneUptime расследует инциденты и оповещения этого кластера с помощью kubectl только для чтения через ИИ-агент Kubernetes.",
  "You should see:": "Вы должны увидеть:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Коллектор и ИИ-агент Kubernetes, а также по одному поду `-logs` и `-ebpf` на каждом узле. Когда они перейдут в `Running`, кластер автоматически появится в разделе **Kubernetes**, обычно через минуту-две.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**ИИ-агент Kubernetes (включён по умолчанию, только чтение).** Под `kubernetes-agent-ai-agent` позволяет ИИ OneUptime расследовать инциденты и оповещения этого кластера с помощью kubectl только для чтения (`get`, `describe`, `logs`, `events`, `top`) с тем же ключом API, и он ничего не может изменить, пока вы позже не дадите ему права на запись. Откройте кластер и перейдите в **ИИ → Агент**, чтобы его увидеть. Не нужен? Устанавливайте с `--set aiAgent.enabled=false` вместо `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Правила для пространств имён определяют, что агент собирает из каждого пространства имён. Чтобы собирать журналы подов и данные eBPF только из `default`, `production` и `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Чтобы оставить всё, но остановить журналы шумных пространств имён, исключите их только из `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Области:** `podLogs` (stdout/stderr контейнеров), `ebpfDiscovery` (трассировки и метрики eBPF), `metrics` (метрики с пространством имён) и `traces` (каждый span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Шаблоны** сопоставляются с полным именем пространства имён и допускают `*`, как в `team-*`. Правило `exclude` всегда побеждает правило `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Свои правила заменяют правило по умолчанию**, которое исключает `kube-system` из `podLogs` и `ebpfDiscovery`. Оставьте его в своём списке, как во втором примере, если оно вам всё ещё нужно.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- У метрик узлов и кластера нет пространства имён, поэтому они сохраняются всегда.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` требует Helm 3.10 или новее.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Отправлять только важные строки.** Отбрасывайте строки журналов подов ниже заданной важности до того, как они покинут кластер:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Принимает `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` и `FATAL`: `WARN` оставляет предупреждения, ошибки и фатальные строки. Важность читается из самой строки журнала (`[ERROR]`, `level=warn`, `"level":"info"`). События Kubernetes этим никогда не отбрасываются.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Отключить журналы подов.** Метрики это не затрагивает: коллектор узлов продолжает работать для метрик kubelet и cAdvisor и лишь перестаёт читать журналы подов:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Изменить способ чтения журналов.** Preset выбирает его за вас; явный `logs.mode` всегда имеет приоритет:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: читает `/var/log/pods` на каждом узле через hostPath (наименьшие накладные расходы; требуется hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: Deployment отслеживает журналы подов через API Kubernetes (работает в любом кластере).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: без журналов подов.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Так читается API-сервер, там, где он отвечает внутри кластера. etcd, планировщик и диспетчер контроллеров отвечают на узлах плоскости управления, которые под агента угадать не может, поэтому он читает их, как только вы укажете адрес каждого узла:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Планировщик и диспетчер контроллеров** отдают HTTPS и принимают токен агента, но kubeadm привязывает их к `127.0.0.1`: задайте им `--bind-address`, доступный поду агента.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** отдаёт свои метрики по обычному HTTP на `--listen-metrics-urls` kubeadm (порт 2381, привязанный к `127.0.0.1`, пока вы не добавите адрес узла), как показано выше. Или опрашивайте его клиентский порт HTTPS, 2379, с клиентским сертификатом, который он запрашивает: поместите `ca.crt`, `tls.crt` и `tls.key` в Secret в `oneuptime-agent` и укажите его в `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Только для самостоятельно управляемых кластеров: управляемые сервисы (EKS, GKE, AKS) не открывают метрики своей плоскости управления.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Мониторинг затрат включён по умолчанию: агент включает открытый движок OpenCost (и небольшой Prometheus, который ему нужен), рассчитывает стоимость ваших узлов и томов по публичным прайс-листам вашего облачного провайдера, без учётных данных, и отправляет, сколько стоит каждое пространство имён и каждая рабочая нагрузка. Первые данные появляются в обзоре кластера и на его странице «Затраты» после первого полного часа.",
  "On an agent installed before it was on by default, upgrade it:":
    "Если агент был установлен до того, как мониторинг затрат стал включаться по умолчанию, обновите его:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Отключение:** добавьте `--set cost.enabled=false` в ту же команду обновления.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **Уже используете Kubecost или OpenCost?** Направьте агент на него, и ничего не будет установлено дополнительно: добавьте `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (или ваш сервис Kubecost).",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **Свои серверы или bare metal?** Задайте тарифы с помощью `--set cost.opencost.customPricing.enabled=true` (USD за час ресурса; см. `values.yaml` chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Полное руководство: [Наблюдаемость затрат Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Агент запускает [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) на каждом узле. Она перехватывает трафик HTTP/HTTPS, gRPC и SQL/Redis от сервисов на Go, .NET, Java, Node.js, Python, Ruby и Rust, без SDK и без sidecar, и отправляет трассировки, метрики запросов (RED) и данные графа сервисов через коллектор.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Требования:** ядро Linux **5.8+** с BTF (по умолчанию в Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Поды eBPF работают в **привилегированном** режиме, который нужен им для загрузки программ eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Отключите её**, если на узлах старое ядро, если привилегированные поды запрещены или если ваши сервисы уже отправляют трассировки через SDK OpenTelemetry и вам не нужны дубликаты:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Выбрать сигналы.** Каждое семейство включается или отключается через `--set ebpf.features.<name>=false` (или `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | По умолчанию | Что добавляет |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | вкл. | Частота запросов HTTP/gRPC, ошибки и задержка по сервисам |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | вкл. | Число вызовов и длительность span-ов (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | вкл. | Рёбра вызывающий → вызываемый; строит карту сервисов |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | вкл. | Счётчики потоков TCP/UDP между подами |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | выкл. | Сетевые метрики между зонами (удваивает их кардинальность) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | вкл. | RTT TCP и счётчики неудачных соединений и повторных передач на уровне узла |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Сквозное распространение трассировок между сервисами** (связывание в одну трассировку запроса, идущего из пода A → под B, в том числе на другом узле) **включено по умолчанию**. Оно работает, переписывая уже идущий трафик (расширяя открытые HTTP-запросы в ядре и добавляя опцию TCP к TLS и чистому TCP), и ошибка в этом подсчёте байтов рассинхронизирует поток: заявленный симптом — передачи через прокси L7, например nginx, которые зависают, как только ответ превышает ~64KB. Если вы это видите или service mesh начинает ронять поды, отключите его с помощью `--set ebpf.contextPropagation=false`; SDK OpenTelemetry распространяет `traceparent` в пространстве пользователя без всего этого.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Каждая `oneuptime.labels.<key>=<value>` становится меткой `<key>:<value>` на кластере, а также на сервисах и хостах, о которых он сообщает. Метки сравниваются без учёта регистра, поэтому существующая метка `Production` используется повторно; метки, добавленные в интерфейсе OneUptime, агент никогда не удаляет.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Обновите** chart до последней версии. `--reset-then-reuse-values` (Helm 3.14+) сохраняет заданные вами значения (preset, имя кластера, фильтры) и берёт всё остальное из нового chart; добавьте сверху любые новые флаги `--set`:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "В Helm 3.13 и старше обновляйте вместо этого с заданными вами значениями:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Не используйте `--reuse-values`: он сохраняет и значения по умолчанию chart, с которого вы обновляетесь, поэтому значения по умолчанию более нового chart (среди них его образ eBPF) так и не применяются.",
  "**Uninstall** the agent and its namespace:":
    "**Удалите** агент и его пространство имён:",
  "| Category | Data |": "| Категория | Данные |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Метрики узлов** | Использование CPU, памяти, файловой системы и сети |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Метрики подов и контейнеров** | CPU, память, сетевой ввод-вывод и перезапуски |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Метрики кластера** | Состояния узлов, выделяемые ресурсы, число подов и рабочих нагрузок |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **События Kubernetes** | Предупреждения, ошибки и события планирования |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Журналы подов** | stdout/stderr каждого контейнера, прочитанные на каждом узле |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Трассировки приложений** *(eBPF)* | Span-ы HTTP, gRPC и SQL/Redis от каждого пода, без SDK и изменений кода |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Метрики запросов и граф сервисов** *(eBPF)* | Частота запросов, ошибки и задержка по сервисам, а также рёбра вызывающий → вызываемый для карты сервисов |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Сетевые потоки** *(eBPF)* | Счётчики байтов и пакетов TCP/UDP между подами |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Затраты рабочих нагрузок** *(включены по умолчанию)* | Расходы по пространствам имён, рабочим нагрузкам и подам, с простаивающей мощностью и эффективностью, а также в виде метрик для оповещений |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Ваш кластер блокирует тома `hostPath` или привилегированные поды. Это нормально для **GKE Autopilot** и **EKS Fargate**: выберите эту платформу вверху этого руководства и выполните её шаги. В **OpenShift**, напротив, установка проходит, но поды узлов агента так и не запускаются: выберите **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "В любом другом кластере с ограничительной политикой Pod Security удалите неудавшийся релиз:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Затем снова выполните команду установки, добавив `--set preset=gke-autopilot`. Этот preset читает журналы подов через API Kubernetes вместо hostPath, применяет усиленный контекст безопасности и не устанавливает привилегированные поды eBPF и профилирования.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Проверьте, что поды агента запущены: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Проверьте журналы коллектора: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Убедитесь, что URL OneUptime и ключ приёма в команде установки указаны верно.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Убедитесь, что кластер может достучаться до вашего экземпляра OneUptime по сети.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Проверьте под ИИ-агента: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Проверьте его журналы: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Пода нет? Обновите chart (см. **Обновление или удаление агента** в разделе Расширенный) и добавьте `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Проверьте, совпадает ли имя кластера: это руководство устанавливает **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Проверьте права RBAC агента: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Поищите ошибки экспорта в журналах коллектора: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Ядро слишком старое или без BTF.** eBPF требует Linux 5.8+ с BTF; проверьте командой `uname -r` на узле. Если обновить нельзя, отключите eBPF с помощью `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Привилегированные поды заблокированы.** Некоторые закрытые кластеры их отклоняют. Отключите eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` недоступны на хосте.** Отключите только семейство статистики TCP: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Проверьте, что поды eBPF исправны: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Включите отладочный вывод OBI, чтобы убедиться, что она видит трафик: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, затем прочитайте `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Если span-ы появляются там, но не в OneUptime, поищите ошибки экспорта в журналах коллектора: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
