# Einen Workflow erstellen

Um einen Workflow anzulegen, öffnen Sie **Arbeitsabläufe** und klicken auf **Workflow erstellen**. Der Dialog **Workflow erstellen** fragt zuerst, wie Sie beginnen möchten, und dann nach einem Namen. Eine Vorlage, die eigene Einstellungen braucht, etwa eine Slack-Webhook-URL, fragt in einem weiteren Schritt danach.

Wählen Sie, wie Sie beginnen:

- **Ohne Vorlage beginnen**, ganz oben im Dialog, gibt Ihnen eine leere Arbeitsfläche. Die meisten Workflows beginnen hier.
- **Oder mit einer Vorlage beginnen** listet einige Vorlagen unter **Empfohlen** auf. Für die übrigen wählen Sie neben dem Suchfeld eine Kategorie, etwa **Vorfälle**, **Monitore** oder **Jira**, oder **Alle Vorlagen**, oder Sie tippen in **Vorlagen durchsuchen…**. Jedes eingegebene Wort muss passen.

Klicken Sie auf eine Vorlage, um zu sehen, was sie tut: ihren Trigger, die Blöcke, aus denen sie besteht, und die Einstellungen, nach denen sie fragt. Klicken Sie dann auf **Diese Vorlage verwenden**, oder doppelklicken Sie auf die Vorlage. Im Suchfeld wählen die Pfeiltasten eine Vorlage aus, und **Enter** verwendet sie. `/` bringt Sie zurück ins Suchfeld.

Workflows werden ausgeschaltet angelegt, sodass nichts ausgeführt wird, bis Sie sie einschalten. Ein neuer Workflow öffnet sich im **Builder**, der Arbeitsfläche, auf der Sie ihn entwerfen.

## Die Arbeitsfläche

Ein von Grund auf neuer Workflow öffnet sich mit einem einzigen gestrichelten Baustein mit der Aufschrift **Choose what starts this workflow**. Dieser Baustein ist der Startpunkt – klicken Sie ihn an, um einen Trigger auszuwählen. Ein aus einer Vorlage erstellter Workflow öffnet sich mit bereits gesetzten Bausteinen.

Jeder Workflow hat ganz oben genau einen **Trigger**. Alles andere ist eine **Komponente**, die etwas tut. Ein zweiter Trigger ersetzt den ersten, und wenn Sie den letzten löschen, kommt der gestrichelte Platzhalter zurück.

Bausteine hinzufügen:

- **Der Trigger** – klicken Sie auf den gestrichelten Platzhalter-Baustein. Es öffnet sich ein Panel mit dem Titel **Add Trigger**.
- **Alles andere** – klicken Sie in der Werkzeugleiste über der Arbeitsfläche auf **Komponente hinzufügen**. Dasselbe Panel öffnet sich, betitelt mit **Komponente hinzufügen**.

Beide Panels beginnen mit den Bausteinen, die die meisten Workflows brauchen, unter **Popular**; danach folgen die übrigen eingebauten Bausteine. Unter **OneUptime resources** klicken Sie auf eine Ressource wie **Incident**, um zu sehen, was Sie damit tun können; **Browse all resources** listet alle auf. Oder Sie suchen: Geben Sie ein paar Wörter ein, etwa `create incident`, und der beste Treffer steht oben. Drücken Sie `/`, um ins Suchfeld zu springen, die Pfeiltasten, um durch die Ergebnisse zu gehen, und **Enter**, um den markierten Baustein hinzuzufügen. Ein Klick auf einen Baustein fügt ihn hinzu.

