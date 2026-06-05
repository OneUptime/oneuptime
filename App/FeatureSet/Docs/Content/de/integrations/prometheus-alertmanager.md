# Prometheus Alertmanager-Integration

Wandeln Sie [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)-Benachrichtigungen in OneUptime-Vorfälle um. Prometheus wertet Ihre Alarmregeln aus, Alertmanager leitet sie weiter, und OneUptime erfasst und eskaliert sie.

Diese Integration ist **eingehend**: Alertmanager sendet per POST an einen OneUptime-**[Workflow](/docs/workflows/index)**, der mit einem **Webhook-Auslöser** beginnt.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Voraussetzungen

- Ein Prometheus + Alertmanager-Setup, in dem Sie `alertmanager.yml` bearbeiten können.
- Alertmanager muss Ihre OneUptime-Instanz über HTTPS erreichen können.
- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

## Schritt 1 — Den OneUptime-Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Alertmanager → Incidents`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Webhook**-Auslöser hinzu und **kopieren Sie seine URL**. Benennen Sie den Block in `Alertmanager` um.
3. Fügen Sie einen **Conditions**-Block verbunden mit dem Auslöser hinzu:
   - **Links**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Rechts**: `firing`
4. Fügen Sie von **Yes** aus einen **Create Incident**-Block hinzu:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: Wählen Sie einen (oder verzweigen Sie zuerst auf `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Speichern** (lassen Sie es bis zum Test deaktiviert).

> **Über gruppierte Alarme.** Alertmanager gruppiert Alarme und sendet ein `alerts`-**Array**. Die oben genannten `commonLabels` und `commonAnnotations` sind die Felder, die für die Gruppe gemeinsam sind – ideal für einen Vorfall pro Benachrichtigung. Wenn Sie **einen Vorfall pro Alarm** möchten, fügen Sie einen [Custom Code](/docs/workflows/components#custom-code)-Block hinzu, der über `Request Body.alerts` iteriert und für jeden einen Vorfall erstellt. Stellen Sie die Gruppierung mit `group_by` in Ihrer Route ein.

## Schritt 2 — Alertmanager konfigurieren

Fügen Sie einen Webhook-Empfänger hinzu, der auf die Workflow-URL zeigt, und leiten Sie Alarme dorthin. In `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Laden Sie Alertmanager neu (`curl -X POST http://localhost:9093/-/reload` oder starten Sie ihn neu).

## Schritt 3 — Testen

1. Aktivieren Sie den Workflow.
2. Lösen Sie einen Test-Alarm aus – zum Beispiel mit `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Prüfen Sie den Tab **Logs** des Workflows und Ihre **Incidents**-Liste.

## Bei Wiederherstellung auflösen (optional)

Mit `send_resolved: true` sendet Alertmanager auch einen POST, wenn ein Alarm sich auflöst, diesmal mit `status: resolved`. Fügen Sie einen zweiten **Conditions**-Zweig hinzu (`status == resolved`), suchen Sie den passenden Vorfall (gleichen Sie auf `commonLabels.alertname` ab), und bewegen Sie ihn mit **Update Incident** in Ihren aufgelösten Zustand.

## Fehlerbehebung

- **Kein Lauf erscheint** — bestätigen Sie, dass Alertmanager die URL erreichen kann (prüfen Sie dessen Logs auf Zustellfehler) und dass der Workflow **Enabled** ist.
- **Vorfallsfelder sind leer** — verschiedene Regeln setzen unterschiedliche Annotationen. Prüfen Sie die Trigger-Ausgabe im Tab **Logs** und referenzieren Sie Felder, die tatsächlich vorhanden sind (`commonAnnotations` vs. `annotations` pro Alarm).
- **Zu viele Vorfälle** — erhöhen Sie `group_by`/`group_interval`, damit Alertmanager verwandte Alarme zusammenfasst.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — das eingehende Muster.
- [Grafana](/docs/integrations/grafana) — dasselbe Prinzip, Grafana-Alarmierung.
- [Webhook-Auslöser](/docs/workflows/triggers#webhook) — wie die empfangende URL funktioniert.
