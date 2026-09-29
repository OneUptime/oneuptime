# Kommandoreference

Komplet reference til alle OneUptime CLI-kommandoer.

## Autentificeringskommandoer

### `oneuptime login`

Autentificer med en OneUptime-instans.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Parameter        | Type        | Påkrævet | Beskrivelse                          |
| ---------------- | ----------- | -------- | ------------------------------------ |
| `<api-key>`      | argument    | Ja       | API-nøgle til autentificering        |
| `<instance-url>` | argument    | Ja       | OneUptime-instans-URL                |
| `--context-name` | indstilling | Nej      | Kontekstnavn (standard: `"default"`) |

---

### `oneuptime context list`

List alle gemte kontekster.

```bash
oneuptime context list
```

---

### `oneuptime context use`

Skift til en navngivet kontekst.

```bash
oneuptime context use <name>
```

| Parameter | Type     | Påkrævet | Beskrivelse                     |
| --------- | -------- | -------- | ------------------------------- |
| `<name>`  | argument | Ja       | Kontekstnavn der skal aktiveres |

---

### `oneuptime context current`

Vis den aktive kontekst med maskeret API-nøgle.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

Fjern en gemt kontekst.

```bash
oneuptime context delete <name>
```

| Parameter | Type     | Påkrævet | Beskrivelse                   |
| --------- | -------- | -------- | ----------------------------- |
| `<name>`  | argument | Ja       | Kontekstnavn der skal slettes |

---

## Ressourcekommandoer

Alle ressourcekommandoer følger det samme mønster. Erstat `<resource>` med et understøttet ressourcenavn (f.eks. `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

List ressourcer med filtrering og paginering.

```bash
oneuptime <resource> list [options]
```

| Indstilling      | Type   | Standard | Beskrivelse                       |
| ---------------- | ------ | -------- | --------------------------------- |
| `--query <json>` | streng | Ingen    | Filterkriterier som JSON          |
| `--limit <n>`    | tal    | `10`     | Maks. antal resultater            |
| `--skip <n>`     | tal    | `0`      | Resultater der skal springes over |
| `--sort <json>`  | streng | Ingen    | Sorteringsrækkefølge som JSON     |
| `-o, --output`   | streng | `table`  | Outputformat                      |

---

### `oneuptime <resource> get`

Hent en enkelt ressource efter ID.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Parameter      | Type        | Påkrævet | Beskrivelse         |
| -------------- | ----------- | -------- | ------------------- |
| `<id>`         | argument    | Ja       | Ressource-ID (UUID) |
| `-o, --output` | indstilling | Nej      | Outputformat        |

---

### `oneuptime <resource> create`

Opret en ny ressource.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Indstilling     | Type   | Påkrævet                      | Beskrivelse            |
| --------------- | ------ | ----------------------------- | ---------------------- |
| `--data <json>` | streng | En af `--data` eller `--file` | Ressourcedata som JSON |
| `--file <path>` | streng | En af `--data` eller `--file` | Sti til JSON-fil       |
| `-o, --output`  | streng | Nej                           | Outputformat           |

---

### `oneuptime <resource> update`

Opdater en eksisterende ressource.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Parameter       | Type        | Påkrævet | Beskrivelse                        |
| --------------- | ----------- | -------- | ---------------------------------- |
| `<id>`          | argument    | Ja       | Ressource-ID                       |
| `--data <json>` | indstilling | Ja       | Felter der skal opdateres som JSON |
| `-o, --output`  | indstilling | Nej      | Outputformat                       |

---

### `oneuptime <resource> delete`

Slet en ressource.

```bash
oneuptime <resource> delete <id> [--force]
```

| Parameter | Type        | Påkrævet | Beskrivelse                    |
| --------- | ----------- | -------- | ------------------------------ |
| `<id>`    | argument    | Ja       | Ressource-ID                   |
| `--force` | indstilling | Nej      | Spring bekræftelsesprompt over |

---

### `oneuptime <resource> count`

Tæl ressourcer, der matcher et filter.

```bash
oneuptime <resource> count [--query <json>]
```

| Indstilling      | Type   | Standard | Beskrivelse              |
| ---------------- | ------ | -------- | ------------------------ |
| `--query <json>` | streng | Ingen    | Filterkriterier som JSON |

---

## Hjælpekommandoer

### `oneuptime version`

Vis CLI-versionen.

```bash
oneuptime version
```

---

### `oneuptime whoami`

Vis aktuelle autentificeringsdetaljer.

```bash
oneuptime whoami
```

Viser instans-URL og maskeret API-nøgle. Hvis en gemt kontekst er aktiv, vises kontekstnavnet også.

---

### `oneuptime resources`

List alle tilgængelige ressourcetyper.

```bash
oneuptime resources [--type <type>]
```

| Indstilling     | Type   | Standard | Beskrivelse                                |
| --------------- | ------ | -------- | ------------------------------------------ |
| `--type <type>` | streng | Ingen    | Filtrer efter `database` eller `analytics` |

---

## Globale indstillinger

Disse flag er tilgængelige på alle kommandoer:

| Indstilling             | Beskrivelse                           |
| ----------------------- | ------------------------------------- |
| `--api-key <key>`       | Tilsidesæt API-nøgle                  |
| `--url <url>`           | Tilsidesæt instans-URL                |
| `--context <name>`      | Brug en specifik kontekst             |
| `-o, --output <format>` | Outputformat: `json`, `table`, `wide` |
| `--no-color`            | Deaktiver farvet output               |
| `--help`                | Vis hjælp                             |
| `--version`             | Vis version                           |

## API-ruter

Som reference mapper CLI-kommandoer til disse API-endpoints:

| Kommando | Metode | Endpoint                        |
| -------- | ------ | ------------------------------- |
| `list`   | POST   | `/api/<resource>/get-list`      |
| `get`    | POST   | `/api/<resource>/<id>/get-item` |
| `create` | POST   | `/api/<resource>`               |
| `update` | PUT    | `/api/<resource>/<id>/`         |
| `delete` | DELETE | `/api/<resource>/<id>/`         |
| `count`  | POST   | `/api/<resource>/count`         |

Alle anmodninger inkluderer `APIKey`-headeren til autentificering.
