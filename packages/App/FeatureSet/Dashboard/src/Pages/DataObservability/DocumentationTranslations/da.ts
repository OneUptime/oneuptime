/*
 * The Data Observability Documentation page in Danish: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Danish words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Hvad Data Observability overvåger

Hver tabel og hver visning i hver forbundet database, hvert femte minut:

- **Antal rækker og størrelse**, fra motorens egne statistikker.
- **Hvornår den sidst ændrede sig**: MySQL og SQL Server oplyser det; for PostgreSQL holder OneUptime øje med tællerne for indsættelser, opdateringer og sletninger og noterer, hvornår de flytter sig.
- **Dens kolonner**: en kolonne, der tilføjes, fjernes, omdøbes, får en anden type eller gøres nullable, kommer på tabellens tidslinje og under Skemaændringer.
- **Dens sædvanlige rytme**: hvor ofte den normalt ændrer sig. En tabel, der går langt ud over sin rytme, vises som **Forsinket**.

Kun databasens katalog læses, og på MongoDB feltnavnene i en samlings nyeste dokumenter. Ingen værdi forlader databasen.

Et katalog kan sige, at en tabel har ændret sig, når kun dens interne vedligeholdelse har, eller slet ikke sige noget. Angiv i en tabels **Indstillinger** en **Friskhedskolonne** som \`updated_at\`, og dens seneste ændring bliver den kolonnes nyeste værdi. Login'et skal kunne læse kolonnen, og den bør være indekseret.

En læsereplika af PostgreSQL eller SQL Server flytter ikke sine skrivetællere, så OneUptime udelader dem dér og siger det på databasen.

## Oversigten

**Oversigt** fortæller, hvordan dine data står lige nu. Indtil projektet er sat op, viser den de trin, der mangler: advarsler på hver database, ejere til tabellerne, en kontrol og dine pipeline-kørsler. **Kræver handling** viser, hvad der har brug for nogen, det værste først: en database, der ikke kunne læses, en pipeline-kørsel, der fejlede eller er forsinket, en kontrol, der fejler eller ikke kunne køre, en afstemning, der er gledet fra hinanden, og et dataprodukt eller en tabel, der er forsinket. Hvert punkt siger, hvem det tilhører, og om dets advarsel er åben, eller at ingen får besked, fordi dets database ikke har nogen advarsel slået til, og åbner siden, hvor det rettes. **Databaser** viser, hvordan hver databases seneste læsning gik, og om dens advarsler er slået til. Tallet ved **Oversigt** i menuen tæller, hvad der kræver nogen, og **Problemer**, lige under, viser hvert enkelt, én side ad gangen, filtreret efter type, database, ejer (eller **Ingen ejer**) og om en advarsel er åben. Hvert tal på **Oversigt** åbner sin liste: **Kræver handling** åbner **Problemer**, **Forsinkede tabeller** åbner **Tabeller** med kun de forsinkede, og **Fejlende kontroller** åbner **Tjek** med kun dem, der fejler.

## Forbind en database

Brug et **skrivebeskyttet login**. Vælg i oversigten eller under Databaser **Forbind en database**, og derefter en af disse:

- **OneUptime forbinder**: indsæt en forbindelsesstreng. Den gemmes krypteret og vises aldrig igen.
- **En sonde i mit netværk forbinder**: vælg en af projektets sonder, og angiv den miljøvariabel på sonden, der indeholder forbindelsesstrengen (for eksempel \`ORDERS_DB_URL\`). Forbindelsesstrengen forlader aldrig dit netværk. Opdater først sonden til den nyeste version.

En database, der allerede er forbundet til Datasikkerhed, overvåges også.

**Databaser, du kan forbinde**, på samme side, viser det, dit projekt allerede kender, og som ingen har forbundet: databaser, dine traces taler med, databaser i dine cloudkonti og databaser, som Databaseovervågning holder øje med. **Forbind** udfylder formularen på forhånd med det, der vides om hver. Intet læses, før du forbinder den.

## Lagerstier

En eksport, der lander i en bucket hver nat, kan være lige så forsinket eller ufuldstændig som enhver tabel. Under **Lagerstier** vælger du **Rediger stier** for en bucket, som din cloudforbindelse har fundet, på Amazon S3, Google Cloud Storage eller en Azure-lagerkonto, og angiver de stier, der betyder noget, én pr. linje. Hver vises under **Tabeller**: dens nyeste objekt er, hvornår den sidst ændrede sig, dens objekter er dens rækker, og de samme advarsler gælder. Kun navne, størrelser og tidspunkter læses, aldrig et objekt.

### Et skrivebeskyttet login, pr. motor

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL og MariaDB (\`performance_schema\` lader OneUptime se skrivninger mellem indsamlingerne):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` lader OneUptime læse størrelser og seneste opdateringer):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: forbind med en PostgreSQL-forbindelsesstreng til clusterets eller arbejdsgruppens endpoint, for eksempel \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\` lader OneUptime læse antal rækker og størrelser (\`svv_table_info\`), de seneste skrivninger og læsninger fra hver brugers forespørgsler (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, gemt i nogle dage) og afstamningen af hver brugers forespørgsler. Uden den fortæller en ændring i en tabels rækker stadig, hvornår den ændrede sig.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: opret en bruger med et nøglepar (ingen adgangskode), og forbind med JSON, der angiver kontoidentifikatoren, brugeren, den private nøgle (ukrypteret PKCS#8), databasen og et warehouse til kontroller:

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

Indsamlingen læser kataloget med SHOW, som ikke kræver noget warehouse, så den koster ingen credits. Kun datakontroller kører på warehouset, efter den tidsplan, du giver dem. Snowflake oplyser ikke nogen tabels seneste ændring, så en tabel har ændret sig, når dens rækker eller bytes har flyttet sig.

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

Google BigQuery: hvert datasæt, som din Google Cloud-forbindelse har fundet, overvåges allerede, med forbindelsens tjenestekonto, uden noget at forbinde. Giv tjenestekontoen **BigQuery Metadata Viewer** og **BigQuery Job User** på projektet, og **BigQuery Data Viewer** på de tabeller, dine kontroller læser. Hver indsamling læser datasættets \`__TABLES__\` (rækker, bytes og seneste ændring, uden omkostning) og dets \`INFORMATION_SCHEMA.COLUMNS\` (faktureret efter BigQuerys minimum på 10 MB). Tilføj **BigQuery Resource Viewer** på projektet for afstamning fra dets jobs, læst én gang i timen (se Afstamning, som databaserne oplyser). For at forbinde et datasæt uden en Google Cloud-forbindelse vælger du **Google BigQuery** og angiver JSON med en nøgle til en tjenestekonto:

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: forbind via dets HTTP-grænseflade, port 8443 med TLS (ClickHouse Cloud) eller 8123 uden, for eksempel \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Angiv en database for kun at overvåge den; udelad den for at overvåge alle databaser undtagen serverens egne. \`system.parts\` lader OneUptime se hver indsættelse mellem indsamlingerne (en merge tæller ikke), \`system.part_log\` giver, hvor serveren fører den, tidspunktet for hver indsættelse, og \`system.query_log\` giver hver tabels seneste læsning og afstamning fra \`INSERT ... SELECT\`, én gang i timen. Hver sætning kører med \`readonly\` sat, så selv et login, der kunne skrive, ikke kan.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: ét Unity Catalog-katalog er en database. Dets skemaer, tabeller, visninger og kolonner og hver Delta-tabels seneste commit læses fra Unity Catalogs REST-API uden SQL-warehouse, så indsamlingen koster ingen beregning. Datakontroller samt afstamning, seneste skrivninger og seneste læsninger fra systemtabellen \`system.access.table_lineage\` (én gang i timen) kører på det SQL-warehouse, du angiver. Forbind med en tjenesteprincipal (eller et personligt adgangstoken i stedet for \`clientId\` og \`clientSecret\`: \`"token": "dapi..."\`):

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

Oracle: forbind med \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\`, eller JSON \`{ "user", "password", "connectString" }\`. Der læses over Oracles egen protokol, uden nogen Oracle-klient at installere. Login'et ser de tabeller, det må læse: tildel \`READ\` på hver tabel, der skal overvåges (det kan forespørge dem, aldrig låse eller ændre dem). \`SELECT_CATALOG_ROLE\` lader OneUptime læse hver tabels størrelse; uden den har kun login'ets egne tabeller en. \`ALL_TAB_MODIFICATIONS\` oplyser hver tabels indsættelser, opdateringer og sletninger siden dens seneste statistikker, og hvornår den sidst ændrede sig.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: én Glue-database er en database. Dens tabeller og visninger, deres kolonner og statistikker og hver Iceberg-tabels seneste commit kommer fra Glue Data Catalogs API, der ikke læser data og intet koster; kontroller kører som Athena-forespørgsler i den arbejdsgruppe, du angiver. Forbind med nøglerne til en IAM-bruger eller -rolle, der må læse Glue-databasen og køre Athena-forespørgsler:

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

Den kræver \`glue:GetDatabase\` og \`glue:GetTables\` på databasen og dens tabeller og til kontroller \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` og \`athena:StopQueryExecution\` på arbejdsgruppen, med læseadgang til tabellernes S3-data og skriveadgang til outputplaceringen.

MongoDB: forbind med dens forbindelsesstreng - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`, eller \`mongodb://\` med et replikasæts værter. En database i stien er den eneste, der overvåges; uden en overvåges hver database, som login'et må læse. Hver samlings dokumenter, størrelse og skrivninger kommer fra \`$collStats\`, og hvornår den sidst modtog et dokument, fra dens nyeste \`_id\`. Dens felter kommer fra dens validators JSON-skema, eller ellers fra navnene og typerne på felterne i dens 100 nyeste dokumenter, beregnet i databasen, så ingen værdi forlader den. Dokumenter læses på en sekundær, hvor der er en. En visnings kildesamling er afstamning, og en brugerdefineret kontrol er en aggregeringspipeline, som JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

For kun at overvåge én database tildeler du \`{ role: "read", db: "orders" }\` i stedet for \`readAnyDatabase\`.

Microsoft Dataverse: ét miljø er en database, med dets tabeller i \`dbo\`, som dets SQL-endpoint navngiver dem. OneUptime logger ind som en app: registrer en i Microsoft Entra ID med en klienthemmelighed, og føj den til miljøet som programbruger (Power Platform admin center > the environment > Settings > Users + permissions > Application users) med en sikkerhedsrolle, der må læse tabellerne. Forbind med JSON eller med en Dataverse-forbindelsesstreng, der angiver \`AuthType=ClientSecret\`. Lejeren kan udelades: miljøet fortæller, hvilken det er i.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

Hvert femte minut giver Web API'et hver tabels definition, dens rækker fra det øjebliksbillede, Dataverse tager én gang om dagen (de halter altså op til en dag bagefter), og dens nyeste \`modifiedon\`, som er tidspunktet for dens seneste ændring. Dens kolonner læses én gang i timen. Hver læsning tæller med i appens Dataverse-anmodningsgrænser, og en indsamling, der bliver bedt om at sætte farten ned, overlader resten til den næste. Et miljø indeholder hundredvis af egne tabeller, så kun de centrale forretningstabeller (konti, kontakter, kundeemner, salgsmuligheder, tilbud, ordrer, fakturaer, produkter, sager, mails, telefonopkald, aftaler, opgaver og noter) og dine egne brugerdefinerede tabeller overvåges. Tabeller fra Microsofts apps (\`msdyn_\`, \`adx_\` og de andre \`ms\`-præfikser) udelades: angiv enhver anden tabel, der skal overvåges, som i \`"tables": ["msdyn_workorder"]\`.

Datakontroller kører som skrivebeskyttet SQL på miljøets TDS-endpoint, på port 1433 eller 5558. Det er slået til, medmindre en administrator har slået det fra; hvor adgangskontrol på brugerniveau er slået til for det, kræver appens rolle privilegiet **Allow user to access TDS endpoint**. Dets SQL har ingen regulære udtryk, ingen \`WITH\` og ingen stikprøve.

## Metrikker, som hver tabel skriver

Hver indsamling skriver disse for hver tabel, så du kan vise dem i diagrammer, lægge dem på dashboards og oprette advarsler på dem som på enhver anden metrik:

| Metrik | Hvad den er |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Rækker i tabellen |
| \`oneuptime.data.table.size\` | Bytes, som tabellen og dens indekser fylder |
| \`oneuptime.data.table.seconds_since_change\` | Sekunder siden en række sidst blev indsat, opdateret eller slettet |
| \`oneuptime.data.table.overdue_seconds\` | Sekunder, tabellen er forbi det tidspunkt, den normalt ændrer sig inden; 0, så længe den er til tiden. Skrives, når dens rytme er lært |
| \`oneuptime.data.table.row_count_change_percent\` | Hvor meget antallet af rækker har flyttet sig siden indsamlingen før, i procent (-50 er halvdelen af rækkerne væk). Tabeller under 1.000 rækker udelades |
| \`oneuptime.data.table.schema_changes\` | Kolonner, der er ændret siden indsamlingen før |
| \`oneuptime.data.table.breaking_schema_changes\` | Kolonner, der er fjernet, omdøbt eller har fået en anden type siden indsamlingen før |

Hver række bærer \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` og \`oneuptime.data.table.key\` (\`schema.table\`). En metrikmonitor grupperet efter \`oneuptime.data.table.key\` advarer én gang pr. tabel, og dens filtre **Unormalt høj** og **Unormalt lav** sammenligner hver tabel med dens egen sædvanlige værdi for den time på ugen, så ingen grænseværdi skal sættes.

## Advarsler

En database, du forbinder, åbner på sine **Anbefalede advarsler**; senere vælger du dem for den under **Databaser**. Hver anbefaling er én metrikmonitor for hele databasen, der advarer én gang pr. tabel, så også en tabel, der oprettes senere, overvåges:

| Advarsel | Udløses, når |
| --- | --- |
| **Tabellen er forsinket** | En tabel bliver i femten minutter forbi det tidspunkt, den normalt ændrer sig inden - samme regel som mærket **Forsinket** |
| **Antal rækker faldt kraftigt** | En tabel mister halvdelen af sine rækker eller flere mellem to indsamlinger |
| **Antal rækker usædvanligt lavt** | En tabel har langt færre rækker end normalt for den time på ugen (lærer over to uger) |
| **Skema ændret** | En tabels kolonner fjernes, omdøbes eller får en anden type. En tilføjet kolonne ødelægger intet og bliver på tidslinjen |
| **Tabeltilstand rapporterer ikke længere** | Ingen af databasens tabeller er blevet læst i femten minutter |

Vælg alvorsgrader, vagtpolitikker, ejere og etiketter, når du opretter dem. Derefter er de almindelige monitorer: rediger dem, slå dem fra, eller sæt dem på en statusside som enhver anden.

En backfill eller en migrering bør ikke tilkalde nogen. Angiv databasen under **Data Observability Databaser** på en vedligeholdelseshændelse, eller sæt dens databaseserver i en, og dens dataadvarsler forbliver stille, mens hændelsen står på.

## Ejere og etiketter

En tabels fane **Ejere** angiver de personer og teams, den tilhører, og tabellens advarsler går til dem; uden ejere til ejerne af dens database. **Ejerregler** og **Etiketregler** gælder for hver tabel, så snart den dukker op første gang, ud fra dens etiketter eller et regulært udtryk på dens navn, skema eller database. En tilladelse, der er afgrænset til \`Owned\`, rækker kun til de tabeller, som dens indehaver eller deres teams ejer, med disses kontroller, aktivitet og rapporterede problemer. At eje en database gør ikke nogen til ejer af dens tabeller: brug en ejerregel til at give et team en hel database.

## Når en advarsel åbnes

En tabels advarsel har et kort **Data**, der fortæller, hvorfor den mest sandsynligt skete, i rækkefølge: en advarsel opstrøms, en fejlet kørsel, en udrulning af en tjeneste, der skriver til den, dens fejlede skrivninger, en kolonne, der ændrede sig, databasen eller den server, den kører på. Nedenunder står det, der afhænger af den: tabeller, dashboards, tjenester og de personer, der ejer dem. Ligesom advarslens **Afstamning**-kort fortæller det kun om de tabeller og pipelines, din rolle må læse.

Sig, hvad du synes: **Nyttig**, **Forventet** (en planlagt hændelse: intet ændres) eller **Ikke et problem** (tabellen får mere spillerum, så det samme forbliver stille næste gang). Hvis en person finder et problem først, registrerer **Rapportér et problem** på tabellen det. **Oversigt** viser, hvordan det hænger sammen: nyttige advarsler pr. uge, hvor mange der ikke var støj, hvor ofte et problem blev opdaget, før nogen rapporterede det, hvor hurtigt, og hvor ofte den sandsynlige årsag var den rigtige.


## Dataprodukter

De mennesker, der bruger data (analytikere, økonomi, ledere, AI-agenter), tænker i det, de bruger: "omsætningsdashboardets tabeller", ikke databaser. Et dataprodukt navngiver de tabeller, med sin ejer, sine forbrugere og sin SLA for friskhed. Opret et under **Dataprodukter**. Dets SLA er en af disse eller begge:
- **Frisk til et tidspunkt på dagen (UTC):** hver dags data lander den dag, inden da. Fra det tidspunkt skal hver tabel have ændret sig den dag; indtil da gælder gårsdagens indlæsning. En indlæsning, der altid er en halv time forsinket, er forsinket i den halve time hver dag.
- **En maksimal alder:** ingen tabels seneste ændring må være ældre end dette.

Hvert femte minut sammenlignes hvert produkts tabeller med dets SLA. Produktet er **Forsinket**, når en af tabellerne er det, og dets data er fra den ældste seneste ændring blandt dem. Det skriver \`oneuptime.data.product.late_tables\` og \`oneuptime.data.product.data_age\`, så du kan vise alle produkters friskhed side om side.

Når du gemmer et produkt, oprettes også, som dig og med dine tilladelser:
- **En monitor**, som er produktet på en statusside. Den er forringet, mens en tabel er forsinket, og åbner en hændelse og en advarsel på dit projekts mindst alvorlige niveau, som løser sig selv. Føj den til en statusside, privat eller offentlig, som en ressource: forbrugere, der abonnerer, får besked, når produktet er forsinket, og når det er friskt igen.
- **En SLO** over den monitor: den andel af tiden, hvor dataene er til tiden, målt mod produktets SLA-mål over 30 dage, med de advarsler for hurtig og langsom burn rate, som enhver SLO starter med.

Når produktet slettes, slettes begge. Hvert produkt har også et **badge**, der fortæller, hvornår dets data er fra, grønt, mens de er til tiden, og ravgult med "late", når de ikke er. Integrer det i et BI-dashboard, en wikiside eller en README fra produktets oversigt. Dets link kræver intet login, så behandl det som et delt link; **Nulstil badge-link** laver et nyt og trækker det gamle tilbage.

## Kontroller af en tabels værdier

Tabellens tilstand fortæller, om en tabel ændrer sig. En **kontrol** fortæller, om det, den indeholder, er rigtigt. Tilføj en på en tabels fane **Tjek**:

| Kontrol | Hvad den læser |
| --- | --- |
| **Andel NULL** | Procentdel af rækker, hvis kolonne er tom |
| **Andel dubletter** | Procentdel af værdier, der gentager en anden rækkes |
| **Antal unikke værdier** | Hvor mange forskellige værdier kolonnen indeholder |
| **Minimum**, **Maksimum**, **Gennemsnit**, **Sum** | Af en numerisk kolonne (en sum af ingen rækker er 0) |
| **Andel ugyldige værdier** | Procentdel af værdier uden for en liste, du angiver |
| **Andel formatfejl** | Procentdel af værdier, der ikke er i et format, du vælger, såsom E-mail, UUID eller Landekode, eller som ikke matcher et regulært udtryk fra dig (alle motorer undtagen SQL Server) |
| **Antal forældreløse rækker** | Rækker, hvis værdi ikke har noget match i en anden tabels kolonne |
| **Antal rækker** | Rækker i tabellen, mest nyttig med **Opdel efter** |
| **Brugerdefineret SQL** | Det tal, som en skrivebeskyttet SELECT fra dig returnerer |

**Foreslåede kontroller** på samme fane tilbyder de kontroller, en tabels kolonner lægger op til, alene ud fra deres navne og typer:
- Et id er unikt.
- Et \`customer_id\` har en matchende række i \`customers\`.
- En mail ligner en mail, og et beløb er ikke negativt.
- En status beholder sine sædvanlige værdier.
- En tabel, der er opdelt efter lejer, tælles pr. lejer.

Tilføj én, tilføj dem alle, eller afvis én for altid.

**Opdel efter** kører en kontrol én gang pr. værdi i en kolonne, såsom en lejer eller en region: én serie og én advarsel hver, for de 100 største segmenter. Et opdelt antal rækker advarer, når én lejer holder op med at sende data.

Kontroller kører med databasens indsamling, hos OneUptime eller på dens sonde, hvert 15. minut, hver time, hver 6. time eller hver dag. Hver kører som én aggregeringssætning i en skrivebeskyttet transaktion med en tidsgrænse for sætninger: kun tallet forlader databasen, medmindre et projekt vælger at gemme en maskeret stikprøve af fejlende rækker. Værdien skrives som \`oneuptime.data.check.value\` med \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` og \`oneuptime.data.check.segment\`.

Sæt **Advar, når** for at advare på en kontrol:
- **Usædvanligt høj** eller **Usædvanligt lav** sammenligner hver værdi med dens egen lærte baseline for den time på ugen.
- **Over** eller **Under** sammenligner den med en grænseværdi.

Når du gemmer kontrollen, oprettes en metrikmonitor for den, som dig og med dine tilladelser. Hvis du rydder betingelsen, fjernes monitoren.

**Fejlende rækker** tæller de rækker, som en skrivebeskyttet SELECT fra dig returnerer: de rækker, der ikke burde findes. 0 er sundt.

Tre ting holder en kontrols omkostninger i ave. **Stikprøveprocent** læser en del af rækkerne, for en kontrol, der læser en rate. **Mest en kontrol må læse (GB)**, under **Indstillinger**, stopper en kontrol på BigQuery eller Athena, før den læser mere end det. **Vent, når en database er optaget**, også dér, overlader forfaldne kontroller til næste indsamling, når en PostgreSQL-, MySQL- eller SQL Server-database ser optaget ud.

**Gem fejlende rækker** under **Indstillinger** gemmer op til 20 fejlende rækker fra en kontrol, med følsomme kolonner maskeret, før de forlader databasen. Den er slået fra, indtil du slår den til. Rækkerne gemmes i OneUptime, på OneUptimes servere på OneUptime Cloud og på dine egne på en selvhostet installation, og når du slår den fra, slettes de.

Hold kontroller i en fil i dit repository, og anvend dem fra CI med \`oneuptime data-checks apply checks.yaml\`. Kør den med \`--dry-run\` på en pull request. En fejl et sted i filen betyder, at intet anvendes. Se dokumentationen for filens format.


## Afstemninger

Kopier glider fra hinanden: warehouset har færre ordrer end applikationens database, eller en migrering mistede rækker. En afstemning sammenligner ét mål for to tabeller, i én database eller to:
- **Antal rækker**
- **Sum** af en kolonne
- **Antal unikke værdier** af en kolonne
- **Brugerdefineret SQL**: en skrivebeskyttet forespørgsel, der returnerer ét tal med navnet \`value\`.

Den har en tolerance: et **Absolut** beløb eller en **Procent** af kildens værdi. Opret en under **Afstemninger**.

Hver side læses af sin egen datakontrol, som afstemningen opretter og vedligeholder, med dens databases indsamling: hos OneUptime eller af databasens sonde. En afstemning kan derfor sammenligne en PostgreSQL-tabel i dit netværk med dens kopi i Snowflake eller BigQuery. Dens kontroller vises på hver tabels fane Tjek og ændres kun fra afstemningen.

De to værdier sammenlignes, så snart begge er læst inden for 15 minutter af hinanden, og begge sider planlægges derefter til at blive læst sammen igen. En afstemning skriver:
- \`oneuptime.data.reconciliation.drifted\`: 1, når de to er gledet fra hinanden ud over tolerancen, 0, når de stemmer. Dens monitor læser dette og advarer, når de glider fra hinanden.
- \`oneuptime.data.reconciliation.difference\`: målets værdi minus kildens.
- \`oneuptime.data.reconciliation.difference_percent\`: forskellen som procentdel af kildens værdi.

En side, hvis kontrol fejler, fortæller hvorfor. En kopi, der indlæses efter en tidsplan, halter efter sin kilde: sammenlign et mål, som begge er faldet til ro på, såsom rækker ældre end en time, med brugerdefineret SQL, eller tag højde for forsinkelsen i tolerancen.

## Pipelines og afstamning, fra OpenLineage

Airflow, Dagster, Spark, dbt og Flink beskriver hver kørsel af et job med [OpenLineage](https://openlineage.io)-hændelser. Send dem uændret til OneUptime med en indtagelsesnøgle til telemetri (Projektindstillinger > Telemetri og APM > Indtagelsesnøgler):

- **URL:** \`https://oneuptime.com/telemetry/openlineage\` (på en selvhostet OneUptime din egen adresse)
- **Endpoint:** \`api/v1/lineage\`, OpenLineages standard
- **API-nøgle:** indtagelsesnøglen. Den sendes som \`Authorization: Bearer\`, eller sæt \`x-oneuptime-token\`.

For Airflows OpenLineage-udbyder:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

For enhver OpenLineage-klient sætter du \`OPENLINEAGE_URL\` og \`OPENLINEAGE_API_KEY\`.

Hvert job vises under **Pipelines** med sin seneste kørsel: hvornår den startede og sluttede, hvor lang tid den tog, og fejlen ved en fejlet kørsel. En kørsel, der læser og skriver tabeller, som OneUptime overvåger, bliver til **afstamning**: en tabels fane **Afstamning** viser de tabeller, den er bygget ud fra, de pipelines, der skriver til den, med deres seneste kørsel, og de tabeller, der er bygget ud fra den.

Datasæt matches med tabeller efter OpenLineages navngivningsspecifikation: \`postgres://host:5432\` med \`database.schema.table\`, \`mysql://host:3306\` med \`database.table\`, \`sqlserver://host:1433\` og \`redshift://cluster:5439\` med \`database.schema.table\`, \`snowflake://account\` med \`database.schema.table\`, \`bigquery\` med \`project.dataset.table\`, \`clickhouse://host:8443\` med \`database.table\` og \`databricks://workspace-host\` med \`catalog.schema.table\`.

Hver pipeline lærer af sine egne kørsler, hvor lang tid en kørsel normalt tager (medianen af dens seneste 20 fuldførte kørsler), og hvor længe der går mellem kørsler efter dens tidsplan (det længste hul mellem dens seneste 50 starter, der ikke er et enkeltstående tilfælde). Begge kendes efter fem kørsler og passer lige så godt til et job, der kører hvert femte minut, som til et, der kører om natten. Når din scheduler sender OpenLineages facet \`nominalTime\`, som Airflow gør, står en kørsels planlagte tidspunkt for dens start, så en backfill stadig læses som tidsplanen.

En pipelines side anbefaler tre monitorer, hver oprettet med ét klik:
- **Pipeline-kørsel fejlede**: en kørsel fejlede eller blev afbrudt.
- **Pipeline-kørsel usædvanligt lang**: en kørsel har taget dobbelt så lang tid som normalt eller mere. Det kontrolleres hvert femte minut, mens kørslen er i gang, så en kørsel, der hænger, ses, før den slutter.
- **Pipeline er forsinket**: ingen kørsel er startet i længere tid, end tidsplanen tillader, med en fjerdedel af intervallet og mindst femten minutters spillerum.

De læser disse metrikker, hver mærket med \`oneuptime.data.pipeline.id\` og \`oneuptime.data.pipeline.name\`:
- \`oneuptime.data.pipeline.run_failed\`: 1 eller 0, når hver kørsel slutter.
- \`oneuptime.data.pipeline.run_duration\`: sekunder, når hver kørsel slutter.
- \`oneuptime.data.pipeline.run_duration_ratio\`: kørslens tid delt med den typiske kørsels (talt som mindst et minut), når hver kørsel slutter og hvert femte minut, mens den kører.
- \`oneuptime.data.pipeline.overdue_seconds\`: hvor længe den næste kørsel er forbi sin tidsplan, hvert femte minut; 0, så længe den er til tiden.

En pipelines side tegner dens **Afstamning**, det første sted at kigge, når en kørsel fejler eller er forsinket: de tabeller, den læser, til venstre, de tabeller, den skriver, til højre, og hvordan hver af dem står nu. Vælg flere trin for at se, hvad de tabeller er bygget ud fra, og hvad der er bygget ud fra dem; et antal ikke-tegnede tabeller, på pipelinens kort eller en tabels, tegner flere af dem på stedet. Den samme afstamning findes på \`POST /api/data-observability/pipelines/lineage\`, til dine egne værktøjer. Vælg en af de kolonner, den skriver, for at følge den hen over pipelinen: op til kolonnen i hver læst tabel, den er bygget fra, og ned til hver tabel, den skriver den til. Send \`"withColumns": true\` for de kolonner, dens kørsler flyttede, til dine egne værktøjer.



## Synkroniseringer fra Fivetran og Airbyte

Fivetran og Airbyte indlæser dine rå tabeller og sender ingen OpenLineage-hændelser, men deres webhooks fortæller, hvornår hver synkronisering starter og slutter. Hver Fivetran-connector og hver Airbyte-forbindelse bliver en pipeline under **Pipelines**, og hver synkronisering en kørsel, med samme kørselshistorik, samme lærte varighed og tidsplan og samme advarsler som enhver pipeline: en fejlet kørsel, en usædvanligt lang og en forsinket. **Pipelines > Forbind Fivetran eller Airbyte** udfylder URL'erne nedenfor med en af dine indtagelsesnøgler.

- **Fivetran:** opret en webhook med Fivetrans REST-API, for din konto eller én destinationsgruppe, med hændelserne \`sync_start\` og \`sync_end\`. Dens URL er \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, og dens hemmelighed er den indtagelsesnøgle. Fivetran signerer hver levering med hemmeligheden, så selve nøglen aldrig rejser i URL'en, og en levering, der ikke er signeret med den, afvises.
- **Airbyte:** sæt i dit arbejdsområdes notifikationsindstillinger webhooken til \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\`, og slå den til for fejlede synkroniseringer og vellykkede synkroniseringer. Airbyte signerer intet, så dens URL bærer nøglen: giv Airbyte sin egen nøgle.

En pipeline navngives, som værktøjet navngiver connectoren eller forbindelsen, under \`fivetran://<destination group>\` eller \`airbyte://<workspace>\`. En fejlet synkroniserings kørsel viser værktøjets fejl. En Fivetran-synkronisering, der omplanlægges ved en API's hastighedsgrænse, ender som **Omplanlagt**: den er ikke en fejl, så den tilkalder ingen, og dens tid lærer ingen varighed.

En Fivetran-connector indlæser det skema i sin destination, der er opkaldt efter den. Når præcis én overvåget database har det skema, registrerer dens tabeller connectoren som deres skriver: en tabel, der bliver forældet, peger på den synkronisering, der skulle have indlæst den, og en fejlet synkroniserings advarsel er årsagen til tabellernes advarsler (se Én advarsel pr. årsag). Airbyte navngiver ingen tabeller.

## Dashboards i BI-værktøjer

Den reelle virkning af dårlige data er det dashboard, nogen åbner. Under **BI-dashboards** tilføjer du dine BI-værktøjer med legitimationsoplysninger, der må læse deres dashboards:

| Værktøj | Legitimationsoplysninger (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (eller en brugers \`username\` og \`password\`) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, et personligt adgangstoken |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, en API-klient |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, en tjenesteprincipal, der må bruge Power BI's administrator-API'er |
| **Hightouch** | \`{ "apiKey": "..." }\`: hver synkronisering læses som én ting mere, der afhænger af en tabel |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: hver synkronisering læses som én ting mere, der afhænger af en tabel |

Hver time, og når et værktøj tilføjes, eller du vælger **Læs nu**, læser OneUptime hvert dashboard og tabellerne bag det: et korts tabel og et native spørgsmåls SQL (Metabase), et datasæts tabel eller et virtuelt datasæts SQL (Superset), Metadata API'ets opstrøms tabeller (Tableau), hver flises explore (Looker) og hver rapports datasæt (Power BI, fra en scanning af arbejdsområdet). Hver tabel matches med en overvåget ud fra dens database, skema og navn; et navn, der stadig passer på to overvågede tabeller, forbliver umatchet. En tabels fane **Afstamning**, dens advarslers kort **Data** og Produktionsgennemgang viser de dashboards, der er bygget på den, og på de tabeller, der er bygget ud fra den. Kun navne og links læses, aldrig et dashboards data.

Et Power BI-værktøj kan også advare om sine datasæts mislykkede opdateringer. Med **Advar ved mislykkede opdateringer** slået til, som det er for et værktøj, der tilføjes nu, holder OneUptime én monitor for værktøjet, der åbner en advarsel for hvert datasæt, hvis seneste opdatering mislykkedes eller blev annulleret, navngivet i advarslens titel, og løser den, så snart en senere opdatering er fuldført. Den læser \`oneuptime.data.bi.refresh_failed\`, mærket med \`oneuptime.data.bi.dataset.name\` og \`oneuptime.data.bi.workspace.name\`: hvert femte minut skriver hvert datasæt, som den timevise læsning fandt fejlende, 1, og 0 i timen efter, at en senere opdatering er fuldført. En opdatering, der stadig kører, ændrer intet, så én fejl er én advarsel, uanset hvor mange timevise læsninger der ser den.

## Jobs i dine traces

Et Kubernetes-CronJob, eller en funktion på en timer, behøver intet installeret for at dukke op som en pipeline: spans med \`k8s.cronjob.name\` eller \`k8s.job.name\`, eller \`faas.name\` med en \`faas.trigger\` på \`timer\` eller \`datasource\`, bliver til en, med sine kørsler og de tabeller, dens databasekald har rørt ved. Hver kørsel linker til sin trace og sine logs, og et CronJob, der holder op med at køre, ses som forsinket.

## Afstamning, som databaserne oplyser

Afstamning behøver ikke en pipeline, der sender OpenLineage. Hver database oplyser selv en del af den, og OneUptime læser den med databasens indsamling:
- **Visninger:** en visning er bygget ud fra de tabeller, den er defineret på, i PostgreSQL, Redshift, MySQL 8 og SQL Server. Når en visning omdefineres eller slettes, forsvinder dens gamle afstamning med den.
- **Forespørgselshistorik:** en forespørgsel, der læste én tabel og skrev en anden, såsom en planlagt forespørgsel, en dbt-model eller en MERGE, er også afstamning. Den kommer fra BigQuerys jobs (visningen \`INFORMATION_SCHEMA.JOBS\` for datasættets projekt og placering, som kræver **BigQuery Resource Viewer**) og Redshifts forespørgselslog (\`stl_insert\` og \`stl_scan\`, som kræver \`SYSLOG ACCESS UNRESTRICTED\`). Kun jobs, der er kørt i datasættets eget projekt, er i dets jobvisning.

Afstamning læses én gang i timen, tilbage til den seneste læsning, og en uge tilbage ved en databases første indsamling, så den er der fra starten. En BigQuery-læsning faktureres for de timer af jobs, den læser, for det meste BigQuerys minimum på 10 MB.

Hver kant på en tabels fane **Afstamning** fortæller, hvor den blev set: i en pipelines kørsel, i forespørgselshistorikken (med et login, hvis forespørgsler flyttede dataene) eller i en visnings definition. Afstamning fra alle kilder tæller med for **Én advarsel pr. årsag**.

Øverst på en tabels fane **Afstamning** tegner et diagram dens afstamning nogle trin i hver retning (tre, eller vælg 1, 2 eller 5): det, den er bygget ud fra, til venstre, de tabeller og dashboards, der er bygget ud fra den, til højre, og de pipelines, der indlæser data udefra, dér hvor de kommer ind. Hvert kort fortæller, hvordan det står nu - forsinket, en åben advarsel, en fejlet kørsel - og en pil bliver rød, når dens pipelines seneste kørsel fejlede, så en forsinket tabel kan følges op til den kørsel, der ødelagde den. Åbn en hvilken som helst tabel for at centrere diagrammet på den. Et kort tegner højst ti tabeller i hver retning og tæller resten, såsom **+14**: vælg antallet for at tegne de næste af dem, hvor de er, og **Nulstil diagram** for at gå tilbage. Hvor kilderne navngiver kolonner, vælger du en af tabellens kolonner i **Følg en kolonne** for at fremhæve, hvor den kommer fra, og hvor den går hen, også hvor den omdøbes undervejs. Den samme afstamning findes på \`POST /api/data-observability/tables/lineage\`, til dine egne værktøjer: send \`"withColumns": true\` for hver pils kolonner, og spørg \`POST /api/data-observability/lineage/expand\` om et korts næste tabeller. Afstamning viser kun de tabeller og pipelines, din rolle må læse: det, du ikke må læse, tegnes aldrig, nævnes aldrig på en pil og tælles aldrig med.

## dbt

Efter \`dbt build\` (eller run, test, seed eller snapshot) sender du projektets artefakter med CLI'en og en indtagelsesnøgle til telemetri. Den læser \`target/manifest.json\` og \`target/run_results.json\` og sender kun det, Data Observability læser af dem:

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

I CI kører du \`oneuptime dbt upload\` som trinnet efter buildet, også når buildet fejler, så fejlede tests registreres. For et dbt Cloud-job henter du dets artefakter med dbt Clouds API og uploader dem derefter med \`--manifest\` og \`--run-results\`. Eller send dem selv: \`POST /telemetry/dbt/v1/artifacts\` med \`{ "manifest": ..., "run_results": ... }\` og nøglen i \`x-oneuptime-token\`.

Hvad hver upload gør:
- **Tabeller:** hver model, seed, snapshot og kilde, der er en tabel, som OneUptime overvåger, får et kort **dbt** på sin oversigt: noden, dens materialisering, ejer, tags og seneste build. Dens dbt-beskrivelse udfylder tabellens beskrivelse, når den er tom. En tabel matches ud fra sin database, sit skema og sit navn, for PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse og Databricks. dbt kender ikke værten, så når to overvågede databaser deler et navn, forbliver deres tabeller umatchede, medmindre kun én af dem indeholder tabellen.
- **Afstamning:** det, hver model er bygget ud fra, bliver afstamning på tabellens fane **Afstamning**, via projektets pipeline.
- **Tests:** hver test af en overvåget tabel vises på dens fane **Tjek**, med sit seneste resultat og de rækker, den fandt fejlende. Klik på **Advar ved fejl** for at få en fejlende test til at åbne en advarsel.
- **Builds:** hvert build er en kørsel af projektets pipeline under **Pipelines** (navnerum \`dbt\`). Et build med en fejl eller en fejlet test er en fejlet kørsel, så pipeline-advarslerne virker også på dbt-builds: fejlet, usædvanligt lang og forsinket.

## Ubrugte tabeller

Hver motor tæller læsningerne af hver tabel i sine egne statistikker:
- PostgreSQL: dens scanninger.
- MySQL: performance_schemas læsninger.
- SQL Server: dens seeks, scans og lookups, med tidspunktet for den seneste.

Hver indsamling sammenligner tælleren med den senest gemte, så en tabels **Senest læst** er kendt på timen, ligesom tidspunktet, siden hvilket den ikke har haft nogen. En tæller på 0 ved en tabels første indsamling betyder, at den ikke er læst, siden motorens statistikker startede, så en ubrugt tabel vises som ubrugt fra starten, ikke efter måneders overvågning. En læsning, der ses i en tjenestes database-spans, tæller også med.

**Ubrugte tabeller** viser de tabeller, som ingen har læst i 90 dage, de største først, med hvornår der sidst blev skrevet til hver: en tabel, der stadig skrives til, men aldrig læses, koster sine skrivninger og sit lager. Oversigten viser, hvor mange der er, og hvad de indeholder. Visninger har ingen egne tællere, så de vises aldrig. Når databasens login ikke kan læse tællerne, kendes en tabels seneste læsning ikke.

## Lagerforbrug

Én gang i timen, med hvert warehouses indsamling, læser OneUptime, hvad Snowflake og BigQuery har brugt det seneste døgn, job for job: Snowflakes beregningscredits fra \`QUERY_ATTRIBUTION_HISTORY\` (med \`IMPORTED PRIVILEGES\` på databasen \`SNOWFLAKE\`, kørt på forbindelsens warehouse) og BigQuerys fakturerede bytes fra dets jobvisning (med **BigQuery Resource Viewer**). Et job er én forespørgsel, der køres igen og igen - Snowflakes parametriserede forespørgsel, BigQuerys forespørgsel uden dens literaler - navngivet efter dens query-tag eller label, eller efter hvad den gør, og hvilken tabel den skriver, og aldrig efter dens forespørgsels tekst.

**Lagerforbrug** viser dagens credits og fakturerede bytes, pr. team (\`team\` i et jobs query-tag eller label, ellers hvem der kører det), de tabeller, hvis skrivninger koster mest (et jobs forbrug fordelt på de tabeller, det skriver, hvor Snowflakes ACCESS_HISTORY eller BigQuerys destinationstabel siger hvilke), de jobs, der fejlede, og hvad der går til jobs, der kun skriver tabeller, som ingen har læst i 90 dage.

## Én advarsel pr. årsag

Når en tabel bliver forældet, bliver hver tabel, der er bygget ud fra den, også forældet. Før en dataadvarsel åbnes, slår OneUptime op i afstamningen efter en allerede åben advarsel på det, dens tabel eller pipeline er bygget ud fra: tabellerne opstrøms, de pipelines, der skriver til dem, og de databaser, de ligger i, op til fem trin op. Når den finder en, er den nye advarsel den advarsels følge:
- Den starter **kvitteret**, så ingen bliver tilkaldt to gange for ét problem. Den genopretter sig selv, så snart dens data gør.
- Dens feed fortæller, hvilken advarsel der forårsagede den, og det gør dens kort **Data** også.
- Den slutter sig til årsagens episode, når årsagen er i en.

Årsagens kort **Data** viser dens **Nedstrøms påvirkning**: hver advarsel, den har forårsaget. En tabeladvarsels kort viser også de tjenester, der skriver til tabellen, med deres fejlede skrivninger og deres udrulninger og andre ændringer i døgnet før advarslen.

Under kortet **Data** tegner en advarsels side dens **Afstamning**: omkring dens tabel, som tabellens fane **Afstamning** tegner den, eller omkring dens pipeline, med vejen op til den advarsel, der forårsagede den, og ned til hver advarsel, den forårsagede, fremhævet, årsagen markeret **Årsag** og hver advarsel, den forårsagede, **Følge**. Når årsagen er på en pipeline, der er tegnet på en pil, siger pilen **Årsag** under pipelinens navn. En advarsel fra en kontrol på én kolonne, såsom en kontrol Andel NULL på \`customer_id\`, åbner med den kolonne fulgt ved siden af disse veje, som på tabellens fane **Afstamning**; vælg dér en anden af tabellens kolonner, eller ryd den for kun at se vejene. Den, der ikke må se den advarsel, der forårsagede den, får hverken kortet **Data** eller afstamningen, og en forårsaget advarsel, som vedkommende ikke må se, bliver hverken fremhævet eller talt med. Den samme afstamning findes på \`POST /api/data-observability/alerts/<alert ID>/lineage\`, med den \`column\`, som en kolonnekontrols advarsel læser, og de kolonner, hver pil bærer. En forårsaget alarm på en pipeline, der er tegnet på en pil, siger **Følge** der på samme måde, og kolonnevælgeren tilbyder først kontrollens kolonne og derefter tabellens øvrige kolonner i dens egen rækkefølge.


## OneUptime AI

- **Undersøgelser af dataadvarsler.** Når OneUptime AI undersøger en advarsel på en tabel, en pipeline eller en database, læser den det, der ligger ved siden af: tabellens friskhed og dens åbne advarsler, den advarsel, den er en følge af, kørslerne af de pipelines, der skriver til den, siden dagen før (en fejlet kørsel med sin fejl), de tjenester, der skriver til den, med deres fejlede skrivninger og deres udrulninger og andre ændringer, og dens afstamning: de tabeller, den er bygget ud fra, og de tabeller, der er bygget ud fra den, dem med et problem først, med hvor den advarsel, den er en følge af, ligger, og hvilke tabeller de advarsler, den forårsagede, ligger på. For en advarsel fra en kontrol på én kolonne følger den også den kolonne gennem afstamningen: de kolonner, den er bygget ud fra opstrøms, og de kolonner, der er bygget ud fra den nedstrøms, tabel for tabel. Den navngiver den kørsel, udrulning eller opstrøms tabel, der ligger bag advarslen. Alle, der må se advarslen, læser dens rapport, så den læser kun det, de alle må læse: hvor en rolle kun læser tabeller eller pipelines ud fra **Ejere** eller **Etiketter**, ingen af dem, som disse sætter til side, ud over advarslens egen tabel eller pipeline. Den nævner eller tæller aldrig andre, hverken i det, den tager udgangspunkt i, eller i det, den spørger om undervejs.
- **Et tjek ud fra en sætning.** På en tabels fane Tjek gør **Skriv et tjek ud fra en sætning** en regel som "ordrer har aldrig en negativ total" til en kontrol med brugerdefineret SQL, der tæller de rækker, der bryder den, med en advarsel, så snart der er nogen. Du læser forespørgslen, før **Tilføj tjek** tilføjer den, og den er underlagt alt, hvad enhver kontrol med brugerdefineret SQL er: én skrivebeskyttet sætning, kørt i en skrivebeskyttet transaktion.
- **Er denne tabel frisk?** Spørg OneUptime AI i Spørg AI, Slack eller Microsoft Teams ("er tabellen orders frisk?"). Den svarer med tabellens friskhed efter dens egen rytme, hvornår den sidst ændrede sig, dens åbne advarsler, dens skriveres seneste kørsler og de dataprodukter, den er en del af. AI-agenter spørger om det samme via MCP-serverens værktøj \`get_data_table_freshness\`, før de bruger dataene.
- **Hvad er denne tabel bygget ud fra?** Spørg på samme måde ("hvad føder tabellen revenue?", "hvad går i stykker, hvis raw.orders holder op med at indlæse?"). Den følger tabellens afstamning tre trin i hver retning, eller op til fem, når der bedes om det, og sætter de opstrøms og nedstrøms tabeller først, der er forsinkede, slettede, har åbne advarsler, eller hvis pipeline fejlede sin seneste kørsel, de nærmeste først, med hvor mange trin væk hver er og tabellerne imellem; derefter resten, de pipelines, der indlæser dens kilder uden for det, OneUptime overvåger, og de BI-dashboards, der er bygget på den. Åbne advarsler tælles, navngives aldrig, og kun dem, som den, der spørger, må se. AI-agenter spørger om det samme via MCP-serverens værktøj \`get_data_table_lineage\`, før de ændrer en tabel. Tabellerne længere væk, end det fortæller om, tæller det hver én gang, uanset hvor mange af de nævnte tabeller de ligger ved siden af. Åbnet på en tabels side ved Spørg AI, hvilken tabel "denne tabel" er, og spørger om netop den, også når flere databaser har en tabel med det navn. Som enhver visning af afstamning fortæller det kun om de tabeller og pipelines, den, der spørger, må læse.

## Tjenester, der bruger hver tabel

En tabels fane **Tjenester** viser de tjenester, der er set skrive til og læse fra den, med de sætninger, hver kørte, dens kald og fejl i den seneste time, og hvornår den sidst blev set. Det kommer fra de database-spans, dine tjenester allerede sender med OpenTelemetry: et klient-span med \`db.system.name\`, \`db.namespace\` og \`db.collection.name\` (eller \`db.sql.table\`, eller et span med et navn som \`INSERT orders\`). Intet ekstra at installere. Det opdateres hvert 15. minut.

Hver tjeneste viser også de endpoints, der laver dens kald, og markeres som **AI-app**, når den også kalder en model. **Fejl, der nævner denne tabel** viser de åbne undtagelser og det seneste døgns fejllogs fra de tjenester, der skriver til tabellen, når de nævner den ved navn.

Et span knyttes kun til en tabel, når dets database er den, en indsamling har læst, og når to databaser deler et navn, kun når dets \`server.address\` er en af deres. Når den ikke er sikker, udelader den spannet.

Disse metrikker er OneUptimes egne driftsdata og faktureres ikke som telemetri.
`;

export default DOCUMENTATION;
