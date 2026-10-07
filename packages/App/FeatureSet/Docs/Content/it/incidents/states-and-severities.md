# Stati e gravità

Ogni incidente porta con sé due classificazioni: uno **stato**, che dice a che punto della vostra risposta si trova, e una **gravità**, che dice quanto fa male. Nella dashboard si somigliano — entrambi compaiono come pillole colorate nell'elenco degli incidenti, entrambi sono elenchi legati al progetto che potete rinominare e ricolorare. Ma svolgono lavori molto diversi.

Gli stati guidano il comportamento. Tre flag booleani sulle righe di stato, insieme all'ordine degli stati, decidono quali incidenti contano come attivi, quali pulsanti compaiono nell'intestazione dell'incidente, quando si ferma il cronometro dello SLA e quando l'incidente sparisce dalla vostra pagina di stato. Le gravità, da sole, non guidano nulla: sono etichette che descrivono l'impatto e su cui altre regole possono fare corrispondenza.

Entrambi gli elenchi vengono preimpostati alla creazione del progetto ed entrambi si modificano in **Incidenti → Impostazioni**. Quella sezione del menu laterale di Incidenti è compressa per impostazione predefinita, quindi espandete **Impostazioni** prima di cercarla.

## Gli stati portano comportamento, le gravità portano significato

Il modello `IncidentState` ha `name`, `description`, `color` e `order`, più tre booleani: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Tutto ciò che il prodotto fa con gli stati si basa su quei booleani e su `order` — mai sul nome dello stato. È per questo che potete rinominare **Resolved** in "Chiuso" senza rompere nulla: il flag viaggia con la riga.

Il modello `IncidentSeverity` ha `name`, `description`, `color` e `order`, e nient'altro. Non ci sono flag. In OneUptime nulla tratta **Critical Incident** diversamente da **Minor Incident** di per sé: la gravità conta solo dove siete voi a puntarci qualcosa, come il criterio di corrispondenza **Incidente Gravità** su una regola di reperibilità.

Qualche regola rapida:

- **Scegliete la gravità per comunicare l'impatto** — compare nell'elenco degli incidenti, nella **Panoramica** dell'incidente ed è un campo obbligatorio quando dichiarate un incidente.
- **Scegliete gli stati per modellare il vostro processo** — i passaggi di risposta che attraversate davvero, nell'ordine in cui li attraversate.
- **Non codificate l'urgenza negli stati** — uno stato chiamato "Critico" non chiamerebbe nessuno. A farlo sono la gravità più una regola di reperibilità.

## Gli stati preimpostati

Tre stati vengono creati insieme al progetto, in quest'ordine. La preimpostazione è idempotente: uno stato viene aggiunto solo se non ne esiste già uno con quel nome.

| Stato            | `order` | Flag                  | Colore     | Che cosa significa                                  |
| ---------------- | ------- | --------------------- | --------- | -------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Lo stato in cui atterrano i nuovi incidenti.       |
| **Acknowledged** | `2`     | `isAcknowledgedState` | `#ffbf53` | Qualcuno ha preso in carico l'incidente.           |
| **Resolved**     | `3`     | `isResolvedState`     | `#2ab57d` | L'incidente è finito e smette di contare come attivo. |

Attenzione al nome: il primo stato è **Identified**, anche se diverse descrizioni all'interno del prodotto continuano a chiamarlo stato "di creazione". Quando un documento o un suggerimento parla di "stato di creazione", intende lo stato che porta `isCreatedState` — in un progetto nuovo, **Identified**.

## Che cosa fa davvero ogni flag di stato

