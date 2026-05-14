# Ausgabeformate

Die OneUptime CLI unterstützt drei Ausgabeformate: **table**, **JSON** und **wide**. Das Format lässt sich mit dem Flag `-o` oder `--output` bei jedem Befehl festlegen.

## Tabelle (Standard)

Das Standardformat bei der Ausführung in einem interaktiven Terminal. Zeigt Ergebnisse als ASCII-Tabelle mit intelligent ausgewählten Spalten an.

```bash
oneuptime incident list
```

```
┌──────────────────┬───────────────────────┬─────────────────────┬─────────────────────┐
│ _id              │ title                 │ createdAt           │ updatedAt           │
├──────────────────┼───────────────────────┼─────────────────────┼─────────────────────┤
│ abc-123          │ API Outage            │ 2025-01-15T10:30:00 │ 2025-01-15T12:00:00 │
│ def-456          │ Database Slowdown     │ 2025-01-14T08:15:00 │ 2025-01-14T09:30:00 │
└──────────────────┴───────────────────────┴─────────────────────┴─────────────────────┘
```

Verhalten des Tabellenformats:
- Wählt bis zu 6 Spalten aus, priorisiert: `_id`, `name`, `title`, `createdAt`, `updatedAt`
- Kürzt Werte, die länger als 60 Zeichen sind, mit `...`
- Verwendet farblich hervorgehobene Überschriften (mit `--no-color` deaktivierbar)

## JSON

Rohe JSON-Ausgabe, hübsch formatiert mit 2-Leerzeichen-Einrückung. Dies ist das beste Format für Skripte und die Weiterleitung an andere Tools.

```bash
oneuptime incident list -o json
```

```json
[
  {
    "_id": "abc-123",
    "title": "API Outage",
    "currentIncidentStateId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-01-15T10:30:00Z"
  }
]
```

Das JSON-Format wird automatisch verwendet, wenn die Ausgabe an einen anderen Befehl weitergeleitet wird (Nicht-TTY-Modus):

```bash
# JSON wird beim Weiterleiten automatisch verwendet
oneuptime incident list | jq '.[].title'
```

## Wide

Zeigt alle Spalten ohne Kürzung an. Nützlich zur detaillierten Überprüfung, kann aber sehr breite Ausgaben erzeugen.

```bash
oneuptime incident list -o wide
```

## Farbige Ausgabe deaktivieren

Die farbige Ausgabe kann auf verschiedene Arten deaktiviert werden:

```bash
# Über das Flag --no-color
oneuptime --no-color incident list

# Über die Umgebungsvariable NO_COLOR
NO_COLOR=1 oneuptime incident list
```

## Spezielle Ausgabefälle

| Szenario | Ausgabe |
|----------|--------|
| Leeres Ergebnisset | `"No results found."` |
| Keine Daten zurückgegeben | `"No data returned."` |
| Einzelnes Objekt (z. B. `get`) | Schlüssel-Wert-Tabellenformat |
| `count`-Befehl | Einfacher numerischer Wert |
