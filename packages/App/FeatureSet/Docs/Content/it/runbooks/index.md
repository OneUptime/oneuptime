# Panoramica dei Runbook

Un runbook è una procedura di risposta riutilizzabile: un elenco ordinato di passaggi manuali e automatici che esegui su un incidente, un avviso o un evento di manutenzione programmata. Trasforma il thread «e adesso che facciamo?» in una checklist che chiunque sia reperibile può seguire alle 3 di notte, con script, chiamate API e approvazioni già scritti. I runbook sono pensati per gli ingegneri reperibili che rispondono agli incidenti e per i team di piattaforma che automatizzano quella risposta.

:::cards
- [Scrivere un runbook](/docs/runbooks/authoring): Creare un runbook e scriverne i passaggi.
- [Regole di runbook](/docs/runbooks/rules): Avviare i runbook su nuovi incidenti, avvisi ed eventi di manutenzione.
- [Eseguire un runbook](/docs/runbooks/running): Avviare un'esecuzione, completarne e approvarne i passaggi, annullarla.
- [Trigger dei runbook](/docs/runbooks/triggers): Eseguire un runbook secondo una pianificazione, o da un altro strumento tramite il suo URL del webhook.
- [Variabili dei runbook](/docs/runbooks/variables): Gli host, le chiavi, le password e i kubeconfig che i tuoi passaggi usano per nome.
- [Agenti di runbook](/docs/runbooks/agents): Installare il Runner che esegue i tuoi script nella tua infrastruttura.
:::

## Come viene eseguito un runbook

```mermaid title="Da un trigger a un risultato registrato"
flowchart TB
    subgraph triggers["Cosa avvia un'esecuzione"]
        direction LR
        rule["Regola di<br/>runbook"]
        manual["Esegui<br/>Runbook su<br/>un evento"]
        runnow["Run Now<br/>sul runbook"]
    end
    rule --> execution["Esecuzione:<br/>un'istantanea<br/>dei passaggi"]
    manual --> execution
    runnow --> execution
    execution --> worker["Il Worker<br/>di OneUptime<br/>esegue<br/>i passaggi<br/>in ordine"]
    worker -->|"Passaggio<br/>Manual o<br/>approvazione"| person["Attende<br/>una persona"]
    worker -->|"Passaggi<br/>HTTP e IA"| onworker["Viene eseguito<br/>sul Worker"]
    worker -->|"JavaScript,<br/>Bash, SSH,<br/>kubectl"| runner["Runner<br/>nella tua<br/>infrastruttura"]
    person --> record["Stato,<br/>output<br/>ed errori<br/>registrati"]
    onworker --> record
    runner --> record
    record --> history["Pagina<br/>Runbook<br/>dell'evento<br/>ed Esecuzioni<br/>del runbook"]
```

Ogni esecuzione di un runbook è un'**esecuzione**. All'avvio, i passaggi del runbook vengono copiati su di essa e OneUptime li esegue in ordine. Un passaggio Manual, o un passaggio che richiede approvazione, mette in pausa l'esecuzione finché qualcuno non agisce.

I passaggi HTTP e IA vengono eseguiti sul Worker di OneUptime. I passaggi Bash, SSH e kubectl vengono eseguiti su un [Runner](/docs/runbooks/agents) che installi nella tua infrastruttura, quindi quegli script non girano mai sui server di OneUptime. Un passaggio JavaScript viene eseguito anch'esso su uno dei tuoi Runner oppure, se non ne sceglie nessuno e il progetto non ha un [Runner predefinito](/docs/runbooks/agents#il-runner-predefinito-del-progetto), su un [Runner globale](/docs/runbooks/agents#runner-globali), in una sandbox che raggiunge solo internet. Lo stato, l'output e il messaggio di errore di ogni passaggio vengono registrati sull'esecuzione, che resta legata all'incidente, all'avviso o all'evento per cui è stata eseguita.

## Concetti chiave

