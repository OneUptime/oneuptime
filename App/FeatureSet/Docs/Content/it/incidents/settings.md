# Impostazioni e automazione

La configurazione degli incidenti non risiede in Project Settings. Risiede all'interno dell'area prodotto Incidents stessa, sotto **Incidents → Settings** e **Incidents → Rules**, su percorsi che iniziano con `/dashboard/{projectId}/incidents/settings/`. Se avete cercato in **Project Settings** i modelli di incidente o i campi personalizzati, ecco perché non li avete trovati.

Sia la sezione **Rules** sia la sezione **Settings** del menu laterale di Incidents sono compresse per impostazione predefinita, quindi dovete espanderle prima che gli elementi seguenti appaiano. Tutto qui è vincolato al progetto: modelli, ruoli, campi personalizzati e regole appartengono a un progetto e si applicano a ogni incidente dichiarato al suo interno.

Questa pagina è il riferimento per quella configurazione — cosa contiene ogni pagina e quale parte viene eseguita automaticamente nel momento in cui un incidente viene creato.

## Dove risiedono le impostazioni degli incidenti

Aprite **Incidents** nella navigazione a sinistra, quindi espandete **Settings** in fondo al menu laterale.

| Pagina                   | Cosa fate lì                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| **Incident State**       | Aggiungete, rinominate, ricolorate e riordinate gli stati che un incidente attraversa.          |
| **Incident Severity**    | Aggiungete, rinominate, ricolorate e riordinate i livelli di gravità.                            |
| **Incident Templates**   | Pre-compilate un intero incidente — titolo, descrizione, risorse, policy di reperibilità, proprietari, etichette. |
| **Note Templates**       | Testo riutilizzabile per note pubbliche e private.                                              |
| **Postmortem Templates** | Strutture riutilizzabili per i postmortem.                                                      |
| **Custom Fields**        | Definite campi aggiuntivi che compaiono su ogni incidente.                                      |
| **Incident Roles**       | Definite i ruoli a cui assegnate i responder, come Incident Commander.                          |
| **More Settings**        | I prefissi del numero di incidente e di episodio di incidente.                                  |

**Incident State** e **Incident Severity** sono trattati in dettaglio in [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — il resto di questa pagina riprende da **Incident Templates**.

Espandete **Rules** e ottenete altre otto pagine: **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules** e **Reminder Rules**. Sono trattate più avanti.

## Modelli di incidente

Un modello di incidente è uno scheletro salvato di un incidente. Invece di ridigitare lo stesso titolo, lo stesso elenco di monitor e la stessa policy di reperibilità ogni volta che il cluster dei pagamenti vacilla, lo salvate una volta e dichiarate a partire da esso.

Andate su **Incidents → Settings → Incident Templates** (`/dashboard/{projectId}/incidents/settings/templates`). La scheda si intitola **Incident Templates**. Crearne uno vi guida attraverso una procedura guidata in sei passaggi:

- **Template Info** — **Template Name** e **Template Description**. Questi nominano il modello stesso; non compaiono mai sull'incidente.
- **Incident Details** — **Title**, **Description** (Markdown), **Incident Severity** e **Initial Incident State**. **Initial Incident State** è opzionale e inizia vuoto; le sue opzioni sono elencate nell'ordine degli stati. Lasciatelo vuoto e gli incidenti creati da questo modello finiranno nello stato di creazione del progetto.
- **Resources Affected** — i monitor, host, cluster e servizi a cui l'incidente deve essere collegato, oltre a **Change Monitor Status to**.
- **On-Call** — **On-Call Policy**, le policy da eseguire quando un incidente creato da questo modello viene dichiarato.
- **Owners** — **Owner - Teams** e **Owner - Users**.
- **Labels** — **Labels**.

Alcune regole rapide:

- L'elenco dei modelli mostra solo **Name** e **Description**. Le righe non sono modificabili o eliminabili dall'elenco — aprite un modello (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) per modificarlo.
- I modelli supportano l'importazione ed esportazione JSON, così potete spostarne uno tra progetti.
- Lo stato vuoto mostra "No incident templates found."

### Come viene applicato un modello

Ci sono due percorsi, e si comportano allo stesso modo.

- **Dalla dashboard** — il pulsante **Create from Template** nell'elenco degli incidenti apre un selettore **Select Incident Template**, e la pagina di dichiarazione legge il modello dal parametro di query string `incidentTemplateId`, quindi pre-compila il modulo con il modello più i suoi team proprietari e utenti proprietari.
- **Dall'API** — passate `createdIncidentTemplateId` a `POST /api/incident` e il server compila l'incidente dal modello.

La parte importante è la regola di unione: **un modello compila solo un campo che avete lasciato indefinito**. Titolo, descrizione, gravità dell'incidente, stato iniziale dell'incidente, lo stato del monitor dietro **Change Monitor Status to**, monitor, host, cluster Kubernetes, host Docker, host Podman, servizi, policy di reperibilità ed etichette vengono copiati dal modello solo quando chi chiama o il modulo non ha fornito nulla. Qualsiasi cosa impostiate esplicitamente vince sempre.

**La finestra di dialogo dello stato vuoto punta al posto sbagliato.** Se non avete ancora modelli, il pulsante **Create from Template** mostra una finestra di dialogo **No Incident Templates**. Il suo testo punta a Project Settings, ma il pulsante indirizza a **Incidents → Settings → Incident Templates** — quella è la posizione reale.

## Modelli di nota

I modelli di nota forniscono ai responder testo predefinito per gli aggiornamenti degli incidenti, così un aggiornamento della pagina di stato alle 3 del mattino non viene scritto da zero da qualcuno mezzo addormentato.

Andate su **Incidents → Settings → Note Templates** (`/dashboard/{projectId}/incidents/settings/note-templates`). La scheda si intitola **Public or Private Note Templates for Incidents** — una singola libreria serve entrambi i tipi di nota. Il modulo di creazione ha due passaggi:

- **Template Info** — **Template Name** e **Template Description**, entrambi obbligatori.
- **Note Details** — il corpo della nota stesso, in Markdown, obbligatorio.

Come i modelli di incidente, le righe vengono create e visualizzate anziché modificate in linea; aprite un modello per modificarlo.

I modelli di nota emergono dove ne avete effettivamente bisogno: le finestre di dialogo di conferma **Acknowledge Incident** e **Resolve Incident** offrono entrambe **Select Note Template** accanto al campo **Public Note**. Vedete [Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed) per capire come differiscono le note pubbliche e private.

## Modelli di postmortem

Un modello di postmortem è lo scheletro del resoconto che producete dopo un incidente — le vostre intestazioni, i vostri suggerimenti, le vostre domande ricorrenti — così ogni revisione nel progetto segue la stessa struttura.

Andate su **Incidents → Settings → Postmortem Templates** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). La scheda si intitola **Postmortem Templates**. Il modulo di creazione ha due passaggi:

