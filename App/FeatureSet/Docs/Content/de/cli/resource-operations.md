# Ressourcenvorgänge

Die OneUptime CLI bietet vollständige CRUD-Vorgänge (Erstellen, Lesen, Aktualisieren, Löschen) für alle unterstützten Ressourcen. Ressourcen werden automatisch aus Ihrer OneUptime-Instanz erkannt.

## Verfügbare Ressourcen

Führen Sie den folgenden Befehl aus, um alle verfügbaren Ressourcentypen anzuzeigen:

```bash
oneuptime resources
```

Sie können nach Typ filtern:

```bash
# Nur Datenbankressourcen anzeigen
oneuptime resources --type database

# Nur Analyseressourcen anzeigen
oneuptime resources --type analytics
```

Gängige Ressourcen umfassen:

| Ressource                   | Befehl                                  |
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

## Ressourcen auflisten

Rufen Sie eine Liste von Ressourcen mit optionaler Filterung, Paginierung und Sortierung ab.

```bash
oneuptime <resource> list [options]
```

**Optionen:**

| Option                  | Beschreibung                         | Standard |
| ----------------------- | ------------------------------------ | -------- |
| `--query <json>`        | Filterkriterien als JSON             | Keiner   |
| `--limit <n>`           | Maximale Anzahl von Ergebnissen      | `10`     |
| `--skip <n>`            | Anzahl zu überspringender Ergebnisse | `0`      |
| `--sort <json>`         | Sortierreihenfolge als JSON          | Keiner   |
| `-o, --output <format>` | Ausgabeformat                        | `table`  |

**Beispiele:**

```bash
# Die 10 neuesten Incidents auflisten
oneuptime incident list

# Incidents nach Status-ID filtern
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# Mit Paginierung auflisten
oneuptime incident list --limit 20 --skip 40

# Nach Erstellungsdatum sortieren (absteigend)
oneuptime incident list --sort '{"createdAt":-1}'

# Als JSON ausgeben
oneuptime incident list -o json
```

## Eine Ressource abrufen

Eine einzelne Ressource nach ihrer ID abrufen.

```bash
oneuptime <resource> get <id>
```

**Argumente:**

| Argument | Beschreibung             |
| -------- | ------------------------ |
| `<id>`   | Die Ressourcen-ID (UUID) |

**Beispiele:**

```bash
# Einen bestimmten Incident abrufen
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Einen Monitor als JSON abrufen
oneuptime monitor get abc-123 -o json
```

## Eine Ressource erstellen

Eine neue Ressource aus eingebettetem JSON oder einer Datei erstellen.

```bash
oneuptime <resource> create [options]
```

**Optionen:**

| Option                  | Beschreibung                                 |
| ----------------------- | -------------------------------------------- |
| `--data <json>`         | Ressourcendaten als JSON-Objekt              |
| `--file <path>`         | Pfad zu einer JSON-Datei mit Ressourcendaten |
| `-o, --output <format>` | Ausgabeformat                                |

Sie müssen entweder `--data` oder `--file` angeben.

**Beispiele:**

```bash
# Einen Incident mit eingebettetem JSON erstellen
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Aus einer JSON-Datei erstellen
oneuptime incident create --file incident.json

# Erstellen und als JSON ausgeben, um die ID zu erfassen
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Eine Ressource aktualisieren

Eine vorhandene Ressource nach ID aktualisieren.

```bash
oneuptime <resource> update <id> [options]
```

**Argumente:**

| Argument | Beschreibung      |
| -------- | ----------------- |
| `<id>`   | Die Ressourcen-ID |

**Optionen:**

| Option                  | Beschreibung                                      |
| ----------------------- | ------------------------------------------------- |
| `--data <json>`         | Zu aktualisierende Felder als JSON (erforderlich) |
| `-o, --output <format>` | Ausgabeformat                                     |

**Beispiele:**

```bash
# Incident-Status ändern (z. B. auf gelöst)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Einen Monitor umbenennen
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Eine Ressource löschen

Eine Ressource nach ID löschen.

```bash
oneuptime <resource> delete <id> [--force]
```

**Argumente:**

| Argument | Beschreibung      |
| -------- | ----------------- |
| `<id>`   | Die Ressourcen-ID |

**Optionen:**

| Option    | Beschreibung                          |
| --------- | ------------------------------------- |
| `--force` | Bestätigungsaufforderung überspringen |

**Beispiele:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Bestätigung überspringen
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Ressourcen zählen

Ressourcen zählen, die optionalen Filterkriterien entsprechen.

```bash
oneuptime <resource> count [options]
```

**Optionen:**

| Option           | Beschreibung             |
| ---------------- | ------------------------ |
| `--query <json>` | Filterkriterien als JSON |

**Beispiele:**

```bash
# Alle Incidents zählen
oneuptime incident count

# Incidents nach Status zählen
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Monitore zählen
oneuptime monitor count
```

## Analyseressourcen

Analyseressourcen unterstützen im Vergleich zu Datenbankressourcen einen eingeschränkten Satz von Vorgängen:

| Vorgang  | Unterstützt |
| -------- | ----------- |
| `list`   | Ja          |
| `create` | Ja          |
| `count`  | Ja          |
| `get`    | Nein        |
| `update` | Nein        |
| `delete` | Nein        |

Verwenden Sie `oneuptime resources --type analytics`, um zu sehen, welche Analyseressourcen auf Ihrer Instanz verfügbar sind.
