# Koble til en database

Dataobserverbarhet leser hver database med en bruker som bare leser katalogen: hvilke tabeller og visninger den inneholder, kolonnene, radene og størrelsen deres, og når de ble endret. Denne siden viser det minste hver databasemotor trenger, og hvordan du holder tilkoblingsstrengen inne i nettverket ditt med en sonde.

## Før du begynner

- **En rolle som kan koble til databaser**: Prosjekteier, Prosjektadministrator eller Telemetriadministrator.
- **En skrivebeskyttet bruker**, opprettet med setningene nedenfor. Sjekker du legger til senere, leser rader i tabellene de sjekker, så gi brukeren `SELECT` på de tabellene først når du legger til en sjekk.

## Velg hvem som kobler til

Under **Dataobserverbarhet > Databaser** velger du **Connect a Database**, og deretter:

- **OneUptime connects**: lim inn en tilkoblingsstreng. Den lagres kryptert, brukes bare av OneUptimes workers og vises aldri igjen.
- **A probe in my network connects**: velg en av sondene dine, og oppgi navnet på miljøvariabelen på sonden som inneholder tilkoblingsstrengen, for eksempel `ORDERS_DB_URL`. Tilkoblingsstrengen forlater aldri nettverket ditt. Se [Egendefinerte probes](/docs/probe/custom-probe).

En database som allerede er koblet til for Datasikkerhet, overvåkes også, uten at du trenger å koble til noe, og det samme gjelder hvert BigQuery-datasett [skytilkoblingen](/docs/telemetry/cloud-accounts) din har funnet.

## Databaser du kan koble til

**Databaser du kan koble til**, under **Databaser**, lister det prosjektet ditt allerede kjenner til og ingen har koblet til: databaser sporene dine snakker med, databaser i skykontoene dine, og databaser Databaseovervåking overvåker. **Koble til** starter skjemaet ut fra det som er kjent om hver av dem, med en tilkoblingsstreng du fyller ut. **Skjul** hindrer at en kommer tilbake. Ingenting leses før du kobler den til.

## En skrivebeskyttet bruker, per databasemotor

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

Tilkoblingsstrengen: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime leser `pg_class`, `pg_stat_user_tables` og `pg_attribute`: en tabell er endret når tellerne for innsettinger, oppdateringer eller slettinger har flyttet seg, og lest når skanntellerne har gjort det.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` lar OneUptime se skrivinger og lesinger mellom innsamlingene; uten den viser `information_schema.TABLES` likevel når hver tabell sist ble endret.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` lar OneUptime lese størrelser, siste oppdateringer og siste lesinger.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Koble til med en PostgreSQL-tilkoblingsstreng til endepunktet for klyngen eller arbeidsgruppen, for eksempel `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` lar OneUptime lese antall rader og størrelser, alle brukeres siste skrivinger og lesinger, og avstamning fra spørringsloggen. Uten den viser endringer i antall rader i en tabell likevel når tabellen ble endret.
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

Snowflake leses gjennom SQL API-et med nøkkelparautentisering. Koble til med JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

Katalogen leses med `SHOW`, som ikke trenger noe warehouse, så innsamlingen koster ingen kreditter. Bare sjekker kjører på warehouset, etter tidsplanen du gir dem.
@tab Google BigQuery
Hvert datasett skytilkoblingen din har funnet, overvåkes med tjenestekontoen til den tilkoblingen. Gi den **BigQuery Metadata Viewer** og **BigQuery Job User** på prosjektet for å lese katalogen, **BigQuery Data Viewer** på tabellene sjekkene dine leser, og **BigQuery Resource Viewer** for avstamning fra jobbene.

Hver innsamling leser datasettets `__TABLES__` (rader, byte og siste endring, uten kostnad) og `INFORMATION_SCHEMA.COLUMNS` (fakturert etter BigQuerys minimum på 10 MB). For å koble til et datasett uten en skytilkobling oppgir du JSON med en nøkkel for en tjenestekonto:

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

