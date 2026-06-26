# Resourcebewerkingen

De OneUptime CLI biedt volledige CRUD-bewerkingen (Aanmaken, Lezen, Bijwerken, Verwijderen) voor alle ondersteunde resources. Resources worden automatisch gedetecteerd van uw OneUptime-instantie.

## Beschikbare resources

Voer de volgende opdracht uit om alle beschikbare resourcetypen te bekijken:

```bash
oneuptime resources
```

U kunt filteren op type:

```bash
# Alleen databaseresources weergeven
oneuptime resources --type database

# Alleen analyticsresources weergeven
oneuptime resources --type analytics
```

Veelgebruikte resources zijn:

| Resource                      | Opdracht                                |
| ----------------------------- | --------------------------------------- |
| Incident                      | `oneuptime incident`                    |
| Melding                       | `oneuptime alert`                       |
| Monitor                       | `oneuptime monitor`                     |
| Monitorstatus                 | `oneuptime monitor-status`              |
| Incidentstatus                | `oneuptime incident-state`              |
| Statuspagina                  | `oneuptime status-page`                 |
| Piketbeleid                   | `oneuptime on-call-policy`              |
| Team                          | `oneuptime team`                        |
| Gepland onderhoudsgebeurtenis | `oneuptime scheduled-maintenance-event` |

## Resources weergeven

Haal een lijst van resources op met optioneel filteren, paginering en sortering.

```bash
oneuptime <resource> list [options]
```

**Opties:**

| Optie                   | Beschrijving                   | Standaard |
| ----------------------- | ------------------------------ | --------- |
| `--query <json>`        | Filtercriteria als JSON        | Geen      |
| `--limit <n>`           | Maximum aantal resultaten      | `10`      |
| `--skip <n>`            | Aantal te overslaan resultaten | `0`       |
| `--sort <json>`         | Sorteervolgorde als JSON       | Geen      |
| `-o, --output <format>` | Uitvoerformaat                 | `table`   |

**Voorbeelden:**

```bash
# De 10 meest recente incidenten weergeven
oneuptime incident list

# Incidenten filteren op status-ID
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# Weergeven met paginering
oneuptime incident list --limit 20 --skip 40

# Sorteren op aanmaakdatum (aflopend)
oneuptime incident list --sort '{"createdAt":-1}'

# Uitvoer als JSON
oneuptime incident list -o json
```

## Een resource ophalen

Haal één resource op aan de hand van het ID.

```bash
oneuptime <resource> get <id>
```

**Argumenten:**

| Argument | Beschrijving           |
| -------- | ---------------------- |
| `<id>`   | Het resource-ID (UUID) |

**Voorbeelden:**

```bash
# Een specifiek incident ophalen
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Een monitor ophalen als JSON
oneuptime monitor get abc-123 -o json
```

## Een resource aanmaken

Maak een nieuwe resource aan vanuit inline JSON of een bestand.

```bash
oneuptime <resource> create [options]
```

**Opties:**

| Optie                   | Beschrijving                                   |
| ----------------------- | ---------------------------------------------- |
| `--data <json>`         | Resourcegegevens als JSON-object               |
| `--file <path>`         | Pad naar een JSON-bestand met resourcegegevens |
| `-o, --output <format>` | Uitvoerformaat                                 |

U moet `--data` of `--file` opgeven.

**Voorbeelden:**

```bash
# Een incident aanmaken met inline JSON
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Aanmaken vanuit een JSON-bestand
oneuptime incident create --file incident.json

# Aanmaken en uitvoer als JSON om het ID te vast te leggen
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Een resource bijwerken

Werk een bestaande resource bij aan de hand van het ID.

```bash
oneuptime <resource> update <id> [options]
```

**Argumenten:**

| Argument | Beschrijving    |
| -------- | --------------- |
| `<id>`   | Het resource-ID |

**Opties:**

| Optie                   | Beschrijving                            |
| ----------------------- | --------------------------------------- |
| `--data <json>`         | Bij te werken velden als JSON (vereist) |
| `-o, --output <format>` | Uitvoerformaat                          |

**Voorbeelden:**

```bash
# Incidentstatus wijzigen (bijv. naar opgelost)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Een monitor hernoemen
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Een resource verwijderen

Verwijder een resource aan de hand van het ID.

```bash
oneuptime <resource> delete <id> [--force]
```

**Argumenten:**

| Argument | Beschrijving    |
| -------- | --------------- |
| `<id>`   | Het resource-ID |

**Opties:**

| Optie     | Beschrijving                 |
| --------- | ---------------------------- |
| `--force` | Bevestigingsprompt overslaan |

**Voorbeelden:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Bevestiging overslaan
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Resources tellen

Tel resources die voldoen aan optionele filtercriteria.

```bash
oneuptime <resource> count [options]
```

**Opties:**

| Optie            | Beschrijving            |
| ---------------- | ----------------------- |
| `--query <json>` | Filtercriteria als JSON |

**Voorbeelden:**

```bash
# Alle incidenten tellen
oneuptime incident count

# Incidenten tellen op status
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Monitors tellen
oneuptime monitor count
```

## Analyticsresources

Analyticsresources ondersteunen een beperkte set bewerkingen vergeleken met databaseresources:

| Bewerking | Ondersteund |
| --------- | ----------- |
| `list`    | Ja          |
| `create`  | Ja          |
| `count`   | Ja          |
| `get`     | Nee         |
| `update`  | Nee         |
| `delete`  | Nee         |

Gebruik `oneuptime resources --type analytics` om te zien welke analyticsresources beschikbaar zijn op uw instantie.
