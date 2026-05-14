# Отправка телеметрических данных в OneUptime с помощью Fluentd

## Обзор

Вы можете использовать плагин [Fluentd](https://www.fluentd.org/) для сбора журналов и телеметрических данных из ваших приложений и сервисов. Плагин отправляет телеметрические данные в HTTP-источник OneUptime. Для отправки данных можно использовать выходной плагин http в Fluentd. Плагин доступен здесь: https://docs.fluentd.org/output/http

## Начало работы

Fluentd поддерживает сотни источников данных, и вы можете передавать журналы из любого из них в OneUptime. Среди наиболее популярных источников:

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust 

и многие другие. 

Полный список поддерживаемых источников доступен [здесь](https://www.fluentd.org/datasources)

## Предварительные требования

- **Шаг 1: Установите Fluentd на вашу систему** — инструкции по установке доступны [здесь](https://docs.fluentd.org/installation)
- **Шаг 2: Зарегистрируйтесь в OneUptime** — вы можете зарегистрировать бесплатный аккаунт [здесь](https://oneuptime.com). Обратите внимание: аккаунт бесплатный, но прием журналов является платной функцией. Подробнее о ценах [здесь](https://oneuptime.com/pricing).
- **Шаг 3: Создайте проект OneUptime** — после регистрации создайте проект на панели управления OneUptime. При необходимости помощи напишите нам по адресу support@oneuptime.com
- **Шаг 4: Создайте токен приёма телеметрии** — после создания учётной записи OneUptime создайте токен приёма телеметрии для приёма журналов, метрик и трассировок от вашего приложения.

После регистрации в OneUptime и создания проекта нажмите «Ещё» в панели навигации и выберите «Настройки проекта».

На странице ключей приёма телеметрии нажмите «Создать ключ приёма» для создания токена.

![Создание сервиса](/docs/static/images/TelemetryIngestionKeys.png)

После создания токена нажмите «Просмотреть» для его отображения.

![Просмотр сервиса](/docs/static/images/TelemetryIngestionKeyView.png)


## Конфигурация

Используйте следующую конфигурацию для отправки телеметрических данных в HTTP-источник OneUptime. Добавьте её в конфигурационный файл Fluentd (обычно находится по пути `/etc/fluentd/fluent.conf` или `/etc/td-agent/td-agent.conf`). 

Замените `YOUR_SERVICE_TOKEN` на токен, созданный на предыдущем шаге, и `YOUR_SERVICE_NAME` на название вашего сервиса. Сервис может иметь любое имя. Если сервис не существует в OneUptime, он будет создан автоматически.

```yaml
# Совпадение со всеми шаблонами 
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```


Пример полного конфигурационного файла:

```yaml
####
## Описание источников:
##

## Встроенный TCP-вход
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```

**При самостоятельном хостинге OneUptime**: замените `endpoint_url` на URL вашего экземпляра. `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## Использование

После добавления конфигурации в конфигурационный файл Fluentd перезапустите сервис. После перезапуска телеметрические данные будут отправляться в HTTP-источник OneUptime. Вы сможете видеть данные на панели управления OneUptime. При возникновении вопросов или необходимости помощи с конфигурацией напишите нам по адресу support@oneuptime.com
