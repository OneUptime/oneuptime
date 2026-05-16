# Befehlsreferenz

Vollständige Referenz für alle OneUptime CLI-Befehle.

## Authentifizierungsbefehle

### `oneuptime login`

Mit einer OneUptime-Instanz authentifizieren.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|------|----------|-------------|
| `<api-key>` | Argument | Ja | API-Schlüssel zur Authentifizierung |
| `<instance-url>` | Argument | Ja | OneUptime-Instanz-URL |
| `--context-name` | Option | Nein | Kontextname (Standard: `"default"`) |

---

### `oneuptime context list`

Alle gespeicherten Kontexte auflisten.

```bash
oneuptime context list
```

---

### `oneuptime context use`

Zu einem benannten Kontext wechseln.

```bash
oneuptime context use <name>
```

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|------|----------|-------------|
| `<name>` | Argument | Ja | Zu aktivierender Kontextname |

---

### `oneuptime context current`

Den aktiven Kontext mit maskiertem API-Schlüssel anzeigen.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

Einen gespeicherten Kontext entfernen.

```bash
oneuptime context delete <name>
```

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|------|----------|-------------|
| `<name>` | Argument | Ja | Zu löschender Kontextname |

---

## Ressourcenbefehle

Alle Ressourcenbefehle folgen demselben Muster. Ersetzen Sie `<resource>` durch einen beliebigen unterstützten Ressourcennamen (z. B. `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

Ressourcen mit Filterung und Paginierung auflisten.

```bash
oneuptime <resource> list [options]
```

| Option | Typ | Standard | Beschreibung |
|--------|------|---------|-------------|
| `--query <json>` | Zeichenkette | Keiner | Filterkriterien als JSON |
| `--limit <n>` | Zahl | `10` | Maximale Ergebnisse |
| `--skip <n>` | Zahl | `0` | Zu überspringende Ergebnisse |
| `--sort <json>` | Zeichenkette | Keiner | Sortierreihenfolge als JSON |
| `-o, --output` | Zeichenkette | `table` | Ausgabeformat |

---

### `oneuptime <resource> get`

Eine einzelne Ressource nach ID abrufen.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|------|----------|-------------|
| `<id>` | Argument | Ja | Ressourcen-ID (UUID) |
| `-o, --output` | Option | Nein | Ausgabeformat |

---

### `oneuptime <resource> create`

Eine neue Ressource erstellen.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Option | Typ | Erforderlich | Beschreibung |
|--------|------|----------|-------------|
| `--data <json>` | Zeichenkette | Eines von `--data` oder `--file` | Ressourcendaten als JSON |
| `--file <path>` | Zeichenkette | Eines von `--data` oder `--file` | Pfad zur JSON-Datei |
| `-o, --output` | Zeichenkette | Nein | Ausgabeformat |

---

### `oneuptime <resource> update`

Eine vorhandene Ressource aktualisieren.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|------|----------|-------------|
| `<id>` | Argument | Ja | Ressourcen-ID |
| `--data <json>` | Option | Ja | Zu aktualisierende Felder als JSON |
| `-o, --output` | Option | Nein | Ausgabeformat |

---

### `oneuptime <resource> delete`

Eine Ressource löschen.

```bash
oneuptime <resource> delete <id> [--force]
```

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|------|----------|-------------|
| `<id>` | Argument | Ja | Ressourcen-ID |
| `--force` | Option | Nein | Bestätigungsaufforderung überspringen |

---

### `oneuptime <resource> count`

Ressourcen zählen, die einem Filter entsprechen.

```bash
oneuptime <resource> count [--query <json>]
```

| Option | Typ | Standard | Beschreibung |
|--------|------|---------|-------------|
| `--query <json>` | Zeichenkette | Keiner | Filterkriterien als JSON |

---

## Hilfsbefehle

### `oneuptime version`

Die CLI-Version anzeigen.

```bash
oneuptime version
```

---

### `oneuptime whoami`

Aktuelle Authentifizierungsdetails anzeigen.

```bash
oneuptime whoami
```

Zeigt die Instanz-URL und den maskierten API-Schlüssel an. Wenn ein gespeicherter Kontext aktiv ist, wird auch der Kontextname angezeigt.

---

### `oneuptime resources`

Alle verfügbaren Ressourcentypen auflisten.

```bash
oneuptime resources [--type <type>]
```

| Option | Typ | Standard | Beschreibung |
|--------|------|---------|-------------|
| `--type <type>` | Zeichenkette | Keiner | Nach `database` oder `analytics` filtern |

---

## Globale Optionen

Diese Flags sind für alle Befehle verfügbar:

| Option | Beschreibung |
|--------|-------------|
| `--api-key <key>` | API-Schlüssel überschreiben |
| `--url <url>` | Instanz-URL überschreiben |
| `--context <name>` | Einen spezifischen Kontext verwenden |
| `-o, --output <format>` | Ausgabeformat: `json`, `table`, `wide` |
| `--no-color` | Farbige Ausgabe deaktivieren |
| `--help` | Hilfe anzeigen |
| `--version` | Version anzeigen |

## API-Routen

Als Referenz ordnet die CLI Befehle diesen API-Endpunkten zu:

| Befehl | Methode | Endpunkt |
|---------|--------|----------|
| `list` | POST | `/api/<resource>/get-list` |
| `get` | POST | `/api/<resource>/<id>/get-item` |
| `create` | POST | `/api/<resource>` |
| `update` | PUT | `/api/<resource>/<id>/` |
| `delete` | DELETE | `/api/<resource>/<id>/` |
| `count` | POST | `/api/<resource>/count` |

Alle Anfragen enthalten den `APIKey`-Header zur Authentifizierung.
