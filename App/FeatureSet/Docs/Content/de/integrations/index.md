# Integrationen

OneUptime verbindet sich mit den Tools, die Ihr Team bereits nutzt – Zabbix, Jira, PagerDuty, Slack und viele weitere – über **[Workflows](/docs/workflows/index)**, die integrierte Automatisierungs-Engine. Es gibt kein separates Plugin zu installieren. Sie verdrahten eine Integration auf einer Drag-and-Drop-Arbeitsfläche, und sie läuft, sobald etwas passiert.

Diese Seite erklärt die zwei Muster, die jede Integration verwendet. Wenn Sie sie verstanden haben, können Sie OneUptime mit fast allem verbinden – auch mit Tools, die hier keine eigene Seite haben.

## Die zwei Muster

Jede Integration bewegt Daten in eine von zwei Richtungen (und viele nutzen beide).

### Eingehend — ein anderes Tool sendet Daten an OneUptime

Verwenden Sie dieses Muster, wenn ein externes System in OneUptime _etwas erstellen oder aktualisieren_ muss – üblicherweise einen Vorfall oder Alarm öffnen, wenn es ein Problem erkennt.

1. Bauen Sie einen Workflow, der mit einem **[Webhook-Auslöser](/docs/workflows/triggers#webhook)** beginnt. OneUptime gibt Ihnen eine eindeutige URL.
2. Im anderen Tool konfigurieren Sie eine Webhook- / Benachrichtigungsaktion, die bei einem Ereignis einen POST an diese URL sendet.
3. Im Workflow lesen Sie die eingehende Payload und verwenden eine **Create Incident**- (oder Create Alert-)Komponente, um sie zu erfassen.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### Ausgehend — OneUptime sendet Daten an ein anderes Tool

Verwenden Sie dieses Muster, wenn _etwas in OneUptime in einem anderen Tool erscheinen soll_ – ein Jira-Ticket öffnen, jemanden in PagerDuty benachrichtigen, in Slack posten.

1. Bauen Sie einen Workflow, der mit einem **[OneUptime-Ereignis-Auslöser](/docs/workflows/triggers#oneuptime-event-triggers)** beginnt – zum Beispiel **Incident → On Create**.
2. Fügen Sie eine **[API-Komponente](/docs/workflows/components#api)** hinzu, die die REST-API des anderen Tools mit den Vorfallsdetails aufruft.
3. Speichern Sie alle API-Schlüssel als **geheime [globale Variablen](/docs/workflows/variables#global-variables)**, damit sie nie im Workflow oder dessen Logs erscheinen.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Katalog

| Tool                                                                  | Richtung                | Was es tut                                                                            |
| --------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | Eingehend               | Zabbix-Probleme in OneUptime-Vorfälle umwandeln (und bei Wiederherstellung auflösen). |
| [Jira](/docs/integrations/jira)                                       | Ausgehend (+ eingehend) | Für jeden Vorfall ein Jira-Issue öffnen; Status zurücksynchronisieren.                |
| [PagerDuty](/docs/integrations/pagerduty)                             | Ausgehend (+ eingehend) | PagerDuty-Ereignisse aus OneUptime-Vorfällen auslösen und auflösen.                   |
| [Opsgenie](/docs/integrations/opsgenie)                               | Ausgehend (+ eingehend) | Opsgenie-Alarme erstellen und schließen.                                              |
| [ServiceNow](/docs/integrations/servicenow)                           | Ausgehend (+ eingehend) | ServiceNow-Vorfälle aus OneUptime öffnen.                                             |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Eingehend               | Alertmanager-Benachrichtigungen in Vorfälle umwandeln.                                |
| [Grafana](/docs/integrations/grafana)                                 | Eingehend               | Grafana-Alarme in Vorfälle umwandeln.                                                 |
| [Datadog](/docs/integrations/datadog)                                 | Eingehend               | Datadog-Monitor-Alarme in Vorfälle umwandeln.                                         |
| [GitHub](/docs/integrations/github)                                   | Ausgehend               | Für einen Vorfall ein GitHub-Issue öffnen.                                            |
| [GitLab](/docs/integrations/gitlab)                                   | Ausgehend               | Für einen Vorfall ein GitLab-Issue öffnen.                                            |
| [Discord](/docs/integrations/discord)                                 | Ausgehend               | Vorfallsaktualisierungen in einen Discord-Kanal posten.                               |
| [Telegram](/docs/integrations/telegram)                               | Ausgehend               | Vorfallsaktualisierungen an einen Telegram-Chat senden.                               |
| [Slack](/docs/workspace-connections/slack)                            | Beides                  | Native Workspace-Verbindung – Kanäle, Alarme und Rufbereitschaft.                     |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | Beides                  | Native Workspace-Verbindung.                                                          |

> **Slack und Microsoft Teams** haben eine tiefere, native Verbindung, die über Workflows hinausgeht – automatische Vorfall-Kanäle, bidirektionale Aktionen und Rufbereitschafts-Benachrichtigungen. Nutzen Sie für diese die [Slack](/docs/workspace-connections/slack)- und [Microsoft Teams](/docs/workspace-connections/microsoft-teams)-Workspace-Verbindungen statt eines Workflows.

## Umgang mit Geheimnissen

Fügen Sie niemals einen API-Schlüssel oder Token direkt in einen Block ein. Stattdessen:

1. Gehen Sie zu **Workflows → Global Variables**.
2. Erstellen Sie eine Variable – zum Beispiel `JIRA_AUTH` – und aktivieren Sie **Is Secret**.
3. Referenzieren Sie sie überall mit `{{variable.JIRA_AUTH}}`.

Geheime Variablen werden in der Benutzeroberfläche nach dem Speichern verborgen und aus den Ausführungs-Logs entfernt. Siehe [Variablen](/docs/workflows/variables#global-variables).

## Authentifizierungs-Spickzettel

Die meisten ausgehenden Integrationen benötigen einen `Authorization`-Header am API-Block. Die gängigen Formen:

| Schema               | Header-Wert                                | Verwendet von              |
| -------------------- | ------------------------------------------ | -------------------------- |
| Bearer-Token         | `Bearer {{variable.TOKEN}}`                | GitHub, viele moderne APIs |
| Basic-Auth           | `Basic {{variable.BASE64_USER_PASS}}`      | Jira, ServiceNow           |
| API-Key-Header       | `GenieKey {{variable.OPSGENIE_KEY}}`       | Opsgenie                   |
| Token im Body        | Feld `routing_key` im JSON-Body            | PagerDuty Events API       |
| Private-Token-Header | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab                     |

Für Basic-Auth kodieren Sie `username:password` (oder `email:api_token`) einmalig mit Base64, und speichern Sie dann das Ergebnis als Geheimnis. Unter macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Ihr Tool ist nicht dabei?

Fast jedes Tool passt in eines der zwei oben genannten Muster:

- Wenn das Tool **einen Webhook senden** kann, wenn etwas passiert, verwenden Sie das **eingehende** Muster – verweisen Sie dessen Webhook auf einen OneUptime-Webhook-Auslöser.
- Wenn das Tool eine **REST-API** hat, verwenden Sie das **ausgehende** Muster – rufen Sie es aus einer **API-Komponente** auf.
- Wenn Sie Daten zwischen beiden umformen müssen, fügen Sie einen **[Custom Code](/docs/workflows/components#custom-code)**-Block ein.

Das deckt den langen Schwanz ab – Zendesk, AWS CloudWatch (über SNS), New Relic, Splunk, StatusCake und so weiter. Das Rezept ist dasselbe; nur URL und Payload ändern sich.

## Weiterführende Themen

- [Workflows – Überblick](/docs/workflows/index) — wie die Automatisierungs-Engine funktioniert.
- [Auslöser](/docs/workflows/triggers) — Webhook- und OneUptime-Ereignis-Auslöser im Detail.
- [Komponenten](/docs/workflows/components) — die API-, Webhook- und Datenkomponenten.
- [Variablen](/docs/workflows/variables) — Geheimnisse und Datenweitergabe zwischen Blöcken.
- [Zabbix](/docs/integrations/zabbix) und [Jira](/docs/integrations/jira) — vollständige Praxisbeispiele.
