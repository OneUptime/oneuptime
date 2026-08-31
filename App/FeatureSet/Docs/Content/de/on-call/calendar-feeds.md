# Kalender-Feeds (Bereitschaftsschichten in Google Kalender, Outlook und Apple Kalender)

Kalender-Feeds bringen Ihre Bereitschaftsschichten in den Kalender, den Sie ohnehin täglich nutzen. OneUptime veröffentlicht für jede Person, jeden Zeitplan und jedes Projekt einen geheimen iCalendar-Link (`.ics`); Google Kalender, Outlook, Apple Kalender, Thunderbird und jede andere App, die einen Kalender per URL abonnieren kann, ruft diesen Link regelmäßig ab und zeigt pro Schicht einen Termin. Es wird nichts installiert und kein Konto verbunden: Der Link ist die gesamte Integration.

> **Note:** Ein abonnierter Kalender dient der **Planung**. Kalender-Apps rufen Feeds nach ihrem eigenen Rhythmus ab — Google Kalender nur alle 8 bis 24 Stunden —, deshalb erreicht Sie ein Tausch eine Stunde vor Schichtbeginn über die eigenen Erinnerungen, Neuzuweisungs-Hinweise und Pager-Benachrichtigungen von OneUptime, nicht über den Kalender.

## Was Sie bekommen

- Ein Termin pro Schicht mit dem Titel `On-call · <Schedule>` im persönlichen Feed und `<Name> · On-call · <Schedule>` in einem geteilten Feed. Die Beschreibung nennt, wer Bereitschaft hat, den Zeitplan und seine Zeitzone, die Ebene, die Schicht in der Zeitzone des Zeitplans, in UTC und in Ihrer Zeitzone, über welche Eskalationsrichtlinien Sie über diesen Zeitplan alarmiert werden, sowie einen Link zum Zeitplan im Dashboard.
- Vertretungen werden berücksichtigt. Wenn jemand für Sie einspringt, wandert der Termin zu dieser Person (`(covering for <Name>)` wird angehängt) und bleibt in Ihrer Kalender-App derselbe Termin, sodass er an Ort und Stelle aktualisiert statt dupliziert wird. Eine teilweise Vertretung teilt die Schicht in aneinander anschließende Termine.
- Standardmäßig zwei Tage Rückschau und 90 Tage Vorschau. Sie können das auf 60 Tage zurück und 180 Tage voraus ausweiten; ein Feed, der 5.000 Termine überschreiten würde, wird gekürzt und weist in seiner Kalenderbeschreibung darauf hin.
- Termine sind als frei markiert (`TRANSP:TRANSPARENT`), ein abonnierter Feed blockiert also nie Ihre Verfügbarkeit, und nichts ist als privat markiert, sodass ein geteilter Teamkalender allen Berechtigten die Titel zeigt.
- Zeiten werden in UTC gesendet und von Ihrer Kalender-App umgerechnet; die Beschreibung nennt die Uhrzeit in der Zeitzone des Zeitplans und in Ihrer. Ihre eigene Zeitzone stellen Sie unter **Benutzereinstellungen** > **Profil** ein, die des Zeitplans in dessen Tab **Einstellungen**. Ein Zeitplan ohne Zeitzone wird in der Zeitzone des Servers berechnet, genau wie beim Alarmieren, und der Termin weist darauf hin.

Feste Zuweisungen — ein Benutzer oder ein Team, das direkt in einer Regel einer Eskalationsrichtlinie steht — haben keinen Anfang und kein Ende und erscheinen in keinem Feed. In OneUptime Cloud folgen Feeds demselben Tarif wie Bereitschaftszeitpläne (Growth); ein Projekt unterhalb dieses Tarifs erhält einen leeren Kalender statt eines Fehlers.

## Drei Arten von Links

| Link                  | Wer ihn erstellt                                                                              | Was er enthält                                                                                                   | Wo                                                            |
| --------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Persönlicher Feed** | Jeder Benutzer, einer pro Projekt                                                             | Ihre Schichten auf allen Zeitplänen des Projekts, plus die Schichten, in denen Sie jemanden vertreten (optional) | **Benutzereinstellungen** > **Kalender-Feed**                 |
| **Zeitplan-Feed**     | Jeder, der den Zeitplan bearbeiten darf; jeder mit Leserecht darf den Link kopieren           | Die Schichten aller auf einem Zeitplan, optional mit Terminen für Abdeckungslücken                               | Die Seite des Zeitplans, Karte **Diesen Zeitplan abonnieren** |
| **Projekt-Feed**      | Jeder, der Bereitschaftszeitpläne bearbeiten darf; jeder mit Leserecht darf den Link kopieren | Die Schichten aller auf allen Zeitplänen des Projekts, optional mit Terminen für Abdeckungslücken                | **Bereitschaftsdienst** > **Kalender-Feeds**                  |