- **Template Info** — **Template Name** e **Template Description**, entrambi obbligatori.
- **Postmortem Details** — **Postmortem Template**, il corpo stesso, in Markdown, obbligatorio.

Ne applicate uno dall'incidente, non dalle impostazioni. Aprite un incidente, scegliete **Postmortem** nel suo menu laterale (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), e usate **Apply Template**. Questo apre una finestra di dialogo **Apply Postmortem Template** con un menu a discesa **Select Template**; sceglierne uno carica il corpo del modello nell'editor **Postmortem Note**, dove lo modificate prima di salvare. Gli episodi di incidente hanno la stessa pagina **Postmortem** e attingono dalla stessa libreria di modelli.

## Campi personalizzati

I campi personalizzati vi permettono di trasportare i vostri metadati su ogni incidente — un nome di servizio interno, un riferimento a un ticket di modifica, un livello cliente.

Andate su **Incidents → Settings → Custom Fields** (`/dashboard/{projectId}/incidents/settings/custom-fields`). La pagina si intitola **Incident Custom Fields**. Ogni definizione ha:

- **Field Name** — obbligatorio, almeno due caratteri. Il segnaposto suggerisce un nome simile a uno slug, come `internal-service`.
- **Field Description** — opzionale.
- **Field Type** — obbligatorio. Sceglie come vengono inseriti i dati. I tipi a discesa richiedono anche l'elenco delle loro opzioni.
- **Dropdown Options** — i valori che compaiono nel menu a discesa, ciascuno con un colore opzionale.

