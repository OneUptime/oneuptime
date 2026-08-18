# Branding & benutzerdefinierte Domains

Die Statusseite ist die eine OneUptime-Oberfläche, die Ihre Kunden tatsächlich ansehen – sie sollte also nach Ihnen aussehen und unter Ihrer eigenen Domain liegen. Beides richten Sie im Abschnitt **Branding** im Seitenmenü einer Statusseite ein, dazu kommt eine Einstellung, die sich unter **Erweiterte Einstellungen** versteckt.

Was Sie vorher wissen sollten: Das Branding verteilt sich auf sieben getrennte Bildschirme, und die Aufteilung liegt nicht immer da, wo man sie vermutet. Logo und Titelbild stehen nicht unter **Grundlegendes Branding** – sie stehen unter **Kopfzeile**. Das Favicon steht unter **Grundlegendes Branding**. Die Farben stehen unter **Übersichtsseite**. Alles andere, was Sie „Theming“ nennen würden, ist benutzerdefiniertes CSS.

Diese Seite geht die Bildschirme der Reihe nach durch und führt Sie anschließend durch den vollständigen Ablauf aus CNAME und danach SSL, um die Seite auf `status.yourcompany.com` zu bringen.

## Wo welches Branding-Steuerelement liegt

Öffnen Sie eine Statusseite: Der Abschnitt **Branding** im Seitenmenü hat sieben Einträge. Hier ist die Karte dazu, damit Sie aufhören zu suchen.

| Seite                          | Was Sie dort einstellen                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Grundlegendes Branding**     | Seitentitel, Seitenbeschreibung, Indexierung durch Suchmaschinen, Favicon.                               |
| **Kopfzeile**                  | Logo, Titelbild, deren Alternativtexte und die Linkleiste der Kopfzeile.                                  |
| **Fußzeile**                   | Copyright-Zeile und die Linkleiste der Fußzeile.                                                         |
| **Übersichtsseite**            | Beschreibung der Übersicht, Balkenfarben des Verlaufsdiagramms, Ausfallzeit-Status, Gesamtverfügbarkeit in Prozent. |
| **HTML, CSS und JavaScript**   | Header-HTML, Footer-HTML, benutzerdefiniertes CSS, benutzerdefiniertes JavaScript.                       |
| **Benutzerdefinierte Domains** | Ihre eigene Domain, CNAME-Verifizierung und SSL.                                                         |
| **Sprachen**                   | Standardsprache und die Sprachen, die im Umschalter der Fußzeile angeboten werden.                       |

## Grundlegendes Branding

**Statusseiten → Ihre Seite → Branding → Grundlegendes Branding** (`{id}/branding`) enthält drei Karten.

- **Titel und Beschreibung** – die Karte weist darauf hin, dass dies auch für SEO verwendet wird. **Bearbeiten** öffnet **Seitentitel** (Platzhalter `Please enter page title here.`) und **Seitenbeschreibung**. Das ist es, was Suchmaschinen und Link-Vorschauen zeigen – schreiben Sie es für Kunden, nicht für Ihr Team.
- **Search Engine Indexing** – ein einzelner Schalter, **Allow Search Engines to Index this Status Page**, im Produkt beschrieben als Steuerung dafür, ob Google und Bing die Seite in ihren Ergebnissen listen dürfen. Er ist standardmäßig an. Schalten Sie ihn aus, wird die Seite stattdessen mit `noindex, nofollow` ausgeliefert.
- **Favicon** – **Edit Favicon** öffnet den Bild-Upload **Favicon**. Das ist das kleine Symbol im Browser-Tab.

Dann sinnvoll: Die Seite ist rein intern oder noch im Aufbau. Schalten Sie **Allow Search Engines to Index this Status Page** aus, damit eine halbfertige Seite nicht anfängt, für Ihren Markennamen zu ranken.

## Der Kopfzeilen-Bildschirm

**Statusseiten → Ihre Seite → Branding → Kopfzeile** (`{id}/header-style`). Trotz des Namens im Seitenmenü liegen hier Ihre beiden größten Markenelemente.

Die erste Karte heißt **Logo, Cover and Favicon** und hat eine Schaltfläche **Edit Images**:

- **Logo** – Bild-Upload, Platzhalter `Upload logo`.
- **Logo Alt Text** – Platzhalter `Logo of My Company`. Lassen Sie das Feld leer, wird stattdessen der Titel der Statusseite verwendet.
- **Titelbild** – Bild-Upload, Platzhalter `Upload cover image`. Das ist das breite Banner hinter der Kopfzeile.
- **Cover Image Alt Text** – dieselbe Idee für das Titelbild.

