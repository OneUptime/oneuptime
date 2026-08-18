# Statusseiten – Übersicht

Eine Statusseite ist das öffentliche Gesicht von allem, was Sie überwachen: eine URL, die Ihre Kunden öffnen können, statt Ihnen zu mailen und zu fragen, ob es nur bei ihnen hakt. Sie zeigt den aktuellen Zustand der Dienste, die Sie sichtbar machen möchten, die Vorfälle, an denen Sie gerade arbeiten, die geplante Wartung und jede Ankündigung, die Sie oben anheften möchten.

Wenn um 2 Uhr nachts etwas kaputtgeht, ist die Statusseite das Erste, worauf Ihre Support-Warteschlange verlinkt. Sie ist auch das, wovon Ihre Abonnenten benachrichtigt werden – es lohnt sich also, sie einzurichten, bevor Sie sie brauchen, nicht während des Ausfalls.

Statusseiten leben unter **Status Pages** in der linken Navigation des Dashboards, in der Gruppe **essentials**. Alles auf dieser Seite gilt pro Statusseite: Ein Projekt kann davon so viele betreiben, wie es möchte – eine öffentliche für Kunden, eine private für ein internes Publikum, eine pro Region für einen bestimmten Markt.

## Auf einen Blick

- **Mit zwei Feldern erstellt.** Eine neue Statusseite fragt nur nach **Name** und **Description**. Ressourcen, Branding und Domains werden alle im Nachhinein konfiguriert.
- **Ressourcen sind das, was Besucher sehen.** Jede Zeile auf der Seite ist eine **Status Page Resource** – ein Monitor (oder eine Monitor-Gruppe) mit eigenem Anzeigenamen, Tooltip und Verfügbarkeitsoptionen. Gruppen unterteilen eine lange Seite in Abschnitte und können verschachtelt werden.
- **Von Tag eins an eine Vorschau-URL.** Jede Statusseite erhält einen Vorschaulink, damit Sie sie ansehen können, bevor eine eigene Domain existiert.
- **Besucherseitige Routen sind über Einstellungen geregelt.** Vorfälle, Ankündigungen, geplante Ereignisse und die Abonnieren-Seite erscheinen jeweils nur, wenn ihr Schalter unter **Advanced Settings** aktiviert ist.
- **Drei Wege, sie privat zu machen.** Private Benutzer, ein Master-Passwort oder SAML-SSO/OIDC – plus eine IP-Whitelist.
- **Abonnenten werden automatisch informiert.** E-Mail-, SMS-, Slack-, Microsoft-Teams- und Webhook-Abonnenten können alle einer Seite folgen, jeder Kanal hinter seinem eigenen Schalter.

## Wichtige Begriffe

| Begriff                | Bedeutung                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statusseite**         | Eine öffentliche (oder private) Seite mit eigenem Branding, eigenen Domains, Ressourcen und Abonnenten. Das Modell `StatusPage`.           |
| **Ressource**           | Eine Zeile, die Besucher sehen – ein Monitor oder eine Monitor-Gruppe, dargestellt auf der Seite mit Anzeigename und Verfügbarkeitsoptionen. |
| **Gruppe**              | Ein benannter Abschnitt, der Ressourcen enthält. Gruppen verschachteln sich in anderen Gruppen, und jede Ebene fasst den Status von allem darunter zusammen. |
| **Ankündigung**         | Eine Nachricht, die Sie auf einer oder mehreren Statusseiten veröffentlichen, mit einer Startzeit und einer optionalen Endzeit.             |
| **Abonnent**            | Jemand (oder etwas), der der Seite über E-Mail, SMS, Slack, Microsoft Teams oder einen Webhook folgt.                                       |
| **Benutzerdefinierte Domain** | Eine eigene Domain – `status.beispiel.de` –, die per CNAME und SSL-Zertifikat auf die Seite zeigt.                                    |
| **Privater Benutzer**   | Ein Konto, das sich bei einer privaten Statusseite anmelden kann. Getrennt von Ihren OneUptime-Projektbenutzern.                            |

## Eine Statusseite erstellen

1. Öffnen Sie **Status Pages → All Status Pages** und klicken Sie auf **Create Status Page**.
2. Füllen Sie im Modal **Create New Status Page** **Name** (erforderlich, mindestens zwei Zeichen) und optional **Description** aus.
3. Klicken Sie auf **Create Status Page**.

Das ist das gesamte Erstellungsformular. Die Liste, auf der Sie danach landen, zeigt **Name**, **Description**, **Labels** und **Owners** und lässt sich nach **Status Page ID**, **Name** und **Description** filtern.

