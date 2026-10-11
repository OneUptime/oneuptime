# Docker Compose

Запустите полноценный бесплатный экземпляр OneUptime на одном Linux-сервере с помощью Docker Compose. Эта страница проведёт вас от чистого сервера до работающего экземпляра, а затем расскажет об HTTPS, подготовке к продакшену, резервных копиях, обновлениях и удалении.

:::cards
- [Установка OneUptime](#установка-oneuptime): От чистого сервера до первой учётной записи за шесть шагов.
- [Настройка HTTPS](#настройка-https): Пусть OneUptime получит сертификат сам, или поставьте перед ним свой прокси.
- [Чек-лист для продакшена](#чек-лист-для-продакшена): Что решить до прихода реального трафика.
- [Обновление OneUptime](#обновление-oneuptime): Переход на последний релиз.
:::

## Как это работает

Docker Compose запускает каждую часть OneUptime в виде контейнера на вашем сервере. Весь трафик входит через контейнер `ingress`, который направляет его в `app`. Приложение хранит данные в PostgreSQL, ClickHouse и Valkey. Встроенный зонд выполняет проверки ваших мониторов и отправляет результаты обратно через ingress.

```mermaid title="Развёртывание с Docker Compose"
flowchart TB
    Users["Пользователи и агенты"]
    Proxy["Ваш обратный прокси, необязательно"]
    Targets["Сайты, которые вы мониторите"]
    subgraph Server["Ваш сервер"]
        Ingress["ingress"]
        App["app"]
        Probe["probe-1"]
        Runner["runner"]
        subgraph Data["Хранилища данных"]
            direction LR
            PG[("postgres")]
            CH[("clickhouse")]
            VK[("valkey")]
        end
    end
    Users -->|HTTPS| Proxy
    Proxy -->|HTTP| Ingress
    Users -.->|"без прокси"| Ingress
    Ingress --> App
    App --> PG
    App --> CH
    App --> VK
    Probe -->|результаты| Ingress
    Runner -->|задания| Ingress
    Probe -->|проверки| Targets
```

| Сервис | Образ | Что он делает |
| --- | --- | --- |
| `ingress` | `oneuptime/nginx` | Принимает весь трафик на портах 80 и 443 и направляет его в приложение. Отдаёт HTTPS, когда OneUptime управляет сертификатом. |
| `app` | `oneuptime/app` | Панель, API, страницы статуса, приём телеметрии и фоновые обработчики. |
| `probe-1` | `oneuptime/probe` | Глобальный зонд, который выполняет проверки ваших мониторов. Использует сеть хоста. |
| `runner` | `oneuptime/runner` | Runner экземпляра, который выполняет исправления кода с помощью ИИ. Использует сеть хоста. |
| `postgres` | `postgres:15` | Конфигурация и состояние: мониторы, инциденты, пользователи. Хранится в томе `postgres`. |
| `clickhouse` | `clickhouse/clickhouse-server:26.7` | Телеметрия: логи, метрики, трассировки и исключения. Хранится в томе `clickhouse`. |
| `valkey` | `valkey/valkey:9.1-alpine` | Кэш и очереди. Ничего не хранит на диске. |

> [!NOTE]
> Сервис `valkey` запускает [Valkey](https://valkey.io), форк Redis 7.2 под лицензией BSD, который настраивается параметрами `VALKEY_*` в `config.env`. Подойдёт любой сервер с протоколом Redis — при желании направьте `VALKEY_HOST` на управляемый Redis. До 13.0.0 эти параметры назывались `REDIS_*`; старые имена по-прежнему читаются, контейнер по-прежнему отвечает на имя хоста `redis`, а `npm run update` их не переписывает, поэтому старый `config.env` не требует правок.

Для продакшена большого масштаба или когда нужна высокая доступность используйте вместо этого [Helm-чарт](https://artifacthub.io/packages/helm/oneuptime/oneuptime) в Kubernetes: Docker Compose запускает по одной копии каждого сервиса на одном сервере.

## Требования

Выбирайте размер сервера по тому, что вы будете на нём запускать. Память и диск определяет телеметрия (логи, метрики, трассировки); когда узнаете свои объёмы, загляните в [Подбор размеров и планирование ёмкости](/docs/installation/sizing).

| | Рекомендуется | Минимум для домашней лаборатории |
| --- | --- | --- |
| **Память** | 16 ГБ | 8 ГБ |
| **CPU** | 8 ядер | 4 ядра |
| **Диск** | 400 ГБ | 20 ГБ |
| **Система** | Ubuntu 22.04 или другой Linux на основе Debian, Ubuntu или RHEL | То же |
| **Архитектура** | x86-64 (`amd64`) или ARM (`arm64`) | То же |

Минимум для домашней лаборатории подходит для личного и экспериментального использования — некоторые запускают OneUptime на Raspberry Pi.

Также понадобятся:

- **Docker** с плагином **Docker Compose v2** (команда `docker compose`).
- **Git**, чтобы загрузить OneUptime.
- **Node.js и npm**, которые запускают скрипты `npm start` и `npm run update`, оборачивающие Docker Compose.
- **Свободные порты 80 и 443** на сервере. В таблице ниже перечислены все порты, которые OneUptime использует на хосте.

| Порт хоста | Кто использует | Параметр | Для чего |
| --- | --- | --- | --- |
| 80 | `ingress` | `ONEUPTIME_HTTP_PORT` | Панель, API, приём телеметрии и проверка Let's Encrypt. |
| 443 | `ingress` | `STATUS_PAGE_HTTPS_PORT` | HTTPS для вашего экземпляра, когда OneUptime управляет сертификатом, а также для страниц статуса и панелей на собственных доменах. |
| 5400 | `postgres` | Задан в `docker-compose.yml` | Даёт `npm run backup` доступ к PostgreSQL. Держите его закрытым от интернета. |
| 3874 | `probe-1` | `GLOBAL_PROBE_1_PORT` | Собственный сервер зонда. Ничему за пределами сервера он не нужен. |
| 3876 | `runner` | `ONEUPTIME_RUNNER_PORT` | Собственный сервер Runner. Ничему за пределами сервера он не нужен. |

Есть также [видео с пошаговой установкой](https://youtu.be/j1SWmMW2oL4).

## Установка OneUptime

:::steps
### Клонируйте ветку release

Ветка `release` содержит файлы последнего релиза.

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
```

### Создайте config.env

Все настройки OneUptime хранятся в `config.env`. Начните с примера:

```bash
cp config.example.env config.env
```

### Задайте имя хоста

Откройте `config.env` и укажите в `HOST` доменное имя или IP-адрес, по которому к OneUptime будут обращаться, без `http://`. Оставляйте `localhost`, только чтобы попробовать OneUptime на своём компьютере.

```ini title="config.env"
HOST=oneuptime.example.com
```

### Сгенерируйте случайные секреты

В файле примера есть секреты-заглушки, которые публично доступны на GitHub. Замените каждый собственным случайным значением:

```bash
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done
grep -c "please-change-this" config.env
```

Последняя команда выводит `0`: заглушек не осталось. Цикл использует GNU `sed`, который есть на любом Linux-сервере. Вот параметры, которые он заполняет:

| Параметр | Что он защищает |
| --- | --- |
| `ONEUPTIME_SECRET` | Вызовы между собственными сервисами OneUptime. |
| `ENCRYPTION_SECRET` | Секреты, которые хранит OneUptime, например токены интеграций и пароли SMTP, и выдаваемые им токены входа. |
| `DATABASE_PASSWORD`, `CLICKHOUSE_PASSWORD`, `VALKEY_PASSWORD` | Три хранилища данных. |
| `REGISTER_PROBE_KEY` | Регистрацию зондов в вашем экземпляре. |
| `GLOBAL_PROBE_1_KEY`, `GLOBAL_PROBE_2_KEY` | Глобальные зонды, которые может запускать Docker Compose (`probe-1` работает по умолчанию). |
| `ONEUPTIME_RUNNER_KEY` | Встроенный Runner. |

> [!IMPORTANT]
> Задайте секреты до первого запуска и не меняйте их потом. PostgreSQL принимает пароль только при создании своей базы данных, а смена `ENCRYPTION_SECRET` позже делает нечитаемым любое значение, зашифрованное старым.

### Запустите OneUptime

:::tabs
@tab npm
```bash
npm start
```
@tab Docker CLI
```bash
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)
```
:::

Первый запуск занимает несколько минут: Docker скачивает образы, а OneUptime создаёт свои базы данных. `npm start` ждёт, пока ответит каждая часть, и завершается строкой **OneUptime is up!**

### Создайте первую учётную запись

Откройте `http://` и следом ваш `HOST` (например, `http://localhost`) и зарегистрируйтесь. Первая учётная запись нового экземпляра становится его главным администратором, который может открыть Admin Dashboard по адресу `/admin`.

Любой, кто может открыть страницу, сможет зарегистрироваться после вас. Чтобы запретить это, откройте Admin Dashboard, перейдите в **Настройки > Аутентификация** и выключите **Разрешить регистрацию**. Люди, которых вы приглашаете в проект, по-прежнему смогут создать учётную запись.
:::

## Настройка HTTPS

OneUptime отдаёт обычный HTTP, пока вы не выберете один из двух способов добавить HTTPS:

| | OneUptime получает сертификат сам | Ваш собственный обратный прокси |
| --- | --- | --- |
| **Где завершается TLS** | В `ingress` OneUptime, с бесплатным сертификатом Let's Encrypt, который он продлевает сам | В вашем прокси: Caddy, Nginx или балансировщике нагрузки |
| **Что нужно** | Публичное доменное имя, указывающее на сервер, и порты 80 и 443, доступные из интернета | Прокси и сертификат для вашего домена |
| **Параметры** | `PROVISION_SSL=true`, `HTTP_PROTOCOL=https` | `PROVISION_SSL=false`, `HTTP_PROTOCOL=https`, `TRUSTED_PROXY_HOPS=2` |
| **Страницы статуса на собственных доменах** | Работают без дополнительной настройки | Ваш прокси должен обслуживать и эти домены |

Если вы размещаете страницы статуса или панели на собственных доменах, проще доверить TLS самому OneUptime: ingress сам заказывает и отдаёт сертификаты этих доменов.

### OneUptime получает сертификат сам

:::steps
#### Направьте домен на сервер

Создайте для домена DNS-запись `A` (или `AAAA` для IPv6) со значением — публичным IP-адресом сервера.

#### Включите получение сертификатов

Задайте эти значения в `config.env`:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

`HOST` должен быть доменным именем: OneUptime не может получить сертификат для IP-адреса или для `localhost`.

#### Перезапустите с новыми параметрами

```bash
npm start
```

#### Откройте экземпляр по HTTPS

Откройте `https://oneuptime.example.com`. OneUptime заказывает сертификат при запуске, затем проверяет его каждый час и продлевает, когда остаётся меньше 30 дней. Пока не придёт первый сертификат, обычно в течение нескольких минут, ingress отдаёт временный самоподписанный, и браузер вас предупреждает.
:::

### Ваш собственный обратный прокси

В этих шагах прокси работает на том же сервере, что и OneUptime. Если ваш прокси работает на другой машине, пропустите первый шаг и направьте прокси на порт 80 этого сервера.

:::steps
#### Переведите ingress с портов 80 и 443

Прокси нужны порты 80 и 443, поэтому переведите ingress на другие порты. Зонд и Runner используют сеть хоста и обращаются к OneUptime через `http://localhost`, поэтому переезжают вместе с ним:

```ini title="config.env"
ONEUPTIME_HTTP_PORT=8080
STATUS_PAGE_HTTPS_PORT=8443
GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost:8080
ONEUPTIME_RUNNER_ONEUPTIME_URL=http://localhost:8080
```

#### Сообщите OneUptime, что он за прокси

```ini title="config.env"
HOST=oneuptime.example.com
HTTP_PROTOCOL=https
PROVISION_SSL=false
TRUSTED_PROXY_HOPS=2
```

`HTTP_PROTOCOL=https` заставляет ссылки, которые строит OneUptime, использовать HTTPS. `TRUSTED_PROXY_HOPS=2` учитывает ваш прокси и ingress OneUptime, чтобы для списков разрешённых IP и ограничений частоты OneUptime читал настоящий адрес посетителя. Прибавляйте по единице за каждый следующий прокси, дописывающий в `X-Forwarded-For`, например CDN или балансировщик нагрузки.

#### Перезапустите OneUptime на новых портах

```bash
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)
bash Tests/Scripts/status-check.sh localhost:8080
```

`npm start` проверяет `http://localhost` на порту 80, где будет ваш прокси, поэтому проверьте новый порт сами. Скрипт завершается строкой **OneUptime is up!**

#### Настройте прокси

:::tabs
@tab Caddy
```text title="Caddyfile"
oneuptime.example.com {
	reverse_proxy localhost:8080
}
```
Caddy сам получает и продлевает сертификат, перенаправляет HTTP на HTTPS и пропускает соединения WebSocket. После изменения файла перезагрузите Caddy, например командой `sudo systemctl reload caddy`.
@tab Nginx
```nginx title="/etc/nginx/conf.d/oneuptime.conf"
map $http_upgrade $oneuptime_connection_upgrade {
    default upgrade;
    ""      close;
}

server {
    listen 80;
    server_name oneuptime.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name oneuptime.example.com;

    ssl_certificate     /etc/letsencrypt/live/oneuptime.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/oneuptime.example.com/privkey.pem;

    # The limits OneUptime's own ingress uses.
    client_max_body_size 50M;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $oneuptime_connection_upgrade;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }

    # MCP clients keep a stream open.
    location /mcp {
        proxy_pass http://127.0.0.1:8080;
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```
Пути к сертификатам — это места, куда Certbot кладёт сертификат Let's Encrypt; если ваш сертификат получен иначе, укажите его пути. Проверьте файл и перезагрузите Nginx командой `sudo nginx -t && sudo systemctl reload nginx`.
:::

#### Откройте экземпляр через прокси

Откройте `https://oneuptime.example.com`. Вы должны увидеть страницу входа OneUptime, отданную с сертификатом вашего прокси.
:::

> [!NOTE]
> За собственным прокси отправляйте телеметрию по OTLP/HTTP (`/otlp`). OTLP по gRPC доходит до OneUptime, только когда TLS завершает его собственный ingress (`PROVISION_SSL=true`).

## Чек-лист для продакшена

Docker Compose запускает по одной копии каждого сервиса на одном сервере, что подходит небольшим командам и домашним лабораториям. Прежде чем на него полагаться, пройдитесь по этому списку.

| Область | Что сделать |
| --- | --- |
| **Секреты** | Ни одно значение в `config.env` больше не является заглушкой `please-change-this-to-random-value`. См. [Сгенерируйте случайные секреты](#сгенерируйте-случайные-секреты). |
| **HTTPS** | К OneUptime обращаются по HTTPS, и задан `HTTP_PROTOCOL=https`. См. [Настройка HTTPS](#настройка-https). |
| **Регистрации** | Когда у команды появятся учётные записи, выключите **Разрешить регистрацию** в **Настройки > Аутентификация** в Admin Dashboard. |
| **Межсетевой экран** | В интернет открыты только порты 80 и 443 (и SSH). PostgreSQL опубликован на порту 5400 для резервного копирования: закройте его межсетевым экраном облачного провайдера, потому что правила `ufw` не действуют на порты, которые публикует Docker. |
| **Резервные копии** | PostgreSQL копируется каждый день, и копии уходят с сервера. См. [Резервное копирование и восстановление](#резервное-копирование-и-восстановление). |
| **Почта** | В Admin Dashboard в **Настройки > Уведомления > Email** настроен почтовый сервер, чтобы OneUptime мог отправлять приглашения и уведомления. См. [SMTP](/docs/emails/smtp). |
| **Диск** | За свободным местом следят. ClickHouse растёт вместе с хранимой телеметрией (см. [Подбор размеров и планирование ёмкости](/docs/installation/sizing)); лог каждого контейнера ограничен 1000 МБ. |
| **Обновления** | OneUptime обновляется не реже раза в неделю. Релизы выходят часто. См. [Обновление OneUptime](#обновление-oneuptime). |
| **Высокая доступность** | Если она нужна, переходите на [Helm-чарт](https://artifacthub.io/packages/helm/oneuptime/oneuptime) в Kubernetes. |

## Резервное копирование и восстановление

PostgreSQL хранит всё, что вы настраиваете: мониторы, инциденты, страницы статуса, пользователей. `npm run backup` сохраняет его дамп в файл в папке `Backups`.

:::steps
### Передайте скрипту резервного копирования пароль базы данных

В `config.env` задайте `DATABASE_BACKUP_PASSWORD` равным значению `DATABASE_PASSWORD`. Скрипт читает `config.env` как обычный текст, поэтому идущий в комплекте `${DATABASE_PASSWORD}` никогда не подставляется.

### Запустите резервное копирование

```bash
npm run backup
```

Скрипт запрашивает пароль sudo и записывает `Backups/db-<day of the month>.backup`, так что ежедневные копии заменяют копии месячной давности. Запускайте его хотя бы раз в день.

### Скопируйте резервные копии за пределы сервера

Копия на том же диске, что и база данных, не переживёт потерю этого диска.
:::

ClickHouse хранит телеметрию в томе Docker `oneuptime_clickhouse`, и никакой скрипт его не копирует. Если эту телеметрию нужно сохранить, сделайте резервную копию тома инструментом для ClickHouse, например [clickhouse-backup](https://github.com/Altinity/clickhouse-backup), или скопируйте том, пока OneUptime остановлен.

Чтобы восстановить PostgreSQL, задайте значения `DATABASE_RESTORE_*` в `config.env`: `DATABASE_RESTORE_PASSWORD` — значением `DATABASE_PASSWORD`, как для резервного копирования, а `DATABASE_RESTORE_FILENAME` — именем восстанавливаемой копии, например `db-31.backup`. Затем выполните `bash restore.sh`. База данных, в которую идёт восстановление, должна уже существовать; в работающей установке она есть.

> [!CAUTION]
> `restore.sh` удаляет из целевой базы данных каждый объект из резервной копии перед тем, как создать его заново. Перед началом скрипт спрашивает подтверждение; проверьте имя базы данных, которое он показывает.

## Обновление OneUptime

Сначала сделайте резервную копию, затем выполните:

```bash
git checkout release
git pull
npm run update
```

`npm run update` запрашивает пароль sudo, добавляет в ваш `config.env` новые параметры из `config.example.env` (ваши значения сохраняются), скачивает новые образы и перезапускает OneUptime. Как и `npm start`, он завершается строкой **OneUptime is up!**

Переход на новую основную версию (например, с 13 на 14) может потребовать большего: прочитайте [Обновление OneUptime до новой версии](/docs/installation/upgrading), прежде чем начинать.

`APP_TAG=release` в `config.env` всегда скачивает последний релиз Community Edition. Чтобы остаться на одной версии, укажите в `APP_TAG` её номер, например `14.0.22`. Для Enterprise Edition теги — `enterprise-release` и `enterprise-14.0.22`.

## Удаление OneUptime

Остановите OneUptime и удалите его контейнеры и сеть:

```bash
npm run down
```

Ваши данные остаются в томах `oneuptime_postgres` и `oneuptime_clickhouse`, а папка `oneuptime` сохраняет `config.env` и резервные копии. Чтобы удалить и данные:

```bash
(export $(grep -v '^#' config.env | xargs) && docker compose down --volumes --remove-orphans)
```

Затем удалите папку `oneuptime`.

> [!CAUTION]
> `--volumes` навсегда удаляет все мониторы, инциденты, пользователей и всю телеметрию. Если что-то из этого может понадобиться, сначала сделайте резервную копию.

## Устранение неполадок

:::details Docker пишет "permission denied" при запуске npm start
Ваш пользователь не может обратиться к демону Docker. Добавьте его в группу `docker`, затем выйдите из системы и войдите снова:

```bash
sudo usermod -aG docker $USER
```
:::

:::details Ingress не запускается, потому что порт 80 или 443 занят
Порт занимает другая программа на сервере, часто веб-сервер. Остановите её или переведите ingress на другие порты и поставьте эту программу перед OneUptime, как описано в разделе [Ваш собственный обратный прокси](#ваш-собственный-обратный-прокси).
:::

:::details npm start завершается с "Maximum retries reached"
Проверка в конце `npm start` сдалась раньше, чем OneUptime ответил. Первый запуск может длиться дольше, чем ждёт проверка, пока скачиваются образы и создаются базы данных. Посмотрите, что запущено, и прочитайте логи:

```bash
npm run ps
npm run logs
```

Когда все контейнеры запущены, повторите проверку командой `npm run status-check`. Если вы перевели ingress с порта 80, проверьте вместо этого его новый порт: `bash Tests/Scripts/status-check.sh localhost:8080`.
:::

:::details Часть страниц загружается, но живые обновления или загрузки файлов не работают
Открывайте OneUptime по адресу из `HOST`. Ingress направляет запросы по имени хоста: всё приложение доступно только по `HOST` и `localhost`, а любое другое имя, например IP-адрес сервера, считается доменом страницы статуса. Укажите в `HOST` имя, которым пользуются люди, и выполните `npm start`.
:::

:::details Браузер предупреждает о сертификате после того, как вы задали PROVISION_SSL
Пока Let's Encrypt не выпустит сертификат, ingress отдаёт временный самоподписанный. Если предупреждение держится дольше нескольких минут, проверьте, что:

- `HOST` — доменное имя, а не IP-адрес и не `localhost`.
- DNS-запись домена указывает на этот сервер.
- Порт 80 доступен из интернета, чтобы Let's Encrypt мог проверить домен.

Когда заказ не удаётся, приложение пишет в лог ошибку, которая начинается с `CoreSSL:EnsurePrimaryHostCertificate`, а за ней следует причина:

```bash
(export $(grep -v '^#' config.env | xargs) && docker compose logs app) | grep -A 5 CoreSSL
```
:::

:::details Встроенный зонд показывает Отключено после смены порта ingress
Admin Dashboard показывает зонд в **Настройки > Мониторинг > Глобальные зонды**. Он обращается к OneUptime по `GLOBAL_PROBE_1_ONEUPTIME_URL`, где по умолчанию указан `http://localhost` (порт 80). Укажите там новый порт ingress, например `http://localhost:8080`, так же задайте `ONEUPTIME_RUNNER_ONEUPTIME_URL` и перезапустите OneUptime.
:::

## Следующие шаги

:::cards
- [Обновление OneUptime до новой версии](/docs/installation/upgrading): Что требует от вас каждая основная версия.
- [Подбор размеров и планирование ёмкости](/docs/installation/sizing): Спланируйте память и диск под вашу телеметрию.
- [Архитектура самостоятельного размещения](/docs/self-hosted/architecture): Как устроены компоненты.
- [Редакция Enterprise](/docs/self-hosted/enterprise): Что добавляет образ Enterprise, и его лицензия.
:::
