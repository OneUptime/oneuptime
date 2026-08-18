# Dichiarare un incidente

Dichiarare un incidente è il momento in cui OneUptime inizia a tenere il conto. Viene creato un record, gli viene apposto un numero, scattano le politiche di reperibilità e — a meno che tu non dica diversamente — gli iscritti alla tua pagina di stato ne vengono informati. Tutto il resto nel ciclo di vita dell'incidente dipende da quella prima scrittura.

Ci sono quattro modi in cui un incidente entra in OneUptime, e tutti finiscono nello stesso posto: una riga nella tabella `Incident` con una gravità, uno stato attuale e un elenco di risorse interessate. La differenza sta solo in chi compila i campi — tu alle 3 del mattino, un modello salvato, i criteri di un monitor, oppure il tuo stesso codice che chiama l'API.

Questa pagina illustra tutti e quattro i modi, campo per campo, e poi tratta cosa il server compila per te e cosa scatta nel momento in cui l'incidente esiste.

## Quattro modi in cui un incidente viene dichiarato

| Se vuoi…                                                      | Scegli                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Aprire un incidente manualmente, compilando tutto             | La procedura guidata **Declare Incident**                                   |
| Aprire un tipo ricorrente di incidente con i campi precompilati | **Create from Template**                                                    |
| Aprirne uno automaticamente quando falliscono i controlli di un monitor | Un filtro di criteri del monitor con **When filters match, declare an incident.** |
| Aprirne uno dal tuo codice, uno script o un altro strumento    | `POST /api/incident`                                                        |

Tutti e quattro scrivono sullo stesso modello, quindi un incidente aperto da una sonda ha esattamente lo stesso aspetto di uno aperto manualmente da un responder — a parte alcune colonne di contabilità che il server imposta su quelli automatici.

## Dichiararne uno manualmente

Apri **Incidents → All Incidents** e clicca su **Declare Incident** in alto a destra nell'elenco **Incidents**. Questo ti porta a una scheda intitolata **Declare New Incident**, che distribuisce il modulo su cinque passaggi: **Incident Details**, **Resources Affected**, **Incident Roles**, **On-Call** e **More**. Anche il pulsante di invio alla fine recita **Declare Incident**.

Solo il primo passaggio ha campi obbligatori. Se hai fretta, compila **Incident Details** e invia — puoi collegare risorse, assegnare ruoli e aggiungere politiche di reperibilità dalle pagine dell'incidente stesso in seguito.

### Passaggio 1 — Incident Details

- **Title** — obbligatorio. Il riepilogo di una riga che tutti vedranno nell'elenco, in Slack e (se l'incidente è visibile) sulla tua pagina di stato. Segnaposto: `Incident Title`.
- **Description** — facoltativo, scritto in Markdown. È il campo che appare sulla pagina di stato, quindi scrivilo per i clienti anziché per il tuo team. Puoi modificarlo in seguito da **Description** nel menu laterale dell'incidente.
- **Declared At** — obbligatorio nel modulo, predefinito su ora. È il timestamp da cui viene misurata ogni durata sull'incidente, quindi retrodatalo se stai registrando qualcosa che è iniziato prima.
- **Incident Severity** — obbligatorio. Una delle gravità configurate per il tuo progetto; i nuovi progetti sono preconfigurati con **Critical Incident**, **Major Incident** e **Minor Incident**.
- **Incident State** — facoltativo. Lascialo invariato e l'incidente atterra nello stato contrassegnato `isCreatedState`, che i nuovi progetti preconfigurano come **Identified**. Impostalo solo quando stai registrando un incidente già oltre quel punto.

**Se il menu a discesa dello stato ti dà problemi.** Se il tuo progetto non ha alcuno stato con il flag `isCreatedState`, la chiamata di creazione fallisce e ti dice di aggiungere uno stato di incidente creato dalle impostazioni. Normalmente questo accade solo su un progetto i cui stati sono stati modificati pesantemente — consulta [Incident States & Severities](/docs/incidents/states-and-severities).

### Passaggio 2 — Resources Affected

