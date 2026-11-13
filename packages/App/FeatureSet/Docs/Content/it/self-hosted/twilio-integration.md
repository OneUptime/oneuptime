# Integrazione Twilio

OneUptime self-hosted invia gli avvisi via SMS e voce tramite il tuo account Twilio, e paghi Twilio direttamente. Le credenziali Twilio si salvano nella dashboard di OneUptime, per un progetto o per l'intera installazione. Un'installazione distribuita da codice può invece impostare l'account dell'intera installazione con variabili d'ambiente, che il chart Helm e Docker Compose trasmettono: vedi [Impostare l'account dell'intera installazione con variabili d'ambiente](#impostare-laccount-dellintera-installazione-con-variabili-dambiente).

> [!NOTE]
> Una vecchia migrazione ha importato una volta `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_PHONE_NUMBER`; modificare quelle variabili non aggiorna le credenziali di un'installazione esistente. Le variabili `GLOBAL_TWILIO_` qui sotto invece sì.

:::cards
- [Preparare l'account Twilio](#1-preparare-laccount-twilio): Credenziali, un numero di telefono e i limiti dell'account.
- [Salvare le credenziali](#2-salvare-le-credenziali-in-oneuptime): Per un progetto, o per l'intera installazione.
- [Configurare l'accesso alla rete](#3-configurare-laccesso-alla-rete): Cosa Twilio deve raggiungere sul tuo server, e quando.
- [Verificare i numeri di telefono](#5-verificare-i-numeri-di-telefono-dei-membri-del-team): Come vengono verificati i numeri dei membri del team.
:::

## 1. Preparare l'account Twilio

:::steps
### Copia le tue credenziali

Apri la [Twilio Console](https://console.twilio.com/) e copia il tuo **Account SID** e il tuo **Auth Token**.

### Procurati un numero di telefono

Procurati un numero di telefono Twilio con le funzionalità SMS e/o voce che ti servono; la Twilio Console mostra che cosa può fare ogni numero. Usa il formato E.164, con il prefisso internazionale, per i numeri del mittente e del destinatario. Dove nessun numero fa entrambe le cose, procuratene uno per le chiamate e uno per gli SMS: vedi [Numeri separati per chiamate e SMS](#numeri-separati-per-chiamate-e-sms).

### Controlla i limiti dell'account

Controlla il saldo dell'account, i permessi dei paesi di destinazione e i requisiti di registrazione dei mittenti applicabili. Gli account di prova hanno restrizioni sui destinatari, geografiche e di altro tipo che possono impedire il funzionamento degli avvisi reali di OneUptime; prima di provare, consulta la [documentazione di Twilio su account e prova gratuita](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account). In produzione usa un account aggiornato.
:::

## 2. Salvare le credenziali in OneUptime

Salva le credenziali per un progetto, oppure una sola volta per l'intera installazione:

| | Configurazione del progetto | Configurazione dell'installazione |
| --- | --- | --- |
| Dove | La scheda **Configurazione Twilio**, in **Altre impostazioni** di **Impostazioni del progetto > Notifiche > Canali di notifica** | **Admin Dashboard > Impostazioni > Chiamate e SMS** |
| Chi può impostarla | **Proprietario del progetto**, **Amministratore del progetto**, oppure **Create Call and SMS** in un ruolo personalizzato | Un amministratore principale |
| Chi può leggerne l'Auth Token | **Proprietario del progetto**, **Amministratore del progetto**, oppure **Read Call and SMS** in un ruolo personalizzato. Gli altri che vedono la configurazione ne vedono il resto; il token è salvato cifrato | Un amministratore principale |
| Usata per | SMS e chiamate ai membri del progetto finché è la predefinita del progetto, le pagine di stato a cui è assegnata e le policy delle chiamate in arrivo che la usano | SMS e chiamate ai membri di qualsiasi progetto che non ha una configurazione predefinita |

Per aggiungere una configurazione di progetto:

:::steps
1. Vai su **Impostazioni del progetto > Notifiche > Canali di notifica** e apri **Altre impostazioni**.
2. In **Configurazione Twilio**, seleziona **Crea configurazione Twilio**.
3. Inserisci un nome e scegli in **Usa questo account per** che cosa invia l'account: **Chiamate e SMS**, **Solo SMS** o **Solo chiamate**. Poi inserisci **SID dell'account Twilio**, **Token di autenticazione Twilio** e il numero che la scelta richiede: **Numero di telefono principale Twilio** per le chiamate, oppure **Numeri di telefono SMS Twilio** per **Solo SMS**. In **Altri campi**, se vuoi, inserisci **Numeri di telefono secondari Twilio** separati da virgole per altri paesi, e **Numeri di telefono SMS Twilio** se i tuoi numeri non possono inviare SMS.
4. **Imposta come predefinito del progetto** è attivo per la prima configurazione del progetto, quindi SMS e chiamate ai membri del progetto, notifiche di reperibilità comprese, passano da lì appena salvi. Disattivalo se questo account serve solo per le pagine di stato o le chiamate in arrivo. Una configurazione aggiunta dopo parte con l'interruttore disattivato: attivalo, oppure scegli **Imposta come predefinito del progetto** dal menu della riga della configurazione, per spostarvi quei messaggi. Una richiesta API che omette `isProjectDefault` viene trattata allo stesso modo.
5. Salva. Un progetto ha una configurazione predefinita per gli SMS e una per le chiamate, quindi una configurazione impostata su **Solo SMS** e una impostata su **Solo chiamate** possono essere entrambe predefinite: vedi [Un account solo per gli SMS, o solo per le chiamate](#un-account-solo-per-gli-sms-o-solo-per-le-chiamate). Le pagine di stato usano la configurazione assegnata esplicitamente a ciascuna di esse.

> [!IMPORTANT]
> **SMS** e **Chiamate telefoniche** partono disattivati in ogni progetto, e finché non sono attivi nessuno nel progetto può aggiungere un numero di telefono per loro. Un proprietario del progetto, un **Amministratore della fatturazione** o chi ha **Manage Billing** li attiva nella scheda **Canali di notifica** della stessa pagina.
:::

Per una configurazione predefinita valida per l'intera installazione, un amministratore può invece aprire **Admin Dashboard > Impostazioni > Chiamate e SMS**, scegliere che cosa invia l'account, modificare le credenziali e i numeri di telefono Twilio e salvare. Le notifiche dei membri usano questa configurazione globale quando il loro progetto non ne ha una predefinita. Mantieni riservato l'Auth Token.

### Impostare l'account dell'intera installazione con variabili d'ambiente

Una nuova installazione può partire con SMS e chiamate già funzionanti, senza nulla da configurare a mano: imposta l'account dell'intera installazione con variabili d'ambiente, da Terraform o da ciò che distribuisce OneUptime. Non appena `GLOBAL_TWILIO_ACCOUNT_SID` è impostata, l'account è quello descritto dalle variabili. L'account salvato in **Admin Dashboard > Impostazioni > Chiamate e SMS** non viene usato, e quella pagina mostra questo in sola lettura, ogni campo con la variabile che lo imposta. Lascia vuota `GLOBAL_TWILIO_ACCOUNT_SID` per configurare invece l'account nell'Admin Dashboard. Le configurazioni dei progetti non cambiano.

| Variabile | Valore Helm | Che cosa contiene |
| --- | --- | --- |
| `GLOBAL_TWILIO_ACCOUNT_SID` | `twilio.accountSid` | L'Account SID. È impostandola che OneUptime legge le altre variabili |
| `GLOBAL_TWILIO_AUTH_TOKEN` | `twilio.authToken`, oppure un Secret indicato in `twilio.existingSecret.name` | L'Auth Token |
| `GLOBAL_TWILIO_USED_FOR` | `twilio.usedFor` | `calls-and-sms` (anche quando è vuota), `sms-only` o `calls-only` |
| `GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER` | `twilio.primaryPhoneNumber` | Il numero da cui partono le chiamate, con il prefisso internazionale. Non serve per `sms-only` |
| `GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS` | `twilio.secondaryPhoneNumbers` | Facoltativi, separati da virgole: numeri usati al posto di quello principale per i destinatari del loro paese |
| `GLOBAL_TWILIO_SMS_PHONE_NUMBERS` | `twilio.smsPhoneNumbers` | Numeri separati da virgole da cui parte ogni SMS. Obbligatori per `sms-only` |

Con Helm, impostale sotto `twilio` nei tuoi values. Per tenere l'auth token fuori dai values che Helm salva con ogni release, mettilo in un Secret tuo e indica quel Secret in `twilio.existingSecret.name`:

```bash
kubectl create secret generic oneuptime-twilio --namespace oneuptime \
  --from-literal=authToken=YOUR_TWILIO_AUTH_TOKEN
```

```yaml
twilio:
  accountSid: ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  usedFor: calls-and-sms
  primaryPhoneNumber: "+14155550100"
  existingSecret:
    name: oneuptime-twilio
```

Metti i numeri di telefono tra virgolette in un file di values, e passali con `--set-string` invece che con `--set`: senza virgolette, `+14155550100` è un numero, che il chart rifiuta. Il chart rifiuta anche altri valori di `twilio` senza `twilio.accountSid`, un Account SID senza auth token e un auth token indicato sia in `twilio.authToken` sia in un Secret. Con Terraform, imposta gli stessi valori su un `helm_release`, con l'auth token come valore sensibile.

Con Docker Compose, imposta le voci `GLOBAL_TWILIO_` in `config.env`, poi esegui `npm run start` per ricreare i container.

OneUptime legge le variabili all'avvio. Se una è errata, per esempio un numero di telefono che OneUptime non riesce a leggere o un auth token mancante, l'account non invia SMS e non effettua chiamate finché non viene corretta; il log del server, **Admin Dashboard > Impostazioni > Chiamate e SMS** e la checklist in `/admin/setup` indicano la variabile. L'auth token non viene mai mostrato. Per cambiare l'account, modifica le variabili e riavvia OneUptime: l'Admin Dashboard non lo modifica.

### Gestire le configurazioni di progetto con Terraform

Una configurazione di progetto è anche la risorsa `oneuptime_call_and_sms_config` del [provider Terraform](/docs/terraform/index), e un data source con lo stesso nome ne legge una. L'Auth Token è sensibile, quindi piani, log e output non lo mostrano mai. Passalo in una variabile sensibile:

```hcl
variable "twilio_auth_token" {
  type      = string
  sensitive = true
}

resource "oneuptime_call_and_sms_config" "production" {
  name                        = "Production Twilio"
  used_for                    = "Calls and SMS"
  twilio_account_sid          = "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
  twilio_auth_token           = var.twilio_auth_token
  twilio_primary_phone_number = "+14155550100"
  is_project_default          = true
}
```

- **Configurazione predefinita.** Terraform rende una configurazione quella predefinita del progetto solo con `is_project_default = true`. Se l'attributo manca, Terraform invia `false`, quindi la prima configurazione di un progetto non diventa quella predefinita come succede nella dashboard. Impostalo su una sola configurazione per ogni tipo di messaggio: due con lo stesso `used_for` che lo impostano entrambe si tolgono a vicenda la predefinita a ogni apply. OneUptime imposta `is_project_default_for_sms` e `is_project_default_for_calls`, che Terraform si limita a leggere.
- **Numeri di telefono.** Scrivi ogni numero con `+` e il prefisso internazionale. Spazi, trattini, punti e parentesi tra le cifre vanno bene: OneUptime memorizza `+1 415 555 0100` come `+14155550100` e Terraform lo riconosce come il numero che hai scritto, quindi un plan non mostra modifiche.
- **Chiave API.** La chiave usata da Terraform deve poter leggere l'Auth Token: **Proprietario del progetto**, **Amministratore del progetto**, oppure **Read Call and SMS** in un ruolo personalizzato, oltre a creare e modificare configurazioni. Con una chiave che non può, la lettura della configurazione non riesce, e l'errore dice chi può leggere il token.
- **Riferimenti.** Il `call_sms_config_id` di una pagina di stato e il `project_call_sms_config_id` di una policy chiamate in entrata prendono l'`id` della configurazione.

### Numeri separati per chiamate e SMS

Un numero Twilio può effettuare chiamate e inviare SMS, oppure solo una delle due cose, e in alcuni paesi nessun numero fa entrambe: i numeri nazionali possono essere solo vocali, mentre gli SMS richiedono un numero mobile. Una configurazione, quella di un progetto o quella dell'installazione, può elencare numeri per gli SMS in **Altri campi**:

| Campo | Che cosa parte da qui |
| --- | --- |
| **Numero di telefono principale Twilio** | Le chiamate, e gli SMS finché non sono elencati numeri per gli SMS |
| **Numeri di telefono secondari Twilio** | Le chiamate, e gli SMS finché non sono elencati numeri per gli SMS, ai destinatari nel paese di ciascun numero |
| **Numeri di telefono SMS Twilio** | Ogni SMS, una volta elencati: dal numero del paese del destinatario, altrimenti dal primo |

Se il tuo numero può solo effettuare chiamate, tienilo come **Numero di telefono principale Twilio** e inserisci un numero che può inviare SMS, come un numero mobile, in **Numeri di telefono SMS Twilio**. Quando una configurazione elenca numeri per gli SMS, nessun SMS parte più dai suoi altri numeri: elenca quindi ogni numero che deve inviare SMS.

Una configurazione senza numeri per gli SMS invia gli SMS dagli stessi numeri delle chiamate, come prima. **Invia SMS di prova** e **Invia chiamata di prova** partono dal numero da cui partirebbe un vero SMS o una vera chiamata allo stesso destinatario. Se Twilio rifiuta un SMS con l'errore 21606, il numero non può inviare SMS: aggiungine uno che può farlo in **Numeri di telefono SMS Twilio**.

> [!NOTE]
> Quali numeri possono inviare SMS, e se un mittente deve prima essere registrato, cambia da paese a paese: dove la registrazione è obbligatoria, un SMS da un numero non registrato può essere bloccato o segnalato come spam. Prima di fare affidamento su un numero, consulta [le linee guida SMS di Twilio](https://www.twilio.com/en-us/guidelines/sms) per ogni paese a cui invii.

### Un account solo per gli SMS, o solo per le chiamate

Un account che usi solo per gli SMS, o solo per le chiamate, non ha bisogno di numeri per l'altro uso. Sceglilo in **Usa questo account per**, e il modulo chiede solo i numeri che servono a quella scelta:

| Scelta | Numeri che richiede | Che cosa non invia mai |
| --- | --- | --- |
| **Chiamate e SMS** | **Numero di telefono principale Twilio** | Niente |
| **Solo SMS** | **Numeri di telefono SMS Twilio** | Chiamate |
| **Solo chiamate** | **Numero di telefono principale Twilio** | SMS |

Un progetto ha una configurazione predefinita per gli SMS e una per le chiamate, e una configurazione è quella predefinita per ciò che invia. Nel menu della riga di una configurazione, **Imposta come predefinito del progetto per gli SMS** o **Imposta come predefinito del progetto per le chiamate** la rende quella predefinita per ciò che invia e lascia l'altra com'è, così una configurazione impostata su **Solo SMS** e una impostata su **Solo chiamate** possono essere entrambe predefinite. Una configurazione impostata su **Chiamate e SMS** prende entrambe le cose. La colonna **Impostazione predefinita del progetto** indica per cosa ciascuna configurazione è predefinita, e **Non usare più come predefinito del progetto** nel menu della riga lo fa cessare.

Ciò che nessuna configurazione predefinita invia parte come partirebbe senza configurazione: finché l'unica predefinita è impostata su **Solo SMS**, le chiamate ai membri del progetto passano dalla configurazione dell'intera installazione. Se nessuna configurazione può inviare un messaggio, il log del messaggio dice che la configurazione del progetto non è usata per quello, e chi può cambiarlo.

Le pagine di stato propongono solo le configurazioni che inviano SMS, e **Invia SMS di prova** e **Invia chiamata di prova** compaiono solo per ciò che una configurazione invia. Ogni configurazione esistente è impostata su **Chiamate e SMS**, come prima. Tramite l'API e Terraform, la scelta è il campo `usedFor`, e una configurazione senza i numeri che la sua scelta richiede viene rifiutata.

## 3. Configurare l'accesso alla rete

L'invio funziona con il solo accesso in uscita. Gli aggiornamenti di consegna, l'esito delle chiamate, la conferma da tastiera e le chiamate in arrivo richiedono che Twilio raggiunga il tuo server.

```mermaid title="Invii in uscita, callback in entrata"
sequenceDiagram
    participant O as OneUptime
    participant T as Twilio
    participant P as Telefono di chi risponde
    O->>T: Invia un SMS o<br/>avvia una chiamata
    T->>P: SMS o chiamata vocale
    T-->>O: Callback dello stato<br/>di consegna dell'SMS
    P->>T: Preme 1 per confermare
    T-->>O: Callback dell'input<br/>da tastiera
```

Un'installazione privata ha bisogno della risoluzione DNS e di HTTPS in uscita su TCP 443 verso Twilio per inviare SMS e chiamate. Twilio consiglia di consentire l'HTTPS in uscita verso `*.twilio.com` perché gli indirizzi delle sue API sono dinamici; vedi [gli indirizzi IP di Twilio](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Applicalo al traffico in uscita del carico di lavoro dell'applicazione OneUptime, comprese le NetworkPolicy di Kubernetes e i firewall esterni.

L'accesso in entrata dipende dalla funzionalità:

| Funzionalità | Twilio deve raggiungere OneUptime? |
| --- | --- |
| Invio di SMS | No. Gli aggiornamenti dello stato di consegna però richiedono un callback. |
| Una semplice chiamata vocale di prova | No. OneUptime fornisce le istruzioni vocali insieme alla richiesta API in uscita. |
| Sapere se una chiamata di reperibilità ha avuto risposta | Sì. Twilio comunica come è finita ogni chiamata, così il feed dell'incidente può dire quando qualcuno non ha risposto. Le chiamate partono comunque anche senza. |
| Premere 1 per confermare un avviso di reperibilità | Sì. Twilio invia l'input da tastiera a OneUptime. |
| Policy delle chiamate in arrivo | Sì. Twilio chiede le istruzioni della chiamata e riporta i risultati della composizione. |

Questi sono i percorsi esterni, attraverso il gateway Nginx di OneUptime. I segnaposto cambiano a ogni notifica:

| Metodo | Percorso | Scopo |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | Stato di consegna dell'SMS |
| POST | `/notification/call/status-callback/:callLogId/:token` | Esito della chiamata |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Conferma da tastiera |
| POST | `/notification/incoming-call/voice` | Istruzioni facoltative per le chiamate in arrivo |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Risultati facoltativi dell'instradamento delle chiamate in arrivo |

OneUptime genera automaticamente gli URL degli SMS, dell'esito delle chiamate e della conferma. Non sostituire i loro token con un URL di webhook statico. Per le chiamate in arrivo, segui [le policy delle chiamate in arrivo](/docs/on-call/incoming-call-policy), che configurano il webhook del numero quando lo colleghi.

Twilio richiede [URL di webhook raggiungibili pubblicamente](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Usa un certificato TLS pubblicamente attendibile e preserva attraverso i proxy l'host, il protocollo, il percorso, i parametri di query, il corpo e l'header `X-Twilio-Signature` originali. I gestori delle chiamate in arrivo convalidano le firme di Twilio; la consegna degli SMS e l'esito delle chiamate usano un token nell'URL per ogni messaggio o chiamata, e la conferma da tastiera un token di query firmato. Non esporre i token in log condivisi o screenshot. Vedi [la sicurezza dei webhook di Twilio](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

### Pubblicare i callback da un'installazione privata

:::steps
1. Pubblica il DNS del nome host di OneUptime, per esempio `oneuptime.example.com`, puntandolo a un reverse proxy o a un load balancer esposto su Internet. Consenti il TCP 443 in entrata e configura un certificato pubblicamente attendibile con la catena completa. Un IP privato, un DNS solo interno o la connessione VPN di un amministratore non danno connettività a Twilio.
2. Dai a quel gateway un percorso di rete verso l'ingress privato di OneUptime, direttamente o tramite la tua VPN site-to-site o il tuo collegamento privato. Consenti la porta del servizio upstream. Un servizio Kubernetes `ClusterIP` richiede un ingress raggiungibile o un altro percorso dal gateway. Mantieni privati i database e gli altri servizi interni.
3. Pubblica solo i percorsi di callback della tabella sopra che usi. Inoltrali tramite il gateway Nginx di OneUptime, che mappa il prefisso esterno `/notification` sull'applicazione. Mantieni `/api` sul percorso della conferma da tastiera. Preserva il metodo HTTP e i dati della richiesta; non reindirizzare a un altro URL. Preserva l'`Host` pubblico e imposta sul tuo proxy header di inoltro attendibili per l'host pubblico e lo schema HTTPS.
4. Escludi questi percorsi dall'SSO del browser, dai CAPTCHA e dalle pagine di accesso del proxy. Mantieni attiva l'autenticazione dei callback di OneUptime. Limita l'accesso all'origine privata al gateway e ai client interni autorizzati.
5. Imposta `HOST=oneuptime.example.com` e `HTTP_PROTOCOL=https` nel `config.env` di Docker Compose, oppure `host: oneuptime.example.com` e `httpProtocol: https` nei valori Helm. Applica la modifica all'installazione e attendi il riavvio dell'applicazione. Queste impostazioni generano URL; non creano DNS, certificati né regole del firewall. OneUptime non ha un'impostazione separata per il nome host dei callback di Twilio. Se il nome host cambia, aggiorna anche il webhook dei numeri di telefono Twilio esistenti.
:::

La dashboard può restare su un ingress privato: con un DNS separato, i dipendenti risolvono lo stesso nome host verso quell'ingress tramite la rete aziendale o la VPN, mentre Twilio lo risolve verso il gateway. Servi su entrambi i percorsi un certificato valido per quel nome host. Le [impostazioni di accesso alle reti private](/docs/self-hosted/private-network-access) di OneUptime regolano le richieste in uscita verso i servizi interni; `ALLOW_PRIVATE_NETWORK_WEBHOOKS` non pubblica un endpoint in entrata.

### Restrizioni sugli IP e installazioni senza accesso in entrata

Gli indirizzi di origine ordinari dei webhook di Twilio cambiano, quindi non usare gli intervalli IP SIP o multimediali come allowlist dei callback. Le edizioni di Twilio idonee offrono [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Verifica che la tua edizione sia idonea e quali prodotti supporta, e configura il firewall con gli intervalli pubblicati attualmente da Twilio; continua a convalidare i callback anche quando lo usi.

> [!WARNING]
> Se una policy vieta le connessioni in entrata, l'invio di SMS e la semplice riproduzione vocale incorporata possono funzionare con l'HTTPS in uscita. Gli aggiornamenti di consegna degli SMS, l'esito delle chiamate, la conferma da tastiera e l'instradamento delle chiamate in arrivo non possono funzionare senza callback raggiungibili. Un'installazione completamente isolata non può usare Twilio.

Per lo sviluppo, la [guida ai test dei webhook](https://www.twilio.com/docs/usage/webhooks/webhook-testing) di Twilio descrive l'uso di un tunnel pubblico: inoltralo a un proxy che consenta solo i percorsi necessari, configura il nome host risultante come sopra e fermalo dopo i test. Anche un tunnel espone un accesso in entrata.

## 4. Verificare separatamente consegna e callback

:::steps
1. Da fuori della rete aziendale e della VPN, verifica che il nome host dei callback si risolva nel gateway pubblico e presenti un certificato TLS valido. Un GET dal browser non mette alla prova questi callback POST.
2. Usa **Invia SMS di prova** e **Invia chiamata di prova** sulla configurazione Twilio del progetto. Conferma la ricezione sul telefono di destinazione. Entrambi richiedono il permesso di aggiungere configurazioni Twilio: **Proprietario del progetto**, **Amministratore del progetto**, oppure **Create Call and SMS** e **Read Call and SMS** in un ruolo personalizzato.
3. Configura per l'utente un contatto SMS o di chiamata verificato e le regole di notifica, poi fai scattare un avviso di reperibilità controllato. Premi 1 e conferma la presa in carico in OneUptime. Se usi le policy delle chiamate in arrivo, chiama il numero configurato e controlla l'instradamento e il registro delle chiamate.
4. Verifica lo stato di consegna degli SMS in OneUptime e nei log dei messaggi di Twilio. Un invio accettato non è una prova di consegna; [Twilio segnala i cambi di stato successivi tramite callback](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).
:::

| Sintomo | Dove guardare |
| --- | --- |
| Non viene inviato nulla | Credenziali, funzionalità del numero, restrizioni dell'account e connettività in uscita. |
| Twilio rifiuta gli SMS con l'errore 21606 | Il numero non può inviare SMS. Aggiungine uno che può farlo in **Numeri di telefono SMS Twilio**: vedi [Numeri separati per chiamate e SMS](#numeri-separati-per-chiamate-e-sms). |
| Chiamate o SMS passano da un account diverso da quello del progetto | Nessuna configurazione è quella predefinita del progetto per essi: la colonna **Impostazione predefinita del progetto** indica per cosa ciascuna configurazione è predefinita. Vedi [Un account solo per gli SMS, o solo per le chiamate](#un-account-solo-per-gli-sms-o-solo-per-le-chiamate). |
| L'SMS o la chiamata arriva, ma lo stato o la conferma non si aggiornano | L'URL di callback e i log dell'ingress pubblico. La [guida di Twilio sugli errori di recupero HTTP](https://www.twilio.com/docs/api/errors/11200) aiuta a diagnosticare callback irraggiungibili, problemi TLS ed errori HTTP. |

Una chiamata di prova riuscita, da sola, non dimostra che i callback siano raggiungibili.

## 5. Verificare i numeri di telefono dei membri del team

Aggiungere un numero di telefono per SMS o chiamate invia subito il suo codice di verifica, e si apre la finestra di verifica. Mostra quando è stato inviato il codice e fino a quando è valido, e invia un nuovo codice su richiesta, al massimo una volta al minuto. Prima di verificare non serve inviare di nuovo nulla.

Quando non è possibile inviare alcun codice, la finestra spiega il motivo invece di dichiarare che un codice è stato inviato: per esempio, che non è configurato alcun account Twilio, finché non esiste né una configurazione predefinita del progetto né la configurazione dell'installazione descritta sopra. Un numero il cui primo codice non può essere inviato non viene aggiunto, e il modulo ne mostra il motivo, come un paese di destinazione rifiutato da Twilio.

Un numero verificato per gli SMS è verificato anche per le chiamate, senza un secondo codice. La verifica tramite chiamata non verifica gli SMS, perché un numero che riceve chiamate, come un fisso, non sempre può ricevere messaggi di testo. Se Twilio accetta un codice che non arriva mai, il log SMS del progetto ne mostra lo stato di consegna.

## Passaggi successivi

:::cards
- [Policy delle chiamate in arrivo](/docs/on-call/incoming-call-policy): Far raggiungere i tuoi ingegneri reperibili da chi chiama tramite un numero Twilio.
- [Regole di escalation](/docs/on-call/escalation-rules): Decidere chi viene avvisato a ogni livello, via SMS, chiamata o qualsiasi altro metodo.
- [Gateway per SMS e chiamate](/docs/self-hosted/sms-and-call-gateway): Inviare SMS e chiamate tramite il tuo provider invece che tramite Twilio.
- [SMTP](/docs/emails/smtp): Inviare anche le email tramite il tuo server di posta.
- [Accesso alle reti private](/docs/self-hosted/private-network-access): Consentire a workflow e webhook di raggiungere strumenti interni.
- [Metriche di consegna delle notifiche](/docs/self-hosted/notification-delivery-metrics): Misurare quanti SMS e chiamate raggiungono Twilio e il telefono.
:::
