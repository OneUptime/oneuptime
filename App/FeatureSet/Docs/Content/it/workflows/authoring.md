# Creare un workflow

Crea un workflow in **Workflows → Create Workflow**, dagli un nome e una descrizione opzionale, poi apri la scheda **Builder** per iniziare a posizionare i nodi sul canvas.

## Il canvas

Il Builder è un grafo zoomabile e spostabile. Aggiungi nodi da una palette di componenti, li colleghi con archi e configuri gli argomenti di ciascun nodo in un pannello laterale. Un indicatore di salvataggio nell'header ti dice se l'ultima modifica è stata persistita.

Un workflow inizia sempre con esattamente un nodo **trigger**. I trigger non hanno porta di input — è da lì che parte l'esecuzione. Tutto ciò che è a valle è un **componente**.

## Anatomia di un nodo

Ogni nodo ha:

| Campo | Scopo |
| --- | --- |
| **Titolo** | L'etichetta mostrata sul canvas. Predefinito al nome del componente; sovrascrivilo per rendere più leggibili i workflow complessi. |
| **Argomenti** | La configurazione necessaria al componente per svolgere il suo lavoro — un URL, un canale Slack, uno snippet JavaScript, ecc. Gli argomenti obbligatori sono marcati con un asterisco. |
| **Porte di input** | Attacchi sul lato sinistro del nodo dove arrivano gli archi in entrata. I componenti hanno una porta di input chiamata `in`; i trigger non ne hanno. |
| **Porte di output** | Attacchi sul lato destro dove partono gli archi in uscita. I componenti definiscono porte come `success`, `error`, `yes`, `no`. |
| **Valori di ritorno** | Dati prodotti dal nodo — i payload delle sue porte di output. I nodi a valle li referenziano come `{{NodeId.fieldName}}`. |

## Collegare i nodi

Trascina da una porta di output alla porta di input di un nodo a valle per creare un arco. Un arco da `success` esegue quel ramo solo se il nodo a monte ha avuto successo; un arco da `error` viene eseguito solo se ha fallito. Se non colleghi una porta, quel ramo semplicemente termina.

Puoi diramare: una stessa porta di output può alimentare più nodi a valle, e da quel punto vengono eseguiti tutti in parallelo.

## Configurare gli argomenti

Clicca un nodo per aprire il suo pannello laterale. Ogni argomento ha un editor tipizzato:

- **Testo / URL / Email / Numero / Password** — un input su una sola riga.
- **JSON** — un editor JSON con syntax highlighting e indicatore di validità.
- **JavaScript** — un editor di codice per gli snippet usati dal componente **Custom Code**.
- **Markdown / HTML** — body in formato rich text per i componenti email e messaggio.
- **CronTab** — un'espressione di pianificazione (usata dal trigger Schedule).
- **Booleano** — un toggle.
- **Select / Query** — drop-down per campi che accettano un insieme fissato di valori o una query in stile modello.

Qualsiasi campo di testo accetta interpolazione di variabili — vedi [Variabili](/docs/workflows/variables) per le regole.

## Un primo workflow minimale

Il modo più rapido per prendere confidenza con il canvas:

1. Posiziona un trigger **Manual**.
2. Posiziona un componente **Log** (sotto **Utils**). Collega la porta di output del trigger alla porta di input del componente Log.
3. Nell'argomento del componente Log, digita `Ciao da {{Manual.JSON.name}}`.
4. Salva e abilita il workflow.
5. Clicca **Esegui manualmente**, incolla `{ "name": "Ada" }` come input e invia.
6. Apri la scheda **Logs**. L'ultima esecuzione mostra l'output catturato del nodo Log: `Ciao da Ada`.

Quel ciclo — trascina, collega, configura, esegui, ispeziona — è il ritmo della creazione di ogni workflow.

## Salvare, abilitare e testare in produzione

I workflow sono memorizzati come un grafo JSON nella colonna `Workflow.graph`. Il Builder salva mentre modifichi; l'indicatore di salvataggio nell'header mostra quando l'ultima modifica è arrivata sul server. Non c'è un passo separato di "pubblicazione".

Però: un workflow scatena il suo trigger solo quando **isEnabled** è attivo. I nuovi workflow vengono spediti disabilitati. Tratta questo flag come il tuo interruttore "pronto per la prod" — costruisci, clicca **Esegui manualmente** per fare un dry-run con un payload di esempio, guarda i **Log** e solo allora attiva Enable.

Se devi mettere in pausa un workflow senza eliminarlo (es. durante un incidente non correlato), disattiva **isEnabled** in **Settings**. Le esecuzioni già in volo continuano; non ne vengono avviate di nuove.

## Riorganizzare e riordinare

- Trascina un nodo per riposizionarlo. La posizione è memorizzata nel grafo, così la prossima persona che apre il canvas vede lo stesso layout.
- Clic destro su un arco per cancellarlo; clic destro su un nodo per le opzioni di cancellazione e duplicazione.
- Per workflow ampi, disponili da sinistra a destra in modo che la direzione di esecuzione corrisponda alla direzione di lettura.

## Cosa leggere dopo

- [Trigger](/docs/workflows/triggers) — le quattro famiglie di trigger e cosa ognuna espone come valori di ritorno.
- [Componenti](/docs/workflows/components) — il catalogo completo e i loro argomenti.
- [Variabili](/docs/workflows/variables) — come referenziare i dati tra i nodi e dalle variabili globali.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — come fare debug di un workflow che non si comporta bene.
