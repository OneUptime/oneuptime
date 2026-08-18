# Note, proprietari e feed

Ogni incidente accumula un registro scritto mentre ci lavorate. Parte di quel registro è per i vostri clienti — l'aggiornamento che esce sulla pagina di stato alle 02:14 dicendo che avete trovato il deploy difettoso. Il resto è per il vostro team — lo stack trace che qualcuno ha incollato, il grafico che finalmente ha avuto senso, la decisione di fare il failover.

OneUptime tiene separati questi due pubblici. Le **Public Notes** vengono pubblicate sulla vostra pagina di stato e possono notificare gli iscritti. Le **Private Notes** (il modello `IncidentInternalNote`) restano all'interno della dashboard. Sotto entrambe si trova l'**Incident Feed**, una cronologia solo in aggiunta che registra tutto ciò che è accaduto all'incidente, e l'elenco **Owners**, che decide chi viene informato.

Tutto questo è accessibile dal menu laterale sinistro dell'incidente: **Notes → Public Notes**, **Notes → Private Notes**, e **Team → Owners**. Il feed si trova nella pagina **Overview** dell'incidente.

## Note pubbliche contro note private

I due tipi di nota sembrano simili nella dashboard ma si comportano in modo molto diverso.

- **Note pubbliche** — il modello `IncidentPublicNote`, servito alle pagine di stato come parte della cronologia dell'incidente. Portano una data **Posted At** che potete impostare voi stessi e una casella di controllo **Notify Status Page Subscribers**.
- **Note private** — il modello `IncidentInternalNote`. Nulla nell'app della pagina di stato le legge. Non hanno un campo posted-at (l'elenco è marcato temporalmente e ordinato per `createdAt`) e nessun campo per gli iscritti, quindi una nota privata non può mai innescare una notifica agli iscritti.

**Cosa significa davvero "private".** Significa "non pubblicata sulla pagina di stato" — non "limitata a un gruppo più piccolo di persone". Entrambi i tipi di nota condividono gli stessi permessi di lettura, quindi chiunque possa leggere l'incidente può leggere le sue note private. Se avete bisogno di limitare chi può vedere del tutto un incidente, usate il flag **Private Incident** (`isPrivate`) sull'incidente stesso, che nasconde l'incidente da ogni pagina di stato e lo limita agli utenti proprietari dell'incidente, ai membri dei suoi team proprietari, e agli amministratori e proprietari del progetto.

**I proprietari vedono entrambe.** Il job di notifica ai proprietari interroga insieme note pubbliche e private. Una nota privata è privata rispetto ai vostri iscritti, non rispetto a chi sta rispondendo.

| Se volete…                                                  | Scegliete         |
| ------------------------------------------------------------ | ----------------- |
| Dire ai clienti cosa sapete e quando saprete di più           | **Public Note**   |
| Retrodatare un aggiornamento che avete già inviato altrove    | **Public Note**   |
| Registrare un'ipotesi, un comando eseguito o un vicolo cieco  | **Private Note**  |
| Allegare un heap dump o uno screenshot di una dashboard interna | **Private Note**  |

## Pubblicare una nota pubblica

Aprite **Notes → Public Notes** nel menu laterale dell'incidente e create una nota. La scheda spiega che ciò che scrivete qui compare sulla pagina di stato; lo stato vuoto dice che finora non sono state create note pubbliche per questo incidente.

| Campo                               | Scopo                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Public Incident Note**             | Il corpo, in Markdown. Obbligatorio. Il modulo ricorda che la nota è visibile sulla vostra pagina di stato e collega un promemoria della sintassi. |
| **Attachments**                      | File condivisi con gli iscritti sulla pagina di stato. Facoltativo.                                                       |
| **Notify Status Page Subscribers**   | Casella di controllo, attiva per impostazione predefinita. Disattivatela per pubblicare in silenzio.                    |
| **Posted At**                        | Data e ora obbligatorie, predefinite a ora, mostrate nel vostro fuso orario attuale.                                     |

