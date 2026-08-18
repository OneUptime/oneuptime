# Statusseiten – Übersicht

Eine Statusseite ist das öffentliche Gesicht von allem, was Sie überwachen: eine einzige URL, die Ihre Kunden aufrufen können, statt Ihnen zu schreiben und zu fragen, ob es nur bei ihnen klemmt. Sie zeigt den aktuellen Zustand der Dienste, die Sie sichtbar machen, die Vorfälle, an denen Sie gerade arbeiten, die Wartungen, die Sie geplant haben, und jede Ankündigung, die Sie oben anheften möchten.

Wenn um 2 Uhr nachts etwas kaputtgeht, ist die Statusseite das Erste, was Ihre Support-Warteschlange verlinkt. Und sie ist die Quelle, aus der Ihre Abonnenten benachrichtigt werden – es lohnt sich also, sie einzurichten, bevor Sie sie brauchen, und nicht mitten im Ausfall.

Statusseiten liegen unter **Statusseiten** in der linken Navigation des Dashboards, in der Gruppe **essentials**. Alles auf dieser Seite gilt pro Statusseite: Ein Projekt darf beliebig viele davon betreiben – eine öffentliche für Kunden, eine private für ein internes Publikum, eine pro Region für einen bestimmten Markt.

## Auf einen Blick

- **Mit zwei Feldern angelegt.** Eine neue Statusseite fragt nur nach **Name** und **Beschreibung**. Ressourcen, Branding und Domains richten Sie danach ein.
- **Ressourcen sind das, was Besucher sehen.** Jede Zeile der Seite ist eine **Statusseite Ressource** – ein Monitor (oder eine Monitorgruppe) mit eigenem Anzeigenamen, eigenem Tooltip und eigenen Verfügbarkeitsoptionen. Gruppen teilen eine lange Seite in Abschnitte und lassen sich verschachteln.
- **Eine Vorschau-URL ab dem ersten Tag.** Jede Statusseite bekommt einen Vorschaulink, damit Sie sie ansehen können, bevor es überhaupt eine eigene Domain gibt.
- **Die besucherseitigen Routen hängen an Einstellungen.** Vorfälle, Ankündigungen, geplante Ereignisse und die Abonnentenseite erscheinen jeweils nur, wenn ihr Schalter unter **Erweiterte Einstellungen** aktiviert ist.
- **Drei Wege, die Seite privat zu machen.** Private Benutzer, ein Master-Passwort oder SAML-SSO / OIDC – dazu eine IP-Whitelist.
- **Abonnenten werden automatisch informiert.** Abonnenten per E-Mail, SMS, Slack, Microsoft Teams und Webhook können einer Seite folgen, jeder Kanal hinter einem eigenen Schalter.

## Zentrale Begriffe

| Begriff                          | Was er bedeutet                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Statusseite**                  | Eine öffentliche (oder private) Seite mit eigenem Branding, eigenen Domains, Ressourcen und Abonnenten. Das Modell `StatusPage`.     |
| **Ressource**                    | Eine Zeile, die Besucher sehen – ein Monitor oder eine Monitorgruppe, auf der Seite mit Anzeigename und Verfügbarkeitsoptionen dargestellt. |
| **Gruppe**                       | Ein benannter Abschnitt, der Ressourcen enthält. Gruppen lassen sich ineinander verschachteln, und jede Ebene fasst den Status von allem darunter zusammen. |
| **Ankündigung**                  | Eine Meldung, die Sie auf einer oder mehreren Statusseiten veröffentlichen, mit Startzeit und optionaler Endzeit.                    |
| **Abonnent**                     | Jemand (oder etwas), der der Seite per E-Mail, SMS, Slack, Microsoft Teams oder Webhook folgt.                                       |
| **Benutzerdefinierte Domain**    | Eine Domain von Ihnen – `status.example.com` –, die per CNAME und SSL-Zertifikat auf die Seite zeigt.                                |
| **Privater Benutzer**            | Ein Konto, das sich an einer privaten Statusseite anmelden kann. Getrennt von den Benutzern Ihres OneUptime-Projekts.                |

