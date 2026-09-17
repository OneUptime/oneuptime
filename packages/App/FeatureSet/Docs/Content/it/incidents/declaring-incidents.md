# Dichiarare un incidente

Dichiarare un incidente è il momento in cui OneUptime inizia a tenere il conto. Viene creato un documento, gli viene impresso un numero, scattano le policy di reperibilità e — se non dite il contrario — gli iscritti alla vostra pagina di stato ne vengono informati. Tutto il resto del ciclo di vita dipende da quella prima scrittura.

Ci sono quattro modi in cui un incidente entra in OneUptime, e finiscono tutti nello stesso posto: una riga nella tabella `Incident` con una gravità, uno stato attuale e un elenco di risorse interessate. L'unica differenza è chi compila i campi — voi alle 3 del mattino, un modello salvato, i criteri di un monitor o il vostro codice che chiama l'API.

Questa pagina percorre tutti e quattro i modi, campo per campo, e poi spiega che cosa compila il server per voi e che cosa scatta nel momento in cui l'incidente esiste.

## Quattro modi per dichiarare un incidente

| Se volete…                                                   | Scegliete                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Aprire un incidente a mano, compilando tutto                 | La procedura guidata **Dichiara incidente**                                 |
| Aprire un tipo ricorrente di incidente con i campi già pronti | **Crea da modello**                                                        |
| Aprirne uno in automatico quando i controlli di un monitor falliscono | Un filtro nei criteri del monitor con **Quando i filtri corrispondono, dichiara un incidente.** |
| Aprirne uno dal vostro codice, da uno script o da un altro strumento | `POST /api/incident`                                                        |

Tutti e quattro scrivono lo stesso modello, quindi un incidente aperto da una sonda è identico a uno aperto a mano da chi risponde — a parte qualche colonna di servizio che il server imposta su quelli automatici.

## Dichiararne uno a mano

Aprite **Incidenti → Tutti gli incidenti** e fate clic su **Dichiara incidente** in alto a destra nell'elenco **Incidenti**. Si apre una scheda intitolata **Dichiara nuovo incidente**, che distribuisce il modulo su cinque passaggi: **Dettagli dell'incidente**, **Risorse interessate**, **Ruoli incidente**, **Reperibilità** e **Altro**. Anche il pulsante di invio finale riporta **Dichiara incidente**.

Solo il primo passaggio ha campi obbligatori. Se avete fretta, compilate **Dettagli dell'incidente** e inviate: risorse, ruoli e policy di reperibilità potete collegarli dopo, dalle pagine dell'incidente stesso.

### Passaggio 1 — Dettagli dell'incidente

- **Titolo** — obbligatorio. Il riassunto di una riga che tutti vedranno nell'elenco, su Slack e (se l'incidente è visibile) sulla vostra pagina di stato. Testo segnaposto: `Incident Title`.
- **Descrizione** — facoltativa, scritta in Markdown. È il campo che compare sulla pagina di stato, quindi scrivetelo per i clienti e non per il vostro team. Potete modificarlo in seguito da **Descrizione** nel menu laterale dell'incidente.
- **Dichiarato il** — obbligatorio nel modulo, preimpostato a ora. È il momento da cui viene misurata ogni durata dell'incidente, quindi retrodatatelo se state registrando qualcosa iniziato prima.
- **Gravità incidente** — obbligatoria. Una delle gravità configurate per il vostro progetto; i nuovi progetti nascono con **Critical Incident**, **Major Incident** e **Minor Incident**.
- **Stato incidente** — facoltativo. Lasciatelo stare e l'incidente atterra nello stato contrassegnato `isCreatedState`, che nei nuovi progetti è **Identified**. Impostatelo solo se state registrando un incidente già oltre quel punto.

