# Härkomst och pipelines

Härkomst visar vilka tabeller varje tabell byggs av, och vilka pipelines som skriver till den. Dataobserverbarhet samlar in den från fem ställen samtidigt - OpenLineage-händelser, dbt, synkroniseringar i Fivetran och Airbyte, vyer, och varje databas egen frågehistorik - och använder den för att koppla varje försenad eller trasig tabell till körningen bakom den, så att ett problem öppnar ett enda larm.

## Var härkomsten kommer ifrån

| Källa | Vad den ger |
| --- | --- |
| **OpenLineage** | Varje körning av ett Airflow-, Dagster-, Spark-, dbt- eller Flink-jobb, och de tabeller det läste och skrev |
| **dbt** | Vad varje modell byggs av, varje build som en körning, och varje tests resultat |
| **Fivetran och Airbyte** | Varje synkronisering som en körning av dess anslutning, och de råtabeller den laddar |
| **Vyer** | En vy byggs av de tabeller den är definierad på (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, materialiserade vyer i ClickHouse, Databricks, MongoDB) |
| **Frågehistorik** | En fråga som läste en tabell och skrev till en annan (BigQuerys jobb, Redshifts frågelogg, ClickHouses frågelogg, Databricks härkomsttabell) |

En tabells flik **Härkomst** visar de tabeller den byggs av, de pipelines som skriver till den med deras senaste körning, och de tabeller som byggs av den. Varje kant visar var den sågs.

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

## Instrumentpaneler i BI-verktyg

Den verkliga följden av dåliga data är instrumentpanelen som någon öppnar. Lägg under **BI-instrumentpaneler** till dina BI-verktyg med autentiseringsuppgifter som får läsa deras instrumentpaneler. Varje timme läser Dataobserverbarhet varje instrumentpanel och tabellerna bakom den, matchar varje tabell mot en bevakad tabell och visar de instrumentpaneler som byggs på en tabell, och på tabellerna som byggs av den, på fliken **Härkomst**, på dess larm och i Production Review.

| Verktyg | Autentiseringsuppgifter |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, ett tjänsthuvudnamn (service principal) som får använda Power BI:s administratörs-API:er |

Bara instrumentpanelernas namn och länkar, och tabellerna de frågar mot, läses: aldrig deras data.

## Pipelines

Varje jobb, dbt-projekt och synkronisering visas under **Pipelines**, med sina körningar: när varje körning startade och slutade, hur lång tid den tog, och felet för en misslyckad körning. Efter fem körningar lär sig varje pipeline av sina egna körningar hur lång tid en körning brukar ta och hur lång tid det brukar gå mellan körningarna enligt dess schema. En pipelines sida rekommenderar tre monitorer:

- **Pipeline Run Failed**: en körning misslyckades eller avbröts.
- **Pipeline Run Unusually Long**: en körning har tagit dubbelt så lång tid som vanligt eller mer, kontrollerat var femte minut medan den körs, så att en körning som hänger sig upptäcks innan den slutar.
- **Pipeline Is Late**: ingen körning har startat på längre tid än schemat tillåter.

## Ett larm per orsak

När en tabell blir inaktuell blir varje tabell som byggs av den också inaktuell. Innan ett datalarm öppnas letar OneUptime i härkomsten efter ett larm som redan är öppet på det som dess tabell eller pipeline byggs av: tabellerna uppströms, de pipelines som skriver till dem och de databaser de ligger i, upp till fem steg uppåt. När den hittar ett blir det nya larmet en följd av det larmet:

- Det startar som **bekräftat**, så att ingen larmas två gånger för samma problem, och återställs av sig självt när dess data gör det.
- Dess flöde och dess kort **Data** visar vilket larm som orsakade det, och det ansluter sig till orsakens episod.

Orsakens kort **Data** listar dess **Downstream Impact**: varje larm den orsakade. Ett tabellarms kort visar också de tjänster som skriver till tabellen, med deras misslyckade skrivningar, och deras driftsättningar och andra ändringar under dygnet före larmet.

## Nästa steg

:::cards
- [Dataprodukter](/docs/data-observability/data-products): Aktualitets-SLA:er över de tabeller som människor använder.
- [OneUptime AI och API:t](/docs/data-observability/ai-and-api): Utredningar som utgår från en tabells skrivare och körningar.
:::
