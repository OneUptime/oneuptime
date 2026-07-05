# Server MCP

Il Server MCP (Model Context Protocol) di OneUptime fornisce agli LLM accesso diretto alla tua istanza OneUptime, abilitando operazioni di monitoraggio, gestione degli incidenti e osservabilità basate sull'AI.

## Cos'è il Server MCP di OneUptime?

Il Server MCP di OneUptime è un ponte tra i Large Language Model (LLM) e la tua istanza OneUptime. Implementa il Model Context Protocol (MCP), consentendo agli assistenti AI come Claude di interagire direttamente con la tua infrastruttura di monitoraggio.

## Come Funziona

Il server MCP è ospitato insieme alla tua istanza OneUptime ed è accessibile tramite il trasporto Streamable HTTP. Non è richiesta alcuna installazione locale.

**Utenti Cloud**: `https://oneuptime.com/mcp`
**Utenti Self-Hosted**: `https://your-oneuptime-domain.com/mcp`

## Funzionalità Principali

- **~155 Strumenti**: Strumenti CRUD completi per 22 tipi di risorse (incidenti, avvisi, monitor, pagine di stato, reperibilità e altro), strumenti di telemetria in sola lettura, oltre a strumenti di workflow e di supporto
- **Operazioni in Tempo Reale**: Creazione, lettura, aggiornamento ed eliminazione di risorse in tempo reale
- **Interfaccia Type-safe**: Completamente tipizzata con validazione completa degli input
- **Autenticazione Sicura**: Autenticazione con chiave API per singola richiesta con gestione appropriata degli errori
- **Annotazioni di Sicurezza**: Gli strumenti in sola lettura riportano `readOnlyHint` e gli strumenti di eliminazione riportano `destructiveHint`, così i client MCP possono approvare automaticamente le chiamate sicure e chiedere conferma prima di quelle distruttive
- **Integrazione Semplice**: Funziona con Claude Desktop e altri client compatibili con MCP
- **Stateless per Progettazione**: Nessun ID di sessione — ogni richiesta è autosufficiente, quindi il server funziona dietro load balancer e deployment multi-replica

## Cosa Puoi Fare

Con il Server MCP di OneUptime, gli assistenti AI possono aiutarti a:

- **Gestione dei Monitor**: Creare e configurare monitor, controllarne lo stato e rivedere la cronologia degli stati
- **Risposta agli Incidenti**: Creare, prendere in carico e risolvere incidenti, aggiungere note interne o pubbliche e tracciare la risoluzione
- **Operazioni di Team**: Gestire team e policy di reperibilità
- **Pagine di Stato**: Gestire le pagine di stato e creare annunci
- **Alerting**: Prendere in carico e risolvere avvisi, aggiungere note agli avvisi e gestire stati e severità degli avvisi
- **Manutenzione Programmata**: Creare e gestire eventi di manutenzione programmata
- **Telemetria**: Interrogare log, metriche, trace, eccezioni e log dei monitor (in sola lettura)

## Requisiti

- Istanza OneUptime (cloud o self-hosted)
- Client compatibile con MCP (Claude Desktop, VS Code con GitHub Copilot, ecc.)
- Chiave API OneUptime valida (richiesta solo per operazioni autenticate - gli strumenti pubblici funzionano senza di essa)

## Ottenere la Chiave API

1. Accedi alla tua istanza OneUptime
2. Naviga su **Impostazioni** → **Chiavi API**
3. Clicca su **Crea Chiave API**
4. Fornisci un nome (es. "Server MCP")
5. Seleziona le autorizzazioni appropriate per il tuo caso d'uso
6. Copia la chiave API generata

Le chiavi API hanno ambito di progetto: il server MCP deduce il tuo progetto dalla chiave, quindi gli strumenti di creazione non richiedono mai un argomento `projectId`.

> **Attenzione — non fornire mai una chiave master a un agente AI.** Anche una chiave API *master* di OneUptime viene accettata su questo header e concede accesso amministrativo all'intera istanza. Usa sempre una chiave API di progetto con il privilegio minimo necessario all'agente (una chiave in sola lettura è sufficiente per tutti gli strumenti `get_`/`list_`/`count_`).

## Configurazione

### Configurazione di Claude Desktop

Trova il file di configurazione di Claude Desktop:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### Per OneUptime Cloud

Aggiungi la seguente configurazione:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Per OneUptime Self-Hosted

Sostituisci `oneuptime.com` con il tuo dominio OneUptime:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Accesso Pubblico (Senza Chiave API)

Per usare solo gli strumenti pubblici (informazioni sulla pagina di stato, guida), puoi connetterti senza una chiave API:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Questa configurazione consente l'accesso agli strumenti pubblici della pagina di stato e alle risorse di guida senza richiedere autenticazione.

### VS Code con GitHub Copilot

