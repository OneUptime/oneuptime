# Integrazione GitHub

Connetti il tuo OneUptime self-hosted a GitHub con una GitHub App di tua proprietà. Una volta installata l'app da OneUptime, i repository dell'installazione vengono importati nel tuo progetto e tenuti sincronizzati, le attività di correzione con l'IA aprono pull request, e il tuo team può affidare lavoro all'app da GitHub menzionandola.

Questa pagina è per chi gestisce il server OneUptime: crei l'app una volta, e poi ogni progetto la connette da **Repository di codice**.

:::cards
- [Creare la GitHub App](#creare-la-github-app): Registra l'app con gli URL, i permessi e gli eventi giusti.
- [Configurare OneUptime](#configurare-oneuptime): Dai al server i sei valori dell'app.
- [Connettere i repository](#connettere-i-repository): Installa l'app da OneUptime.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Cosa significano i messaggi di Repository di codice.
:::

## Come funziona

L'installazione parte da OneUptime, non da GitHub: è il link con cui OneUptime ti manda su GitHub a legare l'installazione al tuo progetto.

```mermaid title="Connettere un'installazione della GitHub App a un progetto"
sequenceDiagram
    participant B as Il tuo browser
    participant O as OneUptime
    participant G as GitHub
    B->>O: Connect with GitHub App
    O-->>B: Reindirizzamento alla pagina di installazione dell'app
    B->>G: Installa e autorizza l'app
    G-->>B: Reindirizzamento a /api/github/auth/callback
    B->>O: installation_id e un codice monouso
    O->>G: Scambia il codice, verifica l'installazione
    O->>G: Importa i repository dell'installazione
    G->>O: Webhook verso /api/github/webhook
```

- Il reindirizzamento del browser porta con sé l'installazione e un codice OAuth monouso. OneUptime scambia il codice per confermare che l'account GitHub che ha installato l'app amministra quell'installazione, poi ne importa i repository.
- I webhook tengono sincronizzato l'elenco dei repository e affidano lavoro all'app: menzioni, assegnazioni, label di attivazione e richieste di revisione. GitHub firma ciascuno con il webhook secret, e OneUptime rifiuta quelli che non riesce a verificare.

## Prima di iniziare

- Un account GitHub che possa creare GitHub App per l'organizzazione o l'utente su cui verrà installata l'app. Per installarla in un'organizzazione devi esserne proprietario, o far approvare la richiesta da un proprietario.
- Un nome host HTTPS pubblico per OneUptime che GitHub possa raggiungere per i webhook. Vedi [Accesso di rete](#accesso-di-rete-per-le-installazioni-self-hosted).
- Accesso alla configurazione del server: `config.env` per Docker Compose, o i tuoi values di Helm per Kubernetes.

## Creare la GitHub App

:::steps
### Apri le impostazioni delle GitHub App

- **Per un'organizzazione:** `https://github.com/organizations/YOUR_ORG/settings/apps`
- **Per un account personale:** `https://github.com/settings/apps`

Seleziona **New GitHub App**.

### Compila il modulo di registrazione

| Campo | Valore |
| --- | --- |
| **GitHub App name** | Un nome univoco qualsiasi, per esempio `OneUptime`. Annotalo esattamente: è `GITHUB_APP_NAME`. |
| **Homepage URL** | `https://your-oneuptime-domain.com` |
| **Callback URL** | `https://your-oneuptime-domain.com/api/github/auth/callback` |
| **Request user authorization (OAuth) during installation** | Attivo. **È obbligatorio**: vedi la nota qui sotto. |
| **Setup URL** | `https://your-oneuptime-domain.com/api/github/auth/callback`, se GitHub ti permette di inserirne uno (vedi sotto). |
| **Redirect on update** | Facoltativo. Dopo che qualcuno modifica un'installazione su GitHub, OneUptime lo porta su **Repository di codice**. |
| **Webhook URL** | `https://your-oneuptime-domain.com/api/github/webhook`, con il webhook **Active**. |
| **Webhook secret** | Una lunga stringa casuale. Annotala: è `GITHUB_APP_WEBHOOK_SECRET`. **Obbligatorio**: OneUptime rifiuta i webhook non firmati, quindi lasciare `GITHUB_APP_WEBHOOK_SECRET` non impostato ferma la sincronizzazione dei repository invece di accettare payload non verificati. |

Secondo la documentazione di GitHub, con **Request user authorization (OAuth) during installation** attivo [non puoi inserire un Setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url): dopo l'installazione gli utenti vengono mandati invece al Callback URL. Entrambi puntano allo stesso indirizzo di OneUptime, quindi il reindirizzamento arriva comunque nel posto giusto.

> [!IMPORTANT]
> **Perché "Request user authorization (OAuth) during installation" è obbligatorio.** Dopo un'installazione, GitHub reindirizza con un `installation_id` nell'URL. Quel numero da solo non prova nulla su chi possieda l'installazione: chiunque può digitarne un altro. Con questa opzione attiva GitHub restituisce anche un `code` OAuth monouso legato all'account GitHub che ha eseguito l'installazione, che OneUptime scambia per confermare che quell'account amministra davvero l'installazione prima di connetterla al tuo progetto.
>
> Senza di essa, OneUptime si rifiuta di connettere l'installazione e la dashboard mostra un errore che ti chiede di attivare questa impostazione. È voluto: accettare l'ID dell'installazione senza verificarlo permetterebbe a un progetto OneUptime di rivendicare i repository di un'altra organizzazione.

### Imposta i permessi

In **Permissions & events**, imposta questi **Repository permissions**:

| Permesso | Accesso | A cosa serve a OneUptime |
| --- | --- | --- |
| Contents | Read and write | Leggere i file del repository e fare push dei branch delle pull request di correzione con l'IA |
| Pull requests | Read and write | Aprire e aggiornare pull request, e pubblicare revisioni |
| Issues | Read and write | Pubblicare i commenti dell'app, **anche nelle pull request**, la cui conversazione GitHub fa passare dall'API delle issue |
| Checks | Read-only | Facoltativo. Leggere il risultato della CI delle pull request di correzione. Senza, il loro stato di CI resta non verificato |
| Metadata | Read-only | Metadati di base del repository (richiesti da GitHub) |

**È Issues: Read and write a rendere interattiva l'app.** Senza di esso, le menzioni vengono ricevute e poi falliscono in silenzio quando l'app prova a rispondere: GitHub serve i commenti delle conversazioni delle pull request dall'API delle issue, quindi questo solo permesso decide ogni risposta che l'app scrive. Vedi [Lavorare con OneUptime da GitHub](/docs/ai/github-app).

OneUptime non ha bisogno di permessi di organizzazione o di account.

### Iscriviti agli eventi webhook

OneUptime usa due gruppi di eventi, che svolgono compiti diversi.

**Sincronizzazione dei repository**: `installation` e `installation_repositories`. Le GitHub App li ricevono automaticamente; tengono l'insieme dei repository connessi allineato a dove è installata l'app.

**L'app interattiva**: a questi bisogna iscriversi esplicitamente, e ognuno abilita un modo preciso di affidare lavoro all'app:

| Evento | Cosa abilita |
| --- | --- |
| **Issue comment** | i comandi `@mention` nelle issue **e** nelle pull request |
| **Issues** | assegnare una issue all'app, e la label di attivazione del repository |
| **Pull request** | chiedere una revisione all'app |
| **Pull request review** | una menzione scritta nel corpo di una revisione inviata |
| **Pull request review comment** | una menzione in un commento inline nel diff |

Se nessuno di questi è sottoscritto, la GitHub App connette comunque i repository e apre comunque pull request di correzione da OneUptime, ma non risponde mai a nulla di ciò che viene scritto in GitHub. È la causa più comune di "il bot mi ignora". Vedi [Lavorare con OneUptime da GitHub](/docs/ai/github-app) per quali sono i comandi e chi può darli.

Gli altri eventi (**Push**, **Workflow run**) vengono confermati e ignorati; iscriversi non abilita notifiche né automazione CI/CD.

### Scegli dove può essere installata l'app

In **Where can this GitHub App be installed?**, scegli:

- **Only on this account** - Per uso privato/interno
- **Any account** - Se vuoi che altri installino la tua app

### Crea l'app e annota i suoi ID

Seleziona **Create GitHub App**. GitHub apre la pagina delle impostazioni dell'app. Annota l'**App ID**, in cima alla pagina, e il **Client ID**, nella sezione **About**.

### Genera un client secret

In **Client secrets**, seleziona **Generate a new client secret**. Copialo subito: GitHub lo mostra una sola volta.

### Genera una chiave privata

In **Private keys**, seleziona **Generate a private key**. GitHub scarica un file `.pem`. Conservalo al sicuro: permette a OneUptime di autenticarsi come l'app.
:::

## Configurare OneUptime

:::tabs
@tab Docker Compose
`config.env` contiene un valore per riga, quindi fornisci la chiave privata codificata in base64, su una sola riga. OneUptime la decodifica:

```bash
base64 < private-key.pem | tr -d '\n'
```

```bash title="config.env"
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY=YOUR_BASE64_ENCODED_PRIVATE_KEY
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

Applica la modifica con `npm run start`, che ricrea i container. `docker compose restart` non rilegge `config.env`.
@tab Kubernetes
```yaml title="values.yaml"
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # The exact name of your GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

`privateKey` accetta anche il PEM stesso, come blocco su più righe (`privateKey: |`). Applica la modifica con `helm upgrade`.
:::

Quando OneUptime è di nuovo attivo, **Repository di codice** mostra **Connect with GitHub App** invece di **GitHub App is not configured on this server**.

### Riferimento delle variabili d'ambiente

| Docker Compose (`config.env`) | Helm (`values.yaml`) | Valore |
| --- | --- | --- |
| `GITHUB_APP_ID` | `gitHubApp.id` | L'**App ID**. Serve per autenticarsi come l'app. |
| `GITHUB_APP_NAME` | `gitHubApp.name` | Il nome esatto dell'app. Il link di installazione e l'handle `@mention` dell'app (in minuscolo, con trattini al posto degli spazi) vengono costruiti da esso. Senza di esso, **Repository di codice** non può connettersi. |
| `GITHUB_APP_CLIENT_ID` | `gitHubApp.clientId` | Il **Client ID**. Serve per verificare chi ha installato l'app. |
| `GITHUB_APP_CLIENT_SECRET` | `gitHubApp.clientSecret` | Il client secret che hai generato. Serve insieme al client ID. |
| `GITHUB_APP_PRIVATE_KEY` | `gitHubApp.privateKey` | La chiave privata: il PEM, o il PEM codificato in base64. |
| `GITHUB_APP_WEBHOOK_SECRET` | `gitHubApp.webhookSecret` | Il webhook secret. Ogni webhook viene verificato con esso, e senza di esso non ne viene accettato nessuno. |

Sono obbligatori tutti e sei.

## Connettere i repository

Avvia la connessione da OneUptime, non dalla pagina dell'app su GitHub: è il link con cui OneUptime ti manda su GitHub a legare l'installazione al tuo progetto.

:::steps
1. Accedi alla tua dashboard di OneUptime
2. Vai in **Prodotti** > **Attività** > **Repository di codice**
3. Fai clic su **Connect with GitHub App**. OneUptime ti porta su GitHub
4. Seleziona l'organizzazione o l'account su cui installare l'app, e scegli a quali repository può accedere: **All repositories** (tutti i repository attuali e futuri) oppure **Only select repositories**
5. Fai clic su **Install** (o su **Save**, se l'app è già installata lì)
6. GitHub ti riporta su **Repository di codice**, e ogni repository dell'installazione viene importato. I repository aggiunti all'installazione o rimossi in seguito restano sincronizzati automaticamente.
:::

**Chi può connettere.** La connessione importa i repository dell'installazione nel progetto, quindi richiede il permesso di aggiungere repository di codice: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, o un team con **Create Code Repository**. Un team che blocca il permesso lo toglie. Su OneUptime Cloud, i repository di codice richiedono il piano Growth o superiore. Per chiunque altro, la scheda è bloccata e dice cosa serve.

**Completa entro 15 minuti, nello stesso browser.** Il link funziona una volta, per 15 minuti, nel browser che l'ha avviato. Quando GitHub ti riporta indietro, OneUptime verifica di nuovo il permesso prima di importare qualsiasi cosa.

## Accesso di rete per le installazioni self-hosted

### Direzione del traffico ed endpoint

| Traffico | Accesso necessario |
| --- | --- |
| Da OneUptime a GitHub | DNS e HTTPS in uscita su TCP 443 verso `api.github.com` per i token della GitHub App e le chiamate API ai repository, e verso `github.com` per lo scambio del token OAuth e le operazioni Git in HTTPS |
| Da GitHub a OneUptime | HTTPS pubblico su TCP 443 verso `POST /api/github/webhook` per la sincronizzazione delle installazioni e degli accessi ai repository, e per l'app interattiva |
| Dal browser dell'utente a OneUptime | Accesso alla dashboard e `GET /api/github/auth/callback` per i reindirizzamenti di installazione e autorizzazione; possono restare accessibili tramite la VPN dell'utente |

Il callback è un [reindirizzamento del browser](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url), mentre il webhook è una richiesta dai server di GitHub. La connessione VPN di un utente non dà a GitHub l'accesso al webhook. I domini qui sopra coprono le richieste principali dell'integrazione; altri strumenti per i repository, download, LFS o pacchetti possono richiedere altre destinazioni. Queste impostazioni descrivono GitHub.com; modificare il firewall non configura il supporto per il nome host di un GitHub Enterprise Server.

### Installazioni private e sicurezza dei callback

Esponi `/api/github/webhook` tramite un gateway pubblico con DNS pubblico, un certificato HTTPS attendibile pubblicamente con la catena completa e una route privata verso l'ingress di OneUptime. Consenti il TCP 443 in entrata verso il gateway e limita l'inoltro pubblico a questa route POST. Tieni la dashboard e il callback del browser sull'ingress privato se gli utenti vi accedono tramite VPN; il DNS split può servire lo stesso nome host all'interno e all'esterno.

Imposta `HOST=oneuptime.example.com` e `HTTP_PROTOCOL=https` in `config.env`, oppure `host: oneuptime.example.com` e `httpProtocol: https` in Helm. Applica la configurazione e attendi che OneUptime si riavvii. Questi valori generano URL; non forniscono DNS, TLS né accesso di rete. Se il nome host cambia, aggiorna gli URL di webhook, callback, setup e homepage della GitHub App.

Conserva il metodo, il percorso originale, la query string, il body, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event` e `X-GitHub-Delivery`. Conserva l'host pubblico e lo schema HTTPS tramite header di proxy attendibili. Escludi il webhook dal SSO del browser, dai CAPTCHA e dalle pagine di accesso del proxy. Tieni attiva la verifica SSL di GitHub e configura lo stesso `GITHUB_APP_WEBHOOK_SECRET` in entrambi i sistemi: OneUptime rifiuta le richieste non firmate e non può validare i webhook senza questo secret. Vedi le [indicazioni di GitHub sulla validazione dei webhook](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Se limiti anche gli IP di origine dei webhook, usa gli intervalli `hooks` attuali dalla Meta API di GitHub e aggiornali regolarmente; non sostituirli con gli intervalli dei runner di GitHub Actions e non saltare la verifica della firma. GitHub avverte che [i suoi indirizzi cambiano e l'elenco pubblicato non è completo](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### Verificare l'accesso e capire i limiti

:::steps
1. Connetti un'installazione da **Repository di codice**.
2. Nelle impostazioni della GitHub App, apri **Advanced** e guarda **Recent Deliveries**. Riconsegna una consegna e conferma che il gateway la inoltra e che OneUptime la accetta.
3. Aggiungi o rimuovi un repository di prova dall'installazione, e controlla che l'elenco dei repository in OneUptime si aggiorni.
:::

GitHub documenta la [diagnostica delle consegne](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) e richiede [una conferma 2xx entro dieci secondi](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks). Un GET dal browser verso il webhook non verifica un POST firmato.

> [!WARNING]
> Senza accesso in entrata, l'autorizzazione nel browser e le operazioni API e Git in uscita possono funzionare, ma i webhook non possono raggiungere OneUptime: le installazioni eliminate e le modifiche agli accessi ai repository non si sincronizzano, e l'app non risponde mai a menzioni, assegnazioni o richieste di revisione.

L'[impostazione di accesso alla rete privata](/docs/self-hosted/private-network-access) controlla le richieste in uscita verso destinazioni private e non rende il webhook raggiungibile da GitHub.

## Risoluzione dei problemi

### La connessione non è stata completata

Quando GitHub ti riporta indietro e l'installazione non è stata connessa, **Repository di codice** mostra **GitHub non è stato connesso**, con una frase nella tua lingua che spiega il motivo. Il resto della pagina si carica come sempre, quindi puoi riconnetterti lì stesso. Non mostra mai cosa ha risposto GitHub: quello è nel log del server OneUptime, con il motivo.

| La pagina dice | Cosa fare |
| --- | --- |
| **"Questo link di connessione non è valido, è scaduto o è già stato usato. Ricomincia."** | Il link funziona una volta, per 15 minuti, nel browser che l'ha avviato. Ricomincia da **Repository di codice** e completa su GitHub entro 15 minuti, nello stesso browser. Installare l'app dalla sua pagina su GitHub non la connette a nessun progetto. |
| **"Non hai l'autorizzazione per aggiungere repository di codice a questo progetto."** | La connessione richiede il permesso di aggiungere repository di codice (vedi [Connettere i repository](#connettere-i-repository)). Chiedi a un amministratore del progetto di concedertelo. Viene verificato di nuovo quando GitHub ti riporta indietro, quindi un permesso tolto nel frattempo chiude la connessione anche qui. |
| **"Per connettere GitHub serve il piano ...."** | Su OneUptime Cloud, i repository di codice richiedono il piano indicato nella frase. Passa il progetto a quel piano, poi connettiti di nuovo. |
| **"GitHub non ha confermato chi ha installato l'app, quindi non è stato possibile verificare l'installazione."** | Attiva **Request user authorization (OAuth) during installation** nelle impostazioni della GitHub App (vedi [Creare la GitHub App](#creare-la-github-app)), poi connettiti di nuovo. |
| **"OneUptime non è riuscito a confermare che il tuo account GitHub possa gestire questa installazione."** | L'account GitHub che ha completato l'installazione non la amministra. Installa l'app con un account proprietario dell'organizzazione o dell'utente su cui è installata, o chiedilo a un proprietario. |
| **"GitHub non ha restituito alcuna installazione."** | Quando un membro dell'organizzazione richiede l'app invece di installarla, un proprietario dell'organizzazione deve prima approvare la richiesta. Connettiti di nuovo quando l'ha fatto. |
| **"La GitHub App non è configurata su questo server OneUptime."** | Imposta sia `GITHUB_APP_CLIENT_ID` sia `GITHUB_APP_CLIENT_SECRET` (vedi [Configurare OneUptime](#configurare-oneuptime)) e riavvia OneUptime. |
| **"OneUptime non è riuscito a completare la connessione. Riprova."** | GitHub ha risposto con un errore, oppure una richiesta o una scrittura non è riuscita durante il completamento. Il log del server OneUptime dice quale. Riprova; se continua a succedere, controlla il log e le impostazioni della GitHub App. |

### Altri problemi

:::details Repository di codice dice "GitHub App is not configured on this server"
`GITHUB_APP_NAME` non è impostato. Impostalo sul nome esatto dell'app, insieme agli altri cinque valori, e riavvia OneUptime.
:::

:::details Dopo aver installato l'app non vengo riportato su OneUptime
Controlla che il **Callback URL** dell'app sia `https://your-oneuptime-domain.com/api/github/auth/callback`, e anche il **Setup URL** se ne è impostato uno. Entrambi devono puntare allo stesso endpoint `/api/github/auth/callback`, sul nome host di `HOST`.
:::

:::details Le Recent Deliveries di GitHub mostrano "Invalid webhook signature"
Il webhook secret nella GitHub App e `GITHUB_APP_WEBHOOK_SECRET` sono diversi, `GITHUB_APP_WEBHOOK_SECRET` non è impostato, oppure un proxy ha modificato il body della richiesta. Imposta lo stesso secret in entrambi, riavvia OneUptime e assicurati che il gateway inoltri il body senza modificarlo.
:::

:::details Gli eventi webhook non arrivano
Controlla che l'URL del webhook sia raggiungibile pubblicamente in HTTPS, poi guarda **Advanced > Recent Deliveries** nelle impostazioni della GitHub App per ogni tentativo e la sua risposta. I webhook vengono rifiutati finché `GITHUB_APP_WEBHOOK_SECRET` non è impostato.
:::

:::details I repository o le attività di correzione falliscono con un errore di autenticazione
OneUptime si autentica come l'app con `GITHUB_APP_ID` e `GITHUB_APP_PRIVATE_KEY`. Controlla che l'App ID sia corretto e che la chiave sia il PEM completo, comprese le righe `BEGIN` ed `END`, o quel PEM codificato in base64. Se l'app è stata disinstallata da GitHub, connettila di nuovo da **Repository di codice**.
:::

:::details Mancano dei repository dopo l'installazione
Controlla a quali repository può accedere l'installazione, nelle sue impostazioni su GitHub. I repository che aggiungi lì vengono importati automaticamente, purché i webhook raggiungano OneUptime.
:::

:::details L'app ignora le menzioni in GitHub
Dai all'app **Issues: Read and write** e iscrivila agli eventi interattivi di [Iscriviti agli eventi webhook](#iscriviti-agli-eventi-webhook). Inoltre le menzioni corrispondono solo all'handle costruito da `GITHUB_APP_NAME`, quindi impostalo sul nome reale dell'app.
:::

## Buone pratiche di sicurezza

- **Ruota regolarmente i secret.** Genera periodicamente nuovi client secret e nuove chiavi private.
- **Tieni impostato il webhook secret.** OneUptime rifiuta i webhook che non riesce a verificare.
- **Limita l'accesso ai repository.** Concedi all'installazione solo i repository che devono essere connessi.
- **Tieni d'occhio le consegne dei webhook.** Controlla regolarmente consegne non riuscite o attività sospette.
- **Tieni le chiavi private fuori dal controllo di versione.**

## Passi successivi

:::cards
- [Lavorare con OneUptime da GitHub](/docs/ai/github-app): I comandi che si possono dare all'app, e chi può darli.
- [Attività di correzione](/docs/ai/ai-agent): Come l'agente IA apre pull request di correzione.
- [Accesso alla rete privata](/docs/self-hosted/private-network-access): Permetti a workflow e webhook di raggiungere gli strumenti interni.
:::
