# Autentisering

OneUptime CLI stöder flera sätt att autentisera mot din OneUptime-instans. Du kan använda namngivna kontexter, miljövariabler eller skicka autentiseringsuppgifter direkt som flaggor.

## Inloggning

Autentisera mot din OneUptime-instans med en API-nyckel:

```bash
oneuptime login <api-key> <instance-url>
```

**Argument:**

| Argument         | Beskrivning                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `<api-key>`      | Din OneUptime API-nyckel (t.ex. `sk-your-api-key`)                |
| `<instance-url>` | URL:en till din OneUptime-instans (t.ex. `https://oneuptime.com`) |

**Alternativ:**

| Alternativ              | Beskrivning                                    |
| ----------------------- | ---------------------------------------------- |
| `--context-name <name>` | Namn för denna kontext (standard: `"default"`) |

**Exempel:**

```bash
# Logga in med standardkontext
oneuptime login sk-abc123 https://oneuptime.com

# Logga in med en namngiven kontext
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Konfigurera flera miljöer
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Kontexter

Kontexter gör det möjligt att spara och växla mellan flera OneUptime-miljöer (t.ex. produktion, staging, utveckling).

### Lista kontexter

```bash
oneuptime context list
```

Visar alla konfigurerade kontexter. Den aktiva kontexten markeras med `*`.

### Byt kontext

```bash
oneuptime context use <name>
```

Byt till en annan namngiven kontext för alla efterföljande kommandon.

```bash
# Byt till staging
oneuptime context use staging

# Byt till produktion
oneuptime context use production
```

### Visa aktuell kontext

```bash
oneuptime context current
```

Visar den aktuellt aktiva kontexten, inklusive instans-URL:en och en maskerad API-nyckel.

### Ta bort en kontext

```bash
oneuptime context delete <name>
```

Ta bort en namngiven kontext. Om den borttagna kontexten är den aktiva växlar CLI automatiskt till den första kvarvarande kontexten.

## Lösning av autentiseringsuppgifter

Autentiseringsuppgifter löses i följande prioritetsordning:

1. **CLI-flaggor** (`--api-key` och `--url`)
2. **Miljövariabler** (`ONEUPTIME_API_KEY` och `ONEUPTIME_URL`)
3. **Namngiven kontext** (via `--context`-flaggan)
4. **Aktuell kontext** (från sparad konfiguration)

Du kan blanda källor – till exempel använda en miljövariabel för API-nyckeln och en sparad kontext för URL:en.

### Använda CLI-flaggor

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Använda miljövariabler

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Använda en specifik kontext

```bash
oneuptime --context production incident list
```

## Verifiera autentisering

Kontrollera din aktuella autentiseringsstatus:

```bash
oneuptime whoami
```

Detta visar:

- Instans-URL
- Maskerad API-nyckel
- Aktuellt kontextnamn (visas bara om en sparad kontext är aktiv)

Om du inte är autentiserad visar kommandot ett hjälpsamt meddelande som föreslår att du kör `oneuptime login`.

## Konfigurationsfil

Autentiseringsuppgifter lagras i `~/.oneuptime/config.json` med begränsade behörigheter (`0600`).

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
