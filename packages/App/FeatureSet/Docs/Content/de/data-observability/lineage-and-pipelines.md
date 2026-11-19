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

Jede Ansicht der Datenherkunft - der Tab **Datenherkunft** einer Tabelle, der einer Pipeline, der einer Warnung, die **Datenherkunftskarte** und was OneUptime AI und die API sagen - zeigt nur die Tabellen und Pipelines, die Ihre Rolle lesen darf. Eine Rolle, die auf das beschränkt ist, was ihre Mitglieder besitzen, oder auf einige Labels, sieht nie eine andere Tabelle oder Pipeline: Sie wird nicht gezeichnet, auf keinem Pfeil genannt und nicht unter den weiter entfernten Tabellen mitgezählt.

## Datenherkunftskarte

**Data Observability > Datenherkunftskarte** zeichnet jeden Datenfluss, den Ihr Projekt gesehen hat, auf einer Seite, sodass Sie sehen, wer welche Daten nutzt und wohin sie fließen, ohne zuerst eine Tabelle auszuwählen. Sie zeigt:

- **Dienste**, die Tabellen schreiben und lesen, aus den Datenbank-Spans in Ihren Traces: ein Span, der seine Tabelle (`db.collection.name` oder das ältere `db.sql.table`) und seine Anweisung (`db.operation.name`) nennt, etwa ein `INSERT` oder ein `SELECT`.
- **Tabellen**, die aus anderen Tabellen erstellt werden, aus allen oben genannten Quellen.
- **Pipelines**, die eine Tabelle aus Daten laden, die OneUptime nicht überwacht, etwa eine Fivetran-Synchronisierung. Eine Pipeline, die Daten zwischen zwei überwachten Tabellen bewegt, wird am Pfeil zwischen ihnen genannt.
- **Dashboards** und Reverse-ETL-Synchronisierungen in Ihren BI-Tools, die die Tabellen lesen, auf denen sie aufbauen, auch wenn sonst nichts diese Tabellen berührt. Ein Power-BI-Bericht, der auf keiner von OneUptime überwachten Tabelle aufbaut, wird mit den Datasets gezeichnet, die er darstellt, und den Datenquellen, aus denen sie laden; baut keines der Dashboards eines BI-Tools auf einer überwachten Tabelle auf, sagt die Karte, warum ([Lineage in Power BI](#lineage-in-power-bi)).

Jeder Pfeil ist etwas, das OneUptime aufgezeichnet hat, nie eine Vermutung. Die Karten stehen von links nach rechts in Flussrichtung der Daten und zeigen ihren Zustand wie im Diagramm einer Tabelle: rot bei einer verspäteten Tabelle, einer offenen Warnung oder einer fehlgeschlagenen Ausführung. Ein Pfeil ist türkis, wenn die Traces eines Dienstes ihn gesehen haben.

Suchen Sie nach einer Tabelle, einem Dienst, einer Pipeline oder einem Dashboard, um zu behalten, was passt, und alles stromaufwärts und stromabwärts davon. Wählen Sie eine Karte aus, um ihre gesamte Datenherkunft hervorzuheben, zu sehen, woher sie stammt und wohin sie fließt, und ihre Seite zu öffnen; **Nur die zugehörige Datenherkunft anzeigen** lässt nur diese auf der Karte. Mit den Schaltern neben der Suche lassen Sie Dienste, Pipelines oder Dashboards weg. **Liste** zeigt jeden Pfeil als Zeile und ist das, was ein Smartphone öffnet.

Eine Karte zeichnet bis zu 400 Karten, die zuletzt gesehenen Datenflüsse zuerst; hat Ihr Projekt mehr, sagt die Karte das. Dieselbe Karte liefert `POST /api/data-observability/lineage/map`, für alle, die Datenobjekte lesen dürfen, und ihre API-Schlüssel. Eine Karte mit mehr sagt, wie viele Tabellen sie ausgelassen hat, jede einmal gezählt, und kann anderswo beginnen: Wählen Sie eine Datenbank, um die Datenflüsse ihrer Tabellen und die Karten, die sie verbinden, zu zeichnen, oder geben Sie einen Namen ein und wählen Sie **Ganzes Projekt durchsuchen**, um die Datenflüsse jeder Tabelle, Pipeline, jedes Dienstes und Dashboards mit diesem Namen zu zeichnen, wie alt sie auch sind. **Ganze Karte anzeigen** geht zurück. Um die Karte der API anderswo beginnen zu lassen, senden Sie `{ "dataStoreId": "<database ID>" }` oder `{ "search": "orders" }`.

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

Die eigentliche Folge schlechter Daten ist das Dashboard, das jemand öffnet. Fügen Sie unter **BI-Dashboards** Ihre BI-Tools mit Zugangsdaten hinzu, die deren Dashboards lesen dürfen. Jede Stunde liest Data Observability jedes Dashboard und die Tabellen dahinter, ordnet jede Tabelle einer überwachten zu und zeigt die Dashboards, die auf einer Tabelle und auf den daraus erstellten Tabellen aufbauen, auf ihrem Tab **Datenherkunft**, an ihren Warnungen und im Production Review.

| Tool | Zugangsdaten |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, ein Service Principal, der die schreibgeschützten Admin-APIs von Power BI verwenden darf, mit den beiden Metadaten-Mandanteneinstellungen aus [Lineage in Power BI](#lineage-in-power-bi), eingeschaltet für die Tabellen hinter jedem Bericht. Berichte und Dashboards werden beide gelesen, mit ihren Aufrufen und Aktualisierungen (siehe unten) |
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

Jeder Job, jedes dbt-Projekt und jeder Sync erscheint unter **Pipelines**, mit seinen Läufen: wann jeder begann und endete, wie lange er dauerte, der wievielte Versuch er war, wo der Scheduler das sagt (die Try-Nummer von Airflow), und der Fehler eines fehlgeschlagenen Laufs. Jede Pipeline lernt nach fünf Läufen aus ihren eigenen Läufen, wie lange ein Lauf üblicherweise dauert und wie viel Zeit nach ihrem Zeitplan zwischen zwei Läufen vergeht. Die Seite einer Pipeline empfiehlt vier Monitore:

- **Pipeline Run Failed**: Ein Lauf ist fehlgeschlagen oder wurde abgebrochen.
- **Pipeline Run Unusually Long**: Ein Lauf dauert doppelt so lange wie üblich oder länger, geprüft alle fünf Minuten, während er läuft, sodass ein hängender Lauf erkannt wird, bevor er endet.
- **Pipeline Is Late**: Seit längerer Zeit, als ihr Zeitplan erlaubt, hat kein Lauf begonnen.
- **Pipeline Stopped by Circuit Breaker**: Der Schutzschalter hat stop geantwortet, und der Stopp dauert, bis er go antwortet oder ein Lauf beginnt.

Der Tab **Eigentümer** einer Pipeline nennt die Personen und Teams, die sich um sie kümmern, und ihre Warnungen gehen an sie. Die **Übersicht** und **Probleme** nennen die Eigentümer einer fehlgeschlagenen oder verspäteten Pipeline, oder zeigen **Kein Eigentümer** und einen Weg, einen hinzuzufügen.

**Eigentümerregeln** können die Eigentümer einer Pipeline für Sie benennen. Auf ihrem Tab **Pipeline-Regeln** gleicht eine Regel eine Pipeline per regulärem Ausdruck mit ihrem Namen ab, etwa `orders_daily.load_orders`, oder mit ihrem Namespace, also wo sie läuft, etwa `airflow://prod`, und fügt ihre Personen und Teams als Eigentümer der Pipeline hinzu, wenn OneUptime die Pipeline zum ersten Mal sieht. Um sie den Pipelines hinzuzufügen, die Sie schon haben, öffnen Sie die Regel und wählen Sie **Jetzt ausführen**.

Die Seite einer Pipeline zeichnet ihre **Datenherkunft**, die erste Anlaufstelle, wenn ein Lauf fehlschlägt oder sich verspätet: links die Tabellen, die sie liest, rechts die Tabellen, die sie schreibt, dazwischen die Pipeline, und wie es jetzt um jede steht. Wählen Sie mehr Schritte, um zu sehen, woraus diese Tabellen erstellt werden und was aus ihnen erstellt wird, und öffnen Sie eine beliebige Tabelle, um ihren eigenen Tab **Datenherkunft** zu sehen. Eine Zahl nicht gezeichneter Tabellen, auf der Karte der Pipeline oder einer Tabelle, zeichnet auch hier weitere davon an Ort und Stelle. Wählen Sie eine der Spalten, die sie schreibt, um ihr über die Pipeline hinweg zu folgen: hinauf zur Spalte jeder gelesenen Tabelle, aus der sie erstellt wurde, und hinunter zu jeder Tabelle, in die sie sie schreibt.

## Schutzschalter

Eine fehlschlagende Prüfung oder eine verspätete Tabelle benachrichtigt ihre Eigentümer, doch die Pipelines, die die Tabelle lesen, würden trotzdem laufen und die fehlerhaften Daten weiter nach unten kopieren. Ein Schutzschalter hält sie vorher an: Der erste Schritt der Pipeline fragt OneUptime, ob die Tabellen, die sie liest, in Ordnung sind, und der Rest läuft nur, wenn die Antwort go lautet.

- Eine fehlschlagende Prüfung einer Tabelle, die die Pipeline liest, stoppt sie immer: eine Prüfung, deren Warnung offen ist, oder ein fehlgeschlagener dbt-Test.
- Eine verspätete Tabelle stoppt sie ebenfalls, sobald **Stoppen, wenn eine gelesene Tabelle verspätet ist** auf der Seite **Schutzschalter** der Pipeline eingeschaltet ist. Für jede Pipeline ist es ausgeschaltet, denn eine verspätete Tabelle kann auch nur einen ruhigen Tag bedeuten.
- Eine Prüfung, die nicht laufen konnte oder noch nicht gelaufen ist, und eine Tabelle ohne Prüfungen stoppen nichts.

Der Schritt fragt mit einem Projekt-API-Schlüssel, der Data Observability lesen darf, und nennt die Pipeline als `namespace/name`, nur mit ihrem Namen oder mit ihrer ID. Der Schutzschalter liest die Tabellen, die die Pipeline liest, aus ihrer Datenherkunft. Eine Anfrage kann zusätzlich `tables` nennen, oder nur diese, jeweils als `schema.table`, nur mit ihrem Namen oder mit ihrer ID; ein Name, der zu keiner Tabelle passt, kommt in `notFound` zurück und zählt nie als Tabelle, die bestanden hat. Beurteilt werden nur die Tabellen, die der API-Schlüssel lesen darf.

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "airflow://prod/orders_daily.load_orders", "failWithStatusCode": true}'
```

Das `verdict` der Antwort ist `go` oder `stop`. `reasons` listet jede fehlschlagende Prüfung mit ihrer Tabelle und jede verspätete Tabelle mit ihrer Verspätung; `tables` listet jede beurteilte Tabelle; und `answer` sagt dasselbe in wenigen Sätzen, für das Log des Schritts. Mit `failWithStatusCode` antwortet ein Stopp mit HTTP 412, sodass `curl -f` den Schritt fehlschlagen lässt. Senden Sie `stopsOnLateTables` als `true` oder `false`, um für eine einzelne Anfrage zu entscheiden, und `dryRun` als `true`, um zu fragen, ohne dass die Antwort gespeichert wird.

Setzen Sie in Airflow einen `ShortCircuitOperator` vor die Aufgaben, die die Tabellen lesen: Gibt seine Funktion false zurück, wird jede Aufgabe nach ihm übersprungen.

```python title="orders_daily.py"
import os

import requests
from airflow.operators.python import ShortCircuitOperator


def inputs_are_healthy() -> bool:
    response = requests.post(
        "https://oneuptime.com/api/data-observability/circuit-breaker",
        headers={"ApiKey": os.environ["ONEUPTIME_API_KEY"]},
        json={"pipeline": "airflow://prod/orders_daily.load_orders"},
        timeout=30,
    )
    response.raise_for_status()
    answer = response.json()
    print(answer["answer"])
    return answer["verdict"] == "go"


check_inputs = ShortCircuitOperator(
    task_id="check_inputs",
    python_callable=inputs_are_healthy,
)

check_inputs >> load_orders
```

Die `on-run-start`-Hooks von dbt führen SQL in Ihrem Warehouse aus, keine Webanfragen. Fragen Sie daher in dem Schritt, der dbt startet: ein CI-Job, eine Cron-Zeile oder die Aufgabe, die es ausführt. Die Pipeline eines dbt-Projekts heißt `dbt/`, gefolgt vom Namen des Projekts.

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "dbt/analytics", "failWithStatusCode": true}' \
  && dbt build
```

Eine Anfrage, die eine Pipeline nennt, wird an ihr gespeichert, außer bei einem Probelauf. Solange der Schutzschalter eine Pipeline gestoppt hat, sagt ihre Seite **Schutzschalter**, seit wann und warum, ihre **Übersicht** öffnet mit dem Stopp, und **Handlungsbedarf** und **Probleme** führen sie als gestoppt statt mit ihrem fehlgeschlagenen oder verspäteten Lauf. Der Stopp endet, wenn der Schutzschalter das nächste Mal go antwortet oder ein Lauf nach ihm beginnt. Dieselbe Seite hat **Jetzt testen**, das den Schutzschalter fragt, ohne dass die Antwort gespeichert wird, und den Schritt für curl, Airflow und dbt mit dem Namen der Pipeline schon eingetragen.

Um von einem Stopp zu erfahren, fügen Sie **Pipeline Stopped by Circuit Breaker** aus den **Empfehlungen** der Pipeline hinzu. Seine Warnung öffnet sich, wenn der Schutzschalter stop antwortet, geht an die Eigentümer der Pipeline, bleibt offen, solange der Stopp gespeichert ist, und wird aufgelöst, sobald der Stopp endet. Er liest die Metrik `oneuptime.data.pipeline.circuit_breaker_stopped` der Pipeline: 1, solange der Schutzschalter sie gestoppt hat, und 0, sobald nicht mehr, geschrieben, wenn der Schutzschalter antwortet, und danach alle fünf Minuten.

Solange Data Observability auf dem Server ausgeschaltet ist, antwortet der Schutzschalter go und speichert nichts: Ein ausgeschaltetes Produkt stoppt nie eine Pipeline.

## Eine Meldung pro Ursache

Veraltet eine Tabelle, veralten auch alle Tabellen, die aus ihr erstellt werden. Bevor sich eine Datenwarnung öffnet, sucht OneUptime in der Lineage nach einer bereits offenen Warnung zu dem, woraus ihre Tabelle oder Pipeline erstellt wird: den vorgelagerten Tabellen, den Pipelines, die in sie schreiben, und den Datenbanken, in denen sie liegen, bis zu fünf Stufen aufwärts. Findet es eine, ist die neue Warnung die Folge dieser Warnung:

- Sie beginnt im Zustand **Bestätigt**, sodass niemand für ein Problem zweimal alarmiert wird, und erholt sich von selbst, sobald ihre Daten es tun.
- Ihr Feed und ihre Karte **Daten** sagen, welche Warnung sie verursacht hat, und sie schließt sich der Episode der Ursache an.

Die Karte **Daten** der Ursache listet ihren **Auswirkung auf nachgelagerte Daten** auf: jede Warnung, die sie verursacht hat. Die Karte einer Tabellenwarnung zeigt außerdem die Dienste, die in die Tabelle schreiben, mit ihren fehlgeschlagenen Schreibvorgängen sowie ihren Deployments und anderen Änderungen am Tag vor der Warnung.

Unter der Karte **Daten** zeichnet die Seite einer Warnung ihre **Datenherkunft**: rund um ihre Tabelle, wie der Tab **Datenherkunft** der Tabelle sie zeichnet, oder rund um ihre Pipeline. Der Weg hinauf zu der Warnung, die sie verursacht hat, und hinunter zu jeder Warnung, die sie verursacht hat, ist hervorgehoben - die Tabelle oder Pipeline der Ursache ist als **Ursache** markiert, die jeder verursachten Warnung als **Folge** -, und der Rest tritt zurück, sodass jeder, der sie öffnet, sieht, wo in der Kette das Problem begann. Liegt die Ursache bei einer Pipeline, die auf einem Pfeil gezeichnet ist, steht auf dem Pfeil **Ursache** unter dem Namen der Pipeline. Betrifft die Ursache eine ganze Datenbank oder liegt sie weiter oben, als das Diagramm reicht, sagt die Karte das in Worten. Bei einer Warnung aus einer Prüfung auf eine einzelne Spalte, etwa Anteil NULL-Werte auf `customer_id`, ist diese Spalte beim Öffnen neben diesen Wegen schon verfolgt, wie im Tab **Datenherkunft** der Tabelle: woher sie stammt und wohin sie fließt, auf jeder Tabelle benannt. Wählen Sie dort eine andere Spalte der Tabelle, oder heben Sie die Auswahl auf, um nur die Wege zu sehen. **Datenherkunft erkunden** öffnet den Tab **Datenherkunft** der Tabelle oder die Seite der Pipeline. Eine verursachte Warnung bei einer Pipeline, die auf einem Pfeil gezeichnet ist, sagt dort ebenso **Folge**, und die Spaltenauswahl bietet zuerst die Spalte der Prüfung an, dann die übrigen Spalten der Tabelle in deren eigener Reihenfolge.

Wer die Warnung, die sie verursacht hat, nicht sehen darf, bekommt weder die Karte **Daten** noch die Datenherkunft, und eine von ihr verursachte Warnung, die diese Person nicht sehen darf, wird weder hervorgehoben noch mitgezählt.

## Lineage in Power BI

**Zugeordnete Tabellen** sagt bei jedem BI-Tool, auf wie vielen überwachten Tabellen seine Dashboards aufbauen, und darunter das Erste, was die übrigen an einer Zuordnung hindert. **See Why** listet auf, was das letzte Lesen gefunden hat und was zu tun ist: Datenbanken, die Ihre Dashboards lesen und die nicht mit OneUptime verbunden sind, jede nur ein **Connect Database** entfernt, mit ihrer Art und Adresse schon ausgefüllt; Tabellen, die eine verbundene Datenbank nicht überwacht und die womöglich von ihrem Scan ausgelassen oder noch nicht erfasst wurden; und Quellen, die keine Datenbank sind, etwa Dateien und Webseiten. Für Power BI nennt es außerdem eine ausgeschaltete Mandanteneinstellung, Datasets, die aus Dataflows lesen, und Datasets, die Power BI nicht beschreiben kann. **Basiert auf** sagt bei jedem Dashboard, welche Datasets es darstellt und woher deren Daten kommen, so wie Power BI es angibt.

OneUptime liest jedes Power-BI-Dataset aus dem Metadatenscan von Power BI, mit der Power Query hinter jeder seiner Tabellen:

- **Die Datenbank, die ein Connector nennt**: SQL Server und Azure SQL (`Sql.Database`), PostgreSQL, MySQL, Oracle, Amazon Redshift, Snowflake, Google BigQuery, Databricks, Amazon Athena und Microsoft Dataverse, dazu das Schema und die Tabelle, die seine Navigation auswählt.
- **SQL, das eine Abfrage ausführt**: die Option **SQL statement** eines Connectors, `Value.NativeQuery` und `Odbc.Query`, und die Tabellen nach jedem `FROM` und `JOIN`.
- **Parameter und gemeinsam genutzte Abfragen**: Ein Parameter steht überall dort, wo er genannt wird, und eine Tabelle, die eine Staging-Abfrage liest, liest, was diese Abfrage liest.
- **Zusammengesetzte Modelle** stellen die Tabellen der Datasets dar, auf denen sie aufbauen.

Ein Bericht stellt die Tabellen seines Datasets dar, ein Dashboard die der Datasets seiner Kacheln. Woher die Daten kommen - der Server und Name einer Datenbank, der Pfad einer Datei, eine Webadresse -, stammt aus den Datenquellen des Scans, die nichts über den Admin-API-Zugriff oben hinaus brauchen.

Power BI gibt die Tabellen eines Datasets erst zurück, wenn ein Fabric-Administrator im Verwaltungsportal unter **Tenant settings > Admin API settings** zwei Mandanteneinstellungen für die Sicherheitsgruppe einschaltet, zu der der Service Principal gehört:

- **Enhance admin APIs responses with detailed metadata**: die Tabellen jedes Datasets.
- **Enhance admin APIs responses with DAX and mashup expressions**: die Abfragen, die sie laden und die sagen, welche Datenbanktabellen sie lesen.

Power BI beschreibt ein Dataset dann, sobald es aktualisiert oder erneut veröffentlicht wurde; eines, das nur DirectQuery verwendet, sobald jemand einen Bericht darauf geöffnet hat. Nie beschreibt es Echtzeit-Datasets, Datasets mit einer Liveverbindung zu Analysis Services, Excel-Arbeitsmappen oder Datasets über 1 GB auf gemeinsam genutzter Kapazität. Ein Dataset, das aus einem Dataflow liest, wird bis zum Dataflow gelesen: Welche Tabellen ein Dataflow lädt, liest OneUptime noch nicht.

Jede Tabelle wird einer überwachten Tabelle über ihren Namen, ihr Schema und ihre Datenbank zugeordnet, ein Server über seinen Kurznamen oder seinen vollständigen Namen. Eine Tabelle eines anderen Datenbanksystems wird nie zugeordnet, ebenso wenig eine in einer anderen Datenbank: Ein Bericht auf `Sales.dbo.Orders` wird nicht mit `Archive.dbo.Orders` verknüpft, weil nur `Archive` überwacht wird.

[Aktualisierungen](#aufrufe-und-aktualisierungen-in-power-bi) werden getrennt von den Tabellen gelesen: Ein Hinweis, dass die Aktualisierungen einiger Datasets nicht gelesen werden konnten, sagt nichts über ihre Tabellen.

## Bevor eine Änderung gemergt wird

Ändert ein Pull Request eine überwachte Tabelle, sagt die [Produktionsprüfung](/docs/ai/ai-agent) im Pull Request, was davon abhängt: die Dienste, die sie lesen, die Tabellen, die aus ihr erstellt werden, die Dashboards darauf und ihre Datenprodukte. Eine Tabelle mit einer Kopie in einer Datenbank, die als Staging markiert ist, sagt außerdem, wie sich die Kopie unterscheidet: ihre Zeilen, ihre Spalten und was die Prüfungen der Tabelle dort lesen, an Ort und Stelle ausgeführt. Bei einer Datenbank, die nur eine Sonde erreicht, werden die Prüfungen weggelassen, und es sagt das.

## Nächste Schritte

:::cards
- [Datenprodukte](/docs/data-observability/data-products): Aktualitäts-SLAs für die Tabellen, die Menschen nutzen.
- [OneUptime AI und die API](/docs/data-observability/ai-and-api): Untersuchungen, die bei dem beginnen, was in eine Tabelle schreibt, und bei ihren Läufen. In KI fragen und über KI-Agenten lässt sich fragen, woraus eine Tabelle erstellt wird.
:::
