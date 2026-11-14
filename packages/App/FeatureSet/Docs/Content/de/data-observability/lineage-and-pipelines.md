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

Oben im Tab zeichnet ein Diagramm diese Datenherkunft einige Schritte in jede Richtung (drei, oder wählen Sie 1, 2 oder 5): links, woraus die Tabelle erstellt wird, rechts die Tabellen und Dashboards, die aus ihr erstellt werden, und die Pipelines, die Daten von außen laden, dort, wo sie hereinkommen. Jede Karte zeigt, wie es jetzt um sie steht - verspätet, eine offene Warnung, ein fehlgeschlagener Lauf -, und ein Pfeil wird rot, wenn der letzte Lauf seiner Pipeline fehlgeschlagen ist, sodass sich eine verspätete Tabelle bis zu dem Lauf zurückverfolgen lässt, der sie aufgehalten hat. Öffnen Sie eine beliebige Tabelle, um das Diagramm auf sie zu zentrieren.

Eine Karte zeichnet höchstens zehn Tabellen in jede Richtung und zählt den Rest, etwa **+14**. Wählen Sie die Zahl aus, um bis zu zehn weitere davon an Ort und Stelle zu zeichnen, Probleme zuerst, mit jedem Pfeil zwischen ihnen und dem bereits Gezeichneten. **Diagramm zurücksetzen** kehrt zum Diagramm zurück, wie es zuerst gezeichnet wurde. Sobald eine Seite so viele Tabellen hält, wie ein Diagramm fassen kann, öffnen Sie eine Tabelle, um das Diagramm auf sie zu zentrieren.

Wo die Quelle Spalten nennt, sagt der Tab **Spalten** einer Tabelle, woher jede Spalte kommt und was sie speist: der Zugriffsverlauf von Snowflake (Enterprise-Edition, die `IMPORTED PRIVILEGES` auf der Datenbank `SNOWFLAKE` braucht) und das Facet `columnLineage` von OpenLineage.

Wählen Sie im Tab **Datenherkunft** unter **Einer Spalte folgen** eine Spalte der Tabelle aus, um hervorzuheben, woher sie stammt und wohin sie fließt: im Diagramm hinauf zu den Spalten, aus denen sie erstellt wird, hinab zu den Spalten, die aus ihr erstellt werden, jede auf ihrer Tabelle benannt, auch wo die Spalte unterwegs umbenannt wurde. Ein Pfeil, dessen Quellen keine Spalten nennen, kann sie weiter tragen, als hervorgehoben ist, und das Diagramm sagt das.

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
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, ein Service Principal, der die schreibgeschützten Admin-APIs von Power BI verwenden darf. Berichte und Dashboards werden beide gelesen, mit ihren Aufrufen und Aktualisierungen (siehe unten) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (oder `eu`) |

Hightouch und Census sind Reverse-ETL-Werkzeuge: Ein Sync, der eine Tabelle in ein CRM kopiert, hängt von dieser Tabelle ab wie ein Dashboard, wird also auf dieselbe Weise gelesen und bei den Warnungen der Tabelle genannt.

Gelesen werden nur die Namen und Links der Dashboards, die Tabellen, die sie abfragen, und bei Power BI, wer sie öffnet und wie ihre Aktualisierungen verliefen: nie ihre Daten.

### Aufrufe und Aktualisierungen in Power BI

Für jeden Power-BI-Bericht und jedes Power-BI-Dashboard zeigt **BI-Dashboards** zuerst, wie oft es in den letzten 28 Tagen geöffnet wurde, wann es zuletzt geöffnet wurde und wie die letzte Aktualisierung seiner Daten verlief, bei einer fehlgeschlagenen Aktualisierung mit ihrem Fehler. Wie viele Personen es geöffnet haben, wer es am häufigsten geöffnet hat und seine letzten Aktualisierungen sind Spalten, die Sie einblenden können. Der Tab **Datenherkunft** einer Tabelle sagt dasselbe über jedes Dashboard, das auf ihr aufbaut, mit seinem Besitzer und seinen Betrachtern unter **Mehr**.

