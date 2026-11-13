# Почтовые провайдеры

Отправляйте почту OneUptime через HTTPS API почтового провайдера, а не через SMTP-сервер: Amazon SES, SendGrid, Mailgun, Postmark или Resend. Проект выбирает провайдера для конфигурации SMTP, а самостоятельно размещённая установка может отправлять через него всю свою почту. API доступен по HTTPS через порт 443, поэтому почта уходит даже из сетей, где порты SMTP заблокированы, а ключ каждого провайдера хранится в зашифрованном виде.

:::cards
- [Amazon SES](#amazon-ses): Ключ доступа IAM или собственная роль IAM сервера, а также регион, в котором подтверждён ваш отправитель.
- [SendGrid](#sendgrid): API-ключ с доступом Mail Send.
- [Mailgun](#mailgun): API-ключ, домен отправки и его регион.
- [Postmark](#postmark): API-токен сервера.
- [Resend](#resend): API-ключ с правом отправки.
- [Переменные окружения](#задать-почту-сервера-через-переменные-окружения): Задайте почту самостоятельно размещённого сервера из values Helm или `config.env`.
- [Устранение неполадок](#устранение-неполадок): Что означает отказ каждого провайдера.
:::

## Выбор провайдера

:::tabs
@tab Проект
В **Настройки проекта > Уведомления > Каналы уведомлений** откройте **Дополнительные настройки** и нажмите **Создать: Конфигурация SMTP** в карточке **Пользовательские конфигурации SMTP**. На шаге **Провайдер** введите **Имя** и выберите провайдера. Следующий шаг запрашивает настройки этого провайдера, а шаг **Отправитель** — **Email отправителя** и **Имя отправителя**. После сохранения кнопка **Отправить тестовое письмо** в строке конфигурации проверяет, что она работает.
@tab Самостоятельно размещённый экземпляр
В Admin Dashboard откройте **Настройки**, затем **Уведомления > Email**. В карточке **Настройки email-сервера** нажмите **Изменить сервер** и выберите для **Тип почтового сервера** нужного провайдера. Ниже появится карточка провайдера, например **Настройки Amazon SES**: нажмите её кнопку изменения, например **Изменить Amazon SES**, и заполните настройки провайдера и шаг **Отправитель**. Пока заполнено не всё необходимое, карточка сообщает, чего не хватает, а каждое письмо отклоняется с указанием настройки, которую нужно заполнить. Сервер, который развёртывается из кода, может вместо этого задать их через переменные окружения: см. [Задать почту сервера через переменные окружения](#задать-почту-сервера-через-переменные-окружения).
:::

| Провайдер | Что нужно указать | Куда отправляет OneUptime |
| --- | --- | --- |
| Amazon SES | Идентификатор ключа доступа, Секретный ключ доступа, Регион | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | API-ключ | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API-ключ, Домен, Регион | `https://api.mailgun.net` или `https://api.eu.mailgun.net` |
| Postmark | API-токен сервера | `https://api.postmarkapp.com/email` |
| Resend | API-ключ | `https://api.resend.com/emails` |

Каждое письмо уходит вместе с текстовой частью, а его изображения (логотип OneUptime, снимки экрана) — в виде встроенных вложений. Если провайдер ограничивает скорость отправки или на его стороне происходит сбой, OneUptime повторяет попытку через то время, которое указывает провайдер; любой другой отказ сохраняется в журналах уведомлений вместе с ответом провайдера.

## Amazon SES

:::steps
### Подтвердите отправителя

В [консоли Amazon SES](https://console.aws.amazon.com/ses/), в регионе, из которого вы будете отправлять почту, подтвердите в разделе **Identities** адрес, с которого отправляете, или его домен. Пока ваша учётная запись находится в песочнице SES, подтвердите также каждого получателя или запросите производственный доступ.

### Создайте ключ доступа

Создайте для OneUptime пользователя IAM с политикой, разрешающей `ses:SendEmail` для вашего удостоверения, а затем создайте для него ключ доступа:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

Самостоятельно размещённая установка в AWS может обойтись без ключа и вместо этого [входить с ролью IAM сервера](#вход-с-ролью-iam-сервера) с той же политикой.

### Заполните шаг «Amazon SES»

Введите **Идентификатор ключа доступа** и **Секретный ключ доступа**, а также **Регион**, в котором подтверждено ваше удостоверение, например `us-east-1`.
:::

### Вход с ролью IAM сервера

Самостоятельно размещённая установка в AWS может отправлять собственную почту от имени роли IAM, которую AWS выдаёт серверу, без ключа доступа, хранимого в OneUptime: учётные данные, которые выдаёт AWS, истекают в течение нескольких часов, и OneUptime получает новые до того, как это произойдёт. Это касается только собственной почты сервера. Конфигурация Amazon SES проекта всегда входит с ключом доступа, потому что роль сервера — это собственное удостоверение AWS сервера, а не проекта.

Дайте роли политику, приведённую выше, а затем запустите OneUptime от её имени:

:::tabs
@tab Amazon EKS
С ролями IAM для сервисных аккаунтов создайте роль с политикой доверия для OIDC-провайдера вашего кластера и поручите Helm-чарту создать сервисный аккаунт с ARN роли. Поды app и worker OneUptime работают от его имени:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

С EKS Pod Identity вместо этого создайте связь Pod Identity между ролью и этим сервисным аккаунтом и не добавляйте аннотацию.
@tab Amazon ECS
Укажите роль как **Task role** в определении задачи OneUptime.
@tab Amazon EC2
Прикрепите роль к инстансу как его профиль инстанса. Если OneUptime работает в Docker на инстансе, увеличьте ограничение переходов (hop limit) метаданных инстанса до 2, чтобы контейнеры могли до них достучаться:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Затем в Admin Dashboard нажмите **Изменить Amazon SES**, выберите **Роль IAM этого сервера** как **Тип аутентификации** и введите **Регион**. При сохранении удаляется ключ доступа, сохранённый ранее.

OneUptime ищет учётные данные сервера там же, где их ищут AWS SDK, в таком порядке: `AWS_ACCESS_KEY_ID` и `AWS_SECRET_ACCESS_KEY` в его окружении, токен веб-удостоверения (`AWS_ROLE_ARN` и `AWS_WEB_IDENTITY_TOKEN_FILE`), конечная точка учётных данных контейнера Amazon ECS и EKS Pod Identity, затем служба метаданных инстанса EC2 (IMDSv2).

## SendGrid

В SendGrid откройте **Settings > API Keys** и создайте ключ с доступом **Mail Send**, а также подтвердите адрес, с которого отправляете почту (Single Sender Verification), или его домен (Domain Authentication). Введите ключ в поле **API-ключ** на шаге **SendGrid**.

## Mailgun

В Mailgun добавьте и подтвердите домен отправки, например `mg.example.com`, затем создайте для него ключ отправки или используйте API-ключ своей учётной записи. На шаге **Mailgun** введите **API-ключ** и **Домен** и выберите **Регион**, в котором создан домен: `EU` — для домена в европейском регионе Mailgun, `US` — для остальных. **Email отправителя** должен быть адресом в этом домене. Sandbox-домен отправляет почту только своим авторизованным получателям.

## Postmark

В Postmark откройте сервер, который отправляет почту, затем его вкладку **API Tokens** и скопируйте API-токен сервера: с токеном учётной записи отправка не работает. Введите его в поле **API-токен сервера** на шаге **Postmark**. **Email отправителя** должен быть подтверждённой подписью отправителя или адресом в подтверждённом домене. Пока Postmark не одобрит вашу учётную запись, почта отправляется только на адреса в вашем собственном домене.

## Resend

В Resend добавьте и подтвердите свой домен в разделе **Domains**, затем создайте API-ключ с правом отправки в разделе **API Keys**. Введите его в поле **API-ключ** на шаге **Resend**, а в **Email отправителя** укажите адрес в своём подтверждённом домене. Собственный тестовый домен Resend отправляет почту только на ваш адрес.

## Задать почту сервера через переменные окружения

Самостоятельно размещённый сервер, который развёртывается из кода, может сразу после запуска отправлять письма, без ручной настройки: задайте его настройки почты через переменные окружения, из Terraform или того, чем вы развёртываете OneUptime. Как только задана `GLOBAL_EMAIL_SERVER_TYPE`, сервер отправляет свои письма так, как описывают переменные. Настройки, сохранённые в Admin Dashboard в разделе **Настройки**, затем **Уведомления > Email**, не используются, а эта страница показывает новые только для чтения, каждое поле вместе с переменной, которая его задаёт. Оставьте `GLOBAL_EMAIL_SERVER_TYPE` пустой, чтобы вместо этого настроить почту в Admin Dashboard. Конфигурации SMTP проектов это не затрагивает.

| Переменная | Значение Helm | Что в ней |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`, `sendgrid`, `amazon-ses`, `mailgun`, `postmark` или `resend`. Только когда она задана, OneUptime читает остальные переменные |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | Адрес, с которого приходит каждое письмо |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | Имя, от которого приходит каждое письмо. Обязательно для `custom-smtp` и `sendgrid` |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp` (и когда она пуста) или `microsoft-graph`, чтобы отправлять через Microsoft Graph с приложением OAuth |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | Почтовый сервер, например `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | Его порт, например `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true`, чтобы отправлять только по зашифрованному соединению с действительным сертификатом, или `false` (и когда она пуста) |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password` (и когда она пуста), `oauth` или `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | Почтовый ящик, под которым выполняется вход, в том числе для `oauth`. Оставьте его и пароль пустыми, чтобы отправлять без входа |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password` или Secret, указанный в `email.existingSecret.name` | Его пароль |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials` (и когда она пуста) или `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | Идентификатор клиента приложения OAuth |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret` или Secret, указанный в `email.existingSecret.name` | Его секрет клиента; для `jwt-bearer` — его закрытый ключ в формате PEM |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | Его URL токена |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | Его scope |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey` или Secret, указанный в `email.existingSecret.name` | API-ключ SendGrid |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key` (и когда она пуста) или `server-iam-role`, чтобы входить с ролью IAM сервера |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | Идентификатор ключа доступа |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey` или Secret, указанный в `email.existingSecret.name` | Его секретный ключ доступа |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | Регион, в котором подтверждён ваш отправитель, например `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey` или Secret, указанный в `email.existingSecret.name` | API-ключ Mailgun |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | Домен отправки, например `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us` (и когда она пуста) или `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken` или Secret, указанный в `email.existingSecret.name` | Серверный API-токен Postmark |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey` или Secret, указанный в `email.existingSecret.name` | API-ключ Resend |

Используются только те переменные, которые читает тип сервера: переменные `GLOBAL_EMAIL_SMTP_` для `custom-smtp` и собственные переменные провайдера для этого провайдера. Журнал сервера и Admin Dashboard называют любую другую заданную переменную неиспользуемой.

В Helm задайте их в разделе `email` ваших values. Чтобы пароль или ключ не попал в values, которые Helm сохраняет с каждым релизом, положите его в свой Secret и укажите этот Secret в `email.existingSecret.name`. Чарт читает его из ключа, указанного в `email.existingSecret.key`, а иначе из ключа, названного по нему: `smtpPassword`, `smtpOAuthClientSecret`, `sendgridApiKey`, `amazonSesSecretAccessKey`, `mailgunApiKey`, `postmarkServerToken` или `resendApiKey`.

```bash
kubectl create secret generic oneuptime-email --namespace oneuptime \
  --from-literal=smtpPassword=YOUR_SMTP_PASSWORD
```

```yaml
email:
  serverType: custom-smtp
  fromEmail: alerts@example.com
  fromName: OneUptime
  smtp:
    host: smtp.example.com
    port: 587
    requireTls: true
    username: alerts@example.com
  existingSecret:
    name: oneuptime-email
```

Чарт отклоняет другие значения `email` без `email.serverType`, настройки без пароля или ключа, который они читают, пароль или ключ, заданный и в values, и в Secret, а также Secret, из которого настройки ничего не читают. В Terraform задайте те же значения в `helm_release`, а пароль или ключ передайте как секретное значение.

В Docker Compose задайте параметры `GLOBAL_EMAIL_` в `config.env`, затем выполните `npm run start`, чтобы пересоздать контейнеры.

OneUptime читает переменные при запуске. Если какая-то из них неверна, например порт, который не является числом, или отсутствующий пароль, сервер не отправляет писем, пока это не исправлено; журнал сервера, настройки почты в Admin Dashboard и контрольный список на `/admin/setup` называют переменную. Пароли и ключи никогда не показываются. Чтобы изменить настройки, измените переменные и перезапустите OneUptime: Admin Dashboard их не меняет.

## Устранение неполадок

Если тестовое письмо не отправлено, вы сразу увидите причину. Для любого другого письма откройте вкладку **Электронная почта** в **Настройки проекта > Уведомления > Журналы уведомлений** и выберите **Просмотреть сообщение о статусе** в его строке.

:::details "Amazon SES needs a verified identity in …"
**Email отправителя** или его домен не подтверждён в регионе, указанном в конфигурации, либо учётная запись находится в песочнице SES, а получатель не подтверждён. Подтвердите адрес в этом регионе или запросите производственный доступ.
:::

:::details "Amazon SES does not recognize the access key" или "did not accept the request's signature"
Проверьте **Идентификатор ключа доступа**, что ключ активен в IAM и что **Секретный ключ доступа** — тот, что был создан вместе с ним. Подпись также отклоняется, если часы сервера идут неправильно.
:::

:::details "The access key may not send with Amazon SES"
Политика пользователя IAM не разрешает `ses:SendEmail` для вашего удостоверения. Добавьте политику, приведённую выше.
:::

:::details "This server has no AWS credentials"
Сервер входит со своей ролью IAM, но AWS не выдаёт ему учётных данных. Запустите его от имени роли, как показывает [Вход с ролью IAM сервера](#вход-с-ролью-iam-сервера), а затем перезапустите поды или задачи OneUptime: под получает настройки своей роли при запуске. В Docker на Amazon EC2 сообщение также говорит, когда ограничение переходов метаданных инстанса слишком низкое.
:::

:::details "This server's IAM role may not send with Amazon SES" или "did not let this server assume the role"
Политика роли не разрешает `ses:SendEmail` для вашего удостоверения: добавьте политику, приведённую выше. Или в Amazon EKS политика доверия роли не разрешает `sts:AssumeRoleWithWebIdentity` для OIDC-провайдера вашего кластера и сервисного аккаунта OneUptime.
:::

:::details "Mailgun has no domain … in its US region"
Домен находится не в том регионе, куда отправляет конфигурация. Проверьте **Домен** и выберите для **Регион** значение `EU`, если домен был создан там.
:::

:::details "is not a confirmed sender signature in Postmark" или "is not a verified domain in Resend"
Подтвердите **Email отправителя** как отправителя или подтвердите его домен в панели управления провайдера.
:::

:::details "did not accept the API key" или "did not accept the server API token"
Проверьте ключ в конфигурации: ключу SendGrid нужен доступ Mail Send, ключ отправки Mailgun работает только для своего домена, Postmark нужен токен сервера, а ключу Resend — право отправки.
:::

## Дальнейшие шаги

:::cards
- [SMTP](/docs/emails/smtp): Отправлять почту через собственный почтовый сервер или Microsoft 365 вместо провайдера.
- [Подписчики и объявления](/docs/status-pages/subscribers): Отправлять письма подписчикам страницы статуса через конфигурацию SMTP проекта.
:::
