# Afstamning og pipelines

Afstamning viser, hvilke tabeller hver tabel er bygget af, og hvilke pipelines der skriver til den. Dataobservabilitet samler den fra fem steder på én gang - OpenLineage-hændelser, dbt, synkroniseringer i Fivetran og Airbyte, views og hver databases egen forespørgselshistorik - og bruger den til at knytte hver forsinket eller ødelagt tabel til kørslen bag den, så ét problem åbner én advarsel.

## Hvor afstamningen kommer fra

| Kilde | Hvad den giver |
| --- | --- |
| **OpenLineage** | Hver kørsel af et Airflow-, Dagster-, Spark-, dbt- eller Flink-job og de tabeller, det læste og skrev |
| **dbt** | Hvad hver model er bygget af, hvert build som en kørsel og hver tests resultat |
| **Fivetran og Airbyte** | Hver synkronisering som en kørsel af dens connector og de rå tabeller, den indlæser |
| **Views** | Et view er bygget af de tabeller, det er defineret på (PostgreSQL, Redshift, MySQL 8, SQL Server, materialiserede views i ClickHouse, Databricks) |
| **Forespørgselshistorik** | En forespørgsel, der læste én tabel og skrev til en anden (BigQuerys jobs, Redshifts forespørgselslog, ClickHouses forespørgselslog, Databricks' afstamningstabel) |

En tabels fane **Afstamning** viser de tabeller, den er bygget af, de pipelines, der skriver til den, med deres seneste kørsel, og de tabeller, der er bygget af den. Hver kant viser, hvor den blev set.

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

## Pipelines

Hvert job, dbt-projekt og hver synkronisering vises under **Pipelines**, med sine kørsler: hvornår hver startede og sluttede, hvor lang tid den tog, og fejlen for en mislykket kørsel. Efter fem kørsler lærer hver pipeline af sine egne kørsler, hvor lang tid en kørsel plejer at tage, og hvor lang tid der går mellem kørslerne efter dens tidsplan. En pipelines side anbefaler tre monitorer:

- **Pipeline Run Failed**: en kørsel mislykkedes eller blev afbrudt.
- **Pipeline Run Unusually Long**: en kørsel har taget dobbelt så lang tid som normalt eller mere, tjekket hvert femte minut, mens den kører, så en kørsel, der hænger, opdages, før den slutter.
- **Pipeline Is Late**: ingen kørsel er startet i længere tid, end tidsplanen tillader.

## Én advarsel pr. årsag

Når en tabel bliver forældet, bliver hver tabel, der er bygget af den, også forældet. Før en dataadvarsel åbnes, slår OneUptime op i afstamningen efter en advarsel, der allerede er åben på det, dens tabel eller pipeline er bygget af: tabellerne opstrøms, de pipelines, der skriver til dem, og de databaser, de ligger i, op til fem trin op. Finder den en, er den nye advarsel en følge af den advarsel:

- Den starter som **bekræftet**, så ingen tilkaldes to gange for ét problem, og genopretter sig selv, når dens data gør det.
- Dens feed og dens **Data**-kort viser, hvilken advarsel der forårsagede den, og den slutter sig til årsagens episode.

Årsagens **Data**-kort viser dens **Downstream Impact**: hver advarsel, den forårsagede. En tabeladvarsels kort viser også de tjenester, der skriver til tabellen, med deres mislykkede skrivninger og deres udrulninger og andre ændringer i døgnet før advarslen.

## Næste trin

:::cards
- [Dataprodukter](/docs/data-observability/data-products): Aktualitets-SLA'er over de tabeller, folk bruger.
- [OneUptime AI og API'et](/docs/data-observability/ai-and-api): Undersøgelser, der tager udgangspunkt i en tabels skrivere og kørsler.
:::
