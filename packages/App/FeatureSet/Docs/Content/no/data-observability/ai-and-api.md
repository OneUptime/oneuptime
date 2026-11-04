# OneUptime AI og API-et

OneUptime AI kjenner dataene dine: den undersøker et datavarsel ut fra tabellens skrivere, kjøringer og oppstrømstabeller, svarer på om en tabell er fersk uansett hvor du spør, og skriver en sjekk ut fra en regel formulert i én setning. Alt Dataobserverbarhet viser, er også tilgjengelig for dine egne verktøy, gjennom endepunktene, metrikkene og MCP-serveren.

## OneUptime AI

- **Undersøkelser av datavarsler.** Når OneUptime AI undersøker et varsel på en tabell, en pipeline eller en database, starter den fra det som ligger nærmest: tabellens aktualitet og åpne varsler, varselet det er en følge av, kjøringene av pipelinene som skriver til den siden dagen før (en mislykket kjøring med feilen, eller kjøringen som aldri kom), tjenestene som skriver til den, med de mislykkede skrivingene, utrullingene og andre endringer deres, og tabellene den er bygget fra. Den navngir kjøringen, utrullingen eller oppstrømstabellen bak varselet. Se [AI SRE](/docs/ai/ai-sre).
- **Er denne tabellen fersk?** Spør i [Spør AI](/docs/ai/ask-ai), Slack eller Microsoft Teams: «er orders-tabellen fersk?». Svaret gir tabellens aktualitet målt mot dens egen rytme, når den sist ble endret, de åpne varslene, skrivernes siste kjøringer og dataproduktene den er en del av. Et navn som flere databaser deler, besvares for hver av dem, så ingen får høre at feil tabell er fersk.
- **En sjekk ut fra en setning.** I fanen **Sjekker** for en tabell gjør **Skriv en sjekk fra en setning** en regel om til en sjekk med egendefinert SQL i databasemotorens SQL. Se [Kontroller og avstemminger](/docs/data-observability/checks).

Hver av disse krever at OneUptime AI er slått på for prosjektet, og handler med tillatelsene til den som spør.

## AI-agenter og MCP-serveren

AI-agenter bør sjekke at dataene er ferske før de bruker dem. [MCP-serveren](/docs/ai/mcp-server) har et skrivebeskyttet verktøy for det:

| Verktøy | Hva det svarer på |
| --- | --- |
| `get_data_table_freshness` | Om en overvåket tabell er fersk, når den sist ble endret, de åpne varslene, skrivernes siste kjøringer og dataproduktene. Oppgi `table` som `schema.table`, bare tabellnavnet eller ID-en |

Det fungerer med en skrivebeskyttet innlogging, og svarer som personen eller API-nøkkelen som logget inn.

## Endepunkter

| Endepunkt | Hva det er for | Signert med |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-hendelser fra Airflow, Dagster, Spark, dbt eller Flink | En inntaksnøkkel for telemetri |
| `POST /telemetry/dbt/v1/artifacts` | `manifest` og `run_results` fra en dbt-bygging | En inntaksnøkkel for telemetri |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Synkroniseringswebhookene fra Fivetran | Inntaksnøkkelen, som signeringshemmeligheten til Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Synkroniseringswebhookene fra Airbyte | Inntaksnøkkelen i URL-en |
| `POST /api/data-observability/tables/freshness` | Aktualiteten til en tabell, slik MCP-verktøyet svarer, med `{ "table": "public.orders" }` | En API-nøkkel |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | «data as of»-merket til et dataprodukt | Merkets eget token |

Tabeller, sjekker, avstemminger, pipelines og dataprodukter er også vanlige ressurser i [API-et](/docs/api-reference/api-reference), som leses og endres med en API-nøkkel som har de tilsvarende tillatelsene.

## Metrikker

Hvert tall Dataobserverbarhet tar vare på, er en metrikk du kan lage grafer av, legge på et dashbord eller varsle på: `oneuptime.data.table.*` for hver tabell, `oneuptime.data.check.value` for hver sjekk, `oneuptime.data.reconciliation.*` for hver avstemming, `oneuptime.data.pipeline.*` for hver pipeline og `oneuptime.data.product.*` for hvert dataprodukt. De er OneUptimes egne driftsdata og faktureres ikke som telemetri.

## Neste steg

:::cards
- [MCP-server](/docs/ai/mcp-server): Koble en AI-agent til OneUptime.
- [Dataobserverbarhet](/docs/data-observability/index): Tilbake til oversikten.
:::
