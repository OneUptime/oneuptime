# Integrazione GitHub

Per integrare GitHub con la propria istanza self-hosted di OneUptime, è necessario creare una GitHub App e configurare le variabili d'ambiente richieste. Questo consente a OneUptime di connettersi ai propri repository GitHub per la gestione dei repository di codice.

## Prerequisiti

- Account GitHub con accesso amministratore dell'organizzazione (per i repository dell'organizzazione) o accesso all'account personale
- Accesso alla configurazione del server OneUptime

## Istruzioni di Configurazione

### Fase 1: Creare una GitHub App

1. Accedere a GitHub e navigare alle impostazioni della propria organizzazione o account personale:

   - **Per le Organizzazioni:** Accedere a `https://github.com/organizations/VOSTRA_ORG/settings/apps`
   - **Per Account Personale:** Accedere a `https://github.com/settings/apps`

2. Fare clic su **"New GitHub App"**

3. Compilare il modulo di registrazione:
   - **GitHub App name:** OneUptime (o qualsiasi nome univoco) - **Salvare questo nome, sarà necessario per la variabile d'ambiente `GITHUB_APP_NAME`**
   - **Homepage URL:** `https://vostro-dominio-oneuptime.com`
   - **Callback URL:** `https://vostro-dominio-oneuptime.com/api/github/auth/callback`
   - **Setup URL:** `https://vostro-dominio-oneuptime.com/api/github/auth/callback` - **Importante: Questo URL è dove GitHub reindirizza gli utenti dopo aver installato l'app. Deve essere impostato affinché il reindirizzamento funzioni.**
   - **Redirect on update:** Spuntare questa opzione per reindirizzare gli utenti dopo aver aggiornato l'installazione dell'app
   - **Webhook URL:** `https://vostro-dominio-oneuptime.com/api/github/webhook`
   - **Webhook secret:** Generare una stringa casuale sicura (salvarla per dopo)

### Fase 2: Configurare i Permessi dell'App

Nella sezione "Permissions & events", configurare i seguenti permessi:

**Permessi Repository:**

| Permesso        | Livello di Accesso  | Scopo                                                                       |
| --------------- | ------------------- | --------------------------------------------------------------------------- |
| Contents        | Lettura e Scrittura | Leggere i file del repository, fare push di branch (richiesto per AI Agent) |
| Pull requests   | Lettura e Scrittura | Creare e gestire pull request                                               |
| Issues          | Lettura e Scrittura | Leggere e commentare sulle issue                                            |
| Commit statuses | Lettura             | Controllare lo stato build/CI                                               |
| Actions         | Lettura             | Leggere i run e i log dei workflow GitHub Actions                           |
| Metadata        | Lettura             | Metadati base del repository (richiesto)                                    |

**Permessi Organizzazione (se si usa con le organizzazioni):**

| Permesso | Livello di Accesso | Scopo                                 |
| -------- | ------------------ | ------------------------------------- |
| Members  | Lettura            | Elencare i membri dell'organizzazione |

**Permessi Account:**

| Permesso        | Livello di Accesso | Scopo                                        |
| --------------- | ------------------ | -------------------------------------------- |
| Email addresses | Lettura            | Leggere l'email dell'utente per le notifiche |

### Fase 3: Iscriversi agli Eventi Webhook

Per ricevere aggiornamenti in tempo reale su OneUptime, iscriversi a questi eventi webhook:

- **Pull request** - Ricevere notifiche quando le PR vengono aperte, chiuse o unite
- **Push** - Ricevere notifiche quando viene fatto push del codice
- **Workflow run** - Ricevere aggiornamenti sullo stato CI/CD

### Fase 4: Impostare l'Accesso di Installazione

Sotto "Where can this GitHub App be installed?", scegliere:

- **Only on this account** - Per uso privato/interno
- **Any account** - Se si vuole che altri possano installare la propria app

### Fase 5: Creare la GitHub App

1. Fare clic su **"Create GitHub App"**
2. Si verrà reindirizzati alla pagina delle impostazioni dell'app
3. Annotare i seguenti valori:
   - **App ID** - Trovato in cima alla pagina delle impostazioni dell'app
   - **Client ID** - Trovato nella sezione "About"

### Fase 6: Generare il Client Secret

1. Nelle impostazioni della GitHub App, scorrere fino a "Client secrets"
2. Fare clic su **"Generate a new client secret"**
3. Copiare immediatamente il secret — non sarà più possibile vederlo

### Fase 7: Generare la Chiave Privata

1. Scorrere fino alla sezione "Private keys"
2. Fare clic su **"Generate a private key"**
3. Un file `.pem` verrà scaricato automaticamente
4. Conservare questo file in modo sicuro — viene usato per autenticarsi come GitHub App

### Fase 8: Configurare le Variabili d'Ambiente di OneUptime

#### Docker Compose

Se si usa Docker Compose, aggiungere queste variabili d'ambiente al file `config.env`:

```bash
# Configurazione GitHub App
GITHUB_APP_ID=VOSTRO_APP_ID
GITHUB_APP_NAME=VOSTRO_APP_NAME  # Il nome esatto della propria GitHub App (ad es. "OneUptime")
GITHUB_APP_CLIENT_ID=VOSTRO_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=VOSTRO_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<CONTENUTO_CHIAVE_PRIVATA_CODIFICATO_BASE64>"
GITHUB_APP_WEBHOOK_SECRET=VOSTRO_WEBHOOK_SECRET
```

**Nota:** Per la chiave privata, codificarla in base64 e incollarla senza righe vuote se il proprio ambiente non supporta le stringhe multiriga.

#### Kubernetes con Helm

