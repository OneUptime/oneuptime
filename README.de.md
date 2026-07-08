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
    <img alt="OneUptime-Logo" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Eine Open-Source-Plattform für Verfügbarkeit, Vorfälle, Rufbereitschaft, Statusseiten, Logs, Traces, Metriken und APM.</h3>

  <p>Monitoring, StatusPage, Rufbereitschaft, Vorfälle, Logs und APM — ersetzen Sie ein ganzes Regal voller SaaS-Tools durch eine Plattform, die Sie kostenlos selbst hosten können.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Website</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Dokumentation</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Schnellstart</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Preise</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Mitwirken</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 OneUptime Cloud ausprobieren — für immer kostenloser Tarif, keine Kreditkarte →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime-Dashboard" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Ersetzen Sie Ihren gesamten Observability-Stack

OneUptime vereint Monitoring, Alarmierung, Vorfallreaktion und Observability in einer einzigen Open-Source-App — damit Sie nicht länger für ein Dutzend separater Tools bezahlen (und diese zusammenflicken) müssen.

| Statt… | Nutzen Sie OneUptime für… |
|---|---|
| Pingdom / UptimeRobot | **Verfügbarkeits-Monitoring** — Website-, API-, Ping-, Port-, SSL-, DNS- und synthetische Prüfungen aus der ganzen Welt |
| StatusPage.io | **Statusseiten** — gebrandete öffentliche und private Statusseiten mit Abonnenten |
| PagerDuty / Opsgenie | **Rufbereitschaft und Alarme** — Dienstpläne, Eskalationsrichtlinien, SMS / Anruf / Push / Slack |
| Incident.io | **Vorfallmanagement** — melden, priorisieren, kommunizieren und Post-Mortem |
| Datadog / New Relic | **APM und Metriken** — Traces, Dashboards und Service-Performance |
| Loggly | **Log-Management** — Logs sammeln, durchsuchen und alarmieren |
| Sentry | **Fehlerverfolgung** — Ausnahmen mit vollständigen Stack-Traces und Kontext |

Alles davon ist **100 % Open Source (Apache 2.0)** und kostenlos selbst zu hosten.

---

<a name="quick-start"></a>

## ⚡ Schnellstart

### ☁️ OneUptime Cloud — der einfache Weg

Keine Einrichtung, immer auf dem neuesten Stand, und es finanziert das Open-Source-Projekt.

