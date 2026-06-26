# Server MCP

Il Server MCP (Model Context Protocol) di OneUptime fornisce agli LLM accesso diretto alla tua istanza OneUptime, abilitando operazioni di monitoraggio, gestione degli incidenti e osservabilità basate sull'AI.

## Cos'è il Server MCP di OneUptime?

Il Server MCP di OneUptime è un ponte tra i Large Language Model (LLM) e la tua istanza OneUptime. Implementa il Model Context Protocol (MCP), consentendo agli assistenti AI come Claude di interagire direttamente con la tua infrastruttura di monitoraggio.

## Come Funziona

Il server MCP è ospitato insieme alla tua istanza OneUptime ed è accessibile tramite il trasporto Streamable HTTP. Non è richiesta alcuna installazione locale.

**Utenti Cloud**: `https://oneuptime.com/mcp`
**Utenti Self-Hosted**: `https://your-oneuptime-domain.com/mcp`

## Funzionalità Principali

- **Copertura API Completa**: Accesso a 711 endpoint API di OneUptime
- **126 Tipi di Risorse**: Gestione di tutte le risorse OneUptime inclusi monitor, incidenti, team, probe e altro
- **Operazioni in Tempo Reale**: Creazione, lettura, aggiornamento ed eliminazione di risorse in tempo reale
- **Interfaccia Type-safe**: Completamente tipizzata con validazione completa degli input
- **Autenticazione Sicura**: Autenticazione basata su chiave API con gestione appropriata degli errori
- **Integrazione Semplice**: Funziona con Claude Desktop e altri client compatibili con MCP
- **Gestione delle Sessioni**: Gestione integrata delle sessioni con supporto alla riconnessione automatica

## Cosa Puoi Fare

Con il Server MCP di OneUptime, gli assistenti AI possono aiutarti a:

- **Gestione dei Monitor**: Creare e configurare monitor, controllarne lo stato e gestire gruppi di monitor
- **Risposta agli Incidenti**: Creare incidenti, aggiungere note, assegnare membri del team e tracciare la risoluzione
- **Operazioni di Team**: Gestire team, autorizzazioni e turni di reperibilità
- **Pagine di Stato**: Aggiornare le pagine di stato, creare annunci e gestire i subscriber
- **Alerting**: Configurare regole di avviso, gestire policy di escalation e controllare i log di notifica
- **Probe**: Distribuire e gestire probe di monitoraggio in diverse posizioni
- **Report e Analisi**: Generare report e analizzare i dati di monitoraggio

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

| Endpoint      | Metodo | Descrizione                                                           |
| ------------- | ------ | --------------------------------------------------------------------- |
| `/mcp`        | GET    | Stream di eventi inviati dal server per le notifiche server-to-client |
| `/mcp`        | POST   | Richieste JSON-RPC per chiamate agli strumenti e altre operazioni     |
| `/mcp`        | DELETE | Pulizia e terminazione della sessione                                 |
| `/mcp/health` | GET    | Endpoint di controllo dello stato di salute                           |
| `/mcp/tools`  | GET    | API REST per elencare gli strumenti disponibili                       |

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

## Verifica

Verifica che il server MCP sia in esecuzione:

```bash
# Per OneUptime Cloud
curl https://oneuptime.com/mcp/health

# Per Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Elenca gli strumenti disponibili:

```bash
# Per OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# Per Self-Hosted
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
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
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

- Il server MCP utilizza l'header `mcp-session-id` per tracciare le sessioni
- Assicurati che il tuo client gestisca correttamente l'ID di sessione restituito dal server
- Le sessioni vengono automaticamente pulite quando le connessioni si chiudono

## Risorse Disponibili

Il server MCP fornisce accesso a 126 tipi di risorse tra cui:

**Monitoraggio**: Monitor, MonitorStatus, MonitorGroup, Probe
**Incidenti**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Avvisi**: Alert, AlertState, AlertSeverity
**Pagine di Stato**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**Reperibilità**: On-CallPolicy, EscalationRule, On-CallSchedule
**Team**: Team, TeamMember, TeamPermission
**Telemetria**: TelemetryService, Log, Span, Metric
**Workflow**: Workflow, WorkflowVariable, WorkflowLog

Ogni risorsa supporta le operazioni standard: List, Count, Get, Create, Update e Delete.
