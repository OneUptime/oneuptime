# Eine Datenbank verbinden

Data Observability liest jede Datenbank mit einem Login, das nur ihren Katalog liest: welche Tabellen und Views sie enthält, deren Spalten, Zeilen und Größe und wann sie sich geändert haben. Diese Seite nennt das Minimum, das jede Engine braucht, und zeigt, wie Sie die Verbindungszeichenfolge mit einer Sonde in Ihrem Netzwerk halten.

## Bevor Sie beginnen

- **Eine Rolle, die Datenbanken verbinden darf**: Projektinhaber, Projektadministrator oder Telemetrie-Administrator.
- **Ein schreibgeschütztes Login**, angelegt mit den Anweisungen unten. Prüfungen, die Sie später hinzufügen, lesen Zeilen der Tabellen, die sie prüfen; geben Sie dem Login `SELECT` auf diese Tabellen also erst, wenn Sie eine hinzufügen.

## Wählen, wer sich verbindet

Wählen Sie unter **Data Observability > Datenbanken** die Option **Connect a Database** und dann:

- **OneUptime connects**: Fügen Sie eine Verbindungszeichenfolge ein. Sie wird verschlüsselt gespeichert, nur von den Workern von OneUptime verwendet und nie wieder angezeigt.
- **A probe in my network connects**: Wählen Sie eine Ihrer Sonden und nennen Sie die Umgebungsvariable auf der Sonde, die die Verbindungszeichenfolge enthält, etwa `ORDERS_DB_URL`. Die Verbindungszeichenfolge verlässt Ihr Netzwerk nie. Siehe [Benutzerdefinierte Probes](/docs/probe/custom-probe).

Eine Datenbank, die bereits für Datensicherheit verbunden ist, wird ebenfalls überwacht, ohne dass Sie etwas verbinden müssen, und ebenso jedes BigQuery-Dataset, das Ihre [Cloud-Verbindung](/docs/telemetry/cloud-accounts) gefunden hat.

## Datenbanken, die Sie verbinden könnten

**Datenbanken, die Sie verbinden könnten** unter **Datenbanken** listet auf, was Ihr Projekt bereits kennt und niemand verbunden hat: Datenbanken, mit denen Ihre Traces sprechen, solche in Ihren Cloud-Konten und solche, die Datenbank-Monitoring überwacht. **Verbinden** startet das Formular mit dem, was über jede bekannt ist, mit einer Verbindungszeichenfolge zum Ausfüllen. **Ausblenden** verhindert, dass eine wiederkommt. Es wird nichts gelesen, bis Sie sie verbinden.

## Ein schreibgeschütztes Login, je Engine

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

Die Verbindungszeichenfolge: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime liest `pg_class`, `pg_stat_user_tables` und `pg_attribute`: Eine Tabelle hat sich geändert, wenn sich ihre Zähler für Einfügen, Aktualisieren oder Löschen bewegt haben, und wurde gelesen, wenn sich ihre Scan-Zähler bewegt haben.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

Mit `performance_schema` sieht OneUptime Schreib- und Lesezugriffe zwischen den Erfassungen; ohne es sagt `information_schema.TABLES` trotzdem, wann sich jede Tabelle zuletzt geändert hat.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