Die Links sehen so aus:

```
https://<Ihr Host>/api/on-call-calendar/user/<token>/shifts.ics
https://<Ihr Host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<Ihr Host>/api/on-call-calendar/project/<token>/project.ics
```

Das 43 Zeichen lange Token im Pfad ist das einzige Zugangsmerkmal — es gibt keine Anmeldung, kein Cookie und keinen API-Schlüssel. Behandeln Sie jeden dieser Links wie ein Passwort.

## Ihr persönlicher Feed

1. Öffnen Sie **Benutzereinstellungen** > **Kalender-Feed** in dem Projekt, dessen Schichten Sie möchten. Persönliche Feeds gelten pro Projekt: Ein zweites Projekt bekommt einen zweiten Link und einen zweiten Kalender.
2. Klicken Sie auf **Kalender-Link erzeugen**. Die Karte **Ihre Bereitschaftsschichten abonnieren** zeigt nun den `https://`-Link und drei Schaltflächen:
   - **Google Kalender** öffnet Google Kalender mit vorausgefülltem Link.
   - **Apple / andere Apps** öffnet die `webcals://`-Form des Links, die macOS, iOS und die meisten Desktop-Apps direkt an ihren Abonnieren-Dialog weiterreichen.
   - **Webcal-Link kopieren** kopiert denselben `webcal(s)://`-Link — den das klassische Outlook für Windows braucht.
3. Abonnieren Sie in Ihrer Kalender-App nach den Schritten weiter unten.

Einstellungen auf derselben Karte:

- **Schichten einschließen, die ich für andere übernehme** (standardmäßig an) ergänzt die Schichten, die Ihnen eine Vertretung auf Zeitplänen gibt, deren Mitglied Sie sonst nicht sind.
- **Tage vergangener Schichten** (Standard 2, höchstens 60) und **Tage Vorschau** (Standard 90, zwischen 7 und 180).

Die Statuszeile zeigt, wann der Link zuletzt abgerufen wurde, von welcher Kalender-App, wie oft, und die letzten vier Zeichen des Tokens, damit Sie Links unterscheiden können. Wurde der Link nach zwei Tagen von nichts abgerufen, fragt die Seite, ob der Server aus dem Internet erreichbar ist (siehe Fehlerbehebung).

Die Seite listet außerdem Ihre **Bevorstehende Schichten** (die nächsten 30 Tage), jede mit einem Link **Vertretung finden**, der die Benutzer-Vertretungen für diese Schicht vorausgefüllt öffnet, sowie die weiter unten beschriebene Karte **Vor Schichten erinnern**.

Aktionen:

- **Link neu erzeugen** erstellt ein neues Token. Jede App, die den alten Link abonniert hat, wird nicht mehr aktualisiert: 30 Tage lang liefert der alte Link einen leeren Kalender, damit diese Apps ihre Kopie leeren, danach antwortet er mit 404. Abonnieren Sie den neuen Link erneut.
- **Deaktivieren** behält den Link, liefert aber einen leeren Kalender, bis Sie ihn wieder aktivieren.
- **Löschen** entfernt den Link. Apps, die ihn weiter abrufen, erhalten 404 und zeigen weiterhin, was sie zuletzt geladen haben — deaktivieren Sie zuerst, wenn sie sich leeren sollen.

Derselbe persönliche Link, mit `?schedule=<id>` auf einen Zeitplan gefiltert, wird auf jeder Zeitplanseite als **Nur meine Schichten auf diesem Zeitplan** angeboten, und das Bereitschaftsbanner sowie die Seite **Meine Bereitschaftsrichtlinien** enthalten einen Link **Ihre Schichten zu Ihrem Kalender hinzufügen** zur oben beschriebenen Seite.

In der Mobil-App: **Bereitschaft** > **Schichten zu meinem Kalender hinzufügen** (auch unter **Einstellungen** > **Kalender-Feed**), mit einem Link pro Projekt. Auf dem iPhone öffnet **In Kalender öffnen** das native Abonnieren-Blatt. Unter Android gibt es keine Möglichkeit, eine URL auf dem Telefon zu abonnieren; der Bildschirm bietet deshalb **Link teilen** und **https-Link kopieren** und bittet Sie, den Link auf einem Computer hinzuzufügen, wonach er auf das Telefon synchronisiert wird. Die Liste **Ihre Schichten** in der App stammt aus denselben Daten und hat dieselbe Aktion **Vertretung finden**.

## In Ihrer Kalender-App abonnieren

Verwenden Sie den `https://`-Link, sofern die App nicht nach `webcal` verlangt; der Abschnitt zu den Schemata weiter unten erklärt den Unterschied.

### Google Kalender (Web)

