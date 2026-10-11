# Microsoft Teams

Verbinden Sie OneUptime mit Microsoft Teams, um Vorfälle, Warnungen, Episoden, geplante Wartungen, Monitore und Bereitschafts-Updates in Ihren Kanälen und Chats zu posten, jedem Vorfall einen eigenen Kanal zu geben und Responder aus Teams handeln zu lassen: bestätigen, beheben, Notizen hinzufügen, die Bereitschaft alarmieren, Vorfälle melden und OneUptime AI fragen.

:::cards
- [Microsoft Teams verbinden](#microsoft-teams-verbinden): Administratorzustimmung, Ihre Anmeldung und die App in jedem Team.
- [Benachrichtigungsregeln](#benachrichtigungsregeln): Legen Sie fest, welche Ereignisse wohin posten und welche einen eigenen Kanal bekommen.
- [Mit dem OneUptime-Bot sprechen](#mit-dem-oneuptime-bot-sprechen): Befehle, Fragen und Formulare im Chat mit dem Bot.
- [Aus Microsoft Teams auf Vorfälle, Warnungen und Ereignisse reagieren](#aus-microsoft-teams-auf-vorfälle-warnungen-und-ereignisse-reagieren): Die Schaltflächen auf den Karten von OneUptime.
:::

## So funktioniert es

```mermaid title="Von einem Ereignis in OneUptime zu einer Karte in Microsoft Teams"
flowchart TB
    event["Ein Vorfall, eine Warnung oder ein Ereignis<br/>entsteht oder ändert sich"] --> rules{"Benachrichtigungsregeln,<br/>deren Bedingungen passen"}
    rules -->|"Create Microsoft Teams Channel"| own["Ein eigener Kanal<br/>im gewählten Team"]
    rules -->|"In einen bestehenden<br/>Kanal oder Chat posten"| existing["Ihre Kanäle und Chats"]
    own --> card["Eine Karte mit Schaltflächen"]
    existing --> card
    card -->|"Ein Responder drückt eine"| change["Die Änderung erfolgt in OneUptime,<br/>als diese Person"]
```

Drei Dinge machen das möglich:

- **Die Verbindung des Projekts**, einmal hergestellt: Eine Administratorin oder ein Administrator von Microsoft 365 stimmt der OneUptime-App für Ihre Organisation zu.
- **Die OneUptime-App in jedem Team**, in dem Sie Benachrichtigungen möchten. Microsoft lässt den Bot nur in Teams posten, denen er hinzugefügt wurde.
- **Die eigene Verbindung jeder Person**: ihr Microsoft-Teams-Konto, verknüpft mit ihrem OneUptime-Konto. Schaltflächen, Befehle und Reaktionen handeln als diese Person, mit ihren Berechtigungen im Projekt.

## Bevor Sie beginnen

- **Eine Rolle, die das Projekt verbinden darf:** **Project Owner**, **Project Admin** oder **Project Member**. Zum Deinstallieren braucht es **Project Owner** oder **Project Admin**.
- **Eine Administratorin oder einen Administrator von Microsoft 365**, um die Administratorzustimmung einmal für die ganze Organisation zu erteilen.
- **Den Growth-Tarif in OneUptime Cloud** für Benachrichtigungsregeln und Zusammenfassungen. Siehe [Benachrichtigungsregeln unterhalb des Growth-Tarifs](#benachrichtigungsregeln-unterhalb-des-growth-tarifs).
- **Auf einem selbst gehosteten Server** zuerst einen dafür eingerichteten Teams-Bot. Siehe [Microsoft-Teams-Integration](/docs/self-hosted/microsoft-teams-integration).

## Microsoft Teams verbinden

:::steps
### Die Administratorzustimmung erteilen

Gehen Sie zu **Projekteinstellungen** > **Arbeitsbereich** > **Microsoft Teams** und klicken Sie auf **Administratorzustimmung erteilen**. Eine Administratorin oder ein Administrator von Microsoft 365 meldet sich an und erlaubt die OneUptime-App für die Organisation. Die Karte sagt dann **Administratorzustimmung abgeschlossen**. Solange kein Workspace verbunden ist, enthält der Abschnitt **Arbeitsbereich** der Menüs Vorfälle, Warnungen, Geplante Wartung, Monitore und Bereitschaft den Eintrag **Slack oder Teams verbinden**, der ebenfalls hierher führt.

### Ihr Konto verbinden

Klicken Sie auf **Mit Microsoft Teams verbinden** und melden Sie sich mit Ihrem Arbeitskonto an. OneUptime liest die Teams Ihrer Organisation; **Teams anzeigen** listet sie.

### Die OneUptime-App jedem Team hinzufügen (erforderlich)

Ihr Konto zu verbinden reicht allein nicht. Microsoft lässt den OneUptime-Bot nur in Teams posten, denen er hinzugefügt wurde, also tun Sie das für jedes Team, in dem Sie Benachrichtigungen möchten:

- Klicken Sie in Microsoft Teams auf "..." neben dem **Namen des Teams** (nicht dem Namen des Kanals).
- Wählen Sie **Manage team** > **Apps** > **More apps**, suchen Sie **OneUptime** und klicken Sie auf **Add**.

In OneUptime Cloud öffnet **Teams Store öffnen** die App im Microsoft Teams Store, wo **Add to a team** dasselbe tut. Auf einem selbst gehosteten Server installieren Sie stattdessen das Paket aus **App-Manifest-Zip herunterladen**: Nur dieses trägt den Bot Ihres Servers. Meldet eine Testbenachrichtigung, dass die OneUptime-App nicht im Team installiert ist, wurde dieser Schritt ausgelassen.

### Alle anderen verbinden

Jede Person verknüpft ihr eigenes Microsoft-Teams-Konto unter **Benutzereinstellungen** > **Arbeitsbereich** > **Microsoft Teams** mit **Connect my account with Microsoft Teams**, um als sie selbst auf Vorfälle zu reagieren und Direktnachrichten zu erhalten. Dieser Abschnitt erscheint, sobald das Projekt mit Microsoft Teams verbunden ist.

### Eine Benachrichtigungsregel hinzufügen

Gehen Sie zu **Vorfälle** > **Arbeitsbereich** > **Microsoft Teams**. Der Abschnitt **Arbeitsbereich** listet nur die Chat-Workspaces, die Ihr Projekt verbunden hat, daher erscheint **Microsoft Teams** dort, sobald es verbunden ist. Legen Sie eine Regel an, zum Beispiel eine, die in einen Teams-Kanal postet, wenn ein Vorfall erstellt wird, und klicken Sie dann in ihrer Zeile auf **Regel testen**.
:::

> [!NOTE]
> OneUptime für sich selbst zu installieren oder es einem Chat hinzuzufügen ist eine andere Installation und lässt es nicht in die Kanäle eines Teams posten. **Private Kanäle** brauchen die App im Kanal selbst: Öffnen Sie den Kanal > "..." > **Manage channel** > **Apps** > **Add an app**. **Geteilte Kanäle** können keine Benachrichtigungen empfangen: Microsoft Teams unterstützt keine Bots in geteilten Kanälen.

## Benachrichtigungsregeln

Eine Benachrichtigungsregel legt fest, welche Ereignisse in Microsoft Teams gepostet werden, und wohin. Jedes Produkt hat eigene Regeln, unter **Arbeitsbereich** > **Microsoft Teams** in seinem Menü:

| Produkt | Registerkarten seiner Seite **Microsoft Teams** |
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
| **Ziel** | Wohin sie postet: in einen bestehenden Kanal eines gewählten Teams, in die gewählten Chats, in einen neuen Kanal in einem gewählten Team, oder in mehrere davon zugleich. |
| **Videoanruf** | Nur Vorfälle und Warnungen: für jeden einen Anruf starten. Siehe [Videoanrufe](/docs/workspace-connections/video-calls). |

Ein Kanal, den die Regel anlegt, wird aus **New Microsoft Teams Channel Name** und der Nummer des Datensatzes benannt, etwa `oneuptime-incident-42`, und nur ein angelegter Kanal bekommt die Personen, die die Regel einlädt. Ein privater Vorfall, eine private Warnung oder Episode bekommt einen privaten Kanal. Jede spätere Änderung des Datensatzes — ein Statuswechsel, eine Notiz, ein neuer Eigentümer — wird in seinen Kanälen und Chats gepostet.

**Projekteinstellungen** > **Arbeitsbereich** > **Microsoft Teams** listet die Kanäle, die OneUptime in Ihren Teams sieht, und die Chats, denen es hinzugefügt wurde, mit **Test senden** neben jedem. Ein Chat erscheint, sobald die OneUptime-App ihm in Microsoft Teams hinzugefügt wurde; **Chats aktualisieren** holt neue Chats und ihre aktuellen Namen.

## Eine Regel testen

**Regel testen** in der Zeile einer Regel postet eine Testnachricht für diese Regel in die Kanäle, die sie nennt, damit Sie sie ankommen sehen. Legt die Regel für jedes Ereignis einen Kanal an, legt auch der Test einen an und lädt die Personen der Regel ein.

Wie **Test senden** neben einem Kanal unter **Projekteinstellungen** > **Arbeitsbereich** > **Microsoft Teams** braucht er die Berechtigung, Benachrichtigungsregeln anzulegen: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** oder **Create Workspace Notification Rule** und **Read Workspace Notification Rule** in einer benutzerdefinierten Rolle. Für jemanden, der die Regeln nur sehen kann, etwa ein **Viewer**, ist **Regel testen** gesperrt, und sein Tooltip sagt, was es braucht; die API lehnt seinen Test mit "You do not have permission to send test notifications in this project." ab. In OneUptime Cloud braucht das Testen einer Regel den Tarif **Growth**, wie das Anlegen einer.

In OneUptime Cloud braucht auch **Test senden** neben einem Kanal oder Chat den Tarif **Growth**, denn in einen Kanal zu posten ist genau das, was Regeln und Zusammenfassungen tun. **Test jetzt senden** bei einer Zusammenfassung braucht die Berechtigung, Zusammenfassungen anzulegen (**Create Workspace Notification Summary** und **Read Workspace Notification Summary** in einer benutzerdefinierten Rolle) und in OneUptime Cloud den Tarif **Growth**; für alle anderen ist es gesperrt, und sein Tooltip sagt, was es braucht. Ein MCP-Client, der mit Lesezugriff verbunden ist, kann keinen Test senden.

## Zusammenfassungen

Die Registerkarte **Zusammenfassung** von **Vorfälle** > **Arbeitsbereich** > **Microsoft Teams** (und von **Warnungen**) postet eine wiederkehrende Übersicht in die Kanäle, die Sie nennen: wie viele Vorfälle oder Warnungen es gab, wie schnell sie bestätigt und behoben wurden, und eine Liste mit Links. Eine neue Zusammenfassung geht jede Woche raus und umfasst die letzten 7 Tage. Lassen Sie **Ersten Bericht senden um** leer, und die erste geht um 09:00 zu Beginn der nächsten Woche, des nächsten Tages oder Monats raus; das Formular sagt, wann.

Eine Zusammenfassung geht nach der Uhr ihrer **Zeitzone** raus, die mit Ihrer beginnt. Sie behält dort das ganze Jahr ihre Tageszeit: Eine für 09:00 in Berlin eingestellte geht auch nach der Umstellung auf Sommer- oder Winterzeit um 09:00 in Berlin raus, und die Daten in ihrer Nachricht sind ebenfalls die Berliner. Senden Sie über die API `timezone` als IANA-Zeitzonennamen, etwa `Europe/Berlin`. Eine ohne Zeitzone erstellte Zusammenfassung übernimmt die Zeitzone aus dem Profil ihrer erstellenden Person, oder UTC, wenn ein API-Schlüssel sie erstellt.

Das Formular einer Zusammenfassung hat vier Schritte: **Grundinformationen** (ihr Name, die Kanäle und deren **Teamname**), **Zeitplan**, **Inhalt** (**Was einzuschließen ist**) und **Filter** (welche Vorfälle oder Warnungen sie zählt).

## Benachrichtigungsregeln unterhalb des Growth-Tarifs

In OneUptime Cloud gehören Benachrichtigungsregeln und Zusammenfassungen zum Tarif **Growth** und höher. Ein Projekt darunter behält die Regeln und Zusammenfassungen, die es schon hat, und sie posten weiterhin in Microsoft Teams. Daher zeigt die Seite **Microsoft Teams** jedes Produkts (Vorfälle, Warnungen, Geplante Wartung, Bereitschaftsdienst, Monitore) den Tarifhinweis und darunter diese (**Noch eingerichtete Benachrichtigungsregeln**, **Noch eingerichtete Zusammenfassungen**): Löschen Sie eine Regel, oder schalten Sie eine Zusammenfassung aus oder löschen Sie sie. Regeln und Zusammenfassungen hinzuzufügen oder zu ändern braucht **Growth**.

## In Microsoft Teams alarmiert werden

Um per Direktnachricht alarmiert zu werden, wenn Sie Bereitschaft haben, fügen Sie Microsoft Teams als eine Ihrer Benachrichtigungsmethoden hinzu:

:::steps
1. Verbinden Sie Ihr eigenes Microsoft-Teams-Konto (siehe [Microsoft Teams verbinden](#microsoft-teams-verbinden)).
2. Gehen Sie zu **Benutzereinstellungen** > **Benachrichtigungsmethoden**, öffnen Sie die Registerkarte **Workspace Apps** und klicken Sie auf **Microsoft Teams-Konto hinzufügen**.
3. Klicken Sie in seiner Zeile auf **Testnachricht senden**. Die Nachricht kommt in Ihren Microsoft-Teams-Chats an.
:::

Durch das Hinzufügen landet es sofort in Ihren Bereitschaftsregeln, sodass Alarme Sie ab dann in Microsoft Teams erreichen. Welche Alarme es bekommt, ändern Sie unter **Benutzereinstellungen** > **Bereitschaftsregeln**.

## Nachrichten als Notizen speichern

Reagieren Sie auf eine Nachricht oder eine Antwort in dem Kanal, den OneUptime für einen Vorfall, eine Warnung, eine Episode oder ein geplantes Wartungsereignis angelegt hat, und OneUptime speichert sie als Notiz an diesem Datensatz. Es bemerkt die Reaktion innerhalb einer Minute und bestätigt das mit einer Antwort im Thread:

| Reaktion | Gespeichert als |
| --- | --- |
| 📌 oder 📍 | Eine private Notiz, die nur Ihr Team sieht |
| 📣 oder 📢 | Eine öffentliche Notiz, die auf der Statusseite erscheint. Nur Vorfälle und geplante Wartungsereignisse. |

Die Notiz wird als Sie gespeichert, mit Ihren Berechtigungen, daher muss Ihr eigenes Microsoft-Teams-Konto verbunden und die OneUptime-App im Team sein.

## Mit dem OneUptime-Bot sprechen

Schreiben Sie dem Bot in einem persönlichen Chat, oder erwähnen Sie OneUptime in einem Kanal oder Gruppenchat mit @: Dort antwortet er nur, wenn er erwähnt wird.

| Nachricht | Was der Bot tut |
| --- | --- |
| `help` | Listet, was er kann. |
| `ask <question>`, oder jede Frage in natürlicher Sprache | OneUptime AI antwortet zu Ihren Logs, Traces, Metriken, Vorfällen und Monitoren, zum Beispiel "Welche Monitore sind gerade ausgefallen?". Antworten lesen nur. |
| `create incident [title]` | Öffnet das Vorfallsformular, mit ausgefülltem Titel. |
| `create maintenance [title]` | Öffnet das Formular für geplante Wartung, mit ausgefülltem Titel. |
| `show active incidents`, `show active alerts` | Listet, was gerade offen ist. |
| `show scheduled maintenance`, `show ongoing maintenance` | Listet anstehende oder laufende Wartungsereignisse. |

OneUptime AI zu fragen braucht eingeschaltete KI für das Projekt. Siehe [KI fragen](/docs/ai/ask-ai).

## Vorfälle und Wartungen aus Microsoft Teams erstellen

`create incident` oder `create maintenance` an den OneUptime-Bot öffnet ein Formular für die Person, die es geschrieben hat, in einem persönlichen Chat, einem Kanal oder einem Gruppenchat gleichermaßen. Es wird als diese Person ausgefüllt: als das OneUptime-Konto, mit dem ihr Microsoft-Teams-Konto verbunden ist (siehe [Microsoft Teams verbinden](#microsoft-teams-verbinden)), mit dessen Berechtigungen im Projekt. Wer kein verbundenes Konto hat oder dessen OneUptime-Konto kein Mitglied des Projekts mehr ist, erfährt, was zu tun ist, statt das Formular zu bekommen.

- **Wer sie nutzen darf.** Die Personen, die in OneUptime einen Vorfall melden oder ein geplantes Wartungsereignis anlegen dürfen: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** und **Incident Member** für einen Vorfall (**Create Incident** in einer benutzerdefinierten Rolle), und **Scheduled Maintenance Admin** und **Scheduled Maintenance Member** für ein Ereignis (**Create Scheduled Maintenance**). Alle anderen erfahren das und bekommen kein Formular.
- **Was ein Formular anbietet.** Jede Liste — Schweregrade, Monitore, Monitorstatus, Bereitschaftsrichtlinien und Beschriftungen — enthält, was die anfragende Person lesen darf, wie dieselbe Liste in OneUptime, und die Hinweise "not shown" der Karte zählen nur diese: bei einer auf einige Beschriftungen beschränkten Rolle die Monitore und Bereitschaftsrichtlinien mit diesen Beschriftungen. Eine Liste, die sie gar nicht lesen darf, fehlt. Archivierte Bereitschaftsrichtlinien werden nie angeboten.
- **Was ein Formular nennen darf.** In einem Kanal oder Gruppenchat darf jede anwesende Person das Formular absenden, und es wird als diese Person abgesendet, mit ihren eigenen Berechtigungen. Der Vorfall oder das Ereignis wird mit diesen Berechtigungen erstellt und dieser Person zugeschrieben. Ein Monitor, eine Bereitschaftsrichtlinie, eine Beschriftung, ein Schweregrad oder Status, den sie nicht lesen darf, oder einer eines anderen Projekts, wird abgelehnt wie einer, den das Projekt nicht hat, und es wird nichts erstellt: Der Bot antwortet "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode funktioniert genauso: Es braucht die Berechtigung, eine Bereitschaftsrichtlinie auszuführen (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** und **On-Call Member**, oder **Create On-Call Duty Policy Execution Log** in einer benutzerdefinierten Rolle) und diesen Vorfall, diese Warnung oder Episode zu lesen, und bietet die aktiven Bereitschaftsrichtlinien an, die die Person lesen darf. Einen Monitor oder eine Bereitschaftsrichtlinie aus einer Karte heraus anzusehen liest diese ebenfalls als die Person, die die Schaltfläche gedrückt hat.

## Aus Microsoft Teams auf Vorfälle, Warnungen und Ereignisse reagieren

Die Schaltflächen auf den Karten von OneUptime handeln als die Person, die sie drückt, in einem persönlichen Chat, einem Kanal oder einem Gruppenchat gleichermaßen: als das OneUptime-Konto, mit dem ihr Microsoft-Teams-Konto verbunden ist, mit dessen Berechtigungen im Projekt. **Acknowledge**, **Resolve**, **Change State**, **Add Note** und **Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode, und **Mark as Ongoing**, **Mark as Complete**, **Change State** und **Add Note** an einem geplanten Wartungsereignis nehmen jeweils die Änderung vor, die dieselbe Aktion in OneUptime vornimmt, und sie wird dort dieser Person zugeschrieben: Status-Zeitleiste und Feed des Datensatzes zeigen, wer seinen Status geändert hat, und die Notiz gehört ihr. Eine Notiz, die aus einer Nachricht mit einer Reaktion gespeichert wird, wird genauso gepostet.

- **Wer sie nutzen darf.** Die Personen, die dieselbe Änderung in OneUptime vornehmen dürfen. Einen Vorfall zu bestätigen, zu beheben oder seinen Status zu ändern braucht die Berechtigung, seinen Status zu ändern: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** und **Incident Member**, oder **Create Incident State Timeline** in einer benutzerdefinierten Rolle. Eine Warnung, eine Episode oder ein geplantes Wartungsereignis braucht dieselbe Berechtigung für die eigene Art (zum Beispiel **Create Alert State Timeline**), und eine Notiz braucht die Berechtigung, diese Art von Notiz zu posten. Wie das Statusfeld in OneUptime verlangen sie keine Berechtigung, den Vorfall oder die Warnung selbst zu bearbeiten. Alle anderen erfahren das, und es ändert sich nichts.
- **Welche Datensätze.** Die, die die Person lesen darf, wie in OneUptime: bei einer auf einige Beschriftungen beschränkten Rolle die Vorfälle, Warnungen, Episoden und Ereignisse mit diesen Beschriftungen. Eine Schaltfläche an jedem anderen Datensatz, oder an einem eines anderen Projekts, wird damit beantwortet, dass der Datensatz "was not found in this project, or you do not have access to it.", und es ändert sich nichts. In OneUptime Cloud wird eine Änderung, die der Tarif des Projekts nicht enthält, mit dem nötigen Tarif abgelehnt.
- **Was Change State anbietet.** Die Status, die die Person lesen darf und in die der Datensatz als Nächstes wechseln darf, in der Reihenfolge des Projekts: keiner vor dem Status, in dem er ist, bei einer Episode wie bei einem Vorfall, einer Warnung oder einem geplanten Wartungsereignis, denn ein Statuswechsel bewegt einen Datensatz nie in seiner Liste zurück nach oben (siehe [Die Reihenfolge ist eine echte Einschränkung, keine Anzeigevorliebe](/docs/incidents/states-and-severities#die-reihenfolge-ist-eine-echte-einschränkung-keine-anzeigevorliebe)). Darf sie keinen lesen, sagt der Bot "No incident states are available to you in this project. Ask a project admin for access to them."; ist der Datensatz im letzten Status, den er erreichen kann, sagt er "There is no later state to move this incident to." Keins von beiden zeigt eine leere Karte.
- **Escalate.** **Escalate** auf einer Karte führt deren Bereitschaftsrichtlinie für den Vorfall, die Warnung oder die Episode aus, um die es auf der Karte geht, als die Person, die gedrückt hat, mit denselben Berechtigungen wie **Execute On-Call Policy**. Eine Karte, die keins davon betrifft, wird mit "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there." beantwortet, und niemand wird alarmiert.

## Trennen

- **Trennen** trennt nur Ihr eigenes Microsoft-Teams-Konto und entfernt damit Ihre Microsoft-Teams-Benachrichtigungsmethode.
- **OneUptime aus Microsoft Teams deinstallieren** unter **Projekteinstellungen** > **Arbeitsbereich** > **Microsoft Teams** trennt das Projekt. OneUptime postet nicht mehr in Microsoft Teams, und die Menüs **Arbeitsbereich** listen es nicht mehr. Die Benachrichtigungsregeln und Zusammenfassungen bleiben für eine spätere neue Verbindung erhalten.

> [!WARNING]
> Das Deinstallieren trennt auch das eigene Microsoft-Teams-Konto jedes Mitglieds im Projekt und entfernt die Microsoft-Teams-Benachrichtigungsmethoden und die Bereitschaftsregeln, die sie nutzten. Ein Projekt ist mit einer Microsoft-365-Organisation verbunden: Um es mit einer anderen zu verbinden, deinstallieren Sie zuerst.

## Fehlerbehebung

:::details Ein Test sagt, die OneUptime-App sei nicht im Team installiert
Microsoft hat den Beitrag abgelehnt, weil der Bot nicht in diesem Team ist. Fügen Sie die App dem Team hinzu (siehe [Microsoft Teams verbinden](#microsoft-teams-verbinden)), bei einem privaten Kanal dem Kanal selbst. Sie einem Team hinzuzufügen bewirkt nichts für die anderen.
:::

:::details Microsoft Teams wurde nicht verbunden
Schickt Microsoft Sie ohne Verbindung zurück, sagt die Seite, auf der Sie begonnen haben, **Microsoft Teams wurde nicht verbunden**, und ein Satz sagt, warum: Ihnen fehlt die Berechtigung, der Link wurde schon benutzt oder ist abgelaufen, Sie haben sich in einer anderen Microsoft-365-Organisation angemeldet, oder Ihre Organisation hat noch keine Teams. Unter [Das Verbinden wurde nicht abgeschlossen](/docs/self-hosted/microsoft-teams-integration#das-verbinden-wurde-nicht-abgeschlossen) stehen alle Sätze und was zu tun ist.
:::

:::details Der Bot sagt, mein Konto sei nicht verbunden
Verknüpfen Sie es unter **Benutzereinstellungen** > **Arbeitsbereich** > **Microsoft Teams** mit **Connect my account with Microsoft Teams**, angemeldet in der Organisation, mit der das Projekt verbunden ist. Ein Gastkonto aus einer anderen Organisation ist nicht dasselbe Konto.
:::

:::details Auf einem selbst gehosteten Server scheitert jede Benachrichtigung
Die in Ihren Teams installierte Teams-App muss das Paket sein, das Ihr Server gebaut hat, und Microsoft muss den Bot-Endpunkt Ihres Servers erreichen können. Siehe die Fehlerbehebung der [Microsoft-Teams-Integration](/docs/self-hosted/microsoft-teams-integration#fehlerbehebung).
:::

## Nächste Schritte

:::cards
- [Slack](/docs/workspace-connections/slack): Dieselben Benachrichtigungen und Aktionen in Slack.
- [Videoanrufe](/docs/workspace-connections/video-calls): Geben Sie jedem Vorfall einen Anruf, gepostet mit seinen Updates.
- [Microsoft-Teams-Integration](/docs/self-hosted/microsoft-teams-integration): Den Teams-Bot auf einem selbst gehosteten Server einrichten.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents): Jeder Weg, auf dem ein Vorfall beginnt, und was dann läuft.
:::