Öffnen Sie die neue Seite, landen Sie auf ihrem **Overview**-Bildschirm, der zwei Karten trägt: **Status Page Preview URL** mit einem Link zur Seite selbst, und **Status Page Details**, wo Sie den Namen, die Beschreibung und die Labels bearbeiten können, die Sie gerade gesetzt haben.

Als Nächstes, in grober Reihenfolge der Nützlichkeit:

- Fügen Sie Ressourcen hinzu, damit auf der Seite etwas zu sehen ist – siehe [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups).
- Legen Sie Seitentitel, Favicon, Logo und Titelbild fest und binden Sie dann eine eigene Domain ein – siehe [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains).
- Entscheiden Sie, über welche Kanäle Personen abonnieren können – siehe [Abonnenten & Ankündigungen](/docs/status-pages/subscribers).
- Stellen Sie unter **Advanced Settings** ein, was auf der Seite erscheint.

## Wo alles liegt

Sobald eine Statusseite geöffnet ist, ist ihr eigenes linkes Seitenmenü in neun Abschnitte gruppiert. Verwenden Sie dies als Landkarte für den Rest dieser Dokumentationsgruppe.

| Abschnitt              | Was darin ist                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic**               | **Overview**, **Announcements**, **Owners**.                                                                                                        |
| **Resources**           | Ein einzelner Bildschirm **Resources** – Gruppen links, die Monitore der ausgewählten Gruppe rechts.                                                |
| **Subscribers**         | **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers**, **Webhook Subscribers**, **Subscriber Settings**.     |
| **Notification Logs**   | **Notification Logs** – was an Abonnenten gesendet wurde.                                                                                            |
| **Audit**               | **Audit Logs**.                                                                                                                                       |
| **Branding**            | **Essential Branding**, **HTML, CSS & JavaScript**, **Custom Domains**, **Header**, **Footer**, **Overview Page**, **Languages**.                    |
| **Security**            | **Private Users**, **SSO**, **OIDC**, **SCIM**, **Authentication Settings**.                                                                          |
| **AI**                  | **MCP**.                                                                                                                                               |
| **Advanced**            | **Monitor Rules**, **Embedded Status**, **Reports**, **Custom Fields**, **Advanced Settings**, **Delete Status Page**.                                |

Zwei Namensbesonderheiten, die es sich zu kennen lohnt, bevor Sie danach suchen:

- Der Eintrag **Resources** heißt nur dann **Resources**, wenn im Projekt Monitor-Gruppen aktiviert sind. Andernfalls heißt er **Monitors**. Es ist so oder so derselbe Bildschirm.
- Es gibt keine separate Groups-Seite. Gruppen und Ressourcen wurden zusammengeführt, und die alte Route `/groups` leitet jetzt auf den Resources-Bildschirm weiter.

Außerhalb einer einzelnen Seite hat der Abschnitt **Status Pages** selbst einen Bereich **More** mit **Announcements** sowie einen eingeklappten Abschnitt **Settings** mit **Announcement Templates**, **Subscriber Templates**, **Custom Fields**, **Owner Rules** und **Label Rules** – diese gelten projektweit, geteilt über alle Statusseiten hinweg.

## Was Besucher sehen

Die öffentliche Seite ist eine eigenständige App mit einer kleinen Menge an Routen:

- `/` – die **Overview**.
- `/incidents` und `/incidents/:id` – die Vorfallliste und ein einzelner Vorfall.
- `/announcements` und `/announcements/:id`.
- `/scheduled-events` und `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` – der Feed.
- `/login`, `/sso` und `/master-password` – nur bei einer privaten Seite relevant.

Die obere Navigationsleiste zeigt immer **Overview**; der Rest erscheint nur, wenn aktiviert. **Incidents**, **Announcements** und **Scheduled Events** benötigen jeweils ihren eigenen Schalter; **Subscribe** benötigt sowohl **Show Subscriber Page** als auch mindestens einen aktivierten Abonnentenkanal. Eine private Seite erhält zusätzlich einen Eintrag **Logout**.

### Die Übersichtsseite

Die Übersicht ist die Seite, die die meisten Besucher jemals sehen. Von oben nach unten zeigt sie:

1. **Alle laufenden Ankündigungen** – Ankündigungen, deren Startzeit vergangen ist und deren Endzeit noch nicht erreicht wurde.
2. **Ein Gesamtstatus-Banner** – eine einzelne Zeile, die zusammenfasst, ob alle oder nur einige Ressourcen betroffen sind.
3. **Einen prozentualen Gesamtverfügbarkeitswert**, sofern Sie ihn aktiviert haben. Standardmäßig aus.
4. **Die Ressourcengruppen**, jeweils mit ihren Ressourcen, deren aktuellem Status und ihren Verfügbarkeitsverlaufsbalken.
5. **Active Incidents**.
6. **Scheduled Maintenance Events**.