| Flag                  | A cosa serve                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Lo stato che un incidente riceve quando nessuno ne ha scelto uno. Se nel progetto nessuno stato porta questo flag, la creazione di un incidente fallisce con un errore che vi chiede di aggiungere uno stato di creazione dalle impostazioni. |
| `isAcknowledgedState` | Contrassegna lo stato di presa in carico del progetto: quello in cui **Acknowledge** porta un incidente e da cui prende il nome il riquadro corrispondente. Un incidente in quello stato, in uno stato successivo o risolto è preso in carico: **Acknowledge** non gli viene più offerto, la reperibilità smette di avvisare per lui e il suo SLA viene marcato come "risposto". |
| `isResolvedState`     | Indica lo stato risolto del progetto: quello in cui **Risolvi** porta l'incidente e che mostra il riquadro statistico del risolto. Un incidente in questo stato, o in qualsiasi stato successivo, è risolto: esce da **Incidenti attivi** e dalla sezione attiva di una pagina di stato, e il suo SLA viene marcato come risolto. |

Per progetto ci si aspetta che ciascun flag sia portato da un solo stato — le ricerche recuperano una riga sola. I tre stati con i flag si possono rinominare, ricolorare e riordinare, ma la pagina delle impostazioni rifiuta di eliminarli e mostra un errore che nomina lo stato di creazione, quello di riconoscimento e quello di risoluzione.

Poiché l'interfaccia legge i nomi degli stati in modo dinamico, rinominare uno stato cambia quello che vedete ovunque: i riquadri statistici, i titoli delle finestre di conferma e la pillola nell'elenco degli incidenti seguono tutti il nome che avete dato alla riga.

## Aggiungere stati vostri

Andate in **Incidenti → Impostazioni → Stato incidente**. La pagina è un elenco ordinato per `order` crescente e un nuovo stato viene aggiunto subito sopra lo stato risolto. Trascinate una riga per cambiarne la posizione.

**Campi di uno stato:**

- **Nome** — obbligatorio, almeno due caratteri. Il segnaposto suggerisce qualcosa come "Investigating".
- **Descrizione** — testo libero facoltativo che spiega quando un incidente si trova in questo stato.
- **Colore** — obbligatorio. Scelto dal selettore di colori; memorizzato come valore esadecimale, tipo `#fd625e`.

Da questo modulo non potete impostare i tre flag: appartengono alle righe preimpostate. Uno stato che aggiungete voi è quindi uno stato senza flag, il che comporta due conseguenze da tenere presenti:

- **Sopra lo stato risolto, tiene l'incidente attivo.** **Incidenti attivi** raccoglie gli incidenti il cui stato attuale sta sopra lo stato risolto, quindi uno stato che aggiungete lì tiene l'incidente nell'elenco attivo e nel conteggio della barra laterale. Uno stato trascinato sotto lo stato risolto conta come risolto ovunque — negli elenchi attivi, sulle pagine di stato, nei promemoria e nello SLA — e spostarvi un incidente da **Resolved** non è una seconda risoluzione.
- **Il suo pulsante di transizione è generico.** Invece di **Acknowledge** o **Risolvi**, la finestra di conferma si intitola **Mark Incident as `<state name>`** con un pulsante di invio **Mark as `<state name>`**.

Una forma ricorrente è inserire un passaggio di triage o di mitigazione tra lo stato di riconoscimento e quello di risoluzione — per esempio, trascinare un nuovo stato "Mitigated" in modo che stia dopo **Acknowledged** e prima di **Resolved**.

## L'ordine è un vincolo reale, non una preferenza di visualizzazione

La colonna `order` viene applicata quando si scrive un cambio di stato, non solo quando si disegna l'elenco:

- **Le transizioni all'indietro vengono rifiutate.** Spostare un incidente a uno stato che nell'ordine precede quello attuale fallisce con un errore che nomina entrambi gli stati.
- **Riselezionare lo stato attuale viene rifiutato.** Impostare un incidente sullo stato in cui si trova già fallisce con "Incident state cannot be same as previous state."
- **Una riga retrodatata non può duplicare la vicina.** Anche inserire una riga di cronologia il cui stato coincide con quello della riga successiva viene rifiutato.
- **I pulsanti dell'intestazione seguono la posizione degli stati con flag nell'ordine.** **Acknowledge** e **Risolvi** vengono proposti in base a dove si trova lo stato attuale nell'elenco ordinato. Uno stato personalizzato collocato *dopo* lo stato risolto non mostrerà mai un pulsante **Risolvi**, perché non c'è più nulla verso cui avanzare.

