# Datadog-Integration

Wandeln Sie [Datadog](https://www.datadoghq.com)-Monitor-Alarme in OneUptime-Vorfälle um, damit Datadogs Erkennung in OneUptime's Incident-Response und Statusseiten einfließt.

Diese Integration ist **eingehend**: Datadogs [Webhooks-Integration](https://docs.datadoghq.com/integrations/webhooks/) sendet per POST an einen OneUptime-**[Workflow](/docs/workflows/index)**, der mit einem **Webhook-Auslöser** beginnt.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Voraussetzungen

- Ein Datadog-Konto, in dem Sie Integrationen und Monitore konfigurieren können.
- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

## Schritt 1 — Den OneUptime-Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Datadog → Incidents`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Webhook**-Auslöser hinzu und **kopieren Sie seine URL**. Benennen Sie den Block in `Datadog` um.
3. Fügen Sie einen **Conditions**-Block verbunden mit dem Auslöser hinzu:
   - **Links**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Rechts**: `Triggered`
4. Fügen Sie von **Yes** aus einen **Create Incident**-Block hinzu:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: Wählen Sie einen.
5. **Speichern** (lassen Sie es bis zum Test deaktiviert).

## Schritt 2 — Den Datadog-Webhook erstellen

1. Gehen Sie in Datadog zu **Integrations → Webhooks** (installieren Sie die **Webhooks**-Integration, falls noch nicht geschehen).
2. **Einen Webhook hinzufügen**:

   - **Name**: `oneuptime` (dieser wird zu `@webhook-oneuptime`).
   - **URL**: die Webhook-URL Ihres Workflows.
   - **Payload** — Datadog erlaubt Ihnen, den JSON-Body mit [Vorlagenvariablen](https://docs.datadoghq.com/integrations/webhooks/#usage) zu definieren:

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Speichern Sie den Webhook.

## Schritt 3 — Alarme eines Monitors an den Webhook senden

Fügen Sie den Webhook-Handle zu den Monitoren hinzu, die Sie weiterleiten möchten. Nehmen Sie in der **Benachrichtigungsnachricht** jedes Monitors Folgendes auf:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Damit werden sowohl der Alarm als auch die Wiederherstellung an OneUptime gesendet. (Um alles weiterzuleiten, können Sie `@webhook-oneuptime` auch bedingungslos zu einem Monitor hinzufügen.)

## Schritt 4 — Testen

1. Aktivieren Sie den Workflow.
2. Verwenden Sie bei einem Monitor **Test Notifications → Alert**, oder lassen Sie einen echten Monitor auslösen.
3. Prüfen Sie den Tab **Logs** des Workflows und Ihre **Incidents**-Liste.

## Bei Wiederherstellung auflösen (optional)

`$ALERT_TRANSITION` ist `Recovered`, wenn ein Monitor sich normalisiert. Fügen Sie einen zweiten **Conditions**-Zweig hinzu (`transition == Recovered`), suchen Sie den passenden Vorfall (gleichen Sie auf der gesendeten `id` ab), und bewegen Sie ihn mit **Update Incident** in Ihren aufgelösten Zustand.

## Fehlerbehebung

- **Kein Lauf erscheint** — bestätigen Sie, dass die Nachricht des Monitors `@webhook-oneuptime` enthält und der Workflow **Enabled** ist.
- **Felder sind leer** — Datadog ersetzt nur Vorlagenvariablen, die für das Ereignis zutreffen. Prüfen Sie die Trigger-Ausgabe im Tab **Logs** und passen Sie Ihre Webhook-Payload an.
- **Doppelte Vorfälle** — ein Monitor, der erneut alarmiert (renotify), sendet mehrere `Triggered`-Ereignisse; deduplizieren Sie mit einer **Find Incident**-Prüfung auf der `id`, bevor Sie erstellen.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — das eingehende Muster.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) und [Grafana](/docs/integrations/grafana) — andere eingehende Quellen.
- [Webhook-Auslöser](/docs/workflows/triggers#webhook) — wie die empfangende URL funktioniert.
