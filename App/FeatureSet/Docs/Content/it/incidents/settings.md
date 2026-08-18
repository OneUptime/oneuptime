# Impostazioni e automazione

La configurazione degli incidenti non vive nelle **Impostazioni del progetto**. Vive dentro l'area di prodotto Incidenti, sotto **Incidenti → Impostazioni** e **Incidenti → Regole**, agli indirizzi che iniziano con `/dashboard/{projectId}/incidents/settings/`. Se avete cercato i modelli di incidente o i campi personalizzati nelle **Impostazioni del progetto**, ecco perché non li avete trovati.

Sia la sezione **Regole** sia la sezione **Impostazioni** del menu laterale di Incidenti sono compresse per impostazione predefinita, quindi dovete espanderle prima che compaiano le voci qui sotto. Tutto ciò che trovate qui è legato al progetto: modelli, ruoli, campi personalizzati e regole appartengono a un progetto e valgono per ogni incidente dichiarato al suo interno.

Questa pagina è il riferimento per quella configurazione — che cosa contiene ciascuna schermata e quale parte di essa entra in azione da sola nell'istante in cui un incidente viene creato.

## Dove si trovano le impostazioni degli incidenti

Aprite **Incidenti** nella navigazione a sinistra, poi espandete **Impostazioni** in fondo al menu laterale.

| Pagina                     | Che cosa ci fate                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Stato incidente**       | Aggiungete, rinominate, ricolorate e riordinate gli stati che un incidente attraversa.                       |
| **Gravità incidente**    | Aggiungete, rinominate, ricolorate e riordinate i livelli di gravità.                                            |
| **Modelli di incidenti**   | Precompilate un incidente intero — titolo, descrizione, risorse, policy di reperibilità, proprietari, etichette. |
| **Modelli di note**       | Testo riutilizzabile per le note pubbliche e private.                                                                  |
| **Modelli post-mortem** | Strutture post-mortem riutilizzabili.                                                                                  |
| **Campi personalizzati**        | Definite campi aggiuntivi che compaiono su ogni incidente.                                                           |
| **Ruoli incidente**       | Definite i ruoli a cui assegnate chi risponde, per esempio Incident Commander.                       |
| **Altre impostazioni**        | I prefissi dei numeri di incidente e di episodio.                                           |

