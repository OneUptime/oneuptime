# OneUptime CLI

De OneUptime CLI is een opdrachtregelinterface voor het beheren van uw OneUptime-resources rechtstreeks vanuit de terminal. Hij ondersteunt volledige CRUD-bewerkingen voor monitors, incidenten, meldingen, statuspagina's en meer.

## Functies

- **Ondersteuning voor meerdere omgevingen** met benoemde contexten voor productie, staging en ontwikkeling
- **Automatische detectie** van beschikbare resources van uw OneUptime-instantie
- **Flexibele authenticatie** via CLI-vlaggen, omgevingsvariabelen of opgeslagen contexten
- **Slimme uitvoerformattering** met JSON-, tabel- en brede weergavemodi
- **Scriptbaar** voor CI/CD-pipelines en automatiseringsworkflows

## Installatie

```bash
npm install -g @oneuptime/cli
```

## Snel starten

```bash
# Authenticeren bij uw OneUptime-instantie
oneuptime login <your-api-key> https://oneuptime.com

# Uw monitors weergeven
oneuptime monitor list

# Een specifiek incident bekijken
oneuptime incident get <incident-id>

# Alle beschikbare resources bekijken
oneuptime resources
```

## Documentatie

| Handleiding | Beschrijving |
|-------|-------------|
| [Authenticatie](./authentication.md) | Inloggen, contexten en beheer van inloggegevens |
| [Resourcebewerkingen](./resource-operations.md) | CRUD-bewerkingen voor monitors, incidenten, meldingen en meer |
| [Uitvoerformaten](./output-formats.md) | JSON-, tabel- en brede uitvoermodi |
| [Scripting en CI/CD](./scripting.md) | Automatisering, omgevingsvariabelen en pipelinegebruik |
| [Opdrachtenoverzicht](./command-reference.md) | Volledig overzicht van alle opdrachten en opties |

## Globale opties

Deze vlaggen kunnen met elke opdracht worden gebruikt:

| Vlag | Beschrijving |
|------|-------------|
| `--api-key <key>` | API-sleutel overschrijven voor deze opdracht |
| `--url <url>` | Instantie-URL overschrijven voor deze opdracht |
| `--context <name>` | Een specifieke benoemde context gebruiken |
| `-o, --output <format>` | Uitvoerformaat: `json`, `table`, `wide` |
| `--no-color` | Gekleurde uitvoer uitschakelen |
| `--help` | Opdrachthulp weergeven |
| `--version` | CLI-versie weergeven |

## Hulp krijgen

```bash
# Algemene hulp
oneuptime --help

# Hulp voor een specifieke opdracht
oneuptime monitor --help
oneuptime monitor list --help
```