- **Aufrufe** stammen aus dem Aktivitätsprotokoll von Power BI, gelesen über seine Admin-API für Aktivitätsereignisse. Power BI bewahrt davon 28 Tage auf, beantwortet 200 Anfragen pro Stunde und teilt jede Anfrage in Stunden auf, daher liest OneUptime es Stunde für Stunde: Jedes stündliche Lesen ergänzt die Stunden seit dem letzten und geht dann durch die 28 Tage zurück, die neuesten zuerst, mit höchstens 100 Anfragen. Ein neues Power-BI-Tool zeigt sofort die letzten Tage und alle 28 Tage innerhalb eines Tages; bis dahin sagen die Aufrufe, seit wann sie gezählt werden. Ein Ereignis kann bis zu einer Stunde brauchen, bis es im Protokoll steht, daher hinken die Aufrufe bis zu zwei Stunden hinterher. Betrachter werden so genannt, wie Power BI sie nennt: mit ihrer E-Mail-Adresse.
- **Aktualisierungen** von Datasets auf einer Kapazität (Premium, Premium pro Benutzer oder Fabric) stammen aus der Admin-Liste der aktualisierbaren Elemente von Power BI: die letzte Aktualisierung jedes Datasets mit ihrem Fehler und wie viele Aktualisierungen in den sieben Tagen, die Power BI aufbewahrt, liefen und fehlschlugen.
- **Aktualisierungen von Datasets auf gemeinsam genutzter Kapazität** stehen nicht in dieser Liste. Power BI zeigt den Aktualisierungsverlauf eines Datasets nur Personen, die das Dataset ändern dürfen. Fügen Sie den Service Principal daher seinem Arbeitsbereich als **Mitwirkender**, **Mitglied** oder **Administrator** hinzu und aktivieren Sie **Service principals can call Fabric public APIs** für ihn in den Entwicklereinstellungen des Fabric-Verwaltungsportals. OneUptime liest dann jede Aktualisierung mit ihrem Fehler. Bis dahin sagt das BI-Tool, für wie viele Datasets es die Aktualisierungen nicht lesen konnte.
- Ein Power-BI-Dashboard, dessen Kacheln aus mehreren Datasets stammen, zeigt die letzte fehlgeschlagene Aktualisierung oder, wenn keine fehlschlug, die älteste: Seine Daten sind nur so aktuell wie diese.

Aufrufe und Aktualisierungen auf Kapazitäten brauchen nichts über den Admin-API-Zugriff oben hinaus: den Service Principal in einer Sicherheitsgruppe, die **Service principals can access read-only admin APIs** erlaubt, ohne Power-BI-Berechtigungen der App, die eine Administratorzustimmung erfordern. Wenn Aufrufe oder Aktualisierungen nicht gelesen werden können, werden die Dashboards trotzdem gelesen und behalten, das BI-Tool sagt, was übersprungen wurde und warum, und das nächste Lesen versucht es erneut.

### Warnungen bei fehlgeschlagenen Aktualisierungen

Aktivieren Sie **Alert on Failed Refreshes**, wenn Sie ein Power-BI-Tool hinzufügen oder bearbeiten (bei einem neuen ist es bereits aktiviert), und OneUptime führt für das Tool einen Monitor unter **Monitore**, benannt nach dem Tool. Der Monitor öffnet eine Warnung für jedes Dataset, dessen letzte Aktualisierung fehlgeschlagen ist oder abgebrochen wurde, mit dem Dataset und seinem Arbeitsbereich im Titel der Warnung, und löst sie auf, sobald eine spätere Aktualisierung abgeschlossen ist. Ein später veröffentlichtes Dataset wird überwacht, sobald es gelesen wird. Wenn Sie den Schalter ausschalten oder das Tool entfernen, wird der Monitor entfernt; bis dahin ist er ein gewöhnlicher Monitor, mit seinen Besitzern, Bereitschaftsrichtlinien und Wartungsfenstern.