Eine brandneue Seite, auf der noch nichts liegt, zeigt einen leeren Zustand, der Sie auffordert, Ressourcen aus dem Dashboard hinzuzufügen – Ihr Stichwort, um zum Bildschirm **Resources** zu gehen.

Was einen Vorfall überhaupt erst auf diese Seite bringt und was ihn wieder entfernt, erfahren Sie unter [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

## Auswählen, was auf der Seite erscheint

Die meisten Anzeigeschalter liegen an einem einzigen Ort: **Status Pages → Ihre Seite → Advanced → Advanced Settings**. Jede Karte hat ihre eigene Schaltfläche **Edit Settings**.

**Incident Settings**:

- **Show Incidents** (`showIncidentsOnStatusPage`) – standardmäßig an. Wird es ausgeschaltet, entfernt das auch den Navigationseintrag **Incidents**.
- **Show Incident History (in days)** (`showIncidentHistoryInDays`) – wie weit die Vorfallliste zurückreicht. Standardmäßig 14.
- **Show Incident Labels** (`showIncidentLabelsOnStatusPage`) – standardmäßig aus.

**Episode Settings** – dieselben drei Schalter für Vorfall-Episoden: **Show Episodes** (`showEpisodesOnStatusPage`, standardmäßig an), **Show Episode History (in days)** (Standard 14) und **Show Episode Labels** (standardmäßig aus). Episoden sind ihr eigenes Modell mit eigenen Endpunkten, keine Ansicht von Vorfällen.

**Announcement Settings**:

- **Show Announcements** (`showAnnouncementsOnStatusPage`) – standardmäßig an.
- **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`) – standardmäßig 14.

**Scheduled Event Settings**:

- **Show Scheduled Maintenance Events** (`showScheduledMaintenanceEventsOnStatusPage`) – standardmäßig an.
- **Show Scheduled Event History (in days)** (`showScheduledEventHistoryInDays`) – standardmäßig 14.
- **Show Event Labels** (`showScheduledEventLabelsOnStatusPage`) – standardmäßig aus.

**Uptime History Settings**:

- **Show Uptime History (in days)** (`showUptimeHistoryInDays`) – die Länge des Verfügbarkeitsbalkens neben jeder Ressource. Standardmäßig 90 und muss zwischen 1 und 90 liegen. Jede Option **Show Uptime %** und **Show Status History Chart** an einer Ressource oder Gruppe liest diese Zahl.

**Subscriber Settings**:

- **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) – standardmäßig an, plus die fünf kanalspezifischen Aktivierungsschalter. Dieselben Kanalschalter erscheinen auch auf dem eigenen Bildschirm **Subscriber Settings** im Abschnitt **Subscribers**; behandeln Sie diesen als den maßgeblichen Ort, um sie zu setzen.

**Powered By OneUptime Branding**:

- **Hide Powered By OneUptime Branding** – standardmäßig aus, sodass die Besucher-Fußzeile „Powered by OneUptime" anzeigt, bis Sie dies aktivieren.

**Wo die Farben sind.** Die Farben des Verfügbarkeitsbalkens liegen nicht hier – **Default Bar Color**, die Balkenfarbregeln, **Downtime Monitor Statuses** und **Show Overall Uptime Percent** liegen alle unter **Status Pages → Ihre Seite → Branding → Overview Page**. Es gibt nirgendwo eine Theme- oder Markenfarbeinstellung; alles darüber hinaus wird mit **Custom CSS** erledigt.

## Vorschau, bevor Sie live gehen

Der Bildschirm **Overview** jeder Statusseite trägt eine Karte **Status Page Preview URL** mit einem direkten Link zur Seite. Nutzen Sie sie, während Sie noch Ressourcen hinzufügen und bevor eine eigene Domain existiert.

Im Hintergrund hat jede öffentliche Route eine Vorschauzwillingsroute unter `/status-page/{statusPageId}/...` – eine Vorschauübersicht, eine Vorschau-Vorfallliste, eine Vorschau-Abonnieren-Seite und so weiter. Das bedeutet, dass eine URL oder ein Screenshot aus der Dashboard-Vorschau nicht dem entspricht, was ein Kunde sieht, sobald eine eigene Domain eingebunden ist – prüfen Sie also jeden Link, den Sie in ein Runbook oder eine E-Mail einfügen, noch einmal.

## Einschränken, wer die Seite sehen kann

Nicht jede Statusseite ist für die Öffentlichkeit. Alle Steuerungen liegen im Abschnitt **Security**.

### Private Benutzer

Schalten Sie **Is Visible to Public** unter **Status Pages → Ihre Seite → Security → Authentication Settings** aus (die Spalte `isPublicStatusPage`). Besucher landen dann auf `/login` und müssen sich anmelden.

Fügen Sie die Personen, die sich anmelden dürfen, unter **Status Pages → Ihre Seite → Security → Private Users** hinzu. Es gibt eine Aktion **Add in Bulk** – fügen Sie eine Liste von E-Mail-Adressen ein, und jede erhält eine Einladungs-E-Mail. Private Benutzer haben ihren eigenen Passwort-vergessen- und Passwort-zurücksetzen-Ablauf, getrennt von Ihren OneUptime-Projektkonten.

### Master-Passwort

**Authentication Settings** hat außerdem eine Karte **Master Password** mit einem Schalter **Require Master Password** und dem Passwort selbst. Besucher gelangen dann auf `/master-password` und schalten die Seite mit einem einzigen gemeinsamen Geheimnis frei.

**Master-Passwort und private Benutzer lassen sich nicht kombinieren.** Solange das Master-Passwort aktiv ist, ist die Authentifizierung privater Benutzer deaktiviert, und der Bildschirm **Private Users** zeigt einen entsprechenden Hinweis.

### SSO und OIDC

Für eine private Seite, die an Ihren Identitätsanbieter gebunden ist, konfiguriert **Status Pages → Ihre Seite → Security → SSO** SAML (Anmelde-URL, Aussteller, x509-Zertifikat, Signatur- und Digest-Methoden) und **Status Pages → Ihre Seite → Security → OIDC** konfiguriert OpenID Connect (Discovery-URL, Aussteller, Client-ID und -Secret, Scopes, Claim-Namen). **SCIM** versorgt private Benutzer automatisch vom IdP aus. Diese sind hinter einer Plan-Funktion verriegelt und daher möglicherweise nicht in jeder Installation verfügbar.

Eine Karte **SSO Settings** stellt **Force SSO for Login** (`requireSsoForLogin`, standardmäßig aus) bereit. Testen Sie Ihre SSO-Konfiguration, bevor Sie sie aktivieren – funktioniert sie nicht, sperren Sie sich selbst aus der Statusseite aus.

### IP-Whitelist

**Authentication Settings** trägt außerdem eine Karte **IP Whitelist**, die auf der Spalte `ipWhitelist` beruht, für Seiten, die nur aus bekannten Netzwerken antworten sollen.

## Das einbettbare Badge und der RSS-Feed

Zwei Wege, um den Status auch außerhalb der Seite selbst sichtbar zu machen.

**Eingebettetes Status-Badge.** Aktivieren Sie **Enable Embedded Status Badge** (`enableEmbeddedOverallStatus`, standardmäßig aus) in der Karte **Embedded Status Badge** unter **Status Pages → Ihre Seite → Advanced → Embedded Status**. Es geht mit einem `embeddedOverallStatusToken` einher und liefert das Badge über `/badge/:statusPageId`, sodass Sie den aktuellen Gesamtstatus in Ihre Dokumentation, die Fußzeile Ihrer App oder eine Marketingseite einbinden können.

**RSS-Feed.** Jede Statusseite stellt `/rss` bereit – einen Feed mit dem Titel „{Name der Statusseite} Updates", dessen Einträge mit `Incident: `, `Announcement: ` und `Scheduled Maintenance: ` beginnen. Praktisch für Personen, die Ihre Updates lieber in einen Reader oder einen Chatbot einspeisen, als sie per E-Mail zu abonnieren.

Wenn Sie die Daten lieber selbst abrufen möchten: Die Statusseite wird von öffentlichen Lese-Endpunkten für Übersicht, Vorfälle, geplante Wartungsereignisse, Ankündigungen und Episoden unterstützt – siehe [Öffentliche API](/docs/status-pages/public-api).

## Wo Sie als Nächstes lesen sollten

- [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups) – Monitore auf die Seite bringen und in Abschnitte gliedern.
- [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains) – Logo, Favicon, Fußzeile, benutzerdefinierter Code und das Einbinden Ihrer eigenen Domain auf der Seite.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – die fünf Abonnentenkanäle, Double-Opt-in und das Veröffentlichen von Ankündigungen.
- [Öffentliche API](/docs/status-pages/public-api) – Statusseitendaten programmatisch lesen.
- [Vorfälle – Übersicht](/docs/incidents/index) – die Ereignisse, die auf der Seite erscheinen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was einen Vorfall auf einer Statusseite erscheinen lässt und was ihn wieder entfernt.
