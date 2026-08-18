# Prometheus Alertmanager-Integration

Wandeln Sie [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)-Benachrichtigungen in OneUptime-Vorfälle um. Prometheus wertet Ihre Alarmregeln aus, Alertmanager leitet sie weiter, und OneUptime erfasst und eskaliert sie.

Diese Integration ist **eingehend**, und es gibt zwei Wege, sie zu bauen:

| Ansatz                                                                                | Verwenden Sie ihn, wenn                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Eingehender Anfrage-Monitor](/docs/monitor/incoming-request-monitor)** (empfohlen) | Alarme zu Vorfällen mit Bereitschaftseskalation werden sollen, ein Vorfall pro Alarm, mit automatischer Auflösung bei Wiederherstellung. Keine eigene Logik zu pflegen. |
| **[Workflow](/docs/workflows/index) mit einem Webhook-Auslöser**                      | Sie Routing-Logik brauchen, die OneUptime nicht nativ bietet – andere Systeme aufrufen, Payloads umformen, bedingt verzweigen.                                          |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Voraussetzungen

- Ein Prometheus + Alertmanager-Setup, in dem Sie `alertmanager.yml` bearbeiten können.
- Alertmanager muss Ihre OneUptime-Instanz über HTTPS erreichen können.
- Ein OneUptime-Projekt, in dem Sie Monitore (oder Workflows) erstellen können.

## Option 1 — Eingehender Anfrage-Monitor

### Schritt 1 — Den Monitor erstellen

1. Gehen Sie zu **Monitore → Monitor erstellen** und wählen Sie **Eingehende Anfrage**.
2. Öffnen Sie den Monitor und klicken Sie im linken Menü auf **Documentation**. Kopieren Sie die URL:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Verwenden Sie Ihren eigenen Host, wenn Sie selbst hosten. Der geheime Schlüssel im Pfad ist der einzige Zugangsschlüssel.

### Schritt 2 — Alertmanager darauf ausrichten

In `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` ist erforderlich – es ist das, was OneUptime mitteilt, dass ein Alarm sich erholt hat. Laden Sie Alertmanager mit `curl -X POST http://localhost:9093/-/reload` neu oder starten Sie ihn neu.

Alertmanager sendet `Content-Type: application/json`, was OneUptime braucht, um Felder aus der Payload zu lesen.

### Schritt 3 — Die Kriterien konfigurieren

Öffnen Sie die **Criteria** des Monitors und bearbeiten Sie das erste Kriterium.

**Filter**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  Die Anführungszeichen um den Platzhalter sind für einen Zeichenkettenvergleich erforderlich. Ein Filter `Request Body` / `Contains` / `"status":"firing"` funktioniert ebenfalls, wenn Sie keinen Ausdruck verwenden möchten.

**Aktionen**

- Aktivieren Sie _When filters match, change monitor status_ und setzen Sie ihn auf **Offline** (oder Degraded).
- Aktivieren Sie _When filters match, declare an incident_. Setzen Sie **Title**, **Severity** und die **On-Call Policies**, die alarmiert werden sollen.
- Aktivieren Sie unter **Advanced Options** dieses Vorfalls **Auto Resolve Incident**. Ohne das werden Wiederherstellungsbenachrichtigungen ignoriert und Vorfälle bleiben für immer offen.

**Settings → Group incidents and alerts by a payload field**

Schalten Sie das ein, damit ein Endpunkt mehrere gleichzeitige Vorfälle halten kann – einen pro Alarm – statt eines einzelnen Vorfalls pro Benachrichtigung.