| Termine | Significato |
| --- | --- |
| **Runbook** | Il modello. Una procedura con un nome, riutilizzabile, con un elenco ordinato di passaggi e un interruttore **Esegui questo runbook**. |
| **Passaggio** | Un elemento di un runbook. Ha un tipo (Manual, JavaScript, HTTP request, Bash, SSH, kubectl o AI), un titolo, una descrizione e impostazioni specifiche del tipo. |
| **Regola di runbook** | Una regola che collega automaticamente uno o più runbook agli incidenti, agli avvisi o agli eventi di manutenzione programmata che soddisfano le sue condizioni: i loro monitor, la gravità, le etichette, le etichette dei monitor, il titolo o la descrizione. |
| **Esecuzione** | Un'esecuzione di un runbook. Viene creata quando scatta una regola, quando qualcuno fa clic su **Esegui Runbook** su un evento o quando qualcuno fa clic su **Run Now** sul runbook stesso. Contiene un'istantanea dei passaggi e lo stato e l'output di ciascuno. |
| **Istantanea** | La copia congelata dei passaggi del runbook che vive su ogni esecuzione. Puoi modificare il runbook in seguito senza riscrivere la storia delle esecuzioni passate. |
| **Runner** | Un piccolo agente che esegui su un host della tua infrastruttura. Esegue i passaggi JavaScript, Bash, SSH e kubectl che lo indicano. Detto anche agente di runbook. Un Runner globale, uno di quelli che OneUptime esegue per ogni progetto, esegue i passaggi JavaScript che non ne nominano nessuno, a meno che il progetto non abbia un Runner predefinito. |
| **Variabile** | Un valore che i passaggi usano per nome, come un host o un URL: `{{global.variables.NAME}}` per uno del progetto, che ogni runbook può usare, oppure `{{local.variables.NAME}}` per uno proprio del runbook. |
| **Segreto** | Una variabile il cui valore è cifrato a riposo, non viene mai più mostrato ed è nascosto in ciò che i passaggi stampano, come una chiave SSH, una password, un kubeconfig o un token API. Consegnato solo ai Runner a cui consenti di usarlo; i Runner globali lo ricevono solo se lo consenti. |

## Tipi di passaggio

Scegli il tipo adatto a ogni passaggio. [Scrivere un runbook](/docs/runbooks/authoring) descrive le impostazioni di ogni tipo.

| Tipo di passaggio | Viene eseguito su | Usalo quando… | Esempio |
| --- | --- | --- | --- |
| **Manual** | Una persona | Una persona deve verificare qualcosa, valutare una situazione o agire dove OneUptime non può. | «Conferma che il traffico è passato alla regione secondaria.» |
| **JavaScript** | Un Runner | Ti serve un piccolo calcolo isolato, in sandbox. | Calcolare il ritardo di replica e decidere se procedere. |
| **HTTP request** | Il Worker di OneUptime | Chiami un'API esistente: un provider cloud, PagerDuty, un webhook Slack, il tuo servizio. | `POST` al tuo orchestratore di failover. |
| **Bash** | Un Runner | Ti servono comandi di shell sulla tua infrastruttura. | Eseguire uno script di ripristino, o chiamare con `curl` un servizio raggiungibile solo dalla tua rete. |
| **SSH** | Un Runner | Ti serve uno script bash su una macchina remota, con accesso tramite una variabile segreta. | Riavviare un servizio su un server web. |
| **kubectl** | Un Runner | Ti servono comandi kubectl su un cluster. | Riavviare `checkout-api` in `production`, poi attendere i nuovi pod. |
| **AI** | Il Worker di OneUptime | Vuoi un'analisi, un riepilogo o una valutazione durante l'esecuzione, dal provider LLM del tuo progetto. | «Esamina la diagnostica qui sopra. Il failover è sicuro?» |

Un runbook può combinarli tutti. La forza dei runbook sta nell'alternare verifiche umane, automazione e analisi dell'IA.

## Cosa avvia un'esecuzione

