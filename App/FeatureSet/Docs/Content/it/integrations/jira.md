# Integrazione con Jira

Apri un ticket [Jira](https://www.atlassian.com/software/jira) ogni volta che viene dichiarato un incidente OneUptime, mantienilo allineato mentre l'incidente evolve e lascia che Jira rimandi i cambi di stato dentro OneUptime — il tutto con un [Workflow](/docs/workflows/index). Non c'è nessun blocco specifico per Jira da installare: OneUptime chiama la REST API di Jira con il [componente API](/docs/workflows/components#api), e Jira richiama un [trigger Webhook](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Questa pagina costruisce entrambe le direzioni. Tutto ciò che precede la sezione in entrata è scritto per **Jira Cloud**; una sezione verso la fine elenca che cosa cambia su **Jira Data Center**.

> Atlassian sta rinominando le cose in Jira Cloud: un **project** ora è uno **space** in gran parte dell'interfaccia, e un **issue** è un **work item**. I tenant usano entrambi i vocabolari, quindi qui sotto, dove la differenza conta, trovi entrambe le diciture.

## Prerequisiti

- Un sito Jira Cloud (`https://your-domain.atlassian.net`) e un progetto in cui archiviare i ticket. Annota la sua **project key** — l'`OPS` in `OPS-1234`.
- Un account Jira che può creare ticket in quel progetto e un **API token** per quell'account, ottenuto da [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Usa un account di servizio anziché quello di una persona — i ticket creati in questo modo vengono attribuiti al proprietario del token.
- L'autorizzazione a creare regole di automazione in quel progetto, per la metà in entrata.
- Un progetto OneUptime in cui puoi creare workflow e variabili globali.

## Passaggio 1 — Salva le credenziali Jira come segreto

La REST API di Jira Cloud accetta la **Basic auth** costruita a partire dall'email del tuo account Atlassian e da un token API, codificati insieme in base64.

1. Codifica una volta `email:api_token`:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Usa `printf`, non `echo`. `echo` aggiunge un carattere di nuova riga, quella nuova riga viene codificata insieme a tutto il resto e Jira risponde `401` per motivi invisibili nella stringa che hai incollato.

2. In OneUptime, vai su **Flussi di lavoro → Variabili globali → Crea**. Chiamala `JIRA_AUTH`, incolla la stringa base64 come **Contenuto** e attiva **Segreto**.
3. Aggiungi una seconda variabile, non segreta, `JIRA_URL` con il valore `https://your-domain.atlassian.net` senza barra finale.

Ora qualsiasi blocco può usare `Basic {{global.variables.JIRA_AUTH}}` come header `Authorization`, e il token non compare mai nel workflow né nei log delle sue esecuzioni. Vedi [Variabili](/docs/workflows/variables).

Due cose sui token API di Atlassian che prima o poi colpiranno un'integrazione che nessuno sta guardando:

- **Scadono.** I token vengono creati con una durata compresa tra un giorno e un anno, un anno per impostazione predefinita, e non esiste un rinnovo — un token scaduto va sostituito a mano sulla stessa pagina e ricodificato dentro `JIRA_AUTH`. Segnati da qualche parte in calendario la data di scadenza. Quando un workflow che ha funzionato per mesi comincia a rispondere `401`, il motivo è questo.
- **Un token con scope richiede un URL di base diverso.** La pagina dei token offre **Create API token with scopes** oltre al classico **Create API token**. I token con scope sono la scelta più sicura, ma non sono indirizzati al tuo sito: vanno su `https://api.atlassian.com/ex/jira/<cloudId>`, quindi `JIRA_URL` diventa quello, e tutti i percorsi qui sotto ci si agganciano invariati. Il tuo `cloudId` è nel JSON su `https://your-domain.atlassian.net/_edge/tenant_info`. Un token con scope inviato a `your-domain.atlassian.net` semplicemente fallisce.

Se la tua organizzazione usa la gestione utenti centralizzata di Atlassian, c'è una terza opzione che aggira il problema della scadenza: una [credenziale OAuth 2.0 per un account di servizio](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). Ti dà un client id e un secret invece di un token, e un workflow li scambia con un access token di breve durata all'inizio di ogni esecuzione — la stessa struttura a due blocchi usata dalla pagina [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365), con un blocco **API Post (JSON)** che recupera il token e tutto ciò che viene dopo che invia `Bearer <token>`. Non c'è niente da sostituire a mano un anno dopo. La pagina di Atlassian contiene la richiesta esatta del token; l'URL di base dell'API è `https://api.atlassian.com`.

## Passaggio 2 — Apri un ticket Jira per ogni incidente

1. Apri **Flussi di lavoro → Crea flusso di lavoro**, chiamalo `Incidents → Jira` e apri il **Costruttore**.
2. Clicca sul blocco segnaposto tratteggiato e aggiungi il trigger **On Create Incident**. Nel suo **Select Fields**, richiedi le colonne che vuoi inviare:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Lascia il suo **Identifier** su `incident-on-create-1` — è il nome con cui lo richiamano i blocchi successivi.

3. Clicca **Aggiungi componente**, aggiungi un blocco **API Post (JSON)** e trascina dal punto **Success** del trigger al punto di ingresso del nuovo blocco. Aprilo, imposta il suo **Identifier** su `create-issue` e compila:

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   Sostituisci `OPS` con la tua project key e `Bug` con un tipo di ticket che esiste in quel progetto. Entrambi si possono indicare anche per id — `{"id": "10000"}` — che è la forma usata dagli esempi ufficiali di Atlassian ed è quella da preferire se due tipi di ticket nel tuo sito hanno lo stesso nome. Le chiamate a `createmeta` più avanti ti forniscono quegli id.

La descrizione sembra pesante perché l'API v3 di Jira Cloud accetta il testo formattato come **Atlassian Document Format** — un albero di documento, non una stringa. La forma qui sopra è il documento valido minimo: un paragrafo che contiene un nodo di testo. Lo stesso vale per `environment` e per qualsiasi campo personalizzato di testo multiriga; i campi personalizzati di testo su una riga accettano ancora una stringa semplice.

Ora accendi il workflow da **Panoramica → Modifica flusso di lavoro → Abilitato**, dichiara un incidente di test e apri **Esecuzioni e registri**. Il blocco `create-issue` dovrebbe mostrare un `201` e un corpo contenente `id`, `key` e `self` del nuovo ticket. Le modifiche sulla tela si salvano da sole — non c'è nessun pulsante Salva, e un workflow disabilitato non può essere eseguito in alcun modo, nemmeno a mano.

La chiave del nuovo ticket è disponibile per qualsiasi blocco successivo a questo:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Compilare altri campi

Alcune aggiunte comuni dentro `fields`:

- **Priorità** — `"priority": { "id": "20000" }`, usando un id di priorità del tuo sito. Per mappare le gravità OneUptime sulle priorità Jira, metti un blocco **If / Else** tra il trigger e il blocco API e ramifica su `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Assegnatario** — `"assignee": { "id": "<accountId>" }`. Jira Cloud identifica le persone tramite l'account id Atlassian; `username` e `userKey` sono stati rimossi dall'API Cloud anni fa.
- **Etichette** — `"labels": ["oneuptime", "sev1"]`, un array piatto di stringhe. Le etichette non possono contenere spazi.
- **Componenti** — `"components": [{ "id": "10000" }]`.
- **Campi personalizzati** — `"customfield_10034": "..."`, usando l'id del campo stesso. La forma del valore dipende dal tipo del campo: un select singolo accetta `{"value": "red"}`, un select multiplo un array di id, un campo di testo multiriga un documento Atlassian Document Format.

Per scoprire che cosa richiede davvero un progetto, chiedilo a Jira invece di tirare a indovinare. Elenca i tipi di ticket di un progetto, poi i campi di uno di essi:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

La seconda chiamata elenca ogni campo che quel tipo di ticket accetta, quali di essi sono obbligatori e gli id `customfield_NNNNN` esatti. Per leggere gli id da un ticket che hai già, recuperalo con `?expand=names`.

## Passaggio 3 — Porta l'id dell'incidente dentro Jira

Entrambe le metà di una sincronizzazione bidirezionale hanno bisogno che un sistema conservi l'identificatore dell'altro, e Jira è il posto migliore dove tenerlo: la colonna `customFields` di OneUptime è un unico blob JSON, quindi scrivere un valore da un workflow sostituisce ogni campo personalizzato di quell'incidente.

**Se hai un admin Jira.** Aggiungi un campo personalizzato di testo breve — chiamalo *OneUptime Incident ID* — alla schermata di creazione del progetto, trovane l'id con `createmeta` e impostalo insieme a tutto il resto:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Se non ce l'hai.** Mettilo invece in un'etichetta. Le etichette non accettano spazi e un id OneUptime è un semplice UUID, quindi `oneuptime-<id>` è un'etichetta valida:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

Il workflow in entrata dovrà poi estrarre quell'etichetta dall'elenco, il che sono un paio di righe in un blocco **Run Custom JavaScript**. Il campo personalizzato è più pulito, se puoi averlo.

Già che ci sei, vale la pena aggiungere sul ticket Jira un link che riporta all'incidente. Un blocco **API Post (JSON)** dopo `create-issue`, puntato su `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, con:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

dà a chiunque in Jira un percorso di ritorno in un clic. Per questo aggiungi `projectId` al **Select Fields** del trigger. È il `globalId` a rendere la chiamata ripetibile senza rischi: Jira aggiorna il link che porta già quell'id invece di aggiungerne un secondo. Poiché un aggiornamento azzera anche tutto ciò che ometti, invia sempre l'`object` completo, non una sua parte.

## Passaggio 4 — Commenta e sposta il ticket mentre l'incidente evolve

Costruiscilo come **secondo** workflow, così un errore qui non potrà mai impedire l'apertura dei ticket.

1. **Crea flusso di lavoro**, chiamalo `Incident updates → Jira` e aggiungi il trigger **On Update Incident**.
2. In **Listen on**, metti `{"currentIncidentStateId": true}`. Il trigger scatterà così solo per i cambi di stato invece che a ogni modifica. In **Select Fields**, richiedi `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Aggiungi un blocco **If / Else**: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — o comunque si chiami lo stato risolto nel tuo progetto. Vedi [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

Dal ramo **Yes** devi prima trovare il ticket che hai aperto nel Passaggio 2. Chiedilo a Jira tramite l'id che hai salvato nel Passaggio 3, con un blocco **API Post (JSON)** il cui **Identifier** è `find-issue`:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  Se hai usato un campo personalizzato invece di un'etichetta, la clausola diventa `cf[10050] ~ \"...\"` con l'id del tuo campo.

L'id del ticket è allora `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, e ogni endpoint qui sotto accetta un id con la stessa naturalezza con cui accetta una key.

Di questo endpoint vale la pena sapere tre cose. **Invia il JQL nel corpo, non metterlo nell'URL** — una query string che contiene `=` dentro un valore viene troncata mentre esce da un workflow, e il JQL non è altro che una sfilza di `=`. **La query deve essere delimitata**: un semplice `order by key desc` viene rifiutato con `400`, ed è per questo che c'è la clausola `project =`. E `/rest/api/3/search/jql` è l'endpoint attuale — il più vecchio `/rest/api/3/search` è deprecato e in via di rimozione, quindi non usarlo.

**Lasciare un commento** è un singolo blocco **API Post (JSON)** verso `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`, con un corpo in Atlassian Document Format proprio come la descrizione:

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**Spostare il ticket** richiede due chiamate, perché una transizione è identificata da un id che cambia da un workflow all'altro e, su alcune board, da un ticket all'altro.

1. Un blocco **API Get (JSON)** su `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` restituisce le transizioni disponibili *dallo stato attuale del ticket*, ognuna con un `id` e un `name`, più un oggetto `to` che indica lo stato a cui porta.
2. Un blocco **API Post (JSON)** verso lo stesso URL ne esegue una:

   ```json
   { "transition": { "id": "31" } }
   ```

Una transizione riuscita risponde `204` senza corpo. Se preferisci non leggere l'elenco a runtime, chiamalo una volta a mano per un ticket nello stato giusto e scrivi l'id fisso nel blocco — ricorda però che è legato a quel workflow, quindi un admin che modifica il workflow Jira può romperlo silenziosamente.

## In entrata — da Jira a OneUptime

Ora l'altra direzione: qualcuno sposta il ticket su Done e l'incidente OneUptime deve seguirlo.

### Costruisci prima il workflow ricevente

1. **Crea flusso di lavoro**, chiamalo `Jira → OneUptime` e aggiungi il trigger **Webhook**.
2. Apri le **Impostazioni** di quel workflow e copia la **Chiave segreta del webhook**. Il tuo URL è:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Le installazioni self-hosted usano il proprio host. Tratta l'URL come una password — chiunque ce l'abbia può avviare il workflow — e rigenera la chiave da quella stessa pagina se dovesse trapelare.

3. Aggiungi un blocco **If / Else** che verifica un segreto condiviso prima che venga eseguito qualsiasi altra cosa. **Input 1** è `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** è `{{global.variables.JIRA_WEBHOOK_SECRET}}` — un valore che inventi tu e salvi come variabile globale segreta.
4. Dal ramo **Yes**, aggiungi un blocco **Update One Incident**:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: che cosa deve significare qui il cambiamento su Jira — di solito un cambio di stato.

   Spostare un incidente richiede l'id dello stato di destinazione, che un blocco **Find One Incident State** con la query `{"name": "Resolved"}` ti restituisce come `{{local.components.incident-state-find-one-1.returnValues.model._id}}`. Scrivilo in `currentIncidentStateId`.

Lascia il workflow abilitato. Ora dai a Jira qualcosa da chiamare.

### Invia l'evento da una regola di automazione Jira

1. In Jira, apri le regole di automazione del progetto: **Space settings → Automation** sui tenant più recenti, **Project settings → Automation** su quelli più vecchi. Per una regola che copre più progetti usa **Settings → System → Global automation**, che richiede il permesso globale *Administer Jira*.
2. **Create rule**, poi scegli il trigger **Work item transitioned** — **Issue transitioned** sui tenant più vecchi. Impostalo perché venga eseguito quando lo stato passa *a* **Done**.

   Usa questo trigger, non *Work item updated*: il trigger di aggiornamento esclude deliberatamente i cambi di stato.

3. Aggiungi l'azione **Send web request** e configurala:

   - **Web request URL**: l'URL webhook di OneUptime visto sopra.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, e `X-OneUptime-Secret` / il tuo segreto condiviso. Usa l'opzione **Hide** sul valore del segreto in modo che gli altri editor della regola non possano leggerlo — tieni presente che l'occultamento è irreversibile per quel valore e che i valori nascosti vanno persi se la regola viene esportata o duplicata.
   - **Web request body**: **Custom format**, così sei tu a controllarne la forma:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     Se nel Passaggio 3 hai usato un'etichetta invece di un campo personalizzato, invia `"labels": "{{issue.labels}}"` ed estrai l'id con un blocco **Run Custom JavaScript** dal lato OneUptime.

4. Attiva la regola, sposta un ticket di test su Done e controlla entrambi i lati: l'audit log della regola in Jira ed **Esecuzioni e registri** in OneUptime.

Cose che vale la pena sapere prima di affidarti a questo meccanismo:

- **La porta di destinazione è limitata.** Send web request raggiunge solo le porte 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 e 9900. OneUptime Cloud è sulla 443; un'installazione self-hosted su una porta insolita non può essere chiamata in questo modo.
- **Non esiste una firma delle richieste.** L'azione non ha un'opzione HMAC, quindi un segreto condiviso in un header su HTTPS è il meccanismo documentato da Atlassian. È il controllo **If / Else** del Passaggio 3 del workflow ricevente a renderlo utile.
- **Le esecuzioni delle regole sono contate.** Jira Cloud conteggia le esecuzioni riuscite delle regole su un massimale mensile che dipende dal tuo piano — 100 su Free, 1.700 su Standard, 1.000 × utenti su Premium, illimitate su Enterprise. Una regola che scatta a ogni transizione in un progetto trafficato si somma in fretta.
- **I valori non vengono codificati per l'URL** al posto tuo. Conta solo se invii un corpo form-encoded; il JSON qui sopra va bene.
- **Atlassian pubblica i suoi intervalli di uscita** su [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com), se la tua installazione OneUptime sta dietro una allow list. Cambiano, quindi interroga periodicamente il feed invece di fissare gli indirizzi.

### Oppure usa un webhook Jira

Un admin Jira può registrare un webhook direttamente in **Settings → System → Advanced → WebHooks**, scegliendo gli eventi da inviare e, facoltativamente, una query JQL che restringe quali ticket lo attivano. Rispetto a una regola di automazione:

- Il payload è quello di Jira, non il tuo: `webhookEvent`, `issue_event_type_name`, l'intero `issue` e un `changelog` il cui array `items` contiene il prima e il dopo di ogni campo modificato. Per un cambio di stato ti serve la voce in cui `field` vale `status`. Leggerla dentro un workflow di solito significa un blocco **Run Custom JavaScript**.
- I webhook **possono** essere firmati — dai un segreto al webhook e Jira invia un header `X-Hub-Signature` che contiene un HMAC del corpo della richiesta — ma un workflow non può verificarlo. La firma copre i byte esatti inviati da Jira, e il trigger Webhook consegna al workflow un corpo già interpretato come JSON, quindi non resta più nulla da sottoporre all'hash. Se vuoi autenticare la richiesta, usa piuttosto una regola di automazione con un header a segreto condiviso.
- L'URL deve essere HTTPS su una porta presa dall'elenco di Jira, che *non* è lo stesso elenco usato dall'azione di automazione — qui la porta 80 non è ammessa.
- La consegna viene ritentata fino a cinque volte con un backoff da cinque a quindici minuti, quindi il tuo workflow deve tollerare che lo stesso evento arrivi due volte.

I webhook registrati da un'app tramite `/rest/api/3/webhook` sono ancora un'altra cosa: scadono 30 giorni dopo la registrazione se non vengono rinnovati. Quelli registrati dall'admin visti sopra non scadono.

## Jira Data Center

Jira self-managed funziona allo stesso modo con una manciata di sostituzioni. **Jira Server** ha raggiunto la fine del supporto a febbraio 2024 e non riceve più correzioni, quindi considera Data Center come il bersaglio self-managed.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — su Data Center non esiste la v3                          |
| `description` come documento Atlassian Document Format | `description` come stringa semplice in wiki markup                      |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| API token da id.atlassian.com                     | **Profile → Personal access tokens → Create token** sul tuo account Jira      |
| Azione di automazione **Send web request**        | Azione di automazione **Send outgoing web request**                          |

Quindi il blocco create-issue diventa un `POST` verso `/rest/api/2/issue` con:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

che è più semplice da mettere in un template — nessun albero di documento.

Altre differenze da mettere in conto:

- **I personal access token** esistono a partire da Jira Core e Jira Software 8.14 e da Jira Service Management 4.15. Scadono — 365 giorni per impostazione predefinita — e l'interfaccia ne segnala uno come *Expires soon* cinque giorni prima. La Basic auth con nome utente e password funziona ancora su Data Center, ma qualche accesso fallito attiva un CAPTCHA che esclude del tutto l'account dalla REST API finché una persona non lo sblocca da un browser, il che è un pessimo modo di scoprire un refuso. Meglio un token.
- **L'automazione è inclusa** a partire da Jira Data Center 10.0. Prima era l'app Automation for Jira, da installare a parte. La sua richiesta in uscita ha un timeout predefinito di 3000 ms, regolabile con la proprietà `outgoing.webhook.timeout.ms`.
- **I webhook** si registrano in **Administration → System → Advanced → WebHooks**, e la delimitazione tramite JQL è supportata. Tieni quei filtri stretti: Jira valuta il JQL di ogni webhook registrato sul thread che ha generato l'evento, quindi una dozzina di filtri larghi rallenta l'azione utente che li ha attivati.
- **Da Data Center 10.0 la consegna dei webhook è asincrona** e non esiste un'opzione sincrona, quindi gli eventi possono arrivare fuori ordine. Rendi idempotente il workflow ricevente.
- **Jira 10 ha eliminato il `$` nelle variabili degli URL dei webhook** — `${issue.id}` è diventato `{issue.id}` — e ha spostato la risorsa REST dei webhook da `/rest/webhooks/1.0/webhook` a `/rest/jira-webhook/1.0/webhooks`.

## Fare lo stesso per gli allarmi

Tutto quello che precede è scritto intorno agli incidenti perché è il caso più comune, ma gli allarmi funzionano in modo identico — cambia il tipo di record e non cambia nient'altro:

| Incidente                                | Allarme                                     |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

Un workflow ha esattamente un trigger, quindi incidenti e allarmi richiedono un workflow ciascuno. Se i due dovessero fare lo stesso lavoro, costruisci una volta sola la parte Jira e richiamala da entrambi con il componente **Execute Workflow**.

## Risoluzione dei problemi

Apri per prima cosa il blocco che fallisce in **Esecuzioni e registri**. Jira restituisce un corpo JSON che indica esattamente che cosa ha rifiutato, e il componente API lo conserva in `response-body`.

**`401 Unauthorized`.** Ricodifica `email:api_token` con `printf` e aggiorna `JIRA_AUTH`; un carattere di nuova riga finale lasciato da `echo` è la causa abituale. Poi verifica che l'account proprietario del token possa creare ticket in quel progetto. Su Data Center, controlla di inviare `Bearer` e non `Basic`.

**`400 Bad Request` che nomina un campo.** Il tipo di ticket non esiste nel progetto, oppure il progetto ha un campo obbligatorio che non stai inviando. Esegui le chiamate `createmeta` viste sopra su quel progetto e quel tipo di ticket e confronta.

**`400` che si lamenta di `description`.** Su Cloud v3 la descrizione deve essere un documento Atlassian Document Format, non una stringa. Invia il documento mostrato sopra, oppure passa quel blocco a `/rest/api/2/issue` e invia testo semplice.

**`404 Not Found`.** Controlla l'URL di base e la versione dell'API — `/rest/api/3/...` su Cloud, `/rest/api/2/...` su Data Center.

**`429 Too Many Requests`.** Jira sta applicando un rate limit. La risposta contiene `Retry-After` in secondi e un `RateLimit-Reason` che indica quale limite hai raggiunto. Le scritture su un singolo ticket hanno un tetto molto basso — nell'ordine di venti in due secondi — quindi un workflow che commenta e sposta il ticket in rapida successione può superarlo su un ticket solo. Metti un blocco **Delay** tra le chiamate, oppure sposta il lavoro di massa su un workflow pianificato.

**La chiamata di transizione restituisce `400`.** L'id della transizione non è valido dallo stato *attuale* del ticket. Recupera `/transitions` per quel ticket e usa un id preso dalla risposta.

**La regola di automazione risulta riuscita ma a OneUptime non arriva niente.** Controlla prima la porta — vedi l'elenco delle porte consentite qui sopra. Poi invia tu stesso una richiesta all'URL del webhook con `curl` e guarda se compare in **Esecuzioni e registri**; se la tua arriva e quella di Jira no, il problema è dal lato Jira.

**Il workflow viene eseguito ma l'incidente non cambia.** Un blocco **Update One Incident** riporta `Items Updated: 0` quando la sua query non ha trovato corrispondenze, e questo conta come successo, non come errore. Verifica che l'id nel payload sia davvero l'id dell'incidente OneUptime e che tu stia interrogando `_id`.

**Un riferimento `{{...}}` compare letteralmente in un ticket Jira.** Un riferimento non risolto viene passato così com'è come testo, invece di essere svuotato. Il log dell'esecuzione indica ogni riferimento che non si è risolto — di solito un identificatore di blocco digitato male o una variabile rinominata.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — i pattern in entrata e in uscita e la guida rapida all'autenticazione.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — la stessa costruzione bidirezionale su Dynamics.
- [Panoramica dei workflow](/docs/workflows/index) e [Creare un workflow](/docs/workflows/authoring) — la tela, gli identificatori e come accendere un workflow.
- [Componenti](/docs/workflows/components) — i blocchi API, If / Else e i componenti sui dati di OneUptime.
- [Variabili](/docs/workflows/variables) — i segreti e la lettura dell'output di un blocco dal successivo.
- [Configurazione e sicurezza](/docs/workflows/configuration) — sicurezza dei webhook e accesso di rete in uscita.
- [ServiceNow](/docs/integrations/servicenow) e [PagerDuty](/docs/integrations/pagerduty) — lo stesso pattern in uscita per altri strumenti.
