# Authenticatie

De OneUptime CLI ondersteunt meerdere manieren om te authenticeren bij uw OneUptime-instantie. U kunt gebruik maken van benoemde contexten, omgevingsvariabelen of inloggegevens rechtstreeks als vlaggen opgeven.

## Inloggen

Authenticeer bij uw OneUptime-instantie met een API-sleutel:

```bash
oneuptime login <api-key> <instance-url>
```

**Argumenten:**

| Argument         | Beschrijving                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `<api-key>`      | Uw OneUptime API-sleutel (bijv. `sk-your-api-key`)                |
| `<instance-url>` | De URL van uw OneUptime-instantie (bijv. `https://oneuptime.com`) |

**Opties:**

| Optie                   | Beschrijving                                    |
| ----------------------- | ----------------------------------------------- |
| `--context-name <name>` | Naam voor deze context (standaard: `"default"`) |

**Voorbeelden:**

```bash
# Inloggen met standaardcontext
oneuptime login sk-abc123 https://oneuptime.com

# Inloggen met een benoemde context
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Meerdere omgevingen instellen
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Contexten

Met contexten kunt u meerdere OneUptime-omgevingen opslaan en ertussen schakelen (bijv. productie, staging, ontwikkeling).

### Contexten weergeven

```bash
oneuptime context list
```

Geeft alle geconfigureerde contexten weer. De huidige context is gemarkeerd met `*`.

### Schakelen van context

```bash
oneuptime context use <name>
```

Schakel over naar een andere benoemde context voor alle volgende opdrachten.

```bash
# Overschakelen naar staging
oneuptime context use staging

# Overschakelen naar productie
oneuptime context use production
```

### Huidige context bekijken

```bash
oneuptime context current
```

Geeft de momenteel actieve context weer, inclusief de instantie-URL en een gemaskeerde API-sleutel.

### Een context verwijderen

```bash
oneuptime context delete <name>
```

Verwijder een benoemde context. Als de verwijderde context de huidige is, schakelt de CLI automatisch over naar de eerste resterende context.

## Inloggegevensresolutie

Inloggegevens worden opgelost in de volgende prioriteitsvolgorde:

1. **CLI-vlaggen** (`--api-key` en `--url`)
2. **Omgevingsvariabelen** (`ONEUPTIME_API_KEY` en `ONEUPTIME_URL`)
3. **Benoemde context** (via `--context`-vlag)
4. **Huidige context** (uit opgeslagen configuratie)

U kunt bronnen combineren — gebruik bijvoorbeeld een omgevingsvariabele voor de API-sleutel en een opgeslagen context voor de URL.

### CLI-vlaggen gebruiken

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Omgevingsvariabelen gebruiken

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Een specifieke context gebruiken

```bash
oneuptime --context production incident list
```

## Authenticatie verifiëren

Controleer uw huidige authenticatiestatus:

```bash
oneuptime whoami
```

Dit geeft het volgende weer:

- Instantie-URL
- Gemaskeerde API-sleutel
- Naam van de huidige context (alleen weergegeven als een opgeslagen context actief is)

Als u niet bent geauthenticeerd, toont de opdracht een behulpzaam bericht met de suggestie `oneuptime login` uit te voeren.

## Configuratiebestand

Inloggegevens worden opgeslagen in `~/.oneuptime/config.json` met beperkte rechten (`0600`).

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
