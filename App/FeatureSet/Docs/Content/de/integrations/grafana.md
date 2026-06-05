# Grafana-Integration

Wandeln Sie [Grafana](https://grafana.com)-Alarme in OneUptime-Vorfälle um. Grafana wertet die Alarmregeln auf Ihren Dashboards aus; OneUptime erfasst, eskaliert und verfolgt sie.

Diese Integration ist **eingehend**: Grafanas Alarmierung sendet an einen OneUptime-**[Workflow](/docs/workflows/index)**, der mit einem **Webhook-Auslöser** beginnt, über einen Grafana-**Webhook-Kontaktpunkt**.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Voraussetzungen

- Grafana 9+ mit aktiviertem [Unified Alerting](https://grafana.com/docs/grafana/latest/alerting/) (der Standard in modernem Grafana).
- Grafana muss Ihre OneUptime-Instanz über HTTPS erreichen können.
- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

## Schritt 1 — Den OneUptime-Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Grafana → Incidents`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Webhook**-Auslöser hinzu und **kopieren Sie seine URL**. Benennen Sie den Block in `Grafana` um.
3. Fügen Sie einen **Conditions**-Block verbunden mit dem Auslöser hinzu:
   - **Links**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Rechts**: `firing`
4. Fügen Sie von **Yes** aus einen **Create Incident**-Block hinzu:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: Wählen Sie einen (oder verzweigen Sie auf `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Speichern** (lassen Sie es bis zum Test deaktiviert).

Die Webhook-Payload von Grafana folgt der Alertmanager-Form – sie enthält `status`, ein `alerts`-Array, `commonLabels` und `commonAnnotations`, plus praktische Top-Level-Felder `title` und `message`.

## Schritt 2 — Den Grafana-Kontaktpunkt konfigurieren

1. Gehen Sie in Grafana zu **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: Fügen Sie die Webhook-URL Ihres Workflows ein. **HTTP Method**: `POST`.
4. Speichern Sie den Kontaktpunkt.
5. Gehen Sie zu **Alerting → Notification policies** und leiten Sie die gewünschten Alarme (oder die Standardrichtlinie) an den **OneUptime**-Kontaktpunkt weiter.

## Schritt 3 — Testen

1. Aktivieren Sie den Workflow.
2. Verwenden Sie im Kontaktpunkt-Bildschirm **Test**, um eine Beispielbenachrichtigung zu senden, oder lassen Sie eine echte Alarmregel auslösen.
3. Prüfen Sie den Tab **Logs** des Workflows und Ihre **Incidents**-Liste.

## Bei Wiederherstellung auflösen (optional)

Wenn der Alarm sich auflöst, sendet Grafana eine weitere Benachrichtigung mit `status: resolved`. Fügen Sie einen zweiten **Conditions**-Zweig hinzu (`status == resolved`), suchen Sie den passenden Vorfall, und bewegen Sie ihn mit **Update Incident** in Ihren aufgelösten Zustand.

## Hinweise

- **Legacy-Alarmierung (Grafana 8 und früher)** sendet eine andere Payload (`ruleName`, `state`, `evalMatches`). Wenn Sie Legacy-Alarmierung verwenden, referenzieren Sie stattdessen `{{Grafana.Request Body.ruleName}}` und `{{Grafana.Request Body.state}}` und verzweigen Sie auf `state == alerting`.
- Sie können die Alarmierung von Grafana auch ganz überspringen und OneUptime dieselben Metriken direkt überwachen lassen – siehe [Metrics Monitor](/docs/monitor/metrics-monitor).

## Fehlerbehebung

- **Kein Lauf erscheint** — bestätigen Sie, dass Grafana die URL erreichen kann (prüfen Sie Grafanas Server-Logs) und dass der Workflow **Enabled** ist.
- **Leere Felder** — prüfen Sie die Trigger-Ausgabe im Tab **Logs**; referenzieren Sie Felder, die für Ihre Alarmierungsversion vorhanden sind.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — das eingehende Muster.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — eng verwandte Payload.
- [Metrics Monitor](/docs/monitor/metrics-monitor) — Metriken direkt in OneUptime überwachen.
