# Kalender-Feeds

Kalender-Feeds bringen Ihre Bereitschaftsschichten in den Kalender, den Sie ohnehin täglich nutzen. OneUptime veröffentlicht für jede Person, jeden Plan und jedes Projekt einen geheimen iCalendar-Link (`.ics`); Google Kalender, Outlook, Apple Kalender, Thunderbird und jede andere App, die einen Kalender per URL abonnieren kann, ruft diesen Link regelmäßig ab und zeigt pro Schicht einen Termin. Es wird nichts installiert und kein Konto verbunden: Der Link ist die gesamte Integration.

```mermaid title="Kalender-Apps rufen einen geheimen Link ab, manche von ihren eigenen Servern"
flowchart TB
    subgraph links["Geheime .ics-Links"]
        direction LR
        personal["Persönlicher Feed"]
        schedule["Plan-Feed"]
        project["Projekt-Feed"]
    end
    shifts["Pläne, Rotationen<br/>und Vertretungen"] --> links
    links -->|"von ihren Servern abgerufen"| serverApps["Google Kalender, Outlook im Web"]
    links -->|"von Ihrem Gerät abgerufen"| deviceApps["Apple Kalender, Thunderbird, klassisches Outlook"]
```

> [!NOTE]
> Ein abonnierter Kalender dient der **Planung**. Kalender-Apps rufen Feeds nach ihrem eigenen Rhythmus ab — Google Kalender nur alle 8 bis 24 Stunden —, deshalb erreicht Sie ein Tausch eine Stunde vor Schichtbeginn über die eigenen Erinnerungen, Neuzuweisungs-Hinweise und Alarmierungen von OneUptime, nicht über den Kalender.

## Was Sie bekommen

- Ein Termin pro Schicht mit dem Titel `On-call · <Schedule>` (mit angehängtem ` · <Policy>`, wenn der Plan genau einer Eskalationsrichtlinie zugeordnet ist) im persönlichen Feed und `<Name> · On-call · <Schedule>` in einem geteilten Feed. Die Beschreibung nennt, wer Bereitschaft hat, den Plan und seine Zeitzone, die Ebene, die Schicht in der Zeitzone des Plans, in UTC und in Ihrer Zeitzone, über welche Eskalationsrichtlinien Sie über diesen Plan alarmiert werden, sowie einen Link zum Plan im Dashboard.
- Vertretungen werden berücksichtigt. Wenn jemand für Sie einspringt, wandert der Termin zu dieser Person (`(covering for <Name>)` wird angehängt) und bleibt in Ihrer Kalender-App derselbe Termin, sodass er an Ort und Stelle aktualisiert statt dupliziert wird. Eine teilweise Vertretung teilt die Schicht in aneinander anschließende Termine.
- Standardmäßig zwei Tage Rückschau und 90 Tage Vorschau. Sie können das auf 60 Tage zurück und 180 Tage voraus ausweiten; ein Feed, der 5.000 Termine überschreiten würde, wird gekürzt und weist in seiner Kalenderbeschreibung darauf hin.
- Termine sind als frei markiert (`TRANSP:TRANSPARENT`), ein abonnierter Feed blockiert also nie Ihre Verfügbarkeit, und nichts ist als privat markiert, sodass ein geteilter Teamkalender allen, die ihn sehen, die Titel zeigt.
- Zeiten werden in UTC gesendet und von Ihrer Kalender-App umgerechnet; die Beschreibung nennt die Uhrzeit in der Zeitzone des Plans und in Ihrer. Ihre eigene Zeitzone stellen Sie als **Zeitzone** in Ihrem **Profil** ein (Ihr Bild oben rechts im Dashboard), die des Plans in der Karte **Zeitzone des Zeitplans** auf seiner Seite **Ebenen**. Ein Plan ohne Zeitzone wird in der Zeitzone des Servers berechnet, genau wie beim Alarmieren, und der Termin weist darauf hin.

Feste Zuweisungen — ein Benutzer oder ein Team, das direkt in einer Regel einer Eskalationsrichtlinie steht — haben keinen Anfang und kein Ende und erscheinen in keinem Feed. In OneUptime Cloud folgen Feeds demselben Tarif wie Bereitschaftspläne (Growth); ein Projekt unterhalb dieses Tarifs erhält einen leeren Kalender statt eines Fehlers.

## Drei Arten von Links

| Link | Wer ihn erstellt | Was er enthält | Wo |
| --- | --- | --- | --- |
| **Persönlicher Feed** | Jeder Benutzer, einer pro Projekt | Ihre Schichten in allen Plänen des Projekts, plus die Schichten, in denen Sie jemanden vertreten (optional) | **Benutzereinstellungen** > **Kalender** > **Kalender-Feed** |
| **Plan-Feed** | Jeder, der den Plan bearbeiten darf; jeder mit Leserecht darf den Link kopieren | Die Schichten aller in einem Plan, optional mit Terminen für Abdeckungslücken | Die Seite des Plans, Karte **Diesen Dienstplan abonnieren** |
| **Projekt-Feed** | Jeder, der Bereitschaftspläne bearbeiten darf; jeder mit Leserecht darf den Link kopieren | Die Schichten aller in allen Plänen des Projekts, optional mit Terminen für Abdeckungslücken | **Bereitschaftsdienst** > **Kalender-Feeds** |

Die Links sehen so aus:

