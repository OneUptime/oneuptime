# Abonnenten & Ankündigungen

Eine Statusseite ist ein Ort, den Menschen aufsuchen. Abonnenten sind die Menschen, die sich das lieber sparen – sie hinterlassen einmal eine E-Mail-Adresse, eine Telefonnummer, einen Slack-Webhook oder einen HTTP-Endpunkt, und von da an kommen Ihre Updates zu ihnen.

Ankündigungen sind die andere Hälfte derselben Aufgabe. Ein Monitor kann Ihren Besuchern sagen, dass der Checkout 500er zurückgibt; kein Monitor kann ihnen sagen, dass Sie am Samstag Datenbanken migrieren, dass ein Drittanbieter gerade einen schlechten Tag hat oder dass der Vorfall, von dem sie gestern gelesen haben, vollständig abgeschlossen ist. Ankündigungen sind der Freitextkanal für alles, was Ihre Prüfungen nicht sehen können, und sie gehen an dieselbe Abonnentenliste.

Diese Seite behandelt beides: die fünf Abonnementkanäle und wie Besucher sich eintragen, was Abonnenten sich aussuchen können, die Abläufe für Double Opt-in und Abmeldung sowie das Schreiben, Planen und Vorlagen von Ankündigungen.

## Abonnementkanäle

Eine Statusseite unterstützt fünf Kanäle, jeder mit eigenem Schalter auf der Statusseite. Gehen Sie auf **Statusseiten → Ihre Seite → Abonnenten → Abonnenten-Einstellungen**:

- **E-Mail-Abonnenten aktivieren** (`enableEmailSubscribers`) – standardmäßig an. Alles andere ist aus, bis Sie es einschalten.
- **SMS-Abonnenten aktivieren** (`enableSmsSubscribers`) – standardmäßig aus.
- **Slack-Abonnenten aktivieren** (`enableSlackSubscribers`) – standardmäßig aus.
- **Microsoft Teams-Abonnenten aktivieren** (`enableMicrosoftTeamsSubscribers`) – standardmäßig aus.
- **Webhook-Abonnenten aktivieren** (`enableWebhookSubscribers`) – standardmäßig aus.

Jeder Kanal bekommt außerdem seine eigene Liste im Seitenmenü der Statusseite unter **Abonnenten**: **E-Mail-Abonnenten**, **SMS-Abonnenten**, **Slack-Abonnenten**, **MS Teams-Abonnenten** und **Webhook-Abonnenten**. Dort sehen Sie, wer eingetragen ist, tragen jemanden von Hand nach oder hinterlassen sich zu einem bestimmten Abonnenten einen Eintrag unter **Notizen** (`internalNote`).

**Ein Schalter allein genügt nicht.** Der Eintrag **Abonnieren** in der Navigationsleiste der Statusseite erscheint nur, wenn **Abonnentenseite anzeigen** (`showSubscriberPageOnStatusPage`) an ist *und* mindestens ein Kanal aktiviert ist. Schalten Sie **E-Mail-Abonnenten aktivieren** ein, lassen aber **Abonnentenseite anzeigen** aus, kommen Besucher gar nicht erst zum Formular.

Dieselben fünf Schalter tauchen ein zweites Mal in der Karte **Abonnenten-Einstellungen** unter **Erweiterte Einstellungen** auf, zusammen mit **Abonnentenseite anzeigen**. Darunter liegen dieselben Spalten – suchen Sie sich einen Bildschirm aus und bleiben Sie dort, am besten auf der eigenen Seite **Abonnenten-Einstellungen**, denn dort steht auch der Rest der Abonnentenkonfiguration.

## Was ein Besucher auf der Seite Abonnieren sieht

Die Seite **Abonnieren** hat ein Untermenü mit einem Reiter je aktiviertem Kanal – **E-Mail**, **SMS**, **Slack**, **MS Teams**, **Webhooks** –, die auf `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` und `/subscribe/webhooks` zeigen. Jeder Reiter fragt nur das Nötigste ab:

