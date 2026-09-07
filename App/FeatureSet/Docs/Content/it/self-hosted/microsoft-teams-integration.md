# Integrazione Microsoft Teams

Per integrare Microsoft Teams con la propria istanza self-hosted di OneUptime, è necessario configurare la Registrazione App Azure e impostare le variabili d'ambiente richieste.

## Prerequisiti

- Account Azure - È possibile crearne uno su [https://azure.com](https://azure.com)
- Accesso alla configurazione del server OneUptime

### Installazioni in reti private

OneUptime utilizza un Azure Bot per l'integrazione Teams. Un URL Incoming Webhook o Teams Workflow non sostituisce l'endpoint di messaggistica di questo bot. Microsoft richiede un [endpoint HTTPS accessibile pubblicamente per un bot self-hosted](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). Un indirizzo IP privato, un nome DNS interno o la connessione VPN di un dipendente non danno ad Azure Bot Service accesso a OneUptime.

Segua la guida all'[accesso alle reti private per le integrazioni](/docs/self-hosted/integration-network-access) prima di proseguire con la configurazione. La guida tratta DNS pubblico, TLS attendibile, un reverse proxy che inoltra le richieste all'installazione privata, regole firewall e verifica. Per Teams, pubblichi `/api/microsoft-bot/messages` e imposti l'**endpoint di messaggistica** Azure Bot del passaggio 4 su tale URL HTTPS pubblico completo. Mantenga intatti il prefisso `/api`, il corpo della richiesta e l'intestazione `Authorization`. Lasci che l'autenticazione del bot convalidi le richieste; un accesso interattivo al proxy o una verifica del browser impediscono a Microsoft di recapitarle.

I reindirizzamenti della registrazione dell'app `/api/microsoft-teams/auth` e `/api/microsoft-teams/admin-consent/callback` ritornano attraverso il browser dell'utente. Tale browser deve raggiungere OneUptime, ad esempio tramite la rete aziendale o una VPN. I messaggi del bot e le azioni delle schede arrivano dai server Microsoft e necessitano di un proprio ingress raggiungibile. La sola consegna degli avvisi in uscita non verifica la connettività in ingresso.

Per lo sviluppo, la [guida Microsoft ai test di Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug) descrive come esporre un servizio locale tramite un tunnel. Inoltri all'ingress OneUptime e utilizzi `/api/microsoft-bot/messages`, sostituendo il percorso di esempio Microsoft `/api/messages`. Aggiorni l'endpoint Azure Bot ogni volta che cambia l'URL pubblico del tunnel e utilizzi un ingress stabile in produzione.

Azure Bot Private Endpoint non sostituisce questo ingress Teams. Le [istruzioni Microsoft sull'isolamento di rete](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) descrivono l'isolamento di Direct Line e indicano che disabilitare l'accesso alla rete pubblica rimuove la configurazione dei canali Teams.

## Istruzioni di Configurazione

### Fase 1: Creare la Registrazione App Azure

1. Accedere al [Portale Azure](https://portal.azure.com)
2. Navigare a "Registrazioni app" e fare clic su "Nuova registrazione"
3. Compilare il modulo di registrazione:
   - **Nome:** oneuptime
   - **Tipi di account supportati:** Account in qualsiasi directory organizzativa (Qualsiasi tenant Microsoft Entra ID - Multitenant)
   - **URI di reindirizzamento:** Web - `https://vostro-dominio-oneuptime.com/api/microsoft-teams/auth`
   - Aggiungere anche: `https://vostro-dominio-oneuptime.com/api/microsoft-teams/admin-consent/callback`
4. Fare clic su "Registra"
5. Annotare l'"ID applicazione (client)" — sarà necessario in seguito

### Fase 2: Configurare i Permessi dell'App

1. Nella propria registrazione app, accedere a "Autorizzazioni API"
2. Fare clic su "Aggiungi un'autorizzazione" e selezionare "Microsoft Graph"

**Aggiungere Autorizzazioni Delegate** (quando si agisce per conto di un utente connesso):

- **User.Read** - Richiesto per ottenere le informazioni del profilo dell'utente autenticato (nome visualizzato, email) durante il flusso OAuth
- **Team.ReadBasic.All** - Richiesto per elencare i team di cui l'utente è membro durante la selezione del team da connettere
- **Channel.ReadBasic.All** - Richiesto per leggere le informazioni sui canali ed elencare i canali all'interno dei team per la consegna delle notifiche
- **ChannelMessage.Send** - Richiesto per inviare notifiche di avvisi e incidenti ai canali Teams

**Aggiungere Autorizzazioni Applicazione** (quando si agisce come app stessa, senza un utente connesso):

- **Team.ReadBasic.All** - Richiesto per elencare tutti i team nell'organizzazione dopo che è stato concesso il consenso amministratore
- **Channel.ReadBasic.All** - Richiesto per verificare l'esistenza del canale e recuperare i dettagli del canale

`ChannelMessage.Send` è soltanto un'autorizzazione delegata; non esiste una variante come autorizzazione dell'applicazione nel [riferimento alle autorizzazioni Microsoft Graph](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend). La mantenga nell'elenco delle autorizzazioni delegate riportato sopra.

**Nota:** Il Bot Framework gestisce la consegna dei messaggi usando i permessi Resource-Specific Consent (RSC) definiti nel manifesto dell'app Teams. Questi permessi sono:

- **ChannelMessage.Send.Group** - Consente al bot di inviare messaggi ai canali del team
- **ChannelMessage.Read.Group** - Consente al bot di leggere i messaggi del canale per i comandi interattivi
- **Channel.Create.Group** - Consente al bot di creare canali quando necessario

3. Fare clic su "Concedi consenso amministratore" per la propria organizzazione

### Fase 3: Creare il Client Secret

1. Accedere a "Certificati e segreti" nella propria registrazione app
2. Fare clic su "Nuovo segreto client"
3. Aggiungere una descrizione e impostare la scadenza (si consiglia 24 mesi)
4. Fare clic su "Aggiungi" e copiare immediatamente il valore del segreto — non sarà più possibile vederlo

**Importante:** Non copiare l'ID del segreto, è necessario il VALORE del segreto che è tipicamente più lungo e include più caratteri.

### Fase 4: Creare un Bot Service

1. Nel Portale Azure, navigare a "Azure Bot" e fare clic su "Crea"
2. Compilare il modulo di creazione del bot:

   - **Bot handle:** oneuptime-bot
   - **Sottoscrizione:** La propria sottoscrizione Azure
   - **Gruppo di risorse:** Creare uno nuovo o usare uno esistente
   - **Posizione:** Scegliere una posizione vicina ai propri utenti
   - **Piano tariffario:** F0 (Gratuito) è sufficiente per i test
   - Usare l'App (client) ID e il Tenant ID dalla registrazione app creata in precedenza

3. Fare clic su "Rivedi + crea" e poi su "Crea"

4. Una volta distribuito, accedere alla propria risorsa bot e navigare a "Configurazione"
5. Impostare l'"Endpoint di messaggistica" a `https://vostro-dominio-oneuptime.com/api/microsoft-bot/messages`
6. Salvare la configurazione

### Fase 5: Aggiungere il Canale Microsoft Teams al Bot

1. Nella risorsa Azure Bot, navigare a "Canali"
2. Trovare e selezionare "Microsoft Teams" e fare clic su "Apri" o "Aggiungi"
3. Esaminare le impostazioni (abilitare per Teams, mantenere le opzioni di messaggistica predefinite a meno che non si abbiano esigenze specifiche)
4. Fare clic su "Salva" (e "Fatto"/"Pubblica" se richiesto) per abilitare il canale Teams

### Fase 6: Configurare le Variabili d'Ambiente di OneUptime

#### Docker Compose

Se si usa Docker Compose, aggiungere queste variabili d'ambiente alla propria configurazione:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=VOSTRO_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=VOSTRO_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=VOSTRO_MICROSOFT_TENANT_ID
```

#### Kubernetes con Helm

Se si usa Kubernetes con Helm, aggiungere questi dati al file `values.yaml`:

```yaml
microsoftTeamsApp:
  clientId: VOSTRO_TEAMS_APP_CLIENT_ID
  clientSecret: VOSTRO_TEAMS_APP_CLIENT_SECRET
   tenantId: VOSTRO_MICROSOFT_TENANT_ID
```

**Importante:** Riavviare il server OneUptime dopo aver aggiunto queste variabili d'ambiente affinché abbiano effetto.

### Fase 7: Caricare il Manifesto App Teams

1. Accedere a **Impostazioni del progetto** > **Area di lavoro** > **Microsoft Teams**
2. Scaricare il manifesto dell'app Teams da lì
3. Accedere a Microsoft Teams, fare clic su "App" nella barra laterale
4. In basso, fare clic su "Gestisci le tue app"
5. Fare clic su "Carica un'app personalizzata"
6. Selezionare "Carica per me o per i miei team"
7. Caricare il file zip del manifesto scaricato in precedenza

## Risoluzione dei Problemi

In caso di problemi:

- Assicurarsi che l'app abbia i permessi corretti concessi
- Verificare che l'URI di reindirizzamento corrisponda esattamente (sostituire `vostro-dominio-oneuptime.com` con il proprio dominio effettivo)
- Verificare che le variabili d'ambiente siano impostate correttamente
- Assicurarsi che l'endpoint di messaggistica del bot sia accessibile da Internet
- Verificare che il bot sia configurato correttamente con il canale Teams
- Controllare che il manifesto dell'app Teams sia stato caricato con successo

## Supporto

Vogliamo migliorare questa integrazione, quindi i feedback sono più che benvenuti. Inviare qualsiasi commento a [hello@oneuptime.com](mailto:hello@oneuptime.com)
