# Benutzerüberschreibungen

Solange jemand abwesend ist, schickt eine Benutzerüberschreibung die Alarme, die diese Person erreichen würden, für eine festgelegte Zeit an die Person, die sie vertritt. Ist niemand als Vertretung genannt, überspringt sie die Person stattdessen: Jede ihrer Schichten in einem Bereitschaftsplan geht an die nächste Person in der Rotation. Nutzen Sie sie für einen Urlaub, einen Krankheitstag oder eine getauschte Schicht.

:::cards
- [Wie eine Überschreibung einen Alarm ändert](#wie-eine-überschreibung-einen-alarm-ändert): Wer stattdessen alarmiert wird, und wann.
- [Eine Überschreibung hinzufügen](#eine-überschreibung-hinzufügen): Wer abwesend ist, wer vertritt, ab wann und bis wann.
- [Eine Überschreibung bearbeiten](#eine-überschreibung-bearbeiten): Ändern, wer vertritt, oder wann sie beginnt und endet.
- [Jede Richtlinie oder eine](#jede-richtlinie-oder-eine): Wo Sie eine Überschreibung hinzufügen und welche gewinnt.
- [Weitere Wege, eine hinzuzufügen](#weitere-wege-eine-hinzuzufügen): Aus einem Plan und aus Ihren bevorstehenden Schichten.
:::

## Wie eine Überschreibung einen Alarm ändert

```mermaid title="Was eine Überschreibung mit einem Alarm macht"
flowchart TB
    page["Eine Regel alarmiert<br/>eine Person"] --> away{"Gilt für sie eine<br/>Überschreibung?"}
    away -->|"Nein"| them["Sie wird<br/>alarmiert"]
    away -->|"Ja"| cover{"Nennt sie, wer<br/>vertritt?"}
    cover -->|"Ja"| covering["Die Vertretung wird<br/>stattdessen alarmiert"]
    cover -->|"Nein"| skip["Sie wird<br/>übersprungen"]
```

Solange eine Überschreibung gilt, von ihrem Beginn bis zu ihrem Ende:

- Steht jemand unter **Wer vertritt?**, bekommt diese Person alle Alarme der abwesenden Person, aus jedem Plan, jedem Team und jeder Regel, für die die Überschreibung gilt. Der Alarm erreicht sie über ihre eigenen persönlichen Bereitschaftsregeln.
- Vertritt niemand, wird die Person übersprungen. In einem Bereitschaftsplan geht jede ihrer Schichten an die nächste Person in der Rotation, die nicht abwesend ist; sind alle in einer Ebene abwesend, übernehmen die Ebenen darunter. Eine Regel, die sie direkt oder über ein Team nennt, alarmiert sie nicht, und der Lauf der Richtlinie sagt, dass sie abwesend ist, und bis wann.
- Überschreibungen verketten sich nicht. Ist die Vertretung selbst abwesend, wird trotzdem sie für die Person alarmiert, die sie vertritt.

Endet die Überschreibung, gehören die Alarme wieder der Person. Die **Zeitachse der Bereitschaftspläne**, die Ebenen eines Plans und die Kalender-Feeds zeigen alle, wer jede vertretene Schicht hat.

## Eine Überschreibung hinzufügen

:::steps
### Die Überschreibungen öffnen

Gehen Sie zu **Bereitschaft → Erweitert → Benutzerüberschreibungen**, um jemanden in jeder Bereitschaftsrichtlinie zu vertreten, oder zur Seite **Benutzerüberschreibungen** einer Richtlinie, unter **Erweitert**, um nur in dieser Richtlinie zu vertreten. Klicken Sie auf **Benutzervertretung hinzufügen**.

### Sagen, wer abwesend ist

**Wer ist abwesend?** steht zuerst auf Ihnen, denn die eigene Abwesenheit einzutragen ist der häufigste Fall. Wählen Sie jemand anderen, um eine Vertretung für diese Person einzutragen.

### Sagen, wer vertritt

Lassen Sie **Wer vertritt?** auf **Nächste Person in der Rotation**, um die Person zu überspringen, oder wählen Sie die Kollegin oder den Kollegen, der alle ihre Alarme übernimmt. Die abwesende Person wird nicht angeboten.

### Die Zeit festlegen

**Beginnt** steht auf jetzt, wenn Sie keine andere Zeit wählen. Setzen Sie **Endet** auf den Zeitpunkt, an dem die Person zurück ist: Er muss nach dem Beginn liegen. Klicken Sie auf **Benutzervertretung hinzufügen**.
:::

Jede Überschreibung ist eine Zeile: **Abwesend**, **Vertreten durch**, **Beginnt** und **Endet**, filterbar nach Beginn und Ende. **Vertreten durch** zeigt bei einem Überspringen **Nächste Person in der Rotation**.

## Eine Überschreibung bearbeiten

Klicken Sie in der Zeile einer Überschreibung auf **Bearbeiten**, auf einer der beiden Seiten **Benutzerüberschreibungen** oder in der Liste der Benutzerüberschreibungen auf der Seite **Ebenen** eines Plans. Das Formular öffnet sich mit der Überschreibung, wie sie gespeichert wurde: Ändern Sie sie und klicken Sie auf **Änderungen speichern**.

- **Wer vertritt?** lässt sich ändern, bis die Überschreibung endet. Stellen Sie es wieder auf **Nächste Person in der Rotation**, um die Person stattdessen zu überspringen.
- **Beginnt** lässt sich verschieben, bis die Überschreibung beginnt, und bleibt danach, wie es ist. **Endet** lässt sich verschieben, bis die Überschreibung endet: Setzen Sie es auf jetzt, um die Überschreibung früher zu beenden. Keines von beiden lässt sich in die Vergangenheit verschieben.
- **Wer ist abwesend?** lässt sich nicht ändern. Fügen Sie für jemand anderen eine neue Überschreibung hinzu.

Eine beendete Überschreibung lässt sich nicht mehr ändern: Ihr **Bearbeiten** ist gesperrt und sagt, warum.

## Jede Richtlinie oder eine

| Hinzugefügt unter | Karte | Gilt für |
| --- | --- | --- |
| **Bereitschaft → Erweitert → Benutzerüberschreibungen** | **Globale Benutzervertretungen** | Jede Bereitschaftsrichtlinie im Projekt |
| **Benutzerüberschreibungen** einer Richtlinie | **Benutzervertretungen der Bereitschaftsrichtlinie** | Nur diese Richtlinie |

Zwei Überschreibungen für dieselbe Person dürfen sich in derselben Richtlinie nicht überschneiden, und auch nicht, wenn beide global sind. Das Formular sagt es, sobald die Zeiten gewählt sind, mit **Diese Vertretung bearbeiten**, um stattdessen jene zu ändern. Eine kann enden, wenn die nächste beginnt.

Die eigene Überschreibung einer Richtlinie darf sich mit einer globalen für dieselbe Person überschneiden: In dieser Richtlinie wird die eigene verwendet, solange beide gelten, und das Formular sagt es. Ein Alarm ohne Richtlinie, aus einem Workflow oder aus dem Chat, folgt nur den globalen Überschreibungen.

Überschreibungen, die sich schon vor dieser Regel überschnitten, bleiben, wie sie sind. Beide sind mit **Überschneidet sich** markiert, und die Markierung sagt, welche verwendet wird: eine, die eine Vertretung nennt, vor einem Überspringen, dann die, die früher beginnt, dann die, die zuerst hinzugefügt wurde.

## Weitere Wege, eine hinzuzufügen

- Aus einem Plan: Klappen Sie auf der Seite **Ebenen** eines Plans eine Ebene auf und klicken Sie neben einer Person auf **Überspringen bis…**. Das öffnet dasselbe Formular mit ihr als abwesend und der Rotation als Vertretung, als globale Überschreibung. Siehe [Wenn jemand abwesend ist](/docs/on-call/schedules#wenn-jemand-abwesend-ist).
- Aus Ihren bevorstehenden Schichten: **Vertretung finden** an einer Ihrer Schichten, unter **Benutzereinstellungen → Kalender → Kalender-Feed**, öffnet das Formular mit Ihnen als abwesend für die Zeiten dieser Schicht, sodass nur noch **Wer vertritt?** bleibt. Siehe [Bevorstehende Schichten und Vertretung](/docs/on-call/calendar-feeds#bevorstehende-schichten-und-vertretung).

Verlässt jemand das Projekt, wird jede Überschreibung gelöscht, die ihn nennt und noch nicht geendet hat, auf beiden Seiten.

## Wer Überschreibungen hinzufügen darf

**Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Bereitschafts-Administrator** und **Bereitschafts-Mitglied** dürfen Überschreibungen hinzufügen, bearbeiten und löschen; **Betrachter** und **Bereitschafts-Betrachter** dürfen sie sehen. In einer eigenen Rolle heißen die Berechtigungen **Create On-Call Policy User Override**, **Edit On-Call Policy User Override**, **Delete On-Call Policy User Override** und **Read On-Call Policy User Override**. Auf der **Zeitachse der Bereitschaftspläne** sehen nur Personen, die Überschreibungen lesen dürfen, wessen Schicht vertreten wird.

Eine Überschreibung in einer Richtlinie folgt dem Geltungsbereich der Richtlinie. Geben Sie einem Team **Bereitschafts-Mitglied**, beschränkt auf die Richtlinien, die ihm gehören, oder auf sein Label, dann fügen seine Mitglieder Überschreibungen nur in diesen Richtlinien hinzu und bearbeiten und löschen sie nur dort. Eine globale Überschreibung gilt für jede Richtlinie, auch für die eines anderen Teams; sie hinzuzufügen, zu bearbeiten oder zu löschen braucht deshalb die Berechtigung für Überschreibungen über das ganze Projekt. Mit einer engeren sind **Benutzervertretung hinzufügen**, **Bearbeiten** und **Löschen** unter **Bereitschaft → Erweitert → Benutzerüberschreibungen** gesperrt und sagen, warum. **Überspringen bis…** in den Ebenen eines Plans und **Vertretung finden** an Ihren bevorstehenden Schichten, die globale Überschreibungen hinzufügen, bieten stattdessen die Richtlinien an, für die Sie Überschreibungen hinzufügen dürfen, mit einer Überschreibung je Richtlinie, und ebenso die Vertretung in der Mobil-App; wo Sie für keine davon eine hinzufügen dürfen, sind sie gesperrt und sagen, warum. Das Team fügt seine Überschreibungen auf der eigenen Seite **Benutzerüberschreibungen** jeder Richtlinie hinzu. Dasselbe gilt für die API: Eine Überschreibung ohne `onCallDutyPolicyId` wird für eine Berechtigung abgelehnt, die auf Labels oder auf eigene Richtlinien beschränkt ist.

In OneUptime Cloud brauchen Benutzerüberschreibungen den Plan **Growth**.

## API

Benutzerüberschreibungen sind die Ressource `/api/on-call-duty-policy-user-override`:

| Feld | Was es enthält |
| --- | --- |
| `overrideUserId` | Die abwesende Person. Pflichtfeld. |
| `routeAlertsToUserId` | Die Person, die vertritt. Lassen Sie das Feld weg, um die Person stattdessen zu überspringen. |
| `startsAt`, `endsAt` | Wann die Überschreibung beginnt und endet. Beide sind Pflicht, und das Ende liegt nach dem Beginn. |
| `onCallDutyPolicyId` | Die Richtlinie, für die sie gilt. Lassen Sie das Feld für eine globale Überschreibung weg. |

```bash
curl -X POST https://oneuptime.com/api/on-call-duty-policy-user-override \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "projectId": "<project-id>",
      "overrideUserId": "<away-user-id>",
      "routeAlertsToUserId": "<cover-user-id>",
      "startsAt": "2026-12-22T09:00:00Z",
      "endsAt": "2027-01-05T09:00:00Z"
    }
  }'
```

Eine Überschreibung, deren abwesende Person und Vertretung dieselbe ist, wird abgelehnt, ebenso eine, die vor ihrem Beginn endet. Ebenso eine, die sich mit einer anderen Überschreibung für dieselbe Person in derselben Richtlinie überschneidet, oder wenn beide global sind: Die Ablehnung nennt die, mit der sie sich überschneidet.

Um eine Überschreibung zu ändern, senden Sie `PUT /api/on-call-duty-policy-user-override/<override-id>` mit den zu ändernden Feldern in `data`: `routeAlertsToUserId` (`null`, um die Person stattdessen zu überspringen), `startsAt` und `endsAt`. `overrideUserId` und `onCallDutyPolicyId` lassen sich nicht ändern. Eine beendete Überschreibung lässt sich nicht ändern, ebenso wenig der Beginn einer, die schon begonnen hat, und eine geänderte Zeit lässt sich nicht in die Vergangenheit verschieben.

## Fehlerbehebung

:::details Die Person im Urlaub wurde trotzdem alarmiert
Prüfen Sie, wo die Überschreibung hinzugefügt wurde. Eine auf der Seite **Benutzerüberschreibungen** einer Richtlinie gilt nur für diese Richtlinie, und andere Richtlinien alarmieren die Person weiter: Fügen Sie sie unter **Bereitschaft → Erweitert → Benutzerüberschreibungen** hinzu, um jede Richtlinie abzudecken. Prüfen Sie auch **Beginnt** und **Endet**: Zeiten werden in Ihrer Zeitzone angezeigt.
:::

:::details Die Vertretung wurde auch nicht alarmiert
Sie wird über ihre eigenen persönlichen Bereitschaftsregeln und verifizierten Methoden erreicht. Suchen Sie sie unter **Bereitschaft → Einsatzbereitschaft** und prüfen Sie den Lauf in den **Ausführungsprotokolle** der Richtlinie.
:::

:::details Ich kann keine Überschreibung hinzufügen
Dafür braucht es eine der Rollen oben, und in OneUptime Cloud den Plan **Growth**. Eine globale Überschreibung braucht die Rolle über das ganze Projekt: Ist die Rolle Ihres Teams auf seine eigenen Richtlinien oder auf einige Labels beschränkt, fügen Sie die Überschreibung auf der eigenen Seite **Benutzerüberschreibungen** der Richtlinie hinzu. **Überspringen bis…**, **Vertretung finden** und die Mobil-App bieten dann nur die Richtlinien an, für die Sie Überschreibungen hinzufügen dürfen, und sind gesperrt, wo Sie für keine davon eine hinzufügen dürfen.
:::

:::details Eine Überschreibung lässt sich nicht speichern, weil sie sich mit einer anderen überschneidet
Die Person hat zu einigen dieser Zeiten bereits eine Überschreibung: in derselben Richtlinie, oder eine globale, wenn auch diese global ist. Klicken Sie unter **Endet** auf **Diese Vertretung bearbeiten**, um stattdessen jene zu ändern, oder wählen Sie Zeiten, die sich nicht mit ihr überschneiden.
:::

## Nächste Schritte

:::cards
- [Bereitschaftspläne](/docs/on-call/schedules): Rotationen, Ebenen und jemanden in einer Ebene überspringen.
- [Zeitachse der Bereitschaftspläne](/docs/on-call/schedule-timeline): Jede vertretene Schicht über alle Pläne hinweg sehen.
- [Kalender-Feeds](/docs/on-call/calendar-feeds): Eine Vertretung für eine Ihrer eigenen Schichten finden.
:::
