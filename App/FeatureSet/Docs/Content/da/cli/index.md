# OneUptime CLI

OneUptime CLI er en kommandolinjegrænseflade til administration af dine OneUptime-ressourcer direkte fra terminalen. Den understøtter fulde CRUD-operationer på monitorer, incidents, alerts, statussider og meget mere.

## Funktioner

- **Understøttelse af flere miljøer** med navngivne kontekster til produktion, staging og udvikling
- **Auto-discovery** af tilgængelige ressourcer fra din OneUptime-instans
- **Fleksibel autentificering** via CLI-flag, miljøvariabler eller gemte kontekster
- **Smart outputformatering** med JSON-, tabel- og wide-visningstilstande
- **Scriptbar** til CI/CD-pipelines og automatiseringsarbejdsgange

## Installation

```bash
npm install -g @oneuptime/cli
```

## Hurtig start

```bash
# Autentificer med din OneUptime-instans
oneuptime login <your-api-key> https://oneuptime.com

# List dine monitorer
oneuptime monitor list

# Se et specifikt incident
oneuptime incident get <incident-id>

# Se alle tilgængelige ressourcer
oneuptime resources
```

## Dokumentation

| Guide | Beskrivelse |
|-------|-------------|
| [Autentificering](./authentication.md) | Login, kontekster og administration af legitimationsoplysninger |
| [Ressourceoperationer](./resource-operations.md) | CRUD-operationer på monitorer, incidents, alerts og mere |
| [Outputformater](./output-formats.md) | JSON-, tabel- og wide-outputtilstande |
| [Scripting og CI/CD](./scripting.md) | Automatisering, miljøvariabler og pipeline-brug |
| [Kommandoreference](./command-reference.md) | Komplet reference til alle kommandoer og indstillinger |

## Globale indstillinger

Disse flag kan bruges med enhver kommando:

| Flag | Beskrivelse |
|------|-------------|
| `--api-key <key>` | Tilsidesæt API-nøgle for denne kommando |
| `--url <url>` | Tilsidesæt instans-URL for denne kommando |
| `--context <name>` | Brug en specifik navngivet kontekst |
| `-o, --output <format>` | Outputformat: `json`, `table`, `wide` |
| `--no-color` | Deaktiver farvet output |
| `--help` | Vis kommandohjælp |
| `--version` | Vis CLI-version |

## Få hjælp

```bash
# Generel hjælp
oneuptime --help

# Hjælp til en specifik kommando
oneuptime monitor --help
oneuptime monitor list --help
```
