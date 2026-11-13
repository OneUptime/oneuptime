# OneUptime AI och API:t

OneUptime AI känner dina data: den utreder ett datalarm utifrån tabellens skrivare, körningar och härkomst, svarar på om en tabell är aktuell och vad den byggs av var frågan än ställs, och skriver en kontroll utifrån en regel som uttrycks i en mening. Allt som Dataobserverbarhet visar finns också tillgängligt för dina egna verktyg, via dess endpoints, dess mätvärden och MCP-servern.

## OneUptime AI

- **Utredningar av datalarm.** När OneUptime AI utreder ett larm på en tabell, en pipeline eller en databas utgår den från det som ligger intill: tabellens aktualitet och öppna larm, larmet som det är en följd av, körningarna av de pipelines som skriver till den sedan dagen innan (en misslyckad körning med sitt fel, eller körningen som aldrig kom), de tjänster som skriver till den med deras misslyckade skrivningar, driftsättningar och andra ändringar, dess härkomst (de tabeller den byggs av och de tabeller som byggs av den, de med ett problem först, var i den larmet som det är en följd av ligger, och vilka tabeller larmen som det orsakade ligger på) och de kolumner som ändrades. För ett larm från en kontroll av en enda kolumn följer den också den kolumnen genom härkomsten: kolumnerna uppströms som den byggs av och kolumnerna nedströms som byggs av den, tabell för tabell, så som härkomstens källor namnger dem. Den pekar ut körningen, driftsättningen eller den uppströms tabell som ligger bakom larmet. Se [AI SRE](/docs/ai/ai-sre).
- **Är den här tabellen aktuell?** Fråga i [Fråga AI](/docs/ai/ask-ai), Slack eller Microsoft Teams: "är tabellen orders aktuell?". Svaret ger tabellens aktualitet utifrån dess egen rytm, när den senast ändrades, dess öppna larm, dess skrivares senaste körningar och de dataprodukter den ingår i. Ett namn som flera databaser delar besvaras för var och en, så att ingen får höra att fel tabell är aktuell.
- **Vad byggs den här tabellen av?** Fråga "vad matar tabellen revenue?" eller "vad går sönder om raw.orders slutar laddas?". Svaret följer tabellens härkomst tre steg åt varje håll, eller upp till fem när du ber om det, och sätter det som är fel först: de uppströms och nedströms tabeller som är sena, borttagna, har öppna larm eller vars pipeline misslyckades vid sin senaste körning, de närmaste först, var och en med hur många steg bort den är och tabellerna emellan. Sedan kommer resten, de pipelines som laddar dess källor utifrån det OneUptime bevakar, och de BI-instrumentpaneler som byggs på den. Öppna larm räknas, nämns aldrig vid namn, och bara de som personen som frågar får se.
- **En kontroll utifrån en mening.** På en tabells flik **Kontroller** gör **Skriv en kontroll utifrån en mening** en regel till en kontroll med anpassad SQL i din motors SQL. Se [Kontroller och avstämningar](/docs/data-observability/checks).
- **Långsam avvikelse.** En tabells rader, eller en kontrolls värde, som rör sig med en femtedel eller mer på en vecka, för långsamt för något larm, går till AI Insights som en titta-här. Den larmar ingen.
- **Inaktuella data bakom AI-appar.** En tjänst som både anropar en modell och läser en tabell är den tabellens AI-konsument. När en sådan tabell blir sen säger sidan **Konversationer** i AI-produkten det: en app som svarar utifrån gamla data visar inget fel i sina egna spår.

Var och en av dessa kräver att OneUptime AI är påslaget för projektet, och agerar med behörigheterna hos den som frågar.

## AI-agenter och MCP-servern

AI-agenter bör kontrollera att data är aktuella innan de använder dem, och vad som byggs av en tabell innan de ändrar den. [MCP-servern](/docs/ai/mcp-server) har verktyg med enbart läsbehörighet för båda:

| Verktyg | Vad det svarar på |
| --- | --- |
| `get_data_table_freshness` | Om en övervakad tabell är aktuell, när den senast ändrades, dess öppna larm, dess skrivares senaste körningar och dess dataprodukter. Ange `table` som `schema.table`, enbart tabellens namn, eller dess ID |
| `get_data_table_lineage` | Vad en övervakad tabell byggs av och vad som byggs av den, tre steg åt varje håll eller upp till fem: tabellerna med ett problem först, de närmaste först, sedan resten, de pipelines som laddar dess källor utifrån och de BI-instrumentpaneler som byggs på den. Ange `table` som för dess aktualitet, och `depth` från 1 till 5 |

Båda fungerar med en inloggning med enbart läsbehörighet, och svarar som den person eller API-nyckel som loggade in.

## Endpoints

| Endpoint | Vad den är till för | Signerad med |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-händelser från Airflow, Dagster, Spark, dbt eller Flink | En intagningsnyckel för telemetri |
| `POST /telemetry/dbt/v1/artifacts` | En dbt-builds `manifest` och `run_results` | En intagningsnyckel för telemetri |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetrans synkroniseringswebhooks | Intagningsnyckeln, som Fivetrans signeringshemlighet |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbytes synkroniseringswebhooks | Intagningsnyckeln i URL:en |
| `POST /api/data-observability/tables/freshness` | En tabells aktualitet, som MCP-verktyget besvarar den, med `{ "table": "public.orders" }` | En API-nyckel |
| `POST /api/data-observability/tables/lineage` | En tabells härkomst några steg åt varje håll, med hur varje tabell står till nu, som fliken **Härkomst** ritar den, med `{ "dataAssetId": "<table ID>", "depth": 3 }`, och med `"withColumns": true` kolumnerna som varje pil bär | En API-nyckel |
| `POST /api/data-observability/tables/lineage/answer` | En tabells härkomst berättad i ord, tabellerna med ett problem först, som MCP-verktyget svarar, med `{ "table": "public.orders", "depth": 3 }` | En API-nyckel |
| `POST /api/data-observability/pipelines/lineage` | De tabeller en pipeline läser och skriver, med hur varje tabell står till nu, som dess sida ritar dem, med `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | En API-nyckel |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | Ett datalarms härkomst, som dess sida ritar den, med vägen till larmet som orsakade det och till larmen det orsakade, och för ett larm från en kontroll av en enda kolumn dess `column` och de kolumner som varje pil bär | En API-nyckel |
| `POST /api/data-observability/lineage/expand` | De nästa tabeller som ett kort i ett härkomstdiagram inte ritar, så som ett val av dess tal ritar dem: kortet som `nodeId` med sin `side`, och det som är ritat som `focusNodeId`, `tables` och `dataDashboardIds` | En API-nyckel |
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