```text
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

> [!WARNING]
> Das 43 Zeichen lange Token im Pfad ist das einzige Zugangsmerkmal — es gibt keine Anmeldung, kein Cookie und keinen API-Schlüssel. Behandeln Sie jeden dieser Links wie ein Passwort.

## Ihr persönlicher Feed

Persönliche Feeds gelten pro Projekt: Ein zweites Projekt bekommt einen zweiten Link und einen zweiten Kalender.

:::steps
### Ihren Kalender-Feed öffnen

Öffnen Sie **Benutzereinstellungen** > **Kalender** > **Kalender-Feed** in dem Projekt, dessen Schichten Sie möchten. **Kalender** ist ein Abschnitt des Seitenmenüs, der eingeklappt beginnt.

### Den Link erzeugen

Klicken Sie auf **Kalenderlink erzeugen**. Die Karte **Ihre Bereitschaftsschichten abonnieren** bietet nun einen einzigen Ablauf zum Abonnieren:

- **Zu Ihrem Kalender hinzufügen**: **Google Kalender** öffnet Google Kalender, der fragt, ob der Kalender hinzugefügt werden soll. **Apple Kalender / Outlook** öffnet die `webcal://`-Form des Links in der App, mit der Ihr Computer oder Telefon abonniert: Apple Kalender auf Mac, iPhone oder iPad, Outlook unter Windows.
- **Oder Link kopieren**: **Link kopieren** kopiert den `https://`-Link für jede andere App, die einen Kalender per URL abonnieren kann. Der Link bleibt auf der Seite verborgen, bis Sie ihn per Klick einblenden.

### Den Link abonnieren

Folgen Sie den Schritten für Ihre App unter „In Ihrer Kalender-App abonnieren“ weiter unten. Ihre Schichten erscheinen als Termine, sobald die App den Link das nächste Mal abruft: siehe „Wie oft Kalender aktualisieren“.
:::

### Einstellungen des Kalender-Feeds

Klicken Sie auf der Karte **Kalender-Feed-Einstellungen** auf **Einstellungen bearbeiten**, um zu ändern, was der Link enthält:

| Einstellung | Was sie bewirkt |
| --- | --- |
| **Schichten einschließen, die ich für andere übernehme** | Standardmäßig an. Ergänzt die Schichten, die Ihnen eine Vertretung in Plänen gibt, deren Mitglied Sie sonst nicht sind. |
| **Tage vergangener Schichten** | Wie weit der Kalender zurückreicht (Standard 2, höchstens 60). |
| **Tage im Voraus** | Wie weit der Kalender vorausreicht (Standard 90, zwischen 7 und 180). |

Die Statuszeile zeigt, wann der Link zuletzt abgerufen wurde, von welcher Kalender-App, wie oft, und die letzten vier Zeichen des Tokens, damit Sie Links unterscheiden können. Wurde der Link nach zwei Tagen von nichts abgerufen, fragt die Seite, ob der Server aus dem Internet erreichbar ist (siehe Fehlerbehebung).

### Den Link verwalten

| Aktion | Was passiert |
| --- | --- |
| **Link neu erzeugen** | Erstellt ein neues Token. Jede App, die den alten Link abonniert hat, wird nicht mehr aktualisiert: 30 Tage lang liefert der alte Link einen leeren Kalender, damit diese Apps ihre Kopie leeren, danach antwortet er mit 404. Abonnieren Sie den neuen Link erneut. |
| **Deaktivieren** | Behält den Link, liefert aber einen leeren Kalender, bis Sie ihn wieder aktivieren. |
| **Löschen** | Entfernt den Link. Apps, die ihn weiter abrufen, erhalten 404 und zeigen weiterhin, was sie zuletzt geladen haben — deaktivieren Sie zuerst, wenn sie sich leeren sollen. |

### Bevorstehende Schichten und Vertretung

Die Seite listet außerdem Ihre **Bevorstehende Schichten** (die nächsten 30 Tage) und die weiter unten beschriebene Karte **Vor Schichten erinnern**. Jede Ihrer eigenen Schichten hat einen Link **Vertretung finden**: Er öffnet die Benutzervertretungen im Projekt der Schicht mit einer neuen, für diese Schicht vorausgefüllten Vertretung, Sie als **Wer ist abwesend?** und die Zeiten der Schicht als **Beginnt** und **Endet** (ab jetzt, falls die Schicht schon begonnen hat), sodass nur noch **Wer vertritt?** fehlt. Die Vertretung leitet in dieser Zeit alle Ihre Alarmierungen aus jeder Bereitschaftsrichtlinie an die vertretende Person weiter; eine Schicht, die nur innerhalb einer Richtlinie existiert, wird stattdessen auf der Seite für Benutzervertretungen dieser Richtlinie vertreten. Eine Schicht, in der Sie selbst jemanden vertreten, hat kein **Vertretung finden**: Vertretungen verketten sich nicht, eine Vertretung der Vertretung würde also nichts ändern.

Derselbe persönliche Link, mit `?schedule=<id>` auf einen Plan gefiltert, wird auf der Seite jedes Plans als **Nur meine Schichten in diesem Dienstplan** angeboten, und das Bereitschaftsbanner sowie die Seite **Meine Bereitschaftsrichtlinien** enthalten einen Link **Ihre Schichten in Ihren Kalender übernehmen** zur Seite oben.

### In der Mobil-App

In der Mobil-App: **On-Call** > **Add shifts to my calendar** (auch unter **Settings** > **Calendar feed**), mit einem Link pro Projekt. Auf dem iPhone öffnet **Open in Calendar** das native Abonnieren-Blatt. Unter Android gibt es keine Möglichkeit, eine URL auf dem Telefon zu abonnieren; der Bildschirm bietet deshalb **Share link** und **Copy https link** und bittet Sie, den Link auf einem Computer hinzuzufügen, wonach er auf das Telefon synchronisiert wird. Die Liste **Your shifts** in der App stammt aus denselben Daten und hat dieselbe Aktion **Get cover**.

## In Ihrer Kalender-App abonnieren

Verwenden Sie in OneUptime **Google Kalender** oder **Apple Kalender / Outlook**, wenn Ihre App eine Schaltfläche hat; jede andere App nimmt den `https://`-Link, den Ihnen **Link kopieren** gibt. „https- und webcal-Links“ weiter unten erklärt die beiden Formen.

:::tabs
@tab Google Kalender
1. Klicken Sie in OneUptime auf **Google Kalender**. Google Kalender öffnet sich und fragt, ob der Kalender hinzugefügt werden soll; klicken Sie auf **Hinzufügen**.
2. Oder klicken Sie in Google Kalender im Web neben **Weitere Kalender** auf **+** > **Per URL**, fügen Sie den Link ein (**Link kopieren** in OneUptime) und klicken Sie auf **Kalender hinzufügen**.

