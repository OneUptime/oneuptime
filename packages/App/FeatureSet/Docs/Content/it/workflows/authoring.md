# Creare un workflow

Per creare un workflow, apri **Flussi di lavoro** e clicca **Crea flusso di lavoro**. Ti accompagna una procedura guidata intitolata **Create a workflow**: prima **Start from**, poi **Name**, e infine il passaggio **Configure**, che compare solo se il modello che hai scelto richiede impostazioni proprie.

In **Start from** scegli come cominciare:

- **Parti da zero**, accanto alla casella di ricerca, ti dà un'area di lavoro vuota.
- Un modello ti dà un workflow già funzionante da modificare. Il passaggio si apre su alcuni modelli in **Consigliati**. Gli altri sono nelle loro categorie, come **Incidenti**, **Monitor** e **Jira**, ciascuna con il numero dei suoi modelli, e **Tutti i modelli** li elenca tutti. Una ricerca li scorre tutti: ogni parola che scrivi deve corrispondere, e ogni categoria mostra quanti dei suoi modelli corrispondono.

Clicca un modello per vedere cosa fa prima di sceglierlo: il suo trigger, i passaggi che lo compongono e le impostazioni che ti chiederà. **Usa questo modello** lo porta a **Name**, e lo stesso fanno **Invio** e un doppio clic. I tasti freccia ti spostano nell'elenco, e `/` ti riporta alla casella di ricerca.

Una volta creato, apri **Costruttore** nel menu di sinistra: è la tela su cui progetti il workflow.

## La tela

Un workflow partito da zero si apre con un unico blocco tratteggiato che dice **Choose what starts this workflow**. Quel blocco è il punto di partenza — cliccalo per scegliere un trigger. Un workflow nato da un modello si apre invece con i blocchi già al loro posto.

Ogni workflow ha un solo **trigger**, in cima. Tutto il resto è un **component**, cioè un blocco che fa qualcosa. Se aggiungi un secondo trigger, questo sostituisce il primo; se elimini l'ultimo, torna il segnaposto tratteggiato.

Per aggiungere i blocchi:

- **Il trigger** — clicca il blocco segnaposto tratteggiato. Si apre un pannello intitolato **Add Trigger**.
- **Tutto il resto** — clicca **Aggiungi componente** nella barra degli strumenti sopra la tela. Si apre lo stesso pannello, questa volta intitolato **Add Component**.

Entrambi i pannelli si aprono sui blocchi che usa quasi ogni workflow, sotto **Popular**, seguiti dagli altri blocchi integrati. Sotto **OneUptime resources** clicca una risorsa come **Incident** per vedere che cosa puoi farci; **Browse all resources** le elenca tutte. Oppure cerca: scrivi qualche parola, come `create incident`, e il risultato più vicino compare per primo. Premi `/` per saltare alla casella di ricerca, le frecce per muoverti tra i risultati e **Invio** per aggiungere il blocco evidenziato. Un clic su un blocco lo aggiunge.

Un blocco nuovo compare sotto il blocco più in basso della tela, e un trigger nuovo prende in alto il posto del vecchio. Il blocco nuovo è selezionato e, se compare fuori vista, la tela scorre quel tanto che basta per mostrarlo. Le sue impostazioni non si aprono da sole: clicca il blocco quando sei pronto a configurarlo. Finché le impostazioni obbligatorie sono vuote, il blocco mostra **Click to set up**. Trascina i blocchi dove vuoi; mentre li sposti la tela li aggancia a una griglia. Le posizioni dei blocchi vengono salvate, così chi apre il workflow dopo di te ritrova la disposizione che hai lasciato.

Le modifiche si salvano da sole. Una pillola nella barra degli strumenti tiene il conto: **Saving…** mentre la modifica è in volo, poi **Salvato**, oppure **Impossibile salvare** se qualcosa è andato storto. Non c'è un pulsante di salvataggio, e non c'è un passaggio di pubblicazione a parte.

## Cosa c'è su un blocco