- **E-Mail** – Überschrift **Per E-Mail abonnieren**, ein Feld **Ihre E-Mail** mit dem Platzhalter `abonnent@firma.de`.
- **SMS** – Überschrift **Per SMS abonnieren**, ein Feld **Ihre Telefonnummer** mit dem Platzhalter `+491234567890`.
- **Slack** – Überschrift **Über Slack abonnieren**, mit **Slack-Arbeitsbereichsname** (dient der Validierung) und **Slack Eingehende Webhook-URL**, Platzhalter `https://hooks.slack.com/services/...`.
- **MS Teams** – Überschrift **Über Microsoft Teams abonnieren**, mit **Name des Microsoft Teams-Arbeitsbereichs** und **Microsoft Teams Eingehende Webhook-URL**, Platzhalter `https://outlook.office.com/webhook/...`.
- **Webhooks** – Überschrift **Per Webhook abonnieren**, ein Feld **Webhook-URL**. Bei jedem Ereignis auf der Statusseite geht eine JSON-`POST`-Anfrage dorthin.

Der Absendeknopf heißt **Abonnieren**, und nach erfolgreicher Anmeldung erscheint *Sie wurden erfolgreich abonniert.* Die Seite trägt außerdem die Aufteilung **Neues Abonnement** / **Bestehendes Abonnement verwalten**, sodass jemand, der bereits abonniert hat, zu seinen Einstellungen zurückfindet, ohne eine alte E-Mail suchen zu müssen.

## Abonnenten Ressourcen und Ereignistypen wählen lassen

Standardmäßig bekommt ein Abonnent alles, was auf der Seite steht. Zwei Schalter in der Karte **Erweiterte Abonnenten-Einstellungen** ändern das:

- **Abonnenten erlauben, Ressourcen auszuwählen** (`allowSubscribersToChooseResources`) – standardmäßig aus. Schalten Sie es ein, bekommt das Abonnementformular einen Schalter **Alle Ressourcen abonnieren**; nehmen Sie den heraus, erscheint **Ressourcen zum Abonnieren auswählen**, und der Besucher kann einzelne Ressourcen anhaken.
- **Abonnenten erlauben, Ereignistypen auszuwählen** (`allowSubscribersToChooseEventTypes`) – standardmäßig aus. Gleiche Form: ein Schalter **Alle Ereignistypen abonnieren**, und darunter **Ereignistypen zum Abonnieren auswählen**, sobald er nicht gesetzt ist.

Die Ereignistypen sind `Incident`, `Announcement` und `Scheduled Event`.

Die Auswahl landet auf dem Abonnentendatensatz als **Is Subscribed to All Resources** (`isSubscribedToAllResources`, Standard true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, Standard true), **Subscribed to Resources** und **Subscribed to Event Types**.

Gut geeignet für: eine Seite, die mehrere Produkte abdeckt. Ein Kunde, der nur Ihre API nutzt, will nicht jedes Mal eine Nachricht, wenn die Marketing-Website wackelt – lassen Sie ihn die Liste lieber selbst eingrenzen, statt zuzusehen, wie er sich ganz abmeldet.

Dieselbe Karte enthält außerdem **Zeitzonen der Abonnenten**.

## Double Opt-in per E-Mail

E-Mail-Abonnenten bestätigen immer. Wird ein Abonnent mit einer E-Mail-Adresse angelegt und nicht bereits als bestätigt erzeugt, wird **Is Subscription Confirmed** (`isSubscriptionConfirmed`) auf `false` gezwungen und ein sechsstelliger **Subscription Confirmation Token** erzeugt. OneUptime schickt dann einen Bestätigungslink der Form `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}` per E-Mail. Der Besucher landet auf einer Seite **Abonnement bestätigen** und sieht, sobald es durch ist, *Abonnement erfolgreich bestätigt*.

Abonnenten per SMS, Slack, Microsoft Teams und Webhook überspringen das – sie werden mit `isSubscriptionConfirmed` bereits auf `true` angelegt.

