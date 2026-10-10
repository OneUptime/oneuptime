# Configurazione e sicurezza del workflow

Cosa sapere prima di mettere un workflow davanti al traffico reale: come attivarlo in sicurezza, chi può fare cosa, come segreti e URL restano privati, cosa possono modificare i passaggi di un workflow e i limiti entro cui lavora ogni esecuzione.

:::cards
- [Andare in produzione](#accendere-o-spegnere-un-workflow): Prova con Esegui flusso di lavoro, poi lascia il workflow attivo.
- [Autorizzazioni](#autorizzazioni): I ruoli dei workflow e i singoli permessi che li compongono.
- [Cosa possono fare i passaggi](#cosa-possono-fare-i-passaggi-di-un-workflow): I passaggi agiscono come Project Admin del progetto del workflow.
- [Limiti](#limiti-di-piano): Esecuzioni per piano, durata di un'esecuzione e chiamate tra workflow.
:::

## Accendere o spegnere un workflow

Ogni workflow ha un interruttore **Abilitato** in cima al suo **Costruttore** e nella sua pagina **Panoramica**. Quando è spento, il workflow non viene eseguito: chiamate webhook, email in arrivo, orari pianificati ed eventi di OneUptime vengono tutti ignorati, così come **Esegui flusso di lavoro** e **Run just this step**. I nuovi workflow partono disabilitati.

Usa questo interruttore come via libera per la produzione:

:::steps
1. Costruisci il workflow.
2. Fai clic su **Esegui flusso di lavoro** nel **Costruttore** con valori realistici. Un workflow disabilitato non può essere eseguito nemmeno a mano, quindi il Costruttore chiede prima di attivarlo: fai clic su **Attiva ed esegui**.
3. Apri l'esecuzione e verifica che ogni blocco sia andato dove ti aspettavi. Vedi [Esecuzioni](/docs/workflows/runs-and-logs).
4. Lascia **Abilitato** acceso se è pronto. Se non lo è, spegnilo finché non lo sarà: mentre è acceso, il suo trigger scatta sugli eventi reali.
:::

Spegnere un workflow impedisce che partano nuove esecuzioni. Un'esecuzione già in corso termina, ma un'esecuzione in attesa su un blocco **Sleep** viene annullata al risveglio.

## Archiviare un workflow

Archivia un workflow che non ti serve più ma che vuoi conservare. Un workflow archiviato:

- **Non viene mai eseguito**, da nessun trigger. Le esecuzioni manuali e **Run just this step**, le chiamate webhook, le pianificazioni, gli eventi di OneUptime, le email in arrivo e i passaggi **Execute Workflow** di altri workflow vengono tutti rifiutati. Una chiamata webhook a un workflow archiviato riceve un errore che dice che il workflow è archiviato.
- **Ferma le esecuzioni in attesa.** Un'esecuzione in pausa in un passaggio **Sleep** viene annullata al risveglio, e un'esecuzione in coda non ancora avviata termina con "Workflow was archived before this run started, so it did not run."
- **Esce dall'elenco dei workflow.** Lo trovi in **Flussi di lavoro → Avanzato → Archiviato**.
- **Conserva tutto.** I suoi passaggi, variabili, proprietari, etichette e la cronologia delle esecuzioni restano com'erano.

Per archiviare un workflow, aprilo, vai in **Impostazioni** e fai clic su **Archivia**. Per archiviarne diversi, selezionali nell'elenco **Flussi di lavoro** e scegli **Archivia**.

Per recuperare un workflow, apri **Flussi di lavoro → Avanzato → Archiviato**, selezionalo e scegli **Annulla archiviazione**, oppure aprilo e fai clic su **Annulla archiviazione** nel banner in cima alle sue pagine.

L'archiviazione e l'interruttore **Abilitato** sono indipendenti. Archiviare non tocca l'interruttore, quindi un workflow che era acceso torna a essere eseguito appena viene ripristinato, e uno che era spento resta spento. La pagina **Archiviato** mostra qual è quale nella colonna **When Unarchived**.

Un workflow esportato non porta mai con sé lo stato di archiviazione, quindi una copia importata non è mai archiviata.

## Proprietari ed etichette

| Cosa                          | Dove                                                          | Cosa fa                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proprietari**               | La pagina **Proprietari** del workflow                        | Gli utenti e i team responsabili del workflow. Un ruolo limitato a ciò che possiede il proprio team raggiunge i workflow di quel team.               |
| **Etichette**                 | La pagina **Panoramica** del workflow                         | Etichette per raggruppare i workflow, per team, integrazione o ambiente. Filtra l'elenco **Flussi di lavoro** per etichetta, e limita un ruolo ad alcune etichette. |
| **Regole etichette**          | **Flussi di lavoro → Impostazioni → Regole etichette**        | Etichetta automaticamente i nuovi workflow in base a schemi nel nome o nella descrizione.                                                           |
| **Regole del proprietario**   | **Flussi di lavoro → Impostazioni → Regole del proprietario** | Assegna automaticamente i proprietari ai nuovi workflow.                                                                                             |

Vedi [Regole di etichette e proprietari](/docs/configuration/label-and-owner-rules) per come corrispondono le regole.

## Segreti

Contrassegna una variabile come **segreta** se contiene qualcosa di sensibile: il suo valore viene allora eliminato dai registri delle esecuzioni e dalle tracce dei passaggi. Il valore di nessuna variabile può essere riletto una volta salvato, segreta o no, né nella dashboard né tramite l'API, e una variabile diventata segreta resta segreta.

Usa le variabili segrete per:

- Chiavi API di servizi esterni.
- Token di autenticazione.
- Chiavi di firma dei webhook.
- Qualsiasi cosa che non vorresti far vedere a chi ha solo accesso in lettura.

Non incollare un segreto direttamente in un blocco: valori come `Authorization: Bearer eyJh...` finiscono visibili nel workflow e nei registri. Usa invece `{{global.variables.MY_SECRET}}`.

Se il segreto è un token di accesso OAuth che scade, trasforma la variabile in una [variabile OAuth 2.0](/docs/workflows/variables#variabili-oauth-20-token-che-si-rinnovano-da-soli). OneUptime recupera allora il token dal tuo provider di identità e lo rinnova ogni volta che un workflow sta per usarne uno scaduto. Le variabili OAuth 2.0 sono sempre segrete, e le loro credenziali sono cifrate nel database.

## Esportare e importare i workflow

Puoi spostare un workflow tra progetti, o tra un'installazione self-hosted e OneUptime Cloud, come file JSON.

:::tabs
@tab Esportare
Apri il workflow, vai in **Impostazioni** e fai clic su **Esporta: Flusso di lavoro**. Per mettere più workflow in un unico file, selezionali nell'elenco **Flussi di lavoro** e scegli **Esporta: JSON**.
@tab Importare
Nell'elenco **Flussi di lavoro**, fai clic su **Import JSON** e scegli un file esportato da qualsiasi progetto OneUptime. Un workflow il cui nome è già presente nel progetto viene importato con "(Imported)" dopo il nome.
:::

Il file contiene il nome del workflow, la descrizione, lo stato di attivazione e il grafo. Volutamente non contiene:

- **La chiave segreta del webhook.** Quando il workflow viene creato se ne genera una nuova, quindi un workflow importato ha un URL di webhook diverso: copialo dal trigger Webhook del nuovo workflow. Tutto ciò che chiamava l'originale va reindirizzato.
- **L'indirizzo email in arrivo.** Un workflow importato con un trigger Incoming Email riceve un indirizzo tutto suo: copialo dal trigger del nuovo workflow. A tutto ciò che scriveva all'originale va dato il nuovo indirizzo.
- **Le variabili globali.** Un blocco che legge `{{global.variables.MY_SECRET}}` mantiene quel riferimento, ma il valore non è nel file. Crea le variabili nel progetto di destinazione prima di eseguire il workflow importato.
- **I proprietari e le etichette.** Le regole di etichette e proprietari del tuo progetto si applicano al workflow importato, come se lo avessi creato a mano.

Un workflow importato viene sempre creato **disabilitato**, anche se era abilitato dove è stato esportato: il suo grafo può puntare a monitor, policy di reperibilità o altri workflow che non esistono nel progetto di destinazione. Rivedilo, attivalo, provalo con **Esegui flusso di lavoro** e poi lascialo acceso. Duplicare un workflow funziona allo stesso modo, così una copia non inizia mai a scattare accanto all'originale prima che tu l'abbia modificata.

Poiché il grafo viaggia così com'è, tutto ciò che è scritto direttamente in un blocco viaggia con esso. È il motivo pratico per tenere le credenziali in variabili segrete: esportare un workflow con un token scritto a mano consegna quel token a chiunque riceva il file.

## Sicurezza dei webhook

I trigger webhook ti danno un URL univoco. Chiunque conosca l'URL può chiamarlo. Per proteggerti da chiamate accidentali o indesiderate:

- Tratta l'URL come una password. Non condividerlo pubblicamente e non inserirlo in un repository pubblico. Il trigger Webhook nasconde la chiave segreta dell'URL finché non fai clic su **Mostra**, e **Copia URL** copia l'URL senza mostrarlo.
- Se l'URL trapela, fai clic sul trigger Webhook nel **Costruttore** e poi su **Reimposta URL**. Il workflow riceve un nuovo URL e quello vecchio smette subito di funzionare.
- Se il trigger dice che il suo URL termina con l'ID del workflow, reimpostalo. I workflow creati prima che gli URL di webhook avessero una propria chiave segreta usano invece l'ID del workflow, che chiunque possa aprire il workflow può vedere.
- Per i workflow sensibili, chiedi al sistema chiamante di inviare un token condiviso in un header (come `X-Webhook-Token`) e verificalo con un blocco **If / Else** prima di fare qualcosa di importante. Salva il token atteso come variabile segreta.
- Per i workflow molto sensibili, preferisci un trigger di evento OneUptime e un passaggio di importazione manuale a un webhook pubblico.

Solo le persone che possono modificare il workflow — **Project Owner**, **Project Admin**, **Workflow Admin** o **Edit Workflow** — possono vedere o reimpostare il suo URL di webhook. Chiunque abbia l'URL può avviare il workflow da qualsiasi luogo, senza accedere, quindi tutti gli altri vedono una nota che dice a chi chiederlo. Questo include un **Workflow Member**, che esegue il workflow a mano dal **Costruttore**.

## Sicurezza delle email in arrivo

Il trigger Incoming Email dà al workflow un indirizzo tutto suo, e chiunque conosca l'indirizzo può scrivergli. La parte prima della `@` è la chiave segreta del workflow, quindi tratta l'indirizzo come una password:

- Non pubblicarlo e non inserirlo in un repository pubblico. Il trigger nasconde la chiave finché non fai clic su **Mostra**, e **Copia indirizzo** copia l'indirizzo senza mostrarlo.
- Se l'indirizzo trapela, fai clic sul trigger Incoming Email nel **Costruttore** e poi su **Reimposta indirizzo**. Il workflow riceve un nuovo indirizzo, e da quel momento le email al vecchio vengono ignorate.
- Chiunque può mettere qualsiasi mittente su un'email, quindi **From** non prova chi l'ha inviata. Prima che un workflow faccia qualcosa di importante, verifica qualcosa che conosce solo il vero mittente — un token nell'oggetto o in un header — con un blocco **If / Else**. Salva il token atteso come variabile segreta.
- La chiave viene nascosta in tutto ciò che l'esecuzione riceve — **To**, **CC**, gli header e i corpi — perché il registro dell'esecuzione è visibile a chiunque possa leggere le esecuzioni del workflow.

Solo le persone che possono modificare il workflow — **Project Owner**, **Project Admin**, **Workflow Admin** o **Edit Workflow** — possono vedere o reimpostare il suo indirizzo. Tutti gli altri vedono una nota che dice a chi chiederlo.

## Accesso alla rete in uscita

I blocchi API e gli altri blocchi HTTP fanno le loro richieste da OneUptime, e il blocco IRC si collega da OneUptime alla porta del server IRC. Se usi il self-hosting, assicurati che la tua installazione possa raggiungere i servizi che chiami. Se usi OneUptime Cloud, i nostri intervalli di IP in uscita sono elencati in [Indirizzi IP](/docs/configuration/ip-addresses), così puoi consentirli dall'altra parte.

Gli indirizzi che un blocco può raggiungere dipendono dal blocco:

| Blocchi                                                    | Loopback, link-local, metadati cloud                                          | Indirizzi di rete privata                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| I blocchi **API** e le richieste di **Run Custom JavaScript** | Rifiutati, a meno che l'host esatto non sia indicato in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Rifiutati, a meno che un amministratore self-hosted non li consenta con `ALLOW_PRIVATE_NETWORK_WEBHOOKS` o `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send Email**, **IRC** e gli URL dei token OAuth 2.0      | Rifiutati                                                                     | Rifiutati su OneUptime Cloud. Consentiti su un'installazione self-hosted, a meno che `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` non sia `true` |
| Slack, Microsoft Teams, Discord e Telegram                 | Rifiutati                                                                     | Rifiutati: ognuno invia solo agli indirizzi del proprio servizio                                                                          |

Vedi [Accesso alla rete privata](/docs/self-hosted/private-network-access) per come un amministratore self-hosted li apre.

## Componenti AI

**Generate Text with AI** invia una richiesta a un LLM: il provider LLM predefinito del progetto, o il provider globale dell'installazione quando il progetto non ne ha uno. Configura i provider in **Impostazioni del progetto → IA → Provider LLM**, e non mettere mai la chiave API di un provider o un tuo endpoint in un workflow.

Cosa riceve il provider, e cosa può farne il modello:

- **Solo ciò che metti nel blocco.** OneUptime invia un'istruzione di sicurezza fissa, poi le **System Instructions**, il **Prompt** e il **Context** del blocco, con i riferimenti compilati. **Context** viene per ultimo, dopo un marcatore, e l'istruzione di sicurezza dice al modello che tutto ciò che segue il marcatore sono dati non attendibili, anche un testo che sembra un'istruzione.
- **Nient'altro.** I dati del trigger, la cronologia del workflow, gli output degli altri blocchi, i record del progetto, la telemetria e i segreti non vengono mai allegati. Lasciano OneUptime solo quando vi fai riferimento in una di quelle tre impostazioni.
- **Testo, e nessuno strumento.** Il modello non può interrogare OneUptime, fare richieste HTTP o modificare dati. I parametri aggiuntivi di un provider lasciano passare solo un elenco consentito di campi di regolazione della generazione: non possono sostituire i messaggi, aggiungere strumenti, ricerca web o altre fonti di dati, chiedere altro che testo o più risposte, attivare lo streaming, far conservare la richiesta al provider o alzare il limite di output del blocco. I campi che OneUptime non conosce vengono scartati.
- **Il modello lo sceglie il tuo amministratore.** Se la generazione deve restare offline, scegli un modello che non recuperi nulla da solo dal lato del provider.

Cosa viene registrato:

- Il registro dell'esecuzione nasconde le **System Instructions**, il **Prompt**, il **Context** e la **Response** del blocco. I blocchi successivi possono comunque usarli durante l'esecuzione, e un blocco in cui ne inserisci uno lo registra secondo le proprie regole, quindi inserirlo è una scelta di mostrarlo.
- Il provider, il modello, il numero di token, il **LLM Log ID** e un messaggio di errore sicuro restano visibili, per l'operatività e la fatturazione. L'errore grezzo di un provider resta fuori da ogni registro, perché un provider può ripetervi la richiesta.
- Ogni chiamata compare in **Impostazioni del progetto → IA → Registri IA** con provider, modello, stato, token, costo e fatturazione, senza il prompt, la risposta o l'errore grezzo.

Di cosa ha bisogno il blocco, e quanto costa:

- **Abilita IA** deve essere acceso, in **Impostazioni del progetto → IA → AI Features**. Su OneUptime Cloud il progetto ha bisogno anche del piano Growth o superiore e di un abbonamento pagato. Le installazioni self-hosted senza fatturazione non hanno vincoli di piano.
- Le chiamate tramite un provider globale a pagamento usano i crediti IA del progetto.
- Ogni chiamata conta nei [limiti giornalieri di IA del progetto](/docs/ai/ai-sre#the-projects-own-daily-limits), quando un proprietario del progetto li imposta. Una volta raggiunto un limite, il blocco prende **Error** senza contattare il modello, fino alla mezzanotte UTC.

| Limite                                                       | Valore                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **System Instructions**, **Prompt** e **Context** insieme    | 50.000 caratteri                                                          |
| **Temperature**                                              | Da `0` a `1`                                                              |
| **Maximum Output Tokens**                                    | Da `1` a `4096`, `1024` per impostazione predefinita                      |
| Una richiesta                                                | Un solo tentativo, al massimo 60 secondi                                  |
| Chiamate contemporanee                                       | 3 per progetto. Le altre prendono **Error**, e un'esecuzione successiva può riprovare. |

Gli errori di convalida, configurazione, accesso, limite, crediti, concorrenza, provider e timeout prendono tutti il percorso **Error**, con il motivo in **Error**. Collega quel percorso prima che il workflow vada in produzione.

> [!WARNING]
> Ogni valore a cui fai riferimento è un dato che invii al provider. Non mettere una variabile segreta nel prompt o nel contesto, a meno che il provider non sia approvato per riceverla. Un provider locale self-hosted come Ollama tiene le richieste all'interno della tua infrastruttura; un provider ospitato le riceve secondo le proprie condizioni di trattamento dei dati.

## Autorizzazioni

I workflow rispettano il controllo degli accessi basato sui ruoli del tuo progetto. I tre ruoli dei workflow:

- **Workflow Admin** — costruisce i workflow: li crea, li modifica, li esegue e li elimina, e gestisce le variabili che usano.
- **Workflow Member** — li usa: apre i workflow e le loro esecuzioni, ed esegue un workflow a mano con **Esegui flusso di lavoro**. Un membro non può creare, modificare o eliminare un workflow, né eseguire da solo uno dei suoi passaggi.
- **Workflow Viewer** — legge i workflow e le loro esecuzioni.

**Project Owner** e **Project Admin** possono fare tutto ciò che può fare un Workflow Admin. **Project Member** può creare ed eliminare workflow, ma non modificarli né eseguirli.

I singoli permessi, per un team o una chiave API che ha bisogno di una sola cosa:

- **Create / Read / Edit / Delete Workflow** — i permessi di base sul workflow stesso. Modificare un workflow, compreso accenderlo, spegnerlo o archiviarlo, richiede **Edit Workflow**; **Delete Workflow** serve solo a eliminare.
- **Edit Workflow** — è anche ciò che serve per eseguire un singolo passaggio con **Run just this step**, e per vedere o reimpostare l'URL del webhook e l'indirizzo email in arrivo di un workflow. Eseguire un intero workflow a mano richiede **Edit Workflow**, **Workflow Admin** o **Workflow Member**.
- **Read Workflow Log** — necessario per vedere le esecuzioni.
- **Create / Read / Edit / Delete Workflow Variables** — gestire le variabili globali e del workflow.

Un'esecuzione a mano raggiunge solo i workflow che puoi aprire: un ruolo limitato ad alcune etichette, o ai workflow posseduti dal tuo team, esegue solo quelli. Chi non può eseguire un workflow vede **Esegui flusso di lavoro** disattivato, con il motivo nel tooltip.

Assegna **Workflow Admin** alle persone che costruiscono l'automazione, e **Workflow Member** a quelle che si limitano ad avviarla. Riserva l'accesso in modifica alle variabili alle persone che gestiscono i segreti del progetto. Vedi [Utenti, team e autorizzazioni](/docs/permissions/index) per come vengono assegnati i ruoli.

## Cosa possono fare i passaggi di un workflow

I passaggi che leggono e modificano i record di OneUptime — i componenti Find, Create, Update e Delete, e i trigger On Create, On Update e On Delete — agiscono come **Project Admin** del progetto del workflow. Chiunque abbia costruito il workflow, un passaggio supera gli stessi controlli che supera un Project Admin nella dashboard e nell'API:

- **Solo il progetto del workflow.** Un passaggio legge e scrive i record del progetto a cui appartiene il workflow e di nessun altro, e un Update non sposta mai un record in un altro progetto.
- **Solo ciò che può fare un Project Admin.** Un passaggio può concedere solo i permessi di team e di chiave API che un Project Admin possiede, quindi non può assegnare **Project Owner**, permessi di fatturazione o di eliminazione del progetto, e non può aggiungere qualcuno a un team i cui permessi vanno oltre quelli di un Project Admin, come il team dei proprietari. Un passaggio non può leggere chi ha creato una sonda o un agente IA, cosa che vedono solo i proprietari del progetto.
- **Non la lettura delle credenziali dei runbook.** Un Project Admin può leggere le credenziali dei runbook, ma questo non viene prestato a un passaggio. Quando una modifica richiede quella lettura — lasciare che OneUptime AI esegua i suoi comandi senza chiedere, attivare **Esegue i comandi di rimedio AI** per un Runner, assegnare una credenziale SSH a un Runner che esegue i comandi di OneUptime AI o indicare una credenziale di runbook, ad esempio nei passaggi di un runbook —, si verifica invece la persona che ha salvato per ultima i passaggi del workflow, e il passaggio viene rifiutato a meno che quella persona non possa leggere le credenziali dei runbook (**Read Runbook Credential**, oppure un Project Owner o un Project Admin). OneUptime registra quella persona quando qualcuno crea il workflow e ogni volta che qualcuno ne salva i passaggi; rinominare il workflow, cambiarne le etichette o accenderlo e spegnerlo mantiene chi ne ha salvato i passaggi per ultimo. Un salvataggio dei passaggi con una chiave API non registra nessuno, quindi i passaggi del workflow non possono fare queste modifiche finché una persona non li salva.
- **Solo ciò che il tuo piano include.** Su OneUptime Cloud, un passaggio che crea o modifica qualcosa che il tuo piano non include viene rifiutato indicando il piano necessario, proprio come nella dashboard. Le installazioni self-hosted senza fatturazione non hanno limiti di piano.
- **Niente di ciò che OneUptime tiene per sé.** Questo viene rifiutato a tutti, workflow compresi:
  - modificare o eliminare una voce del feed (i feed di incidenti, avvisi, episodi, monitor, policy di reperibilità e manutenzioni pianificate);
  - scrivere un registro delle notifiche (i registri di SMS, chiamate, email, WhatsApp, Telegram, notifiche push, webhook e messaggi dell'area di lavoro);
  - i valori che OneUptime imposta man mano che le cose accadono: se il CNAME di un dominio personalizzato è verificato, gli interruttori di protezione di un team (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), quale ruolo di incidente è quello principale e se può essere eliminato, se un proprietario o un membro è stato avvisato, gli orari e il numero dei promemoria, chi è reperibile ora e dopo in un calendario, l'avanzamento di un'esecuzione di reperibilità, il tasso di consumo e l'error budget attuali di uno SLO, un monitor messo in pausa da un incidente o da una manutenzione, il token di reimpostazione della password e l'ultimo accesso di un utente privato di una pagina di stato, i dati che un servizio riporta su sé stesso (versione, runtime, cloud) e l'ultima esecuzione di una regola di rilevamento o di un feed di minacce;
  - dichiarare un incidente da un modello inviando `createdIncidentTemplateId` a **Create One Incident** — scegli invece il modello nell'impostazione **Incident Template** del passaggio: il passaggio dichiara allora l'incidente da esso, come Project Admin, e registra il modello;
  - cambiare il record a cui appartiene un record dopo la sua creazione, come il monitor a cui si riferisce una riga di proprietario o l'incidente su cui si trova una nota.
- **Come nessuno.** Un record creato da un workflow non indica alcun creatore, e il registro di audit nomina il workflow, con il nome che aveva in quel momento, come autore della modifica.

Quando un controllo rifiuta un passaggio, il passaggio prende la sua uscita **Error** senza fare la modifica rifiutata, e il registro dell'esecuzione nomina il passaggio e il motivo con parole semplici, ad esempio *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Leggilo nelle [Esecuzioni](/docs/workflows/runs-and-logs) del workflow. Un passaggio Create Many crea i suoi record uno alla volta e si ferma al primo rifiutato: i record creati prima di quello vengono conservati.

I passaggi che parlano con altri sistemi — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Custom Code e Generate Text with AI — non leggono né modificano record di OneUptime, quindi niente di tutto questo li riguarda.

## Limiti di piano

Su OneUptime Cloud i workflow richiedono il piano Growth o superiore, e ogni piano consente un certo numero di esecuzioni in qualsiasi periodo di 30 giorni:

| Piano      | Esecuzioni negli ultimi 30 giorni |
| ---------- | --------------------------------- |
| Growth     | 500                               |
| Scale      | 2.000                             |
| Enterprise | Nessun limite pratico             |

La finestra scorre: ogni esecuzione registrata dal progetto, a mano o da un trigger, conta per 30 giorni. Sui piani Growth e Scale, la pagina **Flussi di lavoro** mostra una scheda **Esecuzioni del flusso di lavoro** con quante ne ha usate il progetto. Una volta raggiunto il limite, le nuove esecuzioni vengono registrate con lo stato **Execution Exceeded Current Plan** e non vengono eseguite, e lo stesso accade finché l'abbonamento non è pagato. Le installazioni self-hosted senza fatturazione non hanno limiti.

## Quanto può durare un'esecuzione

| Limite                                                       | Predefinito        | Impostazione self-hosted        |
| ------------------------------------------------------------ | ------------------ | ------------------------------- |
| Un'esecuzione, dal suo avvio o dal risveglio dopo uno **Sleep** | 2 minuti        | `WORKFLOW_TIMEOUT_IN_MS`        |
| Un blocco **Run Custom JavaScript**                          | 5 secondi          | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Un blocco **Sleep**                                          | Al massimo 30 giorni | —                             |

L'esecutore controlla la scadenza prima e dopo ogni blocco, e segna un'esecuzione in ritardo come **Timeout** non appena riprende il controllo. Non può interrompere un blocco a metà, quindi i blocchi che attendono la rete hanno limiti di tempo propri: una richiesta di Generate Text with AI si arrende dopo al massimo 60 secondi, e una richiesta di token OAuth 2.0 dopo 20. Un'attesa su un blocco **Sleep** non conta nel tempo di un'esecuzione: l'esecuzione viene messa da parte e riceve 2 nuovi minuti al risveglio.

## Limite alle chiamate tra workflow

Il componente **Execute Workflow** permette a un workflow di avviarne un altro. Per evitare cicli in cui il workflow A avvia B, che avvia di nuovo A, una catena di workflow che si avviano a vicenda viene rifiutata quando tornerebbe a un workflow che ne fa già parte, o supererebbe i 10 workflow di profondità. Il blocco **Execute Workflow** prende allora la sua uscita **Error**, e l'errore mostra la catena.

Se ti serve davvero una catena lunga (come un job che elabora un elemento per esecuzione), di solito è più semplice ciclare all'interno di un solo workflow con **Run Custom JavaScript**.

## Quando i workflow non sono lo strumento giusto

Alcuni casi in cui conviene usare altro:

- **Calcoli pesanti o grandi volumi di dati** — i workflow sono pensati per un lavoro di collegamento leggero, non per macinare numeri. Esegui il lavoro pesante nella tua infrastruttura e lascia che un workflow lo avvii.
- **Calcoli attivi di lunga durata** — un'esecuzione ha 2 minuti per impostazione predefinita. Per un'attesa passiva come «fai A, aspetta due ore, fai B», usa il componente **Sleep**; mette da parte l'esecuzione e la riprende più tardi senza occupare un worker.
- **Risposta agli incidenti passo per passo con persone coinvolte** — a questo servono i [Runbook](/docs/runbooks/index). I workflow servono all'automazione senza supervisione.

## Prossimi passi

:::cards
- [Panoramica dei workflow](/docs/workflows/index): Il quadro d'insieme e un primo workflow dall'inizio alla fine.
- [Componenti](/docs/workflows/components): Di cosa ha bisogno ogni blocco, cosa restituisce e cosa può raggiungere.
- [Runbook](/docs/runbooks/index): Quando le persone devono prendere le decisioni lungo il percorso.
:::