**Se il menu a discesa degli stati fa i capricci.** Se nel vostro progetto nessuno stato porta il flag `isCreatedState`, la chiamata di creazione fallisce e vi dice di aggiungere uno stato di creazione dalle impostazioni. Normalmente succede solo su progetti i cui stati sono stati modificati parecchio — vedete [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

### Passaggio 2 — Risorse interessate

- **Risorse interessate** — un unico campo di ricerca che collega monitor, host, cluster Kubernetes, host Docker, host Podman e servizi. Sotto il cofano si tratta di relazioni distinte sull'incidente (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` e altre), ma il modulo le raccoglie in un unico selettore.
- **Change Monitor Status to** — facoltativo. Sceglie uno stato del monitor che viene applicato a ogni monitor collegato a questo incidente, così dichiarare l'incidente e segnare i monitor come degradati diventa un'azione sola invece di due.

**Collegate i monitor anche quando sembra superfluo.** Il legame tra un incidente e una pagina di stato passa dai monitor dell'incidente: una pagina di stato mostra un incidente quando una delle sue risorse è uno dei monitor dell'incidente. Una notifica di cambio stato agli iscritti viene saltata del tutto se l'incidente non ha monitor collegati. Vedete [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups).

### Passaggio 3 — Ruoli incidente

- **Assegna ruoli incidente** — assegnate i membri del team ai ruoli definiti dal vostro progetto. Alcuni ruoli accettano più di un utente.

I ruoli si configurano in **Incidenti → Impostazioni → Ruoli incidente**, dove definite i ruoli assegnabili durante la risposta — Comandante dell'incidente, responder e qualunque altro serva al vostro processo. Se saltate questo passaggio, al primo cambio di stato viene assegnato automaticamente un Comandante dell'incidente, se nessuno ricopre ancora il ruolo.

### Passaggio 4 — Reperibilità

- **Policy di reperibilità** — una selezione multipla delle policy di reperibilità da eseguire alla creazione di questo incidente. Corrisponde a `onCallDutyPolicies` sull'incidente.

È l'unico punto in cui una policy di reperibilità viene collegata direttamente a un incidente. Le gravità non portano con sé una policy: la gravità è un'etichetta e influenza la chiamata solo come *criterio di corrispondenza* dentro una regola di reperibilità. Le regole configurate in **Incidenti → Regole → Regole di reperibilità** aggiungono le loro policy a quelle che scegliete qui; l'insieme finale eseguito è l'unione delle due, senza duplicati.

### Passaggio 5 — Altro

- **Etichette** — facoltative e funzionalità avanzata: i membri del team che hanno accesso a queste etichette sono quelli che possono accedere all'incidente.
- **Notifica gli iscritti alla pagina di stato** — casella di spunta, attiva per impostazione predefinita. Controlla se gli iscritti ricevono un'e-mail sulla creazione dell'incidente (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Disattivatela per il rumore interno che volete comunque tenere agli atti.
- **Incidente privato** — casella di spunta, disattivata per impostazione predefinita (`isPrivate`). Un incidente privato è visibile solo ai suoi utenti proprietari, ai membri dei suoi team proprietari, agli amministratori e ai proprietari del progetto — ed è nascosto da ogni pagina di stato, qualunque sia il resto delle impostazioni. Nell'elenco degli incidenti li riconoscete da una pillola rossa **Private**.

Il flag **Should be visible on status page?** (`isVisibleOnStatusPage`) non compare nella procedura guidata; il valore predefinito è attivo. Modificatelo in seguito da **Impostazioni** nel menu laterale dell'incidente, dove è etichettato **Visibile sulla pagina di stato**.

## Dichiarare da un modello

Se dichiarate continuamente lo stesso tipo di incidente — stesso schema di titolo, stessa gravità, stessa policy di reperibilità — salvatelo una volta come modello.

Fate clic su **Crea da modello** (il pulsante con solo il contorno accanto a **Dichiara incidente**) e si apre una finestra **Crea incidente da modello**, con un menu a discesa **Seleziona modello di incidente**. Scegliete un modello e il modulo di creazione si apre già compilato; potete comunque cambiare qualsiasi cosa prima di inviare. Se il vostro progetto non ha ancora modelli, ottenete invece una finestra **No Incident Templates**, con un pulsante **Create Template** che vi porta in **Incidenti → Impostazioni → Modelli di incidenti**.

I modelli si costruiscono con una procedura guidata dedicata in sei passaggi — **Informazioni del modello**, **Dettagli dell'incidente**, **Risorse interessate**, **Reperibilità**, **Proprietari**, **Etichette** — con questi campi:

| Campo                        | A cosa serve                                           |
| ---------------------------- | ------------------------------------------------------ |
| **Nome del modello**            | Come il modello viene identificato nel selettore.          |
| **Descrizione del modello**     | Un promemoria per il voi futuro su quando usarlo. |
| **Titolo**                    | Il titolo precompilato sull'incidente.                       |
| **Descrizione**              | Descrizione Markdown precompilata sull'incidente.     |
| **Gravità incidente**        | Gravità precompilata sull'incidente.                 |
| **Stato iniziale dell'incidente**   | Lo stato in cui partono gli incidenti creati da questo modello.       |
| **Risorse interessate**       | Monitor, host, cluster e servizi da collegare.      |
| **Change Monitor Status to** | Stato del monitor da applicare ai monitor collegati.      |
| **Policy di reperibilità**           | Policy da eseguire alla creazione dell'incidente.      |
| **Proprietario - Team**            | I team proprietari degli incidenti creati da questo modello.   |
| **Proprietario - Utenti**            | Gli utenti proprietari degli incidenti creati da questo modello.   |
| **Etichette**                    | Etichette applicate all'incidente.                        |

Qualche regola rapida:

- I modelli non si modificano dall'elenco dei modelli — ne create uno, poi lo aprite per cambiarlo.
- Un modello compila solo i campi che avete lasciato vuoti. Nella pagina di creazione il modello viene applicato come precompilazione che potete sovrascrivere; via API, il server compila un campo dal modello solo quando la richiesta lo ha lasciato `undefined`. Quello che fornisce chi chiama vince sempre.

## Dichiarare in automatico dai criteri di un monitor

La maggior parte degli incidenti non dovrebbe richiedere che una persona li digiti. Nell'editor dei criteri di un monitor, attivate l'interruttore **Quando i filtri corrispondono, dichiara un incidente.** e compare una sezione **Crea incidente** con un pulsante **Aggiungi incidente** — un singolo filtro di criteri può dichiarare più di un incidente.

Ogni voce ha:

- **Titolo dell'incidente** — supporta i modelli; il segnaposto suggerisce qualcosa come `{{monitorName}} is down`.
- **Gravità** — obbligatoria.
- **Descrizione dell'incidente** — anch'essa con modelli.
- **Reperibilità → Policy di reperibilità** — le policy eseguite alla creazione di questo incidente.
- **Ruoli incidente** — preassegnate membri del team ai ruoli.
- **Ownership & Labels → Team proprietari**, **Utenti proprietari**, **Etichette**.
- **Opzioni avanzate → Risoluzione automatica dell'incidente** (risolve l'incidente in automatico quando i criteri smettono di corrispondere), **Mostra incidente sulla pagina di stato**, **Incidente privato** e **Note di rimedio**.

Per l'elenco completo dei segnaposto `{{variable}}` utilizzabili in titolo, descrizione e note di rimedio, vedete [Modelli di incidenti e avvisi](/docs/monitor/incident-alert-templating).

Gli incidenti creati così vengono etichettati dal server: viene impostato `isCreatedAutomatically`, `createdCriteriaId` registra quale filtro di criteri è scattato e `createdByProbe` registra quale sonda l'ha visto. Per tutto il resto si comportano esattamente come un incidente dichiarato a mano.

## Dichiarare tramite API

Il modello dell'incidente espone un endpoint CRUD standard, quindi `POST /api/incident` ne crea uno. Autenticatevi con una chiave API generata in **Impostazioni del progetto → Chiavi API**, inviata nell'intestazione `apikey` — la chiave identifica il progetto, quindi non serve passare separatamente un id di progetto.

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

- `title` — l'unico campo che dovete davvero fornire.
- `declaredAt` — qui facoltativo, anche se il modulo lo richiede. Omettetelo e il server usa l'ora corrente.
- `incidentSeverityId` e `currentIncidentStateId` — il server verifica che entrambi appartengano allo stesso progetto della chiave API e rifiuta la richiesta in caso contrario. Lo stesso controllo vale per lo stato del monitor dietro **Change Monitor Status to**.
- `createdIncidentTemplateId` — applica un modello salvato. Ogni campo che omettete viene compilato dal modello; ogni campo che inviate resta com'è.

Gli endpoint correlati sono `/api/incident-state`, `/api/incident-severity` e `/api/incident-state-timeline`. Il [riferimento API](/reference) generato riporta le forme esatte di richiesta e risposta per ciascuno, compreso il modo in cui vengono espressi i campi di relazione come i monitor.

## Numeri di incidente e prefissi

Ogni incidente riceve un numero sequenziale da un contatore per progetto, assegnato dal server al momento della creazione. Lo conservano due colonne: `incidentNumber` (l'intero grezzo) e `incidentNumberWithPrefix` (quello che vedete davvero). Senza prefisso configurato, il valore mostrato è `#42`.

Per cambiarlo, andate in **Incidenti → Impostazioni → Altre impostazioni**. La scheda **Prefisso del numero** ha un campo **Prefisso del numero dell'incidente** (fino a 20 caratteri, segnaposto `INC-`): impostatelo e lo stesso incidente viene mostrato come `INC-42`. Lasciatelo vuoto per mantenere il `#` predefinito. La scheda contiene anche **Prefisso del numero dell'episodio dell'incidente** per la numerazione degli episodi.

Il numero compare come prima colonna dell'elenco degli incidenti, rimanda all'incidente e appare come **Numero dell'incidente** nella **Panoramica** dell'incidente.

## Che cosa succede nel momento in cui un incidente viene dichiarato

La chiamata di creazione fa molto più che scrivere una riga. Nell'ordine:

1. **Il server riempie i vuoti.** `declaredAt` diventa l'ora corrente, lo stato attuale diventa lo stato `isCreatedState` del progetto, e numero e numero con prefisso vengono assegnati dal contatore del progetto.
2. **Viene applicato un modello**, se è stato fornito `createdIncidentTemplateId` — compilando solo i campi lasciati indefiniti da chi ha chiamato.
3. **Vengono eseguite le regole di privacy**, che marcano l'incidente come privato se una regola corrispondente lo prevede. È il primo motore di regole a partire, così tutto ciò che segue vede l'impostazione di privacy corretta.
4. **Vengono eseguite le regole del proprietario**, che aggiungono gli utenti e i team proprietari indicati dalle regole corrispondenti.
5. **Vengono eseguite le regole delle etichette**, che aggiungono le etichette corrispondenti all'incidente.
6. **Vengono eseguite le regole di reperibilità.** Ogni regola attiva in **Incidenti → Regole → Regole di reperibilità** i cui criteri corrispondono aggiunge le proprie policy all'incidente. Non c'è un ordine di priorità né un'interruzione anticipata: scattano tutte le regole corrispondenti e le policy vengono deduplicate.
7. **Vengono eseguite le regole di runbook**, che collegano e avviano i runbook corrispondenti. Vedete [Runbook](/docs/runbooks/index).
8. **Vengono eseguite le policy di reperibilità.** Ogni policy sull'incidente — scelta nella procedura guidata, ereditata da un modello o aggiunta da una regola — viene eseguita in parallelo con il tipo di evento `IncidentCreated`. Se una policy fallisce, le altre proseguono.
9. **Gli iscritti vengono messi in coda**, se **Notifica gli iscritti alla pagina di stato** è rimasta attiva e l'incidente è visibile sulla pagina di stato. La consegna è gestita da un job in background, non in linea con la vostra richiesta.
10. **Scattano i workflow.** Il trigger **On Create Incident** avvia qualsiasi workflow costruito su di esso. Vedete [Panoramica dei workflow](/docs/workflows/index).

Da lì in poi l'incidente è vivo: conta per il badge **Incidenti attivi** nel menu laterale di Incidenti (è attivo qualsiasi stato non contrassegnato `isResolvedState`), compare sulle pagine di stato che ospitano uno dei suoi monitor e la sua **Cronologia stato** inizia a registrare.

## Dove leggere ora

- [Panoramica degli incidenti](/docs/incidents/index) — come si incastrano i pezzi del modello dell'incidente.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — cosa fanno i flag di stato e come aggiungerne di vostri.
- [Note, proprietari e feed degli incidenti](/docs/incidents/notes-owners-and-feed) — note pubbliche, note private, proprietari e feed delle attività.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings) — modelli, campi personalizzati, ruoli, regole e trigger dei workflow.
- [Iscritti e annunci](/docs/status-pages/subscribers) — chi viene informato dell'incidente che avete appena dichiarato.
- [Modelli di incidenti e avvisi](/docs/monitor/incident-alert-templating) — le variabili disponibili per gli incidenti dichiarati in automatico.