VS Code supporta i server MCP in modo nativo con GitHub Copilot (versione 1.99+). Questo consente a Copilot di accedere direttamente ai dati di OneUptime.

#### Passo 1: Requisiti

- VS Code versione 1.99 o successiva
- Estensione GitHub Copilot installata e attivata
- GitHub Copilot Chat abilitato

#### Passo 2: Apri la Configurazione MCP

1. Premi `Ctrl+Shift+P` (Windows/Linux) o `Cmd+Shift+P` (macOS)
2. Digita "MCP: Open User Configuration" e premi Invio
3. Questo apre o crea il file di configurazione `mcp.json`

In alternativa, crea `.vscode/mcp.json` nel tuo workspace per una configurazione specifica del progetto.

#### Per OneUptime Cloud

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Per OneUptime Self-Hosted

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Passo 3: Avvia il Server MCP

1. Premi `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Digita "MCP: List Servers" per visualizzare i server disponibili
3. Clicca su "oneuptime" per avviare il server
4. Quando richiesto, inserisci la tua chiave API OneUptime

#### Passo 4: Usa con Copilot Chat

Apri GitHub Copilot Chat e usa la modalità Agente (`@workspace` o chiedi direttamente):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Nota sulla Sicurezza

La configurazione sopra utilizza variabili di input con `"password": true` per richiedere in modo sicuro la chiave API invece di archiviarla in testo normale. VS Code ti chiederà di confermare la fiducia all'avvio del server MCP per la prima volta.

## Endpoint Disponibili

| Endpoint      | Metodo | Descrizione                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | Richieste JSON-RPC per chiamate agli strumenti e altre operazioni                                                                            |
| `/mcp`        | GET    | Senza un header `Accept` SSE: payload JSON di discovery. Con tale header: `405` — il server stateless non offre uno stream SSE autonomo (i client conformi procedono senza) |
| `/mcp`        | DELETE | Nessuna operazione (il server è stateless, quindi non c'è alcuna sessione da terminare)                                                             |
| `/mcp/health` | GET    | Endpoint di controllo dello stato di salute                                                                                                            |
| `/mcp/tools`  | GET    | API REST per elencare gli strumenti disponibili                                                                                                 |

## Autenticazione

Il server MCP supporta due modalità di funzionamento:

### Strumenti Pubblici (Autenticazione Non Richiesta)

Puoi connetterti al server MCP senza una chiave API per accedere agli strumenti pubblici:

- **`oneuptime_help`**: Ottieni guida e indicazioni sulle funzionalità MCP di OneUptime
- **`oneuptime_list_resources`**: Elenca le risorse disponibili e le loro operazioni
- **`get_public_status_page_overview`**: Ottieni una panoramica di una pagina di stato pubblica
- **`get_public_status_page_incidents`**: Ottieni gli incidenti da una pagina di stato pubblica
- **`get_public_status_page_scheduled_maintenance`**: Ottieni gli eventi di manutenzione programmata
- **`get_public_status_page_announcements`**: Ottieni gli annunci da una pagina di stato pubblica

Gli strumenti della pagina di stato pubblica accettano sia un ID pagina di stato (UUID) sia il nome di dominio della pagina di stato.

### Strumenti Autenticati (Chiave API Richiesta)

Per tutte le altre operazioni (gestione di monitor, incidenti, team, ecc.), è richiesta l'autenticazione tramite uno dei seguenti header:

- `x-api-key`: La tua chiave API OneUptime
- `Authorization`: Bearer token con la tua chiave API (es. `Bearer your-api-key-here`)

Lo schema `Bearer` non fa distinzione tra maiuscole e minuscole. Gli errori degli strumenti vengono restituiti come risultati in-band dello strumento (`isError: true`) con `statusCode`, dettagli e un suggerimento — non come errori del protocollo MCP — così gli agenti possono leggere il fallimento e autocorreggersi.

## Strumenti di Workflow

Oltre agli strumenti CRUD per risorsa, il server include strumenti di workflow appositamente progettati per la risposta a incidenti e avvisi:

- **`acknowledge_incident`** / **`resolve_incident`**: Portano un incidente allo stato Acknowledged o Resolved del progetto — equivalente a premere il pulsante nella dashboard
- **`acknowledge_alert`** / **`resolve_alert`**: Lo stesso per gli avvisi
- **`add_incident_note`**: Aggiunge una nota a un incidente con `visibility: "internal"` (solo per il team, impostazione predefinita) o `visibility: "public"` (pubblicata sulla pagina di stato). Il Markdown è supportato
- **`add_alert_note`**: Aggiunge una nota interna a un avviso

Un ciclo tipico: `list_incidents` → `acknowledge_incident` → indagine con `list_logs` → `add_incident_note` (pubblica) → `resolve_incident`.

## Who Am I

Lo strumento **`oneuptime_whoami`** restituisce il progetto a cui appartiene la tua chiave API (ID e nome). È un'utile prima chiamata con cui un agente può orientarsi — e poiché gli strumenti di creazione deducono `projectId` dalla chiave API, l'agente non deve mai passare un ID di progetto.

## Interrogare la Telemetria

Log, metriche, trace (span), eccezioni e log dei monitor sono esposti come strumenti `list_` e `count_` in sola lettura (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` e i corrispondenti `count_`). La telemetria viene ingerita tramite OpenTelemetry, quindi non esistono strumenti di creazione.