Die Schaltfläche **Google Kalender** öffnet Googles Seite zum Hinzufügen per URL, `https://calendar.google.com/calendar/r?cid=` gefolgt von der `webcal://`-Form des Links, prozentkodiert. Diese Seite nimmt nur die `webcal://`-Form: Steht dort die `https://`-Form, antwortet Google mit „Unable to add calendar. Check the URL.“ **Per URL** nimmt beide Formen.

Google ruft den Feed **von Googles Servern** ab, der OneUptime-Server muss also aus dem Internet erreichbar sein — OneUptime Cloud ist es immer; für eine selbst gehostete Installation siehe Fehlerbehebung. Der erste Abruf erfolgt meist wenige Minuten nach dem Abonnieren; danach aktualisiert Google etwa alle 8 bis 24 Stunden, manchmal seltener. Es gibt keine Aktualisieren-Schaltfläche für abonnierte Kalender, und Google ignoriert die Aktualisierungshinweise im Feed. Die Statuszeile der Feed-Seite zeigt **Zuletzt abgerufen … von Google Calendar**, sobald Google den Link gelesen hat.

Name und Zeitzone des Kalenders werden **nur beim ersten Abonnieren** gelesen: Wird ein Plan später umbenannt, ändert sich der Kalendername in Google nicht — entfernen Sie den Kalender und fügen Sie ihn erneut hinzu, wenn der Name wichtig ist. Google verwirft Erinnerungen aus Kalenderdateien; legen Sie also Standardbenachrichtigungen für diesen Kalender in den Google-Einstellungen fest oder verwenden Sie besser die eigenen Erinnerungen von OneUptime. Google merkt sich eine Adresse, die es nicht lesen konnte: Haben Sie das Problem behoben, fügen Sie den Link mit angehängtem `?nocache=1` erneut hinzu (OneUptime ignoriert unbekannte Abfrageparameter, der Feed bleibt unverändert) oder erzeugen Sie den Link neu. Die Google-Kalender-App unter Android und iOS kann keine URL abonnieren; fügen Sie den Link auf einem Computer hinzu, dann erscheint er auf dem Telefon.
@tab Outlook im Web
1. Öffnen Sie **Kalender** > **Kalender hinzufügen** > **Aus dem Web abonnieren**.
2. Fügen Sie den `https://`-Link ein (**Link kopieren** in OneUptime), geben Sie dem Kalender einen Namen und klicken Sie auf **Importieren**.

Das funktioniert genauso in Outlook.com, in Outlook im Web für Geschäfts- und Schulkonten, im neuen Outlook für Windows und in Outlook für Mac. Outlook ruft **von Microsofts Servern** ab: etwa alle 3 Stunden bei Outlook.com und alle 4 bis 6 Stunden bei Geschäfts- und Schulkonten, manchmal länger als einen Tag. Das Intervall ist fest, eine manuelle Aktualisierung gibt es nicht.

Abonnieren Sie hier statt in der Desktop-App, wenn der Kalender auch auf dem Telefon und in Outlook im Web erscheinen soll — im klassischen Outlook für Windows erstellte Abonnements bleiben auf diesem PC.
@tab Klassisches Outlook für Windows
1. Klicken Sie auf einem PC mit installiertem Outlook in OneUptime auf **Apple Kalender / Outlook**. Windows reicht den `webcal://`-Link an Outlook weiter, das fragt, ob der Internetkalender hinzugefügt werden soll. Ohne Outlook hat Windows keinen `webcal`-Handler.
2. Oder öffnen Sie in Outlook **Datei** > **Kontoeinstellungen** > **Kontoeinstellungen** > **Internetkalender** > **Neu**, fügen Sie den Link ein (**Link kopieren** in OneUptime) und klicken Sie auf **Hinzufügen**.

Öffnen Sie **nicht** den `https://…/shifts.ics`-Link selbst im klassischen Outlook: Er importiert eine einmalige Momentaufnahme, die nie aktualisiert wird. Den `webcal://`-Link zu öffnen oder die Adresse unter **Internetkalender** hinzuzufügen, erzeugt ein Abonnement.

Der Feed wird bei **Senden/Empfangen** aktualisiert (F9 oder das Intervall unter Senden-Empfangen-Gruppen). Die Einstellungen des Abonnements enthalten das Kontrollkästchen **Aktualisierungslimit**: Ist es aktiviert, aktualisiert Outlook nicht häufiger als vom Anbieter vorgeschlagen. OneUptime schlägt eine Stunde vor (`X-PUBLISHED-TTL:PT1H`), der Feed wird also etwa stündlich aktualisiert. Feeds ohne diesen Hinweis werden mit aktiviertem Kästchen nie aktualisiert; die Feeds von OneUptime tragen ihn, Sie können das Kästchen also aktiviert lassen. Das klassische Outlook ruft den Feed **von Ihrem PC** ab und prüft das Zertifikat des Servers.
@tab Apple Kalender (macOS)
1. Klicken Sie in OneUptime auf **Apple Kalender / Outlook**, oder wählen Sie in Kalender **Ablage** > **Neues Kalenderabonnement** und fügen Sie den Link ein.
2. Stellen Sie im Abonnieren-Blatt **Automatisch aktualisieren** ein — alle 5 Minuten, 15 Minuten, stündlich, täglich oder wöchentlich (stündlich ist Standard) — und wählen Sie unter **Ort** **iCloud**, damit der Kalender auch auf iPhone und iPad erscheint und dort im selben Rhythmus aktualisiert wird.

