# Workflow erstellen

Um einen Workflow zu erstellen, öffnen Sie **Workflows → Workflow erstellen**, geben Sie ihm einen Namen und klicken Sie auf den Tab **Builder**. Sie sehen eine leere Arbeitsfläche, auf der Sie die Automatisierung aufbauen.

## Die Arbeitsfläche

Der Builder ist eine Drag-and-drop-Arbeitsfläche. Sie fügen Bausteine aus der Palette an der Seite hinzu, verbinden sie mit Linien und klicken auf jeden Baustein, um seine Funktion zu konfigurieren. Änderungen werden automatisch gespeichert – oben sehen Sie eine Anzeige, sobald sie übernommen wurden.

Jeder Workflow beginnt mit genau einem **Auslöser** am Anfang. Alles Weitere sind **Komponenten**, die etwas tun.

## Was auf einem Baustein zu sehen ist

| Feld | Funktion |
| --- | --- |
| **Titel** | Der auf der Arbeitsfläche angezeigte Name. Benennen Sie ihn um, damit komplexe Workflows leichter lesbar werden. |
| **Einstellungen** | Was der Baustein braucht, um seine Aufgabe zu erledigen – eine URL, ein Slack-Kanal, ein Nachrichtentext usw. Pflichtfelder sind mit einem Sternchen markiert. |
| **Eingang** | Der Punkt links, an dem Linien aus früheren Bausteinen ankommen. |
| **Ausgänge** | Die Punkte rechts, von denen Linien zu den nächsten Bausteinen führen. Viele Bausteine haben getrennte Ausgänge für **Erfolg** und **Fehler**, damit Sie beide Fälle behandeln können. |

## Bausteine verbinden

Ziehen Sie vom Ausgangspunkt eines Bausteins zum Eingangspunkt des nächsten Bausteins. Die gezogene Linie legt fest, was als Nächstes ausgeführt wird.

- Wenn Sie aus **Erfolg** heraus verbinden, läuft der nächste Baustein nur, wenn der vorherige geklappt hat.
- Wenn Sie aus **Fehler** heraus verbinden, läuft der nächste Baustein nur, wenn der vorherige fehlgeschlagen ist.
- Wenn Sie einen Ausgang nicht verbinden, endet dieser Pfad einfach.

Sie können einen Ausgang mit mehreren Bausteinen verbinden. Sie laufen dann ab diesem Punkt alle gleichzeitig.

## Einen Baustein konfigurieren

Klicken Sie auf einen Baustein, um seine Einstellungen seitlich zu öffnen. Jede Einstellung hat den passenden Eingabetyp – Textfelder, Dropdowns, Code-Editoren, Schalter usw.

Die meisten Textfelder akzeptieren Variablen – so fließen Daten von einem Baustein zum nächsten. Die Syntax finden Sie unter [Variablen](/docs/workflows/variables).

## Ihr erster Workflow

So lernen Sie die Arbeitsfläche am schnellsten kennen:

1. Ziehen Sie einen **Manuell**-Auslöser auf die Arbeitsfläche.
2. Ziehen Sie eine **Log**-Komponente (unter **Utils**) daneben. Verbinden Sie den Auslöser mit der Log-Komponente.
3. Geben Sie im Nachrichtenfeld des Log-Bausteins `Hello from {{Manual.JSON.name}}` ein.
4. Speichern Sie und aktivieren Sie den Workflow.
5. Klicken Sie auf **Manuell ausführen**, fügen Sie `{ "name": "Ada" }` als Eingabe ein und senden Sie ab.
6. Öffnen Sie den Tab **Logs**. Die neueste Ausführung zeigt `Hello from Ada`.

Dieser Ablauf – ziehen, verbinden, konfigurieren, ausführen, das Log prüfen – ist die Grundlage für jeden Workflow, den Sie bauen.

## Speichern und aktivieren

Die Arbeitsfläche speichert sich beim Arbeiten von selbst. Es gibt keinen separaten Schritt zum „Veröffentlichen".

Ein Workflow läuft jedoch nur tatsächlich, wenn **Aktiviert** in den Einstellungen eingeschaltet ist. Neue Workflows starten deaktiviert. Nutzen Sie diesen Schalter als Sicherheitsnetz – bauen, mit **Manuell ausführen** testen, Logs prüfen, dann aktivieren.

Um einen Workflow zu pausieren, ohne ihn zu löschen, schalten Sie **Aktiviert** aus. Bereits laufende Ausführungen werden zu Ende geführt, neue starten nicht mehr.

## Aufräumen

- Bausteine lassen sich durch Ziehen verschieben. Das Layout wird gespeichert, sodass die nächste Person dieselbe Anordnung sieht.
- Klicken Sie mit der rechten Maustaste auf eine Linie, um sie zu löschen. Klicken Sie mit der rechten Maustaste auf einen Baustein, um ihn zu löschen oder zu duplizieren.
- Bei breiten Workflows ordnen Sie die Bausteine von links nach rechts an, sodass sie in derselben Richtung gelesen werden, in der sie ausgeführt werden.

## Weiterführende Themen

- [Auslöser](/docs/workflows/triggers) – die vier Wege, einen Workflow zu starten.
- [Komponenten](/docs/workflows/components) – jeder Baustein, den Sie hinzufügen können.
- [Variablen](/docs/workflows/variables) – Daten zwischen Bausteinen weitergeben.
- [Ausführungen & Logs](/docs/workflows/runs-and-logs) – nachvollziehen, was passiert ist.