**Posted At è la vera marca temporale della nota.** Le pagine di stato ordinano e mostrano le note pubbliche per `postedAt`, non per quando le avete digitate — quindi se state aggiornando la pagina di stato su una notizia che avete inviato 40 minuti fa, impostate **Posted At** al momento in cui è realmente successo. Se una nota arriva tramite l'API senza questo campo, OneUptime marca l'ora corrente.

L'elenco mostra chi ha scritto ogni nota, il suo **Posted At**, il Markdown renderizzato con i suoi allegati, e una colonna **Subscriber Notification Status**. Potete filtrare per **Created By**, **Note** e **Created At**.

## Pubblicare una nota privata

**Notes → Private Notes** è deliberatamente più semplice. Ci sono solo due campi:

- **Private Incident Note** — corpo in Markdown, obbligatorio. Il modulo dichiara apertamente che questo è privato per il vostro team e non è visibile sulla pagina di stato.
- **Attachments** — file destinati al team di risposta agli incidenti.

Nessun **Posted At**, nessuna casella di controllo per gli iscritti — la nota viene marcata temporalmente al momento della creazione.

## Allegati sulle note

Entrambi i tipi di nota accettano allegati tramite un campo **Attachments**, ed entrambi mostrano un elenco di allegati sotto il corpo della nota con un link **Download attachment** per ogni file.

Dove divergono è chi può scaricare il file:

- **Gli allegati delle note pubbliche** sono scaricabili dai visitatori della pagina di stato tramite una rotta della pagina di stato, insieme alla nota stessa.
- **Gli allegati delle note private** sono raggiungibili solo tramite l'API autenticata della dashboard. Non esiste alcuna rotta della pagina di stato per essi.

Questo rende gli allegati la stessa decisione pubblico/privato del testo della nota. Un'immagine di cronologia rivolta al cliente va su una nota pubblica; un dump di configurazione va su una privata.

## Generare una nota con l'IA

Entrambe le pagine delle note portano un pulsante **Generate with AI**. Invia l'incidente al provider IA del vostro progetto e inserisce il Markdown generato nell'editor delle note, dove lo modificate prima di salvare — nulla viene pubblicato automaticamente.

- **Generate Public Note with AI** — descritto come l'analisi dei dati dell'incidente per produrre una nota rivolta al cliente. I modelli includono **Status Update** e **Resolution Notice**.
- **Generate Private Note with AI** — produce invece una nota tecnica interna. I modelli includono **Investigation Update** e **Technical Analysis**.

Dietro il pulsante, la dashboard invia una richiesta a `/incident/generate-note-from-ai/{incidentId}` con il modello scelto e un tipo di nota `public` o `internal`.

## Modelli di nota

Se il vostro team scrive gli stessi tre aggiornamenti a ogni interruzione, salvateli una volta sola. Entrambe le pagine delle note hanno un pulsante **Create from Template** che apre un selettore **Create Note from Template** con un menu a tendina **Select Note Template**.

I modelli sono condivisi tra note pubbliche e private: un unico elenco di modelli serve entrambe, e lo stesso modello può essere inserito in entrambi i tipi di nota.

Li gestite in **Incidents → Settings → Note Templates** — la scheda è intitolata **Public or Private Note Templates for Incidents** e il suo modulo ha un passaggio **Template Info** (**Template Name** e **Template Description**, entrambi obbligatori) e un passaggio **Note Details** per il corpo. Se cliccate su **Create from Template** prima di averne creato uno, OneUptime vi dice che ancora non ne esistono; notate che il messaggio indica Project Settings, ma la pagina in realtà si trova sotto **Incidents → Settings → Note Templates**.

## Pubblicare note da Slack o Microsoft Teams

Se avete collegato uno spazio di lavoro, chi risponde non deve mai lasciare il canale. Sia Slack che Microsoft Teams espongono un'azione per aggiungere una nota che apre una modale con un menu a tendina che offre **Public Note** o **Private Note** più una casella di testo, e scrive il risultato direttamente sull'incidente.

