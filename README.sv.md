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
    <img alt="OneUptime-logotyp" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>En öppen källkodsplattform för drifttid, incidenter, jour, statussidor, loggar, spårningar, mätvärden och APM.</h3>

  <p>Övervakning, StatusPage, Jour, Incidenter, Loggar och APM — ersätt en hel hylla med SaaS-verktyg med en enda plattform som du kan drifta själv, gratis.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="Licens"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stjärnor"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Webbplats</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Dokumentation</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Snabbstart</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Priser</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Bidra</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Prova OneUptime Cloud — gratis för alltid, inget kreditkort →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime-instrumentpanel" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Ersätt hela din observerbarhetsstack

OneUptime samlar övervakning, aviseringar, incidenthantering och observerbarhet i en enda app med öppen källkod — så att du slutar betala för (och foga ihop) ett dussin separata verktyg.

| Istället för… | Använd OneUptime för… |
|---|---|
| Pingdom / UptimeRobot | **Drifttidsövervakning** — webbplats-, API-, ping-, port-, SSL-, DNS- och syntetiska kontroller från hela världen |
| StatusPage.io | **Statussidor** — profilerade offentliga och privata statussidor med prenumeranter |
| PagerDuty / Opsgenie | **Jour och aviseringar** — scheman, eskaleringspolicyer, SMS / samtal / push / Slack |
| Incident.io | **Incidenthantering** — deklarera, triagera, kommunicera och skriv post mortem |
| Datadog / New Relic | **APM och mätvärden** — spårningar, instrumentpaneler och tjänsteprestanda |
| Loggly | **Logghantering** — samla in, sök i och avisera om loggar |
| Sentry | **Felspårning** — undantag med fullständiga anropsstackar och kontext |

Allt är **100 % öppen källkod (Apache 2.0)** och gratis att drifta själv.

---

<a name="quick-start"></a>

## ⚡ Snabbstart

### ☁️ OneUptime Cloud — det enkla sättet

Ingen installation, alltid uppdaterad, och det finansierar projektet med öppen källkod.

**→ [Registrera dig gratis på oneuptime.com](https://oneuptime.com)**

### 🐳 Drifta själv med Docker Compose

Allt du behöver på en enda server (Debian / Ubuntu / RHEL, Docker + Docker Compose). Perfekt för hemmalabb och små team — till och med en Raspberry Pi fungerar.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime körs nu på **http://localhost** — öppna det och skapa ditt första konto.

📖 Fullständig guide: [Installation med Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionering och krav](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes med Helm — för produktion

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Fullständiga installationsinstruktioner och värden på [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Uppgraderar du en befintlig installation?** Se [uppgraderingsguiden](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Funktioner

| | Funktion | Vad den gör |
|---|---|---|
| 📊 | **Drifttidsövervakning** | Webbplats-, API-, IP-, port-, SSL-, DNS- och syntetiska övervakare från flera globala regioner. |
| 📋 | **Statussidor** | Vackra profilerade statussidor, incidenthistorik, planerat underhåll och prenumerantaviseringar. |
| 🚨 | **Incidenthantering** | Komplett incidentflöde: deklarera, tilldela, kommunicera, lös och kör post mortem. |
| 📞 | **Jour och aviseringar** | Jourscheman och eskaleringspolicyer med aviseringar via SMS, telefonsamtal, push, e-post och Slack. |
| 📝 | **Logghantering** | Ta emot, lagra, sök i och avisera om loggar via OpenTelemetry. |
| 🔍 | **APM och spårningar** | Distribuerade spårningar, spans och prestandapaneler för att hitta långsamma vägar och flaskhalsar. |
| 📈 | **Mätvärden och instrumentpaneler** | Anpassade instrumentpaneler över din telemetri — bygg de vyer ditt team behöver. |
| 🐛 | **Felspårning** | Fånga undantag med fullständiga anropsstackar, kontext och releasespårning. |
| ⚡ | **Arbetsflöden** | Automatisera och integrera med Slack, Jira, GitHub, Microsoft Teams och över 5 000 appar. |
| 🤖 | **AI Copilot** | En ständigt aktiv agent som hittar avvikelser i loggar, spårningar och mätvärden, upptäcker grundorsaker och öppnar PR:er med korrigeringar. |

### 🖥️ Infrastrukturövervakning

Släpp in kopiera-och-klistra-agenter **baserade på OpenTelemetry** för att bevaka allt som dina tjänster körs på — med färdiga aviseringsmallar inkluderade:

- **Servrar och VM:er** — CPU, minne, disk, nätverk, processer och loggar från Linux, macOS och Windows. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — en `helm install` levererar mätvärden för noder/pods/containrar/kluster, händelser, loggar samt eBPF-spårningar och tjänstekartor. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — en enda agent upptäcker automatiskt varje container och levererar mätvärden och loggar. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — samma automatiska upptäckt med en agent via Podmans Docker-kompatibla socket. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — noder, VM:er, containrar, lagring, HA-tillstånd, säkerhetskopieringstäckning och replikeringshälsa. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — klusterhälsa, kapacitetsprognoser och insyn i OSD/pool/PG/monitor. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Se skärmbilderna</b></summary>
<br/>

**Drifttidsövervakning**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Statussidor**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Incidenthantering**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**Jour och aviseringar**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Logghantering**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**Application Performance Monitoring**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**Arbetsflöden**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Passar bäst för** | Självdriftare och små team | Reglerade team som behöver premiumsupport |
| **Kostnad** | Gratis och öppen källkod | [Kontakta försäljning](mailto:sales@oneuptime.com) |
| **Funktioner** | Fullständig funktionsuppsättning | Fullständig funktionsuppsättning + härdade avbildningar, prioriterad support, anpassade funktioner och datahemvist |

---

## 💡 Varför OneUptime?

Vårt uppdrag är enkelt: **minska driftstopp och hjälpa fler produkter att lyckas.** Istället för att tejpa ihop sju leverantörer får du en enda plattform som hjälper dig att förstå *varför* saker går sönder, svara snabbt på incidenter och minska det operativa slitet — helt öppen källkod, så att du äger dina data och din stack.

---

<a name="contributing"></a>

## 🤝 Bidra

Vi välkomnar bidrag av alla storlekar. Börja här:

- 🐛 **[Öppna ärenden](https://github.com/OneUptime/oneuptime/issues)** — ta dig an ett, eller [skapa ett nytt](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Hjälp till att skriva tester](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** för kodbasen
- 🧑‍💻 **[Guide för lokal utveckling](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** för att komma igång
- 📖 Läs **[riktlinjerna för att bidra](CONTRIBUTING.md)**
- 💬 Chatta med oss i **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** eller **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Stöd projektet

Om OneUptime är användbart för dig:

- ⭐ **Stjärnmärk detta repo** — det hjälper verkligen andra att hitta oss
- 💵 **[Sponsra oss](https://github.com/sponsors/OneUptime)** — varje krona levererar nya funktioner
- 🛍️ **[Skaffa lite merch](https://shop.oneuptime.com)** — alla intäkter finansierar utveckling med öppen källkod

---

## 📄 Licens

OneUptime licensieras under [Apache License 2.0](LICENSE).

<div align="center">
  <sub>Skapat med ❤️ av <a href="https://oneuptime.com">OneUptime</a>-teamet och <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">bidragsgivare</a>.</sub>
</div>
