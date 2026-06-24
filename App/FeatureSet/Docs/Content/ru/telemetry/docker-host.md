# OneUptime Docker Agent

## Обзор

OneUptime Docker Agent — это готовый образ контейнера, который поставляется с настроенной конфигурацией OpenTelemetry Collector. Запустите его рядом с существующими контейнерами, и он автоматически обнаружит каждый контейнер на хосте, соберёт метрики CPU / памяти / сети / блочного ввода-вывода, а также логи контейнеров, и перешлёт всё в OneUptime по OTLP. Один образ, одна команда.

Эта страница — **руководство по установке**. О настройке мониторов и оповещений Docker поверх данных, собираемых агентом, см. [Docker Monitor](/docs/monitor/docker-monitor).

## Предварительные требования

- Docker Engine 20.10+
- Доступ к `/var/run/docker.sock` на хосте
- **OneUptime Telemetry Ingestion Token** — создайте его в разделе _Project Settings → Telemetry Ingestion Keys_ и скопируйте значение

## Быстрый старт (одна команда)

Замените `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN` и имя хоста значениями для вашего окружения. Имя хоста — это то, как этот хост Docker будет отображаться в OneUptime; выберите что-то вроде `prod-docker-01`.

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

Вот и всё. Как только агент подключится, ваш хост Docker автоматически появится в разделе **Docker** панели управления OneUptime.

## Альтернатива — Docker Compose

Если вы предпочитаете Docker Compose, поместите следующее в файл `docker-compose.yml`:

```yaml
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
```

Запустите его:

```bash
docker compose up -d
```

## Переменные окружения

| Переменная                | Обязательна | Описание                                                                                                                                 |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | Да          | URL вашего экземпляра OneUptime (например, `https://oneuptime.com` или ваш self-hosted хост)                                             |
| `ONEUPTIME_SERVICE_TOKEN` | Да          | Токен загрузки телеметрии из _Project Settings → Telemetry Ingestion Keys_                                                               |
| `DOCKER_HOST_NAME`        | Нет         | Понятное имя для этого хоста. По умолчанию `docker-host`. Задайте ему стабильное значение для каждого хоста (например, `prod-docker-01`) |

## Проверка установки

Убедитесь, что агент запущен:

```bash
docker ps --filter name=oneuptime-docker-agent
```

Проверьте логи агента:

```bash
docker logs -f oneuptime-docker-agent
```

Найдите строку: `"Everything is ready. Begin running and processing data."`

Примерно в течение минуты хост должен появиться в панели управления OneUptime с поступающими метриками и логами.

## Обновление агента

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Повторно выполните команду `docker run` выше
```

Или с Docker Compose:

```bash
docker compose pull
docker compose up -d
```

## Удаление агента

```bash
docker rm -f oneuptime-docker-agent
```

Если вы использовали Docker Compose:

```bash
docker compose down
```

## Что собирается

| Категория                         | Данные                                                                      |
| --------------------------------- | --------------------------------------------------------------------------- |
| **Метрики CPU**                   | Общее использование, процент использования, время троттлинга (на контейнер) |
| **Метрики памяти**                | Использование, лимит, процент, RSS, кэш (на контейнер)                      |
| **Метрики сети**                  | Принятые / переданные байты и пакеты (на контейнер)                         |
| **Метрики блочного ввода-вывода** | Прочитанные / записанные байты и операции (на контейнер)                    |
| **Информация о контейнере**       | Время работы, количество перезапусков, количество процессов                 |
| **Логи контейнеров**              | Логи stdout / stderr из всех контейнеров                                    |

## Self-hosted OneUptime

Если вы используете self-hosted OneUptime, задайте в `ONEUPTIME_URL` ваш собственный экземпляр:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

Если ваш экземпляр работает только по HTTP, используйте `http://` и соответствующий порт.

## Устранение неполадок

### Отказано в доступе к сокету Docker

Контейнер агента должен запускаться от имени root (`--user 0:0`), чтобы получить доступ к `/var/run/docker.sock`. Убедитесь, что присутствует флаг `--user 0:0` (или `user: "0:0"` в Compose).

### Агент отображается как отключённый

1. Убедитесь, что агент запущен: `docker ps --filter name=oneuptime-docker-agent`
2. Проверьте логи агента: `docker logs oneuptime-docker-agent | grep -i error`
3. Убедитесь, что ваш URL OneUptime и токен сервиса указаны верно
4. Убедитесь, что ваш хост Docker может достичь экземпляра OneUptime по сети

### Метрики не появляются

1. Убедитесь, что сокет Docker доступен внутри агента: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. Проверьте логи коллектора на наличие ошибок экспорта: `docker logs oneuptime-docker-agent | tail -100`
3. Убедитесь, что ваш токен сервиса действителен и не истёк

### Имя хоста отображается как идентификатор контейнера

Задайте переменной окружения `DOCKER_HOST_NAME` понятное имя и пересоздайте контейнер.

## Дальнейшие шаги

- Настройте **Docker Monitors** для оповещения об условиях CPU / памяти / перезапусков контейнеров — см. [Docker Monitor](/docs/monitor/docker-monitor).
- Для кластеров Kubernetes вместо отдельных хостов Docker используйте [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- Для неконтейнеризированных хостов (виртуальные машины Linux / macOS / Windows и физические серверы) используйте [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
