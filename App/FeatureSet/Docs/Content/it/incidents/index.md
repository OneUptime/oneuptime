# Panoramica degli incidenti

Un incidente in OneUptime è il record attorno al quale il tuo team si organizza quando qualcosa si rompe. Porta con sé un numero, un titolo, una gravità, uno stato attuale, le risorse che interessa, e tutto ciò che il tuo team annota mentre risponde — note, causa principale, passaggi di rimedio e un feed di attività a sola aggiunta di chi ha fatto cosa.

Gli incidenti sono ciò che trasforma un monitor diventato rosso in una risposta coordinata. Dichiararne uno avvisa la giusta rotazione di reperibilità, aggiunge proprietari che vengono notificati a ogni modifica, avvia i runbook e — se lo desideri — pubblica l'interruzione sulla tua pagina di stato pubblica, così i clienti smettono di aprire ticket per chiedere se sei già a conoscenza del problema.

Puoi dichiarare un incidente manualmente alle 3 del mattino, oppure lasciare che sia un monitor a dichiararlo per te nel momento in cui i suoi criteri corrispondono. In entrambi i casi l'incidente è lo stesso oggetto, con lo stesso ciclo di vita e la stessa documentazione finale.

## In breve

- **Funzionalità di primo livello** — **Incidents** nella navigazione a sinistra della dashboard, all'indirizzo `/dashboard/{projectId}/incidents`.
- **Tre stati preconfigurati** — **Identified**, **Acknowledged** e **Resolved** vengono creati per ogni nuovo progetto. Puoi aggiungerne di tuoi; i tre preconfigurati possono essere rinominati e ricolorati ma mai eliminati.
- **Tre gravità preconfigurate** — **Critical Incident**, **Major Incident** e **Minor Incident**. La gravità è un'etichetta con un colore e un ordine — non porta con sé alcun comportamento proprio.
- **Quattro modi per crearne uno** — la procedura guidata **Declare Incident**, **Create from Template**, una regola di criteri del monitor, oppure `POST /api/incident`.
- **Numerato per progetto** — ogni incidente riceve un numero di incidente, mostrato come `#42` per impostazione predefinita oppure con un prefisso personalizzato, come `INC-42`.
- **Due tipi di note** — note private (note interne) per il tuo team, note pubbliche per gli iscritti alla pagina di stato.
- **Le impostazioni si trovano sotto Incidents, non in Project Settings** — stati, gravità, modelli, campi personalizzati e i motori di regole si trovano tutti in **Incidents → Settings** e **Incidents → Rules**.

## Termini chiave

Una manciata di parole compare in quasi ogni pagina di questa sezione. Chiarisci prima queste.

| Termine                   | Cosa significa                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident**           | Il record stesso — titolo, descrizione, gravità, stato attuale, risorse interessate e tutto ciò che viene scritto su di esso durante la risposta.    |
| **Incident state**     | Dove si trova l'incidente nel suo ciclo di vita. Una riga a livello di progetto con un nome, un colore e un `order`, oltre ai flag che le danno significato. |
| **Incident severity**  | Quanto è grave. Una riga a livello di progetto con un nome, un colore e un `order`. È puramente una classificazione — nulla nel prodotto tratta una gravità in modo speciale. |
| **Incident number**    | Un contatore per progetto mostrato come `#42`, oppure con un prefisso configurato da te, come `INC-42`.                                              |
| **Resources affected** | I monitor, host, cluster Kubernetes, host Docker, servizi e altre infrastrutture che colleghi all'incidente.                                         |
| **Public note**        | Un aggiornamento scritto per i lettori e gli iscritti alla pagina di stato. Viene mostrato nella timeline della pagina di stato.                     |
| **Private note**       | Una nota interna (il modello `IncidentInternalNote`) per il team che risponde. Non arriva mai a una pagina di stato.                                 |
| **Owner**              | Un utente o un team responsabile dell'incidente. I proprietari vengono notificati alla creazione, quando vengono pubblicate note e quando lo stato cambia. |
| **Incident feed**      | La cronologia delle attività a sola aggiunta nella scheda **Overview** dell'incidente, che registra cambi di stato, note, cambi di proprietario, esecuzioni di regole e notifiche. |
| **State timeline**     | Il registro di quale stato ha avuto l'incidente, quando e per quanto tempo — con lo stato di notifica agli iscritti per ogni transizione.             |

