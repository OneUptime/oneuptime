# Panoramica degli incidenti

Un incidente in OneUptime è il documento attorno a cui il vostro team si raduna quando qualcosa si rompe. Porta con sé un numero, un titolo, una gravità, uno stato attuale, le risorse che colpisce e tutto ciò che il vostro team mette per iscritto mentre risponde — note, causa principale, passaggi di rimedio e un feed di attività in sola aggiunta che registra chi ha fatto cosa.

Gli incidenti sono ciò che trasforma un monitor diventato rosso in una risposta coordinata. Dichiararne uno chiama la rotazione di reperibilità giusta, aggiunge proprietari che vengono avvisati a ogni modifica, avvia i runbook e — se lo volete — pubblica il disservizio sulla vostra pagina di stato pubblica, così i clienti smettono di aprire ticket per chiedere se lo sapete già.

Potete dichiarare un incidente a mano alle 3 del mattino, oppure lasciare che sia un monitor a dichiararlo per voi nel momento in cui i suoi criteri corrispondono. In entrambi i casi l'incidente è lo stesso oggetto, con lo stesso ciclo di vita e la stessa traccia scritta alla fine.

## In breve

- **Funzionalità di primo livello** — **Incidenti** nella navigazione a sinistra della dashboard, su `/dashboard/{projectId}/incidents`.
- **Tre stati preimpostati** — **Identified**, **Acknowledged** e **Resolved** vengono creati per ogni nuovo progetto. Potete aggiungerne di vostri; i tre preimpostati si possono rinominare e ricolorare, ma non eliminare.
- **Tre gravità preimpostate** — **Critical Incident**, **Major Incident** e **Minor Incident**. La gravità è un'etichetta con un colore e un ordine: di per sé non comporta alcun comportamento.
- **Quattro modi per crearne uno** — la procedura guidata **Dichiara incidente**, **Crea da modello**, una regola nei criteri di un monitor oppure `POST /api/incident`.
- **Numerati per progetto** — ogni incidente riceve un numero, mostrato come `#42` per impostazione predefinita o con un prefisso vostro, come `INC-42`.
- **Due tipi di nota** — note private (note interne) per il vostro team, note pubbliche per gli iscritti alla pagina di stato.
- **Le impostazioni stanno sotto Incidenti, non sotto Impostazioni del progetto** — stati, gravità, modelli, campi personalizzati e i motori di regole si trovano tutti in **Incidenti → Impostazioni** e **Incidenti → Regole**.

## Termini chiave

Una manciata di parole ricorre in tutte le altre pagine di questa sezione. Chiaritevele subito.

| Termine                | Che cosa significa                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incidente**          | Il documento stesso — titolo, descrizione, gravità, stato attuale, risorse interessate e tutto ciò che vi viene scritto sopra durante la risposta.   |
| **Stato incidente**    | Il punto del ciclo di vita in cui si trova l'incidente. Una riga legata al progetto con nome, colore e `order`, più i flag che le danno significato. |
| **Gravità incidente**  | Quanto è grave. Una riga legata al progetto con nome, colore e `order`. Pura classificazione: nel prodotto nulla tratta una gravità in modo speciale. |
| **Numero incidente**   | Un contatore per progetto mostrato come `#42`, oppure con un prefisso che configurate voi, come `INC-42`.                                            |
| **Risorse interessate** | I monitor, gli host, i cluster Kubernetes, gli host Docker, i servizi e le altre infrastrutture che collegate all'incidente.                         |
| **Nota pubblica**      | Un aggiornamento scritto per chi legge la pagina di stato e per gli iscritti. Compare nella cronologia della pagina di stato.                        |
| **Nota privata**       | Una nota interna (il modello `IncidentInternalNote`) per il team che risponde. Non raggiunge mai una pagina di stato.                                |
| **Proprietario**       | Un utente o un team responsabile dell'incidente. I proprietari vengono avvisati alla creazione, quando si pubblicano note e quando cambia lo stato.  |
| **Incidente Feed**      | La cronologia delle attività in sola aggiunta nella **Panoramica** dell'incidente: cambi di stato, note, modifiche ai proprietari, esecuzioni di regole e notifiche. |
| **Cronologia stato**   | Il resoconto di quale stato ha avuto l'incidente, quando e per quanto — con lo stato di notifica agli iscritti per ogni transizione.                 |