## Eine Statusseite anlegen

1. Öffnen Sie **Statusseiten → Alle Statusseiten** und klicken Sie auf **Statusseite erstellen**.
2. Füllen Sie im Dialog **Create New Status Page** das Feld **Name** (Pflicht, mindestens zwei Zeichen) und optional **Beschreibung** aus.
3. Klicken Sie auf **Statusseite erstellen**.

Das ist das ganze Erstellungsformular. Die Liste, auf der Sie wieder landen, zeigt **Name**, **Beschreibung**, **Beschriftungen** und **Eigentümer** und lässt sich nach **Statusseiten-ID**, **Name** und **Beschreibung** filtern.

Öffnen Sie die neue Seite, landen Sie auf ihrem Bildschirm **Übersicht** mit zwei Karten: **Status Page Preview URL** mit einem Link auf die Seite selbst und **Statusseiten-Details**, wo Sie Name, Beschreibung und Beschriftungen wieder bearbeiten können.

Als Nächstes, grob nach Nutzen sortiert:

- Fügen Sie Ressourcen hinzu, damit überhaupt etwas auf der Seite steht – siehe [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups).
- Setzen Sie Seitentitel, Favicon, Logo und Titelbild und hängen Sie eine eigene Domain an – siehe [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains).
- Entscheiden Sie, über welche Kanäle Menschen abonnieren können – siehe [Abonnenten & Ankündigungen](/docs/status-pages/subscribers).
- Stellen Sie unter **Erweiterte Einstellungen** ein, was auf der Seite erscheint.

## Wo alles liegt

Ist eine Statusseite geöffnet, gliedert sich ihr eigenes linkes Seitenmenü in neun Abschnitte. Nehmen Sie das als Landkarte für den Rest dieser Dokumentationsgruppe.

| Abschnitt                        | Was darin steckt                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Grundlegend**                  | **Übersicht**, **Ankündigungen**, **Eigentümer**.                                                                                              |
| **Ressourcen**                   | Ein einziger Bildschirm **Ressourcen** – links die Gruppen, rechts die Monitore der gewählten Gruppe.                                          |
| **Abonnenten**                   | **E-Mail-Abonnenten**, **SMS-Abonnenten**, **Slack-Abonnenten**, **MS Teams-Abonnenten**, **Webhook-Abonnenten**, **Abonnenten-Einstellungen**. |
| **Benachrichtigungsprotokolle**  | **Benachrichtigungsprotokolle** – was an Abonnenten gesendet wurde.                                                                             |
| **Audit**                        | **Audit-Protokolle**.                                                                                                                          |
| **Branding**                     | **Grundlegendes Branding**, **HTML, CSS und JavaScript**, **Benutzerdefinierte Domains**, **Kopfzeile**, **Fußzeile**, **Übersichtsseite**, **Sprachen**. |
| **Sicherheit**                   | **Private Benutzer**, **SSO**, **OIDC**, **SCIM**, **Authentifizierungseinstellungen**.                                                         |
| **KI**                           | **MCP**.                                                                                                                                       |
| **Erweitert**                    | **Monitor Rules**, **Eingebetteter Status**, **Berichte**, **Benutzerdefinierte Felder**, **Erweiterte Einstellungen**, **Statusseite löschen**. |

Zwei Benennungs-Eigenheiten, die Sie kennen sollten, bevor Sie suchen:

- Der Eintrag **Ressourcen** heißt nur dann **Ressourcen**, wenn im Projekt Monitorgruppen aktiviert sind. Sonst steht dort **Monitore**. Es ist in beiden Fällen derselbe Bildschirm.
- Eine eigene Gruppen-Seite gibt es nicht. Gruppen und Ressourcen wurden zusammengelegt, und die alte Route `/groups` leitet jetzt auf den Ressourcen-Bildschirm um.

