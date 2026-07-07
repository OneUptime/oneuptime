# Provider LLM

OneUptime supporta l'integrazione con vari provider di Large Language Model (LLM) per abilitare funzionalità basate sull'AI in tutta la piattaforma. Questa guida ti aiuterà a configurare il tuo provider LLM.

## Cosa Possono Fare i Provider LLM?

I Provider LLM in OneUptime ti aiutano ad automatizzare e migliorare il flusso di lavoro di gestione degli incidenti:

- **Note sugli Incidenti**: Generazione automatica di note e aggiornamenti dettagliati sugli incidenti
- **Note sugli Avvisi**: Creazione di descrizioni e contesti significativi per gli avvisi
- **Note sulle Manutenzioni Programmate**: Generazione automatica di note per gli eventi di manutenzione
- **Postmortem degli Incidenti**: Redazione automatica di report postmortem completi sugli incidenti
- **Miglioramenti al Codice**: Se colleghi il tuo repository di codice a OneUptime, utilizzeremo il tuo Provider LLM per analizzare i dati di telemetria (log, trace, metriche, eccezioni) e suggerire miglioramenti al codice

## Utenti di OneUptime SaaS

Se stai utilizzando **OneUptime SaaS** (versione cloud-hosted), puoi usare il **Provider LLM Globale** per impostazione predefinita senza alcuna configurazione aggiuntiva. Il Provider LLM Globale è pre-configurato e pronto all'uso per tutte le funzionalità AI.

Se preferisci usare le tue chiavi API o un provider specifico, puoi comunque configurare un Provider LLM personalizzato seguendo le istruzioni qui sotto.

## Provider Supportati

OneUptime supporta attualmente i seguenti provider LLM:

| Provider              | Descrizione                                                              | Chiave API Richiesta | URL Base Richiesto      |
| --------------------- | ------------------------------------------------------------------------ | -------------------- | ----------------------- |
| **OpenAI**            | GPT-4, GPT-4o, GPT-3.5 Turbo e altri modelli OpenAI                      | Sì                   | No (usa il predefinito) |
| **Azure OpenAI**      | Modelli OpenAI ospitati sul tuo deployment Azure                         | Sì                   | Sì                      |
| **Anthropic**         | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku e altri modelli Claude    | Sì                   | No (usa il predefinito) |
| **Groq**              | Inferenza veloce per Llama, Mixtral e altri modelli open                 | Sì                   | No (usa il predefinito) |
| **Mistral**           | Modelli ospitati da Mistral                                              | Sì                   | No (usa il predefinito) |
| **Ollama**            | Modelli open-source self-hosted come Llama 2, Mistral, CodeLlama, ecc.   | No                   | Sì                      |
| **OpenAI Compatible** | Qualsiasi server compatibile con OpenAI (vLLM, LocalAI, LM Studio, ecc.) | No (opzionale)       | Sì                      |

## Configurazione di un Provider LLM

### Passo 1: Naviga alle Impostazioni dei Provider LLM

1. Accedi alla dashboard di OneUptime
2. Vai su **Agenti AI** > **Provider LLM**
3. Clicca su **Crea Provider LLM** per aggiungere un nuovo provider

### Passo 2: Configura il tuo Provider

Compila i seguenti campi:

- **Nome**: Un nome descrittivo per questa configurazione LLM (es. "OpenAI Produzione", "Ollama Locale")
- **Descrizione** (opzionale): Una descrizione per identificare lo scopo di questo provider
- **Tipo LLM**: Seleziona il tipo di provider (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama o OpenAI Compatible)
- **Chiave API**: La tua chiave API (richiesta per OpenAI, Azure OpenAI, Anthropic, Groq e Mistral; opzionale per Ollama e per i server compatibili con OpenAI)
- **Nome del Modello**: Il modello specifico da utilizzare (es. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **URL Base** (opzionale): URL endpoint API personalizzato (richiesto per Azure OpenAI, Ollama e OpenAI Compatible; opzionale per gli altri)

## Configurazione Specifica per Provider

### OpenAI

1. Ottieni la tua chiave API da [OpenAI Platform](https://platform.openai.com/api-keys)
2. Seleziona **OpenAI** come Tipo LLM
3. Inserisci la tua chiave API
4. Scegli un nome di modello:
   - `gpt-4o` - Modello più capace, ideale per compiti complessi
   - `gpt-4o-mini` - Più veloce e conveniente
   - `gpt-4-turbo` - Buon equilibrio tra capacità e velocità
   - `gpt-3.5-turbo` - Veloce ed economico

**Esempio di Configurazione:**

```
Nome: OpenAI Produzione
Tipo LLM: OpenAI
Chiave API: sk-xxxxxxxxxxxxxxxxxxxx
Nome del Modello: gpt-4o
```

### Anthropic

1. Ottieni la tua chiave API da [Anthropic Console](https://console.anthropic.com/)
2. Seleziona **Anthropic** come Tipo LLM
3. Inserisci la tua chiave API
4. Scegli un nome di modello:
   - `claude-3-opus-20240229` - Modello più capace
   - `claude-3-sonnet-20240229` - Buon equilibrio tra intelligenza e velocità
   - `claude-3-haiku-20240307` - Il più veloce e compatto
   - `claude-3-5-sonnet-20241022` - Ultimo modello Sonnet

**Esempio di Configurazione:**

```
Nome: Anthropic Produzione
Tipo LLM: Anthropic
Chiave API: sk-ant-xxxxxxxxxxxxxxxxxxxx
Nome del Modello: claude-3-5-sonnet-20241022
```

### Ollama (Self-Hosted)

Ollama ti consente di eseguire LLM open-source localmente o sulla tua infrastruttura.

1. Installa Ollama da [ollama.ai](https://ollama.ai)
2. Scarica il modello desiderato: `ollama pull llama2`
3. Assicurati che Ollama sia in esecuzione e accessibile
4. Seleziona **Ollama** come Tipo LLM
5. Inserisci l'URL Base (es. `http://localhost:11434`)
6. Inserisci il nome del modello scaricato

**Esempio di Configurazione:**

```
Nome: Ollama Locale
Tipo LLM: Ollama
URL Base: http://localhost:11434
Nome del Modello: llama2
```

**Modelli Ollama Popolari:**

- `llama2` - Modello Llama 2 di Meta
- `llama3` - Modello Llama 3 di Meta
- `mistral` - Modello di Mistral AI
- `codellama` - Modello Llama specializzato per il codice
- `mixtral` - Modello mixture of experts di Mistral

### OpenAI Compatible (vLLM, LocalAI, LM Studio, ecc.)

Usa il provider **OpenAI Compatible** per qualsiasi server che implementa l'API OpenAI `/chat/completions` ma non è OpenAI stesso — ad esempio [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) o text-generation-webui. Questi server sono tipicamente self-hosted su un URL personale e spesso funzionano senza autenticazione.

1. Avvia il tuo server compatibile con OpenAI e annota il suo URL base (di solito termina con `/v1`)
2. Seleziona **OpenAI Compatible** come Tipo LLM
3. Inserisci l'**URL Base** (obbligatorio), es. `http://your-server:8000/v1`
4. Inserisci il **Nome del Modello** (obbligatorio) — deve corrispondere a un modello esposto dal tuo server
5. Inserisci la **Chiave API** solo se il tuo server la richiede; lasciala vuota per i server senza autenticazione

**Esempio di Configurazione (vLLM senza chiave):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Suggerimento: Dopo il salvataggio, usa il pulsante **Test** sul provider per confermare che la connessione, il nome del modello e l'URL base siano corretti.

### vLLM Self-Hosted su Kubernetes (Helm)

Se ospiti OneUptime autonomamente con il chart Helm, puoi eseguire [vLLM](https://docs.vllm.ai) — un server di inferenza compatibile con OpenAI — all'interno del tuo cluster e servire modelli locali sulle tue GPU. Nessun dato lascia la tua infrastruttura.

1. Abilitalo nei tuoi valori Helm (richiede nodi GPU NVIDIA):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Esegui `helm upgrade` e attendi che il pod vLLM diventi Ready (il primo avvio scarica il modello)
3. Fatto — vLLM viene registrato automaticamente come Provider LLM Globale all'avvio (`vllm.globalProvider.enabled`, predefinito `true`), quindi le funzionalità AI funzionano per tutti i progetti. Nota: gli Agenti AI a livello di progetto non possono usare i provider globali e necessitano comunque di un Provider LLM specifico per il progetto.

Se hai disabilitato la registrazione automatica (`vllm.globalProvider.enabled: false`), crea il provider manualmente:

1. Seleziona **OpenAI Compatible** come Tipo LLM (vLLM parla l'API OpenAI)
2. Inserisci l'URL Base in-cluster: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`
3. Inserisci il Nome del Modello: l'id completo del modello HuggingFace (oppure `vllm.servedModelName` se ne hai impostato uno)
4. Inserisci la Chiave API solo se hai impostato `vllm.apiKey`; lasciala vuota per un vLLM senza autenticazione

**Esempio di Configurazione:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Consulta il [README del chart Helm](https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/oneuptime#local-models-with-vllm) per lo scheduling delle GPU, i modelli con accesso limitato e le opzioni di tuning.

## Utilizzo di URL Base Personalizzati

Per distribuzioni enterprise o quando si utilizzano servizi proxy, puoi specificare un URL Base personalizzato:

- **Azure OpenAI**: Usa l'URL del tuo endpoint Azure
- **API compatibili con OpenAI**: Qualsiasi API che segue le specifiche API di OpenAI
- **Istanze Ollama private**: L'URL del tuo server Ollama interno

## Best Practice

1. **Usa nomi descrittivi**: Assegna nomi chiari ai tuoi provider (es. "GPT-4 Produzione", "Ollama Sviluppo")
2. **Proteggi le tue chiavi API**: Le chiavi API sono crittografate a riposo, ma evita di condividerle
3. **Testa la tua configurazione**: Dopo la configurazione, verifica che il provider funzioni con le funzionalità AI
4. **Monitora l'utilizzo**: Tieni traccia dell'utilizzo delle API per gestire i costi

## Risoluzione dei Problemi

### Problemi di Connessione

- **OpenAI/Anthropic**: Verifica che la tua chiave API sia valida e abbia credito sufficiente
- **Ollama**: Assicurati che il server Ollama sia in esecuzione e che l'URL Base sia corretto
- **OpenAI Compatible**: Assicurati che l'URL Base termini con `/v1` (o corrisponda al tuo server), che il Nome del Modello corrisponda a un modello esposto dal tuo server e imposta una Chiave API solo se il tuo server la richiede
- **Firewall**: Verifica che la tua rete consenta connessioni in uscita all'API del provider

### Modello Non Trovato

- Verifica che il nome del modello sia scritto correttamente
- Per Ollama, assicurati di aver scaricato il modello con `ollama pull <model-name>`
- Controlla se il modello è disponibile nella tua regione (alcuni modelli hanno restrizioni regionali)

## Hai Bisogno di Aiuto?

Se riscontri problemi nella configurazione del tuo provider LLM:

1. Controlla le [Segnalazioni su GitHub di OneUptime](https://github.com/OneUptime/oneuptime/issues) per problemi noti
2. Contatta il supporto se sei su un piano enterprise
