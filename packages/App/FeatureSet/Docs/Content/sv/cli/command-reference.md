# Kommandonreferens

Fullständig referens för alla OneUptime CLI-kommandon.

## Autentiseringskommandon

### `oneuptime login`

Autentisera mot en OneUptime-instans.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Parameter        | Typ        | Obligatorisk | Beskrivning                         |
| ---------------- | ---------- | ------------ | ----------------------------------- |
| `<api-key>`      | argument   | Ja           | API-nyckel för autentisering        |
| `<instance-url>` | argument   | Ja           | OneUptime instans-URL               |
| `--context-name` | alternativ | Nej          | Kontextnamn (standard: `"default"`) |

---

### `oneuptime context list`

Lista alla sparade kontexter.

```bash
oneuptime context list
```

---

### `oneuptime context use`

Byt till en namngiven kontext.

```bash
oneuptime context use <name>
```

| Parameter | Typ      | Obligatorisk | Beskrivning              |
| --------- | -------- | ------------ | ------------------------ |
| `<name>`  | argument | Ja           | Kontextnamn att aktivera |

---

### `oneuptime context current`

Visa den aktiva kontexten med maskerad API-nyckel.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

Ta bort en sparad kontext.

```bash
oneuptime context delete <name>
```

| Parameter | Typ      | Obligatorisk | Beskrivning             |
| --------- | -------- | ------------ | ----------------------- |
| `<name>`  | argument | Ja           | Kontextnamn att ta bort |

---

## Resurskommandon

Alla resurskommandon följer samma mönster. Ersätt `<resource>` med valfritt resursvärde som stöds (t.ex. `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

Lista resurser med filtrering och sidnumrering.

```bash
oneuptime <resource> list [options]
```

| Alternativ       | Typ    | Standard | Beskrivning                |
| ---------------- | ------ | -------- | -------------------------- |
| `--query <json>` | sträng | Inget    | Filterkriterier som JSON   |
| `--limit <n>`    | nummer | `10`     | Maximalt antal resultat    |
| `--skip <n>`     | nummer | `0`      | Resultat att hoppa över    |
| `--sort <json>`  | sträng | Inget    | Sorteringsordning som JSON |
| `-o, --output`   | sträng | `table`  | Utdataformat               |

---

### `oneuptime <resource> get`

Hämta en enskild resurs med ID.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Parameter      | Typ        | Obligatorisk | Beskrivning      |
| -------------- | ---------- | ------------ | ---------------- |
| `<id>`         | argument   | Ja           | Resurs-ID (UUID) |
| `-o, --output` | alternativ | Nej          | Utdataformat     |

---

### `oneuptime <resource> create`

Skapa en ny resurs.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Alternativ      | Typ    | Obligatorisk                  | Beskrivning          |
| --------------- | ------ | ----------------------------- | -------------------- |
| `--data <json>` | sträng | En av `--data` eller `--file` | Resursdata som JSON  |
| `--file <path>` | sträng | En av `--data` eller `--file` | Sökväg till JSON-fil |
| `-o, --output`  | sträng | Nej                           | Utdataformat         |

---

### `oneuptime <resource> update`

Uppdatera en befintlig resurs.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Parameter       | Typ        | Obligatorisk | Beskrivning                 |
| --------------- | ---------- | ------------ | --------------------------- |
| `<id>`          | argument   | Ja           | Resurs-ID                   |
| `--data <json>` | alternativ | Ja           | Fält att uppdatera som JSON |
| `-o, --output`  | alternativ | Nej          | Utdataformat                |

---

### `oneuptime <resource> delete`

Ta bort en resurs.

```bash
oneuptime <resource> delete <id> [--force]
```

| Parameter | Typ        | Obligatorisk | Beskrivning                  |
| --------- | ---------- | ------------ | ---------------------------- |
| `<id>`    | argument   | Ja           | Resurs-ID                    |
| `--force` | alternativ | Nej          | Hoppa över bekräftelseprompt |

---

### `oneuptime <resource> count`

Räkna resurser som matchar ett filter.

```bash
oneuptime <resource> count [--query <json>]
```

| Alternativ       | Typ    | Standard | Beskrivning              |
| ---------------- | ------ | -------- | ------------------------ |
| `--query <json>` | sträng | Inget    | Filterkriterier som JSON |

---

## Hjälpkommandon

### `oneuptime version`

Visa CLI-versionen.

```bash
oneuptime version
```

---

### `oneuptime whoami`

Visa aktuella autentiseringsuppgifter.

```bash
oneuptime whoami
```

Visar instans-URL och maskerad API-nyckel. Om en sparad kontext är aktiv visas även kontextnamnet.

---

### `oneuptime resources`

Lista alla tillgängliga resurstyper.

```bash
oneuptime resources [--type <type>]
```

| Alternativ      | Typ    | Standard | Beskrivning                                 |
| --------------- | ------ | -------- | ------------------------------------------- |
| `--type <type>` | sträng | Inget    | Filtrera efter `database` eller `analytics` |

---

## Globala alternativ

Dessa flaggor är tillgängliga för alla kommandon:

| Alternativ              | Beskrivning                           |
| ----------------------- | ------------------------------------- |
| `--api-key <key>`       | Åsidosätt API-nyckel                  |
| `--url <url>`           | Åsidosätt instans-URL                 |
| `--context <name>`      | Använd en specifik kontext            |
| `-o, --output <format>` | Utdataformat: `json`, `table`, `wide` |
| `--no-color`            | Inaktivera färgad utdata              |
| `--help`                | Visa hjälp                            |
| `--version`             | Visa version                          |

## API-rutter

Som referens mappar CLI kommandon till dessa API-slutpunkter:

| Kommando | Metod  | Slutpunkt                       |
| -------- | ------ | ------------------------------- |
| `list`   | POST   | `/api/<resource>/get-list`      |
| `get`    | POST   | `/api/<resource>/<id>/get-item` |
| `create` | POST   | `/api/<resource>`               |
| `update` | PUT    | `/api/<resource>/<id>/`         |
| `delete` | DELETE | `/api/<resource>/<id>/`         |
| `count`  | POST   | `/api/<resource>/count`         |

Alla förfrågningar inkluderar `APIKey`-huvudet för autentisering.
