# Opsgenie-Integration

Erstellen Sie einen [Opsgenie](https://www.atlassian.com/software/opsgenie)-Alarm, sobald ein OneUptime-Vorfall erstellt wird, und schließen Sie ihn, wenn OneUptime auflöst.

Diese Integration ist **ausgehend**: OneUptime ruft die [Opsgenie Alert API](https://docs.opsgenie.com/docs/alert-api) auf. Sie verwendet einen OneUptime-**[Workflow](/docs/workflows/index)** mit einem **Incident → On Create**-Auslöser und einer **API-Komponente**.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## Voraussetzungen

- Ein Opsgenie-**API-Key** aus einer API-Integration: **Settings → Integrations → Add → API**. Kopieren Sie den Key.
- Kennen Sie Ihre Region. Der Standard-API-Host ist `https://api.opsgenie.com`; EU-Konten verwenden `https://api.eu.opsgenie.com`.
- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

## Schritt 1 — Den API-Key speichern

1. Gehen Sie zu **Workflows → Global Variables → Create**.
2. Benennen Sie die Variable `OPSGENIE_KEY`, fügen Sie den API-Key ein und aktivieren Sie **Is Secret**.

## Schritt 2 — Den „Alarm erstellen"-Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Incidents → Opsgenie`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Incident**-Auslöser mit **On Create** hinzu. Benennen Sie ihn in `Incident` um.
3. Fügen Sie einen **API**-Block verbunden mit dem Auslöser hinzu:

   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts` _(verwenden Sie `api.eu.opsgenie.com` für EU)_
   - **Headers**:

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   Der **`alias`** verknüpft diesen Opsgenie-Alarm mit dem OneUptime-Vorfall, sodass Sie ihn später per Alias schließen können. Beachten Sie, dass das Opsgenie-Auth-Schema das wörtliche Wort `GenieKey` gefolgt von einem Leerzeichen und Ihrem Key ist.

4. **Speichern**, aktivieren und einen Test-Vorfall erstellen. Eine `202 Accepted`-Antwort in den Workflow-Logs bedeutet, dass Opsgenie den Alarm in die Warteschlange gestellt hat.

## Schritt 3 — Bei OneUptime-Auflösung schließen (empfohlen)

1. Erstellen Sie einen **zweiten** Workflow namens `Close Opsgenie` mit einem **Incident → On Update**-Auslöser.
2. Fügen Sie einen **Conditions**-Block hinzu, der prüft, ob der Vorfall nun aufgelöst ist (verzweigen Sie auf `{{Incident.currentIncidentState.name}}`).
3. Fügen Sie von **Yes** aus einen **API**-Block hinzu:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: dasselbe `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie sucht den Alarm per Alias und schließt ihn.

## Prioritätszuordnung (optional)

Opsgenie-Prioritäten reichen von `P1` bis `P5`. Ordnen Sie aus OneUptime-Schweregraden mit **Conditions**-Zweigen auf `{{Incident.incidentSeverity.name}}` vor dem API-Block zu.

## Fehlerbehebung

- **`401`/`403`** — falscher Key, falscher Regions-Host, oder die Integration hat keine Berechtigung zum Erstellen von Alarmen. Bestätigen Sie, dass Sie einen **API**-Integrationskey und den passenden `api`/`api.eu`-Host verwenden.
- **Schließen gibt `404` zurück** — der `alias` beim Schließe-Aufruf muss exakt mit dem Erstell-Aufruf übereinstimmen, und `identifierType=alias` muss in der Query-Zeichenkette stehen.
- **Nichts passiert** — bestätigen Sie, dass der Workflow **Enabled** ist.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — Muster und der Authentifizierungs-Spickzettel.
- [PagerDuty](/docs/integrations/pagerduty) — dasselbe Prinzip für PagerDuty.
- [On Call](/docs/on-call/incoming-call-policy) — die integrierte Eskalation von OneUptime.