Quindi, quando aggiungete uno stato, mettetelo dove un incidente ci passerebbe davvero. Ordinarlo male non è solo brutto da vedere: rende impossibili le transizioni.

## Le gravità preimpostate

Tre gravità vengono create insieme al progetto, in quest'ordine:

- **Critical Incident** (`order` 1, `#b70400`) — problemi con impatto altissimo sui clienti, che richiedono una risposta immediata. Un disservizio totale o una violazione dei dati.
- **Major Incident** (`order` 2, `#fd625e`) — impatto significativo, di norma con risposta immediata, a volte con una soluzione temporanea che limita i danni. Un sottosistema importante che smette di funzionare.
- **Minor Incident** (`order` 3, `#ffbf53`) — impatto basso, di solito gestito in orario di lavoro, e difficilmente la maggior parte dei clienti se ne accorge. Un lieve calo delle prestazioni dell'applicazione.

La gravità è obbligatoria quando dichiarate un incidente ed è obbligatoria in ogni specifica di incidente nei criteri di un monitor, quindi ogni incidente — manuale o automatico — arriva con una. Vedete [Dichiarare un incidente](/docs/incidents/declaring-incidents) per il flusso di dichiarazione e [Modelli di incidenti e avvisi](/docs/monitor/incident-alert-templating) per il percorso guidato dai monitor.

## Modificare le gravità

Andate in **Incidenti → Impostazioni → Gravità incidente**. Stessa forma della pagina degli stati: un elenco ordinato per `order`, trascinamento per riordinare, nuove gravità accodate in fondo, con **Nome**, **Descrizione** e **Colore** nel modulo.

Due differenze rispetto agli stati:

- **Non c'è protezione all'eliminazione.** Qualsiasi gravità può essere eliminata, comprese le tre preimpostate.
- **Non ci sono flag da ereditare.** Una nuova gravità si comporta esattamente come quelle preimpostate: è un'etichetta con un colore e una posizione.

**Una nota sui segnaposto.** Il modulo delle gravità riusa parola per parola il testo di esempio del modulo degli stati, quindi i suggerimenti parlano di stati di incidente invece che di gravità. Ignorateli e scrivete nomi e descrizioni vostri.

Dove la gravità fa più che descrivere: in **Incidenti → Regole → Regole di reperibilità**, il campo **Incidente Gravità** di una regola è un criterio di corrispondenza. Elencare lì **Critical Incident** è il modo di esprimere "chiama il team database per qualsiasi cosa critica" — la policy di reperibilità sta sulla regola, non sulla gravità.

## Far avanzare un incidente tra i suoi stati

Ci sono quattro modi in cui un incidente cambia stato:

- **I pulsanti dell'intestazione.** Aprite un incidente. Se il suo stato attuale precede lo stato di riconoscimento, avete **Riconosci** e **Risolvi**; se sta tra i due, avete **Risolvi**. Ognuno apre una breve conferma — **Riconosci incidente** o **Risolvi incidente** — con **Notifica gli iscritti alla pagina di stato** e, ripiegati sotto **Aggiungi una nota pubblica**, il campo facoltativo **Nota pubblica** e il selettore **Seleziona modello di nota** (se il progetto ha modelli di note). Il riconoscimento interrompe anche qualsiasi escalation di reperibilità dell'incidente.
- **La cronologia di stato.** Aggiungete una riga a mano dalla pagina **Cronologia stato** dell'incidente, con **Stato dell'incidente**, **Inizia il** e **Notifica gli iscritti alla pagina di stato**.
- **Il cambio di gruppo.** L'elenco degli incidenti ha un'azione di gruppo **Cambia stato** per spostarne diversi in una volta.
- **In automatico.** Un criterio di monitor con **Risoluzione automatica dell'incidente** attiva risolve il suo incidente quando il criterio non è più soddisfatto, e l'API può aggiornare lo stato tramite `/api/incident-state-timeline`.

