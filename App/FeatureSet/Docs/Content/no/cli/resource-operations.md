# Ressursoperasjoner

OneUptime CLI tilbyr full CRUD (Opprett, Les, Oppdater, Slett) for alle støttede ressurser. Ressurser oppdages automatisk fra OneUptime-instansen din.

## Tilgjengelige ressurser

Kjør følgende kommando for å se alle tilgjengelige ressurstyper:

```bash
oneuptime resources
```

Du kan filtrere etter type:

```bash
# Vis kun databaseressurser
oneuptime resources --type database

# Vis kun analyseressurser
oneuptime resources --type analytics
```

Vanlige ressurser inkluderer:

| Ressurs | Kommando |
|---------|---------|
| Incident | `oneuptime incident` |
| Alert | `oneuptime alert` |
| Monitor | `oneuptime monitor` |
| Monitor Status | `oneuptime monitor-status` |
| Incident State | `oneuptime incident-state` |
| Status Page | `oneuptime status-page` |
| On-Call Policy | `oneuptime on-call-policy` |
| Team | `oneuptime team` |
| Scheduled Maintenance Event | `oneuptime scheduled-maintenance-event` |

## List ressurser

Hent en liste over ressurser med valgfri filtrering, paginering og sortering.

```bash
oneuptime <resource> list [options]
```

**Alternativer:**

| Alternativ | Beskrivelse | Standard |
|------------|-------------|----------|
| `--query <json>` | Filterkriterier som JSON | Ingen |
| `--limit <n>` | Maksimalt antall resultater | `10` |
| `--skip <n>` | Antall resultater som skal hoppes over | `0` |
| `--sort <json>` | Sorteringsrekkefølge som JSON | Ingen |
| `-o, --output <format>` | Utdataformat | `table` |

**Eksempler:**

```bash
# List de 10 siste hendelsene
oneuptime incident list

# Filtrer hendelser etter tilstands-ID
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# List med paginering
oneuptime incident list --limit 20 --skip 40

# Sorter etter opprettelsesdato (synkende)
oneuptime incident list --sort '{"createdAt":-1}'

# Utdata som JSON
oneuptime incident list -o json
```

## Hent en ressurs

Hent en enkelt ressurs etter ID.

```bash
oneuptime <resource> get <id>
```

**Argumenter:**

| Argument | Beskrivelse |
|----------|-------------|
| `<id>` | Ressurs-ID-en (UUID) |

**Eksempler:**

```bash
# Hent en spesifikk hendelse
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Hent en monitor som JSON
oneuptime monitor get abc-123 -o json
```

## Opprett en ressurs

Opprett en ny ressurs fra innebygd JSON eller en fil.

```bash
oneuptime <resource> create [options]
```

**Alternativer:**

| Alternativ | Beskrivelse |
|------------|-------------|
| `--data <json>` | Ressursdata som et JSON-objekt |
| `--file <path>` | Sti til en JSON-fil med ressursdata |
| `-o, --output <format>` | Utdataformat |

Du må oppgi enten `--data` eller `--file`.

**Eksempler:**

```bash
# Opprett en hendelse med innebygd JSON
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Opprett fra en JSON-fil
oneuptime incident create --file incident.json

# Opprett og skriv ut som JSON for å fange ID-en
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Oppdater en ressurs

Oppdater en eksisterende ressurs etter ID.

```bash
oneuptime <resource> update <id> [options]
```

**Argumenter:**

| Argument | Beskrivelse |
|----------|-------------|
| `<id>` | Ressurs-ID-en |

**Alternativer:**

| Alternativ | Beskrivelse |
|------------|-------------|
| `--data <json>` | Felt som skal oppdateres som JSON (påkrevd) |
| `-o, --output <format>` | Utdataformat |

**Eksempler:**

```bash
# Endre hendelsestilstand (f.eks. til løst)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Endre navn på en monitor
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Slett en ressurs

Slett en ressurs etter ID.

```bash
oneuptime <resource> delete <id> [--force]
```

**Argumenter:**

| Argument | Beskrivelse |
|----------|-------------|
| `<id>` | Ressurs-ID-en |

**Alternativer:**

| Alternativ | Beskrivelse |
|------------|-------------|
| `--force` | Hopp over bekreftelsesprompten |

**Eksempler:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Hopp over bekreftelse
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Tell ressurser

Tell ressurser som matcher valgfrie filterkriterier.

```bash
oneuptime <resource> count [options]
```

**Alternativer:**

| Alternativ | Beskrivelse |
|------------|-------------|
| `--query <json>` | Filterkriterier som JSON |

**Eksempler:**

```bash
# Tell alle hendelser
oneuptime incident count

# Tell hendelser etter tilstand
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Tell monitorer
oneuptime monitor count
```

## Analyseressurser

Analyseressurser støtter et begrenset sett med operasjoner sammenlignet med databaseressurser:

| Operasjon | Støttet |
|-----------|---------|
| `list` | Ja |
| `create` | Ja |
| `count` | Ja |
| `get` | Nei |
| `update` | Nei |
| `delete` | Nei |

Bruk `oneuptime resources --type analytics` for å se hvilke analyseressurser som er tilgjengelige på instansen din.
