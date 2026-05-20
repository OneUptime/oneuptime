# Panoramica dei workflow

I workflow sono il costruttore visuale di automazione di OneUptime. Trascini un trigger su un canvas, lo colleghi a una catena di azioni — chiamate HTTP, messaggi Slack, snippet JavaScript, rami condizionali, lookup su database — e hai un'automazione che parte ogni volta che un evento in OneUptime (o nel mondo esterno) si verifica.

Se i runbook sono checklist per gli esseri umani durante un incidente, i workflow sono job in background per il tuo progetto — girano in autonomia, reagiscono alle cose e fanno da collante fra OneUptime e il resto del tuo stack.

## A colpo d'occhio

- **Funzionalità di primo livello** nella dashboard OneUptime in **Workflows**.
- **Tre stili di trigger**: Manuale, Schedulato (cron), Webhook — più un **trigger su evento di modello** che scatta quando una qualsiasi entità OneUptime (incidente, allarme, monitor, status page, ecc.) viene creata, aggiornata o cancellata.
- **Canvas visuale**: trascini nodi da una palette di componenti, colleghi le porte di output alle porte di input.
- **Automazione mista**: richieste HTTP, messaggi Slack / Discord / Microsoft Teams / Telegram, JavaScript personalizzato, parsing JSON, condizionali, email, chiamate a sub-workflow e operazioni CRUD sui modelli OneUptime.
- **Variabili globali**: segreti e configurazioni a livello di progetto che richiami da qualsiasi workflow senza copia-incolla.
- **Esecuzioni e log**: ogni esecuzione viene registrata con stato, tempistiche e output passo per passo.

## Perché usare i workflow?

La maggior parte dei team adotta i workflow quando vuole:

- **Collegare OneUptime a un altro sistema** — pubblicare un incidente su PagerDuty, replicare un allarme in Jira, chiamare un webhook nel proprio stack.
- **Reagire agli eventi OneUptime** — quando si apre un incidente `Sev 1`, contattare il manager on-call *e* creare un ticket Linear *e* bloccare un feature flag.
- **Schedulare job ricorrenti** — ogni cinque minuti interrogare un'API interna e scrivere il risultato in un sistema esterno.
- **Ricevere dati da fuori OneUptime** — un webhook da un sistema CI avvia una catena di aggiornamenti OneUptime.
- **Riutilizzare piccoli pezzi di logica di collegamento** — un workflow ne chiama un altro, così i pattern comuni vivono in un unico posto.

## Concetti chiave

| Termine | Significato |
| --- | --- |
| **Workflow** | Il canvas. Un grafo riutilizzabile e con un nome, fatto di trigger e componenti, con un flag `isEnabled`. |
| **Trigger** | Il nodo che avvia un'esecuzione del workflow. Manuale, Schedulato, Webhook o un evento di modello. Ogni workflow ha esattamente un trigger. |
| **Componente** | Un nodo che svolge un lavoro — una chiamata HTTP, un messaggio Slack, uno snippet JavaScript, un condizionale, ecc. |
| **Porta** | Un'attacco di input o output su un nodo. I componenti hanno porte di output come `success` ed `error`; colleghi una porta alla porta di input del nodo successivo. |
| **Esecuzione / Log** | Un'esecuzione di un workflow. Contiene il timestamp, lo stato (Running, Success, Failed, Timeout) e l'output catturato di ogni nodo eseguito. |
| **Variabile globale** | Un valore con nome (spesso un segreto o una chiave API) definito una sola volta a livello di progetto e referenziato da qualsiasi workflow come `{{variable.NAME}}`. |
| **Variabile locale** | Un valore con scope di una singola esecuzione di workflow — tipicamente il valore di ritorno di un nodo precedente, referenziato come `{{ComponentId.portName}}`. |

## Dove vivono i workflow nella dashboard

