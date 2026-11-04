# Lineage und Pipelines

Lineage sagt, aus welchen Tabellen jede Tabelle erstellt wird und welche Pipelines in sie schreiben. Data Observability sammelt sie aus fünf Quellen zugleich - OpenLineage-Ereignissen, dbt, Syncs von Fivetran und Airbyte, Views und dem eigenen Abfrageverlauf jeder Datenbank - und nutzt sie, um jede verspätete oder fehlerhafte Tabelle mit dem Lauf dahinter zu verknüpfen, sodass ein Problem nur eine Meldung erzeugt.

## Woher die Lineage kommt

| Quelle | Was sie liefert |
| --- | --- |
| **OpenLineage** | Jeden Lauf eines Airflow-, Dagster-, Spark-, dbt- oder Flink-Jobs, mit den Tabellen, die er gelesen und geschrieben hat |
| **dbt** | Woraus jedes Modell erstellt wird, jeden Build als Lauf und das Ergebnis jedes Tests |
| **Fivetran und Airbyte** | Jeden Sync als Lauf seines Connectors, und die Rohtabellen, die er lädt |
| **Views** | Eine View wird aus den Tabellen erstellt, auf denen sie definiert ist (PostgreSQL, Redshift, MySQL 8, SQL Server, materialisierte Views von ClickHouse, Databricks) |
| **Abfrageverlauf** | Eine Abfrage, die eine Tabelle gelesen und eine andere geschrieben hat (die Jobs von BigQuery, das Abfrageprotokoll von Redshift, das Abfrageprotokoll von ClickHouse, die Lineage-Tabelle von Databricks) |

Der Tab **Datenherkunft** einer Tabelle zeigt die Tabellen, aus denen sie erstellt wird, die Pipelines, die in sie schreiben, mit ihrem letzten Lauf, und die Tabellen, die aus ihr erstellt werden. Jede Kante sagt, wo sie gesehen wurde.

## OpenLineage

Senden Sie OpenLineage-Ereignisse unverändert an OneUptime, mit einem [Ingestion-Schlüssel](/docs/telemetry/ingestion-keys) für Telemetrie:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (bei einem selbst gehosteten OneUptime Ihre eigene Adresse)
- **Endpunkt:** `api/v1/lineage`, der Standard von OpenLineage
- **API-Schlüssel:** der Ingestion-Schlüssel, gesendet als `Authorization: Bearer`, oder setzen Sie `x-oneuptime-token`

Für den OpenLineage-Provider von Airflow:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

Setzen Sie für jeden anderen OpenLineage-Client `OPENLINEAGE_URL` und `OPENLINEAGE_API_KEY`. Datasets werden nach der Namenskonvention von OpenLineage Tabellen zugeordnet, etwa `postgres://host:5432` mit `database.schema.table`, `snowflake://account` mit `database.schema.table`, `clickhouse://host:8443` mit `database.table` und `databricks://workspace-host` mit `catalog.schema.table`.

## dbt

Senden Sie nach `dbt build` (oder run, test, seed oder snapshot) die Artefakte des Projekts mit der [OneUptime-CLI](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

Führen Sie in der CI `oneuptime dbt upload` als Schritt nach dem Build aus, auch wenn der Build fehlschlägt, damit fehlgeschlagene Tests erfasst werden. Jede Tabelle, die dbt erstellt, erhält eine Karte **dbt** in ihrer Übersicht, die Lineage ihrer Modelle und ihre Tests im Tab **Prüfungen**; jeder Build ist ein Lauf der Pipeline des Projekts.

## Fivetran und Airbyte

Ihre Webhooks melden, wann jeder Sync beginnt und endet. **Pipelines > Fivetran oder Airbyte verbinden** füllt die URLs mit einem Ihrer Ingestion-Schlüssel aus:

- **Fivetran:** ein mit der REST-API von Fivetran angelegter Webhook für die Ereignisse `sync_start` und `sync_end` an `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, mit dem Ingestion-Schlüssel als Secret. Fivetran signiert jede Zustellung damit, sodass der Schlüssel nie in der URL mitgeschickt wird.
- **Airbyte:** der Webhook des Workspace, gesetzt auf `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, eingeschaltet für fehlgeschlagene und erfolgreiche Syncs. Geben Sie Airbyte einen eigenen Schlüssel.

Ein Fivetran-Sync, der wegen des Rate Limits einer API neu angesetzt wird, endet als **Neu geplant**: kein Fehlschlag, also alarmiert er niemanden.

## Pipelines

Jeder Job, jedes dbt-Projekt und jeder Sync erscheint unter **Pipelines**, mit seinen Läufen: wann jeder begann und endete, wie lange er dauerte und der Fehler eines fehlgeschlagenen Laufs. Jede Pipeline lernt nach fünf Läufen aus ihren eigenen Läufen, wie lange ein Lauf üblicherweise dauert und wie viel Zeit nach ihrem Zeitplan zwischen zwei Läufen vergeht. Die Seite einer Pipeline empfiehlt drei Monitore:

- **Pipeline Run Failed**: Ein Lauf ist fehlgeschlagen oder wurde abgebrochen.
- **Pipeline Run Unusually Long**: Ein Lauf dauert doppelt so lange wie üblich oder länger, geprüft alle fünf Minuten, während er läuft, sodass ein hängender Lauf erkannt wird, bevor er endet.
- **Pipeline Is Late**: Seit längerer Zeit, als ihr Zeitplan erlaubt, hat kein Lauf begonnen.

## Eine Meldung pro Ursache

Veraltet eine Tabelle, veralten auch alle Tabellen, die aus ihr erstellt werden. Bevor sich eine Datenwarnung öffnet, sucht OneUptime in der Lineage nach einer bereits offenen Warnung zu dem, woraus ihre Tabelle oder Pipeline erstellt wird: den vorgelagerten Tabellen, den Pipelines, die in sie schreiben, und den Datenbanken, in denen sie liegen, bis zu fünf Stufen aufwärts. Findet es eine, ist die neue Warnung die Folge dieser Warnung:

- Sie beginnt im Zustand **Bestätigt**, sodass niemand für ein Problem zweimal alarmiert wird, und erholt sich von selbst, sobald ihre Daten es tun.
- Ihr Feed und ihre Karte **Daten** sagen, welche Warnung sie verursacht hat, und sie schließt sich der Episode der Ursache an.

Die Karte **Daten** der Ursache listet ihren **Downstream Impact** auf: jede Warnung, die sie verursacht hat. Die Karte einer Tabellenwarnung zeigt außerdem die Dienste, die in die Tabelle schreiben, mit ihren fehlgeschlagenen Schreibvorgängen sowie ihren Deployments und anderen Änderungen am Tag vor der Warnung.

## Nächste Schritte

:::cards
- [Datenprodukte](/docs/data-observability/data-products): Aktualitäts-SLAs für die Tabellen, die Menschen nutzen.
- [OneUptime AI und die API](/docs/data-observability/ai-and-api): Untersuchungen, die bei dem beginnen, was in eine Tabelle schreibt, und bei ihren Läufen.
:::
