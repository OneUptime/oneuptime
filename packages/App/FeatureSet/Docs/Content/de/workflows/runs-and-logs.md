# Ausführungen & Protokolle

Jedes Mal, wenn ein Workflow läuft, hält OneUptime fest, was passiert ist – wann er lief, ob es geklappt hat und was jeder Baustein getan hat. Dieser Datensatz heißt **Ausführung**. Über Ausführungen bestätigen Sie, dass ein Workflow funktioniert hat, suchen den Fehler, wenn nicht, und schauen sich zurückliegende Aktivität an.

## Wo Sie sie finden

| Seite                                       | Was Sie sehen                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Arbeitsabläufe → Ausführungen & Protokolle** | Jede Ausführung jedes Workflows im Projekt. Filtern Sie nach Workflow-Name, Status und Zeit.    |
| **Workflow → Ausführungen & Protokolle**  | Nur die Ausführungen dieses einen Workflows. Hier gibt es statt des Workflow-Filters einen Filter **Ausführungs-ID**. |
| **Eine einzelne Ausführung**            | Wird über den Knopf **Protokolle anzeigen** in einer Ausführungszeile geöffnet – die Zeilen selbst sind nicht anklickbar. |

## Status einer Ausführung

| Status                             | Was er bedeutet                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Geplant**                        | Der Trigger hat ausgelöst und die Ausführung wartet auf einen Runner. Meist ein Bruchteil einer Sekunde. Eine Ausführung, die nach 5 Minuten immer noch geplant ist, gilt als fehlgeschlagen – niemand hat sie aufgenommen. |
| **Wird ausgeführt**                | Der Workflow ist unterwegs. Lang laufende Bausteine halten eine Ausführung in diesem Zustand.                                                             |
| **Wartet**                         | Die Ausführung ist auf einem **Sleep**-Baustein geparkt und läuft von selbst weiter. Währenddessen belegt sie keinen Worker.                               |
| **Executed**                       | Die Ausführung hat das Ende erreicht, ohne zu scheitern. (Das ist der Erfolgszustand – die Pille zeigt **Executed**, nicht „Success“.)                     |
| **Fehler**                         | Die Ausführung wurde gestoppt, weil ein Baustein einen Fehler geworfen hat. Wird auch verwendet, wenn eine wartende Ausführung nie aufgenommen wird, wenn das Fortsetzen einer schlafenden Ausführung verloren geht, wenn ein Zeitplanausdruck sich nicht auflösen lässt oder wenn der Workflow mitten in der Ausführung deaktiviert wird. |
| **Timeout**                        | Die Ausführung lief länger als erlaubt. Siehe [Workflow-Konfiguration & Sicherheit](/docs/workflows/configuration).                                        |
| **Execution Exceeded Current Plan** | Das Projekt hat seine Workflow-Ausführungen der letzten 30 Tage aufgebraucht, oder das Abonnement ist unbezahlt. Die Ausführung wird festgehalten, aber nicht ausgeführt. Nur OneUptime Cloud. |

Ein Baustein, der an seinen Ausgang **Fehler** übergibt – etwa ein API-Baustein bei einem 4xx –, lässt die Ausführung nicht scheitern. Der Fehlerzweig läuft, und die Ausführung endet trotzdem mit **Executed**. Der Schritt selbst wird weiterhin rot gezeichnet, damit Sie ihn finden.

## Eine Ausführung lesen

Klicken Sie bei einer Ausführung auf **Protokolle anzeigen**, um sie zu öffnen. Die Ansicht **Workflow Run** hat zwei Reiter.

**Schritte** – eine Zeile pro gelaufenem Baustein, in der Reihenfolge. Jede Zeile zeigt den Titel des Bausteins, seine Komponenten-ID, wie lange er gedauert hat und über welchen Ausgang er verlassen wurde (`→ success`, `→ error`, `→ yes`). Klappen Sie eine Zeile auf, und Sie bekommen zwei Detailblöcke:

- **Received** – die Einstellungen, die der Baustein bekommen hat, nachdem alle Variablen aufgelöst waren.
- **Returned** – was er produziert hat.

Fehlgeschlagene Schritte sind rot und starten aufgeklappt, mit der Fehlermeldung über **Received**.

**Full Log** – das rohe, zeilenweise Protokoll, das der Runner ausgegeben hat, einschließlich allem, was die Bausteine selbst protokolliert haben. Nutzen Sie es, wenn die Ansicht **Schritte** den Fehlschlag nicht erklärt.

Zwei Details lohnen sich zu wissen. Die Komponenten-ID unter jedem Schritt-Titel ist genau die Zeichenkette, die Sie in eine Referenz `{{local.components.<id>.returnValues.…}}` einsetzen – das ist der schnellste Weg zu einer korrekten Referenz. Und eine Ausführung behält nur ihre letzten 100 Schritte; eine lange oder mehrfach fortgesetzte Ausführung zeigt an der Stelle der verworfenen früheren Schritte einen bernsteinfarbenen Hinweis.

Die gezeigten Werte sind das, was der Baustein nach dem Einsetzen der Variablen gesehen hat – mit zwei Ausnahmen: Geheimnisse und Felder, die der Baustein als sensibel markiert, werden geschwärzt, und sehr lange Werte werden mit „… (truncated)“ abgeschnitten.