Fehlgeschlagene Aktualisierungen verwenden nicht die Pipeline-Monitore. Ein Dataset, dessen Aktualisierung fehlgeschlagen ist, zeigt weiterhin die Daten seiner letzten abgeschlossenen Aktualisierung, bis eine spätere abgeschlossen ist. Daher bleibt seine Warnung bis dahin offen, während die Warnung eines fehlgeschlagenen Laufs eine Stunde nach dem Lauf erlischt. Außerdem werden Aktualisierungen einmal pro Stunde gelesen: Eine Aktualisierung, die bis zu einer Stunde nach ihrem Ende gelesen wird, läge oft außerhalb der Stunde, die **Pipeline Run Failed** betrachtet, ein halbstündlich aktualisiertes Dataset würde immer wieder zu **Pipeline Is Late**, und eine beendete, aber noch nicht gelesene Aktualisierung sähe nach **Pipeline Run Unusually Long** aus.

- Jedes stündliche Lesen behält die Datasets, deren letzte beendete Aktualisierung fehlgeschlagen ist oder abgebrochen wurde. Alle fünf Minuten schreibt jedes davon `oneuptime.data.bi.refresh_failed`, 1, solange es fehlschlägt, und 0 in der Stunde, nachdem eine spätere Aktualisierung abgeschlossen ist, und der Monitor liest diesen Wert, sodass ein Fehlschlag eine einzige Warnung öffnet, wie viele stündliche Lesevorgänge ihn auch sehen.
- Ein Fehlschlag wird beim nächsten stündlichen Lesen erkannt: Seine Warnung öffnet sich bis zu einer Stunde, nachdem die Aktualisierung fehlgeschlagen ist, und löst sich bis zu einer Stunde, nachdem eine spätere Aktualisierung abgeschlossen wurde.
- Eine noch laufende Aktualisierung ändert nichts: Die Warnung eines Datasets, dessen Aktualisierung fehlgeschlagen ist, bleibt offen, während seine nächste Aktualisierung läuft, und löst sich erst, wenn eine Aktualisierung abgeschlossen ist.
- Auf einer Kapazität liefert die Liste der aktualisierbaren Elemente von Power BI nur die letzte Aktualisierung jedes Datasets. Eine Aktualisierung, die fehlschlug und auf die innerhalb derselben Stunde eine abgeschlossene folgte, wird daher nie gesehen: Bis dahin sind die Daten wieder aktuell.
- Datasets auf gemeinsam genutzter Kapazität warnen nur dort, wo ihre Aktualisierungen gelesen werden können (siehe oben), und ein Dataset, dessen Aktualisierungen nicht gelesen werden konnten, behält seine Warnung, wie sie war, bis sie es können.

## Pipelines

Jeder Job, jedes dbt-Projekt und jeder Sync erscheint unter **Pipelines**, mit seinen Läufen: wann jeder begann und endete, wie lange er dauerte, der wievielte Versuch er war, wo der Scheduler das sagt (die Try-Nummer von Airflow), und der Fehler eines fehlgeschlagenen Laufs. Jede Pipeline lernt nach fünf Läufen aus ihren eigenen Läufen, wie lange ein Lauf üblicherweise dauert und wie viel Zeit nach ihrem Zeitplan zwischen zwei Läufen vergeht. Die Seite einer Pipeline empfiehlt drei Monitore:

- **Pipeline Run Failed**: Ein Lauf ist fehlgeschlagen oder wurde abgebrochen.
- **Pipeline Run Unusually Long**: Ein Lauf dauert doppelt so lange wie üblich oder länger, geprüft alle fünf Minuten, während er läuft, sodass ein hängender Lauf erkannt wird, bevor er endet.
- **Pipeline Is Late**: Seit längerer Zeit, als ihr Zeitplan erlaubt, hat kein Lauf begonnen.

Die Seite einer Pipeline zeichnet ihre **Datenherkunft**, die erste Anlaufstelle, wenn ein Lauf fehlschlägt oder sich verspätet: links die Tabellen, die sie liest, rechts die Tabellen, die sie schreibt, dazwischen die Pipeline, und wie es jetzt um jede steht. Wählen Sie mehr Schritte, um zu sehen, woraus diese Tabellen erstellt werden und was aus ihnen erstellt wird, und öffnen Sie eine beliebige Tabelle, um ihren eigenen Tab **Datenherkunft** zu sehen. Eine Zahl nicht gezeichneter Tabellen, auf der Karte der Pipeline oder einer Tabelle, zeichnet auch hier weitere davon an Ort und Stelle.

## Eine Meldung pro Ursache

