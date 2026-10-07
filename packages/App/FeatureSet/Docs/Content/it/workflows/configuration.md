# Configurazione e sicurezza

Questa pagina raccoglie le impostazioni e i limiti di sicurezza che vale la pena conoscere prima di puntare un workflow su traffico reale.

## Accendere o spegnere un workflow

Ogni workflow ha un interruttore **Abilitato** in cima al suo **Costruttore** e nella sua pagina **Panoramica**. Quando è spento, il workflow non viene eseguito — chiamate al webhook, orari pianificati ed eventi di OneUptime vengono tutti ignorati, e così **Esegui flusso di lavoro** e **Run just this step**. I workflow nuovi partono disabilitati.

Usa quell'interruttore come tuo cancello del "pronto a partire":

1. Costruisci il workflow.
2. Clicca **Esegui flusso di lavoro** nel **Costruttore** con valori realistici. Un workflow disabilitato non si esegue nemmeno a mano, quindi il Costruttore chiede prima di attivarlo: clicca **Attiva ed esegui**.
3. Controlla i **Registri** — assicurati che ogni blocco sia andato dove ti aspettavi.
4. Lascia **Abilitato** acceso se è pronto. Se non lo è, spegnilo finché non lo sarà: mentre è acceso, il suo trigger scatta con eventi reali.

Spegnere un workflow non ferma le esecuzioni già in corso; impedisce soltanto che ne partano di nuove.

## Proprietari ed etichette

- **Proprietari** — gli utenti e i team elencati come proprietari ottengono l'accesso al workflow e possono scegliere di ricevere una notifica quando fallisce. Li imposti in **Impostazioni → Proprietari**.
- **Etichette** — tag per raggruppare i workflow. L'elenco dei workflow si può filtrare per etichetta, il che rende molto più navigabile un progetto affollato. Utili quando organizzi i workflow per team, integrazione o ambiente.
- **Regole etichette** — sotto **Flussi di lavoro → Impostazioni → Regole etichette**, applicano automaticamente le etichette ai nuovi workflow in base a schemi nel nome o nella descrizione.
- **Regole del proprietario** — sotto **Flussi di lavoro → Impostazioni → Regole del proprietario**, assegnano automaticamente i proprietari ai nuovi workflow.

## Segreti

Contrassegna una variabile globale come **secret** se contiene qualcosa di sensibile. Dopo il salvataggio il valore è nascosto alle normali letture dall'API e dall'interfaccia, e il logging del workflow lo rimuove prima che il registro dell'esecuzione venga salvato.

Usa variabili segrete per:

- Le chiavi API dei servizi esterni.
- I token di autenticazione.
- Le chiavi di firma dei webhook.
- Qualsiasi cosa non vorresti far vedere a chi ha solo accesso in lettura.

Non incollare un segreto direttamente dentro un blocco — valori come `Authorization: Bearer eyJh...` finiscono in chiaro nel workflow e nei registri. Usa invece `{{global.variables.MY_SECRET}}`.

## Esportare e importare i workflow

Puoi spostare un workflow da un progetto a un altro, o tra un'installazione self-hosted e OneUptime Cloud, sotto forma di file JSON.

- **Esportazione** — apri il workflow e usa **Export Workflow** in **Impostazioni**. Dall'elenco dei workflow puoi anche selezionarne diversi ed esportarli in un unico file.
- **Importazione** — nell'elenco **Flussi di lavoro**, clicca **Import JSON** e scegli un file esportato da un qualsiasi progetto OneUptime.

Il file contiene nome, descrizione, stato di abilitazione e grafo del workflow. Volutamente non contiene:

- **La chiave segreta del webhook.** Alla creazione del workflow ne viene generata una nuova, quindi un workflow importato ha un URL webhook diverso. Tutto ciò che chiamava l'originale va ripuntato.
- **Le variabili globali.** Un blocco che legge `{{global.variables.MY_SECRET}}` conserva quel riferimento, ma il valore non è nel file. Crea le variabili nel progetto di destinazione prima di eseguire il workflow importato.
- **Proprietari ed etichette.** Le regole di etichetta e di proprietario del progetto di destinazione vengono applicate al workflow importato, esattamente come se lo avessi creato a mano.

