## Настройка пользовательских зондов

Вы можете настроить пользовательские зонды внутри вашей сети для мониторинга ресурсов в частной сети или ресурсов, защищённых брандмауэром.

Для начала необходимо создать пользовательский зонд в Настройках проекта > Зонд. После создания зонда на панели управления OneUptime у вас будут `PROBE_ID` и `PROBE_KEY`.

### Развёртывание зонда

#### Docker

Для запуска зонда убедитесь, что Docker установлен. Пользовательский зонд можно запустить следующей командой:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

При самостоятельном хостинге OneUptime замените `ONEUPTIME_URL` на URL вашего экземпляра.

##### Настройка прокси

Если зонду требуется подключение через прокси-сервер для доступа к OneUptime или внешним ресурсам, настройте прокси с помощью следующих переменных среды:

```
# Для HTTP-прокси
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Для HTTPS-прокси
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Прокси с аутентификацией
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

Зонд также можно запустить через docker-compose. Создайте файл `docker-compose.yml` со следующим содержимым:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

##### С настройкой прокси

При необходимости использования прокси добавьте переменные среды:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      # Настройка прокси (необязательно)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # Для прокси с аутентификацией:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Затем выполните команду:

```
docker compose up -d
```

При самостоятельном хостинге OneUptime замените `ONEUPTIME_URL` на URL вашего экземпляра.

#### Kubernetes

Зонд также можно запустить в Kubernetes. Создайте файл `oneuptime-probe.yaml` со следующим содержимым:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

##### С настройкой прокси

При необходимости использования прокси добавьте переменные среды:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            # Настройка прокси (необязательно)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # Для прокси с аутентификацией:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

Затем выполните команду:

```bash
kubectl apply -f oneuptime-probe.yaml
```

При самостоятельном хостинге OneUptime замените `ONEUPTIME_URL` на URL вашего экземпляра.

### Переменные среды

Зонд поддерживает следующие переменные среды:

#### Обязательные переменные

- `PROBE_KEY` — ключ зонда из вашей панели управления OneUptime
- `PROBE_ID` — идентификатор зонда из вашей панели управления OneUptime
- `ONEUPTIME_URL` — URL вашего экземпляра OneUptime (по умолчанию: https://oneuptime.com)

#### Необязательные переменные

- `HTTP_PROXY_URL` — URL HTTP-прокси сервера для HTTP-запросов
- `HTTPS_PROXY_URL` — URL HTTP-прокси сервера для HTTPS-запросов
- `NO_PROXY` — хосты или домены, разделённые запятыми, которые должны обходить прокси
- `PROBE_NAME` — пользовательское имя зонда
- `PROBE_DESCRIPTION` — описание зонда
- `PROBE_MONITORING_WORKERS` — количество воркеров мониторинга (по умолчанию: 1)
- `PROBE_MONITOR_FETCH_LIMIT` — количество мониторов, загружаемых за раз (по умолчанию: 10)
- `PROBE_MONITOR_RETRY_LIMIT` — количество повторных попыток для неудачных мониторов (по умолчанию: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` — тайм-аут скриптов синтетического монитора в миллисекундах (по умолчанию: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` — тайм-аут скриптов монитора пользовательского кода в миллисекундах (по умолчанию: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` — предельное время выполнения каждого запроса, отправляемого зондом в OneUptime (по умолчанию: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` — записывать предупреждение для запросов к OneUptime, которые выполняются дольше указанного времени (по умолчанию: 10000)

#### Настройка прокси

Зонд поддерживает как HTTP, так и HTTPS прокси-серверы. При настройке весь трафик мониторинга будет проходить через указанные прокси. Также можно указать список `NO_PROXY` через запятую для обхода прокси для внутренних хостов или сетей.

**Формат URL прокси:**

```
http://[username:password@]proxy.server.com:port
```

**Примеры:**

- Базовый прокси: `http://proxy.example.com:8080`
- С аутентификацией: `http://username:password@proxy.example.com:8080`

**Поддерживаемые функции:**

- HTTP и HTTPS прокси
- Аутентификация прокси (имя пользователя/пароль)
- Автоматическое переключение между HTTP и HTTPS прокси
- Выборочный обход прокси с помощью `NO_PROXY`
- Работа со всеми типами мониторов (Сайт, API, SSL, Синтетический и др.)

**Примечание:** Поддерживаются как стандартные переменные среды (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`), так и их варианты в нижнем регистре (`http_proxy`, `https_proxy`, `no_proxy`) для совместимости.

### Проверка

Если зонд успешно запущен, он должен отображаться как `Connected` на вашей панели управления OneUptime. Если статус не изменился — проверьте журналы контейнера. При наличии других проблем создайте запрос на [GitHub](https://github.com/oneuptime/oneuptime) или [обратитесь в поддержку](https://oneuptime.com/support).

### Диагностика отключённого зонда

Зонд помечается как `Disconnected`, когда его запросы к OneUptime перестают выполняться успешно. В журнале зонда указано, на каком этапе застрял каждый неудавшийся запрос, поэтому гадать почти не приходится.

**1. Изучите блок параметров среды, выводимый при запуске.** При старте каждый зонд выводит один блок JSON с используемым URL OneUptime, предельным временем запроса, настройками прокси, унаследованными DNS-резолверами, версией Node/ОС, а также с признаком того, отключена ли проверка TLS. Прикладывайте этот блок к любому сообщению о проблеме.

**2. Найдите отчёт о сбое.** Каждый неудавшийся запрос к OneUptime записывает в журнал блок с полями `stalledAt` и `whatThisMeans`. `stalledAt` — это этап, дальше которого запрос не продвинулся:

| `stalledAt` | Что это значит |
| --- | --- |
| `SocketAssignment` | С машины ничего не ушло. Пул сокетов был исчерпан, либо настроенный прокси так и не завершил построение туннеля CONNECT. |
| `TcpConnect` | Машина отправила SYN и не получила ответа — брандмауэр или средство сетевой безопасности отбрасывает пакеты, либо хост недоступен. |
| `TlsHandshake` | TCP-соединение установлено, но рукопожатие TLS не завершилось. Обычно причина — промежуточное устройство, инспектирующее TLS. |
| `RequestSend` | Соединение установлено, но запрос так и не был передан полностью — принимающая сторона перестала читать данные. |
| `WaitingForServerResponse` | Запрос доставлен, но сервер ничего не вернул. **С сетью зонда всё в порядке** — проверьте сервер OneUptime, его балансировщик нагрузки и обратный прокси. |
| `ResponseBody` | Сервер начал отвечать и остановился на середине. |

В этом же блоке указывается `deadlineOverrunInMs`. Если при предельном времени 45000 мс запрос по фактическому времени занял существенно больше 45000 мс, значит, был заблокирован сам процесс зонда — прежде чем изучать сеть, проверьте `probeProcess.eventLoopMaxDriftInMs` в этом блоке.

**3. Изучите результаты самопроверки подключения.** После трёх сбоев подряд зонд проверяет тот же сервер уровень за уровнем — сначала DNS, затем TCP, затем TLS и, наконец, реальный HTTP-запрос с ответом — и записывает в журнал каждый этап с его временем. Первый этап, завершившийся неудачей, и есть ответ. Если настроен прокси, зонд проверяет участок до прокси, поскольку это единственный участок, который он в действительности проходит.

**4. Следите за медленными запросами, пока они не превратились в сбои.** Запросы, которые выполняются успешно, но дольше `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`, записываются в журнал с указанием затраченного времени. Зонд, у которого в журнале начали появляться 20-секундные запросы, скоро выйдет за 45-секундное предельное время.

На стороне сервера OneUptime запрос зонда, обработанный медленно — или тот, ожидание которого зонд прекратил до отправки ответа, — также записывается в журнал вместе с идентификатором зонда. Эти две записи вместе показывают, на какой стороне соединения кроется причина.