Interroga sempre la telemetria con un filtro sull'intervallo temporale. I campi di query accettano un valore diretto oppure un oggetto operatore:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Operatori supportati: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. I valori di ordinamento sono `"ASC"` o `"DESC"`.

## Selezione dei Campi e Paginazione

Gli strumenti `get_` e `list_` accettano un array `select` opzionale di nomi di campi. Per impostazione predefinita vengono restituiti tutti i campi leggibili tranne quelli pesanti (colonne JSON, testo molto lungo e HTML), che devono essere richiesti esplicitamente in `select`.

Gli strumenti di elenco paginano con `limit` (predefinito 10, massimo 100) e `skip`, e ogni risposta di elenco riporta esattamente ciò che ha restituito:

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## Verifica

Verifica che il server MCP sia in esecuzione:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Elenca gli strumenti disponibili:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## Esempi di Utilizzo

### Query di Informazioni di Base

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Gestione dei Monitor

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Gestione degli Incidenti

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Team e Reperibilità

```
"List the teams in this project"
"Show me our on-call policies"
```

### Gestione delle Pagine di Stato

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Query Pubbliche sulla Pagina di Stato (Senza Chiave API)

Queste query funzionano senza autenticazione, usando solo gli strumenti pubblici della pagina di stato:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Operazioni Avanzate

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## Autorizzazioni della Chiave API

### Accesso in Sola Lettura

Per visualizzare solo i dati, aggiungi autorizzazioni di lettura per la tua chiave API.

### Accesso Completo

Per accesso completo per creare, aggiornare ed eliminare risorse, assicurati che la tua chiave API abbia i permessi di Project Admin.

### Best Practice

- Usa Autorizzazioni Specifiche: Concedi solo le autorizzazioni minime necessarie
- Ruota le Chiavi API: Ruota regolarmente le tue chiavi API
- Monitora l'Utilizzo: Tieni traccia dell'utilizzo delle chiavi API in OneUptime
- Chiavi Separate: Usa chiavi API diverse per ambienti diversi

## Risoluzione dei Problemi

### Errori di Autorizzazione

Assicurati che la tua chiave API abbia le autorizzazioni necessarie:

- Accesso in lettura per elencare le risorse
- Accesso in scrittura per creare/aggiornare le risorse
- Accesso in eliminazione se vuoi rimuovere le risorse

### Problemi di Connessione

1. Verifica che l'URL di OneUptime sia corretto
2. Controlla che la tua chiave API sia valida
3. Assicurati che la tua istanza OneUptime sia accessibile
4. Testa l'endpoint di health check

### Chiave API Non Valida

- Verifica la chiave API nelle impostazioni di OneUptime
- Controlla la presenza di spazi o caratteri aggiuntivi
- Assicurati che la chiave non sia scaduta

### Errori di Sessione

Se ricevi errori relativi alla sessione:

- Il server MCP è stateless — non emette né traccia ID di sessione, quindi ogni richiesta funziona con qualsiasi replica del server
- I client che inviano un header `mcp-session-id` proveniente da una versione precedente del server possono semplicemente ometterlo; viene ignorato
- Aggiorna le configurazioni dei client MCP più vecchi che si aspettano che il server restituisca un ID di sessione

## Risorse Disponibili

Il server MCP fornisce strumenti per le seguenti risorse:

**Monitoraggio**: Monitor, Monitor Status, Monitor Status Event
**Incidenti**: Incident, Incident State, Incident Severity, Incident State Timeline, Incident Public Note, Incident Internal Note
**Avvisi**: Alert, Alert State, Alert Severity, Alert State Timeline, Alert Internal Note
**Pagine di Stato**: Status Page, Status Page Announcement
**Manutenzione Programmata**: Scheduled Maintenance Event, Scheduled Maintenance State, Scheduled Maintenance State Timeline
**Team e Reperibilità**: Team, On-Call Policy
**Etichette**: Label
**Telemetria (sola lettura)**: Log, Metric, Span, Exception Instance, Monitor Log

Ogni risorsa di database supporta Create, Get, List, Update, Delete e Count tramite strumenti in snake_case — ad esempio `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Le risorse di telemetria espongono solo strumenti `list_` e `count_` (ad esempio `list_logs`, `count_spans`).