Le definizioni risiedono nel proprio modello; i valori risiedono sull'incidente stesso nella colonna `customFields`. Su un singolo incidente li compilate da **Custom Fields** nel menu laterale dell'incidente (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Una lacuna da conoscere.** Le definizioni dei campi personalizzati degli incidenti sono l'unica parte della famiglia di incidenti senza trigger di workflow — vedete la sezione sui workflow più avanti.

## Ruoli incidente

I ruoli incidente sono i lavori nominati a cui assegnate le persone durante una risposta. Definiteli su **Incidents → Settings → Incident Roles** (`/dashboard/{projectId}/incidents/settings/roles`); la descrizione della scheda fornisce Incident Commander e Responder come esempi.

I ruoli sono solo definizioni. Assegnate le persone ad essi per ogni incidente — la procedura guidata di dichiarazione ha un passaggio **Incident Roles** con un campo **Assign Incident Roles**, e ogni incidente ha una pagina **Roles** nel suo menu laterale.

## Prefissi numerici

Ogni incidente riceve un numero. Per impostazione predefinita viene reso come `#42`. Se il vostro team dice ad alta voce "INC-42", fate in modo che anche il prodotto lo dica.

Andate su **Incidents → Settings → More Settings** (`/dashboard/{projectId}/incidents/settings/more`). La scheda è **Number Prefix** e contiene due campi sul progetto:

- **Incident Number Prefix** — fino a 20 caratteri, segnaposto `INC-`. Impostatelo e l'incidente `#42` viene visualizzato come `INC-42`.
- **Incident Episode Number Prefix** — la stessa idea per i numeri di episodio di incidente, segnaposto `IE-`.

Lasciate uno dei due vuoto per mantenere il prefisso predefinito `#`; il campo non impostato mostra `# (default)`. Salvate con **Update**. Il valore con prefisso viene memorizzato sull'incidente come `incidentNumberWithPrefix`, che è ciò che l'elenco degli incidenti e l'intestazione dell'incidente rendono.

## Regole eseguite alla creazione di un incidente

**Incidents → Rules** contiene otto motori di regole. Svolgono tutti lo stesso compito — osservano un incidente nel momento in cui viene creato, e agiscono se corrisponde — ma differiscono in cosa fanno e in come si risolvono più regole corrispondenti.

- **Grouping Rules** — raggruppano incidenti correlati in episodi. Le regole vengono valutate in ordine di priorità; i numeri di priorità più bassi vanno per primi.
- **On-Call Rules** — eseguono policy di turno di reperibilità per gli incidenti corrispondenti. Trattate in dettaglio più avanti.
- **Owner Rules** — assegnano automaticamente i proprietari.
- **Runbook Rules** — avviano un [runbook](/docs/runbooks/index) quando un incidente corrisponde.
- **Privacy Rules** — decidono se un incidente corrispondente è privato.
- **Label Rules** — applicano etichette automaticamente.
- **SLA Rules** — tracciano i tempi di risposta e risoluzione. Le regole vengono valutate in ordine; i numeri d'ordine più bassi vanno per primi.
- **Reminder Rules** — ricordano periodicamente ai proprietari dell'incidente mentre un incidente è ancora aperto. Le regole vengono valutate in ordine e la prima regola corrispondente vince.

**La semantica dell'ordine non è uniforme.** Grouping Rules, SLA Rules e Reminder Rules sono valutate in ordine. On-Call Rules non lo sono — ogni regola corrispondente si attiva. Non date per scontato che un modello si applichi a tutte e otto.

Le pagine **On-Call Rules**, **Owner Rules**, **Label Rules** e **Privacy Rules** sono suddivise in schede — una scheda **Incident Rules** e una scheda **Episode Rules**, ciascuna con la propria tabella. Configurate la scheda **Incident Rules** a meno che non intendiate specificamente gli episodi. **Grouping Rules**, **Runbook Rules**, **SLA Rules** e **Reminder Rules** sono tabelle singole.

## Regole di reperibilità per gli incidenti

**Incidents → Rules → On-Call Rules** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) è dove rendete automatico il paging. La scheda, **Incident On-Call Rules**, descrive regole che eseguono automaticamente policy di turno di reperibilità quando vengono creati incidenti corrispondenti. La pagina ha due schede: **Incident Rules** ed **Episode Rules**.

Il modulo di creazione ha tre passaggi:

- **Basic Info** — **Name** (il segnaposto suggerisce qualcosa come pagare il team database per qualsiasi incidente DB), **Description**, e un interruttore **Enabled**. L'elenco mostra una pillola verde **Enabled** o rossa **Disabled** per regola.
- **Match Criteria** — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels**, oltre a campi con espressioni regolari senza distinzione tra maiuscole e minuscole per il titolo dell'incidente, la descrizione dell'incidente, il nome del monitor e la descrizione del monitor.
- **On-Call Policies** — le policy che questa regola esegue.

### Come si risolve la corrispondenza

Le regole con cui la pagina viene fornita di default sono utili da interiorizzare:

- Una regola corrisponde solo quando **tutti** i criteri che avete compilato passano. I criteri lasciati vuoti vengono saltati, non falliti.
- All'interno di un singolo criterio a elenco — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels** — la corrispondenza è di tipo any-of.
- I campi con pattern sono espressioni regolari senza distinzione tra maiuscole e minuscole.
- **Tutte le regole corrispondenti si attivano.** Non c'è priorità né interruzione anticipata.
- L'insieme di policy che effettivamente viene eseguito è l'unione delle policy di ogni regola corrispondente più eventuali policy allegate all'incidente manualmente o da un modello, deduplicate in modo che ogni policy venga eseguita al massimo una volta.

