# OneUptime AI und die API

OneUptime AI kennt Ihre Daten: Sie untersucht eine Datenwarnung ausgehend von dem, was in die Tabelle schreibt, von ihren Läufen und ihrer Datenherkunft, beantwortet überall, wo danach gefragt wird, ob eine Tabelle aktuell ist und woraus sie erstellt wird, und schreibt eine Prüfung aus einer Regel, die in einem Satz formuliert ist. Alles, was Data Observability zeigt, steht auch Ihren eigenen Werkzeugen zur Verfügung, über ihre Endpunkte, ihre Metriken und den MCP-Server.

## OneUptime AI

- **Untersuchungen von Datenwarnungen.** Wenn OneUptime AI eine Warnung zu einer Tabelle, einer Pipeline oder einer Datenbank untersucht, beginnt sie bei dem, was daneben liegt: der Aktualität und den offenen Warnungen der Tabelle, der Warnung, deren Folge sie ist, den Läufen der Pipelines, die seit dem Vortag in sie schreiben (ein fehlgeschlagener Lauf mit seinem Fehler oder der Lauf, der nie kam), den Diensten, die in sie schreiben, mit ihren fehlgeschlagenen Schreibvorgängen, Deployments und anderen Änderungen, ihrer Datenherkunft (den Tabellen, aus denen sie erstellt wird, und den Tabellen, die aus ihr erstellt werden, die mit einem Problem zuerst, wo darin die Warnung liegt, deren Folge sie ist, und auf welchen Tabellen die Warnungen liegen, die sie ausgelöst hat) und den Spalten, die sich geändert haben. Sie nennt den Lauf, das Deployment oder die vorgelagerte Tabelle hinter der Warnung. Siehe [AI SRE](/docs/ai/ai-sre).
- **Ist diese Tabelle aktuell?** Fragen Sie in [KI fragen](/docs/ai/ask-ai), Slack oder Microsoft Teams: „Ist die Tabelle orders aktuell?“. Die Antwort nennt die Aktualität der Tabelle gemessen an ihrem eigenen Rhythmus, wann sie sich zuletzt geändert hat, ihre offenen Warnungen, die letzten Läufe dessen, was in sie schreibt, und die Datenprodukte, zu denen sie gehört. Ein Name, den mehrere Datenbanken teilen, wird für jede einzeln beantwortet, damit niemandem gesagt wird, die falsche Tabelle sei aktuell.
- **Woraus wird diese Tabelle erstellt?** Fragen Sie „Was speist die Tabelle revenue?“ oder „Was bricht, wenn raw.orders nicht mehr geladen wird?“. Die Antwort folgt der Datenherkunft der Tabelle drei Schritte in jede Richtung, auf Wunsch bis zu fünf, und nennt zuerst, was nicht stimmt: die vor- und nachgelagerten Tabellen, die verspätet oder gelöscht sind, offene Warnungen haben oder deren Pipeline beim letzten Lauf fehlgeschlagen ist, die nächsten zuerst, jede mit der Zahl der Schritte bis zu ihr und den Tabellen dazwischen. Danach folgen die übrigen, die Pipelines, die ihre Quellen von außerhalb dessen laden, was OneUptime überwacht, und die BI-Dashboards, die auf ihr aufbauen. Offene Warnungen werden gezählt, nie genannt, und nur die, die die fragende Person sehen darf.
- **Eine Prüfung aus einem Satz.** Im Tab **Prüfungen** einer Tabelle macht **Prüfung aus einem Satz schreiben** aus einer Regel eine Prüfung mit benutzerdefiniertem SQL im SQL Ihrer Engine. Siehe [Prüfungen und Abgleiche](/docs/data-observability/checks).

- **Langsame Drift.** Verändern sich die Zeilen einer Tabelle oder der Wert einer Prüfung innerhalb einer Woche um ein Fünftel oder mehr, zu langsam für jede Warnung, geht das als Hinweis „Hier nachsehen“ an AI Insights. Es alarmiert niemanden.
- **Veraltete Daten hinter KI-Apps.** Ein Dienst, der sowohl ein Modell aufruft als auch eine Tabelle liest, ist der KI-Verbraucher dieser Tabelle. Wird eine solche Tabelle verspätet, sagt das die Seite **Unterhaltungen** des KI-Produkts: Eine App, die aus alten Daten antwortet, zeigt in ihren eigenen Traces nichts Falsches.

Für jede dieser Funktionen muss OneUptime AI für das Projekt eingeschaltet sein, und sie handelt mit den Berechtigungen der Person, die fragt.

## KI-Agenten und der MCP-Server

KI-Agenten sollten prüfen, ob Daten aktuell sind, bevor sie sie nutzen, und was aus einer Tabelle erstellt wird, bevor sie sie ändern. Der [MCP-Server](/docs/ai/mcp-server) hat für beides schreibgeschützte Werkzeuge:

| Werkzeug | Was es beantwortet |
| --- | --- |
| `get_data_table_freshness` | Ob eine überwachte Tabelle aktuell ist, wann sie sich zuletzt geändert hat, ihre offenen Warnungen, die letzten Läufe dessen, was in sie schreibt, und ihre Datenprodukte. Geben Sie `table` als `schema.table`, nur als Namen der Tabelle oder als ihre ID an |
| `get_data_table_lineage` | Woraus eine überwachte Tabelle erstellt wird und was aus ihr erstellt wird, drei Schritte in jede Richtung oder bis zu fünf: die Tabellen mit einem Problem zuerst, die nächsten zuerst, dann die übrigen, die Pipelines, die ihre Quellen von außerhalb laden, und die BI-Dashboards, die auf ihr aufbauen. Geben Sie `table` wie für ihre Aktualität an und `depth` von 1 bis 5 |

Beide funktionieren mit einer schreibgeschützten Anmeldung und antworten als die Person oder der API-Schlüssel, mit der oder dem die Anmeldung erfolgt ist.

## Endpunkte

| Endpunkt | Wofür er dient | Signiert mit |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-Ereignisse von Airflow, Dagster, Spark, dbt oder Flink | Einem Ingestion-Schlüssel für Telemetrie |
| `POST /telemetry/dbt/v1/artifacts` | `manifest` und `run_results` eines dbt-Builds | Einem Ingestion-Schlüssel für Telemetrie |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Die Sync-Webhooks von Fivetran | Dem Ingestion-Schlüssel, als Signatur-Secret von Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Die Sync-Webhooks von Airbyte | Dem Ingestion-Schlüssel in der URL |
| `POST /api/data-observability/tables/freshness` | Die Aktualität einer Tabelle, wie das MCP-Werkzeug sie beantwortet, mit `{ "table": "public.orders" }` | Einem API-Schlüssel |
| `POST /api/data-observability/tables/lineage` | Die Datenherkunft einer Tabelle einige Schritte in jede Richtung, mit dem Zustand jeder Tabelle, wie ihr Tab **Datenherkunft** sie zeichnet, mit `{ "dataAssetId": "<table ID>", "depth": 3 }`, und mit `"withColumns": true` die Spalten, die jeder Pfeil trägt | Einem API-Schlüssel |
| `POST /api/data-observability/tables/lineage/answer` | Die Datenherkunft einer Tabelle in Worten, die Tabellen mit einem Problem zuerst, wie das MCP-Werkzeug sie beantwortet, mit `{ "table": "public.orders", "depth": 3 }` | Einem API-Schlüssel |
| `POST /api/data-observability/pipelines/lineage` | Die Tabellen, die eine Pipeline liest und schreibt, mit dem Zustand jeder Tabelle, wie ihre Seite sie zeichnet, mit `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | Einem API-Schlüssel |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | Die Datenherkunft einer Datenwarnung, wie ihre Seite sie zeichnet, mit dem Weg zu der Warnung, die sie verursacht hat, und zu den Warnungen, die sie verursacht hat | Einem API-Schlüssel |
| `POST /api/data-observability/lineage/expand` | Die nächsten Tabellen, die eine Karte eines Datenherkunft-Diagramms nicht zeichnet, so wie das Auswählen ihrer Zahl sie zeichnet: die Karte als `nodeId` mit ihrer `side`, und was gezeichnet ist, als `focusNodeId`, `tables` und `dataDashboardIds` | Einem API-Schlüssel |
| `POST /api/data-observability/checks/apply` | Die Prüfungen des Projekts mit einer Datei in Übereinstimmung bringen, wie es `oneuptime data-checks apply` tut, mit `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | Einem API-Schlüssel |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | Das Badge „data as of“ eines Datenprodukts | Dem eigenen Token des Badges |

Tabellen, Prüfungen, Abgleiche, Pipelines, Datenprodukte, BI-Verbindungen und Warehouse-Jobs sind außerdem gewöhnliche Ressourcen der [API](/docs/api-reference/api-reference), die Sie mit einem API-Schlüssel mit den passenden Berechtigungen lesen und ändern, und des MCP-Servers und der Workflows.

## Metriken

Jede Zahl, die Data Observability führt, ist eine Metrik, die Sie darstellen, auf ein Dashboard setzen oder für Warnungen nutzen können: `oneuptime.data.table.*` für jede Tabelle, `oneuptime.data.check.value` für jede Prüfung, `oneuptime.data.reconciliation.*` für jeden Abgleich, `oneuptime.data.pipeline.*` für jede Pipeline und `oneuptime.data.product.*` für jedes Datenprodukt. Sie sind die eigenen Betriebsdaten von OneUptime und werden nicht als Telemetrie abgerechnet.

## Nächste Schritte

:::cards
- [MCP-Server](/docs/ai/mcp-server): Verbinden Sie einen KI-Agenten mit OneUptime.
- [Data Observability](/docs/data-observability/index): Zurück zur Übersicht.
:::