macOS ruft den Feed **von Ihrem Mac** ab, es funktioniert also auch mit einer Installation in einem privaten Netzwerk, solange der Mac sie erreicht. Einem selbstsignierten oder von einer internen CA ausgestellten Zertifikat muss zuerst im macOS-Schlüsselbund vertraut werden. **Hinweise entfernen** ist in diesem Blatt standardmäßig aktiviert; das spielt hier keine Rolle, weil der Feed keine Alarme enthält.
@tab iPhone und iPad
Um auf dem Gerät zu abonnieren, tippen Sie in der OneUptime-Mobil-App auf **Open in Calendar** oder gehen Sie zu **Einstellungen** > **Kalender** > **Accounts** > **Account hinzufügen** > **Andere** > **Kalenderabo hinzufügen** und fügen Sie den Link ein.

Auf dem Gerät selbst erstellte Abonnements werden gemäß **Einstellungen** > **Kalender** > **Accounts** > **Datenabgleich** aktualisiert — standardmäßig **Automatisch**, was meist beim Laden im WLAN geschieht. Für eine zuverlässige Aktualisierung abonnieren Sie auf einem Mac mit **iCloud** als Ort oder stellen **Datenabgleich** auf ein festes Intervall.
@tab Thunderbird
Wählen Sie **Datei** > **Neu** > **Kalender** > **Im Netzwerk** > **iCalendar (ICS)**, fügen Sie den `https://`-Link ein und wählen Sie in den Kalendereigenschaften ein Aktualisierungsintervall: 1, 5, 15, 30 oder 60 Minuten. Thunderbird ruft **von Ihrem Computer** ab und muss dem Zertifikat des Servers vertrauen.
@tab Android
Weder die Google-Kalender-App noch Samsung Kalender können eine URL abonnieren. Fügen Sie den `https://`-Link auf einem Computer zu Google Kalender hinzu (**Weitere Kalender** > **+** > **Per URL**); der Kalender wird dann mit allem anderen in diesem Google-Konto auf das Telefon synchronisiert. Die OneUptime-Mobil-App bietet unter Android genau dafür **Share link** und **Copy https link**.
@tab Andere Dienste
Fastmail aktualisiert etwa stündlich und **deaktiviert ein Abonnement nach fünf fehlgeschlagenen Abrufen in Folge**; fügen Sie es in diesem Fall erneut hinzu, sobald der Server wieder in Ordnung ist. Proton Calendar aktualisiert alle 4 bis 16 Stunden und lehnt sehr große Feeds ab — verringern Sie **Tage im Voraus**, wenn er sich beschwert. Confluence Team Calendars akzeptiert den Plan-Feed; sein Limit von 28 Zeichen für Kalendernamen wird eingehalten.
:::

## Wie oft Kalender aktualisieren

| Kalender-App | Typische Aktualisierung | Ruft ab von | Hinweise |
| --- | --- | --- | --- |
| Google Kalender (Per URL) | 8–24 Stunden, manchmal länger | Googles Servern | Keine manuelle Aktualisierung; ignoriert Hinweise; Name und Zeitzone nur beim ersten Abonnieren gelesen |
| Outlook.com | Etwa 3 Stunden | Microsofts Servern | Fest; kann 24 Stunden überschreiten |
| Outlook im Web (Geschäft, Schule) | Etwa 4–6 Stunden | Microsofts Servern | Fest; nicht beeinflussbar |
| Klassisches Outlook für Windows | Bei Senden/Empfangen; etwa stündlich mit **Aktualisierungslimit** | Ihrem PC | Über den `webcal`-Link abonnieren; synchronisiert nicht auf Telefon oder Web |
| Apple Kalender (macOS) | 5 Minuten bis wöchentlich, Standard stündlich | Ihrem Mac | In iCloud speichern, um iPhone und iPad zu erreichen |
| Apple Kalender (nur iOS) | Gemäß **Datenabgleich**, akkuabhängig | Ihrem Telefon | Für Zuverlässigkeit auf einem Mac abonnieren |
| Thunderbird | 1–60 Minuten | Ihrem Computer | |
| Fastmail | Etwa stündlich | Fastmails Servern | Nach fünf fehlgeschlagenen Abrufen deaktiviert |
| Proton Calendar | 4–16 Stunden | Protons Servern | Lehnt große Feeds ab |

OneUptime selbst liefert frische Daten: Eine Änderung an einer Ebene, einer Rotation, einer Vertretung oder einer Richtlinienzuordnung macht den Feed sofort ungültig, und Antworten werden höchstens fünf Minuten zwischengespeichert. Die Wartezeit, die Sie sehen, ist die der Kalender-App, nicht die des Servers. OneUptime schlägt über `REFRESH-INTERVAL` und `X-PUBLISHED-TTL` eine stündliche Aktualisierung vor; nur das klassische Outlook beachtet den Hinweis, und auch nur mit aktiviertem **Aktualisierungslimit** — Apple Kalender, Thunderbird und die übrigen aktualisieren in dem Intervall, das Sie pro Kalender einstellen.

## https- und webcal-Links

Beide zeigen auf denselben Feed. `webcal://` ist der Link mit umbenanntem Schema, damit das Betriebssystem eine Kalender-App statt eines Browsers öffnet; die App ruft den Feed dann über `https://` ab, wenn der Server https anbietet, wie es Apple Kalender und Google Kalender tun.

- **Link kopieren** gibt die `https://`-Form. **Per URL** von Google Kalender, Outlook im Web, Thunderbird und Fastmail nehmen sie.
- **Apple Kalender / Outlook** öffnet die `webcal://`-Form: Apple Kalender und das klassische Outlook für Windows abonnieren darüber. Im klassischen Outlook ist das Öffnen der `https://`-Form stattdessen ein einmaliger Import.
- **Google Kalender** trägt die `webcal://`-Form in Googles Link zum Hinzufügen per URL, die einzige Form, die diese Seite nimmt.
- OneUptime gibt `webcals://` nicht mehr aus: iOS öffnet es nicht („die Adresse ist ungültig“), und Google nimmt es auch nicht. Ein Kalender, den Sie bereits mit einem `webcals://`-Link abonniert haben, funktioniert weiter.
- Läuft Ihre Installation noch mit reinem `http`, wird der Feed im Klartext abgerufen, Token eingeschlossen, und das Dashboard zeigt neben dem Link eine Warnung; wechseln Sie zu `https`, bevor Sie Links breit teilen.

