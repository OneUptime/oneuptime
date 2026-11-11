# OneUptime AI og API-et

OneUptime AI kjenner dataene dine: den undersøker et datavarsel ut fra tabellens skrivere, kjøringer og opphav, svarer på om en tabell er fersk og hva den er bygget fra uansett hvor du spør, og skriver en sjekk ut fra en regel formulert i én setning. Alt Dataobserverbarhet viser, er også tilgjengelig for dine egne verktøy, gjennom endepunktene, metrikkene og MCP-serveren.

## OneUptime AI

- **Undersøkelser av datavarsler.** Når OneUptime AI undersøker et varsel på en tabell, en pipeline eller en database, starter den fra det som ligger nærmest: tabellens aktualitet og åpne varsler, varselet det er en følge av, kjøringene av pipelinene som skriver til den siden dagen før (en mislykket kjøring med feilen, eller kjøringen som aldri kom), tjenestene som skriver til den, med de mislykkede skrivingene, utrullingene og andre endringer deres, opphavet dens (tabellene den er bygget fra og tabellene som er bygget fra den, de med et problem først, hvor i det varselet det er en følge av ligger, og hvilke tabeller varslene det utløste ligger på), og kolonnene som endret seg. Den navngir kjøringen, utrullingen eller oppstrømstabellen bak varselet. Se [AI SRE](/docs/ai/ai-sre).
- **Er denne tabellen fersk?** Spør i [Spør AI](/docs/ai/ask-ai), Slack eller Microsoft Teams: «er orders-tabellen fersk?». Svaret gir tabellens aktualitet målt mot dens egen rytme, når den sist ble endret, de åpne varslene, skrivernes siste kjøringer og dataproduktene den er en del av. Et navn som flere databaser deler, besvares for hver av dem, så ingen får høre at feil tabell er fersk.
- **Hva er denne tabellen bygget fra?** Spør «hva mater revenue-tabellen?» eller «hva går i stykker hvis raw.orders slutter å laste?». Svaret følger tabellens opphav tre trinn i hver retning, eller opptil fem når du ber om det, og setter det som er galt først: oppstrøms- og nedstrømstabellene som er forsinket, slettet, har åpne varsler eller der pipelinen feilet på siste kjøring, de nærmeste først, hver med hvor mange trinn unna den er og tabellene imellom. Deretter kommer resten, pipelinene som laster kildene dens utenfra det OneUptime overvåker, og BI-dashbordene som er bygget på den. Åpne varsler telles, nevnes aldri ved navn, og bare de personen som spør, har lov til å se.
- **En sjekk ut fra en setning.** I fanen **Sjekker** for en tabell gjør **Skriv en sjekk fra en setning** en regel om til en sjekk med egendefinert SQL i databasemotorens SQL. Se [Kontroller og avstemminger](/docs/data-observability/checks).

- **Langsom drift.** Når radene i en tabell, eller verdien til en sjekk, flytter seg med en femtedel eller mer på en uke, for langsomt til at noe varsel utløses, havner det i AI Insights som et «se her». Det varsler ingen.
- **Utdaterte data bak AI-apper.** En tjeneste som både kaller en modell og leser en tabell, er tabellens AI-forbruker. Når en slik tabell blir forsinket, sier siden **Samtaler** i AI-produktet fra om det: en app som svarer ut fra gamle data viser ingenting galt i sine egne traces.

Hver av disse krever at OneUptime AI er slått på for prosjektet, og handler med tillatelsene til den som spør.

## AI-agenter og MCP-serveren

AI-agenter bør sjekke at dataene er ferske før de bruker dem, og hva som er bygget fra en tabell før de endrer den. [MCP-serveren](/docs/ai/mcp-server) har skrivebeskyttede verktøy for begge deler:

| Verktøy | Hva det svarer på |
| --- | --- |
| `get_data_table_freshness` | Om en overvåket tabell er fersk, når den sist ble endret, de åpne varslene, skrivernes siste kjøringer og dataproduktene. Oppgi `table` som `schema.table`, bare tabellnavnet eller ID-en |
| `get_data_table_lineage` | Hva en overvåket tabell er bygget fra og hva som er bygget fra den, tre trinn i hver retning eller opptil fem: tabellene med et problem først, de nærmeste først, så resten, pipelinene som laster kildene dens utenfra, og BI-dashbordene som er bygget på den. Oppgi `table` som for aktualiteten, og `depth` fra 1 til 5 |

Begge fungerer med en skrivebeskyttet innlogging, og svarer som personen eller API-nøkkelen som logget inn.

## Endepunkter

| Endepunkt | Hva det er for | Signert med |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-hendelser fra Airflow, Dagster, Spark, dbt eller Flink | En inntaksnøkkel for telemetri |
| `POST /telemetry/dbt/v1/artifacts` | `manifest` og `run_results` fra en dbt-bygging | En inntaksnøkkel for telemetri |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Synkroniseringswebhookene fra Fivetran | Inntaksnøkkelen, som signeringshemmeligheten til Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Synkroniseringswebhookene fra Airbyte | Inntaksnøkkelen i URL-en |
| `POST /api/data-observability/tables/freshness` | Aktualiteten til en tabell, slik MCP-verktøyet svarer, med `{ "table": "public.orders" }` | En API-nøkkel |
| `POST /api/data-observability/tables/lineage` | Opphavet til en tabell noen trinn i hver retning, med hvordan hver tabell står nå, slik fanen **Opphav** tegner det, med `{ "dataAssetId": "<table ID>", "depth": 3 }` | En API-nøkkel |
| `POST /api/data-observability/tables/lineage/answer` | Opphavet til en tabell fortalt med ord, tabellene med et problem først, slik MCP-verktøyet svarer, med `{ "table": "public.orders", "depth": 3 }` | En API-nøkkel |
| `POST /api/data-observability/pipelines/lineage` | Tabellene en pipeline leser og skriver, med hvordan hver tabell står nå, slik siden dens tegner dem, med `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | En API-nøkkel |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | Opphavet til et datavarsel, slik siden dets tegner det, med veien til varselet som forårsaket det, og til varslene det forårsaket | En API-nøkkel |
| `POST /api/data-observability/checks/apply` | Få prosjektets sjekker til å samsvare med en fil, slik `oneuptime data-checks apply` gjør, med `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | En API-nøkkel |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | «data as of»-merket til et dataprodukt | Merkets eget token |

Tabeller, sjekker, avstemminger, pipelines, dataprodukter, BI-tilkoblinger og datavarehusjobber er også vanlige ressurser i [API-et](/docs/api-reference/api-reference), som leses og endres med en API-nøkkel som har de tilsvarende tillatelsene, og i MCP-serveren og arbeidsflytene.

## Metrikker

Hvert tall Dataobserverbarhet tar vare på, er en metrikk du kan lage grafer av, legge på et dashbord eller varsle på: `oneuptime.data.table.*` for hver tabell, `oneuptime.data.check.value` for hver sjekk, `oneuptime.data.reconciliation.*` for hver avstemming, `oneuptime.data.pipeline.*` for hver pipeline og `oneuptime.data.product.*` for hvert dataprodukt. De er OneUptimes egne driftsdata og faktureres ikke som telemetri.

## Neste steg

:::cards
- [MCP-server](/docs/ai/mcp-server): Koble en AI-agent til OneUptime.
- [Dataobserverbarhet](/docs/data-observability/index): Tilbake til oversikten.
:::
