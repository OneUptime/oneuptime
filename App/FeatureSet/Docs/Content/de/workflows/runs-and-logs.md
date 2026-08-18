# Ausführungen & Protokolle

Bei jeder Ausführung eines Workflows speichert OneUptime einen Datensatz darüber, was passiert ist – wann er lief, ob er erfolgreich war und was jeder Baustein getan hat. Dieser Datensatz wird **Ausführung** genannt. Ausführungen sind Ihr Mittel, um zu bestätigen, dass ein Workflow funktioniert hat, eine fehlgeschlagene zu debuggen und vergangene Aktivitäten nachzuschlagen.

## Wo Sie sie finden

| Seite                                          | Was Sie sehen                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Arbeitsabläufe → Ausführungen & Protokolle** | Jede Ausführung aus jedem Workflow im Projekt. Filterbar nach Workflow-Name, Status und Zeit.        |
| **Arbeitsablauf → Ausführungen & Protokolle**  | Nur die Ausführungen dieses einen Workflows. Hier gibt es statt eines Workflow-Filters einen **Ausführungs-ID**-Filter. |
| **Eine einzelne Ausführung**                   | Wird mit der Schaltfläche **Protokolle anzeigen** in einer Ausführungszeile geöffnet – die Zeilen selbst sind nicht anklickbar. |

## Ausführungsstatus