Feed-URLs leiten nie um. Sie antworten mit `200` auf jedem Schema, das OneUptime erreicht, denn die Anwendung kann nicht erkennen, welches Schema die Kalender-App verwendet hat, wenn TLS davor endet — in OneUptime Cloud oder hinter Ihrem eigenen Load Balancer oder CDN —, und eine Umleitung zeigte dort auf dieselbe URL zurück. Leiten Sie reines `http` auf dem Proxy, der TLS beendet, auf `https` um: dem einen Hop, der es weiß.

## Erinnerungen und Neuzuweisungs-Hinweise

Kalender-Apps liefern keine Alarme aus abonnierten Feeds — Google verwirft sie, Apple entfernt sie standardmäßig, Outlook flacht sie ab —, deshalb sendet OneUptime eigene.

:::steps
1. Öffnen Sie **Benutzereinstellungen** > **Kalender** > **Kalender-Feed**.
2. Wählen Sie auf der Karte **Vor Schichten erinnern** Vorlaufzeiten: **1 Woche**, **1 Tag**, **1 Stunde**, **15 Min.** oder, mit **Benutzerdefiniert**, einen eigenen Wert zwischen 15 Minuten und 14 Tagen. Sie können mehrere gleichzeitig wählen.
3. Wählen Sie, wie Erinnerungen Sie erreichen, unter **Bevor meine Bereitschaftsschicht beginnt** in **Benutzereinstellungen** > **Benachrichtigungseinstellungen** (Tab Bereitschaft). E-Mail und Push sind standardmäßig an.
:::

Jede Erinnerung wird einmal pro Schicht gesendet. Die Nachricht nennt den Plan, die Richtlinien, über die er alarmiert, und die Startzeit in Ihrer Zeitzone.

- Eine Schicht, die durch eine späte Vertretung in eine Ihrer Vorlaufzeiten fällt — jemand übergibt Ihnen eine Schicht 20 Minuten vor Beginn —, erhält sofort eine einzelne Nachhol-Erinnerung.
- Wird eine Schicht, an die Sie erinnert wurden, an jemand anderen übergeben, erhalten Sie **Meine bevorstehende Bereitschaftsschicht wird neu zugewiesen**, ein eigener Ereignistyp, der sich separat stummschalten lässt.
- Erinnerungen werden nie nach Schichtbeginn gesendet und nie für Pläne, die keiner Eskalationsrichtlinie zugeordnet sind, weil diese niemanden alarmieren können.
- Auf WhatsApp kommt eine Erinnerung über Metas vorab genehmigte Bereitschaftsvorlage an: Sie nennt den Plan und die Eskalationsrichtlinie und verlinkt den Plan, enthält aber die Startzeit nicht, und WhatsApp liefert sie nur auf Englisch aus. Für Meldungen über eine Neuzuweisung gibt es keine genehmigte WhatsApp-Vorlage, sie erreichen Sie deshalb über Ihre anderen Kanäle.

## Geteilte Links für einen Plan oder ein Projekt

Ein geteilter Link gehört dem **Projekt**, nicht der Person, die ihn kopiert hat, und er zeigt Namen, nie E-Mail-Adressen. Legen Sie den Plan-Link in einen geteilten Teamkalender — Google, Outlook oder Confluence —, dann bedient ein Abonnement das ganze Team.

### Plan-Feed

Auf der Seite eines Plans hat die Karte **Diesen Dienstplan abonnieren** zwei Hälften: **Nur meine Schichten in diesem Dienstplan** (Ihr persönlicher Link mit Planfilter) und **Alle Schichten in diesem Dienstplan (geteilter Teamlink)**. Jeder mit der Berechtigung **Bearbeiten** für Pläne kann **Geteilten Link veröffentlichen**, ihn mit **Link neu erzeugen** erneuern oder **Deaktivieren**; jeder, der den Plan lesen darf, kann ihn kopieren. Die Karte zeigt, wann der Link zuletzt rotiert wurde.

### Projekt-Feed

**Bereitschaftsdienst** > **Kalender-Feeds** enthält die Karte **Alle Schichten in diesem Projekt (geteilter Link)** — einen geteilten Link über alle Pläne des Projekts — mit denselben Aktionen zum Veröffentlichen, Neuerzeugen und Deaktivieren, und einen Link zu Ihrer persönlichen Feed-Seite.

### Einstellungen geteilter Links

Klicken Sie auf der Karte **Einstellungen des geteilten Links** auf **Einstellungen bearbeiten**:

| Einstellung | Was sie bewirkt |
| --- | --- |
| **Abdeckungslücken anzeigen** | Standardmäßig aus. Fügt überall dort einen Termin `No coverage · <Schedule>` ein, wo eine Ebene abdecken _soll_, aber niemand Bereitschaft hat: eine leere Ebene, eine Ebene mit Startdatum in der Zukunft, Ebenen, die nicht zusammenpassen, oder jedes Loch in einem 24×7-Plan. Die Zeiten außerhalb der Geschäftszeiten eines Bürozeiten-Plans werden nie gemeldet, und es werden höchstens 100 Lücken-Termine ausgegeben, die ältesten zuerst. |
| **Mindestlücke zum Anzeigen (Minuten)** | Standard 60. Blendet kürzere Löcher aus. |
| **Neu erzeugen, wenn jemand das Projekt verlässt** | Standardmäßig aus. Erzeugt den Link automatisch neu, wenn jemand sein letztes Team im Projekt verlässt, damit der Kalender eines ehemaligen Kollegen nicht mehr aktualisiert wird. Alle anderen müssen danach neu abonnieren, deshalb muss man es bewusst einschalten. |
| **Tage vergangener Schichten**, **Tage im Voraus** | Wie beim persönlichen Feed. |