Starten Sie eine Ausführung aus dem **Builder** heraus, öffnet sich genau diese Ansicht und verfolgt die Ausführung bereits, sodass Sie ihr zusehen können, statt sie hinterher zu suchen.

## Häufige Fehlersuche

### „Mein Workflow ist nicht gelaufen.“

1. Stellen Sie sicher, dass der Workflow auf seiner Seite **Übersicht** auf **Aktiviert** steht. Neue Workflows starten deaktiviert, und ein deaktivierter Workflow lehnt jede Ausführung ab – auch manuelle.
2. Bei einem OneUptime-Ereignis-Trigger: Prüfen Sie, ob das Ereignis wirklich stattgefunden hat. Öffnen Sie den Datensatz und sehen Sie sich seine Historie an.
3. Bei einem Webhook-Trigger: Prüfen Sie, ob das andere System an die richtige URL sendet. Die meisten Tools protokollieren, wenn sie einen Webhook schicken – schauen Sie dort nach.
4. Bei einem Zeitplan-Trigger: Prüfen Sie, ob der Cron-Ausdruck zu der Zeit passt, die Sie erwarten.

Taucht die Ausführung *doch* auf, und zwar mit dem Status **Execution Exceeded Current Plan**, dann hat das Projekt alle seine Workflow-Ausführungen der letzten 30 Tage verbraucht, oder das Abonnement ist unbezahlt. Das Protokoll der Ausführung nennt die Anzahl und das Limit Ihres Plans. Das gilt nur für OneUptime Cloud.

### „Ein späterer Baustein ist nie gelaufen.“

Ein Baustein, der nicht läuft, ist meist ein Verdrahtungsproblem. Öffnen Sie den **Builder** und prüfen Sie:

- Ist der Ausgang des früheren Bausteins mit dem Eingang dieses Bausteins verbunden?
- Hat der frühere Baustein einen anderen Ausgang genommen als erwartet – **Fehler** statt **Erfolg** oder **Nein** statt **Ja**? Der Reiter **Schritte** zeigt, welchen er genommen hat.

### „Eine Variable kam leer an.“

Öffnen Sie die Ausführung und sehen Sie sich den Block **Received** des fehlgeschlagenen Schritts an.

- Steht dort wörtlich `{{local.components.…}}`, wurde die Referenz nicht aufgelöst. Meist ist das ein Tippfehler in der Komponenten-ID oder in der ID des Rückgabewerts – denken Sie daran: gemeint ist der **Identifier** des Bausteins, nicht der Name, der darauf angezeigt wird. Prüfen Sie auch die Schreibweise von `local.components` selbst: `{{local.componets.api-get-1.returnValues.response-body}}` wird als wörtlicher Text verschickt, und die Ausführung meldet trotzdem **Executed**.
- Sehen Sie eine leere Zeichenkette, ist der frühere Baustein zwar gelaufen, hat dieses Feld aber nicht erzeugt.

Der Reiter **Full Log** enthält eine Warnzeile, die jede nicht aufgelöste Referenz benennt – meist der schnellste Weg, sie zu finden.

### „Von Hand läuft es, über den Trigger nicht.“

Öffnen Sie den **Builder**, klicken Sie auf **Arbeitsablauf ausführen** und füllen Sie die Felder des Triggers mit Werten, wie sie der echte Trigger schicken würde. Vergleichen Sie dann die Werte unter **Received** dieser Ausführung Seite an Seite mit denen der echten Ausführung. Der Unterschied ist meist ein einzelner Feldname oder Typ.

## Einen Workflow erneut ausführen

Es gibt keinen Knopf „diese Ausführung wiederholen“. Wir führen alte Ausführungen nicht automatisch erneut aus, weil die Nebenwirkungen – Slack-Nachrichten, API-Aufrufe, Tickets – nicht unbedingt gefahrlos wiederholbar sind. Um die Arbeit noch einmal zu erledigen, reparieren Sie den Workflow und lassen ihn vom nächsten echten Trigger auslösen, oder Sie öffnen den **Builder** und klicken mit denselben Werten auf **Arbeitsablauf ausführen**.

## Wie lange werden Ausführungen aufbewahrt?

In OneUptime Cloud werden Ausführungen **30 Tage** lang aufbewahrt und dann gelöscht – deshalb beschreiben sich beide Ausführungslisten so, dass sie die letzten 30 Tage abdecken. Selbst gehostete Installationen behalten Ausführungen, bis Sie sie löschen; wenn ein Workflow sehr häufig läuft und Ihre Historie zumüllt, deaktivieren oder löschen Sie ihn, damit er nichts mehr zum Rauschen beiträgt.

Ausführungen, die aufgezeichnet wurden, bevor es die Schritt-Nachverfolgung gab, haben keinen Inhalt unter **Schritte** und zeigen nur ihr **Full Log**.

## Weiterführende Themen

- [Workflow-Konfiguration & Sicherheit](/docs/workflows/configuration) – Timeouts, Rekursionsgrenzen, verborgene Geheimnisse.
- [Workflow-Variablen](/docs/workflows/variables) – die Variablensyntax, die Sie in Ihren Bausteinen verwenden.
- [Workflow-Komponenten](/docs/workflows/components) – was jeder Baustein produziert.
