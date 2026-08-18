# Esecuzioni e log

Ogni volta che un workflow viene eseguito, OneUptime salva un record di ciò che è successo — quando è stato eseguito, se ha funzionato e cosa ha fatto ciascun blocco. Quel record si chiama **esecuzione** (run). Le esecuzioni servono per confermare che un workflow ha funzionato, per fare il debug di uno che non ha funzionato e per rivedere l'attività passata.

## Dove trovarle

| Pagina                        | Cosa vedi                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Workflows → Runs & Logs** | Ogni esecuzione di ogni workflow nel progetto. Filtra per nome del workflow, stato e periodo.           |
| **Workflow → Runs & Logs**  | Solo le esecuzioni di questo workflow. Qui c'è un filtro **Run ID** al posto del filtro per workflow.  |
| **Una singola esecuzione**            | Si apre con il pulsante **View Logs** su una riga di esecuzione — le righe di esecuzione stesse non sono cliccabili.           |

## Stati di un'esecuzione

| Stato                             | Cosa significa                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled**                      | Il trigger è scattato e l'esecuzione è in coda per un runner. Di solito una frazione di secondo. Un'esecuzione ancora in Scheduled dopo 5 minuti è fallita — nessuno l'ha presa in carico. |
| **Running**                        | Il workflow è in corso. I blocchi a lunga esecuzione mantengono un'esecuzione in questo stato.                                                                                |
| **Waiting**                        | L'esecuzione è ferma su un blocco **Sleep** e riprenderà da sola. Non occupa un worker mentre attende.                                                      |
| **Executed**                       | L'esecuzione è arrivata alla fine senza fallire. (Questo è lo stato di successo — l'etichetta riporta **Executed**, non "Success".)                                                        |
| **Error**                          | L'esecuzione si è fermata perché un blocco ha generato un errore. Usato anche quando un'esecuzione in coda non viene mai presa in carico, quando la ripresa di un'esecuzione in sleep va persa, quando un'espressione di pianificazione non può essere risolta, o quando il workflow viene disabilitato a metà esecuzione. |
| **Timeout**                        | L'esecuzione è durata più a lungo di quanto consentito. Vedi [Configuration & Safety](/docs/workflows/configuration).                                                              |
| **Execution Exceeded Current Plan** | Il progetto ha esaurito le esecuzioni di workflow degli ultimi 30 giorni, oppure l'abbonamento non è pagato. L'esecuzione viene registrata ma non eseguita. Solo su OneUptime Cloud. |

Un blocco che passa alla sua uscita **Error** — ad esempio un blocco API su una risposta 4xx — non fa fallire l'esecuzione. Il ramo di errore viene eseguito e l'esecuzione termina comunque come **Executed**. Il passaggio stesso viene comunque disegnato in rosso, così puoi individuarlo.

## Leggere un'esecuzione

Clicca su **View Logs** su un'esecuzione per aprirla. La vista **Workflow Run** ha due schede.

**Steps** — una riga per ogni blocco eseguito, in ordine. Ogni riga mostra il titolo del blocco, il suo component id, quanto tempo ha impiegato e l'uscita che ha preso (`→ success`, `→ error`, `→ yes`). Espandi una riga per due blocchi di dettaglio:

- **Received** — le impostazioni fornite al blocco, dopo che tutte le variabili sono state risolte.
- **Returned** — ciò che ha prodotto.

I passaggi falliti sono rossi e partono già espansi, con il messaggio di errore stampato sopra **Received**.

**Full Log** — il log grezzo riga per riga stampato dal runner, incluso tutto ciò che i blocchi hanno registrato da soli. Usalo quando la vista Steps non spiega il fallimento.

Due dettagli utili da sapere. Il component id stampato sotto il titolo di ogni passaggio è esattamente la stringa da incollare in un riferimento `{{local.components.<id>.returnValues.…}}`, il che lo rende il modo più veloce per ottenere un riferimento corretto. E un'esecuzione conserva solo i suoi ultimi 100 passaggi — un'esecuzione lunga o ripresa più volte mostra una nota ambra dove i passaggi precedenti sono stati scartati.

I valori mostrati sono quelli visti dal blocco dopo che le variabili sono state riempite, con due eccezioni: i segreti e i campi che il blocco contrassegna come sensibili sono oscurati, e i valori molto lunghi vengono troncati con "… (truncated)".

