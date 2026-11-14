# Prüfungen und Abgleiche

Der Tabellenzustand sagt, ob sich eine Tabelle ändert. Eine **Prüfung** sagt, ob stimmt, was sie enthält, ein **Abgleich** sagt, ob zwei Kopien der Daten übereinstimmen, und die **Tests von dbt** berichten über die Tabellen, die dbt erstellt. Jede davon läuft dort, wo die Erfassung der Datenbank läuft, bei OneUptime oder auf ihrer Sonde, und nur eine Zahl verlässt die Datenbank, es sei denn, ein Projekt entscheidet sich, eine maskierte Stichprobe fehlerhafter Zeilen aufzubewahren.

## Prüfungen

Fügen Sie eine Prüfung im Tab **Prüfungen** einer Tabelle hinzu:

| Prüfung | Was sie liest |
| --- | --- |
| **Anteil NULL-Werte** | Prozentsatz der Zeilen, deren Spalte leer ist |
| **Anteil Duplikate** | Prozentsatz der Werte, die den Wert einer anderen Zeile wiederholen |
| **Anzahl eindeutiger Werte** | Wie viele verschiedene Werte die Spalte enthält |
| **Minimum**, **Maximum**, **Durchschnitt**, **Summe** | Die Werte einer numerischen Spalte (eine Summe über keine Zeilen ist 0) |
| **Anteil ungültiger Werte** | Prozentsatz der Werte außerhalb einer Liste, die Sie angeben |
| **Anteil Formatabweichungen** | Prozentsatz der Werte, die nicht in einem Format sind, das Sie wählen, etwa Email, UUID oder Country Code, oder die nicht auf einen regulären Ausdruck von Ihnen passen (jede Engine außer SQL Server und Dataverse) |
| **Anzahl verwaister Zeilen** | Zeilen, deren Wert keine Entsprechung in der Spalte einer anderen Tabelle hat |
| **Zeilenanzahl** | Zeilen in der Tabelle, am nützlichsten mit **Segmentieren nach** |
| **Benutzerdefiniertes SQL** | Die Zahl, die ein schreibgeschütztes SELECT von Ihnen zurückgibt, benannt `value` (bei MongoDB die einer Aggregations-Pipeline) |
| **Fehlerhafte Zeilen** | Wie viele Zeilen ein schreibgeschütztes SELECT von Ihnen zurückgibt: die Zeilen, die es nicht geben sollte. 0 ist gesund (bei MongoDB die Dokumente, mit denen eine Pipeline endet) |

Jede Prüfung läuft alle 15 Minuten, stündlich, alle 6 Stunden oder täglich, als eine einzige Aggregatanweisung in einer schreibgeschützten Transaktion mit einem Timeout für Anweisungen. Ihr Wert wird als `oneuptime.data.check.value` geschrieben, mit `oneuptime.data.check.id`, `oneuptime.data.check.name` und `oneuptime.data.check.segment`.

## Vorgeschlagene Prüfungen

**Vorgeschlagene Prüfungen** im selben Tab bieten die Prüfungen an, die die Spalten einer Tabelle nahelegen, allein aus ihren Namen und Typen: Eine ID ist eindeutig, eine `customer_id` hat eine passende Zeile in `customers`, eine E-Mail-Adresse sieht wie eine aus, ein Betrag ist nicht negativ, ein Status behält seine üblichen Werte, und eine nach Mandanten aufgeteilte Tabelle wird pro Mandant gezählt. Eine Spalte, von der Datensicherheit weiß, dass sie eine E-Mail-Adresse, eine Telefonnummer oder eine IP-Adresse enthält, muss diesem Format entsprechen, egal wie sie heißt. Fügen Sie eine hinzu, fügen Sie alle hinzu oder verwerfen Sie eine endgültig.

## Eine Prüfung aus einem Satz

**Prüfung aus einem Satz schreiben** macht aus einer Regel wie „Bestellungen haben nie einen negativen Gesamtbetrag“ eine Prüfung mit benutzerdefiniertem SQL, die die Zeilen zählt, die gegen sie verstoßen, im eigenen SQL Ihrer Engine, mit einer Warnung, sobald es welche gibt. Sie lesen die Abfrage, bevor **Prüfung hinzufügen** sie hinzufügt, und sie unterliegt allen Regeln, die für jede Prüfung mit benutzerdefiniertem SQL gelten. Dafür muss OneUptime AI für das Projekt eingeschaltet sein. Bei MongoDB entsteht stattdessen eine Aggregations-Pipeline.

