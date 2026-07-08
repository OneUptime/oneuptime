<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/translations/README.zh-CN.md">简体中文</a> ·
  <a href="/translations/README.zh-TW.md">繁體中文</a> ·
  <a href="/translations/README.ja.md">日本語</a> ·
  <a href="/translations/README.ko.md">한국어</a> ·
  <a href="/translations/README.es.md">Español</a> ·
  <a href="/translations/README.fr.md">Français</a> ·
  <a href="/translations/README.de.md">Deutsch</a> ·
  <a href="/translations/README.pt.md">Português</a> ·
  <a href="/translations/README.it.md">Italiano</a> ·
  <a href="/translations/README.ru.md">Русский</a> ·
  <a href="/translations/README.hi.md">हिन्दी</a> ·
  <a href="/translations/README.nl.md">Nederlands</a> ·
  <a href="/translations/README.da.md">Dansk</a> ·
  <a href="/translations/README.sv.md">Svenska</a> ·
  <a href="/translations/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="Логотип OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Агентная наблюдаемость — единая платформа с открытым исходным кодом для контроля доступности, инцидентов, дежурств, страниц статуса, логов, трассировок, метрик и APM.</h3>

  <p><b>Когда что-то ломается — узнавайте об этом первыми и устраняйте быстрее всех.</b></p>

  <p>OneUptime заменяет целую полку SaaS-инструментов одной платформой, которую можно развернуть у себя бесплатно. Она обнаруживает сбой, вызывает нужного человека, обновляет вашу страницу статуса, находит первопричину и даже открывает PR с исправлением.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Сайт</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Документация</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Быстрый старт</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Цены</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Внести вклад</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Попробуйте OneUptime Cloud — навсегда бесплатный тариф, без банковской карты →</b></a>
</div>

<br/>

<div align="center">
  <img alt="Командный центр OneUptime во время реального инцидента" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## Замените весь ваш стек наблюдаемости

OneUptime объединяет мониторинг, оповещения, реагирование на инциденты и наблюдаемость в одном приложении с открытым исходным кодом — так что вы перестаёте платить за десяток отдельных инструментов (и сшивать их воедино).

| Вместо… | Используйте OneUptime для… |
|---|---|
| Pingdom / UptimeRobot | **Мониторинг доступности** — проверки сайтов, API, ping, портов, SSL, DNS и синтетические проверки из разных точек мира |
| StatusPage.io | **Страницы статуса** — брендированные публичные и частные страницы статуса с подписчиками |
| PagerDuty / Opsgenie | **Дежурства и оповещения** — расписания, политики эскалации, SMS / звонки / push / Slack |
| Incident.io | **Управление инцидентами** — объявление, сортировка, коммуникация и разбор постфактум |
| Datadog / New Relic | **APM и метрики** — трассировки, дашборды и производительность сервисов |
| Loggly | **Управление логами** — сбор, поиск и оповещения по логам |
| Sentry | **Отслеживание ошибок** — исключения с полными стеками вызовов и контекстом |

Всё это **на 100% открытый исходный код (Apache 2.0)** и бесплатно для самостоятельного развёртывания.

---

<details>
<summary><b>🌙 Один инцидент, обработанный от начала до конца</b></summary>

<br/>

Сейчас 2:47 ночи. Оформление заказа начинает отваливаться по таймауту. Вот что делает OneUptime ещё до того, как большинство инструментов вообще подадут первый сигнал — и что на самом деле показано на скриншотах ниже.

### 1 · Обнаружение — *узнайте за секунды*

Пробы в нескольких регионах ловят, как задержка оформления заказа перескакивает ваш порог в 5 секунд, и автоматически открывают инцидент — ещё до того, как ваши клиенты нажмут «обновить».

![Обнаружение — глобальный мониторинг ловит деградацию API оформления заказа](/Home/Static/img/readme/detect.png?raw=true)

### 2 · Реагирование — *нужный человек вызван*

Дежурному инженеру по политике Payments звонят, пишут SMS и отправляют push-уведомление, автоматически эскалируя на резерв, пока кто-нибудь не подтвердит.

![Реагирование — инцидент направлен дежурному и подтверждён](/Home/Static/img/readme/respond.png?raw=true)

### 3 · Коммуникация — *клиенты в курсе*

Ваша страница статуса обновляется сама, и каждый подписчик получает уведомление по электронной почте и SMS — никому не нужно вручную писать обновление.

