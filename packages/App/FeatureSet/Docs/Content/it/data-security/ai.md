# OneUptime AI in Sicurezza dei dati

OneUptime AI lavora su ciò che Sicurezza dei dati ha trovato senza vedere i tuoi dati. Riceve nomi, forme, conteggi e configurazione, mai un valore dei tuoi dati, un campione mascherato, un record o una stringa di connessione. Ogni funzionalità viene eseguita sul modello del tuo progetto, anche uno self-hosted, e ogni pagina, controllo, scansione e integrazione di Sicurezza dei dati funziona con l'IA disattivata.

:::cards
- [Da sola](#da-sola): Cosa fa con ogni nuovo problema, cosa ti aspetta e le regole IA.
- [Cosa vede OneUptime AI](#cosa-vede-oneuptime-ai): Cosa invia ogni funzionalità, e cosa non invia mai.
- [Verificalo di persona](#verificalo-di-persona): L'input esatto che invierebbe uno dei tuoi problemi.
- [Il tuo modello](#il-tuo-modello): Ogni funzionalità sul provider del tuo progetto, Ollama, vLLM o qualsiasi endpoint compatibile con OpenAI.
- [Come viene misurata](#come-viene-misurata): Ogni funzionalità su casi fissi, prima di ogni release.
:::

## Da sola

Con **Lavora sui nuovi problemi** attivo in **Sicurezza dei dati → IA**, come per i nuovi progetti, OneUptime AI lavora da sola su ogni nuovo problema critico o alto. Scrive l'analisi di ciascuno di questi problemi, e di ciascuno che si riapre, come fa **Analizza il problema** e in base a ciò che invia, prima che qualcuno lo apra, e la riscrive solo quando cambia ciò su cui si basa. Per un problema di telemetria nasconde da sola un segreto nella nuova telemetria, dove la regola è dimostrata sui record in cui è stato visto il segreto e nulla legge ciò che nasconde, e propone le regole di pulizia per il resto (vedi [Contenuto in autonomia](/docs/data-security/telemetry#contenuto-in-autonomia)). Una proposta aspetta in quella pagina sotto **In attesa di te**, prima le più rischiose, con cosa cambierà, perché, come verrà dimostrato e come annullarlo. **Approva** fa la modifica con le tue autorizzazioni: una regola di pulizia richiede l'autorizzazione a creare regole di pulizia dei log, regole di pulizia delle tracce o regole della pipeline delle metriche. **Ignora la proposta** dice di no, con un motivo che viene aggiunto alla cronologia del problema. È il controllo del problema a decidere se una modifica ha funzionato: l'archivio viene controllato di nuovo, e il problema si risolve quando non resta nessuno dei suoi dati.

OneUptime AI propone anche i proprietari per gli archivi che non ne hanno, a partire da ciò che li indica già: i tag cloud dell'archivio, i servizi che lo usano e i loro proprietari, i proprietari del codice del file che lo dichiara, chi lo ha modificato secondo il log delle modifiche del cloud e chi lo ha aggiunto a OneUptime. Nomina solo team e persone del tuo progetto, dice quanto è sicura e dice dove le prove non concordano. La proposta per un archivio sensibile arriva con il suo problema **Questo archivio sensibile non ha un proprietario**, e gli altri nuovi archivi ricevono la loro una volta al giorno e quando una connessione cloud viene letta per la prima volta. Quando i proprietari di tre o più archivi si basano sullo stesso tag o sullo stesso inizio del nome, propone anche la regola del proprietario che mantiene un proprietario al prossimo archivio simile, e dice a quanti archivi corrisponderebbe la regola. Queste proposte aspettano in **Proprietari da rivedere**, in questa pagina e in **Archivi dati**: **Approva** aggiunge i proprietari con le tue autorizzazioni, e vengono avvisati come qualsiasi proprietario; **Modifica e approva** sceglie prima altri proprietari; **Annulla** toglie esattamente i proprietari aggiunti, e la regola con loro. Aggiungere un proprietario cambia chi viene avvisato, quindi aspetta sempre te, qualunque cosa dica una regola IA.

Per impostazione predefinita, OneUptime AI chiede prima di ogni modifica, tranne una che nasconde solo dati, si può annullare ed è dimostrata sicura, e non elimina mai dati né avvisa nessuno senza chiedere. Una modifica fatta senza chiedere compare sotto **Fatto dall'IA**, con **Annulla**. **Perché l'IA non ha agito** elenca i problemi che ha esaminato e lasciato com'erano, e perché. Ogni proposta, approvazione, rifiuto e annullamento è nella **Cronologia** del problema e dell'archivio. Con l'interruttore disattivato, Sicurezza dei dati funziona come sempre, e **Analizza il problema** e **Correggi con l'IA** funzionano ancora quando li premi; con l'IA disattivata per il progetto, nessuno dei due.

Nella pagina di un problema, la scheda **OneUptime AI** sopra **Come correggere** mostra l'analisi e ciò che è stato proposto per quel problema, con gli stessi pulsanti. La **Panoramica** della sicurezza dei dati dice quante fughe OneUptime AI ha contenuto questa settimana e quante proposte ti aspettano. **Note per OneUptime AI** conta settimana per settimana com'è andata con le sue modifiche: vedi [Come se la cava OneUptime AI](/docs/ai/ai-sre#come-se-la-cava-oneuptime-ai).

### Regole IA

In **Regole IA** di **Sicurezza dei dati → IA**, una regola dice su quali problemi lavora OneUptime AI - per controllo o gruppo di controlli, gravità, e sensibilità, tipo, provider, ambiente, etichette, categorie di dati e servizio dell'archivio - e, per ogni tipo di lavoro, **Analizza**, **Contenimento**, **Correzione** e **Giudica**, se è **Disattivato**, **Suggerisci** (propone e ti aspetta) o **Automaticamente**. Quando più regole corrispondono a un problema, un tipo di lavoro viene eseguito se una di esse lo attiva, e **Suggerisci** prevale su **Automaticamente**. Ogni proposta dice quale regola l'ha decisa. **Contenimento** impostato su **Automaticamente** permette di eseguire in autonomia anche una regola di pulizia dimostrata per i dati personali, non solo quella di un segreto; una regola non dimostrata sicura ti aspetta sempre, qualunque cosa dica una regola IA. Senza regole valgono le impostazioni predefinite del progetto: analizzare i problemi critici e alti, e suggerire tutto il resto.

Le regole IA appartengono all'intero progetto, come quelle per incidenti e avvisi: le modificano i Proprietari del progetto e gli Amministratori del progetto, e chiunque abbia i permessi delle regole IA. I ruoli di sicurezza vedono ciò che OneUptime AI ha proposto e fatto, ma non le regole.

## Cosa vede OneUptime AI

Nessuna funzionalità invia mai a un modello:

- un valore dei tuoi dati;
- un campione mascherato, come `j***@e******.com`: un indirizzo email mascherato porta ancora un dominio, e una carta mascherata le sue ultime quattro cifre;
- un record della tua telemetria: una riga di log, uno span o una sessione;
- una stringa di connessione, una chiave o qualsiasi altro segreto.

Sicurezza dei dati legge i tuoi dati da sé, nelle sue scansioni, e non ne conserva nulla. Ciò che invia a OneUptime AI viene costruito in un solo punto, a partire da un elenco di ciò che può essere inviato, e un test fallisce quando una funzionalità invia a un modello qualsiasi altra cosa.

| Funzionalità | Cosa invia | Si avvia da sola |
| --- | --- | --- |
| **Analisi su richiesta** | Titolo, gravità ed evidenza del problema, perché il suo controllo è importante e i passaggi che lo correggono; nome, tipo, regione, tag e configurazione dell'archivio, la sua sensibilità, i nomi dei suoi tipi di dati e circa quanti record contiene; chi può raggiungere l'archivio: identità, livello e modalità di ogni concessione, e all'incirca quando è stata usata l'ultima volta, e i servizi visti usarlo; le copie dei suoi dati in altri archivi, i suoi casi di sicurezza, l'azione di risposta che corregge il problema, e il repository e i file che lo dichiarano; quanti proprietari ha l'archivio, mai chi sono; per un problema di telemetria, dove è stato trovato ogni tipo di dato: l'attributo, il corpo del log o il prompt in cui si trova | No: la chiede una persona, nella pagina di un problema, oppure con Spiega con l'IA tramite l'API o il server MCP |
| **Analisi dei nuovi problemi** | Titolo, gravità ed evidenza del problema, perché il suo controllo è importante e i passaggi che lo correggono; nome, tipo, regione, tag e configurazione dell'archivio, la sua sensibilità, i nomi dei suoi tipi di dati e circa quanti record contiene; chi può raggiungere l'archivio: identità, livello e modalità di ogni concessione, e all'incirca quando è stata usata l'ultima volta, e i servizi visti usarlo; le copie dei suoi dati in altri archivi, i suoi casi di sicurezza, l'azione di risposta che corregge il problema, e il repository e i file che lo dichiarano; quanti proprietari ha l'archivio, mai chi sono; per un problema di telemetria, dove è stato trovato ogni tipo di dato: l'attributo, il corpo del log o il prompt in cui si trova | Sì: la avvia un problema nuovo o riaperto di gravità Critica o Alta, finché **Lavora sui nuovi problemi** è attivo |
| **Correggi con l'IA** | Il problema come l'ha visto il suo controllo, nome, tipo, regione e ID cloud dell'archivio, e per un problema di telemetria dove sono stati trovati i suoi dati, come richiesta all'agente di codice, che poi legge il codice del repository per fare la modifica | No: la chiede una persona, in un repository che può modificare in **Code** |
| **Suggerimenti per i campi che nessun rilevatore ha classificato** | Il tipo di archivio e i tipi di dati che l'IA può indicare; il nome di ogni campo, i nomi dei campi accanto e le forme dei suoi valori, ogni lettera come `a` o `A` e ogni cifra come `9`; quanti valori sono stati letti e quanto sono lunghi | Sì: la scansione del contenuto di un archivio li avvia |
| **Chiedi all'IA** | Gli archivi, i problemi e gli accessi che la persona può leggere in Sicurezza dei dati; cosa è stato trovato e dove, ogni tipo di dati per posizione, con conteggi e confidenza | No: una persona fa una domanda |
| **Proprietari degli archivi dati** | Il nome, il tipo, il provider, l'ambiente e la sensibilità dell'archivio, e i nomi dei suoi tipi di dati; ciò che indica un proprietario: i suoi tag cloud, i servizi che lo usano, i proprietari del codice del file che lo dichiara e le modifiche fatte su di esso; i team che le prove nominano, per nome, e le persone che nominano, solo come candidati numerati, mai con il loro nome o indirizzo email | Sì: la avvia un archivio senza proprietari, una volta al giorno per i nuovi archivi e quando una connessione cloud viene letta per la prima volta, mentre **Lavora sui nuovi problemi** è attivo |
| **Nomi per i problemi con una sola causa** | Ciò che condividono gli archivi dati del gruppo: il modulo, lo stack o il tag che li ha creati, l'identità che li ha creati o il loro schema di nomi; il controllo che non superano, quanti problemi contiene il gruppo, il tipo di archivio dati e il codice che li dichiara. Mai il nome di uno degli archivi del gruppo | Sì: lo avvia un gruppo di problemi causati da uno stesso errore, quando si forma o cambia ciò che i suoi archivi condividono, finché **Lavora sui nuovi problemi** è attivo |
| **Correggi la causa** | Il controllo che i problemi del gruppo non superano, ciò che condividono i loro archivi dati e il modulo o i file che li dichiarano, come richiesta all'agente di codice; ogni archivio dati che la pull request corregge: nome, tipo, regione e ID cloud, e il suo problema; l'agente di codice legge poi il codice del repository per fare la modifica | No: lo chiede una persona, da un gruppo in **Problemi** o approvando la proposta di OneUptime AI, in un repository che può modificare in **Codice**; oppure il passaggio **Fix the code with AI** di un playbook di sicurezza. Una regola la cui **Correzione** è impostata su **Automaticamente** la apre da sola |
| **Regole di pulizia per ciò che «Ripulisci» non può coprire** | Il tipo di dati di ogni risultato, la sua categoria e se viene trovato dai suoi valori o dal nome di un campo; dove si trova, l'attributo o il corpo del log, e i nomi degli attributi accanto; le forme dei suoi valori, come `AA-9999` per il valore `AB-1234`, e quanti valori sono stati letti | Sì: la avvia un problema di telemetria in cui OneUptime AI contiene la fuga, per i dati che nessuna regola «Ripulisci» può nascondere, mentre **Lavora sui nuovi problemi** è attivo |
| **Dati sensibili nelle pull request** | Ciò che le regole hanno trovato nel diff della pull request: il file e la riga, il nome scritto, il tipo di dati che nomina e il controllo che non supererebbe; il diff di quei file e il titolo della pull request, senza ciò che sembra un segreto, un indirizzo email o un indirizzo IP; mai ciò che contiene la produzione: dove la tua telemetria ha contenuto i dati, il nome di un archivio o ciò che contiene un archivio, né un campione di ciò che è stato trovato, nemmeno mascherato | Sì: la avvia la [revisione di produzione](/docs/ai/ai-agent#revisione-di-produzione-delle-pull-request) di una pull request, quando le sue regole trovano dati sensibili nella modifica |

**Spiega con l'IA** e **Chiedi all'IA** leggono anche, per primo, il [contesto IA](/docs/ai/ai-context) del tuo team, quando ne ha uno: le note che il tuo team ha scritto per OneUptime AI sui tuoi sistemi. **Analisi dei nuovi problemi** lo legge anche.

### Il testo scritto dai tuoi sistemi è un dato

Il nome di un archivio, il suo ID nel cloud, i suoi tag, le prove con cui ha risposto un cloud e la chiave di un attributo vengono dai tuoi cloud e dal tuo codice, quindi chiunque possa dare un nome a un bucket o mettere un tag su una risorsa scrive ciò che OneUptime AI legge. OneUptime AI riceve ogni istruzione in un messaggio a sé, e quel testo in un secondo messaggio, come dati:

- ogni testo viene limitato a una lunghezza e messo su una sola riga, e ciò che sembra un segreto, un indirizzo email o un indirizzo IP viene tolto;
- il testo che si legge come istruzioni per un'IA, come «ignore previous instructions», viene segnalato, e a OneUptime AI viene detto di non seguirlo mai;
- una risposta strutturata, come quella dei suggerimenti per i campi, viene letta in modo rigoroso: l'oggetto richiesto, o nessuna risposta.

### Cosa viene conservato

La riga di ogni chiamata in **Impostazioni del progetto → IA → Log IA** dice quale funzionalità ha chiamato quale modello, i suoi token e il suo costo. Non conserva mai ciò che è stato inviato o risposto: i Membri del progetto e i Visualizzatori leggono i Log IA, e i dati di Sicurezza dei dati sono per i loro proprietari e per i ruoli di sicurezza. Nemmeno la telemetria di OneUptime registra mai ciò che hanno inviato Spiega con l'IA o i suggerimenti per i campi, anche dove l'operatore del server registra ciò che inviano le altre chiamate all'IA. L'analisi stessa viene conservata sul suo problema, per chiunque possa leggere il problema, e una riga che si basa su qualcosa che un lettore non può leggere gli viene nascosta.

Quando una chiamata non riesce, Spiega con l'IA e i suggerimenti per i campi non conservano neanche una parola dell'errore del provider, che può citare ciò che è stato inviato. L'agente di programmazione dietro Correggi con l'IA e Correggi la causa, e la chat di Chiedi all'IA, conservano ancora l'errore del provider di una chiamata non riuscita nella sua riga.

Le proposte di proprietari conservano lo stesso di Spiega con l'IA: le righe delle loro chiamate nominano la funzionalità, il modello, i token e il costo, mai ciò che è stato inviato o risposto, e nessuna parola dell'errore di una chiamata fallita. Lo stesso vale per le regole di pulizia che scrive OneUptime AI, e ogni regola che ha scritto viene eseguita sui record in cui sono stati visti i dati prima di essere proposta o creata. Lo stesso vale per le letture dei dati sensibili di una pull request, i cui punti vengono conservati nella sua revisione di produzione, in Codice e nel suo commento.

## Verificalo di persona

**Sicurezza dei dati → Impostazioni → OneUptime AI** mostra tutto questo per il tuo progetto:

- **Cosa vede OneUptime AI**: ogni funzionalità, cosa invia e non invia mai, cosa la avvia, il modello su cui viene eseguita e cosa ne viene conservato. Il modello viene indicato a chi può leggere i provider LLM del progetto.
- **Mostra un esempio**: l'input esatto che **Spiega con l'IA** invierebbe per il tuo problema aperto più rischioso, così come lo invierebbe, con ciò che chiederebbe **Correggi con l'IA**. Il contesto IA del tuo progetto, che viene per primo, è mostrato con la sua lunghezza. Mostra solo un problema che puoi leggere.

**Impostazioni del progetto → IA → Provider LLM** rimanda qui, per chi sceglie il modello.

## Il tuo modello

Ogni funzionalità IA di Sicurezza dei dati viene eseguita sul modello scelto dal tuo progetto:

- **Spiega con l'IA** e i suggerimenti per i campi vengono eseguiti sul provider che una regola IA sceglie per il lavoro, altrimenti sul provider LLM predefinito del tuo progetto, altrimenti su quello del server.
- L'agente di programmazione di **Correggi con l'IA** viene eseguito sul provider che una regola IA sceglie, altrimenti su uno dei provider del tuo progetto, altrimenti su quello del server.
- **Chiedi all'IA** viene eseguito sul provider scelto nella chat, altrimenti su quello predefinito del tuo progetto.
- La lettura dei dati sensibili di una pull request viene eseguita sul provider che il repository sceglie per le sue revisioni di produzione, altrimenti sul provider LLM predefinito del tuo progetto, altrimenti su quello del server.

Un modello self-hosted le esegue tutte: Ollama, vLLM o qualsiasi endpoint compatibile con OpenAI che aggiungi in **Impostazioni del progetto → IA → Provider LLM**. Su un server isolato dalla rete, il vLLM incluso nel chart Helm è il provider del server, quindi nulla lascia il server.

### Con l'IA disattivata

Con **Abilita IA** disattivato in **Impostazioni del progetto → IA → Funzionalità IA**, OneUptime AI non invia nulla, e Sicurezza dei dati continua a funzionare come prima: ogni pagina, controllo, scansione e integrazione. Su un problema non compare alcun pulsante dell'IA, e dopo una scansione non viene chiesto nulla su alcun campo.

## Come viene misurata

Ogni funzionalità IA di Sicurezza dei dati viene misurata su un insieme fisso di casi inventati, costruiti come la funzionalità costruisce il suo input e valutati su ciò che dice una risposta giusta: una spiegazione che indica la correzione e non ripete nulla di ciò che il nome di un archivio le diceva di dire, il tipo di dati giusto per ogni campo, una correzione che cambia ciò che serve al controllo e nient'altro, e una risposta tratta da ciò che Chiedi all'IA ha letto. I casi vengono eseguiti contro un modello fissato ogni notte, a ogni modifica di un prompt IA di Sicurezza dei dati e prima di ogni release, che richiede che ogni funzionalità raggiunga la sua soglia.

Le proposte di proprietari sono valutate sul nominare il proprietario indicato dalle prove, sul non scegliere nessuno quando non indicano nessuno e sul non essere sicure dove le prove non concordano. Le regole di pulizia vengono eseguite su valori inventati di ogni posizione, che il modello non vede mai, e valutate sul nascondere ogni valore che contiene i dati e nessuno degli altri, e sul non scrivere alcuna regola per una posizione per cui nessuna regola è giusta. Le letture delle pull request vengono valutate sul mantenere ogni punto che è una fuga, sul lasciare fuori ciò che non lo è e su una correzione che dice cosa cambiare.

Per misurare il tuo modello sugli stessi casi, esegui la valutazione da un checkout di OneUptime, con la chiave del tuo modello, se ne ha bisogno, in `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

Nel tuo progetto, **Verdetti confermati** in **Impostazioni del progetto → IA → Risultati IA** conta quante volte ciò che le persone hanno deciso su un problema analizzato da OneUptime AI è andato come diceva il suo verdetto: corretto o accettato quando diceva **Reale**, accettato o segnato come pubblico per scelta quando diceva **Probabilmente voluto**, e segnato come non un problema quando diceva **Probabilmente un rilevamento errato**.

## Passaggi successivi

:::cards
- [Integrazioni di Sicurezza dei dati](/docs/data-security/integrations): Cosa fanno Spiega con l'IA e Correggi con l'IA su un problema.
- [Provider LLM](/docs/ai/llm-provider): Aggiungi il tuo modello, anche uno self-hosted.
- [Tipi di dati sensibili](/docs/data-security/data-types): Come vengono suggeriti i campi che nessun rilevatore ha saputo collocare.
- [Controlli e problemi di Sicurezza dei dati](/docs/data-security/checks-and-issues): Cosa significa ogni problema, e come correggerlo.
:::
