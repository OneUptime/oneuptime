# Stati e gravità

Ogni incidente porta con sé due classificazioni: uno **stato** che indica a che punto è la vostra risposta, e una **gravità** che indica quanto sia grave. Nella dashboard si somigliano — entrambi appaiono come pillole colorate nell'elenco degli incidenti, entrambi sono elenchi legati al progetto che potete rinominare e ricolorare. Ma svolgono compiti molto diversi.

Gli stati determinano il comportamento. Tre flag booleani sulle righe di stato decidono quali incidenti contano come attivi, quali pulsanti compaiono nell'intestazione dell'incidente, quando si ferma l'orologio dell'SLA e quando l'incidente scompare dalla vostra pagina di stato. Le gravità di per sé non determinano nulla — sono etichette che descrivono l'impatto, e su cui altre regole possono fare corrispondenza.

Entrambi gli elenchi vengono creati automaticamente quando il progetto viene creato, ed entrambi si modificano in **Incidents → Settings**. Quella sezione del menu laterale degli incidenti è chiusa per impostazione predefinita, quindi espandete **Settings** prima di cercarla.

## Gli stati portano il comportamento, le gravità portano il significato

Il modello `IncidentState` ha `name`, `description`, `color` e `order`, oltre a tre booleani: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Tutto ciò che il prodotto fa con gli stati dipende da questi booleani e da `order` — mai dal nome dello stato. Ecco perché potete rinominare **Resolved** in "Closed" senza che nulla si rompa: il flag viaggia insieme alla riga.

Il modello `IncidentSeverity` ha `name`, `description`, `color` e `order` e nient'altro. Non ci sono flag. Niente in OneUptime tratta **Critical Incident** diversamente da **Minor Incident** di per sé — la gravità conta solo dove la puntate esplicitamente, come il criterio di corrispondenza **Incident Severities** su una regola di reperibilità.

Alcune regole rapide:

- **Scegliete la gravità per comunicare l'impatto** — appare nell'elenco degli incidenti, nella **Overview** dell'incidente, ed è un campo obbligatorio quando dichiarate un incidente.
- **Scegliete gli stati per modellare il vostro processo** — i passaggi di risposta che effettivamente percorrete, nell'ordine in cui li percorrete.
- **Non codificate l'urgenza negli stati** — uno stato chiamato "Critical" non avviserebbe nessuno. È la gravità unita a una regola di reperibilità a farlo.

## Gli stati seminati

Tre stati vengono creati con il progetto, in questo ordine. La creazione è idempotente — uno stato viene aggiunto solo quando non ne esiste già uno con quel nome.

| Stato            | `order` | Flag                  | Colore    | Cosa significa                                          |
| ---------------- | ------- | --------------------- | --------- | -------------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Lo stato in cui atterrano i nuovi incidenti.              |
| **Acknowledged** | `2`     | `isAcknowledgedState` | `#ffbf53` | Qualcuno ha preso in carico l'incidente.                  |
| **Resolved**     | `3`     | `isResolvedState`     | `#2ab57d` | L'incidente è terminato e smette di contare come attivo.  |

Notate il nome: il primo stato è **Identified**, anche se diverse descrizioni all'interno del prodotto lo chiamano ancora lo stato "created". Quando un documento o un tooltip dice "created state", intende qualunque stato porti `isCreatedState` — in un progetto appena creato, è **Identified**.

## Cosa fa in pratica ogni flag di stato

| Flag                  | Scopo                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Lo stato che un incidente riceve quando nessuno ne ha scelto uno. Se nessuno stato del progetto porta questo flag, la creazione di un incidente fallisce con un errore che invita ad aggiungere uno stato di creazione dalle impostazioni. |
| `isAcknowledgedState` | Alimenta il pulsante **Acknowledge** e la tessera statistica "<nome dello stato> in" nella **Overview** dell'incidente. Al passaggio a questo stato, l'SLA dell'incidente viene segnato come "risposto".    |
| `isResolvedState`     | Alimenta il pulsante **Resolve** e la tessera statistica dei risolti, definisce l'elenco **Active Incidents**, ed è ciò che rimuove l'incidente dalla sezione attiva di una pagina di stato. Segna l'SLA come risolto. |

Ci si aspetta un solo stato per progetto per ciascun flag — le ricerche recuperano una singola riga. I tre stati contrassegnati possono essere rinominati, ricolorati e riordinati, ma la pagina delle impostazioni rifiuta di eliminarli e mostra un errore che nomina gli stati di creazione, riconoscimento e risoluzione.

