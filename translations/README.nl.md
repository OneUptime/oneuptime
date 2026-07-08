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
    <img alt="OneUptime-logo" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Agentic observability — één open-source platform voor uptime, incidenten, oproepdienst, statuspagina's, logs, traces, metrics en APM.</h3>

  <p><b>Als er iets misgaat, wees de eerste die het weet — en de snelste die het oplost.</b></p>

  <p>OneUptime vervangt een hele plank vol SaaS-tools door één platform dat je gratis zelf kunt hosten. Het vangt de storing op, waarschuwt de juiste persoon, werkt je statuspagina bij, vindt de oorzaak en opent zelfs de oplossings-PR.</p>

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

  <a href="https://oneuptime.com"><b>🚀 Probeer OneUptime Cloud — gratis voor altijd, geen creditcard →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime-commandocentrum tijdens een live incident" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## Vervang je hele observability-stack

OneUptime brengt monitoring, alerting, incidentafhandeling en observability samen in één open-source app — zodat je stopt met betalen voor (en aan elkaar knopen van) een dozijn losse tools.

| In plaats van… | Gebruik OneUptime voor… |
|---|---|
| Pingdom / UptimeRobot | **Uptime-monitoring** — website-, API-, ping-, poort-, SSL-, DNS- en synthetische checks vanuit de hele wereld |
| StatusPage.io | **Statuspagina's** — publieke en private statuspagina's met huisstijl en abonnees |
| PagerDuty / Opsgenie | **Oproepdienst en meldingen** — roosters, escalatiebeleid, sms / oproep / push / Slack |
| Incident.io | **Incidentbeheer** — declareren, triëren, communiceren en post-mortem |
| Datadog / New Relic | **APM en metrics** — traces, dashboards en serviceprestaties |
| Loggly | **Logbeheer** — logs verzamelen, doorzoeken en erop alerten |
| Sentry | **Foutopsporing** — uitzonderingen met volledige stacktraces en context |

Alles is **100% open source (Apache 2.0)** en gratis om zelf te hosten.

---

<details>
<summary><b>🌙 Eén incident, van begin tot eind afgehandeld</b></summary>

<br/>

Het is 02:47 uur. De checkout begint time-outs te geven. Dit is wat OneUptime doet nog voordat de meeste tools de eerste melding zouden versturen — en wat de screenshots hieronder daadwerkelijk laten zien.

### 1 · Detecteren — *binnen seconden op de hoogte*

Probes in meerdere regio's merken dat de checkout-latency je drempel van 5s ver overschrijdt en openen automatisch een incident — nog voordat je klanten op vernieuwen drukken.

![Detecteren — wereldwijde monitoring merkt dat de checkout-API achteruitgaat](/Home/Static/img/readme/detect.png?raw=true)

### 2 · Reageren — *de juiste persoon, gewaarschuwd*

De dienstdoende engineer voor het Payments-beleid wordt gebeld, ge-sms't en per push gewaarschuwd, en escaleert automatisch naar de reserve totdat iemand bevestigt.

![Reageren — het incident wordt naar de oproepdienst geleid en bevestigd](/Home/Static/img/readme/respond.png?raw=true)

### 3 · Communiceren — *klanten op de hoogte*

Je statuspagina werkt zichzelf bij en elke abonnee wordt per e-mail en sms geïnformeerd — niemand hoeft de update met de hand te schrijven.

