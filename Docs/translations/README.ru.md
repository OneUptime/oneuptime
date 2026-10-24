<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a>&nbsp;·
  <a href="/Docs/translations/README.zh-CN.md">简&#8288;体&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.zh-TW.md">繁&#8288;體&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.ja.md">日&#8288;本&#8288;語</a>&nbsp;·
  <a href="/Docs/translations/README.ko.md">한&#8288;국&#8288;어</a>&nbsp;·
  <a href="/Docs/translations/README.es.md">Español</a>&nbsp;·
  <a href="/Docs/translations/README.fr.md">Français</a>&nbsp;·
  <a href="/Docs/translations/README.de.md">Deutsch</a>&nbsp;·
  <a href="/Docs/translations/README.pt.md">Português</a>&nbsp;·
  <a href="/Docs/translations/README.it.md">Italiano</a>&nbsp;·
  <a href="/Docs/translations/README.ru.md">Русский</a>&nbsp;·
  <a href="/Docs/translations/README.hi.md">हिन्दी</a>&nbsp;·
  <a href="/Docs/translations/README.fa.md">فارسی</a>&nbsp;·
  <a href="/Docs/translations/README.nl.md">Nederlands</a>&nbsp;·
  <a href="/Docs/translations/README.da.md">Dansk</a>&nbsp;·
  <a href="/Docs/translations/README.sv.md">Svenska</a>&nbsp;·
  <a href="/Docs/translations/README.no.md">Norsk</a>
</p>

<p align="center">
  <a href="https://oneuptime.com"><picture><source media="(prefers-color-scheme: dark)" srcset="/packages/App/FeatureSet/Docs/Static/images/logo-dark.svg"><img alt="OneUptime" width="42%" src="/packages/App/FeatureSet/Docs/Static/images/logo-light.svg"></picture></a>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
</p>

OneUptime — платформа наблюдаемости с открытым исходным кодом. Она проверяет, что ваши сайты, API и серверы работают, собирает логи, метрики и трассировки, которые отправляют ваши приложения, оповещает дежурного, когда что-то ломается, и сообщает клиентам о проблемах на странице статуса. Всё это происходит в одном продукте: инструмент, который замечает проблему, сам и оповещает вашу команду.

