# Eskalationsregeln

Eine Bereitschaftsrichtlinie alarmiert Personen in Stufen. Jede Eskalationsregel ist eine Stufe: wer alarmiert wird und wie lange auf eine Bestätigung gewartet wird, bevor die nächste Stufe alarmiert wird. Die Regeln einer Richtlinie stehen der Reihe nach auf ihrer Seite **Eskalationsregeln**.

## Wer zuerst alarmiert wird

Wenn Sie auf der Seite **Bereitschaftsrichtlinien** eine Bereitschaftsrichtlinie anlegen, fragt das Formular nach ihrem **Name** und **Wer wird zuerst alarmiert?**. Die Frage nutzt dieselbe Auswahl wie **Benachrichtigen**: Bereitschaftspläne, Teams und Personen, so viele Sie brauchen. Die Ausgewählten bilden die erste Eskalationsregel der Richtlinie, **Level 1**, die **30 Minuten** auf eine Bestätigung wartet, bevor die nächste Stufe alarmiert wird. Die neue Richtlinie öffnet sich danach auf ihrer Seite **Eskalationsregeln**, wo Sie weitere Stufen hinzufügen können.

**Wer wird zuerst alarmiert?** ist optional. Bleibt die Frage leer, beginnt die Richtlinie ohne Eskalationsregeln: Sie alarmiert niemanden, bis Sie eine hinzufügen, und ihre Übersicht weist darauf hin. Beschreibung und Beschriftungen liegen unter **Erweitert**. Gefragt wird nur, wer Eskalationsregeln hinzufügen darf.

## Eine Eskalationsregel hinzufügen

Öffnen Sie die Bereitschaftsrichtlinie, wählen Sie im Seitenmenü **Eskalationsregeln** und klicken Sie auf **Eskalationsregel hinzufügen**. Der Dialog ist eine kurze Seite mit zwei Fragen:

- **Benachrichtigen** — wer auf dieser Stufe alarmiert wird. Eine Auswahl umfasst Bereitschaftspläne, Teams und Personen: Klicken Sie auf **Empfänger hinzufügen**, suchen Sie und wählen Sie so viele aus, wie Sie brauchen. Mindestens einer ist nötig.
  - Ein **Bereitschaftsplan** alarmiert, wer gerade Bereitschaft hat, wenn die Stufe ausgelöst wird, nicht eine feste Person.
  - Ein **Team** alarmiert jedes Mitglied des Teams.
  - Eine **Person** wird direkt alarmiert.
- **Eskalieren nach (in Minuten)** — wie lange auf eine Bestätigung gewartet wird, bevor die nächste Stufe alarmiert wird. Der Wert beginnt bei **30 Minuten**; ändern Sie ihn so, wie es zur Stufe passt.

Alles Weitere liegt unter **Erweitert**, eingeklappt, bis Sie es öffnen:

- **Name** — optional. Eine Regel ohne Namen heißt nach ihrer Stufe: Die erste Regel einer Richtlinie ist **Level 1**, die zweite **Level 2** und so weiter. Das Namensfeld zeigt den Namen, den die Regel bekommt.
- **Beschreibung** — optionale Notizen, etwa wen diese Stufe alarmiert und warum.

Die Kopfzeile von **Erweitert** zeigt **Konfiguriert**, wenn die Regel eine Beschreibung oder einen eigenen Namen hat.

## Wie die Stufen Personen alarmieren

Erreicht ein Vorfall oder eine Warnung die Richtlinie, alarmiert **Level 1** seine Empfänger sofort. Bestätigt niemand innerhalb der Wartezeit, wird **Level 2** alarmiert, und so weiter die Liste hinunter. Ist die Wartezeit der letzten Stufe ohne Bestätigung verstrichen, beginnt die Richtlinie wieder bei **Level 1**, wenn ihre **Wiederholungsrichtlinie** (unter den Regeln) eine Wiederholung vorsieht, so oft wie dort erlaubt, und hört sonst auf.

