# Eskalationsregeln

Eine Bereitschaftsrichtlinie alarmiert Personen in Stufen. Jede Eskalationsregel ist eine Stufe: wer alarmiert wird und wie lange auf eine Bestätigung gewartet wird, bevor die nächste Stufe alarmiert wird. Die Regeln einer Richtlinie stehen der Reihe nach auf ihrer Seite **Eskalationsregeln**.

```mermaid title="Eine Bereitschaftsrichtlinie alarmiert Stufe für Stufe, bis jemand bestätigt"
flowchart TB
    trigger["Vorfall oder Warnung"] --> level1["Level 1 alarmiert"]
    level1 --> ack1{"Rechtzeitig<br/>bestätigt?"}
    ack1 -->|"Ja"| stop["Alarmierung endet"]
    ack1 -->|"Nein"| level2["Level 2 alarmiert"]
    level2 --> ack2{"Rechtzeitig<br/>bestätigt?"}
    ack2 -->|"Ja"| stop
    ack2 -->|"Nein, letzte Stufe"| repeat{"Richtlinie wiederholen?"}
    repeat -->|"Ja"| level1
    repeat -->|"Nein"| done["Richtlinie endet"]
```

:::cards
- [Wer zuerst alarmiert wird](#wer-zuerst-alarmiert-wird): Eine Richtlinie mit ihrer ersten Stufe anlegen.
- [Eine Eskalationsregel hinzufügen](#eine-eskalationsregel-hinzufügen): Die nächste Stufe hinzufügen, Schritt für Schritt.
- [Wie die Stufen Personen alarmieren](#wie-die-stufen-personen-alarmieren): Zeiten, Wiederholungen und wie jede Person erreicht wird.
- [API und Terraform](#regeln-mit-der-api-oder-terraform-anlegen): Richtlinien und Regeln als Code anlegen.
:::

## Wer zuerst alarmiert wird

Wenn Sie auf der Seite **Bereitschaftsrichtlinien** eine Bereitschaftsrichtlinie anlegen, fragt das Formular nach ihrem **Name** und **Wer wird zuerst alarmiert?**. Die Frage nutzt dieselbe Auswahl wie **Benachrichtigen**: Bereitschaftspläne, Teams und Personen, so viele Sie brauchen. Die Ausgewählten bilden die erste Eskalationsregel der Richtlinie, **Level 1**, die **30 Minuten** auf eine Bestätigung wartet, bevor die nächste Stufe alarmiert wird.

:::steps
1. Öffnen Sie **Bereitschaftsdienst** > **Bereitschaftsrichtlinien** und klicken Sie auf **Bereitschaftsrichtlinie erstellen**.
2. Geben Sie einen **Name** ein.
3. Klicken Sie unter **Wer wird zuerst alarmiert?** auf **Empfänger hinzufügen** und wählen Sie die Bereitschaftspläne, Teams und Personen, die zuerst alarmiert werden.
4. Klicken Sie auf **Bereitschaftsrichtlinie erstellen**. Die neue Richtlinie öffnet sich danach auf ihrer Seite **Eskalationsregeln**, wo Sie weitere Stufen hinzufügen können.
:::

**Wer wird zuerst alarmiert?** ist optional. Bleibt die Frage leer, beginnt die Richtlinie ohne Eskalationsregeln: Sie alarmiert niemanden, bis Sie eine hinzufügen, und ihre Übersicht weist darauf hin. Beschreibung und Beschriftungen liegen unter **Weitere Felder**. Gefragt wird nur, wer Eskalationsregeln hinzufügen darf.

## Eine Eskalationsregel hinzufügen

:::steps
### Die Eskalationsregeln der Richtlinie öffnen

Öffnen Sie die Bereitschaftsrichtlinie, wählen Sie im Seitenmenü **Eskalationsregeln** und klicken Sie auf **Eskalationsregel hinzufügen**. Der Dialog ist eine kurze Seite.

### Wählen, wer benachrichtigt wird

Klicken Sie unter **Benachrichtigen** auf **Empfänger hinzufügen**, suchen Sie und wählen Sie so viele Bereitschaftspläne, Teams und Personen, wie diese Stufe alarmieren soll. Mindestens einer ist nötig.

| Empfänger | Wer alarmiert wird, wenn die Stufe ausgelöst wird |
| --- | --- |
| Ein **Bereitschaftsplan** | Wer gerade Bereitschaft hat, wenn die Stufe ausgelöst wird, nicht eine feste Person. |
| Ein **Team** | Jedes Mitglied des Teams. |
| Eine **Person** | Diese Person, direkt. |

### Festlegen, wie lange gewartet wird

**Eskalieren nach (in Minuten)** ist die Wartezeit auf eine Bestätigung, bevor die nächste Stufe alarmiert wird. Der Wert beginnt bei **30 Minuten**; ändern Sie ihn so, wie es zur Stufe passt.

### Die Regel benennen, wenn Sie möchten

Alles andere liegt unter **Weitere Felder**, eingeklappt, bis Sie es öffnen:

- **Name**: optional. Eine Regel ohne Namen heißt nach ihrer Stufe: Die erste Regel einer Richtlinie ist **Level 1**, die zweite **Level 2** und so weiter. Das Namensfeld zeigt den Namen, den die Regel bekommt.
- **Beschreibung**: optionale Notizen, etwa wen diese Stufe alarmiert und warum.

Eingeklappt nennt die Kopfzeile von **Weitere Felder** die beiden und zeigt, welche davon die Regel hat: eine Beschreibung oder einen eigenen Namen.

### Die Regel erstellen

Klicken Sie auf **Regel erstellen**. Die Regel wird unter den anderen angefügt, als nächste Stufe der Richtlinie.
:::

## Wie die Stufen Personen alarmieren

Erreicht ein Vorfall oder eine Warnung die Richtlinie, alarmiert **Level 1** seine Empfänger sofort. Bestätigt niemand innerhalb der Wartezeit, wird **Level 2** alarmiert, und so weiter die Liste hinunter. Ist die Wartezeit der letzten Stufe ohne Bestätigung verstrichen, beginnt die Richtlinie wieder bei **Level 1**, wenn ihre **Wiederholungsrichtlinie** (unter den Regeln) eine Wiederholung vorsieht, so oft wie dort erlaubt, und hört sonst auf. Wird der Vorfall oder die Warnung bestätigt oder behoben, endet die Alarmierung auf jeder Stufe.

Ein Vorfall, eine Warnung oder eine Episode, die bereits bestätigt oder behoben erstellt wird – also nachträglich erfasst –, führt keine ihrer Richtlinien aus: Niemand wird alarmiert, und ihr Feed vermerkt das und nennt die Richtlinien. Siehe [Bereits bestätigt oder behoben gemeldet](/docs/incidents/declaring-incidents#bereits-bestätigt-oder-behoben-gemeldet).

Um eine Richtlinie zu wiederholen, klicken Sie auf der Karte **Wiederholungsrichtlinie** auf **Bearbeiten**, schalten **Wiederholen, wenn niemand bestätigt** ein und legen die **Anzahl der Wiederholungen** fest.

### Die Eskalationsübersicht

Die Übersicht oben auf der Seite **Eskalationsregeln** zeigt die ganze Leiter: wann jede Stufe alarmiert wird, wen sie alarmiert und was nach der letzten passiert. Eine Stufe, deren Empfänger nicht alle alarmiert werden können, sagt das auf ihrer Karte; klicken Sie auf die Markierung, um zu sehen, wer betroffen ist und warum.

### Wie jede Person erreicht wird

Wie jede Person erreicht wird, die eine Stufe alarmiert, bestimmen ihre eigenen Bereitschaftsregeln: **Benutzereinstellungen** > **Bereitschaftsregeln**, mit je einem Tab für Vorfälle, Vorfallsepisoden, Warnungen und Warnungsepisoden und einer Karte pro Schweregrad, die zeigt, welche Benachrichtigungsmethode nach welcher Wartezeit verwendet wird. Projektadministratoren sehen und ändern die Regeln eines Mitglieds unter **Benutzer** > das Mitglied > **Bereitschaftsregeln**.

```mermaid title="Wen eine Stufe alarmiert und wie jede Person erreicht wird"
flowchart TB
    subgraph notify["Benachrichtigen"]
        direction LR
        schedule["Bereitschaftsplan"]
        team["Team"]
        user["Person"]
    end
    schedule -->|"wer Bereitschaft hat"| person["Alarmierte Person"]
    team -->|"jedes Mitglied"| person
    user -->|"direkt"| person
    person --> rules["Ihre Bereitschaftsregeln"]
    rules --> methods["Ihre Benachrichtigungsmethoden"]
```

Ist für eine Person eine Benutzervertretung wirksam, gehen ihre Alarmierungen stattdessen an die Person, die sie vertritt.

Jede Nachricht ist eine, die ihr Anbieter annimmt, damit eine Alarmierung immer hinausgeht. So viel trägt jeder Kanal:

| Kanal | Die längste Nachricht, die er trägt |
| --- | --- |
| SMS | 1.600 Zeichen |
| Telefonanruf | Was in das Anrufskript von Twilio mit 4.000 Zeichen passt |
| Push-Benachrichtigung | 4 KB, davon höchstens 3 KB für Titel, Text und Daten |
| WhatsApp | 1.024 Zeichen |
| Telegram | 4.096 Zeichen |

Eine längere Nachricht, mit einem langen Titel oder einer langen Beschreibung, die eine Vorlage eingefügt hat, wird gekürzt und endet mit einem Hinweis, dass der vollständige Text in OneUptime steht: „… (truncated — see OneUptime for the full text)“. Der Wortlaut einer WhatsApp-Nachricht ist eine feste Vorlage, daher werden dort stattdessen die längsten Werte gekürzt, jeder mit „…“ am Ende. Die Links in einer Nachricht werden nie gekürzt.

### Wenn eine Alarmierung nicht gesendet wird

Eine nicht gesendete Alarmierung sagt unter **Bereitschaftsprotokolle** in den Benutzereinstellungen der Person, warum: Ihre Zeile zeigt **Fehler**, und ihre Statusmeldung nennt den Grund. Sie bleibt nicht mehr bei **Sending** stehen. Die Meldung sagt eines davon:

- das Guthaben des Projekts konnte sie nicht bezahlen, und wer Guthaben aufladen kann;
- der Kanal ist im Projekt ausgeschaltet, und wer ihn einschalten kann.

Die Eigentümer des Projekts erhalten dazu einmal eine E-Mail, bis das Guthaben aufgeladen oder der Kanal wieder eingeschaltet ist.

In OneUptime Cloud wird jede SMS, jeder Anruf, jede WhatsApp- und Telegram-Nachricht vom Guthaben des Projekts unter **Projekteinstellungen > Benachrichtigungen > Benachrichtigungseinstellungen** bezahlt: Ihre genauen Kosten werden abgebucht, wenn der Anbieter sie annimmt, egal wie viele Nachrichten gleichzeitig hinausgehen.

- Ist dort **Automatisches Aufladen** eingeschaltet, lädt die Nachricht, die das Guthaben unter dem Schwellenwert vorfindet, zuerst den eingestellten Betrag auf und belastet die Karte des Projekts; Nachrichten, die es im selben Moment niedrig vorfinden, belasten die Karte nur einmal.
- Schlägt diese Belastung fehl (es gibt keine Zahlungsmethode oder die Karte wurde abgelehnt), versucht es das automatische Aufladen eine Stunde später erneut, und **Benachrichtigungseinstellungen** zeigt das bis dahin oben an. Guthaben von Hand aufzuladen oder das automatische Aufladen erneut zu speichern, versucht es sofort.
- Alarmierungen gehen mit dem verbleibenden Guthaben weiter hinaus, solange das automatische Aufladen die Karte nicht belasten kann.

> [!IMPORTANT]
> SMS, Telefonanrufe, WhatsApp und Telegram sind in einem neuen Projekt ausgeschaltet: In OneUptime Cloud wird jede Nachricht vom Guthaben des Projekts bezahlt, und eine selbst gehostete Installation braucht zuerst ein Twilio-Konto oder einen Telegram-Bot. Solange ein Kanal aus ist, kann niemand im Projekt eine Methode dafür hinzufügen. Nur ein Projekteigentümer oder jemand mit der Rolle **Billing Admin** oder der Berechtigung **Manage Billing** kann einen Kanal einschalten, in der Karte **Benachrichtigungskanäle** unter **Projekteinstellungen > Benachrichtigungen > Benachrichtigungseinstellungen** — ein Projektadministrator kann es nicht. Alle anderen erfahren überall, wo ein Kanal aus ist, genau, wer ihn einschalten kann: über ihrer eigenen Liste der Methoden dafür, in ihrer Einrichtungs-Checkliste und in der Meldung, die sie bekommen, wenn etwas den Kanal braucht.

## Regeln bearbeiten, umsortieren und löschen

Die Karte jeder Regel hat **Regel bearbeiten** und ein **⋯**-Menü mit den übrigen Aktionen:

- **Regel bearbeiten** öffnet denselben einseitigen Dialog, ausgefüllt mit der Regel, wie sie ist: ihre Empfänger, ihre Wartezeit sowie Name und Beschreibung unter **Weitere Felder**. Fügen Sie Empfänger hinzu oder entfernen Sie sie und klicken Sie auf **Änderungen speichern**. Wird der Name geleert, bekommt die Regel wieder den Namen ihrer Stufe.
- **Nach oben verschieben** und **Nach unten verschieben** im **⋯**-Menü einer Regel ändern ihre Stufe. Eine Regel, die nach ihrer Stufe heißt, behält einen Namen, der zu ihrem Platz passt: Wenn **Level 3** an **Level 2** vorbei nach oben rückt, tauschen beide ihre Namen. Ein selbst gewählter Name wie **Manager** bleibt, wohin die Regel auch geht.
- **Regel löschen** fragt zuerst nach und sagt, wen die Stufe alarmiert. Wird eine Stufe gelöscht, rücken die Stufen darunter nach oben, und Regeln, die nach ihrer Stufe heißen, werden passend umbenannt.

## Regeln mit der API oder Terraform anlegen

Eskalationsregeln sind die Ressource `/api/on-call-duty-policy-escalation-rule`; die Personen, Teams und Pläne, die eine Regel alarmiert, sind die Ressourcen `/api/on-call-duty-policy-escalation-rule-user`, `-team` und `-schedule`.

- Eine ohne `name` angelegte Regel heißt wie im Dashboard nach ihrer Stufe: **Level 3** für eine Regel, die die dritte Stufe ihrer Richtlinie wird. Die Terraform-Ressource für Eskalationsregeln verlangt weiterhin einen Namen.
- `escalateAfterInMinutes` hat außerhalb des Dashboards keinen Standardwert. Eine ohne diesen Wert angelegte Regel wartet nicht: Die nächste Stufe wird alarmiert, sobald diese gelaufen ist. Setzen Sie ihn ausdrücklich — 30 ist der Vorschlag des Dashboards.
- Eine Regel, die mit `onCallSchedules`, `teams` oder `users` (Listen von IDs) in ihren `miscDataProps` angelegt wird, bekommt diese Empfänger; so sendet sie auch die Auswahl **Benachrichtigen** des Dashboards. Eine Regel ohne diese Angaben alarmiert niemanden, bis Sie über die obigen Ressourcen Empfänger hinzufügen.
- Regeln, die nach ihrer Stufe heißen, werden umbenannt, wenn Sie Regeln im Dashboard verschieben oder löschen. Eine Änderung von `order` über die API oder Terraform ändert nur die Reihenfolge.
- Wird eine Bereitschaftsrichtlinie über `/api/on-call-duty-policy` mit `onCallSchedules`, `teams` oder `users` (Listen von IDs) in ihren `miscDataProps` angelegt, bekommt sie wie im Dashboard ihre erste Eskalationsregel: **Level 1**, die diese alarmiert, mit einem `escalateAfterInMinutes` von 30. Jede ID muss zum Projekt gehören, und der Aufrufer muss Eskalationsregeln anlegen dürfen, sonst wird die Richtlinie nicht angelegt. Ohne diese Angaben hat die Richtlinie wie bisher keine Regeln; die Terraform-Ressource für Richtlinien sendet sie nicht.

```bash
curl -X POST https://oneuptime.com/api/on-call-duty-policy \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "projectId": "<project-id>",
      "name": "Production on-call"
    },
    "miscDataProps": {
      "onCallSchedules": ["<schedule-id>"],
      "users": ["<user-id>"]
    }
  }'
```

## Nächste Schritte

:::cards
- [Bereitschaftspläne](/docs/on-call/schedules): Die Rotationen aufbauen, die eine Stufe alarmiert.
- [Zeitachse der Bereitschaftspläne](/docs/on-call/schedule-timeline): Sehen, wer in allen Plänen Bereitschaft hat, und Abdeckungslücken finden.
- [Richtlinie für eingehende Anrufe](/docs/on-call/incoming-call-policy): Anrufer per Telefon zur Bereitschaft durchstellen.
:::