**Stato incidente** e **Gravità incidente** sono trattati a fondo in [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — il resto di questa pagina riparte dai **Modelli di incidenti**.

Espandete **Regole** e ottenete altre otto schermate: **Regole di raggruppamento**, **Regole di reperibilità**, **Regole del proprietario**, **Regole di runbook**, **Regole di privacy**, **Regole etichette**, **Regole SLA** e **Reminder Rules**. Le trovate più avanti.

## Modelli di incidenti

Un modello di incidente è lo scheletro salvato di un incidente. Invece di riscrivere ogni volta lo stesso titolo, lo stesso elenco di monitor e la stessa policy di reperibilità quando il cluster dei pagamenti traballa, lo salvate una volta sola e dichiarate a partire da lì.

Andate su **Incidenti → Impostazioni → Modelli di incidenti** (`/dashboard/{projectId}/incidents/settings/templates`). La scheda si intitola **Modelli di incidenti**. Crearne uno vi porta attraverso una procedura guidata in sei passaggi:

- **Informazioni del modello** — **Nome del modello** e **Descrizione del modello**. Danno un nome al modello stesso; non compaiono mai sull'incidente.
- **Dettagli dell'incidente** — **Titolo**, **Descrizione** (Markdown), **Gravità incidente** e **Stato iniziale dell'incidente**. **Stato iniziale dell'incidente** è facoltativo e parte vuoto; le sue opzioni sono elencate nell'ordine degli stati. Lasciatelo in bianco e gli incidenti nati da questo modello atterrano nello stato di creazione del progetto.
- **Risorse interessate** — i monitor, gli host, i cluster e i servizi a cui l'incidente va collegato, più **Change Monitor Status to**.
- **Reperibilità** — **Policy di reperibilità**, cioè le policy da eseguire quando viene dichiarato un incidente creato da questo modello.
- **Proprietari** — **Proprietario - Team** e **Proprietario - Utenti**.
- **Etichette** — **Etichette**.

Qualche regola rapida:

- L'elenco dei modelli mostra solo **Nome** e **Descrizione**. Le righe non si modificano né si eliminano dall'elenco — aprite un modello (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) per cambiarlo.
- I modelli supportano l'importazione e l'esportazione JSON, così potete spostarne uno da un progetto all'altro.
- Lo stato vuoto recita "No incident templates found."

### Come viene applicato un modello

Ci sono due strade, e si comportano allo stesso modo.

- **Dalla dashboard** — il pulsante **Crea da modello** nell'elenco degli incidenti apre un selettore **Seleziona modello di incidente**, e la pagina di dichiarazione legge il modello dal parametro `incidentTemplateId` nella query string, poi precompila il modulo con il modello più i suoi team e utenti proprietari.
- **Dall'API** — passate `createdIncidentTemplateId` a `POST /api/incident` e il server riempie l'incidente a partire dal modello.

La parte importante è la regola di fusione: **un modello riempie solo i campi che avete lasciato indefiniti**. Titolo, descrizione, gravità, stato iniziale, lo stato del monitor dietro **Change Monitor Status to**, monitor, host, cluster Kubernetes, host Docker, host Podman, servizi, policy di reperibilità ed etichette vengono copiati dal modello solo quando chi chiama, o il modulo, non ha fornito nulla. Quello che impostate esplicitamente vince sempre.

**La finestra di dialogo dello stato vuoto indica il posto sbagliato.** Se non avete ancora nessun modello, il pulsante **Crea da modello** mostra una finestra **No Incident Templates**. Il suo testo rimanda alle Impostazioni del progetto, ma il pulsante porta a **Incidenti → Impostazioni → Modelli di incidenti** — è lì che stanno davvero.

## Modelli di note

I modelli di note danno a chi risponde del testo già pronto per gli aggiornamenti, così un aggiornamento sulla pagina di stato alle 3 del mattino non viene scritto da zero da qualcuno mezzo addormentato.

Andate su **Incidenti → Impostazioni → Modelli di note** (`/dashboard/{projectId}/incidents/settings/note-templates`). La scheda si intitola **Modelli di nota pubblica o privata per gli incidenti** — un'unica libreria serve entrambi i tipi di nota. Il modulo di creazione ha due passaggi:

- **Informazioni del modello** — **Nome del modello** e **Descrizione del modello**, entrambi obbligatori.
- **Dettagli della nota** — il corpo della nota, in Markdown, obbligatorio.

Come per i modelli di incidente, le righe si creano e si consultano invece di modificarle sul posto; aprite un modello per cambiarlo.

I modelli di note compaiono dove servono davvero: le finestre di conferma **Acknowledge Incident** e **Resolve Incident** offrono entrambe **Seleziona modello di nota** accanto al campo **Nota pubblica**. Per la differenza tra note pubbliche e private, vedete [Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed).

## Modelli post-mortem

Un modello post-mortem è lo scheletro del resoconto che scrivete dopo un incidente — i vostri titoli, i vostri spunti, le vostre domande di rito — così ogni revisione del progetto segue la stessa forma.

Andate su **Incidenti → Impostazioni → Modelli post-mortem** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). La scheda si intitola **Modelli post-mortem**. Il modulo di creazione ha due passaggi:

- **Informazioni del modello** — **Nome del modello** e **Descrizione del modello**, entrambi obbligatori.
- **Dettagli del postmortem** — **Modello di postmortem**, cioè il corpo vero e proprio, in Markdown, obbligatorio.

