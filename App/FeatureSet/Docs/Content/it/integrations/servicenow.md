# Integrazione con ServiceNow

Apri automaticamente un incidente [ServiceNow](https://www.servicenow.com) ogni volta che viene creato un incidente OneUptime — in modo che ITSM e monitoraggio rimangano allineati.

Questa integrazione è **in uscita**: OneUptime chiama la [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) di ServiceNow. Utilizza un **[Workflow](/docs/workflows/index)** di OneUptime con un trigger **Incident → On Create** e un **componente API**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Prerequisiti

- Un'istanza ServiceNow (`https://your-instance.service-now.com`).
- Un utente ServiceNow con i ruoli `rest_api_explorer` / `itil` (o diritti sufficienti per creare record `incident`). La Basic auth con le credenziali di questo utente è il punto di partenza più semplice; OAuth è consigliato per la produzione.
- Un progetto OneUptime in cui puoi creare workflow.

## Passaggio 1 — Salva le credenziali come segreto

La Table API di ServiceNow accetta la **Basic auth**.

1. Codifica una volta in base64 `username:password`:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. In OneUptime, vai su **Workflows → Global Variables → Create**, chiamala `SERVICENOW_AUTH`, incolla la stringa base64 e attiva **Is Secret**.

## Passaggio 2 — Crea il workflow

1. Apri **Workflows → Create Workflow**, chiamalo `Incidents → ServiceNow` e apri il **Builder**.
2. Aggiungi un trigger **Incident** impostato su **On Create**. Rinominalo `Incident`.
3. Aggiungi un blocco **API** collegato al trigger:
   - **Method**: `POST`
   - **URL**: `https://your-instance.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   Il `correlation_id` mantiene un collegamento all'incidente OneUptime — utile se in seguito vuoi aggiungere un passaggio di risoluzione. ServiceNow usa `1` (alta), `2` (media), `3` (bassa) per `urgency`/`impact`.
4. **Salva**, abilita e crea un incidente di test. Una risposta `201 Created` nei log del workflow restituisce il `sys_id` e il `number` del nuovo record (ad esempio `INC0012345`).

## Passaggio 3 — Risolvi alla risoluzione in OneUptime (opzionale)

1. Crea un **secondo** workflow con un trigger **Incident → On Update** e un blocco **Conditions** che verifica che l'incidente sia risolto.
2. Per aggiornare il record ServiceNow corretto hai bisogno del suo `sys_id`. Puoi salvarlo sull'incidente OneUptime nel Passaggio 2 (leggi `{{CreateRecord.response-body.result.sys_id}}` e scrivilo in un'etichetta con **Update Incident**), oppure cerca il record con una `GET` su `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Aggiungi un blocco **API**: **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, body `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Risolto nel workflow ITIL predefinito).

## Risoluzione dei problemi

- **`401`** — ricodifica `username:password` con `printf` (non `echo`, che aggiunge una nuova riga) e aggiorna `SERVICENOW_AUTH`.
- **`403`** — l'utente non ha i diritti per scrivere nella tabella `incident`; aggiungi il ruolo `itil`.
- **`400`** — un nome o valore di campo è errato per le personalizzazioni della tua istanza. Controlla i nomi dei campi in **System Definition → Tables → incident**.
- **L'istanza rifiuta la chiamata** — alcune istanze limitano la Table API; conferma che REST sia abilitato e che il tuo IP non sia bloccato da un ACL.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — pattern e guida rapida all'autenticazione.
- [Jira](/docs/integrations/jira) — lo stesso pattern in uscita per Jira.
- [Componente API](/docs/workflows/components#api) — lettura del corpo della risposta.