Poiché l'interfaccia legge i nomi degli stati dinamicamente, rinominare uno stato cambia ciò che vedete ovunque — le tessere statistiche, i titoli delle modali di conferma e la pillola nell'elenco degli incidenti seguono tutti il nome che avete dato alla riga.

## Aggiungere i vostri stati

Andate su **Incidents → Settings → Incident State**. La pagina è un elenco ordinato per `order` crescente, e i nuovi stati vengono aggiunti in fondo. Trascinate una riga per cambiarne la posizione.

**Campi di uno stato:**

- **Name** — obbligatorio, almeno due caratteri. Il segnaposto suggerisce qualcosa come "Investigating".
- **Description** — testo libero facoltativo che spiega quando un incidente si trova in questo stato.
- **Color** — obbligatorio. Scelto dal selettore di colore; memorizzato come valore esadecimale tipo `#fd625e`.

Non potete impostare i tre flag da questo modulo — appartengono alle righe seminate. Uno stato che aggiungete è quindi uno stato non contrassegnato, il che comporta due conseguenze da tenere presenti:

- **Conta come attivo.** **Active Incidents** è definito come "lo stato corrente non è lo stato risolto", quindi qualsiasi cosa aggiungiate oltre allo stato risolto mantiene l'incidente nell'elenco attivo e nel conteggio della barra laterale.
- **Il suo pulsante di transizione è generico.** Invece di **Acknowledge** o **Resolve**, la modale di conferma è intitolata **Mark Incident as `<nome dello stato>`** con un pulsante di invio **Mark as `<nome dello stato>`**.

Una forma comune è inserire un passaggio di triage o mitigazione tra gli stati riconosciuto e risolto — ad esempio, trascinate un nuovo stato "Mitigated" in modo che si trovi dopo **Acknowledged** e prima di **Resolved**.

## L'ordine è un vincolo reale, non una preferenza di visualizzazione

La colonna `order` viene applicata quando un cambio di stato viene scritto, non solo quando l'elenco viene disegnato:

- **Le transizioni all'indietro vengono rifiutate.** Spostare un incidente a uno stato che si trova prima nell'ordine rispetto allo stato attuale fallisce con un errore che nomina entrambi gli stati.
- **Riselezionare lo stato attuale viene rifiutato.** Impostare un incidente sullo stato in cui si trova già fallisce con "Incident state cannot be same as previous state."
- **Una riga retrodatata non può duplicare la sua vicina.** Anche l'inserimento di una riga nella cronologia il cui stato corrisponde alla riga che la segue viene rifiutato.
- **I pulsanti dell'intestazione seguono la posizione degli stati contrassegnati nell'ordine.** **Acknowledge** e **Resolve** vengono proposti in base a dove si trova lo stato attuale nell'elenco ordinato. Uno stato personalizzato posizionato *dopo* lo stato risolto non mostrerà mai un pulsante **Resolve**, perché non resta nulla verso cui avanzare.

Quindi, quando aggiungete uno stato, mettetelo dove un incidente passerebbe effettivamente. Ordinarlo male non è solo esteticamente scorretto — rende impossibili le transizioni.

## Le gravità seminate

Tre gravità vengono create con il progetto, in questo ordine:

- **Critical Incident** (`order` 1, `#b70400`) — problemi che causano un impatto molto elevato sui clienti, che richiedono una risposta immediata. Un'interruzione totale o una violazione dei dati.
- **Major Incident** (`order` 2, `#fd625e`) — impatto significativo, che di solito richiede una risposta immediata, a volte con una soluzione temporanea che limita il danno. Un sottosistema importante che si guasta.
- **Minor Incident** (`order` 3, `#ffbf53`) — basso impatto, di solito gestito entro l'orario lavorativo, e la maggior parte dei clienti probabilmente non se ne accorge. Un lieve calo delle prestazioni dell'applicazione.

La gravità è obbligatoria quando dichiarate un incidente, ed è obbligatoria su ogni specifica di incidente nei criteri di un monitor, quindi ogni incidente — manuale o automatico — arriva con una gravità assegnata. Vedete [Declaring an Incident](/docs/incidents/declaring-incidents) per il flusso di dichiarazione e [Incident and Alert Templating](/docs/monitor/incident-alert-templating) per il percorso guidato dal monitor.

## Modificare le gravità

