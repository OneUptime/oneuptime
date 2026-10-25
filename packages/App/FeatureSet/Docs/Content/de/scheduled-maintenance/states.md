# Wartungsstatus

Jedes geplante Wartungsereignis ist in genau einem **Status**: wo die Arbeit steht, von geplant bis abgenommen. Status entscheiden, was OneUptime mit dem Ereignis tut: wann seine Monitore nicht mehr geprüft werden, was Ihre Statusseiten zeigen, wann seine Erinnerungen enden. Diese Seite behandelt die vier Status, mit denen jedes Projekt beginnt, was ein Ereignis zwischen ihnen bewegt und wie Sie eigene Schritte hinzufügen.

:::cards
- [Die vorangelegten Status](#die-vorangelegten-status): Geplant, Laufend, Beendet und Abgeschlossen.
- [Was ein Ereignis bewegt](#was-ein-ereignis-bewegt): Die Uhr, die Kopfzeile, die Zeitachse, Chat und die API.
- [Eigene Status](#eigene-status): Ein Schritt, bevor die Arbeit beginnt, oder eine Prüfung danach.
- [Die Zustands-Zeitachse](#die-zustands-zeitachse): Jeder Status, in dem ein Ereignis war, und wie Sie ihn korrigieren.
:::

## So funktioniert es

Die Wartungsstatus eines Projekts sind eine geordnete Liste, und Ereignisse bewegen sich darin nur nach unten. Wo ein Status steht, entscheidet, als was ein Ereignis darin zählt: wartet auf den Beginn, läuft oder ist vorbei.

```mermaid title="Ereignisse bewegen sich nur nach unten; der Platz eines Status entscheidet, als was er zählt"
flowchart TB
    subgraph waiting["Wartet auf den Beginn"]
        scheduled["Geplant"]
        confirmed["Bestätigt<br/>(eigener)"]
    end
    subgraph progress["Läuft"]
        ongoing["Laufend"]
        verifying["Wird geprüft<br/>(eigener)"]
    end
    subgraph over["Vorbei"]
        ended["Beendet"]
        completed["Abgeschlossen"]
    end
    scheduled --> confirmed
    confirmed -->|"sein Beginnt am"| ongoing
    ongoing --> verifying
    verifying -->|"sein Endet am"| ended
    ended --> completed
```

Das Modell `ScheduledMaintenanceState` hat `name`, `description`, `color` und `order`, dazu vier Flags: `isScheduledState`, `isOngoingState`, `isEndedState` und `isResolvedState`. OneUptime liest die Flags und die Reihenfolge, nie den Namen, deshalb können Sie **Abgeschlossen** in „Abgenommen“ umbenennen, ohne dass etwas kaputtgeht.

> [!TIP]
> Die Liste liegt unter **Geplante Wartung → Einstellungen → Ereignisstatus**. **Einstellungen** ist im Seitenmenü zunächst eingeklappt: Klappen Sie es zuerst auf.

## Die vorangelegten Status

Jedes neue Projekt beginnt mit vier Wartungsstatus, in dieser Reihenfolge:

| Status        | `order` | Flag               | Farbe     | Was er bedeutet                                                |
| ------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Geplant**   | `1`     | `isScheduledState` | `#000000` | Jedes neue Ereignis beginnt hier und wartet auf seine Startzeit. |
| **Laufend**   | `2`     | `isOngoingState`   | `#ffbf53` | Die Arbeit läuft, und die Monitore des Ereignisses werden nicht geprüft. |
| **Beendet**   | `3`     | `isEndedState`     | `#4a4a4a` | Das Zeitfenster ist vorbei, und die Prüfungen laufen wieder.  |
| **Abgeschlossen** | `4` | `isResolvedState`  | `#2ab57d` | Jemand hat die Arbeit abgenommen, und die Erinnerungen an die Eigentümer enden. |

Die vier markierten Status tragen auf der Einstellungsseite das Etikett **Vordefiniert**. Sie können sie umbenennen, umfärben und verschieben, aber sie behalten ihre Reihenfolge und lassen sich nicht löschen: Ihr **Löschen** bleibt gesperrt und sagt, warum.

**Beendet** und **Abgeschlossen** sind beide vorbei. Der Unterschied ist, wer das Ereignis bewegt: OneUptime setzt es zu seinem **Endet am** auf **Beendet**, und eine Person, eine Chat-Schaltfläche oder die API setzt es auf **Abgeschlossen**, sobald die Arbeit geprüft ist.

## Was ein Ereignis bewegt

| Weg              | Wo                                                                                          | Was es abfragt                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Die Uhr**      | Ein Job, der jede Minute läuft                                                              | Nichts: Zu **Beginnt am** setzt er ein wartendes Ereignis auf **Laufend** und zu **Endet am** ein laufendes auf **Beendet**. |
| **Die Kopfzeile** | Die **Übersicht** des Ereignisses: die Schaltflächen **Als {{state}} markieren** und **Status ändern in** in ihrem Menü **⋯** | Ein kurzer Dialog, **Geplante Wartung als {{state}} markieren**, mit **Statusseiten-Abonnenten benachrichtigen** und einer optionalen Notiz unter **Öffentliche Notiz hinzufügen**. |
| **Die Zeitachse** | **Zustands-Zeitachse** im Seitenmenü des Ereignisses                                       | Eine Zeile, die Sie von Hand hinzufügen, mit **Status der geplanten Wartung** und **Beginnt am**.               |
| **Massenänderung** | **Status ändern** für eine Auswahl in der Liste der Ereignisse                            | Den Status und eine öffentliche Notiz, die jedem Ereignis hinzugefügt wird. Ereignisse, die schon in diesem Status oder dahinter sind, werden übersprungen. |
| **Chat**         | Die Schaltflächen in den Slack- und Microsoft-Teams-Nachrichten des Ereignisses             | Dieselbe Änderung, in Ihrem Namen ausgeführt. Siehe [Slack](/docs/workspace-connections/slack#aus-slack-auf-vorfälle-warnungen-und-ereignisse-reagieren). |
| **Die API**      | Eine Zeile, erstellt unter `/api/scheduled-maintenance-state-timeline`                      | Den Status und ob die Abonnenten informiert werden.                                                              |

Die Schaltflächen der Kopfzeile sind nach Ihren Status benannt. Solange das Ereignis wartet, bietet sie zwei: eine, die es startet, benannt nach Ihrem laufenden Status, und eine, die es beendet, benannt nach Ihrem beendeten Status. Solange das Ereignis läuft, nur die zweite. Das Menü **⋯** listet jeden anderen Status nach dem aktuellen auf. Wer den Status des Ereignisses mit seiner Rolle nicht ändern darf, sieht die Schaltflächen gesperrt und kein Menü weiterer Status; zeigt man auf eine, nennt sie die Berechtigungen, die das erlauben würden.

## Was Starten und Beenden bewirken

Ein Ereignis startet, wenn es aus einem Status, in dem es wartet, nach **Laufend** wechselt oder direkt in einen eigenen Status zwischen **Laufend** und **Beendet**. Dann:

- **Seine Monitore werden nicht mehr geprüft** und wechseln zu seinem **Monitor-Status ändern in**, falls es einen hat. Ein Monitor, den Sie dem Ereignis während der Arbeit hinzufügen, wechselt ebenfalls.
- **Seine Statusseiten führen es als laufend**, und seine Abonnenten werden informiert: zur geplanten Zeit, wenn **Wenn das Ereignis beginnt** eingeschaltet ist, und von Hand so, wie es **Statusseiten-Abonnenten benachrichtigen** im Dialog sagt.
- **Seine Eigentümer werden informiert**, wenn sie die Benachrichtigung über Statusänderungen eingeschaltet haben, und das Ereignis erscheint unter **Laufende Ereignisse**.

Ein Ereignis endet, wenn es aus einem Status, in dem es läuft, nach **Beendet**, **Abgeschlossen** oder in einen eigenen Status nach **Beendet** wechselt. Dann werden seine Monitore wieder geprüft und kehren zu „betriebsbereit“ zurück, es sei denn, ein anderes laufendes Ereignis hält sie noch, und seine Abonnenten werden auf dieselbe Weise informiert: zur geplanten Zeit, wenn **Wenn das Ereignis endet** eingeschaltet ist, und von Hand so, wie es der Dialog sagt.

Ein Wechsel von **Laufend** zu „Wird geprüft“ oder von **Beendet** zu **Abgeschlossen** startet oder beendet nichts erneut: Das Ereignis hatte bereits begonnen oder geendet.

## Die Uhr in der Kopfzeile

Vor dem Beginn zählt die Kopfzeile bis dahin herunter; während das Ereignis läuft, zählt sie, wie lange es schon läuft; sobald es vorbei ist, sagt sie, wie lange es gedauert hat. Wenn das Ereignis eine Grenze um mehr als zwei Minuten verpasst, sagt ein gelber Hinweis das:

- **Start überfällig**: Das Ereignis wartet nach seinem **Beginnt am** noch immer.
- **Überzogen**: Das Ereignis läuft nach seinem **Endet am** noch immer.

Der Hinweis nennt die geplante Zeit und den Status, den das Ereignis noch nicht erreicht hat. Direkt nach einer Grenze ist der Job, der Ereignisse bewegt, vielleicht noch nicht gelaufen, deshalb prüft die Kopfzeile in den nächsten Minuten von selbst erneut und zeigt den neuen Status ohne Neuladen.

## Die Reihenfolge wird erzwungen

Jede Statusänderung wird gegen die Liste geprüft, wer sie auch vornimmt: das Dashboard, Slack, Microsoft Teams, die API, Terraform, ein Workflow oder OneUptime selbst.

- **Rückwärtsschritte werden abgelehnt**, mit einer Meldung, die beide Status nennt: "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **Ein Wechsel in den Status, in dem es schon ist, wird abgelehnt**: "Scheduled Maintenance state cannot be same as previous state."
- **Auswahllisten bieten nur die Status nach dem aktuellen an**, sodass niemandem ein Wechsel angeboten wird, der abgelehnt würde.

Um einen versehentlich gesetzten Status zu korrigieren, löschen Sie seine Zeile auf der Seite **Zustands-Zeitachse** des Ereignisses; das Ereignis kehrt in den Status der Zeile davor zurück.

## Eigene Status

Ein Status, den Sie hinzufügen, ist ein Schritt, den Ihr Team durchläuft und den die vier vorangelegten nicht benennen: „Bestätigt“, bevor die Arbeit beginnt, „Wird geprüft“ danach.

:::steps
### Die Statusliste öffnen

Gehen Sie zu **Geplante Wartung → Einstellungen → Ereignisstatus**. Die Karte **Status der geplanten Wartung** listet Ihre Status in ihrer Reihenfolge. Jede Zeile zeigt Farbe und Name, als was ein Ereignis darin zählt (Spalte **Zählt als**) und ihre Beschreibung.

### Den Status erstellen

Klicken Sie auf **Status der geplanten Wartung erstellen** und füllen Sie **Name**, **Beschreibung** und **Farbe** aus. Der neue Status wird direkt über dem abgeschlossenen Status eingefügt.

### An seinen Platz ziehen

Ziehen Sie eine Zeile an ihrem Griff, um sie zu verschieben; die neue Reihenfolge wird beim Loslassen gespeichert. Die Spalte **Zählt als** folgt dem Platz, an dem Sie sie ablegen.
:::

Ein Status, den Sie hinzufügen, hat kein Flag, also bestimmt sein Platz, was er bedeutet:

| Wo Sie ihn platzieren                   | Ein Ereignis darin                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Zwischen **Geplant** und **Laufend**    | Wartet auf sein **Beginnt am**, wie in **Geplant**, und startet von dort zu seiner Zeit.                         |
| Zwischen **Laufend** und **Beendet**    | Läuft, wie in **Laufend**: Seine Monitore bleiben ungeprüft, und es endet zu seinem **Endet am**.                |
| Zwischen **Beendet** und **Abgeschlossen** | Ist vorbei, aber noch nicht abgeschlossen: Erinnerungen, die bis zum Abschluss laufen, gehen weiter.          |
| Unter **Abgeschlossen**                 | Ist abgeschlossen, wie in **Abgeschlossen**.                                                                     |

Halten Sie Ihre Status unterhalb von **Geplant**: Jedes neue Ereignis beginnt dort, und ein Ereignis bewegt sich nie zurück nach oben, also wird ein Status darüber nie erreicht. In einen eigenen Status setzen Sie ein Ereignis über das Menü **⋯** in seiner Kopfzeile, unter **Status ändern in**.

> [!NOTE]
> In OneUptime Cloud erfordert das Hinzufügen oder Ändern von Wartungsstatus den Plan **Growth** oder höher. Jeder Plan kann sie lesen, verwenden und einen von Ihnen hinzugefügten Status löschen.

## Einen Status archivieren

Archivieren Sie einen eigenen Status, den Ihr Team nicht mehr verwenden soll, statt ihn zu löschen. Das Archivieren ändert kein Ereignis: Ein Ereignis in diesem Status bleibt darin und geht wie gewohnt weiter, und seine Statuszeitachse zeigt ihn weiterhin.

- **Archivieren** steht im Menü **⋯** der Zeile. Es fragt zuerst nach und listet die Messungen und Workflows auf, die so eingerichtet sind, dass sie den Status verwenden.
- **Niemand kann ihn erneut auswählen.** Die Kopfzeile des Ereignisses, **Status ändern**, Slack und Microsoft Teams lassen ihn weg, und die API, Terraform und MCP lehnen ihn ab. Sie können Ereignisse weiterhin danach filtern.
- **Archivierte Status werden getrennt aufgeführt**, im eingeklappten Abschnitt **Archivierte Status der geplanten Wartung** unter der Tabelle. **Aus Archiv entfernen** stellt einen so wieder her, wie er war.
- **Die vier eingebauten Status lassen sich nicht archivieren**: OneUptime bewegt Ereignisse in sie hinein. Ihr **Archivieren** ist gesperrt, mit Begründung.

## Die Zustands-Zeitachse

Die Seite **Zustands-Zeitachse** des Ereignisses verzeichnet jeden Status, in dem es war. Ihre Karte, **Status-Zeitachse**, zeichnet sie als Zeitachse: ein Band mit jedem Status so lang, wie er gedauert hat, und darunter jede Änderung, die neueste zuerst. **Tabelle**, in der Kopfzeile der Karte, listet sie stattdessen als Zeilen, mit **Status der geplanten Wartung**, **Beginnt am**, **Endet am**, **Dauer**, ob die Abonnenten informiert werden sollten und wie ihre Benachrichtigung verlief.

Im Dashboard lassen sich Zeilen hinzufügen und löschen, aber nicht bearbeiten, und ein Ereignis behält immer mindestens eine. Über die API lässt sich der `startsAt` einer Zeile korrigieren, und jede aus der Zeitachse berechnete Messung folgt ihm. Wenn Sie die neueste Zeile löschen, kehrt das Ereignis in den Status der Zeile davor zurück.

> [!WARNING]
> Eine Zeile zu löschen schreibt die Geschichte des Ereignisses und jede daraus berechnete Messung um. Nutzen Sie es, um einen Fehler zu korrigieren, nicht zum Aufräumen.

## Fehlerbehebung

:::details Die Kopfzeile zeigt Start überfällig
Das Ereignis wartet mehr als zwei Minuten nach seinem **Beginnt am** noch immer, der Job, der Ereignisse startet, hat es also noch nicht bewegt. Starten Sie es selbst mit der Schaltfläche in der Kopfzeile: Ein Start von Hand tut alles, was der Job tut, einschließlich seiner Monitore.
:::

:::details Ein Ereignis lässt sich nicht in einen früheren Status zurücksetzen
Status bewegen sich nur nach unten in der Liste. Löschen Sie auf der Seite **Zustands-Zeitachse** des Ereignisses die Zeilen nach dem gewünschten Status, die neueste zuerst.
:::

:::details Der abgeschlossene Status fehlt bei den Schaltflächen der Kopfzeile
Die Schaltflächen der Kopfzeile starten und beenden das Ereignis. Das Abschließen liegt im Menü **⋯**, unter **Status ändern in**.
:::

## Nächste Schritte

:::cards
- [Geplante Wartung – Übersicht](/docs/scheduled-maintenance/index): Wo alles liegt und was ein Ereignis beeinflusst.
- [Wartungsereignisse erstellen](/docs/scheduled-maintenance/creating-events): Das Formular, Feld für Feld.
- [Wartungsregeln & Einstellungen](/docs/scheduled-maintenance/settings): Eigentümer erinnern, bis ein Ereignis abgeschlossen ist.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities): Dieselbe geordnete Liste, für Vorfälle.
:::