| Status                             | Bedeutung                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled**                      | Der Auslöser hat gefeuert und die Ausführung wartet auf einen Runner. Normalerweise nur den Bruchteil einer Sekunde. Eine Ausführung, die nach 5 Minuten noch **Scheduled** ist, gilt als fehlgeschlagen – niemand hat sie übernommen. |
| **Running**                        | Der Workflow ist in Bearbeitung. Lang laufende Bausteine halten eine Ausführung in diesem Zustand.                                                                                |
| **Waiting**                        | Die Ausführung wartet an einem **Sleep**-Baustein und wird von selbst fortgesetzt. Während sie wartet, belegt sie keinen Worker.                                                      |
| **Executed**                       | Die Ausführung hat das Ende erreicht, ohne fehlzuschlagen. (Das ist der Erfolgszustand – die Statusanzeige zeigt **Executed**, nicht „Success".)                                        |
| **Error**                          | Die Ausführung wurde gestoppt, weil ein Baustein einen Fehler ausgelöst hat. Wird auch verwendet, wenn eine eingereihte Ausführung nie übernommen wird, wenn die Fortsetzung einer wartenden Ausführung verloren geht, wenn ein Zeitplan-Ausdruck nicht aufgelöst werden kann, oder wenn der Workflow mitten in der Ausführung deaktiviert wird. |
| **Timeout**                        | Die Ausführung lief länger als erlaubt. Siehe [Konfiguration & Sicherheit](/docs/workflows/configuration).                                                              |
| **Execution Exceeded Current Plan** | Das Projekt hat sein Kontingent an Workflow-Ausführungen für die letzten 30 Tage aufgebraucht, oder das Abonnement ist unbezahlt. Die Ausführung wird aufgezeichnet, aber nicht ausgeführt. Nur bei OneUptime Cloud. |

Ein Baustein, der über seinen **Fehler**-Ausgang weitergibt – etwa ein API-Baustein bei einem 4xx – lässt die Ausführung nicht fehlschlagen. Der Fehlerzweig läuft, und die Ausführung endet trotzdem mit **Executed**. Der Schritt selbst wird dennoch rot dargestellt, damit Sie ihn finden können.

## Eine Ausführung lesen

Klicken Sie in einer Ausführung auf **Protokolle anzeigen**, um sie zu öffnen. Die Ansicht **Workflow Run** hat zwei Tabs.

**Schritte** — eine Zeile pro ausgeführtem Baustein, in der Reihenfolge. Jede Zeile zeigt den Titel des Bausteins, seine Komponenten-ID, wie lange er gebraucht hat, und über welchen Ausgang er verlassen wurde (`→ success`, `→ error`, `→ yes`). Klappen Sie eine Zeile auf für zwei Detailblöcke:

- **Received** — die Einstellungen, die der Baustein erhalten hat, nachdem alle Variablen aufgelöst wurden.
- **Returned** — was er erzeugt hat.

Fehlgeschlagene Schritte sind rot und beginnen aufgeklappt, mit der Fehlermeldung oberhalb von **Received**.

**Full Log** — das rohe, zeilenweise Protokoll, das der Runner ausgegeben hat, einschließlich allem, was die Bausteine selbst geloggt haben. Nutzen Sie es, wenn die Ansicht **Schritte** den Fehler nicht erklärt.

Zwei Details, die es zu wissen lohnt. Die Komponenten-ID, die unter jedem Schritttitel angezeigt wird, ist genau die Zeichenkette, die Sie in eine `{{local.components.<id>.returnValues.…}}`-Referenz einfügen – das ist der schnellste Weg, eine Referenz korrekt zu bekommen. Und eine Ausführung behält nur ihre letzten 100 Schritte – eine lange oder wiederholt fortgesetzte Ausführung zeigt einen gelben Hinweis dort, wo die früheren Schritte verworfen wurden.

Die angezeigten Werte sind das, was der Baustein gesehen hat, nachdem die Variablen eingesetzt wurden – mit zwei Ausnahmen: Geheimnisse und Felder, die der Baustein als sensibel markiert, werden geschwärzt, und sehr lange Werte werden mit „… (truncated)" gekürzt.

Wenn Sie eine Ausführung aus dem **Builder** starten, öffnet sich dieselbe Ansicht und folgt der Ausführung bereits automatisch – so können Sie live zusehen, statt sie hinterher zu suchen.

## Häufige Fehlersuche

### „Mein Workflow ist nicht gelaufen."

1. Stellen Sie sicher, dass der Workflow auf seiner Seite **Übersicht** auf **Aktiviert** steht. Neue Workflows starten deaktiviert, und ein deaktivierter Workflow lehnt jede Ausführung ab – auch manuelle.
2. Bei einem OneUptime-Ereignis-Auslöser: Prüfen Sie, ob das Ereignis tatsächlich stattgefunden hat. Öffnen Sie den Datensatz und schauen Sie in seinen Verlauf.
3. Bei einem Webhook-Auslöser: Prüfen Sie, ob das andere System an die richtige URL sendet. Die meisten Tools protokollieren, wann sie einen Webhook senden – schauen Sie dort nach.
4. Bei einem Zeitplan-Auslöser: Prüfen Sie, ob der Cron-Ausdruck mit der erwarteten Zeit übereinstimmt.

Wenn die Ausführung *doch* erscheint, aber mit dem Status **Execution Exceeded Current Plan**, hat das Projekt alle seine Workflow-Ausführungen für die letzten 30 Tage aufgebraucht, oder das Abonnement ist unbezahlt. Das Protokoll der Ausführung nennt die Anzahl und das Limit Ihres Plans. Dies gilt nur für OneUptime Cloud.

### „Ein späterer Baustein wurde nie ausgeführt."

Ein Baustein, der nicht läuft, ist meist ein Verkabelungsproblem. Öffnen Sie den **Builder** und prüfen Sie:

- Ist der Ausgang des vorherigen Bausteins mit dem Eingang dieses Bausteins verbunden?
- Hat der vorherige Baustein einen anderen Ausgang genommen als erwartet – **Fehler** statt **Erfolg**, oder **Nein** statt **Ja**? Der Tab **Schritte** zeigt, welcher es war.

### „Eine Variable kam leer durch."

Öffnen Sie die Ausführung und sehen Sie sich den **Received**-Block des fehlgeschlagenen Schritts an.

- Wenn Sie den wörtlichen Text `{{local.components.…}}` sehen, wurde die Referenz nicht aufgelöst. Meist ist das ein Tippfehler in der Komponenten-ID oder der Rückgabewert-ID – denken Sie daran, dass es die **Identifier** des Bausteins ist, nicht der auf ihm angezeigte Name. Prüfen Sie auch die Schreibweise von `local.components` selbst: `{{local.componets.api-get-1.returnValues.response-body}}` wird als wörtlicher Text gesendet, und die Ausführung meldet trotzdem **Executed**.
- Wenn Sie eine leere Zeichenkette sehen, wurde der vorherige Baustein zwar ausgeführt, hat aber dieses Feld nicht erzeugt.

Der Tab **Full Log** enthält eine Warnzeile, die jede nicht aufgelöste Referenz benennt – meist der schnellste Weg, sie zu finden.

### „Es funktioniert, wenn ich es manuell starte, aber nicht über den Auslöser."

Öffnen Sie den **Builder**, klicken Sie auf **Arbeitsablauf ausführen** und füllen Sie die Felder des Auslösers mit Werten, die dem ähneln, was der echte Auslöser sendet. Vergleichen Sie dann die **Received**-Werte dieser Ausführung Seite an Seite mit denen der echten Ausführung. Der Unterschied liegt meist in einem einzelnen Feldnamen oder -typ.

## Einen Workflow erneut ausführen

Es gibt keinen Button „Diese Ausführung wiederholen". Wir führen alte Ausführungen nicht automatisch erneut aus, weil die Nebenwirkungen – Slack-Nachrichten, API-Aufrufe, Tickets – möglicherweise nicht gefahrlos wiederholbar sind. Um die Arbeit erneut zu erledigen, korrigieren Sie den Workflow und lassen Sie den nächsten echten Auslöser ihn feuern, oder öffnen Sie den **Builder** und klicken Sie mit denselben Werten auf **Arbeitsablauf ausführen**.

## Wie lange werden Ausführungen aufbewahrt?

Bei OneUptime Cloud werden Ausführungen **30 Tage** lang aufbewahrt und dann gelöscht – deshalb beschreiben sich beide Ausführungslisten selbst als die letzten 30 Tage umfassend. Selbst gehostete Installationen behalten Ausführungen, bis Sie sie löschen; wenn ein Workflow sehr häufig läuft und Ihren Verlauf überfüllt, deaktivieren oder löschen Sie ihn, damit das Rauschen nicht weiter wächst.

Ausführungen, die aufgezeichnet wurden, bevor die Schritt-Nachverfolgung eingeführt wurde, haben keinen **Steps**-Inhalt und zeigen nur ihr **Full Log**.

## Weiterführende Themen

- [Konfiguration & Sicherheit](/docs/workflows/configuration) – Zeitüberschreitungen, Rekursionslimits, versteckte Geheimnisse.
- [Variablen](/docs/workflows/variables) – die in Ihren Bausteinen verwendete Variablensyntax.
- [Komponenten](/docs/workflows/components) – was jeder Baustein erzeugt.
