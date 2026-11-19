/*
 * The Data Observability Documentation page in Swedish: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Swedish words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Vad Data Observability bevakar

Varje tabell och varje vy i varje ansluten databas, var femte minut:

- **Antal rader och storlek**, från motorns egen statistik.
- **När den senast ändrades**: MySQL och SQL Server rapporterar det; för PostgreSQL följer OneUptime räknarna för infogningar, uppdateringar och borttagningar och noterar när de rör sig.
- **Dess kolumner**: en kolumn som läggs till, tas bort, byter namn, byter typ eller görs nullable hamnar på tabellens tidslinje och under Schemaändringar.
- **Dess vanliga rytm**: hur ofta den brukar ändras. En tabell som går långt förbi sin rytm visas som **Sen**.

Bara databasens katalog läses, och på MongoDB fältnamnen i en samlings senaste dokument. Inget värde lämnar databasen.

En katalog kan säga att en tabell har ändrats när bara dess interna underhåll har gjort det, eller inte säga något alls. Ange i en tabells **Inställningar** en **Aktualitetskolumn** som \`updated_at\`, så blir dess senaste ändring den kolumnens nyaste värde. Inloggningen måste kunna läsa kolumnen, och den bör vara indexerad.

En läsreplik av PostgreSQL eller SQL Server rör inte sina skrivräknare, så OneUptime utelämnar dem där och säger det på databasen.

## Översikten

**Översikt** visar hur dina data står till just nu. Tills projektet är konfigurerat listar den de steg som återstår: larm på varje databas, ägare till tabellerna, en kontroll och dina pipeline-körningar. **Kräver åtgärd** listar det som behöver någon, det värsta först: en databas som inte kunde läsas, en pipeline-körning som misslyckades eller är sen, en kontroll som misslyckas eller inte kunde köras, en avstämning som har glidit isär, och en dataprodukt eller tabell som är sen. Varje punkt säger vem den tillhör och om dess larm är öppet, eller att ingen meddelas eftersom dess databas inte har något larm påslaget, och öppnar sidan där den åtgärdas. **Databaser** visar hur den senaste läsningen av varje databas gick och om dess larm är påslagna. Talet vid **Översikt** i menyn räknar det som kräver någon, och **Problem**, strax under, visar vart och ett, en sida i taget, filtrerat på typ, databas, ägare (eller **Ingen ägare**) och om ett larm är öppet. Varje tal på **Översikt** öppnar sin lista: **Kräver åtgärd** öppnar **Problem**, **Sena tabeller** öppnar **Tabeller** med bara de sena, och **Misslyckade kontroller** öppnar **Kontroller** med bara de som misslyckas.

## Anslut en databas

Använd en **skrivskyddad inloggning**. Välj **Anslut en databas** i översikten eller under Databaser, och sedan något av detta:

- **OneUptime ansluter**: klistra in en anslutningssträng. Den lagras krypterad och visas aldrig igen.
- **En sond i mitt nätverk ansluter**: välj en av projektets sonder och ange den miljövariabel på sonden som innehåller anslutningssträngen (till exempel \`ORDERS_DB_URL\`). Anslutningssträngen lämnar aldrig ditt nätverk. Uppdatera sonden till den senaste versionen först.

En databas som redan är ansluten för Datasäkerhet bevakas också.

**Databaser du kan ansluta**, på samma sida, listar det som ditt projekt redan känner till och som ingen har anslutit: databaser som dina spårningar pratar med, databaser i dina molnkonton och databaser som Databasövervakning bevakar. **Anslut** fyller i formuläret i förväg med det som är känt om var och en. Inget läses förrän du ansluter den.

## Lagringssökvägar

En export som hamnar i en bucket varje natt kan vara lika sen, eller lika ofullständig, som vilken tabell som helst. Under **Lagringssökvägar** väljer du **Redigera sökvägar** för en bucket som din molnanslutning har hittat, på Amazon S3, Google Cloud Storage eller ett Azure-lagringskonto, och anger de sökvägar som spelar roll, en per rad. Var och en visas under **Tabeller**: dess nyaste objekt är när den senast ändrades, dess objekt är dess rader, och samma larm gäller. Bara namn, storlekar och tider läses, aldrig ett objekt.

### En skrivskyddad inloggning, per motor

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL och MariaDB (\`performance_schema\` låter OneUptime se skrivningar mellan insamlingarna):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` låter OneUptime läsa storlekar och senaste uppdateringar):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: anslut med en PostgreSQL-anslutningssträng till klustrets eller arbetsgruppens endpoint, till exempel \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\` låter OneUptime läsa antal rader och storlekar (\`svv_table_info\`), de senaste skrivningarna och läsningarna från varje användares frågor (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, som sparas i några dagar) och härkomsten för varje användares frågor. Utan den säger en ändring i en tabells rader ändå när den ändrades.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: skapa en användare med ett nyckelpar (inget lösenord) och anslut med JSON som anger kontoidentifieraren, användaren, den privata nyckeln (okrypterad PKCS#8), databasen och ett warehouse för kontroller:

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

Insamlingen läser katalogen med SHOW, som inte behöver något warehouse, så den kostar inga credits. Bara datakontroller körs på warehouset, enligt det schema du ger dem. Snowflake anger inte någon tabells senaste ändring, så en tabell har ändrats när dess rader eller byte har rört sig.

\`\`\`sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
-- Warehouse spend reads SNOWFLAKE.ACCOUNT_USAGE.
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
-- Checks read rows: SELECT on the tables they check.
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
\`\`\`

Google BigQuery: varje dataset som din Google Cloud-anslutning har hittat bevakas redan, med anslutningens tjänstkonto, utan något att ansluta. Ge tjänstkontot **BigQuery Metadata Viewer** och **BigQuery Job User** på projektet, och **BigQuery Data Viewer** på de tabeller som dina kontroller läser. Varje insamling läser datasetets \`__TABLES__\` (rader, byte och senaste ändring, utan kostnad) och dess \`INFORMATION_SCHEMA.COLUMNS\` (debiteras enligt BigQuerys minimum på 10 MB). Lägg till **BigQuery Resource Viewer** på projektet för härkomst från dess jobb, läst en gång i timmen (se Härkomst som databaserna anger). För att ansluta ett dataset utan en Google Cloud-anslutning väljer du **Google BigQuery** och anger JSON med en nyckel för ett tjänstkonto:

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: anslut via dess HTTP-gränssnitt, port 8443 med TLS (ClickHouse Cloud) eller 8123 utan, till exempel \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Ange en databas för att bara bevaka den; utelämna den för att bevaka alla databaser utom serverns egna. \`system.parts\` låter OneUptime se varje infogning mellan insamlingarna (en merge räknas inte), \`system.part_log\` ger, där servern för den, tiden för varje infogning, och \`system.query_log\` ger varje tabells senaste läsning och härkomst från \`INSERT ... SELECT\`, en gång i timmen. Varje sats körs med \`readonly\` satt, så att inte ens en inloggning som skulle kunna skriva kan göra det.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: en Unity Catalog-katalog är en databas. Dess scheman, tabeller, vyer och kolumner, och varje Delta-tabells senaste commit, läses från Unity Catalogs REST-API utan SQL-warehouse, så insamlingen kostar ingen beräkning. Datakontroller, och härkomst, senaste skrivningar och senaste läsningar från systemtabellen \`system.access.table_lineage\` (en gång i timmen), körs på det SQL-warehouse du anger. Anslut med ett tjänsthuvudnamn (eller en personlig åtkomsttoken i stället för \`clientId\` och \`clientSecret\`: \`"token": "dapi..."\`):

\`\`\`json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
\`\`\`

\`\`\`sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE SCHEMA ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE CATALOG ON CATALOG system TO \`oneuptime-reader\`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO \`oneuptime-reader\`;
-- Checks read rows: SELECT on the tables they check. And CAN USE on the SQL warehouse.
\`\`\`

Oracle: anslut med \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\`, eller JSON \`{ "user", "password", "connectString" }\`. Läsningen sker över Oracles eget protokoll, utan någon Oracle-klient att installera. Inloggningen ser de tabeller den får läsa: bevilja \`READ\` på varje tabell som ska bevakas (den kan fråga dem, aldrig låsa eller ändra dem). \`SELECT_CATALOG_ROLE\` låter OneUptime läsa varje tabells storlek; utan den har bara inloggningens egna tabeller en. \`ALL_TAB_MODIFICATIONS\` anger varje tabells infogningar, uppdateringar och borttagningar sedan dess senaste statistik, och när den senast ändrades.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: en Glue-databas är en databas. Dess tabeller och vyer, deras kolumner och statistik, och varje Iceberg-tabells senaste commit kommer från Glue Data Catalogs API, som inte läser några data och inte kostar något; kontroller körs som Athena-frågor i den arbetsgrupp du anger. Anslut med nycklarna för en IAM-användare eller -roll som får läsa Glue-databasen och köra Athena-frågor:

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

Den behöver \`glue:GetDatabase\` och \`glue:GetTables\` på databasen och dess tabeller, och för kontroller \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` och \`athena:StopQueryExecution\` på arbetsgruppen, med läsåtkomst till tabellernas S3-data och skrivåtkomst till utdataplatsen.

MongoDB: anslut med dess anslutningssträng - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`, eller \`mongodb://\` med en replikuppsättnings värdar. En databas i sökvägen är den enda som bevakas; utan en bevakas varje databas som inloggningen får läsa. Varje samlings dokument, storlek och skrivningar kommer från \`$collStats\`, och när den senast tog emot ett dokument, från dess nyaste \`_id\`. Dess fält kommer från dess validerares JSON-schema, eller annars från namnen och typerna på fälten i dess 100 senaste dokument, beräknade i databasen så att inget värde lämnar den. Dokument läses på en sekundär där det finns en. En vys källsamling är härkomst, och en anpassad kontroll är en aggregeringspipeline, som JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

För att bara bevaka en databas beviljar du \`{ role: "read", db: "orders" }\` i stället för \`readAnyDatabase\`.

Microsoft Dataverse: en miljö är en databas, med dess tabeller i \`dbo\`, som dess SQL-endpoint namnger dem. OneUptime loggar in som en app: registrera en i Microsoft Entra ID med en klienthemlighet och lägg till den i miljön som programanvändare (Power Platform admin center > the environment > Settings > Users + permissions > Application users) med en säkerhetsroll som får läsa tabellerna. Anslut med JSON, eller med en Dataverse-anslutningssträng som anger \`AuthType=ClientSecret\`. Klientorganisationen kan utelämnas: miljön säger vilken den finns i.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

Var femte minut ger Web API varje tabells definition, dess rader, från den ögonblicksbild som Dataverse tar en gång om dagen (de släpar alltså efter med upp till en dag), och dess nyaste \`modifiedon\`, som är när den senast ändrades. Dess kolumner läses en gång i timmen. Varje läsning räknas mot appens begärandegränser i Dataverse, och en insamling som ombeds sakta ner lämnar resten till nästa. En miljö innehåller hundratals egna tabeller, så bara de centrala affärstabellerna (konton, kontakter, leads, affärsmöjligheter, offerter, order, fakturor, produkter, ärenden, e-postmeddelanden, telefonsamtal, avtalade tider, uppgifter och anteckningar) och dina egna anpassade tabeller bevakas. Tabeller från Microsofts appar (\`msdyn_\`, \`adx_\` och de andra \`ms\`-prefixen) utelämnas: ange vilken annan tabell som helst som ska bevakas, som i \`"tables": ["msdyn_workorder"]\`.

Datakontroller körs som skrivskyddad SQL på miljöns TDS-endpoint, på port 1433 eller 5558. Den är påslagen om inte en administratör har stängt av den; där åtkomstkontroll på användarnivå är påslagen för den behöver appens roll behörigheten **Allow user to access TDS endpoint**. Dess SQL har inga reguljära uttryck, inget \`WITH\` och inget stickprov.

## Mätvärden som varje tabell skriver

Varje insamling skriver dessa för varje tabell, så att du kan visa dem i diagram, lägga dem på instrumentpaneler och larma på dem som på vilket annat mätvärde som helst:

| Mätvärde | Vad det är |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Rader i tabellen |
| \`oneuptime.data.table.size\` | Byte som tabellen och dess index tar upp |
| \`oneuptime.data.table.seconds_since_change\` | Sekunder sedan en rad senast infogades, uppdaterades eller togs bort |
| \`oneuptime.data.table.overdue_seconds\` | Sekunder som tabellen är förbi den tid den brukar ändras inom; 0 så länge den är i tid. Skrivs när dess rytm är inlärd |
| \`oneuptime.data.table.row_count_change_percent\` | Hur mycket antalet rader har ändrats sedan föregående insamling, i procent (-50 är hälften av raderna borta). Tabeller under 1 000 rader utelämnas |
| \`oneuptime.data.table.schema_changes\` | Kolumner som har ändrats sedan föregående insamling |
| \`oneuptime.data.table.breaking_schema_changes\` | Kolumner som har tagits bort, bytt namn eller bytt typ sedan föregående insamling |

Varje rad bär \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` och \`oneuptime.data.table.key\` (\`schema.table\`). En mätvärdesövervakning grupperad efter \`oneuptime.data.table.key\` larmar en gång per tabell, och dess filter **Onormalt hög** och **Onormalt låg** jämför varje tabell med dess eget vanliga värde för den timmen i veckan, så inget tröskelvärde behöver anges.

## Larm

En databas som du ansluter öppnas på sina **Rekommenderade larm**; senare väljer du dem för den under **Databaser**. Varje rekommendation är en mätvärdesövervakning för hela databasen som larmar en gång per tabell, så att även en tabell som skapas senare bevakas:

| Larm | Utlöses när |
| --- | --- |
| **Tabellen är sen** | En tabell stannar i femton minuter förbi den tid den brukar ändras inom - samma regel som etiketten **Sen** |
| **Antalet rader sjönk kraftigt** | En tabell förlorar hälften av sina rader eller mer mellan två insamlingar |
| **Antalet rader ovanligt lågt** | En tabell har långt färre rader än vanligt för den timmen i veckan (lär sig under två veckor) |
| **Schemat ändrat** | En tabells kolumner tas bort, byter namn eller byter typ. En tillagd kolumn förstör inget och stannar på tidslinjen |
| **Tabellhälsa rapporterar inte längre** | Ingen av databasens tabeller har lästs på femton minuter |

Välj allvarlighetsgrader, jourpolicyer, ägare och etiketter när du skapar dem. Därefter är de vanliga övervakningar: redigera dem, tysta dem eller lägg dem på en statussida som vilken annan som helst.

En backfill eller en migrering ska inte larma någon. Ange databasen under **Dataobserverbarhet Databaser** i en underhållshändelse, eller lägg dess databasserver i en, så förblir dess datalarm tysta medan händelsen pågår.

## Ägare och etiketter

En tabells flik **Ägare** anger de personer och team som den tillhör, och tabellens larm går till dem; utan ägare till ägarna av dess databas. **Ägarregler** och **Etikettregler** gäller för varje tabell så fort den dyker upp första gången, utifrån dess etiketter, eller ett reguljärt uttryck på dess namn, schema eller databas. En behörighet som är begränsad till \`Owned\` når bara de tabeller som dess innehavare eller deras team äger, med deras kontroller, aktivitet och rapporterade problem. Att äga en databas gör inte någon till ägare av dess tabeller: använd en ägarregel för att ge ett team en hel databas. På fliken **Pipelineregler** namnger ägarregler också en pipelines ägare, matchade med ett reguljärt uttryck mot dess namn eller namnrymd, när OneUptime ser pipelinen för första gången.

## När ett larm öppnas

En tabells larm har ett kort **Data** som säger varför det troligast inträffade, i ordning: ett larm uppströms, en misslyckad körning, en driftsättning av en tjänst som skriver till den, dess misslyckade skrivningar, en kolumn som ändrades, databasen eller servern som den körs på. Under det står det som beror på den: tabeller, instrumentpaneler, tjänster och de personer som äger dem. Precis som larmets kort **Härkomst** berättar det bara om de tabeller och pipelines som din roll får läsa.

Säg vad du tycker: **Användbart**, **Förväntat** (en planerad händelse: inget ändras) eller **Inte ett problem** (tabellen får mer marginal, så att samma sak förblir tyst nästa gång). Om en person hittar ett problem först registrerar **Rapportera ett problem** på tabellen det. **Översikt** visar hur det summeras: användbara larm per vecka, hur många som inte var brus, hur ofta ett problem upptäcktes innan någon rapporterade det, hur snabbt, och hur ofta den troliga orsaken var den verkliga.


## Dataprodukter

De som använder data (analytiker, ekonomi, chefer, AI-agenter) tänker i det de använder: "tabellerna för intäktspanelen", inte databaser. En dataprodukt namnger de tabellerna, med sin ägare, sina konsumenter och sitt SLA för aktualitet. Skapa en under **Dataprodukter**. Dess SLA är något av dessa, eller båda:
- **Aktuell vid en tid på dagen (UTC):** varje dags data landar samma dag, före den tiden. Från den tiden måste varje tabell ha ändrats den dagen; fram till dess gäller gårdagens inläsning. En inläsning som alltid är en halvtimme sen är sen under den halvtimmen varje dag.
- **En högsta ålder:** ingen tabells senaste ändring får vara äldre än detta.

Var femte minut jämförs varje produkts tabeller med dess SLA. Produkten är **Sen** när någon tabell är det, och dess data är från den äldsta senaste ändringen bland dem. Den skriver \`oneuptime.data.product.late_tables\` och \`oneuptime.data.product.data_age\`, så att du kan visa alla produkters aktualitet sida vid sida.

När du sparar en produkt skapas också, som du och med dina behörigheter:
- **En övervakning**, som är produkten på en statussida. Den är försämrad medan en tabell är sen, och öppnar en incident och ett larm på ditt projekts minst allvarliga nivå, som löser sig själva. Lägg till den på en statussida, privat eller offentlig, som en resurs: konsumenter som prenumererar får veta när produkten är sen, och när den är aktuell igen.
- **En SLO** över den övervakningen: andelen av tiden som data är i tid, mätt mot produktens SLA-mål över 30 dagar, med de larm för snabb och långsam burn rate som varje SLO börjar med.

När produkten tas bort tas båda bort. Varje produkt har också ett **märke** som säger när dess data är ifrån, grönt så länge de är i tid och bärnstensfärgat med "late" när de inte är det. Bädda in det i en BI-instrumentpanel, en wikisida eller en README från produktens översikt. Dess länk kräver ingen inloggning, så behandla den som en delad länk; **Återställ märkeslänk** skapar en ny och drar tillbaka den gamla.

## Kontroller av en tabells värden

Tabellhälsan säger om en tabell ändras. En **kontroll** säger om det den innehåller är rätt. Lägg till en på en tabells flik **Kontroller**:

| Kontroll | Vad den läser |
| --- | --- |
| **Andel NULL** | Procent av raderna vars kolumn är tom |
| **Andel dubbletter** | Procent av värdena som upprepar en annan rads |
| **Antal unika värden** | Hur många olika värden kolumnen innehåller |
| **Minimum**, **Maximum**, **Genomsnitt**, **Summa** | Av en numerisk kolumn (en summa av inga rader är 0) |
| **Andel ogiltiga värden** | Procent av värdena utanför en lista du anger |
| **Andel formatfel** | Procent av värdena som inte har ett format du väljer, som E-post, UUID eller Landskod, eller som inte matchar ett reguljärt uttryck från dig (alla motorer utom SQL Server) |
| **Antal föräldralösa rader** | Rader vars värde inte har någon matchning i en annan tabells kolumn |
| **Antal rader** | Rader i tabellen, mest användbart med **Segmentera efter** |
| **Anpassad SQL** | Talet som en skrivskyddad SELECT från dig returnerar |

**Föreslagna kontroller** på samma flik erbjuder de kontroller som en tabells kolumner lägger upp för, utifrån enbart deras namn och typer:
- Ett id är unikt.
- Ett \`customer_id\` har en matchande rad i \`customers\`.
- En e-postadress ser ut som en, och ett belopp är inte negativt.
- En status behåller sina vanliga värden.
- En tabell som är uppdelad per hyresgäst räknas per hyresgäst.

Lägg till en, lägg till alla, eller avfärda en för gott.

**Segmentera efter** kör en kontroll en gång per värde i en kolumn, som en hyresgäst eller en region: en serie och ett larm var, för de 100 största segmenten. Ett segmenterat antal rader larmar när en hyresgäst slutar skicka data.

Kontroller körs med databasens insamling, hos OneUptime eller på dess sond, var 15:e minut, varje timme, var 6:e timme eller varje dag. Var och en körs som en enda aggregeringssats i en skrivskyddad transaktion med en tidsgräns för satser: bara talet lämnar databasen, om inte ett projekt väljer att spara ett maskerat stickprov av rader som misslyckas. Värdet skrivs som \`oneuptime.data.check.value\`, med \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` och \`oneuptime.data.check.segment\`.

Ange **Larma när** för att larma på en kontroll:
- **Ovanligt hög** eller **Ovanligt låg** jämför varje värde med dess egen inlärda baslinje för den timmen i veckan.
- **Över** eller **Under** jämför det med ett tröskelvärde.

När du sparar kontrollen skapas en mätvärdesövervakning för den, som du och med dina behörigheter. Om du rensar villkoret tas övervakningen bort.

**Rader som misslyckas** räknar de rader som en skrivskyddad SELECT från dig returnerar: de rader som inte borde finnas. 0 är friskt.

Tre saker håller en kontrolls kostnad i schack. **Stickprovsprocent** läser en andel av raderna, för en kontroll som läser en kvot. **Mest en kontroll får läsa (GB)**, under **Inställningar**, stoppar en kontroll på BigQuery eller Athena innan den läser mer än så. **Vänta när en databas är upptagen**, också där, lämnar förfallna kontroller till nästa insamling när en PostgreSQL-, MySQL- eller SQL Server-databas ser upptagen ut.

**Spara felaktiga rader** under **Inställningar** sparar upp till 20 rader som misslyckas från en kontroll, med känsliga kolumner maskerade innan de lämnar databasen. Den är avstängd tills du slår på den. Raderna lagras i OneUptime, på OneUptimes servrar på OneUptime Cloud och på dina egna på en självhostad installation, och när du stänger av den tas de bort.

Håll kontroller i en fil i ditt repository och tillämpa dem från CI med \`oneuptime data-checks apply checks.yaml\`. Kör den med \`--dry-run\` på en pull request. Ett fel någonstans i filen gör att inget tillämpas. Se dokumentationen för filens format.


## Avstämningar

Kopior glider isär: warehouset har färre order än applikationens databas, eller en migrering tappade rader. En avstämning jämför ett mått för två tabeller, i en databas eller två:
- **Antal rader**
- **Summa** av en kolumn
- **Antal unika värden** av en kolumn
- **Anpassad SQL**: en skrivskyddad fråga som returnerar ett tal, med namnet \`value\`.

Den har en tolerans: ett **Absolut** belopp eller en **Procent** av källans värde. Skapa en under **Avstämningar**.

Varje sida läses av en egen datakontroll, som avstämningen skapar och underhåller, med dess databas insamling: hos OneUptime eller av databasens sond. En avstämning kan därför jämföra en PostgreSQL-tabell i ditt nätverk med dess kopia i Snowflake eller BigQuery. Dess kontroller visas på varje tabells flik Kontroller och ändras bara från avstämningen.

De två värdena jämförs så snart båda har lästs inom 15 minuter från varandra, och båda sidorna schemaläggs sedan att läsas tillsammans igen. En avstämning skriver:
- \`oneuptime.data.reconciliation.drifted\`: 1 när de två har glidit isär utöver toleransen, 0 när de stämmer. Dess övervakning läser detta och larmar när de glider isär.
- \`oneuptime.data.reconciliation.difference\`: målets värde minus källans.
- \`oneuptime.data.reconciliation.difference_percent\`: skillnaden som procent av källans värde.

En sida vars kontroll misslyckas säger varför. En kopia som läses in enligt ett schema släpar efter sin källa: jämför ett mått som båda har stabiliserats på, som rader äldre än en timme, med anpassad SQL, eller ta hänsyn till fördröjningen i toleransen.

## Pipelines och härkomst, från OpenLineage

Airflow, Dagster, Spark, dbt och Flink beskriver varje körning av ett jobb med [OpenLineage](https://openlineage.io)-händelser. Skicka dem oförändrade till OneUptime med en intagningsnyckel för telemetri (Projektinställningar > Telemetri och APM > Intagningsnycklar):

- **URL:** \`https://oneuptime.com/telemetry/openlineage\` (på en självhostad OneUptime din egen adress)
- **Endpoint:** \`api/v1/lineage\`, OpenLineages standard
- **API-nyckel:** intagningsnyckeln. Den skickas som \`Authorization: Bearer\`, eller ange \`x-oneuptime-token\`.

För Airflows OpenLineage-leverantör:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

För vilken OpenLineage-klient som helst anger du \`OPENLINEAGE_URL\` och \`OPENLINEAGE_API_KEY\`.

Varje jobb visas under **Pipelines** med sin senaste körning: när den startade och slutade, hur lång tid den tog, och felet i en misslyckad körning. En körning som läser och skriver tabeller som OneUptime bevakar blir **härkomst**: en tabells flik **Härkomst** visar de tabeller den byggs av, de pipelines som skriver till den med deras senaste körning, och de tabeller som byggs av den.

Dataset matchas mot tabeller enligt OpenLineages namngivningsspecifikation: \`postgres://host:5432\` med \`database.schema.table\`, \`mysql://host:3306\` med \`database.table\`, \`sqlserver://host:1433\` och \`redshift://cluster:5439\` med \`database.schema.table\`, \`snowflake://account\` med \`database.schema.table\`, \`bigquery\` med \`project.dataset.table\`, \`clickhouse://host:8443\` med \`database.table\` och \`databricks://workspace-host\` med \`catalog.schema.table\`.

Varje pipeline lär sig av sina egna körningar hur lång tid en körning brukar ta (medianen av dess senaste 20 slutförda körningar) och hur länge det går mellan körningar enligt dess schema (det längsta glappet mellan dess senaste 50 starter som inte är ett enstaka undantag). Båda är kända efter fem körningar och passar lika bra för ett jobb som körs var femte minut som för ett som körs nattetid. När din schemaläggare skickar OpenLineages facet \`nominalTime\`, som Airflow gör, står en körnings schemalagda tid för dess start, så att en backfill fortfarande läses som schemat.

En pipelines sida rekommenderar tre övervakningar, var och en skapad med ett klick:
- **Pipeline-körning misslyckades**: en körning misslyckades eller avbröts.
- **Pipeline-körning ovanligt lång**: en körning har tagit dubbelt så lång tid som vanligt, eller mer. Det kontrolleras var femte minut medan körningen pågår, så att en körning som hänger sig upptäcks innan den slutar.
- **Pipeline är sen**: ingen körning har startat på längre tid än schemat tillåter, med en fjärdedel av intervallet och minst femton minuters marginal.

De läser dessa mätvärden, vart och ett märkt med \`oneuptime.data.pipeline.id\` och \`oneuptime.data.pipeline.name\`:
- \`oneuptime.data.pipeline.run_failed\`: 1 eller 0, när varje körning slutar.
- \`oneuptime.data.pipeline.run_duration\`: sekunder, när varje körning slutar.
- \`oneuptime.data.pipeline.run_duration_ratio\`: körningens tid delad med den typiska körningens (räknad som minst en minut), när varje körning slutar och var femte minut medan den körs.
- \`oneuptime.data.pipeline.overdue_seconds\`: hur länge nästa körning är förbi sitt schema, var femte minut; 0 så länge den är i tid.

En pipelines sida ritar dess **Härkomst**, det första stället att titta på när en körning misslyckas eller är sen: de tabeller den läser till vänster, de tabeller den skriver till höger, och hur var och en står till nu. Välj fler steg för att se vad de tabellerna byggs av och vad som byggs av dem; ett antal tabeller som inte ritats, på pipelinens kort eller en tabells, ritar fler av dem på plats. Samma härkomst finns på \`POST /api/data-observability/pipelines/lineage\`, för dina egna verktyg. Välj en av kolumnerna den skriver för att följa den genom pipelinen: upp till kolumnen i varje läst tabell som den byggs från, och ner till varje tabell den skriver den till. Skicka \`"withColumns": true\` för kolumnerna som dess körningar flyttade, för dina egna verktyg.

En pipelines sida **Kretsbrytare** sätter upp ett steg som innan pipelinen körs frågar om tabellerna den läser mår bra: en kontroll som misslyckas stoppar körningen, och en sen tabell också så länge **Stoppa när en tabell som den läser är sen** är påslagen. En stoppad pipeline listas under **Kräver åtgärd** tills kretsbrytaren säger go igen eller en körning startar.



## Synkroniseringar från Fivetran och Airbyte

Fivetran och Airbyte läser in dina råa tabeller och skickar inga OpenLineage-händelser, men deras webhooks säger när varje synkronisering startar och slutar. Varje Fivetran-connector och varje Airbyte-anslutning blir en pipeline under **Pipelines**, och varje synkronisering en körning, med samma körningshistorik, samma inlärda varaktighet och schema, och samma larm som vilken pipeline som helst: en misslyckad körning, en ovanligt lång och en sen. **Pipelines > Anslut Fivetran eller Airbyte** fyller i URL:erna nedan med en av dina intagningsnycklar.

- **Fivetran:** skapa en webhook med Fivetrans REST-API, för ditt konto eller en målgrupp, med händelserna \`sync_start\` och \`sync_end\`. Dess URL är \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, och dess hemlighet är den intagningsnyckeln. Fivetran signerar varje leverans med hemligheten, så att själva nyckeln aldrig färdas i URL:en, och en leverans som inte är signerad med den avvisas.
- **Airbyte:** i din arbetsytas aviseringsinställningar anger du webhooken till \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\` och slår på den för misslyckade och lyckade synkroniseringar. Airbyte signerar ingenting, så dess URL bär nyckeln: ge Airbyte en egen nyckel.

En pipeline får det namn som verktyget ger connectorn eller anslutningen, under \`fivetran://<destination group>\` eller \`airbyte://<workspace>\`. En misslyckad synkroniserings körning visar verktygets fel. En Fivetran-synkronisering som schemaläggs om vid en API:s hastighetsgräns slutar som **Omplanerad**: det är inget fel, så den larmar ingen, och dess tid lär inte ut någon varaktighet.

En Fivetran-connector läser in det schema i sitt mål som är uppkallat efter den. När exakt en bevakad databas har det schemat registrerar dess tabeller connectorn som sin skrivare: en tabell som blir inaktuell pekar på den synkronisering som borde ha läst in den, och en misslyckad synkroniserings larm är orsaken till tabellernas larm (se Ett larm per orsak). Airbyte namnger inga tabeller.

## Instrumentpaneler i BI-verktyg

Den verkliga effekten av dåliga data är den instrumentpanel som någon öppnar. Under **BI-instrumentpaneler** lägger du till dina BI-verktyg med autentiseringsuppgifter som får läsa deras instrumentpaneler:

| Verktyg | Autentiseringsuppgifter (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (eller en användares \`username\` och \`password\`) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, en personlig åtkomsttoken |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, en API-klient |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, ett tjänsthuvudnamn som får använda Power BI:s administratörs-API:er |
| **Hightouch** | \`{ "apiKey": "..." }\`: varje synkronisering läses som ytterligare en sak som beror på en tabell |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: varje synkronisering läses som ytterligare en sak som beror på en tabell |

Varje timme, och när ett verktyg läggs till eller du väljer **Läs nu**, läser OneUptime varje instrumentpanel och tabellerna bakom den: ett korts tabell och en inbyggd frågas SQL (Metabase), ett datasets tabell eller ett virtuellt datasets SQL (Superset), Metadata API:s uppströms tabeller (Tableau), varje panels explore (Looker) och varje rapports dataset (Power BI, från en skanning av arbetsytan). Varje tabell matchas mot en bevakad utifrån dess databas, schema och namn; ett namn som fortfarande passar på två bevakade tabeller förblir omatchat. En tabells flik **Härkomst**, dess larms kort **Data** och Produktionsgranskning listar de instrumentpaneler som är byggda på den, och på de tabeller som byggs av den. Bara namn och länkar läses, aldrig en instrumentpanels data.

Ett Power BI-verktyg kan också larma om sina datasets misslyckade uppdateringar. Med **Larma vid misslyckade uppdateringar** påslaget, som det är för ett verktyg som läggs till nu, håller OneUptime en övervakning för verktyget som öppnar ett larm för varje dataset vars senaste uppdatering misslyckades eller avbröts, namngivet i larmets titel, och löser det så snart en senare uppdatering slutförs. Den läser \`oneuptime.data.bi.refresh_failed\`, märkt med \`oneuptime.data.bi.dataset.name\` och \`oneuptime.data.bi.workspace.name\`: var femte minut skriver varje dataset som timläsningen fann misslyckat 1, och 0 under timmen efter att en senare uppdatering slutförts. En uppdatering som fortfarande pågår ändrar inget, så ett fel är ett larm, oavsett hur många timläsningar som ser det.

## Jobb i dina spårningar

Ett Kubernetes-CronJob, eller en funktion med timer, behöver inget installerat för att dyka upp som en pipeline: spans med \`k8s.cronjob.name\` eller \`k8s.job.name\`, eller \`faas.name\` med en \`faas.trigger\` på \`timer\` eller \`datasource\`, blir en, med sina körningar och de tabeller som dess databasanrop har rört. Varje körning länkar till sin spårning och sina loggar, och ett CronJob som slutar köras upptäcks som sent.

## Härkomst som databaserna anger

Härkomst behöver ingen pipeline som skickar OpenLineage. Varje databas anger själv en del av den, och OneUptime läser den med databasens insamling:
- **Vyer:** en vy byggs av de tabeller den är definierad på, i PostgreSQL, Redshift, MySQL 8 och SQL Server. När en vy definieras om eller tas bort försvinner dess gamla härkomst med den.
- **Frågehistorik:** en fråga som läste en tabell och skrev en annan, som en schemalagd fråga, en dbt-modell eller en MERGE, är också härkomst. Den kommer från BigQuerys jobb (vyn \`INFORMATION_SCHEMA.JOBS\` för datasetets projekt och plats, som kräver **BigQuery Resource Viewer**) och Redshifts frågelogg (\`stl_insert\` och \`stl_scan\`, som kräver \`SYSLOG ACCESS UNRESTRICTED\`). Bara jobb som körts i datasetets eget projekt finns i dess jobbvy.

Härkomst läses en gång i timmen, tillbaka till den senaste läsningen, och en vecka bakåt vid en databas första insamling, så att den finns där från början. En BigQuery-läsning debiteras för de timmar av jobb den läser, mestadels BigQuerys minimum på 10 MB.

Varje kant på en tabells flik **Härkomst** säger var den sågs: i en pipelines körning, i frågehistoriken (med en inloggning vars frågor flyttade data) eller i en vys definition. Härkomst från alla källor räknas för **Ett larm per orsak**.

Högst upp på en tabells flik **Härkomst** ritar ett diagram dess härkomst några steg åt varje håll (tre, eller välj 1, 2 eller 5): det den byggs av till vänster, de tabeller och instrumentpaneler som byggs av den till höger, och de pipelines som läser in data utifrån där de kommer in. Varje kort säger hur det står till nu - sen, ett öppet larm, en misslyckad körning - och en pil blir röd när dess pipelines senaste körning misslyckades, så att en sen tabell kan följas upp till den körning som förstörde den. Öppna vilken tabell som helst för att centrera diagrammet på den. Ett kort ritar högst tio tabeller åt varje håll och räknar resten, som **+14**: välj antalet för att rita nästa av dem där de är, och **Återställ diagram** för att gå tillbaka. Där källorna namnger kolumner väljer du en av tabellens kolumner i **Följ en kolumn** för att markera var den kommer ifrån och vart den går, även där den byter namn på vägen. Samma härkomst finns på \`POST /api/data-observability/tables/lineage\`, för dina egna verktyg: skicka \`"withColumns": true\` för varje pils kolumner, och fråga \`POST /api/data-observability/lineage/expand\` om ett korts nästa tabeller. Härkomst visar bara de tabeller och pipelines som din roll får läsa: det du inte får läsa ritas aldrig, nämns aldrig på en pil och räknas aldrig.

## dbt

Efter \`dbt build\` (eller run, test, seed eller snapshot) skickar du projektets artefakter med CLI:t och en intagningsnyckel för telemetri. Den läser \`target/manifest.json\` och \`target/run_results.json\` och skickar bara det som Data Observability läser av dem:

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

I CI kör du \`oneuptime dbt upload\` som steget efter bygget, även när bygget misslyckas, så att misslyckade tester registreras. För ett dbt Cloud-jobb laddar du ned dess artefakter med dbt Clouds API och laddar sedan upp dem med \`--manifest\` och \`--run-results\`. Eller skicka dem själv: \`POST /telemetry/dbt/v1/artifacts\` med \`{ "manifest": ..., "run_results": ... }\` och nyckeln i \`x-oneuptime-token\`.

Vad varje uppladdning gör:
- **Tabeller:** varje modell, seed, snapshot och källa som är en tabell som OneUptime bevakar får ett kort **dbt** på sin översikt: noden, dess materialisering, ägare, taggar och senaste bygge. Dess dbt-beskrivning fyller i tabellens beskrivning när den är tom. En tabell matchas utifrån sin databas, sitt schema och sitt namn, för PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse och Databricks. dbt känner inte till värden, så när två bevakade databaser har samma namn förblir deras tabeller omatchade, om inte bara en av dem innehåller tabellen.
- **Härkomst:** det som varje modell byggs av blir härkomst på tabellens flik **Härkomst**, via projektets pipeline.
- **Tester:** varje test av en bevakad tabell visas på dess flik **Kontroller**, med sitt senaste resultat och de rader den fann misslyckade. Klicka på **Larma vid fel** för att låta ett test som misslyckas öppna ett larm.
- **Byggen:** varje bygge är en körning av projektets pipeline under **Pipelines** (namnrymd \`dbt\`). Ett bygge med ett fel eller ett misslyckat test är en misslyckad körning, så pipelinelarmen fungerar även på dbt-byggen: misslyckad, ovanligt lång och sen.

## Oanvända tabeller

Varje motor räknar läsningarna av varje tabell i sin egen statistik:
- PostgreSQL: dess skanningar.
- MySQL: performance_schemas läsningar.
- SQL Server: dess seeks, scans och lookups, med tiden för den senaste.

Varje insamling jämför räknaren med den senast sparade, så att en tabells **Senast läst** är känd på timmen, liksom sedan när den inte har haft någon. En räknare på 0 vid en tabells första insamling betyder att den inte har lästs sedan motorns statistik startade, så att en oanvänd tabell visas som oanvänd från början, inte efter månader av bevakning. En läsning som syns i en tjänsts databas-spans räknas också.

**Oanvända tabeller** listar de tabeller som ingen har läst på 90 dagar, de största först, med när var och en senast skrevs: en tabell som fortfarande skrivs till men aldrig läses kostar sina skrivningar och sin lagring. Översikten visar hur många det finns och vad de innehåller. Vyer har inga egna räknare, så de listas aldrig. När databasinloggningen inte kan läsa räknarna är en tabells senaste läsning inte känd.

## Lagerkostnad

En gång i timmen, med varje warehouses insamling, läser OneUptime vad Snowflake och BigQuery har spenderat det senaste dygnet, jobb för jobb: Snowflakes beräkningscredits från \`QUERY_ATTRIBUTION_HISTORY\` (med \`IMPORTED PRIVILEGES\` på databasen \`SNOWFLAKE\`, körd på anslutningens warehouse) och BigQuerys debiterade byte från dess jobbvy (med **BigQuery Resource Viewer**). Ett jobb är en fråga som körs om och om igen - Snowflakes parametriserade fråga, BigQuerys fråga utan sina literaler - namngiven efter sin query-tagg eller etikett, eller efter vad den gör och vilken tabell den skriver, och aldrig efter frågans text.

**Lagerkostnad** visar dagens credits och debiterade byte, per team (\`team\` i ett jobbs query-tagg eller etikett, annars den som kör det), de tabeller vars skrivningar kostar mest (ett jobbs kostnad fördelad på de tabeller det skriver, där Snowflakes ACCESS_HISTORY eller BigQuerys måltabell säger vilka), de jobb som misslyckades, och vad som går till jobb som bara skriver tabeller som ingen har läst på 90 dagar.

## Ett larm per orsak

När en tabell blir inaktuell blir också varje tabell som byggs av den inaktuell. Innan ett datalarm öppnas letar OneUptime i härkomsten efter ett redan öppet larm på det som dess tabell eller pipeline byggs av: tabellerna uppströms, de pipelines som skriver till dem och de databaser de ligger i, upp till fem steg upp. När den hittar ett är det nya larmet en följd av det larmet:
- Det börjar **kvitterat**, så att ingen larmas två gånger för ett problem. Det återställs av sig självt så snart dess data gör det.
- Dess flöde säger vilket larm som orsakade det, och det gör dess kort **Data** också.
- Det ansluter till orsakens episod, när orsaken ingår i en.

Orsakens kort **Data** listar dess **Påverkan nedströms**: varje larm som den orsakade. En tabells larmkort visar också de tjänster som skriver till tabellen, med deras misslyckade skrivningar, och deras driftsättningar och andra ändringar under dygnet före larmet.

Under kortet **Data** ritar ett larms sida dess **Härkomst**: runt dess tabell, som tabellens flik **Härkomst** ritar den, eller runt dess pipeline, med vägen upp till det larm som orsakade det och ned till varje larm som det orsakade markerad, orsaken märkt **Orsak** och varje larm som det orsakade **Följd**. När orsaken ligger på en pipeline som ritas på en pil säger pilen **Orsak** under pipelinens namn. Ett larm från en kontroll på en kolumn, som en kontroll Andel NULL på \`customer_id\`, öppnas med den kolumnen följd bredvid dessa vägar, som på tabellens flik **Härkomst**; välj en annan av tabellens kolumner där, eller rensa valet för att bara se vägarna. Den som inte får se det larm som orsakade det får varken kortet **Data** eller härkomsten, och ett orsakat larm som personen inte får se markeras inte och räknas inte. Samma härkomst finns på \`POST /api/data-observability/alerts/<alert ID>/lineage\`, med den \`column\` som en kolumnkontrolls larm läser och de kolumner som varje pil bär. Ett orsakat larm på en pipeline som ritas på en pil säger **Följd** där på samma sätt, och kolumnväljaren erbjuder först kontrollens kolumn och sedan tabellens övriga kolumner i dess egen ordning.


## OneUptime AI

- **Utredningar av datalarm.** När OneUptime AI utreder ett larm på en tabell, en pipeline eller en databas läser den det som ligger bredvid: tabellens aktualitet och dess öppna larm, det larm som det är en följd av, körningarna av de pipelines som skriver till den sedan dagen före (en misslyckad körning med sitt fel), de tjänster som skriver till den med deras misslyckade skrivningar och deras driftsättningar och andra ändringar, och dess härkomst: de tabeller den byggs av och de tabeller som byggs av den, de med ett problem först, med var det larm som det är en följd av ligger och vilka tabeller de larm som det orsakade ligger på. För ett larm från en kontroll på en kolumn följer den också den kolumnen genom härkomsten: de kolumner den byggs av uppströms och de kolumner som byggs av den nedströms, tabell för tabell. Den namnger den körning, driftsättning eller uppströms tabell som ligger bakom larmet. Alla som får se larmet läser dess rapport, så den läser bara det som alla får läsa: där en roll bara läser tabeller eller pipelines utifrån **Ägare** eller **Etiketter**, ingen som dessa skiljer av, utöver larmets egen tabell eller pipeline. Den namnger eller räknar aldrig någon annan, varken i det den utgår från eller i det den frågar om på vägen.
- **En kontroll utifrån en mening.** På en tabells flik Kontroller gör **Skriv en kontroll utifrån en mening** en regel som "order har aldrig en negativ summa" till en kontroll med anpassad SQL som räknar de rader som bryter mot den, med ett larm så snart det finns några. Du läser frågan innan **Lägg till kontroll** lägger till den, och den omfattas av allt som varje kontroll med anpassad SQL omfattas av: en enda skrivskyddad sats, körd i en skrivskyddad transaktion.
- **Är den här tabellen aktuell?** Fråga OneUptime AI i Fråga AI, Slack eller Microsoft Teams ("är tabellen orders aktuell?"). Den svarar med tabellens aktualitet enligt dess egen rytm, när den senast ändrades, dess öppna larm, dess skrivares senaste körningar och de dataprodukter den ingår i. AI-agenter frågar samma sak via MCP-serverns verktyg \`get_data_table_freshness\`, innan de använder data.
- **Vad byggs den här tabellen av?** Fråga på samma sätt ("vad matar tabellen revenue?", "vad går sönder om raw.orders slutar läsas in?"). Den följer tabellens härkomst tre steg åt varje håll, eller upp till fem när det efterfrågas, och sätter de uppströms och nedströms tabeller först som är sena, borttagna, har öppna larm eller vars pipeline misslyckades i sin senaste körning, de närmaste först, med hur många steg bort var och en är och tabellerna däremellan; sedan resten, de pipelines som läser in dess källor utanför det som OneUptime bevakar, och de BI-instrumentpaneler som är byggda på den. Öppna larm räknas, namnges aldrig, och bara de som den som frågar får se. AI-agenter frågar samma sak via MCP-serverns verktyg \`get_data_table_lineage\`, innan de ändrar en tabell. Tabellerna längre bort än det berättar om räknar det en gång var, oavsett hur många av de nämnda tabellerna de ligger bredvid. Öppnat på en tabells sida vet Fråga AI vilken tabell ”den här tabellen” är och frågar om just den, även när flera databaser har en tabell med det namnet. Som varje vy av härkomst berättar det bara om de tabeller och pipelines som den som frågar får läsa.

## Tjänster som använder varje tabell

En tabells flik **Tjänster** listar de tjänster som har setts skriva till och läsa från den, med de satser som var och en körde, dess anrop och fel under den senaste timmen, och när den senast sågs. Det kommer från de databas-spans som dina tjänster redan skickar med OpenTelemetry: ett klient-span med \`db.system.name\`, \`db.namespace\` och \`db.collection.name\` (eller \`db.sql.table\`, eller ett span med ett namn som \`INSERT orders\`). Inget extra att installera. Det uppdateras var 15:e minut.

Varje tjänst visar också de endpoints som gör dess anrop, och markeras som **AI-app** när den också anropar en modell. **Fel som nämner den här tabellen** listar de öppna undantagen och det senaste dygnets felloggar från de tjänster som skriver till tabellen, när de nämner den vid namn.

Ett span kopplas bara till en tabell när dess databas är den som en insamling har läst, och när två databaser har samma namn, bara när dess \`server.address\` är en av deras. När den inte är säker utelämnar den spannet.

Dessa mätvärden är OneUptimes egna driftdata och debiteras inte som telemetri.
`;

export default DOCUMENTATION;