1. Klicken Sie in Google Kalender im Web neben **Weitere Kalender** auf **+** > **Per URL**.
2. Fügen Sie den `https://`-Link ein und klicken Sie auf **Kalender hinzufügen**. Die Schaltfläche **Google Kalender** in OneUptime macht dasselbe mit vorausgefülltem Link.

Google ruft den Feed **von Googles Servern** ab, etwa alle 8 bis 24 Stunden, manchmal seltener. Es gibt keine Aktualisieren-Schaltfläche für abonnierte Kalender, und Google ignoriert die Aktualisierungshinweise im Feed. Name und Zeitzone des Kalenders werden **nur beim ersten Abonnieren** gelesen: Wird ein Zeitplan später umbenannt, ändert sich der Kalendername in Google nicht — entfernen Sie den Kalender und fügen Sie ihn erneut hinzu, wenn der Name wichtig ist. Google verwirft Erinnerungen aus Kalenderdateien; legen Sie also Standardbenachrichtigungen für diesen Kalender in den Google-Einstellungen fest oder verwenden Sie besser die eigenen Erinnerungen von OneUptime. Meldet Google, die URL könne nicht abgerufen werden, prüfen Sie, dass Sie die `https://`-Form und nicht `webcal://` eingefügt haben, und hängen Sie `?nocache=1` an, damit Google erneut nachsieht (OneUptime ignoriert unbekannte Abfrageparameter, der Feed bleibt unverändert). Die Google-Kalender-App unter Android und iOS kann keine URL abonnieren; fügen Sie den Link auf einem Computer hinzu, dann erscheint er auf dem Telefon.

### Outlook im Web und Outlook.com

1. Öffnen Sie **Kalender** > **Kalender hinzufügen** > **Aus dem Web abonnieren**.
2. Fügen Sie den `https://`-Link ein, geben Sie dem Kalender einen Namen und klicken Sie auf **Importieren**.

Outlook ruft **von Microsofts Servern** ab: etwa alle 3 Stunden bei Outlook.com und alle 4 bis 6 Stunden bei Geschäfts- und Schulkonten, manchmal länger als einen Tag. Das Intervall ist fest, eine manuelle Aktualisierung gibt es nicht. Abonnieren Sie hier statt in der Desktop-App, wenn der Kalender auch auf dem Telefon und in Outlook im Web erscheinen soll — im klassischen Outlook für Windows erstellte Abonnements bleiben auf diesem PC. Das neue Outlook für Windows und Outlook für Mac verwenden denselben Dialog **Kalender hinzufügen** > **Aus dem Web abonnieren**.

### Klassisches Outlook für Windows

1. Klicken Sie in OneUptime auf **Webcal-Link kopieren**.
2. Öffnen Sie in Outlook **Datei** > **Kontoeinstellungen** > **Kontoeinstellungen** > **Internetkalender** > **Neu**, fügen Sie den `webcals://`-Link ein und klicken Sie auf **Hinzufügen**. Einen `webcal`-Link im Browser zu öffnen funktioniert ebenfalls auf einem PC mit installiertem Outlook; ohne Outlook hat Windows keinen `webcal`-Handler.

Öffnen Sie **nicht** den `https://…/shifts.ics`-Link selbst im klassischen Outlook: Er importiert eine einmalige Momentaufnahme, die nie aktualisiert wird. Nur `webcal://` und `webcals://` erzeugen ein Abonnement.

Der Feed wird bei **Senden/Empfangen** aktualisiert (F9 oder das Intervall unter Senden-Empfangen-Gruppen). Die Einstellungen des Abonnements enthalten das Kontrollkästchen **Aktualisierungslimit**: Ist es aktiviert, aktualisiert Outlook nicht häufiger als vom Anbieter vorgeschlagen. OneUptime schlägt eine Stunde vor (`X-PUBLISHED-TTL:PT1H`), der Feed wird also etwa stündlich aktualisiert. Feeds ohne diesen Hinweis werden mit aktiviertem Kästchen nie aktualisiert; die Feeds von OneUptime tragen ihn, Sie können das Kästchen also aktiviert lassen. Das klassische Outlook ruft den Feed **von Ihrem PC** ab und prüft das Zertifikat des Servers.

### Apple Kalender unter macOS

1. Klicken Sie in OneUptime auf **Apple / andere Apps**, oder wählen Sie in Kalender **Ablage** > **Neues Kalenderabonnement** und fügen Sie den Link ein.
2. Stellen Sie im Abonnieren-Blatt **Automatisch aktualisieren** ein — alle 5 Minuten, 15 Minuten, stündlich, täglich oder wöchentlich (stündlich ist Standard) — und wählen Sie unter **Ort** **iCloud**, damit der Kalender auch auf iPhone und iPad erscheint und dort im selben Rhythmus aktualisiert wird.

