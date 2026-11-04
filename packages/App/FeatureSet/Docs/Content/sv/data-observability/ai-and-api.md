# OneUptime AI och API:t

OneUptime AI känner dina data: den utreder ett datalarm utifrån tabellens skrivare, körningar och uppströms tabeller, svarar på om en tabell är aktuell var frågan än ställs, och skriver en kontroll utifrån en regel som uttrycks i en mening. Allt som Dataobserverbarhet visar finns också tillgängligt för dina egna verktyg, via dess endpoints, dess mätvärden och MCP-servern.

## OneUptime AI

- **Utredningar av datalarm.** När OneUptime AI utreder ett larm på en tabell, en pipeline eller en databas utgår den från det som ligger intill: tabellens aktualitet och öppna larm, larmet som det är en följd av, körningarna av de pipelines som skriver till den sedan dagen innan (en misslyckad körning med sitt fel, eller körningen som aldrig kom), de tjänster som skriver till den med deras misslyckade skrivningar, driftsättningar och andra ändringar, de tabeller den byggs av och de kolumner som ändrades. Den pekar ut körningen, driftsättningen eller den uppströms tabell som ligger bakom larmet. Se [AI SRE](/docs/ai/ai-sre).
- **Är den här tabellen aktuell?** Fråga i [Fråga AI](/docs/ai/ask-ai), Slack eller Microsoft Teams: "är tabellen orders aktuell?". Svaret ger tabellens aktualitet utifrån dess egen rytm, när den senast ändrades, dess öppna larm, dess skrivares senaste körningar och de dataprodukter den ingår i. Ett namn som flera databaser delar besvaras för var och en, så att ingen får höra att fel tabell är aktuell.
- **En kontroll utifrån en mening.** På en tabells flik **Kontroller** gör **Skriv en kontroll utifrån en mening** en regel till en kontroll med anpassad SQL i din motors SQL. Se [Kontroller och avstämningar](/docs/data-observability/checks).
- **Långsam avvikelse.** En tabells rader, eller en kontrolls värde, som rör sig med en femtedel eller mer på en vecka, för långsamt för något larm, går till AI Insights som en titta-här. Den larmar ingen.
- **Inaktuella data bakom AI-appar.** En tjänst som både anropar en modell och läser en tabell är den tabellens AI-konsument. När en sådan tabell blir sen säger sidan **Konversationer** i AI-produkten det: en app som svarar utifrån gamla data visar inget fel i sina egna spår.

Var och en av dessa kräver att OneUptime AI är påslaget för projektet, och agerar med behörigheterna hos den som frågar.

## AI-agenter och MCP-servern

AI-agenter bör kontrollera att data är aktuella innan de använder dem. [MCP-servern](/docs/ai/mcp-server) har ett verktyg med enbart läsbehörighet för det:

| Verktyg | Vad det svarar på |
| --- | --- |
| `get_data_table_freshness` | Om en övervakad tabell är aktuell, när den senast ändrades, dess öppna larm, dess skrivares senaste körningar och dess dataprodukter. Ange `table` som `schema.table`, enbart tabellens namn, eller dess ID |

Det fungerar med en inloggning med enbart läsbehörighet, och svarar som den person eller API-nyckel som loggade in.

## Endpoints

| Endpoint | Vad den är till för | Signerad med |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-händelser från Airflow, Dagster, Spark, dbt eller Flink | En intagningsnyckel för telemetri |
| `POST /telemetry/dbt/v1/artifacts` | En dbt-builds `manifest` och `run_results` | En intagningsnyckel för telemetri |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetrans synkroniseringswebhooks | Intagningsnyckeln, som Fivetrans signeringshemlighet |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbytes synkroniseringswebhooks | Intagningsnyckeln i URL:en |
| `POST /api/data-observability/tables/freshness` | En tabells aktualitet, som MCP-verktyget besvarar den, med `{ "table": "public.orders" }` | En API-nyckel |
| `POST /api/data-observability/checks/apply` | Gör projektets kontroller likadana som en fil, som `oneuptime data-checks apply` gör, med `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | En API-nyckel |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | En dataprodukts "data as of"-märke | Märkets egen token |

Tabeller, kontroller, avstämningar, pipelines, dataprodukter, BI-anslutningar och lagerjobb är också vanliga resurser i [API:t](/docs/api-reference/api-reference), som läses och ändras med en API-nyckel som har motsvarande behörigheter, och i MCP-servern och arbetsflöden.

## Mätvärden

Varje tal som Dataobserverbarhet sparar är ett mätvärde som du kan visa i ett diagram, lägga på en instrumentpanel eller larma på: `oneuptime.data.table.*` för varje tabell, `oneuptime.data.check.value` för varje kontroll, `oneuptime.data.reconciliation.*` för varje avstämning, `oneuptime.data.pipeline.*` för varje pipeline och `oneuptime.data.product.*` för varje dataprodukt. De är OneUptimes egna driftdata och debiteras inte som telemetri.

## Nästa steg

:::cards
- [MCP-server](/docs/ai/mcp-server): Anslut en AI-agent till OneUptime.
- [Dataobserverbarhet](/docs/data-observability/index): Tillbaka till översikten.
:::