Mit `VIEW DATABASE STATE` liest OneUptime Größen, letzte Aktualisierungen und letzte Lesezugriffe.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Verbinden Sie sich mit einer PostgreSQL-Verbindungszeichenfolge zum Endpunkt des Clusters oder der Arbeitsgruppe, etwa `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. Mit `SYSLOG ACCESS UNRESTRICTED` liest OneUptime Zeilenzahlen und Größen, die letzten Schreib- und Lesezugriffe aller Benutzer und die Lineage aus dem Abfrageprotokoll. Ohne es zeigt eine Änderung der Zeilen einer Tabelle trotzdem, wann sie sich geändert hat.
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

Snowflake wird über seine SQL-API mit Schlüsselpaar-Authentifizierung gelesen. Verbinden Sie sich mit JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

Der Katalog wird mit `SHOW` gelesen, das kein Warehouse braucht, sodass die Erfassung keine Credits kostet. Nur Prüfungen laufen auf dem Warehouse, nach dem Zeitplan, den Sie ihnen geben.
@tab Google BigQuery
Jedes Dataset, das Ihre Cloud-Verbindung gefunden hat, wird mit dem Dienstkonto dieser Verbindung überwacht. Geben Sie ihm **BigQuery Metadata Viewer** und **BigQuery Job User** auf dem Projekt, um den Katalog zu lesen, **BigQuery Data Viewer** auf den Tabellen, die Ihre Prüfungen lesen, und **BigQuery Resource Viewer** für die Lineage aus seinen Jobs.

Jede Erfassung liest die Tabelle `__TABLES__` des Datasets (Zeilen, Bytes und letzte Änderung, kostenlos) und seine `INFORMATION_SCHEMA.COLUMNS` (abgerechnet mit dem Minimum von 10 MB bei BigQuery). Um ein Dataset ohne Cloud-Verbindung zu verbinden, geben Sie JSON mit einem Dienstkontoschlüssel an:

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

ClickHouse wird über seine HTTP-Schnittstelle gelesen, auf Port 8443 mit TLS (ClickHouse Cloud) oder 8123 ohne: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Nennen Sie eine Datenbank, um nur sie zu überwachen, oder lassen Sie sie weg, um jede Datenbank außer den servereigenen zu überwachen. Mit `system.parts` sieht OneUptime jedes Einfügen (ein Merge zählt nicht), `system.part_log` liefert, wo der Server es führt, den Zeitpunkt jedes Einfügens, und `system.query_log` liefert einmal pro Stunde die letzten Lesezugriffe und die Lineage. Jede Anweisung läuft schreibgeschützt, sodass selbst ein Login, das schreiben dürfte, es nicht kann.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Ein Katalog von Unity Catalog ist eine Datenbank. Verbinden Sie sich mit einem Service Principal oder mit einem persönlichen Zugriffstoken als `"token"` anstelle von `clientId` und `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

Der Katalog, seine Spalten und der letzte Commit jeder Delta-Tabelle kommen aus der REST-API von Unity Catalog, ohne SQL-Warehouse, sodass die Erfassung keine Rechenleistung kostet. Prüfungen sowie Lineage und letzte Lesezugriffe aus `system.access.table_lineage`, einmal pro Stunde, laufen auf dem SQL-Warehouse, das Sie nennen; geben Sie dem Service Principal darauf **Can use**.
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle wird über sein eigenes Protokoll gelesen, ohne einen Oracle-Client zu installieren: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. Der Login sieht die Tabellen, die er lesen darf: Erteilen Sie `READ` auf jede zu überwachende Tabelle; damit kann er sie abfragen, aber nie sperren oder ändern. `SELECT_CATALOG_ROLE` lässt OneUptime die Größe jeder Tabelle lesen, und `ALL_TAB_MODIFICATIONS` liefert die Inserts, Updates und Deletes jeder Tabelle seit ihrer letzten Statistik und wann sie sich zuletzt geändert hat.
@tab Amazon Athena
Eine Glue-Datenbank ist eine Datenbank. Ihre Tabellen und Views, deren Spalten und Statistiken sowie der letzte Commit jeder Iceberg-Tabelle kommen aus der API des Glue Data Catalog, die keine Daten liest und nichts kostet. Prüfungen laufen als Athena-Abfragen in der angegebenen Workgroup. Verbinden Sie sich mit den Schlüsseln eines IAM-Benutzers oder einer IAM-Rolle, die `glue:GetDatabase` und `glue:GetTables` aufrufen und für Prüfungen Athena-Abfragen in der Workgroup mit Lesezugriff auf die Daten der Tabellen ausführen dürfen:

```json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
```
@tab MongoDB
```javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
```

MongoDB wird über seinen eigenen Treiber gelesen: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/` oder `mongodb://` mit den Hosts eines Replica Sets. Eine Datenbank im Pfad ist die einzige, die überwacht wird; ohne eine wird jede Datenbank überwacht, die der Login lesen darf, und `{ role: "read", db: "orders" }` anstelle von `readAnyDatabase` beschränkt ihn auf eine. Dokumente, Größe und Schreibvorgänge jeder Collection kommen aus `$collStats`, und wann sie zuletzt ein Dokument aufgenommen hat, aus ihrer neuesten `_id`. Ihre Felder kommen aus dem JSON-Schema ihres Validators oder sonst aus den Namen und Typen der Felder ihrer 100 neuesten Dokumente, in der Datenbank ermittelt, sodass kein Wert sie verlässt. Dokumente werden auf einem Secondary gelesen, wo es einen gibt, und eine benutzerdefinierte Prüfung ist eine Aggregations-Pipeline als JSON.
:::

