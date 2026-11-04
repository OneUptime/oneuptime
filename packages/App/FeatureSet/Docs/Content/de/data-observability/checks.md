# Prüfungen und Abgleiche

Der Tabellenzustand sagt, ob sich eine Tabelle ändert. Eine **Prüfung** sagt, ob stimmt, was sie enthält, ein **Abgleich** sagt, ob zwei Kopien der Daten übereinstimmen, und die **Tests von dbt** berichten über die Tabellen, die dbt erstellt. Jede davon läuft dort, wo die Erfassung der Datenbank läuft, bei OneUptime oder auf ihrer Sonde, und nur eine Zahl verlässt je die Datenbank.

## Prüfungen

Fügen Sie eine Prüfung im Tab **Prüfungen** einer Tabelle hinzu:

| Prüfung | Was sie liest |
| --- | --- |
| **Null Percent** | Prozentsatz der Zeilen, deren Spalte leer ist |
| **Duplicate Percent** | Prozentsatz der Werte, die den Wert einer anderen Zeile wiederholen |
| **Distinct Count** | Wie viele verschiedene Werte die Spalte enthält |
| **Minimum**, **Maximum**, **Durchschnitt**, **Summe** | Die Werte einer numerischen Spalte (eine Summe über keine Zeilen ist 0) |
| **Invalid Percent** | Prozentsatz der Werte außerhalb einer Liste, die Sie angeben |
| **Format Mismatch Percent** | Prozentsatz der Werte, die nicht auf einen regulären Ausdruck passen (jede Engine außer SQL Server) |
| **Orphan Count** | Zeilen, deren Wert keine Entsprechung in der Spalte einer anderen Tabelle hat |
| **Zeilenanzahl** | Zeilen in der Tabelle, am nützlichsten mit **Segment By** |
| **Benutzerdefiniertes SQL** | Die Zahl, die ein schreibgeschütztes SELECT von Ihnen zurückgibt, benannt `value` |

Jede Prüfung läuft alle 15 Minuten, stündlich, alle 6 Stunden oder täglich, als eine einzige Aggregatanweisung in einer schreibgeschützten Transaktion mit einem Timeout für Anweisungen. Ihr Wert wird als `oneuptime.data.check.value` geschrieben, mit `oneuptime.data.check.id`, `oneuptime.data.check.name` und `oneuptime.data.check.segment`.

## Vorgeschlagene Prüfungen

**Suggested Checks** im selben Tab bieten die Prüfungen an, die die Spalten einer Tabelle nahelegen, allein aus ihren Namen und Typen: Eine ID ist eindeutig, eine `customer_id` hat eine passende Zeile in `customers`, eine E-Mail-Adresse sieht wie eine aus, ein Betrag ist nicht negativ, ein Status behält seine üblichen Werte, und eine nach Mandanten aufgeteilte Tabelle wird pro Mandant gezählt. Fügen Sie eine hinzu, fügen Sie alle hinzu oder verwerfen Sie eine endgültig.

## Eine Prüfung aus einem Satz

**Prüfung aus einem Satz schreiben** macht aus einer Regel wie „Bestellungen haben nie einen negativen Gesamtbetrag“ eine Prüfung mit benutzerdefiniertem SQL, die die Zeilen zählt, die gegen sie verstoßen, im eigenen SQL Ihrer Engine, mit einer Warnung, sobald es welche gibt. Sie lesen die Abfrage, bevor **Prüfung hinzufügen** sie hinzufügt, und sie unterliegt allen Regeln, die für jede Prüfung mit benutzerdefiniertem SQL gelten. Dafür muss OneUptime AI für das Projekt eingeschaltet sein.

## Segmente

**Segment By** führt eine Prüfung einmal pro Wert einer Spalte aus, etwa pro Mandant oder Region: eine Reihe und eine Warnung für jeden Wert, für die größten 100 Segmente. Eine segmentierte Zeilenanzahl warnt, wenn ein Mandant keine Daten mehr sendet, während die anderen weitermachen.

## Warnungen zu einer Prüfung

Setzen Sie **Alert When**, um bei einer Prüfung zu warnen:

- **Unusually High** oder **Unusually Low** vergleicht jeden Wert mit seiner eigenen gelernten Baseline für diese Stunde der Woche.
- **Über** oder **Unter** vergleicht ihn mit einem Schwellenwert.

Beim Speichern der Prüfung entsteht ein Metrik-Monitor für sie, in Ihrem Namen und mit Ihren Berechtigungen. Wenn Sie die Bedingung leeren, wird der Monitor entfernt.

## Abgleiche

Kopien driften auseinander: Das Warehouse hat weniger Bestellungen als die Datenbank der Anwendung, oder eine Migration hat Zeilen verloren. Ein Abgleich vergleicht unter **Abgleiche** eine Kennzahl zweier Tabellen, in einer Datenbank oder in zweien:

- **Zeilenanzahl**
- **Summe** einer Spalte
- **Distinct Count** einer Spalte
- **Benutzerdefiniertes SQL**: eine schreibgeschützte Abfrage, die eine Zahl zurückgibt, benannt `value`

Er hat eine Toleranz: einen festen Betrag (**Absolut**) oder einen Prozentsatz des Werts der Quelle (**Prozent**). Jede Seite wird von einer eigenen Prüfung gelesen, die der Abgleich anlegt und pflegt, zusammen mit der Erfassung ihrer Datenbank, sodass ein Abgleich eine PostgreSQL-Tabelle in Ihrem Netzwerk mit ihrer Kopie in Snowflake vergleichen kann. Die beiden Werte werden verglichen, sobald beide im Abstand von höchstens 15 Minuten gelesen wurden. Ein Abgleich schreibt:

- `oneuptime.data.reconciliation.drifted`: 1, wenn die beiden über die Toleranz hinaus auseinandergedriftet sind, 0, wenn sie übereinstimmen. Sein Monitor liest diesen Wert.
- `oneuptime.data.reconciliation.difference`: der Wert des Ziels abzüglich des Werts der Quelle.
- `oneuptime.data.reconciliation.difference_percent`: die Differenz als Prozentsatz des Werts der Quelle.

Eine nach Zeitplan geladene Kopie hinkt ihrer Quelle hinterher: Vergleichen Sie mit benutzerdefiniertem SQL eine Kennzahl, die bei beiden schon feststeht, etwa Zeilen, die älter als eine Stunde sind, oder berücksichtigen Sie den Verzug in der Toleranz.

## dbt-Tests

Nach einem dbt-Build sendet `oneuptime dbt upload` die Artefakte des Projekts (siehe [Lineage und Pipelines](/docs/data-observability/lineage-and-pipelines)). Jeder Test einer überwachten Tabelle erscheint dann in ihrem Tab **Prüfungen**, mit seinem letzten Ergebnis und den Zeilen, bei denen er Fehler gefunden hat. Wählen Sie **Alert on Failures**, damit ein fehlschlagender Test eine Warnung eröffnet.

## Nächste Schritte

:::cards
- [Lineage und Pipelines](/docs/data-observability/lineage-and-pipelines): Senden Sie die Artefakte von dbt, und sehen Sie den Lauf hinter einer fehlschlagenden Prüfung.
- [Datenprodukte](/docs/data-observability/data-products): Versprechen Sie den Menschen, die die Daten nutzen, dass sie aktuell sind.
:::
