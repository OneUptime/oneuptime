# Tabellenzustand

Alle fünf Minuten sagt der Katalog jeder verbundenen Datenbank, wie es jeder Tabelle geht: wann sie sich zuletzt geändert hat, wie viele Zeilen sie enthält, wie groß sie ist und welche Spalten sie hat. Data Observability lernt daraus den Rhythmus jeder Tabelle und sagt, wenn eine Tabelle verspätet ist, schrumpft oder ihre Struktur ändert, ohne dass Sie einen Schwellenwert setzen müssen.

## Was gelesen wird

Für jede Tabelle und jede View:

- **Zeilenzahl und Größe**, aus den eigenen Statistiken der Engine.
- **Wann sie sich zuletzt geändert hat**: der eigene Zeitstempel der Engine, wo sie einen führt, oder der Moment, in dem sich ihre Schreibzähler, Zeilen oder Bytes zwischen zwei Erfassungen bewegt haben.
- **Ihre Spalten**, mit ihren Typen und der Angabe, ob sie leer sein dürfen.
- **Wann sie zuletzt gelesen wurde**, wo die Engine Lesezugriffe zählt.

Nur der Katalog wird gelesen, und bei MongoDB die Feldnamen der neuesten Dokumente einer Collection. Kein Wert verlässt die Datenbank.

## Aktualität

Der **Rhythmus** einer Tabelle gibt an, wie oft sie sich üblicherweise ändert, gelernt aus der Zeit zwischen ihren Änderungen. Eine Tabelle, die ihren Rhythmus deutlich überschreitet, erscheint als **Verspätet**, auf ihrer Seite und unter **Tabellen**, und schreibt, wie weit sie darüber liegt. Ihre Aktualität ist bekannt, sobald sie sich zweimal geändert hat: Eine stündlich geladene Tabelle ist innerhalb von Stunden gelernt, eine nächtlich geladene innerhalb von Tagen.

Eine View enthält keine eigenen Zeilen, also ist ihre Aktualität die ihrer Quellen: siehe [Lineage und Pipelines](/docs/data-observability/lineage-and-pipelines).

Ein Katalog kann sagen, dass sich eine Tabelle geändert hat, obwohl sich nur ihre Verwaltungsdaten geändert haben, oder gar nichts sagen. Nennen Sie in den **Einstellungen** einer Tabelle eine **Freshness-Spalte** wie `updated_at`, und ihre letzte Änderung wird zum neuesten Wert dieser Spalte. Das Login muss die Spalte lesen können, und sie wird bei jeder Erfassung gelesen, sollte also indiziert sein; bei BigQuery und Athena, die nach dem abrechnen, was eine Abfrage liest, wird sie einmal pro Stunde gelesen. Zeiten ohne Zeitzone werden als UTC angenommen.

## Volumen- und Schemaänderungen

- **Zeilen** werden zwischen den Erfassungen verglichen: Eine Tabelle, die die Hälfte ihrer Zeilen verliert oder weit weniger enthält als üblich für diese Stunde der Woche, meldet das.
- **Spalten** werden ebenfalls verglichen. Eine Spalte, die hinzugefügt, entfernt, umbenannt, im Typ geändert oder nullable gemacht wird, landet auf der **Zeitachse** der Tabelle und unter **Schemaänderungen**, wo jede Änderung jeder Datenbank aufgelistet ist, die neueste zuerst. Eine Spalte, die entfernt, umbenannt oder im Typ geändert wird, bricht, was sie liest, und kann warnen. Eine hinzugefügte bricht nichts und bleibt auf der Zeitachse.
- **Gelöschte Tabellen** bleiben unter **Gelöschte Tabellen** erhalten, mit dem Zeitpunkt, zu dem sie zuletzt gesehen wurden, und kehren mit ihrem Verlauf zurück, wenn die Tabelle wiederkommt.

## Empfohlene Warnungen

Wählen Sie unter **Datenbanken** für eine Datenbank **Empfohlene Warnungen**. Jede Empfehlung ist ein einziger Metrik-Monitor für die ganze Datenbank, der einmal pro Tabelle warnt, sodass auch eine später angelegte Tabelle überwacht wird:

| Warnung | Löst aus, wenn |
| --- | --- |
| **Table Is Late** | Eine Tabelle fünfzehn Minuten lang über der Zeit liegt, bis zu der sie sich üblicherweise ändert |
| **Row Count Fell Sharply** | Eine Tabelle zwischen zwei Erfassungen die Hälfte ihrer Zeilen oder mehr verliert |
| **Row Count Unusually Low** | Eine Tabelle weit weniger Zeilen enthält als üblich für diese Stunde der Woche (über zwei Wochen gelernt) |
| **Schema Changed** | Spalten einer Tabelle entfernt, umbenannt oder im Typ geändert werden |
| **Table Health Stopped Reporting** | Seit fünfzehn Minuten keine Tabelle der Datenbank gelesen wurde |

