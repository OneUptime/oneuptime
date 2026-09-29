# OneUptime CLI

OneUptime CLI är ett kommandoradsgränssnitt för att hantera dina OneUptime-resurser direkt från terminalen. Det stöder fullständiga CRUD-operationer för monitorer, incidenter, varningar, statussidor och mer.

## Funktioner

- **Stöd för flera miljöer** med namngivna kontexter för produktion, staging och utveckling
- **Automatisk identifiering** av tillgängliga resurser från din OneUptime-instans
- **Flexibel autentisering** via CLI-flaggor, miljövariabler eller sparade kontexter
- **Smart utdataformatering** med JSON-, tabell- och bred visningsläge
- **Skriptbar** för CI/CD-pipelines och automatiseringsarbetsflöden

## Installation

```bash
npm install -g @oneuptime/cli
```

## Snabbstart

```bash
# Autentisera mot din OneUptime-instans
oneuptime login <your-api-key> https://oneuptime.com

# Lista dina monitorer
oneuptime monitor list

# Visa en specifik incident
oneuptime incident get <incident-id>

# Se alla tillgängliga resurser
oneuptime resources
```

## Dokumentation

| Guide                                         | Beskrivning                                                    |
| --------------------------------------------- | -------------------------------------------------------------- |
| [Autentisering](./authentication.md)          | Inloggning, kontexter och hantering av autentiseringsuppgifter |
| [Resursoperationer](./resource-operations.md) | CRUD-operationer för monitorer, incidenter, varningar och mer  |
| [Utdataformat](./output-formats.md)           | JSON-, tabell- och bred utdataläge                             |
| [Skriptning och CI/CD](./scripting.md)        | Automatisering, miljövariabler och pipelineanvändning          |
| [Kommandonreferens](./command-reference.md)   | Fullständig referens för alla kommandon och alternativ         |

## Globala alternativ

Dessa flaggor kan användas med vilket kommando som helst:

| Flagga                  | Beskrivning                              |
| ----------------------- | ---------------------------------------- |
| `--api-key <key>`       | Åsidosätt API-nyckel för detta kommando  |
| `--url <url>`           | Åsidosätt instans-URL för detta kommando |
| `--context <name>`      | Använd en specifik namngiven kontext     |
| `-o, --output <format>` | Utdataformat: `json`, `table`, `wide`    |
| `--no-color`            | Inaktivera färgad utdata                 |
| `--help`                | Visa kommandohjälp                       |
| `--version`             | Visa CLI-version                         |

## Få hjälp

```bash
# Allmän hjälp
oneuptime --help

# Hjälp för ett specifikt kommando
oneuptime monitor --help
oneuptime monitor list --help
```
