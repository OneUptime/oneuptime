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

OneUptime ist eine Open-Source-Observability-Plattform. Sie prüft, ob Ihre Websites, APIs und Server funktionieren, sammelt die Logs, Metriken und Traces, die Ihre Anwendungen senden, alarmiert die Bereitschaft, wenn etwas ausfällt, und informiert Ihre Kunden auf einer Statusseite. Das alles geschieht in einem Produkt: Das Werkzeug, das ein Problem bemerkt, ist auch das, das Ihr Team alarmiert.

Sie können [OneUptime Cloud](https://oneuptime.com) nutzen oder OneUptime auf Ihren eigenen Servern betreiben.

<p align="center">
  <img alt="OneUptime während eines Vorfalls: seine Zeitleiste, wer Bereitschaft hat, die Statusseite und die Untersuchung durch OneUptime AI" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## Was OneUptime kann

- **[Monitoring](https://oneuptime.com/docs/de/monitor/create-monitor)**: Websites, APIs, Ports, DNS und Zertifikate von Sonden in aller Welt oder aus Ihrem eigenen Netzwerk heraus prüfen. OneUptime überwacht auch Server, Kubernetes, Docker, VMware, Datenbanken und Netzwerkgeräte.
- **[Vorfälle und Bereitschaft](https://oneuptime.com/docs/de/incidents/index)**: Jeden Vorfall auf einer Zeitleiste bearbeiten. Die Bereitschaft per Anruf, SMS, E-Mail, Push, Slack oder Microsoft Teams alarmieren und eskalieren, bis jemand reagiert.
- **[Statusseiten](https://oneuptime.com/docs/de/status-pages/index)**: Kunden auf öffentlichen oder privaten Statusseiten auf dem Laufenden halten und dort geplante Wartungen ankündigen.
- **[Logs, Metriken und Traces](https://oneuptime.com/docs/de/telemetry/open-telemetry)**: Mit OpenTelemetry senden, durchsuchen und Dashboards daraus bauen. Ausnahmen, Profile, Real User Monitoring und Sicherheitsereignisse liegen am selben Ort.
- **[Workflows und Runbooks](https://oneuptime.com/docs/de/workflows/index)**: Routinearbeit automatisieren und Jira, ServiceNow und die anderen Werkzeuge anbinden, die Ihr Team schon nutzt.
- **[OneUptime AI](https://oneuptime.com/docs/de/ai/ai-sre)**: Untersucht neue Vorfälle und Warnungen und veröffentlicht eine belegte Ursachenanalyse. Wenn Sie das Beheben einschalten, kann es einen Pull-Request mit einer Korrektur öffnen, den Ihr Team prüft.
- **[API, CLI und Terraform](https://oneuptime.com/docs/de/api-reference/api-reference)**: OneUptime aus Ihren Skripten und Ihrer CI automatisieren und Monitore, Statusseiten und Bereitschaft als Code verwalten.

Alles Weitere steht in der [Dokumentation](https://oneuptime.com/docs/de/introduction/getting-started).

## Loslegen

### OneUptime Cloud

[Registrieren Sie sich](https://oneuptime.com/accounts/register) und legen Sie ein Projekt an. Für den kostenlosen Tarif brauchen Sie keine Kreditkarte.

### Selbst hosten mit Docker Compose

Sie brauchen einen Linux-Server mit mindestens 8 GB Arbeitsspeicher sowie Docker, Docker Compose, Git und Node.js.

Setzen Sie vor Schritt 3 `HOST` in `config.env` auf den Domainnamen oder die IP-Adresse, über die OneUptime erreicht werden soll, ohne `http://`. Behalten Sie `localhost` nur, um OneUptime auf Ihrem eigenen Rechner auszuprobieren.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config
cp config.example.env config.env

# 3. Start everything
npm start
```

`npm start` prüft den Server, gibt jedem Geheimnis in `config.env` einen eigenen Zufallswert und startet OneUptime. Wenn `npm start` **OneUptime is up!** ausgibt, öffnen Sie `http://localhost` oder die Adresse Ihres Servers und registrieren Sie sich. Das erste Konto wird zum Admin der Instanz.

Die [Docker-Compose-Anleitung](https://oneuptime.com/docs/de/installation/docker-compose) behandelt Servergrößen, HTTPS, Backups und Updates.

### Kubernetes mit Helm

Für den Produktivbetrieb in großem Maßstab oder mit Hochverfügbarkeit installieren Sie das Helm-Chart. Setzen Sie `host` auf den Domainnamen oder die IP-Adresse, unter der OneUptime erreichbar sein soll:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

Die [README des Charts](/HelmChart/Public/oneuptime/README.md) behandelt Speicher, HTTPS, Datenbanken und Upgrades.

## Community und Enterprise

- **Community Edition**: Kostenlos und Open Source, mit allem oben Genannten, einschließlich Single Sign-On per SAML und OIDC.
- **Enterprise Edition**: Ergänzt SCIM-Provisionierung, Audit-Logs, Team-Compliance und Dashboards zum Zustand der Instanz, mit Prioritäts-Support. Für den Produktivbetrieb ist eine Lizenz nötig: [Vertrieb kontaktieren](mailto:sales@oneuptime.com).

Die Dokumentation [vergleicht die beiden Editionen](https://oneuptime.com/docs/de/self-hosted/enterprise).

## Hilfe bekommen

- Stellen Sie Fragen in der [OneUptime-Community auf Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Melden Sie Fehler und wünschen Sie sich Funktionen in den [GitHub Issues](https://github.com/OneUptime/oneuptime/issues).
- Melden Sie Sicherheitslücken vertraulich, wie es [SECURITY.md](/.github/SECURITY.md) beschreibt.
- Für alles andere schreiben Sie an [support@oneuptime.com](mailto:support@oneuptime.com).

## Mitwirken

Fehlerbehebungen, Funktionen, Dokumentation und Tests sind willkommen. Die [Anleitung zur lokalen Entwicklung](https://oneuptime.com/docs/de/installation/local-development) zeigt, wie Sie OneUptime aus dem Quellcode starten, und die [Richtlinien zum Mitwirken](/.github/CONTRIBUTING.md) erklären, wie Pull-Requests und Lizenzierung funktionieren. Issues mit dem Label [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) eignen sich gut für den Einstieg.

Wenn Ihnen OneUptime nützt, geben Sie diesem Repository einen Stern oder [unterstützen Sie das Projekt](https://github.com/sponsors/OneUptime).

## Lizenz

OneUptime ist Open Source unter der [Apache License 2.0](/LICENSE), mit Ausnahme des Verzeichnisses [`ee/`](/ee). Dieses Verzeichnis enthält die Enterprise Edition und ist unter der [OneUptime Enterprise License](/ee/LICENSE) lizenziert. Das Image der Community Edition enthält keinen Code aus `ee/`. Die Datei [`LICENSE`](/LICENSE) im Stammverzeichnis des Repositorys legt diese Aufteilung fest.