ClickHouse leses gjennom HTTP-grensesnittet, port 8443 med TLS (ClickHouse Cloud) eller 8123 uten: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Oppgi en database for å overvåke bare den, eller utelat den for å overvåke alle databaser unntatt serverens egne. `system.parts` lar OneUptime se hver innsetting (en sammenslåing teller ikke), `system.part_log`, der serveren fører den, gir tidspunktet for hver innsetting, og `system.query_log` gir siste lesinger og avstamning én gang i timen. Hver setning kjører skrivebeskyttet, så selv en bruker som kunne ha skrevet, kan ikke gjøre det.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Én katalog i Unity Catalog er én database. Koble til med en service principal, eller med et personlig tilgangstoken som `"token"` i stedet for `clientId` og `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

Katalogen, kolonnene og siste commit for hver Delta-tabell kommer fra REST API-et til Unity Catalog uten noe SQL warehouse, så innsamlingen koster ingen beregningskapasitet. Sjekker, samt avstamning og siste lesinger fra `system.access.table_lineage` én gang i timen, kjører på SQL warehouset du oppgir; gi service principalen **Can use** på det.
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle leses over sin egen protokoll uten en Oracle-klient å installere: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. Brukeren ser tabellene den kan lese: gi `READ` på hver tabell som skal overvåkes, slik at den kan spørre mot dem og aldri låse eller endre dem. `SELECT_CATALOG_ROLE` lar OneUptime lese hver tabells størrelse, og `ALL_TAB_MODIFICATIONS` gir hver tabells inserts, updates og deletes siden siste statistikk, og når den sist endret seg.
@tab Amazon Athena
Én Glue-database er én database. Tabellene og visningene, kolonnene og statistikken deres og hver Iceberg-tabells siste commit kommer fra Glue Data Catalogs API, som ikke leser data og ikke koster noe. Sjekker kjøres som Athena-spørringer i workgroupen du oppgir. Koble til med nøklene til en IAM-bruker eller -rolle som kan kalle `glue:GetDatabase` og `glue:GetTables` og for sjekker kjøre Athena-spørringer i workgroupen med lesetilgang til tabellenes data:

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

MongoDB leses med sin egen driver: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/` eller `mongodb://` med vertene til et replica set. En database i stien er den eneste som overvåkes; uten en overvåkes hver database brukeren kan lese, og `{ role: "read", db: "orders" }` i stedet for `readAnyDatabase` begrenser den til én. Dokumentene, størrelsen og skrivingene til hver samling kommer fra `$collStats`, og når den sist fikk et dokument, fra dens nyeste `_id`. Feltene kommer fra validatorens JSON-skjema, ellers fra navnene og typene til feltene i de 100 nyeste dokumentene, regnet ut i databasen slik at ingen verdi forlater den. Dokumenter leses på en sekundær der det finnes en, og en egendefinert kontroll er en aggregeringspipeline som JSON.
:::

## Hva som leses, og hvor ofte

| Hva | Når |
| --- | --- |
| Tabeller, visninger, kolonner, rader, størrelse og siste endring | Hvert femte minutt |
| Sjekker | Hvert 15. minutt, hver time, hver 6. time eller hver dag, slik hver sjekk angir |
| Avstamning og siste lesinger fra spørringshistorikken | Én gang i timen, tilbake til forrige lesing |

Hver setning kjører skrivebeskyttet, med tidsavbrudd for setninger og låser der databasemotoren har det. Tilkoblingsstrengen logges aldri og fjernes fra hver feilmelding. En statistikk brukeren ikke har lov til å lese, utelates med en advarsel på databasen, og gir aldri en mislykket innsamling. Tilkoblinger til private adresser avvises på OneUptime Cloud: bruk en sonde.

## Lesereplikaer

En lesereplika i PostgreSQL eller SQL Server flytter ikke skrivetellerne sine, så en tabell der kan se uendret ut mens den endres. OneUptime ser at det er en replika, utelater tellerne, sier fra om det på databasen, og faller tilbake på tabellens størrelse og rader. Koble til primærdatabasen der du kan, eller oppgi en [aktualitetskolonne](/docs/data-observability/table-health) for tabellene som betyr noe.

## Lagringsstier

Ikke alt du er avhengig av ligger i en database. Et eksport som havner i en bucket hver natt, er like forsinket, eller like kort, som en hvilken som helst tabell. Under **Lagringsstier** velger du **Rediger stier** for en bucket [skytilkoblingen](/docs/telemetry/cloud-accounts) din fant, på Amazon S3, Google Cloud Storage eller en Azure-lagringskonto, og oppgir stiene som betyr noe, én per linje. På Azure starter du hver med containerens navn.

Hver sti vises deretter under **Tabeller**: det nyeste objektet er når den sist ble endret, objektene er radene, og størrelsen deres er størrelsen, og de samme varslene gjelder. Bare navn, størrelser og tidspunkter leses, aldri et objekt. En sti med mer enn 10000 objekter har ikke noe eksakt antall, noen eksakt størrelse eller noe eksakt nyeste objekt, og sier fra om det: oppgi en smalere.

## Feilsøking

- **Innsamlingen fra databasen mislykkes.** Meldingen sier hvorfor: en vert OneUptime ikke når, en pålogging som avvises, en TLS-modus serveren ikke godtar. En database inne i nettverket ditt kobler du til gjennom en sonde.
- **Tabeller viser ingen siste endring.** Brukeren kan ikke lese databasemotorens statistikk: gi det fanen for databasemotoren din viser, eller vent til antall rader i en tabell har endret seg to ganger.
- **En tabell mangler.** Den ligger i et skjema brukeren ikke kan bruke, eller den er utelatt på databasen. Gi `USAGE` på skjemaet, eller fjern utelatelsen.
- **En MySQL-tabell har ingen kolonner.** Brukeren trenger `REFERENCES`, som ovenfor: det viser kolonnene i en tabell uten å gi noen lesing av radene.

## Neste steg

:::cards
- [Tabellhelse](/docs/data-observability/table-health): Hva hver innsamling lærer om hver tabell, og varslene den anbefaler.
- [Kontroller og avstemminger](/docs/data-observability/checks): Regler for hva en tabell inneholder.
:::
