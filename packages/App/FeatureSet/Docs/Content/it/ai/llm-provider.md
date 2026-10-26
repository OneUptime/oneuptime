# Provider LLM

Un provider LLM è il modello dietro ogni funzionalità di IA di OneUptime: indagini, Chiedi all'IA, bozze e pull request di correzione. Questa pagina mostra quale provider usa una funzionalità, come aggiungerne uno tuo (OpenAI, Azure OpenAI e Microsoft Foundry, Anthropic, Groq, Mistral, Ollama o qualsiasi server compatibile con OpenAI) e come indirizzare OneUptime verso un modello che esegui tu stesso.

:::cards
- [Quale provider usa l'IA](#quale-provider-usa-lia): Il provider predefinito del progetto, altrimenti quello globale.
- [Self-hosted: zero configurazione con le variabili d'ambiente](#self-hosted-zero-configurazione-con-le-variabili-dambiente): Un provider per ogni progetto, dalle impostazioni del server.
- [Configurare un provider LLM](#configurare-un-provider-llm): Aggiungi un provider a un progetto e mettilo alla prova.
- [Scegliere un URL di base per un modello self-hosted](#scegliere-un-url-di-base-per-un-modello-self-hosted): Un indirizzo raggiungibile dal server OneUptime.
:::

## Cosa alimenta un provider

- **Indagini**: OneUptime AI indaga sui nuovi incidenti e avvisi e pubblica nella timeline un'analisi della causa principale con le fonti. Vedi [AI SRE](/docs/ai/ai-sre).
- **Domande**: **Ask AI** risponde a partire dai dati del tuo progetto, con una fonte per ogni affermazione. Vedi [Chiedi all'IA](/docs/ai/ask-ai).
- **Bozze**: **Draft with AI** nelle note di incidenti, avvisi e manutenzioni programmate, e i postmortem, scritti su richiesta o quando un incidente si risolve.
- **Codice**: pull request che correggono eccezioni, tracce lente e le cause trovate dalle indagini, da OneUptime o da GitHub. Vedi [Codice](/docs/ai/ai-agent).
- **Tutto il resto**: il triage di AI Insights, i passaggi di IA dei flussi di lavoro e dei runbook, e le risposte in Slack e Microsoft Teams.

## Quale provider usa l'IA

Le funzionalità di IA usano il provider predefinito del progetto. Un progetto senza provider predefinito usa il provider globale, quando ce n'è uno. Chiedi all'IA può anche spostare una conversazione su un altro dei provider del progetto, o su uno globale.

```mermaid title="Quale provider usa una funzionalità di IA"
flowchart TB
    F["Una funzionalità di IA<br/>ha bisogno di un modello"] --> D{"Il progetto ha<br/>un provider<br/>predefinito?"}
    D -->|"sì"| P["Il provider<br/>predefinito<br/>del progetto"]
    D -->|"no"| G{"Esiste un provider<br/>globale?"}
    G -->|"sì"| GP["Il provider globale:<br/>crediti IA su<br/>OneUptime Cloud"]
    G -->|"no"| N["Non parte nulla,<br/>e le pagine dell'IA<br/>dicono che manca<br/>un provider"]
```

Un provider è il predefinito di un progetto quando **Imposta come predefinito** è attivo, come per ogni nuovo provider. Un progetto i cui provider hanno tutti questa opzione disattivata ripiega sul provider globale, come se non ne avesse nessuno.

Ogni regola di OneUptime AI (regole IA e regole di post-mortem) può invece scegliere un provider proprio, in **Altri campi**: uno dei provider del progetto o uno globale, usato per tutto ciò che la regola avvia. Una regola che non ne sceglie nessuno usa il provider predefinito, e un provider scelto che non si può più usare ripiega su di esso. Vedi [Quale provider LLM usa una regola](/docs/ai/ai-sre#quale-provider-llm-usa-una-regola).

## OneUptime Cloud

Su **OneUptime Cloud**, ogni progetto può usare il provider globale senza alcuna configurazione. È pronto per ogni funzionalità di IA ed è pagato con i crediti IA del progetto.

Per usare invece le tue chiavi API o un modello specifico, aggiungi un tuo provider, come descritto sotto: non ti viene addebitata l'IA che gira sul tuo provider.

Il provider LLM globale è pagato con i crediti IA del progetto. Per limitare quanto l'IA può spendere ogni giorno, imposta un **Limite giornaliero di spesa IA (USD)** in **Impostazioni del progetto → IA → AI Features → Altre impostazioni**; un **Limite giornaliero di token IA** nello stesso punto limita i token su qualsiasi provider, compreso il tuo. Vedi [i limiti giornalieri del progetto](/docs/ai/ai-sre#i-limiti-giornalieri-del-progetto-stesso).

OneUptime Cloud può raggiungere solo endpoint LLM su internet pubblico. Non può collegarsi a un modello nella tua rete privata, come un server Ollama o vLLM self-hosted. Per usare un modello che esegui tu stesso, ospita OneUptime su una rete che può raggiungerlo, oppure esponi il modello su un endpoint pubblico: vedi [Scegliere un URL di base per un modello self-hosted](#scegliere-un-url-di-base-per-un-modello-self-hosted).

## Self-hosted: zero configurazione con le variabili d'ambiente

Su un'istanza self-hosted, il modo più rapido per attivare l'IA per **tutti i progetti in una volta** è impostare le variabili d'ambiente `GLOBAL_LLM_PROVIDER_*` sul tuo server OneUptime: in `config.env` per Docker Compose, o tramite i valori Helm. All'avvio, OneUptime registra da esse un provider LLM globale e lo tiene allineato; nessun progetto deve configurare nulla, e le attività di correzione IA lo usano anche quando un progetto non ha un proprio provider.

| Variabile | Descrizione |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Necessaria per attivarlo. Una tra `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | La chiave API: necessaria per OpenAI, Azure OpenAI, Anthropic, Groq e Mistral; non serve per Ollama o per un server compatibile con OpenAI senza chiave |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | L'endpoint: necessario per Azure OpenAI, Ollama e i server compatibili con OpenAI |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Il modello da usare. Facoltativo: se non è impostato, OneUptime usa il modello predefinito del provider e, su un server compatibile con OpenAI, il primo modello elencato dal server |
| `GLOBAL_LLM_PROVIDER_NAME` | Un nome descrittivo facoltativo, mostrato nella dashboard |

:::tabs
@tab Ollama
```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```
@tab OpenAI
```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```
:::

La sincronizzazione è dichiarativa: cambia una variabile e il provider si adegua al riavvio successivo; rimuovi `GLOBAL_LLM_PROVIDER_TYPE` e il provider viene eliminato. I provider globali creati a mano nell'Admin Dashboard non vengono mai toccati. Un progetto può comunque aggiungere un proprio provider in **Impostazioni del progetto → IA → Provider LLM**, e un provider di proprietà del progetto ha sempre la precedenza.

## Provider supportati

| Provider | A cosa serve | Chiave API richiesta | URL di base richiesto |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 e gli altri modelli OpenAI | Sì | No (usa il predefinito) |
| **Azure OpenAI / Microsoft Foundry** | Modelli che distribuisci in Microsoft Foundry o Azure OpenAI: modelli OpenAI, Foundry Models e Claude | Sì | Sì |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 e gli altri modelli Claude | Sì | No (usa il predefinito) |
| **Groq** | Inferenza veloce per Llama, Mixtral e altri modelli aperti | Sì | No (usa il predefinito) |
| **Mistral** | I modelli ospitati di Mistral | Sì | No (usa il predefinito) |
| **Ollama** | Modelli open source che esegui tu stesso, come Llama 3.1, Mistral o Qwen | No | Sì |
| **OpenAI Compatible** | Qualsiasi server compatibile con OpenAI: vLLM, LocalAI, LM Studio e altri | No (facoltativa) | Sì |

## Configurare un provider LLM

:::steps
### Apri i provider LLM

Vai in **Impostazioni del progetto → IA → Provider LLM** (la sezione **IA** del menu laterale parte chiusa) e fai clic su **Crea: Provider LLM**.

### Scegli il provider

In **Provider**, scegli il tuo **Provider LLM**: una scheda per OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama e qualsiasi server compatibile con OpenAI, ognuna con una riga che dice cos'è.

### Collegalo

In **Connessione**, il modulo chiede solo ciò che quel provider usa, con il suo aiuto sotto ogni campo:

- **Chiave API**: la tua chiave API, necessaria per OpenAI, Azure OpenAI, Anthropic, Groq e Mistral e facoltativa per un server compatibile con OpenAI; per Ollama non viene chiesta
- **URL di base**: l'endpoint, necessario per Azure OpenAI, Ollama e OpenAI Compatible; per gli altri, solo per passare da un proxy o da un gateway
- **Nome modello**: il modello da usare, come `gpt-5.1`, `claude-sonnet-5-5` o `llama3.1`. Se lo lasci vuoto, OneUptime usa il modello predefinito del provider; un server compatibile con OpenAI non ne ha uno, quindi OneUptime gli chiede quali modelli serve e usa il primo che elenca
- **Nome**: il nome del provider finché non ne scrivi uno tuo, come "Production OpenAI" o "Local Ollama"
- **Altri campi**, chiusi sotto i campi precedenti: una **Descrizione**, **Imposta come predefinito**, attivo per un nuovo provider perché le funzionalità di IA usano solo il provider predefinito del progetto, e **Parametri aggiuntivi**, un oggetto JSON facoltativo di parametri extra inviati al provider con ogni richiesta (per esempio `{"temperature": 0.2}`)

**Chi può vedere un provider.** I provider LLM di un progetto li leggono solo i membri che possono leggere le impostazioni del progetto: **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** e **Read LLM**. La **Chiave API** e i **Parametri aggiuntivi** di un provider li leggono solo i proprietari e gli amministratori del progetto, perché i parametri vengono inviati al provider con ogni richiesta e possono contenere un token o un header proprio come la chiave. Gli altri membri vedono se ci sono parametri salvati, non quali. I membri che possono modificare un provider possono comunque sostituirne la chiave API o i parametri senza leggerli: nel modulo di modifica quei campi partono vuoti, e lasciarne uno vuoto mantiene il valore salvato. Per rimuovere i parametri, salva `{}`. Solo i proprietari e gli amministratori del progetto possono cambiare l'**URL di base** di un provider, perché la sua chiave API e i suoi parametri aggiuntivi vengono inviati a quell'indirizzo; gli altri membri che possono modificare un provider possono cambiare tutto il resto. Chiunque possa leggere un provider ne può leggere l'**URL di base**, quindi non metterci mai una chiave, un token o una password: usa la **Chiave API**. L'elenco **Fornitori LLM globali** nella stessa pagina, i provider condivisi su cui un progetto ripiega, mostra nome, descrizione e prezzo a chiunque abbia effettuato l'accesso, e nient'altro.

### Mettilo alla prova

**Provare un provider.** **Test**, nella pagina del provider o nel menu della sua riga, invia al provider un breve prompt con la sua **Chiave API**, il **Nome modello**, l'**URL di base** e i **Parametri aggiuntivi**, e dice se ha risposto e chiamato uno strumento, cosa di cui le funzionalità di IA di OneUptime hanno bisogno. Un test fallito dice prima cosa controllare, poi cosa ha risposto il provider. Chi può modificare un provider può provarlo: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** e **Edit LLM**. Tutti gli altri che possono vedere il provider trovano **Test** bloccato. Un provider LLM globale lo prova un amministratore del server, nell'Admin Dashboard in **Impostazioni → Fornitori LLM globali**.
:::

## Configurazione per provider

### OpenAI

1. Ottieni la tua chiave API da [OpenAI Platform](https://platform.openai.com/api-keys)
2. Seleziona **OpenAI** come provider LLM
3. Inserisci la tua chiave API
4. Scegli un nome di modello:
   - `gpt-5.1` - Predefinito consigliato, forte nel tool calling e nelle indagini complesse
   - `gpt-5.1-mini` - Più veloce e più economico

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Ottieni la tua chiave API dalla [Anthropic Console](https://console.anthropic.com/)
2. Seleziona **Anthropic** come provider LLM
3. Inserisci la tua chiave API
4. Scegli un nome di modello:
   - `claude-sonnet-5-5` - Predefinito consigliato, il miglior equilibrio tra intelligenza, velocità e costo
   - `claude-opus-5-5` - Più capace, per le indagini più difficili
   - `claude-haiku-5-5` - Il più veloce e il più economico

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 e tutti i modelli Claude successivi scelgono da soli il proprio campionamento e rifiutano una richiesta che imposta `temperature`, `top_p` o `top_k`. OneUptime omette queste impostazioni per questi modelli. Se un modello ne rifiuta comunque una, OneUptime invia di nuovo la richiesta senza di essa e se ne ricorda per quel provider.

I modelli Claude 5 ragionano prima di rispondere, e il ragionamento conta nel limite di token della risposta, quindi OneUptime gli lascia spazio. Per farli ragionare meno e rispondere più in fretta e a minor costo, imposta `{"output_config": {"effort": "low"}}` nei **Parametri aggiuntivi** del provider. OneUptime invia ad Anthropic le impostazioni che aggiungi lì con ogni richiesta, tranne `model`, `messages`, `system`, `tools`, `tool_choice` e `stream`, che imposta da sé.

OneUptime usa la cache dei prompt di Anthropic. Ogni chiamata di un'indagine o di una risposta di Chiedi all'IA invia di nuovo il prompt di sistema, gli strumenti e la conversazione fin lì, e OneUptime li contrassegna per la cache: una chiamata paga un decimo del prezzo o meno per ciò che hanno inviato le chiamate precedenti, e un quarto in più del prezzo per ciò che è nuovo, che scrive nella cache. Se un gateway davanti a Claude rifiuta i contrassegni della cache, OneUptime invia di nuovo la richiesta senza di essi e lo ricorda per il provider. [Come vengono contati i token](/docs/ai/ai-sre#come-vengono-contati-i-token) spiega come i token in cache contano per i tuoi limiti.

### Azure OpenAI e Microsoft Foundry

Usa **Azure OpenAI / Microsoft Foundry** per i modelli che distribuisci in Microsoft Foundry o Azure OpenAI: modelli OpenAI, altri Foundry Models e Claude. Inserisci una delle chiavi della risorsa come **Chiave API**, il nome della distribuzione come **Nome modello** e l'endpoint della risorsa come **URL di base**, per esempio `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry e Azure OpenAI](/docs/ai/microsoft-foundry) descrive la parte Azure: la risorsa, i permessi, la distribuzione del modello, i requisiti di rete e la risoluzione dei problemi.

### Ollama (self-hosted)

Ollama esegue modelli open source sulle tue macchine.

1. Installa Ollama da [ollama.ai](https://ollama.ai)
2. Scarica un modello: `ollama pull llama3.1`
3. Assicurati che Ollama sia in esecuzione e che il server OneUptime possa raggiungerlo. Un'installazione nativa ascolta solo su `127.0.0.1`, quindi avviala con `OLLAMA_HOST=0.0.0.0:11434` per accettare connessioni da altre macchine e container (l'immagine Docker ufficiale `ollama/ollama` lo fa già)
4. Seleziona **Ollama** come provider LLM
5. Inserisci l'URL di base: l'indirizzo del server Ollama così come lo raggiunge il server OneUptime, come `http://ollama:11434` (OneUptime aggiunge `/api/chat` da sé). `localhost` non funziona: vedi [Scegliere un URL di base per un modello self-hosted](#scegliere-un-url-di-base-per-un-modello-self-hosted)
6. Inserisci il nome del modello che hai scaricato

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Aumenta la finestra di contesto.** Se non indicato diversamente, Ollama dimensiona la finestra di contesto di un modello in base alla memoria GPU che trova: 4k token sotto i 24 GiB, 32k fino a 48 GiB e 256k oltre (le versioni più vecchie usano 2.048 o 4.096 token). Le funzionalità di IA di OneUptime sono agenti. Ogni richiesta porta il loro prompt di sistema e le definizioni degli strumenti, più di 10.000 token prima di qualsiasi domanda, e un'indagine IA aggiunge ogni risultato di query alla conversazione man mano che procede. Quando una richiesta non ci sta più, Ollama scarta i messaggi più vecchi, e la domanda se ne va con loro. A seconda del modello e della versione di Ollama, il modello risponde allora senza la domanda o senza i suoi strumenti, oppure la richiesta fallisce con "no user query found in messages" (Qwen 3.8 e successivi) o "the prompt is longer than the context length currently available to the model". OneUptime segnala questi errori come "…the request is larger than the model's context window" e non riesegue l'indagine. Imposta un `num_ctx` più grande nei **Parametri aggiuntivi** del provider:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime unisce questo oggetto `options` alle opzioni che invia a Ollama, quindi elenca solo le impostazioni che vuoi cambiare. 65.536 token è quanto Ollama consiglia per gli agenti, e copre la maggior parte delle indagini. Un'indagine lunga può usarne di più, perché OneUptime inizia ad accorciare i vecchi risultati delle query solo quando la conversazione supera circa 75.000 token: usa 131.072 se il modello lo supporta e la tua GPU lo regge. Una finestra di contesto più grande richiede più memoria, e `ollama ps` mostra il contesto che ha ottenuto ogni modello caricato. Per alzare invece il predefinito per tutti i client, imposta `OLLAMA_CONTEXT_LENGTH` sul server Ollama. È l'unico modo quando OneUptime raggiunge Ollama tramite la sua API `/v1` compatibile con OpenAI (il provider **OpenAI Compatible**), che ignora `num_ctx`. Per un provider globale registrato dalle variabili `GLOBAL_LLM_PROVIDER_*`, imposta i **Parametri aggiuntivi** nell'Admin Dashboard in **Impostazioni → Fornitori LLM globali**; la sincronizzazione all'avvio non tocca quel campo.

**Modelli Ollama popolari:**

- `llama3.1` - Il modello Llama 3.1 di Meta, il Llama più vecchio che supporta il tool calling
- `llama3.3` - Il modello Llama 3.3 di Meta
- `qwen2.5` - Il modello Qwen 2.5 di Alibaba
- `mistral-nemo` - Il modello Nemo di Mistral AI

> [!NOTE]
> Le funzionalità di IA di OneUptime sono agenti: si affidano molto al tool calling. Usa `llama3.1` o più recente, oppure un altro modello che chiama strumenti. Un modello piccolo, o uno senza tool calling (come `llama2` o il `llama3` originale), risponde male: non può interrogare i tuoi monitor, i tuoi incidenti o la telemetria, così le indagini tornano vuote o inventate.

### Scegliere un URL di base per un modello self-hosted

L'URL di base di un modello self-hosted, che sia Ollama, vLLM, LM Studio o qualsiasi altro server compatibile con OpenAI, deve essere un indirizzo raggiungibile dal **server OneUptime**. Il tuo browser non vi si collega mai.

**Gli indirizzi di loopback vengono sempre rifiutati.** Prima di collegarsi, OneUptime controlla ogni indirizzo in cui si risolve il nome host dell'URL di base. `localhost`, `127.0.0.1`, `[::1]` e `0.0.0.0`, così come gli indirizzi link-local e di metadati cloud come `169.254.169.254`, vengono rifiutati in ogni distribuzione, self-hosted compresa. È voluto: l'URL di base di un provider non deve poter servire a raggiungere servizi sul server OneUptime stesso. Dentro Docker Compose o Kubernetes, `localhost` sarebbe comunque il container OneUptime, non la macchina che esegue il tuo modello.

Usa invece un indirizzo privato o un nome host interno:

| Dove gira il server del modello | URL di base |
| --- | --- |
| Un servizio sulla rete Docker Compose di OneUptime (`oneuptime`) | Il nome del servizio, ad es. `http://ollama:11434` |
| Lo stesso cluster Kubernetes di OneUptime | Il nome DNS del Service, ad es. `http://ollama.<namespace>.svc.cluster.local:11434`, lo stesso schema del [vLLM incluso](#vllm-self-hosted-su-kubernetes-helm) |
| La macchina host stessa, fuori da qualsiasi container | L'IP LAN dell'host, ad es. `http://192.168.1.20:11434`, oppure `http://host.docker.internal:11434` su Docker Desktop |
| Un'altra macchina della tua rete | Il suo IP privato o il suo nome host interno, ad es. `http://10.0.0.12:11434` |

I server compatibili con OpenAI seguono le stesse regole con la propria porta e il percorso `/v1`, ad es. `http://vllm:8000/v1`, oppure `http://192.168.1.20:1234/v1` per LM Studio. Come un'installazione nativa di Ollama, LM Studio ascolta solo su `127.0.0.1` finché non attivi **Serve on Local Network** nelle sue impostazioni del server.

**Gli indirizzi privati funzionano nelle installazioni self-hosted.** Un OneUptime self-hosted può raggiungere indirizzi di rete privati, come `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` e IPv6 `fc00::/7`, a meno che tu non imposti `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, che li rifiuta come fa OneUptime Cloud. Questa impostazione non si applica a un provider LLM globale, che configura un amministratore (con le variabili `GLOBAL_LLM_PROVIDER_*` o nell'Admin Dashboard) anziché un progetto: può comunque raggiungere indirizzi privati. Gli indirizzi di loopback e link-local restano rifiutati per ogni provider.

**OneUptime Cloud (SaaS) non può raggiungere le reti private.** Rifiuta gli indirizzi di rete privati, e i nomi host che vi si risolvono, per ogni provider LLM. Per usare un modello che gira sulla tua infrastruttura, ospita OneUptime su una rete che può raggiungerlo, oppure esponi il modello su un endpoint raggiungibile pubblicamente. Proteggi un endpoint pubblico con una chiave API: il provider **Ollama** non invia credenziali, mentre **OpenAI Compatible** invia la chiave API come token bearer (Ollama serve anche un'API compatibile con OpenAI sotto `/v1`, quindi può stare dietro un reverse proxy che controlla la chiave).

### OpenAI Compatible (vLLM, LocalAI, LM Studio e altri)

Usa il provider **OpenAI Compatible** per qualsiasi server che implementa l'API `/chat/completions` di OpenAI ma non è OpenAI, per esempio [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) o text-generation-webui. Di solito girano a un tuo indirizzo, spesso senza autenticazione.

1. Avvia il tuo server compatibile con OpenAI e annota il suo URL di base (di solito finisce con `/v1`)
2. Seleziona **OpenAI Compatible** come provider LLM
3. Inserisci l'**URL di base** (obbligatorio), ad es. `http://your-server:8000/v1`. Il server OneUptime deve raggiungerlo, quindi non `localhost`: vedi [Scegliere un URL di base per un modello self-hosted](#scegliere-un-url-di-base-per-un-modello-self-hosted)
4. Inserisci il **Nome modello** oppure lascialo vuoto: in quel caso OneUptime chiede al tuo server quali modelli serve e usa il primo che elenca, che su vLLM è il modello che serve. Un nome inserito deve corrispondere a un modello servito dal tuo server
5. Inserisci la **Chiave API** solo se il tuo server la chiede; lasciala vuota per un server senza chiave

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> Dopo il salvataggio, usa **Test** sul provider per controllare la connessione, il nome del modello e l'URL di base.

### vLLM self-hosted su Kubernetes (Helm)

Se ospiti OneUptime con il chart Helm, puoi eseguire [vLLM](https://docs.vllm.ai), un server di inferenza compatibile con OpenAI, dentro il tuo cluster e servire modelli locali sulle tue GPU. Nessun dato lascia la tua infrastruttura.

1. Attivalo nei tuoi valori Helm (servono nodi con GPU NVIDIA):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Esegui `helm upgrade` e attendi che il pod di vLLM sia Ready (il primo avvio scarica il modello)
3. Fatto: vLLM viene registrato automaticamente come provider LLM globale all'avvio (`vllm.globalProvider.enabled`, predefinito `true`), così le funzionalità di IA funzionano per tutti i progetti, comprese le attività di correzione IA. (Ovunque, sia nel cloud che self-hosted, le attività di correzione dell'agente usano il provider globale quando il progetto non possiede un proprio provider; nel cloud quell'uso viene fatturato come token IA misurati. Un provider di proprietà del progetto ha sempre la precedenza.)

Se hai disattivato la registrazione automatica (`vllm.globalProvider.enabled: false`), crea il provider a mano:

1. Seleziona **OpenAI Compatible** come provider LLM (vLLM parla l'API di OpenAI)
2. Inserisci l'URL di base interno al cluster: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (sostituisci `cluster.local` se hai cambiato `global.clusterDomain`)
3. Inserisci il nome del modello: l'id completo del modello su Hugging Face (o `vllm.servedModelName` se ne hai impostato uno), oppure lascialo vuoto per usare il modello servito da vLLM
4. Inserisci la chiave API solo se hai impostato `vllm.apiKey`; lasciala vuota per un vLLM senza chiave

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Con la fatturazione attiva, o con `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` nei valori Helm), il provider di un progetto non può raggiungere questo indirizzo interno al cluster, che si risolve in un IP privato del cluster. Crea invece il provider nell'Admin Dashboard in **Impostazioni → Fornitori LLM globali**, con gli stessi campi: un provider LLM globale può raggiungere quell'indirizzo.

Vedi la [guida vLLM del chart Helm](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) per la pianificazione delle GPU, i modelli ad accesso limitato e le opzioni di ottimizzazione.

## Buone pratiche

- **Dai ai provider nomi chiari**, come "Production OpenAI" o "Development Ollama", così un collega sa qual è quale.
- **Tieni le chiavi nel campo Chiave API.** Le chiavi API sono cifrate a riposo, e solo i proprietari e gli amministratori del progetto le leggono.
- **Prova dopo ogni modifica**, con **Test** sul provider.
- **Tieni d'occhio quanto costa l'IA.** Ogni chiamata è elencata con i suoi token e il suo costo in **Impostazioni del progetto → IA → Registri IA**.

## Risoluzione dei problemi

:::details Il provider non è raggiungibile
- **OpenAI o Anthropic**: controlla che la tua chiave API sia valida e abbia crediti
- **Azure OpenAI / Microsoft Foundry**: l'errore inizia con ciò che va cambiato. [Microsoft Foundry e Azure OpenAI](/docs/ai/microsoft-foundry) spiega ogni errore con cui risponde Azure
- **Ollama**: controlla che il server Ollama sia in esecuzione, ascolti su un indirizzo raggiungibile dal server OneUptime (`OLLAMA_HOST=0.0.0.0:11434` per un'installazione nativa) e che l'URL di base punti a quell'indirizzo
- **OpenAI Compatible**: controlla che l'URL di base finisca con `/v1` (o corrisponda al tuo server), che il nome del modello, se ne hai inserito uno, corrisponda a un modello servito dal tuo server e di aver impostato una chiave API solo se il tuo server la chiede. Se il nome del modello è vuoto e il server non elenca alcun modello nel suo endpoint `/models`, inseriscine uno
- **"…points to an address OneUptime is not allowed to connect to"**: l'URL di base si risolve in un indirizzo rifiutato: `localhost` o un altro indirizzo di loopback o, su OneUptime Cloud, un indirizzo di rete privato. (OneUptime Cloud segnala invece un nome host rifiutato come "…could not be reached".) Vedi [Scegliere un URL di base per un modello self-hosted](#scegliere-un-url-di-base-per-un-modello-self-hosted)
- **Un firewall**: controlla che la tua rete consenta connessioni in uscita verso l'API del provider
:::

:::details Il modello non viene trovato
Controlla come è scritto il nome del modello. Per Ollama, scarica prima il modello con `ollama pull <model-name>`. Alcuni modelli sono disponibili solo in alcune regioni.
:::

:::details La finestra di contesto è troppo piccola
- **"…the request is larger than the model's context window"**: la richiesta non è entrata nella finestra di contesto del modello, di solito perché un'indagine IA ha raccolto molte prove. Aumenta `num_ctx` nei **Parametri aggiuntivi** del provider, o `OLLAMA_CONTEXT_LENGTH` sul server Ollama; vedi [Ollama (self-hosted)](#ollama-self-hosted)
- **"no user query found in messages"**: lo stesso problema, come lo segnala Qwen. OneUptime invia sempre la domanda; Ollama l'ha scartata per far stare il resto della richiesta
:::

Sei ancora bloccato? Cerca il tuo errore nelle [issue GitHub di OneUptime](https://github.com/OneUptime/oneuptime/issues), oppure contatta il supporto se il tuo piano lo include.

## Passi successivi

:::cards
- [Codice](/docs/ai/ai-agent): Le pull request che scrive il tuo provider, e dove partono.
- [AI SRE](/docs/ai/ai-sre): Cosa fa OneUptime AI con il provider una volta che ne ha uno.
- [Chiedi all'IA](/docs/ai/ask-ai): Fai una domanda al tuo progetto, e cambia il provider di una conversazione.
:::
