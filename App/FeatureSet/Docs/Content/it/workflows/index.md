# Panoramica dei workflow

I workflow ti permettono di automatizzare attività in OneUptime senza scrivere codice. Aggiungi qualche blocco su una tela, collegali tra loro, e hai un'automazione che si avvia ogni volta che succede qualcosa — si apre un incidente, scatta una pianificazione, oppure un altro strumento invia dati a OneUptime.

Pensa ai workflow come ad aiutanti in background per il tuo progetto: reagiscono agli eventi, parlano con altri strumenti e mantengono le cose sincronizzate silenziosamente mentre tu ti concentri sul tuo lavoro.

## Cosa puoi fare con i workflow

- **Collegare OneUptime ai tuoi altri strumenti** — inviare incidenti a Slack, creare ticket Jira, pubblicare su un webhook nel tuo stack.
- **Reagire a ciò che succede in OneUptime** — quando viene creato un incidente critico, avvisare automaticamente il team di reperibilità e aprire un ticket.
- **Eseguire lavori su una pianificazione** — ogni cinque minuti, ogni notte, ogni lunedì mattina.
- **Ricevere dati dall'esterno** — lasciare che altri sistemi inviino dati a OneUptime tramite un URL univoco.
- **Riutilizzare automazioni comuni** — costruirle una volta e richiamarle da qualsiasi altro workflow.

## Come funziona un workflow

Ogni workflow ha tre parti:

1. **Un trigger** — ciò che avvia il workflow. Può essere un pulsante manuale, una pianificazione, un webhook in arrivo, oppure un evento in OneUptime (come un nuovo incidente).
2. **Uno o più componenti** — ciò che fa il workflow. Inviare un messaggio, effettuare una chiamata HTTP, eseguire un controllo rapido, ramificarsi in base a una condizione.
3. **Collegamenti tra loro** — disegni delle linee da un blocco all'altro per decidere l'ordine.

Costruisci tutto questo visivamente su una tela. Non è richiesto codice per la maggior parte dei workflow, anche se puoi aggiungere uno snippet di JavaScript quando ti serve.

## Termini chiave

| Termine                  | Cosa significa                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| **Workflow**             | L'intera automazione — un nome, una tela e un interruttore per attivarla o disattivarla.           |
| **Trigger**              | Il primo blocco. Decide quando viene eseguito il workflow. Ogni workflow ha esattamente un trigger. |
| **Component**            | Un blocco d'azione — invia un messaggio, effettua una richiesta, verifica una condizione.           |
| **Run**                  | Una singola esecuzione del workflow. Salvata con le marche temporali e l'output di ogni blocco.     |
| **Global variable**      | Un valore (come una chiave API) che salvi una volta e riutilizzi in qualsiasi workflow.             |

## Dove trovare i workflow in OneUptime

Apri **Flussi di lavoro** nella navigazione a sinistra. Quella sezione contiene:

- **Flussi di lavoro** — l'elenco dei tuoi workflow. Crea un nuovo workflow o apri uno esistente.
- **Variabili globali** — valori condivisi tra tutti i tuoi workflow.
- **Esecuzioni e registri** — la cronologia delle esecuzioni di ogni workflow nel progetto.

Apri un singolo workflow e il suo menu a sinistra contiene:

- **Panoramica** — nome, descrizione, etichette e l'interruttore **Abilitato**.
- **Costruttore** — la tela in cui progetti il workflow.
- **Variabili del flusso** — valori limitati a questo singolo workflow.
- **Esecuzioni e registri** — ogni esecuzione di questo workflow, con i dettagli.
- **Impostazioni** — segreto del webhook, duplicazione ed esportazione.

## Costruire il tuo primo workflow

1. **Crea** — scegli un punto di partenza, poi dai un nome al tuo workflow.
2. **Pick a trigger** — manuale, pianificato, webhook, oppure un evento da OneUptime.
3. **Add components** — aggiungi azioni alla tela e collegale.
4. **Turn it on** — attiva **Abilitato** dalla pagina **Panoramica**. Un workflow disabilitato non può essere eseguito in nessun modo, nemmeno manualmente.
5. **Test** — clicca **Esegui flusso di lavoro** sul Costruttore e osserva il registro dell'esecuzione.

## Un esempio rapido

Supponi di voler pubblicare su Slack ogni volta che viene creato un incidente critico:

1. Crea un workflow chiamato "Critical incidents to Slack."
2. Scegli il trigger **On Create Incident**.
3. Aggiungi un blocco **If / Else**. Impostalo per verificare se il titolo dell'incidente contiene "Sev 1."
4. Dal ramo **Yes**, aggiungi un blocco **Slack**. Scegli il canale e scrivi il messaggio.
5. Attiva il workflow.

La prossima volta che qualcuno apre un incidente con "Sev 1" nel titolo, Slack si illumina.

## Come i workflow si integrano con il resto di OneUptime

- I **Monitor** individuano il problema. Gli **Incidenti** lo registrano. I **Flussi di lavoro** reagiscono.
- I **Runbook** sono guide passo-passo per le persone. I workflow sono automazione non presidiata. Usa un runbook quando una persona deve prendere decisioni; usa un workflow quando i passaggi sono automatici.
- Le **Workspace connections** (Slack, Teams) sono dove i workflow inviano i loro messaggi.

## Dove leggere in seguito

- [Creare un workflow](/docs/workflows/authoring) — costruire sulla tela.
- [Trigger del workflow](/docs/workflows/triggers) — i diversi modi in cui un workflow può iniziare.
- [Componenti del workflow](/docs/workflows/components) — i blocchi che puoi aggiungere.
- [Variabili del workflow](/docs/workflows/variables) — usare valori tra blocchi e workflow.
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — verificare cosa è successo.
- [Configurazione e sicurezza del workflow](/docs/workflows/configuration) — impostazioni da conoscere.