Darunter steht eine Tabelle **Header-Links** („Header Links for your status page“). Jeder Link hat einen **Titel** und einen **Link** (eine URL, Platzhalter `https://link.com`), und die Zeilen werden per Ziehen umsortiert. Ist keiner konfiguriert, steht in der Tabelle „No status header link for this status page.“

Gut geeignet für: Besucher zurück auf Ihre Marketing-Website, Ihre Doku oder ein Support-Portal führen, ohne dass sie die URL raten müssen.

## Der Fußzeilen-Bildschirm

**Statusseiten → Ihre Seite → Branding → Fußzeile** (`{id}/footer-style`) hat dieselbe Form wie **Kopfzeile**: eine Karte und eine Tabelle.

- **Copyright-Informationen** – **Edit Copyright** öffnet ein einzelnes Feld, **Copyright-Informationen**, mit dem Platzhalter `Acme, Inc.`.
- **Footer-Links** – dasselbe Paar aus **Titel** und **Link**, per Ziehen sortiert, Leermeldung „No status footer link for this status page.“

Impressum, Datenschutz und Nutzungsbedingungen gehören hierhin. Kopfzeilen-Links sind für die Navigation, Fußzeilen-Links für das Kleingedruckte.

## Branding der Übersichtsseite

**Statusseiten → Ihre Seite → Branding → Übersichtsseite** (`{id}/overview-page-branding`) ist der einzige Bildschirm, auf dem Farben konfigurierbar sind – und er entscheidet außerdem, was „down“ im Diagramm bedeutet.

- **Übersichtsseite** – **Edit Branding** öffnet ein Markdown-Feld, **Beschreibung der Übersichtsseite.**, das über der Ressourcenliste dargestellt wird. Nutzen Sie es für einen Satz Kontext: was diese Seite abdeckt und wohin man sich für Support wendet.
- **Rules for Bar Colors of History Chart** – eine geordnete, per Ziehen sortierbare Regeltabelle. Jede Regel hat **When uptime % is greater than or equal to** und **Then, use this bar color**; die Tabellenspalten heißen `When Uptime Percent >=` und `Then, Bar Color is`. Die Reihenfolge zählt – ordnen Sie die Regeln so an, wie sie ausgewertet werden sollen.
- **Ausfallzeit-Monitorstatus** – **Edit Statuses** öffnet eine Mehrfachauswahl, beschrieben mit „These monitor statuses are considered as down“. So entscheiden Sie, ob etwa ein beeinträchtigter Status auf dieser Seite gegen die Verfügbarkeit zählt.
- **Default Bar Color of the History Chart** – **Edit Default Bar Color** öffnet die Farbauswahl **Standard-Balkenfarbe**, also die Farbe für den Fall, dass keine Regel greift.
- **Gesamte Betriebszeit in Prozent** – **Edit Settings** öffnet den Schalter **Gesamtprozentsatz der Verfügbarkeit anzeigen** und ein Dropdown **Verfügbarkeitsgenauigkeit auswählen**, das standardmäßig auf zwei Nachkommastellen steht (`99.99% (Two Decimal)`).

**Wie viele Tage das Diagramm abdeckt, stellen Sie nicht hier ein.** Das ist **Verfügbarkeitsverlauf anzeigen (in Tagen)** unter **Statusseiten → Ihre Seite → Erweitert → Erweiterte Einstellungen** (`{id}/settings`), gültig von 1 bis 90.

## Eigenes HTML, CSS und JavaScript

**Statusseiten → Ihre Seite → Branding → HTML, CSS und JavaScript** (`{id}/custom-code`) hat vier unabhängig bearbeitbare Karten, gestützt auf die Spalten `headerHTML`, `footerHTML`, `customCSS` und `customJavaScript` der Statusseite:

- **Header-HTML** – Platzhalter `Insert Custom HTML here.`, wird in die Kopfzeile der Seite eingefügt.
- **Footer-HTML** – dasselbe für die Fußzeile.
- **Benutzerdefiniertes CSS** – Platzhalter `Insert Custom CSS here.`
- **Benutzerdefiniertes JavaScript** – Platzhalter `Insert Custom JavaScript here.`

**Eine Theme-Auswahl gibt es nicht.** OneUptime-Statusseiten haben keine Theme- oder Markenfarben-Einstellung: Die einzigen eingebauten Farbsteuerungen überhaupt sind **Standard-Balkenfarbe** und die Balkenfarb-Regeln des Verlaufsdiagramms auf dem Bildschirm **Übersichtsseite**. Schriften, Hintergrundfarben, Akzentfarben und Layout-Anpassungen laufen alle über **Benutzerdefiniertes CSS** hier. Wenn Sie nach einem Feld für die „Markenfarbe“ gesucht haben: Das ist die Antwort – es gibt keines, und dieses Feld ist der Notausgang.

