# Note, proprietari e feed

Ogni incidente accumula una traccia scritta mentre ci lavorate. Una parte di quella traccia è per i vostri clienti — l'aggiornamento che esce sulla pagina di stato alle 02:14 per dire che avete trovato il deploy sbagliato. Il resto è per il vostro team — lo stack trace che qualcuno ha incollato, il grafico che finalmente ha avuto senso, la decisione di fare il failover.

OneUptime tiene separati i due pubblici. Le **Note pubbliche** vengono pubblicate sulla vostra pagina di stato e possono avvisare gli iscritti. Le **Note private** (il modello `IncidentInternalNote`) restano dentro la dashboard. Sotto entrambe c'è l'**Incidente Feed**, una cronologia in sola aggiunta che registra tutto ciò che è successo all'incidente, e l'elenco **Proprietari**, che decide chi viene informato.

Tutto questo si trova nel menu laterale sinistro dell'incidente: **Note → Note pubbliche**, **Note → Note private** e **Team → Proprietari**. Il feed sta nella pagina **Panoramica** dell'incidente.

## Note pubbliche e note private a confronto

I due tipi di nota si somigliano nella dashboard e si comportano in modo molto diverso.

- **Note pubbliche** — il modello `IncidentPublicNote`, servito alle pagine di stato come parte della cronologia dell'incidente. Hanno una data **Pubblicato il** che potete impostare voi e una casella di spunta **Notifica gli iscritti alla pagina di stato**.
- **Note private** — il modello `IncidentInternalNote`. Nulla nell'app della pagina di stato le legge. Non hanno un campo di pubblicazione (l'elenco è marcato e ordinato per `createdAt`) né alcun campo relativo agli iscritti, quindi una nota privata non può mai far scattare una notifica agli iscritti.

**Che cosa significa davvero "privata".** Significa "non pubblicata sulla pagina di stato", non "riservata a un gruppo più ristretto di persone". I due tipi di nota condividono gli stessi permessi di lettura, quindi chiunque possa leggere l'incidente può leggerne le note private. Se dovete limitare chi può vedere l'incidente in sé, usate il flag **Incidente privato** (`isPrivate`) sull'incidente, che lo nasconde da ogni pagina di stato e lo riserva agli utenti proprietari dell'incidente, ai membri dei suoi team proprietari e agli amministratori e proprietari del progetto.

**I proprietari vedono entrambe.** Il job di notifica ai proprietari interroga insieme note pubbliche e private. Una nota privata è privata rispetto ai vostri iscritti, non rispetto a chi sta rispondendo.

| Se volete…                                             | Scegliete        |
| ------------------------------------------------------ | ---------------- |
| Dire ai clienti che cosa sapete e quando saprete di più | **Nota pubblica**  |
| Retrodatare un aggiornamento già inviato altrove       | **Nota pubblica**  |
| Annotare un'ipotesi, un comando eseguito o un vicolo cieco | **Nota privata** |
| Allegare un heap dump o lo screenshot di una dashboard interna | **Nota privata** |

## Pubblicare una nota pubblica

Aprite **Note → Note pubbliche** nel menu laterale dell'incidente e create una nota. La scheda spiega che quello che scrivete qui comparirà sulla pagina di stato; lo stato vuoto dice che finora non è stata creata alcuna nota pubblica per questo incidente.

| Campo                              | A cosa serve                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Nota pubblica dell'incidente**           | Il corpo, in Markdown. Obbligatorio. Il modulo vi ricorda che la nota è visibile sulla vostra pagina di stato e rimanda a un riepilogo. |
| **Allegati**                    | File condivisi con gli iscritti sulla pagina di stato. Facoltativo.                                                           |
| **Notifica gli iscritti alla pagina di stato** | Casella di spunta, attiva per impostazione predefinita. Disattivatela per pubblicare in silenzio.                                                              |
| **Pubblicato il**                      | Data e ora obbligatorie, preimpostate a ora, mostrate nel vostro fuso orario attuale.                                            |

