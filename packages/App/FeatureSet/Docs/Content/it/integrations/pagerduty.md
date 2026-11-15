# PagerDuty

Invia gli incidenti di OneUptime a [PagerDuty](https://www.pagerduty.com). Un flusso di lavoro attiva un incidente PagerDuty quando viene dichiarato un incidente di OneUptime, e un secondo lo risolve quando l'incidente di OneUptime viene risolto. Usalo quando è PagerDuty a chiamare il tuo team e OneUptime a sorvegliare i tuoi sistemi.

:::cards
- [Salvare la routing key](#salvare-la-routing-key): Tieni la chiave di PagerDuty fuori dai tuoi flussi di lavoro.
- [Attivare incidenti PagerDuty](#attivare-un-incidente-pagerduty-per-ogni-incidente): Un flusso di lavoro, due blocchi.
- [Risolverli](#risolvere-lincidente-pagerduty): Un secondo flusso di lavoro che segue lo stato dell'incidente.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Quando PagerDuty rifiuta un evento.
:::

> [!TIP]
> Anche OneUptime chiama le persone, con policy di reperibilità, turni e regole di escalation. Per portare il tuo team fuori da PagerDuty, vedi [Migrare da PagerDuty](/docs/moving-to-oneuptime/pagerduty): un'importazione porta qui i tuoi utenti, i turni e le policy di escalation.

## Come funziona

```mermaid title="Due flussi di lavoro, un incidente PagerDuty"
flowchart TB
    declared["Incidente dichiarato"] --> create["Flusso di lavoro 1:<br/>On Create Incident"]
    create -->|"trigger"| pd["Incidente PagerDuty"]
    resolved["Incidente risolto"] --> update["Flusso di lavoro 2:<br/>On Update Incident"]
    update -->|"resolve"| pd
```

Entrambi i flussi di lavoro chiamano la [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) di PagerDuty con la stessa `dedup_key`, ricavata dall'ID dell'incidente di OneUptime. Grazie a quella chiave PagerDuty sa che l'evento di risoluzione chiude l'incidente aperto dall'evento di attivazione.

## Prima di iniziare

- Un servizio PagerDuty con un'integrazione Events API v2. In PagerDuty, apri il servizio, poi **Integrations**, fai clic su **Add an integration** e scegli **Events API V2**. Copia la sua **Integration Key**: la Events API la chiama routing key.
- In OneUptime, il permesso di creare flussi di lavoro e variabili globali. Su OneUptime Cloud, i flussi di lavoro richiedono il piano **Growth** o superiore.

## Salvare la routing key

:::steps
1. Vai su **Flussi di lavoro → Variabili globali** e fai clic su **Crea: Variabile del flusso di lavoro**.
2. Chiamala `PAGERDUTY_ROUTING_KEY` e fai clic su **Avanti**.
3. Incolla la chiave di integrazione in **Contenuto**, attiva **Segreto** e fai clic su **Crea: Variabile del flusso di lavoro**.
:::

Una variabile segreta viene sostituita da `[REDACTED]` nei log delle esecuzioni, quindi la chiave non compare mai in un'esecuzione.

## Attivare un incidente PagerDuty per ogni incidente

:::steps
### Creare il flusso di lavoro

Vai su **Flussi di lavoro**, fai clic su **Crea flusso di lavoro**, poi su **Parti da zero**. Chiamalo `Incidents to PagerDuty` e fai clic su **Crea flusso di lavoro**.

### Aggiungere il trigger

Fai clic sul blocco tratteggiato **Scegli cosa avvia questo flusso di lavoro** e scegli **On Create Incident**. Fai clic sul trigger: i suoi **Campi da passare** iniziano con **Titolo**, quindi fai clic su **Aggiungi campo** e scegli **Descrizione**.

### Inviare l'evento di attivazione

Fai clic su **Aggiungi componente**, aggiungi un blocco **Chiamata API POST (JSON)** e collegagli il punto **Successo** del trigger. Imposta il suo **URL** su `https://events.pagerduty.com/v2/enqueue` e il suo **Corpo della Richiesta** su:

```json
{
  "routing_key": "{{global.variables.PAGERDUTY_ROUTING_KEY}}",
  "event_action": "trigger",
  "dedup_key": "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}",
  "payload": {
    "summary": "{{local.components.incident-on-create-1.returnValues.model.title}}",
    "source": "OneUptime",
    "severity": "critical",
    "custom_details": {
      "description": "{{local.components.incident-on-create-1.returnValues.model.description}}"
    }
  }
}
```

### Provarlo, poi attivarlo

Fai clic su **Esegui flusso di lavoro**, scegli un incidente di prova sotto **Incidente** ed eseguilo. Il passaggio **Chiamata API POST (JSON)** mostra una risposta `202` con `"status": "success"`, e PagerDuty apre un incidente. Poi attiva **Abilitato** in cima al **Costruttore**.
:::

Il blocco invia JSON, quindi non serve un'intestazione `Content-Type`. La `severity` di PagerDuty è una tra `critical`, `error`, `warning` e `info`: per inviare quella di ogni incidente, vedi [Mappare le gravità](#mappare-le-gravità).

## Risolvere l'incidente PagerDuty

Un flusso di lavoro ha un solo trigger, quindi per risolvere serve un secondo flusso di lavoro, avviato quando cambia lo stato di un incidente.

:::steps
### Aggiungere il trigger On Update Incident

Crea un flusso di lavoro chiamato `Resolve PagerDuty incidents` e scegli **On Update Incident** come trigger. In **Campi da osservare**, fai clic su **Aggiungi campo** e scegli **Current Incident State**, così viene eseguito solo quando cambia lo stato. In **Campi da passare**, chiedi se il nuovo stato è uno stato risolto: fai clic su **Aggiungi campo**, apri **Current Incident State** e scegli **Is Resolved State**. Oppure fai clic su **Modifica come JSON** e sostituisci il JSON con:

```json
{ "_id": true, "currentIncidentState": { "isResolvedState": true } }
```

### Controllare che l'incidente sia risolto

Aggiungi un blocco **Se / Altrimenti** dopo il trigger. Imposta **Valore da verificare** su `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.isResolvedState}}` e **Confronto** su **è vero**.

### Inviare l'evento di risoluzione

Aggiungi un blocco **Chiamata API POST (JSON)** dopo il lato **Sì**, con lo stesso **URL** e questo **Corpo della Richiesta**:

```json
{
  "routing_key": "{{global.variables.PAGERDUTY_ROUTING_KEY}}",
  "event_action": "resolve",
  "dedup_key": "oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}"
}
```

### Attivarlo

Attiva **Abilitato**, poi risolvi un incidente di prova in OneUptime. PagerDuty risolve il suo incidente.
:::

Controllare `isResolvedState` invece del nome di uno stato continua a funzionare quando rinomini i tuoi stati. Vedi [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

## Mappare le gravità

Per inviare la gravità di ogni incidente, aggiungi un blocco **Esegui JavaScript personalizzato** tra il trigger e il blocco **Chiamata API POST (JSON)**, e leggi la sua risposta nel corpo.

1. Nei **Campi da passare** del trigger, fai clic su **Aggiungi campo**, apri **Gravità incidente** e scegli **Nome**.
2. Imposta gli **Argomenti** del blocco su `{ "severity": "{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}" }` e il suo **Codice JavaScript** su:

   ```javascript
   // Your incident severities, by name, to PagerDuty's.
   const SEVERITY = {
     "Critical Incident": "critical",
     "Major Incident": "error",
     "Minor Incident": "warning",
   };

   return { severity: SEVERITY[args.severity] || "info" };
   ```

3. Nel corpo della richiesta, imposta `"severity"` su `"{{local.components.javascript-1.returnValues.returnValue.severity}}"`.

I nomi qui sopra sono le tre gravità con cui parte un nuovo progetto. Usa i tuoi se li hai rinominati.

## Risoluzione dei problemi

:::details PagerDuty risponde 400
Il corpo della risposta dice cosa ha rifiutato PagerDuty, e il passaggio **Chiamata API POST (JSON)** dell'esecuzione lo mostra. Di solito la routing key non è una chiave di integrazione Events API v2: copiala di nuovo dalle **Integrations** del servizio. Viene rifiutato anche un evento senza `summary`, `source` o `severity`.
:::

:::details L'evento di risoluzione non chiude nulla
Entrambi gli eventi devono portare esattamente la stessa `dedup_key`. Verifica che entrambi i corpi la costruiscano con `oneuptime-` seguito dall'`_id` dell'incidente, e che il flusso di lavoro di risoluzione sia attivo.
:::

:::details Il flusso di lavoro non viene mai eseguito
Verifica che sia attivo: **Abilitato**, in cima al suo **Costruttore**. Poi apri **Log → Esecuzioni**: un'esecuzione che ha preso il lato **No** del blocco **Se / Altrimenti** è un aggiornamento che non era una risoluzione.
:::

:::details PagerDuty mostra un riferimento invece di un valore
Un riferimento che non si risolve viene inviato così com'è scritto, parentesi graffe comprese. Controlla l'identificatore del blocco, il nome del campo e il nome della variabile, che distingue tra maiuscole e minuscole. Nella scheda **Passaggi** dell'esecuzione, un'impostazione con un riferimento del genere è segnata **Did not resolve**.
:::

## Prossimi passi

:::cards
- [Migrare da PagerDuty](/docs/moving-to-oneuptime/pagerduty): Porta qui il tuo team, i turni e le policy di escalation.
- [Regole di escalation](/docs/on-call/escalation-rules): Chiama le persone direttamente da OneUptime.
- [Opsgenie](/docs/integrations/opsgenie): Gli stessi due flussi di lavoro per Opsgenie.
- [Panoramica delle integrazioni](/docs/integrations/index): Gli schemi dietro ogni integrazione.
:::
