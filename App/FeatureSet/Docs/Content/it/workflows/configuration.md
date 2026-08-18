# Configurazione e sicurezza

Questa pagina copre le impostazioni e i limiti di sicurezza che vale la pena conoscere prima di puntare un workflow su traffico reale.

## Attivare o disattivare un workflow

Ogni workflow ha un interruttore **Abilitato** in **Impostazioni**. Quando è spento, il workflow non viene eseguito — le chiamate webhook, gli orari pianificati e gli eventi OneUptime vengono tutti ignorati. I nuovi workflow partono disabilitati.

Usa questo interruttore come il tuo cancello "pronto per partire":

1. Costruisci il workflow.
2. Clicca **Esegui flusso di lavoro** sul **Costruttore** con valori realistici.
3. Controlla i **Registri** — assicurati che ogni blocco sia andato dove ti aspettavi.
4. Attiva **Abilitato**.

Disattivare un workflow non ferma le esecuzioni già in corso; impedisce solo l'avvio di nuove.

## Proprietari ed etichette

- **Proprietari** — gli utenti e i team elencati come proprietari ottengono accesso al workflow e possono scegliere di ricevere notifiche quando fallisce. Impostali sotto **Settings → Owners**.
- **Etichette** — tag per raggruppare i workflow. L'elenco dei workflow ti permette di filtrare per etichetta, il che rende molto più facile orientarsi in un progetto affollato. Utile quando hai workflow organizzati per team, integrazione o ambiente.
- **Label rules** — sotto **Workflows → Settings → Label Rules**, applica automaticamente etichette ai nuovi workflow in base a pattern del nome o della descrizione.
- **Owner rules** — sotto **Workflows → Settings → Owner Rules**, assegna automaticamente proprietari ai nuovi workflow.

## Segreti

Contrassegna una variabile globale come **secret** se contiene qualcosa di sensibile. Il valore viene nascosto dalle normali letture API e UI dopo il salvataggio, e la registrazione del workflow oscura il valore risolto prima che il registro di esecuzione venga salvato in modo permanente.

Usa variabili segrete per:

- Chiavi API per servizi esterni.
- Token di autenticazione.
- Chiavi di firma dei webhook.
- Qualsiasi cosa che non vorresti far vedere a qualcuno con accesso in sola lettura.

Non incollare un segreto direttamente in un blocco — valori come `Authorization: Bearer eyJh...` finiscono visibili nel workflow e nei registri. Usa invece `{{global.variables.MY_SECRET}}`.

## Esportare e importare workflow

Puoi spostare un workflow tra progetti, o tra un'installazione self-hosted e OneUptime Cloud, come file JSON.

- **Export** — apri il workflow e usa **Export Workflow** sotto **Settings**. Dall'elenco dei workflow puoi anche selezionarne diversi ed esportarli in un unico file.
- **Import** — nell'elenco **Workflows**, clicca **Import JSON** e scegli un file esportato da qualsiasi progetto OneUptime.

Il file contiene il nome del workflow, la descrizione, lo stato abilitato/disabilitato e il suo grafo. Deliberatamente non contiene:

- **La chiave segreta del webhook.** Ne viene generata una nuova quando il workflow viene creato, quindi un workflow importato ha un URL webhook diverso. Qualsiasi cosa chiami quello originale deve essere ripuntata.
- **Le variabili globali.** Un blocco che legge `{{global.variables.MY_SECRET}}` mantiene quel riferimento, ma il valore non è nel file. Crea le variabili nel progetto di destinazione prima di eseguire il workflow importato.
- **Proprietari ed etichette.** Le regole di etichette e proprietari del tuo progetto vengono applicate al workflow importato, esattamente come se lo avessi creato a mano.

Un workflow importato viene sempre creato **disabilitato**, anche se era abilitato da dove è stato esportato — il suo grafo può puntare a monitor, politiche di reperibilità o altri workflow che non esistono nel progetto di destinazione. Rivedilo, abilitalo, testalo con **Run Workflow**, e poi lascialo attivo. Duplicare un workflow si comporta allo stesso modo, così una copia non inizia mai a scattare insieme all'originale prima che tu l'abbia modificata.

Poiché il grafo viaggia parola per parola, qualsiasi cosa digitata direttamente in un blocco viaggia con esso. Questo è il motivo pratico per tenere le credenziali in variabili segrete: esportare un workflow con un token scritto a mano consegna quel token a chiunque riceva il file.

## Quanto può durare un'esecuzione

