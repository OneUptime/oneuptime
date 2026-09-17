# Riferimento Comandi

Riferimento completo per tutti i comandi della CLI di OneUptime.

## Comandi di Autenticazione

### `oneuptime login`

Autentica con un'istanza OneUptime.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Parametro        | Tipo      | Richiesto | Descrizione                                  |
| ---------------- | --------- | --------- | -------------------------------------------- |
| `<api-key>`      | argomento | Sì        | Chiave API per l'autenticazione              |
| `<instance-url>` | argomento | Sì        | URL dell'istanza OneUptime                   |
| `--context-name` | opzione   | No        | Nome del contesto (predefinito: `"default"`) |

---

### `oneuptime context list`

Elenca tutti i contesti salvati.

```bash
oneuptime context list
```

---

### `oneuptime context use`

Passa a un contesto denominato.

```bash
oneuptime context use <name>
```

| Parametro | Tipo      | Richiesto | Descrizione                   |
| --------- | --------- | --------- | ----------------------------- |
| `<name>`  | argomento | Sì        | Nome del contesto da attivare |

---

### `oneuptime context current`

Mostra il contesto attivo con la chiave API mascherata.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

Rimuove un contesto salvato.

```bash
oneuptime context delete <name>
```

| Parametro | Tipo      | Richiesto | Descrizione                    |
| --------- | --------- | --------- | ------------------------------ |
| `<name>`  | argomento | Sì        | Nome del contesto da eliminare |

---

## Comandi sulle Risorse

Tutti i comandi sulle risorse seguono lo stesso schema. Sostituisci `<resource>` con qualsiasi nome di risorsa supportato (es. `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

Elenca le risorse con filtraggio e paginazione.

```bash
oneuptime <resource> list [options]
```

| Opzione          | Tipo    | Predefinito | Descrizione                 |
| ---------------- | ------- | ----------- | --------------------------- |
| `--query <json>` | stringa | Nessuno     | Criteri di filtro come JSON |
| `--limit <n>`    | numero  | `10`        | Numero massimo di risultati |
| `--skip <n>`     | numero  | `0`         | Risultati da saltare        |
| `--sort <json>`  | stringa | Nessuno     | Ordinamento come JSON       |
| `-o, --output`   | stringa | `table`     | Formato di output           |

---

### `oneuptime <resource> get`

Ottieni una singola risorsa tramite ID.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Parametro      | Tipo      | Richiesto | Descrizione             |
| -------------- | --------- | --------- | ----------------------- |
| `<id>`         | argomento | Sì        | ID della risorsa (UUID) |
| `-o, --output` | opzione   | No        | Formato di output       |

---

### `oneuptime <resource> create`

Crea una nuova risorsa.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Opzione         | Tipo    | Richiesto                   | Descrizione                  |
| --------------- | ------- | --------------------------- | ---------------------------- |
| `--data <json>` | stringa | Uno tra `--data` o `--file` | Dati della risorsa come JSON |
| `--file <path>` | stringa | Uno tra `--data` o `--file` | Percorso al file JSON        |
| `-o, --output`  | stringa | No                          | Formato di output            |

---

### `oneuptime <resource> update`

Aggiorna una risorsa esistente.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Parametro       | Tipo      | Richiesto | Descrizione                   |
| --------------- | --------- | --------- | ----------------------------- |
| `<id>`          | argomento | Sì        | ID della risorsa              |
| `--data <json>` | opzione   | Sì        | Campi da aggiornare come JSON |
| `-o, --output`  | opzione   | No        | Formato di output             |

---

### `oneuptime <resource> delete`

Elimina una risorsa.

```bash
oneuptime <resource> delete <id> [--force]
```

| Parametro | Tipo      | Richiesto | Descrizione                    |
| --------- | --------- | --------- | ------------------------------ |
| `<id>`    | argomento | Sì        | ID della risorsa               |
| `--force` | opzione   | No        | Salta la richiesta di conferma |

---

### `oneuptime <resource> count`

Conta le risorse che corrispondono a un filtro.

```bash
oneuptime <resource> count [--query <json>]
```

| Opzione          | Tipo    | Predefinito | Descrizione                 |
| ---------------- | ------- | ----------- | --------------------------- |
| `--query <json>` | stringa | Nessuno     | Criteri di filtro come JSON |

---

## Comandi di Utilità

### `oneuptime version`

Mostra la versione della CLI.

```bash
oneuptime version
```

---

### `oneuptime whoami`

Mostra i dettagli di autenticazione correnti.

```bash
oneuptime whoami
```

Mostra l'URL dell'istanza e la chiave API mascherata. Se è attivo un contesto salvato, viene mostrato anche il nome del contesto.

---

### `oneuptime resources`

Elenca tutti i tipi di risorse disponibili.

```bash
oneuptime resources [--type <type>]
```

| Opzione         | Tipo    | Predefinito | Descrizione                         |
| --------------- | ------- | ----------- | ----------------------------------- |
| `--type <type>` | stringa | Nessuno     | Filtra per `database` o `analytics` |

---

## Opzioni Globali

Questi flag sono disponibili su tutti i comandi:

| Opzione                 | Descrizione                                |
| ----------------------- | ------------------------------------------ |
| `--api-key <key>`       | Sostituisce la chiave API                  |
| `--url <url>`           | Sostituisce l'URL dell'istanza             |
| `--context <name>`      | Usa un contesto specifico                  |
| `-o, --output <format>` | Formato di output: `json`, `table`, `wide` |
| `--no-color`            | Disabilita l'output colorato               |
| `--help`                | Mostra la guida                            |
| `--version`             | Mostra la versione                         |

## Route API

Per riferimento, la CLI mappa i comandi a questi endpoint API:

| Comando  | Metodo | Endpoint                        |
| -------- | ------ | ------------------------------- |
| `list`   | POST   | `/api/<resource>/get-list`      |
| `get`    | POST   | `/api/<resource>/<id>/get-item` |
| `create` | POST   | `/api/<resource>`               |
| `update` | PUT    | `/api/<resource>/<id>/`         |
| `delete` | DELETE | `/api/<resource>/<id>/`         |
| `count`  | POST   | `/api/<resource>/count`         |

Tutte le richieste includono l'header `APIKey` per l'autenticazione.
