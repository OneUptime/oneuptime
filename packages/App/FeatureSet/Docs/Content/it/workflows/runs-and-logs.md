# Esecuzioni e log

Ogni volta che un workflow parte, OneUptime salva un resoconto di quello che è successo: quando è stato eseguito, se ha funzionato e che cosa ha fatto ciascun blocco. Quel resoconto si chiama **esecuzione** (run). Le esecuzioni ti servono per confermare che un workflow ha funzionato, per capire perché uno non ha funzionato e per rileggere l'attività passata.

## Dove trovarle

| Pagina                                       | Che cosa vedi                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Flussi di lavoro → Esecuzioni e registri** | Tutte le esecuzioni di tutti i workflow del progetto. Filtra per nome del workflow, stato e periodo. |
| **Flusso di lavoro → Esecuzioni e registri** | Solo le esecuzioni di questo workflow. Qui, al posto del filtro per workflow, c'è un filtro **ID esecuzione**. |
| **Una singola esecuzione**                   | Si apre con il pulsante **Visualizza log** su una riga di esecuzione — le righe in sé non sono cliccabili. |

## Stati di un'esecuzione

| Stato                              | Che cosa significa                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled**                      | Il trigger è scattato e l'esecuzione è in coda in attesa di un runner. Di solito dura una frazione di secondo. Un'esecuzione ancora in questo stato dopo 5 minuti è fallita: non l'ha presa in carico nessuno. |
| **Running**                        | Il workflow è in corso. I blocchi lenti tengono l'esecuzione in questo stato.                                                                             |
| **Waiting**                        | L'esecuzione è parcheggiata su un blocco **Sleep** e riprenderà da sola. Mentre aspetta non occupa nessun worker.                                          |
| **Executed**                       | L'esecuzione è arrivata in fondo senza fallire. (È questo lo stato di successo — la pillola dice **Executed**, non "Success".)                             |
| **Error**                          | L'esecuzione si è fermata perché un blocco ha sollevato un errore. Vale anche quando un'esecuzione in coda non viene mai presa in carico, quando si perde la ripresa di un'esecuzione addormentata, quando un'espressione di pianificazione non si riesce a risolvere, o quando il workflow viene disabilitato a metà esecuzione. |
| **Timeout**                        | L'esecuzione è durata più a lungo di quanto consentito. Vedi [Configurazione e sicurezza del workflow](/docs/workflows/configuration).                     |
| **Execution Exceeded Current Plan** | Il progetto ha esaurito le esecuzioni di workflow degli ultimi 30 giorni, oppure l'abbonamento non è pagato. L'esecuzione viene registrata ma non eseguita. Solo su OneUptime Cloud. |

Un blocco che esce dal suo output **Error** — per esempio un blocco API su una risposta 4xx — non fa fallire l'esecuzione. Il ramo di errore viene eseguito e l'esecuzione si chiude comunque come **Executed**. Il passaggio, però, resta disegnato in rosso, così lo trovi a colpo d'occhio.

## Leggere un'esecuzione

Clicca **Visualizza log** su un'esecuzione per aprirla. La vista **Workflow Run** ha due schede.

**Passaggi** — una riga per ogni blocco eseguito, in ordine. Ogni riga mostra il titolo del blocco, il suo component id, quanto ci ha messo e l'output da cui è uscito (`→ success`, `→ error`, `→ yes`). Espandi una riga per vedere due blocchi di dettaglio:

- **Received** — le impostazioni con cui il blocco è stato eseguito, dopo che tutte le variabili sono state risolte.
- **Returned** — quello che ha prodotto.

I passaggi falliti sono rossi e si aprono già espansi, con il messaggio di errore stampato sopra **Received**.

**Full Log** — il log grezzo riga per riga scritto dal runner, comprese le righe che i blocchi hanno registrato per conto loro. Usalo quando la scheda **Passaggi** non basta a spiegare il fallimento.

Due dettagli che vale la pena conoscere. Il component id stampato sotto il titolo di ogni passaggio è esattamente la stringa da incollare in un riferimento `{{local.components.<id>.returnValues.…}}`, ed è quindi il modo più rapido per scriverne uno giusto. E un'esecuzione conserva solo i suoi ultimi 100 passaggi: un'esecuzione lunga, o ripresa molte volte, mostra una nota ambra nel punto in cui i passaggi più vecchi sono stati scartati.

I valori che vedi sono quelli che il blocco ha ricevuto dopo la sostituzione delle variabili, con due eccezioni: i segreti e i campi che il blocco marca come sensibili vengono oscurati, e i valori molto lunghi sono tagliati con "… (truncated)".