Ogni tentativo di esecuzione ha una scadenza a orologio. Il runner la controlla prima e dopo ogni componente e contrassegna un'esecuzione scaduta come **Timeout** non appena il controllo ritorna. Anche i componenti che eseguono lavoro di rete o di script hanno bisogno dei propri timeout, perché il runner non può interrompere forzatamente codice di componente arbitrario.

Il componente AI deriva il timeout della richiesta al provider dal tempo rimanente del workflow e lo limita a 60 secondi, lasciando un piccolo margine per la registrazione e la pulizia.

## Limite sulla chiamata di altri workflow

Il componente **Execute Workflow** permette a un workflow di chiamarne un altro. Per prevenire cicli accidentali in cui il workflow A chiama B che richiama A, c'è un limite a quanto può essere profonda la catena. Un'esecuzione che supera il limite termina con un errore chiaro.

Se hai una reale necessità di una catena lunga (come un job che elabora un elemento per esecuzione), è di solito più semplice creare un ciclo dentro un singolo workflow usando **Custom Code**.

## Sicurezza del webhook

I trigger Webhook ti danno un URL univoco. Chiunque conosca l'URL può colpirlo. Per proteggerti da chiamanti accidentali o indesiderati:

- Tratta l'URL come una password. Non condividerlo pubblicamente e non caricarlo in un repository pubblico.
- Per workflow sensibili, chiedi al sistema chiamante di inviare un token condiviso come intestazione (come `X-Webhook-Token`) e verificalo con un blocco **Conditions** prima di fare qualsiasi cosa importante. Salva il token atteso come variabile segreta.
- Per workflow molto sensibili, preferisci un trigger di evento OneUptime e un passaggio di importazione manuale invece di un webhook pubblico.

## Accesso di rete in uscita

I blocchi API e altri blocchi HTTP effettuano le loro richieste da OneUptime. Se fai self-hosting, assicurati che la tua installazione possa raggiungere i servizi che stai chiamando. Se usi OneUptime Cloud, i nostri intervalli di IP in uscita sono elencati in [Indirizzi IP](/docs/configuration/ip-addresses) così puoi consentirli dall'altro lato.

## Componenti AI

**Generate Text with AI** invia una richiesta tramite il gateway LLM configurato di OneUptime. Usa il provider LLM predefinito del progetto, oppure il provider globale dell'installazione quando il progetto non ne ha uno. Configura i provider sotto **Project Settings → AI → LLM Providers**; non inserire mai una chiave API di un provider o un endpoint di modello arbitrario nel workflow stesso.

Il componente AI ha un confine di uscita dati esplicito:

- OneUptime invia un'istruzione fissa di sicurezza del componente più le **System Instructions**, il **Prompt** e il **Context** serializzato risolti al provider configurato. Il Context viene aggiunto dopo un marcatore esplicito alla fine del messaggio utente; l'istruzione fissa dice che tutto ciò che segue quel marcatore rimane dati non fidati anche quando contiene tag o istruzioni.
- Non allega automaticamente il payload del trigger, la cronologia del workflow, l'output di altri componenti, i record di progetto, la telemetria o i segreti. I dati escono solo quando li fai riferimento in uno di quei tre input.
- Non invia definizioni di strumenti né campi di capacità nativa del provider. Il modello non può interrogare OneUptime, effettuare richieste HTTP o modificare dati di progetto tramite questo componente. Il provider/modello configurato rimane un confine di fiducia amministrativo, quindi le installazioni che richiedono una generazione strettamente offline dovrebbero selezionare un modello senza recupero dati nativo gestito dal provider.
- I parametri aggiuntivi a livello di provider sono limitati a una lista consentita di campi di ottimizzazione solo per la generazione. Non possono sostituire i messaggi del workflow, aggiungere strumenti o ricerca web/fonti dati native del provider, abilitare modalità non testuali, richiedere scelte multiple, abilitare lo streaming, mantenere la richiesta tramite flag di archiviazione del provider, o aumentare il limite massimo di token in uscita di questo componente. I campi di capacità futuri sconosciuti vengono scartati per impostazione predefinita.
- I valori di System Instructions, Prompt, Context e Response generata vengono oscurati dalle voci di argomento e valore di ritorno di questo componente AI nel registro di esecuzione automatico del workflow. Rimangono disponibili per i componenti a valle mentre l'esecuzione è in corso. Se li inserisci in un altro componente, si applica la policy di registrazione di quel componente e può registrare il valore risolto; tratta il riutilizzo come una divulgazione esplicita. I nomi di provider/modello, i conteggi dei token, l'LLM Log ID e i messaggi di errore sicuri rimangono visibili per operazioni e fatturazione. I corpi di errore grezzi del provider sono esclusi dai registri del workflow, dai registri LLM, dai registri dell'applicazione e dalle tracce perché un provider può riecheggiare il contenuto della richiesta.

