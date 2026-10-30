# Microsoft Teams

Collega OneUptime a Microsoft Teams per pubblicare nei tuoi canali e nelle tue chat incidenti, avvisi, episodi, manutenzioni programmate, monitor e aggiornamenti di reperibilità, dare a ogni incidente un canale tutto suo e lasciare che i responder agiscano da Teams: riconoscere, risolvere, aggiungere note, chiamare la reperibilità, dichiarare incidenti e fare domande a OneUptime AI.

:::cards
- [Collegare Microsoft Teams](#collegare-microsoft-teams): Il consenso dell'amministratore, il tuo accesso e l'app in ogni team.
- [Chiedere a tutti di collegare il proprio account](#chiedere-a-tutti-di-collegare-il-proprio-account): Scrivi in un colpo solo a tutti i membri che non hanno ancora collegato il proprio account.
- [Regole di notifica](#regole-di-notifica): Decidi quali eventi vengono pubblicati dove, e quali hanno un canale tutto loro.
- [Parlare con il bot di OneUptime](#parlare-con-il-bot-di-oneuptime): Comandi, domande e moduli in una chat con il bot.
- [Tag di reperibilità](#tag-di-reperibilità): Mantieni il tag di un team uguale a chi è reperibile, e chiamalo.
- [Agire su incidenti, avvisi ed eventi da Microsoft Teams](#agire-su-incidenti-avvisi-ed-eventi-da-microsoft-teams): I pulsanti delle schede di OneUptime.
:::

## Come funziona

```mermaid title="Da un evento in OneUptime a una scheda in Microsoft Teams"
flowchart TB
    event["Un incidente, un avviso o un evento<br/>viene creato o cambia"] --> rules{"Regole di notifica<br/>le cui condizioni corrispondono"}
    rules -->|"Un canale<br/>per ciascuno"| own["Un canale tutto suo<br/>nel team che scegli"]
    rules -->|"Pubblicare in un canale<br/>o in una chat esistente"| existing["I tuoi canali e le tue chat"]
    own --> card["Una scheda con pulsanti"]
    existing --> card
    card -->|"Un responder ne preme uno"| change["La modifica avviene in OneUptime,<br/>a nome di quel responder"]
```

Tre cose rendono tutto possibile:

- **Il collegamento del progetto**, fatto una volta: un amministratore di Microsoft 365 dà il consenso all'app di OneUptime per la tua organizzazione.
- **L'app di OneUptime in ogni team** in cui vuoi le notifiche. Microsoft consente al bot di pubblicare solo in un team a cui è stato aggiunto.
- **Il collegamento di ogni persona**: il suo account Microsoft Teams collegato al suo account OneUptime. Pulsanti, comandi e reazioni agiscono a nome di quella persona, con i suoi permessi nel progetto.

Un'organizzazione Microsoft 365 può essere collegata a più di un progetto, per esempio produzione e staging. Il pulsante di una scheda agisce nel progetto per cui la scheda è stata inviata, per esempio il progetto dell'incidente a cui si riferisce. Un messaggio al bot agisce nel progetto del canale in cui viene inviato, per esempio il canale di un incidente, altrimenti nell'unico progetto in cui è collegato l'account Microsoft Teams di chi lo invia. Quando niente lo indica, il bot chiede a quella persona quale progetto intende, con un pulsante per ogni progetto di cui fa parte, e prosegue lì appena sceglie. In una conversazione con OneUptime AI, la scelta vale per le domande successive finché non passa un'ora senza nessuna.

## Prima di iniziare

- **Un ruolo che può collegare il progetto:** **Proprietario del progetto**, **Amministratore del progetto** o **Membro del progetto**. Disinstallare richiede **Proprietario del progetto** o **Amministratore del progetto**.
- **Un amministratore di Microsoft 365** che conceda il consenso dell'amministratore, una volta per tutta l'organizzazione.
- **Il piano Growth su OneUptime Cloud** per le regole di notifica e i riepiloghi. Vedi [Regole di notifica sotto il piano Growth](#regole-di-notifica-sotto-il-piano-growth).
- **Su un server self-hosted,** prima un bot di Teams configurato per esso. Vedi [Integrazione Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).

## Collegare Microsoft Teams

:::steps
### Concedere il consenso dell'amministratore

Vai in **Impostazioni del progetto** > **Area di lavoro** > **Microsoft Teams** e fai clic su **Concedi consenso amministratore**. Un amministratore di Microsoft 365 accede e autorizza l'app di OneUptime per l'organizzazione. La scheda poi dice **Admin Consent Completed**. Finché nessun workspace è collegato, la sezione **Area di lavoro** dei menu Incidenti, Avvisi, Manutenzione programmata, Monitor e Reperibilità contiene **Collega Slack o Teams**, che porta anch'esso qui.

### Collegare il tuo account

Fai clic su **Connect with Microsoft Teams** e accedi con il tuo account di lavoro. OneUptime legge i team della tua organizzazione; **Visualizza team** li elenca.

### Aggiungere l'app di OneUptime a ogni team (obbligatorio)

Collegare il tuo account da solo non basta. Microsoft consente al bot di OneUptime di pubblicare solo in un team a cui è stato aggiunto, quindi fallo per ogni team in cui vuoi le notifiche:

- In Microsoft Teams, fai clic su "..." accanto al **nome del team** (non al nome del canale).
- Scegli **Manage team** > **Apps** > **More apps**, cerca **OneUptime** e fai clic su **Add**.

Su OneUptime Cloud, **Apri lo store di Teams** apre l'app nello Store di Microsoft Teams, dove **Add to a team** fa lo stesso. Su un server self-hosted, installa invece il pacchetto di **Scarica lo zip del manifest dell'app**: solo quello contiene il bot del tuo server. Se una notifica di prova segnala che l'app di OneUptime non è installata nel team, è questo il passaggio saltato.

### Collegare tutti gli altri

Ogni persona collega il proprio account Microsoft Teams in **Impostazioni utente** > **Area di lavoro** > **Microsoft Teams** con **Connect my account with Microsoft Teams**, per agire sugli incidenti e ricevere messaggi diretti a proprio nome. Quella sezione compare non appena il progetto è collegato a Microsoft Teams. Per coinvolgere un intero team in una volta sola, vedi [Chiedere a tutti di collegare il proprio account](#chiedere-a-tutti-di-collegare-il-proprio-account).

### Aggiungere una regola di notifica

Vai in **Incidenti** > **Area di lavoro** > **Microsoft Teams**. La sezione **Area di lavoro** elenca solo gli spazi di chat che il tuo progetto ha collegato, quindi **Microsoft Teams** vi compare non appena è collegato. Crea una regola, per esempio una che pubblica in un canale di Teams quando viene creato un incidente, poi fai clic su **Regola di test** nella sua riga.
:::

> [!NOTE]
> Installare OneUptime per te stesso, o aggiungerlo a una chat, è un'installazione diversa e non gli permette di pubblicare nei canali di un team. I **canali privati** richiedono l'app aggiunta al canale stesso: apri il canale > "..." > **Manage channel** > **Apps** > **Add an app**. I **canali condivisi** non possono ricevere notifiche: Microsoft Teams non supporta i bot nei canali condivisi.

## Chiedere a tutti di collegare il proprio account

Nessuno può collegare l'account Microsoft Teams di un'altra persona, nemmeno un amministratore: ognuno accede al proprio. Per coinvolgere un intero team, un **Proprietario del progetto** o un **Amministratore del progetto** chiede a tutti in una volta di collegare il proprio account, in **Impostazioni del progetto** > **Area di lavoro** > **Microsoft Teams**. La scheda **Members' Microsoft Teams accounts** indica quanti membri hanno collegato il proprio account. Con **Ask everyone to connect**, il bot di OneUptime invia un messaggio a ogni membro che non l'ha ancora fatto, con un pulsante **Connect Microsoft Teams account** che collega il suo account con un clic.

- **Chi riceve un messaggio.** Ogni membro del progetto che non ha collegato il proprio account Microsoft Teams e si trova in un team a cui è stata aggiunta l'app di OneUptime, trovato lì tramite il suo indirizzo email o il nome dell'entità utente. Chi ha ricevuto la richiesta nelle ultime 24 ore non la riceve di nuovo, quindi chiedere ancora il giorno dopo la ricorda solo a chi non ha ancora collegato il proprio account.
- **Cosa dice la scheda.** A che punto sono i messaggi mentre vengono inviati, poi chi ha fatto la richiesta e quanti membri hanno ricevuto un messaggio. I membri che OneUptime non ha trovato sono indicati per nome nella scheda: aggiungi l'app al loro team, oppure chiedi loro di collegare il proprio account da soli in **Impostazioni utente** > **Area di lavoro** > **Microsoft Teams**.
- **Cosa collega il pulsante.** L'account Microsoft Teams di chi lo preme ed effettua l'accesso, al proprio account OneUptime. Un messaggio inoltrato a qualcun altro non collega nulla al membro a cui era stato inviato.

## Regole di notifica

Una regola di notifica dice quali eventi vengono pubblicati in Microsoft Teams, e dove. Ogni prodotto ha le sue regole, in **Area di lavoro** > **Microsoft Teams** nel suo menu:

| Prodotto | Schede della sua pagina **Microsoft Teams** |
| --- | --- |
| **Incidenti** | **Incidenti**, **Incidente Episodi**, **Riepilogo** |
| **Avvisi** | **Avvisi**, **Avviso Episodi**, **Riepilogo** |
| **Manutenzione programmata** | Un elenco di regole |
| **Monitor** | Un elenco di regole |
| **Reperibilità** | Un elenco di regole |

Creare una regola passa per quattro passaggi:

| Passaggio | Cosa imposti |
| --- | --- |
| **Base** | **Nome della regola** e **Descrizione della regola**. |
| **Condizioni** | A quali eventi si applica la regola, per esempio per gravità, stato, etichetta, monitor o parole nel titolo. Vengono verificate quando un evento viene creato e di nuovo a ogni aggiornamento che OneUptime pubblica su di esso, quindi una regola per gli incidenti riconosciuti agisce quando un incidente viene riconosciuto. Una nuova regola vale per ogni evento, per esempio **Tutti gli incidenti**. Per restringerla, scegli **Solo gli incidenti che soddisfano le condizioni** e aggiungi le condizioni. Con due o più, **Condizione di corrispondenza** dice se devono corrispondere tutte o ne basta una. |
| **Destinazione** | Dove pubblica: un canale esistente di un team che scegli, le chat che scegli, un canale per ogni incidente (o avviso, episodio, evento, monitor o policy di reperibilità) creato in un team che scegli, o più di questi insieme. Sotto il passaggio, **Cosa fa questa regola** lo dice a frasi, come la scheda della regola. |
| **Video Call** | Solo incidenti e avvisi: avvia una chiamata per ciascuno. Vedi [Videochiamate](/docs/workspace-connections/video-calls). |

Un canale creato dalla regola prende il nome dal suo record: l'incidente INC-42 riceve `inc-42`, l'avviso ALT-7 riceve `alt-7` e, in un progetto senza prefissi di numero, l'incidente 42 riceve `incident-42`. Il testo in **Prefisso del nome del canale** va davanti, quindi `prod-` dà `prod-inc-42`, e il modulo mostra il nome mentre scrivi. Per un evento di manutenzione pianificata, il prefisso prende il posto del suo prefisso di numero: SM-5 riceve `sm-5` e `maint-` dà `maint-5`. OneUptime mantiene lettere, numeri, spazi, `-` e `_`, fino ai 50 caratteri che Microsoft Teams accetta. Se il team ha già un canale con quel nome, come quello di un altro progetto o uno eliminato negli ultimi 30 giorni, OneUptime aggiunge `-2`, `-3` e così via.

Una regola crea il suo canale la prima volta che un evento le corrisponde: quando l'evento viene creato, o più tardi, quando un aggiornamento lo fa corrispondere mentre è ancora aperto. Una regola per gli incidenti riconosciuti crea il canale quando l'incidente viene riconosciuto. Microsoft Teams mostra i canali di un team a tutti i suoi membri, quindi OneUptime non aggiunge nessuno a un canale uno per uno: tutti nel team che scegli possono aprirlo, come dice il modulo della regola sotto **Chi entra nel canale**. Un incidente, un avviso o un episodio privato riceve un canale privato, che vedono solo i suoi membri; aggiungi le persone in Microsoft Teams.

Per coinvolgere chi è reperibile, scegli le pianificazioni di reperibilità sotto **Menziona chi è reperibile**. Quando il canale viene creato, OneUptime vi pubblica un messaggio, subito dopo il primo del record, che menziona con @ chi è reperibile in quelle pianificazioni, così Microsoft Teams invia loro una notifica. Nessuno viene chiamato. OneUptime trova ogni persona nel team dall'account Microsoft Teams che quella persona ha collegato a OneUptime, oppure dal suo indirizzo email. Chi non è nel team non può aprirne i canali, quindi nel messaggio viene invece indicato per nome, con il motivo. In un canale privato, solo i suoi membri possono aprirlo, quindi aggiungi le persone reperibili in Microsoft Teams.

Ogni aggiornamento successivo del record — un cambio di stato, una nota, un nuovo proprietario — viene pubblicato nei suoi canali, e nei canali e nelle chat esistenti indicati dalle sue regole finché le loro condizioni corrispondono. OneUptime non può archiviare un canale di Microsoft Teams, quindi il canale di una regola resta quando il suo record è chiuso; archivialo o eliminalo in Microsoft Teams.

Un incidente, un avviso, un episodio o un evento di manutenzione pianificata con un canale tutto suo ha **Apri in Microsoft Teams** nell'intestazione della sua pagina in OneUptime, accanto ai pulsanti di stato. Apre quel canale in una nuova scheda, nell'app di Microsoft Teams o nel browser. Un record con due canali suoi li elenca entrambi sotto il pulsante. Un record con canali sia in Slack sia in Microsoft Teams ha invece un solo pulsante **Apri canale**, che li elenca tutti. I canali e le chat esistenti in cui pubblicano le tue regole non vengono proposti.

La pagina del record ha anche una scheda **Canale Microsoft Teams**, che dice chi può aprire il canale: tutti nel team oppure, per un canale privato, i suoi membri, che i suoi proprietari aggiungono in Microsoft Teams. OneUptime non cambia chi è in un canale di Microsoft Teams. Per un canale Slack, la scheda elenca chi c'è e aggiunge persone: vedi [Chi è nel canale di un record](/docs/workspace-connections/slack#chi-è-nel-canale-di-un-record).

I canali e le chat restano leggibili: ogni evento viene pubblicato una volta sola, e il primo stato di un record è nella scheda che annuncia il record, non in una scheda a sé. Un'esecuzione di una policy di reperibilità è una sola scheda, modificata man mano che l'esecuzione scala: chi è stato chiamato, quante volte e come, chi no e perché, e chi ha confermato. Una nuova scheda viene pubblicata solo quando qualcuno deve agire: una regola di escalation non ha raggiunto nessuno, o l'esecuzione è finita senza che nessuno confermasse. Che i proprietari del record o gli iscritti alla pagina di stato siano stati informati resta nel suo feed in OneUptime.

**Impostazioni del progetto** > **Area di lavoro** > **Microsoft Teams** elenca i canali che OneUptime vede nei tuoi team, e le chat a cui è stato aggiunto, con **Invia prova** accanto a ciascuno. Una chat compare non appena l'app di OneUptime vi viene aggiunta in Microsoft Teams; **Refresh Chats** recupera le nuove chat e i loro nomi attuali.

## Provare una regola

**Regola di test** nella riga di una regola pubblica un messaggio di prova di quella regola nei canali che indica, così puoi vederlo arrivare. Se la regola crea un canale per ogni evento, anche la prova ne crea uno e vi invita le persone della regola.

Come **Invia prova** accanto a un canale in **Impostazioni del progetto** > **Area di lavoro** > **Microsoft Teams**, richiede il permesso di creare regole di notifica: **Proprietario del progetto**, **Amministratore del progetto**, **Membro del progetto**, **Amministratore delle impostazioni**, **Membro delle impostazioni**, oppure **Create Workspace Notification Rule** e **Read Workspace Notification Rule** in un ruolo personalizzato. Per chi può solo vedere le regole, come un **Visualizzatore**, **Regola di test** è bloccato, e il suo suggerimento dice cosa serve; l'API rifiuta la sua prova con "You do not have permission to send test notifications in this project." Su OneUptime Cloud, provare una regola richiede il piano **Growth**, come aggiungerne una.

Su OneUptime Cloud, anche **Invia prova** accanto a un canale o a una chat richiede il piano **Growth**, perché pubblicare in un canale è ciò che fanno regole e riepiloghi. **Invia prova ora** su un riepilogo richiede il permesso di creare riepiloghi (**Create Workspace Notification Summary** e **Read Workspace Notification Summary** in un ruolo personalizzato) e, su OneUptime Cloud, il piano **Growth**; per chiunque altro è bloccato, e il suo suggerimento dice cosa serve. Un client MCP collegato con accesso in sola lettura non può inviare alcuna prova.

## Riepiloghi

La scheda **Riepilogo** di **Incidenti** > **Area di lavoro** > **Microsoft Teams** (e di **Avvisi**) pubblica un riepilogo periodico nei canali che indichi: quanti incidenti o avvisi ci sono stati, quanto in fretta sono stati riconosciuti e risolti, e un elenco con i link. Un nuovo riepilogo esce ogni settimana e copre gli ultimi 7 giorni. Lascia vuoto **Invia il primo report alle** e il primo esce alle 09:00 all'inizio della settimana, del giorno o del mese successivo; il modulo dice quando.

Un riepilogo esce secondo l'orologio del suo **Fuso orario**, che parte dal tuo. Lì mantiene la sua ora del giorno tutto l'anno: uno impostato per le 09:00 a Berlino esce ancora alle 09:00 a Berlino dopo il cambio dell'ora legale, e anche le date del suo messaggio sono quelle di Berlino. Tramite l'API, invia `timezone` come nome di fuso orario IANA, come `Europe/Berlin`. Un riepilogo creato senza fuso orario prende quello del profilo di chi l'ha creato, oppure UTC quando lo crea una chiave API.

Il modulo di un riepilogo ha quattro passaggi: **Informazioni di base** (il nome, i canali e il loro **Nome del team**), **Pianificazione**, **Contenuto** (**Cosa includere**) e **Filtri** (quali incidenti o avvisi conta).

## Regole di notifica sotto il piano Growth

Su OneUptime Cloud, le regole di notifica e i riepiloghi sono disponibili dal piano **Growth** in su. Un progetto al di sotto conserva le regole e i riepiloghi che ha già, e questi continuano a pubblicare in Microsoft Teams. Per questo la pagina **Microsoft Teams** di ogni prodotto (Incidenti, Avvisi, Manutenzione programmata, Reperibilità, Monitor) mostra la nota sul piano con questi elencati sotto (**Regole di notifica ancora configurate**, **Riepiloghi ancora configurati**): elimina una regola, oppure disattiva o elimina un riepilogo. Aggiungere o modificare regole e riepiloghi richiede **Growth**.

## Ricevere chiamate in Microsoft Teams

Per essere chiamato con un messaggio diretto quando sei di reperibilità, aggiungi Microsoft Teams ai tuoi metodi di notifica:

:::steps
1. Collega il tuo account Microsoft Teams (vedi [Collegare Microsoft Teams](#collegare-microsoft-teams)).
2. Vai in **Impostazioni utente** > **Metodi di notifica**, apri la scheda **Workspace Apps** e fai clic su **Add Microsoft Teams Account**.
3. Fai clic su **Send Test Message** nella sua riga. Il messaggio arriva nelle tue chat di Microsoft Teams.
:::

Aggiungerlo lo inserisce subito nelle tue regole di reperibilità, quindi da quel momento le chiamate ti raggiungono in Microsoft Teams. Cambia quali chiamate riceve in **Impostazioni utente** > **Regole di reperibilità**.

## Salvare i messaggi come note

Reagisci a un messaggio, o a una risposta, nel canale che OneUptime ha creato per un incidente, un avviso, un episodio o un evento di manutenzione programmata, e OneUptime lo salva come nota su quel record. Rileva la reazione entro un minuto e lo conferma con una risposta nel thread:

| Reazione | Salvato come |
| --- | --- |
| 📌 o 📍 | Una nota privata, visibile solo al tuo team |
| 📣 o 📢 | Una nota pubblica, mostrata sulla pagina di stato. Solo incidenti ed eventi di manutenzione programmata. Su un incidente privato, una nota privata, e la conferma dice perché. |

La nota riprende il messaggio così come Microsoft Teams lo mostrava: la formattazione, i link e il codice, le persone che menziona con il loro nome, e i file e le immagini come link. Una nota pubblica lascia fuori i file e le immagini, perché si aprono solo per il tuo team.

Sono le parole di chi ha scritto il messaggio: il suo nome in OneUptime se il suo account Microsoft Teams è collegato, altrimenti il nome che mostra Teams. Una nota privata viene collocata nella cronologia al momento in cui il messaggio è stato pubblicato, per quanto tempo dopo venga salvata. Una nota pubblica viene collocata al momento in cui viene salvata, cioè quando la pagina di stato la mostra. La cronologia dice chi l'ha salvata. La nota non viene ripubblicata nel canale, dove il messaggio c'è già.

La nota viene salvata a tuo nome, con i tuoi permessi, e l'app di OneUptime deve essere nel team. Se il tuo account Microsoft Teams non è ancora collegato, OneUptime ti chiede di collegarlo, in una risposta che ti menziona, con un pulsante che salva il messaggio non appena l'hai fatto.

## Parlare con il bot di OneUptime

Scrivi al bot in una chat personale, oppure menziona OneUptime con @ in un canale o in una chat di gruppo: lì risponde solo quando viene menzionato.

| Messaggio | Cosa fa il bot |
| --- | --- |
| `help` | Elenca cosa sa fare. |
| `incident [title or number]` | Apre il modulo dell'incidente, con il titolo compilato. Il numero di un incidente, come `42` o `INC-42`, mostra invece quell'incidente: vedi [Gestire un incidente da Microsoft Teams](#gestire-un-incidente-da-microsoft-teams). |
| `maintenance [title]` | Apre il modulo della manutenzione programmata, con il titolo compilato. |
| `oncall` | Elenca chi è reperibile in questo momento in ogni pianificazione di reperibilità che puoi vedere, fino a quando, e chi è il prossimo. |
| `page [who] [message]` | Chiama le persone che menzioni con @ per il tuo messaggio, oppure invia una scheda per scegliere chi chiamare. Vedi [Chiamare qualcuno da Microsoft Teams](#chiamare-qualcuno-da-microsoft-teams). |
| `ask [question]`, o qualsiasi domanda in linguaggio naturale | OneUptime AI risponde su log, trace, metriche, incidenti e monitor, per esempio "quali monitor sono giù in questo momento?". Le risposte si limitano a leggere. |
| `show active incidents`, `show active alerts` | Elenca ciò che è aperto adesso. |
| `show scheduled maintenance`, `show ongoing maintenance` | Elenca gli eventi di manutenzione in arrivo, o in corso. |

A parte le liste `show`, sono le parole che seguono `/oneuptime` in Slack; anche `create incident` e `create maintenance` funzionano ancora. Fare domande a OneUptime AI richiede il tuo account Microsoft Teams collegato e l'IA attivata per il progetto. Se il tuo non è collegato, il bot ti chiede una volta per thread o chat di collegarlo, con un pulsante **Connect Microsoft Teams account**. Vedi [Chiedi all'IA](/docs/ai/ask-ai).

## La tua home in Microsoft Teams

Scrivi `home` al bot di OneUptime e ti risponde con la tua home: una scheda con cosa succede nel progetto, come puoi vederlo tu.

- **La tua reperibilità.** Le pianificazioni di reperibilità in cui sei reperibile adesso, e fino a quando, oppure il tuo prossimo turno.
- **Cosa è aperto.** Gli incidenti e gli avvisi aperti più recenti che puoi leggere, ciascuno con un link alla sua pagina in OneUptime.
- **I suoi pulsanti.** **Declare incident** e **Page someone** rispondono come `incident` e `page`, **Who's on call** come `oncall`, e **Refresh** rilegge la scheda, al suo posto.

Quando aggiungi l'app OneUptime per te, il bot ti invia subito la tua home. La home e gli elenchi `show` leggono come te, quindi richiedono il tuo account Microsoft Teams collegato: finché non lo è, il bot risponde con un pulsante **Connect Microsoft Teams account**. **Apri OneUptime in Microsoft Teams**, in **Impostazioni utente** > **Area di lavoro** > **Microsoft Teams**, apre l'app in Teams.

Quando l'app viene aggiunta a un team, il bot vi saluta: come fargli una domanda e dove aggiungere una regola di notifica che pubblica nei canali del team.

## Creare incidenti e manutenzioni da Microsoft Teams

Scrivere `incident` o `maintenance` al bot di OneUptime apre un modulo per la persona che l'ha scritto, in una chat personale, in un canale o in una chat di gruppo allo stesso modo. Viene compilato a nome di quella persona: come l'account OneUptime a cui è collegato il suo account Microsoft Teams (vedi [Collegare Microsoft Teams](#collegare-microsoft-teams)), con i permessi di quell'account nel progetto. Chi non ha l'account collegato, o il cui account OneUptime non è più membro del progetto, riceve indicazioni su cosa fare in una risposta che lo menziona, invece del modulo.

- **Chi può usarli.** Le persone che possono dichiarare un incidente o creare un evento di manutenzione programmata in OneUptime: **Proprietario del progetto**, **Amministratore del progetto**, **Membro del progetto**, **Amministratore degli incidenti** e **Membro degli incidenti** per un incidente (**Create Incident** in un ruolo personalizzato), e **Amministratore della manutenzione programmata** e **Membro della manutenzione programmata** per un evento (**Create Scheduled Maintenance**). A chiunque altro viene detto, e non riceve alcun modulo.
- **Cosa offre un modulo.** Ogni elenco — gravità, monitor, stati dei monitor, policy di reperibilità ed etichette — contiene ciò che può leggere la persona che l'ha chiesto, come lo stesso elenco in OneUptime, e le note "not shown" della scheda contano solo quelli: con un ruolo limitato ad alcune etichette, i monitor e le policy di reperibilità che portano quelle etichette. Un elenco che non può leggere affatto viene omesso. Le policy di reperibilità archiviate non vengono mai offerte.
- **Cosa può indicare un modulo.** In un canale o in una chat di gruppo chiunque vi partecipi può inviare il modulo, e viene inviato a nome di chi lo fa, con i suoi permessi. L'incidente o l'evento viene creato con quei permessi e attribuito a quella persona. Un monitor, una policy di reperibilità, un'etichetta, una gravità o uno stato che non può leggere, o uno di un altro progetto, viene rifiutato come uno che il progetto non ha, e non viene creato nulla: il bot risponde "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** su un incidente, un avviso o un episodio funziona allo stesso modo: richiede il permesso di eseguire una policy di reperibilità (**Proprietario del progetto**, **Amministratore del progetto**, **Membro del progetto**, **Amministratore della reperibilità** e **Membro della reperibilità**, oppure **Create On-Call Duty Policy Execution Log** in un ruolo personalizzato) e di leggere quell'incidente, avviso o episodio, e offre le policy di reperibilità attive che la persona può leggere. Anche visualizzare un monitor o una policy di reperibilità da una scheda lo legge a nome della persona che ha premuto il pulsante.

## Chiamare qualcuno da Microsoft Teams

In un canale o in una chat di gruppo, `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` chiama subito Nawaz. Riceve una telefonata, un SMS, una notifica push o un'email, come dicono le sue regole di reperibilità, e ognuna gli dice chi lo ha chiamato, tramite quale team o pianificazione, e il tuo messaggio. Il punto in cui invii il comando decide di cosa tratta la chiamata:

- **Nel canale proprio di un incidente o di un avviso**, quello che OneUptime ha creato per esso, la chiamata riguarda quell'incidente o quell'avviso, e non viene creato nulla di nuovo. Lì il messaggio è facoltativo: basta `@OneUptime page @Nawaz Dhandala`. Le persone che chiami vengono chiamate finché una di loro non risponde, dalla chiamata o confermando l'incidente o l'avviso; se lo conferma qualcun altro la chiamata non si ferma, mentre risolverlo la ferma.
- **Ovunque altrove**, come in un altro canale, in una chat di gruppo, in una chat personale con il bot o nel canale di un incidente o di un avviso già risolto, OneUptime crea un avviso il cui titolo è il tuo messaggio, e chiama finché qualcuno non conferma l'avviso. Lo dice la scheda, e la chiamata mostrata nella conversazione nomina l'avviso.
- **Chi viene chiamato subito.** Le persone che menzioni con @, e chi è reperibile nelle pianificazioni seguite da un tag che menzioni con @ (vedi [Tag di reperibilità](#tag-di-reperibilità)), quando le segue un messaggio, oppure senza messaggio nel canale proprio di un incidente o di un avviso. OneUptime riconosce una persona dall'account OneUptime a cui è collegato il suo account Microsoft Teams, oppure dal suo indirizzo email in Microsoft Teams. Nessuno al di fuori del progetto viene chiamato.
- **Tutto il resto riceve una scheda.** Senza nessuno menzionato con @, come in una chat personale con il bot, senza messaggio dove la chiamata ne richiede uno, con un tag che non segue nessuna pianificazione di reperibilità che puoi vedere, o con una persona che OneUptime non riesce a riconoscere, il bot risponde con la scheda **Page someone**, con quello che hai scritto già compilato, e dice chi non è riuscito a scegliere. Nel canale proprio di un incidente o di un avviso, la scheda si apre con quell'incidente o quell'avviso. Scegli persone, un team, una pianificazione di reperibilità, che chiama chi è reperibile in essa in quel momento, o una policy di reperibilità, che chiama tramite le sue regole di escalation, e inviala. Chiunque nella conversazione può inviare la scheda, a proprio nome. Una volta che ha chiamato, la scheda viene rimossa, così nessuno chiama due volte con essa.
- **Dove si vede.** La conversazione mostra la chiamata come una sola scheda, tenuta aggiornata: chi è stato chiamato e come, ogni team con il suo nome seguito dalle sue persone, il tuo messaggio, e chi ha confermato. Dove il bot non può pubblicarla, la sua risposta dice chi è stato chiamato, con un link all'incidente o all'avviso.
- **Chi può chiamare.** Nel canale proprio di un incidente o di un avviso, chiunque possa eseguire una policy di reperibilità (**Proprietario del progetto**, **Amministratore del progetto**, **Membro del progetto**, **Amministratore della reperibilità** e **Membro della reperibilità**, oppure **Create On-Call Duty Policy Execution Log** in un ruolo personalizzato) e leggere quell'incidente o quell'avviso. Ovunque altrove la chiamata crea un avviso, quindi richiede anche il permesso di crearne uno: **Proprietario del progetto**, **Amministratore del progetto** e **Membro del progetto**, oppure **Membro della reperibilità** insieme ad **Membro degli avvisi** (**Create On-Call Duty Policy Execution Log** e **Create Alert** in un ruolo personalizzato). Chiamare direttamente persone, un team o una pianificazione, senza una policy di reperibilità dietro la chiamata, richiede anche l'accesso a tutte le policy di reperibilità del progetto. A chiunque altro viene detto in una risposta, e nessuno viene chiamato. Su OneUptime Cloud, chiamare richiede il piano Growth: al di sotto, OneUptime indica il piano necessario, e nessuno viene chiamato.

## Tag di reperibilità

Mantieni un tag di Microsoft Teams, come `@Payments on-call`, uguale a chi è reperibile in una o più pianificazioni di reperibilità, così chiunque nel suo team può menzionarlo con @ per raggiungerli. OneUptime cambia i membri del tag a ogni passaggio di consegne e sostituzione, e lo controlla ogni 15 minuti.

:::steps
### Collegare un tag a una pianificazione

Apri la pianificazione in **Reperibilità** > **Pianificazioni di reperibilità**. Nella sua scheda **Tag di Microsoft Teams**, fai clic su **Collega tag**, scegli il team e dai un nome al tag: il tag del team con quel nome, oppure uno nuovo creato da OneUptime. I suoi membri vengono sostituiti subito da chi è reperibile.

### Collegarlo anche alla pianificazione secondaria

Per un tag che contenga la reperibilità primaria e quella secondaria, collega lo stesso tag anche nella pagina della pianificazione secondaria. Un tag può seguire qualsiasi numero di pianificazioni.
:::

- **Cosa mostra la scheda.** Chi c'è ora in ogni tag, il suo team, le altre pianificazioni che segue e se è **Aggiornato**. Un tag contiene solo membri del suo team: chi è reperibile ma non è nel team viene indicato, con il motivo.
- **Nessuno reperibile.** OneUptime toglie tutti dal tag finché qualcuno non è reperibile. Un nuovo tag ha bisogno di qualcuno del team reperibile, perché Microsoft Teams non crea tag vuoti.
- **Chiamarlo.** `@OneUptime page @Payments on-call The checkout API is down` chiama chi è reperibile nelle pianificazioni seguite dal tag. Vedi [Chiamare qualcuno da Microsoft Teams](#chiamare-qualcuno-da-microsoft-teams).
- **Cosa serve a Microsoft 365.** Modificare i tag richiede l'autorizzazione `TeamworkTag.ReadWrite.All` dell'app, che un amministratore di Microsoft 365 concede con **Concedi consenso amministratore** in **Impostazioni del progetto** > **Area di lavoro** > **Microsoft Teams**. Se la tua organizzazione ha dato il consenso prima che OneUptime potesse mantenere i tag, dallo di nuovo una volta.
- **Chi può collegarne uno.** I ruoli che possono modificare le pianificazioni: **Proprietario del progetto**, **Amministratore del progetto**, **Membro del progetto**, **Amministratore della reperibilità** e **Membro della reperibilità**, oppure **Edit On-Call Duty Policy Schedule** in un ruolo personalizzato. Su OneUptime Cloud, collegarne uno richiede il piano **Growth**.
- **Scollegare.** OneUptime smette di modificare il tag. Il tag e i suoi membri restano in Microsoft Teams come sono.

## Gestire un incidente da Microsoft Teams

La scheda di un incidente ha quattro pulsanti, **Acknowledge Incident**, **Resolve Incident**, **Add Note** e **View Incident**, e il resto nel suo menu, il pulsante con tre puntini:

| Voce del menu | Cosa fa |
| --- | --- |
| **Change Severity** | Imposta la gravità dell'incidente. |
| **Change Incident State** | Porta l'incidente a uno stato successivo. |
| **Assign Role** | Dà a qualcuno un ruolo nell'incidente, come **Incident Commander**. Un ruolo per una sola persona passa a lei. |
| **Page Someone** | Chiama persone, un team, chi è reperibile in una pianificazione, o una policy di reperibilità per l'incidente, con un messaggio facoltativo. Le persone vengono chiamate finché una di loro non risponde; una policy chiama finché qualcuno non conferma l'incidente. |
| **Edit Custom Fields** | Imposta i campi personalizzati dell'incidente, ognuno compilato con ciò che l'incidente contiene. Un campo lasciato vuoto viene svuotato. |

`incident 42`, scritto al bot, risponde con l'incidente 42, questi pulsanti e il suo menu. Scrivi il numero come lo mostra OneUptime: `42`, `#42` o `INC-42`. Nel canale proprio di un incidente, `incident` da solo mostra quell'incidente.

- **Chi può usarli.** Le persone che possono fare la stessa modifica in OneUptime, come in Slack: vedi [Gestire un incidente da Slack](/docs/workspace-connections/slack#gestire-un-incidente-da-slack). Ogni voce risponde con una scheda, compilata come la persona che l'ha premuta può vedere l'incidente. Chiunque nella conversazione può inviare la scheda, a proprio nome, con i propri permessi.
- **Cosa succede.** La modifica viene fatta a nome della persona che ha inviato la scheda, come in OneUptime, e il feed dell'incidente dice cosa è cambiato. Il bot lo dice in una risposta che la menziona, e rimuove la scheda, così nessuno la invia due volte. **Page Someone** dice chi è stato chiamato, o perché nessuno; un incidente già risolto non chiama nessuno.
- **Dove Microsoft Teams è diverso.** Una scheda non può dire sotto un campo cosa c'è di sbagliato: un valore che non va bene viene indicato in una risposta, e la scheda resta per essere corretta e inviata di nuovo. Un campo di data e ora è un giorno e un'ora, nel tuo fuso orario. Un client Teams meno recente mostra il menu come altri pulsanti. `incident 42` risponde nella conversazione, dove tutti quelli che ne fanno parte possono vedere l'incidente.
- **Schede pubblicate prima del menu.** Mantengono il loro pulsante **Execute On-Call Policy**, che continua a funzionare: **Page Someone** chiama anche una policy di reperibilità. Avvisi ed episodi mantengono il loro.

## Agire su incidenti, avvisi ed eventi da Microsoft Teams

I pulsanti delle schede di OneUptime agiscono a nome della persona che li preme, in una chat personale, in un canale o in una chat di gruppo allo stesso modo: come l'account OneUptime a cui è collegato il suo account Microsoft Teams, con i permessi di quell'account nel progetto. **Acknowledge**, **Resolve**, **Change State**, **Add Note** ed **Execute On-Call Policy** su un incidente, un avviso o un episodio, e **Mark as Ongoing**, **Mark as Complete**, **Change State** e **Add Note** su un evento di manutenzione programmata, fanno ciascuno la modifica che la stessa azione fa in OneUptime, e lì viene attribuita a quella persona: la cronologia degli stati e il feed del record mostrano chi ha cambiato il suo stato, e la nota è sua. Una nota salvata da un messaggio con una reazione viene pubblicata allo stesso modo.

- **Chi può usarli.** Le persone che possono fare la stessa modifica in OneUptime. Riconoscere, risolvere o cambiare lo stato di un incidente richiede il permesso di cambiarne lo stato: **Proprietario del progetto**, **Amministratore del progetto**, **Membro del progetto**, **Amministratore degli incidenti** e **Membro degli incidenti**, oppure **Create Incident State Timeline** in un ruolo personalizzato. Un avviso, un episodio o un evento di manutenzione programmata richiede lo stesso permesso per il proprio tipo (**Create Alert State Timeline**, per esempio), e una nota richiede il permesso di pubblicare quel tipo di nota. Come il pannello dello stato in OneUptime, non chiedono il permesso di modificare l'incidente o l'avviso in sé. A chiunque altro viene detto, e non cambia nulla.
- **Quali record.** Quelli che la persona può leggere, come in OneUptime: con un ruolo limitato ad alcune etichette, gli incidenti, gli avvisi, gli episodi e gli eventi che le portano. Un pulsante su qualsiasi altro record dice perché, e non cambia nulla: su un incidente che il suo ruolo non raggiunge, "your access in this project does not include this incident. Ask a project admin for access to it."; su un incidente privato di cui non è proprietaria, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; e su uno eliminato nel frattempo, "the incident was not found. It may have been deleted." Su OneUptime Cloud, una modifica che il piano del progetto non include viene rifiutata indicando il piano che richiede.
- **Cosa offre Change State.** Gli stati che la persona può leggere in cui il record può passare dopo, nell'ordine del progetto: nessuno precedente allo stato in cui si trova, per un episodio come per un incidente, un avviso o un evento di manutenzione programmata, poiché un cambio di stato non fa mai risalire un record nel suo elenco (vedi [L'ordine è un vincolo reale, non una preferenza di visualizzazione](/docs/incidents/states-and-severities#lordine-è-un-vincolo-reale-non-una-preferenza-di-visualizzazione)). Se non può leggerne nessuno, il bot dice "No incident states are available to you in this project. Ask a project admin for access to them."; quando il record è nell'ultimo stato che può raggiungere, dice "There is no later state to move this incident to." Nessuno dei due mostra una scheda vuota.
- **Add Note su un incidente privato.** Un incidente privato non accetta note pubbliche, quindi la sua scheda non chiede il tipo di nota e aggiunge una nota privata. Anche una scheda inviata prima che diventasse privato aggiunge una nota privata, e lo dice. Vedi [Gli incidenti privati accettano solo note private](/docs/incidents/notes-owners-and-feed#gli-incidenti-privati-accettano-solo-note-private).
- **Escalate.** Il pulsante **Escalate** di una scheda esegue la sua policy di reperibilità per l'incidente, l'avviso o l'episodio di cui tratta la scheda, a nome della persona che l'ha premuto, con gli stessi permessi di **Execute On-Call Policy**. Una scheda che non tratta nessuno di questi riceve come risposta "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", e nessuno viene chiamato.
- **Dove riceve la risposta.** In una risposta nella stessa conversazione, il thread della scheda in un canale, che menziona la persona, così Microsoft Teams la avvisa. Un pulsante premuto troppo tardi dice chi è arrivato prima, e quando, per esempio "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Se il suo account non è collegato.** La risposta le chiede di collegarlo, con un pulsante **Connect Microsoft Teams account**. Il pulsante apre le sue impostazioni Microsoft Teams in OneUptime e collega il suo account in un solo passaggio, dopo l'accesso a OneUptime se serve. Poi OneUptime completa ciò che ha premuto, a suo nome, e risponde nella stessa conversazione; per un pulsante che apre un modulo, o un comando, le chiede di premerlo o di digitarlo di nuovo. Il pulsante funziona una volta, per 30 minuti, e solo per l'account Microsoft che lo ha premuto.

## Scollegare

- **Disconnetti** scollega solo il tuo account Microsoft Teams, e rimuove con esso il tuo metodo di notifica Microsoft Teams.
- **Uninstall OneUptime from Microsoft Teams**, in **Impostazioni del progetto** > **Area di lavoro** > **Microsoft Teams**, scollega il progetto. OneUptime smette di pubblicare in Microsoft Teams, e i menu **Area di lavoro** smettono di elencarlo. Le regole di notifica e i riepiloghi vengono conservati per quando lo ricolleghi.

> [!WARNING]
> Disinstallare scollega anche l'account Microsoft Teams di ogni membro del progetto, e rimuove i metodi di notifica Microsoft Teams e le regole di reperibilità che li usavano. Un progetto è collegato a una sola organizzazione Microsoft 365: per spostarlo in un'altra, disinstalla prima.

## Risoluzione dei problemi

:::details Una prova dice che l'app di OneUptime non è installata nel team
Microsoft ha rifiutato la pubblicazione perché il bot non è in quel team. Aggiungi l'app al team (vedi [Collegare Microsoft Teams](#collegare-microsoft-teams)) oppure, per un canale privato, al canale stesso. Aggiungerla a un team non vale per gli altri.
:::

:::details Microsoft Teams non è stato collegato
Quando Microsoft ti riporta indietro senza un collegamento, la pagina da cui sei partito dice **Microsoft Teams non è stato connesso**, e una frase dice perché: ti manca il permesso, il link è stato già usato o è scaduto, hai effettuato l'accesso a un'altra organizzazione Microsoft 365, oppure la tua organizzazione non ha ancora team. Vedi [La connessione non è stata completata](/docs/self-hosted/microsoft-teams-integration#la-connessione-non-è-stata-completata) per ogni frase e cosa fare.
:::

:::details Il bot dice che il mio account non è collegato
Premi **Connect Microsoft Teams account** nella risposta del bot per collegarlo in un solo passaggio, oppure collegalo in **Impostazioni utente** > **Area di lavoro** > **Microsoft Teams** con **Connect my account with Microsoft Teams**. In entrambi i casi accedi all'organizzazione a cui è collegato il progetto, come ospite se lì sei un ospite. Se sei un ospite e in passato hai collegato l'account della tua organizzazione, collegalo di nuovo.
:::

:::details Tutte le notifiche falliscono su un server self-hosted
L'app di Teams installata nei tuoi team deve essere il pacchetto creato dal tuo server, e Microsoft deve poter raggiungere l'endpoint del bot del tuo server. Vedi la risoluzione dei problemi di [Integrazione Microsoft Teams](/docs/self-hosted/microsoft-teams-integration#risoluzione-dei-problemi).
:::

## Passaggi successivi

:::cards
- [Slack](/docs/workspace-connections/slack): Le stesse notifiche e azioni in Slack.
- [Videochiamate](/docs/workspace-connections/video-calls): Dai a ogni incidente una chiamata, pubblicata con i suoi aggiornamenti.
- [Integrazione Microsoft Teams](/docs/self-hosted/microsoft-teams-integration): Configurare il bot di Teams su un server self-hosted.
- [Dichiarare un incidente](/docs/incidents/declaring-incidents): Tutti i modi in cui inizia un incidente, e cosa viene eseguito allora.
:::
