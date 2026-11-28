import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 или новее",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "Docker-совместимый сокет API Podman в `/run/podman/podman.sock` — включите его командой `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "Контейнеры, журналы которых вам нужны, должны использовать драйвер журналирования `k8s-file` — Podman в режиме rootful по умолчанию использует `journald`, который агент читать не может",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Затем запустите рядом ИИ-агент OneUptime с теми же URL, ключом и именем хоста. **Расследования ИИ включены по умолчанию**: пока OneUptime AI расследует инцидент или оповещение на этом хосте, он выполняет через ИИ-агент команды `docker` только для чтения к Docker-совместимому сокету Podman и ничего не меняет, пока вы не разрешите исправления, — см. **ИИ-агент OneUptime** в разделе Расширенный. Пропустите эту команду, чтобы запустить коллектор без расследований ИИ.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Замените `my-podman-host` именем этого хоста, например `prod-podman-01`. Под этим именем хост появляется в OneUptime, поэтому не меняйте его: новое имя регистрирует новый хост.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить его вместо `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Найдите в журналах эту строку:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Как только агент подключится, хост автоматически появится в разделе **Podman** — обычно примерно в течение минуты. ИИ-агент OneUptime отображается как Подключено на странице хоста **ИИ → ИИ-агент** и внизу его страницы **Обзор**.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**Метрики есть, а журналов нет?** Podman в режиме rootful по умолчанию пишет журналы контейнеров в `journald`, который агент читать не может. Запускайте контейнеры с `--log-driver k8s-file` — см. **Сбор журналов со всех контейнеров (драйвер журналирования k8s-file)** в разделе Расширенный.",
  "| Variable | Required | Description |":
    "| Переменная | Обязательна | Описание |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Да | URL вашего экземпляра OneUptime (например, `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Да | Ключ приёма телеметрии из шага 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | Нет | Понятное имя этого хоста. По умолчанию `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Нет | Версия API Docker, на которой агент говорит с сокетом Podman. По умолчанию пусто: агент согласует её с сокетом. Задавайте её, только чтобы закрепить версию (см. Устранение неполадок) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| от `ONEUPTIME_LOG_OPERATOR_1` до `ONEUPTIME_LOG_OPERATOR_5` | Нет | Собственные операторы коллектора, каждый в виде JSON, для формата журналов, который агент не читает |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Передайте каждую в `podman run` как `-e NAME=value`. Чтобы потом изменить одну из них, удалите агент командой `podman rm -f oneuptime-podman-agent` и снова выполните команду с новым значением.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "Агент читает файлы, которые пишет драйвер журналирования Podman **`k8s-file`** (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`), поэтому видит только журналы контейнеров, которые его используют (или `json-file`, который Podman считает тем же файловым драйвером). По умолчанию Podman в режиме rootful использует **`journald`**, который агент читать не может, как и удалённый драйвер вроде `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Проверьте драйвер журналирования контейнера и драйвер Podman по умолчанию:",
  "Run a single container with `k8s-file`:":
    "Запустите один контейнер с `k8s-file`:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Переключите сервис Compose на `k8s-file` с ротацией:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "Или измените драйвер по умолчанию для всех контейнеров, создаваемых после этого, в `containers.conf` (`/etc/containers/containers.conf` в режиме rootful, `~/.config/containers/containers.conf` в режиме rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "Затем **пересоздайте** затронутые контейнеры (простого перезапуска мало): контейнер сохраняет драйвер журналирования, с которым он был создан. Нужно оставить `journald`? Агент по-прежнему собирает метрики через сокет; файловый драйвер нужен только журналам контейнеров.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, второй контейнер, который запускает шаг 2, выполняет команды `docker`, которые запрашивает OneUptime AI (через Docker-совместимый сокет Podman), пока расследует инцидент или оповещение на этом хосте. **Расследования ИИ включены по умолчанию**: как только он подключится, OneUptime AI расследует с его помощью, а страница хоста **ИИ → ИИ-агент** и его страница **Обзор** показывают его состояние. Чтобы выключить расследования, используйте **Что может делать ИИ** на этой странице; чтобы запустить коллектор без ИИ-агента, удалите его командой `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Только чтение по умолчанию.** Он выполняет такие команды, как `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` и `docker stats --no-stream`, — никогда `exec`, `run`, `rm` или `prune`. Значения окружения в выводе `docker inspect` маскируются, прежде чем что-либо покинет хост.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Исправления включаются явно.** Добавьте в команду `-e ONEUPTIME_AI_ALLOW_WRITES=true`, чтобы разрешить ему перезапускать, запускать, останавливать, приостанавливать, принудительно завершать именованный контейнер или менять его лимиты. `ONEUPTIME_AI_FIXES` рядом задаёт, нужно ли каждому исправлению одобрение (`ask-for-approval`, `automatic` или `bypass-approval`), и страница хоста **ИИ → ИИ-агент** это показывает. `ONEUPTIME_AI_WRITE_TARGETS` (glob-шаблоны через запятую, например `web-*,api-*`) ограничивает, какие контейнеры; `ONEUPTIME_AI_PROTECTED_TARGETS` добавляет контейнеры, которые он никогда не должен менять. Он никогда не меняет ни себя, ни коллектор.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Ему нужен тот же сокет, что и коллектору, и он работает от root, потому что сокет принадлежит root. Монтирование сокета с `:ro` не делает API доступным только для чтения — пределом служит политика команд агента.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Его журналы: `podman logs -f oneuptime-podman-ai-agent`. Что он может выполнять и как работают исправления: [ИИ-агенты для инфраструктуры](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Тег | Описание |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Последний стабильный выпуск (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Последний стабильный выпуск (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | Закреплённая версия, например `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | Тот же образ, зеркало на GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Используйте один из них вместо `oneuptime/podman-agent:release` в конце команды `podman run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Обновление** — скачайте последний образ и удалите работающий агент:",
  "Then run both `podman run` commands from step 2 again.":
    "Затем снова выполните обе команды `podman run` из шага 2.",
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
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Журналы контейнеров** | Журналы stdout/stderr всех контейнеров, которые используют драйвер журналирования `k8s-file` |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Метрики поступают от приёмника коллектора `docker_stats` через Docker-совместимый сокет Podman, поэтому их имена совпадают с метриками агента Docker. Каждая строка журнала получает уровень важности по уровню, который в ней указан (`[ERROR]`, `level=warn`, `{"level":"info"}`); строка без уровня получает его по своему потоку: stderr — `ERROR`, stdout — `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "Агент должен работать от root, чтобы читать `/run/podman/podman.sock`. Убедитесь, что флаг `--user 0:0` есть в вашей команде `podman run` и что сокет включён:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "Это сокет Podman в режиме rootful — тот, который читает агент. Используете Podman в режиме rootless? Его сокет — `/run/user/<uid>/podman/podman.sock` (включите его командой `systemctl --user enable --now podman.socket`), а хранилище — `~/.local/share/containers/storage`: смонтируйте их вместо этого в `/run/podman/podman.sock` и `/var/lib/containers/storage` в контейнере агента — см. документацию агента Podman.",
  "The agent's logs show:": "В журналах агента видно:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "Сервер, у которого есть максимум, отклоняет более новый клиент, коллектор из-за этого завершается, а контейнер уходит в цикл перезапусков. Агент закрепляет версию API Docker, только когда `DOCKER_API_VERSION` её задаёт, а старый образ агента закреплял `1.44`. Удалите агент (`podman rm -f oneuptime-podman-agent`), скачайте последний образ (`podman pull oneuptime/podman-agent:release`) и снова выполните команду из шага 2 без `-e DOCKER_API_VERSION`. Тогда агент согласует версию с сокетом.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "Чтобы всё же закрепить версию, указывайте не больше версии, которую сообщает сокет:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Добавьте её в команду, например `-e DOCKER_API_VERSION=1.41`. Более новые серверы по-прежнему поддерживают старые версии API, поэтому закреплённая версия продолжит работать после обновления.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Проверьте, что агент работает: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Проверьте журналы агента на ошибки: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Проверьте, что URL OneUptime и ключ приёма в команде `podman run` указаны верно.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Убедитесь, что хост может достучаться до вашего экземпляра OneUptime по сети.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Проверьте, что сокет Podman смонтирован в агент. В его образе нет оболочки, поэтому посмотрите из временного контейнера с теми же точками монтирования:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Затем поищите ошибки экспорта в журналах агента (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) и убедитесь, что ключ приёма действителен и не истёк.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "Метрики поступают, но вкладка **Журналы** пуста или показывает только журналы самого агента? Скорее всего, ваши контейнеры не используют файловый драйвер журналирования (`k8s-file` или `json-file`) — Podman в режиме rootful по умолчанию использует `journald`, который агент читать не может.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Если шаг 1 показывает `no files match the configured criteria` или шаг 3 не выводит файлов ваших контейнеров, значит, они не используют `k8s-file`. Переключите их (см. **Сбор журналов со всех контейнеров (драйвер журналирования k8s-file)** в разделе Расширенный), а затем пересоздайте каждый: контейнер сохраняет драйвер журналирования, с которым он был создан:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "Страница хоста показывает данные, у которых имя хоста совпадает с идентификатором этого хоста, а его агент берёт из `PODMAN_HOST_NAME`. Если изменить `PODMAN_HOST_NAME` после регистрации хоста, OneUptime зарегистрирует второй хост под новым именем — журналы будут у него. Проверьте имя, которое сообщает агент:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "Имя хоста берётся из `PODMAN_HOST_NAME`. Агент, запущенный без этой переменной, сообщает `podman-host`, поэтому все хосты, настроенные так, выглядят как один и тот же хост. Задайте `PODMAN_HOST_NAME` собственное имя на каждом хосте и пересоздайте агент: `podman rm -f oneuptime-podman-agent`, а затем выполните команду из шага 2 с новым именем.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Это устанавливает агент для **`web-1`** — оставьте `PODMAN_HOST_NAME` в точности как есть, иначе данные зарегистрируются как новый хост.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "Провайдер Compose для `podman compose`: `podman-compose` или Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "Второй сервис — ИИ-агент OneUptime с теми же URL, ключом и именем хоста. **Расследования ИИ включены по умолчанию**: пока OneUptime AI расследует инцидент или оповещение на этом хосте, он выполняет через ИИ-агент команды `docker` только для чтения к Docker-совместимому сокету Podman и ничего не меняет, пока вы не разрешите исправления, — см. **ИИ-агент OneUptime** в разделе Расширенный. Удалите сервис `oneuptime-podman-ai-agent`, чтобы запустить коллектор без расследований ИИ.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Задайте каждую в списке `environment:` агента, затем выполните `podman compose up -d`, чтобы пересоздать его с новыми значениями.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, второй сервис в docker-compose.yml, выполняет команды `docker`, которые запрашивает OneUptime AI (через Docker-совместимый сокет Podman), пока расследует инцидент или оповещение на этом хосте. **Расследования ИИ включены по умолчанию**: как только он подключится, OneUptime AI расследует с его помощью, а страница хоста **ИИ → ИИ-агент** и его страница **Обзор** показывают его состояние. Чтобы выключить расследования, используйте **Что может делать ИИ** на этой странице; чтобы запустить коллектор без ИИ-агента, удалите его сервис и выполните `podman compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Исправления включаются явно.** Добавьте `- ONEUPTIME_AI_ALLOW_WRITES=true` в его список `environment:`, чтобы разрешить ему перезапускать, запускать, останавливать, приостанавливать, принудительно завершать именованный контейнер или менять его лимиты. `ONEUPTIME_AI_FIXES` рядом задаёт, нужно ли каждому исправлению одобрение (`ask-for-approval`, `automatic` или `bypass-approval`), и страница хоста **ИИ → ИИ-агент** это показывает. `ONEUPTIME_AI_WRITE_TARGETS` (glob-шаблоны через запятую, например `web-*,api-*`) ограничивает, какие контейнеры; `ONEUPTIME_AI_PROTECTED_TARGETS` добавляет контейнеры, которые он никогда не должен менять. Он никогда не меняет ни себя, ни коллектор.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Используйте один из них вместо `oneuptime/podman-agent:release` в строке `image:` агента.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Обновление** — в папке с docker-compose.yml скачайте последние образы и пересоздайте контейнеры:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Удаление** — остановите и удалите всё, что запустил файл:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'Агент должен работать от root, чтобы читать `/run/podman/podman.sock`. Убедитесь, что у сервиса агента в docker-compose.yml есть `user: "0:0"` и что сокет включён:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "Сервер, у которого есть максимум, отклоняет более новый клиент, коллектор из-за этого завершается, а контейнер уходит в цикл перезапусков. Агент закрепляет версию API Docker, только когда `DOCKER_API_VERSION` её задаёт, а старый образ агента закреплял `1.44`. Уберите `DOCKER_API_VERSION` из списка `environment:` агента, затем выполните `podman compose pull` и `podman compose up -d`. Тогда агент согласует версию с сокетом.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Добавьте её в список `environment:` агента, например `- DOCKER_API_VERSION=1.41`, и выполните `podman compose up -d`. Более новые серверы по-прежнему поддерживают старые версии API, поэтому закреплённая версия продолжит работать после обновления.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Проверьте, что URL OneUptime и ключ приёма в docker-compose.yml указаны верно.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "Имя хоста берётся из `PODMAN_HOST_NAME`. Агент, запущенный без этой переменной, сообщает `podman-host`, поэтому все хосты, настроенные так, выглядят как один и тот же хост. Задайте `PODMAN_HOST_NAME` собственное имя на каждом хосте и выполните `podman compose up -d`, чтобы пересоздать агент с ним.",
};

export default TRANSLATION;
