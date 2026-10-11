# SMTP

Invia la posta di OneUptime tramite il tuo server di posta. Un progetto aggiunge configurazioni SMTP con cui le sue pagine di stato inviano la loro posta, e un'installazione self-hosted imposta il server da cui OneUptime invia tutto il resto. Entrambi supportano tre modi di accesso:

- **Nome utente e password**: la classica autenticazione SMTP.
- **OAuth 2.0**: per Microsoft 365 e Google Workspace, dove l'autenticazione di base è spesso disattivata.
- **Nessuno**: per i server relay che non richiedono autenticazione.

```mermaid title="Quale server di posta invia cosa"
flowchart TB
    SP["La posta di una pagina di stato"] --> Q{"Configurazione SMTP personalizzata<br/>scelta per la pagina?"}
    Q -->|"Sì"| P["La configurazione SMTP<br/>del progetto"]
    Q -->|"No"| D["Il server di posta<br/>di OneUptime"]
    E["Tutta l'altra posta<br/>di OneUptime"] --> D
```

In un'installazione self-hosted, il server di posta di OneUptime è quello impostato nell'Admin Dashboard. Una pagina di stato sceglie la sua configurazione SMTP nella propria pagina **Impostazioni iscritti**, nella scheda **SMTP personalizzato**.