> Benutzerdefiniertes JavaScript läuft in den Browsern Ihrer Besucher, auf einer Seite, die Menschen genau dann laden, wenn sie befürchten, dass etwas kaputt ist. Halten Sie es klein, hosten Sie es nach Möglichkeit selbst, und testen Sie es, bevor Sie sich darauf verlassen.

## Spracheinstellungen

**Statusseiten → Ihre Seite → Branding → Sprachen** (`{id}/languages`) hat zwei Karten, und bei beiden geht es um den Sprachumschalter, den Besucher in der Fußzeile der Seite bekommen.

- **Standardsprache** – **Edit Default Language** öffnet ein Dropdown, das jede unterstützte Sprache mit ihrem Eigennamen und ihrem englischen Namen auflistet (`Deutsch (German)`). Die Karte beschreibt sie als die Sprache, die Erstbesucher sehen; umschalten können Besucher jederzeit über die Fußzeile. Standard ist Englisch.
- **Aktivierte Sprachen** – **Edit Enabled Languages** öffnet eine Mehrfachauswahl, Platzhalter `All languages`. Lassen Sie sie leer, werden alle unterstützten Sprachen angeboten. Wählen Sie einige aus, listet der Umschalter in der Fußzeile nur diese.

OneUptime bringt sechzehn Sprachen mit: Englisch, Deutsch, Französisch, Spanisch, Italienisch, Portugiesisch, Niederländisch, Dänisch, Norwegisch, Schwedisch, Russisch, Japanisch, Koreanisch, Chinesisch (vereinfacht), Chinesisch (traditionell) und Hindi.

## Benutzerdefinierte Domains

Standardmäßig ist eine Statusseite über die Vorschau-URL erreichbar, die auf ihrem Bildschirm **Übersicht** steht. Um sie auf Ihren eigenen Hostnamen zu legen, gehen Sie zu **Statusseiten → Ihre Seite → Branding → Benutzerdefinierte Domains** (`{id}/domains`).

Die Karte heißt **Benutzerdefinierte Domains**, und ihre Beschreibung nennt die Voraussetzung direkt: Tragen Sie den Statusseiten-CNAME-Eintrag Ihrer Installation als CNAME für diese Domains ein, damit das funktioniert. Ist nichts konfiguriert, steht in der Tabelle „No custom domains found.“ Die Tabelle hat zwei Spalten, **Domäne** und **Status**, und Filter für **Domäne**, **CNAME gültig** und **SSL bereitgestellt**.

### Bevor Sie anfangen

Zwei Voraussetzungen – eine davon zu überspringen ist der übliche Grund, warum das nicht funktioniert:

- **Die übergeordnete Domain muss bereits verifiziert sein.** Das Dropdown **Domäne** listet nur verifizierte Domains aus den Projekteinstellungen – der Hilfetext des Feldes verweist Sie auf **Mehr → Projekteinstellungen → Benutzerdefinierte Domains**, um dort zuerst eine anzulegen.
- **In der Installation muss ein Statusseiten-CNAME-Eintrag konfiguriert sein.** Bei selbst gehosteten Deployments ist das die Umgebungsvariable `STATUS_PAGE_CNAME_RECORD` in Docker Compose oder `statusPage.cnameRecord` in der Helm-`values.yaml`. Fehlt sie, zeigen die Dialoge **CNAME hinzufügen** und **Kostenloses SSL bestellen** statt einer Anleitung die Meldung „Custom Domains not enabled for this OneUptime installation“.

### Die Domain hinzufügen

Klicken Sie auf **Create Status Page Domain**. Der Dialog (**Create New Status Page Domain**) hat zwei Schritte:

**Grundlegend**

- **Subdomain** – nur das Label, Platzhalter `status (leave blank for root)`. Geben Sie nur `status` ein, nicht den ganzen Hostnamen. Lassen Sie es leer oder geben Sie `@` ein, um die Root- bzw. Apex-Domain zu nutzen.
- **Domäne** – ein Dropdown der verifizierten Domains, Platzhalter `Select domain`.

**Mehr**

- **Benutzerdefiniertes Zertifikat hochladen** – ein Schalter, standardmäßig aus. Lassen Sie ihn aus, bestellt OneUptime ein kostenloses Zertifikat für Sie. Schalten Sie ihn ein, bekommen Sie die Felder **Zertifikat** und **Privater Schlüssel des Zertifikats** für Ihr eigenes PEM-Material.

## Den CNAME verifizieren

