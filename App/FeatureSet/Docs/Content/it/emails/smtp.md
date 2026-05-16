# Configurazione SMTP

OneUptime supporta l'invio di email tramite server SMTP personalizzati con tre metodi di autenticazione:

- **Nome utente e Password** - Autenticazione SMTP tradizionale
- **OAuth 2.0** - Autenticazione moderna per Microsoft 365 e Google Workspace
- **Nessuna** - Per server relay che non richiedono autenticazione

Questa guida descrive come configurare l'autenticazione OAuth 2.0 per Microsoft 365 e Google Workspace.

## Autenticazione OAuth 2.0

OAuth 2.0 fornisce un modo più sicuro per autenticarsi con i server email, soprattutto per gli ambienti enterprise che hanno disabilitato l'autenticazione di base. OneUptime supporta due tipi di grant OAuth:

- **Client Credentials** - Usato da Microsoft 365 e dalla maggior parte dei provider OAuth
- **JWT Bearer** - Usato dagli account di servizio di Google Workspace

### Campi Richiesti per OAuth

Quando si configura SMTP con autenticazione OAuth in OneUptime, avrai bisogno di:

| Campo | Descrizione |
|-------|-------------|
| **Hostname** | Indirizzo del server SMTP |
| **Porta** | Porta SMTP (tipicamente 587 per STARTTLS o 465 per TLS implicito) |
| **Nome utente** | L'indirizzo email da cui inviare |
| **Tipo di Autenticazione** | Seleziona "OAuth" |
| **Tipo di Provider OAuth** | Seleziona "Client Credentials" per Microsoft 365, o "JWT Bearer" per Google Workspace |
| **Client ID** | ID applicazione/client dal tuo provider OAuth (per Google: email dell'account di servizio) |
| **Client Secret** | Client secret dal tuo provider OAuth (per Google: chiave privata) |
| **Token URL** | URL dell'endpoint token OAuth |
| **Scope** | Scope OAuth richiesti per l'accesso SMTP |

---

## Configurazione Microsoft 365

Per usare OAuth con Microsoft 365/Exchange Online, devi registrare un'applicazione in Microsoft Entra (Azure AD) e configurare le autorizzazioni appropriate.

### Passo 1: Registra un'Applicazione in Microsoft Entra

1. Accedi al [centro di amministrazione Microsoft Entra](https://entra.microsoft.com)
2. Naviga su **Identità** > **Applicazioni** > **Registrazioni app**
3. Clicca su **Nuova registrazione**
4. Inserisci un nome per la tua applicazione (es. "OneUptime SMTP")
5. Per **Tipi di account supportati**, seleziona "Account solo in questa directory organizzativa"
6. Lascia vuoto **URI di reindirizzamento** (non necessario per il flusso delle credenziali client)
7. Clicca su **Registra**

Dopo la registrazione, nota i seguenti valori dalla pagina **Panoramica**:
- **ID applicazione (client)** - Questo è il tuo Client ID
- **ID directory (tenant)** - Avrai bisogno di questo per il Token URL

### Passo 2: Crea un Client Secret

1. Nella registrazione della tua app, vai su **Certificati e segreti**
2. Clicca su **Nuovo segreto client**
3. Aggiungi una descrizione e seleziona un periodo di scadenza
4. Clicca su **Aggiungi**
5. **Copia immediatamente il valore del segreto** - non verrà mostrato di nuovo

### Passo 3: Aggiungi le Autorizzazioni API SMTP

1. Vai su **Autorizzazioni API**
2. Clicca su **Aggiungi un'autorizzazione**
3. Seleziona **API usate dalla mia organizzazione**
4. Cerca e seleziona **Office 365 Exchange Online**
5. Seleziona **Autorizzazioni applicazione**
6. Trova e seleziona **SMTP.SendAsApp**
7. Clicca su **Aggiungi autorizzazioni**
8. Clicca su **Concedi consenso amministratore per [la tua organizzazione]** (richiede privilegi di amministratore)

### Passo 4: Registra il Service Principal in Exchange Online

Prima che la tua applicazione possa inviare email, devi registrare il service principal in Exchange Online e concedere le autorizzazioni alla mailbox.

1. Installa il modulo PowerShell di Exchange Online:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Connettiti a Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Registra il service principal (usa l'Object ID da **Applicazioni Enterprise**, non da Registrazioni App):

```powershell
# Trova l'Object ID in Microsoft Entra > Applicazioni Enterprise > La Tua App > Object ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Concedi al service principal il permesso di inviare come mailbox specifica:

```powershell
# Concedi accesso completo alla mailbox al service principal
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Nota:** Usa `Add-MailboxPermission` (non `Add-RecipientPermission`). `Add-RecipientPermission` concede solo `SendAs` sul destinatario e non è sufficiente per il service principal per inviare posta tramite SMTP con OAuth — si otterrà un errore di autenticazione/permesso al momento dell'invio. `Add-MailboxPermission` con `FullAccess` è il comando che funziona effettivamente.

### Passo 5: Configura in OneUptime

In OneUptime, crea o modifica una configurazione SMTP con queste impostazioni:

| Campo | Valore |
|-------|-------|
| Hostname | `smtp.office365.com` |
| Porta | `587` |
| Nome utente | L'indirizzo email a cui hai concesso i permessi (es. `sender@yourdomain.com`) |
| Tipo di Autenticazione | `OAuth` |
| Tipo di Provider OAuth | `Client Credentials` |
| Client ID | Il tuo ID applicazione (client) dal Passo 1 |
| Client Secret | Il valore del segreto dal Passo 2 |
| Token URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope | `https://outlook.office365.com/.default` |
| Email Mittente | Uguale al Nome utente |
| Secure (TLS) | Abilitato |

Sostituisci `<tenant-id>` con il tuo ID directory (tenant) dal Passo 1.

---

## Configurazione Google Workspace

Google Workspace richiede un **account di servizio** con delega a livello di dominio per inviare email per conto degli utenti. Questo è necessario perché i server SMTP di Google non supportano il flusso diretto delle credenziali client OAuth per Gmail.

### Prerequisiti

- Account Google Workspace (non Gmail normale - gli account Gmail consumer non supportano questa funzionalità)
- Accesso Super Admin alla Console di Amministrazione di Google Workspace
- Accesso alla Google Cloud Console

### Passo 1: Crea un Progetto Google Cloud

1. Vai alla [Google Cloud Console](https://console.cloud.google.com)
2. Clicca sul menu a tendina del progetto e seleziona **Nuovo Progetto**
3. Inserisci un nome per il progetto e clicca su **Crea**
4. Seleziona il tuo nuovo progetto

### Passo 2: Abilita l'API Gmail

1. Vai su **API e servizi** > **Libreria**
2. Cerca "Gmail API"
3. Clicca su **Gmail API** e poi su **Abilita**

### Passo 3: Crea un Account di Servizio

1. Vai su **API e servizi** > **Credenziali**
2. Clicca su **Crea credenziali** > **Account di servizio**
3. Inserisci un nome e una descrizione per l'account di servizio
4. Clicca su **Crea e continua**
5. Salta i passaggi opzionali e clicca su **Fine**

### Passo 4: Crea le Chiavi dell'Account di Servizio

1. Clicca sull'account di servizio appena creato
2. Vai alla scheda **Chiavi**
3. Clicca su **Aggiungi chiave** > **Crea nuova chiave**
4. Seleziona **JSON** e clicca su **Crea**
5. Salva il file JSON scaricato in modo sicuro - contiene:
   - `client_id` - Il tuo Client ID
   - `private_key` - Il tuo Client Secret (la chiave privata)

### Passo 5: Abilita la Delega a Livello di Dominio

1. Nei dettagli dell'account di servizio, clicca su **Mostra impostazioni avanzate**
2. Nota il **Client ID** (ID numerico)
3. Seleziona **Abilita Delega a livello di dominio di Google Workspace**
4. Clicca su **Salva**

### Passo 6: Autorizza l'Account di Servizio nella Console di Amministrazione di Google Workspace

1. Accedi alla [Console di Amministrazione di Google Workspace](https://admin.google.com)
2. Vai su **Sicurezza** > **Controllo accessi e dati** > **Controlli API**
3. Clicca su **Gestisci deleghe a livello di dominio**
4. Clicca su **Aggiungi nuovo**
5. Inserisci il **Client ID** dal Passo 5
6. Per gli **Scope OAuth**, inserisci: `https://mail.google.com/`
7. Clicca su **Autorizza**

Nota: Potrebbero volerci da qualche minuto a 24 ore per la propagazione della delega.

### Passo 7: Configura in OneUptime

In OneUptime, crea o modifica una configurazione SMTP con queste impostazioni:

| Campo | Valore |
|-------|-------|
| Hostname | `smtp.gmail.com` |
| Porta | `587` |
| Nome utente | L'indirizzo email di Google Workspace da cui inviare (es. `notifications@yourdomain.com`). Questo utente sarà impersonato dall'account di servizio. |
| Tipo di Autenticazione | `OAuth` |
| Tipo di Provider OAuth | `JWT Bearer` |
| Client ID | La `client_email` dal tuo JSON dell'account di servizio (es. `your-service@your-project.iam.gserviceaccount.com`) |
| Client Secret | La `private_key` dal tuo JSON dell'account di servizio (l'intera chiave inclusi `-----BEGIN PRIVATE KEY-----` e `-----END PRIVATE KEY-----`) |
| Token URL | `https://oauth2.googleapis.com/token` |
| Scope | `https://mail.google.com/` |
| Email Mittente | Uguale al Nome utente |
| Secure (TLS) | Abilitato |

**Importante:** Per Google (JWT Bearer), il Client ID è l'**email dell'account di servizio** (`client_email`), NON il `client_id` numerico. L'account di servizio impersonerà l'utente specificato nel campo Nome utente per inviare email.

---

## Risoluzione dei Problemi

### Microsoft 365

| Problema | Soluzione |
|-------|----------|
| "Authentication unsuccessful" | Verifica che il service principal sia registrato in Exchange e abbia i permessi sulla mailbox |
| "AADSTS700016: Application not found" | Controlla che il Client ID sia corretto e che l'app esista nel tuo tenant |
| "AADSTS7000215: Invalid client secret" | Rigenera il client secret - potrebbe essere scaduto |
| "The mailbox is not enabled for this operation" | Esegui `Add-MailboxPermission` per concedere l'accesso alla mailbox |

### Google Workspace

| Problema | Soluzione |
|-------|----------|
| "invalid_grant" | Assicurati che la delega a livello di dominio sia correttamente configurata e propagata |
| "unauthorized_client" | Verifica che il Client ID sia autorizzato nella Console di Amministrazione di Google Workspace |
| "access_denied" | Controlla che lo scope `https://mail.google.com/` sia autorizzato |
| "Domain policy has disabled third-party Drive apps" | Abilita l'accesso API in Google Workspace Admin > Sicurezza > Controlli API |

### Generale

- **Testa la tua configurazione**: Usa il pulsante "Invia Email di Test" in OneUptime per verificare la tua configurazione
- **Controlla i log**: Rivedi i log di OneUptime per messaggi di errore dettagliati
- **Cache dei token**: OneUptime memorizza nella cache i token OAuth e li rinnova automaticamente prima della scadenza

---

## Best Practice di Sicurezza

1. **Ruota i segreti regolarmente**: Imposta promemoria sul calendario per ruotare i client secret prima della scadenza
2. **Usa account di servizio dedicati**: Crea credenziali separate per OneUptime invece di condividerle con altre applicazioni
3. **Principio del privilegio minimo**: Concedi solo le autorizzazioni minime necessarie (SMTP.SendAsApp per Microsoft, scope mail.google.com per Google)
4. **Monitora l'utilizzo**: Esamina i log delle email e gli accessi alle applicazioni OAuth per attività insolite
5. **Archiviazione sicura**: Non inserire mai i client secret nel controllo di versione

---

## Risorse Aggiuntive

### Microsoft 365
- [Autenticazione di una connessione IMAP, POP o SMTP tramite OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Registrare un'applicazione con la piattaforma di identità Microsoft](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [Uso di OAuth 2.0 per applicazioni da server a server](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Documentazione dell'API Gmail](https://developers.google.com/gmail/api)
- [Protocollo XOAUTH2](https://developers.google.com/gmail/imap/xoauth2-protocol)