Ognuno di questi scrive una riga di cronologia. Un cambio di stato fa anche qualche cosa che non dovete chiedere: pubblica una voce nel feed dell'incidente, assegna un Comandante dell'incidente se l'incidente non ne ha ancora uno e aggiorna il cronometro dello SLA. Riaprire un incidente risolto avvia un nuovo record SLA a partire dal momento della riapertura.

## Cosa fa la presa in carico

Un incidente è preso in carico dal momento in cui passa al vostro stato di presa in carico, a uno stato successivo — uno stato **Investigating** che avete messo sotto **Acknowledged**, per esempio — o a uno stato risolto, con qualunque delle quattro vie qui sopra. La pagina delle impostazioni degli stati mostra quali sono. Una volta preso in carico:

- **Acknowledge non viene più offerto.** Né nell'intestazione dell'incidente, né nell'app mobile (il pulsante e lo swipe), né in Slack o Microsoft Teams, né con `acknowledge_incident` del server MCP di OneUptime. Prenderlo in carico comunque — da un avviso di reperibilità, da Slack o da Teams — viene rifiutato con "Incident is already acknowledged." (o "Incident is already resolved."), invece di riportarlo indietro nella sua lista.
- **La reperibilità smette di avvisare per lui.** Chi conferma il proprio avviso dopo che un collega ha preso in carico l'incidente, o l'ha fatto avanzare, vede il proprio avviso confermato, e l'incidente resta dov'è.
- **Lo SLA viene marcato come risposto** al primo passaggio di questo tipo; proseguire negli stati successivi conserva quell'ora.
- **Il tempo di presa in carico arriva fino a quel primo passaggio** — il riquadro nella **Panoramica** dell'incidente, la metrica **Time to Acknowledge**, una misurazione che termina quando l'incidente viene preso in carico e l'MTTA nei riepiloghi di Slack e Microsoft Teams. Un incidente passato direttamente da **Identified** a **Investigating** è stato preso in carico in quel momento; uno risolto subito lo è stato alla risoluzione.
- **Un filtro Acknowledged** — nel widget elenco incidenti di una dashboard, per esempio — mostra gli incidenti nel vostro stato di presa in carico e in qualsiasi stato successivo, finché non sono risolti.

Avvisi ed episodi seguono la stessa regola con i vostri stati degli avvisi.

## Cosa fa la risoluzione

Un incidente è risolto quando passa da uno stato sopra il vostro stato risolto allo stato risolto, o a qualsiasi stato successivo, con qualunque delle quattro vie qui sopra. Ogni risoluzione:

- **Restituisce i monitor che l'incidente tiene.** Un incidente dichiarato aperto tiene i suoi monitor: li ha messi nel suo stato **Change Monitor Status to**, se ne indica uno, e, se dichiarato a mano, ne ha sospeso il monitoraggio. Una modifica mentre è aperto — aggiungere monitor o cambiare quello stato — glieli fa tenere ugualmente. La risoluzione riprende il loro monitoraggio e li riporta a operativo, a meno che un altro incidente aperto sia ancora su di loro, e da quel momento l'incidente non tiene più nulla. Così un incidente dichiarato già risolto non restituisce nulla, e nemmeno una seconda risoluzione dopo una riapertura: lo stato che i monitor hanno ricevuto nel frattempo — dalle loro sonde, da una manutenzione o impostato a mano — resta.
- **Marca lo SLA come risolto** e, quando le bozze di post-mortem di OneUptime AI sono attive, scrive una bozza di post-mortem.

