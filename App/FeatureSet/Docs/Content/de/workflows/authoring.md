# Einen Workflow erstellen

Um einen Workflow zu erstellen, öffnen Sie **Workflows** und klicken Sie auf **Create Workflow**. Ein Assistent namens **Create a workflow** führt Sie hindurch: zuerst **Start from** – wählen Sie **Start from scratch** oder eine der Vorlagen – dann **Name**, und schließlich ein **Configure**-Schritt, der nur erscheint, wenn die gewählte Vorlage eigene Einstellungen verlangt.

Sobald er erstellt ist, öffnen Sie **Builder** im linken Menü. Das ist die Arbeitsfläche, auf der Sie den Workflow gestalten.

## Die Arbeitsfläche

Ein von Grund auf neuer Workflow öffnet sich mit einem einzelnen gestrichelten Baustein mit der Aufschrift **Please click here to add trigger**. Dieser Baustein ist der Ausgangspunkt – klicken Sie ihn an, um einen Trigger zu wählen. Ein aus einer Vorlage erstellter Workflow öffnet sich mit seinen Bausteinen bereits an Ort und Stelle.

Jeder Workflow hat genau einen **Trigger** ganz oben. Alles andere ist eine **Komponente**, die etwas tut. Das Hinzufügen eines zweiten Triggers ersetzt den ersten, und das Löschen des letzten setzt den gestrichelten Platzhalter zurück.

Bausteine hinzufügen:

- **Der Trigger** – klicken Sie auf den gestrichelten Platzhalter-Baustein. Ein Panel mit dem Titel **Add Trigger** öffnet sich.
- **Alles andere** – klicken Sie in der Werkzeugleiste über der Arbeitsfläche auf **Add Component**. Dasselbe Panel öffnet sich, diesmal mit dem Titel **Add Component**.

Beide Panels sind durchsuchbar – drücken Sie `/`, um zum Suchfeld zu springen – und nach Kategorie gruppiert. Wählen Sie einen Baustein aus und klicken Sie auf **Add to Workflow**.

Neue Bausteine landen immer an derselben Stelle auf der Arbeitsfläche, sodass ein neuer möglicherweise auf etwas fällt, das Sie bereits platziert haben. Ziehen Sie ihn frei; die Arbeitsfläche rastet dabei an einem Raster ein. Baustein-Positionen werden gespeichert, sodass die nächste Person dieselbe Anordnung sieht, die Sie hinterlassen haben.

Änderungen werden automatisch gespeichert. Eine Pille in der Werkzeugleiste verfolgt das: **Saving…**, während die Änderung unterwegs ist, dann **Saved**, oder **Could not save**, wenn es nicht funktioniert hat. Es gibt keinen Speichern-Button und keinen separaten Veröffentlichungsschritt.

## Was auf einem Baustein steht

| Feld                            | Was es tut                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (unter **ID**)     | Die kurze ID, die auf dem Baustein angezeigt wird, wie `log-1`. So beziehen sich andere Bausteine auf diesen; ihn umzubenennen bricht jede `{{local.components.…}}`-Referenz, die darauf zeigt. Die Überschrift des Bausteins ist der eigene Name der Komponente und kann nicht geändert werden. |
| **Settings**                     | Was der Baustein für seine Aufgabe braucht – eine URL, einen Slack-Kanal, einen Nachrichtentext. Optionale Felder sind mit **(Optional)** gekennzeichnet; alles andere ist erforderlich. Seltener genutzte Einstellungen liegen hinter einem **Advanced**-Ausklapper. |
| **Input**                        | Der Punkt an der oberen Kante, an dem Linien von früheren Bausteinen ankommen. Trigger haben keinen – vor ihnen läuft nichts.                                                                                |
| **Outputs**                      | Die Punkte entlang der unteren Kante, direkt darüber beschriftet, an denen Linien zu den nächsten Bausteinen abgehen. Viele Bausteine haben getrennte **Success**- und **Error**-Ausgänge, damit Sie beide Fälle behandeln können. |

