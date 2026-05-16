# Autentificering

OneUptime CLI understøtter flere måder at autentificere med din OneUptime-instans på. Du kan bruge navngivne kontekster, miljøvariabler eller sende legitimationsoplysninger direkte som flag.

## Login

Autentificer med din OneUptime-instans ved hjælp af en API-nøgle:

```bash
oneuptime login <api-key> <instance-url>
```

**Argumenter:**

| Argument | Beskrivelse |
|----------|-------------|
| `<api-key>` | Din OneUptime API-nøgle (f.eks. `sk-your-api-key`) |
| `<instance-url>` | URL'en til din OneUptime-instans (f.eks. `https://oneuptime.com`) |

**Indstillinger:**

| Indstilling | Beskrivelse |
|--------|-------------|
| `--context-name <name>` | Navn til denne kontekst (standard: `"default"`) |

**Eksempler:**

```bash
# Log ind med standardkontekst
oneuptime login sk-abc123 https://oneuptime.com

# Log ind med en navngivet kontekst
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Opsæt flere miljøer
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Kontekster

Kontekster giver dig mulighed for at gemme og skifte mellem flere OneUptime-miljøer (f.eks. produktion, staging, udvikling).

### Liste over kontekster

```bash
oneuptime context list
```

Viser alle konfigurerede kontekster. Den aktuelle kontekst er markeret med `*`.

### Skift kontekst

```bash
oneuptime context use <name>
```

Skift til en anden navngivet kontekst for alle efterfølgende kommandoer.

```bash
# Skift til staging
oneuptime context use staging

# Skift til produktion
oneuptime context use production
```

### Vis aktuel kontekst

```bash
oneuptime context current
```

Viser den aktuelt aktive kontekst, herunder instans-URL og en maskeret API-nøgle.

### Slet en kontekst

```bash
oneuptime context delete <name>
```

Fjern en navngivet kontekst. Hvis den slettede kontekst er den aktuelle, skifter CLI automatisk til den første resterende kontekst.

## Løsning af legitimationsoplysninger

Legitimationsoplysninger løses i følgende prioritetsrækkefølge:

1. **CLI-flag** (`--api-key` og `--url`)
2. **Miljøvariabler** (`ONEUPTIME_API_KEY` og `ONEUPTIME_URL`)
3. **Navngivet kontekst** (via `--context`-flag)
4. **Aktuel kontekst** (fra gemt konfiguration)

Du kan blande kilder – brug f.eks. en miljøvariabel til API-nøglen og en gemt kontekst til URL'en.

### Brug af CLI-flag

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Brug af miljøvariabler

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Brug af en specifik kontekst

```bash
oneuptime --context production incident list
```

## Bekræft autentificering

Kontroller din aktuelle autentificeringsstatus:

```bash
oneuptime whoami
```

Dette viser:
- Instans-URL
- Maskeret API-nøgle
- Aktuel kontekstnavn (vises kun, hvis en gemt kontekst er aktiv)

Hvis ikke autentificeret, viser kommandoen en hjælpsom besked, der foreslår, at du kører `oneuptime login`.

## Konfigurationsfil

Legitimationsoplysninger gemmes i `~/.oneuptime/config.json` med begrænsede tilladelser (`0600`).

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