Un workflow importato viene sempre creato **disabilitato**, anche se era abilitato là da dove è stato esportato — il suo grafo può puntare a monitor, criteri di reperibilità o altri workflow che nel progetto di destinazione non esistono. Rivedilo, abilitalo, provalo con **Esegui flusso di lavoro** e solo allora lascialo acceso. Duplicare un workflow si comporta allo stesso modo, così una copia non inizia a scattare accanto all'originale prima che tu l'abbia modificata.

Siccome il grafo viaggia tale e quale, viaggia con lui anche tutto ciò che è stato digitato direttamente dentro un blocco. È questa la ragione pratica per tenere le credenziali in variabili segrete: esportare un workflow con un token scritto a mano significa consegnare quel token a chiunque riceva il file.

## Quanto può durare un'esecuzione

Ogni tentativo di esecuzione ha una scadenza in tempo reale. Il runner la controlla prima e dopo ogni componente e, appena riprende il controllo, marca come **Timeout** l'esecuzione fuori tempo massimo. Anche i componenti che fanno lavoro di rete o eseguono script devono avere i propri timeout, perché il runner non può interrompere forzatamente il codice arbitrario di un componente.

Il componente AI ricava il timeout della richiesta al provider dal tempo rimasto al workflow e lo limita comunque a 60 secondi, lasciando un piccolo margine per il logging e la pulizia.

## Limite alle chiamate tra workflow

Il componente **Execute Workflow** permette a un workflow di chiamarne un altro. Per evitare cicli accidentali in cui il workflow A chiama B che richiama A, c'è un tetto alla profondità della catena. Un'esecuzione che supera il limite termina con un errore esplicito.

Se hai davvero bisogno di una catena lunga (come un lavoro che elabora un elemento per esecuzione), di solito è più semplice ciclare dentro un singolo workflow usando **Custom Code**.

## Sicurezza dei webhook

I trigger webhook ti danno un URL univoco. Chiunque conosca quell'URL può chiamarlo. Per proteggerti da chiamanti accidentali o indesiderati:

- Tratta l'URL come una password. Non condividerlo pubblicamente e non committarlo in un repository pubblico.
- Per i workflow sensibili, chiedi al sistema chiamante di inviare un token condiviso come header (per esempio `X-Webhook-Token`) e verificalo con un blocco **Conditions** prima di fare qualsiasi cosa importante. Salva il token atteso come variabile segreta.
- Per i workflow molto sensibili, preferisci un trigger su evento di OneUptime e un passaggio di importazione manuale, invece di un webhook pubblico.

## Accesso alla rete in uscita

I blocchi API e gli altri blocchi HTTP effettuano le loro richieste da OneUptime. Se sei in self-hosted, assicurati che la tua installazione riesca a raggiungere i servizi che stai chiamando. Se usi OneUptime Cloud, i nostri intervalli di IP in uscita sono elencati in [Indirizzi IP](/docs/configuration/ip-addresses), così puoi autorizzarli dall'altra parte.

## Componenti AI

**Generate Text with AI** invia una sola richiesta attraverso il gateway LLM configurato in OneUptime. Usa il provider LLM predefinito del progetto, oppure il provider globale dell'installazione quando il progetto non ne ha uno. Configura i provider in **Impostazioni del progetto → IA → Provider LLM**; non mettere mai una chiave API di un provider o l'endpoint arbitrario di un modello dentro il workflow stesso.

Il componente AI ha un confine di uscita dei dati esplicito:

