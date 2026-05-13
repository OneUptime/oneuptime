# Autentisering

OneUptime CLI støtter flere måter å autentisere med OneUptime-instansen din på. Du kan bruke navngitte kontekster, miljøvariabler eller sende legitimasjon direkte som flagg.

## Innlogging

Autentiser med OneUptime-instansen din ved hjelp av en API-nøkkel:

```bash
oneuptime login <api-key> <instance-url>
```

**Argumenter:**

| Argument | Beskrivelse |
|----------|-------------|
| `<api-key>` | OneUptime API-nøkkelen din (f.eks. `sk-your-api-key`) |
| `<instance-url>` | URL-en til OneUptime-instansen din (f.eks. `https://oneuptime.com`) |

**Alternativer:**

| Alternativ | Beskrivelse |
|------------|-------------|
| `--context-name <name>` | Navn for denne konteksten (standard: `"default"`) |

**Eksempler:**

```bash
# Logg inn med standardkontekst
oneuptime login sk-abc123 https://oneuptime.com

# Logg inn med en navngitt kontekst
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Konfigurer flere miljøer
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Kontekster

Kontekster lar deg lagre og bytte mellom flere OneUptime-miljøer (f.eks. produksjon, staging, utvikling).

### List kontekster

```bash
oneuptime context list
```

Viser alle konfigurerte kontekster. Den gjeldende konteksten er merket med `*`.

### Bytt kontekst

```bash
oneuptime context use <name>
```

Bytt til en annen navngitt kontekst for alle påfølgende kommandoer.

```bash
# Bytt til staging
oneuptime context use staging

# Bytt til produksjon
oneuptime context use production
```

### Vis gjeldende kontekst

```bash
oneuptime context current
```

Viser den aktive konteksten, inkludert instans-URL og maskert API-nøkkel.

### Slett en kontekst

```bash
oneuptime context delete <name>
```

Fjern en navngitt kontekst. Hvis den slettede konteksten er den gjeldende, bytter CLI automatisk til den første gjenværende konteksten.

## Oppløsning av legitimasjon

Legitimasjon løses i følgende prioritetsrekkefølge:

1. **CLI-flagg** (`--api-key` og `--url`)
2. **Miljøvariabler** (`ONEUPTIME_API_KEY` og `ONEUPTIME_URL`)
3. **Navngitt kontekst** (via `--context`-flagget)
4. **Gjeldende kontekst** (fra lagret konfigurasjon)

Du kan blande kilder – for eksempel bruke en miljøvariabel for API-nøkkelen og en lagret kontekst for URL-en.

### Bruke CLI-flagg

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Bruke miljøvariabler

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Bruke en spesifikk kontekst

```bash
oneuptime --context production incident list
```

## Bekreft autentisering

Sjekk gjeldende autentiseringsstatus:

```bash
oneuptime whoami
```

Dette viser:
- Instans-URL
- Maskert API-nøkkel
- Gjeldende kontekstnavn (vises kun hvis en lagret kontekst er aktiv)

Hvis du ikke er autentisert, viser kommandoen en nyttig melding som foreslår å kjøre `oneuptime login`.

## Konfigurasjonsfil

Legitimasjon lagres i `~/.oneuptime/config.json` med begrensede tillatelser (`0600`).

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