Avviare un'esecuzione dal **Builder** apre questa stessa vista già seguendo l'esecuzione, così puoi guardarla accadere invece di doverla cercare in seguito.

## Debug comune

### "Il mio workflow non è stato eseguito."

1. Assicurati che il workflow sia **Enabled** nella sua pagina **Overview**. I nuovi workflow partono disabilitati, e un workflow disabilitato rifiuta ogni esecuzione — comprese quelle manuali.
2. Per un trigger di evento OneUptime: conferma che l'evento sia effettivamente avvenuto. Apri il record e controlla la sua cronologia.
3. Per un trigger webhook: conferma che l'altro sistema stia inviando all'URL giusto. La maggior parte degli strumenti registra quando invia un webhook — controlla lì.
4. Per un trigger di pianificazione: conferma che l'espressione cron corrisponda all'orario che ti aspetti.

Se l'esecuzione *appare* con lo stato **Execution Exceeded Current Plan**, il progetto ha esaurito tutte le sue esecuzioni di workflow degli ultimi 30 giorni, oppure l'abbonamento non è pagato. Il log dell'esecuzione riporta il conteggio e il limite del tuo piano. Questo vale solo per OneUptime Cloud.

### "Un blocco successivo non è mai stato eseguito."

Un blocco che non viene eseguito è solitamente un problema di collegamento. Apri il **Builder** e controlla:

- L'uscita del blocco precedente è collegata all'ingresso di questo blocco?
- Il blocco precedente ha preso un'uscita diversa da quella che ti aspettavi — **Error** invece di **Success**, oppure **No** invece di **Yes**? La scheda Steps mostra quale ha preso.

### "Una variabile è arrivata vuota."

Apri l'esecuzione e guarda il blocco **Received** del passaggio fallito.

- Se vedi il testo letterale `{{local.components.…}}`, il riferimento non si è risolto. Di solito è un errore di battitura nel component id o nell'id del return value — ricorda che è l'**Identifier** del blocco, non il nome visualizzato su di esso. Controlla l'ortografia anche di `local.components` stesso: `{{local.componets.api-get-1.returnValues.response-body}}` viene inviato come testo letterale e l'esecuzione riporta comunque **Executed**.
- Se vedi una stringa vuota, il blocco precedente è stato eseguito ma non ha prodotto quel campo.

La scheda **Full Log** riporta una riga di avviso che nomina qualsiasi riferimento non risolto, il che di solito è il modo più veloce per trovarlo.

### "Funziona quando lo eseguo a mano ma non dal trigger."

Apri il **Builder**, clicca su **Run Workflow** e compila i campi del trigger con valori simili a quelli che invia il trigger reale. Poi confronta i valori **Received** di quell'esecuzione con quelli dell'esecuzione reale, fianco a fianco. La differenza è di solito un singolo nome di campo o tipo.

## Rieseguire un workflow

Non esiste un pulsante "riprova questa esecuzione". Non rieseguiamo automaticamente le esecuzioni passate perché gli effetti collaterali — messaggi Slack, chiamate API, ticket — potrebbero non essere sicuri da ripetere. Per rifare il lavoro, correggi il workflow e lascia che sia il prossimo trigger reale a farlo scattare, oppure apri il **Builder** e clicca su **Run Workflow** con gli stessi valori.

## Per quanto tempo vengono conservate le esecuzioni?

Su OneUptime Cloud, le esecuzioni vengono conservate per **30 giorni** e poi eliminate — per questo entrambi gli elenchi di esecuzioni si descrivono come relativi agli ultimi 30 giorni. Le installazioni self-hosted conservano le esecuzioni finché non le elimini tu; se un workflow viene eseguito molto spesso e affolla la cronologia, disabilitalo o eliminalo per smettere di aggiungere rumore.

Le esecuzioni registrate prima dell'introduzione del tracciamento dei passaggi non hanno contenuto in **Steps** e mostrano solo il loro **Full Log**.

## Cosa leggere dopo

- [Configurazione e sicurezza del workflow](/docs/workflows/configuration) — timeout, limiti di ricorsione, segreti nascosti.
- [Variabili del workflow](/docs/workflows/variables) — la sintassi delle variabili usata nei tuoi blocchi.
- [Componenti del workflow](/docs/workflows/components) — cosa produce ciascun blocco.