## I tre stati che OneUptime preimposta per ogni progetto

Quando create un progetto, OneUptime preimposta esattamente tre stati di incidente, in quest'ordine:

| Stato            | Ordine | Colore             | Che cosa significa                                                         |
| ---------------- | ----- | ------------------ | ------------------------------------------------------------------------- |
| **Identified**   | 1     | Rosso (`#fd625e`)  | Lo stato in cui atterra un incidente appena nato. È lo stato di creazione. |
| **Acknowledged** | 2     | Giallo (`#ffbf53`) | Qualcuno ha preso in carico l'incidente e ci sta lavorando.                |
| **Resolved**     | 3     | Verde (`#2ab57d`)  | L'incidente è finito. È la risoluzione a toglierlo dalla pagina di stato.  |

I nomi sono soltanto etichette: a guidare il comportamento sono tre booleani sulla riga dello stato — `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Per progetto ci si aspetta che ciascun flag sia portato da un solo stato.

La distinzione conta più di quanto sembri:

- `isCreatedState` decide dove parte un nuovo incidente. Se alla creazione non viene scelto esplicitamente uno stato, OneUptime cerca lo stato di creazione del progetto e usa quello.
- `isAcknowledgedState` e `isResolvedState` governano i pulsanti **Acknowledge** e **Risolvi** nell'intestazione dell'incidente, i due riquadri statistici nella **Panoramica** dell'incidente e il badge con il conteggio **Incidenti attivi** nel menu laterale.
- **Incidenti attivi** è definito puramente come "lo stato attuale non è lo stato risolto". Qualsiasi stato personalizzato che aggiungete è quindi attivo, a meno che non sia quello risolto.

**Attenzione ai nomi.** Il primo stato preimpostato si chiama **Identified**, anche se diverse descrizioni all'interno del prodotto continuano a chiamarlo stato di creazione. Se nell'elenco degli stati del vostro progetto cercate "Created", si tratta della riga chiamata **Identified**.

Potete aggiungere stati vostri in **Incidenti → Impostazioni → Stato incidente**. I nuovi stati vengono accodati in fondo alla lista ordinata e potete trascinarli per riordinarli. I tre stati con i flag non si possono eliminare — OneUptime lo impedisce — ma potete rinominarli e ricolorarli, ed è per questo che l'interfaccia legge i nomi degli stati in modo dinamico.

L'ordine è vincolante, non estetico: un incidente non può passare a uno stato che nell'ordine precede quello attuale.

Tutti i dettagli sono in [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

## Le tre gravità che OneUptime preimposta per ogni progetto

Ogni nuovo progetto riceve anche tre gravità:

| Gravità               | Ordine | Colore              | Che cosa significa                                          |
| --------------------- | ----- | ------------------ | ---------------------------------------------------------- |
| **Critical Incident** | 1     | Bordeaux (`#b70400`) | Impatto altissimo sui clienti, richiede risposta immediata. |
| **Major Incident**    | 2     | Rosso (`#fd625e`)    | Impatto significativo, di norma con risposta immediata.     |
| **Minor Incident**    | 3     | Giallo (`#ffbf53`)   | Impatto basso, di solito gestito in orario di lavoro.       |

