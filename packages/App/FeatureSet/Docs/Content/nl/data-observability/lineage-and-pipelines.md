# Lineage en pipelines

Herkomst (lineage) zegt uit welke tabellen elke tabel is opgebouwd, en welke pipelines ernaar schrijven. Data-observability verzamelt die op vijf plaatsen tegelijk - OpenLineage-gebeurtenissen, dbt, synchronisaties van Fivetran en Airbyte, views, en de eigen querygeschiedenis van elke database - en gebruikt die om elke te late of kapotte tabel te koppelen aan de uitvoering erachter, zodat één probleem één waarschuwing opent.

## Waar de herkomst vandaan komt

| Bron | Wat het geeft |
| --- | --- |
| **OpenLineage** | Elke uitvoering van een Airflow-, Dagster-, Spark-, dbt- of Flink-job, en de tabellen die ze las en schreef |
| **dbt** | Waaruit elk model is opgebouwd, elke build als een uitvoering, en het resultaat van elke test |
| **Fivetran en Airbyte** | Elke synchronisatie als een uitvoering van de connector, en de ruwe tabellen die ze laadt |
| **Views** | Een view is opgebouwd uit de tabellen waarop ze is gedefinieerd (PostgreSQL, Redshift, MySQL 8, SQL Server, materialized views van ClickHouse, Databricks) |
| **Querygeschiedenis** | Een query die de ene tabel las en naar een andere schreef (de jobs van BigQuery, het querylog van Redshift, het querylog van ClickHouse, de lineagetabel van Databricks) |

Het tabblad **Herkomst** van een tabel toont de tabellen waaruit ze is opgebouwd, de pipelines die ernaar schrijven met hun laatste uitvoering, en de tabellen die uit haar zijn opgebouwd. Elke verbinding zegt waar ze is gezien.

## OpenLineage

Stuur OpenLineage-gebeurtenissen ongewijzigd naar OneUptime, met een [ingestiesleutel](/docs/telemetry/ingestion-keys) voor telemetrie:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (bij een zelfgehoste OneUptime je eigen adres)
- **Endpoint:** `api/v1/lineage`, de standaard van OpenLineage
- **API-sleutel:** de ingestiesleutel, verstuurd als `Authorization: Bearer`, of stel `x-oneuptime-token` in

Voor de OpenLineage-provider van Airflow:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

Stel voor elke andere OpenLineage-client `OPENLINEAGE_URL` en `OPENLINEAGE_API_KEY` in. Datasets worden aan tabellen gekoppeld volgens de naamgevingsspecificatie van OpenLineage, zoals `postgres://host:5432` met `database.schema.table`, `snowflake://account` met `database.schema.table`, `clickhouse://host:8443` met `database.table`, en `databricks://workspace-host` met `catalog.schema.table`.

## dbt

Stuur na `dbt build` (of run, test, seed of snapshot) de artefacten van het project met de [OneUptime-CLI](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

Voer in CI `oneuptime dbt upload` uit als de stap na de build, ook als de build mislukt, zodat mislukte tests worden vastgelegd. Elke tabel die dbt bouwt, krijgt een kaart **dbt** op haar Overzicht, de herkomst van haar modellen, en haar tests op het tabblad **Controles**; elke build is een uitvoering van de pipeline van het project.

## Fivetran en Airbyte

Hun webhooks zeggen wanneer elke synchronisatie begint en eindigt. **Pipelines > Fivetran of Airbyte koppelen** vult de URL's in met een van je ingestiesleutels:

- **Fivetran:** een webhook die met de REST API van Fivetran is aangemaakt, voor de gebeurtenissen `sync_start` en `sync_end`, naar `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, met de ingestiesleutel als geheim. Fivetran ondertekent elke levering ermee, zodat de sleutel nooit in de URL meereist.
- **Airbyte:** de webhook van de werkruimte, ingesteld op `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, aan voor mislukte en geslaagde synchronisaties. Geef Airbyte een eigen sleutel.

Een Fivetran-synchronisatie die bij de rate limit van een API opnieuw wordt gepland, eindigt als **Opnieuw gepland**: geen fout, dus ze roept niemand op.

## Dashboards in BI-tools

De echte impact van slechte gegevens is het dashboard dat iemand opent. Voeg onder **BI-dashboards** je BI-tools toe met inloggegevens die hun dashboards mogen lezen. Elk uur leest Data-observability elk dashboard en de tabellen erachter, koppelt elke tabel aan een bewaakte tabel en toont de dashboards die op een tabel, en op de tabellen die eruit worden gebouwd, zijn gebouwd op het tabblad **Herkomst**, bij de waarschuwingen en in Production Review.

| Tool | Inloggegevens |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, een service principal die de beheer-API's van Power BI mag gebruiken |

Alleen de namen en links van dashboards en de tabellen die ze opvragen worden gelezen: nooit hun gegevens.

## Pipelines

Elke job, elk dbt-project en elke synchronisatie verschijnt onder **Pipelines**, met de uitvoeringen: wanneer elke uitvoering begon en eindigde, hoe lang ze duurde, en de fout van een mislukte uitvoering. Na vijf uitvoeringen leert elke pipeline uit zijn eigen uitvoeringen hoe lang een uitvoering gewoonlijk duurt en hoeveel tijd er volgens zijn planning tussen twee uitvoeringen zit. De pagina van een pipeline beveelt drie monitoren aan:

- **Pipeline Run Failed**: een uitvoering is mislukt of afgebroken.
- **Pipeline Run Unusually Long**: een uitvoering heeft twee keer haar gebruikelijke tijd of langer geduurd, elke vijf minuten gecontroleerd zolang ze loopt, zodat een uitvoering die vastloopt al wordt opgemerkt voordat ze eindigt.
- **Pipeline Is Late**: er is langer geen uitvoering gestart dan de planning toestaat.

## Eén waarschuwing per oorzaak

Wanneer een tabel verouderd raakt, raakt elke tabel die eruit is opgebouwd ook verouderd. Voordat een gegevenswaarschuwing opent, zoekt OneUptime in de herkomst naar een waarschuwing die al openstaat op datgene waaruit haar tabel of pipeline is opgebouwd: de tabellen stroomopwaarts, de pipelines die ernaar schrijven, en de databases waarin ze staan, tot vijf stappen omhoog. Vindt het er een, dan is de nieuwe waarschuwing een gevolg van die waarschuwing:

- Ze begint als **bevestigd**, zodat niemand twee keer wordt opgeroepen voor één probleem, en herstelt vanzelf zodra haar gegevens herstellen.
- Haar feed en haar kaart **Gegevens** zeggen welke waarschuwing haar veroorzaakte, en ze sluit zich aan bij de episode van de oorzaak.

De kaart **Gegevens** van de oorzaak toont haar **Downstream Impact**: elke waarschuwing die ze veroorzaakte. De kaart van een tabelwaarschuwing toont ook de services die naar de tabel schrijven, met hun mislukte schrijfacties, en hun deploys en andere wijzigingen in de dag vóór de waarschuwing.

## Volgende stappen

:::cards
- [Dataproducten](/docs/data-observability/data-products): Actualiteits-SLA's over de tabellen die mensen gebruiken.
- [OneUptime AI en de API](/docs/data-observability/ai-and-api): Onderzoeken die beginnen bij de schrijvers en uitvoeringen van een tabel.
:::
