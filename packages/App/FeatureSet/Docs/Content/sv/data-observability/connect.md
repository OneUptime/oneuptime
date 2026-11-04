# Anslut en databas

Dataobserverbarhet läser varje databas med en inloggning som bara läser dess katalog: vilka tabeller och vyer den innehåller, deras kolumner, rader och storlek, och när de ändrades. Den här sidan anger det minsta som varje motor behöver, och hur du håller anslutningssträngen inom ditt nätverk med en sond.

## Innan du börjar

- **En roll som kan ansluta databaser**: Projektägare, Projektadministratör eller Telemetriadministratör.
- **En inloggning som bara kan läsa**, skapad med satserna nedan. Kontroller som du lägger till senare läser rader i de tabeller de kontrollerar, så ge inloggningen `SELECT` på de tabellerna först när du lägger till en.

## Välj vem som ansluter

Under **Dataobserverbarhet > Databaser** väljer du **Connect a Database**, och sedan:

- **OneUptime connects**: klistra in en anslutningssträng. Den lagras krypterad, används bara av OneUptimes workers och visas aldrig igen.
- **A probe in my network connects**: välj en av dina sonder och ange namnet på den miljövariabel på sonden som innehåller anslutningssträngen, till exempel `ORDERS_DB_URL`. Anslutningssträngen lämnar aldrig ditt nätverk. Se [Anpassade sonder](/docs/probe/custom-probe).

En databas som redan är ansluten för Datasäkerhet övervakas också, utan något att ansluta, och detsamma gäller varje BigQuery-dataset som din [molnanslutning](/docs/telemetry/cloud-accounts) har hittat.

## En inloggning som bara kan läsa, per motor

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

Anslutningssträngen: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime läser `pg_class`, `pg_stat_user_tables` och `pg_attribute`: en tabell har ändrats när dess räknare för insert, update eller delete har rört sig, och lästs när dess skanningsräknare har gjort det.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` låter OneUptime se skrivningar och läsningar mellan insamlingarna; utan den visar `information_schema.TABLES` ändå när varje tabell senast ändrades.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` låter OneUptime läsa storlekar, senaste uppdateringar och senaste läsningar.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Anslut med en PostgreSQL-anslutningssträng till klustrets eller arbetsgruppens endpoint, till exempel `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` låter OneUptime läsa antal rader och storlekar, alla användares senaste skrivningar och läsningar, och härkomst från frågeloggen. Utan den visar ändringar i en tabells rader ändå när den ändrades.
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

Snowflake läses via sitt SQL-API med nyckelparsautentisering. Anslut med JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

Katalogen läses med `SHOW`, som inte behöver något warehouse, så insamlingen kostar inga krediter. Bara kontroller körs i warehouset, enligt det schema du ger dem.
@tab Google BigQuery
Varje dataset som din molnanslutning har hittat övervakas med den anslutningens tjänstkonto. Ge det **BigQuery Metadata Viewer** och **BigQuery Job User** på projektet för att läsa katalogen, **BigQuery Data Viewer** på de tabeller som dina kontroller läser, och **BigQuery Resource Viewer** för härkomst från dess jobb.

Varje insamling läser datasetets `__TABLES__` (rader, byte och senaste ändring, utan kostnad) och dess `INFORMATION_SCHEMA.COLUMNS` (debiteras enligt BigQuerys minimum på 10 MB). För att ansluta ett dataset utan molnanslutning anger du JSON med en tjänstkontonyckel:

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

ClickHouse läses via sitt HTTP-gränssnitt, port 8443 med TLS (ClickHouse Cloud) eller 8123 utan: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Ange en databas för att bara övervaka den, eller utelämna den för att övervaka alla databaser utom serverns egna. `system.parts` låter OneUptime se varje insert (en merge räknas inte), `system.part_log`, där servern för den, ger tidpunkten för varje insert, och `system.query_log` ger senaste läsningar och härkomst en gång i timmen. Varje sats körs med enbart läsbehörighet, så inte ens en inloggning som skulle kunna skriva kan göra det.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

