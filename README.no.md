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

  <h3>Én åpen kildekode-plattform for oppetid, hendelser, vaktordning, statussider, logger, sporinger, metrikker og APM.</h3>

  <p>Overvåking, StatusPage, vaktordning, hendelser, logger og APM — erstatt en hel hylle med SaaS-verktøy med én plattform du kan drifte selv gratis.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Nettsted</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Dokumentasjon</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Kom i gang</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Priser</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Bidra</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Prøv OneUptime Cloud — gratis for alltid, uten kredittkort →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime-dashbord" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Erstatt hele observabilitetsstakken din

OneUptime samler overvåking, varsling, hendelseshåndtering og observabilitet i én åpen kildekode-app — slik at du slutter å betale for (og sy sammen) et dusin separate verktøy.

| I stedet for … | Bruk OneUptime til … |
|---|---|
| Pingdom / UptimeRobot | **Oppetidsovervåking** — sjekker av nettsted, API, ping, port, SSL, DNS og syntetiske sjekker fra hele verden |
| StatusPage.io | **Statussider** — merkevarebygde offentlige og private statussider med abonnenter |
| PagerDuty / Opsgenie | **Vaktordning og varsler** — vaktplaner, eskaleringspolicyer, SMS / anrop / push / Slack |
| Incident.io | **Hendelseshåndtering** — erklær, triager, kommuniser og gjennomfør etteranalyse |
| Datadog / New Relic | **APM og metrikker** — sporinger, dashbord og tjenesteytelse |
| Loggly | **Logghåndtering** — samle inn, søk og varsle på logger |
| Sentry | **Feilsporing** — unntak med fullstendige stakksporinger og kontekst |

Alt sammen er **100 % åpen kildekode (Apache 2.0)** og gratis å drifte selv.

---

<a name="quick-start"></a>

## ⚡ Kom i gang

### ☁️ OneUptime Cloud — den enkle måten

Ingen oppsett, alltid oppdatert, og det finansierer prosjektet med åpen kildekode.

