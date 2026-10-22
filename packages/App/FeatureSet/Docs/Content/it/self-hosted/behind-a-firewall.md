# Dietro una VPN o un firewall

Un'installazione self-hosted di OneUptime può restare non esposta su Internet: invia ogni avviso tramite connessioni in uscita. Alcune cose, però, arrivano dall'esterno. Un reperibile tocca **Acknowledge** in un messaggio, Twilio segnala un tasto premuto durante una chiamata, Slack segnala il clic su un pulsante. Questa pagina le elenca una per una, indicando per ciascuna chi si connette al tuo server e su quale percorso, così puoi pubblicare solo ciò che usi, o niente del tutto.

:::cards
- [Chi si connette al tuo server](#chi-si-connette-al-tuo-server): I telefoni dei reperibili e i provider che richiamano il server.
- [Mantenere tutto privato](#mantenere-tutto-privato): Metti i telefoni dei reperibili sulla tua VPN.
- [Pubblicare solo le pagine di conferma](#pubblicare-solo-le-pagine-di-conferma): Un ingresso stretto per i link di conferma.
- [Callback dei provider](#callback-dei-provider): Telegram, Twilio, WhatsApp, Slack e Microsoft Teams.
:::

## Chi si connette al tuo server

L'invio non richiede mai un accesso in entrata: OneUptime si connette in uscita al tuo server di posta, a Twilio, Telegram, Meta, Slack, Microsoft e al relay push. Ciò che arriva in entrata è uno di questi casi:

| Cosa succede | Chi si connette al tuo server | Un'allowlist degli indirizzi di origine può coprirlo? |
| --- | --- | --- |
| Un reperibile tocca **Acknowledge** in un'e-mail, in un SMS o in un messaggio WhatsApp o Telegram | Il telefono o il computer del reperibile | No: si connette da dovunque si trovi il reperibile |
| Un reperibile conferma l'avviso nell'app OneUptime On-Call | Il telefono del reperibile | No: per lo stesso motivo |
| Un reperibile preme 1 durante una telefonata di reperibilità | Twilio | Solo con Static Proxy for Webhooks di Twilio |
| Qualcuno collega il proprio account Telegram | Telegram | Sì, oppure usa il polling verso Telegram e non consentire nulla |
| Qualcuno fa clic su un pulsante in un messaggio Slack o Microsoft Teams | Slack o Microsoft | No: nessuno dei due pubblica indirizzi fissi |
| WhatsApp segnala che un messaggio è stato consegnato o letto | Meta | No: Meta non pubblica indirizzi fissi |

Un server self-hosted comunica direttamente con questi provider, mai attraverso i server di OneUptime, quindi non c'è alcun elenco di indirizzi di OneUptime da consentire.

## Mantenere tutto privato

Metti i telefoni dei reperibili sulla tua VPN: sempre attiva, oppure attivata su richiesta per il nome host di OneUptime, così nessuno deve connetterla prima di confermare un avviso alle 3 di notte. Senza pubblicare nulla:

- I link di conferma nelle e-mail, negli SMS e nei messaggi WhatsApp e Telegram si aprono, perché il telefono raggiunge il tuo server.
- L'app OneUptime On-Call funziona: puntala all'indirizzo del tuo server. Le notifiche push non richiedono accesso in entrata, perché il server le invia tramite il relay push.
- Le persone collegano i propri account Telegram una volta attivato il polling (vedi [Telegram](#telegram)).

Un link in un'app di messaggistica si apre nel browser interno di quell'app o nel browser predefinito del telefono, mai nell'app OneUptime. Una VPN per singola app deve quindi coprire le app di messaggistica e il browser, non solo l'app OneUptime.

Premere 1 durante una telefonata, i pulsanti nei messaggi Slack e Microsoft Teams e le ricevute di consegna di WhatsApp richiedono comunque che il rispettivo provider raggiunga il tuo server.

## Pubblicare solo le pagine di conferma

Se i telefoni dei reperibili non possono usare la tua VPN, pubblica le pagine che un link di conferma apre, e nient'altro. Metti davanti a OneUptime un reverse proxy, o un tunnel in uscita come Cloudflare Tunnel, che non richiede alcuna regola del firewall in entrata, e lascia passare solo questi percorsi:

| Metodo | Percorso | Cosa fornisce |
| --- | --- | --- |
| GET | `/l/*` | I link brevi negli SMS e nei messaggi WhatsApp e Telegram |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | La pagina con il motivo dell'avviso e il suo pulsante **Acknowledge** |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | Il pulsante **Acknowledge** |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Facoltativo: la pagina che passa l'avviso alla persona successiva |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Facoltativo: il suo pulsante |
| GET | `/oneuptime-assets/*` | I font, gli stili e il logo di quelle pagine |

:::steps
### Puntare un nome pubblico al proxy
I link nei messaggi sono costruiti a partire dall'impostazione `HOST`, quindi quel nome deve risolversi pubblicamente verso il proxy, con un certificato pubblicamente attendibile. Con un DNS separato, le persone sulla tua rete continuano a risolverlo verso l'indirizzo privato e usano tutto il resto come prima.

### Inoltrare i percorsi senza modificarli
Invia questi percorsi all'ingress di OneUptime con il loro metodo, percorso e query string, e rispondi con 404 a tutto il resto.

### Limitarne la frequenza
Ogni link contiene un ID casuale, e un link breve è lungo otto lettere. Limita le richieste che ogni indirizzo può fare, così nessuno può provare ID a raffica.
:::

Dopo che un reperibile ha confermato, la pagina apre l'avviso nella dashboard, che si carica solo sulla tua rete. A quel punto la conferma è già salvata.

## Callback dei provider

### Telegram

L'invio degli avvisi richiede solo HTTPS in uscita verso `api.telegram.org`. Collegare un account significa che il tuo server deve ricevere il messaggio `/start` che una persona invia al tuo bot, in uno di questi due modi:

- **Con il polling**: attiva **Poll Telegram for Messages** in **Admin Dashboard > Impostazioni > Telegram**. OneUptime recupera i messaggi del bot da Telegram ogni pochi secondi tramite HTTPS in uscita, quindi nulla deve raggiungere il tuo server.
- **Con un webhook**: Telegram invia ogni messaggio a `POST /api/notification/telegram/webhook`. Telegram [invia i webhook](https://core.telegram.org/bots/webhooks) da `149.154.160.0/20` e `91.108.4.0/22`, quindi puoi consentire solo quegli indirizzi.

### Twilio

Quando un reperibile preme 1 durante una chiamata per confermare l'avviso, Twilio invia il tasto a `POST /api/user-notification-log-timeline/call/gather-input/*`. Gli indirizzi dei webhook di Twilio cambiano, a meno che la tua edizione di Twilio non includa [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Gli aggiornamenti di consegna degli SMS e le chiamate in arrivo sono descritti in [Integrazione Twilio](/docs/self-hosted/twilio-integration).

### WhatsApp

Avvisi e conferme non richiedono nulla in entrata. Meta invia le ricevute di consegna e di lettura a `/api/notification/whatsapp/webhook`; senza di esse, il registro WhatsApp di OneUptime non può mostrare se un messaggio è stato consegnato, letto o è fallito dopo che Meta l'ha accettato. Meta firma ogni richiesta e non pubblica indirizzi fissi.

### Slack e Microsoft Teams

Pulsanti, menu e comandi nei loro messaggi chiamano il tuo server da indirizzi che nessuno dei due pubblica. I percorsi, e come pubblicarli, sono descritti in [Integrazione Slack](/docs/self-hosted/slack-integration) e [Integrazione Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).

## Passaggi successivi

:::cards
- [Integrazione Twilio](/docs/self-hosted/twilio-integration): SMS e chiamate tramite il tuo account Twilio.
- [Notifiche push](/docs/self-hosted/push-notifications): Il relay push, e cosa raggiungono il tuo server e i telefoni.
- [Panoramica delle app](/docs/mobile-desktop-apps/index): Collega l'app OneUptime On-Call al tuo server.
- [Accesso alla rete privata](/docs/self-hosted/private-network-access): Nella direzione opposta: consenti a OneUptime di raggiungere i tuoi strumenti interni.
:::
