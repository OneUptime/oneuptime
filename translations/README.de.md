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
    <img alt="OneUptime Logo" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Agentische Observability — eine Open-Source-Plattform für Uptime, Vorfälle, Bereitschaftsdienst, Statusseiten, Logs, Traces, Metriken und APM.</h3>

  <p><b>Wenn etwas schiefläuft, erfahren Sie es als Erste – und beheben es am schnellsten.</b></p>

  <p>OneUptime ersetzt ein ganzes Regal voller SaaS-Tools durch eine einzige Plattform, die Sie kostenlos selbst hosten können. Sie erkennt den Ausfall, alarmiert die richtige Person, aktualisiert Ihre Statusseite, findet die Grundursache und öffnet sogar den PR mit der Lösung.</p>

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

  <a href="https://oneuptime.com"><b>🚀 OneUptime Cloud testen — für immer kostenloser Tarif, keine Kreditkarte →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime-Kommandozentrale während eines Live-Vorfalls" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## Ersetzen Sie Ihren gesamten Observability-Stack

OneUptime vereint Monitoring, Alarmierung, Incident Response und Observability in einer einzigen Open-Source-App — damit Sie nicht mehr für ein Dutzend separater Tools bezahlen (und sie mühsam zusammenflicken) müssen.

| Anstelle von… | Nutzen Sie OneUptime für… |
|---|---|
| Pingdom / UptimeRobot | **Uptime-Monitoring** — Website-, API-, Ping-, Port-, SSL-, DNS- und synthetische Prüfungen aus der ganzen Welt |
| StatusPage.io | **Statusseiten** — gebrandete öffentliche und private Statusseiten mit Abonnenten |
| PagerDuty / Opsgenie | **Bereitschaftsdienst und Alarme** — Dienstpläne, Eskalationsrichtlinien, SMS / Anruf / Push / Slack |
| Incident.io | **Incident Management** — deklarieren, triagieren, kommunizieren und Post-Mortem durchführen |
| Datadog / New Relic | **APM und Metriken** — Traces, Dashboards und Service-Performance |
| Loggly | **Log-Management** — Logs sammeln, durchsuchen und darauf alarmieren |
| Sentry | **Fehler-Tracking** — Ausnahmen mit vollständigen Stack-Traces und Kontext |

Das alles ist **zu 100 % Open Source (Apache 2.0)** und kostenlos selbst hostbar.

---

<details>
<summary><b>🌙 Ein Vorfall, von Anfang bis Ende bewältigt</b></summary>

<br/>

Es ist 2:47 Uhr. Der Checkout beginnt, in Timeouts zu laufen. Hier sehen Sie, was OneUptime tut, bevor die meisten Tools überhaupt den ersten Alarm auslösen würden — und was die folgenden Screenshots tatsächlich zeigen.

### 1 · Erkennen — *in Sekunden Bescheid wissen*

Probes in mehreren Regionen bemerken, wie die Checkout-Latenz Ihren 5-Sekunden-Schwellenwert überschreitet, und öffnen automatisch einen Vorfall — bevor Ihre Kunden auf Aktualisieren drücken.

![Erkennen — globales Monitoring bemerkt die sich verschlechternde Checkout-API](/Home/Static/img/readme/detect.png?raw=true)

### 2 · Reagieren — *die richtige Person, alarmiert*

Der diensthabende Ingenieur der Payments-Richtlinie wird angerufen, per SMS und Push-Benachrichtigung kontaktiert und automatisch an die Vertretung eskaliert, bis jemand bestätigt.

![Reagieren — der Vorfall wird an den Bereitschaftsdienst geleitet und bestätigt](/Home/Static/img/readme/respond.png?raw=true)

### 3 · Kommunizieren — *Kunden auf dem Laufenden*

Ihre Statusseite aktualisiert sich selbst und jeder Abonnent wird per E-Mail und SMS benachrichtigt — niemand muss die Aktualisierung von Hand schreiben.

