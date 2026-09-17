# Интеграция со Slack

Подключите самостоятельно размещённый проект OneUptime к Slack для уведомлений, действий с инцидентами, команд и событий сообщений.

## Настройка

1. Настройте имя хоста OneUptime и HTTPS, как описано ниже. Скопируйте созданный манифест в **Settings > Slack Integration**; он также доступен по адресу `https://your-oneuptime-domain.com/api/slack/app-manifest`.
2. [Создайте приложение Slack](https://api.slack.com/apps) в рабочем пространстве из манифеста своей установки, чтобы URL соответствовали имени хоста.
3. Скопируйте **Client ID**, **Client Secret** и **Signing Secret** из **Basic Information** в `config.env` для Docker Compose:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Для Helm задайте следующие значения:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Примените конфигурацию и дождитесь перезапуска OneUptime. Если проверка Events URL не прошла до настройки секрета подписи, повторите её сейчас.
5. Вернитесь в **Settings > Slack Integration**, выберите **Connect to Slack** и авторизуйте приложение. Для действий, требующих идентификации пользователя, подключите также личную учётную запись Slack в OneUptime.

## Сетевой доступ для самостоятельного размещения

### Направления трафика и конечные точки

| Трафик | Необходимый доступ |
| --- | --- |
| OneUptime → Slack | DNS и исходящий HTTPS по TCP 443 к `slack.com` для Web API и обмена токенами OAuth; к `hooks.slack.com` для ответов на команды и уведомлений через входящие вебхуки, если они используются |
| Slack → OneUptime | Общедоступный HTTPS по TCP 443 к четырём POST-маршрутам ниже для полной интеграции |
| Браузер пользователя → OneUptime | Панель и OAuth-перенаправления на `/api/slack/auth/:projectId/:userId` и `/api/slack/auth/:projectId/:userId/user`; они могут оставаться доступными через VPN пользователя |

Домены описывают интеграцию OneUptime, а не полный список разрешений для клиентов или всех функций Slack. *Входящий вебхук* Slack размещён в Slack: OneUptime отправляет запросы туда; это не входящая точка на вашем сервере. См. [руководство по входящим вебхукам](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Передавайте следующие обратные вызовы поставщика приложению OneUptime через ingress:

| Метод и путь | Назначение |
| --- | --- |
| `POST /api/slack/events` | Проверка Events API, реакции, упоминания и сообщения |
| `POST /api/slack/interactive` | Кнопки, ярлыки, отправка модальных форм, `/incident` и `/maintenance` |
| `POST /api/slack/options-load` | Запросы вариантов интерактивных меню |
| `POST /api/slack/command` | Команда `/oneuptime` |

OAuth использует [перенаправление браузера с последующим обменом токенами на сервере](https://docs.slack.dev/authentication/installing-with-oauth/). Манифест регистрирует `/api/slack/auth` как префикс; OneUptime добавляет пути проекта и пользователя при авторизации. Доступ браузера сам по себе не позволяет Slack доставлять события или действия кнопок.

### Частные установки и безопасность обратных вызовов

Используйте публичный DNS и шлюз с общедоверенным HTTPS-сертификатом, полной цепочкой и частным маршрутом к ingress OneUptime. Разрешите входящий TCP 443 и публикуйте только указанные POST-вызовы поставщика. Частный `ClusterIP`, внутренний DNS или VPN сотрудника не дают поставщику доступа. Раздельный DNS позволяет оставить панель и браузерные OAuth-маршруты частными под одним именем хоста.

Задайте `HOST=oneuptime.example.com` и `HTTP_PROTOCOL=https` в `config.env` либо `host: oneuptime.example.com` и `httpProtocol: https` в Helm. Примените конфигурацию и дождитесь перезапуска. Эти значения формируют URL, но не настраивают DNS, TLS или межсетевой экран. При смене имени хоста заново создайте и обновите манифест Slack.

Сохраняйте метод, путь, строку запроса, исходное тело, `Content-Type`, `X-Slack-Signature` и `X-Slack-Request-Timestamp`. Передавайте публичный хост и HTTPS через доверенные заголовки прокси. Исключите обратные вызовы из браузерного SSO, CAPTCHA и страниц входа прокси, сохранив проверки подписи и времени OneUptime. Синхронизируйте часы сервера. Проверка IP источника не заменяет [проверку подписи Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Проверка доступа и ограничения

Проверьте Events Request URL в **Event Subscriptions**: Slack отправляет [проверочный POST и проверяет TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Затем отправьте тестовое уведомление, выполните slash-команду, нажмите кнопку инцидента и вызовите событие подписки. Проверьте журналы шлюза и OneUptime, не записывая секреты. Slack требует быстрых подтверждений, в том числе [ответа за три секунды для взаимодействий](https://docs.slack.dev/interactivity/handling-user-interaction/). GET браузера или успешная исходящая отправка не проверяет POST-вызовы.

При запрете всех входящих соединений авторизованное приложение ещё может отправлять сообщения по исходящему HTTPS, но события, кнопки, ярлыки и команды не работают. Манифест OneUptime использует HTTP-вызовы и отключает Socket Mode; включение Slack Socket Mode не является поддерживаемой заменой. [Настройка доступа к частным сетям](/docs/self-hosted/private-network-access) управляет исходящими запросами к частным адресатам и не публикует обратные вызовы.
