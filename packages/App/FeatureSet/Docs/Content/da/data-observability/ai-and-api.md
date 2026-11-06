# OneUptime AI og API'et

OneUptime AI kender dine data: den undersøger en dataadvarsel ud fra tabellens skrivere, kørsler og opstrøms tabeller, svarer på, om en tabel er opdateret, hvor end spørgsmålet stilles, og skriver et tjek ud fra en regel, der er formuleret i en sætning. Alt, hvad Dataobservabilitet viser, er også tilgængeligt for dine egne værktøjer, via dens endpoints, dens metrikker og MCP-serveren.

## OneUptime AI

- **Undersøgelser af dataadvarsler.** Når OneUptime AI undersøger en advarsel på en tabel, en pipeline eller en database, tager den udgangspunkt i det, der ligger lige ved siden af: tabellens aktualitet og åbne advarsler, den advarsel, den er en følge af, kørslerne af de pipelines, der skriver til den, siden dagen før (en mislykket kørsel med dens fejl, eller den kørsel, der aldrig kom), de tjenester, der skriver til den, med deres mislykkede skrivninger, udrulninger og andre ændringer, og de tabeller, den er bygget af, og de kolonner, der er ændret. Den udpeger den kørsel, udrulning eller opstrøms tabel, der ligger bag advarslen. Se [AI SRE](/docs/ai/ai-sre).
- **Er denne tabel opdateret?** Spørg i [Spørg AI](/docs/ai/ask-ai), Slack eller Microsoft Teams: "er tabellen orders opdateret?". Svaret giver tabellens aktualitet ud fra dens egen rytme, hvornår den sidst blev ændret, dens åbne advarsler, dens skriveres seneste kørsler og de dataprodukter, den indgår i. Et navn, som flere databaser deler, besvares for hver af dem, så ingen får at vide, at den forkerte tabel er opdateret.
- **Et tjek ud fra en sætning.** På en tabels fane **Tjek** gør **Skriv et tjek ud fra en sætning** en regel til et tjek med brugerdefineret SQL i din motors SQL. Se [Kontroller og afstemninger](/docs/data-observability/checks).

- **Langsom drift.** En tabels rækker eller et tjeks værdi, der flytter sig med en femtedel eller mere på en uge, for langsomt til nogen advarsel, kommer til AI Insights som et kig-her. Den alarmerer ingen.
- **Forældede data bag AI-apps.** En tjeneste, der både kalder en model og læser en tabel, er tabellens AI-forbruger. Når sådan en tabel bliver forsinket, siger AI-produktets side **Samtaler** det: en app, der svarer ud fra gamle data, viser intet galt i sine egne spor.

Hver af disse kræver, at OneUptime AI er slået til for projektet, og handler med tilladelserne hos den person, der spørger.

## AI-agenter og MCP-serveren

AI-agenter bør tjekke, at data er opdaterede, før de bruger dem. [MCP-serveren](/docs/ai/mcp-server) har et skrivebeskyttet værktøj til det:

| Værktøj | Hvad det svarer på |
| --- | --- |
| `get_data_table_freshness` | Om en overvåget tabel er opdateret, hvornår den sidst blev ændret, dens åbne advarsler, dens skriveres seneste kørsler og dens dataprodukter. Angiv `table` som `schema.table`, tabellens navn alene eller dens ID |

Det virker med et skrivebeskyttet login og svarer som den person eller API-nøgle, der loggede ind.

## Endpoints

| Endpoint | Hvad det bruges til | Signeret med |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-hændelser fra Airflow, Dagster, Spark, dbt eller Flink | En indtagelsesnøgle til telemetri |
| `POST /telemetry/dbt/v1/artifacts` | Et dbt-builds `manifest` og `run_results` | En indtagelsesnøgle til telemetri |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetrans synkroniseringswebhooks | Indtagelsesnøglen som Fivetrans signeringshemmelighed |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbytes synkroniseringswebhooks | Indtagelsesnøglen i URL'en |
| `POST /api/data-observability/tables/freshness` | En tabels aktualitet, som MCP-værktøjet besvarer den, med `{ "table": "public.orders" }` | En API-nøgle |
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
