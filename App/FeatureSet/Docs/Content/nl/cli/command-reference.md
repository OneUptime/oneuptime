# Opdrachtenoverzicht

Volledig overzicht van alle OneUptime CLI-opdrachten.

## Authenticatieopdrachten

### `oneuptime login`

Authenticeer bij een OneUptime-instantie.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Parameter | Type | Vereist | Beschrijving |
|-----------|------|----------|-------------|
| `<api-key>` | argument | Ja | API-sleutel voor authenticatie |
| `<instance-url>` | argument | Ja | OneUptime instantie-URL |
| `--context-name` | optie | Nee | Contextnaam (standaard: `"default"`) |

---

### `oneuptime context list`

Alle opgeslagen contexten weergeven.

```bash
oneuptime context list
```

---

### `oneuptime context use`

Overschakelen naar een benoemde context.

```bash
oneuptime context use <name>
```

| Parameter | Type | Vereist | Beschrijving |
|-----------|------|----------|-------------|
| `<name>` | argument | Ja | Te activeren contextnaam |

---

### `oneuptime context current`

De actieve context weergeven met gemaskeerde API-sleutel.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

Een opgeslagen context verwijderen.

```bash
oneuptime context delete <name>
```

| Parameter | Type | Vereist | Beschrijving |
|-----------|------|----------|-------------|
| `<name>` | argument | Ja | Te verwijderen contextnaam |

---

## Resourceopdrachten

Alle resourceopdrachten volgen hetzelfde patroon. Vervang `<resource>` door een ondersteunde resourcenaam (bijv. `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

Resources weergeven met filteren en paginering.

```bash
oneuptime <resource> list [options]
```

| Optie | Type | Standaard | Beschrijving |
|--------|------|---------|-------------|
| `--query <json>` | string | Geen | Filtercriteria als JSON |
| `--limit <n>` | number | `10` | Maximum aantal resultaten |
| `--skip <n>` | number | `0` | Te overslaan resultaten |
| `--sort <json>` | string | Geen | Sorteervolgorde als JSON |
| `-o, --output` | string | `table` | Uitvoerformaat |

---

### `oneuptime <resource> get`

Eén resource ophalen op ID.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Parameter | Type | Vereist | Beschrijving |
|-----------|------|----------|-------------|
| `<id>` | argument | Ja | Resource-ID (UUID) |
| `-o, --output` | optie | Nee | Uitvoerformaat |

---

### `oneuptime <resource> create`

Een nieuwe resource aanmaken.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Optie | Type | Vereist | Beschrijving |
|--------|------|----------|-------------|
| `--data <json>` | string | Een van `--data` of `--file` | Resourcegegevens als JSON |
| `--file <path>` | string | Een van `--data` of `--file` | Pad naar JSON-bestand |
| `-o, --output` | string | Nee | Uitvoerformaat |

---

### `oneuptime <resource> update`

Een bestaande resource bijwerken.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Parameter | Type | Vereist | Beschrijving |
|-----------|------|----------|-------------|
| `<id>` | argument | Ja | Resource-ID |
| `--data <json>` | optie | Ja | Bij te werken velden als JSON |
| `-o, --output` | optie | Nee | Uitvoerformaat |

---

### `oneuptime <resource> delete`

Een resource verwijderen.

```bash
oneuptime <resource> delete <id> [--force]
```

| Parameter | Type | Vereist | Beschrijving |
|-----------|------|----------|-------------|
| `<id>` | argument | Ja | Resource-ID |
| `--force` | optie | Nee | Bevestigingsprompt overslaan |

---

### `oneuptime <resource> count`

Resources tellen die overeenkomen met een filter.

```bash
oneuptime <resource> count [--query <json>]
```

| Optie | Type | Standaard | Beschrijving |
|--------|------|---------|-------------|
| `--query <json>` | string | Geen | Filtercriteria als JSON |

---

## Hulpprogramma-opdrachten

### `oneuptime version`

De CLI-versie weergeven.

```bash
oneuptime version
```

---

### `oneuptime whoami`

Huidige authenticatiegegevens weergeven.

```bash
oneuptime whoami
```

Geeft de instantie-URL en gemaskeerde API-sleutel weer. Als een opgeslagen context actief is, wordt ook de contextnaam getoond.

---

### `oneuptime resources`

Alle beschikbare resourcetypen weergeven.

```bash
oneuptime resources [--type <type>]
```

| Optie | Type | Standaard | Beschrijving |
|--------|------|---------|-------------|
| `--type <type>` | string | Geen | Filteren op `database` of `analytics` |

---

## Globale opties

Deze vlaggen zijn beschikbaar voor alle opdrachten:

| Optie | Beschrijving |
|--------|-------------|
| `--api-key <key>` | API-sleutel overschrijven |
| `--url <url>` | Instantie-URL overschrijven |
| `--context <name>` | Een specifieke context gebruiken |
| `-o, --output <format>` | Uitvoerformaat: `json`, `table`, `wide` |
| `--no-color` | Gekleurde uitvoer uitschakelen |
| `--help` | Hulp weergeven |
| `--version` | Versie weergeven |

## API-routes

Ter referentie: de CLI mapt opdrachten naar deze API-eindpunten:

| Opdracht | Methode | Eindpunt |
|---------|--------|----------|
| `list` | POST | `/api/<resource>/get-list` |
| `get` | POST | `/api/<resource>/<id>/get-item` |
| `create` | POST | `/api/<resource>` |
| `update` | PUT | `/api/<resource>/<id>/` |
| `delete` | DELETE | `/api/<resource>/<id>/` |
| `count` | POST | `/api/<resource>/count` |

Alle verzoeken bevatten de `APIKey`-header voor authenticatie.
