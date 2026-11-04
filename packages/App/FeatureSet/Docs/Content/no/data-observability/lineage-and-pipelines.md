# Avstamning og pipelines

Avstamning viser hvilke tabeller hver tabell er bygget fra, og hvilke pipelines som skriver til den. Dataobserverbarhet samler den inn fra fem steder samtidig – OpenLineage-hendelser, dbt, synkroniseringer fra Fivetran og Airbyte, visninger og hver databases egen spørringshistorikk – og bruker den til å knytte hver forsinkede eller ødelagte tabell til kjøringen bak, slik at ett problem åpner én sak.

## Hvor avstamningen kommer fra

| Kilde | Hva den gir |
| --- | --- |
| **OpenLineage** | Hver kjøring av en Airflow-, Dagster-, Spark-, dbt- eller Flink-jobb, og tabellene den leste og skrev til |
| **dbt** | Hva hver modell er bygget fra, hver bygging som en kjøring, og resultatet av hver test |
| **Fivetran og Airbyte** | Hver synkronisering som en kjøring av koblingen, og råtabellene den laster |
| **Visninger** | En visning er bygget fra tabellene den er definert på (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, materialiserte visninger i ClickHouse, Databricks, MongoDB) |
| **Spørringshistorikk** | En spørring som leste én tabell og skrev til en annen (jobbene i BigQuery, spørringsloggen i Redshift, spørringsloggen i ClickHouse, avstamningstabellen i Databricks) |

Fanen **Opphav** for en tabell viser tabellene den er bygget fra, pipelinene som skriver til den med siste kjøring, og tabellene som er bygget fra den. Hver forbindelse viser hvor den ble sett.

## OpenLineage

Send OpenLineage-hendelser til OneUptime, uendret, med en [inntaksnøkkel](/docs/telemetry/ingestion-keys) for telemetri:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (på en selvhostet OneUptime, din egen adresse)
- **Endpoint:** `api/v1/lineage`, standarden i OpenLineage
- **API-nøkkel:** inntaksnøkkelen, sendt som `Authorization: Bearer`, eller angi `x-oneuptime-token`

For OpenLineage-provideren i Airflow:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

For enhver annen OpenLineage-klient angir du `OPENLINEAGE_URL` og `OPENLINEAGE_API_KEY`. Datasett knyttes til tabeller etter navnespesifikasjonen i OpenLineage, for eksempel `postgres://host:5432` med `database.schema.table`, `snowflake://account` med `database.schema.table`, `clickhouse://host:8443` med `database.table`, og `databricks://workspace-host` med `catalog.schema.table`.

## dbt

Etter `dbt build` (eller run, test, seed eller snapshot) sender du prosjektets artefakter med [OneUptime CLI](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

I CI kjører du `oneuptime dbt upload` som steget etter byggingen, også når byggingen feiler, slik at mislykkede tester blir registrert. Hver tabell dbt bygger, får et **dbt**-kort på Oversikt-siden, avstamningen fra modellene, og testene sine i fanen **Sjekker**; hver bygging er en kjøring av prosjektets pipeline.

## Fivetran og Airbyte

Webhookene deres sier når hver synkronisering starter og slutter. **Pipelines > Koble til Fivetran eller Airbyte** fyller ut URL-ene med en av inntaksnøklene dine:

- **Fivetran:** en webhook opprettet med REST API-et til Fivetran, for hendelsene `sync_start` og `sync_end`, til `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, med inntaksnøkkelen som hemmelighet. Fivetran signerer hver levering med den, så nøkkelen sendes aldri i URL-en.
- **Airbyte:** arbeidsområdets webhook satt til `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, slått på for mislykkede og vellykkede synkroniseringer. Gi Airbyte en egen nøkkel.

En Fivetran-synkronisering som planlegges på nytt fordi et API har nådd frekvensgrensen sin, ender som **Omplanlagt**: ikke en feil, så den tilkaller ingen.

## Dashbord i BI-verktøy

Den virkelige følgen av dårlige data er dashbordet noen åpner. Under **BI-dashbord** legger du til BI-verktøyene dine med legitimasjon som kan lese dashbordene deres. Hver time leser Dataobserverbarhet hvert dashbord og tabellene bak det, matcher hver tabell med en overvåket tabell og viser dashbordene som er bygget på en tabell, og på tabellene som bygges av den, på fanen **Opphav**, på varslene og i Production Review.

| Verktøy | Legitimasjon |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, en tjenestekontohaver (service principal) som kan bruke Power BIs administrator-API-er |

Bare dashbordenes navn og lenker, og tabellene de spør mot, leses: aldri dataene deres.

## Pipelines

Hver jobb, hvert dbt-prosjekt og hver synkronisering vises under **Pipelines**, med kjøringene sine: når hver startet og sluttet, hvor lang tid den tok, og feilen fra en mislykket kjøring. Etter fem kjøringer har hver pipeline lært av sine egne kjøringer hvor lang tid en kjøring vanligvis tar, og hvor lenge det går mellom kjøringene etter tidsplanen. Siden for en pipeline anbefaler tre monitorer:

- **Pipeline Run Failed**: en kjøring feilet eller ble avbrutt.
- **Pipeline Run Unusually Long**: en kjøring har tatt dobbelt så lang tid som vanlig eller mer, sjekket hvert femte minutt mens den kjører, så en kjøring som henger, oppdages før den er ferdig.
- **Pipeline Is Late**: ingen kjøring har startet på lengre tid enn tidsplanen tillater.

## Én sak per årsak

Når en tabell blir utdatert, blir hver tabell som er bygget fra den, også utdatert. Før et datavarsel åpnes, slår OneUptime opp i avstamningen etter et varsel som allerede er åpent på det tabellen eller pipelinen er bygget fra: tabellene oppstrøms, pipelinene som skriver til dem, og databasene de ligger i, opptil fem trinn opp. Når den finner et, blir det nye varselet en følge av det varselet:

- Det starter som **bekreftet**, så ingen tilkalles to ganger for ett problem, og det løser seg av seg selv når dataene er i orden igjen.
- Feeden og **Data**-kortet sier hvilket varsel som forårsaket det, og det blir med i episoden til årsaken.

**Data**-kortet til årsaken viser **Downstream Impact**: hvert varsel den forårsaket. Kortet for et tabellvarsel viser også tjenestene som skriver til tabellen, med de mislykkede skrivingene deres, og utrullingene og andre endringer deres i døgnet før varselet.

## Neste steg

:::cards
- [Dataprodukter](/docs/data-observability/data-products): Aktualitets-SLA-er for tabellene folk bruker.
- [OneUptime AI og API-et](/docs/data-observability/ai-and-api): Undersøkelser som starter fra skriverne og kjøringene til en tabell.
:::
