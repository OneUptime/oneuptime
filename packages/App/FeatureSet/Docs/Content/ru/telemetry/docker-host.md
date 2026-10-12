# Агент Docker

Агент Docker от OneUptime — это один контейнер, который запускается на Docker-хосте. Он читает статистику и файлы логов каждого контейнера на хосте и отправляет их в OneUptime, где хост появляется со своими контейнерами, метриками и логами. Второй контейнер, ИИ-агент Docker, позволяет OneUptime AI расследовать проблемы на хосте. [Мониторы Docker](/docs/monitor/docker-monitor) оповещают о том, что отправляет агент.

:::cards
- [Установка агента](#установка-агента): Два контейнера, через `docker run` или Docker Compose.
- [Что собирает агент](#что-собирает-агент): Метрики, логи и инвентарь каждого контейнера.
- [Для логов контейнеров нужен json-file](#для-логов-контейнеров-нужен-драйвер-логов-json-file): Проверка и смена драйвера логов контейнера.
- [Устранение неполадок](#устранение-неполадок): Циклы перезапусков, отсутствующие метрики, отсутствующие логи.
:::

## Как это работает

Агент — это OpenTelemetry Collector со встроенной конфигурацией OneUptime. Через сокет Docker он читает статистику каждого контейнера каждые 30 секунд и каждые 5 минут перечисляет все контейнеры, образы, сети и тома. Он следит за файлами логов контейнеров и отправляет всё на ваш URL OneUptime по OTLP с ключом приёма, который вы ему передаёте.

```mermaid title="Два контейнера на вашем Docker-хосте"
flowchart TB
    containers["Ваши контейнеры"] -->|"статистика, файлы логов,<br/>инвентарь"| agent["Агент Docker"]
    agent -->|"OTLP по HTTPS"| oneuptime["OneUptime"]
    oneuptime -->|"расследует инцидент<br/>или оповещение"| ai["ИИ-агент Docker"]
    ai -->|"команды docker<br/>только для чтения"| containers
```

Хост регистрируется по своим первым данным под именем, которое вы задаёте в `DOCKER_HOST_NAME`. ИИ-агент необязателен: если его не устанавливать, коллектор работает так же.

## Перед началом

- Docker Engine 20.10 или новее и доступ root на хосте: агент читает `/var/run/docker.sock`.
- Docker Compose v2 (команда `docker compose`), если вы устанавливаете через Docker Compose.
- Ключ приёма. Создайте его в разделе **Настройки проекта → Телеметрия и APM → Ключи приема** и скопируйте значение.
- Исходящий HTTPS с хоста на ваш URL OneUptime.
- Для логов контейнеров — контейнеры, которые используют драйвер логов Docker `json-file`, используемый Docker по умолчанию. См. [Для логов контейнеров нужен драйвер логов json-file](#для-логов-контейнеров-нужен-драйвер-логов-json-file).

## Установка агента

:::steps
### Запустите агент

Замените `YOUR_ONEUPTIME_URL` своим URL OneUptime, `YOUR_TELEMETRY_INGESTION_TOKEN` — ключом приёма, а `my-docker-host` — именем этого хоста, например `prod-docker-01`. Под этим именем хост появится в OneUptime, поэтому не меняйте его: новое имя регистрирует новый хост.

:::tabs
@tab Docker CLI
```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

Затем рядом запустите [ИИ-агент](#ии-агент) с теми же значениями. **ИИ-расследования включены по умолчанию**: пока OneUptime AI расследует инцидент или оповещение на этом хосте, он выполняет через ИИ-агент команды `docker` только для чтения и ничего не меняет, если вы не разрешите исправления. Чтобы установить без ИИ-расследований, пропустите эту команду.

```bash
docker run -d \
  --name oneuptime-docker-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/resource-ai-agent:release
```
@tab Docker Compose
Сохраните это как `docker-compose.yml` в папке на хосте. Второй сервис — [ИИ-агент](#ии-агент): уберите его, чтобы запускать коллектор без ИИ-расследований.

```yaml title="docker-compose.yml"
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
  oneuptime-docker-ai-agent:
    image: oneuptime/resource-ai-agent:release
    container_name: oneuptime-docker-ai-agent
    user: "0:0"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker
      - DOCKER_HOST_NAME=my-docker-host
```

Запустите его в этой папке:

```bash
docker compose up -d
```
:::

### Убедитесь, что агент работает

```bash
docker ps --filter name=oneuptime-docker-agent
docker logs -f oneuptime-docker-agent
```

Когда коллектор запустится, в логах должна появиться такая строка:

```text
Everything is ready. Begin running and processing data.
```

### Найдите хост в OneUptime

Откройте **Продукты → Инфраструктура → Docker → Все хосты**. Хост появится под своим `DOCKER_HOST_NAME` примерно через минуту, со своими контейнерами, метриками и логами. ИИ-агент отображается как подключённый на странице хоста **ИИ-агент** и внизу его страницы **Обзор**.
:::

## Переменные окружения

| Переменная | Обязательна | Описание |
| --- | --- | --- |
| `ONEUPTIME_URL` | Да | Ваш URL OneUptime, например `https://oneuptime.com`, или ваш собственный экземпляр. Если экземпляр работает только по HTTP, используйте `http://` и его порт. |
| `ONEUPTIME_SERVICE_TOKEN` | Да | Ключ приёма из раздела **Настройки проекта → Телеметрия и APM → Ключи приема**. |
| `DOCKER_HOST_NAME` | Нет | Имя хоста в OneUptime. По умолчанию `docker-host`, поэтому дайте каждому хосту своё. |
| `DOCKER_API_VERSION` | Нет | Версия API Docker Engine, на которой работает агент. По умолчанию `1.44`. Понизьте её для старого демона или задайте пустое значение, чтобы согласовать её с демоном (см. [Устранение неполадок](#устранение-неполадок)). |

Чтобы изменить значение, удалите агент и снова выполните его команду (Docker CLI) или отредактируйте `docker-compose.yml` и выполните `docker compose up -d` (Docker Compose).

## Что собирает агент

| Данные | Что это |
| --- | --- |
| Метрики контейнеров | CPU (использование, процент, троттлинг), память (использование, лимит, процент), сетевой и блочный ввод-вывод, время работы, перезапуски и число процессов по каждому контейнеру каждые 30 секунд. |
| Логи контейнеров | stdout и stderr каждого контейнера из его файла лога `json-file`. |
| Инвентарь | Все контейнеры в любом состоянии, а также все образы, сети и тома каждые 5 минут. |

Метрики и логи каждого контейнера хранятся под сервисом, названным по имени контейнера. Каждая строка лога получает важность по уровню, который в ней указан, например `[ERROR]`, `level=warn` или `{"level":"info"}`; строка без уровня получает важность своего потока: stderr — `ERROR`, stdout — `INFO`. Строки, начинающиеся с пробела или закрывающей скобки, присоединяются к предыдущей строке, поэтому трассировка стека приходит одной записью. Собственные логи агента не отправляются.

[Мониторинг Docker](/docs/monitor/docker-monitor#собираемые-метрики) перечисляет все метрики и объясняет их значение.

## Для логов контейнеров нужен драйвер логов json-file

Агент следит за `/var/lib/docker/containers/*/*-json.log` — файлами, которые пишет драйвер логов Docker `json-file`. Контейнер с другим драйвером не оставляет файла для чтения: `local` пишет двоичные файлы, а `journald`, `syslog`, `fluentd` и `gelf` отправляют логи в другое место. Его метрики по-прежнему поступают, а логи — нет.

Проверьте драйвер логов контейнера и значение по умолчанию у демона:

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
docker info --format '{{.LoggingDriver}}'
```

Переведите сервис Compose на `json-file` с ротацией:

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

Или сделайте его значением по умолчанию для всех контейнеров, создаваемых после этого, в `/etc/docker/daemon.json`:

```json title="/etc/docker/daemon.json"
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Затем перезапустите Docker и пересоздайте контейнеры. Контейнер сохраняет драйвер логов, с которым был создан, поэтому перезапуска недостаточно.

## Обновление агента

Когда агент старше вашего OneUptime, рядом с **Версия агента** на странице хоста **Обзор** появляется предупреждающий значок. Нажмите на него, чтобы увидеть эти команды.

:::tabs
@tab Docker CLI
```bash
docker pull oneuptime/docker-agent:release
docker pull oneuptime/resource-ai-agent:release
docker rm -f oneuptime-docker-agent oneuptime-docker-ai-agent
```

Затем снова выполните обе команды `docker run` из раздела [Запустите агент](#запустите-агент).
@tab Docker Compose
```bash
docker compose pull
docker compose up -d
```
:::

Тег `release` всегда указывает на новейший выпуск. Чтобы закрепить версию, используйте `oneuptime/docker-agent:<version>`, например `oneuptime/docker-agent:10.0.31`. Тот же образ есть в GitHub Container Registry как `ghcr.io/oneuptime/docker-agent:release`.

## Удаление агента

:::tabs
@tab Docker CLI
```bash
docker rm -f oneuptime-docker-agent
docker rm -f oneuptime-docker-ai-agent
```
@tab Docker Compose
```bash
docker compose down
```
:::

Хост остаётся в OneUptime с отправленными данными. Если он больше не нужен, удалите его через **Удалить хост** в его меню.

## ИИ-агент

Команды и файл Compose выше, `install.sh` агента Docker и `docker-compose.yml` в его [каталоге DockerAgent](https://github.com/OneUptime/oneuptime/tree/master/agents/DockerAgent) запускают **ИИ-агент Docker**: второй контейнер, `oneuptime-docker-ai-agent` (образ `oneuptime/resource-ai-agent:release`), который выполняет команды `docker` только для чтения, запрашиваемые OneUptime AI при расследовании инцидента или оповещения на этом хосте, — `docker ps -a`, `docker logs --tail 200 web`, `docker container inspect web`, `docker stats --no-stream` — и, только если вы это разрешите, применяет исправления, например перезапуск указанного контейнера. Он читает те же `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` и `DOCKER_HOST_NAME`, что и коллектор, поэтому обслуживает ровно этот хост и появляется на странице хоста **ИИ-агент** в OneUptime.

- **ИИ-расследования включены по умолчанию.** Как только агент подключается, OneUptime AI расследует с его помощью инциденты и оповещения на этом хосте, а страница **Обзор** хоста показывает статус агента. Чтобы отключить это, задайте `ONEUPTIME_AI_INVESTIGATION=false` там, где работает агент (как это сделать, показывает **Изменить** в разделе **Что может делать ИИ** на странице ИИ-агента), или не устанавливайте агента.
- Он работает только для чтения, если вы не запустите его с `ONEUPTIME_AI_ALLOW_WRITES=true`; `ONEUPTIME_AI_WRITE_TARGETS` (например, `web-*,api-*`) ограничивает, какие контейнеры может затрагивать исправление. Запустите его также с `ONEUPTIME_AI_FIXES`, чтобы задать, как выполняются исправления, — `ask-for-approval` (каждое одобряет человек), `automatic` или `bypass-approval`, — а страница ИИ-агента покажет это только для чтения ([Что может делать ИИ, задаётся агентом](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)).
- Он работает от root со смонтированным сокетом Docker, потому что сокет принадлежит root, — а тот, кто может пользоваться сокетом, является root на этом хосте, с `:ro` или без. Границу задаёт политика команд агента: он никогда не выполняет `exec`, `run`, `rm` или `prune` и никогда не изменяет себя, коллектор или что-либо из `ONEUPTIME_AI_PROTECTED_TARGETS` (glob-шаблоны имён контейнеров). Значения окружения в выводе `docker inspect` маскируются до того, как что-либо покинет хост.
- `install.sh --no-ai-agent` не устанавливает его; `docker rm -f oneuptime-docker-ai-agent` удаляет его. Обновляйте его так же, как коллектор: `docker pull oneuptime/resource-ai-agent:release`, удалите и запустите снова.

Что он может запускать, как работают исправления и как устранять неполадки: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).

## Устранение неполадок

:::details Агент перезапускается с ошибкой "client version is too new"
Логи агента показывают:

```text
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

Демон отклоняет клиента новее собственного максимума, поэтому приёмник так и не запускается, а вместе с ним завершается и коллектор. Узнайте максимум демона:

```bash
docker version --format '{{ .Server.APIVersion }}'
```

Затем добавьте `-e DOCKER_API_VERSION=1.41` (или полученное значение) в `docker run` или задайте `DOCKER_API_VERSION` в Compose. Новые демоны по-прежнему поддерживают старые версии API, поэтому настройка остаётся верной и после обновления.

Не хотите искать номер? Задайте `DOCKER_API_VERSION` пустой строкой. Тогда агент согласует версию с демоном (один `HEAD /_ping`, затем собственный максимум демона), что работает и со старыми, и с новыми демонами:

```bash
docker run -d ... -e DOCKER_API_VERSION= ...
```
:::

:::details Отказ в доступе к сокету Docker
Чтобы читать `/var/run/docker.sock`, агент должен работать от root. Проверьте, что в вашей команде `docker run` есть `--user 0:0` или в Compose — `user: "0:0"`.
:::

:::details Хост отображается как отключённый
1. Проверьте, что агент работает: `docker ps --filter name=oneuptime-docker-agent`
2. Поищите ошибки в его логах: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`
3. Проверьте `ONEUPTIME_URL` и `ONEUPTIME_SERVICE_TOKEN`: ключ должен быть действительным ключом приёма, который не отключён.
4. Проверьте, что хост может достучаться до вашего URL OneUptime по сети.
:::

:::details Метрики не появляются
1. Проверьте, что сокет Docker смонтирован в агент. В его образе нет оболочки, поэтому посмотрите из временного контейнера, который использует те же точки монтирования: `docker run --rm --volumes-from oneuptime-docker-agent alpine:3.19 ls -la /var/run/docker.sock`
2. Поищите ошибки экспорта в его логах: `docker logs oneuptime-docker-agent 2>&1 | tail -100`
3. Проверьте, что ключ приёма действителен и не истёк.
:::

:::details Метрики поступают, но логов контейнеров нет
Скорее всего, ваши контейнеры используют драйвер логов, отличный от `json-file`. Проверьте, за какими файлами следит агент и какой драйвер использует контейнер:

```bash
docker logs oneuptime-docker-agent 2>&1 | grep -E "Started watching file|no files match"
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

Если агент сообщает `no files match the configured criteria`, переведите контейнеры на `json-file` и пересоздайте их, как показано в разделе [Для логов контейнеров нужен драйвер логов json-file](#для-логов-контейнеров-нужен-драйвер-логов-json-file).
:::

:::details Логи попадают на другой хост, или хост называется docker-host
Имя хоста берётся из `DOCKER_HOST_NAME`. Агент, запущенный без этой переменной, сообщает `docker-host`, поэтому все хосты, настроенные так, выглядят как один; если позже изменить имя, OneUptime зарегистрирует второй хост, и новые данные будут в нём. Задайте `DOCKER_HOST_NAME` своё имя на каждом хосте и пересоздайте агента. Чтобы проверить имя, которое сообщает агент:

```bash
docker inspect oneuptime-docker-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DOCKER_HOST_NAME
```
:::

## Дальнейшие шаги

:::cards
- [Мониторинг Docker](/docs/monitor/docker-monitor): Оповещения по CPU, памяти и перезапускам контейнеров.
- [Базы данных](/docs/telemetry/databases): Контейнеры баз данных на хосте обнаруживаются и получают собственные страницы.
- [Агент Kubernetes](/docs/telemetry/kubernetes-agent): Мониторинг кластера Kubernetes вместо этого.
- [OpenTelemetry-коллектор на хосте](/docs/telemetry/host-otel-collector): Мониторинг самой машины: CPU, диски, процессы и логи.
:::