Due dettagli da conoscere:

- **Protezione dai duplicati** — ogni nota registra il messaggio Slack da cui proviene (`postedFromSlackMessageId`, nel formato `channel_id:message_ts`), quindi più persone che reagiscono allo stesso messaggio producono una nota sola, non cinque.
- **Le note fanno eco** — pubblicare uno dei due tipi di nota invia anche un messaggio nel canale dell'incidente collegato, perché la voce del feed della nota viene creata con la notifica allo spazio di lavoro attivata.

## Quando una nota pubblica raggiunge davvero gli iscritti

Creare una nota pubblica con **Notify Status Page Subscribers** attivo non garantisce di per sé che parta un'email. La nota deve superare una catena di controlli, e ogni fallimento registra un motivo specifico invece di generare un errore:

1. **Notify Status Page Subscribers** deve essere attivo. Se non lo è, la nota viene marcata come saltata nel momento in cui viene creata.
2. La nota deve appartenere a un incidente che esiste ancora.
3. L'incidente deve avere almeno un monitor collegato — senza monitor non c'è una risorsa della pagina di stato verso cui instradare la nota.
4. Il flag **Visible on Status Page** (`isVisibleOnStatusPage`) dell'incidente deve essere vero.
5. Ogni pagina di stato raggiunta dall'incidente deve avere **Show Incidents** (`showIncidentsOnStatusPage`) attivato.
6. Ogni iscritto deve superare le proprie preferenze — non disiscritto, e iscritto a questa risorsa e al tipo di evento `Incident` dove la pagina permette agli iscritti di scegliere.

**Le notifiche non sono istantanee.** Il job che le invia viene eseguito una volta al minuto, quindi aspettatevi fino a circa un minuto tra il salvataggio della nota e la partenza della posta. È questo che significa l'etichetta **Sending Soon**.

La colonna **Subscriber Notification Status** traccia l'intero percorso:

| Stato                         | Cosa significa                                             |
| ------------------------------ | ------------------------------------------------------------ |
| **Notifications skipped.**     | Uno dei controlli sopra si è chiuso. Il motivo è registrato. |
| **Sending Soon**               | In coda, in attesa della prossima esecuzione del job di invio. |
| **Notifications Being Sent**   | Il job sta lavorando sull'elenco degli iscritti.              |
| **Notifications Sent**         | Ogni notifica agli iscritti è stata inviata.                  |
| **Failed**                     | Il job ha generato un errore; l'errore è memorizzato con la nota. |

Cliccate su **more details** sullo stato per aprire **Notification Status Details**. Dove ha senso un nuovo invio, il pulsante di quella modale è **Retry**, che rimette la nota in stato di attesa così che la prossima esecuzione la riprenda.

Il messaggio effettivo che ricevono gli iscritti è modellato per pagina di stato e per canale — email, SMS, Slack e Microsoft Teams hanno ciascuno il proprio modello per l'evento **Subscriber Incident Note Created**, con variabili per il nome e l'URL della pagina di stato, il link dei dettagli, le risorse coinvolte, la gravità e il titolo dell'incidente, il corpo della nota, e un link di disiscrizione per ogni iscritto. Vedete [Iscritti e annunci](/docs/status-pages/subscribers) per come sono configurati quei modelli e canali.

## Il feed dell'incidente

La scheda **Incident Feed** si trova in fondo alla colonna sinistra nella pagina **Overview** dell'incidente. È la storia dell'incidente in ordine: ogni elemento è un'icona, l'avatar e il nome di chi lo ha causato, una marca temporale relativa con l'ora locale esatta al passaggio del mouse, e un corpo in Markdown. Gli elementi sono ordinati dal più vecchio.

Alcuni elementi portano dettagli extra — una notifica ai proprietari elenca ad esempio tutti coloro a cui è stata inviata un'email. Questi mostrano un pulsante **More Information** che apre un pannello **More Information**.

