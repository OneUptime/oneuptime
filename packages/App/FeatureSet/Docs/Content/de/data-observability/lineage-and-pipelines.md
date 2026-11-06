# Lineage und Pipelines

Lineage sagt, aus welchen Tabellen jede Tabelle erstellt wird und welche Pipelines in sie schreiben. Data Observability sammelt sie aus sechs Quellen zugleich - OpenLineage-Ereignissen, dbt, Syncs von Fivetran und Airbyte, Jobs in Ihren Traces, Views und dem eigenen Abfrageverlauf jeder Datenbank - und nutzt sie, um jede verspätete oder fehlerhafte Tabelle mit dem Lauf dahinter zu verknüpfen, sodass ein Problem nur eine Meldung erzeugt.

## Woher die Lineage kommt

| Quelle | Was sie liefert |
| --- | --- |
| **OpenLineage** | Jeden Lauf eines Airflow-, Dagster-, Spark-, dbt- oder Flink-Jobs, mit den Tabellen, die er gelesen und geschrieben hat |
| **dbt** | Woraus jedes Modell erstellt wird, jeden Build als Lauf und das Ergebnis jedes Tests |
| **Fivetran und Airbyte** | Jeden Sync als Lauf seines Connectors, und die Rohtabellen, die er lädt |
| **Jobs in Ihren Traces** | Ein Kubernetes CronJob oder eine zeitgesteuerte Funktion, ihre Läufe und die Tabellen, die ihre Datenbankaufrufe gelesen und geschrieben haben |
| **Views** | Eine View wird aus den Tabellen erstellt, auf denen sie definiert ist (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, materialisierte Views von ClickHouse, Databricks, MongoDB) |
| **Abfrageverlauf** | Eine Abfrage, die eine Tabelle gelesen und eine andere geschrieben hat (der Zugriffsverlauf von Snowflake, die Jobs von BigQuery, das Abfrageprotokoll von Redshift, das Abfrageprotokoll von ClickHouse, die Lineage-Tabelle von Databricks) |

Der Tab **Datenherkunft** einer Tabelle zeigt die Tabellen, aus denen sie erstellt wird, die Pipelines, die in sie schreiben, mit ihrem letzten Lauf, und die Tabellen, die aus ihr erstellt werden. Jede Kante sagt, wo sie gesehen wurde.

Wo die Quelle Spalten nennt, sagt der Tab **Spalten** einer Tabelle, woher jede Spalte kommt und was sie speist: der Zugriffsverlauf von Snowflake (Enterprise-Edition, die `IMPORTED PRIVILEGES` auf der Datenbank `SNOWFLAKE` braucht) und das Facet `columnLineage` von OpenLineage.

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

## Jobs in Ihren Traces

Viele Pipelines sind ein Kubernetes CronJob oder eine Funktion auf einem Timer, ohne Scheduler, der Lineage sendet. Ihre Traces sagen trotzdem alles, ohne dass etwas zu installieren wäre. Alle fünfzehn Minuten werden Spans mit dem Ressourcenattribut `k8s.cronjob.name` oder `k8s.job.name`, oder `faas.name` mit einem `faas.trigger` von `timer` oder `datasource`, zu einer Pipeline unter **Pipelines**:

- Ein Lauf eines CronJobs ist sein Kubernetes Job, und ein Lauf einer Funktion ist ihre `faas.invocation_id`.
- Ein Lauf ist fehlgeschlagen, wenn der Span an der Spitze seines Traces fehlgeschlagen ist. Ein Aufruf, der darin fehlgeschlagen ist und wiederholt wurde, lässt ihn nicht fehlschlagen.
- Die Tabellen, die er geschrieben und gelesen hat, stammen aus seinen Datenbank-Spans.

Jeder Lauf verweist auf seinen Trace, mit seinen Protokollen. Es gelten dieselben drei Monitore, sodass ein CronJob, der nicht mehr läuft, als verspätet erkannt wird.

## Dashboards in BI-Tools

Die eigentliche Folge schlechter Daten ist das Dashboard, das jemand öffnet. Fügen Sie unter **BI-Dashboards** Ihre BI-Tools mit Zugangsdaten hinzu, die deren Dashboards lesen dürfen. Jede Stunde liest Data Observability jedes Dashboard und die Tabellen dahinter, ordnet jede Tabelle einer überwachten zu und zeigt die Dashboards, die auf einer Tabelle und auf den daraus erstellten Tabellen aufbauen, auf ihrem Tab **Datenherkunft**, an ihren Alarmen und im Production Review.

