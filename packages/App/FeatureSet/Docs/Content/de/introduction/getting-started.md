# Erste Schritte

OneUptime ist eine Open-Source-Observability-Plattform. Sie prüft, ob Ihre Websites, APIs und Server funktionieren, sammelt die Logs, Metriken und Traces, die Ihre Anwendungen senden, alarmiert die Bereitschaft, wenn etwas ausfällt, und informiert Ihre Kunden auf einer Statusseite. Das alles geschieht in einem Produkt: Das Werkzeug, das ein Problem bemerkt, ist auch das, das Ihr Team alarmiert. Nutzen Sie OneUptime Cloud, oder betreiben Sie OneUptime auf Ihren eigenen Servern.

## Was möchten Sie tun?

:::cards
- [Erfahren, wenn Ihre Website oder API ausfällt](/docs/guides/website-down): Von Sonden in aller Welt prüfen lassen und bei einem Ausfall eine E-Mail oder einen Alarm erhalten.
- [Per Anruf, SMS oder Push alarmiert werden und eskalieren](/docs/guides/paging): Wer Bereitschaft hat, wird alarmiert, und die nächste Person, wenn niemand reagiert.
- [Eine Statusseite auf Ihrer eigenen Domain veröffentlichen](/docs/guides/status-page): Ihren Kunden unter einer eigenen Adresse zeigen, was gerade passiert.
- [Logs, Metriken und Traces senden](/docs/telemetry/open-telemetry): Die Telemetrie Ihrer Anwendungen mit OpenTelemetry senden, durchsuchen und darauf alarmieren.
- [Einen Server überwachen](/docs/telemetry/hosts): Einen Host mit einem Befehl hinzufügen und CPU, Arbeitsspeicher und Festplatten im Blick behalten.
- [Einen Kubernetes-Cluster überwachen](/docs/telemetry/kubernetes-agent): Den Agenten mit Helm installieren und jeden Node und Pod im Blick behalten.
- [Ihr Team dazuholen](/docs/permissions/index): Personen einladen, in Teams ordnen und festlegen, wer was darf.
- [Einen Vorfall von der ersten Alarmierung bis zur Postmortem-Analyse führen](/docs/incidents/index): Den Vorfall melden, im Team bearbeiten, Kunden informieren und daraus lernen.
:::

## Neu bei OneUptime?

:::cards
- [Schnellstart](/docs/introduction/quickstart): Eine Website überwachen, bei einem Ausfall alarmiert werden und eine Statusseite veröffentlichen.
- [Grundkonzepte](/docs/introduction/core-concepts): Die wenigen Ideen, auf denen alles andere aufbaut, und wie sie zusammenhängen.
- [Glossar](/docs/introduction/glossary): Jedes Wort, das OneUptime verwendet, in ein oder zwei Sätzen, mit seinen anderen Namen.
- [Was nehme ich wann?](/docs/introduction/which-one): Vorfall oder Warnung, Workflow oder Runbook und die anderen Doppelgänger nebeneinander.
:::

Sie betreiben OneUptime auf Ihren eigenen Servern? Folgen Sie zuerst der [Anleitung zum Selbsthosten](/docs/installation/self-hosting-guide): Sie führt von einem leeren Server zu einem, der E-Mails sendet und Personen alarmiert.

## Von einem anderen Werkzeug kommend

**Projekteinstellungen → Erweitert → Import aus anderem Tool** liest Ihre Einrichtung in einem anderen Werkzeug, mit einem API-Schlüssel oder, bei Uptime Kuma, einer Datei. Es zeigt Ihnen, was es gefunden hat, und legt an, was Sie ankreuzen. Im anderen Werkzeug ändert sich nichts, und ein erneuter Import legt nie etwas doppelt an.

Senden Sie Telemetrie bereits mit Prometheus, einem Loki-Client, einem Splunk-Forwarder, dem Datadog Agent oder einem Sentry SDK? Behalten Sie es bei, und richten Sie es mit einem Ingestion-Schlüssel auf OneUptime aus: [Prometheus, Loki, Splunk, Datadog & Sentry](/docs/telemetry/compatible-endpoints) zeigt, wie.

:::details Die elf Werkzeuge, die der Import liest
| Sie kommen von | Was OneUptime liest |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Benutzer, Teams, Pläne, Eskalationen und Dienste |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Benutzer, Teams, Pläne, Eskalationsrichtlinien und Dienste |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Benutzer, Teams, Pläne, Eskalationspfade, Dienste und Vorfalleinstellungen |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Benutzer, Teams, Rotationen und Eskalationsrichtlinien |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Benutzer, Teams, Pläne und Eskalationsketten |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Monitore und öffentliche Statusseiten |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Seiten, ihre Komponenten und Gruppen sowie E-Mail-Abonnenten |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Monitore, Heartbeats, Statusseiten und E-Mail-Abonnenten |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Uptime-Checks |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Uptime-, SSL- und Heartbeat-Checks |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Monitore, aus einem Backup oder der Metrikseite |
:::

