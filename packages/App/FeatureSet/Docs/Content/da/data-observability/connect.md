# Forbind en database

Dataobservabilitet læser hver database med et login, der kun læser dens katalog: hvilke tabeller og views den indeholder, deres kolonner, rækker og størrelse, og hvornår de blev ændret. Denne side viser det mindste, hver motor har brug for, og hvordan du holder forbindelsesstrengen inden for dit netværk med en sonde.

## Før du begynder

- **En rolle, der kan forbinde databaser**: Projektejer, Projektadministrator eller Telemetriadministrator.
- **Et skrivebeskyttet login**, oprettet med sætningerne nedenfor. Tjek, som du tilføjer senere, læser rækker i de tabeller, de tjekker, så giv først login `SELECT` på de tabeller, når du tilføjer et.

## Vælg, hvem der forbinder

Under **Dataobservabilitet > Databaser** vælger du **Forbind en database** og derefter:

- **OneUptime forbinder**: indsæt en forbindelsesstreng. Den gemmes krypteret, bruges kun af OneUptimes workers og vises aldrig igen.
- **En sonde i mit netværk forbinder**: vælg en af dine sonder, og angiv navnet på den miljøvariabel på sonden, der indeholder forbindelsesstrengen, f.eks. `ORDERS_DB_URL`. Forbindelsesstrengen forlader aldrig dit netværk. Se [Brugerdefinerede sonder](/docs/probe/custom-probe).

En database, der allerede er forbundet til Datasikkerhed, overvåges også, uden at du skal forbinde noget, og det samme gælder hvert BigQuery-datasæt, som din [cloudforbindelse](/docs/telemetry/cloud-accounts) har fundet.

## Databaser, du kan forbinde

**Databaser, du kan forbinde** under **Databaser** viser det, dit projekt allerede kender til, og som ingen har forbundet: databaser, dine spor taler med, databaser i dine cloudkonti og databaser, som Databaseovervågning overvåger. **Forbind** starter formularen ud fra det, der er kendt om hver, med en forbindelsesstreng at udfylde. **Skjul** forhindrer, at en kommer tilbage. Intet læses, før du forbinder den.

## Et skrivebeskyttet login pr. motor

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

Forbindelsesstrengen: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime læser `pg_class`, `pg_stat_user_tables` og `pg_attribute`: en tabel er ændret, når dens tællere for insert, update eller delete har flyttet sig, og læst, når dens scanningstællere har gjort det.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` lader OneUptime se skrivninger og læsninger mellem indsamlingerne; uden den viser `information_schema.TABLES` stadig, hvornår hver tabel sidst blev ændret.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` lader OneUptime læse størrelser, seneste opdateringer og seneste læsninger.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Forbind med en PostgreSQL-forbindelsesstreng til klyngens eller arbejdsgruppens endpoint, f.eks. `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` lader OneUptime læse antal rækker og størrelser, alle brugeres seneste skrivninger og læsninger og afstamning fra forespørgselsloggen. Uden den viser ændringer i en tabels rækker stadig, hvornår den blev ændret.
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

Snowflake læses via sit SQL API med nøgleparsgodkendelse. Forbind med JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

Kataloget læses med `SHOW`, som ikke kræver noget warehouse, så indsamlingen koster ingen credits. Kun tjek kører i warehouset, efter den tidsplan, du giver dem.
@tab Google BigQuery
Hvert datasæt, som din cloudforbindelse har fundet, overvåges med den forbindelses tjenestekonto. Giv den **BigQuery Metadata Viewer** og **BigQuery Job User** på projektet for at læse kataloget, **BigQuery Data Viewer** på de tabeller, dine tjek læser, og **BigQuery Resource Viewer** til afstamning fra dens jobs.

Hver indsamling læser datasættets `__TABLES__` (rækker, bytes og seneste ændring, uden omkostning) og dets `INFORMATION_SCHEMA.COLUMNS` (faktureret efter BigQuerys minimum på 10 MB). For at forbinde et datasæt uden en cloudforbindelse angiver du JSON med en nøgle til en tjenestekonto:

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