![Kommunizieren — die öffentliche Statusseite aktualisiert sich und benachrichtigt Abonnenten](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · Diagnostizieren — *Grundursache, gefunden*

Traces, Logs und Metriken werden bis auf den exakten Span korreliert: ein langsames `SELECT … FOR UPDATE` auf `orders`, das an einem fehlenden Index hängt.

![Diagnostizieren — der Trace-Wasserfall lokalisiert den langsamen Datenbank-Span](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · Automatisch beheben — *die Lösung, für Sie vorbereitet*

Der KI-Agent öffnet einen Pull Request mit der Lösung, verknüpft mit dem Vorfall und mit grünen Tests — Sie prüfen und mergen. Wie ein SRE, der niemals schläft.

![Automatisch beheben — der KI-Agent öffnet einen Pull Request mit der Lösung](/Home/Static/img/readme/autofix.png?raw=true)

</details>

---

<a name="quick-start"></a>

## ⚡ Schnellstart

### ☁️ OneUptime Cloud — der einfache Weg

Keine Einrichtung, immer auf dem neuesten Stand und finanziert das Open-Source-Projekt.

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

OneUptime läuft jetzt unter **http://localhost** — öffnen Sie es und erstellen Sie Ihr erstes Konto.

📖 Vollständige Anleitung: [Docker-Compose-Installation](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionierung und Anforderungen](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes mit Helm — für die Produktion

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Vollständige Installationsanweisungen und Werte auf [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Sie aktualisieren eine bestehende Installation?** Siehe den [Upgrade-Leitfaden](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Alles inklusive

| | Funktion | Was sie leistet |
|---|---|---|
| 📊 | **Uptime-Monitoring** | Website-, API-, IP-, Port-, SSL-, DNS- und synthetische Monitore aus mehreren globalen Regionen. |
| 📋 | **Statusseiten** | Schöne, gebrandete Statusseiten, Vorfallhistorie, geplante Wartungen und Abonnentenbenachrichtigungen. |
| 🚨 | **Incident Management** | Durchgängiger Incident-Workflow: deklarieren, zuweisen, kommunizieren, lösen und Post-Mortems durchführen. |
| 📞 | **Bereitschaftsdienst und Alarme** | Bereitschaftspläne und Eskalationsrichtlinien mit SMS-, Telefonanruf-, Push-, E-Mail- und Slack-Alarmen. |
| 📝 | **Log-Management** | Logs über OpenTelemetry aufnehmen, speichern, durchsuchen und darauf alarmieren. |
| 🔍 | **APM und Traces** | Verteilte Traces, Spans und Performance-Dashboards, um langsame Pfade und Engpässe zu finden. |
| 📈 | **Metriken und Dashboards** | Individuelle Dashboards über Ihre Telemetrie — erstellen Sie die Ansichten, die Ihr Team braucht. |
| 🐛 | **Fehler-Tracking** | Erfassen Sie Ausnahmen mit vollständigen Stack-Traces, Kontext und Release-Tracking. |
| ⚡ | **Workflows** | Automatisieren und integrieren Sie mit Slack, Jira, GitHub, Microsoft Teams und über 5.000 Apps. |
| 🤖 | **KI-Copilot** | Ein stets aktiver Agent, der Anomalien in Logs, Traces und Metriken findet, Grundursachen erkennt und PRs mit Lösungen öffnet. |

<details>
<summary><b>⚡ Automatisieren Sie die Routinearbeit</b></summary>

<br/>

Verketten Sie Eskalationen, Ticketing und Benachrichtigungen auf einer visuellen No-Code-Oberfläche — oder fügen Sie eigenen Code ein. Der obige Vorfall hat den Bereitschaftsdienst alarmiert, ein Jira-Ticket geöffnet und in Slack gepostet, ohne dass jemand einen Finger rühren musste.

![Workflows — eine No-Code-Automatisierungsoberfläche für die Vorfalleskalation](/Home/Static/img/readme/workflows.png?raw=true)

</details>

### 🖥️ Infrastruktur-Monitoring

Fügen Sie kopierfertige, **OpenTelemetry-basierte** Agenten ein, um alles zu überwachen, worauf Ihre Services laufen — mit fertigen Alarmvorlagen inklusive:

- **Server und VMs** — CPU, Arbeitsspeicher, Festplatte, Netzwerk, Prozesse und Logs von Linux, macOS und Windows. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — ein `helm install` liefert Node-/Pod-/Container-/Cluster-Metriken, Events, Logs sowie eBPF-Traces und Service-Maps. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — ein einzelner Agent entdeckt automatisch jeden Container und liefert Metriken und Logs. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — dieselbe Ein-Agent-Autoerkennung über Podmans Docker-kompatiblen Socket. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — Nodes, VMs, Container, Speicher, HA-Status, Backup-Abdeckung und Replikationszustand. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — Cluster-Zustand, Kapazitätsprognosen und Einblick in OSD/Pool/PG/Monitor. [Dokumentation →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Ideal für** | Selbst-Hoster und kleine Teams | Regulierte Teams, die Premium-Support benötigen |
| **Kosten** | Kostenlos und Open Source | [Vertrieb kontaktieren](mailto:sales@oneuptime.com) |
| **Funktionen** | Vollständiger Funktionsumfang | Vollständiger Funktionsumfang + gehärtete Images, Prioritäts-Support, individuelle Funktionen und Datenresidenz |

---

## 💡 Warum OneUptime?

Unsere Mission ist einfach: **Ausfallzeiten reduzieren und mehr Produkten zum Erfolg verhelfen.** Statt sieben Anbieter mühsam zusammenzukleben, erhalten Sie eine einzige Plattform, die Ihnen hilft zu verstehen, *warum* Dinge kaputtgehen, schnell auf Vorfälle zu reagieren und den operativen Aufwand zu senken — vollständig Open Source, sodass Ihnen Ihre Daten und Ihr Stack gehören.

---

<a name="contributing"></a>

## 🤝 Mitwirken

Wir begrüßen Beiträge jeder Größe. Beginnen Sie hier:

- 🐛 **[Offene Issues](https://github.com/OneUptime/oneuptime/issues)** — schnappen Sie sich eines oder [eröffnen Sie ein neues](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Helfen Sie beim Schreiben von Tests](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** für die Codebasis
- 🧑‍💻 **[Leitfaden für die lokale Entwicklung](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** für die Einrichtung
- 📖 Lesen Sie die **[Richtlinien für Beiträge](/CONTRIBUTING.md)**
- 💬 Chatten Sie mit uns im **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** oder **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Unterstützen Sie das Projekt

Wenn OneUptime für Sie nützlich ist:

- ⭐ **Geben Sie diesem Repo einen Stern** — das hilft wirklich anderen, uns zu finden
- 💵 **[Sponsern Sie uns](https://github.com/sponsors/OneUptime)** — jeder Dollar bringt neue Funktionen hervor
- 🛍️ **[Holen Sie sich etwas Merch](https://shop.oneuptime.com)** — alle Erlöse finanzieren die Open-Source-Entwicklung

---

## 📄 Lizenz

OneUptime ist unter der [Apache License 2.0](/LICENSE) lizenziert.

<div align="center">
  <sub>Mit ❤️ erstellt vom <a href="https://oneuptime.com">OneUptime</a>-Team und <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">Mitwirkenden</a>.</sub>
</div>