Пользуйтесь [OneUptime Cloud](https://oneuptime.com) или запустите OneUptime на своих серверах.

<p align="center">
  <img alt="OneUptime во время инцидента: его хронология, кто дежурит, страница статуса и расследование OneUptime AI" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## Что умеет OneUptime

- **[Мониторинг](https://oneuptime.com/docs/ru/monitor/create-monitor)**: Проверять сайты, API, порты, DNS и сертификаты с зондов по всему миру или изнутри вашей сети. OneUptime также следит за серверами, Kubernetes, Docker, VMware, базами данных и сетевыми устройствами.
- **[Инциденты и дежурства](https://oneuptime.com/docs/ru/incidents/index)**: Вести каждый инцидент в одной хронологии. Оповещать дежурного звонком, SMS, по электронной почте, push-уведомлением, в Slack или Microsoft Teams и эскалировать, пока кто-то не ответит.
- **[Страницы статуса](https://oneuptime.com/docs/ru/status-pages/index)**: Держать клиентов в курсе на публичных или закрытых страницах статуса и объявлять там плановое обслуживание.
- **[Логи, метрики и трассировки](https://oneuptime.com/docs/ru/telemetry/open-telemetry)**: Отправлять их через OpenTelemetry, искать по ним и строить дашборды. Исключения, профили, Real User Monitoring и события безопасности находятся там же.
- **[Рабочие процессы и сборники инструкций](https://oneuptime.com/docs/ru/workflows/index)**: Автоматизировать рутинную работу и подключать Jira, ServiceNow и другие инструменты, которыми уже пользуется ваша команда.
- **[OneUptime AI](https://oneuptime.com/docs/ru/ai/ai-sre)**: Расследует новые инциденты и оповещения и публикует анализ первопричины со ссылками. Если включить исправление, он может открыть запрос на слияние с исправлением, которое проверит ваша команда.
- **[API, CLI и Terraform](https://oneuptime.com/docs/ru/api-reference/api-reference)**: Автоматизировать OneUptime из ваших скриптов и CI и управлять мониторами, страницами статуса и дежурствами как кодом.

Всё остальное есть в [документации](https://oneuptime.com/docs/ru/introduction/getting-started).

## Начало работы

### OneUptime Cloud

[Зарегистрируйтесь](https://oneuptime.com/accounts/register) и создайте проект. Для бесплатного тарифа банковская карта не нужна.

### Своё развёртывание с Docker Compose

Нужен Linux-сервер как минимум с 8 ГБ памяти, а также Docker, Docker Compose, Git и Node.js.

Перед шагом 3 укажите в `HOST` файла `config.env` доменное имя или IP-адрес, по которому к OneUptime будут обращаться, без `http://`. Оставляйте `localhost`, только чтобы попробовать OneUptime на своём компьютере.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config
cp config.example.env config.env

# 3. Start everything
npm start
```

`npm start` проверяет сервер, задаёт каждому секрету в `config.env` собственное случайное значение и запускает OneUptime. Когда `npm start` выведет **OneUptime is up!**, откройте `http://localhost` или адрес своего сервера и зарегистрируйтесь. Первая учётная запись становится администратором экземпляра.

В [руководстве по Docker Compose](https://oneuptime.com/docs/ru/installation/docker-compose) описаны размеры сервера, HTTPS, резервные копии и обновления.

### Kubernetes с Helm

Для продакшена в большом масштабе или с высокой доступностью установите Helm-чарт. Укажите в `host` доменное имя или IP-адрес, по которому к OneUptime будут обращаться:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

В [README чарта](/HelmChart/Public/oneuptime/README.md) описаны хранилище, HTTPS, базы данных и обновления.

## Community и Enterprise

- **Community Edition**: Бесплатная и с открытым исходным кодом, со всем перечисленным выше, включая единый вход через SAML и OIDC.
- **Enterprise Edition**: Добавляет подготовку учётных записей через SCIM, журналы аудита, соответствие требованиям для команд и панели состояния экземпляра, а также приоритетную поддержку. Для использования в продакшене нужна лицензия: [свяжитесь с отделом продаж](mailto:sales@oneuptime.com).

В документации [сравниваются обе редакции](https://oneuptime.com/docs/ru/self-hosted/enterprise).

## Помощь

- Задавайте вопросы в [сообществе OneUptime в Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Сообщайте об ошибках и предлагайте функции в [issues на GitHub](https://github.com/OneUptime/oneuptime/issues).
- Об уязвимостях сообщайте конфиденциально, как описано в [SECURITY.md](/.github/SECURITY.md).
- По всем остальным вопросам пишите на [support@oneuptime.com](mailto:support@oneuptime.com).

## Участие в проекте

Мы рады исправлениям ошибок, новым функциям, документации и тестам. В [руководстве по локальной разработке](https://oneuptime.com/docs/ru/installation/local-development) показано, как запустить OneUptime из исходного кода, а [правила участия](/.github/CONTRIBUTING.md) объясняют, как устроены запросы на слияние и лицензирование. С задач с меткой [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) удобно начать.

Если OneUptime вам полезен, поставьте этому репозиторию звезду или [поддержите проект](https://github.com/sponsors/OneUptime).

## Лицензия

OneUptime — открытое ПО под лицензией [Apache License 2.0](/LICENSE), за исключением каталога [`ee/`](/ee). В этом каталоге находится Enterprise Edition, и он распространяется по лицензии [OneUptime Enterprise License](/ee/LICENSE). Образ Community Edition не содержит кода из `ee/`. Это разделение закреплено в файле [`LICENSE`](/LICENSE) в корне репозитория.