| Come | Dove | L'esecuzione è collegata a |
| --- | --- | --- |
| Una regola di runbook | **Incidenti**, **Avvisi** o **Manutenzione programmata** → **Regole** → **Regole di runbook** | Il nuovo incidente, avviso o evento |
| **Esegui Runbook** | La pagina **Runbook** di un incidente, un avviso o un evento di manutenzione programmata | Quell'evento |
| **Run Now** | La pagina **Panoramica** del runbook | Niente: un'esecuzione estemporanea |
| Una regola IA | Vedi [AI SRE](/docs/ai/ai-sre) | L'incidente o l'avviso |
| La pianificazione del runbook | La pagina **Trigger** del runbook, vedi [Trigger dei runbook](/docs/runbooks/triggers#eseguire-secondo-una-pianificazione) | Nulla: un'esecuzione non presidiata |
| Una chiamata all'URL del webhook del runbook | La pagina **Trigger** del runbook, vedi [Trigger dei runbook](/docs/runbooks/triggers#chiamare-il-webhook) | Nulla: l'esecuzione conserva i valori inviati dalla chiamata |

Un runbook con l'interruttore **Esegui questo runbook** disattivato, nella sua pagina **Impostazioni**, non viene avviato da nessuna di queste vie. Le esecuzioni già partite proseguono.

## Dove si trovano i runbook nella dashboard

Runbook si trova in **Prodotti**, nel gruppo **Dashboard e automazione**.

| Pagina | Cosa fai lì |
| --- | --- |
| **Prodotti → Runbook** | Sfogliare, creare e aprire runbook. |
| I **Passaggi** di un runbook | Scrivere e riordinare i passaggi, poi **Save Steps**. |
| La **Panoramica** di un runbook | Vedere l'ultima esecuzione e i risultati, e fare clic su **Run Now**. |
| Le **Esecuzioni** di un runbook | Tutte le esecuzioni di questo runbook, filtrate per stato o data di inizio. |
| **Trigger** di un runbook | Eseguirlo secondo una [pianificazione](/docs/runbooks/triggers#eseguire-secondo-una-pianificazione), o da un altro strumento tramite il suo [URL del webhook](/docs/runbooks/triggers#chiamare-il-webhook). |
| Le **Variabili** di un runbook | Gestire le [variabili](/docs/runbooks/variables) che usano solo i passaggi di quel runbook. |
| I **Proprietari** di un runbook | Aggiungere le persone e i team che ne sono responsabili. |
| Le **Impostazioni** di un runbook | Disattivare **Esegui questo runbook** senza eliminare il runbook. |
| **Runbook → Esecuzioni** | Tutte le esecuzioni di tutti i runbook del progetto. |
| **Runbook → Agenti di runbook** | Installare i [Runner](/docs/runbooks/agents) su cui girano i passaggi dei runbook. |
| **Runbook → Impostazioni** | Gestire, in **Variabili globali**, le variabili che ogni runbook può [usare](/docs/runbooks/variables), e le **Regole del proprietario** e **Regole etichette** che aggiungono proprietari ed etichette ai nuovi runbook. |
| **Incidenti / Avvisi / Manutenzione programmata → Regole → Regole di runbook** | Creare le regole che avviano automaticamente i runbook. |
| Un incidente, un avviso o un evento di manutenzione → **Runbook** | Vedere le esecuzioni collegate e fare clic su **Esegui Runbook** per avviarne una. |

Il menu laterale di un runbook raggruppa le sue pagine così. Solo **Base** è aperta all'inizio: fai clic sul titolo di una sezione per aprirla. Una sezione si apre da sola su qualsiasi sua pagina.

| Sezione | Pagine |
| --- | --- |
| **Base** | **Panoramica**, **Passaggi** |
| **Registri** | **Esecuzioni** |
| **Proprietari** | **Proprietari** |
| **Impostazioni** | **Trigger**, **Variabili**, **Impostazioni** |
| **Sviluppatori** | **Terraform**, **API**, **Assistenti IA** |
| **Avanzato** | **Registri di audit**, **Elimina runbook** |

## Un esempio completo

Supponi di voler fare in modo che ogni incidente con «db-primary» nel titolo avvii un runbook di failover del database in cinque passaggi.

:::steps
### Crea il runbook

In **Runbook**, fai clic su **Crea: Runbook** e chiamalo «DB primary failover». Si apre su **Passaggi**: aggiungi questi passaggi e fai clic su **Save Steps**:

| # | Tipo | Titolo |
| --- | --- | --- |
| 1 | JavaScript | Rilevare il ritardo di replica prima del failover |
| 2 | Manual | Confermare nella dashboard dei DBA che la replica è sana |
| 3 | HTTP request | `POST` all'orchestratore di failover |
| 4 | Manual | Verificare che le scritture vadano al nuovo primario |
| 5 | HTTP request | Pubblicare il cessato allarme in `#db-incidents` su Slack |

### Aggiungi una regola

In **Incidenti → Regole → Regole di runbook**, crea una regola con una condizione e il runbook da avviare:

```text
Conditions:  Incident Title starts with db-primary
Runbooks:    [DB primary failover]
```

### Lascialo eseguire

Un monitor apre l'incidente `INC-4821 · db-primary connection timeout`. La regola corrisponde e parte un'esecuzione:

- Il passaggio 1 (JavaScript) viene eseguito sul Runner che hai scelto per lui. Il suo valore di ritorno, ad esempio `{ lagMs: 412 }`, viene acquisito. Un passaggio che non sceglie alcun Runner viene eseguito sul Runner predefinito del progetto oppure, se non ce n'è uno, su un Runner globale.
- Il passaggio 2 (Manual) mette in pausa l'esecuzione, che mostra **In attesa di te**. Chi è reperibile controlla la dashboard e fa clic su **Segna come completato**.
- Il passaggio 3 (HTTP request) viene eseguito e la risposta al `POST` viene acquisita.
- Il passaggio 4 (Manual) mette di nuovo in pausa l'esecuzione finché qualcuno non lo completa.
- Il passaggio 5 (HTTP request) viene eseguito e l'esecuzione risulta **Completato**.

### Rivedilo

L'esecuzione resta nella pagina **Runbook** dell'incidente. Quando scrivi il postmortem, l'output, l'errore e i tempi di ogni passaggio sono a un clic di distanza.
:::

## Casi d'uso comuni

- **Failover del database**: acquisire lo stato con JavaScript, chiedere al DBA reperibile di confermare la salute della replica (Manual), chiamare l'orchestratore (HTTP request), confermare il DNS (Manual), pubblicare il cessato allarme (HTTP request).
- **Svuotamento della cache**: una richiesta HTTP, poi un passaggio Manual «conferma che l'hit rate della cache si sta riprendendo».
- **Incidente con impatto sui clienti**: Manual «pubblica un aggiornamento sulla pagina di stato», una richiesta HTTP per avvisare il team di supporto, JavaScript per ottenere l'elenco degli account coinvolti.
- **Verifiche prima di una manutenzione programmata**: fotografare le metriche, confermare la finestra di modifica con le parti interessate (Manual), attivare la modalità di manutenzione sul bilanciatore di carico (HTTP request).
- **Diagnosticare, poi correggere**: un passaggio Bash raccoglie la diagnostica, un passaggio IA la legge e propone una correzione, e un passaggio kubectl con **Richiedi approvazione** riavvia il carico di lavoro solo dopo che una persona lo ha approvato.
- **Igiene da eseguire sempre**: una regola senza condizioni che acquisisce lo stato del sistema a ogni incidente, per il postmortem.

## Come si inseriscono i runbook nel resto di OneUptime

- I **monitor** aprono incidenti e avvisi, e le **regole di runbook** li trasformano in esecuzioni di runbook: rilevare, attivare, rispondere, registrare.
- Le **[politiche di reperibilità](/docs/on-call/schedules)** decidono chi viene chiamato. I runbook decidono cosa fa quella persona una volta sveglia.
- Le **[connessioni all'area di lavoro](/docs/workspace-connections/slack)** come Slack e Microsoft Teams sono destinazioni naturali per i passaggi di richiesta HTTP che pubblicano aggiornamenti.
- Le **[pagine di stato](/docs/status-pages/index)** vengono spesso aggiornate in un passaggio Manual di un runbook rivolto ai clienti.

## Prossimi passi

:::cards
- [Scrivere un runbook](/docs/runbooks/authoring): Creare il tuo primo runbook e i suoi passaggi.
- [Agenti di runbook](/docs/runbooks/agents): Installare un Runner prima di scrivere un passaggio Bash, SSH o kubectl.
- [Regole di runbook](/docs/runbooks/rules): Avviare i runbook automaticamente alla creazione degli incidenti.
- [Configurazione e sicurezza dei runbook](/docs/runbooks/configuration): Limiti, timeout, autorizzazioni e protezione.
:::