Le descrizioni preimpostate complete sono in [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

Le gravità hanno `name`, `description`, `color` e `order`, e nient'altro. Non ci sono flag, e nessun percorso di codice tratta "Critical Incident" diversamente da qualunque altra riga. La gravità è il modo in cui le persone fanno triage ed è disponibile come criterio di corrispondenza quando scrivete regole di reperibilità — ma scegliere una gravità, da sola, non chiama nessuno.

Modificate o aggiungete gravità in **Incidenti → Impostazioni → Gravità incidente**.

## La vita di un incidente

### 1. Viene dichiarato

Quattro strade portano allo stesso oggetto:

- **A mano** — dall'elenco degli incidenti, fate clic su **Dichiara incidente**. Si apre la procedura guidata **Dichiara nuovo incidente**, lunga cinque passaggi: **Dettagli dell'incidente**, **Risorse interessate**, **Ruoli incidente**, **Reperibilità**, **Altro**.
- **Da un modello** — fate clic su **Crea da modello** e scegliete un **Incidente Modello** salvato. I modelli precompilano titolo, descrizione, gravità, stato iniziale, risorse, policy di reperibilità, proprietari ed etichette.
- **Da un monitor** — una regola nei criteri di un monitor con l'interruttore "dichiara un incidente" attivo crea l'incidente in automatico nel momento in cui i filtri corrispondono. Lì titoli e descrizioni supportano i modelli `{{variable}}`.
- **Tramite API** — `POST /api/incident` con una chiave API. Il server compila per voi `declaredAt`, lo stato di creazione e il numero dell'incidente.

Per la panoramica campo per campo, vedete [Dichiarare un incidente](/docs/incidents/declaring-incidents).

### 2. Le persone giuste lo scoprono

Alla creazione OneUptime esegue l'automazione che avete configurato: regole di etichette, di reperibilità, di proprietari e di runbook. Tutte le policy di reperibilità collegate all'incidente — a mano, da un modello o unite da una regola corrispondente — vengono eseguite in parallelo.

I proprietari ricevono notifiche via e-mail, SMS, chiamata, push e WhatsApp, nel rispetto delle preferenze di notifica di ciascun utente. Se un incidente non ha alcun proprietario, la notifica ripiega sui proprietari del progetto invece di andare persa.

Se l'incidente è visibile su una pagina di stato e le notifiche agli iscritti sono attive, anche gli iscritti vengono informati. Le notifiche sono governate da cron ed eseguite ogni minuto, quindi aspettatevi fino a circa un minuto di ritardo, non un invio istantaneo.

### 3. Il team ci lavora

Chi risponde riconosce l'incidente, collega le risorse interessate, esegue i runbook, assegna i ruoli e mette per iscritto quello che scopre — note private per il team, note pubbliche per i clienti, più le pagine **Causa principale** e **Rimedio** quando il quadro si fa più chiaro. Tutto quello che fanno finisce nell'**Incidente Feed** della pagina **Panoramica**.

### 4. Viene risolto

Un clic su **Risolvi** porta l'incidente allo stato risolto, marca la cronologia di stato, ferma il cronometro della durata e toglie l'incidente dalla sezione attiva di ogni pagina di stato su cui compariva. Non serve altro perché accada: la query della pagina di stato guarda proprio il flag dello stato risolto.

Dopodiché potete scrivere un post-mortem e, se volete, pubblicarlo sulla pagina di stato.

## Dove vivono gli incidenti nella dashboard

Aprite **Incidenti** nella navigazione a sinistra. Il suo menu laterale è organizzato in sezioni:

| Sezione            | Che cosa ci fate                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Panoramica**  | **Tutti gli incidenti** e **Incidenti attivi** — quest'ultima porta un badge rosso con il numero di incidenti che non sono nello stato risolto.                            |
| **Episodi**  | Gli episodi di incidente, una funzionalità di raggruppamento a parte con pagine proprie.                                                                                    |
| **IA**        | **Indagine** e **Rimedio** — impostazioni di indagine automatica e di rimedio automatico.                                                                                   |
| **Area di lavoro** | Connessioni **Slack** e **Microsoft Teams** per gli incidenti.                                                                                                          |
| **Regole**     | I motori di regole: **Regole di raggruppamento**, **Regole di reperibilità**, **Regole del proprietario**, **Regole di runbook**, **Regole di privacy**, **Regole etichette**, **Regole SLA**, **Reminder Rules**. |
| **Impostazioni**  | **Stato incidente**, **Gravità incidente**, **Modelli di incidenti**, **Modelli di note**, **Modelli post-mortem**, **Campi personalizzati**, **Ruoli incidente**, **Altre impostazioni**. |

**Regole** e **Impostazioni** sono compresse per impostazione predefinita: espandetele per trovare le pagine a cui il resto di questa documentazione fa riferimento. La configurazione degli incidenti non sta sotto Impostazioni del progetto, sta tutta qui.

L'elenco degli incidenti mostra **Numero dell'incidente**, **Titolo**, **Stato**, **Gravità**, **Risorse interessate**, **Dichiarato**, **Durata**, **Etichette** e **Proprietari**, con un'azione di gruppo **Cambia stato** per chiuderne diversi in una volta.

## Che cosa mostra ogni pagina di un incidente

Aprite un incidente e trovate un menu laterale a sinistra, raggruppato così:

- **Panoramica** — la scheda **Dettagli dell'incidente** (titolo, gravità, etichette, numero, data di dichiarazione, autore, policy di reperibilità), una scheda **Risorse interessate** e l'**Incidente Feed**. Sopra di esse, i riquadri statistici per tempo di riconoscimento, tempo di risoluzione e **Durata** totale.
- **Cronologia stato** — ogni stato attraversato dall'incidente, con **Inizia il**, **Termina il**, **Durata** e lo stato di notifica agli iscritti per ogni transizione. **Visualizza causa** e **Visualizza log** spiegano perché ogni cambiamento è avvenuto.
- **SLA** — il monitoraggio SLA di questo incidente.
- **Descrizione**, **Causa principale**, **Rimedio** — tre pagine in markdown. La descrizione è quella che compare sulla vostra pagina di stato.
- **Runbook** — le esecuzioni di runbook collegate a questo incidente.
- **Post-mortem** — il resoconto, che potete pubblicare sulla pagina di stato.
- **Ruoli**, **Esecuzioni di reperibilità**, **Proprietari** — chi ci sta lavorando, quali policy sono scattate e chi riceve le notifiche.
- **Registri di notifica**, **Registri IA**, **Registri di audit** — che cosa è stato inviato e che cosa è cambiato.
- **Note pubbliche** e **Note private** — sotto la sezione **Note** del menu laterale.
- **Campi personalizzati**, **Impostazioni**, **Elimina incidente** — sotto **Avanzato**. La pagina **Impostazioni** contiene **Visibile sulla pagina di stato**, **Incidente privato** e la scheda **Reminders**.

[Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed) approfondisce le pagine di collaborazione.

## Come si incastrano gli incidenti con il resto di OneUptime

- **I monitor individuano il problema; gli incidenti lo registrano.** Una regola nei criteri di un monitor può dichiarare un incidente in automatico, precompilando titolo, gravità, policy di reperibilità, proprietari, etichette e note di rimedio. Per le variabili disponibili lì, vedete [Modelli di incidenti e avvisi](/docs/monitor/incident-alert-templating).
- **Sono le policy di reperibilità a chiamare le persone.** Collegate le policy nel passaggio **Reperibilità** della procedura di dichiarazione, su un modello, oppure tramite **Incidenti → Regole → Regole di reperibilità**. Scatta ogni regola corrispondente: l'insieme eseguito è l'unione di tutte le corrispondenze più quanto collegato direttamente, senza duplicati.
- **I runbook dicono alle persone cosa fare.** Le regole di runbook collegano una procedura in automatico quando viene creato un incidente corrispondente, e chi risponde può avviarne una a mano dall'incidente. Vedete [Panoramica dei Runbook](/docs/runbooks/index).
- **Le pagine di stato informano i clienti.** Un incidente compare nell'elenco attivo di una pagina di stato quando la pagina ha gli incidenti abilitati, l'incidente è contrassegnato come visibile sulla pagina e il suo stato attuale non è quello risolto. Gli incidenti privati sono sempre nascosti da ogni pagina di stato. Vedete [Panoramica delle pagine di stato](/docs/status-pages/index).
- **I workflow automatizzano intorno a tutto questo.** I trigger **On Create Incident**, **On Update Incident** e **On Delete Incident** vi permettono di costruire automazioni senza codice sul ciclo di vita dell'incidente. Vedete [Panoramica dei workflow](/docs/workflows/index).

## Dove leggere ora

- [Dichiarare un incidente](/docs/incidents/declaring-incidents) — la procedura guidata, i modelli, i criteri dei monitor e l'API.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — i flag di stato, gli stati personalizzati e la classificazione per gravità.
- [Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed) — note pubbliche e private, proprietari e feed delle attività.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings) — modelli, campi personalizzati, prefissi dei numeri e motori di regole.
- [Panoramica delle pagine di stato](/docs/status-pages/index) — come gli incidenti arrivano ai vostri clienti.
- [Iscritti e annunci](/docs/status-pages/subscribers) — chi viene avvisato quando un incidente cambia stato.