Ein neuer Baustein landet unter dem untersten Baustein der Arbeitsfläche, und ein neuer Trigger nimmt oben den Platz des alten ein. Der neue Baustein ist ausgewählt, und landet er außerhalb des sichtbaren Bereichs, scrollt die Arbeitsfläche gerade so weit, dass er zu sehen ist. Seine Einstellungen öffnen sich nicht von selbst: Klicken Sie den Baustein an, wenn Sie ihn einrichten möchten. Solange seine Pflichteinstellungen leer sind, steht **Click to set up** darauf. Ziehen Sie Bausteine, wohin Sie möchten; die Arbeitsfläche rastet dabei an einem Raster ein. Die Positionen der Bausteine werden gespeichert – die nächste Person sieht also genau die Anordnung, die Sie hinterlassen haben.

Änderungen werden automatisch gespeichert. Eine Pille in der Werkzeugleiste hält das nach: **Saving…**, solange die Änderung unterwegs ist, dann **Gespeichert** oder **Konnte nicht gespeichert werden**, wenn es nicht geklappt hat. Es gibt keinen Speichern-Knopf und keinen separaten Veröffentlichungsschritt.

## Was auf einem Baustein steht

| Feld                          | Wofür es da ist                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (unter **ID**) | Die kurze ID, die auf dem Baustein steht, etwa `log-1`. Andere Bausteine beziehen sich darüber auf diesen einen – benennen Sie sie um, brechen alle `{{local.components.…}}`-Referenzen, die darauf zeigen. Die Überschrift des Bausteins ist der Name der Komponente selbst und lässt sich nicht ändern. |
| **Einstellungen**             | Was der Baustein braucht, um seine Arbeit zu tun – eine URL, einen Slack-Kanal, einen Nachrichtentext. Optionale Felder sind mit **(Optional)** gekennzeichnet; alles andere ist Pflicht. Selten gebrauchte Einstellungen liegen hinter einem Aufklappbereich **Erweitert**. |
| **Input**                     | Der Punkt an der Oberkante, an dem Linien aus früheren Bausteinen ankommen. Trigger haben keinen – vor ihnen läuft nichts.                                                                                  |
| **Outputs**                   | Die Punkte an der Unterkante, direkt darüber beschriftet, von denen Linien zu den nächsten Bausteinen ausgehen. Viele Bausteine haben getrennte Ausgänge **Erfolg** und **Fehler**, sodass Sie beide Fälle behandeln können. |

## Bausteine verbinden

Ziehen Sie von einem Punkt an der Unterkante eines Bausteins hinunter zum Punkt an der Oberkante des nächsten. Die Linie, die Sie ziehen, entscheidet, was als Nächstes läuft.

- Verbinden Sie von **Erfolg** aus, läuft der nächste Baustein nur, wenn der vorherige geklappt hat.
- Verbinden Sie von **Fehler** aus, läuft der nächste Baustein nur, wenn der vorherige fehlgeschlagen ist.
- Lassen Sie einen Ausgang unverbunden, endet dieser Pfad einfach.

Sie können einen Ausgang mit mehreren Bausteinen verbinden. Alle laufen – aber nacheinander, in einer einzigen Warteschlange, nicht parallel. Verlassen Sie sich nicht auf die Reihenfolge zwischen den Zweigen, und rechnen Sie nicht damit, dass sie sich zeitlich überschneiden. Jeder Baustein läuft höchstens einmal pro Ausführung; eine Schleife zurück zu einem früheren Baustein führt ihn also nicht ein zweites Mal aus.

## Einen Baustein konfigurieren

Klicken Sie auf einen Baustein, um seine Einstellungen in einem Dialog zu öffnen (oder springen Sie mit **Tab** zu ihm und drücken Sie **Enter**). Jede Einstellung hat das passende Eingabefeld – Textfelder, Auswahllisten, Code-Editoren, Schalter und so weiter. Füllen Sie sie aus und klicken Sie auf **Speichern**.

Im selben Dialog finden Sie außerdem:

