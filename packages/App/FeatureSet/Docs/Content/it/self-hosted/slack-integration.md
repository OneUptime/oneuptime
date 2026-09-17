# Integrazione Slack

Collega il progetto OneUptime self-hosted a Slack per inviare notifiche e utilizzare azioni sugli incidenti, comandi ed eventi dei messaggi.

## Configurazione

1. Configura hostname e HTTPS di OneUptime come indicato sotto. Copia il manifesto generato in **Settings > Slack Integration**, disponibile anche su `https://your-oneuptime-domain.com/api/slack/app-manifest`.
2. [Crea un’app Slack](https://api.slack.com/apps) nel workspace usando il manifesto della tua installazione, affinché gli URL corrispondano all’hostname.
3. Copia **Client ID**, **Client Secret** e **Signing Secret** da **Basic Information** in `config.env` per Docker Compose:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Per Helm, imposta questi valori:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Applica la configurazione e attendi il riavvio di OneUptime. Se la verifica dell’URL Events è fallita prima di configurare il segreto di firma, riprova ora.
5. Torna in **Settings > Slack Integration**, seleziona **Connect to Slack** e autorizza l’app. Collega anche l’account Slack personale in OneUptime per le azioni che richiedono un’identità utente.

## Accesso di rete per installazioni self-hosted

### Direzione del traffico ed endpoint

| Traffico | Accesso richiesto |
| --- | --- |
| OneUptime → Slack | DNS e HTTPS in uscita su TCP 443 verso `slack.com` per Web API e scambio OAuth; `hooks.slack.com` per risposte ai comandi e notifiche tramite webhook in entrata, se utilizzati |
| Slack → OneUptime | HTTPS pubblico su TCP 443 verso i quattro percorsi POST sotto per l’integrazione completa |
| Browser dell’utente → OneUptime | Dashboard e redirect OAuth a `/api/slack/auth/:projectId/:userId` e `/api/slack/auth/:projectId/:userId/user`; possono restare accessibili tramite VPN utente |

Questi domini descrivono l’integrazione OneUptime, non una lista completa per client o funzionalità Slack. Un webhook Slack *in entrata* è ospitato da Slack: OneUptime vi invia richieste; non è un endpoint in entrata sul tuo server. Consulta la [guida ai webhook in entrata](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Inoltra questi callback del provider all’applicazione OneUptime tramite il suo ingress:

| Metodo e percorso | Scopo |
| --- | --- |
| `POST /api/slack/events` | Verifica Events API, reazioni, menzioni e messaggi |
| `POST /api/slack/interactive` | Pulsanti, scorciatoie, invio di finestre modali, `/incident` e `/maintenance` |
| `POST /api/slack/options-load` | Richieste di opzioni dei menu interattivi |
| `POST /api/slack/command` | Comando `/oneuptime` |

OAuth prevede un [redirect del browser seguito dallo scambio di token sul server](https://docs.slack.dev/authentication/installing-with-oauth/). Il manifesto registra `/api/slack/auth` come prefisso; OneUptime aggiunge i percorsi di progetto e utente durante l’autorizzazione. Il solo accesso del browser non consente a Slack di consegnare eventi o azioni.

### Installazioni private e sicurezza dei callback

Usa DNS pubblico e un gateway con certificato HTTPS pubblicamente attendibile, catena completa e percorso privato all’ingress OneUptime. Consenti TCP 443 in entrata e pubblica solo i callback POST del provider indicati sopra. Un `ClusterIP` privato, DNS interno o VPN di un dipendente non basta al provider. Il DNS separato per rete interna ed esterna mantiene privati dashboard e percorsi OAuth del browser con lo stesso hostname.

Imposta `HOST=oneuptime.example.com` e `HTTP_PROTOCOL=https` in `config.env`, oppure `host: oneuptime.example.com` e `httpProtocol: https` in Helm. Applica la configurazione e attendi il riavvio. Questi valori generano URL; non configurano DNS, TLS o firewall. Rigenera e aggiorna il manifesto Slack quando cambia l’hostname.

Conserva metodo, percorso, query string, corpo originale, `Content-Type`, `X-Slack-Signature` e `X-Slack-Request-Timestamp`. Mantieni host pubblico e schema HTTPS tramite header proxy attendibili. Escludi i callback da SSO del browser, CAPTCHA e pagine di login del proxy, mantenendo i controlli di firma e timestamp OneUptime. Sincronizza l’orologio del server. Un controllo dell’IP sorgente non sostituisce la [verifica delle firme Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Verificare l’accesso e comprendere i limiti

Verifica Events Request URL in **Event Subscriptions**: Slack invia una [challenge POST e controlla TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Invia una notifica di prova, esegui un comando slash, premi un pulsante di incidente e genera un evento sottoscritto. Controlla i log del gateway e di OneUptime senza registrare segreti. Slack richiede conferme rapide, incluse [risposte entro tre secondi per le interazioni](https://docs.slack.dev/interactivity/handling-user-interaction/). Un GET del browser o un messaggio in uscita riuscito non verifica i callback POST.

Senza connessioni in entrata, un’app già autorizzata può inviare messaggi tramite HTTPS in uscita, ma eventi, pulsanti, scorciatoie e comandi non funzionano. Il manifesto OneUptime usa callback HTTP e disabilita Socket Mode; attivare questa modalità Slack non è un’alternativa supportata. L’[impostazione di accesso alla rete privata](/docs/self-hosted/private-network-access) controlla richieste in uscita verso destinazioni private e non pubblica callback.
