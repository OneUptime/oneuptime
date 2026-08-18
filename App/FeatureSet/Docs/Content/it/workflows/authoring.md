# Creare un workflow

Per creare un workflow, apri **Flussi di lavoro** e clicca **Crea flusso di lavoro**. Ti accompagna una procedura guidata intitolata **Create a workflow**: prima **Start from** — scegli **Start from scratch** oppure uno dei modelli — poi **Name**, e infine il passaggio **Configure**, che compare solo se il modello che hai scelto richiede impostazioni proprie.

Una volta creato, apri **Costruttore** nel menu di sinistra: è la tela su cui progetti il workflow.

## La tela

Un workflow partito da zero si apre con un unico blocco tratteggiato che dice **Please click here to add trigger**. Quel blocco è il punto di partenza — cliccalo per scegliere un trigger. Un workflow nato da un modello si apre invece con i blocchi già al loro posto.

Ogni workflow ha un solo **trigger**, in cima. Tutto il resto è un **component**, cioè un blocco che fa qualcosa. Se aggiungi un secondo trigger, questo sostituisce il primo; se elimini l'ultimo, torna il segnaposto tratteggiato.

Per aggiungere i blocchi:

- **Il trigger** — clicca il blocco segnaposto tratteggiato. Si apre un pannello intitolato **Add Trigger**.
- **Tutto il resto** — clicca **Aggiungi componente** nella barra degli strumenti sopra la tela. Si apre lo stesso pannello, questa volta intitolato **Add Component**.

Entrambi i pannelli hanno una ricerca — premi `/` per saltare direttamente alla casella — e raggruppano i blocchi per categoria. Seleziona un blocco e clicca **Add to Workflow**.

I blocchi nuovi compaiono sempre nello stesso punto della tela, quindi può capitare che uno finisca sopra qualcosa che avevi già sistemato. Trascinalo via; mentre lo sposti la tela lo aggancia a una griglia. Le posizioni dei blocchi vengono salvate, così chi apre il workflow dopo di te ritrova la disposizione che hai lasciato.

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

Clicca un blocco per aprirne le impostazioni in una finestra. Ogni impostazione ha il tipo di campo che le serve — testo, menu a tendina, editor di codice, interruttori e così via. Compila e clicca **Salva**.

Nella stessa finestra trovi anche:

- **Elimina** — rimuove questo blocco.
- **Run just this step** — esegue solo questo blocco, senza il resto del workflow. I valori che avrebbe letto dagli altri passaggi arrivano vuoti, e tutto ciò che il blocco invia, scrive o elimina succede per davvero.
- **Documentazione**, **Inputs**, **Outputs** e **Returns** — le schede di riferimento su ciò che il blocco si aspetta e su ciò che produce.

Quasi tutti i campi di testo accettano variabili: è così che i dati passano da un blocco al successivo. Invece di scrivere la sintassi a mano, usa il selettore di valori dell'editor: costruisce un riferimento corretto a partire dal blocco e dal campo che scegli. Vedi [Variabili del workflow](/docs/workflows/variables).

## I controlli mentre costruisci

Il **Costruttore** ricontrolla l'intero grafo a ogni modifica e riassume quello che trova in una pillola nella barra degli strumenti. Cliccala per aprire **Problems with this workflow**, che elenca ogni problema e ti porta dritto al blocco responsabile. I blocchi con un problema hanno anche un badge rosso sulla tela.

Intercetta gli errori che altrimenti resterebbero invisibili finché un'esecuzione non va storta: nessun trigger, due blocchi con lo stesso id, un punto dentro un id, un blocco a cui non arriva nessun collegamento, un'impostazione obbligatoria lasciata vuota, JSON malformato, spazi dentro `{{ }}` e riferimenti a un passaggio o a un valore di ritorno che non esistono.

Una cosa non riesce a controllarla: se il nome di una variabile esiste davvero. Una variabile rinominata salta fuori solo nel log dell'esecuzione.

## Il tuo primo workflow

Il modo più rapido per prendere le misure alla tela:

1. Clicca il blocco segnaposto tratteggiato, scegli **Manual** nel pannello **Add Trigger** e clicca **Add to Workflow**.
2. Clicca **Aggiungi componente**, scegli **Log** (nella categoria **Utils**) e clicca **Add to Workflow**. Trascina il blocco nuovo lontano dal trigger, poi collega il puntino **Execute** del trigger al puntino di input del blocco Log.
3. Apri il blocco Log e imposta il suo **Value** su `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` è l'**Identifier** del trigger, stampato sul blocco stesso — controlla che corrisponda.
4. Vai su **Panoramica**, clicca **Modifica flusso di lavoro** nella scheda **Dettagli del flusso di lavoro** e attiva **Abilitato**. Un workflow disabilitato non si può eseguire in nessun modo, nemmeno a mano.
5. Torna sul **Costruttore**, clicca **Esegui flusso di lavoro**, metti `{ "name": "Ada" }` nel campo **JSON**, clicca **Run Workflow Manually** e conferma con **Run**.
6. Si apre da solo un pannello **Workflow Run** che segue l'esecuzione. Nel log compare `Value:` seguito da `Hello from Ada`.

Quel ciclo — aggiungi, collega, configura, esegui, leggi il log — è il modo in cui costruirai ogni workflow.

## Accenderlo

I workflow nuovi partono disabilitati, e lo stesso vale per qualsiasi workflow che duplichi o importi.

L'interruttore **Abilitato** sta nella pagina **Panoramica** del workflow, dentro la scheda **Dettagli del flusso di lavoro** — non nella pagina delle impostazioni. La stessa scheda mostra lo stato attuale con una pillola verde **Abilitato** o rossa **Disabilitato**.

Un workflow disabilitato non viene eseguito affatto. Le esecuzioni manuali vengono rifiutate con "This workflow is not enabled" esattamente come quelle scatenate da un trigger, quindi l'ordine è: abilitalo, provalo con **Esegui flusso di lavoro**, leggi il log dell'esecuzione e rimetti **Abilitato** su off se non sei pronto a far scattare il suo trigger. Per provare un singolo blocco senza eseguire tutto il resto, usa **Run just this step** nelle impostazioni di quel blocco.

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
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — controllare che cosa è successo.
