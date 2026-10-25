# Warnungsstatus & Schweregrade

Jede Warnung hat einen **Status**, wo Ihr Team mit ihr steht, und einen **Schweregrad**, wie viel sie ausmacht. Status bestimmen, was OneUptime tut: wer noch alarmiert wird, was als aktiv zählt, wann eine Episode behoben ist. Schweregrade ordnen Warnungen, und Regeln können sie abfragen. Diese Seite ist für alle, die sie einrichten oder wissen wollen, warum eine Warnung alarmiert hat oder nicht.

:::cards
- [Die vorangelegten Status](#die-vorangelegten-status): Identifiziert, Bestätigt und Behoben, und was jeder bewirkt.
- [Eigene Status hinzufügen](#eigene-status-hinzufügen): Ein eigener Schritt, etwa „In Untersuchung“.
- [Eine Warnung durch ihre Status bewegen](#eine-warnung-durch-ihre-status-bewegen): Jeder Weg, auf dem sich ein Status ändert.
- [Schweregrade](#die-vorangelegten-schweregrade): Hoch und Low, und eigene hinzufügen.
:::

## So funktioniert es

Die Warnungsstatus eines Projekts bilden eine geordnete Liste, und Warnungen bewegen sich nur nach unten durch sie. Wo ein Status steht, entscheidet, als was eine Warnung in ihm zählt: noch nicht bestätigt, bestätigt oder behoben. Warnungsepisoden durchlaufen dieselbe Liste.

```mermaid title="Warnungen bewegen sich nur nach unten; die Position eines Status bestimmt, als was er zählt"
flowchart TB
    subgraph open["Zählt als<br/>nicht bestätigt"]
        identified["Identifiziert"]
    end
    subgraph working["Zählt als<br/>bestätigt"]
        acknowledged["Bestätigt"]
        investigating["In Untersuchung<br/>(eigener)"]
    end
    subgraph done["Zählt als<br/>behoben"]
        resolved["Behoben"]
        closed["Geschlossen<br/>(eigener)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "überspringen" .-> resolved
```

Das Modell `AlertState` hat `name`, `description`, `color` und `order`, dazu drei Flags: `isCreatedState`, `isAcknowledgedState` und `isResolvedState`. OneUptime liest die Flags und die Reihenfolge, nie den Namen, deshalb können Sie **Behoben** in „Geschlossen“ umbenennen, ohne dass etwas kaputtgeht. Das Modell `AlertSeverity` hat `name`, `description`, `color` und `order` und keine Flags.

> [!TIP]
> Beide Listen liegen unter **Warnungen → Einstellungen**, das im Seitenmenü zunächst eingeklappt ist: Klappen Sie **Einstellungen** auf, um **Warnungsstatus** und **Warnungsschweregrad** zu finden.

## Die vorangelegten Status

Jedes neue Projekt beginnt mit drei Warnungsstatus, in dieser Reihenfolge:

| Status           | `order` | Flag                  | Farbe     | Bedeutung                                       |
| ---------------- | ------- | --------------------- | --------- | ----------------------------------------------- |
| **Identifiziert** | `1`    | `isCreatedState`      | `#fd625e` | Der Status, in dem neue Warnungen beginnen.     |
| **Bestätigt**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Jemand kümmert sich darum, und die Alarmierung endet. |
| **Behoben**      | `3`     | `isResolvedState`     | `#2ab57d` | Die Warnung ist vorbei und zählt nicht mehr als aktiv. |

Die drei Status mit Flag tragen auf der Einstellungsseite die Markierung **Vordefiniert**. Sie können sie umbenennen, umfärben und verschieben, aber sie behalten ihre Reihenfolge, erstellt vor bestätigt vor behoben, und sie lassen sich nicht löschen: Ihr **Löschen** bleibt gesperrt und sagt, warum.

## Was jedes Flag bewirkt

| Flag                  | Was OneUptime damit tut                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Neue Warnungen beginnen hier, wenn niemand einen anderen Status wählt: jede Warnung, die ein Monitor auslöst, und jede, die mit leerem **Anfangsstatus** erstellt wird.           |
| `isAcknowledgedState` | **Bestätigen** setzt eine Warnung hierher. In diesem Status oder jedem danach zählt die Warnung als bestätigt: Ihre Bereitschaftsrichtlinien alarmieren nicht mehr, und **Bestätigen** wird nicht mehr angeboten. |
| `isResolvedState`     | **Beheben** setzt eine Warnung hierher. In diesem Status oder jedem danach zählt die Warnung als behoben: Sie verlässt **Aktive Warnungen**, ihre Erinnerungen enden, und ihre Episode kann behoben werden. |

## Eigene Status hinzufügen

Ein Status, den Sie hinzufügen, ist ein Schritt, den Ihr Team durchläuft und den die drei vorangelegten nicht benennen: „In Untersuchung“, „Eingedämmt“, „Geschlossen“.

:::steps
### Die Statusliste öffnen

Gehen Sie zu **Warnungen → Einstellungen → Warnungsstatus**. Die Karte **Warnungsstatus** listet Ihre Status in ihrer Reihenfolge. Jede Zeile zeigt Farbe und Namen, als was eine Warnung in ihr **Zählt als**, und ihre Beschreibung.

### Den Status anlegen

Klicken Sie auf **Warnungsstatus erstellen** und füllen Sie **Name**, **Beschreibung** und **Farbe** aus. Die Farbe ist schon gewählt: eine, die noch kein anderer Status verwendet. Der neue Status wird direkt über dem behobenen Status eingefügt, sodass er Warnungen aktiv hält.

### An seinen Platz ziehen

Ziehen Sie eine Zeile an ihrem Griff, um sie zu verschieben; die neue Reihenfolge wird beim Loslassen gespeichert. Die Spalte **Zählt als** folgt: über dem bestätigten Status ist eine Warnung **Nicht bestätigt**, ab ihm abwärts **Bestätigt** und ab dem behobenen Status abwärts **Behoben**.
:::

Ein Status, den Sie hinzufügen, hat kein Flag, deshalb bedeutet er, wo er steht. Setzen Sie einen Schritt zur Eindämmung zwischen **Bestätigt** und **Behoben** und einen Schritt zur Einordnung über **Bestätigt**. Ein Status unter **Behoben** zählt überall als behoben.

Eine Warnung setzen Sie über das Menü **⋯** im Kopfbereich der Warnung in einen eigenen Status, unter **Status ändern in**, das jeden Status nach dem aktuellen auflistet. Die Bestätigung heißt **Warnung als {{state}} markieren**, mit dem Namen des Status darin.

> [!NOTE]
> In OneUptime Cloud braucht das Hinzufügen oder Ändern von Warnungsstatus und Schweregraden den Plan **Growth** oder höher. Jeder Plan kann sie lesen, verwenden und einen hinzugefügten Status löschen.

## Die Reihenfolge wird erzwungen

Jeder Statuswechsel einer Warnung wird an der Liste geprüft, egal wer ihn auslöst: das Dashboard, Slack, Microsoft Teams, die API, Terraform, ein Workflow oder OneUptime selbst.

- **Rückwärtsschritte werden abgelehnt**, mit einer Meldung, die beide Status nennt: "Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states."
- **Ein Wechsel in den Status, in dem sie schon ist, wird abgelehnt**: "Alert state cannot be same as previous state."
- **Auswahllisten bieten nur die Status nach dem aktuellen an**, sodass niemandem ein Wechsel angeboten wird, der abgelehnt würde.

Für Warnungsepisoden gilt dieselbe Liste, mit eigenen Meldungen ("Episode cannot transition to …"). Der einzige Schritt zurück nach oben ist OneUptimes eigener: eine Gruppierungsregel, die eine kürzlich behobene Episode wieder öffnet. Um einen versehentlich gesetzten Status zu korrigieren, löschen Sie seine Zeile auf der Seite **Zustands-Zeitachse** der Warnung; die Warnung kehrt in den Status ihrer neuesten verbleibenden Zeile zurück.

## Die vorangelegten Schweregrade

Jedes neue Projekt beginnt mit zwei Warnungsschweregraden, den schwersten zuerst:

| Schweregrad | `order` | Farbe     | Vorangelegte Beschreibung                                                          |
| ----------- | ------- | --------- | ---------------------------------------------------------------------------------- |
| **Hoch**    | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.     |
| **Low**     | `2`     | `#ffbf53` | Issues causing low impact to customers.                                            |

Vorfälle beginnen mit drei Schweregraden, Warnungen mit zwei. Wenn die Vorlage einer Monitor-Empfehlung **Kritisch** oder **Warnung** sagt, ordnet OneUptime das Ihrem ersten und zweiten Warnungsschweregrad zu, in einem neuen Projekt **Hoch** und **Low**.

## Schweregrade bearbeiten

Gehen Sie zu **Warnungen → Einstellungen → Warnungsschweregrad**. Die Karte **Warnungsschweregrade** listet sie, den schwersten zuerst; ziehen Sie eine Zeile, um ihren Rang zu ändern. **Warnungsschweregrad erstellen** fügt einen am Ende der Liste hinzu, als leichtesten, mit denselben Feldern **Name**, **Beschreibung** und **Farbe** wie ein Status.

Der Rang entscheidet, welcher Schweregrad gewinnt, wo OneUptime sie vergleicht: Der Schweregrad einer Episode steigt auf den der schwersten Warnung, die ihr beitritt. Schweregrade haben keine Flags und keine Löschsperre: Jeder Schweregrad lässt sich löschen, auch die beiden vorangelegten.

Ein Schweregrad alarmiert für sich niemanden. Um nach Schweregrad zu alarmieren, legen Sie eine Bereitschaftsregel an, deren **Warnungsschweregrade** auf ihn zutreffen: siehe [Warnungsregeln & Einstellungen](/docs/alerts/settings). Eine Änderung des Schweregrads einer Warnung schreibt einen Eintrag in ihren Feed und gleicht ihre Erinnerungsregel neu ab.

## Einen Status oder Schweregrad archivieren

Archivieren Sie einen Status oder Schweregrad, den Ihr Team nicht mehr verwenden soll, statt ihn zu löschen. Das Archivieren ändert keine Warnung. Das Löschen eines Status nimmt seine Zeilen aus dem Verlauf jeder Warnung, und ein Schweregrad lässt sich nicht löschen, solange Warnungen ihn haben.

- **Archivieren** steht im Menü **⋯** der Zeile. Es fragt zuerst nach und listet die Regeln, Messungen, Monitorkriterien und Workflows auf, die so eingerichtet sind, dass sie den Wert verwenden: Sie verwenden ihn weiter, bis Sie sie ändern.
- **Niemand kann ihn erneut auswählen.** **Status ändern**, die Kopfzeile der Warnung, Slack, Microsoft Teams, Regeln und Monitorkriterien lassen ihn weg. Die API, Terraform und MCP lehnen ihn ab und nennen den Wert und den Ort, an dem er sich wieder aus dem Archiv holen lässt.
- **Warnungen behalten ihn.** Eine Warnung, die ihn hat, behält ihn bei jeder späteren Bearbeitung, ihre Statuszeitachse zeigt ihn weiterhin, und Sie können weiterhin danach filtern.
- **Archivierte Werte werden getrennt aufgeführt**, im eingeklappten Abschnitt **Archivierte Warnungsstatus** oder **Archivierte Warnungsschweregrade** unter der Tabelle, mit Angabe, wer jeden archiviert hat und wann. **Aus Archiv entfernen** stellt einen so wieder her, wie er war.
- **Manche lassen sich nicht archivieren.** Der Erstellungs-, der bestätigte und der behobene Status sowie der letzte nicht archivierte Schweregrad des Projekts. Ihr **Archivieren** ist gesperrt, mit Begründung.

**Löschen** sagt zuerst, was es bewirken würde. Solange Warnungen oder Episoden den Wert haben, wird das Löschen abgelehnt, und der Dialog listet sie auf. Andernfalls listet er auf, was das Löschen ändern würde, und bietet **Stattdessen archivieren** an.

## Eine Warnung durch ihre Status bewegen

| Weg                  | Wo                                                                                        | Was abgefragt wird                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Schaltflächen im Kopfbereich** | Der Kopfbereich der Warnung: **Bestätigen**, **Beheben** und **Status ändern in** in seinem Menü **⋯** | Eine kurze Bestätigung, **Warnung bestätigen**, **Warnung beheben** oder **Warnung als {{state}} markieren**, mit einer optionalen Notiz unter **Private Notiz hinzufügen**. |
| **Statuszeitachse**  | **Zustands-Zeitachse** im Seitenmenü der Warnung                                         | Eine Zeile, die Sie von Hand hinzufügen, mit **Warnungsstatus** und **Beginnt am**.                                                    |
| **Listenzeile** | Das Menü **⋯** in der Zeile einer Warnung in der Warnungsliste: **Bestätigen**, **Beheben** und **Status ändern** | Die Bestätigung aus dem Kopfbereich, mit dem Namen der Warnung. Eine Warnung, die eine andere Änderung inzwischen weiterbewegt hat, bleibt unverändert, und der Dialog sagt, warum. |
| **Massenänderung**   | **Bestätigen**, **Beheben** oder **Status ändern** für eine Auswahl in der Warnungsliste                                   | Der Status und eine private Notiz, die jeder Warnung hinzugefügt wird. Warnungen, die schon in diesem Status oder danach sind, werden übersprungen. |
| **Automatisch**      | Ein Monitor, eine Episode, ein verknüpfter Vorfall oder Ihr eigener Code                  | **Warnung automatisch beheben** in den Kriterien eines Monitors, ein Statuswechsel der Episode, die Vorfallschalter auf [Verknüpfte Warnungen](/docs/incidents/linked-alerts) oder eine Zeile, die unter `/api/alert-state-timeline` angelegt wird. |

Der Kopfbereich bietet **Bestätigen** und **Beheben** an, solange die Warnung noch nicht bestätigt ist, danach nur noch **Beheben**. Eine behobene Warnung zeigt keine von beiden.

## Was Bestätigen bewirkt

Eine Warnung ist bestätigt, sobald sie in Ihren bestätigten Status wechselt oder in einen Status danach, auch einen behobenen. Dann:

- **Die Bereitschaft alarmiert nicht mehr für sie.** Ihre Bereitschaftsrichtlinien alarmieren die nächste Stufe nicht.
- **Bestätigen wird nicht mehr angeboten**, weder im Kopfbereich noch in Slack und Microsoft Teams, wo eine erneute Bestätigung mit "Alert is already acknowledged." oder "Alert is already resolved." abgelehnt wird. Wer danach auf seine Alarmierung antwortet, bestätigt die Alarmierung, und die Warnung bleibt, wo sie ist.
- **Die Zeit bis zur Bestätigung steht fest**, ab dem ersten solchen Wechsel: die erste Kachel der **Übersicht** und eine Messung, die endet, wenn **Die Warnung wird bestätigt**.

## Was Beheben bewirkt

Eine Warnung ist behoben, wenn sie in Ihren behobenen Status wechselt oder in einen Status danach. Dann:

- **Sie verlässt Aktive Warnungen** und die Zählung im Seitenmenü.
- **Ihre Erinnerungen enden**, egal was ihre Erinnerungsregel sagt.
- **Ihre Episode kann behoben werden.** Eine Episode wird von selbst behoben, sobald jede Warnung in ihr behoben ist. Siehe [Warnungsepisoden & Gruppierungsregeln](/docs/alerts/episodes).
- **Ihr Monitor kann eine neue Warnung auslösen.** Ein Kriterium hält jeweils eine offene Warnung; ist diese behoben, öffnet die nächste Übereinstimmung eine weitere.

Der Wechsel von **Behoben** in einen Status danach, etwa „Geschlossen“, ändert nichts davon: Die Warnung war schon behoben.

## Die Statuszeitachse

Die Seite **Zustands-Zeitachse** einer Warnung ist das Protokoll jedes Status, in dem sie war. Ihre Karte, **Status-Zeitachse**, zeichnet sie als Zeitachse: ein Band mit jedem Status so lang, wie er dauerte, und darunter jeder Wechsel, die neuesten zuerst. **Tabelle** im Kopf der Karte listet sie stattdessen als Zeilen, mit **Warnungsstatus**, **Beginnt am**, **Endet am** und **Dauer**.

- **Ursache anzeigen** zeigt die Grundursache, die mit diesem Wechsel festgehalten wurde.
- **Protokolle anzeigen** zeigt, was OneUptime beim Wechsel der Warnung festgehalten hat, etwa die Monitorprüfung, die ihn auslöste.

Zeilen lassen sich hinzufügen und löschen, aber nicht bearbeiten, und eine Warnung behält immer mindestens eine. Das Löschen der neuesten Zeile setzt die Warnung in den Status der Zeile davor zurück.

> [!WARNING]
> Das Löschen einer Zeile schreibt die Geschichte der Warnung um, samt jeder Messung, die daraus berechnet wurde. Nutzen Sie es, um einen Fehler zu korrigieren, nicht zum Aufräumen.

## Die Liste Aktive Warnungen

**Warnungen → Aktive Warnungen** enthält jede Warnung, deren Status über Ihrem behobenen Status steht, und nichts sonst entscheidet darüber: weder Schweregrad noch Alter noch, ob jemand sie bestätigt hat. Das rote Abzeichen daneben im Seitenmenü zählt dieselben Warnungen.

Ein eigener Status über **Behoben** hält Warnungen also in der Liste, und einer darunter nimmt sie heraus, wie Beheben. **Aktive Episoden** funktioniert für Episoden genauso.

## Nächste Schritte

:::cards
- [Warnungen – Übersicht](/docs/alerts/index): Woher Warnungen kommen und wie Ihr Team sie bearbeitet.
- [Warnungsepisoden & Gruppierungsregeln](/docs/alerts/episodes): Wie der Status einer Episode ihre Warnungen bewegt.
- [Warnungsregeln & Einstellungen](/docs/alerts/settings): Nach Schweregrad alarmieren und erinnern.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities): Derselbe Lebenszyklus, für Vorfälle.
:::
