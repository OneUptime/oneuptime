# Uitvoerformaten

De OneUptime CLI ondersteunt drie uitvoerformaten: **tabel**, **JSON** en **breed**. U kunt het formaat instellen met de `-o`- of `--output`-vlag bij elke opdracht.

## Tabel (standaard)

Het standaardformaat bij gebruik in een interactieve terminal. Geeft resultaten weer als een ASCII-tabel met intelligent geselecteerde kolommen.

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

Gedrag van het tabelformaat:
- Selecteert maximaal 6 kolommen, met prioriteit voor: `_id`, `name`, `title`, `createdAt`, `updatedAt`
- Afkappen van waarden langer dan 60 tekens met `...`
- Gebruikt kleurgecodeerde headers (uitschakelen met `--no-color`)

## JSON

Ruwe JSON-uitvoer, fraai opgemaakt met 2 spaties inspringing. Dit is het beste formaat voor scripting en doorsluizen naar andere tools.

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

JSON-formaat wordt automatisch gebruikt wanneer de uitvoer naar een andere opdracht wordt gesluisd (niet-TTY-modus):

```bash
# JSON wordt automatisch gebruikt bij doorsluizen
oneuptime incident list | jq '.[].title'
```

## Breed

Geeft alle kolommen weer zonder afkapping. Nuttig voor gedetailleerde inspectie, maar kan zeer brede uitvoer produceren.

```bash
oneuptime incident list -o wide
```

## Kleur uitschakelen

Gekleurde uitvoer kan op verschillende manieren worden uitgeschakeld:

```bash
# Met de --no-color-vlag
oneuptime --no-color incident list

# Met de NO_COLOR-omgevingsvariabele
NO_COLOR=1 oneuptime incident list
```

## Speciale uitvoergevallen

| Scenario | Uitvoer |
|----------|--------|
| Lege resultatenset | `"No results found."` |
| Geen gegevens geretourneerd | `"No data returned."` |
| Enkel object (bijv. `get`) | Sleutel-waarde-tabelformaat |
| `count`-opdracht | Enkelvoudige numerieke waarde |
