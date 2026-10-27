# Microsoft Teams

Verbinden Sie OneUptime mit Microsoft Teams, um Vorfälle, Warnungen, Episoden, geplante Wartungen, Monitore und Bereitschafts-Updates in Ihren Kanälen und Chats zu posten, jedem Vorfall einen eigenen Kanal zu geben und Responder aus Teams handeln zu lassen: bestätigen, beheben, Notizen hinzufügen, die Bereitschaft alarmieren, Vorfälle melden und OneUptime AI fragen.

:::cards
- [Microsoft Teams verbinden](#microsoft-teams-verbinden): Administratorzustimmung, Ihre Anmeldung und die App in jedem Team.
- [Alle bitten, ihr Konto zu verbinden](#alle-bitten-ihr-konto-zu-verbinden): Schreiben Sie alle Mitglieder, die ihr Konto noch nicht verbunden haben, auf einmal an.
- [Benachrichtigungsregeln](#benachrichtigungsregeln): Legen Sie fest, welche Ereignisse wohin posten und welche einen eigenen Kanal bekommen.
- [Mit dem OneUptime-Bot sprechen](#mit-dem-oneuptime-bot-sprechen): Befehle, Fragen und Formulare im Chat mit dem Bot.
- [Bereitschafts-Tags](#bereitschafts-tags): Halten Sie das Tag eines Teams gleich denen, die Bereitschaft haben, und alarmieren Sie es.
- [Aus Microsoft Teams auf Vorfälle, Warnungen und Ereignisse reagieren](#aus-microsoft-teams-auf-vorfälle-warnungen-und-ereignisse-reagieren): Die Schaltflächen auf den Karten von OneUptime.
:::

## So funktioniert es

```mermaid title="Von einem Ereignis in OneUptime zu einer Karte in Microsoft Teams"
flowchart TB
    event["Ein Vorfall, eine Warnung oder ein Ereignis<br/>entsteht oder ändert sich"] --> rules{"Benachrichtigungsregeln,<br/>deren Bedingungen passen"}
    rules -->|"Ein Kanal<br/>für jeden"| own["Ein eigener Kanal<br/>im gewählten Team"]
    rules -->|"In einen bestehenden<br/>Kanal oder Chat posten"| existing["Ihre Kanäle und Chats"]
    own --> card["Eine Karte mit Schaltflächen"]
    existing --> card
    card -->|"Ein Responder drückt eine"| change["Die Änderung erfolgt in OneUptime,<br/>als diese Person"]
```

Drei Dinge machen das möglich:

- **Die Verbindung des Projekts**, einmal hergestellt: Eine Administratorin oder ein Administrator von Microsoft 365 stimmt der OneUptime-App für Ihre Organisation zu.
- **Die OneUptime-App in jedem Team**, in dem Sie Benachrichtigungen möchten. Microsoft lässt den Bot nur in Teams posten, denen er hinzugefügt wurde.
- **Die eigene Verbindung jeder Person**: ihr Microsoft-Teams-Konto, verknüpft mit ihrem OneUptime-Konto. Schaltflächen, Befehle und Reaktionen handeln als diese Person, mit ihren Berechtigungen im Projekt.

Eine Microsoft-365-Organisation kann mit mehr als einem Projekt verbunden sein, etwa mit Produktion und Staging. Eine Schaltfläche auf einer Karte handelt im Projekt, für das die Karte gesendet wurde, etwa im Projekt des Vorfalls, um den es geht. Eine Nachricht an den Bot handelt im Projekt des Kanals, in dem sie gesendet wird, etwa im Kanal eines Vorfalls, sonst in dem einen Projekt, in dem das Microsoft-Teams-Konto der sendenden Person verbunden ist. Lässt sich das nicht erkennen, fragt der Bot die sendende Person, welches Projekt sie meint, mit einer Schaltfläche für jedes Projekt, in dem sie ist, und macht dort weiter, sobald sie gewählt hat. In einer Unterhaltung mit OneUptime AI gilt die Wahl für die Folgefragen, bis eine Stunde lang keine mehr kommt.

## Bevor Sie beginnen

- **Eine Rolle, die das Projekt verbinden darf:** **Projektinhaber**, **Projektadministrator** oder **Projektmitglied**. Zum Deinstallieren braucht es **Projektinhaber** oder **Projektadministrator**.
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

Jede Person verknüpft ihr eigenes Microsoft-Teams-Konto unter **Benutzereinstellungen** > **Arbeitsbereich** > **Microsoft Teams** mit **Connect my account with Microsoft Teams**, um als sie selbst auf Vorfälle zu reagieren und Direktnachrichten zu erhalten. Dieser Abschnitt erscheint, sobald das Projekt mit Microsoft Teams verbunden ist. Wie Sie ein ganzes Team auf einmal dazuholen, steht unter [Alle bitten, ihr Konto zu verbinden](#alle-bitten-ihr-konto-zu-verbinden).

### Eine Benachrichtigungsregel hinzufügen

Gehen Sie zu **Vorfälle** > **Arbeitsbereich** > **Microsoft Teams**. Der Abschnitt **Arbeitsbereich** listet nur die Chat-Workspaces, die Ihr Projekt verbunden hat, daher erscheint **Microsoft Teams** dort, sobald es verbunden ist. Legen Sie eine Regel an, zum Beispiel eine, die in einen Teams-Kanal postet, wenn ein Vorfall erstellt wird, und klicken Sie dann in ihrer Zeile auf **Regel testen**.
:::

> [!NOTE]
> OneUptime für sich selbst zu installieren oder es einem Chat hinzuzufügen ist eine andere Installation und lässt es nicht in die Kanäle eines Teams posten. **Private Kanäle** brauchen die App im Kanal selbst: Öffnen Sie den Kanal > "..." > **Manage channel** > **Apps** > **Add an app**. **Geteilte Kanäle** können keine Benachrichtigungen empfangen: Microsoft Teams unterstützt keine Bots in geteilten Kanälen.

## Alle bitten, ihr Konto zu verbinden

Niemand kann das Microsoft-Teams-Konto einer anderen Person verbinden, auch kein Admin: Jede Person meldet sich mit ihrem eigenen Konto an. Um ein ganzes Team dazuzuholen, bittet ein **Projektinhaber** oder **Projektadministrator** unter **Projekteinstellungen** > **Arbeitsbereich** > **Microsoft Teams** alle auf einmal, ihr Konto zu verbinden. Die Karte **Members' Microsoft Teams accounts** zeigt, wie viele Mitglieder ihr Konto schon verbunden haben. Mit **Ask everyone to connect** schickt der OneUptime-Bot jedem Mitglied ohne verbundenes Konto eine Nachricht, mit einer Schaltfläche **Connect Microsoft Teams account**, die sein Konto mit einem Klick verbindet.

- **Wer eine Nachricht bekommt.** Jedes Mitglied des Projekts, das sein Microsoft-Teams-Konto noch nicht verbunden hat und in einem Team ist, dem die OneUptime-App hinzugefügt wurde, und das OneUptime dort über seine E-Mail-Adresse oder seinen Benutzerprinzipalnamen findet. Wer in den letzten 24 Stunden gebeten wurde, wird nicht noch einmal gebeten; bitten Sie am nächsten Tag erneut, erinnert das also nur die, die ihr Konto noch immer nicht verbunden haben.
- **Was die Karte sagt.** Solange die Nachrichten verschickt werden, wie weit der Versand ist; danach, wer gebeten hat und wie viele Mitglieder eine Nachricht bekommen haben. Mitglieder, die OneUptime nicht finden konnte, nennt die Karte mit Namen: Fügen Sie die App ihrem Team hinzu, oder lassen Sie sie ihr Konto selbst unter **Benutzereinstellungen** > **Arbeitsbereich** > **Microsoft Teams** verbinden.
- **Was die Schaltfläche verbindet.** Das Microsoft-Teams-Konto der Person, die sie drückt und sich anmeldet, mit ihrem eigenen OneUptime-Konto. Eine an jemand anderen weitergeleitete Nachricht verbindet nichts mit dem Mitglied, an das sie geschickt wurde.

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
| **Bedingungen** | Für welche Ereignisse die Regel gilt, zum Beispiel nach Schweregrad, Status, Beschriftung, Monitor oder Wörtern im Titel. Sie werden geprüft, wenn ein Ereignis erstellt wird, und erneut bei jedem Update, das OneUptime dazu postet, sodass eine Regel für bestätigte Vorfälle greift, sobald ein Vorfall bestätigt wird. Eine neue Regel gilt für jedes Ereignis, etwa **Alle Vorfälle**. Um sie einzugrenzen, wählen Sie **Nur Vorfälle, die den Bedingungen entsprechen** und fügen die Bedingungen hinzu. Bei zwei oder mehr legt **Abgleichsbedingung** fest, ob alle zutreffen müssen oder eine genügt. |
| **Ziel** | Wohin sie postet: in einen bestehenden Kanal eines gewählten Teams, in die gewählten Chats, in einen Kanal für jeden Vorfall (oder jede Warnung, Episode, jedes Ereignis, jeden Monitor oder jede Bereitschaftsrichtlinie), der in einem gewählten Team erstellt wird, oder in mehrere davon zugleich. Unter dem Schritt sagt **Was diese Regel tut** in Sätzen, was sie tut, wie die Karte der Regel. |
| **Videoanruf** | Nur Vorfälle und Warnungen: für jeden einen Anruf starten. Siehe [Videoanrufe](/docs/workspace-connections/video-calls). |

Ein Kanal, den die Regel anlegt, wird nach seinem Datensatz benannt: Vorfall INC-42 bekommt `inc-42`, Warnung ALT-7 bekommt `alt-7`, und in einem Projekt ohne Nummernpräfixe bekommt Vorfall 42 `incident-42`. Text in **Präfix für Kanalnamen** steht davor, aus `prod-` wird also `prod-inc-42`, und das Formular zeigt den Namen schon beim Tippen. Bei einem geplanten Wartungsereignis tritt das Präfix an die Stelle seines Nummernpräfixes: SM-5 bekommt `sm-5`, und aus `maint-` wird `maint-5`. OneUptime behält Buchstaben, Ziffern, Leerzeichen, `-` und `_`, bis zu den 50 Zeichen, die Microsoft Teams annimmt. Hat das Team schon einen Kanal mit diesem Namen, etwa den eines anderen Projekts oder einen in den letzten 30 Tagen gelöschten, hängt OneUptime `-2`, `-3` und so weiter an.

Eine Regel erstellt ihren Kanal, wenn ein Ereignis zum ersten Mal auf sie zutrifft: beim Erstellen des Ereignisses oder später, wenn es durch ein Update zutrifft, solange es noch offen ist. Eine Regel für bestätigte Vorfälle erstellt den Kanal, sobald der Vorfall bestätigt wird. Microsoft Teams zeigt die Kanäle eines Teams allen im Team, daher fügt OneUptime niemanden einzeln zu einem Kanal hinzu: Alle im gewählten Team können ihn öffnen, wie das Regelformular unter **Wer dem Kanal beitritt** sagt. Ein privater Vorfall, eine private Warnung oder Episode bekommt einen privaten Kanal, den nur seine Mitglieder sehen; fügen Sie Personen in Microsoft Teams hinzu.

Um die Personen in Bereitschaft dazuzuholen, wählen Sie ihre Bereitschaftspläne unter **Personen in Bereitschaft erwähnen** aus. Beim Erstellen des Kanals postet OneUptime darin, direkt nach der ersten Nachricht des Datensatzes, eine Nachricht, die alle mit @ erwähnt, die in diesen Bereitschaftsplänen Bereitschaft haben, sodass Microsoft Teams sie benachrichtigt. Niemand wird alarmiert. OneUptime findet jede Person im Team über das Microsoft-Teams-Konto, das sie mit OneUptime verbunden hat, oder sonst über ihre E-Mail-Adresse. Wer nicht im Team ist, kann dessen Kanäle nicht öffnen und wird deshalb stattdessen in der Nachricht genannt, mit dem Grund. Einen privaten Kanal können nur seine Mitglieder öffnen; fügen Sie die Personen in Bereitschaft daher in Microsoft Teams hinzu.

Jede spätere Änderung des Datensatzes — ein Statuswechsel, eine Notiz, ein neuer Eigentümer — wird in seinen Kanälen gepostet und in den bestehenden Kanälen und Chats, die seine Regeln nennen, solange deren Bedingungen zutreffen. OneUptime kann keinen Microsoft Teams-Kanal archivieren, daher bleibt der Kanal einer Regel bestehen, wenn sein Datensatz abgeschlossen ist; archivieren oder löschen Sie ihn in Microsoft Teams.

Ein Vorfall, eine Warnung, eine Episode oder ein geplantes Wartungsereignis mit einem eigenen Kanal hat im Kopf seiner Seite in OneUptime, neben den Statusschaltflächen, **In Microsoft Teams öffnen**. Das öffnet diesen Kanal in einem neuen Tab, in der Microsoft-Teams-App oder im Browser. Ein Datensatz mit zwei eigenen Kanälen listet beide unter der Schaltfläche. Ein Datensatz mit Kanälen in Slack und in Microsoft Teams hat stattdessen eine Schaltfläche **Kanal öffnen**, die sie alle auflistet. Die bestehenden Kanäle und Chats, in die Ihre Regeln posten, werden nicht angeboten.

Die Seite des Datensatzes hat außerdem eine Karte **Microsoft Teams-Kanal**, die sagt, wer den Kanal öffnen kann: alle im Team oder, bei einem privaten Kanal, seine Mitglieder, die seine Besitzer in Microsoft Teams hinzufügen. OneUptime ändert nicht, wer in einem Microsoft-Teams-Kanal ist. Bei einem Slack-Kanal listet die Karte, wer darin ist, und fügt Personen hinzu: siehe [Wer im Kanal eines Datensatzes ist](/docs/workspace-connections/slack#wer-im-kanal-eines-datensatzes-ist).

Kanäle und Chats bleiben lesbar: Jedes Ereignis wird einmal gepostet, und der erste Status eines Datensatzes steht in der Karte, die den Datensatz ankündigt, nicht in einer eigenen Karte. Ein Durchlauf einer Bereitschaftsrichtlinie ist eine einzige Karte, die bearbeitet wird, während der Durchlauf eskaliert: wer alarmiert wurde, wie oft und wie, wer nicht und warum, und wer bestätigt hat. Eine neue Karte wird nur gepostet, wenn jemand handeln muss: Eine Eskalationsregel hat niemanden erreicht, oder der Durchlauf endete, ohne dass jemand bestätigt hat. Dass die Eigentümer eines Datensatzes oder die Statusseiten-Abonnenten benachrichtigt wurden, steht in seinem Feed in OneUptime.

**Projekteinstellungen** > **Arbeitsbereich** > **Microsoft Teams** listet die Kanäle, die OneUptime in Ihren Teams sieht, und die Chats, denen es hinzugefügt wurde, mit **Test senden** neben jedem. Ein Chat erscheint, sobald die OneUptime-App ihm in Microsoft Teams hinzugefügt wurde; **Chats aktualisieren** holt neue Chats und ihre aktuellen Namen.

## Eine Regel testen

**Regel testen** in der Zeile einer Regel postet eine Testnachricht für diese Regel in die Kanäle, die sie nennt, damit Sie sie ankommen sehen. Legt die Regel für jedes Ereignis einen Kanal an, legt auch der Test einen an und lädt die Personen der Regel ein.

Wie **Test senden** neben einem Kanal unter **Projekteinstellungen** > **Arbeitsbereich** > **Microsoft Teams** braucht er die Berechtigung, Benachrichtigungsregeln anzulegen: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Einstellungs-Administrator**, **Einstellungs-Mitglied** oder **Create Workspace Notification Rule** und **Read Workspace Notification Rule** in einer benutzerdefinierten Rolle. Für jemanden, der die Regeln nur sehen kann, etwa ein **Betrachter**, ist **Regel testen** gesperrt, und sein Tooltip sagt, was es braucht; die API lehnt seinen Test mit "You do not have permission to send test notifications in this project." ab. In OneUptime Cloud braucht das Testen einer Regel den Tarif **Growth**, wie das Anlegen einer.

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
| 📣 oder 📢 | Eine öffentliche Notiz, die auf der Statusseite erscheint. Nur Vorfälle und geplante Wartungsereignisse. Bei einem privaten Vorfall eine private Notiz, und die Bestätigung sagt, warum. |

Die Notiz übernimmt die Nachricht so, wie Microsoft Teams sie gezeigt hat: ihre Formatierung, Links und Code, die erwähnten Personen mit Namen und ihre Dateien und Bilder als Links darauf. Eine öffentliche Notiz lässt die Dateien und Bilder weg, da sie sich nur für Ihr Team öffnen.

Sie gibt die Worte dessen wieder, der die Nachricht geschrieben hat: mit seinem OneUptime-Namen, wenn sein Microsoft-Teams-Konto verbunden ist, sonst mit dem Namen, den Teams zeigt. Eine private Notiz wird in der Zeitleiste dort eingeordnet, wo die Nachricht gepostet wurde, egal wie viel später sie gespeichert wird. Eine öffentliche Notiz wird beim Speichern eingeordnet, also dann, wenn die Statusseite sie zeigt. Die Zeitleiste nennt, wer sie gespeichert hat. Die Notiz wird nicht zurück in den Kanal gepostet, in dem die Nachricht bereits steht.

Die Notiz wird als Sie gespeichert, mit Ihren Berechtigungen, und die OneUptime-App muss im Team sein. Ist Ihr Microsoft-Teams-Konto noch nicht verbunden, bittet OneUptime Sie in einer Antwort, die Sie erwähnt, es zu verbinden, mit einer Schaltfläche, die die Nachricht speichert, sobald Sie das getan haben.

## Mit dem OneUptime-Bot sprechen

Schreiben Sie dem Bot in einem persönlichen Chat, oder erwähnen Sie OneUptime in einem Kanal oder Gruppenchat mit @: Dort antwortet er nur, wenn er erwähnt wird.

| Nachricht | Was der Bot tut |
| --- | --- |
| `help` | Listet, was er kann. |
| `incident [title or number]` | Öffnet das Vorfallsformular, mit ausgefülltem Titel. Die Nummer eines Vorfalls, etwa `42` oder `INC-42`, zeigt stattdessen diesen Vorfall: siehe [Einen Vorfall aus Microsoft Teams verwalten](#einen-vorfall-aus-microsoft-teams-verwalten). |
| `maintenance [title]` | Öffnet das Formular für geplante Wartung, mit ausgefülltem Titel. |
| `oncall` | Listet, wer gerade in jedem Bereitschaftsplan, den Sie sehen können, Bereitschaft hat, bis wann und wer als Nächstes dran ist. |
| `page [who] [message]` | Alarmiert die Personen, die Sie mit @ erwähnen, wegen Ihrer Nachricht, oder sendet eine Karte, auf der Sie wählen, wer alarmiert wird. Siehe [Jemanden aus Microsoft Teams alarmieren](#jemanden-aus-microsoft-teams-alarmieren). |
| `ask [question]`, oder jede Frage in natürlicher Sprache | OneUptime AI antwortet zu Ihren Logs, Traces, Metriken, Vorfällen und Monitoren, zum Beispiel "Welche Monitore sind gerade ausgefallen?". Antworten lesen nur. |
| `show active incidents`, `show active alerts` | Listet, was gerade offen ist. |
| `show scheduled maintenance`, `show ongoing maintenance` | Listet anstehende oder laufende Wartungsereignisse. |

Bis auf die `show`-Listen sind das die Wörter, die in Slack auf `/oneuptime` folgen; `create incident` und `create maintenance` funktionieren weiterhin. OneUptime AI zu fragen braucht Ihr eigenes verbundenes Microsoft Teams-Konto und eingeschaltete KI für das Projekt. Ist Ihr Konto nicht verbunden, bittet der Bot Sie einmal pro Thread oder Chat, es zu verbinden, mit einer Schaltfläche **Connect Microsoft Teams account**. Siehe [KI fragen](/docs/ai/ask-ai).

## Ihre Startseite in Microsoft Teams

Schreiben Sie dem OneUptime-Bot `home`, und er antwortet mit Ihrer Startseite: einer Karte, die zeigt, was im Projekt geschieht, so wie Sie es sehen dürfen.

- **Ihre Bereitschaft.** Die Bereitschaftspläne, in denen Sie gerade Bereitschaft haben, und bis wann, oder sonst Ihre nächste Schicht.
- **Was offen ist.** Die neuesten offenen Vorfälle und Warnungen, die Sie lesen dürfen, jeweils mit einem Link auf ihre Seite in OneUptime.
- **Die Schaltflächen.** **Declare incident** und **Page someone** antworten wie `incident` und `page`, **Who's on call** wie `oncall`, und **Refresh** liest die Karte an ihrem Platz neu.

Wenn Sie die OneUptime-App für sich selbst hinzufügen, schickt Ihnen der Bot sofort Ihre Startseite. Die Startseite und die `show`-Listen lesen als Sie, deshalb brauchen sie Ihr eigenes verbundenes Microsoft-Teams-Konto: Bis es verbunden ist, antwortet der Bot mit der Schaltfläche **Connect Microsoft Teams account**. **OneUptime in Microsoft Teams öffnen** unter **Benutzereinstellungen** > **Arbeitsbereich** > **Microsoft Teams** öffnet die App in Teams.

Wenn die App zu einem Team hinzugefügt wird, begrüßt der Bot das Team dort: wie man ihm eine Frage stellt und wo man eine Benachrichtigungsregel hinzufügt, die in die Kanäle des Teams postet.

## Vorfälle und Wartungen aus Microsoft Teams erstellen

`incident` oder `maintenance` an den OneUptime-Bot öffnet ein Formular für die Person, die es geschrieben hat, in einem persönlichen Chat, einem Kanal oder einem Gruppenchat gleichermaßen. Es wird als diese Person ausgefüllt: als das OneUptime-Konto, mit dem ihr Microsoft-Teams-Konto verbunden ist (siehe [Microsoft Teams verbinden](#microsoft-teams-verbinden)), mit dessen Berechtigungen im Projekt. Wer kein verbundenes Konto hat oder dessen OneUptime-Konto kein Mitglied des Projekts mehr ist, erfährt in einer Antwort, die ihn erwähnt, was zu tun ist, statt das Formular zu bekommen.

- **Wer sie nutzen darf.** Die Personen, die in OneUptime einen Vorfall melden oder ein geplantes Wartungsereignis anlegen dürfen: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Vorfall-Administrator** und **Vorfall-Mitglied** für einen Vorfall (**Create Incident** in einer benutzerdefinierten Rolle), und **Wartungs-Administrator** und **Wartungs-Mitglied** für ein Ereignis (**Create Scheduled Maintenance**). Alle anderen erfahren das und bekommen kein Formular.
- **Was ein Formular anbietet.** Jede Liste — Schweregrade, Monitore, Monitorstatus, Bereitschaftsrichtlinien und Beschriftungen — enthält, was die anfragende Person lesen darf, wie dieselbe Liste in OneUptime, und die Hinweise "not shown" der Karte zählen nur diese: bei einer auf einige Beschriftungen beschränkten Rolle die Monitore und Bereitschaftsrichtlinien mit diesen Beschriftungen. Eine Liste, die sie gar nicht lesen darf, fehlt. Archivierte Bereitschaftsrichtlinien werden nie angeboten.
- **Was ein Formular nennen darf.** In einem Kanal oder Gruppenchat darf jede anwesende Person das Formular absenden, und es wird als diese Person abgesendet, mit ihren eigenen Berechtigungen. Der Vorfall oder das Ereignis wird mit diesen Berechtigungen erstellt und dieser Person zugeschrieben. Ein Monitor, eine Bereitschaftsrichtlinie, eine Beschriftung, ein Schweregrad oder Status, den sie nicht lesen darf, oder einer eines anderen Projekts, wird abgelehnt wie einer, den das Projekt nicht hat, und es wird nichts erstellt: Der Bot antwortet "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode funktioniert genauso: Es braucht die Berechtigung, eine Bereitschaftsrichtlinie auszuführen (**Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Bereitschafts-Administrator** und **Bereitschafts-Mitglied**, oder **Create On-Call Duty Policy Execution Log** in einer benutzerdefinierten Rolle) und diesen Vorfall, diese Warnung oder Episode zu lesen, und bietet die aktiven Bereitschaftsrichtlinien an, die die Person lesen darf. Einen Monitor oder eine Bereitschaftsrichtlinie aus einer Karte heraus anzusehen liest diese ebenfalls als die Person, die die Schaltfläche gedrückt hat.

## Jemanden aus Microsoft Teams alarmieren

In einem Kanal oder Gruppenchat alarmiert `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` Nawaz sofort. OneUptime erstellt eine Warnung mit Ihrer Nachricht als Titel, und jede Person, die Sie mit @ erwähnen, bekommt einen Anruf, eine SMS, eine Push-Benachrichtigung oder eine E-Mail, wie es ihre eigenen Bereitschaftsregeln vorsehen, bis jemand die Warnung bestätigt.

- **Wer sofort alarmiert wird.** Die Personen, die Sie mit @ erwähnen, und alle, die in den Bereitschaftsplänen Bereitschaft haben, denen ein von Ihnen mit @ erwähntes Tag folgt (siehe [Bereitschafts-Tags](#bereitschafts-tags)), wenn eine Nachricht auf sie folgt. OneUptime erkennt eine Person am OneUptime-Konto, mit dem ihr Microsoft-Teams-Konto verbunden ist, oder sonst an ihrer E-Mail-Adresse in Microsoft Teams. Niemand außerhalb des Projekts wird alarmiert.
- **Alles andere bekommt eine Karte.** Ohne Erwähnung mit @, wie in einem persönlichen Chat mit dem Bot, ohne Nachricht, mit einem Tag, das keinem für Sie sichtbaren Bereitschaftsplan folgt, oder mit einer Person, die OneUptime nicht erkennt, antwortet der Bot mit der Karte **Page someone**, ausgefüllt mit dem, was Sie geschrieben haben, und nennt, wen er nicht auswählen konnte. Wählen Sie Personen, ein Team, einen Bereitschaftsplan, der alarmiert, wer darin gerade Bereitschaft hat, oder eine Bereitschaftsrichtlinie, die über ihre Eskalationsregeln alarmiert, und senden Sie sie ab. Jede Person im Gespräch darf die Karte absenden, als sie selbst. Hat sie alarmiert, wird die Karte entfernt, damit niemand zweimal damit alarmiert.
- **Wo es erscheint.** Das Gespräch zeigt die Alarmierung als eine Karte, die aktuell gehalten wird: wer alarmiert wurde und wie, und wer bestätigt hat. Wo der Bot sie nicht posten kann, nennt seine Antwort, wer alarmiert wurde, mit einem Link zur Warnung.
- **Wer alarmieren darf.** Alle, die sowohl eine Bereitschaftsrichtlinie ausführen als auch eine Warnung erstellen dürfen: **Projektinhaber**, **Projektadministrator** und **Projektmitglied**, oder **Bereitschafts-Mitglied** zusammen mit **Warnungs-Mitglied** (**Create On-Call Duty Policy Execution Log** und **Create Alert** in einer benutzerdefinierten Rolle). Personen, ein Team oder einen Bereitschaftsplan direkt zu alarmieren, ohne Bereitschaftsrichtlinie dahinter, braucht zusätzlich Zugriff auf alle Bereitschaftsrichtlinien des Projekts. Alle anderen erfahren das in einer Antwort, und niemand wird alarmiert. In OneUptime Cloud braucht das Alarmieren den Growth-Tarif: darunter nennt OneUptime den nötigen Tarif, und niemand wird alarmiert.

## Bereitschafts-Tags

Halten Sie ein Tag in Microsoft Teams wie `@Payments on-call` gleich denen, die in einem oder mehreren Bereitschaftsplänen gerade Bereitschaft haben, damit jeder in seinem Team es mit @ erwähnen kann, um sie zu erreichen. OneUptime ändert die Mitglieder des Tags bei jeder Übergabe und jeder Vertretung und prüft es alle 15 Minuten.

:::steps
### Ein Tag mit einem Bereitschaftsplan verbinden

Öffnen Sie den Bereitschaftsplan unter **Bereitschaftsdienst** > **Bereitschaftspläne**. Klicken Sie in seiner Karte **Tags in Microsoft Teams** auf **Tag verbinden**, wählen Sie das Team und geben Sie den Namen des Tags ein: das Tag des Teams mit diesem Namen oder ein neues, das OneUptime erstellt. Seine Mitglieder werden sofort durch die Personen ersetzt, die Bereitschaft haben.

### Es auch mit dem sekundären Bereitschaftsplan verbinden

Für ein Tag, das die primäre und die sekundäre Bereitschaft enthält, verbinden Sie dasselbe Tag auch auf der Seite des sekundären Bereitschaftsplans. Ein Tag kann beliebig vielen Bereitschaftsplänen folgen.
:::

- **Was die Karte zeigt.** Wer jetzt in jedem Tag ist, sein Team, welchen anderen Bereitschaftsplänen es folgt und ob es **Aktuell** ist. Ein Tag enthält nur Mitglieder seines Teams: Wer Bereitschaft hat, aber nicht im Team ist, wird mit dem Grund genannt.
- **Niemand in Bereitschaft.** OneUptime nimmt alle aus dem Tag, bis jemand Bereitschaft hat. Ein neues Tag braucht jemanden aus dem Team in Bereitschaft, denn Microsoft Teams erstellt kein Tag ohne Mitglieder.
- **Das Tag alarmieren.** `@OneUptime page @Payments on-call The checkout API is down` alarmiert alle, die in den Bereitschaftsplänen des Tags Bereitschaft haben. Siehe [Jemanden aus Microsoft Teams alarmieren](#jemanden-aus-microsoft-teams-alarmieren).
- **Was Microsoft 365 braucht.** Tags zu ändern braucht die Berechtigung `TeamworkTag.ReadWrite.All` der App, die eine Administratorin oder ein Administrator von Microsoft 365 mit **Administratorzustimmung erteilen** unter **Projekteinstellungen** > **Arbeitsbereich** > **Microsoft Teams** erteilt. Hat Ihre Organisation zugestimmt, bevor OneUptime Tags pflegen konnte, stimmen Sie einmal erneut zu.
- **Wer eines verbinden darf.** Die Rollen, die Bereitschaftspläne bearbeiten dürfen: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Bereitschafts-Administrator** und **Bereitschafts-Mitglied**, oder **Edit On-Call Duty Policy Schedule** in einer benutzerdefinierten Rolle. In OneUptime Cloud braucht das Verbinden den Tarif **Growth**.
- **Trennen.** OneUptime ändert das Tag nicht mehr. Das Tag und seine Mitglieder bleiben in Microsoft Teams, wie sie sind.

## Einen Vorfall aus Microsoft Teams verwalten

Die Karte eines Vorfalls hat vier Schaltflächen, **Acknowledge Incident**, **Resolve Incident**, **Add Note** und **View Incident**, und den Rest in ihrem Menü, der Schaltfläche mit drei Punkten:

| Menüpunkt | Was er tut |
| --- | --- |
| **Change Severity** | Legt den Schweregrad des Vorfalls fest. |
| **Change Incident State** | Versetzt den Vorfall in einen späteren Status. |
| **Assign Role** | Gibt jemandem eine Rolle im Vorfall, etwa **Incident Commander**. Eine Rolle für nur eine Person geht an diese Person über. |
| **Page Someone** | Alarmiert Personen, ein Team, wer in einem Bereitschaftsplan gerade Bereitschaft hat, oder eine Bereitschaftsrichtlinie zu dem Vorfall, bis jemand ihn bestätigt. |
| **Edit Custom Fields** | Setzt die benutzerdefinierten Felder des Vorfalls, jedes ausgefüllt mit dem, was der Vorfall enthält. Ein leer gelassenes Feld wird geleert. |

`incident 42`, an den Bot geschrieben, antwortet mit Vorfall 42, diesen Schaltflächen und seinem Menü. Schreiben Sie die Nummer so, wie OneUptime sie zeigt: `42`, `#42` oder `INC-42`. Im eigenen Kanal eines Vorfalls zeigt `incident` allein diesen Vorfall.

- **Wer sie nutzen darf.** Die Personen, die dieselbe Änderung in OneUptime vornehmen dürfen, wie in Slack: siehe [Einen Vorfall aus Slack verwalten](/docs/workspace-connections/slack#einen-vorfall-aus-slack-verwalten). Jeder Menüpunkt antwortet mit einer Karte, ausgefüllt so, wie die Person, die ihn gedrückt hat, den Vorfall sehen darf. Jede Person im Gespräch darf die Karte absenden, als sie selbst, mit ihren eigenen Berechtigungen.
- **Was dann passiert.** Die Änderung wird als die Person vorgenommen, die die Karte abgesendet hat, wie in OneUptime, und der Feed des Vorfalls sagt, was sich geändert hat. Der Bot sagt es in einer Antwort, die sie erwähnt, und entfernt die Karte, damit niemand sie zweimal absendet. **Page Someone** sagt, wer alarmiert wurde oder warum niemand; ein bereits behobener Vorfall alarmiert niemanden.
- **Wo Microsoft Teams anders ist.** Eine Karte kann nicht unter einem Feld sagen, was falsch ist: Ein Wert, der nicht passt, wird in einer Antwort genannt, und die Karte bleibt, um korrigiert und erneut abgesendet zu werden. Ein Feld für Datum und Uhrzeit ist ein Tag und eine Uhrzeit, in Ihrer eigenen Zeitzone. Ein älterer Teams-Client zeigt das Menü als weitere Schaltflächen. `incident 42` antwortet im Gespräch, wo alle darin den Vorfall sehen können.
- **Karten von vor dem Menü.** Sie behalten ihre Schaltfläche **Execute On-Call Policy**, und sie funktioniert weiter: **Page Someone** alarmiert auch eine Bereitschaftsrichtlinie. Warnungen und Episoden behalten ihre.

## Aus Microsoft Teams auf Vorfälle, Warnungen und Ereignisse reagieren

Die Schaltflächen auf den Karten von OneUptime handeln als die Person, die sie drückt, in einem persönlichen Chat, einem Kanal oder einem Gruppenchat gleichermaßen: als das OneUptime-Konto, mit dem ihr Microsoft-Teams-Konto verbunden ist, mit dessen Berechtigungen im Projekt. **Acknowledge**, **Resolve**, **Change State**, **Add Note** und **Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode, und **Mark as Ongoing**, **Mark as Complete**, **Change State** und **Add Note** an einem geplanten Wartungsereignis nehmen jeweils die Änderung vor, die dieselbe Aktion in OneUptime vornimmt, und sie wird dort dieser Person zugeschrieben: Status-Zeitleiste und Feed des Datensatzes zeigen, wer seinen Status geändert hat, und die Notiz gehört ihr. Eine Notiz, die aus einer Nachricht mit einer Reaktion gespeichert wird, wird genauso gepostet.

- **Wer sie nutzen darf.** Die Personen, die dieselbe Änderung in OneUptime vornehmen dürfen. Einen Vorfall zu bestätigen, zu beheben oder seinen Status zu ändern braucht die Berechtigung, seinen Status zu ändern: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Vorfall-Administrator** und **Vorfall-Mitglied**, oder **Create Incident State Timeline** in einer benutzerdefinierten Rolle. Eine Warnung, eine Episode oder ein geplantes Wartungsereignis braucht dieselbe Berechtigung für die eigene Art (zum Beispiel **Create Alert State Timeline**), und eine Notiz braucht die Berechtigung, diese Art von Notiz zu posten. Wie das Statusfeld in OneUptime verlangen sie keine Berechtigung, den Vorfall oder die Warnung selbst zu bearbeiten. Alle anderen erfahren das, und es ändert sich nichts.
- **Welche Datensätze.** Die, die die Person lesen darf, wie in OneUptime: bei einer auf einige Beschriftungen beschränkten Rolle die Vorfälle, Warnungen, Episoden und Ereignisse mit diesen Beschriftungen. Eine Schaltfläche an jedem anderen Datensatz sagt, warum, und es ändert sich nichts: an einem Vorfall, den ihre Rolle nicht erreicht, "your access in this project does not include this incident. Ask a project admin for access to it."; an einem privaten Vorfall, zu dessen Eigentümern sie nicht gehört, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; und an einem inzwischen gelöschten "the incident was not found. It may have been deleted." In OneUptime Cloud wird eine Änderung, die der Tarif des Projekts nicht enthält, mit dem nötigen Tarif abgelehnt.
- **Was Change State anbietet.** Die Status, die die Person lesen darf und in die der Datensatz als Nächstes wechseln darf, in der Reihenfolge des Projekts: keiner vor dem Status, in dem er ist, bei einer Episode wie bei einem Vorfall, einer Warnung oder einem geplanten Wartungsereignis, denn ein Statuswechsel bewegt einen Datensatz nie in seiner Liste zurück nach oben (siehe [Die Reihenfolge ist eine echte Einschränkung, keine Anzeigevorliebe](/docs/incidents/states-and-severities#die-reihenfolge-ist-eine-echte-einschränkung-keine-anzeigevorliebe)). Darf sie keinen lesen, sagt der Bot "No incident states are available to you in this project. Ask a project admin for access to them."; ist der Datensatz im letzten Status, den er erreichen kann, sagt er "There is no later state to move this incident to." Keins von beiden zeigt eine leere Karte.
- **Add Note bei einem privaten Vorfall.** Ein privater Vorfall erhält keine öffentlichen Notizen, daher fragt seine Karte nach keinem Notiztyp und fügt eine private Notiz hinzu. Eine Karte, die gesendet wurde, bevor er privat wurde, fügt ebenfalls eine private Notiz hinzu und sagt das. Siehe [Private Vorfälle erhalten nur private Notizen](/docs/incidents/notes-owners-and-feed#private-vorfälle-erhalten-nur-private-notizen).
- **Escalate.** **Escalate** auf einer Karte führt deren Bereitschaftsrichtlinie für den Vorfall, die Warnung oder die Episode aus, um die es auf der Karte geht, als die Person, die gedrückt hat, mit denselben Berechtigungen wie **Execute On-Call Policy**. Eine Karte, die keins davon betrifft, wird mit "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there." beantwortet, und niemand wird alarmiert.
- **Wo die Person die Antwort bekommt.** In einer Antwort in derselben Unterhaltung, in einem Kanal im Thread der Karte, die sie erwähnt, damit Microsoft Teams sie benachrichtigt. Eine zu spät gedrückte Schaltfläche sagt, wer zuerst da war und wann, etwa "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Wenn ihr Konto nicht verbunden ist.** Die Antwort bittet sie, es zu verbinden, mit einer Schaltfläche **Connect Microsoft Teams account**. Sie öffnet ihre eigenen Microsoft-Teams-Einstellungen in OneUptime und verbindet ihr Konto in einem Schritt, nachdem sie sich bei Bedarf bei OneUptime angemeldet hat. Danach erledigt OneUptime, was sie gedrückt hat, als sie, und antwortet in derselben Unterhaltung; bei einer Schaltfläche, die ein Formular öffnet, oder bei einem Befehl bittet es sie, sie erneut zu drücken oder ihn erneut einzugeben. Die Schaltfläche funktioniert einmal, 30 Minuten lang, und nur für das Microsoft-Konto, das sie gedrückt hat.

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
Drücken Sie in der Antwort des Bots **Connect Microsoft Teams account**, um es in einem Schritt zu verbinden, oder verknüpfen Sie es unter **Benutzereinstellungen** > **Arbeitsbereich** > **Microsoft Teams** mit **Connect my account with Microsoft Teams**. In beiden Fällen melden Sie sich bei der Organisation an, mit der das Projekt verbunden ist, als Gast, wenn Sie dort Gast sind. Haben Sie als Gast früher das Konto Ihrer eigenen Organisation verbunden, verbinden Sie es erneut.
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