## Was gelesen wird, und wie oft

| Was | Wann |
| --- | --- |
| Tabellen, Views, Spalten, Zeilen, Größe und letzte Änderung | Alle fünf Minuten |
| Prüfungen | Alle 15 Minuten, stündlich, alle 6 Stunden oder täglich, wie jede es angibt |
| Lineage und letzte Lesezugriffe aus dem Abfrageverlauf | Einmal pro Stunde, zurück bis zum letzten Lesen |

Jede Anweisung läuft schreibgeschützt, mit einem Timeout für Anweisungen und Sperren, wo die Engine sie kennt. Die Verbindungszeichenfolge wird nie protokolliert und aus jeder Fehlermeldung entfernt. Eine Statistik, die das Login nicht lesen darf, wird mit einem Hinweis an der Datenbank ausgelassen, nie mit einer fehlgeschlagenen Erfassung. Verbindungen zu privaten Adressen werden bei OneUptime Cloud abgelehnt: Verwenden Sie eine Sonde.

## Lesereplikate

Ein Lesereplikat von PostgreSQL oder SQL Server bewegt seine Schreibzähler nicht, sodass eine Tabelle dort unverändert wirken kann, während sie sich ändert. OneUptime erkennt, dass es ein Replikat ist, lässt die Zähler weg, sagt das an der Datenbank und fällt auf die Größe und die Zeilen der Tabelle zurück. Verbinden Sie, wo möglich, den Primärserver, oder nennen Sie für die wichtigen Tabellen eine [Freshness-Spalte](/docs/data-observability/table-health).

## Speicherpfade

Nicht alles, worauf Sie sich verlassen, liegt in einer Datenbank. Ein Export, der jede Nacht in einem Bucket landet, ist so verspätet oder so kurz wie jede Tabelle. Wählen Sie unter **Speicherpfade** **Pfade bearbeiten** für einen Bucket, den Ihre [Cloud-Verbindung](/docs/telemetry/cloud-accounts) gefunden hat, bei Amazon S3, Google Cloud Storage oder einem Azure-Speicherkonto, und nennen Sie die wichtigen Pfade, einen pro Zeile. Beginnen Sie bei Azure jeden mit dem Namen seines Containers.

Jeder Pfad erscheint dann unter **Tabellen**: Sein neuestes Objekt ist seine letzte Änderung, seine Objekte sind seine Zeilen und deren Größe seine Größe, und es gelten dieselben Warnungen. Es werden nur Namen, Größen und Zeiten gelesen, nie ein Objekt. Ein Pfad mit mehr als 10000 Objekten hat keine genaue Anzahl, Größe oder kein neuestes Objekt und sagt das: Nennen Sie einen engeren.

## Fehlerbehebung

- **Die Datenbank zeigt den Status Fehlgeschlagen.** Ihre Meldung sagt, warum: ein Host, den OneUptime nicht erreicht, ein abgelehntes Login, ein TLS-Modus, den der Server nicht akzeptiert. Verbinden Sie eine Datenbank innerhalb Ihres Netzwerks über eine Sonde.
- **Tabellen zeigen keine letzte Änderung.** Das Login kann die Statistiken der Engine nicht lesen: Gewähren Sie, was der Tab Ihrer Engine auflistet, oder warten Sie, bis sich die Zeilen einer Tabelle zweimal geändert haben.
- **Eine Tabelle fehlt.** Sie liegt in einem Schema, das das Login nicht nutzen kann, oder sie ist an der Datenbank ausgeschlossen. Gewähren Sie `USAGE` auf ihr Schema oder entfernen Sie den Ausschluss.
- **Eine MySQL-Tabelle hat keine Spalten.** Das Login braucht `REFERENCES`, wie oben: Es zeigt die Spalten einer Tabelle, ohne irgendeinen Lesezugriff auf ihre Zeilen zu geben.

## Nächste Schritte

:::cards
- [Tabellenzustand](/docs/data-observability/table-health): Was jede Erfassung über jede Tabelle lernt, und die Warnungen, die sie empfiehlt.
- [Prüfungen und Abgleiche](/docs/data-observability/checks): Regeln dafür, was eine Tabelle enthält.
:::
