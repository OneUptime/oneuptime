# Härkomst och pipelines

Härkomst visar vilka tabeller varje tabell byggs av, och vilka pipelines som skriver till den. Dataobserverbarhet samlar in den från sex ställen samtidigt - OpenLineage-händelser, dbt, synkroniseringar i Fivetran och Airbyte, jobb i dina spår, vyer, och varje databas egen frågehistorik - och använder den för att koppla varje försenad eller trasig tabell till körningen bakom den, så att ett problem öppnar ett enda larm.

## Var härkomsten kommer ifrån

| Källa | Vad den ger |
| --- | --- |
| **OpenLineage** | Varje körning av ett Airflow-, Dagster-, Spark-, dbt- eller Flink-jobb, och de tabeller det läste och skrev |
| **dbt** | Vad varje modell byggs av, varje build som en körning, och varje tests resultat |
| **Fivetran och Airbyte** | Varje synkronisering som en körning av dess anslutning, och de råtabeller den laddar |
| **Jobb i dina spår** | Ett Kubernetes CronJob eller en schemalagd funktion, dess körningar, och de tabeller som dess databasanrop läste och skrev |
| **Vyer** | En vy byggs av de tabeller den är definierad på (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, materialiserade vyer i ClickHouse, Databricks, MongoDB) |
| **Frågehistorik** | En fråga som läste en tabell och skrev till en annan (Snowflakes åtkomsthistorik, BigQuerys jobb, Redshifts frågelogg, ClickHouses frågelogg, Databricks härkomsttabell) |

En tabells flik **Härkomst** visar de tabeller den byggs av, de pipelines som skriver till den med deras senaste körning, och de tabeller som byggs av den. Varje kant visar var den sågs.

Överst på fliken ritar ett diagram den härkomsten några steg åt varje håll (tre, eller välj 1, 2 eller 5): till vänster det som tabellen byggs av, till höger de tabeller och instrumentpaneler som byggs av den, och de pipelines som läser in data utifrån, där den kommer in. Varje kort visar hur det står till nu - försenad, ett öppet larm, en misslyckad körning - och en pil blir röd när den senaste körningen av dess pipeline misslyckades, så att en försenad tabell kan följas upp till körningen som stoppade den. Öppna valfri tabell för att centrera diagrammet på den.

Ett kort ritar högst tio tabeller åt varje håll och räknar resten, till exempel **+14**. Välj talet för att rita upp till tio till av dem där de är, problem först, med varje pil mellan dem och det som redan är ritat. **Återställ diagram** går tillbaka till diagrammet som det först ritades. När en sida har så många tabeller som ett diagram rymmer öppnar du en tabell för att centrera diagrammet på den.

Där källan anger kolumner visar en tabells flik **Kolumner** varifrån varje kolumn kommer och vad den matar: Snowflakes åtkomsthistorik (Enterprise-utgåvan, som kräver `IMPORTED PRIVILEGES` på databasen `SNOWFLAKE`), och OpenLineages facet `columnLineage`.

Välj på fliken **Härkomst** en av tabellens kolumner i **Följ en kolumn** för att markera varifrån den kommer och vart den går: uppåt i diagrammet till kolumnerna den byggs av, nedåt till kolumnerna som byggs av den, var och en namngiven på sin tabell, även där kolumnen bytte namn på vägen. En pil vars källor inte anger några kolumner kan föra den längre än det som är markerat, och diagrammet säger det.

Varje vy av härkomst - fliken **Härkomst** för en tabell, för en pipeline och för ett larm, **Härkomstkarta** och det som OneUptime AI och API:et berättar - visar bara de tabeller och pipelines som din roll får läsa. En roll som är begränsad till det dess medlemmar äger, eller till vissa etiketter, ser aldrig någon annan tabell eller pipeline: den ritas inte, nämns inte på någon pil och räknas inte bland tabellerna längre bort.

## Härkomstkarta

**Dataobserverbarhet > Härkomstkarta** ritar varje dataflöde som ditt projekt har sett på en enda sida, så att du kan se vem som använder vilken data och vart den går, utan att först välja en tabell. Den visar:

- **Tjänster** som skriver till och läser tabeller, från databasspann i dina spår: ett spann som anger sin tabell (`db.collection.name`, eller den äldre `db.sql.table`) och sin sats (`db.operation.name`), till exempel en `INSERT` eller en `SELECT`.
- **Tabeller** som är byggda av andra tabeller, från alla källor ovan.
- **Pipelines** som laddar en tabell från data som OneUptime inte bevakar, till exempel en Fivetran-synkning. En pipeline som flyttar data mellan två bevakade tabeller anges på pilen mellan dem.
- **Instrumentpaneler** och reverse ETL-synkningar i dina BI-verktyg, som läser de tabeller de är byggda på, även när inget annat rör de tabellerna. En Power BI-rapport som inte är byggd på någon tabell som OneUptime bevakar ritas med de datauppsättningar den visar och de datakällor de läser in från; när ingen av ett BI-verktygs instrumentpaneler står på en bevakad tabell säger kartan varför ([Härkomst i Power BI](#härkomst-i-power-bi)).

Varje pil är något som OneUptime har registrerat, aldrig en gissning. Korten ligger från vänster till höger i den riktning datan flödar, och visar hur de mår, som på en tabells diagram: rött för en sen tabell, ett öppet larm eller en misslyckad körning. En pil är blågrön där en tjänsts spår har sett den.

Sök efter en tabell, tjänst, pipeline eller instrumentpanel för att behålla det som matchar och allt uppströms och nedströms om det. Välj ett kort för att markera hela dess härkomst, se vad det kommer från och vart det går, och öppna dess sida; **Visa bara dess härkomst** lämnar bara det kvar på kartan. Reglagen bredvid sökningen låter tjänster, pipelines eller instrumentpaneler vara avstängda. **Lista** visar varje pil som en rad, och är vad en telefon öppnar med.

En karta ritar upp till 400 kort, de senast sedda flödena först; när ditt projekt har fler säger kartan det. Samma karta levereras av `POST /api/data-observability/lineage/map`, till alla som får läsa dataresurser, och deras API-nycklar. En karta med fler säger hur många tabeller den har utelämnat, var och en räknad en gång, och kan börja någon annanstans: välj en databas för att kartlägga flödena för dess tabeller och korten de förbinder, eller skriv ett namn och välj **Sök i hela projektet** för att kartlägga flödena för varje tabell, pipeline, tjänst och instrumentpanel med det i namnet, hur gamla de än är. **Visa hela kartan** går tillbaka. Skicka `{ "dataStoreId": "<database ID>" }` eller `{ "search": "orders" }` för att låta API:ets karta börja någon annanstans.

## OpenLineage

Skicka OpenLineage-händelser till OneUptime, oförändrade, med en [intagningsnyckel](/docs/telemetry/ingestion-keys) för telemetri:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (på en OneUptime i egen drift, din egen adress)
- **Endpoint:** `api/v1/lineage`, OpenLineages standard
- **API-nyckel:** intagningsnyckeln, skickad som `Authorization: Bearer`, eller ange `x-oneuptime-token`

För Airflows OpenLineage-provider:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

För alla andra OpenLineage-klienter anger du `OPENLINEAGE_URL` och `OPENLINEAGE_API_KEY`. Dataset matchas mot tabeller enligt OpenLineages namngivningsspecifikation, till exempel `postgres://host:5432` med `database.schema.table`, `snowflake://account` med `database.schema.table`, `clickhouse://host:8443` med `database.table`, och `databricks://workspace-host` med `catalog.schema.table`.

## dbt

Efter `dbt build` (eller run, test, seed eller snapshot) skickar du projektets artefakter med [OneUptime CLI](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

I CI kör du `oneuptime dbt upload` som steget efter builden, även när builden misslyckas, så att misslyckade tester registreras. Varje tabell som dbt bygger får ett **dbt**-kort på sin Översikt, sina modellers härkomst, och sina tester på fliken **Kontroller**; varje build är en körning av projektets pipeline.

## Fivetran och Airbyte

Deras webhooks talar om när varje synkronisering startar och slutar. **Pipelines > Anslut Fivetran eller Airbyte** fyller i URL:erna med en av dina intagningsnycklar:

- **Fivetran:** en webhook som skapas med Fivetrans REST-API, för händelserna `sync_start` och `sync_end`, till `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, med intagningsnyckeln som hemlighet. Fivetran signerar varje leverans med den, så nyckeln skickas aldrig i URL:en.
- **Airbyte:** arbetsytans webhook inställd på `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, påslagen för misslyckade och lyckade synkroniseringar. Ge Airbyte en egen nyckel.

En Fivetran-synkronisering som omplaneras vid ett API:s hastighetsgräns slutar som **Omplanerad**: inget fel, så den larmar ingen.

## Jobb i dina spår

Många pipelines är ett Kubernetes CronJob, eller en funktion på en timer, utan någon schemaläggare som skickar härkomst. Deras spår berättar allt ändå, utan något att installera. Var femtonde minut blir spans med resursattributet `k8s.cronjob.name` eller `k8s.job.name`, eller `faas.name` med en `faas.trigger` som är `timer` eller `datasource`, en pipeline under **Pipelines**:

- En körning av ett CronJob är dess Kubernetes Job, och en körning av en funktion är dess `faas.invocation_id`.
- En körning misslyckades när spanet överst i dess spår gjorde det. Ett anrop som misslyckades och gjordes om inuti den får den inte att misslyckas.
- Tabellerna som den skrev och läste kommer från dess databasspans.

Varje körning länkar till sitt spår, med dess loggar. Samma tre monitorer gäller, så ett CronJob som slutar köras ses som sent.

## Instrumentpaneler i BI-verktyg

Den verkliga följden av dåliga data är instrumentpanelen som någon öppnar. Lägg under **BI-instrumentpaneler** till dina BI-verktyg med autentiseringsuppgifter som får läsa deras instrumentpaneler. Varje timme läser Dataobserverbarhet varje instrumentpanel och tabellerna bakom den, matchar varje tabell mot en bevakad tabell och visar de instrumentpaneler som byggs på en tabell, och på tabellerna som byggs av den, på fliken **Härkomst**, på dess larm och i Production Review.

| Verktyg | Autentiseringsuppgifter |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, ett tjänsthuvudnamn (service principal) som får använda Power BI:s skrivskyddade administratörs-API:er, med de två klientinställningarna för metadata från [Härkomst i Power BI](#härkomst-i-power-bi) påslagna för tabellerna bakom varje rapport. Både rapporter och instrumentpaneler läses, med visningar och uppdateringar (nedan) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (eller `eu`) |

Hightouch och Census är verktyg för reverse ETL: en synkronisering som kopierar en tabell till ett CRM är beroende av den tabellen som en instrumentpanel är, så den läses på samma sätt och nämns på tabellens larm.

Bara instrumentpanelernas namn och länkar, tabellerna de frågar mot och, för Power BI, vem som öppnar dem och hur deras uppdateringar gick, läses: aldrig deras data.

### Visningar och uppdateringar i Power BI

För varje Power BI-rapport och instrumentpanel visar **BI-instrumentpaneler** först hur många gånger den öppnades de senaste 28 dagarna, när den senast öppnades och hur den senaste uppdateringen av dess data gick, med felet från en misslyckad uppdatering. Hur många personer som öppnade den, vem som öppnade den mest och dess senaste uppdateringar är kolumner du kan slå på. En tabells flik **Härkomst** säger detsamma om varje instrumentpanel som bygger på den, med ägare och visare under **Mer**.

- **Visningar** kommer från Power BI:s aktivitetslogg, läst via dess administratörs-API för aktivitetshändelser. Power BI sparar 28 dagar av den, svarar på 200 begäranden i timmen och delar upp varje begäran i timmar, så OneUptime läser den en timme i taget: varje läsning varje timme lägger till timmarna sedan den förra och går sedan bakåt genom de 28 dagarna, nyast först, med högst 100 begäranden. Ett nytt Power BI-verktyg visar de senaste dagarna direkt och alla 28 dagar inom ett dygn; tills dess säger visningarna sedan när de räknas. En händelse kan ta upp till en timme att nå loggen, så visningarna ligger upp till två timmar efter. Visare namnges som Power BI namnger dem: med sin e-postadress.
- **Uppdateringar** av datauppsättningar på en kapacitet (Premium, Premium per användare eller Fabric) kommer från Power BI:s administratörslista över uppdaterbara objekt: varje datauppsättnings senaste uppdatering med sitt fel, och hur många uppdateringar som kördes och misslyckades under de sju dagar Power BI sparar.
- **Uppdateringar av datauppsättningar på delad kapacitet** finns inte i den listan. Power BI visar en datauppsättnings uppdateringshistorik bara för dem som får ändra den, så lägg till tjänsthuvudnamnet i dess arbetsyta som **Deltagare**, **Medlem** eller **Administratör** och slå på **Service principals can call Fabric public APIs** för det i utvecklarinställningarna i Fabrics administratörsportal. OneUptime läser då varje uppdatering, med sitt fel. Tills dess säger BI-verktyget hur många datauppsättningars uppdateringar det inte kunde läsa.
- En Power BI-instrumentpanel vars paneler kommer från flera datauppsättningar visar den senaste uppdateringen som misslyckades, eller den äldsta om ingen misslyckades: dess data är bara så färska som den.

Visningar, och uppdateringar på kapaciteter, behöver inget utöver administratörs-API-åtkomsten ovan: tjänsthuvudnamnet i en säkerhetsgrupp som **Service principals can access read-only admin APIs** tillåter, utan Power BI-behörigheter i appen som kräver administratörsmedgivande. När visningar eller uppdateringar inte kan läsas läses och behålls instrumentpanelerna ändå, BI-verktyget säger vad som hoppades över och varför, och nästa läsning försöker igen.

### Larm vid misslyckade uppdateringar

Slå på **Alert on Failed Refreshes** när du lägger till eller redigerar ett Power BI-verktyg (ett nytt börjar med det påslaget), så håller OneUptime en monitor för verktyget under **Monitorer**, uppkallad efter det. Monitorn öppnar ett larm för varje datauppsättning vars senaste uppdatering misslyckades eller avbröts, med datauppsättningen och dess arbetsyta i larmets titel, och löser det så snart en senare uppdatering har slutförts. En datauppsättning som publiceras senare bevakas så snart den har lästs. Slår du av reglaget eller tar bort verktyget tas monitorn bort; fram till dess är den en vanlig monitor, med sina ägare, jourpolicyer och underhållsfönster.

Misslyckade uppdateringar använder inte pipelinemonitorerna. En datauppsättning vars uppdatering misslyckades fortsätter att visa data från sin senaste slutförda uppdatering tills en senare slutförs, så dess larm förblir öppet tills dess, medan larmet för en misslyckad körning försvinner en timme efter körningen. Och uppdateringar läses en gång i timmen: en uppdatering som läses upp till en timme efter att den slutade skulle ofta hamna utanför den timme som **Pipeline Run Failed** tittar på, en datauppsättning som uppdateras varje halvtimme skulle hela tiden bli **Pipeline Is Late**, och en uppdatering som var klar men ännu inte läst skulle se ut som **Pipeline Run Unusually Long**.

- Varje läsning varje timme behåller de datauppsättningar vars senaste avslutade uppdatering misslyckades eller avbröts. Var femte minut skriver var och en `oneuptime.data.bi.refresh_failed`, 1 så länge den misslyckas och 0 under timmen efter att en senare uppdatering har slutförts, och monitorn läser det, så att ett fel öppnar ett enda larm oavsett hur många läsningar som ser det.
- Ett fel upptäcks vid nästa läsning: dess larm öppnas upp till en timme efter att uppdateringen misslyckades och löses upp till en timme efter att en senare uppdatering slutfördes.
- En uppdatering som fortfarande pågår ändrar ingenting: larmet för en datauppsättning vars uppdatering misslyckades förblir öppet medan dess nästa uppdatering körs och löses först när en uppdatering har slutförts.
- På en kapacitet ger Power BI:s lista över uppdaterbara objekt bara varje datauppsättnings senaste uppdatering, så en uppdatering som misslyckades och följdes av en slutförd inom samma timme syns aldrig: då är data aktuella igen.
- Datauppsättningar på delad kapacitet larmar bara där deras uppdateringar kan läsas (ovan), och en datauppsättning vars uppdateringar inte kunde läsas behåller sitt larm som det var tills de kan läsas.

## Pipelines

Varje jobb, dbt-projekt och synkronisering visas under **Pipelines**, med sina körningar: när varje körning startade och slutade, hur lång tid den tog, vilket försök den var där schemaläggaren anger det (Airflows try-nummer), och felet för en misslyckad körning. Efter fem körningar lär sig varje pipeline av sina egna körningar hur lång tid en körning brukar ta och hur lång tid det brukar gå mellan körningarna enligt dess schema. En pipelines sida rekommenderar tre monitorer:

- **Pipeline Run Failed**: en körning misslyckades eller avbröts.
- **Pipeline Run Unusually Long**: en körning har tagit dubbelt så lång tid som vanligt eller mer, kontrollerat var femte minut medan den körs, så att en körning som hänger sig upptäcks innan den slutar.
- **Pipeline Is Late**: ingen körning har startat på längre tid än schemat tillåter.

Fliken **Ägare** för en pipeline nämner de personer och team som tar hand om den, och dess larm går till dem. **Översikt** och **Problem** nämner ägarna till en pipeline som misslyckades eller är sen, eller visar **Ingen ägare**, med ett sätt att lägga till en.

En pipelines sida har kortet **Härkomst**, det första stället att titta på när en körning misslyckas eller är försenad: till vänster de tabeller den läser, till höger de tabeller den skriver, pipelinen däremellan, och varje kort visar hur det står till nu. Välj fler steg för att se vad tabellerna byggs av och vad som byggs av dem, och öppna valfri tabell för att se dess egen flik **Härkomst**. Ett tal för tabeller som inte är ritade, på pipelinens kort eller en tabells, ritar fler av dem på plats här också. Välj en av kolumnerna den skriver för att följa den genom pipelinen: upp till kolumnen i varje läst tabell som den byggs från, och ner till varje tabell den skriver den till.

## Ett larm per orsak

När en tabell blir inaktuell blir varje tabell som byggs av den också inaktuell. Innan ett datalarm öppnas letar OneUptime i härkomsten efter ett larm som redan är öppet på det som dess tabell eller pipeline byggs av: tabellerna uppströms, de pipelines som skriver till dem och de databaser de ligger i, upp till fem steg uppåt. När den hittar ett blir det nya larmet en följd av det larmet:

- Det startar som **bekräftat**, så att ingen larmas två gånger för samma problem, och återställs av sig självt när dess data gör det.
- Dess flöde och dess kort **Data** visar vilket larm som orsakade det, och det ansluter sig till orsakens episod.

Orsakens kort **Data** listar dess **Påverkan nedströms**: varje larm den orsakade. Ett tabellarms kort visar också de tjänster som skriver till tabellen, med deras misslyckade skrivningar, och deras driftsättningar och andra ändringar under dygnet före larmet.

Under kortet **Data** har ett larms sida kortet **Härkomst**: härkomsten runt dess tabell, som tabellens flik **Härkomst** ritar den, eller runt dess pipeline. Vägen upp till larmet som orsakade det och ner till varje larm det orsakade är framhävd - orsakens tabell eller pipeline märkt **Orsak**, varje orsakat larms märkt **Följd** - och resten tonas ned, så att den som öppnar det ser var i kedjan problemet började. Ligger orsaken hos en pipeline som är ritad på en pil, står det **Orsak** under pipelinens namn på pilen. Gäller orsaken en hel databas, eller ligger den längre upp än diagrammet når, säger kortet det i ord. Ett larm från en kontroll av en enda kolumn, som en kontroll av typen Andel NULL på `customer_id`, öppnas med den kolumnen följd bredvid dessa vägar, som på tabellens flik **Härkomst**: varifrån den kommer och vart den går, namngiven på varje tabell. Välj en annan av tabellens kolumner där, eller rensa den för att bara se vägarna. **Utforska härkomst** öppnar tabellens flik **Härkomst**, eller pipelinens sida. Ett orsakat larm på en pipeline som ritas på en pil säger **Följd** där på samma sätt, och kolumnväljaren erbjuder först kontrollens kolumn och sedan tabellens övriga kolumner i dess egen ordning.

Den som inte får se larmet som orsakade det får varken kortet **Data** eller härkomsten, och ett orsakat larm som personen inte får se framhävs inte och räknas inte.

## Härkomst i Power BI

**Matchade tabeller** på varje BI-verktyg säger hur många bevakade tabeller dess instrumentpaneler är byggda på, och under det det första som hindrar resten från att matchas. **See Why** listar vad den senaste läsningen hittade och vad du ska göra: databaser som dina instrumentpaneler läser och som inte är anslutna till OneUptime, var och en bara en **Connect Database** bort, med typ och adress ifyllda; tabeller som en ansluten databas inte bevakar, som kan vara utelämnade från dess genomsökning eller inte insamlade ännu; och källor som inte är en databas, som filer och webbsidor. För Power BI nämner den också en klientinställning som är avstängd, datauppsättningar som läser från dataflöden och datauppsättningar som Power BI inte kan beskriva. **Bygger på** för varje instrumentpanel säger vilka datauppsättningar den visar och var deras data kommer ifrån, så som Power BI anger det.

OneUptime läser varje Power BI-datauppsättning från Power BI:s metadatagenomsökning, med den Power Query som ligger bakom var och en av dess tabeller:

- **Databasen som en anslutning anger**: SQL Server och Azure SQL (`Sql.Database`), PostgreSQL, MySQL, Oracle, Amazon Redshift, Snowflake, Google BigQuery, Databricks, Amazon Athena och Microsoft Dataverse, och det schema och den tabell som dess navigering väljer.
- **SQL som en fråga kör**: en anslutnings alternativ **SQL statement**, `Value.NativeQuery` och `Odbc.Query`, och tabellerna efter varje `FROM` och `JOIN`.
- **Parametrar och delade frågor**: en parameter gäller överallt där den nämns, och en tabell som läser en mellanlagringsfråga läser det som den frågan läser.
- **Sammansatta modeller** visar tabellerna i de datauppsättningar de är byggda på.

En rapport visar tabellerna i sin datauppsättning, och en instrumentpanel tabellerna i datauppsättningarna bakom dess paneler. Var data kommer ifrån - en databas server och namn, en fils sökväg, en webbadress - kommer från genomsökningens datakällor, som inte behöver något utöver administratörs-API-åtkomsten ovan.

Power BI returnerar en datauppsättnings tabeller först när en Fabric-administratör slår på två klientinställningar i administratörsportalen, under **Tenant settings > Admin API settings**, för den säkerhetsgrupp som tjänsthuvudnamnet ingår i:

- **Enhance admin APIs responses with detailed metadata**: varje datauppsättnings tabeller.
- **Enhance admin APIs responses with DAX and mashup expressions**: frågorna som läser in dem, som säger vilka databastabeller de läser.

Power BI beskriver sedan en datauppsättning när den har uppdaterats eller publicerats på nytt; en som bara använder DirectQuery, när någon har öppnat en rapport på den. Den beskriver aldrig realtidsdatauppsättningar, datauppsättningar med en liveanslutning till Analysis Services, Excel-arbetsböcker eller datauppsättningar över 1 GB på delad kapacitet.

Varje tabell matchas mot en bevakad tabell efter namn, schema och databas, och en server efter sitt korta eller fullständiga namn. En tabell från en annan databasmotor matchas aldrig, och inte heller en i en annan databas: en rapport på `Sales.dbo.Orders` kopplas inte till `Archive.dbo.Orders` eftersom bara `Archive` bevakas.

[Uppdateringar](#visningar-och-uppdateringar-i-power-bi) läses separat från tabellerna: en varning om att vissa datauppsättningars uppdateringar inte kunde läsas säger ingenting om deras tabeller.

## Innan en ändring slås ihop

När en pull request ändrar en bevakad tabell säger [Produktionsgranskning](/docs/ai/ai-agent) på pull requesten vad som beror på den: tjänsterna som läser den, tabellerna som byggs av den, instrumentpanelerna på den och dess dataprodukter. En tabell med en kopia i en databas markerad som Staging säger också hur kopian skiljer sig: dess rader, dess kolumner och vad tabellens kontroller läser där, körda på stället. I en databas som bara en sond kan nå utelämnas kontrollerna, och det sägs.

## Nästa steg

:::cards
- [Dataprodukter](/docs/data-observability/data-products): Aktualitets-SLA:er över de tabeller som människor använder.
- [OneUptime AI och API:t](/docs/data-observability/ai-and-api): Utredningar som utgår från en tabells skrivare och körningar. I Fråga AI och via AI-agenter kan du fråga vad en tabell byggs av.
:::
