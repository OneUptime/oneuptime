# Ausführungen & Logs

Bei jeder Ausführung eines Workflows speichert OneUptime einen Datensatz darüber, was passiert ist – wann der Workflow lief, ob er erfolgreich war und was jeder Baustein getan hat. Dieser Datensatz heißt **Ausführung**. Ausführungen sind Ihr Weg, eine erfolgreiche Ausführung zu bestätigen, eine fehlgeschlagene zu debuggen und vergangene Aktivitäten nachzuschlagen.

## Wo Sie sie finden

| Seite | Was Sie sehen |
| --- | --- |
| **Workflows → Ausführungen & Logs** | Jede Ausführung aus jedem Workflow im Projekt. Filterbar nach Workflow, Status und Zeit. |
| **Workflow → Logs-Tab** | Nur die Ausführungen dieses einen Workflows. |
| **Eine einzelne Ausführung** | Eine Ausführung mit der Ausgabe jedes Bausteins. |

## Ausführungsstatus

| Status | Bedeutung |
| --- | --- |
| **Geplant** | Der Auslöser hat gefeuert und die Ausführung steht kurz vor dem Start. Dauert üblicherweise nur den Bruchteil einer Sekunde. |
| **Läuft** | Der Workflow ist in Bearbeitung. Lang laufende Bausteine halten eine Ausführung in diesem Zustand. |
| **Erfolg** | Jeder ausgeführte Baustein wurde fehlerfrei abgeschlossen. (Absichtlich einen **Fehler**-Zweig zu nehmen, zählt weiterhin als Erfolg – der Workflow selbst ist nicht fehlgeschlagen.) |
| **Fehler** | Ein Baustein ist fehlgeschlagen und es gab keinen verbundenen **Fehler**-Pfad, um damit umzugehen. Die Ausführung wurde dort gestoppt. |
| **Zeitüberschreitung** | Die Ausführung lief länger als erlaubt. Siehe [Konfiguration & Sicherheit](/docs/workflows/configuration). |

## Eine Ausführung lesen

Klicken Sie auf eine Ausführung, um die Details zu öffnen. Sie sehen:

- **Kopfzeile** – Auslöser, Start- und Endzeit, Gesamtdauer und Status.
- **Bausteinliste** – jeder ausgeführte Baustein, in der Reihenfolge. Jeder zeigt die Eingabewerte, seine Ausgabe und den genommenen Pfad.
- **Fehler** – falls ein Baustein fehlgeschlagen ist, die Fehlermeldung und (sofern verfügbar) weitere Details.

Die angezeigten Werte sind genau das, was der Baustein gesehen hat – nachdem alle Variablen eingesetzt wurden. Das ist die mit Abstand nützlichste Debug-Ansicht: Wenn eine Slack-Nachricht den wörtlichen Text `{{Incident.title}}` statt des tatsächlichen Titels zeigt, wissen Sie, dass die Variable nicht aufgelöst wurde.

## Häufige Fehlersuche

### „Mein Workflow ist nicht gelaufen."

1. Stellen Sie sicher, dass der Workflow in den Einstellungen **aktiviert** ist. Neue Workflows starten deaktiviert.
2. Bei einem OneUptime-Ereignis-Auslöser: prüfen Sie, ob das Ereignis tatsächlich stattgefunden hat. Öffnen Sie den Datensatz und schauen Sie in seinen Verlauf.
3. Bei einem Webhook-Auslöser: prüfen Sie, ob das andere System wirklich an die richtige URL sendet. Die meisten Tools protokollieren, wann sie einen Webhook abgesendet haben – schauen Sie dort.
4. Bei einem Zeitplan-Auslöser: prüfen Sie, ob der cron-Ausdruck mit der erwarteten Zeit übereinstimmt.

Wenn der Auslöser ausgelöst hat, aber keine Ausführung erscheint, prüfen Sie Ihr Ausführungskontingent unter **Projekteinstellungen → Abrechnung**.

### „Ein späterer Baustein wurde nie ausgeführt."

Ein Baustein, der nicht läuft, deutet meistens auf ein Verkabelungsproblem hin. Öffnen Sie die Arbeitsfläche und prüfen Sie:

- Ist der Ausgang des vorherigen Bausteins mit dem Eingang dieses Bausteins verbunden?
- Hat der vorherige Baustein einen anderen Ausgang genommen als erwartet (zum Beispiel **Fehler** statt **Erfolg** oder **Nein** statt **Ja**)? Die Detailansicht zeigt, welcher Pfad genommen wurde.

### „Eine Variable kam leer durch."

Öffnen Sie die Ausführung und sehen Sie sich die Werte des fehlerhaften Bausteins an.

- Wenn Sie den wörtlichen Text `{{BlockName.field}}` sehen, wurde die Referenz nicht aufgelöst – wahrscheinlich ein Tippfehler im Bausteinnamen oder Feldnamen.
- Wenn Sie eine leere Zeichenkette sehen, wurde der vorherige Baustein zwar ausgeführt, hat aber dieses Feld nicht erzeugt.

### „Funktioniert beim manuellen Start, aber nicht über den Auslöser."

Nutzen Sie **Manuell ausführen** mit einer JSON-Payload, die dem entspricht, was der echte Auslöser sendet. Vergleichen Sie dann die Werte der manuellen Ausführung mit denen der echten Ausführung Seite an Seite. Der Unterschied liegt meist in einem einzelnen Feldnamen oder Datentyp.

## Einen Workflow erneut ausführen

Es gibt keinen Knopf „diese Ausführung wiederholen". Alte Ausführungen werden nicht automatisch wiederholt, weil die Nebeneffekte (Slack-Nachrichten, API-Aufrufe, Tickets) eventuell nicht gefahrlos wiederholbar sind. Um die Arbeit erneut zu erledigen, korrigieren Sie den Workflow und lassen den nächsten echten Auslöser ihn ausführen.

Bei manuellen Workflows klicken Sie einfach mit derselben Payload erneut auf **Manuell ausführen**.

## Wie lange werden Ausführungen aufbewahrt?

Ausführungen werden für das Projekt unbegrenzt aufbewahrt. Wenn ein Workflow sehr häufig läuft und Ihren Verlauf überfüllt (zum Beispiel ein Debug-Workflow, der jede Minute startet), deaktivieren oder löschen Sie ihn, damit das Rauschen nicht weiter wächst.

## Weiterführende Themen

- [Konfiguration & Sicherheit](/docs/workflows/configuration) – Zeitüberschreitungen, Rekursionslimits, versteckte Geheimnisse.
- [Variablen](/docs/workflows/variables) – die in Ihren Bausteinen verwendete Variablensyntax.
- [Komponenten](/docs/workflows/components) – was jeder Baustein erzeugt.
