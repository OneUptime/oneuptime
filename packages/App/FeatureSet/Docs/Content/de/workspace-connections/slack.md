# Slack

Verbinden Sie OneUptime mit Slack, um Vorfälle, Warnungen, Episoden, geplante Wartungen, Monitore und Bereitschafts-Updates in Ihren Kanälen zu posten, jedem Vorfall einen eigenen Kanal zu geben und Responder handeln zu lassen, ohne Slack zu verlassen: bestätigen, beheben, Notizen hinzufügen, die Bereitschaft alarmieren und Vorfälle melden.

:::cards
- [Slack verbinden](#slack-verbinden): Installieren Sie OneUptime in Ihrem Workspace und verknüpfen Sie dann Ihr eigenes Konto.
- [Benachrichtigungsregeln](#benachrichtigungsregeln): Legen Sie fest, welche Ereignisse wohin posten und welche einen eigenen Kanal bekommen.
- [Der Befehl /oneuptime](#der-befehl-oneuptime): Vorfälle melden, Wartungen planen, sehen, wer Bereitschaft hat, und die KI fragen.
- [Bereitschafts-Benutzergruppen](#bereitschafts-benutzergruppen): Halten Sie eine Benutzergruppe gleich denen, die Bereitschaft haben, und alarmieren Sie sie.
- [Aus Slack auf Vorfälle, Warnungen und Ereignisse reagieren](#aus-slack-auf-vorfälle-warnungen-und-ereignisse-reagieren): Die Schaltflächen in den Nachrichten von OneUptime.
:::

## So funktioniert es

```mermaid title="Von einem Ereignis in OneUptime zu einer Nachricht in Slack"
flowchart TB
    event["Ein Vorfall, eine Warnung oder ein Ereignis<br/>entsteht oder ändert sich"] --> rules{"Benachrichtigungsregeln,<br/>deren Bedingungen passen"}
    rules -->|"Create Slack Channel"| own["Ein eigener Kanal,<br/>seine Personen eingeladen"]
    rules -->|"Post to Existing Slack Channel"| existing["Ihre bestehenden Kanäle"]
    own --> message["Eine Nachricht mit Schaltflächen"]
    existing --> message
    message -->|"Ein Responder drückt eine"| change["Die Änderung erfolgt in OneUptime,<br/>als diese Person"]
```

Zwei Verbindungen machen das möglich:

- **Die Verbindung des Projekts**, einmal hergestellt: die App von OneUptime, installiert in Ihrem Slack-Workspace. Sie postet die Nachrichten, legt die Kanäle an und lädt Personen ein.
- **Die eigene Verbindung jeder Person**: ihr Slack-Konto, verknüpft mit ihrem OneUptime-Konto. Schaltflächen, Befehle und Emoji-Reaktionen handeln als diese Person, mit ihren Berechtigungen im Projekt.

## Bevor Sie beginnen

- **Eine Rolle, die das Projekt verbinden darf:** **Project Owner**, **Project Admin** oder **Project Member**. Zum Deinstallieren der App braucht es **Project Owner** oder **Project Admin**.
- **Einen Slack-Workspace**, in dem Sie Apps installieren dürfen.
- **Den Growth-Tarif in OneUptime Cloud** für Benachrichtigungsregeln und Zusammenfassungen. Siehe [Benachrichtigungsregeln unterhalb des Growth-Tarifs](#benachrichtigungsregeln-unterhalb-des-growth-tarifs).
- **Auf einem selbst gehosteten Server** zuerst eine dafür eingerichtete Slack-App. Siehe [Slack-Integration](/docs/self-hosted/slack-integration).

## Slack verbinden

:::steps
### OneUptime in Ihrem Slack-Workspace installieren

Gehen Sie zu **Projekteinstellungen** > **Arbeitsbereich** > **Slack** und klicken Sie auf **Mit Slack verbinden**. Wählen Sie den Workspace und erlauben Sie OneUptime den Zugriff. Slack schickt Sie zurück auf dieselbe Seite, die nun den Workspace nennt, mit dem das Projekt verbunden ist. Solange kein Workspace verbunden ist, enthält der Abschnitt **Arbeitsbereich** der Menüs Vorfälle, Warnungen, Geplante Wartung, Monitore und Bereitschaft den Eintrag **Slack oder Teams verbinden**, der ebenfalls hierher führt.

### Ihr eigenes Slack-Konto verbinden

Beim Installieren der App wird das Konto der Person verknüpft, die sie installiert hat. Alle anderen verknüpfen ihr eigenes Slack-Konto unter **Benutzereinstellungen** > **Arbeitsbereich** > **Slack** mit **Connect my account with Slack**, um als sie selbst auf Vorfälle zu reagieren und Direktnachrichten zu erhalten. Dieser Abschnitt erscheint, sobald das Projekt mit Slack verbunden ist.

### Eine Benachrichtigungsregel hinzufügen

Gehen Sie zu **Vorfälle** > **Arbeitsbereich** > **Slack**. Der Abschnitt **Arbeitsbereich** listet nur die Chat-Workspaces, die Ihr Projekt verbunden hat, daher erscheint **Slack** dort, sobald es verbunden ist. Legen Sie eine Regel an, zum Beispiel eine, die für jeden neuen Vorfall einen Slack-Kanal erstellt und die Eigentümer des Vorfalls einlädt. Siehe [Benachrichtigungsregeln](#benachrichtigungsregeln).

### Die Regel testen

Klicken Sie in der Zeile der Regel auf **Regel testen**. In den Kanälen, die die Regel nennt, kommt eine Testnachricht an. Siehe [Eine Regel testen](#eine-regel-testen).
:::

## Benachrichtigungsregeln

Eine Benachrichtigungsregel legt fest, welche Ereignisse in Slack gepostet werden, und wohin. Jedes Produkt hat eigene Regeln, unter **Arbeitsbereich** > **Slack** in seinem Menü:

| Produkt | Registerkarten seiner Seite **Slack** |
| --- | --- |
| **Vorfälle** | **Vorfälle**, **Vorfallsepisoden**, **Zusammenfassung** |
| **Warnungen** | **Warnungen**, **Warnungsepisoden**, **Zusammenfassung** |
| **Geplante Wartung** | Eine Liste von Regeln |
| **Monitore** | Eine Liste von Regeln |
| **Bereitschaftsdienst** | Eine Liste von Regeln |

Eine Regel wird in vier Schritten angelegt:

| Schritt | Was Sie festlegen |
| --- | --- |
| **Grundlegend** | **Regelname** und **Regelbeschreibung**. |
| **Bedingungen** | Für welche Ereignisse die Regel auslöst, zum Beispiel nach Schweregrad, Status, Beschriftung, Monitor oder Wörtern im Titel. Ohne Bedingungen löst sie bei jedem Ereignis aus. Bei zwei oder mehr legt **Abgleichsbedingung** fest, ob alle zutreffen müssen oder eine genügt. |
| **Ziel** | Wohin sie postet: **Post to Existing Slack Channel** mit den Kanalnamen, **Create Slack Channel** mit dem Namen des neuen Kanals und wer eingeladen wird, oder beides. |
| **Videoanruf** | Nur Vorfälle und Warnungen: für jeden einen Anruf starten. Siehe [Videoanrufe](/docs/workspace-connections/video-calls). |

Ein Kanal, den die Regel anlegt, wird aus **New Slack Channel Name** und der Nummer des Datensatzes benannt, etwa `oneuptime-incident-42`, und nur ein angelegter Kanal bekommt die Personen, die die Regel einlädt: die Eigentümer des Datensatzes, gewählte Teams und Benutzer und, bei Vorfällen und Warnungen, die Bereitschaftspersonen, sobald sie alarmiert werden. Ein privater Vorfall, eine private Warnung oder Episode bekommt einen privaten Kanal. Jede spätere Änderung des Datensatzes — ein Statuswechsel, eine Notiz, ein neuer Eigentümer — wird in seinen Kanälen und in den bestehenden Kanälen gepostet, die seine Regeln nennen. Ein Vorfall, eine Warnung oder Episode, die bereits behoben erstellt wird, bekommt keinen eigenen Kanal; ihre Erstellungsnachricht geht trotzdem in die Kanäle, die Ihre Regeln nennen. Siehe [Bereits bestätigt oder behoben gemeldet](/docs/incidents/declaring-incidents#bereits-bestätigt-oder-behoben-gemeldet).

Ein Vorfall, eine Warnung, eine Episode oder ein geplantes Wartungsereignis mit einem eigenen Kanal hat im Kopf seiner Seite in OneUptime, neben den Statusschaltflächen, **In Slack öffnen**. Das öffnet diesen Kanal in einem neuen Tab, in der Slack-App oder im Browser. Ein Datensatz mit zwei eigenen Kanälen listet beide unter der Schaltfläche. Ein Datensatz mit Kanälen in Slack und in Microsoft Teams hat stattdessen eine Schaltfläche **Kanal öffnen**, die sie alle auflistet. Die bestehenden Kanäle, in die Ihre Regeln posten, werden nicht angeboten.

Ein Kanal bleibt lesbar: Jedes Ereignis wird einmal gepostet, und der erste Status eines Datensatzes steht in der Nachricht, die den Datensatz ankündigt, nicht in einer eigenen Nachricht. Ein Durchlauf einer Bereitschaftsrichtlinie ist eine einzige Nachricht, die bearbeitet wird, während der Durchlauf eskaliert: wer alarmiert wurde, wie oft und wie, wer nicht und warum, und wer bestätigt hat. Eine neue Nachricht wird nur gepostet, wenn jemand handeln muss: Eine Eskalationsregel hat niemanden erreicht, oder der Durchlauf endete, ohne dass jemand bestätigt hat. Wer sein Slack-Konto nicht mit OneUptime verbunden hat, kann keinem Kanal hinzugefügt werden; OneUptime sagt das einmal pro Kanal, in einer einzigen Nachricht, die alle nennt und bearbeitet wird, wenn die Liste wächst. Schicken Sie ihnen den Link **Connect Slack account** aus dieser Nachricht, damit sie ihr Konto in einem Schritt verbinden. Dass die Eigentümer eines Datensatzes oder die Statusseiten-Abonnenten benachrichtigt wurden, steht in seinem Feed in OneUptime.

**Projekteinstellungen** > **Arbeitsbereich** > **Slack** listet die Kanäle, die OneUptime sieht, mit **Test senden** neben jedem. Einem öffentlichen Kanal tritt OneUptime beim ersten Posten selbst bei. Ein privater Kanal wird erst aufgelistet und kann erst bespielt werden, nachdem die OneUptime-App in Slack in ihn eingeladen wurde.

## Eine Regel testen

**Regel testen** in der Zeile einer Regel postet eine Testnachricht für diese Regel in die Kanäle, die sie nennt, damit Sie sie ankommen sehen. Legt die Regel für jedes Ereignis einen Kanal an, legt auch der Test einen an und lädt die Personen der Regel ein.

Wie **Test senden** neben einem Kanal unter **Projekteinstellungen** > **Arbeitsbereich** > **Slack** braucht er die Berechtigung, Benachrichtigungsregeln anzulegen: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** oder **Create Workspace Notification Rule** und **Read Workspace Notification Rule** in einer benutzerdefinierten Rolle. Für jemanden, der die Regeln nur sehen kann, etwa ein **Viewer**, ist **Regel testen** gesperrt, und sein Tooltip sagt, was es braucht; die API lehnt seinen Test mit "You do not have permission to send test notifications in this project." ab. In OneUptime Cloud braucht das Testen einer Regel den Tarif **Growth**, wie das Anlegen einer.

In OneUptime Cloud braucht auch **Test senden** neben einem Kanal den Tarif **Growth**, denn in einen Kanal zu posten ist genau das, was Regeln und Zusammenfassungen tun. **Test jetzt senden** bei einer Zusammenfassung braucht die Berechtigung, Zusammenfassungen anzulegen (**Create Workspace Notification Summary** und **Read Workspace Notification Summary** in einer benutzerdefinierten Rolle) und in OneUptime Cloud den Tarif **Growth**; für alle anderen ist es gesperrt, und sein Tooltip sagt, was es braucht. Ein MCP-Client, der mit Lesezugriff verbunden ist, kann keinen Test senden.

## Zusammenfassungen

Die Registerkarte **Zusammenfassung** von **Vorfälle** > **Arbeitsbereich** > **Slack** (und von **Warnungen**) postet eine wiederkehrende Übersicht in die Kanäle, die Sie nennen: wie viele Vorfälle oder Warnungen es gab, wie schnell sie bestätigt und behoben wurden, und eine Liste mit Links. Eine neue Zusammenfassung geht jede Woche raus und umfasst die letzten 7 Tage. Lassen Sie **Ersten Bericht senden um** leer, und die erste geht um 09:00 zu Beginn der nächsten Woche, des nächsten Tages oder Monats raus; das Formular sagt, wann.

Eine Zusammenfassung geht nach der Uhr ihrer **Zeitzone** raus, die mit Ihrer beginnt. Sie behält dort das ganze Jahr ihre Tageszeit: Eine für 09:00 in Berlin eingestellte geht auch nach der Umstellung auf Sommer- oder Winterzeit um 09:00 in Berlin raus, und die Daten in ihrer Nachricht sind ebenfalls die Berliner. Senden Sie über die API `timezone` als IANA-Zeitzonennamen, etwa `Europe/Berlin`. Eine ohne Zeitzone erstellte Zusammenfassung übernimmt die Zeitzone aus dem Profil ihrer erstellenden Person, oder UTC, wenn ein API-Schlüssel sie erstellt.

Das Formular einer Zusammenfassung hat vier Schritte: **Grundinformationen** (ihr Name und die Kanäle), **Zeitplan**, **Inhalt** (**Was einzuschließen ist**) und **Filter** (welche Vorfälle oder Warnungen sie zählt).

## Benachrichtigungsregeln unterhalb des Growth-Tarifs

In OneUptime Cloud gehören Benachrichtigungsregeln und Zusammenfassungen zum Tarif **Growth** und höher. Ein Projekt darunter behält die Regeln und Zusammenfassungen, die es schon hat, und sie posten weiterhin in Slack. Daher zeigt die Seite **Slack** jedes Produkts (Vorfälle, Warnungen, Geplante Wartung, Bereitschaftsdienst, Monitore) den Tarifhinweis und darunter diese (**Noch eingerichtete Benachrichtigungsregeln**, **Noch eingerichtete Zusammenfassungen**): Löschen Sie eine Regel, oder schalten Sie eine Zusammenfassung aus oder löschen Sie sie. Regeln und Zusammenfassungen hinzuzufügen oder zu ändern braucht **Growth**.

## In Slack alarmiert werden

Um per Direktnachricht alarmiert zu werden, wenn Sie Bereitschaft haben, fügen Sie Slack als eine Ihrer Benachrichtigungsmethoden hinzu:

:::steps
1. Verbinden Sie Ihr eigenes Slack-Konto (siehe [Slack verbinden](#slack-verbinden)).
2. Gehen Sie zu **Benutzereinstellungen** > **Benachrichtigungsmethoden**, öffnen Sie die Registerkarte **Workspace Apps** und klicken Sie auf **Slack-Konto hinzufügen**.
3. Klicken Sie in seiner Zeile auf **Testnachricht senden**. Die Nachricht kommt in Ihren Slack-Direktnachrichten an.
:::

Durch das Hinzufügen landet es sofort in Ihren Bereitschaftsregeln, sodass Alarme Sie ab dann in Slack erreichen. Welche Alarme es bekommt, ändern Sie unter **Benutzereinstellungen** > **Bereitschaftsregeln**.

## Nachrichten als Notizen speichern

Reagieren Sie auf eine Nachricht im Kanal eines Vorfalls, einer Warnung, einer Episode oder eines geplanten Wartungsereignisses, und OneUptime speichert sie als Notiz an diesem Datensatz und bestätigt das mit einer Antwort im Thread:

| Reaktion | Gespeichert als |
| --- | --- |
| 📌 Ein Pin-Emoji oder Slacks eigenes **Pin to channel** | Eine private Notiz, die nur Ihr Team sieht |
| 📢 Ein Megafon- oder Lautsprecher-Emoji | Eine öffentliche Notiz, die auf der Statusseite erscheint. Nur Vorfälle und geplante Wartungsereignisse. |

Die Notiz übernimmt die Nachricht so, wie Slack sie gezeigt hat: ihre Formatierung, Links und Code, die erwähnten Personen und Kanäle mit Namen und ihre Dateien und Bilder als Links darauf. Eine öffentliche Notiz lässt die Dateien und Bilder weg, da sie sich nur für Ihr Team öffnen.

Sie gibt die Worte dessen wieder, der die Nachricht geschrieben hat: mit seinem OneUptime-Namen, wenn sein Slack-Konto verbunden ist, sonst mit dem Namen, den Slack zeigt. Eine private Notiz wird in der Zeitleiste dort eingeordnet, wo die Nachricht gepostet wurde, egal wie viel später sie gespeichert wird. Eine öffentliche Notiz wird beim Speichern eingeordnet, also dann, wenn die Statusseite sie zeigt. Die Zeitleiste nennt, wer sie gespeichert hat. Die Notiz wird nicht zurück in den Kanal gepostet, in dem die Nachricht bereits steht.

Die Notiz wird als Sie gespeichert, mit Ihren Berechtigungen. Ist Ihr Slack-Konto noch nicht verbunden, bittet OneUptime Sie in einer Nachricht, die nur Sie sehen, es zu verbinden, mit einer Schaltfläche, die die Nachricht speichert, sobald Sie das getan haben. Eine Nachricht wird nur einmal gespeichert, egal wie viele Personen reagieren.

## Der Befehl /oneuptime

OneUptime hat in Slack einen einzigen Befehl, `/oneuptime`. Das Wort, das Sie danach schreiben, sagt, was zu tun ist; alles andere danach ist eine Frage an OneUptime AI.

| Befehl | Was er tut |
| --- | --- |
| `/oneuptime help` | Listet die Befehle auf, mit Beispielen. |
| `/oneuptime incident [title]` | Öffnet das Vorfallsformular, mit ausgefülltem Titel. |
| `/oneuptime maintenance [title]` | Öffnet das Formular für geplante Wartung, mit ausgefülltem Titel. |
| `/oneuptime oncall` | Listet, wer gerade in jedem Bereitschaftsplan, den Sie sehen können, Bereitschaft hat, bis wann und wer als Nächstes dran ist. |
| `/oneuptime page [who] [message]` | Alarmiert die Personen, die Sie mit @ erwähnen, wegen Ihrer Nachricht, oder öffnet ein Formular, in dem Sie wählen, wer alarmiert wird. Siehe [Jemanden aus Slack alarmieren](#jemanden-aus-slack-alarmieren). |
| `/oneuptime ask [question]`, oder jede Frage | OneUptime AI antwortet zu Ihren Logs, Traces, Metriken, Vorfällen und Monitoren. |

Die Antworten auf `help` und `oncall` sind Nachrichten, die nur Sie sehen, unter dem Befehl. Ein erstes Wort, das wie ein vertippter Befehl aussieht, etwa `incidnet`, bekommt den Befehl, dem es ähnelt, statt einer Antwort von OneUptime AI. Die Formulare für Vorfälle und Wartungen handeln als Sie: siehe [Vorfälle und Wartungen aus Slack erstellen](#vorfälle-und-wartungen-aus-slack-erstellen).

> [!NOTE]
> `/oneuptime incident` und `/oneuptime maintenance` ersetzen `/incident` und `/maintenance`, die mit gleichnamigen Befehlen anderer Slack-Apps kollidieren konnten. Eine Slack-App, die aus einem früheren Manifest erstellt wurde, behält sie, und sie öffnen dieselben Formulare, bis die App aktualisiert wird: siehe [Apps aus einem älteren Manifest](/docs/self-hosted/slack-integration#apps-aus-einem-älteren-manifest).

## Die Startseite von OneUptime in Slack

Öffnen Sie OneUptime unter **Apps** in der Seitenleiste von Slack: Der Tab **Home** zeigt, was im Projekt geschieht, so wie Sie es sehen dürfen, und wird bei jedem Öffnen neu gelesen.

- **Ihre Bereitschaft.** Die Bereitschaftspläne, in denen Sie gerade Bereitschaft haben, und bis wann, oder sonst Ihre nächste Schicht.
- **Was offen ist.** Die neuesten offenen Vorfälle und Warnungen, die Sie lesen dürfen, jeweils mit einem Link auf ihre Seite in OneUptime.
- **Die Schaltflächen.** **Declare incident**, **Schedule maintenance** und **Page someone** öffnen dieselben Formulare wie `/oneuptime incident`, `/oneuptime maintenance` und `/oneuptime page`, und **Who's on call** antwortet wie `/oneuptime oncall`.

Die Startseite liest als Sie, deshalb braucht sie Ihr eigenes verbundenes Slack-Konto. Bis es verbunden ist, enthält sie die Schaltfläche **Connect Slack account** und zeigt Ihnen Ihre Startseite, sobald Sie es verbunden haben.

Wenn jemand OneUptime zu einem Kanal hinzufügt, postet es dort eine Begrüßung: wie man ihm eine Frage stellt und wo man eine Benachrichtigungsregel hinzufügt, die in den Kanal postet.

## OneUptime AI aus Slack fragen

Fragen Sie in natürlicher Sprache nach Ihren Logs, Traces, Metriken, Vorfällen und Monitoren. Erwähnen Sie OneUptime in einem Kanal mit @ oder schicken Sie eine Direktnachricht, und die Antwort kommt im Thread. `/oneuptime ask which monitors are down?` postet seine Antwort im Kanal. Beides braucht Ihr verbundenes Slack-Konto und eingeschaltete KI für das Projekt. Antworten in Slack lesen nur: Um etwas zu ändern, nutzen Sie die Schaltflächen. Siehe [KI fragen](/docs/ai/ask-ai).

OneUptime antwortet nur auf das, was an OneUptime gerichtet ist.

- **In Ihrem eigenen Gespräch antworten Sie einfach.** Eine Frage, die Sie in einem Kanal stellen, nicht in einem Thread, beginnt ein Gespräch im Thread darunter: Antworten Sie dort, um weiterzufragen, ohne OneUptime erneut zu erwähnen; alle anderen steigen ein, indem sie OneUptime erwähnen.
- **In jedem anderen Thread erwähnen Sie OneUptime.** Unter der Nachricht eines Vorfalls zum Beispiel erwähnen Sie OneUptime jedes Mal: Was Personen dort einander schreiben, bekommt keine Antwort.
- **Wenn Ihr Slack-Konto nicht verbunden ist.** OneUptime bittet Sie einmal pro Gespräch, es zu verbinden, in einer Nachricht, die nur Sie sehen, mit einer Schaltfläche **Connect Slack account**.

## Vorfälle und Wartungen aus Slack erstellen

`/oneuptime incident` und `/oneuptime maintenance` öffnen ein Formular, das Sie als Sie selbst ausfüllen und absenden: als das OneUptime-Konto, mit dem Ihr Slack-Konto verbunden ist (siehe [Slack verbinden](#slack-verbinden)), mit dessen Berechtigungen im Projekt. Ist Ihr Slack-Konto nicht verbunden oder Ihr OneUptime-Konto kein Mitglied des Projekts mehr, sagt Ihnen OneUptime dort, wo Sie den Befehl ausgeführt haben, in einer Nachricht, die nur Sie sehen, was zu tun ist, und es öffnet sich kein Formular. Die Verknüpfungen **Create New Incident** und **Create Scheduled Event** öffnen dieselben Formulare.

- **Wer sie nutzen darf.** Die Personen, die in OneUptime einen Vorfall melden oder ein geplantes Wartungsereignis anlegen dürfen: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** und **Incident Member** für einen Vorfall (**Create Incident** in einer benutzerdefinierten Rolle), und **Scheduled Maintenance Admin** und **Scheduled Maintenance Member** für ein Ereignis (**Create Scheduled Maintenance**). Alle anderen erfahren das dort, wo sie ihn ausgeführt haben, und es öffnet sich kein Formular.
- **Was ein Formular anbietet.** Jede Liste — Schweregrade, Monitore, Monitorstatus, Bereitschaftsrichtlinien und Beschriftungen — enthält, was Sie lesen dürfen, wie dieselbe Liste in OneUptime: bei einer auf einige Beschriftungen beschränkten Rolle die Monitore und Bereitschaftsrichtlinien mit diesen Beschriftungen. Eine Liste, die Sie gar nicht lesen dürfen, fehlt im Formular. Archivierte Bereitschaftsrichtlinien werden nie angeboten.
- **Was ein Formular nennen darf.** Der Vorfall oder das Ereignis wird mit Ihren eigenen Berechtigungen erstellt und Ihnen zugeschrieben. Ein Monitor, eine Bereitschaftsrichtlinie, eine Beschriftung, ein Schweregrad oder Status, den Sie nicht lesen dürfen, oder einer eines anderen Projekts, wird abgelehnt wie einer, den das Projekt nicht hat, auch aus einem Formular, das vor der Änderung Ihres Zugriffs geöffnet wurde, und es wird nichts erstellt. OneUptime sagt Ihnen im Kanal, in einer Nachricht, die nur Sie sehen, warum.

**Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode funktioniert genauso: Es braucht die Berechtigung, eine Bereitschaftsrichtlinie auszuführen (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** und **On-Call Member**, oder **Create On-Call Duty Policy Execution Log** in einer benutzerdefinierten Rolle) und diesen Vorfall, diese Warnung oder Episode zu lesen, und bietet die aktiven Bereitschaftsrichtlinien an, die Sie lesen dürfen.

## Jemanden aus Slack alarmieren

`/oneuptime page @nawaz The checkout API is throwing 500s` alarmiert Nawaz sofort. OneUptime erstellt eine Warnung mit Ihrer Nachricht als Titel, und jede Person, die Sie mit @ erwähnen, bekommt einen Anruf, eine SMS, eine Push-Benachrichtigung oder eine E-Mail, wie es ihre eigenen Bereitschaftsregeln vorsehen, bis jemand die Warnung bestätigt.

- **Wer sofort alarmiert wird.** Die Personen, die Sie mit @ erwähnen, und alle, die in den Bereitschaftsplänen Bereitschaft haben, denen eine von Ihnen mit @ erwähnte Benutzergruppe folgt (siehe [Bereitschafts-Benutzergruppen](#bereitschafts-benutzergruppen)), wenn eine Nachricht auf sie folgt. OneUptime erkennt eine Person am OneUptime-Konto, mit dem ihr Slack-Konto verbunden ist, oder sonst an der E-Mail-Adresse, die Slack für sie hat. Niemand außerhalb des Projekts wird alarmiert.
- **Alles andere öffnet ein Formular.** Ohne Erwähnung mit @, ohne Nachricht, mit `@here`, mit einer Benutzergruppe, die keinem für Sie sichtbaren Bereitschaftsplan folgt, oder mit einer Person, die OneUptime nicht erkennt, öffnet sich das Formular **Page someone** mit dem, was Sie geschrieben haben, und nennt, wen es nicht auswählen konnte. Wählen Sie Personen, ein Team, einen Bereitschaftsplan, der alarmiert, wer darin gerade Bereitschaft hat, oder eine Bereitschaftsrichtlinie, die über ihre Eskalationsregeln alarmiert, und senden Sie es ab. Ein Name, den Sie zuerst schreiben, wie in `/oneuptime page Primary The disk is full`, wählt den Bereitschaftsplan, das Team oder die Richtlinie mit diesem Namen.
- **Wo es erscheint.** Der Kanal zeigt die Alarmierung als eine Nachricht, die aktuell gehalten wird: wer alarmiert wurde und wie, und wer bestätigt hat. Wo OneUptime nicht posten kann, etwa in einem privaten Kanal, in den es nicht eingeladen wurde, nennt eine Nachricht, die nur Sie sehen, wer alarmiert wurde, mit einem Link zur Warnung.
- **Wer alarmieren darf.** Alle, die sowohl eine Bereitschaftsrichtlinie ausführen als auch eine Warnung erstellen dürfen: **Project Owner**, **Project Admin** und **Project Member**, oder **On-Call Member** zusammen mit **Alert Member** (**Create On-Call Duty Policy Execution Log** und **Create Alert** in einer benutzerdefinierten Rolle). Personen, ein Team oder einen Bereitschaftsplan direkt zu alarmieren, ohne Bereitschaftsrichtlinie dahinter, braucht zusätzlich Zugriff auf alle Bereitschaftsrichtlinien des Projekts. Alle anderen erfahren das dort, wo sie den Befehl ausgeführt haben, und niemand wird alarmiert.

## Bereitschafts-Benutzergruppen

Halten Sie eine Slack-Benutzergruppe wie `@payments-oncall` gleich denen, die in einem oder mehreren Bereitschaftsplänen gerade Bereitschaft haben, damit jeder sie mit @ erwähnen kann, um sie zu erreichen. OneUptime ändert die Mitglieder der Gruppe bei jeder Übergabe und jeder Vertretung und prüft sie alle 15 Minuten.

:::steps
### Eine Benutzergruppe mit einem Bereitschaftsplan verbinden

Öffnen Sie den Bereitschaftsplan unter **Bereitschaftsdienst** > **Bereitschaftspläne**. Klicken Sie in seiner Karte **Slack-Benutzergruppen** auf **Benutzergruppe verbinden**, und wählen Sie dann eine der Benutzergruppen Ihres Workspace oder **Neue Benutzergruppe erstellen** mit einem Namen und einem Handle. Ihre Mitglieder werden sofort durch die Personen ersetzt, die Bereitschaft haben.

### Sie auch mit dem sekundären Bereitschaftsplan verbinden

Für eine Gruppe, die die primäre und die sekundäre Bereitschaft enthält, verbinden Sie dieselbe Gruppe auch auf der Seite des sekundären Bereitschaftsplans. Eine Gruppe kann beliebig vielen Bereitschaftsplänen folgen.
:::

- **Was die Karte zeigt.** Wer jetzt in jeder Gruppe ist, welchen anderen Bereitschaftsplänen sie folgt und ob sie **Aktuell** ist. Wer Bereitschaft hat, aber nicht in die Gruppe aufgenommen werden kann, wird mit dem Grund genannt: OneUptime findet eine Person über ihr verbundenes Slack-Konto oder sonst über die E-Mail-Adresse, die Slack für sie hat, und Slack nimmt Gäste nicht in Benutzergruppen auf.
- **Niemand in Bereitschaft.** Slack kann keine Benutzergruppe ohne Mitglieder behalten, daher deaktiviert OneUptime die Gruppe, bis jemand Bereitschaft hat, und aktiviert sie dann wieder.
- **Die Gruppe alarmieren.** `/oneuptime page @payments-oncall The checkout API is down` alarmiert alle, die in den Bereitschaftsplänen der Gruppe Bereitschaft haben. Siehe [Jemanden aus Slack alarmieren](#jemanden-aus-slack-alarmieren).
- **Was Slack braucht.** Benutzergruppen gibt es in den kostenpflichtigen Tarifen von Slack, und ein Workspace kann nur seinen Inhabern und Admins erlauben, sie zu ändern: Die Karte sagt, was davon zutrifft und was zu tun ist. Wurde Slack verbunden, bevor OneUptime Benutzergruppen pflegen konnte, verbinden Sie es einmal erneut unter **Projekteinstellungen** > **Arbeitsbereich** > **Slack**.
- **Wer eine verbinden darf.** Die Rollen, die Bereitschaftspläne bearbeiten dürfen: **Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** und **On-Call Member**, oder **Edit On-Call Duty Policy Schedule** in einer benutzerdefinierten Rolle. In OneUptime Cloud braucht das Verbinden den Tarif **Growth**.
- **Trennen.** OneUptime ändert die Gruppe nicht mehr. Die Gruppe und ihre Mitglieder bleiben in Slack, wie sie sind.

## Aus Slack auf Vorfälle, Warnungen und Ereignisse reagieren

Auch die Schaltflächen in den Slack-Nachrichten von OneUptime handeln als Sie: als das OneUptime-Konto, mit dem Ihr Slack-Konto verbunden ist, mit dessen Berechtigungen im Projekt. **Acknowledge**, **Resolve**, **Change State**, **Add Note** und **Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode, und **Mark as Ongoing**, **Mark as Complete**, **Change State** und **Add Note** an einem geplanten Wartungsereignis nehmen jeweils die Änderung vor, die dieselbe Aktion in OneUptime vornimmt, und sie wird Ihnen dort zugeschrieben: Status-Zeitleiste und Feed des Datensatzes zeigen, dass Sie seinen Status geändert haben, und die Notiz ist Ihre. Eine Notiz, die aus einer Nachricht mit einer Emoji-Reaktion gespeichert wird, wird genauso gepostet.

- **Wer sie nutzen darf.** Die Personen, die dieselbe Änderung in OneUptime vornehmen dürfen. Einen Vorfall zu bestätigen, zu beheben oder seinen Status zu ändern braucht die Berechtigung, seinen Status zu ändern: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** und **Incident Member**, oder **Create Incident State Timeline** in einer benutzerdefinierten Rolle. Eine Warnung, eine Episode oder ein geplantes Wartungsereignis braucht dieselbe Berechtigung für die eigene Art (zum Beispiel **Create Alert State Timeline**), und eine Notiz braucht die Berechtigung, diese Art von Notiz zu posten. Alle anderen erfahren das, und es ändert sich nichts.
- **Welche Datensätze.** Die, die Sie lesen dürfen, wie in OneUptime: bei einer auf einige Beschriftungen beschränkten Rolle die Vorfälle, Warnungen, Episoden und Ereignisse mit diesen Beschriftungen. Eine Schaltfläche an jedem anderen Datensatz, oder an einem eines anderen Projekts, wird damit beantwortet, dass der Datensatz "was not found in this project, or you do not have access to it.", und es ändert sich nichts. In OneUptime Cloud wird eine Änderung, die der Tarif des Projekts nicht enthält, mit dem nötigen Tarif abgelehnt.
- **Was Change State anbietet.** Die Status, die Sie lesen dürfen und in die der Datensatz als Nächstes wechseln darf, in der Reihenfolge des Projekts: keiner vor dem Status, in dem er ist, bei einer Episode wie bei einem Vorfall, einer Warnung oder einem geplanten Wartungsereignis, denn ein Statuswechsel bewegt einen Datensatz nie in seiner Liste zurück nach oben (siehe [Die Reihenfolge ist eine echte Einschränkung, keine Anzeigevorliebe](/docs/incidents/states-and-severities#die-reihenfolge-ist-eine-echte-einschränkung-keine-anzeigevorliebe)). Dürfen Sie keinen lesen, heißt es "No incident states are available to you in this project. Ask a project admin for access to them."; ist der Datensatz im letzten Status, den er erreichen kann, heißt es "There is no later state to move this incident to." Keins von beiden öffnet ein leeres Formular.
- **Wo Sie die Antwort bekommen.** Unter der Nachricht mit der Schaltfläche, in einer Nachricht, die nur Sie sehen; per Direktnachricht nur, wenn Slack das ablehnt. Eine zu spät gedrückte Schaltfläche sagt, wer zuerst da war und wann, etwa "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Wenn Ihr Slack-Konto nicht verbunden ist.** Die Antwort bittet Sie, es zu verbinden, mit einer Schaltfläche **Connect Slack account**. Sie öffnet Ihre eigenen Slack-Einstellungen in OneUptime und verbindet Ihr Konto in einem Schritt, nachdem Sie sich bei Bedarf bei OneUptime angemeldet haben. Danach erledigt OneUptime, was Sie gedrückt haben, als Sie, und antwortet unter derselben Nachricht; bei einer Schaltfläche, die ein Formular öffnet, oder bei einem Befehl bittet es Sie, sie erneut zu drücken oder ihn erneut auszuführen. Die Schaltfläche funktioniert einmal, 30 Minuten lang, und nur für das Slack-Konto, das sie gedrückt hat: Angemeldet bei Slack als jemand anderes, verbindet sie nichts.

## Trennen

- **Trennen** trennt nur Ihr eigenes Slack-Konto und entfernt damit Ihre Slack-Benachrichtigungsmethode.
- **OneUptime aus Slack deinstallieren** unter **Projekteinstellungen** > **Arbeitsbereich** > **Slack** trennt das Projekt. OneUptime postet nicht mehr in Slack, und die Menüs **Arbeitsbereich** listen es nicht mehr. Die Benachrichtigungsregeln und Zusammenfassungen bleiben für eine spätere neue Verbindung erhalten.

> [!WARNING]
> Das Deinstallieren trennt auch das eigene Slack-Konto jedes Mitglieds im Projekt und entfernt die Slack-Benachrichtigungsmethoden und die Bereitschaftsregeln, die sie nutzten. Wer in Slack alarmiert wurde, wird über seine anderen Benachrichtigungsmethoden alarmiert, bis er Slack wieder hinzufügt.

## Fehlerbehebung

:::details Eine Regel postet nichts
Prüfen Sie die Bedingungen der Regel mit **Regel testen**: Kommt der Test an, haben die Bedingungen der Regel nicht auf das Ereignis gepasst. Kommt er nicht an, zeigt die Slack-Seite, warum. Laden Sie die OneUptime-App bei einem privaten Kanal zuerst in Slack in den Kanal ein. Jede Nachricht, die OneUptime postet, und jede, die Slack abgelehnt hat, steht unter **Projekteinstellungen** > **Benachrichtigungen** > **Benachrichtigungsprotokolle** auf der Registerkarte **Arbeitsbereich**.
:::

:::details Slack wurde nicht verbunden
Schickt Slack Sie ohne Verbindung zurück, sagt die Seite, auf der Sie begonnen haben, **Slack wurde nicht verbunden**, und ein Satz sagt, warum: Ihnen fehlt die Berechtigung, der Link wurde schon benutzt oder ist abgelaufen, Sie haben sich in einem anderen Workspace angemeldet, oder der Server ist nicht für Slack eingerichtet. Unter [Das Verbinden wurde nicht abgeschlossen](/docs/self-hosted/slack-integration#das-verbinden-wurde-nicht-abgeschlossen) stehen alle Sätze und was zu tun ist.
:::

:::details Eine Schaltfläche oder ein Befehl sagt, mein Slack-Konto sei nicht verbunden
Drücken Sie in dieser Antwort **Connect Slack account**, um es in einem Schritt zu verbinden, oder verknüpfen Sie es unter **Benutzereinstellungen** > **Arbeitsbereich** > **Slack** mit **Connect my account with Slack**. Sind Sie kein Mitglied des Projekts mehr, sagt OneUptime das stattdessen und handelt für Sie in nichts.
:::

:::details OneUptime antwortet nicht auf eine Antwort in einem Thread
Eine Antwort ohne Erwähnung wird nur in Ihrem eigenen Gespräch mit OneUptime AI beantwortet: im Thread unter einer Frage, die Sie in einem Kanal gestellt haben. In jedem anderen Thread, etwa dem unter der Nachricht eines Vorfalls, erwähnen Sie OneUptime mit @. Ist Ihr Slack-Konto nicht verbunden, bittet OneUptime Sie einmal pro Gespräch, es zu verbinden, nicht bei jeder Nachricht: Drücken Sie in dieser Nachricht **Connect Slack account**, oder verknüpfen Sie es unter **Benutzereinstellungen** > **Arbeitsbereich** > **Slack**. Siehe [OneUptime AI aus Slack fragen](#oneuptime-ai-aus-slack-fragen).
:::

:::details Benachrichtigungen kommen an, aber Schaltflächen und Befehle tun nichts
Auf einem selbst gehosteten Server muss Slack OneUptime für Schaltflächen, Formulare und Befehle erreichen können; Benachrichtigungen brauchen nur ausgehenden Zugriff. Siehe [Netzwerkzugriff für selbst gehostete Installationen](/docs/self-hosted/slack-integration#netzwerkzugriff-für-selbst-gehostete-installationen).
:::

## Nächste Schritte

:::cards
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Dieselben Benachrichtigungen und Aktionen in Microsoft Teams.
- [Videoanrufe](/docs/workspace-connections/video-calls): Geben Sie jedem Vorfall einen Anruf, gepostet mit seinen Updates.
- [Slack-Integration](/docs/self-hosted/slack-integration): Die Slack-App auf einem selbst gehosteten Server einrichten.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents): Jeder Weg, auf dem ein Vorfall beginnt, und was dann läuft.
:::