**Pubblicato il è il vero timestamp della nota.** Le pagine di stato ordinano e mostrano le note pubbliche per `postedAt`, non per il momento in cui le avete digitate — quindi se state aggiornando la pagina di stato con una comunicazione inviata 40 minuti fa, impostate **Pubblicato il** su quando è successo davvero. Se una nota arriva dall'API senza questo campo, OneUptime vi imprime l'ora corrente.

L'elenco mostra chi ha scritto ogni nota, il suo **Pubblicato il**, il Markdown reso con i suoi allegati e una colonna **Stato notifica iscritto**. Potete filtrare per **Creato da**, **Nota** e **Creato il**.

## Pubblicare una nota privata

**Note → Note private** è volutamente più spartana. Ci sono solo due campi:

- **Nota privata dell'incidente** — corpo in Markdown, obbligatorio. Il modulo dice esplicitamente che è privata per il vostro team e non è visibile sulla pagina di stato.
- **Allegati** — file destinati al team che risponde all'incidente.

Niente **Pubblicato il**, niente casella per gli iscritti: la nota viene marcata al momento della creazione.

## Allegati sulle note

Entrambi i tipi di nota accettano file allegati tramite un campo **Allegati**, ed entrambi mostrano l'elenco degli allegati sotto il corpo della nota, con un collegamento **Download attachment** per ciascun file.

La differenza sta in chi può scaricare il file:

- **Gli allegati delle note pubbliche** sono scaricabili dai visitatori della pagina di stato tramite una rotta della pagina di stato, insieme alla nota stessa.
- **Gli allegati delle note private** sono raggiungibili solo tramite l'API autenticata della dashboard. Per loro non esiste alcuna rotta sulla pagina di stato.

Gli allegati sono quindi la stessa scelta pubblico/privato del testo della nota. L'immagine per la cronologia rivolta ai clienti va su una nota pubblica; un dump di configurazione va su una privata.

## Generare una nota con l'IA

Entrambe le pagine delle note hanno un pulsante **Generate with AI**. Invia l'incidente al provider di IA del vostro progetto e riversa il Markdown generato nell'editor della nota, dove lo modificate prima di salvare — nulla viene pubblicato in automatico.

- **Generate Public Note with AI** — descritto come analisi dei dati dell'incidente per produrre una nota rivolta ai clienti. Tra i modelli ci sono **Status Update** e **Resolution Notice**.
- **Generate Private Note with AI** — produce invece una nota tecnica interna. Tra i modelli ci sono **Investigation Update** e **Technical Analysis**.

Dietro il pulsante, la dashboard invia una POST a `/incident/generate-note-from-ai/{incidentId}` con il modello scelto e un tipo di nota `public` o `internal`.

## Modelli di note

Se il vostro team scrive gli stessi tre aggiornamenti a ogni disservizio, salvateli una volta sola. Entrambe le pagine delle note hanno un pulsante **Crea da modello** che apre un selettore **Crea nota da modello** con un menu a discesa **Seleziona modello di nota**.

I modelli sono condivisi tra note pubbliche e private: un unico elenco di modelli serve entrambe, e lo stesso modello può essere inserito in una nota dell'uno o dell'altro tipo.

Li gestite in **Incidenti → Impostazioni → Modelli di note** — la scheda si intitola **Modelli di nota pubblica o privata per gli incidenti** e il suo modulo ha un passaggio **Informazioni del modello** (**Nome del modello** e **Descrizione del modello**, entrambi obbligatori) e un passaggio **Dettagli della nota** per il corpo. Se fate clic su **Crea da modello** prima di averne creato uno, OneUptime vi dice che non ne esistono; notate che il messaggio rimanda a Impostazioni del progetto, ma la pagina si trova in realtà sotto **Incidenti → Impostazioni → Modelli di note**.

## Pubblicare note da Slack o Microsoft Teams

Se avete collegato un'area di lavoro, chi risponde non deve mai lasciare il canale. Sia Slack sia Microsoft Teams espongono un'azione di aggiunta nota che apre una finestra con un menu a discesa che propone **Nota pubblica** o **Nota privata** più una casella di testo, e scrive il risultato direttamente sull'incidente.

