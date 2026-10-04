# Bereitschaftspläne

Ein Bereitschaftsplan legt fest, wer gerade Bereitschaft hat. Die Personen darin wechseln sich ab: Jede hat eine Zeit lang Bereitschaft, dann übernimmt die nächste. Nehmen Sie einen Plan in die Eskalationsregeln einer Bereitschaftsrichtlinie auf, und die Richtlinie alarmiert auf dieser Stufe, wer im Plan gerade Bereitschaft hat.

## Wer sich abwechselt

Wenn Sie auf der Seite **Bereitschaftspläne** einen Plan anlegen, fragt das Formular nach seinem **Name** und **Wer wechselt sich ab?**. Klicken Sie auf **Benutzer hinzufügen** und wählen Sie die Personen in der Reihenfolge, in der sie sich abwechseln: Sie haben nacheinander Bereitschaft, und die erste hat Bereitschaft, sobald der Plan angelegt ist. Sie bilden die erste Ebene des Plans, **Layer 1**, rund um die Uhr in Bereitschaft. Der neue Plan öffnet sich danach auf seiner Seite **Ebenen**, wo Sie die Rotation ändern oder weitere Ebenen hinzufügen können.

**Wer wechselt sich ab?** ist optional. Bleibt die Frage leer, beginnt der Plan ohne Ebenen: Er setzt niemanden in Bereitschaft, bis Sie auf seiner Seite **Ebenen** eine Ebene hinzufügen. Gefragt wird nur, wer Ebenen hinzufügen darf.

Alles andere liegt unter **Weitere Felder**, eingeklappt, bis Sie es öffnen:

- **Jede Schicht dauert**: **1 Tag**, **1 Woche**, **2 Wochen** oder **1 Monat**, und **1 Woche**, solange Sie nichts ändern. Gefragt wird danach, sobald jemand ausgewählt ist. Jede Person hat so lange Bereitschaft, dann übernimmt die nächste, zu der Uhrzeit, zu der der Plan angelegt wurde.
- **Zeitzone**: die Zeitzone, in der Übergabezeiten und Bereitschaftsstunden gelten. Sie beginnt mit Ihrer eigenen.
- **Beschreibung** und **Beschriftungen**.

Solange jemand ausgewählt ist und unter **Weitere Felder** nichts geändert ist, sagt die eingeklappte Überschrift, was geschehen wird: Jede Person ist eine Woche in Bereitschaft, dann übernimmt die nächste.

## Ebenen

Die Rotation eines Plans besteht aus Ebenen, auf seiner Seite **Ebenen**. Die Ebenen werden von oben nach unten gelesen: Die oberste Ebene, in der jemand Bereitschaft hat, ist die, die alarmiert. Legen Sie die Hauptrotation also nach oben und die Vertretung darunter.

**Ebene hinzufügen** fügt eine Ebene hinzu, die wie die erste beginnt: ab sofort in Bereitschaft, jede Person eine Woche lang, rund um die Uhr. Klappen Sie eine Ebene auf, um ihr Personen hinzuzufügen und zu ändern, wann sie beginnt, wie oft sie übergibt, wann sie zum ersten Mal übergibt und zu welchen Stunden sie Bereitschaft hat.

## Pläne mit der API oder Terraform anlegen

Bereitschaftspläne sind die Ressource `/api/on-call-duty-policy-schedule`; ihre Ebenen und die Personen darin sind die Ressourcen `/api/on-call-duty-schedule-layer` und `/api/on-call-duty-schedule-layer-user`.

- Wird ein Plan mit `firstLayerUsers` (einer Liste von Benutzer-IDs in der Reihenfolge, in der sie sich abwechseln) in seinen `miscDataProps` angelegt, erhält er seine erste Ebene wie im Dashboard: **Layer 1**, ab sofort in Bereitschaft, rund um die Uhr. `firstLayerRotation` gibt an, wie lange jede Schicht dauert, als Rotation wie `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; ohne sie eine Woche. Jeder Benutzer muss Mitglied des Projekts sein und der Aufrufer muss Ebenen anlegen dürfen, sonst wird der Plan nicht angelegt.
- Ein Plan, der ohne sie angelegt wird, hat wie bisher keine Ebenen; die Plan-Ressource von Terraform sendet sie nicht.
- Eine Ebene, die ohne `rotation` angelegt wird, übergibt wie bisher täglich.
