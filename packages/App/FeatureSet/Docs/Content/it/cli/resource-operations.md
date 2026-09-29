# Operazioni sulle Risorse

La CLI di OneUptime fornisce operazioni CRUD (Create, Read, Update, Delete) complete per tutte le risorse supportate. Le risorse vengono auto-individuate dalla tua istanza OneUptime.

## Risorse Disponibili

Esegui il seguente comando per vedere tutti i tipi di risorse disponibili:

```bash
oneuptime resources
```

Puoi filtrare per tipo:

```bash
# Mostra solo le risorse di database
oneuptime resources --type database

# Mostra solo le risorse di analytics
oneuptime resources --type analytics
```

Le risorse comuni includono:

| Risorsa                     | Comando                                 |
| --------------------------- | --------------------------------------- |
| Incident                    | `oneuptime incident`                    |
| Alert                       | `oneuptime alert`                       |
| Monitor                     | `oneuptime monitor`                     |
| Monitor Status              | `oneuptime monitor-status`              |
| Incident State              | `oneuptime incident-state`              |
| Status Page                 | `oneuptime status-page`                 |
| On-Call Policy              | `oneuptime on-call-policy`              |
| Team                        | `oneuptime team`                        |
| Scheduled Maintenance Event | `oneuptime scheduled-maintenance-event` |

## Elenca le Risorse

Recupera un elenco di risorse con filtraggio, paginazione e ordinamento opzionali.

```bash
oneuptime <resource> list [options]
```

**Opzioni:**

| Opzione                 | Descrizione                    | Predefinito |
| ----------------------- | ------------------------------ | ----------- |
| `--query <json>`        | Criteri di filtro come JSON    | Nessuno     |
| `--limit <n>`           | Numero massimo di risultati    | `10`        |
| `--skip <n>`            | Numero di risultati da saltare | `0`         |
| `--sort <json>`         | Ordinamento come JSON          | Nessuno     |
| `-o, --output <format>` | Formato di output              | `table`     |

**Esempi:**

```bash
# Elenca i 10 incidenti più recenti
oneuptime incident list

# Filtra gli incidenti per ID di stato
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# Elenca con paginazione
oneuptime incident list --limit 20 --skip 40

# Ordina per data di creazione (decrescente)
oneuptime incident list --sort '{"createdAt":-1}'

# Output come JSON
oneuptime incident list -o json
```

## Ottieni una Risorsa

Recupera una singola risorsa tramite il suo ID.

```bash
oneuptime <resource> get <id>
```

**Argomenti:**

| Argomento | Descrizione               |
| --------- | ------------------------- |
| `<id>`    | L'ID della risorsa (UUID) |

**Esempi:**

```bash
# Ottieni un incidente specifico
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Ottieni un monitor come JSON
oneuptime monitor get abc-123 -o json
```

## Crea una Risorsa

Crea una nuova risorsa da JSON inline o da un file.

```bash
oneuptime <resource> create [options]
```

**Opzioni:**

| Opzione                 | Descrizione                                             |
| ----------------------- | ------------------------------------------------------- |
| `--data <json>`         | Dati della risorsa come oggetto JSON                    |
| `--file <path>`         | Percorso a un file JSON contenente i dati della risorsa |
| `-o, --output <format>` | Formato di output                                       |

Devi fornire `--data` o `--file`.

**Esempi:**

```bash
# Crea un incidente con JSON inline
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Crea da un file JSON
oneuptime incident create --file incident.json

# Crea e output come JSON per catturare l'ID
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Aggiorna una Risorsa

Aggiorna una risorsa esistente tramite ID.

```bash
oneuptime <resource> update <id> [options]
```

**Argomenti:**

| Argomento | Descrizione        |
| --------- | ------------------ |
| `<id>`    | L'ID della risorsa |

**Opzioni:**

| Opzione                 | Descrizione                                  |
| ----------------------- | -------------------------------------------- |
| `--data <json>`         | Campi da aggiornare come JSON (obbligatorio) |
| `-o, --output <format>` | Formato di output                            |

**Esempi:**

```bash
# Cambia lo stato dell'incidente (es. a risolto)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Rinomina un monitor
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Elimina una Risorsa

Elimina una risorsa tramite ID.

```bash
oneuptime <resource> delete <id> [--force]
```

**Argomenti:**

| Argomento | Descrizione        |
| --------- | ------------------ |
| `<id>`    | L'ID della risorsa |

**Opzioni:**

| Opzione   | Descrizione                    |
| --------- | ------------------------------ |
| `--force` | Salta la richiesta di conferma |

**Esempi:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Salta la conferma
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Conta le Risorse

Conta le risorse che corrispondono a criteri di filtro opzionali.

```bash
oneuptime <resource> count [options]
```

**Opzioni:**

| Opzione          | Descrizione                 |
| ---------------- | --------------------------- |
| `--query <json>` | Criteri di filtro come JSON |

**Esempi:**

```bash
# Conta tutti gli incidenti
oneuptime incident count

# Conta gli incidenti per stato
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Conta i monitor
oneuptime monitor count
```

## Risorse di Analytics

Le risorse di analytics supportano un insieme limitato di operazioni rispetto alle risorse di database:

| Operazione | Supportata |
| ---------- | ---------- |
| `list`     | Sì         |
| `create`   | Sì         |
| `count`    | Sì         |
| `get`      | No         |
| `update`   | No         |
| `delete`   | No         |

Usa `oneuptime resources --type analytics` per vedere quali risorse di analytics sono disponibili sulla tua istanza.