| Pagina | Cosa fai lì |
| --- | --- |
| **Workflows** | Sfogliare, creare e cercare i modelli di workflow. |
| **Scheda Builder di un workflow** | Il canvas drag-and-drop. Aggiungere nodi, collegare porte, configurare argomenti. |
| **Scheda Logs di un workflow** | Ogni esecuzione di questo workflow con filtri per stato e intervallo temporale. Clicca un'esecuzione per vedere l'output nodo per nodo. |
| **Scheda Settings di un workflow** | Rinominare, abilitare/disabilitare, cambiare la descrizione, gestire le label, eliminare. |
| **Workflows → Variabili globali** | Definire valori a livello di progetto richiamabili da qualsiasi workflow. Marca un valore come segreto per nasconderlo dall'interfaccia dopo il salvataggio. |
| **Workflows → Esecuzioni e log** | Storico delle esecuzioni a livello di progetto su tutti i workflow. |

## Il ciclo di vita di un workflow

1. **Scrivere** — Crea un workflow, posiziona un trigger sul canvas, trascina i componenti che ti servono, collegali e configura ciascuno.
2. **Abilitare** — I workflow vengono spediti disabilitati. Attiva l'interruttore in Settings quando sei sicuro che il cablaggio sia corretto.
3. **Scatenare** — Manuale: clicca **Esegui manualmente** con un payload JSON opzionale. Schedulato: il cron scatta. Webhook: un sistema esterno esegue un `POST` all'URL del workflow. Evento di modello: qualcuno (o un altro workflow) crea/aggiorna/cancella un monitor, un incidente, un allarme, ecc.
4. **Eseguire** — Il Workflow Worker percorre il grafo in ordine. Ogni componente legge i suoi argomenti (valori letterali o variabili interpolate), svolge il suo lavoro, scrive il valore di ritorno e sceglie una porta di output. Parte il nodo successivo.
5. **Auditare** — L'esecuzione compare nei **Log**. Stato, durata totale, output per componente ed eventuali errori vengono conservati per tutta la vita del progetto.

## Un esempio concreto

Obiettivo: quando viene creato un incidente con `Sev 1` nel titolo, pubblicare su un canale Slack e aprire un ticket sul tuo tool admin interno.

**1. Crea un workflow** chiamato "Fan-out Sev 1".

**2. Posiziona un trigger.** Scegli il trigger **Incident → On Create** dalla palette. Il trigger espone il nuovo incidente come valore di ritorno.

**3. Posiziona un componente Conditional.** Collega la porta di output del trigger al suo input. Imposta la condizione: `{{Incident.title}}` *contiene* `Sev 1`.

**4. Dalla porta `yes` del Conditional, posiziona un componente Slack.** Canale: `#incident-room`. Corpo del messaggio: `Sev 1 dichiarato: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. Dalla stessa porta `yes` (in parallelo), posiziona un componente API.** `POST` a `https://admin.internal/incidents`. Body: un piccolo oggetto JSON costruito dall'incidente.

**6. Abilita il workflow.** Apri un incidente intitolato "Sev 1 — checkout 500s" in un'altra scheda. In pochi secondi arriva il messaggio Slack, e una nuova esecuzione compare in **Logs** con l'output di ogni nodo catturato.

## Come i workflow si integrano con il resto di OneUptime

- I **monitor** rilevano i problemi; gli **incidenti/allarmi** li registrano; i **workflow** reagiscono — pubblicano messaggi, aprono ticket, avviano automazioni.
- I **runbook** sono procedure di risposta per gli esseri umani (con eventuali passi di script). I workflow sono automazioni di background non presidiate. Sono complementari — un passo runbook può fare `POST` a un trigger webhook di un workflow.
- Le **connessioni workspace** (Slack, Microsoft Teams) sono le destinazioni tipiche per le notifiche dei workflow.
- Le **dashboard** sono viste in sola lettura; i workflow sono il lato scrittura — aggiornano lo stato di OneUptime, chiamano API esterne e spostano dati.

## Cosa leggere dopo

- [Creare un workflow](/docs/workflows/authoring) — costruire un workflow sul canvas, configurare i nodi, collegare le porte.
- [Trigger](/docs/workflows/triggers) — trigger Manuale, Schedulato, Webhook e di evento di modello nel dettaglio.
- [Componenti](/docs/workflows/components) — il catalogo delle azioni e come configurare ciascuna.
- [Variabili](/docs/workflows/variables) — variabili globali, variabili locali e come funziona l'interpolazione.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — leggere lo storico delle esecuzioni, fare debug dei fallimenti.
- [Configurazione e sicurezza](/docs/workflows/configuration) — abilitare/disabilitare, ownership, label, segreti, limiti di ricorsione.