:::details Was OneUptime ersetzt
| Funktion | Was sie tut | Ersetzt Werkzeuge wie |
| --- | --- | --- |
| Verfügbarkeitsüberwachung | Prüft Verfügbarkeit und Antwortzeit von Standorten in aller Welt. | Pingdom, UptimeRobot |
| Statusseiten | Zeigt Kunden den aktuellen Status und die Historie Ihrer Dienste. | Atlassian Statuspage |
| Vorfallmanagement | Führt Vorfälle von Anfang bis Ende, mit Notizen, Eigentümern und einer Zeitleiste. | incident.io |
| Bereitschaft und Warnungen | Plant Bereitschaftsdienste und eskaliert, bis jemand reagiert. | PagerDuty, Opsgenie |
| Log-Verwaltung | Sammelt, durchsucht und visualisiert Logs. | Loggly |
| Workflows | Automatisiert Aktionen und verbindet OneUptime mit den Werkzeugen, die Sie schon nutzen. | Zapier |
| Application Performance Monitoring | Verfolgt Traces, Antwortzeiten, Durchsatz und Fehlerraten. | New Relic, Datadog |
| Fehlerverfolgung | Gruppiert Ausnahmen mit Stacktraces und Kontext. | Sentry |
:::

## So greift OneUptime ineinander

Alles beginnt mit etwas, das Sie überwachen. Ein Monitor prüft es nach Zeitplan oder liest die Telemetrie, die es sendet. Treffen die Kriterien des Monitors zu, meldet OneUptime einen Vorfall oder erstellt eine Warnung, alarmiert die Bereitschaft und zeigt den Vorfall auf Ihrer Statusseite, wenn Sie das möchten.

```mermaid title="Von einer fehlgeschlagenen Prüfung zum alarmierten Team und zur aktualisierten Statusseite"
flowchart TB
    probes["Sonden prüfen Ihre<br/>Websites und APIs"] --> monitors["Monitore"]
    telemetry["Ihre Anwendungen und Agenten<br/>senden Telemetrie"] --> monitors
    monitors -->|"Kriterien erfüllt"| problems["Vorfälle und Warnungen"]
    problems --> oncall["Bereitschaftsrichtlinien<br/>alarmieren Ihr Team"]
    problems --> status["Statusseiten<br/>informieren Ihre Kunden"]
```

- Ein **Vorfall** ist ein Problem, das Ihre Nutzer betrifft. Er kann die Bereitschaft alarmieren und auf Ihrer Statusseite erscheinen.
- Eine **Warnung** ist ein Problem, das sich Ihr Team ansehen sollte, bevor Nutzer es bemerken. Sie kann die Bereitschaft ebenfalls alarmieren, erscheint aber nie auf einer Statusseite.

[Grundkonzepte](/docs/introduction/core-concepts) erklärt jedes dieser Teile in wenigen Sätzen.

## Die Dokumentation erkunden

Die Dokumentation ist wie die Seitenleiste in neun Bereiche gegliedert. Wählen Sie den Teil, den Sie brauchen.

:::details Monitoring
:::cards
- [Monitore](/docs/monitor/create-monitor): Websites, APIs, Ports, DNS, NTP-Server, Zertifikate und mehr von Sonden in aller Welt prüfen.
- [Infrastruktur-Monitore](/docs/monitor/host-monitor): Server, Kubernetes, Docker, VMware, Netzwerkgeräte und Speicher überwachen.
- [Telemetrie-Monitore](/docs/monitor/logs-monitor): Bei den Logs, Metriken, Traces, Ausnahmen und Profilen warnen, die Sie senden.
- [SLOs](/docs/slo/introduction): Zuverlässigkeitsziele, Fehlerbudgets und Burn-Rates verfolgen.
- [Sonden](/docs/probe/custom-probe): Prüfungen aus Ihrem eigenen Netzwerk heraus ausführen.
- [Wenn OneUptime keine Daten empfängt](/docs/monitor/when-oneuptime-is-not-receiving): Warum eine Lücke auf Seiten von OneUptime nie als Ihre Ausfallzeit zählt.
:::
:::

:::details Incident-Response
:::cards
- [Vorfälle](/docs/incidents/index): Vorfälle melden, koordinieren und beheben, mit einer vollständigen Zeitleiste.
- [Warnungen](/docs/alerts/index): Probleme untersuchen, bevor Ihre Nutzer sie bemerken, und das Rauschen in Episoden bündeln.
- [Bereitschaft](/docs/on-call/index): Richtlinien, Eskalationsregeln, Rotationen und wer wann alarmiert wird.
- [Benachrichtigungen](/docs/notifications/index): Wie OneUptime Sie erreicht: Ihre Methoden, Bereitschaftsregeln und Benachrichtigungseinstellungen.
- [Statusseiten](/docs/status-pages/index): Kunden auf öffentlichen oder privaten Statusseiten auf dem Laufenden halten.
- [Geplante Wartung](/docs/scheduled-maintenance/index): Geplante Arbeiten ankündigen und die betroffenen Monitore pausieren.
- [Workspace-Verbindungen](/docs/workspace-connections/slack): Vorfälle aus Slack und Microsoft Teams heraus bearbeiten.
:::
:::

