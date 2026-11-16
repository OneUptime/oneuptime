# ServiceNow

Apri un incidente [ServiceNow](https://www.servicenow.com) per ogni incidente di OneUptime e risolvilo quando l'incidente di OneUptime viene risolto, così il tuo service desk segue ciò che vede il tuo monitoraggio. Due flussi di lavoro chiamano la [Table API](https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/c_TableAPI) di ServiceNow.

:::cards
- [Salvare le credenziali](#salvare-le-credenziali): Tieni la password di ServiceNow fuori dai tuoi flussi di lavoro.
- [Aprire incidenti ServiceNow](#aprire-un-incidente-servicenow-per-ogni-incidente): Un flusso di lavoro, due blocchi.
- [Risolverli](#risolvere-lincidente-servicenow): Trovare il record, poi chiuderlo.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Quando ServiceNow rifiuta una richiesta.
:::

## Come funziona

```mermaid title="Due flussi di lavoro, un incidente ServiceNow"
flowchart TB
    declared["Incidente dichiarato"] --> create["Flusso di lavoro 1:<br/>Alla creazione:<br/>Incidente"]
    create -->|"POST incident"| sn["Incidente ServiceNow"]
    resolved["Incidente risolto"] --> update["Flusso di lavoro 2:<br/>All'aggiornamento:<br/>Incidente"]
    update --> find["Trova il record<br/>per correlation_id"]
    find -->|"PATCH state 6"| sn
```

Il primo flusso di lavoro scrive l'ID dell'incidente di OneUptime nel `correlation_id` del record. Il secondo trova il record tramite quell'ID, poi lo risolve.

## Prima di iniziare

- Un'istanza ServiceNow, come `https://your-instance.service-now.com`.
- Un utente ServiceNow per l'integrazione che possa creare e aggiornare record nella tabella `incident`, di solito con il ruolo `itil`. Il suo nome e la sua password firmano le richieste.
- In OneUptime, il permesso di creare flussi di lavoro e variabili globali. Su OneUptime Cloud, i flussi di lavoro richiedono il piano **Growth** o superiore.

## Salvare le credenziali

La Table API accetta l'autenticazione Basic: il nome e la password dell'utente, codificati insieme.

:::steps
1. Codificali una volta, su macOS o Linux:

   ```bash
   printf '%s' 'integration.user:password' | base64 | tr -d '\n'
   ```

   Usa `printf`, non `echo`: `echo` aggiunge un a capo, che viene codificato con il resto e rende le credenziali non valide.

2. In OneUptime, vai su **Flussi di lavoro → Variabili globali** e fai clic su **Crea: Variabile del flusso di lavoro**. Chiamala `SERVICENOW_AUTH` e fai clic su **Avanti**.
3. Incolla il valore codificato in **Contenuto**, attiva **Segreto** e fai clic su **Crea: Variabile del flusso di lavoro**.
:::

## Aprire un incidente ServiceNow per ogni incidente

:::steps
### Creare il flusso di lavoro

Vai su **Flussi di lavoro**, fai clic su **Crea flusso di lavoro**, poi su **Parti da zero**. Chiamalo `Incidents to ServiceNow` e fai clic su **Crea flusso di lavoro**.

### Aggiungere il trigger

Fai clic sul blocco tratteggiato **Scegli cosa avvia questo flusso di lavoro** e scegli **Alla creazione: Incidente**. Fai clic sul trigger: i suoi **Campi da passare** iniziano con **Titolo**, quindi fai clic su **Aggiungi campo** e scegli **Descrizione**.

### Creare il record

Fai clic su **Aggiungi componente**, aggiungi un blocco **Chiamata API POST (JSON)** e collegagli il punto **Successo** del trigger. Imposta il suo **URL** su `https://your-instance.service-now.com/api/now/table/incident`. In **Altri campi**, imposta i suoi **Intestazioni della richiesta** su:

```json
{
  "Authorization": "Basic {{global.variables.SERVICENOW_AUTH}}",
  "Accept": "application/json"
}
```

E il suo **Corpo della Richiesta** su:

```json
{
  "short_description": "OneUptime: {{local.components.incident-on-create-1.returnValues.model.title}}",
  "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
  "urgency": "1",
  "impact": "1",
  "correlation_id": "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"
}
```

### Provarlo, poi attivarlo

Fai clic su **Esegui flusso di lavoro**, scegli un incidente di prova sotto **Incidente** ed eseguilo. Il passaggio **Chiamata API POST (JSON)** mostra una risposta `201` con il nuovo record, il suo `sys_id` e il suo `number`, come `INC0012345`. Poi attiva **Abilitato** in cima al **Costruttore**.
:::

`urgency` e `impact` accettano `1` per alto, `2` per medio e `3` per basso, e ServiceNow ricava la priorità dai due. Qualsiasi altra colonna della tabella `incident` può andare nel corpo, con il suo nome di colonna.

## Risolvere l'incidente ServiceNow

Un flusso di lavoro ha un solo trigger, quindi per risolvere serve un secondo flusso di lavoro, avviato quando cambia lo stato di un incidente.

:::steps
### Aggiungere il trigger «All'aggiornamento: Incidente»

Crea un flusso di lavoro chiamato `Resolve ServiceNow incidents` e scegli **All'aggiornamento: Incidente** come trigger. In **Campi da osservare**, fai clic su **Aggiungi campo** e scegli **Current Incident State**, così viene eseguito solo quando cambia lo stato. In **Campi da passare**, chiedi se il nuovo stato è uno stato risolto: fai clic su **Aggiungi campo**, apri **Current Incident State** e scegli **Is Resolved State**. Oppure fai clic su **Modifica come JSON** e sostituisci il JSON con:

```json
{ "_id": true, "currentIncidentState": { "isResolvedState": true } }
```

### Controllare che l'incidente sia risolto

Aggiungi un blocco **Se / Altrimenti** dopo il trigger. Imposta **Valore da verificare** su `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.isResolvedState}}` e **Confronto** su **è vero**.

### Trovare il record

Aggiungi un blocco **Chiamata API GET (JSON)** dopo il lato **Sì**, con gli stessi **Intestazioni della richiesta** e questo **URL**:

```text
https://your-instance.service-now.com/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}&sysparm_fields=sys_id&sysparm_limit=1
```

### Risolvere il record

Aggiungi un blocco **Chiamata API PATCH (JSON)** dopo il **Successo** del blocco di ricerca, con gli stessi **Intestazioni della richiesta** e questo **URL**:

```text
https://your-instance.service-now.com/api/now/table/incident/{{local.components.api-get-1.returnValues.response-body.result[0].sys_id}}
```

Imposta il suo **Corpo della Richiesta** su:

```json
{
  "state": "6",
  "close_code": "Solution provided",
  "close_notes": "Resolved in OneUptime"
}
```

### Attivarlo

Attiva **Abilitato**, poi risolvi un incidente di prova in OneUptime. Il suo incidente ServiceNow passa a Resolved.
:::

`state` `6` è Resolved negli stati di incidente predefiniti di ServiceNow. `close_code` deve essere uno dei codici di risoluzione della tua istanza. Molte istanze non risolvono un incidente senza codice di risoluzione e note, quindi invia entrambi.

## Risoluzione dei problemi

:::details ServiceNow risponde 401
Le credenziali sono sbagliate. Codifica di nuovo `username:password` con `printf`, non `echo`, e sostituisci il contenuto di `SERVICENOW_AUTH`.
:::

:::details ServiceNow risponde 403
L'utente non può scrivere nella tabella `incident`. Dagli il ruolo `itil`, o un ruolo con gli stessi diritti, e verifica che nessuna regola di controllo degli accessi gli blocchi la Table API.
:::

:::details ServiceNow risponde 400, o la risoluzione non cambia nulla
Un nome di colonna o un valore non si adatta alla tua istanza: un elenco `state` personalizzato, o un `close_code` che la tua istanza non ha. Confronta con la tabella `incident` in **System Definition → Tables** in ServiceNow, e con il modulo del record stesso.
:::

:::details La risoluzione risponde 404
Il passaggio di ricerca non ha trovato alcun record, quindi l'URL ha mantenuto il riferimento così com'è scritto. Verifica che il primo flusso di lavoro abbia scritto `correlation_id`, e che entrambi i flussi di lavoro lo costruiscano allo stesso modo: `oneuptime-` seguito dall'`_id` dell'incidente.
:::

## Prossimi passi

:::cards
- [Jira](/docs/integrations/jira): Un'integrazione bidirezionale, tenuta allineata da modelli pronti all'uso.
- [Componenti del flusso di lavoro](/docs/workflows/components#api): Ogni impostazione dei blocchi API.
- [Esecuzioni del flusso di lavoro](/docs/workflows/runs-and-logs): Leggi cosa ha inviato e ricevuto ogni richiesta.
- [Panoramica delle integrazioni](/docs/integrations/index): Gli schemi dietro ogni integrazione.
:::