## Segmente

**Segmentieren nach** führt eine Prüfung einmal pro Wert einer Spalte aus, etwa pro Mandant oder Region: eine Reihe und eine Warnung für jeden Wert, für die größten 100 Segmente. Eine segmentierte Zeilenanzahl warnt, wenn ein Mandant keine Daten mehr sendet, während die anderen weitermachen.

## Warnungen zu einer Prüfung

Setzen Sie **Warnen, wenn**, um bei einer Prüfung zu warnen:

- **Ungewöhnlich hoch** oder **Ungewöhnlich niedrig** vergleicht jeden Wert mit seiner eigenen gelernten Baseline für diese Stunde der Woche.
- **Über** oder **Unter** vergleicht ihn mit einem Schwellenwert.

Beim Speichern der Prüfung entsteht ein Metrik-Monitor für sie, in Ihrem Namen und mit Ihren Berechtigungen. Wenn Sie die Bedingung leeren, wird der Monitor entfernt.

Der **Status** einer Prüfung, unter **Prüfungen** und auf dem Tab **Prüfungen** ihrer Tabelle, sagt, wie sie steht: **Fehlerhaft**, solange ihre Warnung offen ist, **Bestanden**, solange nicht, und **Ausführung fehlgeschlagen**, wenn ihre Abfrage fehlschlug. Eine Prüfung ohne Warnung zeigt nur **Ausgeführt**, also dass ihre Abfrage lief. Eine fehlerhafte Prüfung und eine, die nicht laufen konnte, stehen auch in der **Übersicht**.

## Was eine Prüfung kostet

Eine Prüfung konkurriert mit Ihrer Anwendung um die Datenbank, und bei einem Warehouse, das nach dem abrechnet, was eine Abfrage liest, kostet sie Geld. Drei Dinge halten das im Griff:

- **Stichprobenanteil (%)** liest einen Teil der Zeilen statt aller, für eine Prüfung, die eine Rate liest: Anteil NULL-Werte, Durchschnitt, Anteil ungültiger Werte und Anteil Formatabweichungen. Die meisten Engines überspringen ganze Seiten der Tabelle; MySQL, Redshift, ClickHouse und MongoDB lesen weiterhin jede Zeile und sparen sich die Arbeit für den Rest. Dataverse nimmt keine Stichprobe: Eine Prüfung liest dort jede Zeile. Eine Sicht kann es ablehnen, und die Prüfung sagt das.
- **Maximal von einer Prüfung lesbar (GB)** unter **Einstellungen** stoppt eine Prüfung bei BigQuery oder Athena, bevor sie mehr als so viele Gigabyte liest. Der Wert ist 10, bis Sie ihn ändern.
- **Warten, wenn eine Datenbank ausgelastet ist** unter **Einstellungen** lässt fällige Prüfungen für die nächste Erfassung liegen, wenn eine PostgreSQL-, MySQL- oder SQL-Server-Datenbank ausgelastet wirkt. Es ist eingeschaltet, bis Sie es ausschalten, und die Datenbank sagt, wann Prüfungen gewartet haben.

## Fehlerhafte Zeilen

Eine Zahl sagt, dass etwas nicht stimmt; ein paar Zeilen sagen, was. **Fehlerhafte Zeilen aufbewahren** unter **Einstellungen** behält bis zu 20 der Zeilen, die eine Prüfung vom Typ Fehlerhafte Zeilen, Anteil ungültiger Werte, Anteil Formatabweichungen oder Anzahl verwaister Zeilen gefunden hat, und **Fehlerhafte Zeilen** an der Prüfung zeigt sie. Die Einstellung ist aus, bis Sie sie einschalten. Sensible Spalten werden dort maskiert, wo die Zeile gelesen wird, nach dem, was die Datensicherheit in ihnen gefunden hat, oder nach ihren Namen, sodass das, was die Datenbank oder eine Sonde verlässt, bereits maskiert ist. Eine sensible Spalte, die kein Scan gefunden hat und deren Name sie nicht verrät, wird unverändert aufbewahrt.

