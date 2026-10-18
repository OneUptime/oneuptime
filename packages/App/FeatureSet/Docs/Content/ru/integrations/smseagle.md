# Интеграция с SMSEagle

Отправляйте уведомления об оповещениях в виде SMS или звонков через [SMSEagle](https://www.smseagle.eu), аппаратный SMS-шлюз, установленный в вашей собственной сети. В OneUptime есть встроенные компоненты рабочих процессов **SMSEagle**, поэтому настройка занимает немного времени.

Эта интеграция **исходящая**: OneUptime отправляет сообщения через [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
Оповещение OneUptime → On Create  ──►  компонент SMSEagle  ──►  SMS или звонок на телефон
```

## Шаг 1. Создайте ключ API

1. В веб-GUI SMSEagle откройте **Settings → API → API v2** и нажмите **Create API key**.
2. В разделе **Permissions** разрешите **Send SMS** и, если нужны звонки, **Make a TTS Advanced Call**.
3. Скопируйте ключ. В OneUptime он называется **SMSEagle Access Token**.

## Шаг 2. Дайте OneUptime доступ к устройству

1. Разрешите подключение с вашего сервера OneUptime к адресу устройства, например `https://192.168.0.100`, во всех межсетевых экранах и VPN между ними.
2. У устройства SMSEagle обычно частный адрес, а рабочие процессы по умолчанию его блокируют. В самостоятельно размещённом экземпляре добавьте IP-адрес или имя хоста устройства в `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` на сервере API, например `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, и перезапустите его. См. [Доступ к частным сетям](/docs/self-hosted/private-network-access).

## Шаг 3. Сохраните секреты

1. В OneUptime откройте **Рабочие процессы → Глобальные переменные → Создать**.
2. Создайте `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (секретную) и `ONCALL_PHONE`.

## Шаг 4. Соберите рабочий процесс

1. Откройте **Рабочие процессы → Создать рабочий процесс**, назовите его `Alerts → SMSEagle` и откройте **Конструктор**.
2. Добавьте триггер **Alert** со значением **On Create**. Переименуйте его в `Alert`.
3. Добавьте компонент **Send SMS via SMSEagle**, соединённый с триггером:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. Нажмите **Сохранить**, включите рабочий процесс и создайте тестовое оповещение. SMS приходит на телефон.

Шаблон **Text a phone via SMSEagle when an alert fires** собирает такой же рабочий процесс.

## Звонки вместо SMS

Используйте вместо этого **Make a Call via SMSEagle**. У него те же настройки и ещё **Voice ID**, голос синтеза речи на устройстве, и он зачитывает **Text to Read Out**. Ключу API нужно разрешение **Make a TTS Advanced Call**.

Шаблон **Call a phone via SMSEagle when an alert fires** собирает такой же рабочий процесс со звонком.

## Альтернатива: компонент API

Блок **API** тоже подходит:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Советы

- Если устройство отклонило сообщение, причина находится в значении **Error** компонента. Запишите её в журнал на выходе **Ошибка**.
- Используйте **Условия**, чтобы перед отправкой отфильтровать по степени серьёзности.
- Чтобы связаться с несколькими людьми, подключите несколько компонентов SMSEagle, по одному на номер.

## Что почитать дальше

- [Обзор интеграций](/docs/integrations/index): схема исходящих интеграций.
- [Компоненты → SMSEagle](/docs/workflows/components#smseagle): справочник по компоненту.
