# Resursoperationer

OneUptime CLI erbjuder fullständiga CRUD-operationer (Skapa, Läs, Uppdatera, Ta bort) för alla resurser som stöds. Resurser identifieras automatiskt från din OneUptime-instans.

## Tillgängliga resurser

Kör följande kommando för att se alla tillgängliga resurstyper:

```bash
oneuptime resources
```

Du kan filtrera efter typ:

```bash
# Visa bara databasresurser
oneuptime resources --type database

# Visa bara analysresurser
oneuptime resources --type analytics
```

Vanliga resurser inkluderar:

| Resurs                   | Kommando                                |
| ------------------------ | --------------------------------------- |
| Incident                 | `oneuptime incident`                    |
| Varning                  | `oneuptime alert`                       |
| Monitor                  | `oneuptime monitor`                     |
| Monitorstatus            | `oneuptime monitor-status`              |
| Incidenttillstånd        | `oneuptime incident-state`              |
| Statussida               | `oneuptime status-page`                 |
| Jour-policy              | `oneuptime on-call-policy`              |
| Team                     | `oneuptime team`                        |
| Planerat underhållsevent | `oneuptime scheduled-maintenance-event` |

## Lista resurser

Hämta en lista med resurser med valfri filtrering, sidnumrering och sortering.

```bash
oneuptime <resource> list [options]
```

**Alternativ:**

| Alternativ              | Beskrivning                   | Standard |
| ----------------------- | ----------------------------- | -------- |
| `--query <json>`        | Filterkriterier som JSON      | Inget    |
| `--limit <n>`           | Maximalt antal resultat       | `10`     |
| `--skip <n>`            | Antal resultat att hoppa över | `0`      |
| `--sort <json>`         | Sorteringsordning som JSON    | Inget    |
| `-o, --output <format>` | Utdataformat                  | `table`  |

**Exempel:**

```bash
# Lista de 10 senaste incidenterna
oneuptime incident list

# Filtrera incidenter efter tillstånds-ID
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# Lista med sidnumrering
oneuptime incident list --limit 20 --skip 40

# Sortera efter skapandedatum (fallande)
oneuptime incident list --sort '{"createdAt":-1}'

# Utdata som JSON
oneuptime incident list -o json
```

## Hämta en resurs

Hämta en enskild resurs med dess ID.

```bash
oneuptime <resource> get <id>
```

**Argument:**

| Argument | Beskrivning        |
| -------- | ------------------ |
| `<id>`   | Resurs-ID:t (UUID) |

**Exempel:**

```bash
# Hämta en specifik incident
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Hämta en monitor som JSON
oneuptime monitor get abc-123 -o json
```

## Skapa en resurs

Skapa en ny resurs från inline-JSON eller en fil.

```bash
oneuptime <resource> create [options]
```

**Alternativ:**

| Alternativ              | Beskrivning                                       |
| ----------------------- | ------------------------------------------------- |
| `--data <json>`         | Resursdata som ett JSON-objekt                    |
| `--file <path>`         | Sökväg till en JSON-fil som innehåller resursdata |
| `-o, --output <format>` | Utdataformat                                      |

Du måste ange antingen `--data` eller `--file`.

**Exempel:**

```bash
# Skapa en incident med inline-JSON
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Skapa från en JSON-fil
oneuptime incident create --file incident.json

# Skapa och utdata som JSON för att fånga ID:t
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Uppdatera en resurs

Uppdatera en befintlig resurs med ID.

```bash
oneuptime <resource> update <id> [options]
```

**Argument:**

| Argument | Beskrivning |
| -------- | ----------- |
| `<id>`   | Resurs-ID:t |

**Alternativ:**

| Alternativ              | Beskrivning                                |
| ----------------------- | ------------------------------------------ |
| `--data <json>`         | Fält att uppdatera som JSON (obligatorisk) |
| `-o, --output <format>` | Utdataformat                               |

**Exempel:**

```bash
# Ändra incidenttillstånd (t.ex. till löst)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Byt namn på en monitor
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Ta bort en resurs

Ta bort en resurs med ID.

```bash
oneuptime <resource> delete <id> [--force]
```

**Argument:**

| Argument | Beskrivning |
| -------- | ----------- |
| `<id>`   | Resurs-ID:t |

**Alternativ:**

| Alternativ | Beskrivning                  |
| ---------- | ---------------------------- |
| `--force`  | Hoppa över bekräftelseprompt |

**Exempel:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Hoppa över bekräftelse
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Räkna resurser

Räkna resurser som matchar valfria filterkriterier.

```bash
oneuptime <resource> count [options]
```

**Alternativ:**

| Alternativ       | Beskrivning              |
| ---------------- | ------------------------ |
| `--query <json>` | Filterkriterier som JSON |

**Exempel:**

```bash
# Räkna alla incidenter
oneuptime incident count

# Räkna incidenter efter tillstånd
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Räkna monitorer
oneuptime monitor count
```

## Analysresurser

Analysresurser stöder en begränsad uppsättning operationer jämfört med databasresurser:

| Operation | Stöds |
| --------- | ----- |
| `list`    | Ja    |
| `create`  | Ja    |
| `count`   | Ja    |
| `get`     | Nej   |
| `update`  | Nej   |
| `delete`  | Nej   |

Använd `oneuptime resources --type analytics` för att se vilka analysresurser som är tillgängliga i din instans.
