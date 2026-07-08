<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/README.zh-CN.md">简体中文</a> ·
  <a href="/README.zh-TW.md">繁體中文</a> ·
  <a href="/README.ja.md">日本語</a> ·
  <a href="/README.ko.md">한국어</a> ·
  <a href="/README.es.md">Español</a> ·
  <a href="/README.fr.md">Français</a> ·
  <a href="/README.de.md">Deutsch</a> ·
  <a href="/README.pt.md">Português</a> ·
  <a href="/README.it.md">Italiano</a> ·
  <a href="/README.ru.md">Русский</a> ·
  <a href="/README.hi.md">हिन्दी</a> ·
  <a href="/README.nl.md">Nederlands</a> ·
  <a href="/README.da.md">Dansk</a> ·
  <a href="/README.sv.md">Svenska</a> ·
  <a href="/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="Логотип OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Единая платформа с открытым исходным кодом для мониторинга доступности, инцидентов, дежурств, страниц состояния, логов, трейсов, метрик и APM.</h3>

  <p>Мониторинг, StatusPage, дежурства, инциденты, логи и APM — замените целую полку SaaS-инструментов одной платформой, которую можно развернуть у себя бесплатно.</p>

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

  <a href="https://oneuptime.com"><b>🚀 Попробуйте OneUptime Cloud — бесплатный тариф навсегда, без банковской карты →</b></a>
</div>

<br/>

<div align="center">
  <img alt="Панель управления OneUptime" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Замените весь ваш стек наблюдаемости

OneUptime объединяет мониторинг, оповещения, реагирование на инциденты и наблюдаемость в едином приложении с открытым исходным кодом — так что вы перестаёте платить за десяток отдельных инструментов (и сшивать их вместе).

| Вместо… | Используйте OneUptime для… |
|---|---|
| Pingdom / UptimeRobot | **Мониторинг доступности** — проверки сайтов, API, ping, портов, SSL, DNS и синтетические проверки со всего мира |
| StatusPage.io | **Страницы состояния** — брендированные публичные и приватные страницы состояния с подписчиками |
| PagerDuty / Opsgenie | **Дежурства и оповещения** — расписания, политики эскалации, SMS / звонки / push / Slack |
| Incident.io | **Управление инцидентами** — объявление, сортировка, коммуникация и постмортемы |
| Datadog / New Relic | **APM и метрики** — трейсы, дашборды и производительность сервисов |
| Loggly | **Управление логами** — сбор, поиск и оповещения по логам |
| Sentry | **Отслеживание ошибок** — исключения с полными стек-трейсами и контекстом |

Всё это **на 100% открытый исходный код (Apache 2.0)** и бесплатно для самостоятельного развёртывания.

---

<a name="quick-start"></a>

## ⚡ Быстрый старт

### ☁️ OneUptime Cloud — простой путь

Никакой настройки, всегда актуальная версия, и это финансирует проект с открытым исходным кодом.

