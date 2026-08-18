# Creare un workflow

Per creare un workflow, apri **Flussi di lavoro** e clicca **Crea flusso di lavoro**. Una procedura guidata chiamata **Create a workflow** ti accompagna: prima **Start from** — scegli **Start from scratch** o uno dei modelli — poi **Name**, e infine un passaggio **Configure**, che compare solo quando il modello scelto richiede impostazioni proprie.

Una volta creato, apri **Costruttore** nel menu a sinistra. Quella è la tela in cui progetti il workflow.

## La tela

Un workflow creato da zero si apre con un unico blocco tratteggiato che dice **Please click here to add trigger**. Quel blocco è il punto di partenza — cliccalo per scegliere un trigger. Un workflow creato da un modello si apre con i suoi blocchi già posizionati.

Ogni workflow ha esattamente un **trigger** in alto. Tutto il resto è un **component** che fa qualcosa. Aggiungere un secondo trigger sostituisce il primo, ed eliminare l'ultimo rimette al suo posto il segnaposto tratteggiato.

Aggiungere blocchi:

- **Il trigger** — clicca il blocco segnaposto tratteggiato. Si apre un pannello intitolato **Add Trigger**.
- **Tutto il resto** — clicca **Add Component** nella barra degli strumenti sopra la tela. Si apre lo stesso pannello, intitolato **Add Component**.

Entrambi i pannelli sono ricercabili — premi `/` per saltare alla casella di ricerca — e raggruppati per categoria. Seleziona un blocco e clicca **Add to Workflow**.

I nuovi blocchi atterrano sempre nello stesso punto della tela, quindi uno nuovo potrebbe cadere sopra qualcosa che hai già posizionato. Trascinalo via; la tela si aggancia a una griglia mentre lo sposti. Le posizioni dei blocchi vengono salvate, così la prossima persona vede la stessa disposizione che hai lasciato.

Le modifiche si salvano automaticamente. Una pillola nella barra degli strumenti lo segue: **Saving…** mentre la modifica è in corso, poi **Saved**, oppure **Could not save** se non ha funzionato. Non c'è un pulsante Salva né un passaggio di pubblicazione separato.

## Cosa c'è su un blocco

| Campo                          | Cosa fa                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Identifier** (sotto **ID**)  | L'id breve mostrato sul blocco, come `log-1`. È così che gli altri blocchi fanno riferimento a questo, quindi rinominarlo rompe ogni riferimento `{{local.components.…}}` che punta a esso. L'intestazione del blocco è il nome del componente stesso e non può essere cambiata. |
| **Settings**                   | Ciò di cui il blocco ha bisogno per fare il suo lavoro — un URL, un canale Slack, il corpo di un messaggio. I campi opzionali sono etichettati **(Optional)**; tutto il resto è obbligatorio. Le impostazioni meno usate stanno dietro un pannello **Advanced**. |
| **Input**                      | Il punto sul bordo superiore, da cui arrivano le linee dai blocchi precedenti. I trigger non ne hanno uno — niente viene eseguito prima di loro.                                                              |
| **Outputs**                    | I punti lungo il bordo inferiore, etichettati appena sopra di essi, da cui le linee escono verso i blocchi successivi. Molti blocchi hanno output **Success** ed **Error** separati, così puoi gestire entrambi i casi. |

## Collegare i blocchi

Trascina da un punto sul fondo di un blocco fino al punto sulla cima del successivo. La linea che disegni decide cosa viene eseguito dopo.

- Se colleghi da **Success**, il blocco successivo viene eseguito solo quando quello precedente ha funzionato.
- Se colleghi da **Error**, il blocco successivo viene eseguito solo quando quello precedente ha fallito.
- Se non colleghi un output, quel percorso si ferma semplicemente lì.

Puoi collegare un output a più blocchi. Vengono eseguiti tutti — ma uno dopo l'altro, in un'unica coda, non in parallelo. Non fare affidamento sull'ordine tra i rami, e non contare sulla loro sovrapposizione nel tempo. Ogni blocco viene eseguito al massimo una volta per esecuzione, quindi un ciclo che torna a un blocco precedente non lo eseguirà due volte.

## Configurare un blocco

Clicca un blocco per aprire le sue impostazioni in una finestra di dialogo. Ogni impostazione ha il tipo di input giusto — campi di testo, menu a tendina, editor di codice, interruttori, e così via. Compilalo e clicca **Save**.

La stessa finestra di dialogo è dove trovi:

- **Delete** — rimuovi questo blocco.
- **Run just this step** — esegui questo singolo blocco da solo, senza il resto del workflow. I valori che avrebbe letto da altri passaggi arrivano vuoti, e qualsiasi cosa invii, scriva o elimini accade davvero.
- **Documentation**, **Inputs**, **Outputs** e **Returns** — schede di riferimento su cosa si aspetta e cosa produce questo blocco.

