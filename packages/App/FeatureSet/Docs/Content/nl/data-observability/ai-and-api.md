# OneUptime AI en de API

OneUptime AI kent je gegevens: het onderzoekt een gegevenswaarschuwing vanuit de schrijvers, uitvoeringen en stroomopwaartse tabellen van de tabel, beantwoordt overal waar het gevraagd wordt of een tabel actueel is, en schrijft een controle vanuit een regel die in één zin is verwoord. Alles wat Data-observability toont, is ook beschikbaar voor je eigen tools, via de endpoints, de metrieken en de MCP-server.

## OneUptime AI

- **Onderzoeken van gegevenswaarschuwingen.** Wanneer OneUptime AI een waarschuwing op een tabel, een pipeline of een database onderzoekt, begint het bij wat ernaast ligt: de actualiteit en openstaande waarschuwingen van de tabel, de waarschuwing waarvan ze een gevolg is, de uitvoeringen van de pipelines die ernaar schrijven sinds de dag ervoor (een mislukte uitvoering met haar fout, of de uitvoering die nooit kwam), de services die ernaar schrijven met hun mislukte schrijfacties, deploys en andere wijzigingen, de tabellen waaruit ze is opgebouwd, en de kolommen die zijn gewijzigd. Het noemt de uitvoering, deploy of stroomopwaartse tabel achter de waarschuwing. Zie [AI SRE](/docs/ai/ai-sre).
- **Is deze tabel actueel?** Vraag het in [AI vragen](/docs/ai/ask-ai), Slack of Microsoft Teams: "is de tabel orders actueel?". Het antwoord geeft de actualiteit van de tabel volgens haar eigen ritme, wanneer ze voor het laatst is gewijzigd, haar openstaande waarschuwingen, de laatste uitvoeringen van haar schrijvers en de dataproducten waar ze deel van uitmaakt. Een naam die meerdere databases delen, wordt voor elk ervan beantwoord, zodat niemand te horen krijgt dat de verkeerde tabel actueel is.
- **Een controle vanuit een zin.** Op het tabblad **Controles** van een tabel maakt **Een controle schrijven vanuit een zin** van een regel een controle met aangepaste SQL in de SQL van je engine. Zie [Controles en reconciliaties](/docs/data-observability/checks).

- **Langzame drift.** Rijen van een tabel, of de waarde van een controle, die in een week met een vijfde of meer verschuiven, te langzaam voor een waarschuwing, gaan als aandachtspunt naar AI Insights. Het roept niemand op.
- **Verouderde gegevens achter AI-apps.** Een service die zowel een model aanroept als een tabel leest, is de AI-consument van die tabel. Wanneer zo'n tabel te laat is, zegt de pagina **Gesprekken** van het AI-product dat: een app die antwoordt vanuit oude gegevens, toont niets verkeerds in haar eigen traces.

Voor elk hiervan moet OneUptime AI voor het project aan staan, en elk handelt met de machtigingen van degene die de vraag stelt.

## AI-agents en de MCP-server

AI-agents horen te controleren of gegevens actueel zijn voordat ze die gebruiken. De [MCP-server](/docs/ai/mcp-server) heeft daar een alleen-lezen tool voor:

| Tool | Wat het beantwoordt |
| --- | --- |
| `get_data_table_freshness` | Of een bewaakte tabel actueel is, wanneer ze voor het laatst is gewijzigd, haar openstaande waarschuwingen, de laatste uitvoeringen van haar schrijvers en haar dataproducten. Geef `table` op als `schema.table`, alleen de naam van de tabel, of haar ID |

Het werkt met een alleen-lezen aanmelding, en antwoordt als de persoon of API-sleutel die zich heeft aangemeld.

## Endpoints

| Endpoint | Waarvoor het is | Ondertekend met |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-gebeurtenissen van Airflow, Dagster, Spark, dbt of Flink | Een ingestiesleutel voor telemetrie |
| `POST /telemetry/dbt/v1/artifacts` | De `manifest` en `run_results` van een dbt-build | Een ingestiesleutel voor telemetrie |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | De synchronisatiewebhooks van Fivetran | De ingestiesleutel, als ondertekeningsgeheim van Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | De synchronisatiewebhooks van Airbyte | De ingestiesleutel in de URL |
| `POST /api/data-observability/tables/freshness` | De actualiteit van een tabel, zoals de MCP-tool die beantwoordt, met `{ "table": "public.orders" }` | Een API-sleutel |
| `POST /api/data-observability/checks/apply` | Laat de controles van het project overeenkomen met een bestand, zoals `oneuptime data-checks apply` doet, met `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | Een API-sleutel |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | De badge "data as of" van een dataproduct | Het eigen token van de badge |

Tabellen, controles, reconciliaties, pipelines, dataproducten, BI-koppelingen en warehousetaken zijn ook gewone resources van de [API](/docs/api-reference/api-reference), die je leest en wijzigt met een API-sleutel die de bijbehorende machtigingen heeft, en van de MCP-server en workflows.

## Metrieken

Elk getal dat Data-observability bijhoudt, is een metriek die je in een grafiek kunt zetten, op een dashboard kunt plaatsen of waarop je kunt waarschuwen: `oneuptime.data.table.*` voor elke tabel, `oneuptime.data.check.value` voor elke controle, `oneuptime.data.reconciliation.*` voor elke reconciliatie, `oneuptime.data.pipeline.*` voor elke pipeline en `oneuptime.data.product.*` voor elk dataproduct. Het zijn de eigen operationele gegevens van OneUptime, en ze worden niet als telemetrie gefactureerd.

## Volgende stappen

:::cards
- [MCP-server](/docs/ai/mcp-server): Koppel een AI-agent aan OneUptime.
- [Data-observability](/docs/data-observability/index): Terug naar het overzicht.
:::
