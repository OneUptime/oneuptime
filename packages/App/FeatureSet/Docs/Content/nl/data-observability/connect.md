# Een database koppelen

Data-observability leest elke database met een login die alleen de catalogus ervan leest: welke tabellen en views erin staan, hun kolommen, rijen en grootte, en wanneer ze zijn gewijzigd. Deze pagina geeft wat elke engine minimaal nodig heeft, en hoe je de verbindingsreeks met een sonde binnen je netwerk houdt.

## Voordat je begint

- **Een rol die databases kan koppelen**: Projecteigenaar, Projectbeheerder of Telemetriebeheerder.
- **Een alleen-lezen login**, aangemaakt met de statements hieronder. Controles die je later toevoegt, lezen rijen van de tabellen die ze controleren, dus geef de login pas `SELECT` op die tabellen wanneer je er een toevoegt.

## Kies wie verbinding maakt

Kies op **Data Observability > Databases** de knop **Een database koppelen**, en dan:

- **OneUptime maakt verbinding**: plak een verbindingsreeks. Die wordt versleuteld opgeslagen, alleen door de workers van OneUptime gebruikt en nooit meer getoond.
- **Een sonde in mijn netwerk maakt verbinding**: kies een van je sondes en geef de naam op van de omgevingsvariabele op de sonde die de verbindingsreeks bevat, zoals `ORDERS_DB_URL`. De verbindingsreeks verlaat je netwerk nooit. Zie [Aangepaste sondes](/docs/probe/custom-probe).

Een database die al voor Gegevensbeveiliging is gekoppeld, wordt ook bewaakt, zonder dat je iets hoeft te koppelen, net als elke BigQuery-dataset die je [cloudkoppeling](/docs/telemetry/cloud-accounts) heeft gevonden.

## Databases die je kunt koppelen

**Databases die u kunt koppelen**, onder **Databases**, toont wat je project al kent en niemand heeft gekoppeld: databases waarmee je traces praten, databases in je cloudaccounts en databases die Database Monitoring bewaakt. **Koppelen** start het formulier vanuit wat van elk bekend is, met een verbindingsreeks om in te vullen. **Verbergen** voorkomt dat er een terugkomt. Er wordt niets gelezen totdat je hem koppelt.

## Een alleen-lezen login per engine

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

De verbindingsreeks: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime leest `pg_class`, `pg_stat_user_tables` en `pg_attribute`: een tabel is gewijzigd wanneer haar insert-, update- of delete-tellers bewogen, en gelezen wanneer haar scantellers dat deden.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

Met `performance_schema` ziet OneUptime schrijf- en leesacties tussen twee verzamelrondes; zonder dat zegt `information_schema.TABLES` nog steeds wanneer elke tabel voor het laatst is gewijzigd.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

Met `VIEW DATABASE STATE` leest OneUptime groottes, laatste updates en laatste leesacties.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Maak verbinding met een PostgreSQL-verbindingsreeks naar het endpoint van het cluster of de workgroup, zoals `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. Met `SYSLOG ACCESS UNRESTRICTED` leest OneUptime aantallen rijen en groottes, de laatste schrijf- en leesacties van elke gebruiker, en herkomst uit het querylog. Zonder dat zegt een wijziging in de rijen van een tabel nog steeds wanneer ze is gewijzigd.
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

Snowflake wordt gelezen via de SQL API, met sleutelpaarauthenticatie. Maak verbinding met JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

De catalogus wordt gelezen met `SHOW`, waarvoor geen warehouse nodig is, dus het verzamelen kost geen credits. Alleen controles draaien op het warehouse, volgens de planning die je ze geeft.
@tab Google BigQuery
Elke dataset die je cloudkoppeling heeft gevonden, wordt bewaakt met het serviceaccount van die koppeling. Geef het **BigQuery Metadata Viewer** en **BigQuery Job User** op het project om de catalogus te lezen, **BigQuery Data Viewer** op de tabellen die je controles lezen, en **BigQuery Resource Viewer** voor herkomst uit de jobs.

Elke verzamelronde leest de `__TABLES__` van de dataset (rijen, bytes en laatste wijziging, kosteloos) en de `INFORMATION_SCHEMA.COLUMNS` ervan (gefactureerd tegen het minimum van 10 MB van BigQuery). Om een dataset zonder cloudkoppeling te koppelen, geef je JSON op met een serviceaccountsleutel:

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

ClickHouse wordt gelezen via de HTTP-interface, poort 8443 met TLS (ClickHouse Cloud) of 8123 zonder: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Noem een database om alleen die te bewaken, of laat hem weg om elke database te bewaken behalve die van de server zelf. Met `system.parts` ziet OneUptime elke insert (een merge telt niet), `system.part_log` geeft, waar de server die bijhoudt, het tijdstip van elke insert, en `system.query_log` geeft eens per uur de laatste leesacties en de herkomst. Elk statement draait alleen-lezen, dus zelfs een login die zou kunnen schrijven, kan dat niet.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Eén catalogus van Unity Catalog is één database. Maak verbinding met een service principal, of met een persoonlijk toegangstoken als `"token"` in plaats van `clientId` en `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