| Feld                               | Wert                                |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` fächert über das `alerts`-Array von Alertmanager auf und öffnet einen Vorfall pro **eindeutigem** extrahiertem Wert. Da beide Pfade `[*]` verwenden, wird die Wiederherstellung pro Alarm beurteilt: In einer Payload, in der ein Alarm aufgelöst und zwei noch aktiv sind, schließt sich nur der aufgelöste.

> **Warning:** Gruppieren Sie nach etwas, das pro Alarm wirklich eindeutig ist. Der `fingerprint` von Alertmanager ist ein Hash über das vollständige Labelset des Alarms und ist es daher immer. Ein Label taugt nur, wenn es **innerhalb** einer Benachrichtigung variiert – und jedes Label, das in der `group_by` Ihrer Route steht, tut das nie, denn genau das definiert die Aggregationsgruppe. Mit dem obigen `group_by: ["alertname", "instance"]` extrahiert eine Gruppierung nach `requestBody.alerts[*].labels.alertname` aus jedem Alarm der Payload denselben Wert, sodass alle zu einem einzigen Vorfall zusammenfallen. Schlimmer noch: Bei doppelten Werten zählt nur das **erste** Vorkommen, eine Payload, deren erster Alarm `resolved` ist, schließt also diesen Vorfall, während die übrigen noch aktiv sind.

### Schritt 4 — Titel und Beschreibung des Vorfalls schreiben

Der Gruppierungsschlüssel steht als Variable bereit, benannt nach dem letzten Segment des Pfads, `requestBody.alerts[*].fingerprint` liefert Ihnen also `{{fingerprint}}`. Das ist ein Hash und nichts, was man einem Bereitschaftsdienst zeigt – betiteln Sie den Vorfall stattdessen mit den Labels, die die Benachrichtigung gemeinsam hat. `commonLabels` trägt jedes Label aus der `group_by` Ihrer Route, mit der obigen Konfiguration sind also `alertname` und `instance` beide verfügbar:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` und `commonAnnotations` enthalten die Felder, die die Benachrichtigung gemeinsam hat. Ein Pfad pro Alarm wie `requestBody.alerts[0].annotations.summary` liest immer den _ersten_ Alarm der Payload, nicht denjenigen, für den dieser konkrete Vorfall geöffnet wurde – halten Sie `group_by` also eng, wenn jeder Vorfall seinen eigenen Annotationstext tragen soll. Ein Pfad, der sich nicht auflöst, wird wörtlich ausgegeben, mitsamt geschweiften Klammern, statt leer zu bleiben. Die vollständige Variablenliste finden Sie unter [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating).

### Schritt 5 — Den Monitor zurück auf Operational setzen (optional)

Kriterien handeln nur, wenn sie zutreffen; fügen Sie daher ein zweites Kriterium hinzu, damit der Monitor nicht Offline bleibt, nachdem sich alles beruhigt hat:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, und keinen Vorfall deklarieren.

### Schritt 6 — Testen

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

Sie sollten zwei Vorfälle erhalten – einen pro `fingerprint`. Senden Sie es erneut mit `status` auf `resolved` bei beiden Alarmen, und beide sollten sich schließen.

Sie können auch einen echten Alarm mit `amtool` auslösen:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Option 2 — Workflow

Verwenden Sie das, wenn Sie Logik jenseits von „Alarm wird Vorfall" brauchen.

1. Öffnen Sie **Arbeitsabläufe → Workflow erstellen**, benennen Sie ihn `Alertmanager → Incidents`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Webhook**-Auslöser hinzu und **kopieren Sie seine URL**. Benennen Sie den Block in `Alertmanager` um.
3. Fügen Sie einen **Bedingungen**-Block verbunden mit dem Auslöser hinzu:
   - **Links**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Rechts**: `firing`
