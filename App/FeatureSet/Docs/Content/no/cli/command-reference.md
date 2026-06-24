# Kommandoreferanse

Fullstendig referanse for alle OneUptime CLI-kommandoer.

## Autentiseringskommandoer

### `oneuptime login`

Autentiser med en OneUptime-instans.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Parameter        | Type       | Påkrevd | Beskrivelse                          |
| ---------------- | ---------- | ------- | ------------------------------------ |
| `<api-key>`      | argument   | Ja      | API-nøkkel for autentisering         |
| `<instance-url>` | argument   | Ja      | URL til OneUptime-instansen          |
| `--context-name` | alternativ | Nei     | Kontekstnavn (standard: `"default"`) |

---

### `oneuptime context list`

List alle lagrede kontekster.

```bash
oneuptime context list
```

---

### `oneuptime context use`

Bytt til en navngitt kontekst.

```bash
oneuptime context use <name>
```

| Parameter | Type     | Påkrevd | Beskrivelse                     |
| --------- | -------- | ------- | ------------------------------- |
| `<name>`  | argument | Ja      | Kontekstnavn som skal aktiveres |

---

### `oneuptime context current`

Vis den aktive konteksten med maskert API-nøkkel.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

Fjern en lagret kontekst.

```bash
oneuptime context delete <name>
```

| Parameter | Type     | Påkrevd | Beskrivelse                   |
| --------- | -------- | ------- | ----------------------------- |
| `<name>`  | argument | Ja      | Kontekstnavn som skal slettes |

---

## Ressurskommandoer

Alle ressurskommandoer følger samme mønster. Erstatt `<resource>` med et støttet ressursnavn (f.eks. `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

List ressurser med filtrering og paginering.

```bash
oneuptime <resource> list [options]
```

| Alternativ       | Type   | Standard | Beskrivelse                     |
| ---------------- | ------ | -------- | ------------------------------- |
| `--query <json>` | streng | Ingen    | Filterkriterier som JSON        |
| `--limit <n>`    | tall   | `10`     | Maksimalt antall resultater     |
| `--skip <n>`     | tall   | `0`      | Resultater som skal hoppes over |
| `--sort <json>`  | streng | Ingen    | Sorteringsrekkefølge som JSON   |
| `-o, --output`   | streng | `table`  | Utdataformat                    |

---

### `oneuptime <resource> get`

Hent en enkelt ressurs etter ID.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Parameter      | Type       | Påkrevd | Beskrivelse       |
| -------------- | ---------- | ------- | ----------------- |
| `<id>`         | argument   | Ja      | Ressurs-ID (UUID) |
| `-o, --output` | alternativ | Nei     | Utdataformat      |

---

### `oneuptime <resource> create`

Opprett en ny ressurs.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Alternativ      | Type   | Påkrevd                       | Beskrivelse          |
| --------------- | ------ | ----------------------------- | -------------------- |
| `--data <json>` | streng | Én av `--data` eller `--file` | Ressursdata som JSON |
| `--file <path>` | streng | Én av `--data` eller `--file` | Sti til JSON-fil     |
| `-o, --output`  | streng | Nei                           | Utdataformat         |

---

### `oneuptime <resource> update`

Oppdater en eksisterende ressurs.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Parameter       | Type       | Påkrevd | Beskrivelse                       |
| --------------- | ---------- | ------- | --------------------------------- |
| `<id>`          | argument   | Ja      | Ressurs-ID                        |
| `--data <json>` | alternativ | Ja      | Felt som skal oppdateres som JSON |
| `-o, --output`  | alternativ | Nei     | Utdataformat                      |

---

### `oneuptime <resource> delete`

Slett en ressurs.

```bash
oneuptime <resource> delete <id> [--force]
```

| Parameter | Type       | Påkrevd | Beskrivelse                    |
| --------- | ---------- | ------- | ------------------------------ |
| `<id>`    | argument   | Ja      | Ressurs-ID                     |
| `--force` | alternativ | Nei     | Hopp over bekreftelsesprompten |

---

### `oneuptime <resource> count`

Tell ressurser som matcher et filter.

```bash
oneuptime <resource> count [--query <json>]
```

| Alternativ       | Type   | Standard | Beskrivelse              |
| ---------------- | ------ | -------- | ------------------------ |
| `--query <json>` | streng | Ingen    | Filterkriterier som JSON |

---

## Verktøykommandoer

### `oneuptime version`

Vis CLI-versjonen.

```bash
oneuptime version
```

---

### `oneuptime whoami`

Vis gjeldende autentiseringsdetaljer.

```bash
oneuptime whoami
```

Viser instans-URL og maskert API-nøkkel. Hvis en lagret kontekst er aktiv, vises også kontekstnavnet.

---

### `oneuptime resources`

List alle tilgjengelige ressurstyper.

```bash
oneuptime resources [--type <type>]
```

| Alternativ      | Type   | Standard | Beskrivelse                                |
| --------------- | ------ | -------- | ------------------------------------------ |
| `--type <type>` | streng | Ingen    | Filtrer etter `database` eller `analytics` |

---

## Globale alternativer

Disse flaggene er tilgjengelige på alle kommandoer:

| Alternativ              | Beskrivelse                           |
| ----------------------- | ------------------------------------- |
| `--api-key <key>`       | Overstyr API-nøkkel                   |
| `--url <url>`           | Overstyr instans-URL                  |
| `--context <name>`      | Bruk en spesifikk kontekst            |
| `-o, --output <format>` | Utdataformat: `json`, `table`, `wide` |
| `--no-color`            | Deaktiver farget utdata               |
| `--help`                | Vis hjelp                             |
| `--version`             | Vis versjon                           |

## API-ruter

For referanse, kartlegger CLI kommandoer til disse API-endepunktene:

| Kommando | Metode | Endepunkt                       |
| -------- | ------ | ------------------------------- |
| `list`   | POST   | `/api/<resource>/get-list`      |
| `get`    | POST   | `/api/<resource>/<id>/get-item` |
| `create` | POST   | `/api/<resource>`               |
| `update` | PUT    | `/api/<resource>/<id>/`         |
| `delete` | DELETE | `/api/<resource>/<id>/`         |
| `count`  | POST   | `/api/<resource>/count`         |

Alle forespørsler inkluderer `APIKey`-overskriften for autentisering.
