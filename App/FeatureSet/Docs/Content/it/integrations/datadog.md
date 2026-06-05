# Integrazione con Datadog

Trasforma gli allarmi dei monitor [Datadog](https://www.datadoghq.com) in incidenti OneUptime, in modo che il rilevamento di Datadog alimenti la risposta agli incidenti e le status page di OneUptime.

Questa integrazione è **in entrata**: l'[integrazione Webhooks](https://docs.datadoghq.com/integrations/webhooks/) di Datadog fa una POST a un **[Workflow](/docs/workflows/index)** di OneUptime che inizia con un **trigger Webhook**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prerequisiti

- Un account Datadog in cui puoi configurare integrazioni e monitor.
- Un progetto OneUptime in cui puoi creare workflow.

## Passaggio 1 — Crea il workflow OneUptime

1. Apri **Workflows → Create Workflow**, chiamalo `Datadog → Incidents` e apri il **Builder**.
2. Aggiungi un trigger **Webhook** e **copia il suo URL**. Rinomina il blocco in `Datadog`.
3. Aggiungi un blocco **Conditions** collegato al trigger:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. Da **Yes**, aggiungi un blocco **Create Incident**:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: scegline una.
5. **Salva** (lascia disabilitato finché non è testato).

## Passaggio 2 — Crea il webhook Datadog

1. In Datadog, vai su **Integrations → Webhooks** (installa l'integrazione **Webhooks** se non l'hai già fatto).
2. **Aggiungi un webhook**:
   - **Name**: `oneuptime` (diventa `@webhook-oneuptime`).
   - **URL**: l'URL webhook del tuo workflow.
   - **Payload** — Datadog ti permette di definire il corpo JSON usando le [variabili template](https://docs.datadoghq.com/integrations/webhooks/#usage):

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

3. Salva il webhook.

## Passaggio 3 — Invia gli allarmi di un monitor al webhook

Aggiungi l'handle del webhook ai monitor che vuoi inoltrare. Nel **messaggio di notifica** di ciascun monitor, includi:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Questo invia sia l'allarme che il ripristino a OneUptime. (Per inoltrare tutto, puoi anche aggiungere `@webhook-oneuptime` a un monitor in modo incondizionato.)

## Passaggio 4 — Testalo

1. Abilita il workflow.
2. Da un monitor, usa **Test Notifications → Alert**, o lascia che scatti un vero monitor.
3. Controlla la scheda **Logs** del workflow e il tuo elenco **Incidents**.

## Risoluzione al ripristino (opzionale)

`$ALERT_TRANSITION` è `Recovered` quando un monitor si ripristina. Aggiungi un secondo ramo **Conditions** (`transition == Recovered`), trova l'incidente corrispondente (cerca per l'`id` che hai inviato) e spostalo nel tuo stato risolto con **Update Incident**.

## Risoluzione dei problemi

- **Nessuna esecuzione appare** — conferma che il messaggio del monitor includa `@webhook-oneuptime` e che il workflow sia **Enabled**.
- **I campi sono vuoti** — Datadog sostituisce solo le variabili template applicabili all'evento. Ispeziona l'output del trigger nella scheda **Logs** e adatta il tuo payload webhook.
- **Incidenti duplicati** — un monitor che rinotifica invia più eventi `Triggered`; deduplicali con un controllo **Find Incident** sull'`id` prima di creare.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — il pattern in entrata.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) e [Grafana](/docs/integrations/grafana) — altre sorgenti in entrata.
- [Trigger Webhook](/docs/workflows/triggers#webhook) — come funziona l'URL di ricezione.
