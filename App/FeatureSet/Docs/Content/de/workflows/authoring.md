# Einen Workflow erstellen

Um einen Workflow anzulegen, öffnen Sie **Arbeitsabläufe** und klicken auf **Workflow erstellen**. Ein Assistent namens **Create a workflow** führt Sie hindurch: zuerst **Start from** – wählen Sie **Start from scratch** oder eine der Vorlagen –, dann **Name**, und zum Schluss ein Schritt **Konfigurieren**, der nur auftaucht, wenn die gewählte Vorlage eigene Einstellungen verlangt.

Sobald er angelegt ist, öffnen Sie **Builder** im linken Menü. Das ist die Arbeitsfläche, auf der Sie den Workflow entwerfen.

## Die Arbeitsfläche

Ein von Grund auf neuer Workflow öffnet sich mit einem einzigen gestrichelten Baustein mit der Aufschrift **Please click here to add trigger**. Dieser Baustein ist der Startpunkt – klicken Sie ihn an, um einen Trigger auszuwählen. Ein aus einer Vorlage erstellter Workflow öffnet sich mit bereits gesetzten Bausteinen.

Jeder Workflow hat ganz oben genau einen **Trigger**. Alles andere ist eine **Komponente**, die etwas tut. Ein zweiter Trigger ersetzt den ersten, und wenn Sie den letzten löschen, kommt der gestrichelte Platzhalter zurück.

Bausteine hinzufügen:

- **Der Trigger** – klicken Sie auf den gestrichelten Platzhalter-Baustein. Es öffnet sich ein Panel mit dem Titel **Add Trigger**.
- **Alles andere** – klicken Sie in der Werkzeugleiste über der Arbeitsfläche auf **Komponente hinzufügen**. Dasselbe Panel öffnet sich, betitelt mit **Komponente hinzufügen**.

Beide Panels lassen sich durchsuchen – drücken Sie `/`, um ins Suchfeld zu springen – und sind nach Kategorien gruppiert. Wählen Sie einen Baustein aus und klicken Sie auf **Add to Workflow**.

Neue Bausteine landen immer an derselben Stelle der Arbeitsfläche, ein neuer kann also auf etwas fallen, das Sie bereits platziert haben. Ziehen Sie ihn beiseite; die Arbeitsfläche rastet dabei an einem Raster ein. Die Positionen der Bausteine werden gespeichert – die nächste Person sieht also genau die Anordnung, die Sie hinterlassen haben.

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

Klicken Sie auf einen Baustein, um seine Einstellungen in einem Dialog zu öffnen. Jede Einstellung hat das passende Eingabefeld – Textfelder, Auswahllisten, Code-Editoren, Schalter und so weiter. Füllen Sie sie aus und klicken Sie auf **Speichern**.

Im selben Dialog finden Sie außerdem:

- **Löschen** – entfernt diesen Baustein.
- **Run just this step** – führt diesen einen Baustein für sich aus, ohne den Rest des Workflows. Werte, die er aus anderen Schritten gelesen hätte, kommen leer an, und alles, was er sendet, schreibt oder löscht, passiert wirklich.
- **Dokumentation**, **Inputs**, **Outputs** und **Returns** – Referenzkarten dazu, was dieser Baustein erwartet und was er liefert.

Die meisten Textfelder nehmen Variablen entgegen – so fließen Daten von einem Baustein zum nächsten. Tippen Sie die Syntax nicht von Hand, sondern nutzen Sie die Werteauswahl im Editor: Sie baut aus dem gewählten Baustein und Feld eine korrekte Referenz. Siehe [Workflow-Variablen](/docs/workflows/variables).

## Prüfungen beim Bauen

Der Builder prüft bei jeder Änderung den gesamten Graphen und meldet das Ergebnis in einer Pille in der Werkzeugleiste. Ein Klick auf die Pille öffnet **Problems with this workflow**: Dort steht jedes Problem, und ein Klick bringt Sie zum verantwortlichen Baustein. Bausteine mit einem Problem tragen zusätzlich ein rotes Abzeichen auf der Arbeitsfläche.

Er fängt die Fehler ab, die sonst unsichtbar bleiben, bis eine Ausführung schiefgeht: kein Trigger, zwei Bausteine mit derselben ID, ein Punkt in einer ID, ein Baustein, zu dem nichts führt, eine leer gelassene Pflichteinstellung, fehlerhaftes JSON, Leerzeichen in `{{ }}` und Referenzen auf einen Schritt oder Rückgabewert, den es nicht gibt.

Eines kann er nicht prüfen: ob ein Variablenname existiert. Eine umbenannte Variable fällt erst im Ausführungsprotokoll auf.

## Ihr erster Workflow

Der schnellste Weg, ein Gefühl für die Arbeitsfläche zu bekommen:

1. Klicken Sie auf den gestrichelten Platzhalter-Baustein, wählen Sie im Panel **Add Trigger** den Eintrag **Manual** und klicken Sie auf **Add to Workflow**.
2. Klicken Sie auf **Komponente hinzufügen**, wählen Sie **Log** (unter **Utils**) und klicken Sie auf **Add to Workflow**. Ziehen Sie den neuen Baustein vom Trigger weg und verbinden Sie dann den Punkt **Execute** des Triggers nach unten mit dem Eingangspunkt des Log-Bausteins.
3. Öffnen Sie den Log-Baustein und setzen Sie sein Feld **Wert** auf `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` ist der **Identifier** des Triggers, angezeigt auf dem Trigger-Baustein – prüfen Sie, ob er übereinstimmt.
4. Gehen Sie auf **Übersicht**, klicken Sie auf der Karte **Details zum Arbeitsablauf** auf **Workflow bearbeiten** und schalten Sie **Aktiviert** ein. Ein deaktivierter Workflow lässt sich überhaupt nicht ausführen, nicht einmal von Hand.
5. Zurück im **Builder** klicken Sie auf **Arbeitsablauf ausführen**, tragen `{ "name": "Ada" }` in das Feld **JSON** ein, klicken auf **Run Workflow Manually** und bestätigen mit **Run**.
6. Ein Panel **Workflow Run** öffnet sich von selbst und verfolgt die Ausführung. Das Protokoll zeigt `Value:` gefolgt von `Hello from Ada`.

Dieser Zyklus – hinzufügen, verbinden, konfigurieren, ausführen, Protokoll lesen – ist die Art, wie Sie jeden Workflow bauen werden.

## Den Workflow einschalten

Neue Workflows starten deaktiviert, und ebenso jeder Workflow, den Sie duplizieren oder importieren.

Der Schalter **Aktiviert** sitzt auf der Seite **Übersicht** des Workflows, in der Karte **Details zum Arbeitsablauf** – nicht auf der Einstellungsseite. Dieselbe Karte zeigt den aktuellen Zustand als grüne Pille **Aktiviert** oder rote Pille **Deaktiviert**.

Ein deaktivierter Workflow läuft überhaupt nicht. Manuelle Ausführungen werden mit „This workflow is not enabled“ genauso abgelehnt wie ausgelöste. Die Reihenfolge lautet also: einschalten, mit **Arbeitsablauf ausführen** testen, das Ausführungsprotokoll lesen und **Aktiviert** wieder ausschalten, falls Sie noch nicht so weit sind, dass sein Trigger feuern darf. Um einen einzelnen Baustein zu testen, ohne das Ganze laufen zu lassen, nutzen Sie **Run just this step** in dessen Einstellungen.

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
- [Workflow-Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – nachsehen, was passiert ist.