L'intestazione della scheda ha anche un menu **Actions** così potete agire senza lasciare la cronologia:

- **Execute Runbook** — avvia un [runbook](/docs/runbooks/index) contro questo incidente.
- **Execute On-Call Policy** — avvisa una policy su richiesta.
- **Add Public Note** — gli stessi quattro campi della pagina Public Notes, in una modale.
- **Add Private Note** — solo corpo della nota e allegati.

Accanto, **Refresh** ricarica il feed.

**Il feed è solo in aggiunta, e non è il vostro registro di controllo.** L'API permette di creare e leggere le voci del feed ma non di modificarle o eliminarle, quindi nessuno può riscrivere silenziosamente la storia di un incidente. Non è nemmeno permanente: sulle installazioni a pagamento, le righe del feed più vecchie di tre anni vengono rimosse. Per un registro duraturo di chi ha cambiato cosa, usate **Audit → Audit Logs** nel menu laterale dell'incidente.

## Cosa registra il feed

Le voci del feed vengono scritte dal servizio degli incidenti stesso, da entrambi i servizi delle note, dalla cronologia degli stati, dalle modifiche di proprietari e membri, dai motori delle regole, dall'esecuzione della reperibilità, dagli esecutori di indagine IA e post mortem, e dai job cron di notifica. I tipi di evento coprono:

- **L'incidente stesso** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Note e resoconti** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Persone** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Notifiche** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automazione** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Ogni tipo ha la propria icona, così potete scorrere un feed lungo e distinguere i cambi di stato dal resto. L'analisi delle cause radice generata dall'IA è contrassegnata in modo distinto e renderizzata in una modalità Markdown limitata.

I feed rispettano la privacy dell'incidente: per gli incidenti privati, le letture del feed sono filtrate allo stesso modo dell'incidente.

## Proprietari

I proprietari sono le persone e i team responsabili di un incidente. Sono il destinatario delle notifiche per tutto ciò che gli accade — e sono il motivo per cui un incidente non passa inosservato mentre tutti pensano che qualcun altro se ne stia occupando.

Aprite **Team → Owners** nel menu laterale dell'incidente. La scheda **Owners** mostra un badge con il conteggio e descrive i proprietari come le persone e i team responsabili di questo incidente che vengono notificati sui cambiamenti, con un conteggio in tempo reale come "2 people · 1 team". I proprietari sono resi come avatar sovrapposti; passando il mouse su uno si mostra l'email della persona o lo contrassegna come **Team**.

- Cliccate su **Add owner** per aprire un selettore con una casella di ricerca per persone o team.
- Cliccate sul controllo di rimozione su un avatar per aprire la conferma **Remove owner**, poi **Remove**.
- Senza ancora proprietari, la scheda lo dice e vi invita ad aggiungere un collega o un team così da essere notificati sui cambiamenti.

Gli utenti proprietari e i team proprietari sono record separati — aggiungere un team rende ogni membro di quel team un proprietario ai fini della notifica senza elencarli individualmente.

## Come vengono assegnati i proprietari

Ci sono quattro percorsi per finire nell'elenco dei proprietari:

- **Da un modello di incidente** — i modelli portano i campi **Owner - Teams** e **Owner - Users**, descritti come i team e gli utenti che possiedono l'incidente e che verranno notificati quando viene creato o aggiornato. Creare un incidente dal modello li precompila. Vedete [Dichiarare un incidente](/docs/incidents/declaring-incidents).
- **Da Incident Owner Rules** — le regole di corrispondenza aggiungono automaticamente proprietari al momento della creazione.
- **Alla creazione tramite l'API** — gli utenti e i team proprietari passati con la chiamata di creazione vengono aggiunti immediatamente, con un flag che controlla se ricevono l'email "sei stato aggiunto".
- **A mano** — il controllo **Add owner** sulla pagina **Owners**, in qualsiasi momento durante l'incidente.