| Campo                              | Che cosa fa                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (sotto **ID**)      | L'id breve stampato sul blocco, tipo `log-1`. È il nome con cui gli altri blocchi lo richiamano: se lo rinomini, rompi ogni riferimento `{{local.components.…}}` che punta a questo blocco. L'intestazione del blocco, invece, è il nome del componente stesso e non si può cambiare. |
| **Settings**                       | Quello che serve al blocco per fare il suo lavoro — un URL, un canale Slack, il testo di un messaggio. I campi facoltativi sono contrassegnati con **(Optional)**; tutti gli altri sono obbligatori. Le impostazioni meno usate stanno sotto la sezione **Advanced**. |
| **Input**                          | Il puntino sul bordo superiore, dove arrivano le linee dai blocchi precedenti. I trigger non ce l'hanno — prima di loro non viene eseguito nulla.                                                            |
| **Outputs**                        | I puntini lungo il bordo inferiore, con l'etichetta appena sopra, da cui partono le linee verso i blocchi successivi. Molti blocchi hanno un output **Success** e uno **Error** separati, così puoi gestire entrambi i casi. |

## Collegare i blocchi

Trascina da un puntino sul fondo di un blocco fino al puntino in cima a quello successivo. La linea che tracci decide che cosa viene eseguito dopo.

- Se colleghi da **Success**, il blocco successivo viene eseguito solo quando quello prima ha funzionato.
- Se colleghi da **Error**, il blocco successivo viene eseguito solo quando quello prima è fallito.
- Se un output non lo colleghi, quel percorso si ferma semplicemente lì.

Puoi collegare un output a più blocchi. Vengono eseguiti tutti — ma uno dopo l'altro, in un'unica coda, non in parallelo. Non fare affidamento sull'ordine tra i rami e non contare sul fatto che si sovrappongano nel tempo. Ogni blocco viene eseguito al massimo una volta per esecuzione, quindi una linea che torna indietro a un blocco precedente non lo esegue una seconda volta.

## Configurare un blocco

Clicca un blocco per aprirne le impostazioni in una finestra (oppure raggiungilo con **Tab** e premi **Invio**). Ogni impostazione ha il tipo di campo che le serve — testo, menu a tendina, editor di codice, interruttori e così via. Compila e clicca **Salva**.

Nella stessa finestra trovi anche:

- **Elimina** — rimuove questo blocco.
- **Run just this step** — esegue solo questo blocco, senza il resto del workflow. I valori che avrebbe letto dagli altri passaggi arrivano vuoti, e tutto ciò che il blocco invia, scrive o elimina succede per davvero.
- **Documentazione**, **Inputs**, **Outputs** e **Returns** — le schede di riferimento su ciò che il blocco si aspetta e su ciò che produce.

Quasi tutti i campi di testo accettano variabili: è così che i dati passano da un blocco al successivo. Invece di scrivere la sintassi a mano, usa il selettore di valori dell'editor: costruisce un riferimento corretto a partire dal blocco e dal campo che scegli. Vedi [Variabili del workflow](/docs/workflows/variables).

## I controlli mentre costruisci

Il **Costruttore** ricontrolla l'intero grafo a ogni modifica e riassume quello che trova in una pillola nella barra degli strumenti. Cliccala per aprire **Problems with this workflow**, che elenca ogni problema e ti porta dritto al blocco responsabile. Sulla tela, un blocco con impostazioni obbligatorie ancora vuote mostra **Click to set up**, e un blocco con qualunque altro problema ha un badge nell'angolo: rosso per un errore, ambra per un avviso. Passa il mouse sul badge per leggere cosa non va.

Intercetta gli errori che altrimenti resterebbero invisibili finché un'esecuzione non va storta: nessun trigger, due blocchi con lo stesso id, un punto dentro un id, un blocco a cui non arriva nessun collegamento, un'impostazione obbligatoria lasciata vuota, JSON malformato, spazi dentro `{{ }}` e riferimenti a un passaggio o a un valore di ritorno che non esistono.

Una cosa non riesce a controllarla: se il nome di una variabile esiste davvero. Una variabile rinominata salta fuori solo nel log dell'esecuzione.

## Il tuo primo workflow

Il modo più rapido per prendere le misure alla tela:

1. Clicca il blocco segnaposto tratteggiato, poi clicca **Manual** nel pannello **Add Trigger**.
2. Clicca **Aggiungi componente**, poi clicca **Log** sotto **Popular**. Il blocco nuovo compare sotto il trigger. Collega il puntino **Execute** del trigger al puntino di input del blocco Log.
3. Clicca il blocco Log, che mostra **Click to set up**, e imposta il suo **Value** su `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` è l'**Identifier** del trigger, stampato sul blocco stesso — controlla che corrisponda.
4. Attiva **Abilitato** in cima al Costruttore. Un workflow disabilitato non si può eseguire in nessun modo, nemmeno a mano; se salti questo passaggio, **Esegui flusso di lavoro** ti chiede prima di attivarlo.
5. Torna sul **Costruttore**, clicca **Esegui flusso di lavoro**, metti `{ "name": "Ada" }` nel campo **JSON**, clicca **Run Workflow Manually** e conferma con **Run**.
6. Si apre da solo un pannello **Workflow Run** che segue l'esecuzione. Nel log compare `Value:` seguito da `Hello from Ada`.

Quel ciclo — aggiungi, collega, configura, esegui, leggi il log — è il modo in cui costruirai ogni workflow.

## Accenderlo

I workflow nuovi partono disabilitati, e lo stesso vale per qualsiasi workflow che duplichi o importi. Finché un workflow è spento, il Costruttore lo dice sopra la tela, con un pulsante **Attiva flusso di lavoro**.

L'interruttore **Abilitato** sta in cima al **Costruttore**, accanto ad **Aggiungi componente** ed **Esegui flusso di lavoro**. Si trova anche nella pagina **Panoramica** del workflow: clicca **Modifica flusso di lavoro** nella scheda **Dettagli del flusso di lavoro**, che mostra lo stato attuale con una pillola verde **Abilitato** o rossa **Disabilitato**. Solo chi può modificare il workflow può accenderlo o spegnerlo; gli altri vedono l'interruttore in grigio.

Un workflow disabilitato non viene eseguito affatto: il suo trigger viene ignorato, e così **Esegui flusso di lavoro** e **Run just this step**. Se lo esegui, o esegui uno dei suoi blocchi, mentre è spento, il Costruttore chiede invece **Attivare questo flusso di lavoro?**. **Attiva ed esegui** (o **Attiva ed esegui il passaggio**) accende il workflow e poi esegue quello che hai chiesto, con i valori che hai indicato. Quindi l'ordine è: costruiscilo, provalo con **Esegui flusso di lavoro**, leggi il log dell'esecuzione e rimetti **Abilitato** su off se non sei pronto a far scattare il suo trigger. Per provare un singolo blocco senza eseguire tutto il resto, usa **Run just this step** nelle impostazioni di quel blocco.

Tutto il resto che avvia un workflow disabilitato viene respinto con lo stesso consiglio. Una chiamata al suo URL webhook riceve un HTTP 400 e "This workflow is turned off, so it can't run. Turn it on with the Enabled switch at the top of its Builder, then try again." Un blocco **Execute Workflow** che lo chiama prende il percorso **Error**, e l'errore indica il workflow chiamato.

Per mettere in pausa un workflow senza eliminarlo, spegni **Abilitato**. Non parte nessuna nuova esecuzione. Un'esecuzione già a metà strada arriva in fondo, ma una parcheggiata su un blocco **Sleep** viene annullata al risveglio e registrata come errore.

## Mettere in ordine

- Trascina i blocchi per spostarli. La disposizione viene salvata.
- Per eliminare una linea, trascina una delle sue estremità via dal puntino e lasciala su una zona vuota della tela.
- Per eliminare un blocco, cliccalo e usa **Elimina** in fondo alla finestra delle sue impostazioni. Anche selezionare un blocco o una linea e premere Backspace lo rimuove.
- Non c'è modo di duplicare un singolo blocco. **Duplicate Workflow**, nella pagina **Impostazioni** del workflow, copia tutto quanto, e la copia nasce disabilitata.
- Impila i blocchi dall'alto verso il basso, così si leggono nella direzione in cui vengono eseguiti — gli input stanno sul bordo superiore e gli output su quello inferiore, quindi il flusso scende in modo naturale.

## Cosa leggere dopo

- [Trigger del workflow](/docs/workflows/triggers) — i quattro modi in cui un workflow può partire.
- [Componenti del workflow](/docs/workflows/components) — tutti i blocchi che puoi aggiungere.
- [Variabili del workflow](/docs/workflows/variables) — spostare i dati tra i blocchi.
- [Esecuzioni del workflow](/docs/workflows/runs-and-logs) — controllare che cosa è successo.
