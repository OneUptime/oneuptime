# Integrazione con PagerDuty

Attiva un incidente [PagerDuty](https://www.pagerduty.com) ogni volta che viene creato un incidente OneUptime, e risolvilo quando OneUptime lo risolve. Utile quando PagerDuty gestisce la tua escalation e i turni on-call e vuoi che il monitoraggio di OneUptime lo alimenti.

Questa integrazione è **in uscita**: OneUptime chiama la [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) di PagerDuty. Utilizza un **[Workflow](/docs/workflows/index)** di OneUptime con un trigger **Incident → On Create** e un **componente API**.

> OneUptime ha la propria funzionalità on-call ed escalation integrata — vedi [On Call](/docs/on-call/incoming-call-policy). Usa questa integrazione solo se vuoi specificamente che gli eventi arrivino anche in PagerDuty.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Prerequisiti

- Un servizio PagerDuty con un'integrazione **Events API v2**. In PagerDuty: **Service → Integrations → Add integration → Events API v2**. Copia l'**Integration Key** (detta anche _routing key_).
- Un progetto OneUptime in cui puoi creare workflow.

## Passaggio 1 — Salva la routing key

1. Vai su **Workflows → Global Variables → Create**.
2. Chiamala `PAGERDUTY_ROUTING_KEY`, incolla la chiave di integrazione e attiva **Is Secret**.

## Passaggio 2 — Crea il workflow di "attivazione"

1. Apri **Workflows → Create Workflow**, chiamalo `Incidents → PagerDuty` e apri il **Builder**.
2. Aggiungi un trigger **Incident** impostato su **On Create**. Rinominalo `Incident`.
3. Aggiungi un blocco **API** collegato al trigger:

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

   La **`dedup_key`** collega questo incidente PagerDuty all'incidente OneUptime in modo da poterlo risolvere in seguito. Usare l'ID dell'incidente OneUptime lo mantiene univoco e prevedibile.

4. **Salva**, abilita e crea un incidente di test. Una risposta `202` nei log del workflow significa che PagerDuty ha accettato l'evento.

## Passaggio 3 — Risolvi al momento della risoluzione in OneUptime (consigliato)

1. Nello **stesso** workflow, aggiungere un secondo trigger **Incident**? No — un workflow ha un solo trigger. Crea invece un **secondo** workflow chiamato `Resolve PagerDuty` con un trigger **Incident → On Update**.
2. Aggiungi un blocco **Conditions** per verificare che l'incidente sia ora risolto (ramifica sullo stato dell'incidente/`{{Incident.currentIncidentState.name}}` uguale al nome del tuo stato risolto).
3. Da **Yes**, aggiungi un blocco **API** a PagerDuty con la **stessa `dedup_key`** e `event_action` impostato su `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty abbina la `dedup_key` e chiude l'incidente originale.

## Mappatura delle severità (opzionale)

Il campo `severity` di PagerDuty accetta `critical`, `error`, `warning` o `info`. Per mappare dalle severità OneUptime, aggiungi rami **Conditions** su `{{Incident.incidentSeverity.name}}` prima del blocco API e invia un corpo diverso da ciascuno.

## In entrata (opzionale)

Per fare il contrario — aprire un incidente OneUptime da un evento PagerDuty — aggiungi un workflow con trigger **Webhook** e punta un [webhook V3](https://developer.pagerduty.com/docs/webhooks/v3-overview/) di PagerDuty (o un'Events Orchestration) sul suo URL, poi usa **Create Incident**. Vedi il [pattern in entrata](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Risoluzione dei problemi

- **`400` con `"invalid routing key"`** — l'integrazione deve essere **Events API v2**, non la vecchia Events API v1 o un tipo di integrazione diverso. Copia di nuovo la chiave.
- **La risoluzione non chiude nulla** — la `dedup_key` nella chiamata di risoluzione deve corrispondere esattamente a quella della chiamata di attivazione.
- **Nulla nei log** — conferma che il workflow sia **Enabled** e che il trigger sia **On Create**.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — pattern e guida rapida all'autenticazione.
- [On Call](/docs/on-call/incoming-call-policy) — l'escalation integrata di OneUptime.
- [Opsgenie](/docs/integrations/opsgenie) — la stessa idea per Opsgenie.
