# OneUptime CLI

OneUptime CLI er et kommandolinjegrensesnitt for å administrere OneUptime-ressursene dine direkte fra terminalen. Det støtter full CRUD-operasjoner på monitorer, hendelser, varsler, statussider og mer.

## Funksjoner

- **Støtte for flere miljøer** med navngitte kontekster for produksjon, staging og utvikling
- **Automatisk oppdagelse** av tilgjengelige ressurser fra OneUptime-instansen din
- **Fleksibel autentisering** via CLI-flagg, miljøvariabler eller lagrede kontekster
- **Smart utdataformatering** med JSON-, tabell- og bred visningsmodus
- **Skriptbart** for CI/CD-pipelines og automatiseringsarbeidsflyter

## Installasjon

```bash
npm install -g @oneuptime/cli
```

## Rask start

```bash
# Autentiser med OneUptime-instansen din
oneuptime login <your-api-key> https://oneuptime.com

# List monitorene dine
oneuptime monitor list

# Vis en spesifikk hendelse
oneuptime incident get <incident-id>

# Se alle tilgjengelige ressurser
oneuptime resources
```

## Dokumentasjon

| Veiledning | Beskrivelse |
|------------|-------------|
| [Autentisering](./authentication.md) | Innlogging, kontekster og legitimasjonshåndtering |
| [Ressursoperasjoner](./resource-operations.md) | CRUD-operasjoner på monitorer, hendelser, varsler og mer |
| [Utdataformater](./output-formats.md) | JSON-, tabell- og bred utdatamodus |
| [Skripting og CI/CD](./scripting.md) | Automatisering, miljøvariabler og pipeline-bruk |
| [Kommandoreferanse](./command-reference.md) | Fullstendig referanse for alle kommandoer og alternativer |

## Globale alternativer

Disse flaggene kan brukes med alle kommandoer:

| Flagg | Beskrivelse |
|-------|-------------|
| `--api-key <key>` | Overstyr API-nøkkel for denne kommandoen |
| `--url <url>` | Overstyr instans-URL for denne kommandoen |
| `--context <name>` | Bruk en spesifikk navngitt kontekst |
| `-o, --output <format>` | Utdataformat: `json`, `table`, `wide` |
| `--no-color` | Deaktiver farget utdata |
| `--help` | Vis kommandohjelp |
| `--version` | Vis CLI-versjon |

## Få hjelp

```bash
# Generell hjelp
oneuptime --help

# Hjelp for en spesifikk kommando
oneuptime monitor --help
oneuptime monitor list --help
```
