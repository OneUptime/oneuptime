# OneUptime AI og API'et

OneUptime AI kender dine data: den undersøger en dataadvarsel ud fra tabellens skrivere, kørsler og afstamning, svarer på, om en tabel er opdateret, og hvad den er bygget af, hvor end spørgsmålet stilles, og skriver et tjek ud fra en regel, der er formuleret i en sætning. Alt, hvad Dataobservabilitet viser, er også tilgængeligt for dine egne værktøjer, via dens endpoints, dens metrikker og MCP-serveren.

## OneUptime AI

- **Undersøgelser af dataadvarsler.** Når OneUptime AI undersøger en advarsel på en tabel, en pipeline eller en database, tager den udgangspunkt i det, der ligger lige ved siden af: tabellens aktualitet og åbne advarsler, den advarsel, den er en følge af, kørslerne af de pipelines, der skriver til den, siden dagen før (en mislykket kørsel med dens fejl, eller den kørsel, der aldrig kom), de tjenester, der skriver til den, med deres mislykkede skrivninger, udrulninger og andre ændringer, og dens afstamning (de tabeller, den er bygget af, og de tabeller, der er bygget af den, dem med et problem først, hvor i den den advarsel, den er en følge af, ligger, og hvilke tabeller de advarsler, den har udløst, ligger på), og de kolonner, der er ændret. Den udpeger den kørsel, udrulning eller opstrøms tabel, der ligger bag advarslen. Se [AI SRE](/docs/ai/ai-sre).
- **Er denne tabel opdateret?** Spørg i [Spørg AI](/docs/ai/ask-ai), Slack eller Microsoft Teams: "er tabellen orders opdateret?". Svaret giver tabellens aktualitet ud fra dens egen rytme, hvornår den sidst blev ændret, dens åbne advarsler, dens skriveres seneste kørsler og de dataprodukter, den indgår i. Et navn, som flere databaser deler, besvares for hver af dem, så ingen får at vide, at den forkerte tabel er opdateret.
- **Hvad er denne tabel bygget af?** Spørg "hvad fodrer tabellen revenue?" eller "hvad går i stykker, hvis raw.orders holder op med at blive indlæst?". Svaret følger tabellens afstamning tre trin i hver retning, eller op til fem, når der bedes om det, og sætter det, der er galt, først: de opstrøms og nedstrøms tabeller, der er forsinkede, slettede, har åbne advarsler, eller hvis pipeline fejlede ved sin seneste kørsel, de nærmeste først, hver med hvor mange trin væk den er, og tabellerne imellem. Derefter kommer resten, de pipelines, der indlæser dens kilder udefra det, OneUptime overvåger, og de BI-dashboards, der er bygget på den. Åbne advarsler tælles, nævnes aldrig ved navn, og kun dem, den person, der spørger, må se.
- **Et tjek ud fra en sætning.** På en tabels fane **Tjek** gør **Skriv et tjek ud fra en sætning** en regel til et tjek med brugerdefineret SQL i din motors SQL. Se [Kontroller og afstemninger](/docs/data-observability/checks).

- **Langsom drift.** En tabels rækker eller et tjeks værdi, der flytter sig med en femtedel eller mere på en uge, for langsomt til nogen advarsel, kommer til AI Insights som et kig-her. Den alarmerer ingen.
- **Forældede data bag AI-apps.** En tjeneste, der både kalder en model og læser en tabel, er tabellens AI-forbruger. Når sådan en tabel bliver forsinket, siger AI-produktets side **Samtaler** det: en app, der svarer ud fra gamle data, viser intet galt i sine egne spor.

Hver af disse kræver, at OneUptime AI er slået til for projektet, og handler med tilladelserne hos den person, der spørger.

## AI-agenter og MCP-serveren

AI-agenter bør tjekke, at data er opdaterede, før de bruger dem, og hvad der er bygget af en tabel, før de ændrer den. [MCP-serveren](/docs/ai/mcp-server) har skrivebeskyttede værktøjer til begge dele:

