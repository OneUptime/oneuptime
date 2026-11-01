# Google Workspace

Importa i log di audit di [Google Workspace](https://workspace.google.com) negli eventi di sicurezza di OneUptime: gli accessi e ciò che Google vi ha segnalato, le modifiche degli amministratori, le app a cui è stato dato accesso ai dati, il single sign-on, le impostazioni di sicurezza degli account e, se vuoi, i file condivisi fuori dall'organizzazione o scaricati in Google Drive. Lì li cerchi accanto a log, trace e metriche, li correli con ogni altra fonte e chiami la reperibilità per quelli che contano. OneUptime li legge con un account di servizio che agisce come uno dei tuoi amministratori, e non cambia nulla in Google Workspace.

:::cards
- [Configurare la connessione](#configurare-la-connessione): Un account di servizio, la delega a livello di dominio e il modulo della connessione.
- [Cosa viene importato](#cosa-viene-importato): Quali attività, e come ognuna diventa un evento di sicurezza.
- [Come funziona il polling](#come-funziona-il-polling): La finestra che legge ogni interrogazione, e perché si sovrappone di 2 ore alla precedente.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Cosa significa ogni errore e cosa cambiare.
:::

## Come funziona

```mermaid title="Da un'attività di Google Workspace a un evento di sicurezza"
flowchart TB
    gws["Google Workspace<br/>registra<br/>un'attività"] --> poll["OneUptime interroga<br/>all'intervallo della<br/>connessione"]
    poll --> token["Il suo account<br/>di servizio agisce<br/>come il tuo<br/>amministratore"]
    token --> list["Elenca le attività<br/>di ogni log<br/>dall'ultima volta"]
    list --> event["Ognuno è salvato<br/>come evento OCSF<br/>del suo tipo"]
```

Ogni minuto, OneUptime interroga ogni connessione abilitata il cui intervallo di polling è trascorso. Un'interrogazione accede come il tuo account di servizio per conto dell'amministratore che indichi, ed elenca le attività di ogni log di audit dall'ultima interrogazione ([Activities: list](https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities/list)): amministrazione, accessi, token OAuth, SAML, sicurezza degli account e, quando l'opzione **Attività di Drive** è attiva, Drive. Ogni evento di un'attività viene salvato come un evento [OCSF](https://schema.ocsf.io/): un accesso come un evento Authentication, un ruolo di amministratore assegnato come un evento User Access Management, un accesso segnalato da Google come un Detection Finding.

## Prima di iniziare

- In OneUptime, il ruolo Project Owner, Project Admin o Security Admin. I ruoli Security Member e Security Viewer vedono le connessioni e la cronologia delle loro esecuzioni, ma non possono modificarle.
- Un super amministratore di Google Workspace, per consentire la delega a livello di dominio, e un amministratore che l'account di servizio impersona, con il privilegio Reports. Un super amministratore ce l'ha.
- Un progetto Google Cloud in cui puoi creare un account di servizio e attivare la Admin SDK API.
- Per l'attività di Drive, un'edizione con il log di audit di Drive, come Business Standard, Business Plus, Enterprise o Education.
- HTTPS in uscita dall'app e dai worker di OneUptime verso `oauth2.googleapis.com` e `admin.googleapis.com`.

## Configurare la connessione

La connessione accede con la chiave di un account di servizio e la [delega a livello di dominio](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority), con un unico ambito di sola lettura: `https://www.googleapis.com/auth/admin.reports.audit.readonly`.

:::steps
### Creare un account di servizio e una chiave

1. Nella [console di Google Cloud](https://console.cloud.google.com), scegli un progetto, apri **APIs & Services → Library**, cerca **Admin SDK API** e seleziona **Enable**.
2. Apri **IAM & Admin → Service accounts → Create service account**, chiamalo `oneuptime-security-events` e seleziona **Done**. Non ha bisogno di alcun ruolo nel progetto.
3. Apri l'account di servizio e copia il suo **Unique ID**, l'ID client che la delega indica. Nella scheda **Keys**, seleziona **Add key → Create new key → JSON**, e conserva il file: è la chiave.

### Consentire la delega a livello di dominio

1. Nella [Console di amministrazione Google](https://admin.google.com), come super amministratore, apri **Security → Access and data control → API controls → Manage domain-wide delegation** e seleziona **Add new**.
2. Inserisci il **Unique ID** dell'account di servizio come **Client ID**, e `https://www.googleapis.com/auth/admin.reports.audit.readonly` come unico **OAuth scope**. Seleziona **Authorize**. Google può impiegare qualche minuto per applicarlo.

### Aggiungere la connessione in OneUptime

Apri **Prodotti → Security Events → Connessioni** (`/dashboard/{projectId}/security-events/connections`), fai clic su **Aggiungi connessione**, scegli **Google Workspace** in **Identità** e fai clic su **Avanti**. Inserisci l'**Administrator email**, fai clic su **Avanti** e incolla il contenuto del file della chiave in **JSON dell'account di servizio**. Nel passaggio **Interrogazione**, attiva **Attività di Drive** per leggere anche Drive.

### Provarla prima di salvare

Fai clic su **Prova queste impostazioni** in **Testa prima di salvare**. Il test accede e legge i log degli accessi e di amministrazione con i valori del modulo, e non salva nulla, quindi una delega mancante emerge prima che la connessione esista. Poi fai clic su **Avanti**, dai alla connessione un **Nome** e creala.
:::

| Impostazione | Cosa inserire |
| --- | --- |
| **Administrator email** | L'indirizzo dell'amministratore che l'account di servizio impersona, per esempio `admin@example.com`. Deve avere il privilegio Reports. |
| **Attività di Drive** | Facoltativa, disattivata per impostazione predefinita. Se attiva, ogni interrogazione legge anche le condivisioni e i download di Drive. |
| **JSON dell'account di servizio** | L'intero file della chiave, che contiene `client_email` e `private_key`. È cifrato, mai restituito dall'API e mai più mostrato. Sostituiscilo con **Aggiorna le credenziali** sulla connessione. |

Il passaggio **Interrogazione** ha anche una **Descrizione** facoltativa, il **Intervallo di interrogazione (minuti)**, un numero intero da `1` a `1440` che parte da `5`, e **Abilitato**, che parte attivo.

## Cosa viene importato

Ogni evento ha il fornitore `Google` e il prodotto `Google Workspace`. Un'attività che contiene più eventi diventa un evento di sicurezza per ciascuno, e ogni evento conserva i campi dell'attività e i propri, come `event.name`, `event.type` e `parameters.<name>`, così una regola li legge con i nomi di Google.

| Log | Eventi | Classe OCSF | Gravità |
| --- | --- | --- | --- |
| Accessi (`login`) | `login_success`, `login_failure` con il suo motivo, `login_challenge`. Una disconnessione viene letta ma non importata. | Authentication (`3002`) | Informational; Low per un accesso non riuscito; Medium quando Google lo segna come `is_suspicious` |
| Rilevamenti di Google (`login`) | `suspicious_login` e le sue varianti, `gov_attack_warning`, `account_disabled_hijacked` e gli altri account che Google ha disattivato | Detection Finding (`2004`) | Medium; High per un attacco sostenuto da un governo, un account dirottato o una password trapelata |
| Amministrazione (`admin`) | Privilegi e ruoli di amministratore concessi o revocati, delega a livello di dominio, utenti creati, eliminati o sospesi, verifica in due passaggi disattivata, membri dei gruppi, impostazioni | User Access Management (`3005`), Account Change (`3001`), Group Management (`3006`), Entity Management (`3004`) | Medium per un potere concesso; Low per un utente eliminato o una verifica in due passaggi disattivata |
| Token OAuth (`token`) | Un'app a cui è stato dato accesso ai dati di qualcuno, con i suoi ambiti, o a cui quell'accesso è stato tolto | Authorize Session (`3003`) | Informational |
| SAML (`saml`) | Single sign-on in un'app | Authentication (`3002`) | Low per un accesso non riuscito |
| Sicurezza degli account (`user_accounts`) | Modifiche alla verifica in due passaggi, alla password e al recupero | Account Change (`3001`) | Low quando indebolisce l'account |
| Drive (`drive`), con l'opzione attiva | `change_user_access`, `change_document_visibility`, `change_document_access_scope`, `change_acl_editors`, `download` | File Hosting Activity (`6006`) | Low per un file condiviso fuori dal dominio del proprietario o aperto a un link |

Le regole della libreria per Google Workspace li leggono come vengono importati qui, come quelle per un accesso segnalato da Google, privilegi di amministratore concessi e un file reso pubblico in Drive.

## Come funziona il polling

- **Le attività vengono lette in base a quando sono avvenute.** La Reports API non ha un altro orario con cui elencarle, e Google documenta che i suoi log arrivano con minuti o ore di ritardo.
- **La prima interrogazione guarda indietro di 24 ore**, così una nuova connessione mostra subito le sue attività recenti.
- **Ogni interrogazione successiva parte 120 minuti prima del cursore salvato**, così un'attività che Google rende leggibile fino a 2 ore in ritardo viene letta all'interrogazione successiva, e i duplicati vengono scartati in base all'ID di ogni evento all'interno del progetto. Una che arriva più tardi non viene letta dal polling: importa il suo intervallo di tempo da **Diagnostica**.
- **Un'interrogazione legge al massimo 24 ore oltre il cursore.** Una connessione il cui cursore è rimasto indietro recupera in una serie di finestre di 24 ore.
- **Drive viene letto un evento alla volta**, poiché Drive registra ogni file che qualcuno apre. Quando Google rifiuta il log di Drive, l'esecuzione lo segnala con un avviso, e gli altri log vengono comunque importati.
- **Un'esecuzione fallita non cambia nulla.** Dopo un errore di rete, o uno stato di errore di Google, il cursore e la lunghezza della finestra restano com'erano, e l'interrogazione successiva rilegge la stessa finestra. L'unica eccezione è una richiesta scaduta: il cursore resta, ma la finestra successiva è lunga la metà, perché una finestra troppo pesante per ricevere risposta in tempo scadrebbe a ogni tentativo.

### Quando una finestra contiene più di quanto un'interrogazione possa leggere

Ogni log ha un budget proprio, in pagine da 1.000 attività: 10 per gli accessi, 5 ciascuno per amministrazione, token OAuth e SAML, 3 per la sicurezza degli account, e 4 per ogni evento di Drive. Un'interrogazione si ferma dopo 4 minuti. Quando un budget ferma un log prima della fine della sua finestra, l'esecuzione è **Parziale**, e il suo avviso nomina il log e il budget. Google elenca prima le attività più recenti, quindi OneUptime accorcia la finestra invece di spostare il cursore oltre attività che non ha mai raggiunto:

1. **Restringere.** L'interrogazione successiva legge una finestra lunga la metà, dallo stesso punto di partenza, e continua a dimezzarla finché una finestra non viene letta per intero, fino a un minuto. L'avviso dell'esecuzione lo dice: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Le attività già importate dalla finestra più lunga vengono saltate come duplicati.
2. **Tornare a crescere.** Dopo che una finestra è stata letta per intero, il cursore passa alla sua fine, e la finestra successiva è di nuovo lunga il doppio, fino a 24 ore.
3. **Superare un singolo minuto.** Se anche un solo minuto contiene più di quanto un'interrogazione possa leggere, il polling lo supera, così le attività più recenti continuano ad arrivare. L'esecuzione resta **Parziale**, e **Ultimo errore** riporta `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importa quel minuto con **Import this time range** per recuperare ciò che un'esecuzione può leggere.

Cambiare l'**Intervallo di interrogazione (minuti)** non cambia nulla di tutto questo: decide quanto spesso parte un'interrogazione, non dove inizia la sua finestra.

### Eseguire, visualizzare in anteprima e importare su richiesta

Fai clic su **Diagnostica** su una connessione per vederne le esecuzioni recenti e lavorarci a mano. Chi può modificare la connessione può avviare queste azioni; chi può vederla può leggerne la cronologia.

- **Esegui ora** avvia subito un'interrogazione, con il cursore abituale, anche quando la connessione non è **Abilitato**.
- **Preview audit events** legge un intervallo di tempo fino a 7 giorni e non importa nulla.
- **Import this time range** importa un intervallo fino a 7 giorni, dopo la tua conferma, senza spostare il cursore. Le attività già importate vengono saltate. Google conserva 6 mesi di log di audit.
- **Copy diagnostics** su un'esecuzione copia il suo rapporto per il supporto. Non contiene mai credenziali.

## Testare la connessione

**Testa la connessione** sulla riga di una connessione, e **Prova queste impostazioni** nel modulo, vengono eseguiti nel processo dell'API, non in un worker in background, così un test risponde anche quando il problema sono i worker. Esegue questi controlli, in ordine:

| Controllo | Cosa verifica |
| --- | --- |
| **Configurazione** | L'indirizzo dell'amministratore e la chiave sono ben formati. Non viene contattato nulla quando questo fallisce. |
| **Authenticate with Google** | Google consente all'account di servizio di agire come l'amministratore: la delega a livello di dominio è configurata. |
| **Read the audit logs** | I log degli accessi e di amministrazione delle ultime 24 ore si possono leggere. |
| **Read Drive activity** | Solo con l'opzione attiva: il log di Drive si può leggere. |
| **Activities available to import** | Quante attività di accesso e di amministrazione contengono le ultime 24 ore, al massimo 1.000 ciascuna, quindi `1000+` significa di più. Nessuna è un avviso. |
| **Background workers**, **Poll scheduler**, **Security event storage** | Il lato di OneUptime stesso: un processo prende i job della coda Worker, il job di polling gira ogni minuto e l'archivio degli eventi di sicurezza risponde. |
| **Scheduled polling** | Per una connessione salvata: il polling è attivo, nessuna esecuzione è bloccata in attesa di un worker e le interrogazioni girano in orario. |

Ogni richiesta di un test ha una scadenza di 20 secondi. Un test non importa mai nulla e non sposta mai il cursore, e ogni controllo fallito dice cosa cambiare.

## Risoluzione dei problemi

L'**Ultimo errore** della connessione conserva il messaggio di errore completo, con le credenziali oscurate. Quando una connessione ha un errore, seleziona **Visualizza errore** nella sua colonna **Azioni** per leggerlo, e **Copia errore** nella finestra di dialogo per copiarlo. Ogni messaggio inizia con `Google Workspace`, poi nomina la richiesta fallita, e cita il motivo dato da Google.

:::details Ultimo errore dice `token request failed`
- `unauthorized_client`: l'account di servizio non ha la delega a livello di dominio per l'ambito. Aggiungi il suo **Unique ID** con `https://www.googleapis.com/auth/admin.reports.audit.readonly` in **Manage domain-wide delegation**.
- `invalid_grant` con `Invalid email or User ID`: l'**Administrator email** non è un utente di questo Google Workspace.
- `invalid_grant` con `Invalid JWT Signature`: la chiave è stata eliminata o disattivata. Crea una nuova chiave e salvala con **Aggiorna le credenziali**.
:::

:::details Ultimo errore dice `activities request failed (HTTP 403)`
- Motivo `SERVICE_DISABLED` o `accessNotConfigured`: la Admin SDK API è disattivata nel progetto dell'account di servizio. Attivala e riprova tra qualche minuto.
- Motivo `forbidden`: all'amministratore manca il privilegio Reports. Assegnalo in **Account → Admin roles** nella Console di amministrazione Google, o indica un super amministratore.
:::

:::details L'attività di Drive non viene letta
Il log di Drive richiede un'edizione che lo includa, e un amministratore con il privilegio Reports. Ogni esecuzione avvisa `Drive activity was not read`, e gli altri log vengono comunque importati. Disattiva **Attività di Drive** quando la tua edizione non ha il log di Drive.
:::

:::details Ultimo errore dice `did not complete`
La richiesta non ha ricevuto risposta: un timeout, un nome che non si risolve o un indirizzo rifiutato. Verifica che l'app e i worker di OneUptime possano raggiungere `oauth2.googleapis.com` e `admin.googleapis.com`, attraverso qualsiasi proxy che usi.
:::

:::details Il test riesce, ma Last Polled è Never
Il job di polling non è mai stato eseguito. Leggi i controlli **Background workers** e **Poll scheduler**. Su un'installazione self-hosted, la causa abituale è `DISABLE_QUEUE_WORKERS=true` sull'app, senza un deployment separato dei worker che prenda i job: impostalo su `false`, oppure esegui il deployment dei worker (Helm: `worker.enabled: true`, che è `false` per impostazione predefinita).
:::

## Prossimi passi

:::cards
- [Eventi di sicurezza](/docs/telemetry/security-events): Cerca, correla e genera avvisi su ciò che importi.
- [Microsoft Entra ID](/docs/integrations/microsoft-entra-id): Importa gli accessi e le modifiche alla directory di Microsoft.
- [Google SecOps](/docs/integrations/google-secops): Porta dentro anche i rilevamenti di Google SecOps.
- [Panoramica delle integrazioni](/docs/integrations/index): Gli altri strumenti che puoi collegare.
:::
