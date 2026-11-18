/*
 * The Data Observability Documentation page in Norwegian: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Norwegian words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Hva Data Observability overvåker

Hver tabell og hver visning i hver tilkoblede database, hvert femte minutt:

- **Antall rader og størrelse**, fra motorens egen statistikk.
- **Når den sist endret seg**: MySQL og SQL Server oppgir det; for PostgreSQL følger OneUptime med på tellerne for innsettinger, oppdateringer og slettinger og noterer når de beveger seg.
- **Kolonnene dens**: en kolonne som legges til, fjernes, får nytt navn, får en annen type eller gjøres nullable, havner på tabellens tidslinje og under Skjemaendringer.
- **Den vanlige rytmen dens**: hvor ofte den vanligvis endrer seg. En tabell som går godt forbi rytmen sin, vises som **Sen**.

Bare databasens katalog leses, og på MongoDB feltnavnene i de nyeste dokumentene i en samling. Ingen verdi forlater databasen.

En katalog kan si at en tabell har endret seg når bare det interne vedlikeholdet har gjort det, eller ikke si noe i det hele tatt. Oppgi en **Freshness-kolonne** som \`updated_at\` i tabellens **Innstillinger**, så blir den siste endringen den kolonnens nyeste verdi. Påloggingen må kunne lese kolonnen, og den bør være indeksert.

En lesereplika av PostgreSQL eller SQL Server flytter ikke skrivetellerne sine, så OneUptime utelater dem der og sier det på databasen.

## Oversikten

**Oversikt** viser hvordan dataene dine står nå. Inntil prosjektet er satt opp, viser den stegene som gjenstår: varsler på hver database, eiere for tabellene, en sjekk og pipeline-kjøringene dine. **Krever handling** viser det som trenger noen, det verste først: en database som ikke kunne leses, en pipeline-kjøring som feilet eller er sen, en sjekk som feiler eller ikke kunne kjøre, en avstemming som har drevet fra hverandre, og et dataprodukt eller en tabell som er sen. Hvert punkt sier hvem det tilhører, og om varselet er åpent, eller at ingen får beskjed fordi databasen ikke har noe varsel slått på, og åpner siden der det rettes. **Databaser** viser hvordan den siste lesingen av hver database gikk, og om varslene er slått på. Tallet ved **Oversikt** i menyen teller det som krever noen, og **Problemer**, rett under, viser hvert av dem, én side om gangen, filtrert på type, database, eier (eller **Ingen eier**) og om et varsel er åpent. Hvert tall på **Oversikt** åpner sin liste: **Krever handling** åpner **Problemer**, **Sene tabeller** åpner **Tabeller** med bare de sene, og **Sjekker som feiler** åpner **Sjekker** med bare de som feiler.

## Koble til en database

Bruk en **skrivebeskyttet pålogging**. Velg **Koble til en database** i oversikten eller under Databaser, og deretter ett av disse:

- **OneUptime kobler til**: lim inn en tilkoblingsstreng. Den lagres kryptert og vises aldri igjen.
- **En sonde i mitt nettverk kobler til**: velg en av prosjektets sonder og oppgi miljøvariabelen på sonden som inneholder tilkoblingsstrengen (for eksempel \`ORDERS_DB_URL\`). Tilkoblingsstrengen forlater aldri nettverket ditt. Oppdater sonden til nyeste versjon først.

En database som allerede er koblet til for Datasikkerhet, overvåkes også.

**Databaser du kan koble til**, på samme side, viser det prosjektet ditt allerede kjenner til og som ingen har koblet til: databaser som tracene dine snakker med, databaser i skykontoene dine og databaser som Databaseovervåking følger med på. **Koble til** fyller ut skjemaet på forhånd med det som er kjent om hver av dem. Ingenting leses før du kobler den til.

## Lagringsstier

En eksport som lander i en bucket hver natt, kan være like sen eller ufullstendig som en hvilken som helst tabell. Under **Lagringsstier** velger du **Rediger stier** for en bucket som skytilkoblingen din har funnet, på Amazon S3, Google Cloud Storage eller en Azure-lagringskonto, og oppgir stiene som betyr noe, én per linje. Hver av dem vises under **Tabeller**: det nyeste objektet er når den sist endret seg, objektene er radene, og de samme varslene gjelder. Bare navn, størrelser og tidspunkter leses, aldri et objekt.

### En skrivebeskyttet pålogging, per motor

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL og MariaDB (\`performance_schema\` lar OneUptime se skrivinger mellom innsamlingene):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` lar OneUptime lese størrelser og siste oppdateringer):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: koble til med en PostgreSQL-tilkoblingsstreng til endepunktet for klyngen eller arbeidsgruppen, for eksempel \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\` lar OneUptime lese antall rader og størrelser (\`svv_table_info\`), de siste skrivingene og lesingene fra hver brukers spørringer (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, som beholdes i noen dager) og opphavet til hver brukers spørringer. Uten den sier en endring i radene i en tabell fortsatt når den endret seg.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: opprett en bruker med et nøkkelpar (uten passord), og koble til med JSON som oppgir kontoidentifikatoren, brukeren, den private nøkkelen (ukryptert PKCS#8), databasen og et warehouse for sjekker:

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

Innsamlingen leser katalogen med SHOW, som ikke trenger noe warehouse, så den koster ingen credits. Bare datasjekker kjører på warehouset, etter tidsplanen du gir dem. Snowflake oppgir ikke siste endring for noen tabell, så en tabell har endret seg når radene eller bytene har beveget seg.

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

Google BigQuery: hvert datasett som Google Cloud-tilkoblingen din har funnet, overvåkes allerede, med tilkoblingens tjenestekonto, uten noe å koble til. Gi tjenestekontoen **BigQuery Metadata Viewer** og **BigQuery Job User** på prosjektet, og **BigQuery Data Viewer** på tabellene sjekkene dine leser. Hver innsamling leser datasettets \`__TABLES__\` (rader, bytes og siste endring, uten kostnad) og dets \`INFORMATION_SCHEMA.COLUMNS\` (fakturert etter BigQuerys minimum på 10 MB). Legg til **BigQuery Resource Viewer** på prosjektet for opphav fra jobbene, lest én gang i timen (se Opphav som databasene oppgir). For å koble til et datasett uten en Google Cloud-tilkobling velger du **Google BigQuery** og oppgir JSON med en nøkkel for en tjenestekonto:

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: koble til via HTTP-grensesnittet, port 8443 med TLS (ClickHouse Cloud) eller 8123 uten, for eksempel \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Oppgi en database for å overvåke bare den; utelat den for å overvåke alle databaser unntatt serverens egne. \`system.parts\` lar OneUptime se hver innsetting mellom innsamlingene (en merge teller ikke), \`system.part_log\` gir, der serveren fører den, tidspunktet for hver innsetting, og \`system.query_log\` gir hver tabells siste lesing og opphav fra \`INSERT ... SELECT\`, én gang i timen. Hver setning kjører med \`readonly\` satt, så selv en pålogging som kunne skrive, ikke kan det.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: én Unity Catalog-katalog er en database. Skjemaene, tabellene, visningene og kolonnene, og den siste commiten for hver Delta-tabell, leses fra Unity Catalogs REST-API uten SQL-warehouse, så innsamlingen koster ingen databehandling. Datasjekker, og opphav, siste skrivinger og siste lesinger fra systemtabellen \`system.access.table_lineage\` (én gang i timen), kjører på SQL-warehouset du oppgir. Koble til med en tjenestekontohaver (eller et personlig tilgangstoken i stedet for \`clientId\` og \`clientSecret\`: \`"token": "dapi..."\`):

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

Oracle: koble til med \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\`, eller JSON \`{ "user", "password", "connectString" }\`. Det leses over Oracles egen protokoll, uten noen Oracle-klient å installere. Påloggingen ser tabellene den har lov til å lese: gi \`READ\` på hver tabell som skal overvåkes (den kan spørre dem, aldri låse eller endre dem). \`SELECT_CATALOG_ROLE\` lar OneUptime lese størrelsen på hver tabell; uten den har bare påloggingens egne tabeller en størrelse. \`ALL_TAB_MODIFICATIONS\` oppgir hver tabells innsettinger, oppdateringer og slettinger siden siste statistikk, og når den sist endret seg.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: én Glue-database er en database. Tabellene og visningene, kolonnene og statistikken deres, og den siste commiten for hver Iceberg-tabell kommer fra API-et til Glue Data Catalog, som ikke leser data og ikke koster noe; sjekker kjører som Athena-spørringer i arbeidsgruppen du oppgir. Koble til med nøklene til en IAM-bruker eller -rolle som kan lese Glue-databasen og kjøre Athena-spørringer:

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

Den trenger \`glue:GetDatabase\` og \`glue:GetTables\` på databasen og tabellene dens, og for sjekker \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` og \`athena:StopQueryExecution\` på arbeidsgruppen, med lesetilgang til tabellenes S3-data og skrivetilgang til utdataplasseringen.

MongoDB: koble til med tilkoblingsstrengen - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`, eller \`mongodb://\` med vertene i et replikasett. En database i stien er den eneste som overvåkes; uten en overvåkes hver database påloggingen kan lese. Dokumentene, størrelsen og skrivingene i hver samling kommer fra \`$collStats\`, og når den sist tok imot et dokument, fra den nyeste \`_id\`. Feltene kommer fra validatorens JSON-skjema, eller ellers fra navnene og typene på feltene i de 100 nyeste dokumentene, beregnet i databasen slik at ingen verdi forlater den. Dokumenter leses på en sekundær der det finnes en. Kildesamlingen til en visning er opphav, og en egendefinert sjekk er en aggregeringspipeline, som JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

For å overvåke bare én database gir du \`{ role: "read", db: "orders" }\` i stedet for \`readAnyDatabase\`.

Microsoft Dataverse: ett miljø er en database, med tabellene i \`dbo\`, slik SQL-endepunktet navngir dem. OneUptime logger på som en app: registrer en i Microsoft Entra ID med en klienthemmelighet, og legg den til i miljøet som programbruker (Power Platform admin center > the environment > Settings > Users + permissions > Application users) med en sikkerhetsrolle som kan lese tabellene. Koble til med JSON, eller med en Dataverse-tilkoblingsstreng som oppgir \`AuthType=ClientSecret\`. Leieren kan utelates: miljøet sier hvilken det ligger i.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

Hvert femte minutt gir Web API-et definisjonen av hver tabell, radene fra øyeblikksbildet Dataverse tar én gang om dagen (de henger altså opptil en dag etter), og den nyeste \`modifiedon\`, som er når den sist endret seg. Kolonnene leses én gang i timen. Hver lesing teller mot appens forespørselsgrenser i Dataverse, og en innsamling som blir bedt om å sakke ned, overlater resten til den neste. Et miljø inneholder hundrevis av egne tabeller, så bare de sentrale forretningstabellene (kontoer, kontakter, kundeemner, salgsmuligheter, tilbud, ordrer, fakturaer, produkter, saker, e-poster, telefonsamtaler, avtaler, oppgaver og notater) og dine egne egendefinerte tabeller overvåkes. Tabeller fra Microsofts apper (\`msdyn_\`, \`adx_\` og de andre \`ms\`-prefiksene) utelates: oppgi en hvilken som helst annen tabell som skal overvåkes, som i \`"tables": ["msdyn_workorder"]\`.

Datasjekker kjører som skrivebeskyttet SQL på miljøets TDS-endepunkt, på port 1433 eller 5558. Det er slått på med mindre en administrator har slått det av; der tilgangskontroll på brukernivå er slått på for det, trenger appens rolle rettigheten **Allow user to access TDS endpoint**. SQL-en har ingen regulære uttrykk, ingen \`WITH\` og ikke noe utvalg.

## Måledata som hver tabell skriver

Hver innsamling skriver disse for hver tabell, slik at du kan vise dem i diagrammer, legge dem på dashbord og lage varsler på dem som på alle andre måledata:

| Måledata | Hva det er |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Rader i tabellen |
| \`oneuptime.data.table.size\` | Bytes som tabellen og indeksene tar |
| \`oneuptime.data.table.seconds_since_change\` | Sekunder siden en rad sist ble satt inn, oppdatert eller slettet |
| \`oneuptime.data.table.overdue_seconds\` | Sekunder tabellen er forbi tidspunktet den vanligvis endrer seg innen; 0 så lenge den er i rute. Skrives når rytmen er lært |
| \`oneuptime.data.table.row_count_change_percent\` | Hvor mye antall rader har beveget seg siden forrige innsamling, i prosent (-50 er halvparten av radene borte). Tabeller under 1 000 rader utelates |
| \`oneuptime.data.table.schema_changes\` | Kolonner som er endret siden forrige innsamling |
| \`oneuptime.data.table.breaking_schema_changes\` | Kolonner som er fjernet, har fått nytt navn eller en annen type siden forrige innsamling |

Hver rad har \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` og \`oneuptime.data.table.key\` (\`schema.table\`). En målingsmonitor gruppert etter \`oneuptime.data.table.key\` varsler én gang per tabell, og filtrene **Unormalt høy** og **Unormalt lav** sammenligner hver tabell med dens egen vanlige verdi for den timen i uken, så ingen terskel må settes.

## Varsler

En database du kobler til, åpner på sine **Anbefalte varsler**; senere velger du dem for den under **Databaser**. Hver anbefaling er én målingsmonitor for hele databasen som varsler én gang per tabell, så også en tabell som opprettes senere, overvåkes:

| Varsel | Utløses når |
| --- | --- |
| **Tabellen er sen** | En tabell blir i femten minutter forbi tidspunktet den vanligvis endrer seg innen - samme regel som merket **Sen** |
| **Antall rader falt kraftig** | En tabell mister halvparten av radene sine eller mer mellom to innsamlinger |
| **Antall rader uvanlig lavt** | En tabell har langt færre rader enn vanlig for den timen i uken (lærer over to uker) |
| **Skjema endret** | Kolonner i en tabell fjernes, får nytt navn eller en annen type. En kolonne som legges til, ødelegger ingenting og blir på tidslinjen |
| **Tabelltilstand rapporterer ikke lenger** | Ingen tabell i databasen er lest på femten minutter |

Velg alvorlighetsgrader, vaktpolicyer, eiere og etiketter når du oppretter dem. Deretter er de vanlige monitorer: rediger dem, demp dem eller legg dem på en statusside som alle andre.

En backfill eller en migrering bør ikke tilkalle noen. Oppgi databasen under **Data Observability Databaser** på en vedlikeholdshendelse, eller legg databaseserveren dens i en, så holder datavarslene seg stille mens hendelsen pågår.

## Eiere og etiketter

En tabells fane **Eiere** angir personene og teamene den tilhører, og tabellens varsler går til dem; uten eiere til eierne av databasen. **Eierregler** og **Etikettregler** gjelder for hver tabell så snart den dukker opp første gang, ut fra etikettene, eller et regulært uttrykk på navnet, skjemaet eller databasen. En tillatelse som er avgrenset til \`Owned\`, når bare tabellene som innehaveren eller teamene deres eier, med sjekkene, aktiviteten og de rapporterte problemene deres. Å eie en database gjør ikke noen til eier av tabellene: bruk en eierregel for å gi et team en hel database.

## Når et varsel åpnes

En tabells varsel har et kort **Data** som sier hvorfor det mest sannsynlig skjedde, i rekkefølge: et varsel oppstrøms, en mislykket kjøring, en utrulling av en tjeneste som skriver til den, de mislykkede skrivingene, en kolonne som endret seg, databasen eller serveren den kjører på. Under står det som avhenger av den: tabeller, dashbord, tjenester og personene som eier dem. Som varselets **Opphav**-kort forteller det bare om tabellene og pipelinene rollen din kan lese.

Si hva du synes: **Nyttig**, **Forventet** (en planlagt hendelse: ingenting endres) eller **Ikke et problem** (tabellen får mer slingringsmonn, så det samme holder seg stille neste gang). Hvis en person finner et problem først, registrerer **Rapporter et problem** på tabellen det. **Oversikt** viser hvordan det summerer seg: nyttige varsler per uke, hvor mange som ikke var støy, hvor ofte et problem ble oppdaget før noen rapporterte det, hvor raskt, og hvor ofte den sannsynlige årsaken var den virkelige.


## Dataprodukter

Menneskene som bruker data (analytikere, økonomi, ledere, AI-agenter), tenker i det de bruker: "tabellene til omsetningsdashbordet", ikke databaser. Et dataprodukt navngir de tabellene, med eier, forbrukere og SLA for ferskhet. Opprett et under **Dataprodukter**. SLA-en er ett av disse, eller begge:
- **Fersk innen et klokkeslett (UTC):** dataene for hver dag lander den dagen, innen da. Fra det klokkeslettet må hver tabell ha endret seg den dagen; inntil da gjelder gårsdagens innlasting. En innlasting som alltid er en halvtime forsinket, er sen i den halvtimen hver dag.
- **En maksimal alder:** ingen tabells siste endring kan være eldre enn dette.

Hvert femte minutt sammenlignes tabellene i hvert produkt med SLA-en. Produktet er **Sen** når en av tabellene er det, og dataene er fra den eldste siste endringen blant dem. Det skriver \`oneuptime.data.product.late_tables\` og \`oneuptime.data.product.data_age\`, slik at du kan vise ferskheten til hvert produkt side om side.

Når du lagrer et produkt, opprettes også, som deg og med dine tillatelser:
- **En monitor**, som er produktet på en statusside. Den er redusert mens en tabell er sen, og åpner en hendelse og et varsel på prosjektets minst alvorlige nivå, som løser seg selv. Legg den til på en statusside, privat eller offentlig, som en ressurs: forbrukere som abonnerer, får vite når produktet er sent, og når det er ferskt igjen.
- **En SLO** over den monitoren: andelen av tiden dataene er i rute, målt mot produktets SLA-mål over 30 dager, med varslene for rask og langsom burn rate som hver SLO starter med.

Når du sletter produktet, slettes begge. Hvert produkt har også et **merke** som sier når dataene er fra, grønt så lenge de er i rute og ravgult med "late" når de ikke er det. Bygg det inn i et BI-dashbord, en wikiside eller en README fra produktets oversikt. Lenken krever ingen pålogging, så behandle den som en delt lenke; **Tilbakestill merkelenke** lager en ny og trekker tilbake den gamle.

## Sjekker av verdiene i en tabell

Tabelltilstanden sier om en tabell endrer seg. En **sjekk** sier om det den inneholder, er riktig. Legg til en på fanen **Sjekker** for en tabell:

| Sjekk | Hva den leser |
| --- | --- |
| **Andel NULL** | Prosentandel rader der kolonnen er tom |
| **Andel duplikater** | Prosentandel verdier som gjentar en annen rads |
| **Antall unike verdier** | Hvor mange forskjellige verdier kolonnen inneholder |
| **Minimum**, **Maksimum**, **Gjennomsnitt**, **Sum** | Av en numerisk kolonne (en sum av ingen rader er 0) |
| **Andel ugyldige verdier** | Prosentandel verdier utenfor en liste du oppgir |
| **Andel formatfeil** | Prosentandel verdier som ikke er i et format du velger, som E-post, UUID eller Landskode, eller som ikke samsvarer med et regulært uttrykk fra deg (alle motorer unntatt SQL Server) |
| **Antall foreldreløse rader** | Rader der verdien ikke har noen treff i kolonnen til en annen tabell |
| **Antall rader** | Rader i tabellen, mest nyttig med **Segmenter etter** |
| **Egendefinert SQL** | Tallet som en skrivebeskyttet SELECT fra deg returnerer |

**Foreslåtte sjekker** på samme fane tilbyr sjekkene som kolonnene i en tabell legger opp til, bare ut fra navnene og typene deres:
- En id er unik.
- En \`customer_id\` har en tilsvarende rad i \`customers\`.
- En e-postadresse ser ut som en, og et beløp er ikke negativt.
- En status beholder de vanlige verdiene sine.
- En tabell som er delt opp per leietaker, telles per leietaker.

Legg til én, legg til alle, eller avvis én for godt.

**Segmenter etter** kjører en sjekk én gang per verdi i en kolonne, som en leietaker eller en region: én serie og ett varsel hver, for de 100 største segmentene. Et segmentert antall rader varsler når én leietaker slutter å sende data.

Sjekker kjører med databasens innsamling, hos OneUptime eller på sonden, hvert 15. minutt, hver time, hver 6. time eller hver dag. Hver kjører som én aggregeringssetning i en skrivebeskyttet transaksjon med tidsavbrudd for setninger: bare tallet forlater databasen, med mindre et prosjekt velger å beholde et maskert utvalg av rader som feiler. Verdien skrives som \`oneuptime.data.check.value\`, med \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` og \`oneuptime.data.check.segment\`.

Sett **Varsle når** for å varsle på en sjekk:
- **Uvanlig høy** eller **Uvanlig lav** sammenligner hver verdi med dens egen lærte grunnlinje for den timen i uken.
- **Over** eller **Under** sammenligner den med en terskel.

Når du lagrer sjekken, opprettes en målingsmonitor for den, som deg, med dine tillatelser. Hvis du tømmer betingelsen, fjernes monitoren.

**Rader som feiler** teller radene som en skrivebeskyttet SELECT fra deg returnerer: radene som ikke burde finnes. 0 er sunt.

Tre ting holder kostnaden for en sjekk i sjakk. **Utvalgsprosent** leser en andel av radene, for en sjekk som leser en rate. **Mest en kontroll kan lese (GB)**, under **Innstillinger**, stopper en sjekk på BigQuery eller Athena før den leser mer enn det. **Vent når en database er opptatt**, også der, overlater sjekker som skal kjøres til neste innsamling når en PostgreSQL-, MySQL- eller SQL Server-database ser opptatt ut.

**Behold feilaktige rader** under **Innstillinger** beholder opptil 20 rader som feiler fra en sjekk, med sensitive kolonner maskert før de forlater databasen. Den er av til du slår den på. Radene lagres i OneUptime, på OneUptimes servere på OneUptime Cloud og på dine egne på en selvdrevet installasjon, og når du slår den av, slettes de.

Hold sjekker i en fil i repositoryet ditt, og bruk dem fra CI med \`oneuptime data-checks apply checks.yaml\`. Kjør den med \`--dry-run\` på en pull request. En feil hvor som helst i filen gjør at ingenting brukes. Se dokumentasjonen for filformatet.


## Avstemminger

Kopier driver fra hverandre: warehouset har færre ordrer enn applikasjonens database, eller en migrering mistet rader. En avstemming sammenligner ett mål for to tabeller, i én database eller to:
- **Antall rader**
- **Sum** av en kolonne
- **Antall unike verdier** av en kolonne
- **Egendefinert SQL**: en skrivebeskyttet spørring som returnerer ett tall, kalt \`value\`.

Den har en toleranse: et **Absolutt** beløp eller en **Prosent** av kildens verdi. Opprett en under **Avstemminger**.

Hver side leses av en egen datasjekk, som avstemmingen oppretter og holder ved like, med databasens innsamling: hos OneUptime eller på databasens sonde. En avstemming kan derfor sammenligne en PostgreSQL-tabell i nettverket ditt med kopien i Snowflake eller BigQuery. Sjekkene vises på fanen Sjekker for hver tabell og endres bare fra avstemmingen.

De to verdiene sammenlignes så snart begge er lest innen 15 minutter fra hverandre, og begge sidene planlegges deretter til å leses sammen igjen. En avstemming skriver:
- \`oneuptime.data.reconciliation.drifted\`: 1 når de to har drevet fra hverandre utover toleransen, 0 når de stemmer. Monitoren leser dette og varsler når de driver fra hverandre.
- \`oneuptime.data.reconciliation.difference\`: målets verdi minus kildens.
- \`oneuptime.data.reconciliation.difference_percent\`: differansen som prosentandel av kildens verdi.

En side der sjekken feiler, sier hvorfor. En kopi som lastes inn etter en tidsplan, henger etter kilden: sammenlign et mål som begge har roet seg på, som rader eldre enn en time, med egendefinert SQL, eller ta høyde for forsinkelsen i toleransen.

## Pipelines og opphav, fra OpenLineage

Airflow, Dagster, Spark, dbt og Flink beskriver hver kjøring av en jobb med [OpenLineage](https://openlineage.io)-hendelser. Send dem uendret til OneUptime, med en inntaksnøkkel for telemetri (Prosjektinnstillinger > Telemetri og APM > Inntaksnøkler):

- **URL:** \`https://oneuptime.com/telemetry/openlineage\` (på en selvdrevet OneUptime din egen adresse)
- **Endpoint:** \`api/v1/lineage\`, standarden i OpenLineage
- **API-nøkkel:** inntaksnøkkelen. Den sendes som \`Authorization: Bearer\`, eller sett \`x-oneuptime-token\`.

For OpenLineage-leverandøren i Airflow:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

For alle OpenLineage-klienter setter du \`OPENLINEAGE_URL\` og \`OPENLINEAGE_API_KEY\`.

Hver jobb vises under **Pipelines**, med den nyeste kjøringen: når den startet og sluttet, hvor lang tid den tok, og feilen i en mislykket kjøring. En kjøring som leser og skriver tabeller OneUptime overvåker, blir **opphav**: fanen **Opphav** for en tabell viser tabellene den er bygget fra, pipelinene som skriver til den med den nyeste kjøringen deres, og tabellene som er bygget fra den.

Datasett kobles til tabeller etter navnespesifikasjonen i OpenLineage: \`postgres://host:5432\` med \`database.schema.table\`, \`mysql://host:3306\` med \`database.table\`, \`sqlserver://host:1433\` og \`redshift://cluster:5439\` med \`database.schema.table\`, \`snowflake://account\` med \`database.schema.table\`, \`bigquery\` med \`project.dataset.table\`, \`clickhouse://host:8443\` med \`database.table\`, og \`databricks://workspace-host\` med \`catalog.schema.table\`.

Hver pipeline lærer av sine egne kjøringer hvor lang tid en kjøring vanligvis tar (medianen av de siste 20 fullførte kjøringene) og hvor lang tid det går mellom kjøringer etter tidsplanen (det lengste gapet mellom de siste 50 startene som ikke er et enkelttilfelle). Begge er kjent etter fem kjøringer, og passer like godt for en jobb som kjører hvert femte minutt, som for en som kjører om natten. Når scheduleren din sender facetten \`nominalTime\` fra OpenLineage, slik Airflow gjør, står det planlagte tidspunktet for en kjøring for starten, slik at en backfill fortsatt leses som tidsplanen.

Siden for en pipeline anbefaler tre monitorer, hver opprettet med ett klikk:
- **Pipeline-kjøring mislyktes**: en kjøring mislyktes eller ble avbrutt.
- **Pipeline-kjøring uvanlig lang**: en kjøring har tatt dobbelt så lang tid som vanlig, eller mer. Det sjekkes hvert femte minutt mens kjøringen pågår, så en kjøring som henger, oppdages før den slutter.
- **Pipeline er sen**: ingen kjøring har startet på lengre tid enn tidsplanen tillater, med en fjerdedel av intervallet og minst femten minutters slingringsmonn.

De leser disse måledataene, hver merket med \`oneuptime.data.pipeline.id\` og \`oneuptime.data.pipeline.name\`:
- \`oneuptime.data.pipeline.run_failed\`: 1 eller 0, når hver kjøring slutter.
- \`oneuptime.data.pipeline.run_duration\`: sekunder, når hver kjøring slutter.
- \`oneuptime.data.pipeline.run_duration_ratio\`: kjøringens tid delt på tiden til den typiske kjøringen (regnet som minst ett minutt), når hver kjøring slutter og hvert femte minutt mens den kjører.
- \`oneuptime.data.pipeline.overdue_seconds\`: hvor lenge den neste kjøringen er forbi tidsplanen, hvert femte minutt; 0 så lenge den er i rute.

Siden for en pipeline tegner dens **Opphav**, det første stedet å se når en kjøring feiler eller er sen: tabellene den leser, til venstre, tabellene den skriver, til høyre, og hvordan hver av dem står nå. Velg flere steg for å se hva de tabellene er bygget fra, og hva som er bygget fra dem; et antall tabeller som ikke er tegnet, på kortet til pipelinen eller en tabell, tegner flere av dem på stedet. Det samme opphavet finnes på \`POST /api/data-observability/pipelines/lineage\`, for dine egne verktøy. Velg en av kolonnene den skriver for å følge den gjennom pipelinen: opp til kolonnen i hver tabell den leser som den er bygget fra, og ned til hver tabell den skriver den til. Send \`"withColumns": true\` for kolonnene kjøringene flyttet, for dine egne verktøy.



## Synkroniseringer fra Fivetran og Airbyte

Fivetran og Airbyte laster inn rådatatabellene dine og sender ingen OpenLineage-hendelser, men webhookene deres sier når hver synkronisering starter og slutter. Hver Fivetran-connector og hver Airbyte-tilkobling blir en pipeline under **Pipelines**, og hver synkronisering en kjøring, med samme kjøringshistorikk, samme lærte varighet og tidsplan og samme varsler som en hvilken som helst pipeline: en mislykket kjøring, en uvanlig lang og en sen. **Pipelines > Koble til Fivetran eller Airbyte** fyller ut URL-ene nedenfor med en av inntaksnøklene dine.

- **Fivetran:** opprett en webhook med REST-API-et til Fivetran, for kontoen din eller én destinasjonsgruppe, med hendelsene \`sync_start\` og \`sync_end\`. URL-en er \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, og hemmeligheten er den inntaksnøkkelen. Fivetran signerer hver levering med hemmeligheten, så selve nøkkelen reiser aldri i URL-en, og en levering som ikke er signert med den, avvises.
- **Airbyte:** i varslingsinnstillingene for arbeidsområdet ditt setter du webhooken til \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\`, og slår den på for mislykkede og vellykkede synkroniseringer. Airbyte signerer ingenting, så URL-en bærer nøkkelen: gi Airbyte en egen nøkkel.

En pipeline får navnet verktøyet gir connectoren eller tilkoblingen, under \`fivetran://<destination group>\` eller \`airbyte://<workspace>\`. Kjøringen til en mislykket synkronisering viser verktøyets feil. En Fivetran-synkronisering som planlegges på nytt på grunn av en API-grense, ender som **Omplanlagt**: det er ikke en feil, så den tilkaller ingen, og tiden dens lærer ingen varighet.

En Fivetran-connector laster inn skjemaet i destinasjonen sin som er oppkalt etter den. Når nøyaktig én overvåket database har det skjemaet, registrerer tabellene der connectoren som sin skriver: en tabell som blir utdatert, peker på synkroniseringen som skulle ha lastet den inn, og varselet til en mislykket synkronisering er årsaken til tabellenes varsler (se Ett varsel per årsak). Airbyte navngir ingen tabeller.

## Dashbord i BI-verktøy

Den virkelige virkningen av dårlige data er dashbordet noen åpner. Under **BI-dashbord** legger du til BI-verktøyene dine med legitimasjon som kan lese dashbordene deres:

| Verktøy | Legitimasjon (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (eller en brukers \`username\` og \`password\`) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, et personlig tilgangstoken |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, en API-klient |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, en tjenestekontohaver som kan bruke administrator-API-ene til Power BI |
| **Hightouch** | \`{ "apiKey": "..." }\`: hver synkronisering leses som én ting til som avhenger av en tabell |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: hver synkronisering leses som én ting til som avhenger av en tabell |

Hver time, og når et verktøy legges til eller du velger **Les nå**, leser OneUptime hvert dashbord og tabellene bak det: tabellen til et kort og SQL-en til et innebygd spørsmål (Metabase), tabellen til et datasett eller SQL-en til et virtuelt datasett (Superset), oppstrømstabellene i Metadata API (Tableau), explore for hver flis (Looker) og datasettet til hver rapport (Power BI, fra en skanning av arbeidsområdet). Hver tabell kobles til en overvåket tabell ut fra database, skjema og navn; et navn som fortsatt passer på to overvåkede tabeller, forblir ukoblet. Fanen **Opphav** for en tabell, kortet **Data** i varslene og Produksjonsgjennomgang viser dashbordene som er bygget på den, og på tabellene som er bygget fra den. Bare navn og lenker leses, aldri dataene i et dashbord.

Et Power BI-verktøy kan også varsle om mislykkede oppdateringer av datasettene sine. Med **Varsle ved mislykkede oppdateringer** slått på, slik det er for et verktøy som legges til nå, holder OneUptime én monitor for verktøyet som åpner et varsel for hvert datasett der den siste oppdateringen mislyktes eller ble avbrutt, navngitt i tittelen på varselet, og løser det så snart en senere oppdatering er fullført. Den leser \`oneuptime.data.bi.refresh_failed\`, merket med \`oneuptime.data.bi.dataset.name\` og \`oneuptime.data.bi.workspace.name\`: hvert femte minutt skriver hvert datasett som den timevise lesingen fant feilende, 1, og 0 i timen etter at en senere oppdatering er fullført. En oppdatering som fortsatt kjører, endrer ingenting, så én feil er ett varsel, uansett hvor mange timevise lesinger som ser den.

## Jobber i tracene dine

En Kubernetes-CronJob, eller en funksjon på en timer, trenger ingenting installert for å dukke opp som en pipeline: spans med \`k8s.cronjob.name\` eller \`k8s.job.name\`, eller \`faas.name\` med en \`faas.trigger\` på \`timer\` eller \`datasource\`, blir en, med kjøringene og tabellene som databasekallene har berørt. Hver kjøring lenker til sin trace og sine logger, og en CronJob som slutter å kjøre, oppdages som sen.

## Opphav som databasene oppgir

Opphav trenger ikke en pipeline som sender OpenLineage. Hver database oppgir selv en del av det, og OneUptime leser det med databasens innsamling:
- **Visninger:** en visning er bygget fra tabellene den er definert på, i PostgreSQL, Redshift, MySQL 8 og SQL Server. Når en visning defineres på nytt eller slettes, forsvinner det gamle opphavet med den.
- **Spørringshistorikk:** en spørring som leste én tabell og skrev en annen, som en planlagt spørring, en dbt-modell eller en MERGE, er også opphav. Det kommer fra jobbene i BigQuery (visningen \`INFORMATION_SCHEMA.JOBS\` for datasettets prosjekt og plassering, som trenger **BigQuery Resource Viewer**) og spørringsloggen i Redshift (\`stl_insert\` og \`stl_scan\`, som trenger \`SYSLOG ACCESS UNRESTRICTED\`). Bare jobber som er kjørt i datasettets eget prosjekt, er i jobbvisningen.

Opphav leses én gang i timen, tilbake til forrige lesing, og en uke tilbake ved en databases første innsamling, så det er der fra starten. En lesing i BigQuery faktureres for timene med jobber den leser, for det meste etter BigQuerys minimum på 10 MB.

Hver kant på fanen **Opphav** for en tabell sier hvor den ble sett: i en pipelines kjøring, i spørringshistorikken (med en pålogging der spørringene flyttet dataene) eller i definisjonen av en visning. Opphav fra alle kilder teller med for **Ett varsel per årsak**.

Øverst på fanen **Opphav** for en tabell tegner et diagram opphavet noen steg i hver retning (tre, eller velg 1, 2 eller 5): det den er bygget fra, til venstre, tabellene og dashbordene som er bygget fra den, til høyre, og pipelinene som laster inn data utenfra der de kommer inn. Hvert kort sier hvordan det står nå - sen, et åpent varsel, en mislykket kjøring - og en pil blir rød når den nyeste kjøringen til pipelinen dens mislyktes, så en sen tabell kan følges opp til kjøringen som ødela den. Åpne en hvilken som helst tabell for å sentrere diagrammet på den. Et kort tegner høyst ti tabeller i hver retning og teller resten, som **+14**: velg antallet for å tegne de neste der de er, og **Tilbakestill diagram** for å gå tilbake. Der kildene navngir kolonner, velger du en av tabellens kolonner i **Følg en kolonne** for å fremheve hvor den kommer fra og hvor den går, også der den får nytt navn underveis. Det samme opphavet finnes på \`POST /api/data-observability/tables/lineage\`, for dine egne verktøy: send \`"withColumns": true\` for kolonnene til hver pil, og spør \`POST /api/data-observability/lineage/expand\` om de neste tabellene til et kort. Opphav viser bare tabellene og pipelinene rollen din kan lese: det du ikke kan lese, blir aldri tegnet, nevnt på en pil eller telt.

## dbt

Etter \`dbt build\` (eller run, test, seed eller snapshot) sender du prosjektets artefakter med CLI-en og en inntaksnøkkel for telemetri. Den leser \`target/manifest.json\` og \`target/run_results.json\` og sender bare det Data Observability leser av dem:

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

I CI kjører du \`oneuptime dbt upload\` som steget etter bygget, også når bygget feiler, slik at mislykkede tester registreres. For en dbt Cloud-jobb laster du ned artefaktene med API-et til dbt Cloud og laster dem deretter opp med \`--manifest\` og \`--run-results\`. Eller send dem selv: \`POST /telemetry/dbt/v1/artifacts\` med \`{ "manifest": ..., "run_results": ... }\` og nøkkelen i \`x-oneuptime-token\`.

Hva hver opplasting gjør:
- **Tabeller:** hver modell, seed, snapshot og kilde som er en tabell OneUptime overvåker, får et kort **dbt** på oversikten sin: noden, materialiseringen, eier, tagger og siste bygg. dbt-beskrivelsen fyller ut tabellens beskrivelse når den er tom. En tabell kobles ut fra database, skjema og navn, for PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse og Databricks. dbt kjenner ikke verten, så når to overvåkede databaser har samme navn, forblir tabellene deres ukoblet, med mindre bare én av dem inneholder tabellen.
- **Opphav:** det hver modell er bygget fra, blir opphav på fanen **Opphav** for tabellen, via prosjektets pipeline.
- **Tester:** hver test av en overvåket tabell vises på fanen **Sjekker**, med siste resultat og radene den fant som feilet. Klikk **Varsle ved feil** for å få en test som feiler, til å åpne et varsel.
- **Bygg:** hvert bygg er en kjøring av prosjektets pipeline under **Pipelines** (navnerom \`dbt\`). Et bygg med en feil eller en mislykket test er en mislykket kjøring, så pipeline-varslene fungerer også på dbt-bygg: mislykket, uvanlig lang og sen.

## Ubrukte tabeller

Hver motor teller lesingene av hver tabell i sin egen statistikk:
- PostgreSQL: skanningene.
- MySQL: lesingene i performance_schema.
- SQL Server: seeks, scans og lookups, med tidspunktet for den siste.

Hver innsamling sammenligner telleren med den sist lagrede, så **Sist lest** for en tabell er kjent på timen, og det samme er tidspunktet siden den ikke har hatt noen. En teller på 0 ved en tabells første innsamling betyr at den ikke er lest siden motorens statistikk startet, så en ubrukt tabell vises som ubrukt fra starten, ikke etter måneder med overvåking. En lesing som ses i databasespans for en tjeneste, teller også.

**Ubrukte tabeller** viser tabellene ingen har lest på 90 dager, de største først, med når det sist ble skrevet til hver: en tabell som det fortsatt skrives til, men som aldri leses, koster skrivingene og lagringen sin. Oversikten viser hvor mange det er, og hva de inneholder. Visninger har ingen egne tellere, så de vises aldri. Når databasepåloggingen ikke kan lese tellerne, er ikke den siste lesingen av en tabell kjent.

## Lagerforbruk

Én gang i timen, med innsamlingen for hvert warehouse, leser OneUptime hva Snowflake og BigQuery har brukt det siste døgnet, jobb for jobb: beregningscredits i Snowflake fra \`QUERY_ATTRIBUTION_HISTORY\` (med \`IMPORTED PRIVILEGES\` på databasen \`SNOWFLAKE\`, kjørt på tilkoblingens warehouse) og fakturerte bytes i BigQuery fra jobbvisningen (med **BigQuery Resource Viewer**). En jobb er én spørring som kjøres igjen og igjen - den parametriserte spørringen i Snowflake, spørringen i BigQuery uten literalene - navngitt etter query-taggen eller etiketten, eller etter hva den gjør og tabellen den skriver, og aldri etter teksten i spørringen.

**Lagerforbruk** viser dagens credits og fakturerte bytes, per team (\`team\` i query-taggen eller etiketten til en jobb, ellers den som kjører den), tabellene der skrivingene koster mest (forbruket til en jobb fordelt på tabellene den skriver, der ACCESS_HISTORY i Snowflake eller måltabellen i BigQuery sier hvilke), jobbene som mislyktes, og hva som går til jobber som bare skriver tabeller ingen har lest på 90 dager.

## Ett varsel per årsak

Når en tabell blir utdatert, blir hver tabell som er bygget fra den, også utdatert. Før et datavarsel åpnes, slår OneUptime opp i opphavet etter et allerede åpent varsel på det tabellen eller pipelinen er bygget fra: tabellene oppstrøms, pipelinene som skriver til dem, og databasene de ligger i, opptil fem steg opp. Når den finner et, er det nye varselet en følge av det varselet:
- Det starter **kvittert**, så ingen tilkalles to ganger for ett problem. Det gjenoppretter seg selv så snart dataene gjør det.
- Feeden sier hvilket varsel som forårsaket det, og det gjør kortet **Data** også.
- Det blir med i årsakens episode, når årsaken er i en.

Kortet **Data** for årsaken viser dens **Påvirkning nedstrøms**: hvert varsel den forårsaket. Kortet til et tabellvarsel viser også tjenestene som skriver til tabellen, med de mislykkede skrivingene deres, og utrullingene og andre endringer i døgnet før varselet.

Under kortet **Data** tegner siden for et varsel dets **Opphav**: rundt tabellen, slik fanen **Opphav** for tabellen tegner det, eller rundt pipelinen, med veien opp til varselet som forårsaket det og ned til hvert varsel det forårsaket, fremhevet, årsaken merket **Årsak** og hvert varsel det forårsaket **Følge**. Når årsaken er på en pipeline som er tegnet på en pil, sier pilen **Årsak** under navnet på pipelinen. Et varsel fra en sjekk på én kolonne, som en sjekk Andel NULL på \`customer_id\`, åpnes med den kolonnen fulgt ved siden av disse veiene, som på fanen **Opphav** for tabellen; velg en annen av tabellens kolonner der, eller tøm valget for å se bare veiene. Den som ikke kan se varselet som forårsaket det, får verken kortet **Data** eller opphavet, og et forårsaket varsel som vedkommende ikke kan se, blir verken fremhevet eller telt. Det samme opphavet finnes på \`POST /api/data-observability/alerts/<alert ID>/lineage\`, med \`column\` som varselet til en kolonnesjekk leser, og kolonnene hver pil bærer. Et forårsaket varsel på en pipeline som er tegnet på en pil, sier **Følge** der på samme måte, og kolonnevelgeren tilbyr først kontrollens kolonne og deretter tabellens andre kolonner i dens egen rekkefølge.


## OneUptime AI

- **Undersøkelser av datavarsler.** Når OneUptime AI undersøker et varsel på en tabell, en pipeline eller en database, leser den det som ligger ved siden av: tabellens ferskhet og åpne varsler, varselet den er en følge av, kjøringene til pipelinene som skriver til den siden dagen før (en mislykket kjøring med feilen sin), tjenestene som skriver til den med de mislykkede skrivingene og utrullingene og andre endringer, og opphavet: tabellene den er bygget fra og tabellene som er bygget fra den, de med et problem først, med hvor varselet den er en følge av ligger, og hvilke tabeller varslene den forårsaket ligger på. For et varsel fra en sjekk på én kolonne følger den også den kolonnen gjennom opphavet: kolonnene den er bygget fra oppstrøms og kolonnene som er bygget fra den nedstrøms, tabell for tabell. Den navngir kjøringen, utrullingen eller oppstrømstabellen bak varselet. Alle som kan se varselet, leser rapporten, så den leser bare tabellene og pipelinene som ingen har skilt ut med **Eiere** eller **Etiketter**, og varselets egen tabell eller pipeline. Den navngir eller teller aldri noen andre, verken i det den starter fra eller i det den spør om underveis.
- **En sjekk fra en setning.** På fanen Sjekker for en tabell gjør **Skriv en sjekk fra en setning** en regel som "ordrer har aldri en negativ total" om til en sjekk med egendefinert SQL som teller radene som bryter den, med et varsel så snart det finnes noen. Du leser spørringen før **Legg til sjekk** legger den til, og den er underlagt alt en hvilken som helst sjekk med egendefinert SQL er: én skrivebeskyttet setning, kjørt i en skrivebeskyttet transaksjon.
- **Er denne tabellen fersk?** Spør OneUptime AI i Spør AI, Slack eller Microsoft Teams ("er tabellen orders fersk?"). Den svarer med tabellens ferskhet etter dens egen rytme, når den sist endret seg, de åpne varslene, de nyeste kjøringene til skriverne og dataproduktene den er en del av. AI-agenter spør om det samme via verktøyet \`get_data_table_freshness\` på MCP-serveren, før de bruker dataene.
- **Hva er denne tabellen bygget fra?** Spør på samme måte ("hva mater tabellen revenue?", "hva går i stykker hvis raw.orders slutter å laste inn?"). Den følger tabellens opphav tre steg i hver retning, eller opptil fem når det blir bedt om det, og setter oppstrøms- og nedstrømstabellene som er sene, slettet, har åpne varsler eller der pipelinen feilet siste kjøring, først, de nærmeste først, med hvor mange steg unna hver er og tabellene imellom; deretter resten, pipelinene som laster inn kildene utenfor det OneUptime overvåker, og BI-dashbordene som er bygget på den. Åpne varsler telles, navngis aldri, og bare de som den som spør, kan se. AI-agenter spør om det samme via verktøyet \`get_data_table_lineage\` på MCP-serveren, før de endrer en tabell. Tabellene lenger unna enn det forteller om, teller det hver én gang, uansett hvor mange av de nevnte tabellene de ligger ved siden av. Åpnet på siden til en tabell vet Spør AI hvilken tabell «denne tabellen» er, og spør om akkurat den, også når flere databaser har en tabell med det navnet. Som enhver visning av opphav forteller det bare om tabellene og pipelinene den som spør, kan lese.

## Tjenester som bruker hver tabell

Fanen **Tjenester** for en tabell viser tjenestene som er sett skrive til og lese fra den, med setningene hver kjørte, kallene og feilene den siste timen, og når den sist ble sett. Det kommer fra databasespansene tjenestene dine allerede sender med OpenTelemetry: et klientspan med \`db.system.name\`, \`db.namespace\` og \`db.collection.name\` (eller \`db.sql.table\`, eller et span med et navn som \`INSERT orders\`). Ingenting ekstra å installere. Det oppdateres hvert 15. minutt.

Hver tjeneste viser også endepunktene som gjør kallene, og merkes som **AI-app** når den også kaller en modell. **Feil som nevner denne tabellen** viser de åpne unntakene og feilloggene fra det siste døgnet fra tjenestene som skriver til tabellen, når de nevner den ved navn.

Et span knyttes bare til en tabell når databasen er den en innsamling har lest, og når to databaser har samme navn, bare når \`server.address\` er en av deres. Når den ikke er sikker, utelater den spannet.

Disse måledataene er OneUptimes egne driftsdata og faktureres ikke som telemetri.
`;

export default DOCUMENTATION;