Solange die Domain nicht verifiziert ist, zeigt die Zeile die Aktion **CNAME hinzufügen**. Sie öffnet einen Dialog **CNAME hinzufügen**, der Ihnen genau das gibt, was Sie bei Ihrem DNS-Anbieter einfügen müssen:

- **Eintragstyp** – `CNAME`
- **Name** – die vollständige Domain, die Sie gerade angelegt haben, zum Beispiel `status.yourcompany.com`
- **Inhalt** – der Statusseiten-CNAME-Eintrag Ihrer Installation

Der Dialog weist darauf hin, dass die automatische Verifizierung nach dem Anlegen des Eintrags bis zu 24 Stunden dauern kann. Darauf warten müssen Sie nicht: Die Absende-Schaltfläche des Dialogs heißt **CNAME verifizieren** und prüft den Eintrag sofort.

Legen Sie zuerst den DNS-Eintrag an und klicken Sie dann auf **CNAME verifizieren**. Ein Klick, bevor der Eintrag existiert, schlägt schlicht fehl.

## Ein SSL-Zertifikat bestellen

Sobald der CNAME verifiziert ist – und nur, wenn Sie kein eigenes Zertifikat hochgeladen haben –, erscheint in der Zeile die Aktion **Kostenloses SSL bestellen**. Ihr Dialog, **Order Free SSL Certificate for this Status Page**, erklärt, dass OneUptime LetsEncrypt verwendet, dass der Vorgang sicher und kostenlos ist und dass die Bereitstellung nach der Bestellung einige Stunden dauert. Die Absende-Schaltfläche heißt **Kostenloses SSL bestellen**.

**Die angegebenen Zeiten widersprechen sich von Bildschirm zu Bildschirm**, lesen Sie also nicht zu viel in eine einzelne Zahl hinein: Der Bestelldialog nennt drei Stunden, die Spalte **Status** eine Stunde, und bei einem eigenen Zertifikat sind es dreißig Minuten. Nehmen Sie alle als „schauen Sie später heute noch einmal vorbei“ und wenden Sie sich an den Support, wenn bis dahin nichts passiert ist.

Ist das Zertifikat einmal bereitgestellt, erneuert es sich automatisch. Für Sie fällt nichts Wiederkehrendes an.

## Die Spalte Status der Domain lesen

Die Spalte **Status** ist der gesamte Einrichtungs-Zustandsautomat in einer Zelle. Jede Meldung sagt Ihnen entweder, was als Nächstes zu tun ist, oder dass Sie fertig sind.

| Was in der Spalte Status steht                        | Was das bedeutet                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | Der CNAME ist noch nicht verifiziert. Legen Sie den Eintrag an, dann **CNAME verifizieren**. |
| Action Required: Please order SSL certificate.        | Der CNAME ist verifiziert, aber es ist kein Zertifikat bestellt. Klicken Sie auf **Kostenloses SSL bestellen**. |
| No action is required, allow 30 minutes to provision. | Sie haben ein eigenes Zertifikat hochgeladen, und es wird gerade installiert.      |
| No action is required, this will be provisioned soon. | Das kostenlose Zertifikat ist bestellt und unterwegs. Wenden Sie sich an den Support, falls es nie ankommt. |
| Certificate Provisioned. No action required.          | Fertig. OneUptime erneuert das Zertifikat automatisch.                            |

Bleibt eine Zeile lange nach dem Anlegen des DNS-Eintrags auf „Action Required: Please add your CNAME record.“ stehen, prüfen Sie, ob der Name des Eintrags die vollständige Domain ist und ob sein Inhalt exakt dem CNAME-Eintrag Ihrer Installation entspricht.

## Powered by OneUptime

Die Zeile „Powered by OneUptime“ ist keine Einstellung des Branding-Abschnitts. Sie liegt unter **Statusseiten → Ihre Seite → Erweitert → Erweiterte Einstellungen** (`{id}/settings`), in der Karte **Branding „Powered By OneUptime“**, als einzelner Schalter: **Branding "Powered By OneUptime" ausblenden**. **Edit Settings** öffnet ihn, wie jede andere Karte auf dieser Seite.

## Wo Sie als Nächstes lesen sollten

- [Statusseiten – Übersicht](/docs/status-pages/index) – was eine Statusseite ist und wie die Teile zusammenpassen.
- [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups) – auswählen, was Besucher auf der Seite tatsächlich sehen.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – Abonnenten per E-Mail, SMS, Slack und Webhook sowie Ankündigungen.
- [Öffentliche API](/docs/status-pages/public-api) – Statusseitendaten programmatisch lesen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was einen Vorfall auf der Seite erscheinen und wieder verschwinden lässt.
