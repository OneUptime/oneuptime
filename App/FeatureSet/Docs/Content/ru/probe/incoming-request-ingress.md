# Входящие запросы через зонд

Пользовательский зонд может дополнительно запускать **входящий HTTP-обработчик**, принимающий вызовы `heartbeat` и `incoming-request` из вашей частной сети и пересылающий их в OneUptime. Это позволяет сервисам, **не имеющим исходящего доступа в интернет**, всё равно отчитываться перед [монитором входящих запросов](/docs/monitor/incoming-request-monitor), отправляя запросы на зонд в локальной сети вместо прямого обращения к `oneuptime.com`.

## Обзор

При установке `PROBE_INGRESS_PORT` зонд привязывает дополнительный HTTP-обработчик на указанном порту. Обработчик принимает те же URL-пути с `secretkey`, что и публичные конечные точки OneUptime:

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

Затем зонд проксирует запрос на ваш экземпляр OneUptime, сохраняя метод, тело и заголовки запроса (за исключением hop-by-hop заголовков: `Host`, `Connection`, `Content-Length` и др.). Зонд автоматически добавляет заголовок `OneUptime-Probe-Id`, чтобы запрос был атрибутирован проксирующему зонду.

Обработчик работает на **выделенном порту**, отдельно от внутренних конечных точек зонда для статуса и метрик, так что вы можете открыть его для частной сети, не раскрывая ничего лишнего.

## Когда использовать

Используйте входящий обработчик, когда:

- Ваши сервисы работают в изолированном сегменте сети без исходящего HTTPS-доступа
- Вам необходимо держать весь трафик мониторинга внутри VPC или сети on-premises
- Вы хотите иметь единую точку выхода — зонд — которому разрешён доступ к OneUptime
- Вы уже развернули [пользовательский зонд](/docs/probe/custom-probe) и хотите повторно использовать его для входящих пульсов

Если ваши сервисы уже имеют прямой доступ к `https://oneuptime.com` (или вашему URL самостоятельного хостинга), данная функция **не нужна** — вызывайте URL пульса непосредственно из сервиса.

## Включение входящего обработчика

Установите `PROBE_INGRESS_PORT` в нужный порт. Любое значение больше `0` включает обработчик; отсутствие значения (или `0`) отключает его.

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

Если вы не используете `--network host`, опубликуйте порт явно:

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

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
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

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
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

Внутренние сервисы смогут отправлять пульсы на `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`.

## Отправка запросов на зонд

Замените публичный URL пульса:

```
https://oneuptime.com/heartbeat/<secret-key>
```

на URL входящего обработчика зонда:

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

Путь, метод, тело и заголовки остаются такими же, поэтому в существующем коде клиента нужно изменить только базовый URL.

### Примеры

```bash
# GET пульс
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# POST пульс с JSON-телом
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron-задание
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## Поведение при пересылке

- **Синхронный ответ, асинхронная пересылка.** Зонд немедленно подтверждает входящий запрос кодом `200` и пересылает его в OneUptime в фоне. Сервис не ждёт завершения пересылки.
- **Заголовки сохраняются.** Все заголовки, кроме hop-by-hop (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Upgrade`), передаются дальше. Зонд добавляет заголовок `OneUptime-Probe-Id` для идентификации.
- **Тело сохраняется.** Принимаются JSON, URL-encoded и необработанные `application/octet-stream` нагрузки размером до **50 МБ**.
- **Повторные попытки с отсрочкой.** При неудаче пересылки зонд повторяет попытки до `PROBE_INGRESS_FORWARD_RETRY_LIMIT` раз с экспоненциальной отсрочкой (2 с, 4 с, 8 с, не более 15 с).
- **Поддержка прокси.** Если зонд настроен с `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`, пересылаемые запросы будут идти через прокси.

## Переменные среды

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PROBE_INGRESS_PORT` | _не задана_ (отключено) | Порт, на котором привязывается входящий обработчик. Любое значение `> 0` включает входящий обработчик. |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS` | `10000` | Тайм-аут (мс) для каждой попытки пересылки в OneUptime. Минимум `1000`. |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3` | Количество повторных попыток до отказа от пересылки. Укажите `0` для отключения повторных попыток. |

Стандартные переменные зонда (`PROBE_KEY`, `PROBE_ID`, `ONEUPTIME_URL`, переменные прокси) применяются в обычном порядке — полный список см. в разделе [Пользовательские зонды](/docs/probe/custom-probe).

## Соображения безопасности

- **Конечная точка намеренно не аутентифицирована** — секретный ключ в URL-пути *и есть* аутентификация, так же как на публичной конечной точке `oneuptime.com`. Относитесь к секретному ключу как к учётным данным.
- **Привязывайтесь только к частному интерфейсу.** Входящий обработчик не должен быть доступен из публичного интернета. Используйте сетевую политику, правило брандмауэра или сервис `ClusterIP` для ограничения доступа.
- **При необходимости шифрования трафика используйте HTTPS-терминацию.** Обработчик зонда работает по HTTP. Разместите перед ним внутренний балансировщик нагрузки / контроллер входящего трафика для использования TLS на входящем узле. Канал пересылки от зонда к OneUptime всегда использует HTTPS (при условии, что `ONEUPTIME_URL` начинается с `https://`).
- **Ограничения ресурсов.** Обработчик принимает тела запросов размером до 50 МБ. При необходимости более строгого ограничения разместите перед ним обратный прокси.

## Устранение неполадок

- **Зонд выводит в журнал `Probe ingress listener started on port <port>` при запуске** — подтверждает, что обработчик работает. Если эта строка отсутствует, `PROBE_INGRESS_PORT` не задан, равен `0` или содержит недопустимое значение.
- **`Probe ingress: failed to forward to <url> after N attempts`** — зонд не может достичь OneUptime. Проверьте исходящее подключение зонда, настройки прокси и значение `ONEUPTIME_URL`.
- **`Probe ingress: probe ID not available, forwarding without it`** — зонд ещё не зарегистрировался. Пересылка всё равно выполнится; пульс просто не будет атрибутирован зонду.
- **Пульс появляется в OneUptime, но не через зонд** — убедитесь, что ваш сервис обращается к `http://<probe-host>:<port>/...`, а не к публичному URL. Обычная причина — некорректная настройка DNS или `/etc/hosts`.

## Связанные материалы

- [Пользовательские зонды](/docs/probe/custom-probe)
- [Монитор входящих запросов](/docs/monitor/incoming-request-monitor)