**→ [Kostenlos anmelden auf oneuptime.com](https://oneuptime.com)**

### 🐳 Selbst hosten mit Docker Compose

Alles, was Sie brauchen, auf einem einzigen Server (Debian / Ubuntu / RHEL, Docker + Docker Compose). Ideal für Homelabs und kleine Teams — sogar ein Raspberry Pi funktioniert.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime läuft nun unter **http://localhost** — öffnen Sie es und erstellen Sie Ihr erstes Konto.

📖 Vollständige Anleitung: [Docker-Compose-Installation](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionierung und Anforderungen](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes mit Helm — für die Produktion

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Vollständige Installationsanweisungen und Werte auf [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Aktualisieren Sie eine bestehende Installation?** Siehe die [Upgrade-Anleitung](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Funktionen

| | Funktion | Was es macht |
|---|---|---|
| 📊 | **Verfügbarkeits-Monitoring** | Website-, API-, IP-, Port-, SSL-, DNS- und synthetische Monitore aus mehreren globalen Regionen. |
| 📋 | **Statusseiten** | Schöne, gebrandete Statusseiten, Vorfallverlauf, geplante Wartung und Abonnentenbenachrichtigungen. |
| 🚨 | **Vorfallmanagement** | Durchgängiger Vorfall-Workflow: melden, zuweisen, kommunizieren, lösen und Post-Mortems durchführen. |
| 📞 | **Rufbereitschaft und Alarme** | Rufbereitschaftspläne und Eskalationsrichtlinien mit SMS-, Telefonanruf-, Push-, E-Mail- und Slack-Alarmen. |
| 📝 | **Log-Management** | Logs über OpenTelemetry aufnehmen, speichern, durchsuchen und alarmieren. |
| 🔍 | **APM und Traces** | Verteilte Traces, Spans und Performance-Dashboards, um langsame Pfade und Engpässe zu finden. |
| 📈 | **Metriken und Dashboards** | Individuelle Dashboards über Ihre Telemetrie — bauen Sie die Ansichten, die Ihr Team braucht. |
| 🐛 | **Fehlerverfolgung** | Erfassen Sie Ausnahmen mit vollständigen Stack-Traces, Kontext und Release-Tracking. |
| ⚡ | **Workflows** | Automatisieren und integrieren Sie mit Slack, Jira, GitHub, Microsoft Teams und über 5.000 Apps. |
| 🤖 | **KI-Copilot** | Ein stets aktiver Agent, der Anomalien über Logs, Traces und Metriken hinweg findet, Ursachen erkennt und PRs mit Korrekturen öffnet. |

### 🖥️ Infrastruktur-Monitoring

Setzen Sie per Copy-and-Paste **OpenTelemetry-basierte** Agenten ein, um alles zu überwachen, worauf Ihre Dienste laufen — mit fertigen Alarmvorlagen inklusive:

- **Server und VMs** — CPU, Arbeitsspeicher, Festplatte, Netzwerk, Prozesse und Logs von Linux, macOS und Windows. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — ein `helm install` liefert Node-/Pod-/Container-/Cluster-Metriken, Events, Logs sowie eBPF-Traces und Service-Maps. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — ein einzelner Agent erkennt automatisch jeden Container und liefert Metriken und Logs. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — dieselbe Ein-Agent-Auto-Erkennung über Podmans Docker-kompatiblen Socket. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — Nodes, VMs, Container, Storage, HA-Status, Backup-Abdeckung und Replikationszustand. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — Cluster-Zustand, Kapazitätsprognosen und Sichtbarkeit von OSD/Pool/PG/Monitor. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Screenshots ansehen</b></summary>
<br/>

**Verfügbarkeits-Monitoring**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Statusseiten**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Vorfallmanagement**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**Rufbereitschaft und Alarme**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Log-Management**
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
| **Am besten für** | Selbst-Hoster und kleine Teams | Regulierte Teams, die Premium-Support benötigen |
| **Kosten** | Kostenlos und Open Source | [Vertrieb kontaktieren](mailto:sales@oneuptime.com) |
| **Funktionen** | Voller Funktionsumfang | Voller Funktionsumfang + gehärtete Images, priorisierter Support, individuelle Funktionen und Datenresidenz |

---

## 💡 Warum OneUptime?

Unsere Mission ist einfach: **Ausfallzeiten reduzieren und mehr Produkten zum Erfolg verhelfen.** Statt sieben Anbieter zusammenzukleben, erhalten Sie eine Plattform, die Ihnen hilft zu verstehen, *warum* Dinge kaputtgehen, schnell auf Vorfälle zu reagieren und den operativen Aufwand zu senken — vollständig Open Source, sodass Ihnen Ihre Daten und Ihr Stack gehören.

---

<a name="contributing"></a>

## 🤝 Mitwirken

Wir freuen uns über Beiträge jeder Größe. Beginnen Sie hier:

- 🐛 **[Offene Issues](https://github.com/OneUptime/oneuptime/issues)** — nehmen Sie sich eines vor oder [erstellen Sie ein neues](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Helfen Sie beim Schreiben von Tests](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** für die Codebasis
- 🧑‍💻 **[Anleitung zur lokalen Entwicklung](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** zum Einrichten
- 📖 Lesen Sie die **[Richtlinien zum Mitwirken](CONTRIBUTING.md)**
- 💬 Chatten Sie mit uns im **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** oder **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Unterstützen Sie das Projekt

Wenn OneUptime für Sie nützlich ist:

- ⭐ **Markieren Sie dieses Repository mit einem Stern** — das hilft anderen wirklich, uns zu finden
- 💵 **[Werden Sie Sponsor](https://github.com/sponsors/OneUptime)** — jeder Dollar bringt neue Funktionen
- 🛍️ **[Holen Sie sich etwas Merch](https://shop.oneuptime.com)** — alle Erlöse finanzieren die Open-Source-Entwicklung

---

## 📄 Lizenz

OneUptime ist unter der [Apache License 2.0](LICENSE) lizenziert.

<div align="center">
  <sub>Mit ❤️ erstellt vom <a href="https://oneuptime.com">OneUptime</a>-Team und <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">Mitwirkenden</a>.</sub>
</div>
