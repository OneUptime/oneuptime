# Configurazione e sicurezza

Questa pagina raccoglie le impostazioni e i limiti di sicurezza che vale la pena conoscere prima di puntare un workflow sul traffico di produzione.

## Abilita / disabilita

Ogni workflow ha un flag **isEnabled** in **Settings**. I workflow disabilitati non scattano mai — eventi di modello, webhook ed esecuzioni schedulate vengono ignorati. I nuovi workflow vengono spediti disabilitati.

Tratta questo come il tuo interruttore "pronto per la prod":

1. Costruisci il workflow.
2. Clicca **Esegui manualmente** con un payload rappresentativo.
3. Controlla i **Log** — conferma che ogni nodo abbia preso la porta che ti aspettavi.
4. Attiva **isEnabled**.

Disabilitare un workflow non influisce sulle esecuzioni già in volo; ferma solo la creazione di nuove.

## Ownership e label

- **Owners** — gli utenti e i team elencati come owner ricevono accesso basato sui permessi e (opzionalmente) notifiche quando il workflow fallisce. Configura in **Settings → Owners**.
- **Labels** — tag many-to-many per organizzare i workflow. Filtra l'elenco dei workflow per label. Utile quando un progetto ha decine di workflow organizzati per team, per integrazione o per ambiente.
- **Label rules** — in **Workflows → Settings → Label Rules**, applica automaticamente label ai nuovi workflow in base a match regex su nome o descrizione.
- **Owner rules** — in **Workflows → Settings → Owner Rules**, assegna automaticamente owner ai nuovi workflow.

## Segreti

Le variabili globali possono essere marcate come **secret**. Il valore è cifrato a riposo, in sola scrittura nell'interfaccia dopo il salvataggio e oscurato dai log delle esecuzioni (sostituito con `[REDACTED]`).

Usa le variabili segrete per:

- Chiavi API per integrazioni in uscita.
- Bearer token.
- Chiavi di firma dei webhook.
- Qualsiasi valore che un attaccante con accesso in lettura a un workflow non dovrebbe vedere.

Non incollare un segreto direttamente nell'argomento di un componente — riferimenti come `Authorization: Bearer eyJh...` compaiono nel JSON del workflow e nei log delle esecuzioni in chiaro. Referenzia invece `{{variable.MY_SECRET}}`.

## Timeout per esecuzione

Ogni esecuzione ha una durata massima. Se un'esecuzione non termina entro il timeout, viene marcata come `Timeout` e ogni componente in volo viene cancellato. Il default è generoso (minuti, non secondi) — consulta la configurazione di ambiente del worker per il valore esatto nella tua installazione.

La maggior parte dei componenti ha i propri timeout per chiamata dentro il timeout di esecuzione — es. il componente API si arrende su una richiesta in uscita bloccata ben prima che lo faccia l'intera esecuzione.

## Limite di ricorsione

Il componente **Execute Workflow** consente a un workflow di chiamarne un altro. Per prevenire loop incontrollati dove A chiama B che chiama A all'infinito, il worker traccia la catena di chiamate e ferma una catena che supera una profondità fissa (tipicamente un numero piccolo come 5). L'esecuzione che termina viene marcata come `Error` con un messaggio chiaro sul limite di ricorsione.

Se hai un'esigenza legittima per una catena lunga (es. una visita ricorsiva di cartelle che processa un livello per esecuzione), rifattorizzala in un singolo workflow che itera internamente tramite **Custom Code** — quel pattern non è soggetto al limite di catena.

## Sicurezza dei webhook

I trigger webhook espongono un URL HTTPS univoco. Chiunque scopra l'URL può colpirlo. Per difenderti da chiamanti accidentali o ostili:

- Tratta l'URL come un segreto condiviso. Non incollarlo in chat pubbliche né committarlo in un repo pubblico.
- Per i workflow ad alto valore, chiedi al sistema chiamante di includere un segreto condiviso come header (es. `X-Webhook-Token`) e validalo in un nodo **Conditions** prima di fare qualsiasi cosa distruttiva. Definisci il token atteso come variabile globale segreta.
- Per i workflow a valore molto alto, preferisci un trigger su evento di modello e un passo di import manuale invece di un webhook pubblico.

## Egress di rete in uscita

I componenti API e altri stile HTTP inviano richieste dalla rete del Workflow Worker di OneUptime. Se ospiti OneUptime in self-hosting, la rete in uscita del worker è affar tuo — assicurati che possa raggiungere le API di terze parti che chiami. Se usi OneUptime Cloud, il nostro range di IP egress è pubblicato in [IP Addresses](/docs/configuration/ip-addresses) così puoi inserirlo in allowlist sul lato ricevente.

## Permessi

I workflow sono risorse di prima classe soggette al controllo accessi basato sui ruoli a livello di progetto:

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — i quattro permessi CRUD sui modelli di workflow.
- `RunWorkflow` — necessario per cliccare **Esegui manualmente** o per dispatchare un workflow via API.
- `ReadWorkflowLog` — necessario per vedere la pagina **Esecuzioni e log**.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — controllo sull'elenco delle variabili globali.

La maggior parte degli ingegneri dovrebbe avere create/edit/read sui workflow ma non sulle variabili. Riserva l'accesso in modifica alle variabili alle persone che gestiscono i segreti del tuo progetto.

## Quote

OneUptime Cloud limita il numero di esecuzioni al mese per progetto sui piani più piccoli. Il limite è mostrato in **Project Settings → Billing**. Quando lo raggiungi, i nuovi trigger vengono rifiutati (e registrati con una ragione "quota exceeded" sul workflow interessato) fino al ciclo di fatturazione successivo. Le installazioni in self-hosting non sono soggette a quota.

## Per cosa i workflow *non* sono indicati

Alcuni pattern per cui dovresti rivolgerti a un altro strumento:

- **Computazione a lunga durata** — i workflow sono orientati al collante tra sistemi, non a macinare grossi dataset. Esegui il lavoro pesante nella tua infrastruttura e usa un workflow per farlo partire.
- **Workflow stateful che durano minuti/ore** — una singola esecuzione è pensata per terminare velocemente. Se devi "fai la cosa A, poi attendi due ore, poi fai la cosa B", modella l'attesa come uno scheduler esterno che ripiomba su un trigger webhook.
- **Risposta agli incidenti passo-passo con checkpoint umani** — è per questo che esistono i [Runbook](/docs/runbooks/index). Usa un workflow se non c'è un essere umano nel loop; usa un runbook se c'è.

## Cosa leggere dopo

- [Panoramica dei workflow](/docs/workflows/index) — la mappa concettuale.
- [Componenti](/docs/workflows/components) — i dettagli degli argomenti per ogni azione.
- [Runbook](/docs/runbooks/index) — quando usare un runbook al posto del workflow.