## Bausteine verbinden

Ziehen Sie von einem Punkt am unteren Rand eines Bausteins zum Punkt am oberen Rand des nächsten. Die gezogene Linie entscheidet, was als Nächstes läuft.

- Verbinden Sie von **Success** aus, läuft der nächste Baustein nur, wenn der vorherige erfolgreich war.
- Verbinden Sie von **Error** aus, läuft der nächste Baustein nur, wenn der vorherige fehlgeschlagen ist.
- Verbinden Sie einen Ausgang nicht, endet dieser Pfad einfach dort.

Sie können einen Ausgang mit mehreren Bausteinen verbinden. Alle laufen – aber nacheinander, in einer einzigen Warteschlange, nicht parallel. Verlassen Sie sich nicht auf die Reihenfolge zwischen Zweigen und nicht darauf, dass sie sich zeitlich überschneiden. Jeder Baustein läuft höchstens einmal pro Ausführung, sodass eine Schleife zurück zu einem früheren Baustein diesen nicht ein zweites Mal ausführt.

## Einen Baustein konfigurieren

Klicken Sie auf einen Baustein, um seine Einstellungen in einem Dialog zu öffnen. Jede Einstellung hat die passende Art von Eingabefeld – Textfelder, Dropdowns, Code-Editoren, Schalter und so weiter. Füllen Sie sie aus und klicken Sie auf **Save**.

Im selben Dialog finden Sie außerdem:

- **Delete** – diesen Baustein entfernen.
- **Run just this step** – diesen einen Baustein für sich allein ausführen, ohne den Rest des Workflows. Werte, die er von anderen Schritten gelesen hätte, kommen leer an, und alles, was er sendet, schreibt oder löscht, passiert wirklich.
- **Documentation**, **Inputs**, **Outputs** und **Returns** – Referenzkarten dafür, was dieser Baustein erwartet und erzeugt.

Die meisten Textfelder akzeptieren Variablen – so fließen Daten von einem Baustein zum nächsten. Statt die Syntax von Hand einzutippen, verwenden Sie im Editor den Werte-Picker: Er baut aus dem gewählten Baustein und Feld eine korrekte Referenz. Siehe [Workflow-Variablen](/docs/workflows/variables).

## Prüfungen während des Aufbaus

Der Builder prüft den gesamten Graphen bei jeder Änderung und meldet die Ergebnisse in einer Pille in der Werkzeugleiste. Klicken Sie auf die Pille, um **Problems with this workflow** zu öffnen, das jedes Problem auflistet und Sie zum zuständigen Baustein springen lässt. Bausteine mit einem Problem tragen außerdem ein rotes Abzeichen auf der Arbeitsfläche.

Es erkennt die Fehler, die sonst unsichtbar bleiben, bis eine Ausführung schiefgeht – kein Trigger, zwei Bausteine mit derselben ID, ein Punkt innerhalb einer ID, ein Baustein, mit dem nichts verbunden ist, eine erforderliche Einstellung, die leer gelassen wurde, fehlerhaftes JSON, Leerzeichen innerhalb von `{{ }}`, und Referenzen auf einen Schritt oder Rückgabewert, den es nicht gibt.

Eine Sache kann es nicht prüfen: ob ein Variablenname existiert. Eine umbenannte Variable zeigt sich erst im Ausführungsprotokoll.

## Ihr erster Workflow

Der schnellste Weg, ein Gefühl für die Arbeitsfläche zu bekommen:

1. Klicken Sie auf den gestrichelten Platzhalter-Baustein, wählen Sie **Manual** im Panel **Add Trigger** und klicken Sie auf **Add to Workflow**.
2. Klicken Sie auf **Add Component**, wählen Sie **Log** (unter **Utils**) und klicken Sie auf **Add to Workflow**. Ziehen Sie den neuen Baustein vom Trigger weg, und verbinden Sie dann den **Execute**-Punkt des Triggers mit dem Eingangspunkt des Log-Bausteins.
3. Öffnen Sie den Log-Baustein und setzen Sie sein Feld **Value** auf `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` ist der **Identifier** des Triggers, angezeigt auf dem Trigger-Baustein – prüfen Sie, ob er übereinstimmt.
4. Gehen Sie zu **Overview**, klicken Sie auf **Edit Workflow** auf der Karte **Workflow Details**, und schalten Sie **Enabled** ein. Ein deaktivierter Workflow kann überhaupt nicht ausgeführt werden, auch nicht von Hand.
5. Klicken Sie zurück im **Builder** auf **Run Workflow**, tragen Sie `{ "name": "Ada" }` in das Feld **JSON** ein, klicken Sie auf **Run Workflow Manually** und bestätigen Sie mit **Run**.
6. Ein Panel **Workflow Run** öffnet sich von selbst und verfolgt die Ausführung. Das Protokoll zeigt `Value:` gefolgt von `Hello from Ada`.

Dieser Kreislauf – hinzufügen, verbinden, konfigurieren, ausführen, das Protokoll lesen – ist, wie Sie jeden Workflow bauen werden.

## Einschalten

Neue Workflows starten deaktiviert, ebenso jeder Workflow, den Sie duplizieren oder importieren.

Der Schalter **Enabled** befindet sich auf der **Overview**-Seite des Workflows, in der Karte **Workflow Details** – nicht auf der Settings-Seite. Dieselbe Karte zeigt den aktuellen Zustand als grüne **Enabled**- oder rote **Disabled**-Pille.

Ein deaktivierter Workflow kann überhaupt nicht laufen. Manuelle Ausführungen werden mit „This workflow is not enabled" abgelehnt, genau wie ausgelöste – die Reihenfolge lautet also: aktivieren, mit **Run Workflow** testen, das Ausführungsprotokoll lesen, und **Enabled** wieder ausschalten, wenn Sie noch nicht bereit sind, dass sein Trigger auslöst. Um einen einzelnen Baustein zu testen, ohne das Ganze auszuführen, verwenden Sie **Run just this step** in den Einstellungen dieses Bausteins.

Um einen Workflow zu pausieren, ohne ihn zu löschen, schalten Sie **Enabled** aus. Es starten keine neuen Ausführungen. Eine Ausführung, die gerade läuft, wird abgeschlossen, aber eine, die bei einem **Sleep**-Baustein pausiert, wird beim Aufwachen abgebrochen und als Fehler protokolliert.

## Aufräumen

- Ziehen Sie Bausteine, um sie zu verschieben. Das Layout wird gespeichert.
- Um eine Linie zu löschen, ziehen Sie eines ihrer Enden vom Punkt weg und legen Sie es auf leerer Arbeitsfläche ab.
- Um einen Baustein zu löschen, klicken Sie ihn an und verwenden Sie **Delete** unten in seinem Einstellungsdialog. Einen Baustein oder eine Linie auszuwählen und Rücktaste zu drücken, entfernt ihn ebenfalls.
- Es gibt keine Möglichkeit, einen einzelnen Baustein zu duplizieren. **Duplicate Workflow** auf der **Settings**-Seite des Workflows kopiert das Ganze, und die Kopie landet deaktiviert.
- Stapeln Sie Bausteine von oben nach unten, sodass sie sich in der Richtung lesen lassen, in der sie ausgeführt werden – Eingänge liegen an der oberen Kante, Ausgänge an der unteren, sodass der Fluss natürlich nach unten geht.

## Weiterführende Themen

- [Workflow-Trigger](/docs/workflows/triggers) – die vier Wege, wie ein Workflow starten kann.
- [Workflow-Komponenten](/docs/workflows/components) – jeder Baustein, den Sie hinzufügen können.
- [Workflow-Variablen](/docs/workflows/variables) – Daten zwischen Bausteinen bewegen.
- [Workflow-Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – nachvollziehen, was passiert ist.