La maggior parte dei campi di testo accetta variabili — è così che i dati fluiscono da un blocco all'altro. Invece di digitare la sintassi a mano, usa il selettore di valori nell'editor: costruisce un riferimento corretto in base al blocco e al campo che scegli. Vedi [Variabili del workflow](/docs/workflows/variables).

## Controlli mentre costruisci

Il Costruttore controlla l'intero grafo ogni volta che lo modifichi, e riporta ciò che trova in una pillola nella barra degli strumenti. Clicca la pillola per aprire **Problems with this workflow**, che elenca ogni problema e ti porta al blocco responsabile. Anche i blocchi con un problema portano un badge rosso sulla tela.

Individua gli errori che altrimenti sarebbero invisibili finché un'esecuzione non va storta — nessun trigger, due blocchi che condividono un id, un punto dentro un id, un blocco a cui nulla si collega, un'impostazione obbligatoria lasciata vuota, JSON malformato, spazi dentro `{{ }}`, e riferimenti a un passaggio o a un valore di ritorno che non esiste.

Una cosa che non può controllare: se il nome di una variabile esiste. Una variabile rinominata compare solo nel registro di esecuzione.

## Il tuo primo workflow

Il modo più rapido per prendere confidenza con la tela:

1. Clicca il blocco segnaposto tratteggiato, scegli **Manual** nel pannello **Add Trigger**, e clicca **Add to Workflow**.
2. Clicca **Add Component**, scegli **Log** (sotto **Utils**), e clicca **Add to Workflow**. Trascina il nuovo blocco lontano dal trigger, poi collega il punto **Execute** del trigger fino al punto di input del blocco Log.
3. Apri il blocco Log e imposta il suo **Value** su `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` è l'**Identifier** del trigger, mostrato sul blocco trigger — controlla che corrisponda.
4. Vai su **Panoramica**, clicca **Edit Workflow** sulla scheda **Workflow Details**, e attiva **Abilitato**. Un workflow disabilitato non può essere eseguito affatto, nemmeno manualmente.
5. Torna sul **Costruttore**, clicca **Run Workflow**, metti `{ "name": "Ada" }` nel campo **JSON**, clicca **Run Workflow Manually**, e conferma con **Run**.
6. Si apre da solo un pannello **Workflow Run** che segue l'esecuzione. Il registro mostra `Value:` seguito da `Hello from Ada`.

Quel ciclo — aggiungi, collega, configura, esegui, leggi il registro — è come costruirai ogni workflow.

## Attivarlo

I nuovi workflow partono disabilitati, così come ogni workflow che duplichi o importi.

L'interruttore **Abilitato** si trova nella pagina **Panoramica** del workflow, nella scheda **Workflow Details** — non nella pagina Settings. La stessa scheda mostra lo stato attuale come una pillola verde **Abilitato** o rossa **Disabilitato**.

Un workflow disabilitato non può essere eseguito affatto. Le esecuzioni manuali vengono rifiutate con "This workflow is not enabled" esattamente come quelle attivate da trigger, quindi l'ordine è: abilitalo, testalo con **Run Workflow**, leggi il registro di esecuzione, e riporta **Abilitato** su spento se non sei pronto a far scattare il suo trigger. Per testare un singolo blocco senza eseguire l'intero workflow, usa **Run just this step** nelle impostazioni di quel blocco.

Per mettere in pausa un workflow senza eliminarlo, disattiva **Abilitato**. Non parte nessuna nuova esecuzione. Un'esecuzione a metà termina comunque, ma una parcheggiata su un blocco **Sleep** viene annullata al risveglio e registrata come errore.

## Fare ordine

- Trascina i blocchi per spostarli. La disposizione viene salvata.
- Per eliminare una linea, trascina una delle sue estremità via dal punto e rilasciala su una zona vuota della tela.
- Per eliminare un blocco, cliccalo e usa **Delete** in fondo alla sua finestra di dialogo delle impostazioni. Selezionare un blocco o una linea e premere Backspace lo rimuove anch'esso.
- Non c'è modo di duplicare un singolo blocco. **Duplicate Workflow** nella pagina **Settings** del workflow copia l'intero workflow, e la copia atterra disabilitata.
- Impila i blocchi dall'alto verso il basso in modo che si leggano nella direzione in cui vengono eseguiti — gli input sono sul bordo superiore, gli output su quello inferiore, quindi il flusso va naturalmente verso il basso.

## Dove leggere in seguito

- [Trigger del workflow](/docs/workflows/triggers) — i quattro modi in cui un workflow può iniziare.
- [Componenti del workflow](/docs/workflows/components) — ogni blocco che puoi aggiungere.
- [Variabili del workflow](/docs/workflows/variables) — spostare dati tra blocchi.
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — verificare cosa è successo.
