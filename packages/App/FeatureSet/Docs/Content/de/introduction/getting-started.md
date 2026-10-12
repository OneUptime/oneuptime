# Erste Schritte

OneUptime ist eine Open-Source-Observability-Plattform. Sie prüft, ob Ihre Websites, APIs und Server funktionieren, sammelt die Logs, Metriken und Traces, die Ihre Anwendungen senden, alarmiert die Bereitschaft, wenn etwas ausfällt, und informiert Ihre Kunden auf einer Statusseite. Das alles geschieht in einem Produkt: Das Werkzeug, das ein Problem bemerkt, ist auch das, das Ihr Team alarmiert. Nutzen Sie OneUptime Cloud, oder betreiben Sie OneUptime auf Ihren eigenen Servern.

Beginnen Sie hier:

:::cards
- [Schnellstart](/docs/introduction/quickstart): Eine Website überwachen, bei einem Ausfall alarmiert werden und eine Statusseite veröffentlichen.
- [Grundkonzepte](/docs/introduction/core-concepts): Die wenigen Ideen, auf denen alles andere aufbaut, und wie sie zusammenhängen.
- [Startseite & Tastenkürzel](/docs/introduction/home): Sich im Dashboard zurechtfinden, und die Tasten, die Ihnen Klicks sparen.
- [Ihr Konto](/docs/introduction/your-account): Ihr Profil, Ihr Passwort, Passkeys und die Zwei-Faktor-Authentifizierung.
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

### Monitoring

:::cards
- [Monitore](/docs/monitor/create-monitor): Websites, APIs, Ports, DNS, NTP-Server, Zertifikate und mehr von Sonden in aller Welt prüfen.
- [Infrastruktur-Monitore](/docs/monitor/server-monitor): Server, Kubernetes, Docker, VMware, Netzwerkgeräte und Speicher überwachen.
- [Telemetrie-Monitore](/docs/monitor/logs-monitor): Bei den Logs, Metriken, Traces, Ausnahmen und Profilen warnen, die Sie senden.
- [SLOs](/docs/slo/introduction): Zuverlässigkeitsziele, Fehlerbudgets und Burn-Rates verfolgen.
- [Sonden](/docs/probe/custom-probe): Prüfungen aus Ihrem eigenen Netzwerk heraus ausführen.
- [Wenn OneUptime keine Daten empfängt](/docs/monitor/when-oneuptime-is-not-receiving): Warum eine Lücke auf Seiten von OneUptime nie als Ihre Ausfallzeit zählt.
:::

### Incident-Response

:::cards
- [Vorfälle](/docs/incidents/index): Vorfälle melden, koordinieren und beheben, mit einer vollständigen Zeitleiste.
- [Bereitschaft](/docs/on-call/schedules): Rotationen, Eskalationsregeln und wer wann alarmiert wird.
- [Statusseiten](/docs/status-pages/index): Kunden auf öffentlichen oder privaten Statusseiten auf dem Laufenden halten.
- [Workspace-Verbindungen](/docs/workspace-connections/slack): Vorfälle aus Slack und Microsoft Teams heraus bearbeiten.
:::

### Observability

:::cards
- [Telemetrie](/docs/telemetry/open-telemetry): Logs, Metriken und Traces mit OpenTelemetry senden und durchsuchen.
- [Infrastruktur-Agenten](/docs/telemetry/kubernetes-agent): Die Agenten für Kubernetes, Hosts, Docker, Proxmox, VMware und mehr installieren.
- [Cloud](/docs/telemetry/cloud-environments): ECS, Cloud Run, Azure Container Apps und andere verwaltete Plattformen beobachten.
- [KI-Observability](/docs/telemetry/ai-llm-observability): Den Gesprächen Ihrer KI folgen und erfahren, wenn sie schlecht antwortet.
- [Sicherheit](/docs/telemetry/security-events): Sicherheitsereignisse und Bedrohungsinformationen sammeln.
- [Real User Monitoring](/docs/rum/index): Messen, was echte Nutzer erleben, mit Core Web Vitals und Session Replay.
- [Dashboards](/docs/dashboards/index): Dashboards aus Ihren Metriken, Logs und Monitoren bauen.
- [Inventar](/docs/inventory/overview): Jeden Dienst, Host und jedes Gerät sehen, das OneUptime kennt.
:::

