# Integrazione con Zabbix

[Zabbix](https://www.zabbix.com) monitora i tuoi server e la rete; OneUptime gestisce la risposta agli incidenti, l'on-call e le status page. Collegali e ogni problema Zabbix diventa automaticamente un incidente OneUptime — in modo che le persone giuste vengano avvisate e la tua status page rimanga aggiornata.

Questa integrazione è **in entrata**: Zabbix invia i problemi a OneUptime. Utilizza un **webhook media type** di Zabbix da un lato e un **[Workflow](/docs/workflows/index)** di OneUptime dall'altro. Nessun plugin, nessun servizio aggiuntivo.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## Come funziona

1. Un trigger Zabbix passa allo stato **PROBLEM**.
2. Un'**azione** Zabbix istruisce il media type **OneUptime** a inviare l'evento.
3. Lo script del media type fa una POST di un piccolo payload JSON all'URL del workflow OneUptime.
4. Il workflow legge il payload e crea un incidente (e, facoltativamente, lo risolve quando Zabbix si ripristina).

## Prerequisiti

- Un server Zabbix che amministri (questa guida è scritta per **Zabbix 6.0 LTS / 7.0 LTS**; il webhook media type funziona allo stesso modo dalla versione 5.0+).
- Il tuo server Zabbix deve poter raggiungere la tua istanza OneUptime via HTTPS.
- Un progetto OneUptime in cui puoi creare workflow.

## Parte 1 — Crea il workflow OneUptime

Fai questo prima, perché avrai bisogno dell'URL webhook che genera.

1. Apri **Workflows → Create Workflow**. Chiamalo `Zabbix → Incidents` e apri la scheda **Builder**.
2. Trascina un trigger **Webhook** sul canvas. Cliccalo e **copia l'URL univoco** che mostra. Tienilo al sicuro — chiunque lo possieda può avviare il workflow. Rinomina il blocco in `Zabbix` per una lettura più chiara delle variabili.
3. Trascina un blocco **Conditions** sul canvas e collega l'output del trigger ad esso. Configura:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1`  *(Zabbix invia `1` per un problema, `0` per il ripristino)*
4. Trascina un blocco **Create Incident** e collegalo all'output **Yes** del blocco **Conditions**. Compila:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: scegli la severità dell'incidente OneUptime che preferisci (potrai raffinarla in seguito aggiungendo altri rami **Conditions** che mappano le severità Zabbix).
5. Salva. Lascia **Enabled** *disattivato* per ora — lo abiliterai dopo un test.

> **Suggerimento:** Inserire il `event_id` di Zabbix nella descrizione (o in un'etichetta dell'incidente) ti permette di ritrovare l'incidente in seguito se vuoi risolverlo automaticamente al ripristino. Vedi [Risoluzione automatica](#risoluzione-automatica-opzionale).

## Parte 2 — Configura Zabbix

### Passaggio 1: Crea il media type OneUptime

1. In Zabbix, vai su **Alerts → Media types** (nelle versioni più vecchie: **Administration → Media types**).
2. Clicca **Create media type** e imposta **Type** su **Webhook**.
3. **Name**: `OneUptime`.
4. Aggiungi questi **Parameters** (clicca *Add* per ciascuno). Questi mappano i [macro](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) di Zabbix in un payload pulito:

   | Name | Value |
   | --- | --- |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. Incolla questo nel campo **Script**:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader('Content-Type: application/json');

   var payload = {
     source: 'zabbix',
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw 'OneUptime responded with HTTP ' + request.getStatus() + ': ' + response;
   }

   return 'OK';
   ```

6. Clicca la scheda **Message templates** e aggiungi un template per **Problem** e **Problem recovery** (il corpo può essere vuoto — il payload è costruito nello script). Questo è necessario affinché Zabbix utilizzi il media type per quei tipi di evento.
7. Clicca **Add** per salvare il media type.

### Passaggio 2: Crea un utente per il webhook

Zabbix invia le notifiche *a un utente*. Creane uno dedicato in modo che l'integrazione sia facile da trovare e disabilitare.

1. Vai su **Users → Users → Create user**. Chiamalo `OneUptime Webhook`, assegnagli un ruolo che possa ricevere notifiche (es. **User role**), e aggiungilo a un gruppo utenti.
2. Nella scheda **Media**, clicca **Add**:
   - **Type**: `OneUptime`
   - **Send to**: incolla l'**URL webhook del workflow** copiato nella Parte 1.
   - **When active** / severità: lascia i valori predefiniti (o restringi alle severità che ti interessano).
3. Clicca **Add** e poi **Update**.

### Passaggio 3: Invia i problemi a OneUptime con un'azione

1. Vai su **Alerts → Actions → Trigger actions → Create action**.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (facoltativo): restringi l'ambito — ad esempio, *Trigger severity >= Warning*. Lascia vuoto per inviare tutto.
4. Nella scheda **Operations**, aggiungi un'operazione che invia a **User: OneUptime Webhook** tramite il media type **OneUptime**.
5. Per risolvere gli incidenti al ripristino in seguito, compila anche le **Recovery operations** con lo stesso utente/media.
6. Clicca **Add** per salvare e assicurati che l'azione sia **Enabled**.

## Parte 3 — Testalo

1. Torna al workflow OneUptime e attiva **Enabled**.
2. In Zabbix, attiva un problema di test — ad esempio, abbassa temporaneamente la soglia di un trigger, o usa un item di test che passa allo stato di problema.
3. Apri la scheda **Logs** del tuo workflow. Dovresti vedere un'esecuzione con il payload Zabbix, il blocco **Conditions** che prende il percorso **Yes** e l'incidente creato.
4. Controlla **Incidents** in OneUptime — il tuo problema Zabbix è ora un incidente.

Se non arriva nulla, vedi [Risoluzione dei problemi](#risoluzione-dei-problemi).

## Risoluzione automatica (opzionale)

Il workflow principale sopra *apre* gli incidenti. Per *chiuderli* anche quando Zabbix si ripristina:

1. Assicurati che la tua azione Zabbix abbia le **Recovery operations** configurate (Passaggio 3 sopra) in modo che vengano inviati anche gli eventi di ripristino. Al ripristino, `status` arriva come `0`.
2. Nel workflow, aggiungi un secondo ramo **Conditions**: left `{{Zabbix.Request Body.status}}`, operatore `==`, right `0`.
3. Dal suo output **Yes**, aggiungi un blocco **Find Incident** che cerca l'incidente aperto creato in precedenza — cerca per il `event_id` Zabbix che hai salvato nella descrizione o in un'etichetta.
4. Collegalo a un blocco **Update Incident** e sposta l'incidente nel tuo stato *risolto*.

Poiché la risoluzione dipende da come modelli gli stati degli incidenti nel tuo progetto, mantieni il percorso di **creazione** come base affidabile e aggiungi il percorso di risoluzione una volta confermato che gli eventi fluiscono correttamente. Vedi [Componenti → Componenti per i dati di OneUptime](/docs/workflows/components#oneuptime-data-components).

## Mappatura delle severità Zabbix (opzionale)

Le severità Zabbix (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) arrivano come `{{Zabbix.Request Body.severity}}`. Per mapparle alle severità degli incidenti OneUptime, aggiungi rami **Conditions** prima di **Create Incident** — ad esempio, instrada `Disaster` e `High` a un incidente "Critical" e tutto il resto a "Major". Crea un blocco **Create Incident** per ogni ramo.

## Risoluzione dei problemi

**Il workflow non viene mai eseguito.**
- Conferma che l'interruttore **Enabled** del workflow sia attivo.
- Dal server Zabbix, verifica che possa raggiungere l'URL: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. Dovresti ricevere una risposta rapida.
- Controlla **Reports → Action log** in Zabbix per gli errori di consegna.

**Zabbix riporta un errore dello script.**
- Apri il media type e usa **Test** per inviare un payload di esempio. Zabbix mostra l'output dello script o l'errore generato.
- Una risposta non-2xx da OneUptime viene segnalata dal `throw` nello script — verifica che l'URL del workflow sia corretto.

**L'incidente viene creato ma i campi sono vuoti.**
- Apri la scheda **Logs** del workflow e ispeziona l'output del trigger. Conferma che i nomi dei campi sotto **Request Body** corrispondano a quelli che stai referenziando (`name`, `host`, `severity`, `status`, `event_id`).
- Un campo mancante viene risolto come stringa vuota anziché come errore — vedi [Variabili → Insidie](/docs/workflows/variables#gotchas).

**Tutto si attiva due volte.**
- Probabilmente hai sia un'operazione per il problema che un passaggio di escalation che inviano allo stesso media. Controlla i passaggi **Operations** dell'azione.

## Note sulla sicurezza

- Tratta l'URL webhook del workflow come una password. Se viene compromesso, elimina il trigger e creane uno nuovo per ruotare l'URL.
- Restringi le condizioni dell'azione Zabbix in modo da inviare solo le severità che richiedono un incidente.
- Se esegui OneUptime self-hosted dietro un firewall, consenti all'IP di uscita del tuo server Zabbix di raggiungerlo via HTTPS.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — i pattern in entrata/uscita.
- [Trigger Webhook](/docs/workflows/triggers#webhook) — come funziona l'URL di ricezione.
- [Componenti](/docs/workflows/components) — **Conditions**, **Create Incident** e altro.
- [Variabili](/docs/workflows/variables) — lettura del payload Zabbix nei blocchi successivi.