Se si usa Kubernetes con Helm, aggiungere questi dati al file `values.yaml`:

```yaml
gitHubApp:
  id: "VOSTRO_APP_ID"
  name: "VOSTRO_APP_NAME" # Il nome esatto della propria GitHub App
  clientId: "VOSTRO_CLIENT_ID"
  clientSecret: "VOSTRO_CLIENT_SECRET"
  privateKey: "<CONTENUTO_CHIAVE_PRIVATA_CODIFICATO_BASE64>"
  webhookSecret: "VOSTRO_WEBHOOK_SECRET"
```

**Importante:** Riavviare il server OneUptime dopo aver aggiunto queste variabili d'ambiente affinché abbiano effetto.

### Fase 9: Installare la GitHub App

1. Accedere alla pagina pubblica della propria GitHub App: `https://github.com/apps/VOSTRO_APP_NAME`
2. Fare clic su **"Install"** o **"Configure"**
3. Selezionare l'organizzazione o l'account in cui installare l'app
4. Scegliere a quali repository l'app può accedere:
   - **All repositories** - Accesso a tutti i repository attuali e futuri
   - **Only select repositories** - Scegliere repository specifici
5. Fare clic su **"Install"**

### Fase 10: Connettere i Repository in OneUptime

1. Accedere al proprio dashboard OneUptime
2. Navigare a **Altro** > **Repository di Codice**
3. Fare clic su **"Crea Repository"** o usare il flusso di installazione della GitHub App
4. Se reindirizzati da GitHub, l'ID di installazione verrà acquisito automaticamente
5. Selezionare i repository da connettere dall'elenco
6. Fare clic su **"Connetti"** per collegare il repository al proprio progetto OneUptime

## Riferimento Variabili d'Ambiente

| Variabile                   | Descrizione                                                                  | Obbligatorio        |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------- |
| `GITHUB_APP_ID`             | L'App ID dalle impostazioni della propria GitHub App                         | Sì                  |
| `GITHUB_APP_NAME`           | Il nome esatto della propria GitHub App (usato per gli URL di installazione) | Sì                  |
| `GITHUB_APP_CLIENT_ID`      | Il Client ID dalle impostazioni della propria GitHub App                     | Sì                  |
| `GITHUB_APP_CLIENT_SECRET`  | Il client secret generato                                                    | Sì                  |
| `GITHUB_APP_PRIVATE_KEY`    | Il contenuto del file della chiave privata (.pem)                            | Sì                  |
| `GITHUB_APP_WEBHOOK_SECRET` | Il webhook secret per verificare i payload dei webhook                       | No (ma consigliato) |

## Risoluzione dei Problemi

### Problemi Comuni

**Non si viene reindirizzati a OneUptime dopo aver installato la GitHub App:**

- Assicurarsi che il **Setup URL** sia configurato nelle impostazioni della GitHub App a: `https://vostro-dominio-oneuptime.com/api/github/auth/callback`
- Accedere alle impostazioni della GitHub App > sezione "Post installation" e verificare che il Setup URL sia impostato correttamente
- L'opzione "Redirect on update" dovrebbe essere anche spuntata
- Nota: Il Setup URL è diverso dal Callback URL — entrambi dovrebbero puntare allo stesso endpoint `/api/github/auth/callback`

**Errore "GitHub App is not configured":**

- Assicurarsi che la variabile d'ambiente `GITHUB_APP_CLIENT_ID` sia impostata
- Riavviare il server OneUptime dopo aver impostato le variabili d'ambiente

**Errore "Invalid webhook signature":**

- Verificare che `GITHUB_APP_WEBHOOK_SECRET` corrisponda al secret configurato in GitHub
- Assicurarsi che l'URL del webhook sia corretto e accessibile da Internet

**Errore "Failed to get installation access token":**

- Verificare che `GITHUB_APP_PRIVATE_KEY` sia formattato correttamente
- Controllare che la chiave privata includa i marcatori BEGIN/END
- Assicurarsi che l'App ID sia corretto

**Non è possibile vedere i repository dopo l'installazione:**

- Verificare che la GitHub App abbia accesso ai repository che si vuole connettere
- Controllare i permessi di installazione in GitHub (Impostazioni > Applicazioni > GitHub Apps Installate)

**Gli eventi webhook non vengono ricevuti:**

- Assicurarsi che l'URL del webhook sia accessibile pubblicamente
- Controllare i log di consegna dei webhook nelle impostazioni della GitHub App
- Verificare che il webhook secret sia configurato correttamente

### Controllo delle Consegne Webhook

1. Accedere alle impostazioni della GitHub App
2. Fare clic su "Advanced" nella barra laterale
3. Visualizzare "Recent Deliveries" per vedere i tentativi di webhook e le risposte

## Buone Pratiche di Sicurezza

1. **Ruotare regolarmente i secret** - Generare periodicamente nuovi client secret e chiavi private
2. **Usare i webhook secret** - Configurare sempre un webhook secret per verificare l'autenticità del payload
3. **Limitare l'accesso ai repository** - Concedere l'accesso solo ai repository che devono essere connessi
4. **Monitorare le consegne webhook** - Controllare regolarmente le consegne fallite o le attività sospette
5. **Mantenere sicure le chiavi private** - Non mai commettere le chiavi private nel controllo versione

## Supporto

Se si incontrano problemi con l'integrazione GitHub, si prega di:

1. Controllare la sezione di risoluzione dei problemi sopra
2. Esaminare i log di OneUptime per messaggi di errore dettagliati
3. Contattarci all'indirizzo [hello@oneuptime.com](mailto:hello@oneuptime.com)

Accogliamo con piacere i feedback per migliorare questa integrazione!