Rotieren Sie einen geteilten Link, wenn jemand geht, der ihn hatte, oder schalten Sie die automatische Rotation oben ein.

Wenn eine Person ihr letztes Team in einem Projekt verlässt, entfernt OneUptime sie außerdem aus den Planebenen und Eskalationsregeln dieses Projekts, löscht die laufenden und künftigen Vertretungen des Projekts, in denen sie genannt wird (als vertretene Person oder als Vertretung), deaktiviert ihren persönlichen Feed für das Projekt und löscht dort ihre Erinnerungen. Ein persönlicher Link zeigt Schichten nur, solange die Person, der er gehört, Mitglied des Projekts ist: Das wird bei jedem Abruf des Links geprüft, sodass jemand, der das Projekt verlassen hat, einen leeren Kalender erhält, und die Liste der kommenden Schichten in der Mobil-App umfasst nur die Projekte, in denen die Person noch Mitglied ist.

## Termine im Detail

- Jede Schicht hat eine stabile Identität aus Plan und Schichtbeginn, sodass dieselbe Schicht in Ihrem persönlichen Feed, im Plan-Feed und nach dem Neuerzeugen eines Links derselbe Termin ist. Kalender-Apps aktualisieren ihn an Ort und Stelle; eine Änderung erhöht die Sequenznummer des Termins.
- Eine Vertretung, die die ganze Schicht tauscht, behält den Termin und ändert die Person; eine Vertretung über einen Teil der Schicht erzeugt drei aneinander anschließende Termine, zum Beispiel A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Ist ein Plan zwei oder mehr Eskalationsrichtlinien zugeordnet und gilt eine Vertretung nur für eine davon, unterscheiden sich die alarmierten Personen je Richtlinie. Der Feed zeigt das, statt es zu verbergen: Die Schicht behält ihren Termin für die Person, die über die anderen Richtlinien alarmiert wird, mit einem Hinweis auf die Richtlinie, die jemand anderen alarmiert, und die Vertretung erhält einen zusätzlichen Termin mit dem Titel `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Vergangene Schichten tragen in ihrer Beschreibung die Zeile „Past shifts reflect the current rotation, not who was actually paged“.
- Ein Plan, der keiner Eskalationsrichtlinie zugeordnet ist, wird trotzdem angezeigt, mit dem Hinweis, dass er niemanden alarmieren wird.

## Planung, nicht Prüfung

Der Feed zeigt die Rotation, **wie sie jetzt eingerichtet ist**, auch für vergangene Tage: Eine nachträglich eingetragene Vertretung schreibt die Vergangenheit im Kalender um. Für tatsächlich geleistete Bereitschaftsstunden, Fairness-Prüfungen und Vergütung verwenden Sie **Bereitschaftsdienst** > **Berichte** > **Bereitschaftszeit des Benutzers**, das aus dem entsteht, was der Pager tatsächlich getan hat.

## Sicherheit

- Das Token im Link ist das einzige Zugangsmerkmal. Wer den Link hat, sieht die Schichten — Namen, Pläne, Richtlinien —, bis er neu erzeugt wird. Fügen Sie Links nicht in Chaträume oder Tickets ein; braucht ein Team einen Kalender, teilen Sie den Plan- oder Projekt-Link statt Ihres persönlichen.
- Links gelten pro Projekt. Ein geleakter persönlicher Link legt die Schichten eines Projekts offen, nicht die aller Projekte, denen Sie angehören.
- Das Neuerzeugen eines Links verschiebt das alte Token in eine 30-tägige Schonfrist (leerer Kalender, danach 404). **Deaktivieren** liefert einen leeren Kalender. Ein unbekannter oder abgelaufener Link antwortet mit einem schlichten 404 ohne Hinweis. Leere Kalender bringen abonnierte Apps dazu, ihre Kopie zu leeren; ein 404 lässt sie die Kopie behalten — deshalb liefern Deaktivieren und Neuerzeugen leere Kalender.
- Tokens werden gehasht gespeichert; die auf der Einstellungsseite angezeigte Kopie ist mit `ENCRYPTION_SECRET` verschlüsselt. Setzen Sie diese Variable bei einer selbst gehosteten Installation auf ein echtes Geheimnis — der Server warnt beim Start, wenn sie nicht gesetzt ist oder noch einer der Platzhalter aus diesem Repository ist (`secret` oder das `please-change-this-to-random-value`, das `config.example.env` setzt). Ändern Sie sie später, bietet die Seite **Link neu erzeugen** an, weil die gespeicherte Kopie nicht mehr gelesen werden kann; der Feed funktioniert weiter, bis Sie das tun.
- Feed-Antworten sind mit `Cache-Control: private` markiert, von Suchmaschinen ausgeschlossen (`X-Robots-Tag: noindex`) und pro Link sowie pro Client-Adresse ratenbegrenzt.

Der eigene Nginx von OneUptime hält Feed-Anfragen aus seinen Protokollen heraus:

```nginx title="default.conf.template"
location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
    access_log off;
    error_log /dev/null crit;
    proxy_max_temp_file_size 0;
    ...
}
```

Ein Token landet also nie neben einer Client-Adresse in einer Protokolldatei; die Anwendung protokolliert es ebenfalls nie. `access_log off` entfernt die Zeile pro Anfrage, `error_log` entfernt die Zeilen, die Nginx bei einem fehlgeschlagenen Aufruf der Anwendung schreibt — ohne sie wird das Token jedes Clients aufgezeichnet, der während eines Neustarts abruft — und `proxy_max_temp_file_size 0` hält einen großen Feed aus einer temporären Datei heraus.

> [!WARNING]
> **Jeder Proxy, jede WAF und jedes CDN, das Sie vor OneUptime betreiben, protokolliert die vollständige URI weiterhin, im Zugriffs- wie im Fehlerprotokoll,** sofern Sie es nicht anders konfigurieren — prüfen Sie das, bevor Sie Feeds ausrollen.

## Konfiguration bei Selbst-Hosting

Nichts muss eingeschaltet werden: Feeds funktionieren auf jeder Installation. Vier Umgebungsvariablen steuern sie, gesetzt in `config.env` bei Docker Compose oder unter `onCallCalendarFeed` in den Helm-Werten (siehe die [Konfigurationsreferenz](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) des Charts):

| Variable | Helm-Wert | Standard | Wirkung |
| --- | --- | --- | --- |
| `DISABLE_ON_CALL_CALENDAR_FEED` | `onCallCalendarFeed.disabled` | `false` | Notschalter. Jede Feed-URL antwortet mit `503` und `Retry-After: 3600`; abonnierte Apps behalten ihre Kopie und versuchen es später erneut. Nichts wird gelöscht. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS` | `onCallCalendarFeed.rateLimit.windowSeconds` | `60` | Länge des Ratenbegrenzungsfensters. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60` | Abrufe, die ein Link von einer Client-Adresse pro Fenster machen darf. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perIpPerWindow` | `3000` | Abrufe, die eine Client-Adresse über alle Links pro Fenster machen darf — die Obergrenze für ein ganzes Büro hinter einer Adresse. |

