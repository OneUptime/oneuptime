# Esecuzioni e log

Ogni volta che un workflow viene eseguito, OneUptime salva un record di cio che e accaduto — quando e stato eseguito, se ha funzionato e cosa ha fatto ciascun blocco. Quel record si chiama **esecuzione**. Le esecuzioni sono il modo in cui confermi che un workflow ha funzionato, fai debug di uno che non ha funzionato e ripercorri l'attivita passata.

## Dove trovarle

| Pagina | Cosa vedi |
| --- | --- |
| **Workflows → Esecuzioni e log** | Ogni esecuzione di ogni workflow del progetto. Filtra per workflow, stato e intervallo temporale. |
| **Workflow → Scheda Logs** | Solo le esecuzioni di questo specifico workflow. |
| **Una singola esecuzione** | Una sola esecuzione, con l'output di ogni blocco. |

## Stati delle esecuzioni

| Stato | Cosa significa |
| --- | --- |
| **Scheduled** | Il trigger e scattato e l'esecuzione sta per iniziare. Di solito richiede solo una frazione di secondo. |
| **Running** | Il workflow e in corso. I blocchi di lunga durata mantengono un'esecuzione in questo stato. |
| **Success** | Ogni blocco eseguito si e concluso senza errori. (Prendere un ramo **error** intenzionalmente conta comunque come successo — il workflow in se non ha fallito.) |
| **Error** | Un blocco e fallito e non c'era un percorso **error** collegato per gestirlo. L'esecuzione si e fermata li. |
| **Timeout** | L'esecuzione ha richiesto piu tempo di quello consentito. Vedi [Configurazione e sicurezza](/docs/workflows/configuration). |

## Leggere un'esecuzione

Clicca su una qualsiasi esecuzione per aprirne i dettagli. Vedrai:

- **Header** — il trigger, l'ora di inizio e fine, la durata totale e lo stato.
- **Elenco dei blocchi** — ogni blocco eseguito, in ordine. Ognuno mostra i valori che ha ricevuto, il suo output e quale percorso ha preso.
- **Errori** — se un blocco e fallito, il messaggio di errore e (quando disponibile) maggiori dettagli.

I valori mostrati sono esattamente quelli che il blocco ha visto — dopo che tutte le variabili sono state risolte. Questa e la singola vista di debug piu utile: se un messaggio Slack mostra il testo letterale `{{Incident.title}}` invece del titolo reale, sai che la variabile non e stata risolta.

## Debug comune

### "Il mio workflow non e stato eseguito."

1. Assicurati che il workflow sia **abilitato** in Settings. I nuovi workflow partono disabilitati.
2. Per un trigger su evento di OneUptime: conferma che l'evento sia effettivamente accaduto. Apri il record e controllane la cronologia.
3. Per un trigger webhook: conferma che l'altro sistema stia inviando all'URL corretto. La maggior parte degli strumenti registra quando invia un webhook — controlla li.
4. Per un trigger pianificato: verifica che l'espressione cron corrisponda all'orario previsto.

Se il trigger e scattato ma non appare alcuna esecuzione, controlla la tua quota di esecuzioni sotto **Project Settings → Billing**.

### "Un blocco successivo non e mai stato eseguito."

Un blocco che non viene eseguito di solito e un problema di collegamento. Apri il canvas e controlla:

- L'output del blocco precedente e collegato all'input di questo blocco?
- Il blocco precedente ha preso un output diverso da quello che ti aspettavi (per esempio, **error** invece di **success**, o **No** invece di **Yes**)? Il dettaglio dell'esecuzione mostra quale percorso e stato preso.

### "Una variabile e arrivata vuota."

Apri l'esecuzione e guarda i valori del blocco che fallisce.

- Se vedi il testo letterale `{{BlockName.field}}`, il riferimento non e stato risolto — probabilmente un errore di battitura nel nome del blocco o del campo.
- Se vedi una stringa vuota, il blocco precedente e stato eseguito ma non ha prodotto quel campo.

### "Funziona quando lo eseguo manualmente ma non dal trigger."

Usa **Run Manually** con un payload JSON che assomigli a cio che invia il trigger reale. Poi confronta i valori dell'esecuzione manuale con quelli dell'esecuzione reale, fianco a fianco. La differenza e di solito il nome o il tipo di un singolo campo.

## Rieseguire un workflow

Non c'e un pulsante "ritenta questa esecuzione." Non rieseguiamo le esecuzioni passate automaticamente perche gli effetti collaterali (messaggi Slack, chiamate API, ticket) potrebbero non essere sicuri da ripetere. Per rifare il lavoro, correggi il workflow e lascia che il prossimo trigger reale lo avvii.

Per i workflow manuali, basta cliccare **Run Manually** con lo stesso payload.

## Per quanto tempo vengono mantenute le esecuzioni?

Le esecuzioni vengono mantenute a tempo indeterminato per il progetto. Se un workflow viene eseguito molto spesso e ingombra la tua cronologia (come un workflow di debug che scatta ogni minuto), disabilitalo o eliminalo per smettere di contribuire al rumore.

## Letture successive

- [Configurazione e sicurezza](/docs/workflows/configuration) — timeout, limiti di ricorsione, segreti nascosti.
- [Variabili](/docs/workflows/variables) — la sintassi delle variabili usata nei tuoi blocchi.
- [Componenti](/docs/workflows/components) — cosa produce ciascun blocco.