macOS ruft den Feed **von Ihrem Mac** ab, es funktioniert also auch mit einer Installation in einem privaten Netzwerk, solange der Mac sie erreicht. Einem selbstsignierten oder von einer internen CA ausgestellten Zertifikat muss zuerst im macOS-Schlüsselbund vertraut werden. **Hinweise entfernen** ist in diesem Blatt standardmäßig aktiviert; das spielt hier keine Rolle, weil der Feed keine Alarme enthält.

### iPhone und iPad

Auf dem Gerät selbst erstellte Abonnements werden gemäß **Einstellungen** > **Kalender** > **Accounts** > **Datenabgleich** aktualisiert — standardmäßig **Automatisch**, was meist beim Laden im WLAN geschieht. Für eine zuverlässige Aktualisierung abonnieren Sie auf einem Mac mit **iCloud** als Ort oder stellen **Datenabgleich** auf ein festes Intervall. Um auf dem Gerät zu abonnieren, tippen Sie in der OneUptime-Mobil-App auf **In Kalender öffnen** oder gehen Sie zu **Einstellungen** > **Kalender** > **Accounts** > **Account hinzufügen** > **Andere** > **Kalenderabo hinzufügen** und fügen Sie den Link ein.

### Thunderbird

Wählen Sie **Datei** > **Neu** > **Kalender** > **Im Netzwerk** > **iCalendar (ICS)**, fügen Sie den `https://`-Link ein und wählen Sie in den Kalendereigenschaften ein Aktualisierungsintervall: 1, 5, 15, 30 oder 60 Minuten. Thunderbird ruft **von Ihrem Computer** ab und muss dem Zertifikat des Servers vertrauen.

### Fastmail, Proton und andere Dienste

Fastmail aktualisiert etwa stündlich und **deaktiviert ein Abonnement nach fünf fehlgeschlagenen Abrufen in Folge**; fügen Sie es in diesem Fall erneut hinzu, sobald der Server wieder gesund ist. Proton Calendar aktualisiert alle 4 bis 16 Stunden und lehnt sehr große Feeds ab — verringern Sie **Tage Vorschau**, wenn er sich beschwert. Confluence Team Calendars akzeptiert den Zeitplan-Feed; sein Limit von 28 Zeichen für Kalendernamen wird eingehalten.

### Android

Weder die Google-Kalender-App noch Samsung Kalender können eine URL abonnieren. Fügen Sie den `https://`-Link auf einem Computer zu Google Kalender hinzu (**Weitere Kalender** > **+** > **Per URL**); der Kalender wird dann mit allem anderen in diesem Google-Konto auf das Telefon synchronisiert. Die OneUptime-Mobil-App bietet unter Android genau dafür **Link teilen** und **https-Link kopieren**.

## Wie oft Kalender aktualisieren

| Kalender-App                      | Typische Aktualisierung                                           | Ruft ab von        | Hinweise                                                                                                |
| --------------------------------- | ----------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| Google Kalender (Per URL)         | 8–24 Stunden, manchmal länger                                     | Googles Servern    | Keine manuelle Aktualisierung; ignoriert Hinweise; Name und Zeitzone nur beim ersten Abonnieren gelesen |
| Outlook.com                       | Etwa 3 Stunden                                                    | Microsofts Servern | Fest; kann 24 Stunden überschreiten                                                                     |
| Outlook im Web (Geschäft, Schule) | Etwa 4–6 Stunden                                                  | Microsofts Servern | Fest; nicht beeinflussbar                                                                               |
| Klassisches Outlook für Windows   | Bei Senden/Empfangen; etwa stündlich mit **Aktualisierungslimit** | Ihrem PC           | Braucht einen `webcal`-Link; synchronisiert nicht auf Telefon oder Web                                  |
| Apple Kalender (macOS)            | 5 Minuten bis wöchentlich, Standard stündlich                     | Ihrem Mac          | In iCloud speichern, um iPhone und iPad zu erreichen                                                    |
| Apple Kalender (nur iOS)          | Gemäß **Datenabgleich**, akkuabhängig                             | Ihrem Telefon      | Für Zuverlässigkeit auf einem Mac abonnieren                                                            |
| Thunderbird                       | 1–60 Minuten                                                      | Ihrem Computer     |                                                                                                         |
| Fastmail                          | Etwa stündlich                                                    | Fastmails Servern  | Nach fünf fehlgeschlagenen Abrufen deaktiviert                                                          |
| Proton Calendar                   | 4–16 Stunden                                                      | Protons Servern    | Lehnt große Feeds ab                                                                                    |

OneUptime selbst liefert frische Daten: Eine Änderung an einer Ebene, einer Rotation, einer Vertretung oder einer Richtlinienzuordnung macht den Feed sofort ungültig, und Antworten werden höchstens fünf Minuten zwischengespeichert. Die Wartezeit, die Sie sehen, ist die der Kalender-App, nicht die des Servers. OneUptime schlägt über `REFRESH-INTERVAL` und `X-PUBLISHED-TTL` eine stündliche Aktualisierung vor; nur das klassische Outlook und Apple Kalender beachten den Hinweis.