- OneUptime invia al provider configurato un'istruzione fissa di sicurezza del componente, più i valori risolti di **System Instructions**, **Prompt** e **Context** serializzato. Il contesto viene accodato dopo un marcatore esplicito alla fine del messaggio utente; l'istruzione fissa dice che tutto ciò che segue quel marcatore resta dato non attendibile, anche quando contiene tag o istruzioni.
- Non allega automaticamente il payload del trigger, la cronologia del workflow, gli output di altri componenti, i record del progetto, la telemetria o i segreti. I dati escono solo quando li richiami tu in uno di quei tre input.
- Non invia definizioni di strumenti né campi di capacità nativi del provider. Attraverso questo componente il modello non può interrogare OneUptime, fare richieste HTTP o modificare i dati del progetto. Il provider e il modello configurati restano un confine di fiducia gestito dall'amministratore, quindi le installazioni che richiedono una generazione rigorosamente offline dovrebbero scegliere un modello privo di recupero dati intrinseco gestito dal provider.
- I parametri aggiuntivi a livello di provider sono limitati a un elenco di campi consentiti che regolano solo la generazione. Non possono sostituire i messaggi del workflow, aggiungere strumenti o ricerche web e sorgenti dati native del provider, abilitare modalità diverse dal testo, richiedere più risposte alternative, abilitare lo streaming, far conservare la richiesta tramite flag di archiviazione del provider, né alzare il tetto di token in uscita di questo componente. I campi di capacità futuri e sconosciuti vengono scartati per impostazione predefinita.
- System Instructions, Prompt, Context e i valori della Response generata vengono oscurati nelle voci di argomenti e valori di ritorno di questo componente AI nel registro automatico di esecuzione del workflow. Restano invece disponibili ai componenti successivi mentre l'esecuzione è in corso. Se ne inserisci uno in un altro componente, vale la politica di logging di quel componente, che potrebbe registrare il valore risolto: considera il riutilizzo una divulgazione esplicita. Nomi di provider e modello, conteggi dei token, LLM Log ID e messaggi di errore sicuri restano visibili per esigenze operative e di fatturazione. I corpi grezzi degli errori del provider sono esclusi dai registri dei workflow, dai registri LLM, dai registri applicativi e dalle tracce, perché un provider può restituire il contenuto della richiesta.

Tratta ogni variabile richiamata come un dato che stai deliberatamente inviando al provider. In particolare, non inserire una variabile globale segreta nel prompt o nel contesto a meno che quella divulgazione sia necessaria e il provider sia autorizzato a riceverla. Un provider locale self-hosted come Ollama può tenere la richiesta dentro la tua infrastruttura; un provider ospitato riceve la richiesta secondo i termini di trattamento dei dati di quel provider.

Ogni chiamata viene registrata in **Impostazioni del progetto → IA → Registri IA**, con provider, modello, stato, token, costo e informazioni di fatturazione. Le anteprime di prompt e risposta e i dettagli grezzi degli errori del provider non vengono conservati nel registro IA. Le chiamate che passano da un provider globale a pagamento consumano il credito IA del progetto. L'IA nei workflow rientra anche nel budget giornaliero di token per l'IA autonoma del progetto; quando il budget si esaurisce, il componente prende il percorso **Error** senza contattare il modello. L'IA del progetto deve essere abilitata. Su OneUptime Cloud l'abbonamento deve essere in regola ed è richiesto il piano Growth (o un piano che ne includa le funzionalità); le installazioni self-hosted con la fatturazione disattivata non hanno questo vincolo di piano.

Alcuni limiti integrati mantengono finite le chiamate non presidiate: System Instructions, Prompt e Context serializzato hanno un tetto complessivo di 50.000 caratteri; Temperature deve stare tra `0` e `1`; Maximum Output Tokens deve stare tra `1` e `4096` (predefinito `1024`); e la richiesta al provider viene tentata una sola volta e scade dopo al massimo 60 secondi. Per ogni progetto non vengono eseguite più di tre chiamate IA di workflow in parallelo; le chiamate in eccesso prendono il percorso **Error** e possono essere ritentate da un'esecuzione successiva. Errori di convalida, configurazione, accesso, budget, credito, concorrenza, provider e timeout prendono tutti il percorso **Error** e popolano l'output **Error**. Collega quel percorso prima di abilitare un workflow in produzione.

## Autorizzazioni

I workflow rispettano il controllo degli accessi basato sui ruoli del tuo progetto. I tre ruoli dei workflow:

- **Workflow Admin** — costruisce i workflow: li crea, li modifica, li esegue e li elimina, e gestisce le variabili che usano.
- **Workflow Member** — li usa: apre i workflow e le loro esecuzioni, ed esegue un workflow a mano con **Esegui flusso di lavoro**. Un membro non può creare, modificare o eliminare un workflow, né eseguire da solo uno dei suoi passaggi.
- **Workflow Viewer** — legge i workflow e le loro esecuzioni.

**Project Owner** e **Project Admin** possono fare tutto ciò che fa un Workflow Admin. **Project Member** può creare ed eliminare workflow, ma non modificarli né eseguirli.

Le singole autorizzazioni, per un team o una chiave API che ha bisogno esattamente di una cosa:

- **Create / Read / Edit / Delete Workflow** — le autorizzazioni di base sul workflow stesso. Modificare un workflow, anche attivarlo, disattivarlo o archiviarlo, richiede **Edit Workflow**; **Delete Workflow** serve solo a eliminare.
- **Edit Workflow** — è anche ciò che serve per eseguire da solo un passaggio con **Run just this step**, e per vedere o reimpostare l'URL del webhook e l'indirizzo email in entrata di un workflow. Eseguire a mano un intero workflow richiede **Edit Workflow**, **Workflow Admin** o **Workflow Member**.
- **Read Workflow Log** — serve per vedere le esecuzioni.
- **Read / Create / Edit / Delete Workflow Variable** — il controllo sull'elenco delle variabili globali.

Un'esecuzione a mano raggiunge solo i workflow che puoi aprire: un ruolo limitato ad alcune etichette, o ai workflow di cui il tuo team è proprietario, esegue solo quelli. Chi non può eseguire un workflow vede **Esegui flusso di lavoro** disattivato, con il motivo nel suggerimento.

Dai **Workflow Admin** a chi costruisce l'automazione e **Workflow Member** a chi si limita ad avviarla. Riserva l'accesso in modifica alle variabili alle persone che gestiscono i segreti del progetto.

## Cosa possono fare i passaggi di un workflow

I passaggi che leggono e modificano record di OneUptime (i componenti Find, Create, Update e Delete e i trigger On Create, On Update e On Delete) agiscono come **Project Admin** del progetto del workflow. Superano gli stessi controlli di un Project Admin nella dashboard e nell'API:

- **Solo il progetto del workflow.** Un passaggio non legge né modifica mai i record di un altro progetto, e un Update non sposta mai un record in un altro progetto.
- **Solo ciò che può fare un Project Admin.** Un passaggio non può concedere autorizzazioni che un Project Admin non ha (come **Project Owner** o la fatturazione), né aggiungere qualcuno a un team con più autorizzazioni, come il team dei proprietari.
- **Solo ciò che il vostro piano include.** Su OneUptime Cloud, ciò che il vostro piano non include viene rifiutato indicando il piano necessario.
- **Niente di ciò che OneUptime gestisce da sé.** Le voci del feed non si possono modificare né eliminare, i registri delle notifiche non si possono scrivere, e i valori che OneUptime imposta da sé (come un CNAME verificato, gli interruttori di protezione di un team o chi è di turno adesso) non si possono cambiare. Anche un passaggio **Create One Incident** non può dichiarare un incidente da un modello (`createdIncidentTemplateId`): leggi il modello con **Find One Incident Template** e passane i valori.
- **Come nessuna persona.** Un record creato da un workflow non ha autore, e il registro di audit indica il workflow come autore della modifica.

Un passaggio rifiutato prende la sua uscita **Error** senza apportare la modifica rifiutata, e il registro dell'esecuzione dice quale passaggio è stato rifiutato e perché. Un passaggio Create Many crea i suoi record uno alla volta e si ferma a quello rifiutato; quelli creati prima restano. I passaggi che comunicano con altri sistemi (API, e-mail, chat, Custom Code, IA) non sono interessati.

## Limiti di piano

OneUptime Cloud limita il numero di esecuzioni al mese sui piani più piccoli. Il tuo limite attuale è indicato in **Impostazioni del progetto → Fatturazione**. Quando lo raggiungi, i nuovi trigger vengono rifiutati fino al ciclo di fatturazione successivo. Le installazioni self-hosted non hanno questo limite.

## Quando i workflow non sono lo strumento giusto

Qualche caso in cui conviene ricorrere ad altro:

- **Calcoli pesanti o grandi volumi di dati** — i workflow sono pensati per lavoro di collegamento leggero, non per macinare numeri. Esegui il lavoro pesante nella tua infrastruttura e lascia che sia un workflow ad avviarlo.
- **Elaborazioni attive di lunga durata** — un singolo tentativo di esecuzione dovrebbe concludersi in fretta. Per un'attesa passiva del tipo "fai A, aspetta due ore, fai B", usa il componente **Sleep**: mette da parte l'esecuzione e la riprende più tardi senza occupare un worker.
- **Risposta agli incidenti passo passo con le persone coinvolte** — è esattamente a questo che servono i [Runbook](/docs/runbooks/index). I workflow servono per l'automazione non presidiata.

## Cosa leggere dopo

- [Panoramica dei workflow](/docs/workflows/index) — il quadro d'insieme.
- [Componenti del workflow](/docs/workflows/components) — il riferimento blocco per blocco.
- [Panoramica dei Runbook](/docs/runbooks/index) — quando usare un runbook al posto di un workflow.
