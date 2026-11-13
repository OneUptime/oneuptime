# OneUptime AI en de API

OneUptime AI kent je gegevens: het onderzoekt een gegevenswaarschuwing vanuit de schrijvers, uitvoeringen en herkomst van de tabel, beantwoordt overal waar het gevraagd wordt of een tabel actueel is en waaruit ze is opgebouwd, en schrijft een controle vanuit een regel die in één zin is verwoord. Alles wat Data-observability toont, is ook beschikbaar voor je eigen tools, via de endpoints, de metrieken en de MCP-server.

## OneUptime AI

- **Onderzoeken van gegevenswaarschuwingen.** Wanneer OneUptime AI een waarschuwing op een tabel, een pipeline of een database onderzoekt, begint het bij wat ernaast ligt: de actualiteit en openstaande waarschuwingen van de tabel, de waarschuwing waarvan ze een gevolg is, de uitvoeringen van de pipelines die ernaar schrijven sinds de dag ervoor (een mislukte uitvoering met haar fout, of de uitvoering die nooit kwam), de services die ernaar schrijven met hun mislukte schrijfacties, deploys en andere wijzigingen, haar herkomst (de tabellen waaruit ze is opgebouwd en de tabellen die uit haar zijn opgebouwd, die met een probleem eerst, waar daarin de waarschuwing ligt waarvan ze een gevolg is, en op welke tabellen de waarschuwingen liggen die ze veroorzaakte), en de kolommen die zijn gewijzigd. Bij een waarschuwing uit een controle op één kolom volgt het die kolom ook door de herkomst: de stroomopwaartse kolommen waaruit ze is opgebouwd en de stroomafwaartse kolommen die uit haar zijn opgebouwd, tabel voor tabel, zoals de bronnen van de herkomst ze noemen. Het noemt de uitvoering, deploy of stroomopwaartse tabel achter de waarschuwing. Zie [AI SRE](/docs/ai/ai-sre).
- **Is deze tabel actueel?** Vraag het in [AI vragen](/docs/ai/ask-ai), Slack of Microsoft Teams: "is de tabel orders actueel?". Het antwoord geeft de actualiteit van de tabel volgens haar eigen ritme, wanneer ze voor het laatst is gewijzigd, haar openstaande waarschuwingen, de laatste uitvoeringen van haar schrijvers en de dataproducten waar ze deel van uitmaakt. Een naam die meerdere databases delen, wordt voor elk ervan beantwoord, zodat niemand te horen krijgt dat de verkeerde tabel actueel is.
- **Waaruit is deze tabel opgebouwd?** Vraag "wat voedt de tabel revenue?" of "wat gaat er mis als raw.orders niet meer laadt?". Het antwoord volgt de herkomst van de tabel drie stappen in elke richting, of tot vijf als je erom vraagt, en zet wat er mis is voorop: de stroomopwaartse en stroomafwaartse tabellen die te laat zijn, verwijderd zijn, openstaande waarschuwingen hebben of waarvan de pipeline bij de laatste uitvoering mislukte, de dichtstbijzijnde eerst, elk met hoeveel stappen ze verwijderd is en de tabellen ertussen. Daarna komen de overige, de pipelines die haar bronnen laden van buiten wat OneUptime bewaakt, en de BI-dashboards die erop zijn gebouwd. Openstaande waarschuwingen worden geteld, nooit genoemd, en alleen die de persoon die het vraagt mag zien.
- **Een controle vanuit een zin.** Op het tabblad **Controles** van een tabel maakt **Een controle schrijven vanuit een zin** van een regel een controle met aangepaste SQL in de SQL van je engine. Zie [Controles en reconciliaties](/docs/data-observability/checks).

