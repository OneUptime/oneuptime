# Integrazione con Microsoft Dynamics 365

Apri un **Case** in [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) ogni volta che viene dichiarato un incidente OneUptime, mantieni quel caso allineato mentre l'incidente evolve e lascia che Dynamics rimandi le modifiche del caso dentro OneUptime — il tutto con un [Workflow](/docs/workflows/index). Non c'è nessun blocco specifico per Dynamics da installare: OneUptime parla con la **Dataverse Web API** tramite il [componente API](/docs/workflows/components#api), e Dynamics risponde attraverso un [trigger Webhook](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Questa pagina copre entrambe le direzioni. Costruisci prima la metà in uscita — è quella che richiede la configurazione di Microsoft Entra ID, e una volta che funziona la metà in entrata è un solo flusso.

## Prerequisiti

- Un ambiente **Dynamics 365** che contiene la tabella **Case**. I casi arrivano da Dynamics 365 Customer Service; un ambiente Dataverse che non lo include non ha nessuna tabella `incident` su cui scrivere.
- L'**endpoint Web API** dell'ambiente. Lo trovi nel [Power Platform admin center](https://admin.powerplatform.microsoft.com/) sotto **Settings → Developer resources** del tuo ambiente, oppure in **make.powerapps.com → Settings → Developer resources**. Ha questo aspetto: `https://yourorg.crm.dynamics.com/api/data/v9.2/` — il segmento della regione varia (`crm` per il Nord America, `crm2` per il Sud America, `crm7` per il Giappone e così via).
- I diritti per registrare un'applicazione in **Microsoft Entra ID** e per creare un **application user** nell'ambiente Dynamics. Di solito si tratta di due amministratori diversi.
- Un progetto OneUptime in cui puoi creare workflow e variabili globali.

> Tutto ciò che segue usa i nomi delle tabelle Dataverse, non le etichette dei form di Dynamics. Un caso è la tabella **`incident`**, la sua collezione in un URL è **`incidents`**, la sua chiave primaria è **`incidentid`** e la sua colonna del titolo è **`title`**. Il numero del caso che vedi nell'interfaccia è **`ticketnumber`**.

## Passaggio 1 — Registra un'applicazione in Microsoft Entra ID

OneUptime si autentica come applicazione, non come persona, quindi usa il flusso OAuth 2.0 **client credentials**.

1. Accedi al [portale Azure](https://portal.azure.com) come amministratore dello stesso tenant del tuo ambiente Dynamics e apri **Microsoft Entra ID**.
2. Vai su **App registrations → New registration**. Dagli un nome come `OneUptime Integration`, lascia **Supported account types** su **Accounts in this organizational directory only** e seleziona **Register**.
3. Dalla pagina **Overview** dell'app, copia l'**Application (client) ID** e il **Directory (tenant) ID**.
4. Vai su **Certificates & secrets → Client secrets → New client secret**. Copia il **Value** del segreto — non il suo ID — prima di cambiare pagina. Non viene mostrato mai più. Un client secret può durare al massimo 24 mesi, quindi annota la scadenza dove ti capiterà di rivederla.

Due cose che qui vengono spesso aggiunte ma che non ti servono:

- **Nessuna API permission.** Nel flusso client credentials non c'è nessun utente autenticato, quindi i permessi delegati non fanno nulla. `user_impersonation` sotto **Dataverse** è un permesso delegato ed è solo per le app interattive. Microsoft Entra ID emette senza problemi un token per Dataverse anche senza alcun permesso configurato — l'accesso viene deciso dal lato Dynamics, nel Passaggio 2.
- **Nessun passaggio di admin consent.** Stesso motivo.

Per le applicazioni di produzione Microsoft preferisce un certificato a un client secret. Quell'opzione richiede che sia il chiamante a costruire e firmare da sé un'asserzione JWT, cosa che un workflow non può fare, quindi qui il client secret è la scelta pratica — trattalo di conseguenza: tienilo in una variabile segreta e ruotalo prima che scada.

## Passaggio 2 — Crea l'application user in Dynamics

È il passaggio che viene saltato, e saltarlo produce l'errore più sconcertante di tutta questa integrazione: la richiesta del token va a buon fine, e poi ogni chiamata a Dataverse fallisce con `403 Forbidden` e il codice di errore `0x80072560` — *"The user isn't a member of the organization."* Entra ID emette il token senza sapere nulla di Dynamics; Dynamics poi cerca una riga utente corrispondente all'applicazione, e non ce n'è nessuna.

1. Apri il [Power Platform admin center](https://admin.powerplatform.microsoft.com/) e seleziona **Manage → Environments**, poi il tuo ambiente.
2. Seleziona **Settings → Users + permissions → Application users**.
3. Seleziona **+ New app user**, poi **+ Add an app**, scegli la registrazione del Passaggio 1 e seleziona **Add**.
4. Scegli una **Business unit**, inserisci un **Email address**, poi usa l'icona di modifica accanto a **Security roles**.
5. Assegna un ruolo di sicurezza **personalizzato** con i privilegi di creazione, lettura e scrittura sulla tabella **Case**. A un application user non si può assegnare uno dei ruoli integrati — Microsoft ne richiede uno personalizzato. Se non hai un ruolo adatto, copiane uno esistente e riducilo.
6. Seleziona **Save**, poi **Create**.

In un ambiente puoi avere un solo application user per ogni applicazione registrata. Gli application user non consumano licenze e sono esenti dalle regole di appartenenza al gruppo di sicurezza dell'ambiente.

## Passaggio 3 — Salva le credenziali in OneUptime

Vai su **Flussi di lavoro → Variabili globali → Crea** e aggiungi queste, attivando **Segreto** per quelle indicate:

| Nome                     | Valore                                                      | Segreto |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | Il Directory (tenant) ID del Passaggio 1                    | No     |
| `DYNAMICS_CLIENT_ID`     | L'Application (client) ID del Passaggio 1                   | No     |
| `DYNAMICS_CLIENT_SECRET` | Il **Value** del client secret del Passaggio 1              | Sì     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — senza barra finale     | No     |

Incolla il client secret esattamente come te lo ha dato Entra ID. OneUptime codifica per te il corpo del form, quindi non applicare tu a mano la codifica URL.

Richiama una qualsiasi di queste variabili da un blocco con `{{global.variables.DYNAMICS_CLIENT_ID}}`. Vedi [Variabili](/docs/workflows/variables) per capire come i segreti vengono ripuliti dai log delle esecuzioni.

## Passaggio 4 — Ottieni un access token

Ogni esecuzione recupera il proprio token. I token durano 60–90 minuti e il flusso client credentials non emette mai un refresh token, quindi non c'è niente da mettere in cache e niente da rinnovare — una chiamata HTTP in più per esecuzione è tutto il costo.

1. Apri **Flussi di lavoro → Crea flusso di lavoro**, chiamalo `Incidents → Dynamics 365` e apri il **Costruttore**.
2. Clicca sul segnaposto tratteggiato, aggiungi il trigger **On Create Incident** e nel suo **Select Fields** richiedi le colonne che vuoi inviare:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Lascia il suo **Identifier** su `incident-on-create-1`.

3. Clicca **Aggiungi componente**, aggiungi un blocco **API Post (JSON)**, collega il punto **Success** del trigger a quel blocco e aprine le impostazioni. Imposta il suo **Identifier** su `get-token`, poi:

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**Scrivi il nome dell'header come `Content-Type`, esattamente con queste maiuscole.** È ciò che dice a OneUptime di inviare il corpo come form post invece che come JSON, l'unica forma che l'endpoint token di Microsoft accetta. `content-type` in minuscolo non corrisponde: la richiesta parte come JSON e torna indietro con un `400`.

Lo `scope` deve essere l'URL del tuo ambiente seguito da `/.default` — è la forma per i client confidenziali. Un URL dell'ambiente sbagliato qui è la causa abituale di `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

Il token è ora disponibile a valle come:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Passaggio 5 — Crea il caso

Aggiungi un secondo blocco **API Post (JSON)**, collega il punto **Success** di `get-token` a quel blocco e imposta il suo **Identifier** su `create-case`.

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

Sostituisci il GUID dell'account con l'account a cui appartengono questi casi. **`customerid` è davvero obbligatorio su un caso** — è una delle colonne che Dataverse impone su qualsiasi scrittura programmatica, quindi una creazione che ne è priva viene rifiutata. Poiché può puntare a un account oppure a un contatto, non si scrive mai `customerid@odata.bind`; si scrive `customerid_account@odata.bind` oppure `customerid_contact@odata.bind`, e questi nomi distinguono maiuscole e minuscole. `title` è obbligatorio in un altro senso: i form di Dynamics lo pretendono, l'API no, quindi invialo comunque.

È `Prefer: return=representation` a rendere tutto questo utilizzabile da un workflow. Senza, una creazione riuscita risponde `204 No Content` e mette l'URI del nuovo record in un header di risposta `OData-EntityId`, dal quale poi dovresti estrarre un GUID. Con esso, la risposta è `201 Created` e porta con sé il record stesso, così il blocco successivo può leggere:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Ora accendi il workflow — **Panoramica → Modifica flusso di lavoro → Abilitato** — dichiara un incidente di test e leggi l'esecuzione sotto **Esecuzioni e registri**. Il blocco `create-case` dovrebbe mostrare un `201` e un corpo contenente il nuovo `incidentid`. Le modifiche sulla tela si salvano da sole; non c'è nessun pulsante Salva.

### Mappare gravità e stato

Dynamics fornisce `severitycode` con una sola opzione, "Default Value", quindi non esiste una scala di gravità pronta all'uso su cui mappare. Usa invece **`prioritycode`** e, se vuoi priorità differenziate per gravità, ramifica con un blocco **If / Else** su `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.

| Colonna          | Valori                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` è personalizzabile, quindi un tenant può aver aggiunto valori propri. Invia interi, non etichette.

## Passaggio 6 — Fai in modo che incidente e caso restino rintracciabili l'uno dall'altro

Qualunque cosa farai in seguito — commentare, risolvere, sincronizzare all'indietro — richiede che uno dei due sistemi conservi l'identificatore dell'altro. Mettilo dal lato Dynamics.

Aggiungi alla tabella Case una colonna **single line of text**, per esempio `new_oneuptimeincidentid`, e impostala quando crei il caso:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Poi qualsiasi workflow successivo può trovare il caso con un filtro:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Se definisci quella colonna come **alternate key** sulla tabella Case, puoi saltare del tutto la ricerca e fare un `PATCH` diretto su `incidents(new_oneuptimeincidentid='<id>')` — un upsert che crea il caso se manca e lo aggiorna se c'è. La chiave deve finire di costruirsi (il suo stato diventa **Active**) prima di poter essere usata, e i valori di una alternate key non possono contenere `/ < > * % & : \ ? + #`. Un id OneUptime è un semplice UUID, quindi è sicuro.

Funziona anche la direzione inversa — salvare l'id del caso Dynamics sull'incidente OneUptime — usando un blocco **Update One Incident** che scrive in `customFields`. Fai attenzione: `customFields` è un'unica colonna JSON, quindi scriverla sostituisce il valore di ogni campo personalizzato di quell'incidente, non solo il tuo. Tenere il collegamento dal lato Dynamics evita del tutto il problema.

## Passaggio 7 — Risolvi il caso quando l'incidente viene risolto

Costruiscilo come **secondo** workflow, così un errore qui non può impedire l'apertura dei casi.

1. **Crea flusso di lavoro**, chiamalo `Incident resolved → Close Dynamics case` e aggiungi il trigger **On Update Incident**.
2. Nel **Listen on** del trigger, metti `{"currentIncidentStateId": true}` così il workflow si sveglia solo per i cambi di stato invece che a ogni modifica. In **Select Fields**, richiedi `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Aggiungi un blocco **If / Else**. **Input 1** è `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** è `==`, **Input 2** è `Resolved` — o comunque si chiami lo stato risolto nel tuo progetto. Vedi [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).
4. Dal ramo **Yes**, ripeti il blocco `get-token` del Passaggio 4.
5. Aggiungi un blocco **API Get (JSON)**, imposta il suo **Identifier** su `find-case` e dagli l'URL con il `$filter` del Passaggio 6. Una query Dataverse risponde con un array `value`, e un riferimento di workflow può indicizzare dentro un array con le parentesi quadre, quindi l'id del caso è `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Aggiungi un blocco **API Post (JSON)** che chiude il caso:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: gli stessi del Passaggio 5, meno `Prefer`.
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` è un valore di `statuscode` nello stato Resolved — `5` è *Problem Solved*.

     **Prova questo corpo sul tuo ambiente prima di affidartici.** `CloseIncident` accetta due parametri, `IncidentResolution` e `Status`, ma Microsoft non ne pubblica alcun esempio HTTP — tutti i campioni ufficiali sono in C#. La forma qui sopra è la trasposizione convenzionale. Se il tuo ambiente la rifiuta, prova a identificare il caso con una semplice proprietà `"incidentid": "<the case id>"` al posto della forma `@odata.bind`, che è il modo in cui gli altri esempi di azioni Microsoft fanno riferimento a un record esistente.

**Perché non fare semplicemente un `PATCH` del caso a `statecode: 1`?** Puoi farlo — Microsoft documenta un `PATCH` di `statecode` e `statuscode` come l'equivalente Web API del vecchio messaggio SetState, ed è lo strumento giusto per spostare un caso tra stati attivi. Quello che non fa è creare l'attività **Case Resolution** che ci si aspetta da un caso risolto in Dynamics 365 Customer Service, e viene rifiutato senza appello in un ambiente in cui un amministratore ha configurato transizioni di stato personalizzate. Usa `CloseIncident` per risolvere; usa `PATCH` per tutto il resto. E ogni volta che scrivi `statecode`, imposta `statuscode` nella stessa richiesta — altrimenti Dynamics applica in silenzio lo `statuscode` predefinito associato a quel `statecode`.

`CloseIncident` proviene da Dynamics 365 Customer Service e non da Dataverse di base, e non è elencata nel riferimento delle azioni Dataverse. Se restituisce `404`, verifica che esista nel tuo ambiente recuperando `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` e cercando `CloseIncident`.

Per tutto ciò che non arriva a chiudere il caso — una nota, un aumento di priorità, un cambio di titolo — usa un blocco **API Patch (JSON)** verso `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` con un header `If-Match: *`, che impedisce a un upsert accidentale di creare un nuovo caso. Invia solo le colonne che stai modificando.

## In entrata — da Dynamics 365 a OneUptime

Ora l'altra direzione: qualcuno chiude il caso in Dynamics, oppure un operatore aggiunge una nota, e OneUptime deve saperlo.

### Costruisci prima il workflow ricevente

1. **Crea flusso di lavoro**, chiamalo `Dynamics 365 → OneUptime` e aggiungi il trigger **Webhook**.
2. Apri le **Impostazioni** di quel workflow e copia la **Chiave segreta del webhook**. Il tuo URL è:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Su un'installazione self-hosted, sostituisci il tuo host. Tratta l'URL come una password — chiunque ce l'abbia può avviare il workflow. Puoi rigenerare la chiave dalla stessa pagina.

3. Aggiungi un blocco **If / Else** che verifica un segreto condiviso prima che accada qualsiasi altra cosa. **Input 1** è `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — un valore che inventi tu e salvi come variabile globale segreta.
4. Dal ramo **Yes**, aggiungi un blocco **Update One Incident**:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: qualunque cosa il cambiamento del caso debba significare in OneUptime — un cambio di stato, una nota, un'etichetta.

   Per spostare l'incidente in uno stato ti servirà l'id di quello stato: un blocco **Find One Incident State** con la query `{"name": "Resolved"}` ti dà `{{local.components.incident-state-find-one-1.returnValues.model._id}}` da scrivere in `currentIncidentStateId`.

Lascialo abilitato e pronto. Ora dai a Dynamics qualcosa da chiamare.

### Opzione A — un flusso Power Automate (consigliata)

È la strada che dovrebbe prendere la maggior parte dei team: controlli tu il payload e non c'è niente da installare.

1. In [Power Automate](https://make.powerautomate.com), crea un **Automated cloud flow**.
2. Trigger: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — qualsiasi ambito più stretto scatta solo per le righe di cui sei proprietario tu o la tua business unit.
   - **Select columns**: `statecode,statuscode`. È un filtro valido solo per gli Update e vale la pena impostarlo bene. Le colonne lookup non sono supportate qui, e non elencare mai una colonna presente in ogni aggiornamento (come la chiave primaria), altrimenti il flusso scatta a ogni salvataggio.

3. Aggiungi **Microsoft Dataverse → Get a row by ID**, tabella `Cases`, row id preso dal trigger e un **Select columns** con `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Questa seconda chiamata vale quello che costa. In un aggiornamento il trigger porta con sé solo le colonne che sono cambiate, quindi gli identificatori su cui devi fare la corrispondenza potrebbero semplicemente non esserci.

4. Aggiungi l'azione integrata **HTTP**:

   - **Method**: `POST`
   - **URI**: l'URL webhook di OneUptime visto sopra
   - **Headers**: `Content-Type: application/json` e `X-OneUptime-Secret: <the same secret>`
   - **Body**: costruiscilo a partire dagli output di *Get a row by ID*, per esempio

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Salva e attiva il flusso.

Cose da sapere prima di scegliere definitivamente questa strada:

- Il **connettore Microsoft Dataverse è premium.** Per un flusso automatizzato serve la licenza solo al proprietario del flusso, non a tutti quelli che toccano il caso — ma se la licenza del proprietario decade, il flusso si ferma in silenzio.
- I trigger Dataverse sono **push, non polling** — Dynamics registra una callback e la invoca. La consegna avviene normalmente in pochi secondi; oltre i cinque minuti significa che il servizio asincrono è in arretrato, cosa che puoi verificare in **Settings → System Jobs** nell'admin center.
- Gli header personalizzati sopravvivono. Power Automate rimuove diverse famiglie di header standard dalle azioni HTTP (la maggior parte degli header `Accept-*` e `Content-*`, `Host`, `Origin`, `Cookie`), ma un header tuo come `X-OneUptime-Secret` viene lasciato passare.
- Il flusso deve stare nello stesso ambiente della tabella che osserva.
- Le richieste vengono conteggiate sull'allocazione di richieste Power Platform del tuo tenant, e il throttling del connettore compare come `429` dentro l'esecuzione del flusso.

### Opzione B — un webhook Dataverse nativo

Se Power Automate non è disponibile, Dataverse può chiamare OneUptime direttamente. Registra l'endpoint con il [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, dagli l'URL di OneUptime, scegli l'autenticazione **HttpHeader** e aggiungi `X-OneUptime-Secret` con il tuo segreto. Poi registra uno step sulla tabella **incident** per il messaggio **Update**, con **Filtering Attributes** limitati alle colonne che ti interessano, stage **PostOperation**, modalità di esecuzione **Asynchronous**.

Prendi questa strada a occhi aperti:

- **Solo le porte 80 e 443.** Un OneUptime self-hosted su qualsiasi altra porta non può essere registrato.
- **Dataverse non verifica il tuo segreto.** Invia l'header; rifiutare una richiesta che non lo porta è interamente compito del tuo workflow — ed è proprio a questo che serve il blocco **If / Else** del workflow ricevente.
- **Il payload non è un comodo oggetto JSON.** È un `RemoteExecutionContext` serializzato, in cui `InputParameters` è un *array* di coppie `{key, value}` e la riga modificata sta sotto la chiave `Target` con le sue colonne in un ulteriore array `Attributes`. Metti in conto l'aggiunta di un blocco **Run Custom JavaScript** per appiattirlo prima che qualsiasi altra cosa possa leggerlo.
- **Vengono incluse solo le colonne modificate** in un aggiornamento, quindi registra una **Post Image** se ti servono `ticketnumber` o la tua colonna con l'id OneUptime.
- **Sopra i 256 KB le parti interessanti vengono rimosse** — `InputParameters`, `PreEntityImages` e `PostEntityImages` spariscono tutti, e la richiesta porta un header `x-ms-dynamics-msg-size-exceeded`. `PrimaryEntityId` e `PrimaryEntityName` sopravvivono, quindi il ripiego è rileggere la riga attraverso la Web API.
- **La consegna è quasi implacabile.** Dataverse attende 60 secondi un `2xx` e riprova esattamente una volta, solo per `502`, `503` e `504`. Qualsiasi altra cosa — incluso un `500` dal tuo lato — non viene ritentata; finisce come System Job fallito.
- Scegli **Asynchronous**. Uno step sincrono blocca il salvataggio dell'operatore in attesa del tuo endpoint, e se poi la transazione viene annullata la richiesta è già partita e non può essere richiamata.

I workflow in background classici di Dynamics non hanno alcuno step HTTP o webhook, quindi non costituiscono una terza opzione.

## Fare lo stesso per gli allarmi

Tutto quello che precede è scritto intorno agli incidenti perché è il caso più comune, ma gli allarmi funzionano in modo identico — cambia il tipo di record e non cambia nient'altro:

| Incidente                                                    | Allarme                                             |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

Un workflow ha esattamente un trigger, quindi incidenti e allarmi richiedono un workflow ciascuno. Se i due dovessero fare lo stesso lavoro, costruisci una volta sola la parte Dynamics e richiamala da entrambi con il componente **Execute Workflow**.

## Risoluzione dei problemi

Leggi per prima cosa il blocco che fallisce in **Esecuzioni e registri** — entrambi gli endpoint Microsoft restituiscono un corpo JSON esplicativo, e il componente API lo conserva in `response-body`.

**La richiesta del token fallisce con `400` e `invalid_request` o un grant type non supportato.** L'header `Content-Type` non è esattamente `Content-Type: application/x-www-form-urlencoded`, quindi il corpo è partito come JSON. Controlla le maiuscole.

**`400` con `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** Lo `scope` non è l'URL del tuo ambiente più `/.default`. Copia l'URL da **Developer resources** ed elimina la barra finale e qualsiasi percorso `/api/data/...`.

**`401 Unauthorized` da Dynamics.** L'header `Authorization` manca, è malformato, oppure il token è scaduto durante l'esecuzione. Deve leggersi `Bearer <token>` con un solo spazio.

**`403 Forbidden` con `0x80072560`, "The user isn't a member of the organization".** Il Passaggio 2 è stato saltato oppure l'application user è legato a un'altra registrazione dell'app. Il token va bene; è l'utente dal lato Dynamics che non c'è.

**`403 Forbidden` con un errore di privilegi.** L'application user esiste ma il suo ruolo di sicurezza personalizzato non ha Create, Read o Write su **Case**.

**`400 Bad Request` che nomina il cliente.** `customerid` è obbligatorio. Imposta `customerid_account@odata.bind` oppure `customerid_contact@odata.bind`, scritti esattamente così, con un URI che inizia con una barra, per esempio `/accounts(<guid>)`.

**`404 Not Found` su `/CloseIncident`.** L'azione è di Dynamics 365 Customer Service. Cercala nel `$metadata` del tuo ambiente prima di dare per scontato che sia disponibile.

**`412 Precondition Failed` con `DuplicateRecord`.** Una regola di rilevamento duplicati ha trovato una corrispondenza. O restringi la regola, o smetti di inviare il campo su cui fa corrispondenza.

**`429 Too Many Requests`.** Sono i limiti di protezione del servizio di Dataverse — all'incirca 6.000 richieste e 20 minuti di tempo di esecuzione per utente in una qualsiasi finestra di cinque minuti, per server web. La risposta contiene un `Retry-After` in secondi. Se un workflow procede a raffica, mettici dentro un blocco **Delay** oppure sposta il lavoro su un workflow pianificato che opera a lotti.

**A OneUptime non arriva niente.** Invia tu stesso una richiesta all'URL del webhook con `curl` e controlla le **Esecuzioni e registri** del workflow. Se la tua richiesta compare e quella di Dynamics no, il problema è a monte: per Power Automate, guarda la cronologia delle esecuzioni del flusso; per un webhook nativo, guarda in **Settings → System Jobs** filtrando sui fallimenti.

**Il workflow viene eseguito ma l'incidente non cambia.** Un blocco **Update One Incident** riporta `Items Updated: 0` quando la query non ha trovato corrispondenze — è un successo, non un errore. Verifica che l'id nel payload sia l'id dell'incidente OneUptime e che tu stia interrogando `_id`.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — i pattern in entrata e in uscita e la guida rapida all'autenticazione.
- [Jira](/docs/integrations/jira) — la stessa costruzione bidirezionale su Jira.
- [Panoramica dei workflow](/docs/workflows/index) e [Creare un workflow](/docs/workflows/authoring) — la tela, gli identificatori e come accendere un workflow.
- [Componenti](/docs/workflows/components) — i blocchi API, If / Else e i componenti sui dati di OneUptime.
- [Variabili](/docs/workflows/variables) — i segreti e la lettura dell'output di un blocco dal successivo.
- [Configurazione e sicurezza](/docs/workflows/configuration) — sicurezza dei webhook e accesso di rete in uscita.
- [Indirizzi IP](/docs/configuration/ip-addresses) — gli intervalli in uscita di OneUptime, se Dynamics sta dietro una allow list.