Un modello si applica dall'incidente, non dalle impostazioni. Aprite un incidente, scegliete **Post-mortem** nel suo menu laterale (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) e usate **Applica modello**. Si apre una finestra **Applica modello di analisi post-incidente** con un menu a discesa **Seleziona modello**; sceglierne uno carica il corpo del modello nell'editor **Nota del postmortem**, dove lo modificate prima di salvare. Gli episodi di incidente hanno la stessa pagina **Post-mortem** e attingono alla stessa libreria di modelli.

## Campi personalizzati

I campi personalizzati vi permettono di portare i vostri metadati su ogni incidente — il nome interno di un servizio, il riferimento a un ticket di change, la fascia di un cliente.

Andate su **Incidenti → Impostazioni → Campi personalizzati** (`/dashboard/{projectId}/incidents/settings/custom-fields`). La pagina si intitola **Campi personalizzati dell'incidente**. Ogni definizione ha:

- **Nome del campo** — obbligatorio, almeno due caratteri. Il segnaposto suggerisce un nome in stile slug, come `internal-service`.
- **Descrizione del campo** — facoltativa.
- **Tipo di campo** — obbligatorio. Sceglie come si inseriscono i dati. I tipi a menu a discesa richiedono anche l'elenco delle opzioni.
- **Opzioni del menu a discesa** — i valori che compaiono nel menu, ciascuno con un colore facoltativo.

Le definizioni vivono in un modello a sé; i valori vivono sull'incidente stesso, nella colonna `customFields`. Su un singolo incidente li compilate da **Campi personalizzati** nel menu laterale dell'incidente (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Una lacuna da conoscere.** Le definizioni dei campi personalizzati degli incidenti sono l'unica parte della famiglia Incidenti senza trigger di workflow — vedete la sezione sui workflow più sotto.

## Ruoli incidente

I ruoli incidente sono gli incarichi con un nome a cui assegnate le persone durante una risposta. Definiteli in **Incidenti → Impostazioni → Ruoli incidente** (`/dashboard/{projectId}/incidents/settings/roles`); la descrizione della scheda porta come esempi Incident Commander e Responder.

I ruoli sono solo definizioni. Le persone le assegnate incidente per incidente — la procedura di dichiarazione ha un passaggio **Ruoli incidente** con un campo **Assegna ruoli incidente**, e ogni incidente ha una pagina **Ruoli** nel proprio menu laterale.

## Prefissi dei numeri

Ogni incidente riceve un numero. Per impostazione predefinita viene reso come `#42`. Se il vostro team dice "INC-42" a voce, fatelo dire anche al prodotto.

Andate su **Incidenti → Impostazioni → Altre impostazioni** (`/dashboard/{projectId}/incidents/settings/more`). La scheda è **Prefisso del numero** e contiene due campi del progetto:

- **Prefisso del numero dell'incidente** — fino a 20 caratteri, segnaposto `INC-`. Impostatelo e l'incidente `#42` compare come `INC-42`.
- **Prefisso del numero dell'episodio dell'incidente** — la stessa idea per i numeri degli episodi, segnaposto `IE-`.

Lasciate vuoto uno dei due per mantenere il prefisso predefinito `#`; il campo non impostato mostra `# (default)`. Salvate con **Aggiorna**. Il valore con prefisso viene memorizzato sull'incidente come `incidentNumberWithPrefix`, ed è quello che l'elenco degli incidenti e l'intestazione dell'incidente mostrano.

## Le regole che scattano alla creazione di un incidente

**Incidenti → Regole** contiene otto motori di regole. Fanno tutti lo stesso mestiere — guardano un incidente nell'istante in cui viene creato e agiscono se corrisponde — ma si distinguono per che cosa fanno e per come si risolvono più regole che corrispondono insieme.

- **Regole di raggruppamento** — raggruppano incidenti correlati in episodi. Le regole vengono valutate in ordine di priorità; i numeri di priorità più bassi vanno per primi.
- **Regole di reperibilità** — eseguono le policy di reperibilità per gli incidenti corrispondenti. Trattate in dettaglio più sotto.
- **Regole del proprietario** — assegnano i proprietari automaticamente.
- **Regole di runbook** — avviano un [runbook](/docs/runbooks/index) quando un incidente corrisponde.
- **Regole di privacy** — decidono se un incidente corrispondente è privato.
- **Regole etichette** — applicano le etichette automaticamente.
- **Regole SLA** — tracciano i tempi di risposta e di risoluzione. Le regole vengono valutate in ordine; i numeri d'ordine più bassi vanno per primi.
- **Reminder Rules** — ricordano periodicamente ai proprietari dell'incidente che l'incidente è ancora aperto. Le regole vengono valutate in ordine e vince la prima che corrisponde.

**La semantica dell'ordine non è uniforme.** Regole di raggruppamento, Regole SLA e Reminder Rules sono valutate in ordine. Le Regole di reperibilità no — scattano tutte le regole che corrispondono. Non date per scontato che un solo modello valga per tutte e otto.

Le pagine **Regole di reperibilità**, **Regole del proprietario**, **Regole etichette** e **Regole di privacy** hanno delle schede — una scheda **Incident Rules** e una scheda **Episode Rules**, ciascuna con la propria tabella. Configurate la scheda **Incident Rules**, a meno che non intendiate proprio gli episodi. **Regole di raggruppamento**, **Regole di runbook**, **Regole SLA** e **Reminder Rules** sono tabelle singole.

## Regole di reperibilità degli incidenti

**Incidenti → Regole → Regole di reperibilità** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) è dove rendete automatica la chiamata al reperibile. La scheda, **Regole di reperibilità incidente**, descrive regole che eseguono automaticamente le policy di reperibilità quando vengono creati incidenti corrispondenti. La pagina ha due schede: **Incident Rules** e **Episode Rules**.