## https, webcal und webcals

Alle drei zeigen auf denselben Feed. `webcal://` und `webcals://` sind der `http://`- bzw. `https://`-Link mit umbenanntem Schema, damit das Betriebssystem eine Kalender-App statt eines Browsers öffnet; `webcals` ist die verschlüsselte Variante und das, was OneUptime anbietet, wenn `HTTP_PROTOCOL` auf `https` steht.

- Google Kalender, Outlook im Web, Thunderbird und Fastmail wollen die `https://`-Form.
- Apple Kalender und das klassische Outlook für Windows abonnieren über einen `webcal(s)://`-Link; im klassischen Outlook ist die `https://`-Form ein einmaliger Import.
- `webcal://` ohne `s` ist unverschlüsselt und sendet das Token bei jedem Abruf im Klartext. Läuft Ihre Installation noch mit reinem `http`, zeigt das Dashboard neben dem Link eine Warnung; wechseln Sie zu `https`, bevor Sie Links breit teilen.

## Erinnerungen und Neuzuweisungs-Hinweise

Kalender-Apps liefern keine Alarme aus abonnierten Feeds — Google verwirft sie, Apple entfernt sie standardmäßig, Outlook flacht sie ab —, deshalb sendet OneUptime eigene.

Unter **Benutzereinstellungen** > **Kalender-Feed** lässt Sie die Karte **Vor Schichten erinnern** Vorlaufzeiten wählen: **1 Woche**, **1 Tag**, **1 Stunde**, **15 Min.** oder einen eigenen Wert zwischen 15 Minuten und 14 Tagen, auch mehrere gleichzeitig. Jede Erinnerung wird einmal pro Schicht über die Zustellwege gesendet, die Sie für **Bevor meine Bereitschaftsschicht beginnt** unter **Benutzereinstellungen** > **Benachrichtigungseinstellungen** (Tab Bereitschaft; E-Mail und Push sind standardmäßig an) gewählt haben. Die Nachricht nennt den Zeitplan, die Richtlinien, über die er alarmiert, und die Startzeit in Ihrer Zeitzone.

- Eine Schicht, die durch eine späte Vertretung in eine Ihrer Vorlaufzeiten fällt — jemand übergibt Ihnen eine Schicht 20 Minuten vor Beginn —, erhält sofort eine einzelne Nachhol-Erinnerung.
- Wird eine Schicht, an die Sie erinnert wurden, an jemand anderen übergeben, erhalten Sie **Meine bevorstehende Bereitschaftsschicht wurde neu zugewiesen**, ein eigener Ereignistyp, der sich separat stummschalten lässt.
- Erinnerungen werden nie nach Schichtbeginn gesendet und nie für Zeitpläne, die keiner Eskalationsrichtlinie zugeordnet sind, weil diese niemanden alarmieren können.

## Geteilte Links für einen Zeitplan oder ein Projekt

Ein geteilter Link gehört dem **Projekt**, nicht der Person, die ihn kopiert hat, und er zeigt Namen, nie E-Mail-Adressen.

**Zeitplan-Feed.** Auf der Seite eines Zeitplans hat die Karte **Diesen Zeitplan abonnieren** zwei Hälften: **Nur meine Schichten auf diesem Zeitplan** (Ihr persönlicher Link mit Zeitplanfilter) und **Schichten aller auf diesem Zeitplan (geteilter Team-Link)**. Jeder mit der Berechtigung **Bearbeiten** für Zeitpläne kann **Geteilten Link veröffentlichen**, ihn **Neu erzeugen** oder **Deaktivieren**; jeder, der den Zeitplan lesen darf, kann ihn kopieren. Die Karte zeigt, wann der Link zuletzt rotiert wurde.

**Projekt-Feed.** **Bereitschaftsdienst** > **Kalender-Feeds** enthält die Karte **Schichten aller in diesem Projekt (geteilter Link)** — einen geteilten Link über alle Zeitpläne des Projekts — mit denselben Aktionen zum Veröffentlichen, Neuerzeugen und Deaktivieren, und einen Link zu Ihrer persönlichen Feed-Seite.

Einstellungen bei beiden:

- **Abdeckungslücken anzeigen** (standardmäßig aus) fügt überall dort einen Termin `No coverage · <Schedule>` ein, wo eine Ebene abdecken _soll_, aber niemand Bereitschaft hat: eine leere Ebene, eine Ebene mit Startdatum in der Zukunft, Ebenen, die nicht zusammenpassen, oder jedes Loch in einem 24×7-Zeitplan. Die Zeiten außerhalb der Geschäftszeiten eines Bürozeiten-Zeitplans werden nie gemeldet. **Mindestlücke für die Anzeige (Minuten)** (Standard 60) blendet kürzere Löcher aus; höchstens 100 Lücken-Termine werden ausgegeben, die ältesten zuerst.
- **Neu erzeugen, wenn jemand das Projekt verlässt** (standardmäßig aus) erzeugt den Link automatisch neu, wenn jemand sein letztes Team im Projekt verlässt, damit der Kalender eines ehemaligen Kollegen nicht mehr aktualisiert wird. Alle anderen müssen danach neu abonnieren, deshalb ist es eine Opt-in-Einstellung.
- **Tage vergangener Schichten** und **Tage Vorschau**, wie beim persönlichen Feed.

Legen Sie den Zeitplan-Link in einen geteilten Teamkalender — Google, Outlook oder Confluence —, dann bedient ein Abonnement das ganze Team. Rotieren Sie ihn, wenn jemand geht, der ihn hatte, oder schalten Sie die automatische Rotation oben ein.

Wenn eine Person ihr letztes Team in einem Projekt verlässt, entfernt OneUptime sie außerdem aus den Zeitplanebenen und Eskalationsregeln dieses Projekts, deaktiviert ihren persönlichen Feed für das Projekt und löscht dort ihre Erinnerungen.

## Termine im Detail

- Jede Schicht hat eine stabile Identität aus Zeitplan und Schichtbeginn, sodass dieselbe Schicht in Ihrem persönlichen Feed, im Zeitplan-Feed und nach dem Neuerzeugen eines Links derselbe Termin ist. Kalender-Apps aktualisieren ihn an Ort und Stelle; eine Änderung erhöht die Sequenznummer des Termins.
- Eine Vertretung, die die ganze Schicht tauscht, behält den Termin und ändert die Person; eine Vertretung über einen Teil der Schicht erzeugt drei aneinander anschließende Termine, zum Beispiel A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Ist ein Zeitplan zwei oder mehr Eskalationsrichtlinien zugeordnet und gilt eine Vertretung nur für eine davon, unterscheiden sich die alarmierten Personen je Richtlinie. Der Feed zeigt das, statt es zu verbergen: Die Schicht behält ihren Termin für die Person, die über die anderen Richtlinien alarmiert wird, mit einem Hinweis auf die Richtlinie, die jemand anderen alarmiert, und die Vertretung erhält einen zusätzlichen Termin mit dem Titel `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Vergangene Schichten tragen in ihrer Beschreibung die Zeile „Past shifts reflect the current rotation, not who was actually paged“.
- Ein Zeitplan, der keiner Eskalationsrichtlinie zugeordnet ist, wird trotzdem angezeigt, mit dem Hinweis, dass er niemanden alarmieren wird.

## Planung, nicht Prüfung

Der Feed zeigt die Rotation, **wie sie jetzt konfiguriert ist**, auch für vergangene Tage: Eine nachträglich eingetragene Vertretung schreibt die Vergangenheit im Kalender um. Für tatsächlich geleistete Bereitschaftsstunden, Fairness-Prüfungen und Vergütung verwenden Sie **Bereitschaftsdienst** > **Berichte** > **Bereitschaftszeit pro Benutzer**, der aus dem entsteht, was der Pager tatsächlich getan hat.

## Sicherheit

- Das Token im Link ist das einzige Zugangsmerkmal. Wer den Link hat, sieht die Schichten — Namen, Zeitpläne, Richtlinien —, bis er neu erzeugt wird. Fügen Sie Links nicht in Chaträume oder Tickets ein; braucht ein Team einen Kalender, teilen Sie den Zeitplan- oder Projekt-Link statt Ihres persönlichen.
- Links gelten pro Projekt. Ein geleakter persönlicher Link legt die Schichten eines Projekts offen, nicht die aller Projekte, denen Sie angehören.
- **Neu erzeugen** verschiebt das alte Token in eine 30-tägige Schonfrist (leerer Kalender, danach 404). **Deaktivieren** liefert einen leeren Kalender. Ein unbekannter oder abgelaufener Link antwortet mit einem schlichten 404 ohne Hinweis. Leere Kalender bringen abonnierte Apps dazu, ihre Kopie zu leeren; ein 404 lässt sie die Kopie behalten — deshalb liefern Deaktivieren und Neuerzeugen leere Kalender.
- Tokens werden gehasht gespeichert; die auf der Einstellungsseite angezeigte Kopie ist mit `ENCRYPTION_SECRET` verschlüsselt. Setzen Sie diese Variable bei einer selbst gehosteten Installation auf ein echtes Geheimnis — der Server warnt beim Start, wenn sie nicht gesetzt ist oder noch wörtlich `secret` lautet. Ändern Sie sie später, bietet die Seite **Link neu erzeugen** an, weil die gespeicherte Kopie nicht mehr gelesen werden kann; der Feed funktioniert weiter, bis Sie das tun.
- Feed-Antworten sind mit `Cache-Control: private` markiert, von Suchmaschinen ausgeschlossen (`X-Robots-Tag: noindex`) und pro Link sowie pro Client-Adresse ratenbegrenzt.
- Der eigene Nginx von OneUptime schreibt Feed-Anfragen nicht in sein Zugriffsprotokoll:

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      ...
  }
  ```

  Ein Token landet also nie neben einer Client-Adresse in einer Protokolldatei; die Anwendung protokolliert es ebenfalls nie. **Jeder Proxy, jede WAF und jedes CDN, das Sie vor OneUptime betreiben, protokolliert die vollständige URI weiterhin**, sofern Sie es nicht anders konfigurieren — prüfen Sie das, bevor Sie Feeds ausrollen.

