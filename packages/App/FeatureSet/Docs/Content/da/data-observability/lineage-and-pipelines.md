# Afstamning og pipelines

Afstamning viser, hvilke tabeller hver tabel er bygget af, og hvilke pipelines der skriver til den. Dataobservabilitet samler den fra seks steder på én gang - OpenLineage-hændelser, dbt, synkroniseringer i Fivetran og Airbyte, jobs i dine spor, views og hver databases egen forespørgselshistorik - og bruger den til at knytte hver forsinket eller ødelagt tabel til kørslen bag den, så ét problem åbner én advarsel.

## Hvor afstamningen kommer fra

| Kilde | Hvad den giver |
| --- | --- |
| **OpenLineage** | Hver kørsel af et Airflow-, Dagster-, Spark-, dbt- eller Flink-job og de tabeller, det læste og skrev |
| **dbt** | Hvad hver model er bygget af, hvert build som en kørsel og hver tests resultat |
| **Fivetran og Airbyte** | Hver synkronisering som en kørsel af dens connector og de rå tabeller, den indlæser |
| **Jobs i dine spor** | Et Kubernetes CronJob eller en planlagt funktion, dens kørsler og de tabeller, dens databasekald læste og skrev |
| **Views** | Et view er bygget af de tabeller, det er defineret på (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, materialiserede views i ClickHouse, Databricks, MongoDB) |
| **Forespørgselshistorik** | En forespørgsel, der læste én tabel og skrev til en anden (Snowflakes adgangshistorik, BigQuerys jobs, Redshifts forespørgselslog, ClickHouses forespørgselslog, Databricks' afstamningstabel) |

En tabels fane **Afstamning** viser de tabeller, den er bygget af, de pipelines, der skriver til den, med deres seneste kørsel, og de tabeller, der er bygget af den. Hver kant viser, hvor den blev set.

Hvor kilden nævner kolonner, viser en tabels fane **Kolonner**, hvor hver kolonne kommer fra, og hvad den føder: Snowflakes adgangshistorik (Enterprise-udgaven, som kræver `IMPORTED PRIVILEGES` på databasen `SNOWFLAKE`) og OpenLineages facet `columnLineage`.

## OpenLineage

Send OpenLineage-hændelser til OneUptime, uændrede, med en [indtagelsesnøgle](/docs/telemetry/ingestion-keys) til telemetri:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (på en selvhostet OneUptime din egen adresse)
- **Endpoint:** `api/v1/lineage`, OpenLineages standard
- **API-nøgle:** indtagelsesnøglen, sendt som `Authorization: Bearer`, eller angiv `x-oneuptime-token`

Til Airflows OpenLineage-provider:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

For enhver anden OpenLineage-klient angiver du `OPENLINEAGE_URL` og `OPENLINEAGE_API_KEY`. Datasæt matches med tabeller efter OpenLineages navngivningsspecifikation, f.eks. `postgres://host:5432` med `database.schema.table`, `snowflake://account` med `database.schema.table`, `clickhouse://host:8443` med `database.table` og `databricks://workspace-host` med `catalog.schema.table`.

## dbt

Efter `dbt build` (eller run, test, seed eller snapshot) sender du projektets artefakter med [OneUptime-CLI'en](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

I CI kører du `oneuptime dbt upload` som trinnet efter buildet, også når buildet fejler, så fejlede tests bliver registreret. Hver tabel, dbt bygger, får et **dbt**-kort på sin Oversigt, sine modellers afstamning og sine tests på fanen **Tjek**; hvert build er en kørsel af projektets pipeline.

## Fivetran og Airbyte

Deres webhooks fortæller, hvornår hver synkronisering starter og slutter. **Pipelines > Forbind Fivetran eller Airbyte** udfylder URL'erne med en af dine indtagelsesnøgler:

- **Fivetran:** en webhook, der er oprettet med Fivetrans REST API, til hændelserne `sync_start` og `sync_end`, til `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, med indtagelsesnøglen som hemmelighed. Fivetran signerer hver levering med den, så nøglen aldrig sendes i URL'en.
- **Airbyte:** arbejdsområdets webhook sat til `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, slået til for mislykkede og vellykkede synkroniseringer. Giv Airbyte sin egen nøgle.

En Fivetran-synkronisering, der omplanlægges ved et API's hastighedsgrænse, ender som **Omplanlagt**: ikke en fejl, så den tilkalder ingen.

## Jobs i dine spor

Mange pipelines er et Kubernetes CronJob eller en funktion på en timer uden nogen planlægger, der sender afstamning. Deres spor siger det alligevel, uden noget at installere. Hvert femtende minut bliver spans med ressourceattributten `k8s.cronjob.name` eller `k8s.job.name`, eller `faas.name` med en `faas.trigger` på `timer` eller `datasource`, til en pipeline under **Pipelines**:

- En kørsel af et CronJob er dets Kubernetes Job, og en kørsel af en funktion er dens `faas.invocation_id`.
- En kørsel mislykkedes, når den span, der ligger øverst i dens spor, gjorde det. Et kald, der mislykkedes og blev forsøgt igen inde i den, får den ikke til at mislykkes.
- De tabeller, den skrev og læste, kommer fra dens databasespans.

Hver kørsel linker til sit spor, med dets logge. De samme tre monitorer gælder, så et CronJob, der holder op med at køre, ses som forsinket.

## Dashboards i BI-værktøjer

Den reelle følge af dårlige data er det dashboard, nogen åbner. Under **BI-dashboards** tilføjer du dine BI-værktøjer med legitimationsoplysninger, der må læse deres dashboards. Hver time læser Dataobservabilitet hvert dashboard og tabellerne bag det, matcher hver tabel med en overvåget tabel og viser de dashboards, der er bygget på en tabel og på de tabeller, der bygges af den, på dens fane **Afstamning**, på dens alarmer og i Production Review.

| Værktøj | Legitimationsoplysninger |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, en service principal, der må bruge Power BI's administrator-API'er |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (eller `eu`) |

Hightouch og Census er reverse ETL-værktøjer: en synkronisering, der kopierer en tabel ind i et CRM, afhænger af den tabel, som et dashboard gør, så den læses på samme måde og nævnes på tabellens advarsler.

Kun dashboards' navne og links og de tabeller, de forespørger, læses: aldrig deres data.

## Pipelines

Hvert job, dbt-projekt og hver synkronisering vises under **Pipelines**, med sine kørsler: hvornår hver startede og sluttede, hvor lang tid den tog, hvilket forsøg den var, hvor planlæggeren oplyser det (Airflows try number), og fejlen for en mislykket kørsel. Efter fem kørsler lærer hver pipeline af sine egne kørsler, hvor lang tid en kørsel plejer at tage, og hvor lang tid der går mellem kørslerne efter dens tidsplan. En pipelines side anbefaler tre monitorer:

- **Pipeline Run Failed**: en kørsel mislykkedes eller blev afbrudt.
- **Pipeline Run Unusually Long**: en kørsel har taget dobbelt så lang tid som normalt eller mere, tjekket hvert femte minut, mens den kører, så en kørsel, der hænger, opdages, før den slutter.
- **Pipeline Is Late**: ingen kørsel er startet i længere tid, end tidsplanen tillader.

## Én advarsel pr. årsag

Når en tabel bliver forældet, bliver hver tabel, der er bygget af den, også forældet. Før en dataadvarsel åbnes, slår OneUptime op i afstamningen efter en advarsel, der allerede er åben på det, dens tabel eller pipeline er bygget af: tabellerne opstrøms, de pipelines, der skriver til dem, og de databaser, de ligger i, op til fem trin op. Finder den en, er den nye advarsel en følge af den advarsel:

- Den starter som **bekræftet**, så ingen tilkaldes to gange for ét problem, og genopretter sig selv, når dens data gør det.
- Dens feed og dens **Data**-kort viser, hvilken advarsel der forårsagede den, og den slutter sig til årsagens episode.

Årsagens **Data**-kort viser dens **Nedstrøms påvirkning**: hver advarsel, den forårsagede. En tabeladvarsels kort viser også de tjenester, der skriver til tabellen, med deres mislykkede skrivninger og deres udrulninger og andre ændringer i døgnet før advarslen.

## Før en ændring flettes

Når en pull request ændrer en overvåget tabel, siger [Production Review](/docs/ai/ai-agent) på pull requesten, hvad der afhænger af den: de tjenester, der læser den, de tabeller, der er bygget af den, de dashboards, der ligger på den, og dens dataprodukter. En tabel med en kopi på en database markeret som Staging siger også, hvordan kopien adskiller sig: dens rækker, dens kolonner og det, tabellens tjek læser dér, kørt på stedet. På en database, som kun en sonde kan nå, udelades tjekkene, og den siger det.

## Næste trin

:::cards
- [Dataprodukter](/docs/data-observability/data-products): Aktualitets-SLA'er over de tabeller, folk bruger.
- [OneUptime AI og API'et](/docs/data-observability/ai-and-api): Undersøgelser, der tager udgangspunkt i en tabels skrivere og kørsler.
:::
