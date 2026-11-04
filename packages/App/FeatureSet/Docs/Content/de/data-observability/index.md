# Data Observability

Data Observability überwacht die Tabellen, auf die sich Ihr Unternehmen verlässt, in PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse und Databricks, und sagt Ihnen, wenn ihre Daten verspätet, unvollständig, falsch oder fehlerhaft sind, bevor es den Menschen auffällt, die sie nutzen. Sie lernt den Rhythmus jeder Tabelle von selbst, liest den Katalog jeder Datenbank und nie eine Zeile, und verknüpft jedes Datenproblem mit dem Pipeline-Lauf, dem Deployment oder der vorgelagerten Tabelle, die dahintersteckt.

Sie beantwortet vier Fragen:

:::cards
- [Sind die Daten aktuell?](/docs/data-observability/table-health): Letzte Änderung, Zeilen, Größe und Spalten jeder Tabelle, alle fünf Minuten gelesen, mit Warnungen, wenn eine Tabelle verspätet ist, schrumpft oder ihre Struktur ändert.
- [Sind die Daten richtig?](/docs/data-observability/checks): Prüfungen dessen, was eine Tabelle enthält, Abgleiche zwischen einer Tabelle und ihrer Kopie sowie die Tests von dbt, mit Warnungen, wenn sie fehlschlagen.
- [Woher kommen sie, und was speisen sie?](/docs/data-observability/lineage-and-pipelines): Lineage aus Ihren Pipelines, aus dbt, Fivetran, Airbyte, Views und dem eigenen Abfrageverlauf der Datenbanken, sodass ein Problem nur eine Meldung erzeugt.
- [Können sich die Menschen, die sie nutzen, darauf verlassen?](/docs/data-observability/data-products): Datenprodukte mit einem Aktualitäts-SLA, auf Statusseiten und als SLO verfolgt, mit einem Badge „data as of“.
:::

## So funktioniert es

```mermaid title="Von Ihren Datenbanken zu einer Warnung, auf die jemand reagiert"
flowchart TB
    db["Ihre Datenbanken<br/>und Warehouses"] --> collect["Katalog alle fünf Minuten gelesen,<br/>von OneUptime oder einer Sonde"]
    pipes["Airflow, dbt, Spark,<br/>Fivetran, Airbyte"] --> runs["Pipeline-Läufe<br/>und Lineage"]
    collect --> health["Tabellenzustand:<br/>Aktualität, Volumen, Schema"]
    collect --> checks["Prüfungen und<br/>Abgleiche"]
    health --> alerts["Warnungen, mit dem Lauf<br/>oder Deployment dahinter"]
    checks --> alerts
    runs --> alerts
    alerts --> oncall["Bereitschaft, Statusseiten,<br/>SLOs und OneUptime AI"]
```

1. **Verbinden Sie eine Datenbank** mit einem schreibgeschützten Login. Eine Datenbank, die Datensicherheit bereits kennt, wird ohne weiteres Zutun überwacht, ebenso jedes BigQuery-Dataset, das Ihre Google-Cloud-Verbindung gefunden hat. Eine Datenbank in einem privaten Netzwerk liest eine Sonde, die Sie dort betreiben.
2. **Alle fünf Minuten** liest OneUptime den Katalog und die Statistiken jeder Datenbank: jede Tabelle und jede View, ihre Spalten, Zeilen und Größe und wann sie sich zuletzt geändert hat. Keine Tabelle wird gescannt und keine Zeile gelesen.
3. **Der Rhythmus jeder Tabelle wird gelernt**: wie oft sie sich üblicherweise ändert. Eine Tabelle, die ihren Rhythmus verpasst, ist verspätet; eine, deren Zeilen einbrechen oder deren Spalten sich ändern, meldet das.
4. **Empfohlene Warnungen** machen aus jedem dieser Fälle einen Monitor, für den Sie sich bewusst entscheiden, und Prüfungen, die Sie hinzufügen, lesen, was eine Tabelle enthält.
5. Die **Datenherkunft** (Lineage) sagt, welche Tabellen welche speisen, sodass eine Warnung zu einer Tabelle, deren Quelle zuerst ausgefallen ist, als Folge dieser Quelle gilt: eine Meldung, nicht zehn.

## Was sie anders macht

