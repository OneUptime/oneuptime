# Abonnenten & Ankündigungen

Eine Statusseite ist ein Ort, zu dem Menschen gehen. Abonnenten sind die Menschen, die das lieber nicht tun möchten – sie geben Ihnen einmalig eine E-Mail-Adresse, eine Telefonnummer, einen Slack-Webhook oder einen HTTP-Endpunkt, und danach kommen Ihre Updates zu ihnen.

Ankündigungen sind die andere Hälfte derselben Aufgabe. Ein Monitor kann Ihren Besuchern mitteilen, dass der Checkout 500er zurückgibt; kein Monitor kann ihnen mitteilen, dass Sie am Samstag Datenbanken migrieren, dass ein Drittanbieter einen schlechten Tag hat, oder dass der Vorfall, über den sie gestern gelesen haben, vollständig behoben ist. Ankündigungen sind der Freitext-Kanal für alles, was Ihre Prüfungen nicht sehen können, und sie gehen an dieselbe Abonnentenliste hinaus.

Diese Seite behandelt beides: die fünf Abonnement-Kanäle und wie Besucher sich anmelden, worauf Abonnenten sich beschränken können, die Double-Opt-in- und Abmelde-Abläufe sowie wie Ankündigungen geschrieben, geplant und mit Vorlagen versehen werden.

## Abonnement-Kanäle

Eine Statusseite unterstützt fünf Kanäle, jeder mit einem eigenen Schalter auf der Statusseite. Gehen Sie zu **Status Pages → your page → Subscribers → Subscriber Settings**:

- **Enable Email Subscribers** (`enableEmailSubscribers`) – standardmäßig aktiviert. Alles andere ist deaktiviert, bis Sie es einschalten.
- **Enable SMS Subscribers** (`enableSmsSubscribers`) – standardmäßig deaktiviert.
- **Enable Slack Subscribers** (`enableSlackSubscribers`) – standardmäßig deaktiviert.
- **Enable Microsoft Teams Subscribers** (`enableMicrosoftTeamsSubscribers`) – standardmäßig deaktiviert.
- **Enable Webhook Subscribers** (`enableWebhookSubscribers`) – standardmäßig deaktiviert.

Jeder Kanal erhält außerdem seine eigene Liste im Seitenmenü der Statusseite unter **Subscribers**: **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers** und **Webhook Subscribers**. Dort sehen Sie, wer angemeldet ist, fügen jemanden von Hand hinzu, oder hinterlassen sich selbst einen **Notes**-Eintrag (`internalNote`) zu einem bestimmten Abonnenten.

**Ein Schalter allein genügt nicht.** Der Menüpunkt **Subscribe** in der Navigationsleiste der Statusseite erscheint nur, wenn **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) aktiviert *und* mindestens ein Kanal freigeschaltet ist. Wenn Sie **Enable Email Subscribers** aktivieren, aber **Show Subscriber Page** deaktiviert lassen, haben Besucher keine Möglichkeit, das Formular zu erreichen.

Dieselben fünf Schalter erscheinen ein zweites Mal in der Karte **Subscriber Settings** auf **Advanced Settings**, neben **Show Subscriber Page**. Es sind darunter dieselben Spalten – wählen Sie einen Bildschirm und bleiben Sie dabei, und bevorzugen Sie die dedizierte Seite **Subscriber Settings**, da dort der Rest der Abonnentenkonfiguration lebt.

## Was ein Besucher auf der Subscribe-Seite sieht

Die Seite **Subscribe** hat ein Untermenü mit einem Tab pro aktiviertem Kanal – **Email**, **SMS**, **Slack**, **MS Teams**, **Webhooks** – zugeordnet zu `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` und `/subscribe/webhooks`. Jeder Tab fragt nach dem Minimum, das er benötigt:

- **Email** – Überschrift **Subscribe by Email**, ein Feld **Your Email** mit dem Platzhalter `subscriber@company.com`.
- **SMS** – Überschrift **Subscribe by SMS**, ein Feld **Your Phone Number** mit dem Platzhalter `+11234567890`.
- **Slack** – Überschrift **Subscribe by Slack**, mit **Slack Workspace Name** (zur Validierung verwendet) und **Slack Incoming Webhook URL**, Platzhalter `https://hooks.slack.com/services/...`.
- **MS Teams** – Überschrift **Subscribe by Microsoft Teams**, mit **Microsoft Teams Workspace Name** und **Microsoft Teams Incoming Webhook URL**, Platzhalter `https://outlook.office.com/webhook/...`.
- **Webhooks** – Überschrift **Subscribe by Webhook**, ein Feld **Webhook URL**. Bei jedem Statusseiten-Ereignis wird dorthin ein JSON-`POST`-Request gesendet.