:::details Observability
:::cards
- [Telemetrie](/docs/telemetry/open-telemetry): Logs, Metriken und Traces mit OpenTelemetry senden und durchsuchen.
- [Infrastruktur-Agenten](/docs/telemetry/hosts): Einen Host mit einem Befehl hinzufügen und die Agenten für Kubernetes, Docker, Proxmox, VMware und mehr installieren.
- [App-Plattformen](/docs/telemetry/cloud-environments): Die Apps überwachen, die Sie auf ECS und Fargate, Cloud Run, App Service und anderen verwalteten Plattformen betreiben.
- [Cloud](/docs/telemetry/cloud-accounts): Ihre AWS-, Azure- und Google-Cloud-Konten verbinden und jede Ressource darin überwachen.
- [KI-Observability](/docs/telemetry/ai-llm-observability): Den Gesprächen Ihrer KI folgen und erfahren, wenn sie schlecht antwortet.
- [Sicherheit](/docs/telemetry/security-events): Sicherheitsereignisse und Bedrohungsinformationen sammeln.
- [Datensicherheit](/docs/data-security/index): Die sensiblen Daten in Ihren Buckets, Datenbanken und Ihrer Telemetrie finden und beheben, wie sie aufbewahrt werden.
- [Data Observability](/docs/data-observability/index): Erfahren Sie, wann die Daten in Ihren Datenbanken und Data Warehouses verspätet, falsch oder fehlerhaft sind, und welcher Lauf, welches Deployment oder welche Tabelle dahintersteckt.
- [Real User Monitoring](/docs/rum/index): Messen, was echte Nutzer erleben, mit Core Web Vitals und Session Replay.
- [Dashboards](/docs/dashboards/index): Dashboards aus Ihren Metriken, Logs und Monitoren bauen.
- [Inventar](/docs/inventory/overview): Jeden Dienst, Host und jedes Gerät sehen, das OneUptime kennt.
:::
:::

:::details Automatisierung & KI
:::cards
- [Runbooks](/docs/runbooks/index): Abläufe für den Ernstfall in Schritte verwandeln, die Ihr Team ausführen kann.
- [Formulare](/docs/forms/index): Jeden ein Problem über ein Formular melden lassen, das einen Vorfall eröffnet.
- [Workflows](/docs/workflows/index): Aktionen automatisieren, wenn in OneUptime etwas passiert.
- [KI](/docs/ai/ai-sre): OneUptime AI Vorfälle und Warnungen untersuchen lassen und sie zu Ihren Systemen befragen.
:::
:::

:::details Integrationen
:::cards
- [Integrationen](/docs/integrations/index): Jira, ServiceNow, Grafana, Datadog, Huntress, SIEM-Werkzeuge, Discord, Telegram, IRC und mehr anbinden.
:::
:::

:::details Entwickler
:::cards
- [API-Referenz](/docs/api-reference/api-reference): OneUptime mit seiner REST-API automatisieren.
- [CLI](/docs/cli/index): OneUptime aus Ihrem Terminal und Ihrer CI verwalten.
- [Terraform-Provider](/docs/terraform/index): Monitore, Statusseiten und Bereitschaft als Code verwalten.
- [Crossplane-Provider](/docs/crossplane/index): Ihr Projekt mit Crossplane aus Kubernetes verwalten.
:::
:::

:::details Administration
:::cards
- [Benutzer und Berechtigungen](/docs/permissions/index): Personen einladen, Teams organisieren und festlegen, was sie dürfen.
- [Identität](/docs/identity/sso): Mit SAML- oder OIDC-Single-Sign-on anmelden und Benutzer mit SCIM bereitstellen.
- [Konfiguration](/docs/configuration/label-and-owner-rules): Ressourcen automatisch beschriften und Eigentümern zuweisen.
- [E-Mails](/docs/emails/smtp): Die E-Mails von OneUptime über Ihren eigenen SMTP-Server versenden.
- [Mobile und Desktop-Apps](/docs/mobile-desktop-apps/index): Alarme erhalten und reagieren unter iOS, Android, macOS, Windows und Linux.
:::
:::

:::details Selbst hosten
:::cards
- [Installation](/docs/installation/self-hosting-guide): Ihr eigenes OneUptime installieren, dimensionieren und aktualisieren.
- [Selbst gehostete Einrichtung](/docs/self-hosted/architecture): Architektur, Integrationen und Enterprise-Funktionen für Ihre eigene Installation.
:::
:::

## Nächste Schritte

:::cards
- [Schnellstart](/docs/introduction/quickstart): Ihren ersten Monitor, Ihre erste Bereitschaftsrichtlinie und Ihre erste Statusseite einrichten.
- [Grundkonzepte](/docs/introduction/core-concepts): Die Begriffe lernen, die jede andere Seite verwendet.
- [Startseite & Tastenkürzel](/docs/introduction/home): Jede Seite, Einstellung und Aktion im Dashboard finden.
- [Docker Compose](/docs/installation/docker-compose): OneUptime auf Ihrem eigenen Server betreiben.
:::
