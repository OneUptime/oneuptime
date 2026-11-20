# OneUptime AI in Sicurezza dei dati

OneUptime AI lavora su ciò che Sicurezza dei dati ha trovato senza vedere i tuoi dati. Riceve nomi, forme, conteggi e configurazione, mai un valore dei tuoi dati, un campione mascherato, un record o una stringa di connessione. Ogni funzionalità viene eseguita sul modello del tuo progetto, anche uno self-hosted, e ogni pagina, controllo, scansione e integrazione di Sicurezza dei dati funziona con l'IA disattivata.

:::cards
- [Cosa vede OneUptime AI](#cosa-vede-oneuptime-ai): Cosa invia ogni funzionalità, e cosa non invia mai.
- [Verificalo di persona](#verificalo-di-persona): L'input esatto che invierebbe uno dei tuoi problemi.
- [Il tuo modello](#il-tuo-modello): Ogni funzionalità sul provider del tuo progetto, Ollama, vLLM o qualsiasi endpoint compatibile con OpenAI.
- [Come viene misurata](#come-viene-misurata): Ogni funzionalità su casi fissi, prima di ogni release.
:::

## Cosa vede OneUptime AI

Nessuna funzionalità invia mai a un modello:

- un valore dei tuoi dati;
- un campione mascherato, come `j***@e******.com`: un indirizzo email mascherato porta ancora un dominio, e una carta mascherata le sue ultime quattro cifre;
- un record della tua telemetria: una riga di log, uno span o una sessione;
- una stringa di connessione, una chiave o qualsiasi altro segreto.

Sicurezza dei dati legge i tuoi dati da sé, nelle sue scansioni, e non ne conserva nulla. Ciò che invia a OneUptime AI viene costruito in un solo punto, a partire da un elenco di ciò che può essere inviato, e un test fallisce quando una funzionalità invia a un modello qualsiasi altra cosa.

| Funzionalità | Cosa invia | Si avvia da sola |
| --- | --- | --- |
| **Spiega con l'IA** | Il titolo, la gravità e le prove del problema, perché il suo controllo è importante e la correzione per il cloud dell'archivio; il nome, il tipo, la regione e l'ID nel cloud dell'archivio, la sua sensibilità e i nomi dei suoi tipi di dati; per un problema nella telemetria, dove è stato trovato ogni tipo di dati: l'attributo, il corpo del log o il prompt in cui si trova | No: una persona la richiede, nella pagina di un problema |
| **Analisi dei nuovi problemi** | Il titolo, la gravità e le prove del problema, perché il suo controllo è importante e la correzione per il cloud dell'archivio; il nome, il tipo, la regione e l'ID nel cloud dell'archivio, la sua sensibilità e i nomi dei suoi tipi di dati; per un problema nella telemetria, dove è stato trovato ogni tipo di dati: l'attributo, il corpo del log o il prompt in cui si trova | Sì: un nuovo problema critico o alto la avvia, mentre **Lavora sui nuovi problemi** è attivo |
| **Correggi con l'IA** | Ciò che invia Spiega con l'IA, come richiesta all'agente di programmazione, che poi legge il codice stesso del repository per apportare la modifica | No: una persona la richiede, in un repository che può modificare in **Codice** |
| **Suggerimenti per i campi che nessun rilevatore ha classificato** | Il tipo di archivio e i tipi di dati che l'IA può indicare; il nome di ogni campo, i nomi dei campi accanto e le forme dei suoi valori, ogni lettera come `a` o `A` e ogni cifra come `9`; quanti valori sono stati letti e quanto sono lunghi | Sì: la scansione del contenuto di un archivio li avvia |
| **Chiedi all'IA** | Gli archivi, i problemi e gli accessi che la persona può leggere in Sicurezza dei dati; cosa è stato trovato e dove, ogni tipo di dati per posizione, con conteggi e confidenza | No: una persona fa una domanda |

**Spiega con l'IA** e **Chiedi all'IA** leggono anche, per primo, il [contesto IA](/docs/ai/ai-context) del tuo team, quando ne ha uno: le note che il tuo team ha scritto per OneUptime AI sui tuoi sistemi. **Analisi dei nuovi problemi** lo legge anche.

### Il testo scritto dai tuoi sistemi è un dato

Il nome di un archivio, il suo ID nel cloud, i suoi tag, le prove con cui ha risposto un cloud e la chiave di un attributo vengono dai tuoi cloud e dal tuo codice, quindi chiunque possa dare un nome a un bucket o mettere un tag su una risorsa scrive ciò che OneUptime AI legge. OneUptime AI riceve ogni istruzione in un messaggio a sé, e quel testo in un secondo messaggio, come dati:

- ogni testo viene limitato a una lunghezza e messo su una sola riga, e ciò che sembra un segreto, un indirizzo email o un indirizzo IP viene tolto;
- il testo che si legge come istruzioni per un'IA, come «ignore previous instructions», viene segnalato, e a OneUptime AI viene detto di non seguirlo mai;
- una risposta strutturata, come quella dei suggerimenti per i campi, viene letta in modo rigoroso: l'oggetto richiesto, o nessuna risposta.

### Cosa viene conservato

La riga di ogni chiamata in **Impostazioni del progetto → IA → Log IA** dice quale funzionalità ha chiamato quale modello, i suoi token e il suo costo. Non conserva mai ciò che è stato inviato o risposto: i Membri del progetto e i Visualizzatori leggono i Log IA, e i dati di Sicurezza dei dati sono per i loro proprietari e per i ruoli di sicurezza. Nemmeno la telemetria di OneUptime registra mai ciò che hanno inviato Spiega con l'IA o i suggerimenti per i campi, anche dove l'operatore del server registra ciò che inviano le altre chiamate all'IA.

Quando una chiamata non riesce, Spiega con l'IA e i suggerimenti per i campi non conservano neanche una parola dell'errore del provider, che può citare ciò che è stato inviato. L'agente di programmazione dietro Correggi con l'IA e la chat di Chiedi all'IA conservano ancora l'errore del provider di una chiamata non riuscita nella sua riga.

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

Un modello self-hosted le esegue tutte: Ollama, vLLM o qualsiasi endpoint compatibile con OpenAI che aggiungi in **Impostazioni del progetto → IA → Provider LLM**. Su un server isolato dalla rete, il vLLM incluso nel chart Helm è il provider del server, quindi nulla lascia il server.

### Con l'IA disattivata

Con **Abilita IA** disattivato in **Impostazioni del progetto → IA → Funzionalità IA**, OneUptime AI non invia nulla, e Sicurezza dei dati continua a funzionare come prima: ogni pagina, controllo, scansione e integrazione. Su un problema non compare alcun pulsante dell'IA, e dopo una scansione non viene chiesto nulla su alcun campo.

## Come viene misurata

Ogni funzionalità IA di Sicurezza dei dati viene misurata su un insieme fisso di casi inventati, costruiti come la funzionalità costruisce il suo input e valutati su ciò che dice una risposta giusta: una spiegazione che indica la correzione e non ripete nulla di ciò che il nome di un archivio le diceva di dire, il tipo di dati giusto per ogni campo, una correzione che cambia ciò che serve al controllo e nient'altro, e una risposta tratta da ciò che Chiedi all'IA ha letto. I casi vengono eseguiti contro un modello fissato ogni notte, a ogni modifica di un prompt IA di Sicurezza dei dati e prima di ogni release, che richiede che ogni funzionalità raggiunga la sua soglia.

Per misurare il tuo modello sugli stessi casi, esegui la valutazione da un checkout di OneUptime, con la chiave del tuo modello, se ne ha bisogno, in `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Passaggi successivi

:::cards
- [Integrazioni di Sicurezza dei dati](/docs/data-security/integrations): Cosa fanno Spiega con l'IA e Correggi con l'IA su un problema.
- [Provider LLM](/docs/ai/llm-provider): Aggiungi il tuo modello, anche uno self-hosted.
- [Tipi di dati sensibili](/docs/data-security/data-types): Come vengono suggeriti i campi che nessun rilevatore ha saputo collocare.
- [Controlli e problemi di Sicurezza dei dati](/docs/data-security/checks-and-issues): Cosa significa ogni problema, e come correggerlo.
:::