:::cards
- [Aggiungere un server di posta](#aggiungere-un-server-smtp): Due passaggi, con tutto il resto ripiegato.
- [Microsoft 365](#configurazione-di-microsoft-365): OAuth con una registrazione dell'app in Entra.
- [Google Workspace](#configurazione-di-google-workspace): OAuth con un account di servizio.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Errori comuni e il loro significato.
:::

## Aggiungere un server SMTP

Aggiungi il server di posta di un progetto in **Impostazioni del progetto > Notifiche > Impostazioni notifiche**, nella scheda **Configurazioni SMTP personalizzate**. In un'installazione self-hosted, il server da cui invia OneUptime stesso si imposta in **Admin Dashboard > Impostazioni > Notifiche > E-mail**, nella scheda **Impostazioni e-mail e SMTP personalizzate**. Entrambi i moduli chiedono le stesse cose, in due passaggi.

:::steps
### Aprire il modulo

:::tabs
@tab Progetto
In **Impostazioni del progetto > Notifiche > Impostazioni notifiche**, fai clic su **Crea: SMTP Configurazione** nella scheda **Configurazioni SMTP personalizzate**.
@tab Istanza self-hosted
Nell'Admin Dashboard, apri **Impostazioni**, poi **Notifiche > E-mail** nel menu laterale (**Notifiche** è inizialmente chiuso). Nella scheda **Impostazioni del server e-mail**, fai clic su **Modifica server** e imposta **Tipo di server email** su `Custom SMTP`. Poi fai clic su **Modifica config SMTP** nella scheda **Impostazioni e-mail e SMTP personalizzate**, che compare sotto.
:::

### Compilare il passaggio Server

Nel passaggio **Server**, inserisci il **Nome** (solo configurazioni di progetto), l'**Hostname**, la **Porta** (una nuova configurazione di progetto parte da `587`), il **Nome utente** e la **Password**.

### Controllare Altri campi

Tutto il resto è ripiegato sotto **Altri campi**, alla fine del passaggio **Server**. Finché è ripiegato, la sua intestazione dice come viene inviata la posta, per esempio «La posta viene inviata tramite SMTP, con accesso tramite nome utente e password. TLS è obbligatorio.» Aprilo solo se devi cambiare una delle impostazioni della tabella qui sotto.

### Compilare il passaggio Mittente

Nel passaggio **Mittente**, inserisci l'**Email mittente** e il **Nome mittente** da cui arriva la tua posta. Il tuo server deve consentire l'invio da quell'indirizzo.

### Salvare e inviare un'e-mail di prova

Salva la configurazione. Una volta salvata una configurazione di progetto, **Invia e-mail di prova** sulla sua riga verifica che funzioni. Serve l'autorizzazione ad aggiungere configurazioni SMTP: **Project Owner**, **Project Admin**, oppure **Create SMTP Config** e **Read SMTP Config** in un ruolo personalizzato. Su OneUptime Cloud serve anche il piano **Growth**, come per aggiungere una configurazione. Per chiunque altro il pulsante è bloccato, e il suo tooltip dice cosa serve.

La prova chiede un indirizzo **E-mail** a cui inviare, inizialmente il tuo. Controlla che il messaggio arrivi.
:::

Queste sono le impostazioni sotto **Altri campi**:

| Campo | Cosa fa |
| --- | --- |
| **Trasporto** | `SMTP` (predefinito), oppure `Microsoft Graph` per un tenant Microsoft 365 con SMTP AUTH disattivato. Scegliere Microsoft Graph nasconde hostname, porta, nome utente e password, e mostra i campi OAuth. |
| **Richiedi TLS** | Attivo per una nuova configurazione di progetto. La posta viene inviata solo su una connessione cifrata con un certificato valido. Se l'opzione è disattivata, la posta viene cifrata solo se il server lo offre e il certificato non viene verificato. La porta 465 è sempre cifrata. |
| **Tipo di autenticazione** | `Username and Password` (predefinito), `OAuth`, oppure `None` per un relay che non richiede accesso. |
| **Campi OAuth** | **Tipo di provider OAuth**, **Client ID OAuth**, **Client Secret OAuth**, **URL del token OAuth** e **Scope OAuth**, mostrati quando si sceglie OAuth o Microsoft Graph. |
| **Descrizione** | Una nota per il tuo team (solo configurazioni di progetto). |

**Microsoft Graph.** Apri **Altri campi**, imposta **Trasporto** su `Microsoft Graph` e inserisci i dati di un'app Azure che abbia l'autorizzazione dell'applicazione **Mail.Send**: il suo client ID e il suo client secret, l'URL del token `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` e lo scope `https://graph.microsoft.com/.default`. La posta parte dalla casella dell'**Email mittente**, che deve essere una casella con licenza nel tuo tenant.

> [!NOTE]
> Su OneUptime Cloud, il server di posta di un progetto deve essere raggiungibile da Internet: un host che si risolve in un indirizzo privato o interno viene rifiutato. In un'installazione self-hosted, gli indirizzi privati sono consentiti a meno che `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` sia `true`; gli indirizzi di loopback e link-local vengono sempre rifiutati. Il server di posta dell'istanza non viene controllato in questo modo.

## Autenticazione OAuth 2.0

OAuth 2.0 permette a OneUptime di accedere al tuo server di posta senza password, cosa che i servizi di posta aziendali richiedono sempre più spesso. OneUptime supporta due tipi di grant OAuth:

- **Client Credentials**: usato da Microsoft 365 e dalla maggior parte dei provider OAuth.
- **JWT Bearer**: usato dagli account di servizio di Google Workspace.

```mermaid title="Come OneUptime accede con OAuth"
sequenceDiagram
    participant O as OneUptime
    participant T as URL del token
    participant M as Server di posta
    O->>T: Richiede un token di accesso
    T-->>O: Token di accesso
    Note over O: In cache, e rinnovato<br/>prima della scadenza
    O->>M: Accede con il token
    O->>M: Invia l'e-mail
```

**Tipo di autenticazione** e i campi OAuth si trovano sotto **Altri campi**, nel passaggio Server del modulo. Per accedere con OAuth, compila:

| Campo | Descrizione |
| --- | --- |
| **Hostname** | Indirizzo del server SMTP |
| **Porta** | Porta SMTP (di solito 587 per STARTTLS o 465 per TLS implicito) |
| **Nome utente** | L'indirizzo e-mail della casella che invia |
| **Tipo di autenticazione** | `OAuth` |
| **Tipo di provider OAuth** | `Client Credentials` per Microsoft 365, oppure `JWT Bearer` per Google Workspace |
| **Client ID OAuth** | L'ID dell'applicazione (client) del tuo provider OAuth (per Google: l'e-mail dell'account di servizio) |
| **Client Secret OAuth** | Il client secret del tuo provider OAuth (per Google: la chiave privata) |
| **URL del token OAuth** | L'endpoint dei token OAuth del tuo provider |
| **Scope OAuth** | Lo scope OAuth che concede l'accesso SMTP |

OneUptime mette in cache i token OAuth e li rinnova automaticamente prima che scadano.

## Configurazione di Microsoft 365

Per usare OAuth con Microsoft 365 (Exchange Online), registra un'applicazione in Microsoft Entra, dalle l'autorizzazione a inviare posta tramite SMTP e consentile di usare la casella da cui invii.

:::steps
### Registrare un'applicazione in Microsoft Entra

1. Accedi all'[interfaccia di amministrazione di Microsoft Entra](https://entra.microsoft.com).
2. Vai su **Identity** > **Applications** > **App registrations** e fai clic su **New registration**.
3. Inserisci un nome (per esempio «OneUptime SMTP»), seleziona «Accounts in this organizational directory only» e lascia vuoto **Redirect URI**.
4. Fai clic su **Register**.

Nella pagina **Overview**, annota l'**Application (client) ID** (il tuo client ID) e il **Directory (tenant) ID** (per l'URL del token).

### Creare un client secret

1. Nella registrazione dell'app, vai su **Certificates & secrets** e fai clic su **New client secret**.
2. Aggiungi una descrizione, scegli un periodo di scadenza e fai clic su **Add**.
3. **Copia subito il valore del secret**: non viene mostrato di nuovo.

### Aggiungere l'autorizzazione SMTP

1. Vai su **API permissions** e fai clic su **Add a permission**.
2. Seleziona **APIs my organization uses**, poi cerca e seleziona **Office 365 Exchange Online**.
3. Seleziona **Application permissions**, spunta **SMTP.SendAsApp** e fai clic su **Add permissions**.
4. Fai clic su **Grant admin consent for [your organization]** (servono privilegi di amministratore).

### Registrare l'entità servizio in Exchange Online

Prima che l'applicazione possa inviare posta, registra la sua entità servizio in Exchange Online e dalle accesso alla casella da cui invii:

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> Usa `Add-MailboxPermission`, non `Add-RecipientPermission`. `Add-RecipientPermission` concede solo `SendAs` sul destinatario, che non basta perché l'entità servizio invii posta tramite SMTP con OAuth: l'invio non riesce con un errore di autenticazione o di autorizzazione.

### Creare la configurazione SMTP in OneUptime

Crea o modifica una configurazione SMTP con queste impostazioni, sostituendo `<tenant-id>` con il tuo **Directory (tenant) ID**:

| Campo | Valore |
| --- | --- |
| Hostname | `smtp.office365.com` |
| Porta | `587` |
| Nome utente | L'indirizzo e-mail a cui hai concesso le autorizzazioni (ad es. `sender@yourdomain.com`) |
| Tipo di autenticazione | `OAuth` |
| Tipo di provider OAuth | `Client Credentials` |
| Client ID OAuth | Il tuo **Application (client) ID** |
| Client Secret OAuth | Il valore del client secret |
| URL del token OAuth | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope OAuth | `https://outlook.office365.com/.default` |
| Email mittente | Uguale al nome utente |
| Richiedi TLS | Attivo |

Poi usa **Invia e-mail di prova** per verificarla.
:::

## Configurazione di Google Workspace

Google Workspace richiede un **account di servizio** con delega a livello di dominio, che invia la posta per conto di un utente del tuo dominio. I server SMTP di Google non supportano un semplice flusso client credentials per Gmail.

### Prima di iniziare con Google Workspace

- Un account Google Workspace. Gli account Gmail personali non lo supportano.
- Accesso da Super Admin alla console di amministrazione di Google Workspace.
- Accesso alla Google Cloud Console.

:::steps
### Creare un progetto Google Cloud

1. Vai alla [Google Cloud Console](https://console.cloud.google.com).
2. Fai clic sul selettore dei progetti e scegli **New Project**.
3. Inserisci un nome per il progetto, fai clic su **Create** e seleziona il nuovo progetto.

### Abilitare la Gmail API

1. Vai su **APIs & Services** > **Library**.
2. Cerca «Gmail API», fai clic su **Gmail API** e poi su **Enable**.

### Creare un account di servizio

1. Vai su **APIs & Services** > **Credentials**.
2. Fai clic su **Create Credentials** > **Service account**.
3. Inserisci un nome e una descrizione, fai clic su **Create and Continue**, salta i passaggi facoltativi e fai clic su **Done**.

### Creare una chiave dell'account di servizio

1. Fai clic sull'account di servizio appena creato e vai alla scheda **Keys**.
2. Fai clic su **Add Key** > **Create new key**, seleziona **JSON** e fai clic su **Create**.
3. Conserva al sicuro il file JSON scaricato. Il suo `client_email` è il tuo client ID OAuth, e la sua `private_key` il tuo client secret OAuth.

### Abilitare la delega a livello di dominio

1. Nei dettagli dell'account di servizio, fai clic su **Show Advanced Settings**.
2. Annota il **Client ID** numerico.
3. Spunta **Enable Google Workspace Domain-wide Delegation** e fai clic su **Save**.

### Autorizzare l'account di servizio nell'amministrazione di Google Workspace

1. Accedi alla [console di amministrazione di Google Workspace](https://admin.google.com).
2. Vai su **Security** > **Access and data control** > **API Controls** e fai clic su **Manage Domain Wide Delegation**.
3. Fai clic su **Add new**, inserisci il **Client ID** numerico del passaggio precedente e, in **OAuth Scopes**, inserisci `https://mail.google.com/`.
4. Fai clic su **Authorize**.

La delega può richiedere da qualche minuto fino a 24 ore per entrare in vigore.

### Creare la configurazione SMTP per Google Workspace

Crea o modifica una configurazione SMTP con queste impostazioni:

| Campo | Valore |
| --- | --- |
| Hostname | `smtp.gmail.com` |
| Porta | `587` |
| Nome utente | L'indirizzo e-mail di Google Workspace da cui inviare (ad es. `notifications@yourdomain.com`). L'account di servizio agisce per conto di questo utente. |
| Tipo di autenticazione | `OAuth` |
| Tipo di provider OAuth | `JWT Bearer` |
| Client ID OAuth | Il `client_email` del JSON del tuo account di servizio (ad es. `your-service@your-project.iam.gserviceaccount.com`) |
| Client Secret OAuth | La `private_key` del JSON del tuo account di servizio (l'intera chiave, compresi `-----BEGIN PRIVATE KEY-----` e `-----END PRIVATE KEY-----`) |
| URL del token OAuth | `https://oauth2.googleapis.com/token` |
| Scope OAuth | `https://mail.google.com/` |
| Email mittente | Uguale al nome utente |
| Richiedi TLS | Attivo |

Poi usa **Invia e-mail di prova** per verificarla.
:::

> [!IMPORTANT]
> Per Google (JWT Bearer), il **Client ID OAuth** è l'**e-mail dell'account di servizio** (`client_email`), non il `client_id` numerico. L'account di servizio agisce per conto dell'utente indicato in **Nome utente** per inviare la posta.

## Risoluzione dei problemi

### Errori di Microsoft 365

| Problema | Soluzione |
| --- | --- |
| "Authentication unsuccessful" | Verifica che l'entità servizio sia registrata in Exchange e abbia le autorizzazioni sulla casella |
| "AADSTS700016: Application not found" | Controlla che il client ID sia corretto e che l'app esista nel tuo tenant |
| "AADSTS7000215: Invalid client secret" | Crea un nuovo client secret: quello vecchio potrebbe essere scaduto |
| "The mailbox is not enabled for this operation" | Esegui `Add-MailboxPermission` per concedere l'accesso alla casella |

### Errori di Google Workspace

| Problema | Soluzione |
| --- | --- |
| "invalid_grant" | Assicurati che la delega a livello di dominio sia configurata correttamente e propagata |
| "unauthorized_client" | Verifica che il client ID sia autorizzato nella console di amministrazione di Google Workspace |
| "access_denied" | Controlla che lo scope `https://mail.google.com/` sia autorizzato |
| "Domain policy has disabled third-party Drive apps" | Abilita l'accesso alle API nell'amministrazione di Google Workspace, in Security > API Controls |

### Altri problemi

:::details "Cannot send email. Please check your SMTP config."
**Invia e-mail di prova** mostra questo messaggio quando un server a cui si accede con nome utente e password, o senza accesso, non accetta la posta. Controlla **Hostname**, **Porta**, **Nome utente** e **Password**. Se il tuo server non offre TLS, o il suo certificato non è valido per il suo hostname, disattiva **Richiedi TLS** sotto **Altri campi** e riprova. La risposta del server viene conservata con la prova: apri la scheda **E-mail** di **Impostazioni del progetto > Notifiche > Registri di notifica** e seleziona **Visualizza messaggio di stato** sulla sua riga.
:::

:::details "Cannot send email with OAuth authentication"
L'accesso OAuth non è riuscito, e il messaggio termina con l'errore restituito dal tuo provider. Controlla **Client ID OAuth**, **Client Secret OAuth**, **URL del token OAuth** e **Scope OAuth**, che l'applicazione abbia le autorizzazioni indicate sopra e che sia stato concesso il consenso dell'amministratore. Se il tuo tenant Microsoft 365 ha SMTP AUTH disattivato, imposta invece **Trasporto** su `Microsoft Graph`.
:::

:::details "Microsoft Graph send failed"
Una configurazione con **Trasporto** `Microsoft Graph` mostra questo messaggio quando Graph non accetta la posta, seguito dall'errore di Microsoft. Controlla che l'app abbia l'autorizzazione dell'applicazione **Mail.Send** con il consenso dell'amministratore concesso, che lo **Scope OAuth** sia `https://graph.microsoft.com/.default` e che l'**Email mittente** sia una casella con licenza nel tuo tenant.
:::

:::details "SMTP server host … could not be reached"
OneUptime ha rifiutato di connettersi al server di posta del progetto. Su OneUptime Cloud, un hostname che non si risolve, o che si risolve in un indirizzo privato, di loopback o link-local, viene rifiutato con questo messaggio, che non dice mai quale dei casi si sia verificato: usa l'hostname pubblico del server di posta. In un'installazione self-hosted, e per un server di posta indicato con il suo indirizzo IP, il messaggio dice invece il motivo. **Invia e-mail di prova** lo mostra solo per una configurazione OAuth; per le altre, trovalo con **Visualizza messaggio di stato** nella scheda **E-mail** dei registri di notifica.
:::

:::details L'e-mail di prova non arriva
Controlla l'**Email mittente**: il tuo server deve consentire l'invio da quell'indirizzo. Poi guarda nella cartella spam del destinatario e nei log del tuo server di posta per il tentativo.
:::

## Buone pratiche di sicurezza

- **Ruota regolarmente i secret.** Imposta promemoria per sostituire i client secret prima che scadano.
- **Usa credenziali dedicate.** Crea credenziali apposite per OneUptime invece di condividerle con altre applicazioni.
- **Concedi il privilegio minimo.** Concedi solo ciò che serve all'invio: **SMTP.SendAsApp** per Microsoft, lo scope `https://mail.google.com/` per Google.
- **Monitora l'uso.** Esamina i log della posta e gli accessi delle applicazioni OAuth per individuare attività insolite.
- **Conserva i secret in modo sicuro.** Non inserire mai i client secret nel controllo di versione.

## Approfondimenti

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Passaggi successivi

:::cards
- [Riepilogo delle notifiche](/docs/emails/notification-rollup): Come OneUptime raggruppa le raffiche di e-mail ai proprietari.
- [Iscritti e annunci](/docs/status-pages/subscribers): Inviare la posta agli iscritti di una pagina di stato con una configurazione SMTP del progetto.
:::
