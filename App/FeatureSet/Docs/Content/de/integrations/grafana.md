# Grafana-Integration

Wandeln Sie [Grafana](https://grafana.com)-Alarme in OneUptime-Vorfälle um. Grafana wertet die Alarmregeln auf Ihren Dashboards aus; OneUptime erfasst, eskaliert und verfolgt sie.

Diese Integration ist **eingehend**: Ein Grafana-**Webhook-Kontaktpunkt** sendet per POST an OneUptime. Es gibt zwei Wege, das zu empfangen.

| Ansatz                                                                                | Verwenden Sie ihn, wenn                                                                                                                  |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **[Eingehender Anfrage-Monitor](/docs/monitor/incoming-request-monitor)** (empfohlen) | Alarme zu Vorfällen mit Bereitschaftseskalation werden sollen, ein Vorfall pro Alarm, mit automatischer Auflösung bei Wiederherstellung. |
| **[Workflow](/docs/workflows/index) mit einem Webhook-Auslöser**                      | Sie Routing-Logik brauchen, die OneUptime nicht nativ bietet – andere Systeme aufrufen, Payloads umformen, bedingt verzweigen.           |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Die Webhook-Payload von Grafana folgt der Alertmanager-Form – `status`, ein `alerts`-Array, `commonLabels` und `commonAnnotations`, plus praktische Top-Level-Felder `title` und `message`.

## Voraussetzungen

- Grafana 9+ mit aktiviertem [Unified Alerting](https://grafana.com/docs/grafana/latest/alerting/) (der Standard in modernem Grafana).
- Grafana muss Ihre OneUptime-Instanz über HTTPS erreichen können.
- Ein OneUptime-Projekt, in dem Sie Monitore (oder Workflows) erstellen können.

## Option 1 — Eingehender Anfrage-Monitor

1. Gehen Sie zu **Monitore → Monitor erstellen** und wählen Sie **Eingehende Anfrage**. Öffnen Sie den Monitor und klicken Sie im linken Menü auf **Documentation**, um die URL zu kopieren.
2. Öffnen Sie die **Criteria** des Monitors und setzen Sie **Filter Type** auf `JavaScript Expression` und **Value** auf `"{{requestBody.status}}" === "firing"`.
3. Deklarieren Sie bei einem Treffer einen Vorfall, wählen Sie die zu alarmierenden **On-Call Policies** und aktivieren Sie **Auto Resolve Incident** unter **Advanced Options**.
4. Aktivieren Sie unter **Settings** die Option **Group incidents and alerts by a payload field** und setzen Sie:

   | Feld                               | Wert                                |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Betiteln Sie den Vorfall mit `{{requestBody.commonLabels.alertname}}` und beschreiben Sie ihn mit `{{requestBody.message}}` oder `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` enthält den Gruppierungsschlüssel selbst, ist aber ein Hash – nichts, was man einem Bereitschaftsdienst zeigt.)
6. Richten Sie den Grafana-Kontaktpunkt auf die URL des Monitors aus (siehe die Kontaktpunkt-Schritte weiter unten).

Jeder **eindeutige** Gruppierungswert wird zu einem eigenen Vorfall, und jeder davon schließt sich, sobald Grafana ihn als aufgelöst meldet. Der `fingerprint` pro Alarm in Grafana ist für das Labelset eines Alarms eindeutig, deshalb ist er oben der Gruppierungspfad. Die Seite [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) geht dieselbe Einrichtung ausführlicher durch – die Payload-Form ist dieselbe, jeder Schritt dort gilt also auch hier.

> **Warning:** Gruppieren Sie nicht nach einem Label, das über eine Benachrichtigung hinweg konstant ist. Grafanas Standard-Benachrichtigungsrichtlinie gruppiert nach `grafana_folder` und `alertname`, jeder Alarm in einem Webhook teilt sich also denselben alertname – eine Gruppierung nach `requestBody.alerts[*].labels.alertname` würde die gesamte Payload zu einem einzigen Vorfall zusammenfallen lassen. Die Gruppierungspfade müssen außerdem mit dem wörtlichen `requestBody.` beginnen, und nur das erste `[*]` in einem Pfad ist ein Platzhalter. All das scheitert stillschweigend.

## Option 2 — Workflow

Verwenden Sie das, wenn Sie Logik jenseits von „Alarm wird Vorfall" brauchen.

### Schritt 1 — Den OneUptime-Workflow erstellen

1. Öffnen Sie **Arbeitsabläufe → Workflow erstellen**, benennen Sie ihn `Grafana → Incidents`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Webhook**-Auslöser hinzu und **kopieren Sie seine URL**. Benennen Sie den Block in `Grafana` um.
3. Fügen Sie einen **Bedingungen**-Block verbunden mit dem Auslöser hinzu:
   - **Links**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Rechts**: `firing`
4. Fügen Sie von **Ja** aus einen **Vorfall erstellen**-Block hinzu:
   - **Titel**: `{{Grafana.Request Body.title}}`
   - **Beschreibung**: `{{Grafana.Request Body.message}}`
   - **Schweregrad**: Wählen Sie einen (oder verzweigen Sie auf `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Speichern** (lassen Sie es bis zum Test deaktiviert).

## Den Grafana-Kontaktpunkt konfigurieren

1. Gehen Sie in Grafana zu **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: Fügen Sie die Monitor-URL aus Option 1 oder die Webhook-URL des Workflows aus Option 2 ein. **HTTP Method**: `POST`.
4. Speichern Sie den Kontaktpunkt.
5. Gehen Sie zu **Alerting → Notification policies** und leiten Sie die gewünschten Alarme (oder die Standardrichtlinie) an den **OneUptime**-Kontaktpunkt weiter.

## Testen

1. Aktivieren Sie den Workflow, falls Sie einen gebaut haben.
2. Verwenden Sie im Kontaktpunkt-Bildschirm **Test**, um eine Beispielbenachrichtigung zu senden, oder lassen Sie eine echte Alarmregel auslösen.
3. Prüfen Sie Ihre **Vorfälle**-Liste – und den Tab **Protokolle** des Workflows, falls Sie Option 2 verwendet haben.

## Bei Wiederherstellung auflösen

Wenn der Alarm sich auflöst, sendet Grafana eine weitere Benachrichtigung mit `status: resolved`.

Mit **Option 1** schließen das oben konfigurierte Wiederherstellungsfeld und sein Wert den passenden Vorfall automatisch – vorausgesetzt, **Auto Resolve Incident** ist aktiv.

Mit **Option 2** fügen Sie einen zweiten **Bedingungen**-Zweig hinzu (`status == resolved`), suchen den passenden Vorfall und bewegen ihn mit **Update Incident** in Ihren aufgelösten Zustand.

## Hinweise

- **Legacy Alerting (Grafana 8 und älter)** sendet eine andere Payload (`ruleName`, `state`, `evalMatches`). Wenn Sie Legacy Alerting nutzen, referenzieren Sie stattdessen `{{Grafana.Request Body.ruleName}}` und `{{Grafana.Request Body.state}}` und verzweigen Sie auf `state == alerting`.
- Sie können die Alarmierung von Grafana auch ganz umgehen und OneUptime dieselben Metriken direkt überwachen lassen – siehe [Metriken-Überwachung](/docs/monitor/metrics-monitor).

## Fehlerbehebung

- **Es kommt nichts an** — bestätigen Sie, dass Grafana die URL erreichen kann (prüfen Sie Grafanas Serverlogs) und bei Option 2, dass der Workflow **Aktiviert** ist. OneUptime beantwortet jede eingehende Anfrage mit einem leeren `200`, bevor sie validiert wird, ein `200` in Grafanas Logs bestätigt also nicht, dass die Payload angenommen wurde.
- **Vorfälle öffnen sich, schließen sich aber nie** — prüfen Sie das Wiederherstellungsfeld und seinen Wert im Kriterium sowie ob **Auto Resolve Incident** unter **Advanced Options** des Vorfalls aktiv ist. Der Vergleich unterscheidet Groß-/Kleinschreibung.
- **Nur ein Vorfall für eine Payload voller Alarme** — Sie haben nach einem Label gruppiert, das innerhalb einer Benachrichtigung nicht variiert. Gruppieren Sie stattdessen nach `requestBody.alerts[*].fingerprint`.
- **Der Vorfallstext zeigt rohe `{{...}}`-Platzhalter** — der Pfad hat sich nicht aufgelöst, und nicht aufgelöste Platzhalter bleiben stehen, statt geleert zu werden. Referenzieren Sie Felder, die es für Ihre Alerting-Version gibt; prüfen Sie die Trigger-Ausgabe im Tab **Protokolle**, falls Sie Option 2 verwendet haben.

## Weiterführende Themen

- [Eingehender Anfrage-Monitor](/docs/monitor/incoming-request-monitor) — der Monitortyp, seine Kriterien und die Vorfallsgruppierung im Detail.
- [Integrationen – Überblick](/docs/integrations/index) — das eingehende Muster.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — eng verwandte Payload.
- [Metriken-Überwachung](/docs/monitor/metrics-monitor) — Metriken direkt in OneUptime überwachen.
