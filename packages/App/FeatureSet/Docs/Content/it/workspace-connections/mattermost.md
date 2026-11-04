# Mattermost

Collega OneUptime al tuo server Mattermost per pubblicare nei tuoi canali incidenti, avvisi, episodi, manutenzioni programmate, monitor e aggiornamenti di reperibilità, dare a ogni incidente un canale tutto suo e lasciare che i responder riconoscano, risolvano, aggiungano note e cambino lo stato senza uscire da Mattermost.

:::cards
- [Collegare Mattermost](#collegare-mattermost): Crea un account bot per OneUptime, poi collega il progetto con il suo token.
- [Collegare il tuo account](#collegare-il-tuo-account-mattermost): Collega il tuo account Mattermost al tuo account OneUptime.
- [Regole di notifica](#regole-di-notifica): Decidi quali eventi vengono pubblicati dove, e quali hanno un canale tutto loro.
- [Agire da Mattermost](#agire-su-incidenti-avvisi-ed-eventi-da-mattermost): I pulsanti dei messaggi di OneUptime.
- [Rete e self-hosting](#rete-e-self-hosting): Cosa deve poter raggiungere ciascun server.
:::

## Come funziona

```mermaid title="Da un evento in OneUptime a un messaggio in Mattermost"
flowchart TB
    event["Un incidente, un avviso o un evento<br/>viene creato o cambia"] --> rules{"Regole di notifica<br/>le cui condizioni corrispondono"}
    rules -->|"Un canale<br/>per ciascuno"| own["Un canale tutto suo,<br/>con le sue persone aggiunte man mano"]
    rules -->|"Pubblica in canali esistenti"| existing["I tuoi canali esistenti"]
    own --> message["Un messaggio con pulsanti"]
    existing --> message
    message -->|"Un responder ne preme uno"| change["La modifica avviene in OneUptime,<br/>a nome di quel responder"]
```

Due collegamenti rendono tutto possibile:

- **Il collegamento del progetto**, fatto una volta: un account bot sul tuo server Mattermost, nel team in cui pubblica OneUptime. Pubblica i messaggi, crea i canali e vi aggiunge le persone.
- **Il collegamento di ogni persona**: il suo account Mattermost collegato al suo account OneUptime. I pulsanti agiscono a nome di quella persona, con i suoi permessi nel progetto.

Un team Mattermost può essere collegato a più di un progetto, per esempio produzione e staging. Un pulsante agisce nel progetto del record di cui parla il suo messaggio.

## Prima di iniziare

- **Un ruolo che può collegare il progetto:** **Proprietario del progetto**, **Amministratore del progetto** o **Membro del progetto**. Scollegare richiede **Proprietario del progetto** o **Amministratore del progetto**.
- **Un server Mattermost** in cui puoi creare un account bot, oppure un amministratore di Mattermost che possa crearne uno per te. Funzionano sia Mattermost Cloud sia Mattermost self-hosted.
- **Il piano Growth su OneUptime Cloud** per le regole di notifica e i riepiloghi.

Per Mattermost non serve configurare nulla sul server di OneUptime stesso: ogni progetto porta il proprio server Mattermost e il proprio account bot.

## Collegare Mattermost

:::steps
### Creare un account bot in Mattermost

In Mattermost, apri **System Console** > **Integrations** > **Bot Accounts** e assicurati che **Enable Bot Account Creation** sia attivo. Poi vai in **Integrations** > **Bot Accounts** > **Add Bot Account**, chiamalo `oneuptime` e salva. Mattermost mostra il token di accesso del bot una sola volta: copialo.

### Aggiungere il bot al tuo team

Aggiungi il bot al team in cui OneUptime deve pubblicare, come aggiungeresti una persona: **Main Menu** > **Invite People**, e invita `@oneuptime`. OneUptime crea canali e pubblica solo in quel team.

### Collegare il progetto

In OneUptime, vai in **Impostazioni del progetto** > **Area di lavoro** > **Mattermost** e fai clic su **Collega Mattermost**. Inserisci l'indirizzo del tuo server, per esempio `https://chat.example.com`, e il token di accesso del bot. OneUptime verifica il token con il tuo server prima di conservare qualsiasi cosa. Se il bot è in più di un team, OneUptime ti chiede in quale pubblicare.

### Aggiungere una regola di notifica

Vai in **Incidenti** > **Area di lavoro** > **Mattermost** e crea una regola. Per esempio, una che crea un canale Mattermost per ogni nuovo incidente con tutti quelli che ci lavorano. Vedi [Regole di notifica](#regole-di-notifica).
:::

Il token di accesso del bot viene conservato solo sul server di OneUptime, cifrato insieme agli altri segreti del progetto, e non viene mai più mostrato. L'indirizzo del server, il team e il nome utente del bot sono visibili a tutti nel progetto, nella pagina delle impostazioni di Mattermost.

Un progetto è collegato a un solo team Mattermost. Per spostarlo in un altro team, o su un altro server, scollegalo prima: **Impostazioni del progetto** > **Area di lavoro** > **Mattermost**, poi **⋯** > **Scollega Mattermost**. Scollegarlo scollega anche l'account Mattermost di ogni membro e rimuove i suoi metodi di notifica Mattermost e le regole di reperibilità che li usano. Le tue regole di notifica e i tuoi riepiloghi vengono conservati per quando lo ricolleghi.

## Collegare il tuo account Mattermost

Mattermost non ha una pagina di accesso a cui OneUptime possa mandarti, quindi il bot di OneUptime invia invece al tuo account Mattermost un messaggio diretto con un link:

:::steps
1. Vai in **Impostazioni utente** > **Area di lavoro** > **Mattermost**. OneUptime cerca l'account Mattermost con il tuo indirizzo email. Se ne trova uno, fai clic su **Invia il link a @your-username**. Altrimenti, fai clic su **Inviami un link** e inserisci il tuo nome utente Mattermost.
2. Apri in Mattermost il messaggio diretto del bot di OneUptime e fai clic su **Connect my account**.
3. Il link apre OneUptime, che collega il tuo account.
:::

Apri il link nello stesso browser in cui l'hai richiesto: funziona solo lì, una sola volta e solo per 15 minuti. Questo dimostra che chi l'ha richiesto possiede entrambi gli account, così nessuno può collegare l'account Mattermost di un'altra persona. Se non hai richiesto un link, ignoralo: non viene collegato nulla finché non viene aperto nel browser che l'ha richiesto.

Il collegamento del tuo account appartiene a questo progetto. In un altro progetto collegato allo stesso team Mattermost, collegalo anche lì.

## Ricevere chiamate in Mattermost

Per essere chiamato con un messaggio diretto quando sei di reperibilità, aggiungi Mattermost ai tuoi metodi di notifica:

:::steps
1. Collega il tuo account Mattermost (vedi [Collegare il tuo account Mattermost](#collegare-il-tuo-account-mattermost)).
2. Vai in **Impostazioni utente** > **Metodi di notifica**, apri la scheda **App dell'area di lavoro** e fai clic su **Aggiungi account Mattermost**.
3. Fai clic su **Send Test Message** nella sua riga. Il messaggio arriva come messaggio diretto dal bot del progetto.
:::

Aggiungerlo lo inserisce subito nelle tue regole di reperibilità, quindi da quel momento le chiamate ti raggiungono in Mattermost. Cambia quali chiamate riceve in **Impostazioni utente** > **Regole di reperibilità**. Ogni chiamata contiene un link per riconoscerla e uno per escalarla. Scollegare il tuo account Mattermost rimuove questo metodo e le regole di reperibilità che lo usano.

## Regole di notifica

Una regola di notifica dice quali eventi vengono pubblicati in Mattermost, e dove. Ogni prodotto ha le sue regole, in **Area di lavoro** > **Mattermost** nel suo menu: **Incidenti** (con **Incidente Episodi** e una scheda **Riepilogo**), **Avvisi** (con **Avviso Episodi** e **Riepilogo**), **Manutenzione programmata**, **Monitor**, **Reperibilità** ed **Eventi di sicurezza**. Funzionano come quelle di Slack: vedi [Regole di notifica](/docs/workspace-connections/slack#regole-di-notifica) per condizioni, destinazioni e chi entra in un canale.

Un canale creato da una regola prende il nome dal suo record: l'incidente INC-42 riceve `inc-42`. Mattermost accetta lettere minuscole, numeri, `-` e `_`, fino a 64 caratteri, con una lettera o un numero all'inizio e alla fine, e il modulo della regola mostra il nome mentre scrivi. Se esiste già un canale con quel nome, per esempio uno archiviato, OneUptime aggiunge `-2`, `-3` e così via. Un incidente, un avviso o un episodio privato riceve un canale privato.

Per pubblicare in un canale esistente, inserisci il suo nome come compare nel suo indirizzo, per esempio `incidents` per `chat.example.com/team/channels/incidents`, oppure il suo nome visualizzato. OneUptime entra da solo in un canale pubblico la prima volta che vi pubblica. Aggiungi il bot a un canale privato in Mattermost prima che una regola vi pubblichi.

Le persone entrano nel canale di una regola tramite l'account Mattermost che hanno collegato, altrimenti tramite l'account Mattermost con il loro indirizzo email, quando il tuo server mostra gli indirizzi email al bot (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime nomina chi non è riuscito ad aggiungere in un solo messaggio nel canale, con un link per collegare il proprio account.

**Regola di test** nella riga di una regola pubblica un messaggio di prova di quella regola nei canali che indica, come fa per Slack.

I messaggi di OneUptime non notificano nessuno con ciò che citano: un nome o una descrizione che contiene `@channel`, `@here` o `@someone` viene mostrato così com'è scritto, e non avvisa nessuno.

## Agire su incidenti, avvisi ed eventi da Mattermost

I messaggi di OneUptime hanno pulsanti, e un menu **More actions** per ciò che serve a meno persone. Ognuno agisce a tuo nome, con i tuoi permessi nel progetto, e risponde in un messaggio che vedi solo tu.

| Record | Pulsanti e menu |
| --- | --- |
| **Incidente** | **Acknowledge**, **Resolve**, **Add Note** e nel menu **Change Severity** e **Change State** |
| **Avviso** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Episodio di incidente, episodio di avviso** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Manutenzione programmata** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** ed **Execute On-Call Policy** aprono un modulo in Mattermost. Una nota su un incidente o su un evento di manutenzione programmata può essere pubblica, mostrata sulla pagina di stato, o privata; una nota su un incidente privato è sempre privata, e su un avviso è sempre privata anch'essa. Ogni messaggio ha anche un link che apre il suo record in OneUptime, per tutto il resto.

Se il tuo account Mattermost non è ancora collegato, un pulsante te lo dice, con un link a **Impostazioni utente** > **Area di lavoro** > **Mattermost**. Collega il tuo account, poi premi di nuovo il pulsante.

Ogni pressione di un pulsante viene registrata in **Impostazioni del progetto** > **Notifiche** > **Registri di notifica**, nella scheda **Area di lavoro**, insieme a chi l'ha premuto.

## Rete e self-hosting

Due server comunicano tra loro:

- **OneUptime chiama il tuo server Mattermost**, per pubblicare, creare canali e aggiungere persone. Su OneUptime Cloud, il tuo server Mattermost deve essere raggiungibile da internet. Un OneUptime self-hosted può raggiungere un server Mattermost su una rete privata una volta che il suo operatore consente gli indirizzi privati con `ALLOW_PRIVATE_NETWORK_WEBHOOKS` o `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`. OneUptime non chiama mai un indirizzo sulla propria macchina né un indirizzo di metadati cloud, e non segue mai un reindirizzamento.
- **Il tuo server Mattermost chiama OneUptime** quando qualcuno preme un pulsante o invia un modulo: `https://<your OneUptime>/api/mattermost/interactive` e `/api/mattermost/dialog`. Se l'indirizzo di OneUptime è privato, aggiungi il suo host in **System Console** > **Environment** > **Developer** > **Allow untrusted internal connections to** in Mattermost, altrimenti i pulsanti non funzioneranno.

Ogni pulsante che OneUptime pubblica porta una firma, verificata quando viene premuto, per il team Mattermost in cui è stato pubblicato: una pressione che OneUptime non ha firmato, o che arriva da un altro team, non fa nulla.

## Risoluzione dei problemi

| Cosa vedi | Cosa fare |
| --- | --- |
| **Mattermost did not accept the access token** | Copia di nuovo il token del bot. Mattermost lo mostra una sola volta: se serve, creane uno nuovo in **Integrations** > **Bot Accounts**. |
| **The bot account is not a member of any team** | Aggiungi il bot al tuo team in Mattermost, poi collega di nuovo il progetto. |
| **OneUptime could not reach the Mattermost server** | Controlla l'indirizzo, e che OneUptime possa raggiungerlo. Vedi [Rete e self-hosting](#rete-e-self-hosting). |
| **The bot is not a member of the private Mattermost channel** | Aggiungi il bot al canale in Mattermost. |
| Un pulsante non fa nulla, oppure Mattermost dice che non è riuscito a completare l'azione | Mattermost non riesce a raggiungere OneUptime. Vedi [Rete e self-hosting](#rete-e-self-hosting). |
| Non arriva nessun messaggio diretto con il tuo link | Controlla il nome utente, e che il bot sia in un team di cui fai parte. |