Il modulo di creazione ha tre passaggi:

- **Informazioni di base** — **Nome** (il segnaposto suggerisce qualcosa come chiamare il team database per qualsiasi incidente DB), **Descrizione** e un interruttore **Abilitato**. L'elenco mostra per ogni regola una pillola verde **Abilitato** o rossa **Disabilitato**.
- **Criteri di corrispondenza** — **Monitor**, **Incidente Gravità**, **Etichette dell'incidente**, **Etichette del monitor**, più campi con espressioni regolari senza distinzione tra maiuscole e minuscole per titolo dell'incidente, descrizione dell'incidente, nome del monitor e descrizione del monitor.
- **Policy di reperibilità** — le policy che questa regola esegue.

### Come si risolve la corrispondenza

Vale la pena assimilare le regole con cui funziona la pagina stessa:

- Una regola corrisponde solo quando **tutti** i criteri che avete compilato passano. I criteri lasciati vuoti vengono saltati, non considerati falliti.
- All'interno di un singolo criterio a elenco — **Monitor**, **Incidente Gravità**, **Etichette dell'incidente**, **Etichette del monitor** — basta che corrisponda uno qualsiasi dei valori.
- I campi con i pattern sono espressioni regolari senza distinzione tra maiuscole e minuscole.
- **Scattano tutte le regole che corrispondono.** Non c'è priorità e non c'è cortocircuito.
- L'insieme di policy che viene davvero eseguito è l'unione delle policy di ogni regola corrispondente, più le policy collegate all'incidente a mano o da un modello, deduplicate in modo che ogni policy venga eseguita al massimo una volta.

La gravità è un criterio di corrispondenza qui e in nessun altro posto. Non esiste un campo di reperibilità su una gravità: scegliere "Critical Incident" non chiama nessuno di per sé. Se volete che sia la gravità a guidare le chiamate, scrivete una regola di reperibilità che corrisponda su di essa.

## Collegare direttamente le policy di reperibilità