4. Fügen Sie von **Ja** aus einen **Vorfall erstellen**-Block hinzu:
   - **Titel**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Beschreibung**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Schweregrad**: Wählen Sie einen (oder verzweigen Sie zuerst auf `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Speichern**, und richten Sie dann die `webhook_configs`-URL aus Schritt 2 oben stattdessen auf die URL des Workflows aus.

Für einen Vorfall pro Alarm fügen Sie einen [Custom Code](/docs/workflows/components#custom-code)-Block hinzu, der über `Request Body.alerts` iteriert. Mit `send_resolved: true` fügen Sie einen zweiten **Bedingungen**-Zweig auf `status == resolved` hinzu, der den passenden Vorfall sucht und ihn mit **Update Incident** in Ihren aufgelösten Zustand bewegt.

## Totmannschalter

Keine der beiden Optionen sagt Ihnen, wenn Prometheus selbst ausfällt – dass keine Alarme ankommen, sieht genau so aus, als wäre alles in Ordnung. Die übliche Antwort ist ein dauerhaft feuernder Alarm, der an einen Monitor geleitet wird, der ihn planmäßig erwartet. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) liefert einen namens `Watchdog` mit; bei einem einfachen Prometheus fügen Sie eine Alarmregel mit einem stets wahren Ausdruck hinzu (`vector(1)`).

Erstellen Sie einen **zweiten** Eingehenden Anfrage-Monitor, leiten Sie `Watchdog` mit kurzem `repeat_interval` dorthin, und geben Sie diesem Monitor ein Kriterium **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. Das ist der eine Fall, in dem ein Kriterium für ausbleibende Anfragen auf einen Alarmempfänger gehört.

Dies ist die Konfiguration aus Schritt 2 mit eingefügter Watchdog-Route und -Empfänger – eine Unterroute wird vor dem eigenen Empfänger der übergeordneten Route ausgewertet, sodass `Watchdog` zum zweiten Monitor geht und alles andere weiterhin zum ersten:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## Fehlerbehebung

- **Es kommt nichts an** — bestätigen Sie, dass Alertmanager die URL erreichen kann; prüfen Sie dessen Logs auf Zustellfehler. OneUptime beantwortet jede Anfrage mit einem leeren `200`, bevor irgendetwas validiert wird, ein `200` bestätigt also nicht, dass die Payload angenommen wurde. Prüfen Sie stattdessen die Zeitleiste des Monitors.
- **Vorfälle öffnen sich, schließen sich aber nie** — prüfen Sie `send_resolved: true` in Alertmanager, das Wiederherstellungsfeld und seinen Wert im Kriterium (der Vergleich unterscheidet Groß-/Kleinschreibung) sowie **Auto Resolve Incident** unter **Advanced Options** des Vorfalls. Zwei subtilere Ursachen: Eine Payload mit mehr eindeutigen Schlüsseln als **Max incidents per request** verbirgt die Schlüssel jenseits der Grenze auch vor der Wiederherstellung; und wenn ausgerechnet die `resolved`-Benachrichtigung durch die Ingest-Zusammenfassung (siehe unten) verworfen wird, bleibt der Vorfall dauerhaft hängen, weil Alertmanager Firing-Benachrichtigungen wiederholt, Resolved-Benachrichtigungen aber nicht. Schließen Sie diese von Hand.
- **Überhaupt keine Vorfälle, Monitorstatus unverändert** — der Gruppierungspfad muss mit dem wörtlichen `requestBody.` beginnen, und nur das erste `[*]` in einem Pfad ist ein Platzhalter. Beide Fehler scheitern stillschweigend.
- **Der Vorfallstext zeigt rohe `{{...}}`-Platzhalter** — der Pfad hat sich nicht aufgelöst, und OneUptime lässt nicht aufgelöste Platzhalter stehen, statt sie zu leeren. Verschiedene Regeln setzen unterschiedliche Annotationen, referenzieren Sie also Felder, die es für Ihre Regeln tatsächlich gibt (`commonAnnotations` gegenüber `annotations` pro Alarm).
- **Nur ein Vorfall für eine Payload voller Alarme** — Sie haben nach einem Label gruppiert, das innerhalb einer Benachrichtigung nicht variiert, meist eines, das auch in der `group_by` Ihrer Route steht. Gruppieren Sie stattdessen nach `requestBody.alerts[*].fingerprint`.
- **Zu viele Vorfälle** — erweitern Sie `group_by` / `group_interval`, damit Alertmanager verwandte Alarme zusammenfasst. Ein niedrigeres **Max incidents per request** deckelt sie, verbirgt aber auch die Schlüssel jenseits der Grenze vor der Wiederherstellung.
- **Einzelne Benachrichtigungen scheinen bei starken Bursts übersprungen zu werden** — Anfragen an denselben Monitor werden beim Ingest zusammengefasst, damit ein Sender einen Monitor nicht überlasten kann; das kann eine zwischenzeitliche Payload verwerfen, wenn Benachrichtigungen dicht aufeinander eintreffen. Größere `group_wait`- und `group_interval`-Werte ziehen sie auseinander. Gesteuert wird das Zusammenfassen über die Umgebungsvariable `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` des App-Containers, die standardmäßig aktiv ist; selbst hostende Betreiber, die jede Payload ausgewertet brauchen, können sie auf diesem Container auf `false` setzen.

## Weiterführende Themen

- [Eingehender Anfrage-Monitor](/docs/monitor/incoming-request-monitor) — der Monitortyp, seine Kriterien und die Vorfallsgruppierung im Detail.
- [Integrationen – Überblick](/docs/integrations/index) — die eingehenden und ausgehenden Muster.
- [Grafana](/docs/integrations/grafana) — dasselbe Prinzip, Grafana-Alarmierung.
- [Webhook-Auslöser](/docs/workflows/triggers#webhook) — wie die empfangende URL des Workflows funktioniert.
