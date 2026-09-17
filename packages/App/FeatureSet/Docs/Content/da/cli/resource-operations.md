# Ressourceoperationer

OneUptime CLI leverer fulde CRUD-operationer (Opret, Læs, Opdater, Slet) for alle understøttede ressourcer. Ressourcer opdages automatisk fra din OneUptime-instans.

## Tilgængelige ressourcer

Kør følgende kommando for at se alle tilgængelige ressourcetyper:

```bash
oneuptime resources
```

Du kan filtrere efter type:

```bash
# Vis kun databaseressourcer
oneuptime resources --type database

# Vis kun analyticsressourcer
oneuptime resources --type analytics
```

Almindelige ressourcer inkluderer:

| Ressource                   | Kommando                                |
| --------------------------- | --------------------------------------- |
| Incident                    | `oneuptime incident`                    |
| Alert                       | `oneuptime alert`                       |
| Monitor                     | `oneuptime monitor`                     |
| Monitor Status              | `oneuptime monitor-status`              |
| Incident State              | `oneuptime incident-state`              |
| Status Page                 | `oneuptime status-page`                 |
| On-Call Policy              | `oneuptime on-call-policy`              |
| Team                        | `oneuptime team`                        |
| Scheduled Maintenance Event | `oneuptime scheduled-maintenance-event` |

## List ressourcer

Hent en liste over ressourcer med valgfri filtrering, paginering og sortering.

```bash
oneuptime <resource> list [options]
```

**Indstillinger:**

| Indstilling             | Beskrivelse                        | Standard |
| ----------------------- | ---------------------------------- | -------- |
| `--query <json>`        | Filterkriterier som JSON           | Ingen    |
| `--limit <n>`           | Maks. antal resultater             | `10`     |
| `--skip <n>`            | Antal resultater der springes over | `0`      |
| `--sort <json>`         | Sorteringsrækkefølge som JSON      | Ingen    |
| `-o, --output <format>` | Outputformat                       | `table`  |

**Eksempler:**

```bash
# List de 10 seneste incidents
oneuptime incident list

# Filtrer incidents efter tilstands-ID
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# List med paginering
oneuptime incident list --limit 20 --skip 40

# Sortér efter oprettelsesdato (faldende)
oneuptime incident list --sort '{"createdAt":-1}'

# Output som JSON
oneuptime incident list -o json
```

## Hent en ressource

Hent en enkelt ressource efter dens ID.

```bash
oneuptime <resource> get <id>
```

**Argumenter:**

| Argument | Beskrivelse            |
| -------- | ---------------------- |
| `<id>`   | Ressource-ID'et (UUID) |

**Eksempler:**

```bash
# Hent et specifikt incident
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Hent en monitor som JSON
oneuptime monitor get abc-123 -o json
```

## Opret en ressource

Opret en ny ressource fra inline JSON eller en fil.

```bash
oneuptime <resource> create [options]
```

**Indstillinger:**

| Indstilling             | Beskrivelse                           |
| ----------------------- | ------------------------------------- |
| `--data <json>`         | Ressourcedata som et JSON-objekt      |
| `--file <path>`         | Sti til en JSON-fil med ressourcedata |
| `-o, --output <format>` | Outputformat                          |

Du skal angive enten `--data` eller `--file`.

**Eksempler:**

```bash
# Opret et incident med inline JSON
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Opret fra en JSON-fil
oneuptime incident create --file incident.json

# Opret og output som JSON for at fange ID'et
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Opdater en ressource

Opdater en eksisterende ressource efter ID.

```bash
oneuptime <resource> update <id> [options]
```

**Argumenter:**

| Argument | Beskrivelse     |
| -------- | --------------- |
| `<id>`   | Ressource-ID'et |

**Indstillinger:**

| Indstilling             | Beskrivelse                                   |
| ----------------------- | --------------------------------------------- |
| `--data <json>`         | Felter der skal opdateres som JSON (påkrævet) |
| `-o, --output <format>` | Outputformat                                  |

**Eksempler:**

```bash
# Skift incidenttilstand (f.eks. til løst)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Omdøb en monitor
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Slet en ressource

Slet en ressource efter ID.

```bash
oneuptime <resource> delete <id> [--force]
```

**Argumenter:**

| Argument | Beskrivelse     |
| -------- | --------------- |
| `<id>`   | Ressource-ID'et |

**Indstillinger:**

| Indstilling | Beskrivelse                    |
| ----------- | ------------------------------ |
| `--force`   | Spring bekræftelsesprompt over |

**Eksempler:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Spring bekræftelse over
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Tæl ressourcer

Tæl ressourcer, der matcher valgfrie filterkriterier.

```bash
oneuptime <resource> count [options]
```

**Indstillinger:**

| Indstilling      | Beskrivelse              |
| ---------------- | ------------------------ |
| `--query <json>` | Filterkriterier som JSON |

**Eksempler:**

```bash
# Tæl alle incidents
oneuptime incident count

# Tæl incidents efter tilstand
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Tæl monitorer
oneuptime monitor count
```

## Analytics-ressourcer

Analytics-ressourcer understøtter et begrænset sæt af operationer sammenlignet med databaseressourcer:

| Operation | Understøttet |
| --------- | ------------ |
| `list`    | Ja           |
| `create`  | Ja           |
| `count`   | Ja           |
| `get`     | Nej          |
| `update`  | Nej          |
| `delete`  | Nej          |

Brug `oneuptime resources --type analytics` for at se, hvilke analytics-ressourcer der er tilgængelige på din instans.