| Værktøj | Hvad det svarer på |
| --- | --- |
| `get_data_table_freshness` | Om en overvåget tabel er opdateret, hvornår den sidst blev ændret, dens åbne advarsler, dens skriveres seneste kørsler og dens dataprodukter. Angiv `table` som `schema.table`, tabellens navn alene eller dens ID |
| `get_data_table_lineage` | Hvad en overvåget tabel er bygget af, og hvad der er bygget af den, tre trin i hver retning eller op til fem: tabellerne med et problem først, de nærmeste først, så resten, de pipelines, der indlæser dens kilder udefra, og de BI-dashboards, der er bygget på den. Angiv `table` som for dens aktualitet, og `depth` fra 1 til 5 |

De virker begge med et skrivebeskyttet login og svarer som den person eller API-nøgle, der loggede ind.

## Endpoints

| Endpoint | Hvad det bruges til | Signeret med |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-hændelser fra Airflow, Dagster, Spark, dbt eller Flink | En indtagelsesnøgle til telemetri |
| `POST /telemetry/dbt/v1/artifacts` | Et dbt-builds `manifest` og `run_results` | En indtagelsesnøgle til telemetri |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetrans synkroniseringswebhooks | Indtagelsesnøglen som Fivetrans signeringshemmelighed |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbytes synkroniseringswebhooks | Indtagelsesnøglen i URL'en |
| `POST /api/data-observability/tables/freshness` | En tabels aktualitet, som MCP-værktøjet besvarer den, med `{ "table": "public.orders" }` | En API-nøgle |
| `POST /api/data-observability/tables/lineage` | En tabels afstamning nogle trin i hver retning, med hvordan hver tabel står nu, som dens fane **Afstamning** tegner den, med `{ "dataAssetId": "<table ID>", "depth": 3 }`, og med `"withColumns": true` de kolonner, hver pil bærer | En API-nøgle |
| `POST /api/data-observability/tables/lineage/answer` | En tabels afstamning fortalt i ord, tabellerne med et problem først, som MCP-værktøjet svarer, med `{ "table": "public.orders", "depth": 3 }` | En API-nøgle |
| `POST /api/data-observability/pipelines/lineage` | De tabeller, en pipeline læser og skriver, med hvordan hver tabel står nu, som dens side tegner dem, med `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | En API-nøgle |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | En dataadvarsels afstamning, som dens side tegner den, med vejen til den advarsel, der forårsagede den, og til de advarsler, den forårsagede | En API-nøgle |
| `POST /api/data-observability/lineage/expand` | De næste tabeller, et kort i et afstamningsdiagram ikke tegner, sådan som et valg af dets tal tegner dem: kortet som `nodeId` med dets `side`, og det tegnede som `focusNodeId`, `tables` og `dataDashboardIds` | En API-nøgle |
| `POST /api/data-observability/checks/apply` | Få projektets tjek til at matche en fil, som `oneuptime data-checks apply` gør, med `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | En API-nøgle |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | Et dataprodukts "data as of"-badge | Badgets eget token |

Tabeller, tjek, afstemninger, pipelines, dataprodukter, BI-forbindelser og warehouse-jobs er også almindelige ressourcer i [API'et](/docs/api-reference/api-reference), som læses og ændres med en API-nøgle, der har de tilsvarende tilladelser, og i MCP-serveren og workflows.

## Metrikker

Hvert tal, Dataobservabilitet gemmer, er en metrik, du kan vise i en graf, sætte på et dashboard eller advare på: `oneuptime.data.table.*` for hver tabel, `oneuptime.data.check.value` for hvert tjek, `oneuptime.data.reconciliation.*` for hver afstemning, `oneuptime.data.pipeline.*` for hver pipeline og `oneuptime.data.product.*` for hvert dataprodukt. De er OneUptimes egne driftsdata og faktureres ikke som telemetri.

## Næste trin

:::cards
- [MCP-server](/docs/ai/mcp-server): Forbind en AI-agent til OneUptime.
- [Dataobservabilitet](/docs/data-observability/index): Tilbage til oversigten.
:::