**→ [Зарегистрируйтесь бесплатно на oneuptime.com](https://oneuptime.com)**

### 🐳 Самостоятельное размещение с Docker Compose

Всё необходимое на одном сервере (Debian / Ubuntu / RHEL, Docker + Docker Compose). Отлично подходит для домашних лабораторий и небольших команд — подойдёт даже Raspberry Pi.

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

📖 Полное руководство: [Установка Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Требования и размеры](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes с Helm — для продакшена

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Полные инструкции по установке и значения на [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Обновляете существующую установку?** См. [руководство по обновлению](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Возможности

| | Возможность | Что она делает |
|---|---|---|
| 📊 | **Мониторинг доступности** | Мониторы сайтов, API, IP, портов, SSL, DNS и синтетические мониторы из множества регионов по всему миру. |
| 📋 | **Страницы состояния** | Красивые брендированные страницы состояния, история инцидентов, запланированное обслуживание и уведомления подписчиков. |
| 🚨 | **Управление инцидентами** | Сквозной процесс работы с инцидентами: объявление, назначение, коммуникация, разрешение и постмортемы. |
| 📞 | **Дежурства и оповещения** | Расписания дежурств и политики эскалации с оповещениями по SMS, телефонным звонком, push, email и Slack. |
| 📝 | **Управление логами** | Приём, хранение, поиск и оповещения по логам через OpenTelemetry. |
| 🔍 | **APM и трейсы** | Распределённые трейсы, спаны и дашборды производительности для поиска медленных участков и узких мест. |
| 📈 | **Метрики и дашборды** | Настраиваемые дашборды поверх вашей телеметрии — создавайте представления, нужные вашей команде. |
| 🐛 | **Отслеживание ошибок** | Захват исключений с полными стек-трейсами, контекстом и отслеживанием релизов. |
| ⚡ | **Рабочие процессы** | Автоматизация и интеграция со Slack, Jira, GitHub, Microsoft Teams и более чем 5000 приложений. |
| 🤖 | **AI-помощник** | Всегда активный агент, который находит аномалии в логах, трейсах и метриках, выявляет первопричины и открывает PR с исправлениями. |

### 🖥️ Мониторинг инфраструктуры

Подключите готовые к копированию агенты **на основе OpenTelemetry**, чтобы отслеживать всё, на чём работают ваши сервисы — с готовыми шаблонами оповещений в комплекте:

- **Серверы и VM** — CPU, память, диск, сеть, процессы и логи из Linux, macOS и Windows. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — одна команда `helm install` доставляет метрики узлов/подов/контейнеров/кластера, события, логи, а также eBPF-трейсы и карты сервисов. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — единый агент автоматически обнаруживает каждый контейнер и доставляет метрики и логи. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — то же автоматическое обнаружение одним агентом через Docker-совместимый сокет Podman. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — узлы, VM, контейнеры, хранилище, состояние HA, покрытие резервным копированием и состояние репликации. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — состояние кластера, прогнозы ёмкости и видимость OSD/пулов/PG/мониторов. [Документация →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Посмотреть скриншоты</b></summary>
<br/>

**Мониторинг доступности**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Страницы состояния**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Управление инцидентами**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**Дежурства и оповещения**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Управление логами**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**Мониторинг производительности приложений**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**Рабочие процессы**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 Community против Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Лучше всего для** | Самостоятельного размещения и небольших команд | Регулируемых команд, которым нужна премиум-поддержка |
| **Стоимость** | Бесплатно и с открытым исходным кодом | [Связаться с отделом продаж](mailto:sales@oneuptime.com) |
| **Возможности** | Полный набор функций | Полный набор функций + защищённые образы, приоритетная поддержка, индивидуальные функции и резидентность данных |

---

## 💡 Почему OneUptime?

Наша миссия проста: **сократить простои и помочь большему числу продуктов преуспеть.** Вместо того чтобы на скотче соединять семь поставщиков, вы получаете единую платформу, которая помогает понять, *почему* что-то ломается, быстро реагировать на инциденты и сократить операционную рутину — полностью открытый исходный код, поэтому вы владеете своими данными и своим стеком.

---

<a name="contributing"></a>

## 🤝 Участие в проекте

Мы приветствуем вклад любого размера. Начните здесь:

- 🐛 **[Открытые задачи](https://github.com/OneUptime/oneuptime/issues)** — возьмите одну в работу или [создайте новую](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Помогите писать тесты](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** для кодовой базы
- 🧑‍💻 **[Руководство по локальной разработке](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** для настройки
- 📖 Прочитайте **[рекомендации по участию](CONTRIBUTING.md)**
- 💬 Общайтесь с нами в **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** или **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Поддержите проект

Если OneUptime вам полезен:

- ⭐ **Поставьте звезду этому репозиторию** — это действительно помогает другим найти нас
- 💵 **[Станьте спонсором](https://github.com/sponsors/OneUptime)** — каждый доллар помогает выпускать новые функции
- 🛍️ **[Приобретите мерч](https://shop.oneuptime.com)** — вся выручка идёт на разработку с открытым исходным кодом

---

## 📄 Лицензия

OneUptime распространяется под лицензией [Apache License 2.0](LICENSE).

<div align="center">
  <sub>Сделано с ❤️ командой <a href="https://oneuptime.com">OneUptime</a> и <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">участниками</a>.</sub>
</div>
