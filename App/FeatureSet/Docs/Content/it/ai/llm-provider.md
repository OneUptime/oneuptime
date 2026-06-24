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

| Provider      | Descrizione                                                            | Chiave API Richiesta | URL Base Richiesto      |
| ------------- | ---------------------------------------------------------------------- | -------------------- | ----------------------- |
| **OpenAI**    | GPT-4, GPT-4o, GPT-3.5 Turbo e altri modelli OpenAI                    | Sì                   | No (usa il predefinito) |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku e altri modelli Claude  | Sì                   | No (usa il predefinito) |
| **Ollama**    | Modelli open-source self-hosted come Llama 2, Mistral, CodeLlama, ecc. | No                   | Sì                      |

## Configurazione di un Provider LLM

### Passo 1: Naviga alle Impostazioni dei Provider LLM

1. Accedi alla dashboard di OneUptime
2. Vai su **Impostazioni Progetto** > **AI** > **Provider LLM**
3. Clicca su **Crea Provider LLM** per aggiungere un nuovo provider

### Passo 2: Configura il tuo Provider

Compila i seguenti campi:

- **Nome**: Un nome descrittivo per questa configurazione LLM (es. "OpenAI Produzione", "Ollama Locale")
- **Descrizione** (opzionale): Una descrizione per identificare lo scopo di questo provider
- **Tipo LLM**: Seleziona il tipo di provider (OpenAI, Anthropic o Ollama)
- **Chiave API**: La tua chiave API (richiesta per OpenAI e Anthropic)
- **Nome del Modello**: Il modello specifico da utilizzare (es. `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **URL Base** (opzionale): URL endpoint API personalizzato (richiesto per Ollama, opzionale per gli altri)

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
- **Firewall**: Verifica che la tua rete consenta connessioni in uscita all'API del provider

### Modello Non Trovato

- Verifica che il nome del modello sia scritto correttamente
- Per Ollama, assicurati di aver scaricato il modello con `ollama pull <model-name>`
- Controlla se il modello è disponibile nella tua regione (alcuni modelli hanno restrizioni regionali)

## Hai Bisogno di Aiuto?

Se riscontri problemi nella configurazione del tuo provider LLM:

1. Controlla le [Segnalazioni su GitHub di OneUptime](https://github.com/OneUptime/oneuptime/issues) per problemi noti
2. Contatta il supporto se sei su un piano enterprise
