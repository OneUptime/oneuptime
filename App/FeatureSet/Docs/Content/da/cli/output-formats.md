# Outputformater

OneUptime CLI understøtter tre outputformater: **tabel**, **JSON** og **wide**. Du kan angive formatet med `-o`- eller `--output`-flag på enhver kommando.

## Tabel (standard)

Standardformatet, når det kører i en interaktiv terminal. Viser resultater som en ASCII-tabel med intelligent valgte kolonner.

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

Tabelformatets adfærd:
- Vælger op til 6 kolonner med prioritering af: `_id`, `name`, `title`, `createdAt`, `updatedAt`
- Afskærer værdier længere end 60 tegn med `...`
- Bruger farvekodede overskrifter (deaktiver med `--no-color`)

## JSON

Råt JSON-output, pænt formateret med 2-tegns indrykning. Dette er det bedste format til scripting og piping til andre værktøjer.

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

JSON-formatet bruges automatisk, når outputtet sendes til en anden kommando (ikke-TTY-tilstand):

```bash
# JSON bruges automatisk ved piping
oneuptime incident list | jq '.[].title'
```

## Wide

Viser alle kolonner uden afskæring. Nyttigt til detaljeret inspektion, men kan producere meget bredt output.

```bash
oneuptime incident list -o wide
```

## Deaktivering af farver

Farveoutput kan deaktiveres på flere måder:

```bash
# Brug af --no-color-flag
oneuptime --no-color incident list

# Brug af NO_COLOR-miljøvariablen
NO_COLOR=1 oneuptime incident list
```

## Specielle outputtilfælde

| Scenarie | Output |
|----------|--------|
| Tomt resultatsæt | `"No results found."` |
| Ingen data returneret | `"No data returned."` |
| Enkelt objekt (f.eks. `get`) | Nøgle-værdi-tabelformat |
| `count`-kommando | Simpel numerisk værdi |