Außerhalb einer einzelnen Seite hat der Bereich **Statusseiten** selbst einen Abschnitt **Mehr** mit **Ankündigungen** sowie einen eingeklappten Abschnitt **Einstellungen** mit **Ankündigungs-Vorlagen**, **Abonnenten-Vorlagen**, **Benutzerdefinierte Felder**, **Eigentümerregeln** und **Beschriftungsregeln** – die gelten projektweit und werden von allen Statusseiten geteilt.

## Was Besucher sehen

Die öffentliche Seite ist eine eigene Anwendung mit einer überschaubaren Menge an Routen:

- `/` – die **Übersicht**.
- `/incidents` und `/incidents/:id` – die Vorfallliste und ein einzelner Vorfall.
- `/announcements` und `/announcements/:id`.
- `/scheduled-events` und `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` – der Feed.
- `/login`, `/sso` und `/master-password` – nur auf einer privaten Seite relevant.

Die obere Navigationsleiste zeigt immer **Übersicht**; der Rest erscheint nur, wenn er aktiviert ist. **Vorfälle**, **Ankündigungen** und **Geplante Ereignisse** brauchen jeweils ihren Schalter; **Abonnieren** braucht **Abonnentenseite anzeigen** und mindestens einen aktivierten Abonnentenkanal. Eine private Seite bekommt zusätzlich den Eintrag **Abmelden**.

### Die Übersichtsseite

Die Übersicht ist die Seite, die die meisten Besucher überhaupt zu sehen bekommen. Von oben nach unten zeigt sie:

1. **Alle laufenden Ankündigungen** – Ankündigungen, deren Startzeit vorbei und deren Endzeit noch nicht erreicht ist.
2. **Ein Gesamtstatus-Banner** – eine einzelne Zeile, die zusammenfasst, ob alle oder nur einige Ressourcen betroffen sind.
3. **Einen Gesamtprozentsatz der Verfügbarkeit**, falls Sie ihn eingeschaltet haben. Standardmäßig aus.
4. **Die Ressourcengruppen**, jede mit ihren Ressourcen, deren aktuellem Status und deren Verfügbarkeitsverlaufs-Balken.
5. **Aktive Vorfälle**.
6. **Geplante Wartungsereignisse**.

Eine brandneue Seite ohne Inhalt zeigt einen Leerzustand, der Sie auffordert, Ressourcen über das Dashboard hinzuzufügen – Ihr Stichwort, zum Bildschirm **Ressourcen** zu wechseln.

