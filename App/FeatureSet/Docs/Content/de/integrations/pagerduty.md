# PagerDuty-Integration

Lösen Sie einen [PagerDuty](https://www.pagerduty.com)-Vorfall aus, sobald ein OneUptime-Vorfall erstellt wird, und lösen Sie ihn auf, wenn OneUptime auflöst. Nützlich, wenn PagerDuty Ihre Eskalation und Rufbereitschaftspläne verwaltet und Sie möchten, dass das Monitoring von OneUptime dieses System speist.

Diese Integration ist **ausgehend**: OneUptime ruft die [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) von PagerDuty auf. Sie verwendet einen OneUptime-**[Workflow](/docs/workflows/index)** mit einem **Incident → On Create**-Auslöser und einer **API-Komponente**.

> OneUptime hat seine eigene Rufbereitschaft und Eskalation eingebaut – siehe [On Call](/docs/on-call/incoming-call-policy). Verwenden Sie diese Integration nur, wenn Sie Ereignisse explizit auch in PagerDuty haben möchten.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Voraussetzungen

- Ein PagerDuty-Service mit einer **Events API v2**-Integration. In PagerDuty: **Service → Integrations → Add integration → Events API v2**. Kopieren Sie den **Integration Key** (auch _routing key_ genannt).
- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

## Schritt 1 — Den Routing-Key speichern

1. Gehen Sie zu **Workflows → Global Variables → Create**.
2. Benennen Sie die Variable `PAGERDUTY_ROUTING_KEY`, fügen Sie den Integration-Key ein und aktivieren Sie **Is Secret**.

## Schritt 2 — Den „Auslöse"-Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Incidents → PagerDuty`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Incident**-Auslöser mit **On Create** hinzu. Benennen Sie ihn in `Incident` um.
3. Fügen Sie einen **API**-Block verbunden mit dem Auslöser hinzu:

   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   Der **`dedup_key`** verknüpft diesen PagerDuty-Vorfall mit dem OneUptime-Vorfall, sodass Sie ihn später auflösen können. Die Verwendung der OneUptime-Vorfall-ID hält ihn eindeutig und vorhersehbar.

4. **Speichern**, aktivieren und einen Test-Vorfall erstellen. Eine `202`-Antwort in den Workflow-Logs bedeutet, dass PagerDuty das Ereignis akzeptiert hat.

## Schritt 3 — Bei OneUptime-Auflösung auflösen (empfohlen)

1. Im **gleichen** Workflow einen zweiten **Incident**-Auslöser hinzufügen? Nein – ein Workflow hat einen Auslöser. Erstellen Sie stattdessen einen **zweiten** Workflow namens `Resolve PagerDuty` mit einem **Incident → On Update**-Auslöser.
2. Fügen Sie einen **Conditions**-Block hinzu, der prüft, ob der Vorfall nun aufgelöst ist (verzweigen Sie auf den Zustand des Vorfalls/`{{Incident.currentIncidentState.name}}` gleich Ihrem aufgelösten Zustandsnamen).
3. Fügen Sie von **Yes** aus einen **API**-Block zu PagerDuty hinzu mit demselben **`dedup_key`** und `event_action` auf `resolve` gesetzt:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty gleicht den `dedup_key` ab und schließt den ursprünglichen Vorfall.

## Schweregrad-Zuordnung (optional)

PagerDuty's `severity` akzeptiert `critical`, `error`, `warning` oder `info`. Um von OneUptime-Schweregraden zuzuordnen, fügen Sie **Conditions**-Zweige auf `{{Incident.incidentSeverity.name}}` vor dem API-Block hinzu und senden Sie von jedem einen anderen Body.

## Eingehend (optional)

Um den anderen Weg zu gehen – einen OneUptime-Vorfall aus einem PagerDuty-Ereignis zu öffnen – fügen Sie einen Workflow mit **Webhook**-Auslöser hinzu und verweisen Sie einen PagerDuty-[V3-Webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/) (oder eine Events Orchestration) auf dessen URL, dann verwenden Sie **Create Incident**. Siehe das [eingehende Muster](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Fehlerbehebung

- **`400` mit `"invalid routing key"`** — die Integration muss **Events API v2** sein, nicht die ältere Events API v1 oder ein anderer Integrationstyp. Kopieren Sie den Key erneut.
- **Auflösung schließt nichts** — der `dedup_key` beim Auflöse-Aufruf muss exakt mit dem Auslöse-Aufruf übereinstimmen.
- **Nichts in den Logs** — bestätigen Sie, dass der Workflow **Enabled** ist und der Auslöser **On Create** ist.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — Muster und der Authentifizierungs-Spickzettel.
- [On Call](/docs/on-call/incoming-call-policy) — die integrierte Eskalation von OneUptime.
- [Opsgenie](/docs/integrations/opsgenie) — dasselbe Prinzip für Opsgenie.