Passare da **Resolved** a uno stato successivo — **Closed**, per esempio — non è una seconda risoluzione: nulla di tutto questo viene rieseguito e non parte un nuovo SLA. Un incidente dichiarato prima che OneUptime registrasse questo restituisce i suoi monitor alla prossima risoluzione, come sempre.

## La cronologia di stato

La pagina **Cronologia stato** nel menu laterale dell'incidente è la traccia di controllo di ogni stato attraversato. La scheda su quella pagina si intitola **Cronologia di stato** ed è ordinata dal più recente.

**Colonne:**

- **Stato dell'incidente** — una pillola colorata con nome e colore dello stato.
- **Inizia il** — quando l'incidente è entrato in questo stato.
- **Termina il** — quando ne è uscito. Lo stato attuale mostra `Currently Active`.
- **Durata** — tempo trascorso nello stato, conteggiato fino a ora per quello attuale.
- **Stato notifica iscritto** — se la notifica alla pagina di stato per questo cambiamento è stata inviata, saltata o è ancora in attesa, con un collegamento **maggiori dettagli** e — quando l'invio è fallito — un'azione **Retry**.

**Azioni di riga:**

- **Visualizza causa** — apre una finestra **Causa principale** che mostra il markdown registrato con quel cambio di stato.
- **Visualizza log** — apre una finestra che spiega perché lo stato è cambiato, con un visualizzatore **Log dello stato dell'incidente**.

Le righe di cronologia si possono creare ed eliminare, ma non modificare. Eliminare la riga sbagliata riscrive la storia dell'incidente, quindi trattatelo come uno strumento di correzione, non come un'abitudine di pulizia.

## L'elenco Incidenti attivi

**Incidenti → Incidenti attivi** è l'elenco che tenete d'occhio durante un turno. La sua definizione è esattamente una condizione: lo stato attuale dell'incidente sta sopra il vostro stato risolto, il primo stato nell'ordine contrassegnato `isResolvedState`. Nient'altro viene considerato — né la gravità, né l'età, né se qualcuno l'ha riconosciuto.

La voce del menu laterale porta un badge rosso con il conteggio basato sulla stessa query, così badge ed elenco concordano sempre. Quando non c'è nulla da vedere, la pagina ve lo dice.

La conseguenza pratica: uno stato personalizzato che aggiungete sopra lo stato risolto tiene gli incidenti in questo elenco — "Mitigated" non è "finito" — e uno che mettete dopo li toglie, come fa lo stato risolto. Avvisi ed episodi seguono la stessa regola con i propri stati, e la leggono i conteggi del menu laterale, i promemoria, le pagine di stato e l'app mobile.

## Informare gli iscritti alla pagina di stato di un cambio di stato

Un cambio di stato può inviare un'e-mail agli iscritti alla vostra pagina di stato, ma passa attraverso diversi filtri. Capirli vi risparmia parecchie indagini del tipo "perché non è stato avvisato nessuno".

La notifica viene richiesta per ogni riga di cronologia da **Notifica gli iscritti alla pagina di stato** (`shouldStatusPageSubscribersBeNotified`), la casella di spunta nella finestra di cambio stato e nel modulo manuale della cronologia. Quando è disattivata, la riga viene salvata con stato "saltata" e una spiegazione. Quando è attiva, la riga viene messa in coda e la raccoglie un job in background — il job gira ogni minuto, quindi la consegna è rapida ma non istantanea.

**La riga in coda viene poi saltata se vale una qualsiasi di queste condizioni:**

- **Il nuovo stato è lo stato di creazione.** Gli iscritti erano già stati informati alla dichiarazione dell'incidente, quindi la prima riga di cronologia deliberatamente non invia un secondo messaggio.
- **L'incidente non ha monitor collegati.** Senza risorse non c'è nessuna pagina di stato su cui mappare l'incidente.
- **L'incidente non è visibile sulla pagina di stato** (`isVisibleOnStatusPage` è disattivato).
- **La pagina di stato ha gli incidenti disattivati** (`showIncidentsOnStatusPage` è disattivato). Questo vale per singola pagina di stato: le altre pagine che mostrano lo stesso monitor ricevono comunque la notifica.