- **Resources Affected** — una singola casella di ricerca che collega monitor, host, cluster Kubernetes, host Docker, host Podman e servizi. Sotto il cofano si tratta di relazioni separate sull'incidente (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` e altre), ma il modulo le raccoglie in un unico selettore.
- **Change Monitor Status to** — facoltativo. Sceglie uno stato del monitor che viene applicato a ogni monitor collegato a questo incidente, così dichiarare l'incidente e contrassegnare i monitor come degradati diventa un'unica azione anziché due.

**Collega i monitor anche quando sembra ridondante.** Il collegamento tra un incidente e una pagina di stato passa attraverso i monitor dell'incidente: una pagina di stato mostra un incidente quando una delle sue risorse è uno dei monitor dell'incidente. Una notifica di cambio stato agli iscritti viene saltata del tutto quando l'incidente non ha monitor collegati. Consulta [Status Page Resources & Groups](/docs/status-pages/resources-and-groups).

### Passaggio 3 — Incident Roles

- **Assign Incident Roles** — assegna membri del team ai ruoli definiti dal tuo progetto. Alcuni ruoli accettano più di un utente.

I ruoli stessi vengono configurati in **Incidents → Settings → Incident Roles**, dove definisci i ruoli che possono essere assegnati durante la risposta — Incident Commander, Responder e qualsiasi altro il tuo processo richieda. Se salti questo passaggio, un Incident Commander viene assegnato automaticamente al primo cambio di stato se nessuno ricopre ancora il ruolo.

### Passaggio 4 — On-Call

- **On-Call Policy** — una selezione multipla delle politiche di reperibilità da eseguire quando questo incidente viene creato. Corrisponde a `onCallDutyPolicies` sull'incidente.

Questo è l'unico punto in cui una politica di reperibilità viene collegata direttamente a un incidente. Le gravità non portano con sé una politica di reperibilità — la gravità è un'etichetta, e influisce sull'avviso solo come *criterio di corrispondenza* all'interno di una regola di reperibilità. Le regole configurate in **Incidents → Rules → On-Call Rules** aggiungono le loro politiche a quelle scelte qui; l'insieme finale eseguito è l'unione senza duplicati di entrambi.

### Passaggio 5 — More

- **Labels** — facoltativo ed è una funzionalità avanzata: i membri del team con accesso a queste etichette sono quelli che possono accedere all'incidente.
- **Notify Status Page Subscribers** — casella di controllo, attiva per impostazione predefinita. Controlla se gli iscritti vengono informati via email della creazione dell'incidente (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Disattivala per rumore interno che vuoi comunque registrare.
- **Private Incident** — casella di controllo, disattivata per impostazione predefinita (`isPrivate`). Un incidente privato è visibile solo ai suoi utenti proprietari, ai membri dei suoi team proprietari, agli amministratori del progetto e ai proprietari del progetto — ed è nascosto da ogni pagina di stato, indipendentemente da qualsiasi altra impostazione. L'elenco degli incidenti contrassegna questi con un badge rosso **Private**.

Il flag **Should be visible on status page?** (`isVisibleOnStatusPage`) non è nella procedura guidata; per impostazione predefinita è vero. Cambialo in seguito da **Settings** nel menu laterale dell'incidente, dove è etichettato **Visible on Status Page**.

## Dichiarare da un modello

Se continui a dichiarare lo stesso tipo di incidente — lo stesso schema di titolo, la stessa gravità, la stessa politica di reperibilità — salvalo una volta come modello.

Clicca su **Create from Template** (il pulsante contornato accanto a **Declare Incident**) e si apre una finestra modale **Create Incident from Template**, con un menu a discesa **Select Incident Template**. Scegli un modello e il modulo di creazione si apre precompilato; puoi comunque cambiare qualsiasi cosa prima di inviare. Se il tuo progetto non ha ancora modelli, ottieni invece una finestra modale **No Incident Templates**, con un pulsante **Create Template** che ti porta a **Incidents → Settings → Incident Templates**.

I modelli vengono costruiti con una propria procedura guidata a sei passaggi — **Template Info**, **Incident Details**, **Resources Affected**, **On-Call**, **Owners**, **Labels** — con questi campi:

