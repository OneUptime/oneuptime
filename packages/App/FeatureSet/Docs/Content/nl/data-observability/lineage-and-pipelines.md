# Lineage en pipelines

Herkomst (lineage) zegt uit welke tabellen elke tabel is opgebouwd, en welke pipelines ernaar schrijven. Data-observability verzamelt die op zes plaatsen tegelijk - OpenLineage-gebeurtenissen, dbt, synchronisaties van Fivetran en Airbyte, jobs in je traces, views, en de eigen querygeschiedenis van elke database - en gebruikt die om elke te late of kapotte tabel te koppelen aan de uitvoering erachter, zodat één probleem één waarschuwing opent.

## Waar de herkomst vandaan komt

| Bron | Wat het geeft |
| --- | --- |
| **OpenLineage** | Elke uitvoering van een Airflow-, Dagster-, Spark-, dbt- of Flink-job, en de tabellen die ze las en schreef |
| **dbt** | Waaruit elk model is opgebouwd, elke build als een uitvoering, en het resultaat van elke test |
| **Fivetran en Airbyte** | Elke synchronisatie als een uitvoering van de connector, en de ruwe tabellen die ze laadt |
| **Jobs in je traces** | Een Kubernetes CronJob of een geplande functie, hun uitvoeringen, en de tabellen die hun databaseaanroepen lazen en schreven |
| **Views** | Een view is opgebouwd uit de tabellen waarop ze is gedefinieerd (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, materialized views van ClickHouse, Databricks, MongoDB) |
| **Querygeschiedenis** | Een query die de ene tabel las en naar een andere schreef (de toegangsgeschiedenis van Snowflake, de jobs van BigQuery, het querylog van Redshift, het querylog van ClickHouse, de lineagetabel van Databricks) |

Het tabblad **Herkomst** van een tabel toont de tabellen waaruit ze is opgebouwd, de pipelines die ernaar schrijven met hun laatste uitvoering, en de tabellen die uit haar zijn opgebouwd. Elke verbinding zegt waar ze is gezien.

Waar de bron kolommen noemt, zegt het tabblad **Kolommen** van een tabel waar elke kolom vandaan komt en wat ze voedt: de toegangsgeschiedenis van Snowflake (Enterprise edition, die `IMPORTED PRIVILEGES` op de database `SNOWFLAKE` nodig heeft), en de facet `columnLineage` van OpenLineage.

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

## Jobs in je traces

Veel pipelines zijn een Kubernetes CronJob, of een functie op een timer, zonder scheduler die herkomst stuurt. Hun traces zeggen het toch, zonder dat je iets hoeft te installeren. Elke vijftien minuten worden spans met het resourcekenmerk `k8s.cronjob.name` of `k8s.job.name`, of `faas.name` met een `faas.trigger` van `timer` of `datasource`, een pipeline onder **Pipelines**:

- Een uitvoering van een CronJob is haar Kubernetes Job, en een uitvoering van een functie is haar `faas.invocation_id`.
- Een uitvoering is mislukt wanneer de span bovenaan haar trace dat was. Een aanroep die mislukte en daarbinnen opnieuw werd geprobeerd, laat haar niet mislukken.
- De tabellen die ze schreef en las komen uit haar databasespans.

Elke uitvoering verwijst naar haar trace, met haar logboeken. Dezelfde drie monitoren gelden, dus een CronJob die stopt met draaien, wordt gezien als te laat.

## Dashboards in BI-tools

De echte impact van slechte gegevens is het dashboard dat iemand opent. Voeg onder **BI-dashboards** je BI-tools toe met inloggegevens die hun dashboards mogen lezen. Elk uur leest Data-observability elk dashboard en de tabellen erachter, koppelt elke tabel aan een bewaakte tabel en toont de dashboards die op een tabel, en op de tabellen die eruit worden gebouwd, zijn gebouwd op het tabblad **Herkomst**, bij de waarschuwingen en in Production Review.

| Tool | Inloggegevens |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, een service principal die de beheer-API's van Power BI mag gebruiken |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (of `eu`) |

Hightouch en Census zijn reverse-ETL-tools: een synchronisatie die een tabel naar een CRM kopieert, hangt van die tabel af zoals een dashboard dat doet, dus ze wordt op dezelfde manier gelezen en genoemd bij de waarschuwingen van de tabel.

Alleen de namen en links van dashboards en de tabellen die ze opvragen worden gelezen: nooit hun gegevens.

## Pipelines

Elke job, elk dbt-project en elke synchronisatie verschijnt onder **Pipelines**, met de uitvoeringen: wanneer elke uitvoering begon en eindigde, hoe lang ze duurde, welke poging het was waar de scheduler dat zegt (het try-nummer van Airflow), en de fout van een mislukte uitvoering. Na vijf uitvoeringen leert elke pipeline uit zijn eigen uitvoeringen hoe lang een uitvoering gewoonlijk duurt en hoeveel tijd er volgens zijn planning tussen twee uitvoeringen zit. De pagina van een pipeline beveelt drie monitoren aan:

- **Pipeline Run Failed**: een uitvoering is mislukt of afgebroken.
- **Pipeline Run Unusually Long**: een uitvoering heeft twee keer haar gebruikelijke tijd of langer geduurd, elke vijf minuten gecontroleerd zolang ze loopt, zodat een uitvoering die vastloopt al wordt opgemerkt voordat ze eindigt.
- **Pipeline Is Late**: er is langer geen uitvoering gestart dan de planning toestaat.

## Eén waarschuwing per oorzaak

Wanneer een tabel verouderd raakt, raakt elke tabel die eruit is opgebouwd ook verouderd. Voordat een gegevenswaarschuwing opent, zoekt OneUptime in de herkomst naar een waarschuwing die al openstaat op datgene waaruit haar tabel of pipeline is opgebouwd: de tabellen stroomopwaarts, de pipelines die ernaar schrijven, en de databases waarin ze staan, tot vijf stappen omhoog. Vindt het er een, dan is de nieuwe waarschuwing een gevolg van die waarschuwing:

- Ze begint als **bevestigd**, zodat niemand twee keer wordt opgeroepen voor één probleem, en herstelt vanzelf zodra haar gegevens herstellen.
- Haar feed en haar kaart **Gegevens** zeggen welke waarschuwing haar veroorzaakte, en ze sluit zich aan bij de episode van de oorzaak.

De kaart **Gegevens** van de oorzaak toont haar **Impact stroomafwaarts**: elke waarschuwing die ze veroorzaakte. De kaart van een tabelwaarschuwing toont ook de services die naar de tabel schrijven, met hun mislukte schrijfacties, en hun deploys en andere wijzigingen in de dag vóór de waarschuwing.

## Voordat een wijziging wordt gemerged

Wanneer een pull request een bewaakte tabel wijzigt, zegt [Production Review](/docs/ai/ai-agent) op de pull request wat ervan afhangt: de services die haar lezen, de tabellen die eruit zijn opgebouwd, de dashboards erop en haar dataproducten. Een tabel met een kopie op een database die als Staging is gemarkeerd, zegt ook hoe de kopie verschilt: haar rijen, haar kolommen en wat de controles van de tabel daar lezen, ter plekke uitgevoerd. Op een database die alleen een sonde kan bereiken, worden de controles weggelaten, en dat wordt gemeld.

## Volgende stappen

:::cards
- [Dataproducten](/docs/data-observability/data-products): Actualiteits-SLA's over de tabellen die mensen gebruiken.
- [OneUptime AI en de API](/docs/data-observability/ai-and-api): Onderzoeken die beginnen bij de schrijvers en uitvoeringen van een tabel.
:::