![Коммуникация — публичная страница статуса обновляется и уведомляет подписчиков](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · Диагностика — *первопричина найдена*

Трассировки, логи и метрики сопоставляются вплоть до конкретного спана: медленный `SELECT … FOR UPDATE` по `orders`, застрявший на отсутствующем индексе.

![Диагностика — водопад трассировки точно указывает на медленный спан базы данных](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · Автоисправление — *исправление подготовлено за вас*

ИИ-агент открывает pull request с исправлением, связанный с инцидентом, с зелёными тестами — вам остаётся проверить и смержить. Как SRE, который никогда не спит.

![Автоисправление — ИИ-агент открывает pull request с исправлением](/Home/Static/img/readme/autofix.png?raw=true)

</details>

---

<a name="quick-start"></a>

## ⚡ Быстрый старт

### ☁️ OneUptime Cloud — простой путь

Никакой настройки, всегда актуальная версия, и это финансирует проект с открытым исходным кодом.

**→ [Зарегистрируйтесь бесплатно на oneuptime.com](https://oneuptime.com)**

### 🐳 Самостоятельное развёртывание с Docker Compose

Всё необходимое на одном сервере (Debian / Ubuntu / RHEL, Docker + Docker Compose). Отлично подходит для домашних лабораторий и небольших команд — сгодится даже Raspberry Pi.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime теперь работает по адресу **http://localhost** — откройте его и создайте свою первую учётную запись.

📖 Полное руководство: [Установка через Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Размеры и требования](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes с Helm — для продакшена

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Полные инструкции по установке и параметры на [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Обновляете существующую установку?** См. [руководство по обновлению](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Всё в комплекте

| | Функция | Что она делает |
|---|---|---|
| 📊 | **Мониторинг доступности** | Мониторы сайтов, API, IP, портов, SSL, DNS и синтетические мониторы из нескольких глобальных регионов. |
| 📋 | **Страницы статуса** | Красивые брендированные страницы статуса, история инцидентов, плановое обслуживание и уведомления подписчиков. |
| 🚨 | **Управление инцидентами** | Сквозной процесс работы с инцидентами: объявление, назначение, коммуникация, устранение и разбор постфактум. |
| 📞 | **Дежурства и оповещения** | Расписания дежурств и политики эскалации с оповещениями по SMS, телефонному звонку, push, электронной почте и Slack. |
| 📝 | **Управление логами** | Приём, хранение, поиск и оповещения по логам через OpenTelemetry. |
| 🔍 | **APM и трассировки** | Распределённые трассировки, спаны и дашборды производительности для поиска медленных участков и узких мест. |
| 📈 | **Метрики и дашборды** | Настраиваемые дашборды по вашей телеметрии — стройте те представления, которые нужны вашей команде. |
| 🐛 | **Отслеживание ошибок** | Захват исключений с полными стеками вызовов, контекстом и отслеживанием релизов. |
| ⚡ | **Рабочие процессы** | Автоматизация и интеграция со Slack, Jira, GitHub, Microsoft Teams и более чем 5000 приложений. |
| 🤖 | **ИИ-помощник** | Всегда активный агент, который находит аномалии в логах, трассировках и метриках, выявляет первопричины и открывает PR с исправлениями. |

<details>
<summary><b>⚡ Автоматизируйте рутину</b></summary>

<br/>

Настройте эскалации, тикеты и уведомления на визуальном no-code-полотне — или добавьте собственный код. Инцидент, описанный выше, вызвал дежурного, открыл тикет в Jira и отправил сообщение в Slack, и никому не пришлось и пальцем шевельнуть.

![Рабочие процессы — no-code-полотно автоматизации для эскалации инцидентов](/Home/Static/img/readme/workflows.png?raw=true)

</details>

### 🖥️ Мониторинг инфраструктуры

Разверните готовые к копированию агенты **на базе OpenTelemetry**, чтобы следить за всем, на чём работают ваши сервисы — с встроенными шаблонами оповещений:

- **Серверы и VM** — CPU, память, диск, сеть, процессы и логи с Linux, macOS и Windows. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — один `helm install` доставляет метрики узлов/подов/контейнеров/кластера, события, логи, а также eBPF-трассировки и карты сервисов. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — единый агент автоматически обнаруживает каждый контейнер и доставляет метрики и логи. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — то же автообнаружение одним агентом через Docker-совместимый сокет Podman. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — узлы, VM, контейнеры, хранилище, состояние HA, покрытие резервным копированием и здоровье репликации. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — здоровье кластера, прогнозы по ёмкости и видимость OSD/пулов/PG/мониторов. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 Community или Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Лучше всего для** | Тех, кто разворачивает у себя, и небольших команд | Регулируемых команд, которым нужна премиум-поддержка |
| **Стоимость** | Бесплатно и с открытым исходным кодом | [Связаться с отделом продаж](mailto:sales@oneuptime.com) |
| **Возможности** | Полный набор возможностей | Полный набор возможностей + защищённые образы, приоритетная поддержка, индивидуальные функции и резидентность данных |

---

## 💡 Почему OneUptime?

Наша миссия проста: **сократить простои и помочь большему числу продуктов добиться успеха.** Вместо того чтобы скотчем скреплять семь вендоров, вы получаете одну платформу, которая помогает понять, *почему* всё ломается, быстро реагировать на инциденты и снижать операционную рутину — полностью открытый исходный код, так что вы владеете своими данными и своим стеком.

---

<a name="contributing"></a>

## 🤝 Участие в проекте

Мы приветствуем вклад любого размера. Начните отсюда:

- 🐛 **[Открытые задачи](https://github.com/OneUptime/oneuptime/issues)** — возьмите одну в работу или [заведите новую](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Помогите писать тесты](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** для кодовой базы
- 🧑‍💻 **[Руководство по локальной разработке](/App/FeatureSet/Docs/Content/en/installation/local-development.md)**, чтобы настроить окружение
- 📖 Прочитайте **[рекомендации по участию](/CONTRIBUTING.md)**
- 💬 Общайтесь с нами в **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** или **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Поддержите проект

Если OneUptime полезен вам:

- ⭐ **Поставьте звезду этому репозиторию** — это действительно помогает другим найти нас
- 💵 **[Станьте спонсором](https://github.com/sponsors/OneUptime)** — каждый доллар приближает выход новых функций
- 🛍️ **[Возьмите немного мерча](https://shop.oneuptime.com)** — вся выручка идёт на разработку с открытым исходным кодом

---

## 📄 Лицензия

OneUptime распространяется по лицензии [Apache License 2.0](/LICENSE).

<div align="center">
  <sub>Сделано с ❤️ командой <a href="https://oneuptime.com">OneUptime</a> и <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">участниками</a>.</sub>
</div>