Due dettagli utili da conoscere:

- **Protezione dai duplicati** — ogni nota registra il messaggio Slack da cui proviene (`postedFromSlackMessageId`, nel formato `channel_id:message_ts`), così se in più persone reagite allo stesso messaggio ne esce una nota sola, non cinque.
- **Le note tornano indietro** — pubblicare una nota di entrambi i tipi invia anche un messaggio nel canale dell'incidente collegato, perché la voce di feed della nota viene creata con la notifica all'area di lavoro attiva.

## Quando una nota pubblica raggiunge davvero gli iscritti

Creare una nota pubblica con **Notifica gli iscritti alla pagina di stato** attiva non garantisce da solo che parta un'e-mail. La nota deve superare una catena di controlli, e ogni mancato superamento registra un motivo preciso invece di generare un errore:

1. **Notifica gli iscritti alla pagina di stato** deve essere attiva. Se non lo è, la nota viene marcata come saltata nel momento stesso in cui viene creata.
2. La nota deve appartenere a un incidente che esiste ancora.
3. L'incidente deve avere almeno un monitor collegato — senza monitor non c'è alcuna risorsa della pagina di stato a cui indirizzare la nota.
4. Il flag **Visibile sulla pagina di stato** (`isVisibleOnStatusPage`) dell'incidente deve essere vero.
5. Ogni pagina di stato raggiunta dall'incidente deve avere **Mostra incidenti** (`showIncidentsOnStatusPage`) attivo.
6. Ogni iscritto deve superare le proprie preferenze — non essersi disiscritto ed essere iscritto a questa risorsa e al tipo di evento `Incident`, dove la pagina lascia scegliere agli iscritti.

**Le notifiche non sono istantanee.** Il job che le invia gira una volta al minuto, quindi aspettatevi fino a circa un minuto tra il salvataggio della nota e la partenza della posta. È questo che significa l'etichetta **Sending Soon**.

La colonna **Stato notifica iscritto** segue l'intero percorso:

| Stato                        | Che cosa significa                                     |
| ---------------------------- | ------------------------------------------------------ |
| **Notifications skipped.**   | Uno dei filtri qui sopra si è chiuso. Il motivo viene registrato. |
| **Sending Soon**             | In coda, in attesa della prossima esecuzione del job di invio.      |
| **Notifications Being Sent** | Il job sta scorrendo l'elenco degli iscritti.        |
| **Notifiche inviate**       | Tutte le notifiche agli iscritti sono partite.        |
| **Non riuscito**                   | Il job ha generato un errore, che viene salvato con la nota.      |

Fate clic su **maggiori dettagli** accanto allo stato per aprire **Dettagli dello stato della notifica**. Dove un nuovo invio ha senso, il pulsante di quella finestra è **Retry**, che riporta la nota in stato di attesa così la prossima esecuzione la riprende.

Il messaggio che gli iscritti ricevono è modellato per pagina di stato e per canale — e-mail, SMS, Slack e Microsoft Teams hanno ciascuno il proprio modello per l'evento **Subscriber Incident Note Created**, con variabili per nome e URL della pagina di stato, il collegamento ai dettagli, le risorse interessate, la gravità e il titolo dell'incidente, il corpo della nota e un collegamento di disiscrizione per ogni iscritto. Vedete [Iscritti e annunci](/docs/status-pages/subscribers) per sapere come si configurano quei modelli e quei canali.

## Il feed dell'incidente

La scheda **Incidente Feed** sta in fondo alla colonna sinistra nella pagina **Panoramica** dell'incidente. È la storia dell'incidente in ordine: ogni voce è un'icona, l'avatar e il nome di chi l'ha causata, un timestamp relativo con l'ora locale esatta al passaggio del mouse e un corpo in Markdown. Le voci sono ordinate dalla più vecchia.