## I tre stati che OneUptime preconfigura per ogni progetto

Quando viene creato un progetto, OneUptime preconfigura esattamente tre stati dell'incidente, in questo ordine:

| Stato            | Ordine | Colore              | Cosa significa                                                            |
| ---------------- | ----- | ------------------ | --------------------------------------------------------------------------- |
| **Identified**   | 1     | Rosso (`#fd625e`)    | Lo stato in cui atterra un incidente appena creato. Questo è lo stato di creazione. |
| **Acknowledged** | 2     | Giallo (`#ffbf53`) | Qualcuno ha preso in carico l'incidente e ci sta lavorando.                |
| **Resolved**     | 3     | Verde (`#2ab57d`)  | L'incidente è terminato. Risolverlo è ciò che lo rimuove dalla tua pagina di stato. |

I nomi sono solo etichette — ciò che effettivamente determina il comportamento sono tre booleani sulla riga dello stato: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Ci si aspetta che solo uno stato per progetto porti ciascun flag.

Questa distinzione conta più di quanto sembri:

- `isCreatedState` decide dove inizia un nuovo incidente. Se non viene selezionato esplicitamente uno stato alla creazione, OneUptime cerca lo stato di creazione del progetto e lo usa.
- `isAcknowledgedState` e `isResolvedState` guidano i pulsanti **Acknowledge** e **Resolve** nell'intestazione dell'incidente, i due riquadri statistici nella scheda **Overview** dell'incidente, e il badge del conteggio **Active Incidents** nel menu laterale.
- **Active Incidents** è definito semplicemente come "lo stato attuale non è lo stato risolto". Qualsiasi stato personalizzato che aggiungi è quindi attivo a meno che non sia quello risolto.

**Nota sul nome.** Il primo stato preconfigurato si chiama **Identified**, anche se diverse descrizioni all'interno del prodotto lo definiscono ancora lo stato di creazione. Se stai cercando "Created" nell'elenco degli stati del tuo progetto, è la riga chiamata **Identified**.

Puoi aggiungere i tuoi stati in **Incidents → Settings → Incident State**. I nuovi stati vengono aggiunti alla fine dell'elenco ordinato e puoi trascinarli per riordinarli. I tre stati contrassegnati non possono essere eliminati — OneUptime lo impedisce — ma puoi rinominarli e ricolorarli, ed è per questo che l'interfaccia legge i nomi degli stati in modo dinamico.

L'ordine è imposto, non è puramente estetico: un incidente non può passare a uno stato che si trova prima, nell'ordine, rispetto a quello attuale.

I dettagli completi si trovano in [Incident States & Severities](/docs/incidents/states-and-severities).

## Le tre gravità che OneUptime preconfigura per ogni progetto

Ogni nuovo progetto riceve anche tre gravità:

| Gravità              | Ordine | Colore              | Cosa significa                                             |
| --------------------- | ----- | ------------------ | ------------------------------------------------------------ |
| **Critical Incident** | 1     | Marrone (`#b70400`) | Impatto sui clienti molto alto, richiede una risposta immediata. |
| **Major Incident**    | 2     | Rosso (`#fd625e`)    | Impatto significativo, di solito richiede una risposta immediata. |
| **Minor Incident**    | 3     | Giallo (`#ffbf53`) | Impatto basso, di solito gestito durante l'orario di lavoro. |

Le descrizioni complete preconfigurate si trovano in [Incident States & Severities](/docs/incidents/states-and-severities).

Le gravità hanno `name`, `description`, `color` e `order` e nient'altro. Non ci sono flag, e nessun percorso di codice tratta "Critical Incident" in modo diverso da qualsiasi altra riga. La gravità è il modo in cui gli esseri umani effettuano il triage, ed è disponibile come criterio di corrispondenza quando scrivi regole di reperibilità — ma scegliere una gravità non avvisa nessuno di per sé.

Modifica o aggiungi gravità in **Incidents → Settings → Incident Severity**.

## La vita di un incidente

### 1. Viene dichiarato

Quattro percorsi portano allo stesso oggetto:

- **Manualmente** — dall'elenco degli incidenti, clicca su **Declare Incident**. Si apre la procedura guidata **Declare New Incident**, lunga cinque passaggi: **Incident Details**, **Resources Affected**, **Incident Roles**, **On-Call**, **More**.
- **Da un modello** — clicca su **Create from Template** e scegli un **Incident Template** salvato. I modelli precompilano titolo, descrizione, gravità, stato iniziale, risorse, politiche di reperibilità, proprietari ed etichette.
- **Da un monitor** — una regola di criteri del monitor con l'opzione "dichiara un incidente" attivata crea l'incidente automaticamente nel momento in cui i suoi filtri corrispondono. Titoli e descrizioni supportano il templating `{{variable}}`.
- **Tramite API** — `POST /api/incident` con una chiave API. Il server compila `declaredAt`, lo stato di creazione e il numero dell'incidente per te.

Consulta [Declaring an Incident](/docs/incidents/declaring-incidents) per il percorso campo per campo.

### 2. Le persone giuste vengono informate

Alla creazione OneUptime esegue l'automazione che hai configurato: regole di etichette, regole di reperibilità, regole di proprietario e regole di runbook. Qualsiasi politica di reperibilità collegata all'incidente — manualmente, da un modello, o unita da una regola di reperibilità corrispondente — viene eseguita in parallelo.

I proprietari vengono notificati via email, SMS, chiamata, notifica push e WhatsApp, in base alle preferenze di notifica di ciascun utente. Se un incidente non ha alcun proprietario, la notifica ricade sui proprietari del progetto anziché essere scartata.

Se l'incidente è visibile su una pagina di stato e le notifiche agli iscritti sono attive, anche gli iscritti vengono informati. Le notifiche sono gestite da un cron e vengono eseguite ogni minuto, quindi aspettati fino a circa un minuto di ritardo anziché un invio istantaneo.

### 3. Il tuo team lo gestisce

I responder riconoscono l'incidente, collegano le risorse interessate, eseguono runbook, assegnano ruoli dell'incidente e annotano ciò che scoprono — note private per il team, note pubbliche per i clienti, oltre alle pagine **Root Cause** e **Remediation** man mano che il quadro si chiarisce. Tutto ciò che fanno finisce nell'**Incident Feed** nella pagina **Overview**.

### 4. Viene risolto

Cliccare su **Resolve** sposta l'incidente nello stato risolto, registra la cronologia degli stati, ferma il conteggio della durata e rimuove l'incidente dalla sezione attiva di qualsiasi pagina di stato su cui era mostrato. Non deve cambiare nient'altro perché questo avvenga — il flag dello stato risolto è ciò che la query della pagina di stato controlla.

Da lì puoi scrivere un post-mortem e, facoltativamente, pubblicarlo sulla pagina di stato.

## Dove si trovano gli incidenti nella dashboard

Apri **Incidents** nella navigazione a sinistra. Il suo menu laterale è organizzato in sezioni:

| Sezione       | Cosa puoi fare lì                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**  | **All Incidents** e **Active Incidents** — quest'ultimo porta un badge rosso con il conteggio degli incidenti che non sono nello stato risolto.                          |
| **Episodes**  | Episodi degli incidenti, una funzionalità di raggruppamento separata con pagine proprie.                                                                                 |
| **AI**        | **Investigation** e **Remediation** — impostazioni di indagine automatica e rimedio automatico.                                                                          |
| **Workspace** | Connessioni **Slack** e **Microsoft Teams** per gli incidenti.                                                                                                            |
| **Rules**     | I motori di regole: **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules**, **Reminder Rules**.    |
| **Settings**  | **Incident State**, **Incident Severity**, **Incident Templates**, **Note Templates**, **Postmortem Templates**, **Custom Fields**, **Incident Roles**, **More Settings**. |

**Rules** e **Settings** sono compressi per impostazione predefinita — espandili per trovare le pagine a cui fa riferimento il resto di questa documentazione. La configurazione degli incidenti non si trova in Project Settings — vive tutta qui.

L'elenco degli incidenti stesso mostra **Incident Number**, **Title**, **State**, **Severity**, **Resources Affected**, **Declared**, **Duration**, **Labels** e **Owners**, con un'azione collettiva **Change State** per chiuderne diversi contemporaneamente.