## Konfiguration bei Selbst-Hosting

Nichts muss eingeschaltet werden: Feeds funktionieren auf jeder Installation. Vier Umgebungsvariablen steuern sie, gesetzt in `config.env` bei Docker Compose oder unter `onCallCalendarFeed` in den Helm-Werten (siehe die [Konfigurationsreferenz](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) des Charts):

| Variable                                                | Helm-Wert                                        | Standard | Wirkung                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false`  | Notschalter. Jede Feed-URL antwortet mit `503` und `Retry-After: 3600`; abonnierte Apps behalten ihre Kopie und versuchen es später erneut. Nichts wird gelöscht. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`     | Länge des Ratenbegrenzungsfensters.                                                                                                                               |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`     | Abrufe, die ein Link von einer Client-Adresse pro Fenster machen darf.                                                                                            |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`   | Abrufe, die eine Client-Adresse über alle Links pro Fenster machen darf — die Obergrenze für ein ganzes Büro hinter einer Adresse.                                |

Ebenfalls relevant:

- **`HOST` und `HTTP_PROTOCOL`** bilden die Links. Ist `HOST` leer oder `localhost` oder `HTTP_PROTOCOL` gleich `http`, zeigt die Feed-Seite eine Warnung, und die Links funktionieren von außen nicht.
- **`TRUSTED_PROXY_HOPS`** bestimmt, welche Adresse die Begrenzung pro Adresse zählt. Der Standard `1` ist für die Standard-Layouts von Docker Compose und Helm richtig; zählen Sie für jeden eigenen Proxy — CDN, WAF oder Load Balancer —, der an `X-Forwarded-For` anhängt, eins hinzu, sonst sieht jeder Kalender-Client wie dieselbe Adresse aus und alle teilen sich ein Budget. Siehe [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) in der Chart-Dokumentation.
- **Redis** trägt die Caches und die Ratenbegrenzung. Beide degradieren sanft: Ohne Redis werden Feeds weiterhin gerendert, nur langsamer, und die Begrenzung lässt Anfragen durch.
- Im geteilten Modus des Helm-Charts (`worker.enabled: true`) werden Feeds auf der API-Ebene gerendert; dimensionieren Sie diese Ebene für einen Schwung Kalender-Clients, die zur vollen Stunde abrufen.
- Die oben gezeigte Ausnahme vom Nginx-Zugriffsprotokoll ist Teil des mitgelieferten `Nginx/default.conf.template`; behalten Sie sie bei, wenn Sie die Vorlage anpassen.

## Fehlerbehebung

**Nichts hat den Link abgerufen, oder „URL konnte nicht abgerufen werden“.** Google Kalender, Outlook im Web, Fastmail und Proton rufen **von ihren eigenen Servern** ab, der OneUptime-Host muss also aus dem öffentlichen Internet mit einem Zertifikat erreichbar sein, dem sie vertrauen. Eine Installation in einem privaten Netzwerk, hinter einem VPN oder mit einer internen Zertifizierungsstelle ist für sie unerreichbar, egal was Sie einfügen. Apple Kalender, Thunderbird und das klassische Outlook rufen vom Gerät ab und funktionieren überall dort, wo das Gerät das Dashboard öffnen kann — nach dem Vertrauen des Zertifikats auf diesem Gerät, falls es selbstsigniert ist. Die Statuszeile der Feed-Seite sagt Ihnen, ob etwas den Link bereits abgerufen hat; `curl -I` gegen den Link von außerhalb Ihres Netzwerks ist die schnellste Prüfung. OneUptime den _Zugriff_ auf private Netzwerke zu erlauben — [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access) — ist eine andere Sache und hilft hier nicht.

**Der Kalender ist veraltet.** Lesen Sie zuerst die Aktualisierungstabelle: Bei Google ist die Verzögerung normal. Damit Google erneut nachsieht, entfernen Sie den Kalender und fügen ihn erneut hinzu oder hängen `?nocache=1` an den Link (unbekannte Parameter werden ignoriert, der Feed bleibt gleich, aber Google behandelt ihn als neu). Im klassischen Outlook drücken Sie F9 und prüfen die Einstellung **Aktualisierungslimit**. In Apple Kalender verwenden Sie **Darstellung** > **Kalender aktualisieren**. Ist eine Änderung am selben Tag wichtig, verlassen Sie sich auf die Erinnerungen und Neuzuweisungs-Hinweise von OneUptime statt auf den Kalender.

