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

  <h3>Én open source-platform til oppetid, hændelser, vagt, statussider, logs, traces, metrics og APM.</h3>

  <p>Overvågning, StatusPage, Vagt, Hændelser, Logs og APM — erstat en hel reol af SaaS-værktøjer med én platform, du kan hoste selv gratis.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Websted</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Dokumentation</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Kom hurtigt i gang</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Priser</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Bidrag</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Prøv OneUptime Cloud — gratis for evigt, intet kreditkort →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime-dashboard" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Erstat hele din observability-stack

OneUptime samler overvågning, alarmering, hændelseshåndtering og observability i én enkelt open source-app — så du holder op med at betale for (og lappe sammen) et dusin separate værktøjer.

| I stedet for… | Brug OneUptime til… |
|---|---|
| Pingdom / UptimeRobot | **Oppetidsovervågning** — website-, API-, ping-, port-, SSL-, DNS- og syntetiske tjek fra hele verden |
| StatusPage.io | **Statussider** — brandede offentlige og private statussider med abonnenter |
| PagerDuty / Opsgenie | **Vagt og alarmer** — vagtplaner, eskaleringspolitikker, SMS / opkald / push / Slack |
| Incident.io | **Hændelseshåndtering** — erklær, triager, kommuniker og lav post-mortem |
| Datadog / New Relic | **APM og metrics** — traces, dashboards og serviceydelse |
| Loggly | **Loghåndtering** — indsaml, søg og alarmér på logs |
| Sentry | **Fejlsporing** — undtagelser med fulde stak-spor og kontekst |

Det hele er **100 % open source (Apache 2.0)** og gratis at hoste selv.

---

<a name="quick-start"></a>

## ⚡ Kom hurtigt i gang

### ☁️ OneUptime Cloud — den nemme vej

Ingen opsætning, altid opdateret, og det finansierer open source-projektet.

**→ [Tilmeld dig gratis på oneuptime.com](https://oneuptime.com)**

### 🐳 Hosting selv med Docker Compose

Alt hvad du har brug for på en enkelt server (Debian / Ubuntu / RHEL, Docker + Docker Compose). Perfekt til homelabs og små teams — selv en Raspberry Pi virker.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime kører nu på **http://localhost** — åbn det og opret din første konto.

📖 Fuld vejledning: [Installation med Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Størrelse og krav](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes med Helm — til produktion

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Fulde installationsinstruktioner og values på [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Opgraderer du en eksisterende installation?** Se [opgraderingsvejledningen](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Funktioner

| | Funktion | Hvad den gør |
|---|---|---|
| 📊 | **Oppetidsovervågning** | Website-, API-, IP-, port-, SSL-, DNS- og syntetiske monitorer fra flere globale regioner. |
| 📋 | **Statussider** | Smukke brandede statussider, hændelseshistorik, planlagt vedligeholdelse og abonnentnotifikationer. |
| 🚨 | **Hændelseshåndtering** | End-to-end-hændelsesforløb: erklær, tildel, kommuniker, løs og kør post-mortems. |
| 📞 | **Vagt og alarmer** | Vagtplaner og eskaleringspolitikker med SMS-, telefonopkald-, push-, e-mail- og Slack-alarmer. |
| 📝 | **Loghåndtering** | Indtag, gem, søg og alarmér på logs via OpenTelemetry. |
| 🔍 | **APM og traces** | Distribuerede traces, spans og ydelsesdashboards til at finde langsomme stier og flaskehalse. |
| 📈 | **Metrics og dashboards** | Brugerdefinerede dashboards over din telemetri — byg de visninger, dit team har brug for. |
| 🐛 | **Fejlsporing** | Fang undtagelser med fulde stak-spor, kontekst og release-sporing. |
| ⚡ | **Workflows** | Automatisér og integrér med Slack, Jira, GitHub, Microsoft Teams og 5.000+ apps. |
| 🤖 | **AI Copilot** | En altid tændt agent, der finder anomalier på tværs af logs, traces og metrics, opdager grundårsager og åbner PR'er med rettelser. |

### 🖥️ Infrastrukturovervågning

Sæt copy-paste, **OpenTelemetry-baserede** agenter ind for at holde øje med alt, dine services kører på — med færdiglavede alarmskabeloner inkluderet:

- **Servere og VM'er** — CPU, hukommelse, disk, netværk, processer og logs fra Linux, macOS og Windows. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — én `helm install` leverer node-/pod-/container-/klyngemetrics, events, logs samt eBPF-traces og service maps. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — en enkelt agent finder automatisk hver container og leverer metrics og logs. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — samme automatiske opdagelse med én agent via Podmans Docker-kompatible socket. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — noder, VM'er, containere, lagring, HA-tilstand, backup-dækning og replikeringssundhed. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — klyngesundhed, kapacitetsprognoser og OSD-/pool-/PG-/monitor-indblik. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Se skærmbillederne</b></summary>
<br/>

**Oppetidsovervågning**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Statussider**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Hændelseshåndtering**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**Vagt og alarmer**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Loghåndtering**
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
| **Bedst til** | Selvhostere og små teams | Regulerede teams med behov for premium-support |
| **Pris** | Gratis og open source | [Kontakt salg](mailto:sales@oneuptime.com) |
| **Funktioner** | Fuldt funktionssæt | Fuldt funktionssæt + hærdede images, prioriteret support, brugerdefinerede funktioner og dataophold |

---

## 💡 Hvorfor OneUptime?

Vores mission er enkel: **reducer nedetid og hjælp flere produkter med at få succes.** I stedet for at tape syv leverandører sammen får du én platform, der hjælper dig med at forstå *hvorfor* tingene går i stykker, reagere hurtigt på hændelser og skære det operationelle slid ned — fuldt open source, så du ejer dine data og din stack.

---

<a name="contributing"></a>

## 🤝 Bidrag

Vi byder bidrag af enhver størrelse velkommen. Start her:

- 🐛 **[Åbne issues](https://github.com/OneUptime/oneuptime/issues)** — tag fat i en, eller [opret en ny](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Hjælp med at skrive tests](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** til kodebasen
- 🧑‍💻 **[Vejledning til lokal udvikling](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** for at komme i gang
- 📖 Læs **[retningslinjerne for bidrag](CONTRIBUTING.md)**
- 💬 Chat med os i **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** eller **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Støt projektet

Hvis OneUptime er nyttigt for dig:

- ⭐ **Giv dette repo en stjerne** — det hjælper virkelig andre med at finde os
- 💵 **[Bliv sponsor](https://github.com/sponsors/OneUptime)** — hver krone leverer nye funktioner
- 🛍️ **[Køb noget merch](https://shop.oneuptime.com)** — alt overskud finansierer open source-udvikling

---

## 📄 Licens

OneUptime er licenseret under [Apache License 2.0](LICENSE).

<div align="center">
  <sub>Lavet med ❤️ af <a href="https://oneuptime.com">OneUptime</a>-teamet og <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">bidragydere</a>.</sub>
</div>