**Unbestätigt heißt still.** Die Abfrage, die Abonnenten für eine Benachrichtigung holt, filtert auf `isUnsubscribed: false` und `isSubscriptionConfirmed: true`. Eine E-Mail-Adresse, die den Link nie angeklickt hat, steht in Ihrer Liste **E-Mail-Abonnenten** und bekommt nichts. Beteuert jemand, abonniert zu haben, hört aber nichts, prüfen Sie zuerst diese Spalte.

Es gibt keinen Schalter, um die E-Mail-Bestätigung abzuschalten – sie gilt für jeden, der sich über die Statusseite einträgt. Eine eigene Spalte pro Abonnent, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, Standard true), steuert die E-Mail „Sie haben abonniert“, die nach der Bestätigung eines Abonnenten hinausgeht.

## Ein Abonnement verwalten und kündigen

Jede Abonnenten-E-Mail trägt einen Abmeldelink der Form `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Diese Seite heißt **Abonnement aktualisieren** und sagt dem Besucher, dass er dort seine Einstellungen ändern oder sich abmelden kann. Sie enthält:

- Alle Ressourcen- und Ereignistyp-Auswahlen, die die Seite zulässt.
- Einen Schalter **Abbestellen**, beschrieben als Abmeldung von allen Ressourcen. Er schreibt **Ist abgemeldet** (`isUnsubscribed`, Standard false).
- Einen Absendeknopf **Abonnement aktualisieren**; nach dem Speichern erscheint *Ihre Änderungen wurden gespeichert.*

Wer den Link verloren hat, nutzt **Bestehendes Abonnement verwalten** auf der Seite **Abonnieren** und drückt auf **Verwaltungslink senden**. OneUptime antwortet, dass eine E-Mail mit dem Link unterwegs ist und man in den Spam-Ordner schauen soll, falls sie nicht ankommt.

Dahinter stehen die Endpunkte `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` und `PUT .../update-subscription/:statusPageId/:subscriberId`.

Eine Abmeldung setzt ein Kennzeichen um, statt eine Zeile zu löschen – der Datensatz bleibt also mit gesetztem **Ist abgemeldet** in der Kanalliste stehen. Praktisch, wenn Sie später erklären müssen, warum eine bestimmte Adresse keine Post mehr bekommen hat.

## Worüber Abonnenten benachrichtigt werden

Abonnenten hören von den drei Ereignistypen oben, aber jede Quelle hat ihren eigenen Schalter, damit nichts aus Versehen hinausgeht.

### Benachrichtigungen zu Ankündigungen

Die Ankündigung selbst trägt **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), im Erstellungsformular als Kontrollkästchen **Statusseiten-Abonnenten benachrichtigen** und standardmäßig an. Nennt die Ankündigung unter **Betroffene Monitore (Optional)** Monitore, ist die Benachrichtigung auf diese Monitore beschränkt; lassen Sie das Feld leer, werden alle Abonnenten benachrichtigt.

### Geplante Wartungsereignisse

Ein geplantes Wartungsereignis hat einen eigenen Satz Abonnentenspalten: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, dazu **Subscriber notifications before the event** und **Next subscriber notification before the event at?** für Vorwarnungen. **Statusseiten** am Ereignis entscheidet, auf welchen Seiten es auftaucht, und **Should be visible on status page?** entscheidet, ob es überhaupt auftaucht.

### Vorfälle

`Incident` ist der dritte Ereignistyp. Was einen Vorfall überhaupt auf eine Statusseite bringt – welche Ressourcen er berührt und welche Zustände ihn sichtbar halten – steht unter [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

Der Abschnitt **Benachrichtigungsprotokolle** im Seitenmenü der Statusseite (`{id}/notification-logs`) ist die Stelle, an der Sie nachsehen, was die Seite tatsächlich gesendet hat.

## Benachrichtigungsvorlagen anpassen

Die Karte **Benachrichtigungsvorlagen** unter **Abonnenten-Einstellungen** listet die Vorlagen auf, die diese Statusseite verwendet, mit den Spalten **Vorlagenname**, **Ereignistyp** und **Benachrichtigungsmethode** – so können Sie den Wortlaut je Ereignistyp und je Kanal variieren, statt eine Standardnachricht für alles hinzunehmen.

Projektweite Vorlagen liegen eine Ebene höher, unter **Statusseiten → Einstellungen → Abonnenten-Vorlagen**, neben **Ankündigungs-Vorlagen**.

## E-Mail-Fußzeile, eigenes SMTP und Twilio

Drei weitere Karten unter **Abonnenten-Einstellungen** steuern, wie Abonnentennachrichten Ihr Projekt verlassen:

- **E-Mail-Fußzeileneinstellungen** – **Benutzerdefinierten E-Mail-Fußzeilentext aktivieren** und **Fußzeilentext der Abonnenten-E-Mail-Benachrichtigung** setzen Ihre eigene Fußzeile unter Abonnenten-E-Mails.
- **Benutzerdefiniertes SMTP** – **Benutzerdefinierte SMTP-Konfiguration** verschickt Abonnenten-E-Mails über Ihren eigenen Mailserver statt über den Standard.
- **Twilio-Konfiguration** – **Twilio-Konfiguration** ist das Twilio-Konto, das für SMS-Abonnenten genutzt wird.

Eigenes SMTP lohnt sich früh, wenn Sie E-Mail-Abonnenten haben: Post von Ihrer eigenen Domain wird deutlich seltener weggefiltert und deutlich eher von dem Kunden ernst genommen, der sie um 2 Uhr nachts liest.

## Ankündigungen

Eine Ankündigung ist ein Datensatz auf Projektebene (das Modell `StatusPageAnnouncement`), den Sie auf eine oder mehrere Statusseiten ausspielen, wahlweise auf bestimmte Monitore begrenzt und mit einem Zeitfenster, in dem er gezeigt wird.

Sie legen eine über **Statusseiten → Mehr → Ankündigungen** an oder über **Ankündigungen** im Seitenmenü einer einzelnen Statusseite. Das Erstellungsformular ist ein Assistent mit vier Schritten:

1. **Grundlegende Informationen** – **Ankündigungstitel** (Pflicht, mindestens zwei Zeichen), **Beschreibung** (Markdown, optional) und **Anhänge** für Dateien, die zusammen mit der Ankündigung auf der Statusseite verfügbar sein sollen.
2. **Statusseiten** – **Ankündigung auf diesen Status-Seiten anzeigen**, eine Pflicht-Mehrfachauswahl. Eine Ankündigung kann mehrere Seiten auf einmal treffen.
3. **Betroffene Ressourcen** – **Betroffene Monitore (Optional)**. Wählen Sie keinen aus, werden alle Abonnenten benachrichtigt.
4. **Zeitplan & Einstellungen** – **Anzeige der Ankündigung beginnen ab** (Pflicht, Standard: jetzt), **Anzeige der Ankündigung beenden um** (optional) und **Statusseiten-Abonnenten benachrichtigen** (standardmäßig an).

Besucher lesen Ankündigungen unter `/announcements`, aufgeteilt in **Aktive Ankündigungen** und **Vergangene Ankündigungen**, jede mit **Angekündigt am** datiert. Aktuell laufende Ankündigungen werden zusätzlich oben auf der Übersichtsseite angeheftet. Gibt es nichts zu zeigen, steht dort *Keine Ankündigungen* mit dem Hinweis, dass bisher keine veröffentlicht wurden.

Anhänge werden über `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId` ausgeliefert, hinter derselben Leseprüfung wie die Statusseite selbst – ein Anhang auf einer privaten Seite bleibt also privat.

## Wie die Zeitsteuerung von Ankündigungen funktioniert

**Show At** (`showAnnouncementAt`) und **End At** (`endAnnouncementAt`) treiben alles, aber die Übersichtsseite und die Ankündigungsliste stellen unterschiedliche Fragen, und dieser Unterschied bringt Leute ins Stolpern.

- **Die Übersichtsseite** zeigt eine Ankündigung, wenn `showAnnouncementAt` in der Vergangenheit liegt und `endAnnouncementAt` entweder in der Zukunft liegt oder leer ist.
- **Die Liste `/announcements`** zeigt Ankündigungen, deren `showAnnouncementAt` in den Zeitraum **Ankündigungsverlauf anzeigen (in Tagen)** (`showAnnouncementHistoryInDays`, Standard 14) fällt, und teilt sie dann clientseitig in aktive und vergangene auf.

Zwei Folgen, die Sie einplanen sollten:

- **Eine Ankündigung ohne Enddatum läuft nie ab.** Lassen Sie **Anzeige der Ankündigung beenden um** leer, bleibt sie unbegrenzt oben auf der Übersichtsseite. Setzen Sie bei allem Zeitgebundenen ein Enddatum.
- **Eine alte, aber noch aktive Ankündigung kann aus der Liste verschwinden.** Hat sie vor mehr als `showAnnouncementHistoryInDays` begonnen, fällt sie aus `/announcements` heraus, bleibt aber auf der Übersicht. Erhöhen Sie den Verlaufszeitraum, wenn Sie lange laufende Hinweise pflegen.

Ob Ankündigungen überhaupt erscheinen, steuert die Karte **Ankündigungseinstellungen** unter **Erweiterte Einstellungen**: **Ankündigungen anzeigen** (`showAnnouncementsOnStatusPage`, Standard true) und **Ankündigungsverlauf anzeigen (in Tagen)** (Standard 14). Ist **Ankündigungen anzeigen** aus, weist der Ankündigungs-Endpunkt die Anfrage rundheraus ab.

## Ankündigungsvorlagen

Wenn Sie dieselbe Art von Hinweis immer wieder veröffentlichen – die monatliche Wartungsankündigung, eine wiederkehrende Beeinträchtigung bei einem Drittanbieter –, legen Sie sie vor. **Statusseiten → Einstellungen → Ankündigungs-Vorlagen** speichert das Modell `StatusPageAnnouncementTemplate`, und sein Formular fragt nach **Vorlagenname**, **Vorlagenbeschreibung**, **Ankündigungstitel**, **Beschreibung**, **Ankündigung auf diesen Status-Seiten anzeigen**, **Betroffene Monitore (Optional)** und **Abonnenten benachrichtigen** – die Verteilung und die Benachrichtigungsentscheidung fallen also einmal statt jedes Mal.

## Webhook-Abonnenten und SSRF-Schutz

Webhook-Abonnenten erhalten bei jedem Ereignis auf der Statusseite eine JSON-`POST`-Anfrage. Damit sind sie der einfachste Weg, Statusseiten-Updates in ein eigenes System zu leiten – einen Chatbot, ein internes Dashboard, eine Ticket-Warteschlange.

Weil das Abonnieren eine öffentliche Aktion auf einer öffentlichen Seite ist, schützt OneUptime das Ziel:

- Eine allgemeine **Webhook-URL** wird vor der Annahme geprüft, und private, Loopback-, Link-Local- und Cloud-Metadaten-Adressen werden abgelehnt. Sie können ein Abonnement nicht auf etwas innerhalb des Netzwerks der OneUptime-Installation richten.
- Eine **Slack Eingehende Webhook-URL** muss mit `https://hooks.slack.com/services/` beginnen.

Wird ein Webhook-Abonnement bei der Anmeldung abgelehnt, ist eine interne oder fehlerhafte URL das Erste, was Sie prüfen sollten.

## Wo Sie als Nächstes lesen sollten

- [Statusseiten – Übersicht](/docs/status-pages/index) – was eine Statusseite ist und wie sie aufgebaut ist.
- [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups) – die Monitore und Gruppen, zwischen denen Abonnenten wählen können.
- [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains) – eigene Domains, Logos und das Aussehen der Seite, auf die Ihre E-Mails verlinken.
- [Öffentliche API](/docs/status-pages/public-api) – Statusseitendaten programmatisch lesen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was einen Vorfall auf eine Statusseite bringt und was ihn wieder entfernt.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – die projektweiten Regeln hinter der Vorfallkommunikation.