Alcune voci portano dettagli in più — una notifica ai proprietari, per esempio, elenca tutti quelli a cui è stata inviata. Queste mostrano un pulsante **More Information** che apre un pannello **More Information**.

L'intestazione della scheda ha anche un menu **Azioni**, così potete agire senza lasciare la cronologia:

- **Execute Runbook** — avviate un [runbook](/docs/runbooks/index) su questo incidente.
- **Esegui criterio di reperibilità** — chiamate una policy su richiesta.
- **Add Public Note** — gli stessi quattro campi della pagina Note pubbliche, in una finestra.
- **Aggiungi nota privata** — solo corpo della nota e allegati.

Accanto, **Aggiorna** ricarica il feed.

**Il feed è in sola aggiunta, e non è il vostro registro di audit.** L'API consente di creare e leggere le voci di feed, ma non di aggiornarle o eliminarle, quindi nessuno può riscrivere di nascosto la storia di un incidente. Non è però permanente: sulle installazioni a pagamento, le righe di feed più vecchie di tre anni vengono rimosse. Per una traccia duratura di chi ha cambiato cosa, usate **Audit → Registri di audit** nel menu laterale dell'incidente.

## Che cosa registra il feed

Le voci di feed vengono scritte dal servizio degli incidenti stesso, da entrambi i servizi delle note, dalla cronologia di stato, dalle modifiche a proprietari e membri, dai motori di regole, dall'esecuzione delle policy di reperibilità, dai motori di indagine e post-mortem con IA e dai job cron delle notifiche. I tipi di evento coprono:

- **L'incidente stesso** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Note e resoconti** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Le persone** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Le notifiche** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **L'automazione** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Ogni tipo ha la propria icona, così potete scorrere un feed lungo e distinguere i cambi di stato dal rumore di fondo. L'analisi della causa principale generata dall'IA è contrassegnata in modo distinto e resa in una modalità Markdown limitata.

I feed rispettano la privacy dell'incidente: per gli incidenti privati, le letture del feed sono filtrate allo stesso modo dell'incidente.

## Proprietari

I proprietari sono le persone e i team responsabili di un incidente. Sono il bersaglio delle notifiche per tutto quello che gli succede — e sono il motivo per cui un incidente non passa inosservato mentre ognuno dà per scontato che se ne stia occupando qualcun altro.

Aprite **Team → Proprietari** nel menu laterale dell'incidente. La scheda **Proprietari** mostra un badge con il conteggio e descrive i proprietari come le persone e i team responsabili di questo incidente che vengono avvisati delle modifiche, con un conteggio corrente tipo "2 persone · 1 team". I proprietari compaiono come avatar sovrapposti; passandoci sopra vedete l'e-mail della persona oppure l'indicazione **Team**.

- Fate clic su **Aggiungi proprietario** per aprire un selettore con una casella di ricerca per persone o team.
- Fate clic sul comando di rimozione su un avatar per aprire la conferma **Rimuovi proprietario**, poi su **Rimuovi**.
- Se non ci sono ancora proprietari, la scheda ve lo dice e vi invita ad aggiungere un collega o un team perché vengano avvisati delle modifiche.

Utenti proprietari e team proprietari sono record separati: aggiungere un team rende proprietario ogni suo membro ai fini delle notifiche, senza elencarli uno per uno.

## Come vengono assegnati i proprietari

Ci sono quattro strade per finire nell'elenco dei proprietari:

- **Da un modello di incidente** — i modelli hanno i campi **Proprietario - Team** e **Proprietario - Utenti**, descritti come i team e gli utenti proprietari dell'incidente che verranno avvisati quando viene creato o aggiornato. Creare un incidente dal modello li precompila. Vedete [Dichiarare un incidente](/docs/incidents/declaring-incidents).
- **Dalle regole dei proprietari degli incidenti** — le regole corrispondenti aggiungono proprietari in automatico al momento della creazione.
- **Alla creazione tramite API** — gli utenti e i team proprietari passati con la chiamata di creazione vengono aggiunti subito, con un flag che decide se ricevono l'e-mail "sei stato aggiunto".
- **A mano** — il comando **Aggiungi proprietario** nella pagina **Proprietari**, in qualsiasi momento durante l'incidente.