De catalogus, de kolommen ervan en de laatste commit van elke Delta-tabel komen uit de REST API van Unity Catalog, zonder SQL-warehouse, dus het verzamelen kost geen rekenkracht. Controles, en herkomst en laatste leesacties uit `system.access.table_lineage` eens per uur, draaien op het SQL-warehouse dat je opgeeft; geef de service principal daarop **Can use**.
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle wordt gelezen via het eigen protocol, zonder een Oracle-client te installeren: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. De login ziet de tabellen die hij mag lezen: geef `READ` op elke tabel die bewaakt moet worden, zodat hij ze kan opvragen maar nooit vergrendelen of wijzigen. `SELECT_CATALOG_ROLE` laat OneUptime de grootte van elke tabel lezen, en `ALL_TAB_MODIFICATIONS` geeft de inserts, updates en deletes van elke tabel sinds de laatste statistieken, en wanneer hij voor het laatst wijzigde.
@tab Amazon Athena
Eén Glue-database is één database. De tabellen en views, hun kolommen en statistieken en de laatste commit van elke Iceberg-tabel komen uit de API van de Glue Data Catalog, die geen gegevens leest en niets kost. Controles draaien als Athena-query's in de workgroup die je opgeeft. Maak verbinding met de sleutels van een IAM-gebruiker of -rol die `glue:GetDatabase` en `glue:GetTables` mag aanroepen en voor controles Athena-query's in de workgroup mag uitvoeren met leestoegang tot de gegevens van de tabellen:

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

MongoDB wordt gelezen met de eigen driver: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/`, of `mongodb://` met de hosts van een replica set. Een database in het pad is de enige die bewaakt wordt; zonder pad wordt elke database bewaakt die de login mag lezen, en `{ role: "read", db: "orders" }` in plaats van `readAnyDatabase` beperkt hem tot één. De documenten, grootte en schrijfacties van elke collectie komen uit `$collStats`, en wanneer er voor het laatst een document bij kwam uit de nieuwste `_id`. De velden komen uit het JSON-schema van de validator, of anders uit de namen en typen van de velden van de 100 nieuwste documenten, in de database bepaald zodat geen waarde haar verlaat. Documenten worden gelezen op een secondary als die er is, en een aangepaste controle is een aggregatiepijplijn, als JSON.
:::

## Wat wordt gelezen, en hoe vaak

| Wat | Wanneer |
| --- | --- |
| Tabellen, views, kolommen, rijen, grootte en laatste wijziging | Elke vijf minuten |
| Controles | Elke 15 minuten, elk uur, elke 6 uur of elke dag, zoals elke controle aangeeft |
| Herkomst en laatste leesacties uit de querygeschiedenis | Eens per uur, terug tot de vorige uitlezing |

Elk statement draait alleen-lezen, met een statement- en lock-time-out waar de engine die heeft. De verbindingsreeks wordt nooit gelogd en uit elke foutmelding gehaald. Een statistiek die de login niet mag lezen, wordt weggelaten met een waarschuwing op de database; de verzamelronde mislukt er nooit door. Verbindingen met privéadressen worden geweigerd op OneUptime Cloud: gebruik een sonde.

## Read replica's

Een read replica van PostgreSQL of SQL Server verhoogt haar schrijftellers niet, dus een tabel daar kan ongewijzigd lijken terwijl ze wijzigt. OneUptime ziet dat het een replica is, laat de tellers weg, meldt dat op de database en valt terug op de grootte en rijen van de tabel. Koppel waar mogelijk de primary, of geef een [freshness-kolom](/docs/data-observability/table-health) op voor de tabellen die ertoe doen.

## Opslagpaden

Niet alles waar je op vertrouwt staat in een database. Een export die elke nacht in een bucket landt, is net zo laat of net zo kort als elke tabel. Kies onder **Opslagpaden** de optie **Paden bewerken** voor een bucket die je [cloudkoppeling](/docs/telemetry/cloud-accounts) heeft gevonden, op Amazon S3, Google Cloud Storage of een Azure-opslagaccount, en noem de paden die ertoe doen, één per regel. Begin bij Azure elk pad met de naam van de container.

Elk pad verschijnt dan onder **Tabellen**: het nieuwste object is het moment van de laatste wijziging, de objecten zijn de rijen en hun grootte is de grootte, en dezelfde waarschuwingen gelden. Alleen namen, groottes en tijden worden gelezen, nooit een object. Een pad met meer dan 10000 objecten heeft geen exact aantal, geen exacte grootte en geen exact nieuwste object, en meldt dat: noem een smaller pad.

## Probleemoplossing

- **De database toont Mislukt.** De melding zegt waarom: een host die OneUptime niet kan bereiken, een geweigerde login, een TLS-modus die de server niet accepteert. Koppel een database binnen je netwerk via een sonde.
- **Tabellen tonen geen laatste wijziging.** De login kan de statistieken van de engine niet lezen: verleen wat het tabblad van je engine opsomt, of wacht tot de rijen van een tabel twee keer zijn gewijzigd.
- **Er ontbreekt een tabel.** Die staat in een schema dat de login niet mag gebruiken, of is op de database uitgesloten. Verleen `USAGE` op het schema, of verwijder de uitsluiting.
- **Een MySQL-tabel heeft geen kolommen.** De login heeft `REFERENCES` nodig, zoals hierboven: het toont de kolommen van een tabel zonder enige leestoegang tot haar rijen.

## Volgende stappen

:::cards
- [Gezondheid van tabellen](/docs/data-observability/table-health): Wat elke verzamelronde over elke tabel leert, en de waarschuwingen die ze aanbeveelt.
- [Controles en reconciliaties](/docs/data-observability/checks): Regels voor wat een tabel bevat.
:::