Ebenfalls relevant:

- **`HOST` und `HTTP_PROTOCOL`** bilden die Links. Ist `HOST` leer oder `localhost` oder `HTTP_PROTOCOL` gleich `http`, zeigt die Feed-Seite eine Warnung, und die Links funktionieren von außen nicht. Ist `HOST` eine private Adresse — `10.x`, `172.16–31.x`, `192.168.x`, ein Name ohne Punkt wie ein Containername oder ein Name unter `.internal`, `.local`, `.lan` und ähnlichen —, sagt die Seite, dass Google Kalender und Outlook im Web den Link nicht erreichen können; Apps auf einem Computer im selben Netzwerk können es weiterhin.
- **`TRUSTED_PROXY_HOPS`** bestimmt, welche Adresse die Begrenzung pro Adresse zählt. Der Standard `1` ist für die Standard-Layouts von Docker Compose und Helm richtig; zählen Sie für jeden eigenen Proxy — CDN, WAF oder Load Balancer —, der an `X-Forwarded-For` anhängt, eins hinzu, sonst sieht jeder Kalender-Client wie dieselbe Adresse aus und alle teilen sich ein Budget. Siehe [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) in der Chart-Dokumentation.
- **Redis** trägt die Caches und die Ratenbegrenzung. Beide degradieren sanft: Ohne Redis werden Feeds weiterhin gerendert, nur langsamer, und die Begrenzung lässt Anfragen durch.
- Im geteilten Modus des Helm-Charts (`worker.enabled: true`) werden Feeds auf der API-Ebene gerendert; dimensionieren Sie diese Ebene für einen Schwung Kalender-Clients, die zur vollen Stunde abrufen.
- Die oben gezeigte Ausnahme vom Nginx-Zugriffsprotokoll ist Teil des mitgelieferten `packages/Nginx/default.conf.template`; behalten Sie sie bei, wenn Sie die Vorlage anpassen.

## Fehlerbehebung

:::details Google Kalender meldet "Unable to add calendar. Check the URL."
Ältere OneUptime-Versionen legten die `https://`-Form des Links in die Schaltfläche **Google Kalender**, und Googles Seite zum Hinzufügen per URL nimmt nur die `webcal://`-Form. Laden Sie die Feed-Seite neu und klicken Sie erneut auf **Google Kalender**, oder fügen Sie den Link unter **Weitere Kalender** > **+** > **Per URL** hinzu.
:::

:::details Google Kalender zeigt den Kalender, aber keine Schichten
Prüfen Sie zuerst die Statuszeile der Feed-Seite. **Zuletzt abgerufen … von Google Calendar** bedeutet, dass Google den Link gelesen hat: Öffnen Sie den Link im Browser und sehen Sie sich an, was er liefert — ein leerer Kalender nennt seinen Grund in `X-WR-CALDESC` (siehe „Der Kalender ist leer“ unten).

**Noch nicht abgerufen** bedeutet, dass Google ihn nicht lesen konnte: Von einem Rechner außerhalb Ihres Netzwerks muss `curl -sI <link>` sofort mit `200` und `Content-Type: text/calendar` antworten. Eine Umleitung, eine Anmeldeseite, eine Firewall oder eine Bot-Prüfung vor OneUptime stoppt Googles Abrufer; das tat auch eine Umleitungsschleife in älteren OneUptime-Versionen, auf Installationen mit `PROVISION_SSL=true`, bei denen TLS vor Nginx endet. Sobald er mit `200` antwortet, fügen Sie den Link mit angehängtem `?nocache=1` erneut hinzu, damit Google ihn neu liest.
:::

:::details Nichts hat den Link abgerufen, oder „URL konnte nicht abgerufen werden“
Google Kalender, Outlook im Web, Fastmail und Proton rufen **von ihren eigenen Servern** ab, der OneUptime-Host muss also aus dem öffentlichen Internet mit einem Zertifikat erreichbar sein, dem sie vertrauen. Eine Installation in einem privaten Netzwerk, hinter einem VPN oder mit einer internen Zertifizierungsstelle ist für sie unerreichbar, egal was Sie einfügen.

Apple Kalender, Thunderbird und das klassische Outlook rufen vom Gerät ab und funktionieren überall dort, wo das Gerät das Dashboard öffnen kann — nachdem dem Zertifikat auf diesem Gerät vertraut wurde, falls es selbstsigniert ist. Die Statuszeile der Feed-Seite sagt Ihnen, ob etwas den Link bereits abgerufen hat; `curl -I` gegen den Link von außerhalb Ihres Netzwerks ist die schnellste Prüfung:

```bash
curl -I "https://<your host>/api/on-call-calendar/user/<token>/shifts.ics"
```

OneUptime den _Zugriff_ auf private Netzwerke zu erlauben — [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access) — ist eine andere Sache und hilft hier nicht.
:::