| Campo                        | Scopo                                                |
| ---------------------------- | ------------------------------------------------------ |
| **Template Name**            | Come il modello viene identificato nel selettore.       |
| **Template Description**     | Una nota per te stesso in futuro su quando usarlo.      |
| **Title**                    | Il titolo precompilato sull'incidente.                  |
| **Description**              | Descrizione in Markdown precompilata sull'incidente.    |
| **Incident Severity**        | Gravità precompilata sull'incidente.                    |
| **Initial Incident State**   | Lo stato in cui iniziano gli incidenti da questo modello. |
| **Resources Affected**       | Monitor, host, cluster e servizi da collegare.          |
| **Change Monitor Status to** | Stato del monitor da applicare ai monitor collegati.    |
| **On-Call Policy**           | Politiche da eseguire quando l'incidente viene creato.  |
| **Owner - Teams**            | Team proprietari degli incidenti creati da questo modello. |
| **Owner - Users**            | Utenti proprietari degli incidenti creati da questo modello. |
| **Labels**                   | Etichette applicate all'incidente.                      |

Alcune regole rapide:

- I modelli non sono modificabili dall'elenco dei modelli — ne crei uno, poi lo apri per modificarlo.
- Un modello compila solo un campo che hai lasciato vuoto. Nella pagina di creazione il modello viene applicato come precompilazione che puoi sovrascrivere; nell'API, il server compila un campo dal modello solo quando la richiesta ha lasciato quel campo `undefined`. Ciò che il chiamante ha fornito vince sempre.

## Dichiarare automaticamente dai criteri del monitor

La maggior parte degli incidenti non dovrebbe richiedere che un essere umano li digiti. Nell'editor dei criteri di un monitor, attiva l'opzione **When filters match, declare an incident.** e appare una sezione **Create Incident** con un pulsante **Add Incident** — un filtro di criteri può dichiarare più di un incidente.

Ogni voce ha:

