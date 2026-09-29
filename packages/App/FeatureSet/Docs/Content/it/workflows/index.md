# Panoramica dei workflow

I workflow ti permettono di automatizzare attività in OneUptime senza scrivere codice. Aggiungi qualche blocco a una tela, collegali tra loro ed ecco un'automazione che parte ogni volta che succede qualcosa — si apre un incidente, scatta una pianificazione, oppure un altro strumento manda dati a OneUptime.

Pensa ai workflow come ad aiutanti che lavorano in sottofondo per il tuo progetto: reagiscono agli eventi, parlano con gli altri strumenti e tengono tutto sincronizzato senza far rumore, mentre tu ti concentri sul tuo lavoro.

## Cosa puoi fare con i workflow

- **Collegare OneUptime agli altri tuoi strumenti** — manda gli incidenti su Slack, crea ticket Jira, pubblica su un webhook del tuo stack.
- **Reagire a ciò che succede in OneUptime** — quando viene creato un incidente critico, avvisa il team di reperibilità e apri automaticamente un ticket.
- **Eseguire lavori a intervalli regolari** — ogni cinque minuti, ogni notte, ogni lunedì mattina.
- **Ricevere dati dall'esterno** — lascia che altri sistemi inviino dati a OneUptime tramite un URL univoco.
- **Riutilizzare l'automazione ricorrente** — costruiscila una volta e richiamala da qualsiasi altro workflow.

## Come funziona un workflow

Ogni workflow ha tre parti:

1. **Un trigger** — ciò che avvia il workflow. Può essere un pulsante manuale, una pianificazione, un webhook in entrata o un evento di OneUptime (per esempio un nuovo incidente).
2. **Uno o più componenti** — ciò che il workflow fa. Inviare un messaggio, fare una chiamata HTTP, eseguire un controllo veloce, ramificare in base a una condizione.
3. **I collegamenti tra di essi** — tracci delle linee da un blocco al successivo per decidere l'ordine.

Costruisci tutto questo visivamente su una tela. Per la maggior parte dei workflow non serve programmare, anche se puoi aggiungere un frammento di JavaScript quando ti serve.

## Termini chiave

| Termine             | Che cosa significa                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Workflow**        | L'automazione nel suo insieme — un nome, una tela e un interruttore per accenderla o spegnerla. |
| **Trigger**         | Il primo blocco. Decide quando il workflow viene eseguito. Ogni workflow ha esattamente un trigger. |
| **Componente**      | Un blocco d'azione — invia un messaggio, fa una richiesta, verifica una condizione.          |
| **Esecuzione**      | Una singola esecuzione del workflow. Salvata con orari e output di ogni blocco.              |
| **Variabile globale** | Un valore (per esempio una chiave API) che salvi una volta e riusi in qualsiasi workflow.  |

## Dove trovare i workflow in OneUptime

Apri **Flussi di lavoro** nella navigazione a sinistra. Quella sezione contiene:

- **Flussi di lavoro** — l'elenco dei tuoi workflow. Creane uno nuovo o aprine uno esistente.
- **Variabili globali** — valori condivisi tra tutti i tuoi workflow.
- **Esecuzioni e registri** — la cronologia delle esecuzioni di ogni workflow del progetto.

Apri un singolo workflow e il suo menu a sinistra contiene:

- **Panoramica** — nome, descrizione, etichette e l'interruttore **Abilitato**.
- **Costruttore** — la tela su cui progetti il workflow.
- **Variabili del flusso** — valori validi solo per questo workflow.
- **Esecuzioni e registri** — ogni esecuzione di questo workflow, con i dettagli.
- **Impostazioni** — chiave segreta del webhook, duplicazione ed esportazione.

## Costruire il tuo primo workflow

1. **Crea** — scegli un punto di partenza, poi dai un nome al tuo workflow.
2. **Scegli un trigger** — manuale, pianificato, webhook o un evento di OneUptime.
3. **Aggiungi i componenti** — metti le azioni sulla tela e collegale.
4. **Accendilo** — attiva **Abilitato** nella pagina **Panoramica**. Un workflow disabilitato non può essere eseguito in alcun modo, nemmeno a mano.
5. **Provalo** — clicca **Esegui flusso di lavoro** nel Costruttore e osserva il registro dell'esecuzione.

## Un esempio veloce

Poniamo che tu voglia pubblicare su Slack ogni volta che viene creato un incidente critico:

1. Crea un workflow chiamato "Incidenti critici su Slack".
2. Scegli il trigger **On Create Incident**.
3. Aggiungi un blocco **If / Else**. Impostalo perché verifichi se il titolo dell'incidente contiene "Sev 1".
4. Dal ramo **Yes**, aggiungi un blocco **Slack**. Scegli il canale e scrivi il messaggio.
5. Accendi il workflow.

La prossima volta che qualcuno apre un incidente con "Sev 1" nel titolo, Slack si illumina.

## Come i workflow si incastrano col resto di OneUptime

- **Monitor** individuano il problema. **Incidenti** lo registrano. **Flussi di lavoro** ci reagiscono.
- **Runbook** sono guide passo passo per le persone. I workflow sono automazione non presidiata. Usa un runbook quando serve che sia una persona a decidere; usa un workflow quando i passaggi sono automatici.
- **Connessioni dell'area di lavoro** (Slack, Teams) sono il posto in cui i workflow mandano i loro messaggi.

## Cosa leggere dopo

- [Creare un workflow](/docs/workflows/authoring) — costruire sulla tela.
- [Trigger del workflow](/docs/workflows/triggers) — i diversi modi in cui un workflow può partire.
- [Componenti del workflow](/docs/workflows/components) — i mattoncini che puoi aggiungere.
- [Variabili del workflow](/docs/workflows/variables) — usare valori tra blocchi e workflow diversi.
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — controllare che cosa è successo.
- [Configurazione e sicurezza del workflow](/docs/workflows/configuration) — impostazioni che vale la pena conoscere.