La gravità è un criterio di corrispondenza qui e da nessun'altra parte. Non esiste un campo di reperibilità su una gravità di incidente — selezionare "Critical Incident" non fa scattare, di per sé, il paging di nessuno. Se volete che la gravità guidi il paging, scrivete una regola di reperibilità che corrisponda su di essa.

## Collegare policy di reperibilità direttamente

Le regole non sono l'unico percorso. Ogni incidente porta con sé un proprio elenco di policy di reperibilità, esposto come campo **On-Call Policy** nel passaggio **On-Call** della procedura guidata di dichiarazione e nel passaggio **On-Call** di un modello di incidente. La descrizione del campo lo dice chiaramente: queste sono le policy di turno di reperibilità da eseguire quando questo incidente viene creato.

Quando un incidente viene creato, OneUptime esegue le regole delle etichette, poi le regole di reperibilità (che uniscono le loro policy corrispondenti all'elenco dell'incidente), poi le regole runbook — e se l'elenco risultante non è vuoto, ogni policy al suo interno viene eseguita. Le esecuzioni vengono eseguite in parallelo e si risolvono in modo indipendente, quindi il fallimento di una policy non ferma le altre. Ogni esecuzione è contrassegnata con l'incidente che l'ha attivata e con il tipo di evento di notifica di creazione incidente.

Per vedere cosa è successo, aprite l'incidente e scegliete **On-Call Executions** nel suo menu laterale (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Guidare gli incidenti dai workflow

I trigger dei workflow per gli incidenti non sono scritti a mano — OneUptime li genera dai modelli di dati, quindi ogni modello della famiglia incidenti ottiene componenti **On Create X**, **On Update X** e **On Delete X**, denominati dal nome singolare del modello. I tre principali sono **On Create Incident**, **On Update Incident** e **On Delete Incident**, e risiedono nella categoria **Incident** della tavolozza dei componenti workflow su `/dashboard/{projectId}/workflows`.

La stessa generazione vi fornisce trigger per la configurazione stessa: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** e altri ancora. Ogni modello ottiene anche componenti di azione corrispondenti — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** e i loro equivalenti multi-riga — così un trigger e un'azione con nomi simili si trovano fianco a fianco nella stessa categoria. **On Create Incident** avvia un workflow; **Create One Incident** ne apre uno.

Alcuni dettagli che contano quando li collegate:

- **On Update X** accetta un argomento opzionale **Listen on** che restringe il trigger agli aggiornamenti che toccano campi specifici. Lasciatelo vuoto per attivarlo su qualsiasi modifica. Se un aggiornamento arriva senza una registrazione di quali campi sono cambiati, il filtro viene saltato e il workflow viene eseguito comunque.
- **On Create X** e **On Update X** accettano entrambi un argomento obbligatorio **Select Fields**; **On Delete X** non accetta argomenti.
- Tutti e tre espongono un'unica porta di uscita **Success**, e ciascuno accetta un argomento ID così potete eseguire il workflow manualmente su un singolo record.
- I nomi derivano dal nome singolare del modello, non dal nome della sua tabella — ecco perché vedete **On Create Incident Team Owner** e **On Create Incident User Owner** anziché i nomi basati sulla tabella.
- Non ci sono trigger per le definizioni dei campi personalizzati degli incidenti. Quel modello è l'unico membro della famiglia incidenti con i workflow disabilitati.

Per costruire il resto del workflow, vedete [Creare un workflow](/docs/workflows/authoring) e [Variabili del workflow](/docs/workflows/variables).

## Dove leggere ora

- [Panoramica degli incidenti](/docs/incidents/index) — come si combina insieme la funzionalità incidenti.
- [Dichiarare un incidente](/docs/incidents/declaring-incidents) — la procedura guidata di dichiarazione, i modelli e l'API.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — le pagine di impostazione degli stati e delle gravità e cosa fanno i flag.
- [Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed) — dove vengono usati i modelli di nota.
- [Iscritti e annunci](/docs/status-pages/subscribers) — chi viene a sapere di un incidente fuori dal vostro team.
- [Panoramica dei workflow](/docs/workflows/index) — automatizzare sopra i trigger degli incidenti.
- [Panoramica dei Runbook](/docs/runbooks/index) — le procedure a cui le regole runbook si collegano.
