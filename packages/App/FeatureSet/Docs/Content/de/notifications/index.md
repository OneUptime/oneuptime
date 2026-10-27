# Wie OneUptime Sie erreicht

OneUptime erreicht Sie auf zwei Wegen. Es alarmiert Sie, wenn während Ihrer Bereitschaft ein Vorfall oder eine Warnung ausgelöst wird, und es hält Sie über das auf dem Laufenden, was Ihnen gehört: eine Notiz zu Ihrem Vorfall, eine Überwachung, deren Status sich geändert hat, Ihre nächste Schicht. Beides kommt an den Adressen an, die Sie in den **Benutzereinstellungen** pflegen, Projekt für Projekt. Diese Seite erklärt, wie die Teile zusammenpassen, wo sie zu finden sind und womit Sie starten.

:::cards
- [Drei Seiten, drei Fragen](#drei-seiten-drei-fragen): Methoden, Bereitschaftsregeln und Benachrichtigungseinstellungen, und was jede davon entscheidet.
- [Wo Sie sie finden](#wo-sie-sie-finden): Die Seiten der Benutzereinstellungen, Abschnitt für Abschnitt.
- [Womit Sie starten](#womit-sie-starten): Die Methoden, Regeln und Einstellungen, die ein neues Mitglied erhält.
- [Wenn keine Regel passt](#wenn-keine-regel-passt): Wie ein Alarm Sie trotzdem erreicht, und wer davon erfährt.
:::

## So funktioniert es

```mermaid title="Zwei Wege, auf denen OneUptime Sie erreicht, über dieselben Methoden"
flowchart TB
    page["Ein Vorfall oder eine<br/>Warnung alarmiert Sie<br/>in der Bereitschaft"] --> rules["Ihre Bereitschaftsregeln"]
    owned["Mit einem Datensatz,<br/>der Ihnen gehört,<br/>passiert etwas"] --> settings["Ihre Benachrichtigungs-<br/>einstellungen"]
    rules --> methods["Ihre verifizierten<br/>Methoden: E-Mail,<br/>Telefon, Push, Chat"]
    settings --> methods
```

- Eine Bereitschaftsrichtlinie alarmiert Sie, wenn eine ihrer Eskalationsregeln Sie nennt, ein Team, in dem Sie sind, oder einen Plan, in dem Sie gerade Bereitschaft haben. Ihre Bereitschaftsregeln entscheiden dann, welche Ihrer Methoden OneUptime versucht, und nach welcher Zeit.
- Wenn mit einem Datensatz, der Ihnen gehört, oder mit Ihren Schichten etwas passiert, entscheiden Ihre Benachrichtigungseinstellungen, über welche Kanäle die Neuigkeit geht.
- In beiden Fällen nutzt OneUptime nur Methoden, die Sie verifiziert haben, und zwar in dem Projekt, aus dem der Alarm oder die Neuigkeit kommt.

## Drei Seiten, drei Fragen

| Seite | Was sie enthält | Die Frage, die sie beantwortet |
| --- | --- | --- |
| **Benachrichtigungsmethoden** | Ihre E-Mail-Adressen, Telefonnummern, WhatsApp-Nummern, Telegram-, Slack- und Microsoft Teams-Konten, Push-Geräte und Webhooks | Wo kann OneUptime mich erreichen? |
| **Bereitschaftsregeln** | Für jede Art von Alarm und jeden Schweregrad: welche Methode versucht wird und nach welcher Zeit | Wie werde ich in der Bereitschaft alarmiert? |
| **Benachrichtigungseinstellungen** | Für jedes Ereignis zu einem Datensatz, der Ihnen gehört, oder zu Ihren Schichten: welche Kanäle genutzt werden | Wovon erfahre ich sonst noch, und wo? |

Sie sind mit Absicht getrennt. Jeden Kanal in den **Benachrichtigungseinstellungen** einzuschalten, alarmiert Sie nie, und eine Methode, die Sie nicht verifiziert haben, wird nie genutzt, was auch immer Ihre Regeln sagen.

> [!IMPORTANT]
> Methoden, Regeln und Einstellungen gehören zu einem Projekt. Richten Sie sie in jedem Projekt ein, in dem Sie arbeiten: Die **Benutzereinstellungen** zeigen immer das Projekt, in dem Sie gerade sind.

## Wo Sie sie finden

Öffnen Sie die **Benutzereinstellungen**, rechts in der Leiste unter der oberen Leiste. Ihr Seitenmenü enthält alles dazu, wie OneUptime Sie erreicht:

| Abschnitt | Seiten |
| --- | --- |
| **Erste Schritte** | **Einrichtungs-Checkliste**: was noch einzurichten ist, in der Reihenfolge, die zählt |
| **Warnungen & Benachrichtigungen** | **Benachrichtigungsmethoden**, **Bereitschaftsregeln**, **Benachrichtigungseinstellungen** und **E-Mail-Einstellungen**, wo Sie festlegen, wie viele E-Mails Ihre Neuigkeiten ergeben |
| **Bereitschaftsprotokolle** | **Bereitschaftsprotokolle**: jeder Alarm an Sie in diesem Projekt, und was gesendet wurde |
| **Richtlinie für eingehende Anrufe** | **Eingehende Telefonnummern**: die Nummer, unter der eine Richtlinie für eingehende Anrufe Sie anruft |
| **Kalender** | **Kalender-Feed**: Ihre Schichten in Ihrer Kalender-App, und Erinnerungen, bevor sie beginnen |
| **Profil** | **Benutzerdefinierte Felder**: Angaben, die Ihr Projekt von seinen Mitgliedern erfragt |
| **Arbeitsbereich** | **Slack** und **Microsoft Teams**: Ihr eigenes Konto, in jedem Arbeitsbereich, den das Projekt verbunden hat |

**Erste Schritte** und **Warnungen & Benachrichtigungen** sind geöffnet; die anderen Abschnitte starten eingeklappt, und ein Abschnitt öffnet sich von selbst, wenn Sie auf einer seiner Seiten sind. **Arbeitsbereich** erscheint nur, wenn das Projekt Slack oder Microsoft Teams verbunden hat.

Projekteigentümer und Admins können Ihre Einrichtung ebenfalls ansehen: Unter **Benutzer** öffnen sie Ihre Zeile und deren Abschnitt **Bereitschaft**, mit **Einsatzbereitschaft**, **Benachrichtigungsmethoden** und **Bereitschaftsregeln**. Sie können dort eine Methode für Sie hinzufügen, aber der Code geht an die Methode selbst, sodass nur Sie sie verifizieren können.

## Womit Sie starten

Wenn Sie einem Projekt mit einer verifizierten Anmelde-E-Mail beitreten, richtet OneUptime Sie so ein, dass ein Alarm Sie immer erreichen kann:

1. Ihre Anmelde-E-Mail wird als verifizierte E-Mail-Methode hinzugefügt.
2. Für jeden Schweregrad, auf jedem der vier Tabs der **Bereitschaftsregeln**, schickt Ihnen eine Regel eine E-Mail, sobald Sie alarmiert werden.
3. Eine Reihe von Neuigkeiten zu dem, was Ihnen gehört, und zu Ihren Schichten ist per E-Mail eingeschaltet. Siehe [Benachrichtigungseinstellungen](/docs/notifications/notification-settings#was-für-ein-neues-mitglied-eingeschaltet-ist).

Jede Methode, die Sie später verifizieren, erhält dieselben Regeln: eine Regel für jeden Schweregrad, die gesendet wird, sobald Sie alarmiert werden. Eine Telefonnummer für SMS zu verifizieren heißt also, dass jeder Alarm Ihnen auch eine SMS schickt. Um SMS nur für kritische Alarme zu behalten, löschen Sie die SMS-Regeln der anderen Schweregrade. Siehe [Persönliche Bereitschaftsregeln](/docs/notifications/on-call-rules#die-regeln-mit-denen-sie-starten).

## Die Einrichtungs-Checkliste

**Benutzereinstellungen → Einrichtungs-Checkliste** öffnet **Ihre Einrichtungs-Checkliste**: alles, was OneUptime braucht, um Sie zu erreichen, in der Reihenfolge, die zählt. Ein Schritt verlinkt die Seite, die ihn erledigt, und **Erneut prüfen** liest alles neu ein.

| Abschnitt | Was er prüft |
| --- | --- |
| **Damit wir Sie erreichen können** | Sie haben eine Methode, jede hinzugefügte Methode ist verifiziert, und mindestens eine davon liegt auf einem Kanal, den das Projekt eingeschaltet hat |
| **Wie Sie alarmiert werden möchten** | Jeder Schweregrad hat eine Regel, auf jedem der vier Tabs der **Bereitschaftsregeln** |
| **Auf dem Laufenden bleiben** | Sie erfahren, wann eine Schicht beginnt, und hinter jedem Kanal, den Sie in den **Benachrichtigungseinstellungen** eingeschaltet haben, steht eine verifizierte Methode |
| **Wünschenswert** | Eine Nummer für eingehende Anrufe, Ihre Slack- und Microsoft Teams-Konten, ein Kalender-Link und Ihre Profilfelder |

**Auf dem Laufenden bleiben** nennt Push nur für ein Update, das Sie auf keinem anderen Weg erreicht: Jedes Update, das ein neues Mitglied per Push erhält, kommt auch per E-Mail.

**Wünschenswert** zählt nicht für den Fortschrittsbalken, ebenso wenig ein Schritt, den nur jemand anderes erledigen kann. Die Zeile oben fasst alles zusammen:

| Überschrift | Was sie bedeutet |
| --- | --- |
| **Alles ist eingerichtet** | Alarme erreichen Sie, und es ist nichts mehr zu tun |
| **Ein paar Dinge müssen noch eingerichtet werden** | Ein Schweregrad hat keine Regel, oder ein Schritt ist noch nicht erledigt |
| **Noch kann Sie nichts erreichen** | Keine Ihrer Methoden kann genutzt werden: Keine ist verifiziert, oder jede verifizierte liegt auf einem Kanal, den dieses Projekt ausgeschaltet hat |
| **Sie sind eingerichtet und haben gerade keine Bereitschaft** | Alles ist bereit für den Tag, an dem eine Richtlinie Sie nennt |

## Wenn keine Regel passt

Ein Alarm kann Sie für eine Art und einen Schweregrad erreichen, für die Sie keine Regel haben, etwa für einen Schweregrad, der nach Ihrem Beitritt hinzugekommen ist. OneUptime alarmiert Sie trotzdem, über das, was Sie verifiziert haben:

1. Jede kostenlose Methode, die Sie haben: Push-Geräte, E-Mail-Adressen, Slack und Microsoft Teams.
2. Wenn Sie keine davon haben, eine kostenpflichtige Methode, in dieser Reihenfolge: SMS, ein Telefonanruf, WhatsApp, Telegram. Es ist die erste, die Sie verifiziert haben, auf einem Kanal, den das Projekt eingeschaltet hat.
3. Wenn Sie auch davon keine haben, ein Webhook.

Sie erhalten darüber eine E-Mail, ebenso die Eigentümer der Bereitschaftsrichtlinie, oder die Eigentümer des Projekts, wenn die Richtlinie keine hat. Ist gar nichts verifiziert, kann der Alarm nicht zugestellt werden, und die E-Mail sagt stattdessen das. Diese E-Mails werden zurückgehalten, solange weitere Alarme eintreffen, sodass ein Sturm von Alarmen kein Sturm von E-Mails wird. Wie Sie die fehlende Regel hinzufügen, steht unter [Persönliche Bereitschaftsregeln](/docs/notifications/on-call-rules#wenn-ein-schweregrad-keine-regel-hat).

## Fehlerbehebung

:::details Ich hatte Bereitschaft, aber nichts hat mich erreicht
Öffnen Sie **Benutzereinstellungen → Bereitschaftsprotokolle**. Keine Zeile für den Vorfall bedeutet, dass seine Bereitschaftsrichtlinie Sie nie alarmiert hat: Prüfen Sie ihre Eskalationsregeln und wer Bereitschaft hatte. Bei einer Zeile mit dem Status **Fehler** sagt **Statusmeldung anzeigen**, warum, etwa ein Kanal, den das Projekt ausgeschaltet hat. Prüfen Sie dann, ob Ihre Methoden verifiziert sind und ob **Ihre Einrichtungs-Checkliste** unter **Damit wir Sie erreichen können** nichts mehr offen hat.
:::

:::details Ich bekomme E-Mails zu Datensätzen, nach denen ich nie gefragt habe
Sie sind Eigentümer des Datensatzes, direkt oder über ein Team, oder der Datensatz hat keine Eigentümer und Sie sind ein Projekteigentümer. Schalten Sie das Ereignis unter **Benutzereinstellungen → Benachrichtigungseinstellungen** aus, oder verringern Sie die Menge unter **Benutzereinstellungen → E-Mail-Einstellungen**.
:::

:::details Ich habe eine Telefonnummer hinzugefügt, aber sie steht nicht in meinen Regeln
Eine Nummer kommt in Ihre Regeln, sobald sie verifiziert ist. Klicken Sie in ihrer Zeile auf **Verifizieren** und geben Sie den Code ein. Hat ihre Karte keine Schaltfläche zum Hinzufügen, hat das Projekt diesen Kanal ausgeschaltet. Siehe [Benachrichtigungsmethoden](/docs/notifications/notification-methods#einen-kanal-für-ihr-projekt-einschalten).
:::

## Nächste Schritte

:::cards
- [Benachrichtigungsmethoden](/docs/notifications/notification-methods): Fügen Sie die Adressen hinzu, unter denen OneUptime Sie erreichen darf, und verifizieren Sie sie.
- [Persönliche Bereitschaftsregeln](/docs/notifications/on-call-rules): Legen Sie fest, welche Methode jeder Alarm versucht, und wann.
- [Benachrichtigungseinstellungen](/docs/notifications/notification-settings): Wählen Sie die Neuigkeiten, von denen Sie erfahren, und über welche Kanäle.
- [Eskalationsregeln](/docs/on-call/escalation-rules): Wie eine Bereitschaftsrichtlinie Stufe für Stufe entscheidet, wer alarmiert wird.
:::