**→ [Registrer deg gratis på oneuptime.com](https://oneuptime.com)**

### 🐳 Drift selv med Docker Compose

Alt du trenger på én enkelt server (Debian / Ubuntu / RHEL, Docker + Docker Compose). Perfekt for hjemmelaboratorier og små team — en Raspberry Pi fungerer til og med.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime kjører nå på **http://localhost** — åpne det og opprett din første konto.

📖 Fullstendig veiledning: [Installasjon med Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensjonering og krav](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes med Helm — for produksjon

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Fullstendige installasjonsinstruksjoner og verdier på [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Oppgraderer du en eksisterende installasjon?** Se [oppgraderingsveiledningen](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Funksjoner

| | Funksjon | Hva den gjør |
|---|---|---|
| 📊 | **Oppetidsovervåking** | Overvåkere for nettsted, API, IP, port, SSL, DNS og syntetiske sjekker fra flere globale regioner. |
| 📋 | **Statussider** | Vakre merkevarebygde statussider, hendelseshistorikk, planlagt vedlikehold og abonnentvarsler. |
| 🚨 | **Hendelseshåndtering** | Ende-til-ende hendelsesflyt: erklær, tildel, kommuniser, løs og gjennomfør etteranalyser. |
| 📞 | **Vaktordning og varsler** | Vaktplaner og eskaleringspolicyer med varsler via SMS, telefonanrop, push, e-post og Slack. |
| 📝 | **Logghåndtering** | Ta inn, lagre, søk og varsle på logger via OpenTelemetry. |
| 🔍 | **APM og sporinger** | Distribuerte sporinger, spans og ytelsesdashbord for å finne trege stier og flaskehalser. |
| 📈 | **Metrikker og dashbord** | Egendefinerte dashbord over telemetrien din — bygg visningene teamet ditt trenger. |
| 🐛 | **Feilsporing** | Fang opp unntak med fullstendige stakksporinger, kontekst og utgivelsessporing. |
| ⚡ | **Arbeidsflyter** | Automatiser og integrer med Slack, Jira, GitHub, Microsoft Teams og 5 000+ apper. |
| 🤖 | **AI-Copilot** | En alltid tilgjengelig agent som finner avvik på tvers av logger, sporinger og metrikker, avdekker grunnårsaker og åpner PR-er med rettelser. |

### 🖥️ Infrastrukturovervåking

Sett inn kopier-og-lim-inn-agenter, **basert på OpenTelemetry**, for å følge med på alt tjenestene dine kjører på — med ferdiglagde varselmaler inkludert:

- **Servere og VM-er** — CPU, minne, disk, nettverk, prosesser og logger fra Linux, macOS og Windows. [Dokumentasjon →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — én `helm install` leverer node-/pod-/container-/klyngemetrikker, hendelser, logger og eBPF-sporinger og tjenestekart. [Dokumentasjon →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — én enkelt agent oppdager automatisk hver container og leverer metrikker og logger. [Dokumentasjon →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — samme automatiske oppdagelse med én agent via Podmans Docker-kompatible socket. [Dokumentasjon →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — noder, VM-er, containere, lagring, HA-tilstand, sikkerhetskopidekning og replikeringshelse. [Dokumentasjon →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — klyngehelse, kapasitetsprognoser og innsyn i OSD/pool/PG/monitor. [Dokumentasjon →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Se skjermbildene</b></summary>
<br/>

**Oppetidsovervåking**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Statussider**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Hendelseshåndtering**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**Vaktordning og varsler**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Logghåndtering**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**Overvåking av applikasjonsytelse**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**Arbeidsflyter**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Best egnet for** | Selvdriftere og små team | Regulerte team som trenger førsteklasses støtte |
| **Kostnad** | Gratis og åpen kildekode | [Kontakt salg](mailto:sales@oneuptime.com) |
| **Funksjoner** | Fullt funksjonssett | Fullt funksjonssett + herdede images, prioritert støtte, egendefinerte funksjoner og datalagring i valgt region |

---

## 💡 Hvorfor OneUptime?

Oppdraget vårt er enkelt: **redusere nedetid og hjelpe flere produkter å lykkes.** I stedet for å teipe sammen sju leverandører, får du én plattform som hjelper deg å forstå *hvorfor* ting går galt, respondere raskt på hendelser og kutte operasjonelt slit — helt åpen kildekode, slik at du eier dataene og stakken din.

---

<a name="contributing"></a>

## 🤝 Bidra

Vi ønsker bidrag av alle størrelser velkommen. Start her:

- 🐛 **[Åpne issues](https://github.com/OneUptime/oneuptime/issues)** — plukk opp en, eller [opprett en ny](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Hjelp til med å skrive tester](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** for kodebasen
- 🧑‍💻 **[Veiledning for lokal utvikling](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** for å komme i gang
- 📖 Les **[retningslinjene for bidrag](CONTRIBUTING.md)**
- 💬 Prat med oss i **[utvikler-Slacken](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** eller **[fellesskaps-Slacken](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Støtt prosjektet

Hvis OneUptime er nyttig for deg:

- ⭐ **Gi denne repoen en stjerne** — det hjelper virkelig andre å finne oss
- 💵 **[Bli sponsor](https://github.com/sponsors/OneUptime)** — hver krone leverer nye funksjoner
- 🛍️ **[Skaff deg litt merch](https://shop.oneuptime.com)** — alt overskudd finansierer utvikling med åpen kildekode

---

## 📄 Lisens

OneUptime er lisensiert under [Apache License 2.0](LICENSE).

<div align="center">
  <sub>Laget med ❤️ av <a href="https://oneuptime.com">OneUptime</a>-teamet og <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">bidragsytere</a>.</sub>
</div>
