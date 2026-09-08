# Integrazione Microsoft Teams

Per integrare Microsoft Teams con la propria istanza self-hosted di OneUptime, è necessario configurare la Registrazione App Azure e impostare le variabili d'ambiente richieste.

## Prerequisiti

- Account Azure - È possibile crearne uno su [https://azure.com](https://azure.com)
- Accesso alla configurazione del server OneUptime

## Accesso di rete

OneUptime utilizza un Azure Bot per l'integrazione Teams. Un URL Incoming Webhook o Teams Workflow non sostituisce l'endpoint di messaggistica di questo bot. Microsoft richiede un [endpoint HTTPS accessibile pubblicamente per un bot self-hosted](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). Un indirizzo IP privato, un nome DNS interno o la connessione VPN di un dipendente non danno ad Azure Bot Service accesso a OneUptime.

| Funzionalità | Da OneUptime al fornitore | Dal fornitore a OneUptime |
| --- | --- | --- |
| Notifiche Teams | HTTPS verso le API Microsoft | Necessario per l'integrazione completa del bot, incluso il rilevamento delle conversazioni |
| Comandi Teams, pulsanti delle schede, eventi di installazione nelle chat | HTTPS | `POST /api/microsoft-bot/messages` |

I reindirizzamenti della registrazione dell'app `/api/microsoft-teams/auth` e `/api/microsoft-teams/admin-consent/callback` ritornano attraverso il browser dell'utente. Tale browser deve raggiungere OneUptime, ad esempio tramite la rete aziendale o una VPN. I messaggi del bot e le azioni delle schede arrivano dai server Microsoft e necessitano di un proprio ingress raggiungibile. La sola consegna degli avvisi in uscita non verifica la connettività in ingresso.

### Produzione: pubblicare un gateway verso l'installazione privata

1. **Scelga un nome host**, ad esempio `oneuptime.example.com`. Pubblichi record DNS pubblici che puntino a un gateway esposto a Internet. I fornitori non possono raggiungere indirizzi IP privati e nomi DNS esclusivamente interni. Con DNS separato, i dipendenti possono risolvere lo stesso nome host verso l'ingress privato e continuare a utilizzare la dashboard tramite VPN. Anche l'ingress privato deve servire HTTPS con un certificato valido per quel nome host.

2. **Colleghi il gateway a OneUptime.** Lo collochi in una DMZ con una rotta verso l'ingress privato, oppure utilizzi un gateway pubblico collegato attraverso la propria VPN site-to-site o connessione privata. Consenta il traffico dal gateway all'ingress sulla porta del servizio a monte. Per Kubernetes/Portainer, un servizio privato `ClusterIP` da solo non basta: il gateway necessita di un ingress/controller o di un'altra destinazione raggiungibile. Mantenga privati database e altri servizi interni.

3. **Termini HTTPS sulla porta 443** con un certificato pubblicamente attendibile e una catena intermedia completa. Consenta TCP in ingresso sulla porta 443 del gateway. Installare un certificato o modificare il DNS non crea da solo la rotta verso la destinazione privata.

4. Pubblichi solo `/api/microsoft-bot/messages` e imposti questo URL HTTPS pubblico completo come endpoint di messaggistica Azure Bot nel passaggio 4. L'adattatore Bot Framework di OneUptime deve ricevere e autenticare le richieste. Conservi metodo, percorso, stringa di query, corpo e intestazioni di autenticazione (`Authorization`). Mantenga l'`Host` pubblico e imposti intestazioni attendibili `X-Forwarded-Host` e `X-Forwarded-Proto: https`. Non aggiunga reindirizzamenti.

5. Escluda questi percorsi da SSO del browser, CAPTCHA e pagine di accesso del proxy. Mantenga attiva l'autenticazione OneUptime. Limiti l'accesso all'origine al gateway e ai client interni autorizzati; oscuri i token nei log.

6. **Imposti l'URL canonico di OneUptime**:

   Docker Compose, in `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Valori Helm/Portainer:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Sostituisca l'esempio con il suo dominio. Queste impostazioni generano URL; non creano DNS, TLS o regole firewall. Applichi la configurazione Compose o l'aggiornamento Helm e attenda il riavvio dell'applicazione. Se il nome host cambia, aggiorni l'endpoint Azure Bot e gli URI di reindirizzamento della registrazione dell'app, quindi scarichi e carichi nuovamente il manifesto Teams.

Le [impostazioni di accesso alle reti private](/docs/self-hosted/private-network-access) controllano le richieste in uscita di OneUptime verso servizi interni. Abilitare `ALLOW_PRIVATE_NETWORK_WEBHOOKS` non rende OneUptime raggiungibile da Teams.

### Accesso in uscita e restrizioni IP

Consenta la risoluzione DNS e HTTPS (TCP 443) in uscita dall'applicazione OneUptime. Teams utilizza `graph.microsoft.com`, `login.microsoftonline.com`, gli endpoint di autenticazione/canale Bot Framework e l'URL del servizio connettore della conversazione. Utilizzi le [indicazioni Microsoft sui firewall](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) ed esamini il traffico bloccato durante i test; questi esempi non sono un elenco completo di domini. Il connettore di riserva del cloud commerciale è `https://smba.trafficmanager.net/teams/`; l'URL del servizio di una conversazione può essere diverso.

Microsoft non supporta liste fisse di IP in ingresso per Bot Framework, perché gli indirizzi cambiano. Gli intervalli multimediali dei client Teams non sono gli indirizzi sorgente dei webhook del bot. Mantenga attiva l'autenticazione Bot Framework.

### Test e installazioni senza accesso in ingresso

Da una rete esterna alla VPN, verifichi DNS pubblico e TLS, quindi controlli il percorso Teams:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Nelle versioni attuali di OneUptime, la risposta prevista è `405 Method Not Allowed` con `Allow: POST`. Questo conferma che la richiesta GET ha raggiunto il percorso, non che una richiesta POST autenticata del bot funzionerà. Le versioni precedenti possono restituire l'errore JSON 404 di OneUptime; esamini il corpo della risposta e i registri del proxy. Errori TLS, timeout o una pagina di errore HTML del proxy indicano problemi di certificato o instradamento.

Colleghi Teams, invii una notifica di prova, scriva al bot e prema un pulsante di una scheda. Confermi l'azione in OneUptime e confronti le diagnostiche Microsoft con i log del gateway e dell'applicazione. Una notifica ricevuta non verifica un POST in ingresso autenticato.

Per lo sviluppo, la [guida Microsoft ai test di Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams) descrive come esporre un servizio locale tramite un tunnel. Inoltri all'ingress OneUptime e utilizzi `/api/microsoft-bot/messages`, sostituendo il percorso di esempio Microsoft `/api/messages`. Aggiorni l'endpoint Azure Bot ogni volta che cambia l'URL pubblico del tunnel e utilizzi un ingress stabile in produzione. Configuri anche il nome host OneUptime corrispondente. Arresti il tunnel dopo i test: espone comunque un accesso in ingresso.

Se ogni connessione in ingresso è vietata, l'integrazione Teams completa non funziona: comandi, azioni delle schede e rilevamento delle conversazioni ne dipendono. Un'installazione completamente disconnessa non può usare Teams.

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