Veraltet eine Tabelle, veralten auch alle Tabellen, die aus ihr erstellt werden. Bevor sich eine Datenwarnung öffnet, sucht OneUptime in der Lineage nach einer bereits offenen Warnung zu dem, woraus ihre Tabelle oder Pipeline erstellt wird: den vorgelagerten Tabellen, den Pipelines, die in sie schreiben, und den Datenbanken, in denen sie liegen, bis zu fünf Stufen aufwärts. Findet es eine, ist die neue Warnung die Folge dieser Warnung:

- Sie beginnt im Zustand **Bestätigt**, sodass niemand für ein Problem zweimal alarmiert wird, und erholt sich von selbst, sobald ihre Daten es tun.
- Ihr Feed und ihre Karte **Daten** sagen, welche Warnung sie verursacht hat, und sie schließt sich der Episode der Ursache an.

Die Karte **Daten** der Ursache listet ihren **Auswirkung auf nachgelagerte Daten** auf: jede Warnung, die sie verursacht hat. Die Karte einer Tabellenwarnung zeigt außerdem die Dienste, die in die Tabelle schreiben, mit ihren fehlgeschlagenen Schreibvorgängen sowie ihren Deployments und anderen Änderungen am Tag vor der Warnung.

Unter der Karte **Daten** zeichnet die Seite einer Warnung ihre **Datenherkunft**: rund um ihre Tabelle, wie der Tab **Datenherkunft** der Tabelle sie zeichnet, oder rund um ihre Pipeline. Der Weg hinauf zu der Warnung, die sie verursacht hat, und hinunter zu jeder Warnung, die sie verursacht hat, ist hervorgehoben - die Tabelle oder Pipeline der Ursache ist als **Ursache** markiert, die jeder verursachten Warnung als **Folge** -, und der Rest tritt zurück, sodass jeder, der sie öffnet, sieht, wo in der Kette das Problem begann. Liegt die Ursache bei einer Pipeline, die auf einem Pfeil gezeichnet ist, steht auf dem Pfeil **Ursache** unter dem Namen der Pipeline. Betrifft die Ursache eine ganze Datenbank oder liegt sie weiter oben, als das Diagramm reicht, sagt die Karte das in Worten. Bei einer Warnung aus einer Prüfung auf eine einzelne Spalte, etwa Anteil NULL-Werte auf `customer_id`, ist diese Spalte beim Öffnen neben diesen Wegen schon verfolgt, wie im Tab **Datenherkunft** der Tabelle: woher sie stammt und wohin sie fließt, auf jeder Tabelle benannt. Wählen Sie dort eine andere Spalte der Tabelle, oder heben Sie die Auswahl auf, um nur die Wege zu sehen. **Datenherkunft erkunden** öffnet den Tab **Datenherkunft** der Tabelle oder die Seite der Pipeline.

Wer die Warnung, die sie verursacht hat, nicht sehen darf, bekommt weder die Karte **Daten** noch die Datenherkunft, und eine von ihr verursachte Warnung, die diese Person nicht sehen darf, wird weder hervorgehoben noch mitgezählt.

## Bevor eine Änderung gemergt wird

Ändert ein Pull Request eine überwachte Tabelle, sagt die [Produktionsprüfung](/docs/ai/ai-agent) im Pull Request, was davon abhängt: die Dienste, die sie lesen, die Tabellen, die aus ihr erstellt werden, die Dashboards darauf und ihre Datenprodukte. Eine Tabelle mit einer Kopie in einer Datenbank, die als Staging markiert ist, sagt außerdem, wie sich die Kopie unterscheidet: ihre Zeilen, ihre Spalten und was die Prüfungen der Tabelle dort lesen, an Ort und Stelle ausgeführt. Bei einer Datenbank, die nur eine Sonde erreicht, werden die Prüfungen weggelassen, und es sagt das.

## Nächste Schritte

:::cards
- [Datenprodukte](/docs/data-observability/data-products): Aktualitäts-SLAs für die Tabellen, die Menschen nutzen.
- [OneUptime AI und die API](/docs/data-observability/ai-and-api): Untersuchungen, die bei dem beginnen, was in eine Tabelle schreibt, und bei ihren Läufen. In KI fragen und über KI-Agenten lässt sich fragen, woraus eine Tabelle erstellt wird.
:::