Die Schaltfläche zum Absenden trägt die Beschriftung **Subscribe**, und eine erfolgreiche Anmeldung zeigt *You have been subscribed successfully.* Die Seite trägt außerdem eine Aufteilung **New Subscription** / **Manage Existing Subscription**, sodass jemand, der bereits abonniert hat, zu seinen Einstellungen zurückfinden kann, ohne nach einer alten E-Mail zu suchen.

## Abonnenten Ressourcen und Ereignistypen wählen lassen

Standardmäßig erhält ein Abonnent alles auf der Seite. Zwei Schalter in der Karte **Advanced Subscriber Settings** ändern das:

- **Allow Subscribers to Choose Resources** (`allowSubscribersToChooseResources`) – standardmäßig deaktiviert. Schalten Sie es ein, und dem Anmeldeformular wächst ein Schalter **Subscribe to All Resources**; deaktivieren Sie ihn, und **Select Resources to Subscribe** erscheint, sodass der Besucher einzelne Ressourcen auswählen kann.
- **Allow Subscribers to Choose Event Types** (`allowSubscribersToChooseEventTypes`) – standardmäßig deaktiviert. Gleiche Form: ein Schalter **Subscribe to All Event Types**, und darunter **Select Event Types to Subscribe**, wenn er deaktiviert ist.

Die Ereignistypen sind `Incident`, `Announcement` und `Scheduled Event`.

Die Auswahlen landen auf dem Abonnentendatensatz als **Is Subscribed to All Resources** (`isSubscribedToAllResources`, Standard true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, Standard true), **Subscribed to Resources** und **Subscribed to Event Types**.

Gut für: eine Seite, die mehrere Produkte abdeckt. Ein Kunde, der nur Ihre API nutzt, möchte keine Seite jedes Mal, wenn die Marketing-Website wackelt – lassen Sie ihn die Liste selbst eingrenzen, statt zuzusehen, wie er sich ganz abmeldet.

Dieselbe Karte trägt auch **Subscriber Timezones**.

## Double-Opt-in bei E-Mail

E-Mail-Abonnenten bestätigen immer. Wenn ein Abonnent mit einer E-Mail-Adresse erstellt wird und nicht bereits als bestätigt angelegt wurde, wird **Is Subscription Confirmed** (`isSubscriptionConfirmed`) auf `false` gezwungen, und ein sechsstelliges **Subscription Confirmation Token** wird erzeugt. OneUptime versendet dann einen Bestätigungslink der Form `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Der Besucher landet auf einer Seite **Confirm Subscription** und sieht, sobald diese durchgeht, *Subscription confirmed successfully*.

SMS-, Slack-, Microsoft-Teams- und Webhook-Abonnenten überspringen dies – sie werden mit `isSubscriptionConfirmed` bereits auf `true` gesetzt erstellt.

**Unbestätigt bedeutet stumm.** Die Abfrage, die Abonnenten für eine Benachrichtigung holt, filtert auf `isUnsubscribed: false` und `isSubscriptionConfirmed: true`. Eine E-Mail-Adresse, die nie auf den Link geklickt hat, sitzt in Ihrer Liste **Email Subscribers** und erhält nichts. Wenn jemand beteuert, abonniert zu sein, aber nichts hört, prüfen Sie zuerst diese Spalte.

Es gibt keinen Schalter, um die E-Mail-Bestätigung auszuschalten – sie ist bedingungslos für jeden, der sich über die Statusseite anmeldet. Eine separate Spalte pro Abonnent, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, Standard true), steuert die "Sie haben abonniert"-E-Mail, die verschickt wird, sobald ein Abonnent bestätigt ist.

## Ein Abonnement verwalten und kündigen

Jede Abonnenten-E-Mail trägt einen Abmeldelink der Form `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Diese Seite trägt den Titel **Update Subscription** und teilt dem Besucher mit, dass er dort seine Einstellungen aktualisieren oder sich abmelden kann. Sie enthält:

- Welche Ressourcen- und Ereignistyp-Auswahlmöglichkeiten die Seite auch zulässt.
- Einen Schalter **Unsubscribe**, beschrieben als Abmeldung von allen Ressourcen. Er schreibt **Is Unsubscribed** (`isUnsubscribed`, Standard false).
- Eine Schaltfläche zum Absenden mit der Beschriftung **Update Subscription**; das Speichern zeigt *Your changes have been saved.*

Jemand, der den Link verloren hat, verwendet **Manage Existing Subscription** auf der Seite **Subscribe** und drückt **Send Management Link**. OneUptime antwortet, dass eine E-Mail mit dem Link gesendet wurde und man den Spam-Ordner prüfen soll, falls sie nicht ankommt.

Die dahinterliegenden Endpunkte sind `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` und `PUT .../update-subscription/:statusPageId/:subscriberId`.