Andate su **Incidents → Settings → Incident Severity**. Stessa forma della pagina degli stati — un elenco ordinato per `order`, trascinabile per riordinare, con le nuove gravità aggiunte in fondo, e con **Name**, **Description** e **Color** nel modulo.

Due differenze rispetto agli stati:

- **Non c'è protezione contro l'eliminazione.** Qualsiasi gravità può essere eliminata, incluse le tre seminate.
- **Non ci sono flag da ereditare.** Una nuova gravità si comporta esattamente come quelle seminate — è un'etichetta con un colore e una posizione.

**Una nota sui segnaposto.** Il modulo delle gravità riutilizza parola per parola il testo di esempio del modulo degli stati, quindi i suggerimenti parlano di stati dell'incidente invece che di gravità. Ignorateli e scrivete i vostri nomi e descrizioni di gravità.

Dove la gravità fa di più che descrivere: su **Incidents → Rules → On-Call Rules**, il campo **Incident Severities** di una regola è un criterio di corrispondenza. Elencare **Critical Incident** lì è il modo in cui si esprime "avvisa il team database per qualsiasi cosa critica" — la policy di reperibilità vive nella regola, non nella gravità.

## Far avanzare un incidente attraverso i suoi stati

Ci sono quattro modi in cui un incidente cambia stato:

- **I pulsanti dell'intestazione.** Aprite un incidente. Se il suo stato attuale è precedente allo stato riconosciuto, ottenete **Acknowledge** e **Resolve**; se è tra i due, ottenete **Resolve**. Ciascuno apre una modale di conferma — **Acknowledge Incident** o **Resolve Incident** — che offre anche **Select Note Template**, **Public Note** e **Notify Status Page Subscribers**.
- **La cronologia degli stati.** Aggiungete una riga manualmente dalla pagina **State Timeline** dell'incidente con **Incident Status**, **Starts At** e **Notify Status Page Subscribers**.
- **Modifica in blocco.** L'elenco degli incidenti ha un'azione in blocco **Change State** per spostare più incidenti contemporaneamente.
- **Automaticamente.** Un criterio di monitor con **Auto Resolve Incident** attivato risolve il suo incidente quando il criterio non è più soddisfatto, e l'API può aggiornare lo stato tramite `/api/incident-state-timeline`.

Ognuna di queste azioni scrive una riga nella cronologia. Un cambio di stato fa anche alcune cose che non dovete richiedere esplicitamente: pubblica una voce nel feed dell'incidente, assegna un Incident Commander se l'incidente non ne ha ancora uno, e aggiorna l'orologio dell'SLA. Riaprire un incidente risolto avvia un nuovo record SLA a partire dal momento della riapertura.

## La cronologia degli stati

La pagina **State Timeline** dell'incidente nel menu laterale dell'incidente è il registro di controllo di ogni stato in cui l'incidente si è trovato. La scheda su quella pagina è intitolata **Status Timeline**, ed è ordinata dalla più recente.

**Colonne:**

- **Incident Status** — una pillola colorata con il nome e il colore dello stato.
- **Starts At** — quando l'incidente è entrato in questo stato.
- **Ends At** — quando lo ha lasciato. Lo stato attuale mostra `Currently Active`.
- **Duration** — tempo trascorso nello stato, contato fino ad ora per quello attuale.
- **Subscriber Notification Status** — se la notifica della pagina di stato per questo cambiamento è stata inviata, saltata o è ancora in sospeso, con un link **more details**, e — quando l'invio è fallito — un'azione **Retry**.

**Azioni sulla riga:**

- **View Cause** — apre una modale **Root Cause** che visualizza il markdown registrato con quel cambio di stato.
- **View Logs** — apre una modale che spiega perché lo stato è cambiato, con un visualizzatore **Incident State Log**.

Le righe della cronologia possono essere create ed eliminate, ma non modificate. Eliminare la riga sbagliata riscrive la storia dell'incidente, quindi trattatela come uno strumento di correzione, non come un'abitudine di pulizia.

## L'elenco Active Incidents

**Incidents → Active Incidents** è l'elenco che tenete d'occhio durante un turno. La sua definizione è esattamente una condizione: lo stato attuale dell'incidente è uno stato in cui `isResolvedState` è falso. Nient'altro viene considerato — non la gravità, non l'età, non se qualcuno lo ha riconosciuto.

La voce del menu laterale porta un badge rosso con il conteggio che usa la stessa query, quindi il badge e l'elenco sono sempre allineati. Quando non c'è nulla da vedere, la pagina lo dice.

