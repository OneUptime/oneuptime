# Creazione di un workflow

Per creare un workflow, apri **Workflows → Create Workflow**, assegna un nome e clicca sulla scheda **Builder**. Vedrai un canvas vuoto su cui costruirai l'automazione.

## Il canvas

Il Builder e un canvas drag-and-drop. Aggiungi i blocchi dalla palette laterale, li colleghi tra loro con delle linee e clicchi su ciascun blocco per configurare cosa fa. Le modifiche vengono salvate automaticamente — vedrai un indicatore in alto una volta che sono state salvate.

Ogni workflow inizia con un **trigger** all'inizio. Tutto il resto e un **componente** che esegue qualcosa.

## Cosa contiene un blocco

| Campo            | Cosa fa                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Titolo**       | Il nome mostrato sul canvas. Rinominalo per rendere piu leggibili i workflow complessi.                                                                                             |
| **Impostazioni** | Cio di cui il blocco ha bisogno per svolgere il proprio compito — un URL, un canale Slack, il corpo di un messaggio, ecc. I campi obbligatori sono contrassegnati con un asterisco. |
| **Input**        | Il pallino a sinistra dove arrivano le linee dai blocchi precedenti.                                                                                                                |
| **Output**       | I pallini a destra da cui partono le linee verso i blocchi successivi. Molti blocchi hanno output **success** ed **error** separati, cosi puoi gestire entrambi i casi.             |

## Collegare i blocchi

Trascina dal pallino di output di un blocco al pallino di input del blocco successivo. La linea che disegni decide cosa viene eseguito dopo.

- Se ti colleghi dall'output **success**, il blocco successivo viene eseguito solo se il precedente ha funzionato.
- Se ti colleghi dall'output **error**, il blocco successivo viene eseguito solo se il precedente ha fallito.
- Se non colleghi un output, quel percorso si interrompe semplicemente.

Puoi collegare un singolo output a piu blocchi. Da quel punto vengono eseguiti tutti contemporaneamente.

## Configurare un blocco

Clicca su un blocco per aprire le sue impostazioni nel pannello laterale. Ogni impostazione ha il tipo di input appropriato — campi di testo, menu a tendina, editor di codice, interruttori e cosi via.

La maggior parte dei campi di testo accetta variabili — e cosi che i dati passano da un blocco all'altro. Vedi [Variabili](/docs/workflows/variables) per la sintassi.

## Il tuo primo workflow

Il modo piu rapido per prendere confidenza con il canvas:

1. Trascina un trigger **Manual** sul canvas.
2. Trascina un componente **Log** (sotto **Utils**) accanto. Collega il trigger al componente Log.
3. Nel campo messaggio del blocco Log, scrivi `Hello from {{Manual.JSON.name}}`.
4. Salva e attiva il workflow.
5. Clicca su **Run Manually**, incolla `{ "name": "Ada" }` come input e invia.
6. Apri la scheda **Logs**. L'ultima esecuzione mostra `Hello from Ada`.

Quel ciclo — trascina, collega, configura, esegui, controlla il log — e il modo in cui costruirai ogni workflow.

## Salva e attiva

Il canvas salva mentre lavori. Non c'e un passaggio separato di "pubblicazione."

Tuttavia, un workflow viene effettivamente eseguito solo quando **Enabled** e attivo in Settings. I nuovi workflow partono disabilitati. Usa quell'interruttore come rete di sicurezza — costruisci, testa con **Run Manually**, controlla i log, poi attivalo.

Per mettere in pausa un workflow senza eliminarlo, disattiva **Enabled**. Le esecuzioni gia in corso vengono completate; non ne vengono avviate di nuove.

## Mettere in ordine

- Trascina i blocchi per spostarli. La disposizione viene salvata, cosi la persona successiva vedra la stessa configurazione.
- Clicca con il tasto destro su una linea per eliminarla. Clicca con il tasto destro su un blocco per eliminarlo o duplicarlo.
- Per workflow estesi, disponili da sinistra a destra in modo che si leggano nella stessa direzione in cui vengono eseguiti.

## Letture successive

- [Trigger](/docs/workflows/triggers) — i quattro modi in cui un workflow puo iniziare.
- [Componenti](/docs/workflows/components) — ogni blocco che puoi aggiungere.
- [Variabili](/docs/workflows/variables) — spostare i dati tra i blocchi.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — verificare cosa e successo.