- **Löschen** – entfernt diesen Baustein.
- **Run just this step** – führt diesen einen Baustein für sich aus, ohne den Rest des Workflows. Werte, die er aus anderen Schritten gelesen hätte, kommen leer an, und alles, was er sendet, schreibt oder löscht, passiert wirklich.
- **Dokumentation**, **Inputs**, **Outputs** und **Returns** – Referenzkarten dazu, was dieser Baustein erwartet und was er liefert.

Die meisten Textfelder nehmen Variablen entgegen – so fließen Daten von einem Baustein zum nächsten. Tippen Sie die Syntax nicht von Hand, sondern nutzen Sie die Werteauswahl im Editor: Sie baut aus dem gewählten Baustein und Feld eine korrekte Referenz. Siehe [Workflow-Variablen](/docs/workflows/variables).

## Prüfungen beim Bauen

Der Builder prüft bei jeder Änderung den gesamten Graphen und meldet das Ergebnis in einer Pille in der Werkzeugleiste. Ein Klick auf die Pille öffnet **Problems with this workflow**: Dort steht jedes Problem, und ein Klick bringt Sie zum verantwortlichen Baustein. Auf der Arbeitsfläche steht auf einem Baustein, dessen Pflichteinstellungen noch leer sind, **Click to set up**; ein Baustein mit einem anderen Problem trägt ein Abzeichen in der Ecke: rot für einen Fehler, gelb für eine Warnung. Fahren Sie mit der Maus über das Abzeichen, um zu lesen, was nicht stimmt.

Er fängt die Fehler ab, die sonst unsichtbar bleiben, bis eine Ausführung schiefgeht: kein Trigger, zwei Bausteine mit derselben ID, ein Punkt in einer ID, ein Baustein, zu dem nichts führt, eine leer gelassene Pflichteinstellung, fehlerhaftes JSON, Leerzeichen in `{{ }}` und Referenzen auf einen Schritt oder Rückgabewert, den es nicht gibt.

Eines kann er nicht prüfen: ob ein Variablenname existiert. Eine umbenannte Variable fällt erst im Ausführungsprotokoll auf.

## Ihr erster Workflow

Der schnellste Weg, ein Gefühl für die Arbeitsfläche zu bekommen:

1. Klicken Sie auf den gestrichelten Platzhalter-Baustein und dann im Panel **Add Trigger** auf **Manual**.
2. Klicken Sie auf **Komponente hinzufügen** und dann unter **Popular** auf **Log**. Der neue Baustein landet unter dem Trigger. Verbinden Sie den Punkt **Execute** des Triggers nach unten mit dem Eingangspunkt des Log-Bausteins.
3. Klicken Sie auf den Log-Baustein, auf dem **Click to set up** steht, und setzen Sie sein Feld **Wert** auf `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` ist der **Identifier** des Triggers, angezeigt auf dem Trigger-Baustein – prüfen Sie, ob er übereinstimmt.
4. Schalten Sie oben im Builder **Aktiviert** ein. Ein deaktivierter Workflow lässt sich überhaupt nicht ausführen, nicht einmal von Hand; wenn Sie diesen Schritt auslassen, fragt **Arbeitsablauf ausführen** zuerst, ob er eingeschaltet werden soll.
5. Zurück im **Builder** klicken Sie auf **Arbeitsablauf ausführen**, tragen `{ "name": "Ada" }` in das Feld **JSON** ein, klicken auf **Run Workflow Manually** und bestätigen mit **Run**.
6. Ein Panel **Workflow Run** öffnet sich von selbst und verfolgt die Ausführung. Das Protokoll zeigt `Value:` gefolgt von `Hello from Ada`.

Dieser Zyklus – hinzufügen, verbinden, konfigurieren, ausführen, Protokoll lesen – ist die Art, wie Sie jeden Workflow bauen werden.

## Den Workflow einschalten

Neue Workflows starten deaktiviert, und ebenso jeder Workflow, den Sie duplizieren oder importieren. Solange ein Workflow ausgeschaltet ist, sagt der Builder das über der Arbeitsfläche, mit der Schaltfläche **Arbeitsablauf einschalten**.