Aggiungere due volte la stessa persona non fa danni: i proprietari già assegnati non vengono duplicati.

## Regole dei proprietari degli incidenti

Le **Regole dei proprietari degli incidenti** assegnano in automatico utenti e team proprietari quando vengono creati incidenti corrispondenti — sono lo strato di instradamento grazie a cui un incidente sul database finisce al team database senza che nessuno debba pensarci. Le trovate insieme al resto dell'automazione degli incidenti, trattata in [Impostazioni e automazione degli incidenti](/docs/incidents/settings).

Il modulo della regola ha tre passaggi — **Informazioni di base**, **Criteri di corrispondenza** e **Proprietari** — e il passaggio dei proprietari contiene due sezioni:

- **Proprietari da assegnare** — scegliete **Team proprietari** e **Utenti proprietari**. Quando la regola corrisponde, ogni utente e team selezionato viene aggiunto come proprietario, e i proprietari già assegnati non vengono duplicati.
- **Eredita proprietari** — assegnate i proprietari a partire da entità collegate invece di nominarli. **Inherit Owners From Monitors** rende ogni proprietario dei monitor dell'incidente proprietario dell'incidente, e **Inherit Owners From Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** e **… From Services** fanno lo stesso per quelle risorse.

Un interruttore **Notifica ai proprietari** decide se le persone lo vengono a sapere. Lasciatelo attivo per l'instradamento vero; disattivatelo per aggiungere proprietari in silenzio — utile quando una regola serve a tenere l'ordine e non a chiamare qualcuno.

Ogni esecuzione di una regola viene scritta nel feed dell'incidente, così potete sempre capire se una persona è stata aggiunta da una regola o da un essere umano.

## Di che cosa vengono avvisati i proprietari

Cinque job avvisano i proprietari, ciascuno in esecuzione una volta al minuto:

- **Incidente creato** — oggetto `[New Incident {number}] - {title}`.
- **È stata pubblicata una nota** — per le note pubbliche *e* private, oggetto `[Update Incident {number}] - {title}`.
- **L'incidente ha cambiato stato** — vedete [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).
- **Siete stati aggiunti come proprietari** — oggetto `You have been added as the owner of Incident {number} - {title}`.
- **Ancora non risolto** — un promemoria guidato dall'ora del prossimo sollecito dell'incidente, oggetto `[Reminder] Incident {number} is still {state} - {title}`.

Ogni notifica viene preparata per e-mail, SMS, chiamata vocale, push e WhatsApp e passata alle impostazioni di notifica dell'utente, che decidono che cosa viene inviato davvero. Ogni destinatario può disattivarle singolarmente — le impostazioni per utente parlano di invio delle notifiche di incidente creato, nota pubblicata, stato cambiato, proprietario aggiunto, membro assegnato e promemoria per gli incidenti ancora aperti. Chi vuole una chiamata solo per i cambi di stato può avere esattamente quello.

**Gli incidenti senza proprietari non restano in silenzio.** Se un incidente non ha alcun proprietario, i job di notifica ripiegano sui proprietari del progetto, così nulla cade nel vuoto. Ogni persona avvisata viene anche aggiunta alla voce di feed corrispondente, così dopo potete vedere esattamente chi è stato informato e a quale indirizzo.

## Dove leggere ora

- [Panoramica degli incidenti](/docs/incidents/index) — che cos'è un incidente e come si incastrano i pezzi.
- [Dichiarare un incidente](/docs/incidents/declaring-incidents) — creare incidenti a mano, da modelli e dai monitor.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — la macchina a stati che guida metà del feed.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings) — regole dei proprietari, modelli di note e il resto dell'automazione.
- [Iscritti e annunci](/docs/status-pages/subscribers) — dove finiscono le note pubbliche e chi le riceve.
- [Panoramica delle pagine di stato](/docs/status-pages/index) — il lato dell'incidente rivolto ai clienti.