**Der Kalender ist leer.** Ein leerer Kalender ist Absicht. Er bedeutet, dass der Link deaktiviert ist, ein alter Link innerhalb seiner 30-tägigen Schonfrist nach dem Neuerzeugen ist, das Projekt unterhalb des Tarifs liegt, der Bereitschaftszeitpläne enthält, oder Sie auf keinem Zeitplan dieses Projekts mehr stehen. Öffnen Sie den Link im Browser: Die Kalenderbeschreibung (`X-WR-CALDESC`) nennt den Grund.

**404.** Der Link ist unbekannt, wurde gelöscht oder seine Schonfrist ist abgelaufen. Erzeugen Sie einen neuen und abonnieren Sie erneut.

**503.** Entweder ist `DISABLE_ON_CALL_CALENDAR_FEED` gesetzt, oder der Server ist ausgelastet: Es werden höchstens einige Feeds gleichzeitig gerendert, und ein Zeitplan, dessen Berechnung sehr lange dauert, wird abgebrochen. Existiert eine frühere Kopie des Feeds, liefert der Server stattdessen diese mit dem Header `Warning: 110`; ein 503 bedeutet also, dass es nichts gab, worauf zurückgegriffen werden konnte. Clients behalten ihre letzte Kopie und versuchen es nach dem `Retry-After`-Intervall erneut. Fastmail deaktiviert ein Abonnement nach fünf Fehlern in Folge; fügen Sie es erneut hinzu, sobald der Server gesund ist. Die Metrik `oncall_calendar_render_duration_ms` zeigt Betreibern, welche Feeds langsam sind.

**429 oder „zu viele Anfragen“.** Viele Clients hinter einer Adresse — ein Büro-NAT, ein VPN-Gateway — teilen sich das Budget pro Adresse. Erhöhen Sie `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` und prüfen Sie `TRUSTED_PROXY_HOPS`: Ist der Wert zu niedrig, wird jeder Client Ihrem eigenen Proxy zugeordnet und alle teilen sich ein Budget.

**Zertifikatsfehler in Apple Kalender, Thunderbird oder Outlook.** Diese Apps prüfen TLS auf dem Gerät. Importieren Sie Ihre interne CA in den Vertrauensspeicher des Geräts — den macOS-Schlüsselbund, den Windows-Zertifikatsspeicher, den Zertifikatsmanager von Thunderbird — oder verwenden Sie ein öffentlich vertrauenswürdiges Zertifikat. Serverseitige Abrufer wie Google und Microsoft können nicht dazu gebracht werden, einer privaten CA zu vertrauen.

**Die Zeiten sind falsch.** Alle Zeiten in der Datei sind UTC; die Kalender-App rechnet in ihre eigene Zeitzone um. Wirken Schichten um einen festen Versatz verschoben, prüfen Sie die Zeitzone des Zeitplans (Tab **Einstellungen**) und Ihre eigene (**Benutzereinstellungen** > **Profil**). Ein Zeitplan ohne Zeitzone wird in der Zeitzone des Servers berechnet, und der Termin weist darauf hin.

**Der Feed sagt, er wurde gekürzt.** Mehr als 5.000 Termine fielen in das Fenster. Verringern Sie **Tage Vorschau** oder abonnieren Sie **Nur meine Schichten auf diesem Zeitplan** statt eines ganzen Projekts.

**Google zeigt einen alten Kalendernamen.** Google liest den Namen nur beim ersten Abonnieren; entfernen Sie den Kalender und fügen Sie ihn erneut hinzu.

**Die Einstellungsseite sagt, der Link müsse neu erzeugt werden.** `ENCRYPTION_SECRET` hat sich seit dem Erstellen des Links geändert, der Server kann ihn also nicht mehr anzeigen. Das bestehende Abonnement funktioniert weiter; das Neuerzeugen gibt Ihnen einen wieder kopierbaren Link und zieht den alten nach 30 Tagen zurück.

**Eine Schicht fehlt in meinem Feed.** Nur Zeitplanschichten erscheinen; direkte Benutzer- oder Teamzuweisungen in einer Richtlinienregel sind fest und haben keine Termine. Eine Schicht, die jemand anderes per Vertretung übernommen hat, verlässt Ihren Feed, weil sie jetzt in dessen Feed ist. Schalten Sie **Schichten einschließen, die ich für andere übernehme** ein, um Schichten zu sehen, die Sie durch Vertretungen auf Zeitplänen erhalten haben, deren Mitglied Sie nicht sind.
