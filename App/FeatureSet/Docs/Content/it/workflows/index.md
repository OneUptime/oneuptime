# Panoramica dei workflow

I workflow permettono di automatizzare attivita in OneUptime senza scrivere codice. Basta trascinare alcuni blocchi su un canvas, collegarli tra loro, e si ottiene un'automazione che si attiva ogni volta che qualcosa accade — l'apertura di un incidente, lo scatto di una pianificazione o un altro strumento che invia dati a OneUptime.

Pensa ai workflow come a degli assistenti in background per il tuo progetto: reagiscono agli eventi, dialogano con altri strumenti e mantengono tutto sincronizzato in silenzio, mentre tu ti concentri sul tuo lavoro.

## Cosa puoi fare con i workflow

- **Collegare OneUptime ai tuoi altri strumenti** — inviare incidenti a Slack, creare ticket Jira, fare una chiamata webhook al tuo stack.
- **Reagire a cio che accade in OneUptime** — quando viene creato un incidente critico, notificare il team on-call e aprire automaticamente un ticket.
- **Eseguire job pianificati** — ogni cinque minuti, ogni notte, ogni lunedi mattina.
- **Ricevere dati dall'esterno** — permettere ad altri sistemi di inviare dati a OneUptime tramite un URL univoco.
- **Riutilizzare automazioni comuni** — costruisci una volta, richiama da qualsiasi altro workflow.

## Come funziona un workflow

Ogni workflow ha tre parti:

1. **Un trigger** — cio che avvia il workflow. Puo essere un pulsante manuale, una pianificazione, un webhook in arrivo o un evento in OneUptime (come un nuovo incidente).
2. **Uno o piu componenti** — cio che il workflow fa. Inviare un messaggio, effettuare una chiamata HTTP, eseguire un controllo rapido, ramificare in base a una condizione.
3. **Connessioni tra di essi** — disegni delle linee da un blocco al successivo per decidere l'ordine.

Costruisci tutto questo visivamente su un canvas. Per la maggior parte dei workflow non serve scrivere codice, anche se puoi inserire uno snippet JavaScript quando necessario.

## Termini chiave

| Termine | Cosa significa |
| --- | --- |
| **Workflow** | L'intera automazione — un nome, un canvas e un interruttore per attivarla o disattivarla. |
| **Trigger** | Il primo blocco. Decide quando il workflow viene eseguito. Ogni workflow ha esattamente un trigger. |
| **Componente** | Un blocco azione — invia un messaggio, effettua una richiesta, verifica una condizione. |
| **Esecuzione** | Una singola esecuzione del workflow. Viene salvata con i timestamp e l'output di ogni blocco. |
| **Variabile globale** | Un valore (come una chiave API) che salvi una volta e riutilizzi in qualsiasi workflow. |

## Dove trovare i workflow in OneUptime

Apri **Workflows** nel menu di navigazione a sinistra. Da li:

- **Workflows** — il tuo elenco di workflow. Crea un nuovo workflow o aprine uno esistente.
- **Scheda Builder** — il canvas dove progetti il workflow.
- **Scheda Logs** — ogni esecuzione di questo workflow, con i relativi dettagli.
- **Scheda Settings** — nome, descrizione, proprietari, etichette, abilita/disabilita.
- **Variabili globali** — valori condivisi tra tutti i tuoi workflow.
- **Esecuzioni e log** — cronologia delle esecuzioni di tutti i workflow del tuo progetto.

## Creare il primo workflow

1. **Crea** — assegna un nome al tuo workflow e una breve descrizione.
2. **Scegli un trigger** — manuale, pianificato, webhook o un evento da OneUptime.
3. **Aggiungi i componenti** — trascina le azioni sul canvas e collegale.
4. **Testa** — clicca su **Run Manually** e osserva cosa accade nei log.
5. **Attivalo** — sposta l'interruttore **Enabled** in Settings quando sei pronto.

## Un esempio rapido

Supponi di voler pubblicare un messaggio su Slack ogni volta che viene creato un incidente critico:

1. Crea un workflow chiamato "Incidenti critici su Slack."
2. Scegli il trigger **Incident → On Create**.
3. Aggiungi un blocco **Conditions**. Impostalo per verificare se il titolo dell'incidente contiene "Sev 1."
4. Dal ramo **Yes**, aggiungi un blocco **Slack**. Scegli il canale e scrivi il messaggio.
5. Attiva il workflow.

La prossima volta che qualcuno apre un incidente con "Sev 1" nel titolo, Slack si illuminera.

## Come si integrano i workflow con il resto di OneUptime

- I **monitor** rilevano il problema. Gli **incidenti** lo registrano. I **workflow** vi reagiscono.
- I **runbook** sono guide passo passo per le persone. I workflow sono automazione non presidiata. Usa un runbook quando una persona deve prendere decisioni; usa un workflow quando i passaggi sono automatici.
- Le **connessioni con workspace** (Slack, Teams) sono il luogo in cui i workflow inviano i propri messaggi.

## Letture successive

- [Creazione di un workflow](/docs/workflows/authoring) — lavorare sul canvas.
- [Trigger](/docs/workflows/triggers) — i diversi modi in cui un workflow puo iniziare.
- [Componenti](/docs/workflows/components) — i blocchi che puoi aggiungere.
- [Variabili](/docs/workflows/variables) — usare i valori tra blocchi e workflow.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — verificare cosa e successo.
- [Configurazione e sicurezza](/docs/workflows/configuration) — impostazioni utili da conoscere.