:::details Der Kalender ist veraltet
Lesen Sie zuerst die Aktualisierungstabelle: Bei Google ist die Verzögerung normal. Damit Google erneut nachsieht, entfernen Sie den Kalender und fügen ihn erneut hinzu oder hängen `?nocache=1` an den Link (unbekannte Parameter werden ignoriert, der Feed bleibt gleich, aber Google behandelt ihn als neu). Im klassischen Outlook drücken Sie F9 und prüfen die Einstellung **Aktualisierungslimit**. In Apple Kalender verwenden Sie **Darstellung** > **Kalender aktualisieren**. Ist eine Änderung am selben Tag wichtig, verlassen Sie sich auf die Erinnerungen und Neuzuweisungs-Hinweise von OneUptime statt auf den Kalender.
:::

:::details Der Kalender ist leer
Ein leerer Kalender ist Absicht. Er bedeutet, dass der Link deaktiviert ist, ein alter Link innerhalb seiner 30-tägigen Schonfrist nach dem Neuerzeugen ist, das Projekt unterhalb des Tarifs liegt, der Bereitschaftspläne enthält, oder Sie in keinem Plan dieses Projekts mehr stehen. Öffnen Sie den Link im Browser: Die Kalenderbeschreibung (`X-WR-CALDESC`) nennt den Grund. Wenn Sie das Projekt verlassen haben, bleibt der Link leer: Er zeigt Schichten nur, solange Sie Mitglied sind.
:::

:::details Der Link antwortet mit 404
Der Link ist unbekannt, wurde gelöscht oder seine Schonfrist ist abgelaufen. Erzeugen Sie einen neuen und abonnieren Sie erneut.
:::

:::details Der Link antwortet mit 503
Entweder ist `DISABLE_ON_CALL_CALENDAR_FEED` gesetzt, oder der Server ist ausgelastet: Es werden höchstens einige Feeds gleichzeitig gerendert, und ein Plan, dessen Berechnung sehr lange dauert, wird abgebrochen. Existiert eine frühere Kopie des Feeds, liefert der Server stattdessen diese mit dem Header `Warning: 110`; ein 503 bedeutet also, dass es nichts gab, worauf zurückgegriffen werden konnte. Clients behalten ihre letzte Kopie und versuchen es nach dem `Retry-After`-Intervall erneut. Fastmail deaktiviert ein Abonnement nach fünf Fehlern in Folge; fügen Sie es erneut hinzu, sobald der Server wieder in Ordnung ist. Die Metrik `oncall_calendar_render_duration_ms` zeigt Betreibern, welche Feeds langsam sind.
:::

:::details 429 oder „zu viele Anfragen“
Viele Clients hinter einer Adresse — ein Büro-NAT, ein VPN-Gateway — teilen sich das Budget pro Adresse. Erhöhen Sie `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` und prüfen Sie `TRUSTED_PROXY_HOPS`: Ist der Wert zu niedrig, wird jeder Client Ihrem eigenen Proxy zugeordnet und alle teilen sich ein Budget.
:::

:::details Zertifikatsfehler in Apple Kalender, Thunderbird oder Outlook
Diese Apps prüfen TLS auf dem Gerät. Importieren Sie Ihre interne CA in den Vertrauensspeicher des Geräts — den macOS-Schlüsselbund, den Windows-Zertifikatsspeicher, den Zertifikatsmanager von Thunderbird — oder verwenden Sie ein öffentlich vertrauenswürdiges Zertifikat. Serverseitige Abrufer wie Google und Microsoft können nicht dazu gebracht werden, einer privaten CA zu vertrauen.
:::

:::details Die Zeiten sind falsch
Alle Zeiten in der Datei sind UTC; die Kalender-App rechnet in ihre eigene Zeitzone um. Wirken Schichten um einen festen Versatz verschoben, prüfen Sie die Zeitzone des Plans (**Zeitzone des Zeitplans** auf seiner Seite **Ebenen**) und Ihre eigene (**Zeitzone** in Ihrem **Profil**). Ein Plan ohne Zeitzone wird in der Zeitzone des Servers berechnet, und der Termin weist darauf hin.
:::

:::details Der Feed sagt, er wurde gekürzt
Mehr als 5.000 Termine fielen in das Fenster. Verringern Sie **Tage im Voraus** oder abonnieren Sie **Nur meine Schichten in diesem Dienstplan** statt eines ganzen Projekts.
:::

:::details Google zeigt einen alten Kalendernamen
Google liest den Namen nur beim ersten Abonnieren; entfernen Sie den Kalender und fügen Sie ihn erneut hinzu.
:::

:::details Die Einstellungsseite sagt, der Link müsse neu erzeugt werden
`ENCRYPTION_SECRET` hat sich seit dem Erstellen des Links geändert, der Server kann ihn also nicht mehr anzeigen. Das bestehende Abonnement funktioniert weiter; das Neuerzeugen gibt Ihnen einen wieder kopierbaren Link und zieht den alten nach 30 Tagen zurück.
:::

:::details Eine Schicht fehlt in meinem Feed
Nur Planschichten erscheinen; direkte Benutzer- oder Teamzuweisungen in einer Richtlinienregel sind fest und haben keine Termine. Eine Schicht, die jemand anderes per Vertretung übernommen hat, verlässt Ihren Feed, weil sie jetzt in dessen Feed ist. Schalten Sie **Schichten einschließen, die ich für andere übernehme** ein, um Schichten zu sehen, die Sie durch Vertretungen in Plänen erhalten haben, deren Mitglied Sie nicht sind.
:::

## Nächste Schritte

:::cards
- [Bereitschaftspläne](/docs/on-call/schedules): Die Rotationen einrichten, die Ihre Feeds zeigen.
- [Zeitachse der Bereitschaftspläne](/docs/on-call/schedule-timeline): Alle Pläne im Dashboard nebeneinander sehen.
- [Eskalationsregeln](/docs/on-call/escalation-rules): Pläne an Richtlinien anhängen, damit ihre Schichten Personen alarmieren.
:::