ClickHouse læses via sin HTTP-grænseflade, port 8443 med TLS (ClickHouse Cloud) eller 8123 uden: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Angiv en database for kun at overvåge den, eller udelad den for at overvåge alle databaser undtagen serverens egne. `system.parts` lader OneUptime se hver insert (en merge tæller ikke), `system.part_log` giver, hvor serveren fører den, tidspunktet for hver insert, og `system.query_log` giver seneste læsninger og afstamning én gang i timen. Hver sætning kører skrivebeskyttet, så selv et login med skriverettigheder kan ikke skrive.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Ét katalog i Unity Catalog er én database. Forbind med en service principal eller med et personligt adgangstoken som `"token"` i stedet for `clientId` og `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

Kataloget, dets kolonner og hver Delta-tabels seneste commit kommer fra Unity Catalogs REST API uden noget SQL-warehouse, så indsamlingen koster ingen beregningskraft. Tjek samt afstamning og seneste læsninger fra `system.access.table_lineage` én gang i timen kører i det SQL-warehouse, du angiver; giv din service principal **Can use** på det.
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle læses over sin egen protokol uden en Oracle-klient at installere: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. Brugeren ser de tabeller, den må læse: giv `READ` på hver tabel, der skal overvåges, så den kan forespørge dem og aldrig låse eller ændre dem. `SELECT_CATALOG_ROLE` lader OneUptime læse hver tabels størrelse, og `ALL_TAB_MODIFICATIONS` giver hver tabels inserts, updates og deletes siden dens seneste statistik, og hvornår den sidst ændrede sig.
@tab Amazon Athena
Én Glue-database er én database. Dens tabeller og visninger, deres kolonner og statistik og hver Iceberg-tabels seneste commit kommer fra Glue Data Catalogs API, som ikke læser data og ikke koster noget. Tjek kører som Athena-forespørgsler i den workgroup, du angiver. Forbind med nøglerne til en IAM-bruger eller -rolle, der må kalde `glue:GetDatabase` og `glue:GetTables` og til tjek køre Athena-forespørgsler i workgroupen med læseadgang til tabellernes data:

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

MongoDB læses med sin egen driver: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/` eller `mongodb://` med et replica sets værter. En database i stien er den eneste, der overvåges; uden en overvåges hver database, brugeren må læse, og `{ role: "read", db: "orders" }` i stedet for `readAnyDatabase` begrænser den til én. Hver samlings dokumenter, størrelse og skrivninger kommer fra `$collStats`, og hvornår den sidst fik et dokument, fra dens nyeste `_id`. Dens felter kommer fra dens validators JSON-skema, ellers fra navnene og typerne på felterne i dens 100 nyeste dokumenter, udregnet i databasen, så ingen værdi forlader den. Dokumenter læses på en sekundær, hvor der er en, og en brugerdefineret kontrol er en aggregeringspipeline som JSON.
:::

## Hvad der læses, og hvor ofte

| Hvad | Hvornår |
| --- | --- |
| Tabeller, views, kolonner, rækker, størrelse og seneste ændring | Hvert femte minut |
| Tjek | Hvert 15. minut, hver time, hver 6. time eller hver dag, som hvert tjek angiver |
| Afstamning og seneste læsninger fra forespørgselshistorikken | Én gang i timen, tilbage til den seneste læsning |

Hver sætning kører skrivebeskyttet, med en tidsgrænse for sætninger og låse, hvor motoren har dem. Forbindelsesstrengen logges aldrig og fjernes fra hver fejlmeddelelse. En statistik, som login ikke må læse, udelades med en advarsel på databasen; indsamlingen mislykkes aldrig af den grund. Forbindelser til private adresser afvises på OneUptime Cloud: brug en sonde.

## Læsereplikaer

En PostgreSQL- eller SQL Server-læsereplika flytter ikke sine skrivetællere, så en tabel dér kan se uændret ud, mens den ændrer sig. OneUptime ser, at det er en replika, udelader tællerne, siger det på databasen og falder tilbage til tabellens størrelse og rækker. Forbind primærdatabasen, hvor du kan, eller angiv en [friskhedskolonne](/docs/data-observability/table-health) for de tabeller, der betyder noget.

## Lagerstier

Ikke alt, du er afhængig af, ligger i en database. En eksport, der lander i en bucket hver nat, er lige så forsinket eller lige så kort som enhver tabel. Under **Lagerstier** vælger du **Rediger stier** for en bucket, som din [cloudforbindelse](/docs/telemetry/cloud-accounts) har fundet, på Amazon S3, Google Cloud Storage eller en Azure-lagerkonto, og angiver de stier, der betyder noget, én pr. linje. På Azure skal hver starte med containerens navn.

Hver sti vises derefter under **Tabeller**: dens nyeste objekt er, hvornår den sidst blev ændret, dens objekter er dens rækker, og deres størrelse er dens størrelse, og de samme advarsler gælder. Kun navne, størrelser og tidspunkter læses, aldrig et objekt. En sti med mere end 10000 objekter har intet nøjagtigt antal, ingen nøjagtig størrelse og intet nøjagtigt nyeste objekt og siger det: angiv en smallere.

## Fejlfinding

- **Databasen viser Mislykkedes.** Dens meddelelse siger hvorfor: en vært, OneUptime ikke kan nå, et afvist login, en TLS-tilstand, serveren ikke accepterer. Forbind en database inde i dit netværk via en sonde.
- **Tabeller viser ingen seneste ændring.** Login kan ikke læse motorens statistik: giv det, som fanen for din motor viser, eller vent, til en tabels rækker har ændret sig to gange.
- **En tabel mangler.** Den ligger i et skema, som login ikke må bruge, eller den er udelukket på databasen. Giv `USAGE` på dens skema, eller fjern udelukkelsen.
- **En MySQL-tabel har ingen kolonner.** Login skal have `REFERENCES`, som ovenfor: det viser en tabels kolonner uden at give nogen læsning af dens rækker.

## Næste trin

:::cards
- [Tabellernes tilstand](/docs/data-observability/table-health): Hvad hver indsamling lærer om hver tabel, og de advarsler, den anbefaler.
- [Kontroller og afstemninger](/docs/data-observability/checks): Regler for det, en tabel indeholder.
:::
