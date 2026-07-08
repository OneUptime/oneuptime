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
    <img alt="OneUptime-logo" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Eén open-source platform voor uptime, incidenten, on-call, statuspagina's, logs, traces, metrics en APM.</h3>

  <p>Monitoring, StatusPage, On-Call, Incidenten, Logs en APM — vervang een hele plank vol SaaS-tools door één platform dat je gratis zelf kunt hosten.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Website</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Documentatie</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Snel aan de slag</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Prijzen</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Bijdragen</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Probeer OneUptime Cloud — voor altijd gratis plan, geen creditcard →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime-dashboard" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Vervang je hele observability-stack

OneUptime brengt monitoring, alerting, incidentrespons en observability samen in één open-source app — zodat je stopt met betalen voor (en aan elkaar knopen van) een dozijn losse tools.

| In plaats van… | Gebruik OneUptime voor… |
|---|---|
| Pingdom / UptimeRobot | **Uptime-monitoring** — website-, API-, ping-, poort-, SSL-, DNS- en synthetische checks van over de hele wereld |
| StatusPage.io | **Statuspagina's** — gebrande openbare en privé-statuspagina's met abonnees |
| PagerDuty / Opsgenie | **On-Call en meldingen** — schema's, escalatiebeleid, SMS / gesprek / push / Slack |
| Incident.io | **Incidentbeheer** — declareren, triagen, communiceren en post-mortems |
| Datadog / New Relic | **APM en metrics** — traces, dashboards en serviceprestaties |
| Loggly | **Logbeheer** — logs verzamelen, doorzoeken en erop alerteren |
| Sentry | **Foutopsporing** — exceptions met volledige stack traces en context |

Alles is **100% open source (Apache 2.0)** en gratis zelf te hosten.

---

<a name="quick-start"></a>

## ⚡ Snel aan de slag

### ☁️ OneUptime Cloud — de makkelijke manier

Geen setup, altijd up-to-date en het financiert het open-source-project.

**→ [Meld je gratis aan op oneuptime.com](https://oneuptime.com)**

### 🐳 Zelf hosten met Docker Compose

Alles wat je nodig hebt op één server (Debian / Ubuntu / RHEL, Docker + Docker Compose). Ideaal voor homelabs en kleine teams — zelfs een Raspberry Pi werkt.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime draait nu op **http://localhost** — open het en maak je eerste account aan.

📖 Volledige handleiding: [Docker Compose-installatie](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Omvang en vereisten](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes met Helm — voor productie

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Volledige installatie-instructies en values op [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Een bestaande installatie upgraden?** Zie de [upgradehandleiding](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Functies

| | Functie | Wat het doet |
|---|---|---|
| 📊 | **Uptime-monitoring** | Website-, API-, IP-, poort-, SSL-, DNS- en synthetische monitors vanuit meerdere wereldwijde regio's. |
| 📋 | **Statuspagina's** | Prachtige gebrande statuspagina's, incidentgeschiedenis, gepland onderhoud en meldingen aan abonnees. |
| 🚨 | **Incidentbeheer** | Volledige incidentworkflow: declareren, toewijzen, communiceren, oplossen en post-mortems uitvoeren. |
| 📞 | **On-Call en meldingen** | On-call-schema's en escalatiebeleid met SMS-, telefoon-, push-, e-mail- en Slack-meldingen. |
| 📝 | **Logbeheer** | Logs binnenhalen, opslaan, doorzoeken en erop alerteren via OpenTelemetry. |
| 🔍 | **APM en traces** | Gedistribueerde traces, spans en prestatiedashboards om trage paden en knelpunten te vinden. |
| 📈 | **Metrics en dashboards** | Aangepaste dashboards over je telemetrie — bouw de weergaven die je team nodig heeft. |
| 🐛 | **Foutopsporing** | Leg exceptions vast met volledige stack traces, context en release-tracking. |
| ⚡ | **Workflows** | Automatiseer en integreer met Slack, Jira, GitHub, Microsoft Teams en meer dan 5.000 apps. |
| 🤖 | **AI-copiloot** | Een altijd actieve agent die anomalieën opspoort in logs, traces en metrics, hoofdoorzaken vindt en PR's opent met oplossingen. |

### 🖥️ Infrastructuurmonitoring

Plaats kant-en-klare, **op OpenTelemetry gebaseerde** agents om alles te bewaken waarop je services draaien — inclusief kant-en-klare alert-templates:

- **Servers en VM's** — CPU, geheugen, schijf, netwerk, processen en logs van Linux, macOS en Windows. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — één `helm install` levert node-/pod-/container-/clustermetrics, events, logs en eBPF-traces en service maps. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — één agent ontdekt automatisch elke container en levert metrics en logs. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — dezelfde automatische ontdekking met één agent via Podmans Docker-compatibele socket. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nodes, VM's, containers, opslag, HA-status, back-updekking en replicatiegezondheid. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — clustergezondheid, capaciteitsprognoses en OSD-/pool-/PG-/monitorinzicht. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Bekijk de screenshots</b></summary>
<br/>

**Uptime-monitoring**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Statuspagina's**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Incidentbeheer**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**On-Call en meldingen**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Logbeheer**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**Application Performance Monitoring**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**Workflows**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Het best voor** | Zelfhosters en kleine teams | Gereguleerde teams die premiumondersteuning nodig hebben |
| **Kosten** | Gratis en open source | [Neem contact op met sales](mailto:sales@oneuptime.com) |
| **Functies** | Volledige functieset | Volledige functieset + geharde images, prioriteitsondersteuning, aangepaste functies en dataresidentie |

---

## 💡 Waarom OneUptime?

Onze missie is eenvoudig: **downtime verminderen en meer producten helpen slagen.** In plaats van zeven leveranciers aan elkaar te plakken, krijg je één platform dat je helpt te begrijpen *waarom* dingen stukgaan, snel op incidenten te reageren en operationeel gedoe te verminderen — volledig open source, zodat jij eigenaar bent van je data en je stack.

---

<a name="contributing"></a>

## 🤝 Bijdragen

We verwelkomen bijdragen van elke omvang. Begin hier:

- 🐛 **[Open issues](https://github.com/OneUptime/oneuptime/issues)** — pak er een op, of [maak een nieuwe aan](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Help mee met het schrijven van tests](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** voor de codebase
- 🧑‍💻 **[Handleiding voor lokale ontwikkeling](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** om aan de slag te gaan
- 📖 Lees de **[richtlijnen voor bijdragen](CONTRIBUTING.md)**
- 💬 Chat met ons in de **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** of **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Steun het project

Als OneUptime nuttig voor je is:

- ⭐ **Geef deze repo een ster** — het helpt anderen echt om ons te vinden
- 💵 **[Word sponsor](https://github.com/sponsors/OneUptime)** — elke euro levert nieuwe functies op
- 🛍️ **[Scoor wat merchandise](https://shop.oneuptime.com)** — alle opbrengsten financieren open-source-ontwikkeling

---

## 📄 Licentie

OneUptime is gelicentieerd onder de [Apache License 2.0](LICENSE).

<div align="center">
  <sub>Gemaakt met ❤️ door het <a href="https://oneuptime.com">OneUptime</a>-team en <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">bijdragers</a>.</sub>
</div>
