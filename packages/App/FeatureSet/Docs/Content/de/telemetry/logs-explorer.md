# Protokoll-Explorer

Im Protokoll-Explorer durchsuchen und lesen Sie die Protokolle, die Ihre Dienste, Hosts und Agenten an OneUptime senden. Grenzen Sie Millionen von Zeilen auf die wenigen ein, die zählen, verfolgen Sie neue, sobald sie eintreffen, stellen Sie sie in Diagrammen dar und speichern Sie die Ansichten, zu denen Ihr Team immer wieder zurückkehrt.

:::cards
- [Eine Protokollzeile finden](#eine-protokollzeile-finden): Ein Zeitraum, eine Suche und ein paar Filter.
- [Ein Protokoll lesen](#ein-protokoll-lesen): Seine Attribute, sein Trace und die Zeilen um es herum.
- [Protokolle live verfolgen](#protokolle-live-verfolgen): Neue Zeilen alle 10 Sekunden.
- [Eine Ansicht speichern](#eine-ansicht-speichern): Eine Suche, ihre Filter und ihre Spalten für alle behalten.
- [Protokoll-Einblicke](#protokoll-einblicke): Häufigste Fehler, Schweregrade und wer was protokolliert.
- [Fehlerprotokolle, fehlende und übermäßige Protokolle mit KI finden und beheben](#fehlerprotokolle-fehlende-und-übermäßige-protokolle-mit-ki-finden-und-beheben): Pull Requests, die Fehler beheben, protokollieren, was nicht protokolliert wird, und übermäßige Zeilen leiser machen.
:::

## Wie der Explorer Ihre Protokolle eingrenzt

Alles auf dem Tab **Betrachter** arbeitet mit einer Menge von Protokollen: denen im Zeitraum, die zu Ihrer Suche und zu jedem Filter-Chip passen. Ändern Sie eines davon, ändern sich die Liste, das Volumendiagramm und die Zahlen in der Seitenleiste gemeinsam.

```mermaid title="Wie der Betrachter Ihre Protokolle eingrenzt"
flowchart TB
    all["Jedes Protokoll<br/>im Zeitraum"] --> search["Ihre Suche, etwa<br/>severity:error"]
    search --> chips["Ihre Filter-Chips,<br/>etwa ein Dienst"]
    chips --> list["Liste: neueste zuerst,<br/>100 pro Seite"]
    chips --> chart["Analysen: Anzahlen<br/>und häufigste Werte"]
    list --> details["Ein Protokoll: Details<br/>und Kontext"]
```

Der Explorer hat fünf Tabs:

| Tab | Wofür er da ist |
| --- | --- |
| **Betrachter** | Protokolle suchen, filtern und lesen. Er öffnet mit der letzten Stunde, neueste zuerst, 100 Protokolle pro Seite. |
| **Einblicke** | Was Ihre Dienste in einem Zeitraum protokolliert haben und was schiefging. |
| **KI** | Die Fehlerprotokolle, die fehlende Protokollierung und die übermäßigen Protokolle, die OneUptime in Ihren Protokollen findet, und was OneUptime AI dagegen getan hat. Siehe [Fehlerprotokolle, fehlende und übermäßige Protokolle mit KI finden und beheben](#fehlerprotokolle-fehlende-und-übermäßige-protokolle-mit-ki-finden-und-beheben). |
| **Einrichtungsanleitung** | Wie Sie Protokolle mit OpenTelemetry, Fluent Bit oder Fluentd senden, mit einem Ihrer [Aufnahmeschlüssel](/docs/telemetry/ingestion-keys). |
| **Einstellungen** | Was mit Protokollen beim Eintreffen geschieht: **Pipelines**, **Drop-Filter**, **Scrub-Regeln** und **Aufzeichnungsregeln**. |

## Bevor Sie beginnen

- **Eintreffende Protokolle.** Senden Sie sie mit [OpenTelemetry](/docs/telemetry/open-telemetry), [Fluent Bit](/docs/telemetry/fluentbit), [Fluentd](/docs/telemetry/fluentd) oder [Syslog](/docs/telemetry/syslog). Der Tab **Einrichtungsanleitung** zeigt die Konfiguration für Ihre Sprache oder Ihren Collector.
- **Eine Rolle, die Telemetrie lesen darf.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member oder Telemetry Viewer, oder eine eigene Rolle mit der Berechtigung Read Telemetry Service Log. Ihr Bereich entscheidet, wessen Protokolle Sie sehen: siehe [Telemetrie](/docs/permissions/index#telemetrie).

## Eine Protokollzeile finden

:::steps
### Den Betrachter öffnen

Öffnen Sie **Produkte → Observability → Protokolle**. Der **Betrachter** listet die Protokolle der letzten Stunde, neueste zuerst, mit **Zeit**, **Dienst**, **Schweregrad** und **Nachricht**.

### Den Zeitraum wählen

Wählen Sie einen Zeitraum in der Zeitauswahl, oder ziehen Sie über das Volumendiagramm über der Liste, um in eine Spitze hineinzuzoomen. Ein Doppelklick auf das Diagramm zoomt wieder heraus. Siehe [In einen Zeitraum zoomen](/docs/telemetry/charts-and-time-ranges).

### Suchen

Geben Sie eine Abfrage in das Suchfeld ein und drücken Sie Enter, zum Beispiel `severity:error service:checkout timeout`. Freie Wörter durchsuchen die Nachricht, und `@key:value` durchsucht ein Attribut. Siehe [Suchsyntax](/docs/telemetry/search-syntax#protokolle).

### Mit Filtern eingrenzen

Klicken Sie auf einen Wert in der Seitenleiste **Filter**, um ihn als Chip hinzuzufügen: einen Schweregrad, einen Dienst oder einen Host, Cluster oder eine andere Ressource, die Protokolle gesendet hat. Jeder Wert zeigt, wie viele Protokolle ihn tragen. Auf einem Telefon tippen Sie auf **Filter**, um die Seitenleiste zu öffnen.

### Ein Protokoll öffnen

Klicken Sie auf eine Zeile. Ihre Details öffnen sich neben der Liste.
:::

Ihre Suche, Ihre Chips und der Zeitraum stehen in der Adresse der Seite, sodass ein Neuladen, ein Lesezeichen oder ein geteilter Link dieselben Protokolle öffnet.

## Ein Protokoll lesen

Das Detailfenster hat zwei Tabs:

| Tab | Was er zeigt |
| --- | --- |
| **Details** | Den **Protokolltext**, seine **Trace-ID**, **Span-ID** und **Sitzung**, wenn es sie hat, und seine **Attribute**, als Liste oder als JSON. |
| **Kontext** | Das Protokoll inmitten seiner Nachbarn. **In der Nähe (Dienst + Zeit)** zeigt die fünf Zeilen davor und danach aus demselben Dienst, und **Dieser Trace** zeigt bis zu 100 Protokolle seines Traces. |

- Klicken Sie auf die Trace-ID, um die ganze Anfrage im [Trace-Explorer](/docs/telemetry/traces-explorer) zu öffnen.
- Zeigen Sie auf ein Attribut und klicken Sie auf sein Filtersymbol, um nach diesem Wert zu suchen, oder kopieren Sie ihn. Alle Attribute auf einmal kopieren Sie als JSON.
- **Dieser Trace** erscheint nur bei einem Protokoll, das innerhalb eines Traces geschrieben wurde.

## Protokolle live verfolgen

Klicken Sie über der Liste auf **Live**. Der Explorer springt auf die erste Seite, neueste zuerst sortiert, und sucht alle 10 Sekunden nach neuen Protokollen, sodass Zeilen erscheinen, während Ihre Dienste sie schreiben.

Der Live-Modus schaltet sich aus, wenn Sie die Suche, einen Filter oder den Zeitraum ändern oder auf eine andere Ergebnisseite wechseln: Er zeigt nur die neuesten Protokolle. Klicken Sie erneut auf **Live**, um fortzufahren.

## Spalten wählen und exportieren

- **Spalten** legt fest, was die Liste zeigt. **Zeit**, **Dienst**, **Schweregrad** und **Nachricht** stehen vorn; fügen Sie **Trace-ID**, **Span-ID** oder ein beliebiges Attribut hinzu, verschieben Sie Spalten nach oben und unten, oder kehren Sie mit **Zurücksetzen** zu den Standards zurück.
- **Export** lädt die Protokolle der Seite herunter, die Sie gerade sehen. **Als CSV exportieren** schreibt die angezeigten Spalten; **Als JSON exportieren** schreibt jedes Feld jedes Protokolls mit allen seinen Attributen.
- Zeigen Sie auf die Kopfzeile und ziehen Sie die Linie am Ende eines Spaltennamens, um die Spalte breiter oder schmaler zu machen, oder doppelklicken Sie auf die Linie, um die Spalte an ihren Inhalt anzupassen. Die Liste merkt sich Ihre Breiten in diesem Browser; **Breiten zurücksetzen** am Ende der Kopfzeile setzt jede Spalte auf ihre eigene Breite zurück.

## Eine Ansicht speichern

Eine gespeicherte Ansicht behält eine Suche, ihre Filter-Chips, den Zeitraum, die Spalten, die Sortierung und die Seitengröße unter einem Namen.

:::steps
### Die Ansicht einrichten

Suchen, filtern und wählen Sie die Spalten, die Sie behalten möchten.

### Speichern

Öffnen Sie **Gespeicherte Ansichten** und klicken Sie auf **+ Aktuelle Ansicht speichern**. Geben Sie einen **Name** ein, setzen Sie **Als Standard festlegen**, wenn sich diese Ansicht öffnen soll, sobald jemand die Protokolle öffnet, und klicken Sie auf **Ansicht speichern**.

### Verwenden

Wählen Sie die Ansicht unter **Gespeicherte Ansichten**, um sie anzuwenden, und **Ansicht zurücksetzen**, um zur letzten Stunde ohne Filter zurückzukehren. Zeigen Sie auf eine Ansicht in der Liste, um sie zu **Bearbeiten** oder zu **Löschen**, oder, solange sie angewendet ist, um sie mit Ihren Änderungen zu **Aktualisieren**.
:::

Gespeicherte Ansichten gehören zum Projekt, alle darin sehen also dieselbe Liste. Ein fortlaufender Zeitraum wie die letzte Stunde bleibt fortlaufend: Die Ansicht zeigt die Stunde vor dem Öffnen, nicht die Stunde, in der Sie sie gespeichert haben. Solange das Projekt keine Standardansicht hat, wird die nächste gespeicherte Ansicht zum Standard, und ein Projekt hat immer nur einen Standard.

## Ihre Protokolle in Diagrammen darstellen

Schalten Sie die Liste auf **Analysen** um, um Protokolle zu zählen statt sie zu lesen. Wählen Sie eine Zeitreihe, eine Top-Liste oder eine Tabelle; zählen Sie jedes Protokoll oder die eindeutigen Werte eines Felds; und gruppieren Sie nach Schweregrad, Dienst, Trace, Span oder einem beliebigen Attribut, dann nach einem zweiten Feld. Eine Top-Liste oder eine Tabelle zeigt die obersten 5, 10, 25 oder 50 Gruppen.

Klicken Sie auf **Liste**, um zu den Zeilen selbst zurückzukehren.

## Zugehörige Traces und Metriken öffnen

Die Schaltflächen **Traces** und **Metriken** neben **Gespeicherte Ansichten** öffnen den [Trace-Explorer](/docs/telemetry/traces-explorer) oder den [Metrik-Explorer](/docs/telemetry/metrics-explorer) für dasselbe Zeitfenster, mit so viel von Ihrer Filterung, wie dieser Explorer nutzen kann. Zeigen Sie auf eine Schaltfläche, um zu sehen, was sie nicht übernehmen kann.

## Protokoll-Einblicke

Der Tab **Einblicke** zeigt, was Ihre Dienste in einem Zeitraum protokolliert haben und was schiefging. Beschränken Sie ihn mit der Auswahlliste neben der Zeitauswahl auf bestimmte Dienste, Hosts oder Cluster.

| Bereich | Was er zeigt |
| --- | --- |
| Übersichtskarten | **Protokolle insgesamt**, **Fehler**, **Eindeutige Fehler** und **Meldende Quellen**. |
| **Verteilung der Schweregrade** | Wie sich die Protokolle nach Schweregrad aufteilen. |
| **Häufigste Fehler** | Die unterschiedlichen Meldungen mit dem Schweregrad Error oder Fatal, die häufigsten zuerst. |
| **Quellen, die Protokolle melden** | Das Volumen und das Fehlersignal jedes Dienstes, Hosts oder jeder anderen Quelle. |

Wählen Sie einen der häufigsten Fehler, um zu sehen, was um ihn herum geschah: wann er auftrat, was seine Vorkommen gemeinsam haben, wo er auftritt, welche Traces ihn tragen und seine letzten Zeilen. **Passende Protokolle öffnen** öffnet sie im **Betrachter**, und **Explain with AI** öffnet [Ask AI](/docs/ai/ask-ai) mit dem Fehler und seinen Belegen als Prompt, den Sie bearbeiten können.

## Fehlerprotokolle, fehlende und übermäßige Protokolle mit KI finden und beheben

Jede Stunde durchsucht OneUptime die Protokolle jedes Dienstes aus der letzten Stunde nach Fehlern, die er immer wieder protokolliert, nach Fehlschlägen, die er nicht protokolliert, und nach Zeilen, die seine Protokolle überfluten, und legt seine Befunde mit den Belegen als KI-Einblicke an. OneUptime AI untersucht dann jeden Befund und öffnet einen Pull Request, der ihn behebt. Nichts wird je zusammengeführt: Ihr Team prüft jeden Pull Request.

OneUptime legt drei Arten von Befunden an:

| Befund | Wann OneUptime ihn anlegt | Der Pull Request |
| --- | --- | --- |
| **Fehlerprotokoll** | Ein Dienst hat in der Stunde eine Meldung 20-mal oder öfter mit Error oder Fatal protokolliert, eine Meldung mit eigenen Wörtern und ohne Ausnahme. Eine Meldung, die mit einer Ausnahme oder mit einem Stacktrace darin protokolliert wird, wird stattdessen in der [Ausnahmenverfolgung](/docs/telemetry/exceptions) erfasst. | Behebt, warum der Fehler protokolliert wird, oder protokolliert ihn mit dem Schweregrad, den er verdient. |
| **Fehlende Protokollierung** | Mindestens 20 Spans eines Vorgangs sind in der Stunde fehlgeschlagen, 5 % oder mehr davon, während mindestens 100 Protokolle des Dienstes eine Trace-ID tragen, und keine der 20 jüngsten fehlgeschlagenen Anfragen des Vorgangs hat eine Protokollzeile geschrieben. Oder ein Dienst hat in der Stunde 500 oder mehr Protokolle und 100 oder mehr Spans gesendet, und weniger als 1 % seiner Protokolle tragen eine Trace-ID. | Protokolliert den Fehlschlag dort, wo er passiert, oder sorgt dafür, dass die Protokolle des Dienstes die Trace-ID tragen. |
| **Übermäßiges Protokoll** | Eine Meldung, die unterhalb von Error protokolliert wird, macht in der Stunde 25 % oder mehr der Zeilen eines Dienstes aus, etwa 10.000 Zeilen oder mehr. | Protokolliert die Zeile seltener: mit Debug, einmal pro Stapel oder gar nicht. |

Ein Befund hält eine Meldung als ihr Muster fest: Die Teile, die sich von Zeile zu Zeile ändern, etwa Zahlen und IDs, werden maskiert. Der Pull Request wird mit diesem Muster angefordert, nie mit einer Zeile, wie sie protokolliert wurde, und OneUptime AI wird angewiesen, nie Geheimnisse oder personenbezogene Daten zu protokollieren oder Protokollzeilen in den Pull Request zu kopieren.

OneUptime AI öffnet den Pull Request für ein Fehlerprotokoll nur dann selbstständig, wenn es den schuldigen Code findet. Ein Fehler, der von anderswo kommt, etwa von einer ausgefallenen Abhängigkeit, bekommt keinen Pull Request, es sei denn, jemand fordert ihn mit **Mit KI beheben** an.

### Einschalten

**Protokolle → KI → Einstellungen** enthält den Schalter **Fehlerprotokolle, fehlende und übermäßige Protokolle finden und beheben**, der für neue Projekte eingeschaltet ist. Ist **KI aktivieren** aus, werden Fehlerprotokolle, fehlende und übermäßige Protokolle weiterhin gefunden, aber OneUptime AI tut nichts damit. Um Pull Requests zu öffnen, braucht OneUptime AI ein in [Code](/docs/ai/ai-agent) verbundenes Repository: Die Seite sagt, was zuerst fehlt. Der Code eines Repositorys wird auf dem Runner geändert, den das Repository in Code auswählt.

OneUptime AI öffnet von sich aus höchstens 5 Pull Requests pro Tag (UTC), für alle Telemetrie, die es behebt, zusammen, einen pro Befund, und nie mehr, als ein Repository an offenen KI-Pull-Requests zulässt.

### KI-Regeln

Ohne Regel untersucht OneUptime AI jedes Problem, das es in Ihren Protokollen findet, sofort und öffnet für jedes, das es beheben kann, einen Pull Request. Die **KI-Regeln** unter **Weitere Einstellungen** schränken das in drei Schritten ein:

| Schritt | Was er entscheidet |
| --- | --- |
| **Übereinstimmung** | Welche Dienste: die ausgewählten, die mit bestimmten Labels oder die, deren Namen zu einem Muster passen. |
| **Untersuchen** | **Sofort** oder **Nur falls nach einer Wartezeit noch gefunden**: Ein Problem, das während der Wartezeit verschwindet, wird nicht untersucht. |
| **Behebung** | **Nicht beheben**, **Vor dem Beheben fragen** oder **Ohne Nachfrage beheben**. Wer zuerst fragt, überlässt den Pull Request einer Person: Der Befund bietet **Mit KI beheben** an. |

Unter **Weitere Felder** wählt eine Regel die Code-Repositories, die MCP-Server und den LLM-Anbieter, die OneUptime AI für sie verwenden darf. Ist nichts ausgewählt, darf es alle verwenden, und den Standard-LLM-Anbieter des Projekts.

### Sehen, was es getan hat

- **Protokolle → KI → Einblicke** listet, was OneUptime gefunden hat, jeden Befund mit seinen Belegen und **In Protokollen öffnen**, das die betroffenen Zeilen aus der Stunde, in der er gefunden wurde, im **Betrachter** öffnet. Ein Fehlschlag, der keine Protokollzeile schreibt, hat keine Zeilen zum Öffnen: **In Traces öffnen** öffnet stattdessen seine fehlgeschlagenen Spans. Bei einem Fehlerprotokoll richtet **Monitor erstellen** einen Protokoll-Monitor ein, der die Zeilen der Meldung zählt.
- **Protokolle → KI → Aktivität** listet jede Untersuchung und jeden Pull Request, das Neueste zuerst, jeweils mit ihrem Stand. Eine abgeschlossene Untersuchung sagt auch, was OneUptime AI gefunden hat, etwa eine Fehlerursache außerhalb des Codes, weshalb dieses Fehlerprotokoll von selbst keinen Pull Request bekam.
- In Code sagt die Aufgabe, dass OneUptime sie gestartet hat, mit einem Link zu ihrem Befund, und der Pull Request sagt, warum er geöffnet wurde.

## Was mit Protokollen beim Eintreffen geschieht

Der Tab **Einstellungen** enthält die Regeln, die OneUptime auf jedes Protokoll anwendet, bevor es gespeichert wird. Sie wirken auf die Protokolle, die danach eintreffen, nicht auf gespeicherte. Wie lange jedes Protokoll aufbewahrt wird, wird ebenfalls bei seiner Ankunft festgelegt: siehe [Datenaufbewahrung](/docs/telemetry/data-retention).

| Regel | Was sie tut |
| --- | --- |
| **Drop-Filter** | Protokolle verwerfen, die Sie nicht behalten möchten, oder nur eine Stichprobe davon behalten. Siehe [Datensätze verwerfen oder Stichproben nehmen](/docs/telemetry/drop-filters-and-scrub-rules#datensätze-verwerfen-oder-stichproben-nehmen). |
| **Scrub-Regeln** | Sensible Daten maskieren, etwa E-Mail-Adressen und Kartennummern. Siehe [Sensible Daten bereinigen](/docs/telemetry/drop-filters-and-scrub-rules#sensible-daten-bereinigen). |
| **Pipelines** | Felder aus der Nachricht extrahieren, den Schweregrad korrigieren, Attribute umbenennen. Siehe [Protokoll-Pipelines](/docs/telemetry/log-pipelines). |
| **Aufzeichnungsregeln** | Passende Protokolle in Metriken umwandeln. Siehe [Aufzeichnungsregeln für Protokolle](/docs/telemetry/log-recording-rules). |

## Tastenkürzel

Drücken Sie im Betrachter `?`, um sie zu sehen.

| Taste | Was sie tut |
| --- | --- |
| `j` / `k` | Zum nächsten oder vorherigen Protokoll wechseln. |
| Enter | Das ausgewählte Protokoll öffnen oder schließen. |
| Esc | Das Detailfenster schließen. |
| `/` | Zum Suchfeld springen. |
| ⌘ + Enter oder Strg + Enter | Die Suche anwenden. |
| `?` | Die Tastenkürzel ein- oder ausblenden. |

## Fehlerbehebung

:::details Es erscheinen keine Protokolle
Vergrößern Sie zuerst den Zeitraum: Der Betrachter öffnet mit der letzten Stunde. Ist die Liste weiterhin leer, vergleichen Sie Ihre Einrichtung mit der **Einrichtungsanleitung** und prüfen Sie, ob der Bereich Ihrer Rolle den Dienst abdeckt, der die Protokolle sendet.
:::

:::details Die Suche meldet, dass ihr die Zeit ausging
Eine Suche, die länger als 45 Sekunden läuft, wird abgebrochen. Wählen Sie einen kürzeren Zeitraum oder fügen Sie einen exakten Wert wie einen Dienst hinzu, damit OneUptime seinen Index nutzen kann. Siehe [Suchsyntax](/docs/telemetry/search-syntax#gut-zu-wissen).
:::

:::details Live schaltet sich immer wieder aus
Der Live-Modus folgt nur den neuesten Protokollen, daher schaltet ihn eine Änderung der Suche, eines Filters, des Zeitraums oder der Seite aus. Klicken Sie erneut auf **Live**, sobald Ihre Filter stehen.
:::

## Nächste Schritte

:::cards
- [Suchsyntax](/docs/telemetry/search-syntax): Jeder Filter, den das Suchfeld versteht.
- [Logs-Überwachung](/docs/monitor/logs-monitor): Benachrichtigt werden, wenn die gesuchten Protokolle auftauchen.
- [Protokoll-Pipelines](/docs/telemetry/log-pipelines): Teile einer Protokollzeile in filterbare Attribute verwandeln.
- [Trace-Explorer](/docs/telemetry/traces-explorer): Der Anfrage eines Protokolls durch Ihre Dienste folgen.
:::
