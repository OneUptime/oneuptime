# Einen Workflow erstellen

Erstellen Sie einen Workflow unter **Workflows → Workflow erstellen**, geben Sie ihm einen Namen und eine optionale Beschreibung, und öffnen Sie dann den **Builder**-Tab, um Knoten auf die Arbeitsfläche zu ziehen.

## Die Arbeitsfläche

Der Builder ist ein zoom- und schwenkbarer Graph. Sie fügen Knoten aus einer Komponentenpalette hinzu, verbinden sie mit Kanten und konfigurieren die Argumente jedes Knotens in einem Seitenpanel. Ein Speicheranzeiger in der Kopfzeile sagt Ihnen, ob Ihre letzte Bearbeitung persistiert wurde.

Ein Workflow beginnt immer mit genau einem **Trigger**-Knoten. Trigger haben keinen Eingabeport — hier beginnt die Ausführung. Alles, was nachgelagert ist, ist eine **Komponente**.

## Anatomie eines Knotens

Jeder Knoten hat:

| Feld | Zweck |
| --- | --- |
| **Titel** | Die auf der Arbeitsfläche angezeigte Beschriftung. Standardmäßig der Komponentenname; überschreiben Sie ihn, um komplexe Workflows lesbarer zu machen. |
| **Argumente** | Die Konfiguration, die die Komponente benötigt, um ihre Arbeit zu erledigen — eine URL, ein Slack-Kanal, ein JavaScript-Snippet usw. Pflichtargumente sind mit einem Sternchen markiert. |
| **Eingabeports** | Buchsen auf der linken Seite des Knotens, wo eingehende Kanten landen. Komponenten haben einen Eingabeport namens `in`; Trigger haben keinen. |
| **Ausgabeports** | Buchsen auf der rechten Seite, wo ausgehende Kanten beginnen. Komponenten definieren Ports wie `success`, `error`, `yes`, `no`. |
| **Rückgabewerte** | Daten, die der Knoten erzeugt — die Payloads seiner Ausgabeports. Nachgelagerte Knoten referenzieren diese als `{{NodeId.fieldName}}`. |

## Knoten verbinden

Ziehen Sie von einem Ausgabeport zum Eingabeport eines nachgelagerten Knotens, um eine Kante zu erstellen. Eine Kante von `success` führt diesen Zweig nur dann aus, wenn der vorgelagerte Knoten erfolgreich war; eine Kante von `error` führt ihn nur dann aus, wenn er fehlgeschlagen ist. Wenn Sie einen Port nicht verbinden, endet dieser Zweig einfach.

Sie können verzweigen: ein Ausgabeport kann mehrere nachgelagerte Knoten speisen, und sie alle laufen ab diesem Punkt parallel.

## Argumente konfigurieren

Klicken Sie auf einen Knoten, um sein Seitenpanel zu öffnen. Jedes Argument hat einen typisierten Editor:

- **Text / URL / E-Mail / Zahl / Passwort** — eine einzeilige Eingabe.
- **JSON** — ein JSON-Editor mit Syntaxhervorhebung und Validierungsanzeige.
- **JavaScript** — ein Code-Editor für Snippets, die von der **Custom Code**-Komponente verwendet werden.
- **Markdown / HTML** — Rich-Text-Bodys für E-Mail- und Nachrichtenkomponenten.
- **CronTab** — ein Zeitplan-Ausdruck (verwendet vom Schedule-Trigger).
- **Boolean** — ein Umschalter.
- **Select / Query** — Dropdowns für Felder, die einen festen Satz an Werten oder eine Modell-artige Abfrage akzeptieren.

Jedes Textfeld akzeptiert Variableninterpolation — siehe [Variablen](/docs/workflows/variables) für die Regeln.

## Ein minimaler erster Workflow

Der schnellste Weg, die Arbeitsfläche zu erleben:

1. Einen **Manual**-Trigger ablegen.
2. Eine **Log**-Komponente ablegen (unter **Utils**). Verbinden Sie den Ausgabeport des Triggers mit dem Eingabeport der Log-Komponente.
3. In das Argument der Log-Komponente eingeben: `Hello from {{Manual.JSON.name}}`.
4. Speichern und den Workflow aktivieren.
5. Klicken Sie auf **Manuell ausführen**, fügen Sie `{ "name": "Ada" }` als Eingabe ein und senden Sie ab.
6. Öffnen Sie den **Logs**-Tab. Die letzte Ausführung zeigt die erfasste Ausgabe des Log-Knotens: `Hello from Ada`.

Dieser Rundlauf — ziehen, verkabeln, konfigurieren, ausführen, prüfen — ist der Rhythmus beim Erstellen jedes Workflows.

## Speichern, aktivieren und in Produktion testen

Workflows werden als JSON-Graph in der Spalte `Workflow.graph` gespeichert. Der Builder speichert während Sie bearbeiten; der Speicheranzeiger in der Kopfzeile zeigt, wann die letzte Änderung den Server erreicht hat. Es gibt keinen separaten „Veröffentlichen"-Schritt.

Aber: Ein Workflow feuert seinen Trigger nur, wenn **isEnabled** eingeschaltet ist. Neue Workflows werden deaktiviert ausgeliefert. Behandeln Sie dieses Flag als Ihren „bereit für die Produktion"-Schalter — bauen, auf **Manuell ausführen** klicken, um mit einem Beispiel-Payload einen Trockenlauf zu machen, in die **Logs** schauen und erst dann „Enable" einschalten.

Wenn Sie einen Workflow pausieren müssen, ohne ihn zu löschen (z. B. während eines nicht verwandten Vorfalls), schalten Sie **isEnabled** in den **Einstellungen** aus. Bereits laufende Ausführungen werden fortgesetzt; es werden keine neuen gestartet.

## Neu anordnen und reorganisieren

- Ziehen Sie einen Knoten, um ihn neu zu positionieren. Die Position wird im Graphen gespeichert, sodass die nächste Person, die die Arbeitsfläche öffnet, dasselbe Layout sieht.
- Rechtsklicken Sie auf eine Kante, um sie zu löschen; rechtsklicken Sie auf einen Knoten für Lösch- und Duplikat-Optionen.
- Bei breiten Workflows legen Sie sie von links nach rechts an, damit die Ausführungsrichtung Ihrer Leserichtung entspricht.

## Wo weiterlesen

- [Trigger](/docs/workflows/triggers) — die vier Trigger-Familien und was jede als Rückgabewerte bereitstellt.
- [Komponenten](/docs/workflows/components) — der vollständige Katalog und ihre Argumente.
- [Variablen](/docs/workflows/variables) — wie Daten zwischen Knoten und aus globalen Variablen referenziert werden.
- [Ausführungen & Protokolle](/docs/workflows/runs-and-logs) — wie ein sich fehlverhaltender Workflow debuggt wird.