Tratta ogni variabile referenziata come dati che stai intenzionalmente inviando al provider. In particolare, non inserire una variabile globale segreta nel prompt o nel contesto a meno che quella divulgazione non sia richiesta e il provider non sia approvato per riceverla. Un provider locale self-hosted come Ollama può mantenere la richiesta all'interno della tua stessa infrastruttura; un provider ospitato riceve la richiesta secondo i termini di trattamento dei dati di quel provider.

Ogni chiamata viene registrata in **Project Settings → AI → AI Logs**, incluso provider, modello, stato, token, costo e informazioni di fatturazione. Le anteprime di prompt e risposta e i dettagli di errore grezzi del provider non vengono memorizzati nel registro AI. Le chiamate tramite un provider globale a pagamento consumano il saldo di credito AI del progetto. L'AI del workflow conta anche verso il budget giornaliero di token AI autonomi del progetto; quando il budget è esaurito, il componente segue il suo percorso **Error** senza contattare il modello. L'AI di progetto deve essere abilitata. Su OneUptime Cloud, l'abbonamento deve essere a pagamento ed è richiesto il piano Growth (o un piano che include le funzionalità Growth); le installazioni self-hosted con la fatturazione disabilitata non hanno questo blocco di piano.

Limiti integrati mantengono finite le chiamate non presidiate: System Instructions, Prompt e Context serializzato sono limitati a 50.000 caratteri combinati; Temperature deve andare da `0` a `1`; Maximum Output Tokens deve andare da `1` a `4096` (predefinito `1024`); e la richiesta al provider viene tentata una sola volta e scade dopo al massimo 60 secondi. Non più di tre chiamate AI del workflow vengono eseguite contemporaneamente per progetto; le chiamate aggiuntive seguono il percorso **Error** e possono essere ritentate da un'esecuzione successiva del workflow. Gli errori di validazione, configurazione, accesso, budget, saldo, concorrenza, provider e timeout seguono tutti il percorso **Error** e popolano l'output **Error**. Collega quel percorso prima di abilitare un workflow in produzione.

## Permessi

I workflow rispettano il controllo degli accessi basato sui ruoli del tuo progetto. I permessi rilevanti:

- **Create / Read / Edit / Delete Workflow** — i permessi di base sul workflow stesso.
- **Run Workflow** — necessario per eseguire un workflow manualmente o attivarlo tramite API.
- **Read Workflow Log** — necessario per visualizzare le esecuzioni.
- **Read / Create / Edit / Delete Workflow Variable** — controllo sull'elenco delle variabili globali.

La maggior parte degli ingegneri dovrebbe avere creazione/modifica/lettura sui workflow ma non sulle variabili. Riserva l'accesso in modifica alle variabili alle persone che gestiscono i segreti del tuo progetto.

## Limiti del piano

OneUptime Cloud limita il numero di esecuzioni al mese sui piani più piccoli. Il tuo limite attuale è mostrato sotto **Project Settings → Billing**. Quando lo raggiungi, i nuovi trigger vengono rifiutati fino al successivo ciclo di fatturazione. Le installazioni self-hosted non hanno questo limite.

## Quando i workflow non sono lo strumento giusto

Alcuni casi in cui dovresti rivolgerti a qualcos'altro:

- **Calcoli pesanti o grandi dataset** — i workflow sono pensati per lavoro leggero di collegamento, non per elaborazioni numeriche intensive. Esegui il lavoro pesante nella tua infrastruttura e lascia che un workflow lo avvii.
- **Calcoli attivi di lunga durata** — un singolo tentativo di esecuzione è pensato per finire rapidamente. Per un ritardo passivo come "fai A, aspetta due ore, fai B," usa il componente **Sleep**; persiste l'esecuzione e la riprende più tardi senza occupare un worker.
- **Risposta agli incidenti passo-passo con persone coinvolte** — è a questo che servono i [Runbook](/docs/runbooks/index). I workflow sono per l'automazione non presidiata.

## Dove leggere in seguito

- [Panoramica dei workflow](/docs/workflows/index) — il quadro generale.
- [Componenti del workflow](/docs/workflows/components) — riferimento blocco per blocco.
- [Panoramica dei Runbook](/docs/runbooks/index) — quando usare un runbook al posto di un workflow.