La conseguenza pratica: qualsiasi stato personalizzato che aggiungete mantiene gli incidenti in questo elenco. Di solito è ciò che volete — "Mitigated" non è "fatto" — ma significa che il badge si azzera solo quando gli incidenti raggiungono effettivamente lo stato risolto.

## Informare gli iscritti alla pagina di stato di un cambio di stato

Un cambio di stato può inviare un'email agli iscritti alla vostra pagina di stato, ma passa attraverso diverse verifiche. Capirle vi risparmia molto lavoro di debug del tipo "perché nessuno è stato avvisato".

La notifica viene richiesta per singola riga della cronologia tramite **Notify Status Page Subscribers** (`shouldStatusPageSubscribersBeNotified`), la casella di controllo nella modale di cambio stato e nel modulo manuale della cronologia. Quando è disattivata, la riga viene memorizzata con uno stato "saltato" e una spiegazione. Quando è attivata, la riga viene messa in coda e un job in background la elabora — il job viene eseguito ogni minuto, quindi la consegna è rapida ma non istantanea.

**La riga in coda viene poi saltata quando una di queste condizioni è vera:**

- **Il nuovo stato è lo stato di creazione.** Gli iscritti sono già stati informati quando l'incidente è stato dichiarato, quindi la prima riga della cronologia deliberatamente non invia un secondo messaggio.
- **L'incidente non ha monitor collegati.** Senza risorse, non c'è una pagina di stato su cui mappare l'incidente.
- **L'incidente non è visibile sulla pagina di stato** (`isVisibleOnStatusPage` è disattivato).
- **La pagina di stato ha gli incidenti disattivati** (`showIncidentsOnStatusPage` è disattivato). Questo vale per singola pagina di stato — altre pagine che mostrano lo stesso monitor vengono comunque notificate.

**Un'altra cosa che cambia l'esito.** Se digitate una **Public Note** nella modale di cambio stato, la riga della cronologia viene contrassegnata come già notificata invece di essere messa in coda. È la nota stessa a raggiungere gli iscritti, così ricevono un solo messaggio invece di due. Il tipo di evento dietro il semplice messaggio di cambio stato è `Subscriber Incident State Changed`.

Per sapere chi riceve queste notifiche e come vengono scelti i modelli, vedete [Subscribers & Announcements](/docs/status-pages/subscribers).

## Tenere un incidente fuori dalla pagina di stato

Tre cose separate decidono se un incidente compare del tutto sulla pagina pubblica, e tutte e tre devono essere vere:

- **Show Incidents** (`showIncidentsOnStatusPage`) sulla pagina di stato stessa.
- **Visible on Status Page** (`isVisibleOnStatusPage`) sull'incidente — un interruttore nella pagina **Settings** dell'incidente. È vero per impostazione predefinita e non si trova nella procedura guidata di dichiarazione; un criterio di monitor può impostarlo con **Show Incident on Status Page**.
- **Lo stato attuale non è lo stato risolto.** Questo è ciò che rimuove un incidente dalla sezione attiva: la query della pagina di stato recupera gli incidenti il cui stato attuale è uno stato non risolto qualsiasi. Non archiviate né chiudete nulla — lo risolvete, e passa nella cronologia.

**Gli incidenti privati non appaiono mai.** Attivare **Private Incident** nasconde l'incidente da ogni pagina di stato, indipendentemente dagli interruttori sopra, e lo limita ai suoi proprietari più agli amministratori e proprietari del progetto.

Quanta cronologia di incidenti risolti conserva la pagina è un'impostazione della pagina di stato, non dell'incidente. Vedete [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) per come i monitor sulla pagina decidono quali incidenti compaiono in generale.

## Cosa leggere dopo

- [Panoramica degli incidenti](/docs/incidents/index) — come si incastra l'area funzionale degli incidenti.
- [Dichiarare un incidente](/docs/incidents/declaring-incidents) — la procedura guidata di dichiarazione, i modelli e l'API.
- [Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed) — note pubbliche, note private e il feed di attività.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings) — modelli, campi personalizzati, regole e trigger di workflow.
- [Iscritti e annunci](/docs/status-pages/subscribers) — chi riceve le email che invia un cambio di stato.
- [Panoramica delle pagine di stato](/docs/status-pages/index) — cosa mostra una pagina di stato e a chi.
- [Panoramica dei workflow](/docs/workflows/index) — reagire ai cambi di stato con l'automazione.