Wählen Sie beim Anlegen Schweregrade, Bereitschaftsrichtlinien, Eigentümer und Beschriftungen. Danach sind es gewöhnliche Monitore: Bearbeiten Sie sie, schalten Sie sie stumm oder setzen Sie sie wie jeden anderen auf eine Statusseite.

Ein Backfill oder eine Migration sollte niemanden alarmieren. Nennen Sie die Datenbank unter **Data Observability Datenbanken** in einem [Wartungsereignis](/docs/scheduled-maintenance/index), oder setzen Sie ihren Datenbankserver hinein, und ihre Datenwarnungen bleiben still, solange das Ereignis läuft.

## Metriken, die jede Tabelle schreibt

Jede Erfassung schreibt diese Metriken für jede Tabelle, sodass Sie sie wie jede andere Metrik darstellen, auf Dashboards setzen und für Warnungen nutzen können:

| Metrik | Was sie ist |
| --- | --- |
| `oneuptime.data.table.row_count` | Zeilen in der Tabelle |
| `oneuptime.data.table.size` | Bytes, die die Tabelle und ihre Indizes belegen |
| `oneuptime.data.table.seconds_since_change` | Sekunden seit der letzten Änderung der Tabelle |
| `oneuptime.data.table.overdue_seconds` | Sekunden, die die Tabelle über der Zeit liegt, bis zu der sie sich üblicherweise ändert; 0, solange sie pünktlich ist |
| `oneuptime.data.table.row_count_change_percent` | Wie stark sich die Zeilenzahl seit der vorherigen Erfassung bewegt hat, in Prozent |
| `oneuptime.data.table.schema_changes` | Seit der vorherigen Erfassung geänderte Spalten |
| `oneuptime.data.table.breaking_schema_changes` | Seit der vorherigen Erfassung entfernte, umbenannte oder im Typ geänderte Spalten |

Jede Zeile trägt `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` und `oneuptime.data.table.key` (`schema.table`). Ein [Metrik-Monitor](/docs/monitor/metrics-monitor), gruppiert nach `oneuptime.data.table.key`, warnt einmal pro Tabelle, und seine Filter **Anomal hoch** und **Anomal niedrig** vergleichen jede Tabelle mit ihrem eigenen üblichen Wert für diese Stunde der Woche. Diese Metriken sind die eigenen Betriebsdaten von OneUptime und werden nicht als Telemetrie abgerechnet.

## Ungenutzte Tabellen

Jede Engine, die Lesezugriffe zählt, sagt, wann jede Tabelle zuletzt gelesen wurde: die Scans von PostgreSQL, das performance_schema von MySQL, die Seeks, Scans und Lookups von SQL Server sowie der Abfrageverlauf von Redshift, ClickHouse und Databricks. Auch ein Lesezugriff, der in den Datenbank-Spans Ihrer Dienste erscheint, zählt.

**Ungenutzte Tabellen** listet die Tabellen auf, die seit 90 Tagen niemand gelesen hat, die größten zuerst, mit dem Zeitpunkt, zu dem jede zuletzt beschrieben wurde: Eine Tabelle, die noch beschrieben, aber nie gelesen wird, kostet ihre Schreibvorgänge und ihren Speicher. Ein Zähler von 0 bei der ersten Erfassung einer Tabelle bedeutet, dass sie seit dem Start der Statistiken der Engine nicht gelesen wurde, sodass eine ungenutzte Tabelle von Anfang an als ungenutzt erscheint.

## Warehouse-Ausgaben

Einmal pro Stunde liest Data Observability, was jedes Snowflake- und BigQuery-Warehouse am letzten Tag ausgegeben hat, Job für Job: die Compute-Credits von Snowflake aus `QUERY_ATTRIBUTION_HISTORY` und die abgerechneten Bytes von BigQuery aus seiner Jobs-Ansicht, die **BigQuery Resource Viewer** benötigt. Ein Job ist eine Abfrage, die immer wieder läuft, benannt nach ihrem Query-Tag oder Label oder danach, was sie tut und welche Tabelle sie schreibt: nie nach dem Text der Abfrage.

**Warehouse-Ausgaben** zeigt die Summen nach Team (das `team` im Query-Tag oder Label eines Jobs, sonst wer ihn ausführt), die Tabellen, deren Schreibvorgänge am meisten kosten, die fehlgeschlagenen Jobs und was auf Jobs entfällt, die nur Tabellen schreiben, die seit 90 Tagen niemand gelesen hat.

