import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 или новее",
  "Access to `/var/run/docker.sock` on the host":
    "Доступ к `/var/run/docker.sock` на хосте",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "Контейнеры, журналы которых вам нужны, должны использовать драйвер журналирования `json-file` — драйвер Docker по умолчанию",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Затем запустите рядом ИИ-агент OneUptime с теми же URL, ключом и именем хоста. **Расследования ИИ включены по умолчанию**: пока OneUptime AI расследует инцидент или оповещение на этом хосте, он выполняет через ИИ-агент команды `docker` только для чтения и ничего не меняет, пока вы не разрешите исправления, — см. **ИИ-агент OneUptime** в разделе Расширенный. Пропустите эту команду, чтобы запустить коллектор без расследований ИИ.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Замените `my-docker-host` именем этого хоста, например `prod-docker-01`. Под этим именем хост появляется в OneUptime, поэтому не меняйте его: новое имя регистрирует новый хост.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить его вместо `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Найдите в журналах эту строку:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Как только агент подключится, хост автоматически появится в разделе **Docker** — обычно примерно в течение минуты. ИИ-агент OneUptime отображается как Подключено на странице хоста **ИИ → ИИ-агент** и внизу его страницы **Обзор**.",
  "| Variable | Required | Description |":
    "| Переменная | Обязательна | Описание |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Да | URL вашего экземпляра OneUptime (например, `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Да | Ключ приёма телеметрии из шага 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | Нет | Понятное имя этого хоста. По умолчанию `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Нет | Версия API Docker Engine, на которой говорит агент. По умолчанию пусто: агент согласует её с демоном, поэтому работает любой Docker Engine начиная с 20.10. Задавайте её, только чтобы закрепить версию (см. Устранение неполадок) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| от `ONEUPTIME_LOG_OPERATOR_1` до `ONEUPTIME_LOG_OPERATOR_5` | Нет | Собственные операторы коллектора, каждый в виде JSON, для формата журналов, который агент не читает |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "Передайте каждую в `docker run` как `-e NAME=value`. Чтобы потом изменить одну из них, удалите агент командой `docker rm -f oneuptime-docker-agent` и снова выполните команду с новым значением.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "Агент читает `/var/lib/docker/containers/*/*-json.log`, поэтому видит только журналы контейнеров, которые используют драйвер журналирования Docker **`json-file`**. Это драйвер Docker по умолчанию, но некоторые хосты переходят на `local` (двоичные файлы, которые агент не может разобрать) или на удалённый драйвер (`journald`, `syslog`, `fluentd`, `gelf`, …), после которого не остаётся файлов для чтения.",
  "Check a container's log driver, and the daemon's default:":
    "Проверьте драйвер журналирования контейнера и драйвер демона по умолчанию:",
  "Switch a Compose service to `json-file`, with rotation:":
    "Переключите сервис Compose на `json-file` с ротацией:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "Или измените драйвер демона по умолчанию для всех контейнеров, создаваемых после этого, в `/etc/docker/daemon.json`:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "Затем перезапустите Docker и **пересоздайте** затронутые контейнеры (простого перезапуска мало): контейнер сохраняет драйвер журналирования, с которым он был создан.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, второй контейнер, который запускает шаг 2, выполняет команды `docker`, которые запрашивает OneUptime AI, пока расследует инцидент или оповещение на этом хосте. **Расследования ИИ включены по умолчанию**: как только он подключится, OneUptime AI расследует с его помощью, а страница хоста **ИИ → ИИ-агент** и его страница **Обзор** показывают его состояние. Чтобы выключить расследования, используйте **Что может делать ИИ** на этой странице; чтобы запустить коллектор без ИИ-агента, удалите его командой `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Только чтение по умолчанию.** Он выполняет такие команды, как `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` и `docker stats --no-stream`, — никогда `exec`, `run`, `rm` или `prune`. Значения окружения в выводе `docker inspect` маскируются, прежде чем что-либо покинет хост.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Исправления включаются явно.** Добавьте в команду `-e ONEUPTIME_AI_ALLOW_WRITES=true`, чтобы разрешить ему перезапускать, запускать, останавливать, приостанавливать, принудительно завершать именованный контейнер или менять его лимиты. `ONEUPTIME_AI_FIXES` рядом задаёт, нужно ли каждому исправлению одобрение (`ask-for-approval`, `automatic` или `bypass-approval`), и страница хоста **ИИ → ИИ-агент** это показывает. `ONEUPTIME_AI_WRITE_TARGETS` (glob-шаблоны через запятую, например `web-*,api-*`) ограничивает, какие контейнеры; `ONEUPTIME_AI_PROTECTED_TARGETS` добавляет контейнеры, которые он никогда не должен менять. Он никогда не меняет ни себя, ни коллектор.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Он работает от root, потому что сокет Docker принадлежит root. Монтирование сокета с `:ro` не делает API Docker доступным только для чтения — пределом служит политика команд агента.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Его журналы: `docker logs -f oneuptime-docker-ai-agent`. Что он может выполнять и как работают исправления: [ИИ-агенты для инфраструктуры](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Тег | Описание |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | Последний стабильный выпуск (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | Последний стабильный выпуск (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | Закреплённая версия, например `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | Тот же образ, зеркало на GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "Используйте один из них вместо `oneuptime/docker-agent:release` в конце команды `docker run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Обновление** — скачайте последний образ и удалите работающий агент:",
  "Then run both `docker run` commands from step 2 again.":
    "Затем снова выполните обе команды `docker run` из шага 2.",
  "**Uninstall:**": "**Удаление:**",
  "| Category | Data |": "| Категория | Данные |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **Метрики CPU** | Общее использование, процент использования, время троттлинга (по контейнерам) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Метрики памяти** | Использование, лимит, процент, RSS, кэш (по контейнерам) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Сетевые метрики** | Полученные и отправленные байты и пакеты (по контейнерам) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Метрики блочного ввода-вывода** | Прочитанные и записанные байты и операции (по контейнерам) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Сведения о контейнере** | Время работы, число перезапусков, число процессов |",
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **Журналы контейнеров** | Журналы stdout/stderr всех контейнеров |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Каждая строка журнала получает уровень важности по уровню, который в ней указан (`[ERROR]`, `level=warn`, `{"level":"info"}`); строка без уровня получает его по своему потоку: stderr — `ERROR`, stdout — `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "Агент должен работать от root, чтобы читать `/var/run/docker.sock`. Убедитесь, что флаг `--user 0:0` есть в вашей команде `docker run`.",
  "The agent's logs show:": "В журналах агента видно:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "Демон отклоняет клиента новее собственного максимума, коллектор из-за этого завершается, а контейнер уходит в цикл перезапусков. Агент закрепляет версию, только когда `DOCKER_API_VERSION` её задаёт, а старый образ агента закреплял `1.44`, которую Docker Engine с 20.10 по 24 отклоняет. Удалите агент (`docker rm -f oneuptime-docker-agent`), скачайте последний образ (`docker pull oneuptime/docker-agent:release`) и снова выполните команду из шага 2 без `-e DOCKER_API_VERSION`. Тогда агент согласует версию с демоном.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "Чтобы всё же закрепить версию, указывайте не больше максимума демона:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Добавьте её в команду, например `-e DOCKER_API_VERSION=1.41`. Более новые демоны по-прежнему поддерживают старые версии API, поэтому закреплённая версия продолжит работать после обновления Docker.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. Проверьте, что агент работает: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. Проверьте журналы агента на ошибки: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. Проверьте, что URL OneUptime и ключ приёма в команде `docker run` указаны верно.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Убедитесь, что хост может достучаться до вашего экземпляра OneUptime по сети.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Проверьте, что сокет Docker смонтирован в агент. В его образе нет оболочки, поэтому посмотрите из временного контейнера с теми же точками монтирования:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Затем поищите ошибки экспорта в журналах агента (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) и убедитесь, что ключ приёма действителен и не истёк.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "Метрики поступают, но вкладка **Журналы** пуста или показывает только журналы самого агента? Скорее всего, ваши контейнеры не используют драйвер журналирования `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Если шаг 1 показывает `no files match the configured criteria` или шаг 3 не выводит файлов ваших контейнеров, значит, они не используют `json-file`. Переключите их (см. **Сбор журналов со всех контейнеров (драйвер журналирования json-file)** в разделе Расширенный), а затем пересоздайте каждый: контейнер сохраняет драйвер журналирования, с которым он был создан:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "Страница хоста показывает данные, у которых имя хоста совпадает с идентификатором этого хоста, а его агент берёт из `DOCKER_HOST_NAME`. Если изменить `DOCKER_HOST_NAME` после регистрации хоста, OneUptime зарегистрирует второй хост под новым именем — журналы будут у него. Проверьте имя, которое сообщает агент:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "Имя хоста берётся из `DOCKER_HOST_NAME`. Агент, запущенный без этой переменной, сообщает `docker-host`, поэтому все хосты, настроенные так, выглядят как один и тот же хост. Задайте `DOCKER_HOST_NAME` собственное имя на каждом хосте и пересоздайте агент: `docker rm -f oneuptime-docker-agent`, а затем выполните команду из шага 2 с новым именем.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Это устанавливает агент для **`web-1`** — оставьте `DOCKER_HOST_NAME` в точности как есть, иначе данные зарегистрируются как новый хост.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (команда `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "Второй сервис — ИИ-агент OneUptime с теми же URL, ключом и именем хоста. **Расследования ИИ включены по умолчанию**: пока OneUptime AI расследует инцидент или оповещение на этом хосте, он выполняет через ИИ-агент команды `docker` только для чтения и ничего не меняет, пока вы не разрешите исправления, — см. **ИИ-агент OneUptime** в разделе Расширенный. Удалите сервис `oneuptime-docker-ai-agent`, чтобы запустить коллектор без расследований ИИ.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "Задайте каждую в списке `environment:` агента, затем выполните `docker compose up -d`, чтобы пересоздать его с новыми значениями.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, второй сервис в docker-compose.yml, выполняет команды `docker`, которые запрашивает OneUptime AI, пока расследует инцидент или оповещение на этом хосте. **Расследования ИИ включены по умолчанию**: как только он подключится, OneUptime AI расследует с его помощью, а страница хоста **ИИ → ИИ-агент** и его страница **Обзор** показывают его состояние. Чтобы выключить расследования, используйте **Что может делать ИИ** на этой странице; чтобы запустить коллектор без ИИ-агента, удалите его сервис и выполните `docker compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Исправления включаются явно.** Добавьте `- ONEUPTIME_AI_ALLOW_WRITES=true` в его список `environment:`, чтобы разрешить ему перезапускать, запускать, останавливать, приостанавливать, принудительно завершать именованный контейнер или менять его лимиты. `ONEUPTIME_AI_FIXES` рядом задаёт, нужно ли каждому исправлению одобрение (`ask-for-approval`, `automatic` или `bypass-approval`), и страница хоста **ИИ → ИИ-агент** это показывает. `ONEUPTIME_AI_WRITE_TARGETS` (glob-шаблоны через запятую, например `web-*,api-*`) ограничивает, какие контейнеры; `ONEUPTIME_AI_PROTECTED_TARGETS` добавляет контейнеры, которые он никогда не должен менять. Он никогда не меняет ни себя, ни коллектор.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "Используйте один из них вместо `oneuptime/docker-agent:release` в строке `image:` агента.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Обновление** — в папке с docker-compose.yml скачайте последние образы и пересоздайте контейнеры:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Удаление** — остановите и удалите всё, что запустил файл:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    'Агент должен работать от root, чтобы читать `/var/run/docker.sock`. Убедитесь, что у сервиса агента в docker-compose.yml есть `user: "0:0"`.',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "Демон отклоняет клиента новее собственного максимума, коллектор из-за этого завершается, а контейнер уходит в цикл перезапусков. Агент закрепляет версию, только когда `DOCKER_API_VERSION` её задаёт, а старый образ агента закреплял `1.44`, которую Docker Engine с 20.10 по 24 отклоняет. Уберите `DOCKER_API_VERSION` из списка `environment:` агента, затем выполните `docker compose pull` и `docker compose up -d`. Тогда агент согласует версию с демоном.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Добавьте её в список `environment:` агента, например `- DOCKER_API_VERSION=1.41`, и выполните `docker compose up -d`. Более новые демоны по-прежнему поддерживают старые версии API, поэтому закреплённая версия продолжит работать после обновления Docker.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Проверьте, что URL OneUptime и ключ приёма в docker-compose.yml указаны верно.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "Имя хоста берётся из `DOCKER_HOST_NAME`. Агент, запущенный без этой переменной, сообщает `docker-host`, поэтому все хосты, настроенные так, выглядят как один и тот же хост. Задайте `DOCKER_HOST_NAME` собственное имя на каждом хосте и выполните `docker compose up -d`, чтобы пересоздать агент с ним.",
};

export default TRANSLATION;