- **Langzame drift.** Rijen van een tabel, of de waarde van een controle, die in een week met een vijfde of meer verschuiven, te langzaam voor een waarschuwing, gaan als aandachtspunt naar AI Insights. Het roept niemand op.
- **Verouderde gegevens achter AI-apps.** Een service die zowel een model aanroept als een tabel leest, is de AI-consument van die tabel. Wanneer zo'n tabel te laat is, zegt de pagina **Gesprekken** van het AI-product dat: een app die antwoordt vanuit oude gegevens, toont niets verkeerds in haar eigen traces.

Voor elk hiervan moet OneUptime AI voor het project aan staan, en elk handelt met de machtigingen van degene die de vraag stelt.

## AI-agents en de MCP-server

AI-agents horen te controleren of gegevens actueel zijn voordat ze die gebruiken, en wat er uit een tabel is opgebouwd voordat ze die wijzigen. De [MCP-server](/docs/ai/mcp-server) heeft voor beide alleen-lezen tools:

| Tool | Wat het beantwoordt |
| --- | --- |
| `get_data_table_freshness` | Of een bewaakte tabel actueel is, wanneer ze voor het laatst is gewijzigd, haar openstaande waarschuwingen, de laatste uitvoeringen van haar schrijvers en haar dataproducten. Geef `table` op als `schema.table`, alleen de naam van de tabel, of haar ID |
| `get_data_table_lineage` | Waaruit een bewaakte tabel is opgebouwd en wat er uit haar is opgebouwd, drie stappen in elke richting of tot vijf: de tabellen met een probleem eerst, de dichtstbijzijnde eerst, dan de overige, de pipelines die haar bronnen van buiten laden en de BI-dashboards die erop zijn gebouwd. Geef `table` op zoals voor haar actualiteit, en `depth` van 1 tot 5 |

Beide werken met een alleen-lezen aanmelding, en antwoorden als de persoon of API-sleutel die zich heeft aangemeld.

## Endpoints

| Endpoint | Waarvoor het is | Ondertekend met |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-gebeurtenissen van Airflow, Dagster, Spark, dbt of Flink | Een ingestiesleutel voor telemetrie |
| `POST /telemetry/dbt/v1/artifacts` | De `manifest` en `run_results` van een dbt-build | Een ingestiesleutel voor telemetrie |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | De synchronisatiewebhooks van Fivetran | De ingestiesleutel, als ondertekeningsgeheim van Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | De synchronisatiewebhooks van Airbyte | De ingestiesleutel in de URL |
| `POST /api/data-observability/tables/freshness` | De actualiteit van een tabel, zoals de MCP-tool die beantwoordt, met `{ "table": "public.orders" }` | Een API-sleutel |
| `POST /api/data-observability/tables/lineage` | De herkomst van een tabel een paar stappen in elke richting, met hoe elke tabel er nu voor staat, zoals het tabblad **Herkomst** die tekent, met `{ "dataAssetId": "<table ID>", "depth": 3 }`, en met `"withColumns": true` de kolommen die elke pijl draagt | Een API-sleutel |
| `POST /api/data-observability/tables/lineage/answer` | De herkomst van een tabel in woorden verteld, de tabellen met een probleem eerst, zoals de MCP-tool die beantwoordt, met `{ "table": "public.orders", "depth": 3 }` | Een API-sleutel |
| `POST /api/data-observability/pipelines/lineage` | De tabellen die een pipeline leest en schrijft, met hoe elke tabel er nu voor staat, zoals zijn pagina ze tekent, met `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | Een API-sleutel |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | De herkomst van een gegevenswaarschuwing, zoals haar pagina die tekent, met de weg naar de waarschuwing die haar veroorzaakte en naar de waarschuwingen die ze veroorzaakte, en bij een waarschuwing uit een controle op één kolom haar `column` en de kolommen die elke pijl draagt | Een API-sleutel |
| `POST /api/data-observability/lineage/expand` | De volgende tabellen die een kaart van een herkomstdiagram niet tekent, zoals het selecteren van haar getal ze tekent: de kaart als `nodeId` met haar `side`, en wat getekend is als `focusNodeId`, `tables` en `dataDashboardIds` | Een API-sleutel |
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