## Dienste, die jede Tabelle nutzen

Der Tab **Dienste** einer Tabelle listet die Dienste auf, die beim Schreiben und Lesen der Tabelle gesehen wurden, mit den Anweisungen, die jeder ausgeführt hat, seinen Aufrufen und Fehlern in der letzten Stunde und dem Zeitpunkt, zu dem er zuletzt gesehen wurde. Die Angaben stammen aus den Datenbank-Spans, die Ihre Dienste bereits mit OpenTelemetry senden: ein Client-Span mit `db.system.name`, `db.namespace` und `db.collection.name`. Es muss nichts zusätzlich installiert werden.

Ein Span wird einer Tabelle nur zugeordnet, wenn seine Datenbank eine ist, die eine Erfassung gelesen hat, und wenn zwei Datenbanken denselben Namen tragen, nur dann, wenn seine `server.address` zu einer von ihnen gehört.

Jeder Dienst zeigt außerdem die Endpunkte, die seine Aufrufe auslösen, aus dem Server-Span im selben Trace, und ist als **KI-App** markiert, wenn er auch ein Modell aufruft. **Fehler, die diese Tabelle nennen** listet die offenen Ausnahmen und die Fehlerprotokolle des letzten Tages von den Diensten auf, die in die Tabelle schreiben, wenn sie sie beim Namen nennen.

## Eigentümer und Beschriftungen

Der Tab **Eigentümer** einer Tabelle nennt die Personen und Teams, denen sie gehört, und die Warnung einer Tabelle geht an sie; ohne welche an die Eigentümer ihrer Datenbank. Geben Sie ihr in den **Einstellungen** einer Tabelle eigene **Beschriftungen**.

Das sollten Sie nicht hunderte Male tun müssen. **Eigentümerregeln** und **Beschriftungsregeln** gelten für jede Tabelle, sobald sie zum ersten Mal erscheint, zugeordnet nach ihren Beschriftungen oder nach einem regulären Ausdruck auf ihren Namen, ihr Schema oder ihre Datenbank: Alles in `finance` geht an das Finanzteam, und alles mit dem Namen `*_pii` bekommt eine Beschriftung.

Eine auf `Owned` beschränkte Berechtigung erreicht nur die Tabellen, die ihrem Inhaber oder dessen Teams gehören, sowie deren Prüfungen, Aktivität und gemeldete Probleme. Wer eine Datenbank besitzt, besitzt damit nicht ihre Tabellen: Mit einer Eigentümerregel geben Sie einem Team eine ganze Datenbank.

## Wenn eine Warnung sich öffnet

Die Warnung einer Tabelle hat eine Karte **Daten**, die sagt, warum es am wahrscheinlichsten passiert ist, nach Rang geordnet: eine vorgelagerte Warnung, ein fehlgeschlagener Lauf, ein Deployment eines Dienstes, der in sie schreibt, ihre fehlschlagenden Schreibvorgänge, eine Spalte, die sich geändert hat, die Datenbank selbst oder der Server, auf dem sie läuft. Darunter steht, was von ihr abhängt: Tabellen in ihrer Lineage, Dashboards, Dienste und die Personen, denen sie gehören.

Sagen Sie, was Sie davon halten:

- **Useful**: Sie hatte recht.
- **Expected**: ein geplantes Ereignis. Nichts ändert sich, und das nächste wird ebenfalls gemeldet.
- **Kein Problem**: Die Tabelle bekommt mehr Spielraum, sodass dasselbe beim nächsten Mal still bleibt. Das übliche Intervall einer verspäteten Tabelle wächst, und die Toleranz einer Zeilenzahl wird weiter.

Findet zuerst ein Mensch ein Problem, hält **Ein Problem melden** an der Tabelle das fest. Die **Übersicht** zeigt dann, wie sich Data Observability für Ihr Projekt schlägt: nützliche Probleme pro Woche, wie viele kein Rauschen waren, wie viele Tabellen gelesen werden, wie oft es ein Problem meldete, bevor jemand es berichtete, wie schnell und wie oft seine wahrscheinliche Ursache die tatsächliche war.

## Nächste Schritte

:::cards
- [Prüfungen und Abgleiche](/docs/data-observability/checks): Regeln dafür, was eine Tabelle enthält, über die Frage hinaus, ob sie sich ändert.
- [Lineage und Pipelines](/docs/data-observability/lineage-and-pipelines): Woher die Daten einer verspäteten Tabelle kommen, und der Lauf, der sie hätte laden sollen.
:::