![Communiceren — de publieke statuspagina werkt bij en informeert abonnees](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · Diagnosticeren — *oorzaak, gevonden*

Traces, logs en metrics worden gecorreleerd tot op de exacte span: een trage `SELECT … FOR UPDATE` op `orders`, vastgelopen op een ontbrekende index.

![Diagnosticeren — de trace-waterval wijst de trage databasespan aan](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · Automatisch oplossen — *de oplossing, voor je opgesteld*

De AI-agent opent een pull request met de oplossing, gekoppeld aan het incident, met groene tests — jij beoordeelt en merget. Als een SRE die nooit slaapt.

![Automatisch oplossen — de AI-agent opent een pull request met de oplossing](/Home/Static/img/readme/autofix.png?raw=true)

</details>

---

<a name="quick-start"></a>

## ⚡ Snel aan de slag

### ☁️ OneUptime Cloud — de makkelijke weg

Geen installatie, altijd up-to-date, en het financiert het open-source project.

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

📖 Volledige installatie-instructies en waarden op [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Een bestaande installatie bijwerken?** Zie de [upgradehandleiding](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Alles in één pakket

| | Functie | Wat het doet |
|---|---|---|
| 📊 | **Uptime-monitoring** | Website-, API-, IP-, poort-, SSL-, DNS- en synthetische monitors vanuit meerdere wereldwijde regio's. |
| 📋 | **Statuspagina's** | Prachtige statuspagina's met huisstijl, incidentgeschiedenis, gepland onderhoud en meldingen aan abonnees. |
| 🚨 | **Incidentbeheer** | Volledige incidentworkflow: declareren, toewijzen, communiceren, oplossen en post-mortems uitvoeren. |
| 📞 | **Oproepdienst en meldingen** | Oproeproosters en escalatiebeleid met sms-, telefoon-, push-, e-mail- en Slack-meldingen. |
| 📝 | **Logbeheer** | Logs opnemen, opslaan, doorzoeken en erop alerten via OpenTelemetry. |
| 🔍 | **APM en traces** | Gedistribueerde traces, spans en prestatiedashboards om trage paden en knelpunten te vinden. |
| 📈 | **Metrics en dashboards** | Aangepaste dashboards over je telemetrie — bouw de weergaven die je team nodig heeft. |
| 🐛 | **Foutopsporing** | Vang uitzonderingen op met volledige stacktraces, context en release-tracking. |
| ⚡ | **Workflows** | Automatiseer en integreer met Slack, Jira, GitHub, Microsoft Teams en meer dan 5.000 apps. |
| 🤖 | **AI-copiloot** | Een altijd actieve agent die anomalieën vindt in logs, traces en metrics, oorzaken opspoort en PR's met oplossingen opent. |

### ⚡ Automatiseer het monnikenwerk

Koppel escalaties, ticketing en meldingen op een visueel, no-code canvas — of voeg eigen code toe. Het incident hierboven waarschuwde de oproepdienst, opende een Jira-ticket en plaatste een bericht in Slack zonder dat iemand een vinger hoefde uit te steken.

![Workflows — een no-code automatiseringscanvas voor incidentescalatie](/Home/Static/img/readme/workflows.png?raw=true)

### 🖥️ Infrastructuurmonitoring

Plaats kant-en-klare **OpenTelemetry-gebaseerde** agents om alles in de gaten te houden waarop je services draaien — met kant-en-klare alertsjablonen inbegrepen:

- **Servers en VMs** — CPU, geheugen, schijf, netwerk, processen en logs van Linux, macOS en Windows. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — één `helm install` levert node-/pod-/container-/clustermetrics, events, logs en eBPF-traces en servicemaps. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — één agent detecteert automatisch elke container en levert metrics en logs. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — dezelfde automatische detectie met één agent via Podmans Docker-compatibele socket. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nodes, VMs, containers, opslag, HA-status, back-updekking en replicatiegezondheid. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — clustergezondheid, capaciteitsvoorspellingen en OSD-/pool-/PG-/monitorzichtbaarheid. [Documentatie →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 Community versus Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Ideaal voor** | Zelf-hosters en kleine teams | Gereguleerde teams die premium ondersteuning nodig hebben |
| **Kosten** | Gratis en open source | [Neem contact op met sales](mailto:sales@oneuptime.com) |
| **Functies** | Volledige functieset | Volledige functieset + geharde images, prioritaire ondersteuning, maatwerkfuncties en dataresidentie |

---

## 💡 Waarom OneUptime?

Onze missie is eenvoudig: **downtime verminderen en meer producten helpen slagen.** In plaats van zeven leveranciers aan elkaar te plakken, krijg je één platform dat je helpt begrijpen *waarom* dingen kapotgaan, snel op incidenten te reageren en operationeel monnikenwerk terug te dringen — volledig open source, zodat je eigenaar bent van je data en je stack.

---

<a name="contributing"></a>

## 🤝 Bijdragen

We verwelkomen bijdragen van elke omvang. Begin hier:

- 🐛 **[Open issues](https://github.com/OneUptime/oneuptime/issues)** — pak er een op, of [maak een nieuwe aan](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Help mee tests schrijven](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** voor de codebase
- 🧑‍💻 **[Handleiding voor lokale ontwikkeling](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** om aan de slag te gaan
- 📖 Lees de **[bijdragerichtlijnen](/CONTRIBUTING.md)**
- 💬 Chat met ons in de **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** of **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Steun het project

Als OneUptime nuttig voor je is:

- ⭐ **Geef deze repo een ster** — het helpt anderen ons echt te vinden
- 💵 **[Word sponsor](https://github.com/sponsors/OneUptime)** — elke euro levert nieuwe functies op
- 🛍️ **[Scoor wat merch](https://shop.oneuptime.com)** — alle opbrengsten financieren open-source ontwikkeling

---

## 📄 Licentie

OneUptime is gelicentieerd onder de [Apache License 2.0](/LICENSE).

<div align="center">
  <sub>Gemaakt met ❤️ door het <a href="https://oneuptime.com">OneUptime</a>-team en <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">bijdragers</a>.</sub>
</div>
