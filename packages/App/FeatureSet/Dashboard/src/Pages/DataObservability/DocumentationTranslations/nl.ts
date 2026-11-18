/*
 * The Data Observability Documentation page in Dutch: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Dutch words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Wat Data Observability bewaakt

Elke tabel en elke weergave van elke gekoppelde database, elke vijf minuten:

- **Aantal rijen en grootte**, uit de eigen statistieken van de engine.
- **Wanneer hij voor het laatst veranderde**: MySQL en SQL Server melden het; bij PostgreSQL houdt OneUptime de tellers voor invoegingen, updates en verwijderingen in de gaten en noteert wanneer ze bewegen.
- **Zijn kolommen**: een kolom die wordt toegevoegd, verwijderd, hernoemd, van type veranderd of nullable gemaakt, komt in de tijdlijn van de tabel en bij Schemawijzigingen.
- **Zijn gebruikelijke ritme**: hoe vaak hij gewoonlijk verandert. Een tabel die ruim over zijn ritme heen gaat, wordt getoond als **Te laat**.

Alleen de catalogus van de database wordt gelezen, en bij MongoDB de veldnamen van de nieuwste documenten van een collectie. Geen enkele waarde verlaat de database.

Een catalogus kan zeggen dat een tabel is veranderd terwijl alleen het interne onderhoud veranderde, of helemaal niets zeggen. Geef in de **Instellingen** van een tabel een **Freshness-kolom** op, zoals \`updated_at\`, en de laatste wijziging wordt de nieuwste waarde van die kolom. De login moet de kolom kunnen lezen, en die hoort geïndexeerd te zijn.

Een leesreplica van PostgreSQL of SQL Server beweegt zijn schrijftellers niet, dus OneUptime laat ze daar weg en meldt dat bij de database.

## Het overzicht

Het **Overzicht** laat zien hoe uw data er nu voor staan. Zolang het project niet is ingericht, somt het de resterende stappen op: waarschuwingen op elke database, eigenaren voor de tabellen, een controle en de runs van uw pipelines. **Aandacht nodig** somt op wat iemand nodig heeft, het ergste eerst: een database die niet kon worden gelezen, een pipeline-run die mislukte of te laat is, een controle die faalt of niet kon draaien, een reconciliatie die afweek, en een dataproduct of tabel die te laat is. Elk item zegt van wie het is en of de waarschuwing open is, of dat niemand wordt ingelicht omdat er voor de database geen waarschuwing aan staat, en opent de pagina waar het wordt opgelost. **Databases** laat zien hoe de laatste leesbeurt van elke database ging en of de waarschuwingen aan staan. Het getal naast **Overzicht** in het menu telt wat iemand nodig heeft, en **Problemen**, er direct onder, toont ze allemaal, een pagina tegelijk, gefilterd op soort, database, eigenaar (of **Geen eigenaar**) en of er een waarschuwing openstaat. Elk getal op het **Overzicht** opent zijn lijst: **Aandacht nodig** opent **Problemen**, **Late tabellen** opent **Tabellen** met alleen de late, en **Mislukte controles** opent **Controles** met alleen de mislukte.

## Een database koppelen

Gebruik een **alleen-lezen login**. Kies in het overzicht of bij Databases **Een database koppelen**, en vervolgens een van beide:

- **OneUptime maakt verbinding**: plak een verbindingsreeks. Die wordt versleuteld opgeslagen en nooit meer getoond.
- **Een sonde in mijn netwerk maakt verbinding**: kies een van de sondes van dit project en geef de omgevingsvariabele van de sonde op die de verbindingsreeks bevat (bijvoorbeeld \`ORDERS_DB_URL\`). De verbindingsreeks verlaat uw netwerk nooit. Werk de sonde eerst bij naar de nieuwste versie.

Een database die al voor Gegevensbeveiliging is gekoppeld, wordt ook bewaakt.

**Databases die u kunt koppelen**, op dezelfde pagina, somt op wat uw project al kent en wat nog niemand heeft gekoppeld: databases waarmee uw traces praten, databases in uw cloudaccounts en databases die Databasebewaking volgt. **Koppelen** vult het formulier vooraf in met wat er van elke database bekend is. Er wordt niets gelezen totdat u hem koppelt.

## Opslagpaden

Een export die elke nacht in een bucket belandt, kan net zo goed te laat of onvolledig zijn als elke tabel. Kies onder **Opslagpaden** **Paden bewerken** voor een bucket die uw cloudkoppeling heeft gevonden, op Amazon S3, Google Cloud Storage of een Azure-opslagaccount, en geef de paden op die ertoe doen, één per regel. Elk pad verschijnt onder **Tabellen**: het nieuwste object is wanneer het voor het laatst veranderde, de objecten zijn de rijen, en dezelfde waarschuwingen gelden. Alleen namen, groottes en tijden worden gelezen, nooit een object.

### Een alleen-lezen login, per engine

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL en MariaDB (met \`performance_schema\` ziet OneUptime schrijfacties tussen verzamelingen):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (met \`VIEW DATABASE STATE\` leest OneUptime groottes en laatste updates):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: maak verbinding met een PostgreSQL-verbindingsreeks naar het endpoint van het cluster of de werkgroep, bijvoorbeeld \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. Met \`SYSLOG ACCESS UNRESTRICTED\` leest OneUptime aantallen rijen en groottes (\`svv_table_info\`), de laatste schrijf- en leesacties van de query's van elke gebruiker (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, enkele dagen bewaard) en de herkomst van de query's van elke gebruiker. Zonder dat zegt een verandering in de rijen van een tabel nog steeds wanneer hij veranderde.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: maak een gebruiker aan met een sleutelpaar (zonder wachtwoord) en maak verbinding met JSON die de account-ID, de gebruiker, de privésleutel (onversleutelde PKCS#8), de database en een warehouse voor controles noemt:

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

De verzameling leest de catalogus met SHOW, dat geen warehouse nodig heeft, en kost dus geen credits. Alleen datacontroles draaien op het warehouse, volgens het schema dat u ze geeft. Snowflake noemt van geen enkele tabel de laatste wijziging, dus een tabel is veranderd wanneer de rijen of bytes bewogen.

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

Google BigQuery: elke dataset die uw Google Cloud-koppeling heeft gevonden, wordt al bewaakt, met het serviceaccount van die koppeling, zonder iets te koppelen. Geef het serviceaccount **BigQuery Metadata Viewer** en **BigQuery Job User** op het project, en **BigQuery Data Viewer** op de tabellen die uw controles lezen. Elke verzameling leest \`__TABLES__\` van de dataset (rijen, bytes en laatste wijziging, kosteloos) en de \`INFORMATION_SCHEMA.COLUMNS\` ervan (gefactureerd tegen het minimum van 10 MB van BigQuery). Voeg **BigQuery Resource Viewer** toe op het project voor herkomst uit de jobs, eenmaal per uur gelezen (zie Herkomst die de databases noemen). Om een dataset zonder Google Cloud-koppeling te koppelen, kiest u **Google BigQuery** en geeft u JSON met een serviceaccountsleutel op:

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: maak verbinding via de HTTP-interface, poort 8443 met TLS (ClickHouse Cloud) of 8123 zonder, bijvoorbeeld \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Noem een database om alleen die te bewaken; laat hem weg om elke database behalve die van de server zelf te bewaken. Met \`system.parts\` ziet OneUptime elke invoeging tussen verzamelingen (een merge telt niet), \`system.part_log\` geeft, waar de server het bijhoudt, de tijd van elke invoeging, en \`system.query_log\` geeft eenmaal per uur de laatste leesactie van elke tabel en de herkomst uit \`INSERT ... SELECT\`. Elke instructie draait met \`readonly\` ingesteld, zodat zelfs een login die zou kunnen schrijven dat niet kan.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: één Unity Catalog-catalogus is een database. De schema's, tabellen, weergaven en kolommen ervan, en de laatste commit van elke Delta-tabel, worden gelezen via de REST-API van Unity Catalog zonder SQL-warehouse, dus de verzameling kost geen rekenkracht. Datacontroles, en herkomst, laatste schrijf- en leesacties uit de systeemtabel \`system.access.table_lineage\` (eenmaal per uur), draaien op het SQL-warehouse dat u noemt. Maak verbinding met een service-principal (of een persoonlijk toegangstoken in plaats van \`clientId\` en \`clientSecret\`: \`"token": "dapi..."\`):

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

Oracle: maak verbinding met \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\`, of met JSON \`{ "user", "password", "connectString" }\`. Er wordt gelezen via het eigen protocol van Oracle, zonder Oracle-client te installeren. De login ziet de tabellen die hij mag lezen: verleen \`READ\` op elke tabel die u wilt bewaken (hij kan ze opvragen, nooit vergrendelen of wijzigen). Met \`SELECT_CATALOG_ROLE\` leest OneUptime de grootte van elke tabel; zonder heeft alleen de eigen tabellen van de login er een. \`ALL_TAB_MODIFICATIONS\` noemt de invoegingen, updates en verwijderingen van elke tabel sinds de laatste statistieken, en wanneer hij voor het laatst veranderde.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: één Glue-database is een database. De tabellen en weergaven, hun kolommen en statistieken, en de laatste commit van elke Iceberg-tabel komen uit de API van de Glue Data Catalog, die geen data leest en niets kost; controles draaien als Athena-query's in de werkgroep die u noemt. Maak verbinding met de sleutels van een IAM-gebruiker of -rol die de Glue-database mag lezen en Athena-query's mag uitvoeren:

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

Er is \`glue:GetDatabase\` en \`glue:GetTables\` nodig op de database en de tabellen ervan, en voor controles \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` en \`athena:StopQueryExecution\` op de werkgroep, met leestoegang tot de S3-data van de tabellen en schrijftoegang tot de uitvoerlocatie.

MongoDB: maak verbinding met de verbindingsreeks - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`, of \`mongodb://\` met de hosts van een replicaset. Een database in het pad is de enige die wordt bewaakt; zonder database wordt elke database bewaakt die de login mag lezen. De documenten, grootte en schrijfacties van elke collectie komen uit \`$collStats\`, en wanneer hij voor het laatst een document opnam, uit de nieuwste \`_id\`. De velden komen uit het JSON-schema van de validator, of anders uit de namen en typen van de velden van de 100 nieuwste documenten, berekend in de database zodat geen enkele waarde die verlaat. Documenten worden op een secondary gelezen als die er is. De bron-collectie van een weergave is herkomst, en een aangepaste controle is een aggregatiepipeline, als JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

Om slechts één database te bewaken, verleent u \`{ role: "read", db: "orders" }\` in plaats van \`readAnyDatabase\`.

Microsoft Dataverse: één omgeving is een database, met de tabellen in \`dbo\`, zoals het SQL-endpoint ze noemt. OneUptime meldt zich aan als app: registreer er een in Microsoft Entra ID met een clientgeheim en voeg die aan de omgeving toe als toepassingsgebruiker (Power Platform admin center > the environment > Settings > Users + permissions > Application users) met een beveiligingsrol die de tabellen mag lezen. Maak verbinding met JSON, of met een Dataverse-verbindingsreeks die \`AuthType=ClientSecret\` vermeldt. De tenant mag worden weggelaten: de omgeving zegt in welke hij zit.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

Elke vijf minuten geeft de Web API de definitie van elke tabel, de rijen, uit de momentopname die Dataverse eenmaal per dag maakt (ze lopen dus tot een dag achter), en de nieuwste \`modifiedon\`, het moment van de laatste wijziging. De kolommen worden eenmaal per uur gelezen. Elke leesactie telt mee voor de Dataverse-aanvraaglimieten van de app, en een verzameling die wordt gevraagd te vertragen, laat de rest over aan de volgende. Een omgeving bevat honderden eigen tabellen, dus alleen de belangrijkste bedrijfstabellen (accounts, contactpersonen, leads, verkoopkansen, offertes, orders, facturen, producten, cases, e-mails, telefoongesprekken, afspraken, taken en notities) en uw eigen aangepaste tabellen worden bewaakt. Tabellen van de apps van Microsoft (\`msdyn_\`, \`adx_\` en de andere \`ms\`-voorvoegsels) worden weggelaten: noem elke andere tabel die u wilt bewaken, zoals in \`"tables": ["msdyn_workorder"]\`.

Datacontroles draaien als alleen-lezen SQL op het TDS-endpoint van de omgeving, op poort 1433 of 5558. Het staat aan, tenzij een beheerder het heeft uitgezet; waar toegangsbeheer op gebruikersniveau ervoor aan staat, heeft de rol van de app de bevoegdheid **Allow user to access TDS endpoint** nodig. De SQL ervan kent geen reguliere expressies, geen \`WITH\` en geen steekproef.

## Metrics die elke tabel schrijft

Elke verzameling schrijft deze voor elke tabel, zodat u ze in grafieken kunt weergeven, op dashboards kunt zetten en er waarschuwingen op kunt instellen zoals bij elke andere metric:

| Metric | Wat het is |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Rijen in de tabel |
| \`oneuptime.data.table.size\` | Bytes die de tabel en de indexen innemen |
| \`oneuptime.data.table.seconds_since_change\` | Seconden sinds een rij voor het laatst werd ingevoegd, bijgewerkt of verwijderd |
| \`oneuptime.data.table.overdue_seconds\` | Seconden dat de tabel voorbij het moment is waarop hij gewoonlijk verandert; 0 zolang hij op tijd is. Geschreven zodra het ritme is geleerd |
| \`oneuptime.data.table.row_count_change_percent\` | Hoeveel het aantal rijen sinds de vorige verzameling is veranderd, in procenten (-50 is de helft van de rijen weg). Tabellen onder 1.000 rijen worden weggelaten |
| \`oneuptime.data.table.schema_changes\` | Kolommen die sinds de vorige verzameling zijn gewijzigd |
| \`oneuptime.data.table.breaking_schema_changes\` | Kolommen die sinds de vorige verzameling zijn verwijderd, hernoemd of van type veranderd |

Elke rij draagt \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` en \`oneuptime.data.table.key\` (\`schema.table\`). Een metrics-monitor gegroepeerd op \`oneuptime.data.table.key\` waarschuwt eenmaal per tabel, en de filters **Afwijkend hoog** en **Afwijkend laag** vergelijken elke tabel met zijn eigen gebruikelijke waarde voor dat uur van de week, zodat er geen drempel hoeft te worden ingesteld.

## Waarschuwingen

Een database die u koppelt, opent op zijn **Aanbevolen waarschuwingen**; kies ze later voor hem onder **Databases**. Elke aanbeveling is één metrics-monitor voor de hele database die eenmaal per tabel waarschuwt, zodat ook een later aangemaakte tabel wordt bewaakt:

| Waarschuwing | Gaat af wanneer |
| --- | --- |
| **Tabel is te laat** | Een tabel blijft vijftien minuten lang voorbij het moment waarop hij gewoonlijk verandert - dezelfde regel als het label **Te laat** |
| **Aantal rijen sterk gedaald** | Een tabel verliest tussen twee verzamelingen de helft van zijn rijen of meer |
| **Aantal rijen ongewoon laag** | Een tabel bevat veel minder rijen dan gebruikelijk voor dat uur van de week (leert over twee weken) |
| **Schema gewijzigd** | Kolommen van een tabel worden verwijderd, hernoemd of van type veranderd. Een toegevoegde kolom breekt niets en blijft in de tijdlijn |
| **Tabelstatus meldt niet meer** | Geen enkele tabel van de database is vijftien minuten lang gelezen |

Kies ernsten, on-callbeleid, eigenaren en labels wanneer u ze aanmaakt. Vanaf dan zijn het gewone monitors: bewerk ze, demp ze of zet ze op een statuspagina zoals elke andere.

Een backfill of een migratie hoort niemand op te roepen. Noem de database onder **Databases van Data Observability** in een onderhoudsgebeurtenis, of neem de databaseserver erin op, en de datawaarschuwingen blijven stil zolang de gebeurtenis loopt.

## Eigenaren en labels

Het tabblad **Eigenaren** van een tabel noemt de mensen en teams van wie hij is, en een waarschuwing van de tabel gaat naar hen; zonder eigenaren naar de eigenaren van de database. **Eigenaarsregels** en **Labelregels** gelden voor elke tabel zodra die voor het eerst verschijnt, op basis van de labels, of van een reguliere expressie op de naam, het schema of de database. Een bevoegdheid die beperkt is tot \`Owned\` reikt alleen tot de tabellen van de houder of diens teams, met hun controles, activiteit en gemelde problemen. Wie een database bezit, is daarmee nog geen eigenaar van de tabellen: gebruik een eigenaarsregel om een team een hele database te geven.

## Wanneer een waarschuwing opent

De waarschuwing van een tabel heeft een kaart **Gegevens** die zegt waarom ze het waarschijnlijkst gebeurde, op volgorde: een waarschuwing stroomopwaarts, een mislukte run, een deploy van een service die erin schrijft, de mislukte schrijfacties, een kolom die veranderde, de database of de server waarop hij draait. Daaronder staat wat ervan afhangt: tabellen, dashboards, services en de mensen van wie ze zijn. Net als de kaart **Herkomst** van de waarschuwing vertelt ze alleen over de tabellen en pipelines die uw rol mag lezen.

Zeg wat u ervan vond: **Nuttig**, **Verwacht** (een geplande gebeurtenis: er verandert niets) of **Geen probleem** (de tabel krijgt meer speelruimte, zodat hetzelfde de volgende keer stil blijft). Als iemand een probleem als eerste vindt, legt **Een probleem melden** op de tabel het vast. Het **Overzicht** laat zien hoe het optelt: nuttige meldingen per week, hoeveel geen ruis waren, hoe vaak een probleem werd gezien voordat iemand het meldde, hoe snel, en hoe vaak de waarschijnlijke oorzaak de echte was.


## Dataproducten

De mensen die data gebruiken (analisten, finance, directie, AI-agents) denken in wat ze gebruiken: "de tabellen van het omzetdashboard", niet in databases. Een dataproduct noemt die tabellen, met de eigenaar, de afnemers en de actualiteits-SLA. Maak er een aan onder **Dataproducten**. De SLA is een van beide, of allebei:
- **Actueel op een tijdstip van de dag (UTC):** de data van elke dag komen die dag binnen, vóór dat tijdstip. Vanaf dat tijdstip moet elke tabel die dag zijn veranderd; tot dan geldt de lading van gisteren. Een lading die altijd een half uur te laat is, is elke dag dat halve uur te laat.
- **Een maximale leeftijd:** de laatste wijziging van geen enkele tabel mag ouder zijn dan dit.

Elke vijf minuten worden de tabellen van elk product getoetst aan de SLA. Het product is **Te laat** wanneer een van zijn tabellen dat is, en de data zijn van de oudste laatste wijziging onder hen. Het schrijft \`oneuptime.data.product.late_tables\` en \`oneuptime.data.product.data_age\`, zodat u de actualiteit van elk product naast elkaar kunt weergeven.

Het opslaan van een product maakt ook, namens u en met uw bevoegdheden:
- **Een monitor**, die het product op een statuspagina vertegenwoordigt. Hij is verminderd zolang een tabel te laat is, en opent een incident en een waarschuwing op de laagste ernst van uw project, die vanzelf worden opgelost. Voeg hem als resource toe aan een statuspagina, privé of openbaar: afnemers die zich abonneren, horen wanneer het product te laat is en wanneer het weer actueel is.
- **Een SLO** over die monitor: het deel van de tijd dat de data op tijd zijn, afgezet tegen het SLA-doel van het product over 30 dagen, met de waarschuwingen voor snelle en langzame burn rate waarmee elke SLO begint.

Het verwijderen van het product verwijdert beide. Elk product heeft ook een **badge** die zegt van wanneer de data zijn, groen zolang ze op tijd zijn en amber met "late" zodra dat niet meer zo is. Sluit hem in een BI-dashboard, een wikipagina of een README in vanuit het overzicht van het product. De link vereist geen aanmelding, dus behandel hem als een gedeelde link; **Badgelink opnieuw instellen** maakt een nieuwe en trekt de oude in.

## Controles op de waarden van een tabel

De tabelstatus zegt of een tabel verandert. Een **controle** zegt of wat hij bevat klopt. Voeg er een toe op het tabblad **Controles** van een tabel:

| Controle | Wat hij leest |
| --- | --- |
| **Percentage NULL** | Percentage rijen waarvan de kolom leeg is |
| **Percentage duplicaten** | Percentage waarden dat de waarde van een andere rij herhaalt |
| **Aantal unieke waarden** | Hoeveel verschillende waarden de kolom bevat |
| **Minimum**, **Maximum**, **Gemiddelde**, **Som** | Van een numerieke kolom (een som over geen rijen is 0) |
| **Percentage ongeldige waarden** | Percentage waarden buiten een lijst die u opgeeft |
| **Percentage afwijkende opmaak** | Percentage waarden dat niet in een opmaak staat die u kiest, zoals E-mail, UUID of Landcode, of dat niet overeenkomt met een reguliere expressie van u (elke engine behalve SQL Server) |
| **Aantal verweesde rijen** | Rijen waarvan de waarde geen tegenhanger heeft in de kolom van een andere tabel |
| **Aantal rijen** | Rijen in de tabel, het nuttigst met **Segmenteren op** |
| **Aangepaste SQL** | Het getal dat een alleen-lezen SELECT van u teruggeeft |

**Voorgestelde controles** op hetzelfde tabblad bieden de controles aan die de kolommen van een tabel vragen, alleen op basis van hun namen en typen:
- Een id is uniek.
- Een \`customer_id\` heeft een overeenkomende rij in \`customers\`.
- Een e-mailadres ziet eruit als een e-mailadres, en een bedrag is niet negatief.
- Een status houdt zijn gebruikelijke waarden.
- Een tabel die per tenant is opgesplitst, wordt per tenant geteld.

Voeg er een toe, voeg ze allemaal toe, of wijs er een definitief af.

**Segmenteren op** voert een controle eenmaal uit per waarde van een kolom, zoals een tenant of een regio: één reeks en één waarschuwing per waarde, voor de grootste 100 segmenten. Een gesegmenteerd aantal rijen waarschuwt wanneer één tenant geen data meer stuurt.

Controles draaien met de verzameling van de database, door OneUptime of door de sonde ervan, elke 15 minuten, elk uur, elke 6 uur of elke dag. Elke controle draait als één aggregatie-instructie in een alleen-lezen transactie met een time-out voor instructies: alleen het getal verlaat de database, tenzij een project ervoor kiest een gemaskeerde steekproef van mislukte rijen te bewaren. De waarde wordt geschreven als \`oneuptime.data.check.value\`, met \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` en \`oneuptime.data.check.segment\`.

Stel **Waarschuwen wanneer** in om op een controle te waarschuwen:
- **Ongewoon hoog** of **Ongewoon laag** vergelijkt elke waarde met zijn eigen geleerde basislijn voor dat uur van de week.
- **Boven** of **Onder** vergelijkt hem met een drempel.

Het opslaan van de controle maakt er een metrics-monitor voor, namens u, met uw bevoegdheden. Het leegmaken van de voorwaarde verwijdert de monitor.

**Mislukte rijen** telt de rijen die een alleen-lezen SELECT van u teruggeeft: de rijen die niet zouden mogen bestaan. 0 is gezond.

Drie dingen houden de kosten van een controle in de hand. **Steekproefpercentage** leest een deel van de rijen, voor een controle die een verhouding leest. **Maximaal te lezen door een controle (GB)**, onder **Instellingen**, stopt een controle op BigQuery of Athena voordat hij meer dan dat leest. **Wachten wanneer een database druk is**, ook daar, laat verschuldigde controles over aan de volgende verzameling wanneer een PostgreSQL-, MySQL- of SQL Server-database druk lijkt.

**Mislukte rijen bewaren** onder **Instellingen** bewaart tot 20 mislukte rijen van een controle, waarbij gevoelige kolommen worden gemaskeerd voordat ze de database verlaten. Het staat uit totdat u het aanzet. De rijen worden opgeslagen in OneUptime, bij OneUptime Cloud op de servers van OneUptime en bij een zelf gehoste installatie op uw eigen servers, en het uitzetten verwijdert ze.

Bewaar controles in een bestand in uw repository en pas ze vanuit CI toe met \`oneuptime data-checks apply checks.yaml\`. Voer het uit met \`--dry-run\` op een pull request. Een fout waar dan ook in het bestand zorgt ervoor dat er niets wordt toegepast. De documentatie beschrijft de opmaak van het bestand.


## Reconciliaties

Kopieën lopen uit elkaar: het warehouse heeft minder orders dan de database van de applicatie, of een migratie is rijen kwijtgeraakt. Een reconciliatie vergelijkt één maat van twee tabellen, in één database of in twee:
- **Aantal rijen**
- **Som** van een kolom
- **Aantal unieke waarden** van een kolom
- **Aangepaste SQL**: een alleen-lezen query die één getal teruggeeft, met de naam \`value\`.

Hij heeft een tolerantie: een **Absoluut** bedrag of een **Procent** van de waarde van de bron. Maak er een aan onder **Reconciliaties**.

Elke kant wordt gelezen door een eigen datacontrole, die de reconciliatie aanmaakt en bijhoudt, met de verzameling van de bijbehorende database: door OneUptime of door de sonde van de database. Een reconciliatie kan dus een PostgreSQL-tabel in uw netwerk vergelijken met de kopie ervan in Snowflake of BigQuery. De controles verschijnen op het tabblad Controles van elke tabel en worden alleen vanuit de reconciliatie gewijzigd.

De twee waarden worden vergeleken zodra beide binnen 15 minuten van elkaar zijn gelezen, en daarna worden beide kanten ingepland om weer samen te worden gelezen. Een reconciliatie schrijft:
- \`oneuptime.data.reconciliation.drifted\`: 1 wanneer de twee verder dan de tolerantie uit elkaar zijn gelopen, 0 wanneer ze overeenkomen. De monitor ervan leest dit en waarschuwt wanneer ze uit elkaar lopen.
- \`oneuptime.data.reconciliation.difference\`: de waarde van het doel min die van de bron.
- \`oneuptime.data.reconciliation.difference_percent\`: het verschil als percentage van de waarde van de bron.

Een kant waarvan de controle mislukt, zegt waarom. Een kopie die volgens een schema wordt geladen, loopt achter op de bron: vergelijk een maat waarover beide al tot rust zijn gekomen, zoals rijen ouder dan een uur, met aangepaste SQL, of houd in de tolerantie rekening met de vertraging.

## Pipelines en herkomst, uit OpenLineage

Airflow, Dagster, Spark, dbt en Flink beschrijven elke run van een job met [OpenLineage](https://openlineage.io)-gebeurtenissen. Stuur ze ongewijzigd naar OneUptime, met een telemetrie-ingestiesleutel (Projectinstellingen > Telemetrie & APM > Ingestiesleutels):

- **URL:** \`https://oneuptime.com/telemetry/openlineage\` (bij een zelf gehoste OneUptime uw eigen adres)
- **Endpoint:** \`api/v1/lineage\`, de standaard van OpenLineage
- **API-sleutel:** de ingestiesleutel. Die wordt verzonden als \`Authorization: Bearer\`, of stel \`x-oneuptime-token\` in.

Voor de OpenLineage-provider van Airflow:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

Stel voor elke OpenLineage-client \`OPENLINEAGE_URL\` en \`OPENLINEAGE_API_KEY\` in.

Elke job verschijnt onder **Pipelines**, met de nieuwste run: wanneer die begon en eindigde, hoe lang hij duurde, en de fout van een mislukte run. Een run die tabellen leest en schrijft die OneUptime bewaakt, wordt **herkomst**: het tabblad **Herkomst** van een tabel toont de tabellen waaruit hij is opgebouwd, de pipelines die erin schrijven met hun nieuwste run, en de tabellen die uit hem zijn opgebouwd.

Datasets worden aan tabellen gekoppeld volgens de naamgevingsspecificatie van OpenLineage: \`postgres://host:5432\` met \`database.schema.table\`, \`mysql://host:3306\` met \`database.table\`, \`sqlserver://host:1433\` en \`redshift://cluster:5439\` met \`database.schema.table\`, \`snowflake://account\` met \`database.schema.table\`, \`bigquery\` met \`project.dataset.table\`, \`clickhouse://host:8443\` met \`database.table\`, en \`databricks://workspace-host\` met \`catalog.schema.table\`.

Elke pipeline leert uit zijn eigen runs hoe lang een run gewoonlijk duurt (de mediaan van de laatste 20 voltooide runs) en hoe lang hij volgens zijn schema tussen runs zit (het langste gat tussen de laatste 50 starts dat geen uitzondering is). Beide zijn bekend na vijf runs, en passen bij een job die elke vijf minuten draait net zo goed als bij een die 's nachts draait. Wanneer uw scheduler het facet \`nominalTime\` van OpenLineage stuurt, zoals Airflow doet, staat de geplande tijd van een run voor zijn start, zodat een backfill nog steeds als het schema leest.

De pagina van een pipeline raadt drie monitors aan, elk met één klik aangemaakt:
- **Pipeline-run mislukt**: een run is mislukt of afgebroken.
- **Pipeline-run ongewoon lang**: een run heeft twee keer zo lang geduurd als gebruikelijk, of langer. Dit wordt elke vijf minuten gecontroleerd terwijl de run loopt, zodat een run die vastloopt wordt gezien voordat hij eindigt.
- **Pipeline is te laat**: er is langer geen run gestart dan het schema toestaat, met een kwart van het interval en minstens vijftien minuten speling.

Ze lezen deze metrics, elk voorzien van \`oneuptime.data.pipeline.id\` en \`oneuptime.data.pipeline.name\`:
- \`oneuptime.data.pipeline.run_failed\`: 1 of 0, wanneer elke run eindigt.
- \`oneuptime.data.pipeline.run_duration\`: seconden, wanneer elke run eindigt.
- \`oneuptime.data.pipeline.run_duration_ratio\`: de tijd van de run gedeeld door die van de gebruikelijke run (geteld als minstens een minuut), wanneer elke run eindigt en elke vijf minuten terwijl hij loopt.
- \`oneuptime.data.pipeline.overdue_seconds\`: hoe lang de volgende run over zijn schema heen is, elke vijf minuten; 0 zolang hij op tijd is.

De pagina van een pipeline tekent zijn **Herkomst**, de eerste plek om te kijken wanneer een run mislukt of te laat is: links de tabellen die hij leest, rechts de tabellen die hij schrijft, en hoe elke tabel er nu voor staat. Kies meer stappen om te zien waaruit die tabellen zijn opgebouwd en wat uit hen is opgebouwd; een aantal niet getekende tabellen, op de kaart van de pipeline of van een tabel, tekent er meer van ter plekke. Dezelfde herkomst staat op \`POST /api/data-observability/pipelines/lineage\`, voor uw eigen tools. Kies een van de kolommen die ze schrijft om die over de pipeline heen te volgen: omhoog naar de kolom van elke gelezen tabel waaruit die is gebouwd, en omlaag naar elke tabel waarin ze die schrijft. Stuur voor uw eigen tools \`"withColumns": true\` voor de kolommen die de runs ervan hebben verplaatst.



## Fivetran- en Airbyte-synchronisaties

Fivetran en Airbyte laden uw ruwe tabellen en sturen geen OpenLineage-gebeurtenissen, maar hun webhooks zeggen wanneer elke synchronisatie begint en eindigt. Elke Fivetran-connector en elke Airbyte-verbinding wordt een pipeline onder **Pipelines**, en elke synchronisatie een run, met dezelfde rungeschiedenis, dezelfde geleerde duur en hetzelfde schema, en dezelfde waarschuwingen als elke pipeline: een mislukte run, een ongewoon lange en een te late. **Pipelines > Fivetran of Airbyte koppelen** vult de URL's hieronder in met een van uw ingestiesleutels.

- **Fivetran:** maak met de REST-API van Fivetran een webhook voor uw account of één bestemmingsgroep, met de gebeurtenissen \`sync_start\` en \`sync_end\`. De URL is \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, en het geheim is die ingestiesleutel. Fivetran ondertekent elke levering met het geheim, zodat de sleutel zelf nooit in de URL meereist, en een levering die er niet mee is ondertekend, wordt geweigerd.
- **Airbyte:** stel in de meldingsinstellingen van uw werkruimte de webhook in op \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\`, en zet hem aan voor mislukte en geslaagde synchronisaties. Airbyte ondertekent niets, dus de URL draagt de sleutel: geef Airbyte een eigen sleutel.

Een pipeline heet zoals de tool de connector of de verbinding noemt, onder \`fivetran://<destination group>\` of \`airbyte://<workspace>\`. De run van een mislukte synchronisatie toont de fout van de tool. Een Fivetran-synchronisatie die wegens de snelheidslimiet van een API opnieuw wordt ingepland, eindigt als **Opnieuw gepland**: dat is geen mislukking, dus het roept niemand op, en de tijd ervan leert geen duur.

Een Fivetran-connector laadt het schema van zijn bestemming dat naar hem is genoemd. Wanneer precies één bewaakte database dat schema heeft, registreren de tabellen ervan de connector als hun schrijver: een tabel die verouderd raakt, wijst naar de synchronisatie die hem had moeten laden, en de waarschuwing van een mislukte synchronisatie is de oorzaak van de waarschuwingen van de tabellen (zie Eén melding per oorzaak). Airbyte noemt geen tabellen.

## Dashboards in BI-tools

De echte impact van slechte data is het dashboard dat iemand opent. Voeg onder **BI-dashboards** uw BI-tools toe met inloggegevens die hun dashboards mogen lezen:

| Tool | Inloggegevens (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (of de \`username\` en het \`password\` van een gebruiker) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, een persoonlijk toegangstoken |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, een API-client |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, een service-principal die de beheer-API's van Power BI mag gebruiken |
| **Hightouch** | \`{ "apiKey": "..." }\`: elke synchronisatie wordt gelezen als nog iets dat van een tabel afhangt |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: elke synchronisatie wordt gelezen als nog iets dat van een tabel afhangt |

Elk uur, en wanneer een tool wordt toegevoegd of u **Nu lezen** kiest, leest OneUptime elk dashboard en de tabellen erachter: de tabel van een kaart en de SQL van een native vraag (Metabase), de tabel van een dataset of de SQL van een virtuele dataset (Superset), de stroomopwaartse tabellen van de Metadata API (Tableau), de explore van elke tegel (Looker), en de dataset van elk rapport (Power BI, uit een werkruimtescan). Elke tabel wordt aan een bewaakte gekoppeld op basis van de database, het schema en de naam; een naam die nog op twee bewaakte tabellen past, blijft ongekoppeld. Het tabblad **Herkomst** van een tabel, de kaart **Gegevens** van de waarschuwingen ervan en Productiebeoordeling noemen de dashboards die erop zijn gebouwd, en op de tabellen die eruit zijn opgebouwd. Alleen namen en links worden gelezen, nooit de data van een dashboard.

Een Power BI-tool kan ook waarschuwen bij mislukte vernieuwingen van zijn datasets. Met **Waarschuwen bij mislukte vernieuwingen** aan, zoals bij een tool die nu wordt toegevoegd, houdt OneUptime één monitor voor de tool bij die een waarschuwing opent voor elke dataset waarvan de laatste vernieuwing mislukte of werd geannuleerd, genoemd in de titel van de waarschuwing, en die oplost zodra een latere vernieuwing is voltooid. Hij leest \`oneuptime.data.bi.refresh_failed\`, voorzien van \`oneuptime.data.bi.dataset.name\` en \`oneuptime.data.bi.workspace.name\`: elke vijf minuten schrijft elke dataset die de uurlijkse leesbeurt als mislukt aantrof 1, en 0 voor het uur na een latere voltooide vernieuwing. Een vernieuwing die nog loopt, verandert niets, dus één mislukking is één waarschuwing, hoeveel uurlijkse leesbeurten haar ook zien.

## Jobs in uw traces

Een Kubernetes-CronJob, of een functie met een timer, heeft niets geïnstalleerd nodig om als pipeline te verschijnen: spans met \`k8s.cronjob.name\` of \`k8s.job.name\`, of \`faas.name\` met een \`faas.trigger\` van \`timer\` of \`datasource\`, worden er een, met de runs en de tabellen die de databaseaanroepen hebben geraakt. Elke run linkt naar zijn trace en logs, en een CronJob die niet meer draait, wordt als te laat gezien.

## Herkomst die de databases noemen

Herkomst heeft geen pipeline nodig die OpenLineage stuurt. Elke database noemt er zelf een deel van, en OneUptime leest het met de verzameling van de database:
- **Weergaven:** een weergave is opgebouwd uit de tabellen waarop hij is gedefinieerd, in PostgreSQL, Redshift, MySQL 8 en SQL Server. Wanneer een weergave opnieuw wordt gedefinieerd of verwijderd, verdwijnt zijn oude herkomst mee.
- **Querygeschiedenis:** een query die de ene tabel las en een andere schreef, zoals een geplande query, een dbt-model of een MERGE, is ook herkomst. Die komt uit de jobs van BigQuery (de weergave \`INFORMATION_SCHEMA.JOBS\` van het project en de locatie van de dataset, waarvoor **BigQuery Resource Viewer** nodig is) en het querylogboek van Redshift (\`stl_insert\` en \`stl_scan\`, waarvoor \`SYSLOG ACCESS UNRESTRICTED\` nodig is). Alleen jobs die in het eigen project van de dataset zijn uitgevoerd, staan in de jobsweergave ervan.

Herkomst wordt eenmaal per uur gelezen, terug tot de vorige leesbeurt, en bij de eerste verzameling van een database een week terug, zodat ze er vanaf het begin is. Een leesbeurt bij BigQuery wordt gefactureerd voor de uren aan jobs die ze leest, meestal tegen het minimum van 10 MB van BigQuery.

Elke verbinding op het tabblad **Herkomst** van een tabel zegt waar ze is gezien: in de run van een pipeline, in de querygeschiedenis (met een login waarvan de query's de data verplaatsten) of in de definitie van een weergave. Herkomst uit elke bron telt mee voor **Eén melding per oorzaak**.

Boven aan het tabblad **Herkomst** van een tabel tekent een diagram de herkomst een paar stappen in elke richting (drie, of kies 1, 2 of 5): links waaruit hij is opgebouwd, rechts de tabellen en dashboards die uit hem zijn opgebouwd, en de pipelines die data van buiten laden waar die binnenkomen. Elke kaart zegt hoe het er nu voor staat - te laat, een open waarschuwing, een mislukte run - en een pijl wordt rood wanneer de nieuwste run van zijn pipeline mislukte, zodat een te late tabel kan worden gevolgd tot aan de run die hem kapotmaakte. Open een willekeurige tabel om het diagram erop te centreren. Een kaart tekent hoogstens tien tabellen in elke richting en telt de rest, zoals **+14**: selecteer het aantal om de volgende ervan te tekenen waar ze staan, en **Diagram opnieuw instellen** om terug te gaan. Waar de bronnen kolommen noemen, kiest u een van de kolommen van de tabel in **Een kolom volgen** om te markeren waar hij vandaan komt en waar hij naartoe gaat, zelfs waar hij onderweg wordt hernoemd. Dezelfde herkomst staat op \`POST /api/data-observability/tables/lineage\`, voor uw eigen tools: stuur \`"withColumns": true\` voor de kolommen van elke pijl, en vraag \`POST /api/data-observability/lineage/expand\` om de volgende tabellen van een kaart. De herkomst toont alleen de tabellen en pipelines die uw rol mag lezen: wat u niet mag lezen, wordt nooit getekend, op een pijl genoemd of geteld.

## dbt

Stuur na \`dbt build\` (of run, test, seed of snapshot) de artefacten van het project met de CLI en een telemetrie-ingestiesleutel. Die leest \`target/manifest.json\` en \`target/run_results.json\` en stuurt alleen wat Data Observability ervan leest:

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

Voer in CI \`oneuptime dbt upload\` uit als de stap na de build, ook wanneer de build mislukt, zodat mislukte tests worden vastgelegd. Download bij een dbt Cloud-job de artefacten met de API van dbt Cloud en upload ze daarna met \`--manifest\` en \`--run-results\`. Of verstuur ze zelf: \`POST /telemetry/dbt/v1/artifacts\` met \`{ "manifest": ..., "run_results": ... }\` en de sleutel in \`x-oneuptime-token\`.

Wat elke upload doet:
- **Tabellen:** elk model, elke seed, elke snapshot en elke bron die een door OneUptime bewaakte tabel is, krijgt een kaart **dbt** op het overzicht ervan: de node, de materialisatie, de eigenaar, de tags en de laatste build. De dbt-beschrijving vult de beschrijving van de tabel wanneer die leeg is. Een tabel wordt gekoppeld op basis van de database, het schema en de naam, voor PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse en Databricks. dbt kent de host niet, dus wanneer twee bewaakte databases dezelfde naam hebben, blijven hun tabellen ongekoppeld, tenzij slechts één van beide de tabel bevat.
- **Herkomst:** waaruit elk model is opgebouwd, wordt herkomst op het tabblad **Herkomst** van de tabel, via de pipeline van het project.
- **Tests:** elke test van een bewaakte tabel verschijnt op het tabblad **Controles** ervan, met het laatste resultaat en de rijen die hij als mislukt vond. Klik op **Waarschuwen bij mislukkingen** om een falende test een waarschuwing te laten openen.
- **Builds:** elke build is een run van de pipeline van het project onder **Pipelines** (namespace \`dbt\`). Een build met een fout of een mislukte test is een mislukte run, dus de pipelinewaarschuwingen werken ook bij dbt-builds: mislukt, ongewoon lang en te laat.

## Ongebruikte tabellen

Elke engine telt de leesacties van elke tabel in zijn eigen statistieken:
- PostgreSQL: de scans.
- MySQL: de leesacties van performance_schema.
- SQL Server: de seeks, scans en lookups, met de tijd van de laatste.

Elke verzameling vergelijkt de teller met de laatst bewaarde, zodat **Laatst gelezen** van een tabel tot op het uur bekend is, net als het moment sinds wanneer hij er geen meer had. Een teller van 0 bij de eerste verzameling van een tabel betekent dat hij niet is gelezen sinds de statistieken van de engine begonnen, zodat een ongebruikte tabel vanaf het begin als ongebruikt verschijnt, niet pas na maanden bewaken. Een leesactie die in de databasespans van een service wordt gezien, telt ook.

**Ongebruikte tabellen** somt de tabellen op die al 90 dagen niemand heeft gelezen, de grootste eerst, met wanneer er voor het laatst in elk werd geschreven: een tabel waarin nog wordt geschreven maar die nooit wordt gelezen, kost zijn schrijfacties en zijn opslag. Het overzicht laat zien hoeveel het er zijn en wat ze bevatten. Weergaven houden geen eigen tellers bij, dus ze worden nooit opgesomd. Wanneer de databaselogin de tellers niet kan lezen, is de laatste leesactie van een tabel niet bekend.

## Warehouse-uitgaven

Eenmaal per uur, met de verzameling van elk warehouse, leest OneUptime wat Snowflake en BigQuery in de afgelopen dag hebben uitgegeven, job voor job: de rekencredits van Snowflake uit \`QUERY_ATTRIBUTION_HISTORY\` (met \`IMPORTED PRIVILEGES\` op de database \`SNOWFLAKE\`, uitgevoerd op het warehouse van de verbinding), en de gefactureerde bytes van BigQuery uit de jobsweergave ervan (met **BigQuery Resource Viewer**). Een job is één query die steeds opnieuw wordt uitgevoerd - de geparametriseerde query van Snowflake, de query van BigQuery zonder zijn literals - genoemd naar zijn querytag of label, of naar wat hij doet en de tabel die hij schrijft, en nooit naar de tekst van zijn query.

**Warehouse-uitgaven** toont de credits en gefactureerde bytes van de dag, per team (de \`team\` in de querytag of het label van een job, anders wie hem uitvoert), de tabellen waarvan de schrijfacties het meest kosten (de uitgaven van een job verdeeld over de tabellen die hij schrijft, waar ACCESS_HISTORY van Snowflake of de bestemmingstabel van BigQuery zegt welke), de jobs die mislukten, en wat er naar jobs gaat die alleen tabellen schrijven die al 90 dagen niemand heeft gelezen.

## Eén melding per oorzaak

Wanneer een tabel verouderd raakt, raakt elke tabel die eruit is opgebouwd ook verouderd. Voordat een datawaarschuwing opent, zoekt OneUptime in de herkomst naar een al open waarschuwing op datgene waaruit de tabel of pipeline is opgebouwd: de stroomopwaartse tabellen, de pipelines die erin schrijven, en de databases waarin ze staan, tot vijf stappen omhoog. Vindt het er een, dan is de nieuwe waarschuwing het gevolg van die waarschuwing:
- Ze begint als **bevestigd**, zodat niemand twee keer wordt opgeroepen voor één probleem. Ze herstelt vanzelf zodra de data dat doen.
- De feed zegt welke waarschuwing haar veroorzaakte, en de kaart **Gegevens** ook.
- Ze sluit aan bij de episode van de oorzaak, wanneer de oorzaak in een episode zit.

De kaart **Gegevens** van de oorzaak somt de **Impact stroomafwaarts** op: elke waarschuwing die ze veroorzaakte. De kaart van een tabelwaarschuwing toont ook de services die in de tabel schrijven, met hun mislukte schrijfacties, en hun deploys en andere wijzigingen in de dag vóór de waarschuwing.

Onder de kaart **Gegevens** tekent de pagina van een waarschuwing haar **Herkomst**: rond haar tabel, zoals het tabblad **Herkomst** van de tabel die tekent, of rond haar pipeline, met de weg omhoog naar de waarschuwing die haar veroorzaakte en omlaag naar elke waarschuwing die ze veroorzaakte gemarkeerd, de oorzaak aangeduid met **Oorzaak** en elke veroorzaakte waarschuwing met **Gevolg**. Wanneer de oorzaak bij een pipeline ligt die op een pijl is getekend, zegt de pijl **Oorzaak** onder de naam van de pipeline. Een waarschuwing van een controle op één kolom, zoals een controle Percentage NULL op \`customer_id\`, opent met die kolom gevolgd naast deze wegen, zoals op het tabblad **Herkomst** van de tabel; kies daar een andere kolom van de tabel, of maak de keuze leeg om alleen de wegen te zien. Wie de waarschuwing die haar veroorzaakte niet mag zien, krijgt de kaart **Gegevens** noch de herkomst, en een veroorzaakte waarschuwing die hij niet mag zien, wordt niet gemarkeerd en niet geteld. Dezelfde herkomst staat op \`POST /api/data-observability/alerts/<alert ID>/lineage\`, met de \`column\` die de waarschuwing van een kolomcontrole leest en de kolommen die elke pijl draagt. Een veroorzaakte waarschuwing bij een pipeline die op een pijl is getekend, zegt daar op dezelfde manier **Gevolg**, en de kolomkiezer biedt eerst de kolom van de controle aan, daarna de andere kolommen van de tabel in haar eigen volgorde.


## OneUptime AI

- **Onderzoeken van datawaarschuwingen.** Wanneer OneUptime AI een waarschuwing op een tabel, een pipeline of een database onderzoekt, leest het wat ernaast ligt: de actualiteit van de tabel en de open waarschuwingen, de waarschuwing waarvan ze het gevolg is, de runs van de pipelines die erin schrijven sinds de dag ervoor (een mislukte run met zijn fout), de services die erin schrijven met hun mislukte schrijfacties en hun deploys en andere wijzigingen, en de herkomst: de tabellen waaruit ze is opgebouwd en de tabellen die eruit zijn opgebouwd, die met een probleem eerst, met waar de waarschuwing waarvan ze het gevolg is zich bevindt en op welke tabellen de waarschuwingen staan die ze veroorzaakte. Bij een waarschuwing van een controle op één kolom volgt het die kolom ook door de herkomst: de kolommen waaruit hij stroomopwaarts is opgebouwd en de kolommen die er stroomafwaarts uit zijn opgebouwd, tabel voor tabel. Het noemt de run, de deploy of de stroomopwaartse tabel achter de waarschuwing. Iedereen die de waarschuwing mag zien, leest het rapport ervan, dus leest het alleen de tabellen en pipelines die niemand met **Eigenaren** of **Labels** heeft afgeschermd, plus de eigen tabel of pipeline van de waarschuwing. Het noemt of telt nooit een andere, niet in waar het van uitgaat en niet in wat het onderweg vraagt.
- **Een controle vanuit een zin.** Op het tabblad Controles van een tabel maakt **Een controle schrijven vanuit een zin** van een regel als "orders hebben nooit een negatief totaal" een controle met aangepaste SQL die de rijen telt die de regel overtreden, met een waarschuwing zodra er een is. U leest de query voordat **Controle toevoegen** hem toevoegt, en hij valt onder alles wat voor elke controle met aangepaste SQL geldt: één alleen-lezen instructie, uitgevoerd in een alleen-lezen transactie.
- **Is deze tabel actueel?** Vraag het OneUptime AI in AI vragen, Slack of Microsoft Teams ("is de tabel orders actueel?"). Het antwoordt met de actualiteit van de tabel volgens zijn eigen ritme, wanneer hij voor het laatst veranderde, de open waarschuwingen, de nieuwste runs van zijn schrijvers en de dataproducten waar hij deel van uitmaakt. AI-agents vragen hetzelfde via de tool \`get_data_table_freshness\` van de MCP-server, voordat ze de data gebruiken.
- **Waaruit is deze tabel opgebouwd?** Vraag het op dezelfde manier ("wat voedt de tabel revenue?", "wat gaat er kapot als raw.orders niet meer laadt?"). Het volgt de herkomst van de tabel drie stappen in elke richting, of tot vijf als daarom wordt gevraagd, en zet de stroomopwaartse en stroomafwaartse tabellen die te laat zijn, verwijderd zijn, open waarschuwingen hebben of waarvan de pipeline bij de laatste run mislukte voorop, de dichtstbijzijnde eerst, met hoeveel stappen elk verwijderd is en de tabellen ertussen; daarna de rest, de pipelines die de bronnen van buiten wat OneUptime bewaakt laden, en de BI-dashboards die erop zijn gebouwd. Open waarschuwingen worden geteld, nooit genoemd, en alleen die welke de vrager mag zien. AI-agents vragen hetzelfde via de tool \`get_data_table_lineage\` van de MCP-server, voordat ze een tabel wijzigen. De tabellen verderop dan wat het noemt, telt het elk één keer, hoeveel genoemde tabellen er ook naast liggen. Geopend op de pagina van een tabel weet AI vragen welke tabel "deze tabel" is en vraagt het naar die, ook als meerdere databases een tabel met die naam hebben. Zoals elke weergave van de herkomst vertelt het alleen over de tabellen en pipelines die de vrager mag lezen.

## Services die elke tabel gebruiken

Het tabblad **Services** van een tabel somt de services op die erin zijn gezien schrijven en lezen, met de instructies die elke service uitvoerde, de aanroepen en fouten in het afgelopen uur, en wanneer hij voor het laatst is gezien. Dat komt uit de databasespans die uw services al met OpenTelemetry sturen: een client-span met \`db.system.name\`, \`db.namespace\` en \`db.collection.name\` (of \`db.sql.table\`, of een span met een naam als \`INSERT orders\`). Niets extra te installeren. Het wordt elke 15 minuten bijgewerkt.

Elke service toont ook de endpoints die zijn aanroepen doen, en wordt gemarkeerd als **AI-app** wanneer hij ook een model aanroept. **Fouten die deze tabel noemen** somt de open uitzonderingen en de foutlogs van de afgelopen dag op van de services die in de tabel schrijven, wanneer ze hem bij naam noemen.

Een span wordt alleen aan een tabel gekoppeld wanneer zijn database de database is die een verzameling heeft gelezen, en wanneer twee databases een naam delen, alleen wanneer zijn \`server.address\` een van de hunne is. Als het niet zeker is, laat het de span weg.

Deze metrics zijn de eigen operationele gegevens van OneUptime en worden niet als telemetrie gefactureerd.
`;

export default DOCUMENTATION;