Le regole non sono l'unica strada. Ogni incidente porta con sé un proprio elenco di policy di reperibilità, esposto come campo **Policy di reperibilità** nel passaggio **Reperibilità** della procedura di dichiarazione e nel passaggio **Reperibilità** di un modello di incidente. La descrizione del campo lo dice chiaramente: sono le policy di reperibilità da eseguire quando questo incidente viene creato.

Quando un incidente viene creato, OneUptime esegue prima le regole etichette, poi le regole di reperibilità (che fondono le policy corrispondenti nell'elenco dell'incidente), poi le regole di runbook — e se l'elenco che ne risulta non è vuoto, ogni policy contenuta viene eseguita. Le esecuzioni partono in parallelo e si concludono in modo indipendente, quindi una policy che fallisce non ferma le altre. Ogni esecuzione viene marcata con l'incidente che l'ha innescata e con il tipo di evento di notifica "incidente creato".

Per vedere che cosa è successo, aprite l'incidente e scegliete **Esecuzioni di reperibilità** nel suo menu laterale (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Pilotare gli incidenti dai workflow

I trigger di workflow per gli incidenti non sono scritti a mano — OneUptime li genera dai modelli di dati, quindi ogni modello della famiglia Incidenti ottiene i componenti **On Create X**, **On Update X** e **On Delete X**, chiamati con il nome singolare del modello. I tre principali sono **On Create Incident**, **On Update Incident** e **On Delete Incident**, e li trovate sotto la categoria **Incidente** nel pannello **Aggiungi componente** all'indirizzo `/dashboard/{projectId}/workflows`.

La stessa generazione vi dà i trigger per la configurazione stessa: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** e altri ancora. Ogni modello riceve anche i componenti di azione corrispondenti — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** e i loro equivalenti su più righe — perciò un trigger e un'azione dal nome simile finiscono uno accanto all'altro nella stessa categoria. **On Create Incident** avvia un workflow; **Create One Incident** apre un incidente.

Qualche dettaglio che conta quando li collegate:

- **On Update X** accetta un argomento facoltativo **Listen on** che restringe il trigger agli aggiornamenti che toccano determinati campi. Lasciatelo vuoto per scattare a ogni modifica. Se arriva un aggiornamento senza traccia di quali campi si siano mossi, il filtro viene saltato e il workflow parte comunque.
- **On Create X** e **On Update X** richiedono entrambi un argomento obbligatorio **Select Fields**; **On Delete X** non accetta argomenti.
- Tutti e tre espongono un'unica porta d'uscita **Successo**, e ciascuno accetta un argomento ID così potete eseguire il workflow a mano su un singolo record.
- I nomi derivano dal nome singolare del modello, non dal nome della tabella — ed è per questo che vedete **On Create Incident Team Owner** e **On Create Incident User Owner** invece di nomi modellati sulle tabelle.
- Non ci sono trigger per le definizioni dei campi personalizzati degli incidenti. Quel modello è l'unico membro della famiglia Incidenti con i workflow disattivati.

Per costruire il resto del workflow, vedete [Creare un workflow](/docs/workflows/authoring) e [Variabili del workflow](/docs/workflows/variables).

## Dove leggere ora

- [Panoramica degli incidenti](/docs/incidents/index) — come si incastrano le parti della funzionalità Incidenti.
- [Dichiarare un incidente](/docs/incidents/declaring-incidents) — la procedura di dichiarazione, i modelli e l'API.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — le pagine di impostazione di stati e gravità e che cosa fanno i flag.
- [Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed) — dove si usano i modelli di note.
- [Iscritti e annunci](/docs/status-pages/subscribers) — chi viene a sapere di un incidente fuori dal vostro team.
- [Panoramica dei workflow](/docs/workflows/index) — automatizzare a partire dai trigger degli incidenti.
- [Panoramica dei Runbook](/docs/runbooks/index) — le procedure che le regole di runbook collegano.