Das Abmelden kippt ein Flag, statt eine Zeile zu löschen, sodass der Datensatz in der Kanalliste verbleibt, wobei **Is Unsubscribed** gesetzt ist – nützlich, wenn Sie später erklären müssen, warum eine bestimmte Adresse aufgehört hat, Mails zu erhalten.

## Worüber Abonnenten benachrichtigt werden

Abonnenten hören von den drei oben genannten Ereignistypen, aber jede Quelle hat ihren eigenen Schalter, sodass nichts versehentlich versendet wird.

### Ankündigungs-Benachrichtigungen

Die Ankündigung selbst trägt **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), auf dem Erstellungsformular als Checkbox **Notify Status Page Subscribers** dargestellt und standardmäßig aktiviert. Wenn die Ankündigung unter **Monitors affected (Optional)** Monitore benennt, ist die Benachrichtigung auf diese Monitore beschränkt; lassen Sie es leer, werden alle Abonnenten benachrichtigt.

### Geplante Wartungsereignisse

Ein geplantes Wartungsereignis hat seine eigenen Abonnentenspalten: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, sowie **Subscriber notifications before the event** und **Next subscriber notification before the event at?** für Vorabwarnungen. **Status Pages** am Ereignis entscheidet, auf welchen Seiten es erscheint, und **Should be visible on status page?** entscheidet, ob es überhaupt erscheint.

### Vorfälle

`Incident` ist der dritte Ereignistyp. Was einen Vorfall überhaupt erst auf eine Statusseite bringt – welche Ressourcen er betrifft und welche Status ihn sichtbar halten – ist in [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) behandelt.

Der Abschnitt **Notification Logs** im Seitenmenü der Statusseite (`{id}/notification-logs`) ist der Ort, an den Sie gehen, wenn Sie sehen müssen, was die Seite tatsächlich versendet hat.

## Benachrichtigungsvorlagen anpassen

Die Karte **Notification Templates** auf **Subscriber Settings** listet die von dieser Statusseite verwendeten Vorlagen auf, mit den Spalten **Template Name**, **Event Type** und **Notification Method** – so können Sie den Wortlaut pro Ereignistyp und pro Kanal variieren, statt für alles eine einzige Standardnachricht zu akzeptieren.

Projektweite Vorlagen liegen eine Ebene höher, unter **Status Pages → Settings → Subscriber Templates**, neben **Announcement Templates**.

## E-Mail-Fußzeile, benutzerdefiniertes SMTP und Twilio

Drei weitere Karten auf **Subscriber Settings** steuern, wie Abonnentennachrichten Ihr Projekt verlassen:

- **Email Footer Settings** – **Enable Custom Email Footer Text** und **Subscriber Email Notification Footer Text** setzen Ihre eigene Fußzeile auf Abonnenten-E-Mails.
- **Custom SMTP** – **Custom SMTP Config** sendet Abonnenten-E-Mails über Ihren eigenen Mailserver statt über den Standard.
- **Twilio Config** – **Twilio Config** ist das für SMS-Abonnenten verwendete Twilio-Konto.

Benutzerdefiniertes SMTP lohnt sich früh, wenn Sie E-Mail-Abonnenten haben: Mail, die von Ihrer eigenen Domain kommt, wird weit seltener herausgefiltert und weit eher von dem Kunden vertraut, der sie um 2 Uhr morgens liest.

## Ankündigungen

Eine Ankündigung ist ein projektweiter Datensatz (das Modell `StatusPageAnnouncement`), den Sie an eine oder mehrere Statusseiten ausstrahlen, optional auf bestimmte Monitore beschränkt, mit einem Zeitfenster, während dessen sie angezeigt wird.

Sie erstellen eine über **Status Pages → More → Announcements**, oder über **Announcements** im Seitenmenü einer einzelnen Statusseite. Das Erstellungsformular ist ein vierstufiger Assistent:

1. **Basic Information** – **Announcement Title** (erforderlich, mindestens zwei Zeichen), **Description** (Markdown, optional) und **Attachments** für Dateien, die zusammen mit der Ankündigung auf der Statusseite verfügbar sein sollen.
2. **Status Pages** – **Show announcement on these status pages**, eine erforderliche Mehrfachauswahl. Eine Ankündigung kann mehrere Seiten gleichzeitig ansprechen.
3. **Resources Affected** – **Monitors affected (Optional)**. Wählen Sie keinen aus, werden alle Abonnenten benachrichtigt.
4. **Schedule & Settings** – **Start Showing Announcement At** (erforderlich, standardmäßig jetzt), **End Showing Announcement At** (optional) und **Notify Status Page Subscribers** (standardmäßig aktiviert).