Was einen Vorfall überhaupt auf diese Seite bringt und was ihn wieder herunternimmt, steht unter [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

## Auswählen, was auf der Seite erscheint

Die meisten Anzeigeschalter liegen an einer Stelle: **Statusseiten → Ihre Seite → Erweitert → Erweiterte Einstellungen**. Jede Karte hat ihre eigene Schaltfläche **Edit Settings**.

**Vorfall-Einstellungen**:

- **Vorfälle anzeigen** (`showIncidentsOnStatusPage`) – standardmäßig an. Schalten Sie den Schalter aus, verschwindet auch der Navigationseintrag **Vorfälle**.
- **Vorfallverlauf anzeigen (in Tagen)** (`showIncidentHistoryInDays`) – wie weit die Vorfallliste zurückreicht. Standard: 14.
- **Vorfallbeschriftungen anzeigen** (`showIncidentLabelsOnStatusPage`) – standardmäßig aus.

**Episodeneinstellungen** – dieselben drei Schalter für Vorfall-Episoden: **Episoden anzeigen** (`showEpisodesOnStatusPage`, standardmäßig an), **Episodenverlauf anzeigen (in Tagen)** (Standard 14) und **Episodenbeschriftungen anzeigen** (standardmäßig aus). Episoden sind ein eigenes Modell mit eigenen Endpunkten, keine Ansicht auf Vorfälle.

**Ankündigungseinstellungen**:

- **Ankündigungen anzeigen** (`showAnnouncementsOnStatusPage`) – standardmäßig an.
- **Ankündigungsverlauf anzeigen (in Tagen)** (`showAnnouncementHistoryInDays`) – Standard: 14.

**Einstellungen für geplante Ereignisse**:

- **Geplante Wartungsereignisse anzeigen** (`showScheduledMaintenanceEventsOnStatusPage`) – standardmäßig an.
- **Verlauf geplanter Ereignisse anzeigen (in Tagen)** (`showScheduledEventHistoryInDays`) – Standard: 14.
- **Ereignisbeschriftungen anzeigen** (`showScheduledEventLabelsOnStatusPage`) – standardmäßig aus.

**Einstellungen für Verfügbarkeitsverlauf**:

- **Verfügbarkeitsverlauf anzeigen (in Tagen)** (`showUptimeHistoryInDays`) – die Länge des Verfügbarkeitsbalkens neben jeder Ressource. Standard 90, erlaubt sind 1 bis 90. Jede Option **Verfügbarkeit % anzeigen** und **Statusverlaufsdiagramm anzeigen** an einer Ressource oder Gruppe liest diesen Wert.

**Abonnenten-Einstellungen**:

- **Abonnentenseite anzeigen** (`showSubscriberPageOnStatusPage`) – standardmäßig an, dazu die fünf Schalter für die einzelnen Kanäle. Dieselben Kanalschalter erscheinen auch auf dem eigenen Bildschirm **Abonnenten-Einstellungen** im Abschnitt **Abonnenten**; behandeln Sie diesen als den maßgeblichen Ort dafür.

**Branding „Powered By OneUptime“**:

- **Branding "Powered By OneUptime" ausblenden** – standardmäßig aus, in der Besucher-Fußzeile steht also „Powered by OneUptime“, bis Sie den Schalter umlegen.

**Wo die Farben stecken.** Die Farben der Verfügbarkeitsbalken sind nicht hier – **Standard-Balkenfarbe**, die Balkenfarb-Regeln, **Ausfallzeit-Monitorstatus** und **Gesamtprozentsatz der Verfügbarkeit anzeigen** liegen allesamt unter **Statusseiten → Ihre Seite → Branding → Übersichtsseite**. Eine Theme- oder Markenfarben-Einstellung gibt es nirgends; alles darüber hinaus machen Sie mit **Benutzerdefiniertes CSS**.

## Vorschau, bevor Sie live gehen

Der Bildschirm **Übersicht** jeder Statusseite trägt eine Karte **Status Page Preview URL** mit einem direkten Link auf die Seite. Nutzen Sie ihn, solange Sie noch Ressourcen hinzufügen und es noch keine eigene Domain gibt.

Hinter den Kulissen hat jede öffentliche Route einen Vorschau-Zwilling unter `/status-page/{statusPageId}/...` – eine Vorschau-Übersicht, eine Vorschau-Vorfallliste, eine Vorschau-Abonnentenseite und so weiter. Eine URL oder ein Screenshot aus der Dashboard-Vorschau stimmt also nicht mit dem überein, was Kunden sehen, sobald eine eigene Domain hängt – prüfen Sie deshalb jeden Link doppelt, den Sie in ein Runbook oder eine E-Mail kopieren.

## Einschränken, wer die Seite sehen darf

Nicht jede Statusseite ist für die Öffentlichkeit gedacht. Alle Steuerelemente dafür sitzen im Abschnitt **Sicherheit**.

### Private Benutzer

Schalten Sie **Ist öffentlich sichtbar** unter **Statusseiten → Ihre Seite → Sicherheit → Authentifizierungseinstellungen** aus (die Spalte `isPublicStatusPage`). Besucher landen dann auf `/login` und müssen sich anmelden.

Wer sich anmelden darf, tragen Sie unter **Statusseiten → Ihre Seite → Sicherheit → Private Benutzer** ein. Es gibt die Aktion **In großen Mengen hinzufügen** – fügen Sie eine Liste von E-Mail-Adressen ein, und jede bekommt eine Einladungs-E-Mail. Private Benutzer haben ihren eigenen Ablauf für vergessene und zurückgesetzte Passwörter, getrennt von Ihren OneUptime-Projektkonten.

### Master-Passwort

Die **Authentifizierungseinstellungen** haben außerdem eine Karte **Master-Passwort** mit dem Schalter **Master-Passwort erforderlich** und dem Passwort selbst. Besucher landen dann auf `/master-password` und schalten die Seite mit einem einzigen geteilten Geheimnis frei.

**Master-Passwort und private Benutzer lassen sich nicht kombinieren.** Solange das Master-Passwort aktiv ist, ist die Authentifizierung über private Benutzer deaktiviert, und der Bildschirm **Private Benutzer** weist Sie mit einem Banner darauf hin.

### SSO und OIDC

Für eine private Seite, die an Ihren Identitätsanbieter gekoppelt ist, konfigurieren Sie unter **Statusseiten → Ihre Seite → Sicherheit → SSO** SAML (Sign-on-URL, Issuer, x509-Zertifikat, Signatur- und Digest-Verfahren) und unter **Statusseiten → Ihre Seite → Sicherheit → OIDC** OpenID Connect (Discovery-URL, Issuer, Client-ID und Secret, Scopes, Claim-Namen). **SCIM** stellt private Benutzer automatisch aus dem IdP bereit. Diese Funktionen hängen an einem Tarif-Feature und sind daher nicht in jeder Installation verfügbar.

Eine Karte **SSO-Einstellungen** bietet **SSO für Anmeldung erzwingen** (`requireSsoForLogin`, standardmäßig aus). Testen Sie Ihre SSO-Konfiguration, bevor Sie den Schalter umlegen – funktioniert sie nicht, sperren Sie sich selbst aus der Statusseite aus.

### IP-Whitelist

Die **Authentifizierungseinstellungen** tragen außerdem eine Karte **IP-Whitelist**, gestützt auf die Spalte `ipWhitelist`, für Seiten, die nur aus bekannten Netzen antworten sollen.

## Das einbettbare Badge und der RSS-Feed

Zwei Wege, den Status auch anderswo als auf der Seite selbst zu zeigen.

**Eingebettetes Status-Badge.** Aktivieren Sie **Eingebettetes Status-Badge aktivieren** (`enableEmbeddedOverallStatus`, standardmäßig aus) in der Karte **Eingebettetes Status-Badge** unter **Statusseiten → Ihre Seite → Erweitert → Eingebetteter Status**. Dazu gehört ein `embeddedOverallStatusToken`, und das Badge wird unter `/badge/:statusPageId` ausgeliefert – so setzen Sie den aktuellen Gesamtstatus in Ihre Doku, in die Fußzeile Ihrer App oder auf eine Marketingseite.

**RSS-Feed.** Jede Statusseite liefert `/rss` aus – einen Feed mit dem Titel „{status page name} Updates“, dessen Einträge die Präfixe `Incident: `, `Announcement: ` und `Scheduled Maintenance: ` tragen. Praktisch für alle, die Ihre Updates lieber in einen Reader oder einen Chatbot leiten, als sie per E-Mail zu abonnieren.

Wenn Sie die Daten lieber selbst abholen: Hinter der Statusseite stehen öffentliche Lese-Endpunkte für Übersicht, Vorfälle, geplante Wartungsereignisse, Ankündigungen und Episoden – siehe [Öffentliche API](/docs/status-pages/public-api).

## Wo Sie als Nächstes lesen sollten

- [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups) – Monitore auf die Seite bringen und in Abschnitte gliedern.
- [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains) – Logo, Favicon, Fußzeile, eigener Code und die Seite unter Ihrer eigenen Domain.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – die fünf Abonnentenkanäle, Double Opt-in und das Veröffentlichen von Ankündigungen.
- [Öffentliche API](/docs/status-pages/public-api) – Statusseitendaten programmatisch lesen.
- [Vorfälle – Übersicht](/docs/incidents/index) – die Ereignisse, die auf der Seite auftauchen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was einen Vorfall auf eine Statusseite bringt und was ihn wieder entfernt.