Der Schalter **Aktiviert** sitzt oben im **Builder**, neben **Komponente hinzufügen** und **Arbeitsablauf ausführen**. Sie finden ihn auch auf der Seite **Übersicht** des Workflows: Klicken Sie in der Karte **Details zum Arbeitsablauf** auf **Workflow bearbeiten**. Die Karte zeigt den aktuellen Zustand als grüne Pille **Aktiviert** oder rote Pille **Deaktiviert**. Nur wer den Workflow bearbeiten darf, kann ihn ein- oder ausschalten; alle anderen sehen den Schalter ausgegraut.

Ein deaktivierter Workflow läuft überhaupt nicht: Sein Trigger wird ignoriert, ebenso **Arbeitsablauf ausführen** und **Run just this step**. Führen Sie ihn oder einen seiner Bausteine aus, während er ausgeschaltet ist, fragt der Builder stattdessen **Diesen Arbeitsablauf einschalten?**. **Einschalten und ausführen** (bzw. **Einschalten und Schritt ausführen**) schaltet den Workflow ein und führt dann aus, was Sie verlangt haben, mit den Werten, die Sie angegeben haben. Die Reihenfolge lautet also: bauen, mit **Arbeitsablauf ausführen** testen, das Ausführungsprotokoll lesen und **Aktiviert** wieder ausschalten, falls Sie noch nicht so weit sind, dass sein Trigger feuern darf. Um einen einzelnen Baustein zu testen, ohne das Ganze laufen zu lassen, nutzen Sie **Run just this step** in dessen Einstellungen.

Alles andere, was einen deaktivierten Workflow startet, wird mit demselben Hinweis abgewiesen. Ein Aufruf seiner Webhook-URL erhält HTTP 400 und „This workflow is turned off, so it can't run. Turn it on with the Enabled switch at the top of its Builder, then try again.“ Ein **Execute Workflow**-Baustein, der ihn aufruft, nimmt seinen **Error**-Pfad, und der Fehler nennt den aufgerufenen Workflow.

Um einen Workflow zu pausieren, ohne ihn zu löschen, schalten Sie **Aktiviert** aus. Es starten keine neuen Ausführungen. Eine Ausführung, die gerade mitten drin ist, läuft zu Ende – eine, die auf einem **Sleep**-Baustein geparkt ist, wird beim Aufwachen abgebrochen und als Fehler festgehalten.

## Aufräumen

- Ziehen Sie Bausteine, um sie zu verschieben. Das Layout wird gespeichert.
- Um eine Linie zu löschen, ziehen Sie eines ihrer Enden vom Punkt weg und lassen es auf leerer Arbeitsfläche los.
- Um einen Baustein zu löschen, klicken Sie ihn an und nutzen **Löschen** unten in seinem Einstellungsdialog. Einen Baustein oder eine Linie auszuwählen und die Rücktaste zu drücken, entfernt sie ebenfalls.
- Einen einzelnen Baustein zu duplizieren, geht nicht. **Duplicate Workflow** auf der Seite **Einstellungen** des Workflows kopiert das Ganze, und die Kopie landet deaktiviert.
- Stapeln Sie Bausteine von oben nach unten, damit sie sich in ihrer Laufrichtung lesen lassen – Eingänge liegen an der Oberkante, Ausgänge an der Unterkante, der Fluss geht also von selbst nach unten.

## Weiterführende Themen

- [Workflow-Trigger](/docs/workflows/triggers) – die vier Arten, wie ein Workflow starten kann.
- [Workflow-Komponenten](/docs/workflows/components) – jeder Baustein, den Sie hinzufügen können.
- [Workflow-Variablen](/docs/workflows/variables) – Daten zwischen Bausteinen bewegen.
- [Workflow-Ausführungen](/docs/workflows/runs-and-logs) – nachsehen, was passiert ist.
