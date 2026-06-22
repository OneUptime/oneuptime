# Formati di Output

La CLI di OneUptime supporta tre formati di output: **tabella**, **JSON** e **wide**. Puoi impostare il formato con il flag `-o` o `--output` su qualsiasi comando.

## Tabella (Predefinito)

Il formato predefinito quando si esegue in un terminale interattivo. Mostra i risultati come una tabella ASCII con colonne selezionate in modo intelligente.

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

Comportamento del formato tabella:

- Seleziona fino a 6 colonne, dando priorità a: `_id`, `name`, `title`, `createdAt`, `updatedAt`
- Tronca i valori più lunghi di 60 caratteri con `...`
- Usa intestazioni con codice colore (disabilita con `--no-color`)

## JSON

Output JSON grezzo, stampato in modo leggibile con indentazione a 2 spazi. Questo è il formato migliore per script e piping ad altri strumenti.

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

Il formato JSON viene usato automaticamente quando l'output è reindirizzato a un altro comando (modalità non-TTY):

```bash
# JSON è usato automaticamente quando si fa piping
oneuptime incident list | jq '.[].title'
```

## Wide

Mostra tutte le colonne senza troncamento. Utile per ispezioni dettagliate, ma può produrre un output molto largo.

```bash
oneuptime incident list -o wide
```

## Disabilitare i Colori

L'output colorato può essere disabilitato in diversi modi:

```bash
# Usando il flag --no-color
oneuptime --no-color incident list

# Usando la variabile d'ambiente NO_COLOR
NO_COLOR=1 oneuptime incident list
```

## Casi di Output Speciali

| Scenario                    | Output                        |
| --------------------------- | ----------------------------- |
| Insieme di risultati vuoto  | `"No results found."`         |
| Nessun dato restituito      | `"No data returned."`         |
| Oggetto singolo (es. `get`) | Formato tabella chiave-valore |
| Comando `count`             | Valore numerico semplice      |