**Un'altra cosa che cambia l'esito.** Se scrivete una **Nota pubblica** nella finestra di cambio stato, la riga di cronologia viene marcata come già notificata invece che messa in coda. È la nota stessa a raggiungere gli iscritti, quindi ricevono un messaggio invece di due. Quel messaggio nomina il nuovo stato su ogni canale, come avrebbe fatto il messaggio di cambio stato: per esempio `[Resolved Incident] <title>` nell'oggetto dell'email e `**Status:** Resolved` in Slack e Microsoft Teams. Pubblicare la nota richiede il permesso di creare note pubbliche: senza, la finestra non offre la nota, e un cambio di stato inviato con una nota viene rifiutato, quindi lo stato resta com'era. Il tipo di evento dietro il messaggio semplice di cambio stato è `Subscriber Incident State Changed`.

Gli avvisi, gli episodi di avvisi e gli episodi di incidenti offrono invece una nota privata con il cambio di stato (**Aggiungi una nota privata**), e funziona allo stesso modo: pubblicarla richiede il permesso proprio della nota (**Create Alert Internal Note**, **Create Alert Episode Internal Note** o **Create Incident Episode Internal Note** in un ruolo personalizzato; i ruoli predefiniti di avvisi, incidenti e progetto li hanno), e un cambio di stato inviato con una nota privata da chi non ha quel permesso viene rifiutato per intero, quindi lo stato non cambia.

Per sapere chi riceve queste comunicazioni e come vengono scelti i modelli, vedete [Iscritti e annunci](/docs/status-pages/subscribers).

## Tenere un incidente fuori dalla pagina di stato

Tre cose distinte decidono se un incidente compare sulla pagina pubblica, e tutte e tre devono essere vere:

- **Mostra incidenti** (`showIncidentsOnStatusPage`) sulla pagina di stato stessa.
- **Visibile sulla pagina di stato** (`isVisibleOnStatusPage`) sull'incidente — un interruttore nella pagina **Impostazioni** dell'incidente. È attivo per impostazione predefinita e non compare nella procedura guidata di dichiarazione; un criterio di monitor può impostarlo con **Mostra incidente sulla pagina di stato**.
- **Lo stato attuale sta sopra lo stato risolto.** È questo a togliere un incidente dalla sezione attiva: la query della pagina di stato recupera gli incidenti il cui stato attuale sta sopra il vostro stato risolto, quindi lo stato risolto e ogni stato successivo lo tolgono. Non archiviate né chiudete nulla — lo risolvete, e passa nello storico.

**Gli incidenti privati non compaiono mai.** Attivare **Incidente privato** nasconde l'incidente da ogni pagina di stato, a prescindere dagli interruttori qui sopra, e lo limita ai suoi proprietari più gli amministratori e i proprietari del progetto.

Quanto storico risolto conserva la pagina è un'impostazione della pagina di stato, non dell'incidente. Vedete [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups) per capire come i monitor sulla pagina decidono quali incidenti compaiono.

## Dove leggere ora

- [Panoramica degli incidenti](/docs/incidents/index) — come si incastra l'area degli incidenti.
- [Dichiarare un incidente](/docs/incidents/declaring-incidents) — la procedura guidata, i modelli e l'API.
- [Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed) — note pubbliche, note private e feed delle attività.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings) — modelli, campi personalizzati, regole e trigger dei workflow.
- [Iscritti e annunci](/docs/status-pages/subscribers) — chi riceve le e-mail generate da un cambio di stato.
- [Panoramica delle pagine di stato](/docs/status-pages/index) — che cosa mostra una pagina di stato e a chi.
- [Panoramica dei workflow](/docs/workflows/index) — reagire ai cambi di stato con l'automazione.
