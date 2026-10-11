# Slack

Verbinden Sie OneUptime mit Slack, um Vorfälle, Warnungen, Episoden, geplante Wartungen, Monitore und Bereitschafts-Updates in Ihren Kanälen zu posten, jedem Vorfall einen eigenen Kanal zu geben und Responder handeln zu lassen, ohne Slack zu verlassen: bestätigen, beheben, Notizen hinzufügen, die Bereitschaft alarmieren und Vorfälle melden.

:::cards
- [Slack verbinden](#slack-verbinden): Installieren Sie OneUptime in Ihrem Workspace und verknüpfen Sie dann Ihr eigenes Konto.
- [Benachrichtigungsregeln](#benachrichtigungsregeln): Legen Sie fest, welche Ereignisse wohin posten und welche einen eigenen Kanal bekommen.
- [Vorfälle und Wartungen aus Slack erstellen](#vorfälle-und-wartungen-aus-slack-erstellen): `/incident` und `/maintenance`, als Sie selbst.
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

Die Notiz wird als Sie gespeichert, mit Ihren Berechtigungen, daher muss Ihr eigenes Slack-Konto verbunden sein. Eine Nachricht wird nur einmal gespeichert, egal wie viele Personen reagieren.

## OneUptime AI aus Slack fragen

Fragen Sie in natürlicher Sprache nach Ihren Logs, Traces, Metriken, Vorfällen und Monitoren. Erwähnen Sie OneUptime in einem Kanal mit @ oder schicken Sie eine Direktnachricht, und die Antwort kommt im Thread; antworten Sie dort, um weiterzufragen. `/oneuptime ask which monitors are down?` postet seine Antwort im Kanal. Beides braucht Ihr verbundenes Slack-Konto und eingeschaltete KI für das Projekt. Antworten in Slack lesen nur: Um etwas zu ändern, nutzen Sie die Schaltflächen. Siehe [KI fragen](/docs/ai/ask-ai).

## Vorfälle und Wartungen aus Slack erstellen

`/incident` und `/maintenance` öffnen ein Formular, das Sie als Sie selbst ausfüllen und absenden: als das OneUptime-Konto, mit dem Ihr Slack-Konto verbunden ist (siehe [Slack verbinden](#slack-verbinden)), mit dessen Berechtigungen im Projekt. Ist Ihr Slack-Konto nicht verbunden oder Ihr OneUptime-Konto kein Mitglied des Projekts mehr, sagt Ihnen OneUptime per Direktnachricht, was zu tun ist, und es öffnet sich kein Formular. Die Verknüpfungen **Create New Incident** und **Create Scheduled Event** öffnen dieselben Formulare.

- **Wer sie nutzen darf.** Die Personen, die in OneUptime einen Vorfall melden oder ein geplantes Wartungsereignis anlegen dürfen: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** und **Incident Member** für einen Vorfall (**Create Incident** in einer benutzerdefinierten Rolle), und **Scheduled Maintenance Admin** und **Scheduled Maintenance Member** für ein Ereignis (**Create Scheduled Maintenance**). Alle anderen erfahren das per Direktnachricht, und es öffnet sich kein Formular.
- **Was ein Formular anbietet.** Jede Liste — Schweregrade, Monitore, Monitorstatus, Bereitschaftsrichtlinien und Beschriftungen — enthält, was Sie lesen dürfen, wie dieselbe Liste in OneUptime: bei einer auf einige Beschriftungen beschränkten Rolle die Monitore und Bereitschaftsrichtlinien mit diesen Beschriftungen. Eine Liste, die Sie gar nicht lesen dürfen, fehlt im Formular. Archivierte Bereitschaftsrichtlinien werden nie angeboten.
- **Was ein Formular nennen darf.** Der Vorfall oder das Ereignis wird mit Ihren eigenen Berechtigungen erstellt und Ihnen zugeschrieben. Ein Monitor, eine Bereitschaftsrichtlinie, eine Beschriftung, ein Schweregrad oder Status, den Sie nicht lesen dürfen, oder einer eines anderen Projekts, wird abgelehnt wie einer, den das Projekt nicht hat, auch aus einem Formular, das vor der Änderung Ihres Zugriffs geöffnet wurde, und es wird nichts erstellt. OneUptime sagt Ihnen per Direktnachricht, warum.

**Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode funktioniert genauso: Es braucht die Berechtigung, eine Bereitschaftsrichtlinie auszuführen (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** und **On-Call Member**, oder **Create On-Call Duty Policy Execution Log** in einer benutzerdefinierten Rolle) und diesen Vorfall, diese Warnung oder Episode zu lesen, und bietet die aktiven Bereitschaftsrichtlinien an, die Sie lesen dürfen.

## Aus Slack auf Vorfälle, Warnungen und Ereignisse reagieren

Auch die Schaltflächen in den Slack-Nachrichten von OneUptime handeln als Sie: als das OneUptime-Konto, mit dem Ihr Slack-Konto verbunden ist, mit dessen Berechtigungen im Projekt. **Acknowledge**, **Resolve**, **Change State**, **Add Note** und **Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode, und **Mark as Ongoing**, **Mark as Complete**, **Change State** und **Add Note** an einem geplanten Wartungsereignis nehmen jeweils die Änderung vor, die dieselbe Aktion in OneUptime vornimmt, und sie wird Ihnen dort zugeschrieben: Status-Zeitleiste und Feed des Datensatzes zeigen, dass Sie seinen Status geändert haben, und die Notiz ist Ihre. Eine Notiz, die aus einer Nachricht mit einer Emoji-Reaktion gespeichert wird, wird genauso gepostet.

- **Wer sie nutzen darf.** Die Personen, die dieselbe Änderung in OneUptime vornehmen dürfen. Einen Vorfall zu bestätigen, zu beheben oder seinen Status zu ändern braucht die Berechtigung, seinen Status zu ändern: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** und **Incident Member**, oder **Create Incident State Timeline** in einer benutzerdefinierten Rolle. Eine Warnung, eine Episode oder ein geplantes Wartungsereignis braucht dieselbe Berechtigung für die eigene Art (zum Beispiel **Create Alert State Timeline**), und eine Notiz braucht die Berechtigung, diese Art von Notiz zu posten. Alle anderen erfahren das per Direktnachricht, und es ändert sich nichts.
- **Welche Datensätze.** Die, die Sie lesen dürfen, wie in OneUptime: bei einer auf einige Beschriftungen beschränkten Rolle die Vorfälle, Warnungen, Episoden und Ereignisse mit diesen Beschriftungen. Eine Schaltfläche an jedem anderen Datensatz, oder an einem eines anderen Projekts, wird damit beantwortet, dass der Datensatz "was not found in this project, or you do not have access to it.", und es ändert sich nichts. In OneUptime Cloud wird eine Änderung, die der Tarif des Projekts nicht enthält, mit dem nötigen Tarif abgelehnt.
- **Was Change State anbietet.** Die Status, die Sie lesen dürfen und in die der Datensatz als Nächstes wechseln darf, in der Reihenfolge des Projekts: keiner vor dem Status, in dem er ist, bei einer Episode wie bei einem Vorfall, einer Warnung oder einem geplanten Wartungsereignis, denn ein Statuswechsel bewegt einen Datensatz nie in seiner Liste zurück nach oben (siehe [Die Reihenfolge ist eine echte Einschränkung, keine Anzeigevorliebe](/docs/incidents/states-and-severities#die-reihenfolge-ist-eine-echte-einschränkung-keine-anzeigevorliebe)). Dürfen Sie keinen lesen, heißt es "No incident states are available to you in this project. Ask a project admin for access to them."; ist der Datensatz im letzten Status, den er erreichen kann, heißt es "There is no later state to move this incident to." Keins von beiden öffnet ein leeres Formular.

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
Verknüpfen Sie es unter **Benutzereinstellungen** > **Arbeitsbereich** > **Slack** mit **Connect my account with Slack**. Sind Sie kein Mitglied des Projekts mehr, sagt OneUptime das stattdessen und handelt für Sie in nichts.
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