- **Incident Title** — supporta il templating; il segnaposto suggerisce qualcosa come `{{monitorName}} is down`.
- **Severity** — obbligatorio.
- **Incident Description** — anch'essa con templating.
- **On-Call → On-Call Policies** — politiche eseguite quando questo incidente viene creato.
- **Incident Roles** — pre-assegna membri del team ai ruoli.
- **Ownership & Labels → Owner Teams**, **Owner Users**, **Labels**.
- **Advanced Options → Auto Resolve Incident** (risolve automaticamente l'incidente quando i criteri smettono di corrispondere), **Show Incident on Status Page**, **Private Incident** e **Remediation Notes**.

Per l'elenco completo dei segnaposto `{{variable}}` che puoi usare nel titolo, nella descrizione e nelle note di rimedio, consulta [Incident & Alert Templating](/docs/monitor/incident-alert-templating).

Gli incidenti creati in questo modo vengono contrassegnati dal server: `isCreatedAutomatically` viene impostato, `createdCriteriaId` registra quale filtro di criteri è scattato e `createdByProbe` registra quale sonda l'ha rilevato. Per il resto si comportano esattamente come un incidente dichiarato manualmente.

## Dichiarare tramite l'API

Il modello dell'incidente espone un endpoint CRUD standard, quindi `POST /api/incident` ne crea uno. Autenticati con una chiave API generata in **Project Settings → API Keys**, inviata nell'header `apikey` — la chiave identifica il progetto, quindi non devi passare separatamente un id di progetto.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Campi utili nel corpo della richiesta:

- `title` — l'unico campo che devi davvero fornire.
- `declaredAt` — facoltativo qui anche se il modulo lo richiede. Omettilo e il server usa l'ora corrente.
- `incidentSeverityId` e `currentIncidentStateId` — il server controlla che entrambi appartengano allo stesso progetto della chiave API, e rifiuta la richiesta se non è così. Lo stesso controllo si applica allo stato del monitor dietro **Change Monitor Status to**.
- `createdIncidentTemplateId` — applica un modello salvato. Ogni campo che ometti viene compilato dal modello; ogni campo che invii viene mantenuto così com'è.

Gli endpoint correlati sono `/api/incident-state`, `/api/incident-severity` e `/api/incident-state-timeline`. Il [riferimento API](/reference) generato ha le forme esatte di richiesta e risposta per ciascuno, incluso come vengono espressi i campi di relazione come i monitor.

## Numeri e prefissi degli incidenti

Ogni incidente riceve un numero sequenziale da un contatore per progetto, assegnato dal server al momento della creazione. Due colonne lo contengono: `incidentNumber` (l'intero grezzo) e `incidentNumberWithPrefix` (ciò che vedi effettivamente). Senza un prefisso configurato, il valore mostrato è `#42`.

Per cambiarlo, vai su **Incidents → Settings → More Settings**. La scheda **Number Prefix** ha un campo **Incident Number Prefix** (fino a 20 caratteri, segnaposto `INC-`) — impostalo e lo stesso incidente viene mostrato come `INC-42`. Lascialo vuoto per mantenere il predefinito `#`. La scheda contiene anche **Incident Episode Number Prefix** per la numerazione degli episodi.

Il numero appare come prima colonna dell'elenco degli incidenti, collega all'incidente e appare come **Incident Number** nella pagina **Overview** dell'incidente.

## Cosa succede nel momento in cui un incidente viene dichiarato

La chiamata di creazione fa più che scrivere una riga. In ordine:

1. **Il server compila le lacune.** `declaredAt` viene impostato per impostazione predefinita su ora, lo stato attuale è predefinito allo stato `isCreatedState` del progetto, e il numero dell'incidente e il numero con prefisso vengono assegnati dal contatore del progetto.
2. **Viene applicato un modello**, se è stato fornito `createdIncidentTemplateId` — compilando solo i campi che il chiamante ha lasciato indefiniti.
3. **Vengono eseguite le regole di privacy**, contrassegnando l'incidente come privato quando una regola corrispondente lo indica. Questo è il primo motore di regole a essere eseguito, quindi tutto ciò che segue vede l'impostazione di privacy corretta.
4. **Vengono eseguite le regole di proprietario**, aggiungendo gli utenti e i team proprietari indicati dalle regole corrispondenti.
5. **Vengono eseguite le regole di etichette**, aggiungendo le etichette che corrispondono all'incidente.
6. **Vengono eseguite le regole di reperibilità.** Ogni regola abilitata in **Incidents → Rules → On-Call Rules** i cui criteri corrispondono aggiunge le proprie politiche all'incidente. Non c'è un ordine di priorità né un cortocircuito — tutte le regole corrispondenti scattano e le politiche vengono deduplicate.
7. **Vengono eseguite le regole di runbook**, collegando e avviando i runbook corrispondenti. Consulta [Runbooks](/docs/runbooks/index).
8. **Vengono eseguite le politiche di reperibilità.** Ogni politica sull'incidente — scelta nella procedura guidata, ereditata da un modello, o aggiunta da una regola — viene eseguita in parallelo con il tipo di evento `IncidentCreated`. Il fallimento di una politica non ferma le altre.
9. **Gli iscritti vengono messi in coda**, se **Notify Status Page Subscribers** è rimasto attivo e l'incidente è visibile sulla pagina di stato. La consegna è gestita da un job in background, non in linea con la tua richiesta.
10. **I workflow scattano.** Il trigger **On Create Incident** avvia qualsiasi workflow costruito su di esso. Consulta [Workflows Overview](/docs/workflows/index).

Da quel momento l'incidente è attivo: conta ai fini del badge **Active Incidents** nel menu laterale di Incidents (qualsiasi stato non contrassegnato `isResolvedState` conta come attivo), appare sulle pagine di stato che portano uno dei suoi monitor, e la sua **State Timeline** inizia a registrare.

## Cosa leggere dopo

- [Incidents Overview](/docs/incidents/index) — come si integra il modello di incidente.
- [Incident States & Severities](/docs/incidents/states-and-severities) — cosa fanno i flag di stato e come aggiungere i tuoi.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — note pubbliche, note private, proprietari e il feed di attività.
- [Incident Settings & Automation](/docs/incidents/settings) — modelli, campi personalizzati, ruoli, regole e trigger dei workflow.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — chi viene informato dell'incidente che hai appena dichiarato.
- [Incident & Alert Templating](/docs/monitor/incident-alert-templating) — le variabili disponibili per gli incidenti dichiarati automaticamente.
