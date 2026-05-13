# Autenticazione

La CLI di OneUptime supporta più modalità di autenticazione con la tua istanza OneUptime. Puoi utilizzare contesti denominati, variabili d'ambiente o passare le credenziali direttamente come flag.

## Login

Autentica con la tua istanza OneUptime usando una chiave API:

```bash
oneuptime login <api-key> <instance-url>
```

**Argomenti:**

| Argomento | Descrizione |
|----------|-------------|
| `<api-key>` | La tua chiave API OneUptime (es. `sk-your-api-key`) |
| `<instance-url>` | L'URL della tua istanza OneUptime (es. `https://oneuptime.com`) |

**Opzioni:**

| Opzione | Descrizione |
|--------|-------------|
| `--context-name <name>` | Nome per questo contesto (predefinito: `"default"`) |

**Esempi:**

```bash
# Login con contesto predefinito
oneuptime login sk-abc123 https://oneuptime.com

# Login con un contesto denominato
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Configurazione di più ambienti
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Contesti

I contesti ti consentono di salvare e passare tra più ambienti OneUptime (es. produzione, staging, sviluppo).

### Elenca i Contesti

```bash
oneuptime context list
```

Mostra tutti i contesti configurati. Il contesto corrente è contrassegnato con `*`.

### Cambia Contesto

```bash
oneuptime context use <name>
```

Passa a un contesto denominato diverso per tutti i comandi successivi.

```bash
# Passa a staging
oneuptime context use staging

# Passa a produzione
oneuptime context use production
```

### Visualizza il Contesto Corrente

```bash
oneuptime context current
```

Mostra il contesto attualmente attivo, incluso l'URL dell'istanza e una chiave API mascherata.

### Elimina un Contesto

```bash
oneuptime context delete <name>
```

Rimuove un contesto denominato. Se il contesto eliminato è quello corrente, la CLI passa automaticamente al primo contesto rimanente.

## Risoluzione delle Credenziali

Le credenziali vengono risolte nel seguente ordine di priorità:

1. **Flag CLI** (`--api-key` e `--url`)
2. **Variabili d'ambiente** (`ONEUPTIME_API_KEY` e `ONEUPTIME_URL`)
3. **Contesto denominato** (tramite flag `--context`)
4. **Contesto corrente** (dalla configurazione salvata)

Puoi combinare le fonti -- per esempio, usa una variabile d'ambiente per la chiave API e un contesto salvato per l'URL.

### Uso dei Flag CLI

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Uso delle Variabili d'Ambiente

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Uso di un Contesto Specifico

```bash
oneuptime --context production incident list
```

## Verifica dell'Autenticazione

Controlla lo stato di autenticazione corrente:

```bash
oneuptime whoami
```

Questo visualizza:
- URL dell'istanza
- Chiave API mascherata
- Nome del contesto corrente (mostrato solo se è attivo un contesto salvato)

Se non autenticato, il comando mostra un messaggio utile che suggerisce di eseguire `oneuptime login`.

## File di Configurazione

Le credenziali sono archiviate in `~/.oneuptime/config.json` con autorizzazioni limitate (`0600`).

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
