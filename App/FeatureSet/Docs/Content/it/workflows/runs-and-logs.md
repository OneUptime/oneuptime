# Esecuzioni e log

Ogni volta che il trigger di un workflow scatta, OneUptime crea un'**esecuzione** — un record di una singola esecuzione con tempistiche, stato e output nodo per nodo. Le esecuzioni sono il modo in cui confermi che un workflow ha funzionato, come fai debug di uno che non ha funzionato e come scrivi un postmortem quando un'automazione si comporta male.

## Dove trovarle

| Pagina | Scope |
| --- | --- |
| **Workflows → Esecuzioni e log** | A livello di progetto. Ogni esecuzione di ogni workflow. Filtra per workflow, stato e intervallo temporale. |
| **Scheda Logs di un workflow** | Solo le esecuzioni di questo workflow. |
| **Pagina di dettaglio di un'esecuzione** | Una singola esecuzione, espansa con l'output nodo per nodo e qualsiasi messaggio di errore. |

## Stati di esecuzione

| Stato | Significato |
| --- | --- |
| **Scheduled** | Il trigger è scattato e l'esecuzione è in coda, ma il worker non l'ha ancora presa in carico. Di solito una frazione di secondo. |
| **Running** | Il worker sta attualmente percorrendo il grafo. I componenti a lunga durata (chiamate HTTP lente, ritardi intenzionali) tengono un'esecuzione in questo stato. |
| **Success** | Ogni nodo eseguito è terminato senza errori. (Un workflow che ha preso un ramo `error` deliberatamente è comunque `Success` nel suo complesso — il workflow in sé non ha fallito.) |
| **Error** | Un nodo è fallito e non c'era una porta `error` cablata per gestirlo. L'esecuzione si è fermata a quel nodo. |
| **Timeout** | L'esecuzione ha superato il timeout per esecuzione. Vedi [Configurazione e sicurezza](/docs/workflows/configuration). |

## Leggere un'esecuzione

Clicca un'esecuzione dalla lista per aprirne la pagina di dettaglio. Vedrai:

- **Header** — il trigger che è scattato, i timestamp di inizio e fine, la durata totale, lo stato.
- **Elenco dei nodi** — ogni nodo eseguito in ordine, ciascuno con i suoi argomenti catturati, il suo valore di ritorno e la porta di output scelta.
- **Errori** — se un nodo è fallito, il messaggio di errore e (quando disponibile) lo stack trace.

Gli argomenti catturati mostrano i valori *post-interpolazione* — cioè le stringhe esatte che il nodo ha visto dopo che le variabili sono state risolte. Questa è la vista di debug singolarmente più utile: se un messaggio Slack contiene il testo letterale `{{Incident.title}}`, sai che il riferimento alla variabile non si è risolto.

## Pattern di debug comuni

### "Il mio workflow non è partito."

1. Conferma che il workflow sia **abilitato** in **Settings**. I nuovi workflow vengono spediti disabilitati.
2. Per un trigger su evento di modello: conferma che l'evento sia effettivamente accaduto. Apri l'entità (l'incidente, l'allarme, il monitor) e guarda la sua history.
3. Per un trigger webhook: conferma che il sistema esterno stia colpendo l'URL corretto. Molti tool loggano la consegna dei webhook in uscita — controlla lì.
4. Per un trigger schedulato: conferma che l'espressione cron si valuti all'orario che ti aspetti. Usa un parser cron in caso di dubbio.

Se il trigger è scattato ma non compare alcuna esecuzione, controlla la quota di esecuzioni del progetto in **Project Settings → Billing**.

### "Parte ma un nodo a valle non viene mai eseguito."

Un nodo che non viene eseguito è di solito un problema di cablaggio. Apri il canvas e controlla:

- La porta di output del nodo a monte è effettivamente collegata alla porta di input di questo nodo?
- Il nodo a monte ha preso una porta diversa (es. `error` invece di `success`, oppure `no` invece di `yes`)? Guarda il dettaglio dell'esecuzione per vedere quale porta ha scelto.

### "Una variabile arriva vuota."

Apri il dettaglio dell'esecuzione e guarda gli argomenti catturati del nodo che fallisce. Se vedi il testo letterale `{{NodeId.field}}`, il riferimento non si è risolto — probabilmente un refuso in `NodeId` o `field`. Se vedi una stringa vuota, il nodo a monte è stato eseguito ma non ha prodotto quel campo.

### "Funziona manualmente ma non dal trigger."

Usa **Esegui manualmente** con un payload JSON che riproduca ciò che il trigger reale pubblica. Poi confronta gli argomenti catturati nell'esecuzione manuale e in quella di produzione fianco a fianco — la differenza è di solito in un singolo nome di campo o tipo.

## Rieseguire un workflow

Non c'è un pulsante "ritenta questa esecuzione" — per scelta progettuale, OneUptime non riesegue mai una vecchia esecuzione, perché i side effect in uscita (messaggi Slack, chiamate API) potrebbero non essere idempotenti. Se vuoi rifare il lavoro, correggi il workflow e lascia che il prossimo trigger reale lo faccia partire.

Per i workflow manuali, basta cliccare **Esegui manualmente** con lo stesso payload.

## Conservazione dei log

Le esecuzioni vengono conservate a tempo indefinito sul progetto. Se devi fare pulizia su workflow rumorosi ad alto volume (es. un workflow di debug che parte ogni minuto), disabilitali o cancellali — non esiste un toggle di retention per workflow.

## Cosa leggere dopo

- [Configurazione e sicurezza](/docs/workflows/configuration) — timeout, limiti di ricorsione, oscuramento dei segreti.
- [Variabili](/docs/workflows/variables) — la sintassi usata dagli argomenti interpolati.
- [Componenti](/docs/workflows/components) — i campi di valori di ritorno che ogni componente pubblica.
