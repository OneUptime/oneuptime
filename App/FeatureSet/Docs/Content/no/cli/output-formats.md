# Utdataformater

OneUptime CLI støtter tre utdataformater: **tabell**, **JSON** og **bred**. Du kan angi formatet med flagget `-o` eller `--output` på alle kommandoer.

## Tabell (standard)

Standardformatet ved kjøring i en interaktiv terminal. Viser resultater som en ASCII-tabell med intelligent valgte kolonner.

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

Tabelformat-atferd:

- Velger opptil 6 kolonner, prioritert: `_id`, `name`, `title`, `createdAt`, `updatedAt`
- Avkorter verdier lengre enn 60 tegn med `...`
- Bruker fargekodede overskrifter (deaktiver med `--no-color`)

## JSON

Rå JSON-utdata, fint formatert med 2-mellomroms innrykk. Dette er det beste formatet for skripting og rørlegging til andre verktøy.

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

JSON-format brukes automatisk når utdataene rørlegges til en annen kommando (ikke-TTY-modus):

```bash
# JSON brukes automatisk ved rørlegging
oneuptime incident list | jq '.[].title'
```

## Bred

Viser alle kolonner uten avkorting. Nyttig for detaljert inspeksjon, men kan gi svært brede utdata.

```bash
oneuptime incident list -o wide
```

## Deaktivere farger

Fargeutdata kan deaktiveres på flere måter:

```bash
# Bruke flagget --no-color
oneuptime --no-color incident list

# Bruke miljøvariabelen NO_COLOR
NO_COLOR=1 oneuptime incident list
```

## Spesielle utdatatilfeller

| Scenario                     | Utdata                    |
| ---------------------------- | ------------------------- |
| Tomt resultatsett            | `"No results found."`     |
| Ingen data returnert         | `"No data returned."`     |
| Enkelt objekt (f.eks. `get`) | Nøkkel-verdi-tabellformat |
| `count`-kommando             | Enkel numerisk verdi      |