### Automatisierung & KI

:::cards
- [Runbooks](/docs/runbooks/index): Abläufe für den Ernstfall in Schritte verwandeln, die Ihr Team ausführen kann.
- [Formulare](/docs/forms/index): Jeden ein Problem über ein Formular melden lassen, das einen Vorfall eröffnet.
- [Workflows](/docs/workflows/index): Aktionen automatisieren, wenn in OneUptime etwas passiert.
- [KI](/docs/ai/ai-sre): OneUptime AI Vorfälle und Warnungen untersuchen lassen und sie zu Ihren Systemen befragen.
:::

### Integrationen

:::cards
- [Integrationen](/docs/integrations/index): Jira, ServiceNow, Grafana, Datadog, Huntress, SIEM-Werkzeuge, Discord, Telegram, IRC und mehr anbinden.
:::

### Entwickler

:::cards
- [API-Referenz](/docs/api-reference/api-reference): OneUptime mit seiner REST-API automatisieren.
- [CLI](/docs/cli/index): OneUptime aus Ihrem Terminal und Ihrer CI verwalten.
- [Terraform-Provider](/docs/terraform/index): Monitore, Statusseiten und Bereitschaft als Code verwalten.
:::

### Administration

:::cards
- [Benutzer und Berechtigungen](/docs/permissions/index): Personen einladen, Teams organisieren und festlegen, was sie dürfen.
- [Identität](/docs/identity/sso): Mit SAML- oder OIDC-Single-Sign-on anmelden und Benutzer mit SCIM bereitstellen.
- [Konfiguration](/docs/configuration/label-and-owner-rules): Ressourcen automatisch beschriften und Eigentümern zuweisen.
- [E-Mails](/docs/emails/smtp): Die E-Mails von OneUptime über Ihren eigenen SMTP-Server versenden.
- [Mobile und Desktop-Apps](/docs/mobile-desktop-apps/index): Alarme erhalten und reagieren unter iOS, Android, macOS, Windows und Linux.
:::

### Selbst hosten

:::cards
- [Installation](/docs/installation/docker-compose): Ihr eigenes OneUptime installieren, dimensionieren und aktualisieren.
- [Selbst gehostete Einrichtung](/docs/self-hosted/architecture): Architektur, Integrationen und Enterprise-Funktionen für Ihre eigene Installation.
:::

## Von einem anderen Werkzeug kommend

### Ihre Einrichtung mitnehmen

**Projekteinstellungen → Aus einem anderen Tool importieren** liest Ihre Einrichtung in einem anderen Werkzeug, mit einem API-Schlüssel oder, bei Uptime Kuma, einer Datei. Es zeigt Ihnen, was es gefunden hat, und legt an, was Sie ankreuzen. Im anderen Werkzeug ändert sich nichts, und ein erneuter Import legt nie etwas doppelt an.

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

### Was OneUptime ersetzt

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

## Nächste Schritte

:::cards
- [Schnellstart](/docs/introduction/quickstart): Ihren ersten Monitor, Ihre erste Bereitschaftsrichtlinie und Ihre erste Statusseite einrichten.
- [Grundkonzepte](/docs/introduction/core-concepts): Die Begriffe lernen, die jede andere Seite verwendet.
- [Startseite & Tastenkürzel](/docs/introduction/home): Jede Seite, Einstellung und Aktion im Dashboard finden.
- [Docker Compose](/docs/installation/docker-compose): OneUptime auf Ihrem eigenen Server betreiben.
:::
