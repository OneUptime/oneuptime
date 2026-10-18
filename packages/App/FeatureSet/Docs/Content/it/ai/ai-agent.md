# Attività di correzione

Un'attività di correzione è una pull request che OneUptime AI scrive nel tuo codice. La avvii da un'eccezione, una traccia, un servizio o un'indagine, oppure OneUptime la avvia da solo; un [Runner](/docs/runbooks/agents) clona il repository, scrive la modifica su un nuovo branch, la compila e la testa, e apre una pull request. Una persona rivede e unisce ognuna: il Runner può fare il push di branch e aprire pull request, nient'altro.

:::cards
- [Come funziona un'esecuzione di correzione](#come-funziona-unesecuzione-di-correzione): Da un clic a una pull request, passo dopo passo.
- [Dove partono le attività di correzione](#dove-partono-le-attività-di-correzione): I pulsanti che ne avviano una, e cosa fa ogni pull request.
- [Prima di iniziare](#prima-di-iniziare): Un modello, un repository collegato e un Runner.
- [Quando una correzione non riesce](#quando-una-correzione-non-riesce): Cosa succede a un'esecuzione che va in errore, si blocca o resta in attesa.
:::

> [!TIP]
> Puoi avviarla anche da GitHub. Menziona la GitHub App di OneUptime in una issue o in una pull request e implementa, rivede o revisiona direttamente lì: vedi [GitHub App](/docs/ai/github-app). È lo stesso agente, lo stesso Runner e gli stessi budget; cambia solo il trigger.

## Come funziona un'esecuzione di correzione

```mermaid title="Da un clic a una pull request"
flowchart TB
    S["Fix with AI o un<br/>trigger automatico"] --> Q["Un'attività di<br/>correzione entra<br/>in coda"]
    Q --> R["Un Runner che esegue<br/>le correzioni di<br/>codice AI la prende"]
    R --> C["Clona il repository<br/>e crea un branch"]
    C --> A["L'agente di codice<br/>scrive la modifica"]
    A --> V["I comandi di setup,<br/>build e test<br/>la verificano"]
    V -->|"un errore"| A
    V --> P["Commit, push e<br/>apertura di una<br/>pull request"]
    P --> H["Una persona la rivede<br/>e ne fa il merge"]
```

1. Fai clic su **Fix with AI** su un'eccezione non risolta, oppure un altro pulsante o trigger avvia un'attività (vedi [Dove partono le attività di correzione](#dove-partono-le-attività-di-correzione)).
2. L'attività entra in coda, e un Runner disponibile con **Esegue le correzioni di codice AI** attivato la prende.
3. Il Runner recupera il contesto dell'attività. Per un'eccezione, sono il tipo, il messaggio e lo stack trace.
4. Clona il repository in un proprio spazio di lavoro e crea un branch. Una correzione di un'eccezione si chiama `oneuptime-fix-exception-` seguito dai primi caratteri dell'id dell'esecuzione.
5. Un agente di codice, alimentato dal provider LLM del tuo progetto, legge il codice e scrive la modifica. Il server OneUptime effettua le chiamate al LLM, quindi il Runner non possiede mai la chiave API del tuo provider, e ogni chiamata viene misurata ed elencata nei log dell'IA.
6. Se il repository ha comandi di verifica, un Runner tuo compila e testa la modifica prima di fare qualsiasi commit, e restituisce un errore all'agente di codice perché lo ripari (vedi [Verifica prima della pull request](#verifica-prima-della-pull-request)).
7. Il Runner fa il commit, il push del branch, apre la pull request ed elimina lo spazio di lavoro.

La pagina da cui è stata avviata l'attività ne mostra lo stato in tempo reale. Ogni attività è elencata in **Prodotti → Codice → Attività**: aprine una per vedere la **Panoramica**, i **Registri** (una riga per ogni file che il Runner ha letto o scritto e per ogni comando che ha eseguito) e le **Pull Request**.

Ogni esecuzione è soggetta a budget che il server impone: al massimo **40 chiamate al LLM** e **100.000 token di output**. Un'esecuzione che ne raggiunge uno termina con un riepilogo del lavoro svolto fin lì invece di girare a vuoto. Le esecuzioni di correzione contano anche per i limiti giornalieri di IA del progetto, quando il progetto li imposta.

## Dove partono le attività di correzione

| Dove | Clic | La pull request |
| --- | --- | --- |
| La pagina **AI Assistance** di un'eccezione | **Fix with AI** | Corregge il bug dietro l'eccezione. |
| La pagina **AI Assistance** di un'eccezione | **Generate Regression Test** | Aggiunge un test che riproduce l'eccezione e fallisce finché il bug non è corretto. |
| La pagina **AI Assistance** di un'eccezione | **Improve Error Handling** | Per un errore previsto, come un input non valido: toglie i dati utente dal messaggio, convalida l'input prima e contrassegna l'errore come gestito, senza cambiare il comportamento. |
| La scheda **AI Investigation** di un incidente o di un avviso | **Open Fix PR from this analysis** | Corregge la causa principale pubblicata dall'indagine (vedi [Correzioni di codice automatiche dalle indagini](#correzioni-di-codice-automatiche-dalle-indagini)). |
| Una traccia | **Fix performance with AI** | Corregge lo schema lento trovato nella traccia, come query N+1 o un singolo span lento dominante. |
| La pagina **Registri** di un servizio | **Improve Logging** | Rende i log del servizio strutturati, con la severità giusta e collegati alle sue tracce, senza cambiare il comportamento. |
| La pagina **Tracce** di un servizio | **Improve Tracing** | Aggiunge span e attributi dove manca il tracing del servizio, senza cambiare il comportamento. |

Per aprire la pagina **AI Assistance** di un'eccezione, apri l'eccezione in **Prodotti → Osservabilità → Eccezioni** e scegli **AI Assistance** nel suo menu laterale. Un'eccezione risolta o archiviata deve prima essere contrassegnata come non risolta.

OneUptime AI avvia anche attività di correzione da solo: da un'indagine che trova una modifica al codice, da una che termina senza conclusioni perché mancava telemetria, e dagli AI Insights su eccezioni e tracce lente. Ognuna ha il suo interruttore; vedi [Correzioni di codice automatiche](/docs/ai/ai-sre#correzioni-automatiche-del-codice).

## Verifica prima della pull request

Un repository di codice può avere fino a tre comandi di verifica nella sua pagina **Impostazioni**, in **Repository di codice**:

| Comando | Esempio | Quando viene eseguito |
| --- | --- | --- |
| **Setup Command** | `npm ci` | Per primo, per installare le dipendenze. |
| **Build Command** | `npm run build` | Dopo il setup. |
| **Test Command** | `npm test` | Per ultimo. |

Quando uno di essi è impostato, ogni esecuzione di correzione verifica la sua modifica prima che si apra la pull request:

1. Quando l'agente di codice ha finito, i comandi vengono eseguiti in ordine nella radice del repository, sul Runner, nello spazio di lavoro clonato. Ognuno ha fino a 15 minuti e viene eseguito con `CI=true`, così niente resta in attesa di un input; il primo errore ferma il passaggio.
2. In caso di errore, la parte finale dell'output del comando fallito torna allo stesso agente di codice come attività di riparazione, con l'istruzione di correggere la propria modifica invece di indebolire o saltare i test, e i comandi vengono eseguiti di nuovo. Fa al massimo **2** tentativi di riparazione. Condividono il budget LLM dell'esecuzione, e le loro modifiche finiscono nello stesso commit della correzione.
3. L'esito, superato, fallito o saltato (nessun comando impostato, o un Runner condiviso), viene scritto in una sezione Verification della descrizione della pull request e registrato sulla pull request dell'attività.

Una modifica che continua a non superare la verifica non viene scartata: la pull request si apre comunque, con una sezione "Verification failed" ben evidenziata che nomina il comando fallito e termina con il suo output. Il lavoro resta, e chi rivede decide. Un repository senza comandi impostati viene segnalato come saltato, invece di far pensare a una build verde.

I comandi sono impostazioni del repository che scrive il tuo team, eseguite sul tuo Runner: lo stesso modello di fiducia dei passaggi Bash di un runbook. L'IA non li scrive né li modifica mai. I Runner condivisi di OneUptime non li eseguono mai: su un Runner condiviso la correzione viene scritta e aperta per la revisione, la verifica viene segnalata come saltata e la CI del tuo repository controlla la modifica. [Esegui un Runner tuo](#esegui-un-runner-tuo) per far compilare e testare le correzioni prima che si apra la pull request.

## Prima di iniziare

Un'attività di correzione ha bisogno di tre cose. La pagina **AI Assistance** dell'eccezione le controlla tutte e tre prima di offrire l'avvio, e dice cosa manca.

| Cosa | OneUptime Cloud | Self-hosted |
| --- | --- | --- |
| Un provider LLM | Niente da configurare: un progetto senza un proprio provider usa il provider globale, pagato con i crediti IA del progetto. Un tuo provider, in **Impostazioni del progetto → IA → Provider LLM**, ha la precedenza. | Imposta una volta sul server le variabili d'ambiente `GLOBAL_LLM_PROVIDER_*`, oppure aggiungi un provider al progetto. |
| Un repository collegato tramite la GitHub App | **Prodotti → Codice → Attività**, poi **Repository di codice** e **Connect with GitHub App**. Se l'app è già installata sull'account GitHub, fai invece clic su **Collega un'installazione esistente**: installarla di nuovo non la collega. Richiede il piano Growth. | Lo stesso, una volta che la tua istanza ha una GitHub App (vedi [Integrazione con GitHub](/docs/self-hosted/github-integration)). |
| Un Runner che esegue le correzioni di codice AI | Niente da gestire: se ne occupano i Runner condivisi di OneUptime. | Il servizio `runner` di Docker Compose, o il Runner del chart Helm (`runner.enabled`, attivo per impostazione predefinita), si registra da solo ed esegue le correzioni di codice AI. |

Su un'istanza self-hosted, il provider globale è un blocco di `config.env` (Docker Compose) o dei tuoi valori Helm. Per un Ollama self-hosted:

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach, never localhost.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No GLOBAL_LLM_PROVIDER_API_KEY needed — Ollama is keyless.
```

Qualsiasi provider supportato funziona: vedi [Provider LLM](/docs/ai/llm-provider) per tutti i provider e ogni variabile d'ambiente.

Non associ i repository ai servizi. Quando un'attività parte, OneUptime trova il repository confrontando i percorsi dei file dello stack trace dell'eccezione con i tuoi repository collegati. Se nulla corrisponde, ripiega su un repository che si chiama come il servizio, e poi sull'unico repository del progetto quando ce n'è uno solo. La pagina **AI Assistance** mostra quale repository ha trovato.

### Esegui un Runner tuo

Per eseguire un Runner altrove, ad esempio su una macchina vicina ai tuoi repository:

:::steps
### Crea il Runner

Crea un Runner in **Runbook → Agenti di runbook** e fai clic su **Mostra istruzioni di configurazione** nella sua riga. Il comando contiene la chiave segreta del Runner, che solo un Project Owner, Project Admin o Runbook Admin può leggere. Ha questo aspetto:

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=<your-oneuptime-url> \
  -d oneuptime/runner:release
```

### Attiva le correzioni di codice AI

Attiva **Esegue le correzioni di codice AI** sul Runner. È disattivato per impostazione predefinita, e il Runner recepisce la modifica al suo prossimo heartbeat, entro circa un minuto; non c'è nulla da riavviare.

### Verifica che si colleghi

Il Runner risulta collegato nella pagina **Runbook → Agenti di runbook** entro un paio di minuti. Se non succede, leggi il log del container (`docker logs oneuptime-runner`) per cercare un errore di credenziali o di rete.
:::

Qualsiasi modo di eseguire il container funziona (Docker Compose, Kubernetes e così via), purché abbia queste variabili e possa raggiungere la tua istanza OneUptime via HTTPS:

| Variabile | Cos'è |
| --- | --- |
| `ONEUPTIME_RUNNER_ID` | L'id del Runner, dalla dashboard. |
| `ONEUPTIME_RUNNER_KEY` | La chiave segreta del Runner. |
| `ONEUPTIME_URL` | L'indirizzo della tua istanza OneUptime (`https://oneuptime.com` su OneUptime Cloud). |

> [!NOTE]
> Prima di OneUptime 12, le correzioni di codice AI giravano su un componente AI Agent separato (l'immagine `oneuptime/ai-agent` con variabili `AI_AGENT_*`). È confluito nel Runner: se ne esegui ancora uno, la [guida all'aggiornamento da v11 a v12](/docs/installation/upgrading) spiega come sostituirlo.

## Correzioni di codice automatiche dalle indagini

Quando un'[indagine IA](/docs/ai/ai-sre) pubblica un'analisi della causa principale su un incidente o un avviso, e la sua attenta classificazione raccomanda una modifica al codice, la scheda dell'indagine offre **Open Fix PR from this analysis**: un'attività di correzione il cui intero contesto è l'analisi pubblicata. Il pulsante è nascosto quando il rimedio è operativo, solo infrastrutturale, esterno, un rifiuto previsto, un errore dell'utente o non conclusivo. Le correzioni idonee avvengono senza il clic finché l'interruttore **Apri una pull request di correzione quando un'indagine trova una modifica al codice** è attivo. Fa parte della correzione: si trova sotto **Correggi automaticamente i nuovi incidenti** in **Incidenti → IA → Impostazioni** (e sotto **Correggi automaticamente i nuovi avvisi** in **Avvisi → IA → Impostazioni**), si attiva quando si attiva la correzione e apre pull request solo finché la correzione è attiva. Entrambi partono disattivati, anche per i nuovi progetti.

Finché è attivo, un'indagine che termina con una causa principale certa e documentata, che una modifica al codice può correggere, mette in coda la stessa attività di correzione che crea il pulsante. La decisione è una classificazione vincolata che il server controlla, mai uno schema cercato nel testo dell'analisi: solo un verdetto positivo di correzione del codice apre una pull request. Prove mancanti, un rimedio fuori dal codice e una classificazione fallita portano tutti a non fare nulla.

Tutto il resto è come il pulsante:

- La pull request si apre pronta per la revisione, scritta a partire dall'analisi pubblicata, e richiede un repository collegato tramite la GitHub App e un Runner con **Esegue le correzioni di codice AI** attivato.
- Conta per il limite giornaliero di attività di correzione di quel segnale (**Daily Incident AI Fix Task Limit** o **Daily Alert AI Fix Task Limit**, in **Altre impostazioni** nella sua pagina delle impostazioni IA) e per il tetto di pull request aperte del repository, quando uno dei due è impostato. Se non sono impostati, nessuno dei due limita nulla.
- Ogni trigger cerca prima un'attività di correzione già in coda o in esecuzione per lo stesso incidente o avviso, così un trigger automatico e un clic diventano di solito un'unica attività, non due pull request. Il controllo è una lettura prima della scrittura, non un blocco, quindi due trigger nello stesso istante possono comunque passare entrambi.
- L'esecuzione è scritta dal sistema, non è attribuita a nessuno, e niente viene unito da solo.

## Quando una correzione non riesce

:::details L'esecuzione va in errore
La correzione non si è potuta applicare, il repository non era raggiungibile o la chiamata al LLM è fallita. La pagina da cui è stata avviata l'attività mostra il motivo e offre di riprovare. La pagina **Registri** dell'attività contiene il log completo dell'esecuzione.
:::

:::details Il Runner si ferma a metà di un'esecuzione
Un'esecuzione il cui heartbeat tace da più di 12 minuti viene chiusa con un errore. Non viene mai rimessa in coda da sola, perché il Runner potrebbe aver già fatto il push di una parte di un branch di correzione; riavviala da dove l'avevi avviata.
:::

:::details Nessun Runner prende l'attività
Un'attività che aspetta più di 30 minuti mentre non è collegato nessun Runner con **Esegue le correzioni di codice AI** fallisce, con un messaggio che invita a controllare il Runner, così non risulta mai in corso per sempre. Quando un Runner è online ma occupato, le attività in coda aspettano il loro turno.
:::

## Privacy

Il clone del tuo repository vive in uno spazio di lavoro dentro il container del Runner e viene eliminato al termine dell'esecuzione, che sia riuscita o no. Il Runner non possiede mai la chiave API del tuo provider LLM: il server OneUptime effettua le chiamate al LLM per lui. OneUptime non conserva il tuo repository e non si addestra sul tuo codice. Il log dell'attività conserva i primi 300 caratteri dell'output di ogni passaggio, così puoi controllare cosa ha fatto il Runner, e questo può includere frammenti di codice. Esegui un Runner self-hosted con il tuo provider LLM (Ollama locale compreso) e il tuo codice non lascia mai la tua infrastruttura.

## In programma

Previsto, e **non ancora disponibile**:

- **Supporto per GitLab.** I repository si collegano solo tramite la GitHub App.
- **Più telemetria in una correzione.** Portare nella correzione le tracce, i log e le metriche attorno a un'eccezione, oltre lo stack trace.

## Passi successivi

:::cards
- [GitHub App](/docs/ai/github-app): Chiedi una modifica, una revisione o una review direttamente da GitHub.
- [AI SRE](/docs/ai/ai-sre): Le indagini le cui analisi le attività di correzione possono trasformare in pull request.
- [Agenti di runbook](/docs/runbooks/agents): Il worker che svolge ogni esecuzione di correzione.
:::