Aggiungere due volte la stessa persona è sicuro; i proprietari già assegnati non vengono duplicati.

## Regole dei proprietari dell'incidente

Le **Incident Owner Rules** assegnano automaticamente utenti e team proprietari quando vengono creati incidenti corrispondenti — lo strato di instradamento che fa sì che un incidente sul database finisca sul team database senza che nessuno ci pensi. Le trovate insieme al resto dell'automazione degli incidenti coperta in [Impostazioni e automazione degli incidenti](/docs/incidents/settings).

Il modulo della regola ha tre passaggi — **Basic Info**, **Match Criteria** e **Owners** — e il passaggio owners contiene due sezioni:

- **Owners to Assign** — scegliete **Owner Teams** e **Owner Users**. Quando la regola corrisponde, ogni utente e team selezionato viene aggiunto come proprietario, e i proprietari già assegnati non vengono duplicati.
- **Inherit Owners** — assegnate proprietari dalle entità correlate invece di nominarli. **Inherit Owners From Monitors** rende ogni proprietario dei monitor dell'incidente un proprietario dell'incidente, e **Inherit Owners From Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** e **… From Services** fanno lo stesso per quelle risorse.

Un interruttore **Notify Owners** controlla se le persone vengono informate. Lasciatelo attivo per l'instradamento reale; disattivatelo per aggiungere proprietari in silenzio — utile quando una regola è una comodità contabile piuttosto che un avviso.

Ogni esecuzione di regola viene scritta nel feed dell'incidente, così potete sempre distinguere se una persona è stata aggiunta da una regola o da un essere umano.

## Cosa viene notificato ai proprietari

Cinque job notificano i proprietari, ciascuno eseguito una volta al minuto:

- **Incidente creato** — oggetto `[New Incident {number}] - {title}`.
- **È stata pubblicata una nota** — sia per note pubbliche *che* private, oggetto `[Update Incident {number}] - {title}`.
- **Lo stato dell'incidente è cambiato** — vedete [Stati e gravità](/docs/incidents/states-and-severities).
- **Siete stati aggiunti come proprietario** — oggetto `You have been added as the owner of Incident {number} - {title}`.
- **Ancora non risolto** — un promemoria guidato dall'orario del prossimo promemoria dell'incidente, oggetto `[Reminder] Incident {number} is still {state} - {title}`.

Ogni notifica viene predisposta per email, SMS, chiamata vocale, push e WhatsApp e consegnata alle impostazioni di notifica dell'utente, che decidono cosa viene effettivamente inviato. Ogni destinatario può disattivare individualmente ciascuna di queste — le impostazioni per utente sono formulate come l'invio delle notifiche di incidente creato, nota pubblicata, stato cambiato, proprietario aggiunto, membro assegnato, e promemoria di ancora aperto. Chi vuole solo una chiamata per i cambi di stato può avere esattamente quello.

**Gli incidenti senza proprietari non sono silenziosi.** Se un incidente non ha alcun proprietario, i job di notifica ricadono sui proprietari del progetto, così nulla viene perso. Ogni persona notificata viene anche aggiunta alla voce del feed corrispondente, così potete vedere in seguito esattamente chi è stato informato e a quale indirizzo.

## Cosa leggere dopo

- [Panoramica degli incidenti](/docs/incidents/index) — cos'è un incidente e come si incastrano le parti.
- [Dichiarare un incidente](/docs/incidents/declaring-incidents) — creare incidenti a mano, da modelli e da monitor.
- [Stati e gravità](/docs/incidents/states-and-severities) — la macchina a stati che guida metà del feed.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings) — regole dei proprietari, modelli di nota e il resto dell'automazione.
- [Iscritti e annunci](/docs/status-pages/subscribers) — dove finiscono le note pubbliche e chi le riceve.
- [Panoramica delle pagine di stato](/docs/status-pages/index) — il lato rivolto al cliente di un incidente.
