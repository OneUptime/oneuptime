# Slack

Verbinden Sie OneUptime mit Slack, um Vorfälle, Warnungen, Episoden, geplante Wartungen, Monitore und Bereitschafts-Updates in Ihren Kanälen zu posten, jedem Vorfall einen eigenen Kanal zu geben und Responder handeln zu lassen, ohne Slack zu verlassen: bestätigen, beheben, Notizen hinzufügen, die Bereitschaft alarmieren und Vorfälle melden.

:::cards
- [Slack verbinden](#slack-verbinden): Installieren Sie OneUptime in Ihrem Workspace und verknüpfen Sie dann Ihr eigenes Konto.
- [Alle bitten, ihr Konto zu verbinden](#alle-bitten-ihr-konto-zu-verbinden): Schreiben Sie alle Mitglieder, die ihr Konto noch nicht verbunden haben, auf einmal an.
- [Benachrichtigungsregeln](#benachrichtigungsregeln): Legen Sie fest, welche Ereignisse wohin posten und welche einen eigenen Kanal bekommen.
- [Wer im Kanal eines Datensatzes ist](#wer-im-kanal-eines-datensatzes-ist): Sehen Sie, wer darin ist, treten Sie bei und fügen Sie Personen hinzu, direkt auf der Seite des Datensatzes.
- [Der Befehl /oneuptime](#der-befehl-oneuptime): Vorfälle melden, Wartungen planen, sehen, wer Bereitschaft hat, und die KI fragen.
- [Bereitschafts-Benutzergruppen](#bereitschafts-benutzergruppen): Halten Sie eine Benutzergruppe gleich denen, die Bereitschaft haben, und alarmieren Sie sie.
- [Aus Slack auf Vorfälle, Warnungen und Ereignisse reagieren](#aus-slack-auf-vorfälle-warnungen-und-ereignisse-reagieren): Die Schaltflächen in den Nachrichten von OneUptime.
:::

## So funktioniert es

```mermaid title="Von einem Ereignis in OneUptime zu einer Nachricht in Slack"
flowchart TB
    event["Ein Vorfall, eine Warnung oder ein Ereignis<br/>entsteht oder ändert sich"] --> rules{"Benachrichtigungsregeln,<br/>deren Bedingungen passen"}
    rules -->|"Ein Kanal<br/>für jeden"| own["Ein eigener Kanal,<br/>seine Personen eingeladen, sobald sie dazukommen"]
    rules -->|"In vorhandenen Kanälen posten"| existing["Ihre bestehenden Kanäle"]
    own --> message["Eine Nachricht mit Schaltflächen"]
    existing --> message
    message -->|"Ein Responder drückt eine"| change["Die Änderung erfolgt in OneUptime,<br/>als diese Person"]
```

Zwei Verbindungen machen das möglich:

- **Die Verbindung des Projekts**, einmal hergestellt: die App von OneUptime, installiert in Ihrem Slack-Workspace. Sie postet die Nachrichten, legt die Kanäle an und lädt Personen ein.
- **Die eigene Verbindung jeder Person**: ihr Slack-Konto, verknüpft mit ihrem OneUptime-Konto. Schaltflächen, Befehle und Emoji-Reaktionen handeln als diese Person, mit ihren Berechtigungen im Projekt.

Ein Slack-Workspace kann mit mehr als einem Projekt verbunden sein, etwa mit Produktion und Staging. Eine Schaltfläche oder ein Formular handelt im Projekt des Datensatzes, um den es geht. Befehle und Nachrichten an OneUptime handeln im Projekt des Kanals, in dem sie geschrieben werden, etwa im Kanal eines Vorfalls, sonst in dem einen Projekt, in dem Ihr Slack-Konto verbunden ist. Lässt sich das nicht erkennen, fragt OneUptime, welches Projekt Sie meinen, mit einer Schaltfläche für jedes Projekt, in dem Sie sind, und macht dort weiter, sobald Sie gewählt haben. In einer Unterhaltung mit OneUptime AI gilt Ihre Wahl für den Rest des Threads.

## Bevor Sie beginnen

- **Eine Rolle, die das Projekt verbinden darf:** **Projektinhaber**, **Projektadministrator** oder **Projektmitglied**. Zum Deinstallieren der App braucht es **Projektinhaber** oder **Projektadministrator**.
- **Einen Slack-Workspace**, in dem Sie Apps installieren dürfen.
- **Den Growth-Tarif in OneUptime Cloud** für Benachrichtigungsregeln und Zusammenfassungen. Siehe [Benachrichtigungsregeln unterhalb des Growth-Tarifs](#benachrichtigungsregeln-unterhalb-des-growth-tarifs).
- **Auf einem selbst gehosteten Server** zuerst eine dafür eingerichtete Slack-App. Siehe [Slack-Integration](/docs/self-hosted/slack-integration).

## Slack verbinden

:::steps
### OneUptime in Ihrem Slack-Workspace installieren

Gehen Sie zu **Projekteinstellungen** > **Arbeitsbereich** > **Slack** und klicken Sie auf **Mit Slack verbinden**. Wählen Sie den Workspace und erlauben Sie OneUptime den Zugriff. Slack schickt Sie zurück auf dieselbe Seite, die nun den Workspace nennt, mit dem das Projekt verbunden ist. Solange kein Workspace verbunden ist, enthält der Abschnitt **Arbeitsbereich** der Menüs Vorfälle, Warnungen, Geplante Wartung, Monitore und Bereitschaft den Eintrag **Slack oder Teams verbinden**, der ebenfalls hierher führt.

### Ihr eigenes Slack-Konto verbinden

Beim Installieren der App wird das Konto der Person verknüpft, die sie installiert hat. Alle anderen verknüpfen ihr eigenes Slack-Konto unter **Benutzereinstellungen** > **Arbeitsbereich** > **Slack** mit **Connect my account with Slack**, um als sie selbst auf Vorfälle zu reagieren und Direktnachrichten zu erhalten. Dieser Abschnitt erscheint, sobald das Projekt mit Slack verbunden ist. Wie Sie ein ganzes Team auf einmal dazuholen, steht unter [Alle bitten, ihr Konto zu verbinden](#alle-bitten-ihr-konto-zu-verbinden).

### Eine Benachrichtigungsregel hinzufügen

Gehen Sie zu **Vorfälle** > **Arbeitsbereich** > **Slack**. Der Abschnitt **Arbeitsbereich** listet nur die Chat-Workspaces, die Ihr Projekt verbunden hat, daher erscheint **Slack** dort, sobald es verbunden ist. Legen Sie eine Regel an, zum Beispiel eine, die für jeden neuen Vorfall einen Slack-Kanal mit allen erstellt, die daran arbeiten: den alarmierten Personen, dem Vorfall-Kommandanten und den Eigentümern. Siehe [Benachrichtigungsregeln](#benachrichtigungsregeln).

### Die Regel testen

Klicken Sie in der Zeile der Regel auf **Regel testen**. In den Kanälen, die die Regel nennt, kommt eine Testnachricht an. Siehe [Eine Regel testen](#eine-regel-testen).
:::

## Alle bitten, ihr Konto zu verbinden

Niemand kann das Slack-Konto einer anderen Person verbinden, auch kein Admin: Jede Person meldet sich mit ihrem eigenen Konto an. Um ein ganzes Team dazuzuholen, bittet ein **Projektinhaber** oder **Projektadministrator** unter **Projekteinstellungen** > **Arbeitsbereich** > **Slack** alle auf einmal, ihr Konto zu verbinden. Die Karte **Members' Slack accounts** zeigt, wie viele Mitglieder ihr Konto schon verbunden haben. **Ask everyone to connect** schickt jedem Mitglied ohne verbundenes Konto eine Direktnachricht von OneUptime in Slack, mit einer Schaltfläche **Connect Slack account**, die sein Konto mit einem Klick verbindet.

- **Wer eine Nachricht bekommt.** Jedes Mitglied des Projekts, das sein Slack-Konto noch nicht verbunden hat und das OneUptime in Slack über seine E-Mail-Adresse findet. Wer in den letzten 24 Stunden gebeten wurde, wird nicht noch einmal gebeten; bitten Sie am nächsten Tag erneut, erinnert das also nur die, die ihr Konto noch immer nicht verbunden haben.
- **Was die Karte sagt.** Solange die Nachrichten verschickt werden, wie weit der Versand ist; danach, wer gebeten hat und wie viele Mitglieder eine Nachricht bekommen haben. Mitglieder, die OneUptime in Slack nicht über ihre E-Mail-Adresse finden konnte, nennt die Karte mit Namen: Diese verbinden ihr Konto selbst unter **Benutzereinstellungen** > **Arbeitsbereich** > **Slack**.
- **Was die Schaltfläche verbindet.** Das Slack-Konto der Person, die sie drückt und sich anmeldet, mit ihrem eigenen OneUptime-Konto. Eine an jemand anderen weitergeleitete Nachricht verbindet nichts mit dem Mitglied, an das sie geschickt wurde.

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
| **Bedingungen** | Für welche Ereignisse die Regel gilt, zum Beispiel nach Schweregrad, Status, Beschriftung, Monitor oder Wörtern im Titel. Sie werden geprüft, wenn ein Ereignis erstellt wird, und erneut bei jedem Update, das OneUptime dazu postet, sodass eine Regel für bestätigte Vorfälle greift, sobald ein Vorfall bestätigt wird. Eine neue Regel gilt für jedes Ereignis, etwa **Alle Vorfälle**. Um sie einzugrenzen, wählen Sie **Nur Vorfälle, die den Bedingungen entsprechen** und fügen die Bedingungen hinzu. Bei zwei oder mehr legt **Abgleichsbedingung** fest, ob alle zutreffen müssen oder eine genügt. |
| **Ziel** | Wohin sie postet: **In vorhandenen Kanälen posten** mit den Kanalnamen, **Einen Kanal für jeden Vorfall erstellen** (oder jede Warnung, Episode, jedes Ereignis, jeden Monitor oder jede Bereitschaftsrichtlinie) mit den Personen, die ihm beitreten, oder beides. Unter dem Schritt sagt **Was diese Regel tut** in Sätzen, was sie tut, wie die Karte der Regel. |
| **Videoanruf** | Nur Vorfälle und Warnungen: für jeden einen Anruf starten. Siehe [Videoanrufe](/docs/workspace-connections/video-calls). |

Ein Kanal, den die Regel anlegt, wird nach seinem Datensatz benannt: Vorfall INC-42 bekommt `inc-42`, Warnung ALT-7 bekommt `alt-7`, und in einem Projekt ohne Nummernpräfixe bekommt Vorfall 42 `incident-42`. Text in **Präfix für Kanalnamen** steht davor, aus `prod-` wird also `prod-inc-42`, und das Formular zeigt den Namen schon beim Tippen. Bei einem geplanten Wartungsereignis tritt das Präfix an die Stelle seines Nummernpräfixes: SM-5 bekommt `sm-5`, und aus `maint-` wird `maint-5`. Slack nimmt Kleinbuchstaben, Ziffern, `-` und `_`, bis zu 80 Zeichen. Gibt es schon einen Kanal mit diesem Namen, etwa den eines anderen Projekts oder einen archivierten, hängt OneUptime `-2`, `-3` und so weiter an.

Eine Regel erstellt ihren Kanal, wenn ein Ereignis zum ersten Mal auf sie zutrifft: beim Erstellen des Ereignisses oder später, wenn es durch ein Update zutrifft, solange es noch offen ist. Eine Regel für bestätigte Vorfälle erstellt den Kanal, sobald der Vorfall bestätigt wird. Ein privater Vorfall, eine private Warnung oder Episode bekommt einen privaten Kanal.

**Wer dem Kanal beitritt** listet, wen die Regel in ihren Kanal holt, jeweils sobald die Person zum Datensatz dazukommt, nicht nur beim Erstellen des Kanals: **Personen in Bereitschaft, sobald sie alarmiert werden**, **Vorfall-Kommandant und weitere Vorfallsrollen, sobald sie zugewiesen werden** (Vorfälle und Vorfallsepisoden) und **Eigentümer, sobald sie hinzugefügt werden**, bei einer neuen Regel alle angehakt, und die Personen, Teams und Bereitschaftspläne unter **Außerdem einladen** beim Erstellen des Kanals. Der Vorfall-Kommandant wird meist zugewiesen, wenn jemand den Vorfall zum ersten Mal bestätigt, und tritt dem Kanal dann bei. Eine Regel, die gespeichert wurde, bevor Vorfallsrollen ein eigenes Kästchen hatten, holt sie dazu, wenn sie die Eigentümer oder die Personen in Bereitschaft einlädt, und ihr Kästchen ist angehakt. Ein bestehender Kanal, in den eine Regel postet, bekommt niemanden.

Bei einem Bereitschaftsplan unter **Außerdem einladen** tritt bei, wer beim Erstellen des Kanals laut der Seite des Bereitschaftsplans darin Bereitschaft hat, ohne alarmiert zu werden. Um Personen nur zu den Kanälen bestimmter Vorfälle hinzuzufügen, geben Sie einer zweiten Regel diese Bedingungen und diese Personen, mit demselben **Präfix für Kanalnamen** wie die erste: Regeln, auf die ein Vorfall beim Erstellen seines Kanals zutrifft, teilen sich diesen Kanal, und jede fügt ihre eigenen Personen hinzu.

Jede spätere Änderung des Datensatzes — ein Statuswechsel, eine Notiz, ein neuer Eigentümer — wird in seinen Kanälen gepostet und in den bestehenden Kanälen, die seine Regeln nennen, solange deren Bedingungen zutreffen. Ist **Kanal archivieren, wenn der Vorfall behoben ist** an, oder sein Gegenstück für Warnungen, Episoden, Ereignisse, Monitore und Bereitschaftsrichtlinien, archiviert die Regel, die einen Kanal erstellt hat, ihn, wenn der Datensatz behoben, abgeschlossen oder gelöscht ist, egal was ihre Bedingungen dann sagen. Ein Vorfall, eine Warnung oder Episode, die bereits behoben erstellt wird, bekommt keinen eigenen Kanal; ihre Erstellungsnachricht geht trotzdem in die Kanäle, die Ihre Regeln nennen. Siehe [Bereits bestätigt oder behoben gemeldet](/docs/incidents/declaring-incidents#bereits-bestätigt-oder-behoben-gemeldet).

Ein Vorfall, eine Warnung, eine Episode oder ein geplantes Wartungsereignis mit einem eigenen Kanal hat im Kopf seiner Seite in OneUptime, neben den Statusschaltflächen, **In Slack öffnen**. Das öffnet diesen Kanal in einem neuen Tab, in der Slack-App oder im Browser. Ein Datensatz mit zwei eigenen Kanälen listet beide unter der Schaltfläche. Ein Datensatz mit Kanälen in Slack und in Microsoft Teams hat stattdessen eine Schaltfläche **Kanal öffnen**, die sie alle auflistet. Die bestehenden Kanäle, in die Ihre Regeln posten, werden nicht angeboten.

Ein Kanal bleibt lesbar: Jedes Ereignis wird einmal gepostet, und der erste Status eines Datensatzes steht in der Nachricht, die den Datensatz ankündigt, nicht in einer eigenen Nachricht. Ein Durchlauf einer Bereitschaftsrichtlinie ist eine einzige Nachricht, die bearbeitet wird, während der Durchlauf eskaliert: wer alarmiert wurde, wie oft und wie, wer nicht und warum, und wer bestätigt hat. Eine neue Nachricht wird nur gepostet, wenn jemand handeln muss: Eine Eskalationsregel hat niemanden erreicht, oder der Durchlauf endete, ohne dass jemand bestätigt hat. Wer sein Slack-Konto nicht mit OneUptime verbunden hat, wird über das Slack-Konto mit seiner E-Mail-Adresse hinzugefügt. Wer auf keinem der beiden Wege zu finden oder in Slack Gast ist, kann keinem Kanal hinzugefügt werden; OneUptime sagt das einmal pro Kanal, in einer einzigen Nachricht, die alle nennt und bearbeitet wird, wenn die Liste wächst. Schicken Sie ihnen den Link **Connect Slack account** aus dieser Nachricht, damit sie ihr Konto in einem Schritt verbinden. Dass die Eigentümer eines Datensatzes oder die Statusseiten-Abonnenten benachrichtigt wurden, steht in seinem Feed in OneUptime.

**Projekteinstellungen** > **Arbeitsbereich** > **Slack** listet die Kanäle, die OneUptime sieht, mit **Test senden** neben jedem. Einem öffentlichen Kanal tritt OneUptime beim ersten Posten selbst bei. Ein privater Kanal wird erst aufgelistet und kann erst bespielt werden, nachdem die OneUptime-App in Slack in ihn eingeladen wurde.

## Wer im Kanal eines Datensatzes ist

Ein Vorfall, eine Warnung, eine Episode oder ein geplantes Wartungsereignis mit einem eigenen Slack-Kanal hat auf seiner Seite in OneUptime eine Karte **Slack-Kanal**. Die Karte zeigt den Kanal als Link, der ihn in Slack öffnet, ob er privat ist und wer darin ist, Sie zuerst. Auf der Karte, ohne einen Slack-Admin:

- **Kanal beitreten** fügt Sie hinzu, wenn Sie nicht im Kanal sind.
- **Personen hinzufügen** öffnet eine Liste der Personen und Teams des Projekts: Wählen Sie eine Person, um sie hinzuzufügen, oder ein Team, um alle darin hinzuzufügen.

Die OneUptime-App fügt sie hinzu, so wie sie die Personen des Kanals einer Regel hinzufügt. Die App bleibt in den Kanälen, die sie erstellt, daher klappt das auch bei einem privaten Kanal, den alle verlassen haben.

- **Wer Personen hinzufügen darf.** Wer den Datensatz bearbeiten darf: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Vorfall-Administrator** und **Vorfall-Mitglied** bei einem Vorfall oder **Edit Incident** in einer benutzerdefinierten Rolle, und dieselbe Berechtigung bei einer Warnung, einer Episode oder einem Ereignis (zum Beispiel **Edit Alert**). Alle anderen sehen, wer im Kanal ist und wie sie hineinkommen.
- **Wer hinzugefügt werden kann.** Jemand, den OneUptime in Slack findet: über das Slack-Konto, das die Person verbunden hat, oder sonst über die E-Mail-Adresse, die Slack für sie hat. Die Karte nennt, wen sie nicht hinzufügen konnte, und warum, etwa einen Gast, den Slack aus dem Kanal heraushält.
- **Was festgehalten wird.** Wer hinzugefügt wurde und von wem, im Feed des Datensatzes (**Kanalmitglied hinzugefügt**) und unter **Projekteinstellungen** > **Benachrichtigungen** > **Benachrichtigungsprotokolle** auf der Registerkarte **Arbeitsbereich**.
- **Jemanden entfernen.** OneUptime fügt nur hinzu: Entfernen Sie jemanden in Slack aus dem Kanal.

## Eine Regel testen

**Regel testen** in der Zeile einer Regel postet eine Testnachricht für diese Regel in die Kanäle, die sie nennt, damit Sie sie ankommen sehen. Legt die Regel für jedes Ereignis einen Kanal an, legt auch der Test einen an und lädt die Personen der Regel ein.

Wie **Test senden** neben einem Kanal unter **Projekteinstellungen** > **Arbeitsbereich** > **Slack** braucht er die Berechtigung, Benachrichtigungsregeln anzulegen: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Einstellungs-Administrator**, **Einstellungs-Mitglied** oder **Create Workspace Notification Rule** und **Read Workspace Notification Rule** in einer benutzerdefinierten Rolle. Für jemanden, der die Regeln nur sehen kann, etwa ein **Betrachter**, ist **Regel testen** gesperrt, und sein Tooltip sagt, was es braucht; die API lehnt seinen Test mit "You do not have permission to send test notifications in this project." ab. In OneUptime Cloud braucht das Testen einer Regel den Tarif **Growth**, wie das Anlegen einer.

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
| 📢 Ein Megafon- oder Lautsprecher-Emoji | Eine öffentliche Notiz, die auf der Statusseite erscheint. Nur Vorfälle und geplante Wartungsereignisse. Bei einem privaten Vorfall eine private Notiz, und die Bestätigung sagt, warum. |

Die Notiz übernimmt die Nachricht so, wie Slack sie gezeigt hat: ihre Formatierung, Links und Code, die erwähnten Personen und Kanäle mit Namen und ihre Dateien und Bilder als Links darauf. Eine öffentliche Notiz lässt die Dateien und Bilder weg, da sie sich nur für Ihr Team öffnen.

Sie gibt die Worte dessen wieder, der die Nachricht geschrieben hat: mit seinem OneUptime-Namen, wenn sein Slack-Konto verbunden ist, sonst mit dem Namen, den Slack zeigt. Eine private Notiz wird in der Zeitleiste dort eingeordnet, wo die Nachricht gepostet wurde, egal wie viel später sie gespeichert wird. Eine öffentliche Notiz wird beim Speichern eingeordnet, also dann, wenn die Statusseite sie zeigt. Die Zeitleiste nennt, wer sie gespeichert hat. Die Notiz wird nicht zurück in den Kanal gepostet, in dem die Nachricht bereits steht.

Die Notiz wird als Sie gespeichert, mit Ihren Berechtigungen. Ist Ihr Slack-Konto noch nicht verbunden, bittet OneUptime Sie in einer Nachricht, die nur Sie sehen, es zu verbinden, mit einer Schaltfläche, die die Nachricht speichert, sobald Sie das getan haben. Eine Nachricht wird nur einmal gespeichert, egal wie viele Personen reagieren.

## Der Befehl /oneuptime

OneUptime hat in Slack einen einzigen Befehl, `/oneuptime`. Das Wort, das Sie danach schreiben, sagt, was zu tun ist; alles andere danach ist eine Frage an OneUptime AI.

| Befehl | Was er tut |
| --- | --- |
| `/oneuptime help` | Listet die Befehle auf, mit Beispielen. |
| `/oneuptime incident [title or number]` | Öffnet das Vorfallsformular, mit ausgefülltem Titel. Die Nummer eines Vorfalls, etwa `42` oder `INC-42`, zeigt stattdessen diesen Vorfall: siehe [Einen Vorfall aus Slack verwalten](#einen-vorfall-aus-slack-verwalten). |
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

In einem Slack-Workspace, der mit mehr als einem Projekt verbunden ist, zeigt die Startseite jeweils ein Projekt. Ist Ihr Slack-Konto in zwei oder mehr davon verbunden, listet das Menü **Switch project** neben dem Namen des Projekts die anderen auf, in denen Sie Mitglied sind. Wählen Sie eines, um seine Startseite zu sehen, und die Startseite öffnet sich von da an mit ihm, solange Sie dort noch Mitglied sind. Bis Sie eines wählen, zeigt sie dasjenige Ihrer Projekte, das zuerst mit Slack verbunden wurde.

Wenn jemand OneUptime zu einem Kanal hinzufügt, postet es dort eine Begrüßung: wie man ihm eine Frage stellt und wo man eine Benachrichtigungsregel hinzufügt, die in den Kanal postet. Wenn Sie den Tab **Messages** zum ersten Mal öffnen, heißt es Sie dort willkommen: was es in Slack tut und wie Sie anfangen.

## OneUptime AI aus Slack fragen

Fragen Sie in natürlicher Sprache nach Ihren Logs, Traces, Metriken, Vorfällen und Monitoren. Erwähnen Sie OneUptime in einem Kanal mit @ oder schicken Sie eine Direktnachricht, und die Antwort kommt im Thread. `/oneuptime ask which monitors are down?` postet seine Antwort im Kanal. Beides braucht Ihr verbundenes Slack-Konto und eingeschaltete KI für das Projekt. Antworten in Slack lesen nur: Um etwas zu ändern, nutzen Sie die Schaltflächen. Siehe [KI fragen](/docs/ai/ask-ai).

OneUptime antwortet nur auf das, was an OneUptime gerichtet ist.

- **In Ihrem eigenen Gespräch antworten Sie einfach.** Eine Frage, die Sie in einem Kanal stellen, nicht in einem Thread, beginnt ein Gespräch im Thread darunter: Antworten Sie dort, um weiterzufragen, ohne OneUptime erneut zu erwähnen; alle anderen steigen ein, indem sie OneUptime erwähnen.
- **In jedem anderen Thread erwähnen Sie OneUptime.** Unter der Nachricht eines Vorfalls zum Beispiel erwähnen Sie OneUptime jedes Mal: Was Personen dort einander schreiben, bekommt keine Antwort.
- **Wenn Ihr Slack-Konto nicht verbunden ist.** OneUptime bittet Sie einmal pro Gespräch, es zu verbinden, in einer Nachricht, die nur Sie sehen, mit einer Schaltfläche **Connect Slack account**.

## Vorfälle und Wartungen aus Slack erstellen

`/oneuptime incident` und `/oneuptime maintenance` öffnen ein Formular, das Sie als Sie selbst ausfüllen und absenden: als das OneUptime-Konto, mit dem Ihr Slack-Konto verbunden ist (siehe [Slack verbinden](#slack-verbinden)), mit dessen Berechtigungen im Projekt. Ist Ihr Slack-Konto nicht verbunden oder Ihr OneUptime-Konto kein Mitglied des Projekts mehr, sagt Ihnen OneUptime dort, wo Sie den Befehl ausgeführt haben, in einer Nachricht, die nur Sie sehen, was zu tun ist, und es öffnet sich kein Formular. Die Verknüpfungen **Create New Incident** und **Create Scheduled Event** öffnen dieselben Formulare.

- **Wer sie nutzen darf.** Die Personen, die in OneUptime einen Vorfall melden oder ein geplantes Wartungsereignis anlegen dürfen: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Vorfall-Administrator** und **Vorfall-Mitglied** für einen Vorfall (**Create Incident** in einer benutzerdefinierten Rolle), und **Wartungs-Administrator** und **Wartungs-Mitglied** für ein Ereignis (**Create Scheduled Maintenance**). Alle anderen erfahren das dort, wo sie ihn ausgeführt haben, und es öffnet sich kein Formular.
- **Was ein Formular anbietet.** Jede Liste — Schweregrade, Monitore, Monitorstatus, Bereitschaftsrichtlinien und Beschriftungen — enthält, was Sie lesen dürfen, wie dieselbe Liste in OneUptime: bei einer auf einige Beschriftungen beschränkten Rolle die Monitore und Bereitschaftsrichtlinien mit diesen Beschriftungen. Eine Liste, die Sie gar nicht lesen dürfen, fehlt im Formular. Archivierte Bereitschaftsrichtlinien werden nie angeboten.
- **Was ein Formular nennen darf.** Der Vorfall oder das Ereignis wird mit Ihren eigenen Berechtigungen erstellt und Ihnen zugeschrieben. Ein Monitor, eine Bereitschaftsrichtlinie, eine Beschriftung, ein Schweregrad oder Status, den Sie nicht lesen dürfen, oder einer eines anderen Projekts, wird abgelehnt wie einer, den das Projekt nicht hat, auch aus einem Formular, das vor der Änderung Ihres Zugriffs geöffnet wurde, und es wird nichts erstellt. OneUptime sagt Ihnen im Kanal, in einer Nachricht, die nur Sie sehen, warum.

**Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode funktioniert genauso: Es braucht die Berechtigung, eine Bereitschaftsrichtlinie auszuführen (**Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Bereitschafts-Administrator** und **Bereitschafts-Mitglied**, oder **Create On-Call Duty Policy Execution Log** in einer benutzerdefinierten Rolle) und diesen Vorfall, diese Warnung oder Episode zu lesen, und bietet die aktiven Bereitschaftsrichtlinien an, die Sie lesen dürfen.

## Jemanden aus Slack alarmieren

`/oneuptime page @nawaz The checkout API is throwing 500s` alarmiert Nawaz sofort. Er bekommt einen Anruf, eine SMS, eine Push-Benachrichtigung oder eine E-Mail, wie es seine eigenen Bereitschaftsregeln vorsehen, und jede davon sagt ihm, wer ihn alarmiert hat, über welches Team oder welchen Bereitschaftsplan, und Ihre Nachricht. Wo Sie den Befehl ausführen, entscheidet, worum es bei der Alarmierung geht:

- **Im eigenen Kanal eines Vorfalls oder einer Warnung**, dem Kanal, den OneUptime dafür erstellt hat, geht es bei der Alarmierung um diesen Vorfall oder diese Warnung, und nichts Neues wird erstellt. Eine Nachricht ist dort optional: `/oneuptime page @nawaz` genügt. Die Personen, die Sie alarmieren, werden alarmiert, bis eine von ihnen antwortet, über die Alarmierung selbst oder indem sie den Vorfall oder die Warnung bestätigt; bestätigt jemand anderes, beendet das die Alarmierung nicht, ein Beheben schon.
- **Überall sonst**, etwa in einem anderen Kanal, einer Direktnachricht, auf dem Tab **Home** der App oder im Kanal eines behobenen Vorfalls oder einer behobenen Warnung, erstellt OneUptime eine Warnung mit Ihrer Nachricht als Titel und alarmiert, bis jemand die Warnung bestätigt. Das Formular sagt das, und ebenso die Antwort, die nur Sie sehen, bevor jemand alarmiert wird.
- **Wer sofort alarmiert wird.** Die Personen, die Sie mit @ erwähnen, und alle, die in den Bereitschaftsplänen Bereitschaft haben, denen eine von Ihnen mit @ erwähnte Benutzergruppe folgt (siehe [Bereitschafts-Benutzergruppen](#bereitschafts-benutzergruppen)), wenn eine Nachricht auf sie folgt, oder ohne Nachricht im eigenen Kanal eines Vorfalls oder einer Warnung. OneUptime erkennt eine Person am OneUptime-Konto, mit dem ihr Slack-Konto verbunden ist, oder sonst an der E-Mail-Adresse, die Slack für sie hat. Niemand außerhalb des Projekts wird alarmiert.
- **Alles andere öffnet ein Formular.** Ohne Erwähnung mit @, ohne Nachricht, wo die Alarmierung eine braucht, mit `@here`, mit einer Benutzergruppe, die keinem für Sie sichtbaren Bereitschaftsplan folgt, oder mit einer Person, die OneUptime nicht erkennt, öffnet sich das Formular **Page someone** mit dem, was Sie geschrieben haben, und nennt, wen es nicht auswählen konnte. Im eigenen Kanal eines Vorfalls oder einer Warnung öffnet es sich mit diesem Vorfall oder dieser Warnung. Wählen Sie Personen, ein Team, einen Bereitschaftsplan, der alarmiert, wer darin gerade Bereitschaft hat, oder eine Bereitschaftsrichtlinie, die über ihre Eskalationsregeln alarmiert, und senden Sie es ab. Ein Name, den Sie zuerst schreiben, wie in `/oneuptime page Primary The disk is full`, wählt den Bereitschaftsplan, das Team oder die Richtlinie mit diesem Namen.
- **Wo es erscheint.** Der Kanal zeigt die Alarmierung als eine Nachricht, die aktuell gehalten wird: wer alarmiert wurde und wie, jedes Team mit seinem Namen und seinen Personen danach, Ihre Nachricht und wer bestätigt hat. Wo OneUptime nicht posten kann, etwa in einem privaten Kanal, in den es nicht eingeladen wurde, nennt eine Nachricht, die nur Sie sehen, wer alarmiert wurde, mit einem Link zum Vorfall oder zur Warnung.
- **Wer alarmieren darf.** Im eigenen Kanal eines Vorfalls oder einer Warnung alle, die eine Bereitschaftsrichtlinie ausführen dürfen (**Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Bereitschafts-Administrator** und **Bereitschafts-Mitglied**, oder **Create On-Call Duty Policy Execution Log** in einer benutzerdefinierten Rolle) und diesen Vorfall oder diese Warnung lesen dürfen. Überall sonst erstellt die Alarmierung eine Warnung und braucht deshalb auch die Berechtigung, eine zu erstellen: **Projektinhaber**, **Projektadministrator** und **Projektmitglied**, oder **Bereitschafts-Mitglied** zusammen mit **Warnungs-Mitglied** (**Create On-Call Duty Policy Execution Log** und **Create Alert** in einer benutzerdefinierten Rolle). Personen, ein Team oder einen Bereitschaftsplan direkt zu alarmieren, ohne Bereitschaftsrichtlinie dahinter, braucht zusätzlich Zugriff auf alle Bereitschaftsrichtlinien des Projekts. Alle anderen erfahren das dort, wo sie den Befehl ausgeführt haben, und niemand wird alarmiert. In OneUptime Cloud braucht das Alarmieren den Growth-Tarif: darunter nennt OneUptime den nötigen Tarif, und niemand wird alarmiert.

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
- **Wer eine verbinden darf.** Die Rollen, die Bereitschaftspläne bearbeiten dürfen: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Bereitschafts-Administrator** und **Bereitschafts-Mitglied**, oder **Edit On-Call Duty Policy Schedule** in einer benutzerdefinierten Rolle. In OneUptime Cloud braucht das Verbinden den Tarif **Growth**.
- **Trennen.** OneUptime ändert die Gruppe nicht mehr. Die Gruppe und ihre Mitglieder bleiben in Slack, wie sie sind.

## Einen Vorfall aus Slack verwalten

Die Nachricht eines Vorfalls hat vier Schaltflächen, **Acknowledge Incident**, **Resolve Incident**, **Add Note** und **View Incident**, und den Rest in ihrem Menü, der Schaltfläche mit drei Punkten dahinter:

| Menüpunkt | Was er tut |
| --- | --- |
| **Change Severity** | Legt den Schweregrad des Vorfalls fest. |
| **Change Incident State** | Versetzt den Vorfall in einen späteren Status. |
| **Assign Role** | Gibt jemandem eine Rolle im Vorfall, etwa **Incident Commander**. Eine Rolle für nur eine Person geht an diese Person über. |
| **Page Someone** | Alarmiert Personen, ein Team, wer in einem Bereitschaftsplan gerade Bereitschaft hat, oder eine Bereitschaftsrichtlinie zu dem Vorfall, mit einer optionalen Nachricht. Personen werden alarmiert, bis eine von ihnen antwortet; eine Richtlinie alarmiert, bis jemand den Vorfall bestätigt. |
| **Edit Custom Fields** | Setzt die benutzerdefinierten Felder des Vorfalls, jedes ausgefüllt mit dem, was der Vorfall enthält. Ein leer gelassenes Feld wird geleert. |

`/oneuptime incident 42` zeigt Vorfall 42, mit diesen Schaltflächen und seinem Menü, in einer Nachricht, die nur Sie sehen. Schreiben Sie die Nummer so, wie OneUptime sie zeigt: `42`, `#42` oder `INC-42`. Im eigenen Kanal eines Vorfalls zeigt `/oneuptime incident` allein diesen Vorfall.

- **Wer sie nutzen darf.** Die Personen, die dieselbe Änderung in OneUptime vornehmen dürfen. **Change Severity** und **Edit Custom Fields** brauchen die Berechtigung, den Vorfall zu bearbeiten: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Vorfall-Administrator** und **Vorfall-Mitglied**, oder **Edit Incident** in einer benutzerdefinierten Rolle. **Assign Role** braucht **Create Incident Member**, und **Delete Incident Member**, um eine Rolle für nur eine Person zu übertragen. **Page Someone** braucht, was **Execute On-Call Policy** braucht. Alle anderen erfahren, warum, und es öffnet sich kein Formular.
- **Was die Formulare anbieten.** Was Sie im Projekt lesen dürfen. Ein benutzerdefiniertes Feld, das vom Monitor des Vorfalls übernommen wird, fehlt, da es erneut übernommen würde, und ein Formular fasst 40 Felder: Bearbeiten Sie den Rest in OneUptime.
- **Was dann passiert.** Das Formular schließt sich, und die Änderung wird als Sie vorgenommen, wie in OneUptime: Der Feed des Vorfalls und mit ihm die Kanäle des Vorfalls sagen, was sich geändert hat, jedes benutzerdefinierte Feld mit seinem neuen Wert. Ein Wert, der nicht zu seinem Feld passt, etwa Text für eine Zahl, wird unter dem Feld genannt, und das Formular bleibt offen. **Page Someone** sagt, wer alarmiert wurde oder warum niemand; ein bereits behobener Vorfall alarmiert niemanden.
- **Nachrichten von vor dem Menü.** Sie behalten ihre Schaltfläche **Execute On-Call Policy**, und sie funktioniert weiter: **Page Someone** alarmiert auch eine Bereitschaftsrichtlinie. Warnungen und Episoden behalten ihre.

## Aus Slack auf Vorfälle, Warnungen und Ereignisse reagieren

Auch die Schaltflächen in den Slack-Nachrichten von OneUptime handeln als Sie: als das OneUptime-Konto, mit dem Ihr Slack-Konto verbunden ist, mit dessen Berechtigungen im Projekt. **Acknowledge**, **Resolve**, **Change State**, **Add Note** und **Execute On-Call Policy** an einem Vorfall, einer Warnung oder Episode, und **Mark as Ongoing**, **Mark as Complete**, **Change State** und **Add Note** an einem geplanten Wartungsereignis nehmen jeweils die Änderung vor, die dieselbe Aktion in OneUptime vornimmt, und sie wird Ihnen dort zugeschrieben: Status-Zeitleiste und Feed des Datensatzes zeigen, dass Sie seinen Status geändert haben, und die Notiz ist Ihre. Eine Notiz, die aus einer Nachricht mit einer Emoji-Reaktion gespeichert wird, wird genauso gepostet.

- **Wer sie nutzen darf.** Die Personen, die dieselbe Änderung in OneUptime vornehmen dürfen. Einen Vorfall zu bestätigen, zu beheben oder seinen Status zu ändern braucht die Berechtigung, seinen Status zu ändern: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Vorfall-Administrator** und **Vorfall-Mitglied**, oder **Create Incident State Timeline** in einer benutzerdefinierten Rolle. Eine Warnung, eine Episode oder ein geplantes Wartungsereignis braucht dieselbe Berechtigung für die eigene Art (zum Beispiel **Create Alert State Timeline**), und eine Notiz braucht die Berechtigung, diese Art von Notiz zu posten. Alle anderen erfahren das, und es ändert sich nichts.
- **Welche Datensätze.** Die, die Sie lesen dürfen, wie in OneUptime: bei einer auf einige Beschriftungen beschränkten Rolle die Vorfälle, Warnungen, Episoden und Ereignisse mit diesen Beschriftungen. Eine Schaltfläche an jedem anderen Datensatz sagt, warum, und es ändert sich nichts: an einem Vorfall, den Ihre Rolle nicht erreicht, "your access in this project does not include this incident. Ask a project admin for access to it."; an einem privaten Vorfall, zu dessen Eigentümern Sie nicht gehören, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; und an einem inzwischen gelöschten "the incident was not found. It may have been deleted." In OneUptime Cloud wird eine Änderung, die der Tarif des Projekts nicht enthält, mit dem nötigen Tarif abgelehnt.
- **Was Change State anbietet.** Die Status, die Sie lesen dürfen und in die der Datensatz als Nächstes wechseln darf, in der Reihenfolge des Projekts: keiner vor dem Status, in dem er ist, bei einer Episode wie bei einem Vorfall, einer Warnung oder einem geplanten Wartungsereignis, denn ein Statuswechsel bewegt einen Datensatz nie in seiner Liste zurück nach oben (siehe [Die Reihenfolge ist eine echte Einschränkung, keine Anzeigevorliebe](/docs/incidents/states-and-severities#die-reihenfolge-ist-eine-echte-einschränkung-keine-anzeigevorliebe)). Dürfen Sie keinen lesen, heißt es "No incident states are available to you in this project. Ask a project admin for access to them."; ist der Datensatz im letzten Status, den er erreichen kann, heißt es "There is no later state to move this incident to." Keins von beiden öffnet ein leeres Formular.
- **Add Note bei einem privaten Vorfall oder einer privaten Episode.** Ein privater Vorfall oder eine private Episode erhält keine öffentlichen Notizen, daher fragt das Formular nach keinem Notiztyp und fügt eine private Notiz hinzu. Ein Formular, das geöffnet wurde, bevor der Vorfall oder die Episode privat wurde, fügt ebenfalls eine private Notiz hinzu und sagt das. Siehe [Private Vorfälle erhalten nur private Notizen](/docs/incidents/notes-owners-and-feed#private-vorfälle-erhalten-nur-private-notizen).
- **Wo Sie die Antwort bekommen.** Unter der Nachricht mit der Schaltfläche, in einer Nachricht, die nur Sie sehen; per Direktnachricht nur, wenn Slack das ablehnt. Eine zu spät gedrückte Schaltfläche sagt, wer zuerst da war und wann, etwa "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Wenn Ihr Slack-Konto nicht verbunden ist.** Die Antwort bittet Sie, es zu verbinden, mit einer Schaltfläche **Connect Slack account**. Sie öffnet Ihre eigenen Slack-Einstellungen in OneUptime und verbindet Ihr Konto in einem Schritt, nachdem Sie sich bei Bedarf bei OneUptime angemeldet haben. Danach erledigt OneUptime, was Sie gedrückt haben, als Sie, und antwortet unter derselben Nachricht; bei einer Schaltfläche, die ein Formular öffnet, oder bei einem Befehl bittet es Sie, sie erneut zu drücken oder ihn erneut auszuführen. Die Schaltfläche funktioniert einmal, 30 Minuten lang, und nur für das Slack-Konto, das sie gedrückt hat: Angemeldet bei Slack als jemand anderes, verbindet sie nichts.

## Trennen

- **Trennen** trennt nur Ihr eigenes Slack-Konto und entfernt damit Ihre Slack-Benachrichtigungsmethode.
- **OneUptime aus Slack deinstallieren** unter **Projekteinstellungen** > **Arbeitsbereich** > **Slack** trennt das Projekt. OneUptime postet nicht mehr in Slack, und die Menüs **Arbeitsbereich** listen es nicht mehr. Die Benachrichtigungsregeln und Zusammenfassungen bleiben für eine spätere neue Verbindung erhalten.

> [!WARNING]
> Das Deinstallieren trennt auch das eigene Slack-Konto jedes Mitglieds im Projekt und entfernt die Slack-Benachrichtigungsmethoden und die Bereitschaftsregeln, die sie nutzten. Wer in Slack alarmiert wurde, wird über seine anderen Benachrichtigungsmethoden alarmiert, bis er Slack wieder hinzufügt.

## Ihre Slack-Daten

OneUptime liest aus Slack nur, was diese Funktionen brauchen, mit den Berechtigungen, die Sie bei der Installation erteilen:

- **Nachrichten an OneUptime.** Eine Nachricht, die es mit @ erwähnt, eine, die Sie ihm als Direktnachricht schicken, und Ihre Antworten in einem Gespräch mit ihm, samt den früheren Nachrichten dieses Threads oder dieser Direktnachrichten, damit OneUptime AI antworten kann. Slack schickt ihm auch die übrigen Nachrichten der Kanäle und Gruppen-Direktnachrichten, in denen es ist; OneUptime beantwortet sie nicht und behält sie nicht.
- **Nachrichten, die Sie als Notiz speichern.** Eine Nachricht, auf die Sie mit 📌 oder 📢 reagieren oder die Sie anheften, im Kanal eines Vorfalls, einer Warnung, einer Episode oder eines geplanten Wartungsereignisses, als Notiz an diesem Datensatz gespeichert, mit dem Namen ihres Verfassers.
- **Namen von Kanälen und Personen.** Die Kanäle, in die es posten kann, damit Sie sie auswählen können, die Namen von Personen, um zu zeigen, wer etwas geschrieben oder getan hat, und wer im eigenen Kanal eines Datensatzes ist, gelesen, wenn die Seite des Datensatzes es zeigt.
- **E-Mail-Adressen.** Die E-Mail-Adresse, die Slack für eine Person hat, um ihr Slack-Konto ihrem OneUptime-Konto zuzuordnen, wenn sie es nicht verbunden hat: um sie zu alarmieren, in eine Bereitschafts-Benutzergruppe aufzunehmen, dem Kanal eines Datensatzes hinzuzufügen oder sie zu bitten, es zu verbinden.
- **Benutzergruppen.** Die Benutzergruppen Ihres Arbeitsbereichs, um eine für einen Bereitschaftsplan auszuwählen, und die Personen in einer Gruppe, die Sie verbinden, um sie gleich denen zu halten, die gerade Bereitschaft haben.

Was OneUptime davon behält — den Namen des Arbeitsbereichs, seine Kanäle, die Slack-Konten, die Personen verbinden, die Notizen und die Benutzergruppen —, wird mit Ihrem Projekt gespeichert. Die [Datenschutzerklärung](https://oneuptime.com/legal/privacy) beschreibt, wie OneUptime mit Ihren Daten umgeht.

## Fehlerbehebung

:::details Eine Regel postet nichts
Prüfen Sie die Bedingungen der Regel mit **Regel testen**: Kommt der Test an, haben die Bedingungen der Regel nicht auf das Ereignis gepasst. Kommt er nicht an, zeigt die Slack-Seite, warum. Laden Sie die OneUptime-App bei einem privaten Kanal zuerst in Slack in den Kanal ein. Jede Nachricht, die OneUptime postet, und jede, die Slack abgelehnt hat, steht unter **Projekteinstellungen** > **Benachrichtigungen** > **Benachrichtigungsprotokolle** auf der Registerkarte **Arbeitsbereich**.
:::

:::details Jemand fehlt im Kanal einer Regel
Die Karte der Regel sagt unter **Dann**, wen die Regel einlädt. Jede Art von Person tritt bei, sobald sie zum Datensatz dazukommt: die alarmierten Personen bei ihrer Alarmierung, der Vorfall-Kommandant bei seiner Zuweisung, ein Eigentümer beim Hinzufügen, und wer beim Erstellen des Kanals schon am Datensatz war. Findet OneUptime jemanden in Slack weder über das verbundene Konto noch über die E-Mail-Adresse, kann diese Person nicht hinzugefügt werden; OneUptime nennt sie im Kanal, mit einem Link, um ihr Konto zu verbinden. Um jemanden sofort hinzuzufügen, drücken Sie **Personen hinzufügen** auf der Karte **Slack-Kanal** des Datensatzes.
:::

:::details Alle haben einen privaten Kanal verlassen
Öffnen Sie den Vorfall, die Warnung, die Episode oder das Ereignis in OneUptime und drücken Sie **Kanal beitreten** auf seiner Karte **Slack-Kanal**, dann **Personen hinzufügen**, um die anderen zurückzuholen. Das braucht die Berechtigung, den Datensatz zu bearbeiten, keinen Slack-Admin: Die OneUptime-App ist noch im Kanal und fügt sie hinzu. Sagt die Karte, dass OneUptime den Kanal nicht sehen kann, wurde der Kanal gelöscht oder die App daraus entfernt: Jemand im Kanal kann die App wieder hinzufügen, indem er `/invite @OneUptime` eingibt.
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
