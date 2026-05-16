# Utdataformat

OneUptime CLI stöder tre utdataformat: **tabell**, **JSON** och **bred**. Du kan ange formatet med flaggorna `-o` eller `--output` på vilket kommando som helst.

## Tabell (standard)

Standardformatet vid körning i en interaktiv terminal. Visar resultat som en ASCII-tabell med intelligent valda kolumner.

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

Tabellformatets beteende:
- Väljer upp till 6 kolumner, prioriterar: `_id`, `name`, `title`, `createdAt`, `updatedAt`
- Trunkerar värden längre än 60 tecken med `...`
- Använder färgkodade rubriker (inaktivera med `--no-color`)

## JSON

Rå JSON-utdata, snyggt formaterad med 2 mellanslags indragning. Detta är det bästa formatet för skriptning och vidarebefordran till andra verktyg.

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

JSON-format används automatiskt när utdata skickas till ett annat kommando (icke-TTY-läge):

```bash
# JSON används automatiskt vid vidarebefordran
oneuptime incident list | jq '.[].title'
```

## Bred

Visar alla kolumner utan trunkering. Användbart för detaljerad granskning men kan producera mycket bred utdata.

```bash
oneuptime incident list -o wide
```

## Inaktivera färg

Färgutdata kan inaktiveras på flera sätt:

```bash
# Använda --no-color-flaggan
oneuptime --no-color incident list

# Använda NO_COLOR-miljövariabeln
NO_COLOR=1 oneuptime incident list
```

## Särskilda utdatafall

| Scenario | Utdata |
|----------|--------|
| Tomt resultatset | `"No results found."` |
| Ingen data returnerad | `"No data returned."` |
| Enskilt objekt (t.ex. `get`) | Nyckel-värde-tabellformat |
| `count`-kommando | Enkelt numeriskt värde |
