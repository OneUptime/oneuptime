# Zeitachse der Bereitschaftspläne

Die Zeitachse der Bereitschaftspläne zeigt alle Bereitschaftspläne Ihres Projekts in einem Wochen- oder Monatsraster: eine Zeile pro Plan, eine Spalte pro Tag. So beantworten Sie „Wer hat diese Woche in meinem Team – oder in der ganzen Organisation – Bereitschaft?“, ohne jeden Plan einzeln zu öffnen.

Die Schichten auf der Zeitachse sind genau die, mit denen OneUptime Personen alarmiert, Benutzervertretungen eingeschlossen: Die Zeitachse, die Eskalationsregeln und die Kalender-Feeds lesen sie alle aus derselben Quelle.

```mermaid title="Eine Menge an Schichten hinter Zeitachse, Alarmierung und Kalender-Feeds"
flowchart TB
    subgraph setup["Jeder Plan"]
        direction LR
        layers["Ebenen und Rotationen"]
        overrides["Benutzervertretungen"]
    end
    layers --> shifts["Wer wann Bereitschaft hat"]
    overrides --> shifts
    shifts --> timeline["Zeitachse der<br/>Bereitschaftspläne"]
    shifts --> paging["Eskalationsregeln<br/>alarmieren sie"]
    shifts --> feeds["Kalender-Feeds"]
```

## Die Zeitachse öffnen

- **Bereitschaftsdienst** > **Zeitachse der Bereitschaftspläne** zeigt jeden Plan, den Sie sehen dürfen, gruppiert nach besitzendem Team. Die Schaltfläche **Zeitachsenansicht** unter **Bereitschaftspläne** öffnet dieselbe Seite.
- **Teams** > ein Team > **Bereitschaftspläne** zeigt nur die Pläne, die diesem Team gehören.

Ein Team besitzt einen Plan, wenn es auf der Seite **Eigentümer** des Plans eingetragen ist. Pläne ohne besitzendes Team werden unter **Kein Eigentümer-Team** zusammengefasst. Schalten Sie **Nach Team gruppieren** aus, um alle Pläne in einer Liste zu sehen, nach Namen sortiert.

## Das Raster lesen

| Im Raster | Bedeutung |
| --- | --- |
| Ein Balken | Eine Schicht: wer Bereitschaft hat, von wann bis wann. Eine Person hat in jedem Plan dieselbe Farbe. |
| Ein blasser Balken | Eine Schicht in der Vergangenheit. |
| Ein mit **⇄** markierter Balken | Eine Vertretung: Jemand übernimmt eine Schicht. Die schmale Spur darunter nennt die Person, deren Schicht übernommen wird, durchgestrichen. |
| Ein schraffierter gelber Block | Eine Abdeckungslücke: Niemand hat Bereitschaft. Ein Alarm, der an diesen Plan eskaliert, erreicht dann niemanden. |
| Die rote Linie | Jetzt. |
| Die Zeile unter dem Namen eines Plans | Wer gerade Bereitschaft hat, oder **Gerade niemand in Bereitschaft**. |

Fahren Sie mit der Maus über einen Balken oder eine Lücke, oder steuern Sie sie mit der Tastatur an, um die Details zu sehen.

Unter dem Raster listet **In Bereitschaft diese Woche** (**In Bereitschaft diesen Monat** in der Monatsansicht) alle auf, die im gewählten Zeitraum Bereitschaft haben. Fahren Sie mit der Maus über einen Namen, um zu sehen, wie lange die Person Bereitschaft hat und in wie vielen Plänen.

## Zeitraum und Zeitzone ändern

- Wechseln Sie zwischen **Woche** und **Monat**, blättern Sie mit den Pfeilen und kehren Sie mit **Heute** zurück.
- Zeiten werden in Ihrer eigenen Zeitzone angezeigt. Die Zeitzonen-Schaltfläche öffnet **Zeitachse in Zeitzone anzeigen**, das die Zeitachse in jeder anderen Zone zeigt, ohne dass sich ändert, wann jemand Bereitschaft hat: Jeder Plan übergibt weiterhin in seiner eigenen Zeitzone.
- Die Zeitachse reicht 180 Tage zurück und 365 Tage voraus.

> [!NOTE]
> Vergangene Schichten werden aus der aktuellen Konfiguration jedes Plans neu berechnet. Sie zeigen also die Rotation, wie sie jetzt eingerichtet ist, und die kann davon abweichen, wer damals tatsächlich alarmiert wurde. Für die Stunden, die Personen tatsächlich in Bereitschaft verbracht haben, nutzen Sie **Bereitschaftsdienst** > **Berichte** > **Bereitschaftszeit des Benutzers**. Siehe [Bereitschaftszeit des Benutzers](/docs/on-call/readiness#bereitschaftszeit-des-benutzers).

## Einen Plan oder eine Person finden

- **Suchen** findet Plannamen, Teamnamen und die Personen in Bereitschaft.
- Der Teamfilter beschränkt die Ansicht auf ein Team oder auf **Meine Teams**; **Zeitpläne, in denen ich bin** zeigt nur die Pläne, in denen Sie eingeteilt sind.
- Klicken Sie über dem Raster auf **ohne Bereitschaft jetzt** oder **mit Abdeckungslücken diese Woche** (**mit Abdeckungslücken diesen Monat** in der Monatsansicht), um nur diese Pläne zu sehen. Ein erneuter Klick zeigt wieder alle.
- Klicken Sie unter dem Raster auf eine Person oder auf einen ihrer Balken, um alle ihre Schichten hervorzuheben. **Hervorhebung entfernen** macht das rückgängig, und **Filter löschen** setzt die Suche und die Filter zurück.

## Wer was sieht

| Gilt für | Regel |
| --- | --- |
| Berechtigungen | Dieselben Berechtigungen und Label-Einschränkungen wie **Bereitschaftspläne**, dazu die Berechtigung, Planebenen zu lesen. |
| Vertretungen | Wessen Schicht eine Vertretung übernimmt, sehen nur Personen, die Benutzervertretungen lesen dürfen. Alle anderen sehen trotzdem, wer alarmiert wird. |
| Anzahl der Pläne | Bis zu 250 Pläne auf einmal, nach Namen sortiert. Die Seite **Bereitschaftspläne** eines Teams beschränkt sie auf die Pläne dieses Teams. |
| Tarif | In OneUptime Cloud braucht die Zeitachse den Tarif **Growth**, wie die Bereitschaftspläne. |

## Nächste Schritte

:::cards
- [Bereitschaftspläne](/docs/on-call/schedules): Festlegen, wer sich abwechselt, mit Ebenen und Bereitschaftszeiten.
- [Kalender-Feeds](/docs/on-call/calendar-feeds): Ihre Schichten in Google Kalender, Outlook oder Apple Kalender bringen.
- [Eskalationsregeln](/docs/on-call/escalation-rules): Festlegen, wen jede Stufe einer Bereitschaftsrichtlinie alarmiert.
:::