Se avvii un'esecuzione dal **Costruttore**, si apre questa stessa vista già agganciata all'esecuzione, così la guardi mentre succede invece di andartela a cercare dopo.

## Debug delle situazioni più comuni

### "Il mio workflow non è partito."

1. Verifica che il workflow sia **Abilitato** nella sua pagina **Panoramica**. I workflow nuovi nascono disabilitati, e un workflow disabilitato rifiuta ogni esecuzione, comprese quelle manuali.
2. Se il trigger è un evento di OneUptime: controlla che l'evento sia davvero avvenuto. Apri il record e guarda la sua cronologia.
3. Se il trigger è un webhook: controlla che l'altro sistema stia chiamando l'URL giusto. Quasi tutti gli strumenti registrano l'invio di un webhook — guarda lì.
4. Se il trigger è una pianificazione: controlla che l'espressione cron corrisponda all'orario che ti aspetti.

Se invece l'esecuzione *compare*, con lo stato **Execution Exceeded Current Plan**, il progetto ha esaurito le esecuzioni di workflow degli ultimi 30 giorni oppure l'abbonamento non è pagato. Il log dell'esecuzione riporta il conteggio e il limite del tuo piano. Vale solo su OneUptime Cloud.

### "Un blocco successivo non è mai stato eseguito."

Quando un blocco non viene eseguito, di solito è un problema di collegamenti. Apri il **Costruttore** e controlla:

- L'output del blocco precedente è collegato all'input di questo blocco?
- Il blocco precedente è uscito da un output diverso da quello che ti aspettavi — **Error** invece di **Success**, oppure **No** invece di **Yes**? La scheda **Passaggi** ti dice da quale è uscito.

### "Una variabile è arrivata vuota."

Apri l'esecuzione e guarda il blocco **Received** del passaggio fallito.

- Se vedi il testo `{{local.components.…}}` così com'è, il riferimento non è stato risolto. Di solito è un errore di battitura nel component id o nell'id del valore di ritorno — ricorda che conta l'**Identifier** del blocco, non il nome mostrato sopra di esso. Controlla anche come hai scritto `local.components`: `{{local.componets.api-get-1.returnValues.response-body}}` viene inviato come testo letterale e l'esecuzione si chiude comunque come **Executed**.
- Se vedi una stringa vuota, il blocco precedente è stato eseguito ma non ha prodotto quel campo.

La scheda **Full Log** contiene una riga di avviso con il nome di ogni riferimento rimasto irrisolto, ed è quasi sempre il modo più veloce per trovarlo.

### "A mano funziona, dal trigger no."

Apri il **Costruttore**, clicca **Esegui flusso di lavoro** e riempi i campi del trigger con valori simili a quelli che manda il trigger vero. Poi confronta i valori **Received** di quell'esecuzione con quelli dell'esecuzione reale, uno accanto all'altro. La differenza è quasi sempre il nome o il tipo di un singolo campo.

## Rieseguire un workflow

Non esiste un pulsante "riprova questa esecuzione". Non rieseguiamo automaticamente le esecuzioni passate perché i loro effetti collaterali — messaggi Slack, chiamate API, ticket — potrebbero non essere sicuri da ripetere. Per rifare il lavoro, correggi il workflow e lascia che sia il prossimo trigger reale a farlo partire, oppure apri il **Costruttore** e clicca **Esegui flusso di lavoro** con gli stessi valori.

## Per quanto tempo vengono conservate le esecuzioni?

Su OneUptime Cloud le esecuzioni si conservano per **30 giorni** e poi vengono eliminate — è per questo che entrambi gli elenchi si presentano come relativi agli ultimi 30 giorni. Le installazioni self-hosted le tengono finché non le elimini tu; se un workflow parte molto spesso e ti intasa la cronologia, disabilitalo o eliminalo per smettere di aggiungere rumore.

Le esecuzioni registrate prima dell'arrivo del tracciamento dei passaggi non hanno contenuto in **Passaggi** e mostrano solo il loro **Full Log**.

## Cosa leggere dopo

- [Configurazione e sicurezza del workflow](/docs/workflows/configuration) — timeout, limiti di ricorsione, segreti nascosti.
- [Variabili del workflow](/docs/workflows/variables) — la sintassi delle variabili che usi nei blocchi.
- [Componenti del workflow](/docs/workflows/components) — che cosa produce ogni blocco.
