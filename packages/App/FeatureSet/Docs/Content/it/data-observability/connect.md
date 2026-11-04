# Collegare un database

Osservabilità dei dati legge ogni database con un utente che legge solo il suo catalogo: quali tabelle e viste contiene, le loro colonne, righe e dimensioni, e quando sono cambiate. Questa pagina indica il minimo che serve a ogni motore, e come tenere la stringa di connessione all'interno della tua rete con una sonda.

## Prima di iniziare

- **Un ruolo che può collegare i database**: Proprietario del progetto, Amministratore del progetto o Amministratore della telemetria.
- **Un utente di sola lettura**, creato con le istruzioni qui sotto. I controlli che aggiungerai in seguito leggono righe delle tabelle che controllano, quindi concedi all'utente `SELECT` su quelle tabelle solo quando ne aggiungi uno.

## Scegliere chi si collega

In **Osservabilità dei dati > Database**, scegli **Connect a Database**, poi:

- **OneUptime connects**: incolla una stringa di connessione. Viene salvata cifrata, usata solo dai worker di OneUptime e non viene mai più mostrata.
- **A probe in my network connects**: scegli una delle tue sonde e indica la variabile d'ambiente sulla sonda che contiene la stringa di connessione, ad esempio `ORDERS_DB_URL`. La stringa di connessione non lascia mai la tua rete. Vedi [Sonde personalizzate](/docs/probe/custom-probe).

Anche un database già collegato per Sicurezza dei dati viene sorvegliato, senza nulla da collegare, e così ogni dataset BigQuery trovato dalla tua [connessione cloud](/docs/telemetry/cloud-accounts).

## Un utente di sola lettura, per motore

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

La stringa di connessione: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime legge `pg_class`, `pg_stat_user_tables` e `pg_attribute`: una tabella è cambiata quando si sono mossi i suoi contatori di inserimenti, aggiornamenti o eliminazioni, ed è stata letta quando si sono mossi i suoi contatori di scansioni.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` permette a OneUptime di vedere scritture e letture tra una raccolta e l'altra; senza di esso, `information_schema.TABLES` indica comunque quando ogni tabella è cambiata l'ultima volta.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` permette a OneUptime di leggere dimensioni, ultimi aggiornamenti e ultime letture.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Collegati con una stringa di connessione PostgreSQL all'endpoint del cluster o del workgroup, ad esempio `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` permette a OneUptime di leggere il numero di righe e le dimensioni, le ultime scritture e letture di ogni utente, e il lineage dal log delle query. Senza di esso, un cambiamento nelle righe di una tabella indica comunque quando è cambiata.
@tab Snowflake
```sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
```

Snowflake viene letto tramite la sua API SQL con autenticazione a coppia di chiavi. Collegati con un JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

Il catalogo viene letto con `SHOW`, che non richiede alcun warehouse, quindi la raccolta non consuma crediti. Solo i controlli girano sul warehouse, secondo la pianificazione che dai loro.
@tab Google BigQuery
Ogni dataset trovato dalla tua connessione cloud viene sorvegliato con l'account di servizio di quella connessione. Assegnagli **BigQuery Metadata Viewer** e **BigQuery Job User** sul progetto per leggere il catalogo, **BigQuery Data Viewer** sulle tabelle che leggono i tuoi controlli, e **BigQuery Resource Viewer** per il lineage dai suoi job.

Ogni raccolta legge la tabella `__TABLES__` del dataset (righe, byte e ultima modifica, senza costi) e la sua `INFORMATION_SCHEMA.COLUMNS` (fatturata al minimo di 10 MB di BigQuery). Per collegare un dataset senza connessione cloud, fornisci un JSON con una chiave dell'account di servizio:

```json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
```
@tab ClickHouse
```sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
```

ClickHouse viene letto tramite la sua interfaccia HTTP, sulla porta 8443 con TLS (ClickHouse Cloud) o 8123 senza: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Indica un database per sorvegliare solo quello, oppure omettilo per sorvegliare tutti i database tranne quelli del server stesso. `system.parts` permette a OneUptime di vedere ogni inserimento (un merge non conta), `system.part_log`, dove il server lo mantiene, fornisce l'orario di ogni inserimento, e `system.query_log` fornisce le ultime letture e il lineage una volta all'ora. Ogni istruzione viene eseguita in sola lettura, così nemmeno un utente che potrebbe scrivere riesce a farlo.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Un catalogo di Unity Catalog è un database. Collegati con un service principal, oppure con un token di accesso personale passato come `"token"` al posto di `clientId` e `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

Il catalogo, le sue colonne e l'ultimo commit di ogni tabella Delta arrivano dall'API REST di Unity Catalog senza alcun SQL warehouse, quindi la raccolta non consuma risorse di calcolo. I controlli, e il lineage e le ultime letture da `system.access.table_lineage` una volta all'ora, girano sul SQL warehouse che indichi; concedi al service principal **Can use** su di esso.
@tab Amazon Athena
Un database Glue è un database. Le sue tabelle e viste, le loro colonne e statistiche e l'ultimo commit di ogni tabella Iceberg arrivano dall'API del Glue Data Catalog, che non legge dati e non costa nulla. I controlli vengono eseguiti come query Athena nel workgroup che indichi. Connettiti con le chiavi di un utente o ruolo IAM che possa chiamare `glue:GetDatabase` e `glue:GetTables` e, per i controlli, eseguire query Athena nel workgroup con accesso in lettura ai dati delle tabelle:

```json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
```
:::

## Cosa viene letto, e ogni quanto

| Cosa | Quando |
| --- | --- |
| Tabelle, viste, colonne, righe, dimensioni e ultima modifica | Ogni cinque minuti |
| Controlli | Ogni 15 minuti, ogni ora, ogni 6 ore o ogni giorno, come indica ciascuno |
| Lineage e ultime letture dalla cronologia delle query | Una volta all'ora, a partire dall'ultima lettura |

Ogni istruzione viene eseguita in sola lettura, con un timeout per istruzioni e lock dove il motore li prevede. La stringa di connessione non viene mai registrata nei log ed è rimossa da ogni errore. Una statistica che l'utente non può leggere viene omessa con un avvertimento sul database, mai con una raccolta non riuscita.

## Risoluzione dei problemi

- **Il database mostra lo stato Non riuscito.** Il suo messaggio dice perché: un host che OneUptime non riesce a raggiungere, un utente rifiutato, una modalità TLS che il server non accetta. Se il database è all'interno della tua rete, collegalo tramite una sonda.
- **Le tabelle non mostrano alcuna ultima modifica.** L'utente non può leggere le statistiche del motore: concedi ciò che elenca la scheda del tuo motore, oppure attendi che le righe di una tabella cambino due volte.
- **Manca una tabella.** Si trova in uno schema che l'utente non può usare, oppure è esclusa sul database. Concedi `USAGE` sul suo schema, oppure rimuovi l'esclusione.

## Passaggi successivi

:::cards
- [Salute delle tabelle](/docs/data-observability/table-health): Cosa impara ogni raccolta su ogni tabella, e gli avvisi che consiglia.
- [Controlli e riconciliazioni](/docs/data-observability/checks): Regole su ciò che contiene una tabella.
:::