Die Übersicht oben auf der Seite **Eskalationsregeln** zeigt die ganze Leiter: wann jede Stufe alarmiert wird, wen sie alarmiert und was nach der letzten passiert. Eine Stufe, deren Empfänger nicht alle alarmiert werden können, sagt das auf ihrer Karte; klicken Sie auf die Markierung, um zu sehen, wer betroffen ist und warum.

Wie jede Person erreicht wird, die eine Stufe alarmiert, bestimmen ihre eigenen Bereitschaftsregeln: **Benutzereinstellungen** > **Bereitschaftsregeln**, mit je einem Tab für Vorfälle, Vorfallsepisoden, Warnungen und Warnungsepisoden und einer Karte pro Schweregrad, die zeigt, welche Benachrichtigungsmethode nach welcher Wartezeit verwendet wird. Projektadministratoren sehen und ändern die Regeln eines Mitglieds unter **Benutzer** > das Mitglied > **Bereitschaftsregeln**.

## Regeln bearbeiten, umsortieren und löschen

- **Regel bearbeiten** öffnet denselben einseitigen Dialog, ausgefüllt mit der Regel, wie sie ist: ihre Empfänger, ihre Wartezeit sowie Name und Beschreibung unter **Erweitert**. Fügen Sie Empfänger hinzu oder entfernen Sie sie und speichern Sie. Wird der Name geleert, bekommt die Regel wieder den Namen ihrer Stufe.
- **Nach oben verschieben** und **Nach unten verschieben** im **⋯**-Menü einer Regel ändern ihre Stufe. Eine Regel, die nach ihrer Stufe heißt, behält einen Namen, der zu ihrem Platz passt: Wenn **Level 3** an **Level 2** vorbei nach oben rückt, tauschen beide ihre Namen. Ein selbst gewählter Name wie **Manager** bleibt, wohin die Regel auch geht.
- **Regel löschen** fragt zuerst nach und sagt, wen die Stufe alarmiert. Wird eine Stufe gelöscht, rücken die Stufen darunter nach oben, und Regeln, die nach ihrer Stufe heißen, werden passend umbenannt.

## Regeln mit der API oder Terraform anlegen

Eskalationsregeln sind die Ressource `/api/on-call-duty-policy-escalation-rule`; die Personen, Teams und Pläne, die eine Regel alarmiert, sind die Ressourcen `/api/on-call-duty-policy-escalation-rule-user`, `-team` und `-schedule`.

- Eine ohne `name` angelegte Regel heißt wie im Dashboard nach ihrer Stufe: **Level 3** für eine Regel, die die dritte Stufe ihrer Richtlinie wird. Die Terraform-Ressource für Eskalationsregeln verlangt weiterhin einen Namen.
- `escalateAfterInMinutes` hat außerhalb des Dashboards keinen Standardwert. Eine ohne diesen Wert angelegte Regel wartet nicht: Die nächste Stufe wird alarmiert, sobald diese gelaufen ist. Setzen Sie ihn ausdrücklich — 30 ist der Vorschlag des Dashboards.
- Regeln, die nach ihrer Stufe heißen, werden umbenannt, wenn Sie Regeln im Dashboard verschieben oder löschen. Eine Änderung von `order` über die API oder Terraform ändert nur die Reihenfolge.
- Wird eine Bereitschaftsrichtlinie über `/api/on-call-duty-policy` mit `onCallSchedules`, `teams` oder `users` (Listen von IDs) in ihren `miscDataProps` angelegt, bekommt sie wie im Dashboard ihre erste Eskalationsregel: **Level 1**, die diese alarmiert, mit einem `escalateAfterInMinutes` von 30. Jede ID muss zum Projekt gehören, und der Aufrufer muss Eskalationsregeln anlegen dürfen, sonst wird die Richtlinie nicht angelegt. Ohne diese Angaben hat die Richtlinie wie bisher keine Regeln; die Terraform-Ressource für Richtlinien sendet sie nicht.