## Cosa mostra ogni pagina di un incidente

Apri un incidente e ottieni un menu laterale sinistro, raggruppato così:

- **Overview** — la scheda **Incident Details** (titolo, gravità, etichette, numero dell'incidente, data di dichiarazione, dichiarato da, politiche di reperibilità), una scheda **Affected Resources** e l'**Incident Feed**. Sopra di esse, riquadri statistici per il tempo di riconoscimento, il tempo di risoluzione e la **Duration** totale.
- **State Timeline** — ogni stato in cui è stato l'incidente, con **Starts At**, **Ends At**, **Duration** e lo stato di notifica agli iscritti per ogni transizione. **View Cause** e **View Logs** spiegano il motivo di ogni cambiamento.
- **SLA** — tracciamento SLA per questo incidente.
- **Description**, **Root Cause**, **Remediation** — tre pagine in markdown. La descrizione è quella che appare sulla tua pagina di stato.
- **Runbooks** — esecuzioni di runbook collegate a questo incidente.
- **Postmortem** — il resoconto, che puoi facoltativamente pubblicare sulla pagina di stato.
- **Roles**, **On-Call Executions**, **Owners** — chi se ne occupa, quali politiche sono scattate e chi viene notificato.
- **Notification Logs**, **AI Logs**, **Audit Logs** — cosa è stato inviato e cosa è cambiato.
- **Private Notes** e **Public Notes** — sotto la sezione **Notes** del menu laterale.
- **Custom Fields**, **Settings**, **Delete Incident** — sotto **Advanced**. La pagina **Settings** contiene **Visible on Status Page**, **Private Incident** e la scheda **Reminders**.

[Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) tratta in profondità le pagine di collaborazione.

## Come gli incidenti si integrano con il resto di OneUptime

- **I monitor individuano il problema; gli incidenti lo registrano.** Una regola di criteri del monitor può dichiarare automaticamente un incidente, precompilando titolo, gravità, politiche di reperibilità, proprietari, etichette e note di rimedio. Consulta [Incident and Alert Templating](/docs/monitor/incident-alert-templating) per le variabili disponibili lì.
- **Le politiche di reperibilità gestiscono l'avviso.** Collega le politiche nel passaggio **On-Call** della procedura guidata di dichiarazione, su un modello, oppure tramite **Incidents → Rules → On-Call Rules**. Ogni regola corrispondente scatta — l'insieme eseguito è l'unione di tutte le corrispondenze più qualsiasi elemento collegato direttamente, senza duplicati.
- **I runbook dicono alle persone cosa fare.** Le regole di runbook collegano automaticamente una procedura quando viene creato un incidente corrispondente, e i responder possono avviarne una manualmente dall'incidente. Consulta [Runbooks Overview](/docs/runbooks/index).
- **Le pagine di stato informano i clienti.** Un incidente appare nell'elenco attivo di una pagina di stato quando la pagina ha gli incidenti abilitati, l'incidente è contrassegnato come visibile sulla pagina di stato, e il suo stato attuale non è lo stato risolto. Gli incidenti privati sono sempre nascosti da ogni pagina di stato. Consulta [Status Pages Overview](/docs/status-pages/index).
- **I workflow automatizzano attorno ad esso.** I trigger **On Create Incident**, **On Update Incident** e **On Delete Incident** ti permettono di costruire automazioni no-code sopra il ciclo di vita dell'incidente. Consulta [Workflows Overview](/docs/workflows/index).

## Cosa leggere dopo

- [Declaring an Incident](/docs/incidents/declaring-incidents) — la procedura guidata, i modelli, i criteri del monitor e l'API.
- [Incident States & Severities](/docs/incidents/states-and-severities) — i flag di stato, gli stati personalizzati e la classificazione della gravità.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — note pubbliche e private, proprietari e il feed di attività.
- [Incident Settings & Automation](/docs/incidents/settings) — modelli, campi personalizzati, prefissi numerici e i motori di regole.
- [Status Pages Overview](/docs/status-pages/index) — come gli incidenti raggiungono i tuoi clienti.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — chi viene notificato quando un incidente cambia.