- **Sie ist Teil des übrigen OneUptime.** Eine Datenwarnung ist eine gewöhnliche Warnung: Sie alarmiert über die Bereitschaft, eröffnet Vorfälle, erscheint auf Statusseiten und zählt gegen SLOs. Die Dienste, die laut Ihren Traces in eine Tabelle schreiben, und deren Deployments stehen bei jeder Tabellenwarnung.
- **Nichts pro Tabelle zu konfigurieren.** Rhythmen, Zeitpläne und übliche Laufzeiten werden aus dem gelernt, was jede Tabelle und jede Pipeline tut, und ein für eine Datenbank empfohlener Monitor deckt jede Tabelle darin ab, auch später angelegte.
- **Eine Meldung pro Ursache.** Eine Warnung, für deren vorgelagerte Tabelle, Pipeline oder Datenbank schon eine Warnung offen ist, schließt sich dieser Warnung als deren Folge an, bereits bestätigt, sodass ein fehlerhafter Ladevorgang nur einmal alarmiert.
- **OneUptime AI kennt Ihre Daten.** Untersuchungen von Datenwarnungen beginnen bei dem, was in die Tabelle schreibt, bei ihren Läufen und ihren vorgelagerten Tabellen; in KI fragen, Slack und Microsoft Teams sowie über KI-Agenten lässt sich fragen, ob eine Tabelle aktuell ist; und eine Prüfung lässt sich aus einem Satz schreiben. Siehe [OneUptime AI und die API](/docs/data-observability/ai-and-api).

## Bevor Sie beginnen

- **Eine Rolle, die sie einrichten darf.** Projektinhaber, Projektadministratoren und Telemetrie-Administratoren verbinden Datenbanken. Alle, die Datenbestände bearbeiten dürfen, fügen Prüfungen, Abgleiche und Datenprodukte hinzu; Betrachter lesen, was sie gefunden hat. Siehe [Berechtigungsreferenz](/docs/permissions/reference).
- **Ein schreibgeschütztes Login auf jeder Datenbank.** [Eine Datenbank verbinden](/docs/data-observability/connect) nennt, was jede Engine mindestens braucht.

## Schnellstart

:::steps
### Eine Datenbank verbinden

Öffnen Sie **Data Observability**, gehen Sie zu **Datenbanken** und wählen Sie **Connect a Database**. Wählen Sie die Engine und geben Sie eine schreibgeschützte Verbindungszeichenfolge an oder den Namen der Umgebungsvariable, aus der Ihre Sonde sie liest. [Eine Datenbank verbinden](/docs/data-observability/connect) zeigt das Login jeder Engine.

### Ihre Tabellen ansehen

Innerhalb von fünf Minuten erscheinen ihre Tabellen unter **Tabellen**, jede mit ihren Zeilen, ihrer Größe und dem Zeitpunkt ihrer letzten Änderung. Die Aktualität einer Tabelle ist bekannt, sobald sie sich zweimal geändert hat: **Fresh**, solange sie ihren Rhythmus einhält, **Late**, sobald sie ihn verpasst.

### Die empfohlenen Warnungen hinzufügen

Wählen Sie unter **Datenbanken** für die Datenbank **Recommended Alerts** und fügen Sie die gewünschten hinzu: eine Tabelle, die verspätet ist, eine, deren Zeilen stark fallen oder ungewöhnlich niedrig liegen, eine, deren Spalten sich ändern, und eine Datenbank, die nicht mehr meldet. Jede ist ein gewöhnlicher Monitor: Bereitschaft, Eigentümer, Wartungsfenster und Statusseiten funktionieren wie bei jedem anderen.
:::

## Nächste Schritte

:::cards
- [Eine Datenbank verbinden](/docs/data-observability/connect): Das Login mit den geringsten Rechten für jede Engine, und Sonden für private Netzwerke.
- [Tabellenzustand](/docs/data-observability/table-health): Aktualität, Volumen, Schemaänderungen, ungenutzte Tabellen und die Metriken, die jede Tabelle schreibt.
- [Prüfungen und Abgleiche](/docs/data-observability/checks): Regeln für die Werte einer Tabelle, der Vergleich einer Tabelle mit ihrer Kopie und die Tests von dbt.
- [Lineage und Pipelines](/docs/data-observability/lineage-and-pipelines): OpenLineage, dbt, Fivetran und Airbyte, und eine Meldung pro Ursache.
- [Datenprodukte](/docs/data-observability/data-products): Aktualitäts-SLAs für die Menschen, die Daten nutzen, auf Statusseiten und als SLOs.
- [OneUptime AI und die API](/docs/data-observability/ai-and-api): Untersuchungen, eine Prüfung aus einem Satz, Aktualität für KI-Agenten und jeder Endpunkt.
:::