En katalog i Unity Catalog är en databas. Anslut med ett tjänsthuvudnamn, eller med en personlig åtkomsttoken som `"token"` i stället för `clientId` och `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

Katalogen, dess kolumner och varje Delta-tabells senaste commit kommer från Unity Catalogs REST-API utan något SQL-warehouse, så insamlingen kostar ingen beräkningskapacitet. Kontroller, samt härkomst och senaste läsningar från `system.access.table_lineage` en gång i timmen, körs i det SQL-warehouse som du anger; ge tjänsthuvudnamnet **Can use** på det.
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle läses över sitt eget protokoll, utan någon Oracle-klient att installera: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. Inloggningen ser de tabeller den får läsa: ge `READ` på varje tabell som ska bevakas, vilket låter den fråga mot dem men aldrig låsa eller ändra dem. `SELECT_CATALOG_ROLE` låter OneUptime läsa varje tabells storlek, och `ALL_TAB_MODIFICATIONS` ger varje tabells inserts, updates och deletes sedan dess senaste statistik, och när den senast ändrades.
@tab Amazon Athena
En Glue-databas är en databas. Dess tabeller och vyer, deras kolumner och statistik och varje Iceberg-tabells senaste commit kommer från Glue Data Catalogs API, som inte läser några data och inte kostar något. Kontroller körs som Athena-frågor i den workgroup du anger. Anslut med nycklarna för en IAM-användare eller -roll som får anropa `glue:GetDatabase` och `glue:GetTables` och för kontroller köra Athena-frågor i workgroupen med läsåtkomst till tabellernas data:

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

MongoDB läses med sin egen drivrutin: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/` eller `mongodb://` med ett replica sets värdar. En databas i sökvägen är den enda som bevakas; utan en bevakas varje databas som inloggningen får läsa, och `{ role: "read", db: "orders" }` i stället för `readAnyDatabase` begränsar den till en. Varje samlings dokument, storlek och skrivningar kommer från `$collStats`, och när den senast fick ett dokument från dess nyaste `_id`. Dess fält kommer från validatorns JSON-schema, annars från namnen och typerna på fälten i dess 100 nyaste dokument, beräknade i databasen så att inget värde lämnar den. Dokument läses på en sekundär där det finns en, och en anpassad kontroll är en aggregeringspipeline som JSON.
:::

## Vad som läses, och hur ofta

| Vad | När |
| --- | --- |
| Tabeller, vyer, kolumner, rader, storlek och senaste ändring | Var femte minut |
| Kontroller | Var 15:e minut, varje timme, var 6:e timme eller varje dag, enligt vad var och en anger |
| Härkomst och senaste läsningar från frågehistoriken | En gång i timmen, tillbaka till den senaste läsningen |

Varje sats körs med enbart läsbehörighet, med en tidsgräns för satser och lås där motorn har sådana. Anslutningssträngen loggas aldrig och tas bort ur varje felmeddelande. En statistik som inloggningen inte får läsa utelämnas med en varning på databasen; insamlingen misslyckas aldrig på grund av det.

## Felsökning

- **Databasen visar Misslyckades.** Dess meddelande säger varför: en värd som OneUptime inte kan nå, en inloggning som nekades, ett TLS-läge som servern inte accepterar. Anslut en databas inuti ditt nätverk via en sond.
- **Tabeller visar ingen senaste ändring.** Inloggningen kan inte läsa motorns statistik: bevilja det som fliken för din motor listar, eller vänta tills en tabells rader har ändrats två gånger.
- **En tabell saknas.** Den ligger i ett schema som inloggningen inte får använda, eller så är den undantagen i databasen. Bevilja `USAGE` på dess schema, eller ta bort undantaget.

## Nästa steg

:::cards
- [Tabellhälsa](/docs/data-observability/table-health): Vad varje insamling lär sig om varje tabell, och de larm den rekommenderar.
- [Kontroller och avstämningar](/docs/data-observability/checks): Regler för vad en tabell innehåller.
:::