Besucher lesen Ankündigungen unter `/announcements`, aufgeteilt in **Active Announcements** und **Past Announcements**, jeweils mit **Announced at** versehen. Derzeit laufende Ankündigungen werden außerdem oben auf der Übersichtsseite angeheftet. Wenn es nichts anzuzeigen gibt, zeigt die Seite *No Announcement* mit dem Hinweis, dass bisher noch keine veröffentlicht wurden.

Anhänge werden von `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId` ausgeliefert, hinter derselben Leseprüfung wie die Statusseite selbst – sodass ein Anhang an einer privaten Seite privat bleibt.

## Wie die Ankündigungsplanung funktioniert

**Show At** (`showAnnouncementAt`) und **End At** (`endAnnouncementAt`) steuern alles, aber die Übersichtsseite und die Ankündigungsliste stellen unterschiedliche Fragen, und der Unterschied bringt Leute zu Fall.

- **Die Übersichtsseite** zeigt eine Ankündigung, wenn `showAnnouncementAt` in der Vergangenheit liegt und `endAnnouncementAt` entweder in der Zukunft liegt oder leer ist.
- **Die Liste `/announcements`** zeigt Ankündigungen, deren `showAnnouncementAt` innerhalb von **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`, Standard 14) liegt, und teilt sie dann clientseitig in aktive und vergangene auf.

Zwei Konsequenzen, mit denen Sie planen sollten:

- **Eine Ankündigung ohne Enddatum läuft nie ab.** Lassen Sie **End Showing Announcement At** leer, bleibt sie unbegrenzt oben auf der Übersichtsseite angeheftet. Setzen Sie ein Enddatum bei allem, was zeitlich begrenzt ist.
- **Eine alte, aber noch aktive Ankündigung kann aus der Liste verschwinden.** Wenn sie vor mehr als `showAnnouncementHistoryInDays` Tagen begonnen hat, fällt sie aus `/announcements` heraus, bleibt aber auf der Übersicht. Erhöhen Sie das Historienfenster, wenn Sie langlaufende Hinweise pflegen.

Ob Ankündigungen überhaupt erscheinen, wird über die Karte **Announcement Settings** auf **Advanced Settings** gesteuert: **Show Announcements** (`showAnnouncementsOnStatusPage`, Standard true) und **Show Announcement History (in days)** (Standard 14). Ist **Show Announcements** deaktiviert, verweigert der Ankündigungs-Endpunkt die Anfrage rundweg.

## Ankündigungsvorlagen

Wenn Sie wiederholt dieselbe Art von Hinweis posten – eine monatliche Wartungsankündigung, eine wiederkehrende Beeinträchtigung eines Drittanbieters – legen Sie sie auf Vorrat an. **Status Pages → Settings → Announcement Templates** speichert das Modell `StatusPageAnnouncementTemplate`, und sein Formular fragt nach **Template Name**, **Template Description**, **Announcement Title**, **Description**, **Show announcement on these status pages**, **Monitors affected (Optional)** und **Notify Subscribers**, sodass die Ausstrahlung und die Benachrichtigungsentscheidung einmal getroffen werden statt jedes Mal.

## Webhook-Abonnenten und SSRF-Schutz

Webhook-Abonnenten erhalten bei jedem Statusseiten-Ereignis einen JSON-`POST`-Request, was sie zum einfachsten Weg macht, Statusseiten-Updates in ein eigenes System einzuspeisen – einen Chatbot, ein internes Dashboard, eine Ticket-Warteschlange.

Da das Abonnieren eine öffentliche Operation auf einer öffentlichen Seite ist, schützt OneUptime das Ziel:

- Eine generische **Webhook URL** wird vor der Annahme validiert, und private, Loopback-, Link-lokale und Cloud-Metadaten-Adressen werden abgelehnt. Sie können ein Abonnement nicht auf etwas innerhalb des eigenen Netzwerks der OneUptime-Bereitstellung richten.
- Eine **Slack Incoming Webhook URL** muss mit `https://hooks.slack.com/services/` beginnen.

Wird ein Webhook-Abonnement bei der Anmeldung abgelehnt, ist eine interne oder fehlerhafte URL das Erste, was Sie prüfen sollten.

## Weiterführende Themen

- [Statusseiten – Übersicht](/docs/status-pages/index) – was eine Statusseite ist und wie sie aufgebaut ist.
- [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups) – die Monitore und Gruppen, zwischen denen Abonnenten wählen können.
- [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains) – benutzerdefinierte Domains, Logos und das Aussehen der Seite, auf die Ihre E-Mails verlinken.
- [Öffentliche Status-Seiten-API](/docs/status-pages/public-api) – Statusseitendaten programmgesteuert lesen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was einen Vorfall auf eine Statusseite bringt und was ihn wieder entfernt.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – die projektweiten Regeln hinter der Vorfallkommunikation.