Die Zeilen werden in OneUptime gespeichert: bei OneUptime Cloud auf den Servern von OneUptime, bei einer selbst gehosteten Installation auf Ihren eigenen. Wer die Prüfungen des Projekts lesen darf, kann sie sehen. Eine Prüfung behält nur die Zeilen ihres letzten Laufs, und wenn Sie **Fehlerhafte Zeilen aufbewahren** ausschalten, wird gelöscht, was jede Prüfung aufbewahrt hat.

## Prüfungen in einer Datei

Von Hand geschriebene Prüfungen driften von dem Code weg, der die Tabellen ändert. Halten Sie sie in Ihrem Repository, geprüft im selben Pull Request:

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

Wenden Sie sie aus der CI mit der [OneUptime CLI](/docs/cli/index) und einem API-Schlüssel an:

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

Eine Prüfung ist dieselbe Prüfung, wenn sie denselben Namen auf derselben Tabelle hat, sodass zweimaliges Anwenden einer Datei nichts ändert. Ein Fehler irgendwo in der Datei wendet nichts an und beendet mit einem Fehler, führen Sie also `--dry-run` im Pull Request aus und wenden Sie beim Merge an. Mit `--prune` wird eine Prüfung gelöscht, die ein früheres Anwenden erstellt hat und die die Datei nicht mehr nennt. Eine Prüfung, die Sie von Hand hinzugefügt haben, wird nie gelöscht. Eine Prüfung aus einer Datei sagt das in ihrer Zeile, und ihr nächstes Anwenden überschreibt, was von Hand geändert wurde.

Die Schlüssel sind `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` und `enabled`.

## Abgleiche

Kopien driften auseinander: Das Warehouse hat weniger Bestellungen als die Datenbank der Anwendung, oder eine Migration hat Zeilen verloren. Ein Abgleich vergleicht unter **Abgleiche** eine Kennzahl zweier Tabellen, in einer Datenbank oder in zweien:

- **Zeilenanzahl**
- **Summe** einer Spalte
- **Anzahl eindeutiger Werte** einer Spalte
- **Benutzerdefiniertes SQL**: eine schreibgeschützte Abfrage, die eine Zahl zurückgibt, benannt `value`

Er hat eine Toleranz: einen festen Betrag (**Absolut**) oder einen Prozentsatz des Werts der Quelle (**Prozent**). Jede Seite wird von einer eigenen Prüfung gelesen, die der Abgleich anlegt und pflegt, zusammen mit der Erfassung ihrer Datenbank, sodass ein Abgleich eine PostgreSQL-Tabelle in Ihrem Netzwerk mit ihrer Kopie in Snowflake vergleichen kann. Die beiden Werte werden verglichen, sobald beide im Abstand von höchstens 15 Minuten gelesen wurden. Ein Abgleich schreibt:

- `oneuptime.data.reconciliation.drifted`: 1, wenn die beiden über die Toleranz hinaus auseinandergedriftet sind, 0, wenn sie übereinstimmen. Sein Monitor liest diesen Wert.
- `oneuptime.data.reconciliation.difference`: der Wert des Ziels abzüglich des Werts der Quelle.
- `oneuptime.data.reconciliation.difference_percent`: die Differenz als Prozentsatz des Werts der Quelle.

Eine nach Zeitplan geladene Kopie hinkt ihrer Quelle hinterher: Vergleichen Sie mit benutzerdefiniertem SQL eine Kennzahl, die bei beiden schon feststeht, etwa Zeilen, die älter als eine Stunde sind, oder berücksichtigen Sie den Verzug in der Toleranz.

## dbt-Tests

Nach einem dbt-Build sendet `oneuptime dbt upload` die Artefakte des Projekts (siehe [Lineage und Pipelines](/docs/data-observability/lineage-and-pipelines)). Jeder Test einer überwachten Tabelle erscheint dann in ihrem Tab **Prüfungen**, mit seinem letzten Ergebnis und den Zeilen, bei denen er Fehler gefunden hat. Wählen Sie **Bei Fehlern warnen**, damit ein fehlschlagender Test eine Warnung eröffnet.

## Nächste Schritte

:::cards
- [Lineage und Pipelines](/docs/data-observability/lineage-and-pipelines): Senden Sie die Artefakte von dbt, und sehen Sie den Lauf hinter einer fehlschlagenden Prüfung.
- [Datenprodukte](/docs/data-observability/data-products): Versprechen Sie den Menschen, die die Daten nutzen, dass sie aktuell sind.
:::
