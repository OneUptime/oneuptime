# Microsoft Teams

Collega OneUptime a Microsoft Teams per pubblicare nei tuoi canali e nelle tue chat incidenti, avvisi, episodi, manutenzioni programmate, monitor e aggiornamenti di reperibilità, dare a ogni incidente un canale tutto suo e lasciare che i responder agiscano da Teams: riconoscere, risolvere, aggiungere note, chiamare la reperibilità, dichiarare incidenti e fare domande a OneUptime AI.

:::cards
- [Collegare Microsoft Teams](#collegare-microsoft-teams): Il consenso dell'amministratore, il tuo accesso e l'app in ogni team.
- [Regole di notifica](#regole-di-notifica): Decidi quali eventi vengono pubblicati dove, e quali hanno un canale tutto loro.
- [Parlare con il bot di OneUptime](#parlare-con-il-bot-di-oneuptime): Comandi, domande e moduli in una chat con il bot.
- [Agire su incidenti, avvisi ed eventi da Microsoft Teams](#agire-su-incidenti-avvisi-ed-eventi-da-microsoft-teams): I pulsanti delle schede di OneUptime.
:::

## Come funziona

```mermaid title="Da un evento in OneUptime a una scheda in Microsoft Teams"
flowchart TB
    event["Un incidente, un avviso o un evento<br/>viene creato o cambia"] --> rules{"Regole di notifica<br/>le cui condizioni corrispondono"}
    rules -->|"Create Microsoft Teams Channel"| own["Un canale tutto suo<br/>nel team che scegli"]
    rules -->|"Pubblicare in un canale<br/>o in una chat esistente"| existing["I tuoi canali e le tue chat"]
    own --> card["Una scheda con pulsanti"]
    existing --> card
    card -->|"Un responder ne preme uno"| change["La modifica avviene in OneUptime,<br/>a nome di quel responder"]
```

Tre cose rendono tutto possibile:

- **Il collegamento del progetto**, fatto una volta: un amministratore di Microsoft 365 dà il consenso all'app di OneUptime per la tua organizzazione.
- **L'app di OneUptime in ogni team** in cui vuoi le notifiche. Microsoft consente al bot di pubblicare solo in un team a cui è stato aggiunto.
- **Il collegamento di ogni persona**: il suo account Microsoft Teams collegato al suo account OneUptime. Pulsanti, comandi e reazioni agiscono a nome di quella persona, con i suoi permessi nel progetto.

## Prima di iniziare

- **Un ruolo che può collegare il progetto:** **Project Owner**, **Project Admin** o **Project Member**. Disinstallare richiede **Project Owner** o **Project Admin**.
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

Ogni persona collega il proprio account Microsoft Teams in **Impostazioni utente** > **Area di lavoro** > **Microsoft Teams** con **Connect my account with Microsoft Teams**, per agire sugli incidenti e ricevere messaggi diretti a proprio nome. Quella sezione compare non appena il progetto è collegato a Microsoft Teams.

### Aggiungere una regola di notifica

Vai in **Incidenti** > **Area di lavoro** > **Microsoft Teams**. La sezione **Area di lavoro** elenca solo gli spazi di chat che il tuo progetto ha collegato, quindi **Microsoft Teams** vi compare non appena è collegato. Crea una regola, per esempio una che pubblica in un canale di Teams quando viene creato un incidente, poi fai clic su **Regola di test** nella sua riga.
:::

> [!NOTE]
> Installare OneUptime per te stesso, o aggiungerlo a una chat, è un'installazione diversa e non gli permette di pubblicare nei canali di un team. I **canali privati** richiedono l'app aggiunta al canale stesso: apri il canale > "..." > **Manage channel** > **Apps** > **Add an app**. I **canali condivisi** non possono ricevere notifiche: Microsoft Teams non supporta i bot nei canali condivisi.

## Regole di notifica

Una regola di notifica dice quali eventi vengono pubblicati in Microsoft Teams, e dove. Ogni prodotto ha le sue regole, in **Area di lavoro** > **Microsoft Teams** nel suo menu:

| Prodotto | Schede della sua pagina **Microsoft Teams** |
| --- | --- |
| **Incidenti** | **Incidenti**, **Incidente Episodi**, **Summary** |
| **Avvisi** | **Avvisi**, **Avviso Episodi**, **Summary** |
| **Manutenzione programmata** | Un elenco di regole |
| **Monitor** | Un elenco di regole |
| **Reperibilità** | Un elenco di regole |

Creare una regola passa per quattro passaggi:

| Passaggio | Cosa imposti |
| --- | --- |
| **Base** | **Nome della regola** e **Descrizione della regola**. |
| **Condizioni** | Per quali eventi scatta la regola, per esempio per gravità, stato, etichetta, monitor o parole nel titolo. Senza condizioni scatta per ogni evento. Con due o più, **Condizione di corrispondenza** dice se devono corrispondere tutte o ne basta una. |
| **Destinazione** | Dove pubblica: un canale esistente di un team che scegli, le chat che scegli, un nuovo canale creato in un team che scegli, o più di questi insieme. |
| **Video Call** | Solo incidenti e avvisi: avvia una chiamata per ciascuno. Vedi [Videochiamate](/docs/workspace-connections/video-calls). |

Un canale creato dalla regola prende il nome da **New Microsoft Teams Channel Name** seguito dal numero del record, come `oneuptime-incident-42`, e solo un canale creato riceve le persone che la regola invita. Un incidente, un avviso o un episodio privato riceve un canale privato. Ogni aggiornamento successivo del record — un cambio di stato, una nota, un nuovo proprietario — viene pubblicato nei suoi canali e nelle sue chat.

**Impostazioni del progetto** > **Area di lavoro** > **Microsoft Teams** elenca i canali che OneUptime vede nei tuoi team, e le chat a cui è stato aggiunto, con **Invia prova** accanto a ciascuno. Una chat compare non appena l'app di OneUptime vi viene aggiunta in Microsoft Teams; **Refresh Chats** recupera le nuove chat e i loro nomi attuali.

## Provare una regola

**Regola di test** nella riga di una regola pubblica un messaggio di prova di quella regola nei canali che indica, così puoi vederlo arrivare. Se la regola crea un canale per ogni evento, anche la prova ne crea uno e vi invita le persone della regola.

Come **Invia prova** accanto a un canale in **Impostazioni del progetto** > **Area di lavoro** > **Microsoft Teams**, richiede il permesso di creare regole di notifica: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, oppure **Create Workspace Notification Rule** e **Read Workspace Notification Rule** in un ruolo personalizzato. Per chi può solo vedere le regole, come un **Viewer**, **Regola di test** è bloccato, e il suo suggerimento dice cosa serve; l'API rifiuta la sua prova con "You do not have permission to send test notifications in this project." Su OneUptime Cloud, provare una regola richiede il piano **Growth**, come aggiungerne una.

Su OneUptime Cloud, anche **Invia prova** accanto a un canale o a una chat richiede il piano **Growth**, perché pubblicare in un canale è ciò che fanno regole e riepiloghi. **Invia prova ora** su un riepilogo richiede il permesso di creare riepiloghi (**Create Workspace Notification Summary** e **Read Workspace Notification Summary** in un ruolo personalizzato) e, su OneUptime Cloud, il piano **Growth**; per chiunque altro è bloccato, e il suo suggerimento dice cosa serve. Un client MCP collegato con accesso in sola lettura non può inviare alcuna prova.

## Riepiloghi

La scheda **Summary** di **Incidenti** > **Area di lavoro** > **Microsoft Teams** (e di **Avvisi**) pubblica un riepilogo periodico nei canali che indichi: quanti incidenti o avvisi ci sono stati, quanto in fretta sono stati riconosciuti e risolti, e un elenco con i link. Un nuovo riepilogo esce ogni settimana e copre gli ultimi 7 giorni. Lascia vuoto **Invia il primo report alle** e il primo esce alle 09:00 all'inizio della settimana, del giorno o del mese successivo; il modulo dice quando.

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
| 📣 o 📢 | Una nota pubblica, mostrata sulla pagina di stato. Solo incidenti ed eventi di manutenzione programmata. |

La nota viene salvata a tuo nome, con i tuoi permessi, quindi il tuo account Microsoft Teams deve essere collegato, e l'app di OneUptime deve essere nel team.

## Parlare con il bot di OneUptime

Scrivi al bot in una chat personale, oppure menziona OneUptime con @ in un canale o in una chat di gruppo: lì risponde solo quando viene menzionato.

| Messaggio | Cosa fa il bot |
| --- | --- |
| `help` | Elenca cosa sa fare. |
| `ask <question>`, o qualsiasi domanda in linguaggio naturale | OneUptime AI risponde su log, trace, metriche, incidenti e monitor, per esempio "quali monitor sono giù in questo momento?". Le risposte si limitano a leggere. |
| `create incident [title]` | Apre il modulo dell'incidente, con il titolo compilato. |
| `create maintenance [title]` | Apre il modulo della manutenzione programmata, con il titolo compilato. |
| `show active incidents`, `show active alerts` | Elenca ciò che è aperto adesso. |
| `show scheduled maintenance`, `show ongoing maintenance` | Elenca gli eventi di manutenzione in arrivo, o in corso. |

Fare domande a OneUptime AI richiede l'IA attivata per il progetto. Vedi [Chiedi all'IA](/docs/ai/ask-ai).

## Creare incidenti e manutenzioni da Microsoft Teams

Scrivere `create incident` o `create maintenance` al bot di OneUptime apre un modulo per la persona che l'ha scritto, in una chat personale, in un canale o in una chat di gruppo allo stesso modo. Viene compilato a nome di quella persona: come l'account OneUptime a cui è collegato il suo account Microsoft Teams (vedi [Collegare Microsoft Teams](#collegare-microsoft-teams)), con i permessi di quell'account nel progetto. Chi non ha l'account collegato, o il cui account OneUptime non è più membro del progetto, riceve indicazioni su cosa fare invece del modulo.

- **Chi può usarli.** Le persone che possono dichiarare un incidente o creare un evento di manutenzione programmata in OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** e **Incident Member** per un incidente (**Create Incident** in un ruolo personalizzato), e **Scheduled Maintenance Admin** e **Scheduled Maintenance Member** per un evento (**Create Scheduled Maintenance**). A chiunque altro viene detto, e non riceve alcun modulo.
- **Cosa offre un modulo.** Ogni elenco — gravità, monitor, stati dei monitor, policy di reperibilità ed etichette — contiene ciò che può leggere la persona che l'ha chiesto, come lo stesso elenco in OneUptime, e le note "not shown" della scheda contano solo quelli: con un ruolo limitato ad alcune etichette, i monitor e le policy di reperibilità che portano quelle etichette. Un elenco che non può leggere affatto viene omesso. Le policy di reperibilità archiviate non vengono mai offerte.
- **Cosa può indicare un modulo.** In un canale o in una chat di gruppo chiunque vi partecipi può inviare il modulo, e viene inviato a nome di chi lo fa, con i suoi permessi. L'incidente o l'evento viene creato con quei permessi e attribuito a quella persona. Un monitor, una policy di reperibilità, un'etichetta, una gravità o uno stato che non può leggere, o uno di un altro progetto, viene rifiutato come uno che il progetto non ha, e non viene creato nulla: il bot risponde "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** su un incidente, un avviso o un episodio funziona allo stesso modo: richiede il permesso di eseguire una policy di reperibilità (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** e **On-Call Member**, oppure **Create On-Call Duty Policy Execution Log** in un ruolo personalizzato) e di leggere quell'incidente, avviso o episodio, e offre le policy di reperibilità attive che la persona può leggere. Anche visualizzare un monitor o una policy di reperibilità da una scheda lo legge a nome della persona che ha premuto il pulsante.

## Agire su incidenti, avvisi ed eventi da Microsoft Teams

I pulsanti delle schede di OneUptime agiscono a nome della persona che li preme, in una chat personale, in un canale o in una chat di gruppo allo stesso modo: come l'account OneUptime a cui è collegato il suo account Microsoft Teams, con i permessi di quell'account nel progetto. **Acknowledge**, **Resolve**, **Change State**, **Add Note** ed **Execute On-Call Policy** su un incidente, un avviso o un episodio, e **Mark as Ongoing**, **Mark as Complete**, **Change State** e **Add Note** su un evento di manutenzione programmata, fanno ciascuno la modifica che la stessa azione fa in OneUptime, e lì viene attribuita a quella persona: la cronologia degli stati e il feed del record mostrano chi ha cambiato il suo stato, e la nota è sua. Una nota salvata da un messaggio con una reazione viene pubblicata allo stesso modo.

- **Chi può usarli.** Le persone che possono fare la stessa modifica in OneUptime. Riconoscere, risolvere o cambiare lo stato di un incidente richiede il permesso di cambiarne lo stato: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** e **Incident Member**, oppure **Create Incident State Timeline** in un ruolo personalizzato. Un avviso, un episodio o un evento di manutenzione programmata richiede lo stesso permesso per il proprio tipo (**Create Alert State Timeline**, per esempio), e una nota richiede il permesso di pubblicare quel tipo di nota. Come il pannello dello stato in OneUptime, non chiedono il permesso di modificare l'incidente o l'avviso in sé. A chiunque altro viene detto, e non cambia nulla.
- **Quali record.** Quelli che la persona può leggere, come in OneUptime: con un ruolo limitato ad alcune etichette, gli incidenti, gli avvisi, gli episodi e gli eventi che le portano. Un pulsante su qualsiasi altro record, o su uno di un altro progetto, riceve come risposta che il record "was not found in this project, or you do not have access to it.", e non cambia nulla. Su OneUptime Cloud, una modifica che il piano del progetto non include viene rifiutata indicando il piano che richiede.
- **Cosa offre Change State.** Gli stati che la persona può leggere in cui il record può passare dopo, nell'ordine del progetto: nessuno precedente allo stato in cui si trova, per un episodio come per un incidente, un avviso o un evento di manutenzione programmata, poiché un cambio di stato non fa mai risalire un record nel suo elenco (vedi [L'ordine è un vincolo reale, non una preferenza di visualizzazione](/docs/incidents/states-and-severities#lordine-è-un-vincolo-reale-non-una-preferenza-di-visualizzazione)). Se non può leggerne nessuno, il bot dice "No incident states are available to you in this project. Ask a project admin for access to them."; quando il record è nell'ultimo stato che può raggiungere, dice "There is no later state to move this incident to." Nessuno dei due mostra una scheda vuota.
- **Escalate.** Il pulsante **Escalate** di una scheda esegue la sua policy di reperibilità per l'incidente, l'avviso o l'episodio di cui tratta la scheda, a nome della persona che l'ha premuto, con gli stessi permessi di **Execute On-Call Policy**. Una scheda che non tratta nessuno di questi riceve come risposta "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", e nessuno viene chiamato.

## Scollegare

- **Disconnect** scollega solo il tuo account Microsoft Teams, e rimuove con esso il tuo metodo di notifica Microsoft Teams.
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
Collegalo in **Impostazioni utente** > **Area di lavoro** > **Microsoft Teams** con **Connect my account with Microsoft Teams**, con l'accesso effettuato nell'organizzazione a cui è collegato il progetto. Un account ospite di un'altra organizzazione non è lo stesso account.
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
