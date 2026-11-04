# OneUptime AI und die API

OneUptime AI kennt Ihre Daten: Sie untersucht eine Datenwarnung ausgehend von dem, was in die Tabelle schreibt, von ihren Läufen und ihren vorgelagerten Tabellen, beantwortet überall, wo danach gefragt wird, ob eine Tabelle aktuell ist, und schreibt eine Prüfung aus einer Regel, die in einem Satz formuliert ist. Alles, was Data Observability zeigt, steht auch Ihren eigenen Werkzeugen zur Verfügung, über ihre Endpunkte, ihre Metriken und den MCP-Server.

## OneUptime AI

- **Untersuchungen von Datenwarnungen.** Wenn OneUptime AI eine Warnung zu einer Tabelle, einer Pipeline oder einer Datenbank untersucht, beginnt sie bei dem, was daneben liegt: der Aktualität und den offenen Warnungen der Tabelle, der Warnung, deren Folge sie ist, den Läufen der Pipelines, die seit dem Vortag in sie schreiben (ein fehlgeschlagener Lauf mit seinem Fehler oder der Lauf, der nie kam), den Diensten, die in sie schreiben, mit ihren fehlgeschlagenen Schreibvorgängen, Deployments und anderen Änderungen, und den Tabellen, aus denen sie erstellt wird. Sie nennt den Lauf, das Deployment oder die vorgelagerte Tabelle hinter der Warnung. Siehe [AI SRE](/docs/ai/ai-sre).
- **Ist diese Tabelle aktuell?** Fragen Sie in [KI fragen](/docs/ai/ask-ai), Slack oder Microsoft Teams: „Ist die Tabelle orders aktuell?“. Die Antwort nennt die Aktualität der Tabelle gemessen an ihrem eigenen Rhythmus, wann sie sich zuletzt geändert hat, ihre offenen Warnungen, die letzten Läufe dessen, was in sie schreibt, und die Datenprodukte, zu denen sie gehört. Ein Name, den mehrere Datenbanken teilen, wird für jede einzeln beantwortet, damit niemandem gesagt wird, die falsche Tabelle sei aktuell.
- **Eine Prüfung aus einem Satz.** Im Tab **Prüfungen** einer Tabelle macht **Prüfung aus einem Satz schreiben** aus einer Regel eine Prüfung mit benutzerdefiniertem SQL im SQL Ihrer Engine. Siehe [Prüfungen und Abgleiche](/docs/data-observability/checks).

Für jede dieser Funktionen muss OneUptime AI für das Projekt eingeschaltet sein, und sie handelt mit den Berechtigungen der Person, die fragt.

## KI-Agenten und der MCP-Server

KI-Agenten sollten prüfen, ob Daten aktuell sind, bevor sie sie nutzen. Der [MCP-Server](/docs/ai/mcp-server) hat dafür ein schreibgeschütztes Werkzeug:

| Werkzeug | Was es beantwortet |
| --- | --- |
| `get_data_table_freshness` | Ob eine überwachte Tabelle aktuell ist, wann sie sich zuletzt geändert hat, ihre offenen Warnungen, die letzten Läufe dessen, was in sie schreibt, und ihre Datenprodukte. Geben Sie `table` als `schema.table`, nur als Namen der Tabelle oder als ihre ID an |

Es funktioniert mit einer schreibgeschützten Anmeldung und antwortet als die Person oder der API-Schlüssel, mit der oder dem die Anmeldung erfolgt ist.

## Endpunkte

| Endpunkt | Wofür er dient | Signiert mit |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage-Ereignisse von Airflow, Dagster, Spark, dbt oder Flink | Einem Ingestion-Schlüssel für Telemetrie |
| `POST /telemetry/dbt/v1/artifacts` | `manifest` und `run_results` eines dbt-Builds | Einem Ingestion-Schlüssel für Telemetrie |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Die Sync-Webhooks von Fivetran | Dem Ingestion-Schlüssel, als Signatur-Secret von Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Die Sync-Webhooks von Airbyte | Dem Ingestion-Schlüssel in der URL |
| `POST /api/data-observability/tables/freshness` | Die Aktualität einer Tabelle, wie das MCP-Werkzeug sie beantwortet, mit `{ "table": "public.orders" }` | Einem API-Schlüssel |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | Das Badge „data as of“ eines Datenprodukts | Dem eigenen Token des Badges |

Tabellen, Prüfungen, Abgleiche, Pipelines und Datenprodukte sind außerdem gewöhnliche Ressourcen der [API](/docs/api-reference/api-reference), die Sie mit einem API-Schlüssel mit den passenden Berechtigungen lesen und ändern.

## Metriken

Jede Zahl, die Data Observability führt, ist eine Metrik, die Sie darstellen, auf ein Dashboard setzen oder für Warnungen nutzen können: `oneuptime.data.table.*` für jede Tabelle, `oneuptime.data.check.value` für jede Prüfung, `oneuptime.data.reconciliation.*` für jeden Abgleich, `oneuptime.data.pipeline.*` für jede Pipeline und `oneuptime.data.product.*` für jedes Datenprodukt. Sie sind die eigenen Betriebsdaten von OneUptime und werden nicht als Telemetrie abgerechnet.

## Nächste Schritte

:::cards
- [MCP-Server](/docs/ai/mcp-server): Verbinden Sie einen KI-Agenten mit OneUptime.
- [Data Observability](/docs/data-observability/index): Zurück zur Übersicht.
:::