| Tool | Zugangsdaten |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, ein Service Principal, der die Admin-APIs von Power BI verwenden darf |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (oder `eu`) |

Hightouch und Census sind Reverse-ETL-Werkzeuge: Ein Sync, der eine Tabelle in ein CRM kopiert, hängt von dieser Tabelle ab wie ein Dashboard, wird also auf dieselbe Weise gelesen und bei den Warnungen der Tabelle genannt.

Gelesen werden nur die Namen und Links der Dashboards und die Tabellen, die sie abfragen: nie ihre Daten.

## Pipelines

Jeder Job, jedes dbt-Projekt und jeder Sync erscheint unter **Pipelines**, mit seinen Läufen: wann jeder begann und endete, wie lange er dauerte, der wievielte Versuch er war, wo der Scheduler das sagt (die Try-Nummer von Airflow), und der Fehler eines fehlgeschlagenen Laufs. Jede Pipeline lernt nach fünf Läufen aus ihren eigenen Läufen, wie lange ein Lauf üblicherweise dauert und wie viel Zeit nach ihrem Zeitplan zwischen zwei Läufen vergeht. Die Seite einer Pipeline empfiehlt drei Monitore:

- **Pipeline Run Failed**: Ein Lauf ist fehlgeschlagen oder wurde abgebrochen.
- **Pipeline Run Unusually Long**: Ein Lauf dauert doppelt so lange wie üblich oder länger, geprüft alle fünf Minuten, während er läuft, sodass ein hängender Lauf erkannt wird, bevor er endet.
- **Pipeline Is Late**: Seit längerer Zeit, als ihr Zeitplan erlaubt, hat kein Lauf begonnen.

## Eine Meldung pro Ursache

Veraltet eine Tabelle, veralten auch alle Tabellen, die aus ihr erstellt werden. Bevor sich eine Datenwarnung öffnet, sucht OneUptime in der Lineage nach einer bereits offenen Warnung zu dem, woraus ihre Tabelle oder Pipeline erstellt wird: den vorgelagerten Tabellen, den Pipelines, die in sie schreiben, und den Datenbanken, in denen sie liegen, bis zu fünf Stufen aufwärts. Findet es eine, ist die neue Warnung die Folge dieser Warnung:

- Sie beginnt im Zustand **Bestätigt**, sodass niemand für ein Problem zweimal alarmiert wird, und erholt sich von selbst, sobald ihre Daten es tun.
- Ihr Feed und ihre Karte **Daten** sagen, welche Warnung sie verursacht hat, und sie schließt sich der Episode der Ursache an.

Die Karte **Daten** der Ursache listet ihren **Auswirkung auf nachgelagerte Daten** auf: jede Warnung, die sie verursacht hat. Die Karte einer Tabellenwarnung zeigt außerdem die Dienste, die in die Tabelle schreiben, mit ihren fehlgeschlagenen Schreibvorgängen sowie ihren Deployments und anderen Änderungen am Tag vor der Warnung.

## Bevor eine Änderung gemergt wird

Ändert ein Pull Request eine überwachte Tabelle, sagt die [Produktionsprüfung](/docs/ai/ai-agent) im Pull Request, was davon abhängt: die Dienste, die sie lesen, die Tabellen, die aus ihr erstellt werden, die Dashboards darauf und ihre Datenprodukte. Eine Tabelle mit einer Kopie in einer Datenbank, die als Staging markiert ist, sagt außerdem, wie sich die Kopie unterscheidet: ihre Zeilen, ihre Spalten und was die Prüfungen der Tabelle dort lesen, an Ort und Stelle ausgeführt. Bei einer Datenbank, die nur eine Sonde erreicht, werden die Prüfungen weggelassen, und es sagt das.

## Nächste Schritte

:::cards
- [Datenprodukte](/docs/data-observability/data-products): Aktualitäts-SLAs für die Tabellen, die Menschen nutzen.
- [OneUptime AI und die API](/docs/data-observability/ai-and-api): Untersuchungen, die bei dem beginnen, was in eine Tabelle schreibt, und bei ihren Läufen.
:::
