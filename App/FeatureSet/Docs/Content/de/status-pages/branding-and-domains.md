# Branding & benutzerdefinierte Domains

Eine Statusseite ist die eine OneUptime-Oberfläche, die Ihre Kunden tatsächlich ansehen, sie sollte also so wirken, als gehöre sie zu Ihnen, und auf Ihrer eigenen Domain liegen. Beides wird im Abschnitt **Branding** im Seitenmenü einer Statusseite konfiguriert, plus einer Einstellung, die sich in **Advanced Settings** versteckt.

Was Sie vorab wissen sollten: Branding ist auf sieben separate Bildschirme aufgeteilt, und die Aufteilung liegt nicht immer dort, wo man sie vermuten würde. Logo und Titelbild befinden sich nicht auf **Essential Branding** – sie sind auf **Header**. Das Favicon ist auf **Essential Branding**. Farben sind auf **Overview Page**. Alles andere, was Sie sich unter „Theming" vorstellen, ist Custom CSS.

Diese Seite geht jeden Bildschirm der Reihe nach durch und führt Sie dann durch die vollständige Abfolge CNAME-dann-SSL, um die Seite auf `status.yourcompany.com` zu bringen.

## Wo sich jede Branding-Einstellung befindet

Öffnen Sie eine Statusseite; der Abschnitt **Branding** im Seitenmenü hat sieben Einträge. Hier die Übersicht, damit Sie nicht suchen müssen.

| Seite                       | Was Sie dort einstellen                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| **Essential Branding**      | Seitentitel, Seitenbeschreibung, Indexierung durch Suchmaschinen, Favicon.                     |
| **Header**                  | Logo, Titelbild, deren Alt-Text und die Link-Leiste im Header.                                 |
| **Footer**                  | Copyright-Zeile und die Link-Leiste im Footer.                                                 |
| **Overview Page**           | Übersichtsbeschreibung, Balkenfarben des Verlaufsdiagramms, Ausfallstatus, gesamter Verfügbarkeitsprozentsatz. |
| **HTML, CSS & JavaScript**  | Header-HTML, Footer-HTML, benutzerdefiniertes CSS, benutzerdefiniertes JavaScript.             |
| **Custom Domains**          | Ihre eigene Domain, CNAME-Verifizierung und SSL.                                               |
| **Languages**                | Standardsprache und die im Footer-Umschalter angebotenen Sprachen.                             |

## Grundlegendes Branding

**Status Pages → your page → Branding → Essential Branding** (`{id}/branding`) enthält drei Karten.

- **Title and Description** – die Karte weist darauf hin, dass dies auch für SEO verwendet wird. **Edit** öffnet **Page Title** (Platzhalter `Please enter page title here.`) und **Page Description**. Das zeigen Suchmaschinen und Link-Vorschauen, schreiben Sie es also für einen Kunden, nicht für Ihr Team.
- **Search Engine Indexing** – ein einzelner Umschalter, **Allow Search Engines to Index this Status Page**, im Produkt beschrieben als Steuerung, ob Google und Bing die Seite in ihren Ergebnissen auflisten dürfen. Standardmäßig an. Schalten Sie ihn aus, wird die Seite stattdessen mit `noindex, nofollow` ausgeliefert.
- **Favicon** – **Edit Favicon** öffnet den Bild-Upload **Favicon**. Das ist das kleine Symbol im Browser-Tab.

Nutzen Sie es, wenn: die Seite nur intern ist oder noch eingerichtet wird. Schalten Sie **Allow Search Engines to Index this Status Page** aus, damit eine halbfertige Seite nicht anfängt, für Ihren Markennamen zu ranken.

## Der Header-Bildschirm

**Status Pages → your page → Branding → Header** (`{id}/header-style`). Trotz des Namens im Seitenmenü liegen hier Ihre beiden größten Markenwerte.

Die erste Karte trägt den Titel **Logo, Cover and Favicon**, mit einer Schaltfläche **Edit Images**:

- **Logo** – Bild-Upload, Platzhalter `Upload logo`.
- **Logo Alt Text** – Platzhalter `Logo of My Company`. Lassen Sie es leer, wird stattdessen der Titel der Statusseite verwendet.
- **Cover** – Bild-Upload, Platzhalter `Upload cover image`. Das ist das breite Banner hinter dem Header.
- **Cover Image Alt Text** – dasselbe Prinzip für das Titelbild.

Darunter befindet sich eine Tabelle **Header Links** („Header Links for your status page"). Jeder Link hat einen **Title** und einen **Link** (eine URL, Platzhalter `https://link.com`), und Zeilen werden per Ziehen neu angeordnet. Ohne konfigurierte Einträge liest die Tabelle „No status header link for this status page."

Gut geeignet, um: Besucher zurück auf Ihre Marketing-Website, Ihre Dokumentation oder ein Support-Portal zu lenken, ohne sie die URL raten zu lassen.

## Der Footer-Bildschirm

**Status Pages → your page → Branding → Footer** (`{id}/footer-style`) hat dieselbe Form wie **Header**, eine Karte und eine Tabelle.

- **Copyright Info** – **Edit Copyright** öffnet ein einzelnes Feld, **Copyright Info**, mit dem Platzhalter `Acme, Inc.`.
- **Footer Links** – dasselbe Paar **Title** plus **Link**, per Ziehen sortierbar, leere Meldung „No status footer link for this status page."

Rechtliche Links, Datenschutz und AGB gehören hierher. Header-Links sind für die Navigation, Footer-Links für das Kleingedruckte.

## Branding der Übersichtsseite

**Status Pages → your page → Branding → Overview Page** (`{id}/overview-page-branding`) ist der einzige Bildschirm, auf dem Farben konfigurierbar sind, und er entscheidet auch, was „down" im Diagramm bedeutet.

- **Overview Page** – **Edit Branding** öffnet ein Markdown-Feld, **Overview Page Description.**, das über der Ressourcenliste dargestellt wird. Nutzen Sie es für einen Satz Kontext: was diese Seite abdeckt und wohin man sich für Support wendet.
- **Rules for Bar Colors of History Chart** – eine geordnete, per Ziehen sortierbare Tabelle von Regeln. Jede Regel hat **When uptime % is greater than or equal to** und **Then, use this bar color**; die Tabellenspalten lauten `When Uptime Percent >=` und `Then, Bar Color is`. Die Reihenfolge ist entscheidend, ordnen Sie sie also so an, wie sie ausgewertet werden sollen.
- **Downtime Monitor Statuses** – **Edit Statuses** öffnet eine Mehrfachauswahl, beschrieben als „These monitor statuses are considered as down". So legen Sie fest, ob etwa ein Status „degraded" auf dieser Seite gegen die Verfügbarkeit zählt.
- **Default Bar Color of the History Chart** – **Edit Default Bar Color** öffnet die Farbauswahl **Default Bar Color**, die Farbe, die verwendet wird, wenn keine Regel zutrifft.
- **Overall Uptime Percent** – **Edit Settings** öffnet den Umschalter **Show Overall Uptime Percent** und ein Dropdown **Select Uptime Precision**, das standardmäßig auf zwei Nachkommastellen steht (`99.99% (Two Decimal)`).

**Wie viele Tage das Diagramm abdeckt, wird hier nicht festgelegt.** Das ist **Show Uptime History (in days)** auf **Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`), gültig von 1 bis 90.

## Benutzerdefiniertes HTML, CSS und JavaScript

**Status Pages → your page → Branding → HTML, CSS & JavaScript** (`{id}/custom-code`) hat vier unabhängig bearbeitbare Karten, gestützt von den Spalten `headerHTML`, `footerHTML`, `customCSS` und `customJavaScript` der Statusseite:

- **Header HTML** – Platzhalter `Insert Custom HTML here.`, in den Header der Seite eingefügt.
- **Footer HTML** – dasselbe, für den Footer.
- **Custom CSS** – Platzhalter `Insert Custom CSS here.`
- **Custom JavaScript** – Platzhalter `Insert Custom JavaScript here.`

**Es gibt keinen Theme-Auswähler.** OneUptime-Statusseiten haben keine Theme- oder Markenfarben-Einstellung: Die einzigen eingebauten Farbsteuerungen überhaupt sind **Default Bar Color** und die Farbregeln für die Verlaufsdiagramm-Balken auf dem Bildschirm **Overview Page**. Schriftarten, Hintergrundfarben, Akzentfarben und Layout-Anpassungen laufen alle über **Custom CSS** hier. Falls Sie nach einem Feld für „Markenfarbe" gesucht haben – das ist die Antwort, es gibt keins, und dieses Feld ist der Notausgang.

> Benutzerdefiniertes JavaScript läuft in den Browsern Ihrer Besucher auf einer Seite, die Menschen genau dann laden, wenn sie befürchten, dass etwas kaputt ist. Halten Sie es klein, hosten Sie es nach Möglichkeit selbst, und testen Sie es, bevor Sie sich darauf verlassen.

## Spracheinstellungen

**Status Pages → your page → Branding → Languages** (`{id}/languages`) hat zwei Karten, und beide betreffen den Sprachumschalter, den Besucher im Seiten-Footer erhalten.

- **Default Language** – **Edit Default Language** öffnet ein Dropdown, das jede unterstützte Sprache mit ihrem eigenen und dem englischen Namen auflistet (`Deutsch (German)`). Die Karte beschreibt sie als die Sprache, die Erstbesucher zuerst sehen; Besucher können jederzeit über den Footer wechseln. Standardmäßig Englisch.
- **Enabled Languages** – **Edit Enabled Languages** öffnet eine Mehrfachauswahl, Platzhalter `All languages`. Lassen Sie sie leer, werden alle unterstützten Sprachen angeboten. Wählen Sie einige aus, listet der Footer-Umschalter nur diese.

Sechzehn Sprachen werden mit OneUptime ausgeliefert: Englisch, Deutsch, Französisch, Spanisch, Italienisch, Portugiesisch, Niederländisch, Dänisch, Norwegisch, Schwedisch, Russisch, Japanisch, Koreanisch, Chinesisch (vereinfacht), Chinesisch (traditionell) und Hindi.

## Benutzerdefinierte Domains

Standardmäßig ist eine Statusseite über die auf ihrem Bildschirm **Overview** angezeigte Vorschau-URL erreichbar. Um sie auf Ihren eigenen Hostnamen zu bringen, gehen Sie zu **Status Pages → your page → Branding → Custom Domains** (`{id}/domains`).

Die Karte trägt den Titel **Custom Domains**, und ihre Beschreibung nennt die Voraussetzung direkt: Fügen Sie den CNAME-Eintrag der Statusseite Ihrer Installation als CNAME für diese Domains hinzu, damit es funktioniert. Ohne Konfiguration liest die Tabelle „No custom domains found." Die Tabelle hat zwei Spalten, **Domain** und **Status**, sowie Filter für **Domain**, **CNAME Valid** und **SSL Provisioned**.

### Bevor Sie beginnen

Zwei Voraussetzungen, und eine davon zu überspringen ist meist der Grund, warum es nicht funktioniert:

- **Die übergeordnete Domain muss bereits verifiziert sein.** Das Dropdown **Domain** listet nur verifizierte Domains aus den Projekteinstellungen auf – der Hilfetext des Feldes selbst verweist Sie auf **More → Project Settings → Custom Domains**, um zuerst eine hinzuzufügen.
- **Die Installation muss einen CNAME-Eintrag für die Statusseite konfiguriert haben.** Bei selbstgehosteten Installationen ist das die Umgebungsvariable `STATUS_PAGE_CNAME_RECORD` in Docker Compose, oder `statusPage.cnameRecord` in der Helm-`values.yaml`. Fehlt sie, zeigen sowohl das Modal **Add CNAME** als auch **Order Free SSL** stattdessen die Meldung „Custom Domains not enabled for this OneUptime installation".

### Die Domain hinzufügen

Klicken Sie auf **Create Status Page Domain**. Das Modal (**Create New Status Page Domain**) hat zwei Schritte:

**Basic**

- **Subdomain** – nur das Label, Platzhalter `status (leave blank for root)`. Geben Sie nur `status` ein, nicht den gesamten Hostnamen. Lassen Sie es leer oder geben Sie `@` ein, um die Root-/Apex-Domain zu verwenden.
- **Domain** – ein Dropdown verifizierter Domains, Platzhalter `Select domain`.

**More**

- **Upload Custom Certificate** – ein Umschalter, standardmäßig aus. Lassen Sie ihn aus, bestellt OneUptime ein kostenloses Zertifikat für Sie. Schalten Sie ihn ein, erhalten Sie die Felder **Certificate** und **Certificate Private Key** für Ihr eigenes PEM-Material.

## Den CNAME verifizieren

Solange die Domain unverifiziert ist, zeigt die Zeile eine Aktion **Add CNAME**. Sie öffnet ein Modal mit dem Titel **Add CNAME**, das Ihnen genau gibt, was Sie bei Ihrem DNS-Anbieter einfügen müssen:

- **Record Type** – `CNAME`
- **Name** – die vollständige Domain, die Sie gerade angelegt haben, zum Beispiel `status.yourcompany.com`
- **Content** – der CNAME-Eintrag der Statusseite Ihrer Installation

Das Modal weist darauf hin, dass die automatische Verifizierung, sobald der Eintrag vorhanden ist, bis zu 24 Stunden dauern kann. Sie müssen darauf nicht warten: Die Absende-Schaltfläche des Modals ist **Verify CNAME**, die den Eintrag auf Anfrage prüft.

Legen Sie zuerst den DNS-Eintrag an, klicken Sie dann auf **Verify CNAME**. Ein Klick, bevor der Eintrag existiert, schlägt einfach fehl.

## Ein SSL-Zertifikat bestellen

Sobald der CNAME verifiziert ist – und nur, wenn Sie kein eigenes Zertifikat hochgeladen haben –, erscheint auf der Zeile eine Aktion **Order Free SSL**. Ihr Modal, **Order Free SSL Certificate for this Status Page**, erklärt, dass OneUptime LetsEncrypt verwendet, dass der Vorgang sicher und kostenlos ist und dass die Bereitstellung ein paar Stunden nach der Bestellung dauert. Die Absende-Schaltfläche ist **Order Free SSL**.

**Die angegebenen Zeiten widersprechen sich zwischen den Bildschirmen**, lesen Sie also nicht zu viel in eine einzelne Zahl hinein: Das Bestellmodal nennt drei Stunden, die Spalte **Status** nennt eine Stunde, und ein benutzerdefiniertes Zertifikat nennt dreißig Minuten. Behandeln Sie alle als „später am selben Tag wiederkommen", und wenden Sie sich an den Support, falls bis dahin nichts passiert ist.

Sobald es bereitgestellt ist, erfolgt die Erneuerung automatisch. Für Sie gibt es dabei nichts Wiederkehrendes zu tun.

## Die Status-Spalte der Domain lesen

Die Spalte **Status** ist die gesamte Zustandsmaschine der Einrichtung in einer Zelle. Jede Meldung sagt Ihnen entweder, was als Nächstes zu tun ist, oder dass Sie fertig sind.

| Was die Status-Spalte sagt                             | Was es bedeutet                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.           | Der CNAME ist noch nicht verifiziert. Fügen Sie den Eintrag hinzu, dann **Verify CNAME**. |
| Action Required: Please order SSL certificate.            | Der CNAME ist verifiziert, aber kein Zertifikat ist bestellt. Klicken Sie auf **Order Free SSL**. |
| No action is required, allow 30 minutes to provision.     | Sie haben ein eigenes Zertifikat hochgeladen, und es wird installiert.              |
| No action is required, this will be provisioned soon.     | Das kostenlose Zertifikat ist bestellt und unterwegs. Wenden Sie sich an den Support, falls es nie ankommt. |
| Certificate Provisioned. No action required.              | Fertig. OneUptime erneuert das Zertifikat automatisch.                              |

Bleibt eine Zeile lange nach dem Anlegen des DNS-Eintrags bei „Action Required: Please add your CNAME record." stehen, prüfen Sie, ob der Name des Eintrags die vollständige Domain ist und ob sein Inhalt genau mit dem CNAME-Eintrag Ihrer Installation übereinstimmt.

## Powered by OneUptime

Die Zeile „Powered by OneUptime" ist keine Einstellung im Branding-Abschnitt. Sie befindet sich auf **Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`), in der Karte **Powered By OneUptime Branding**, als einzelner Umschalter: **Hide Powered By OneUptime Branding**. **Edit Settings** öffnet ihn, wie jede andere Karte auf dieser Seite.

## Wo Sie als Nächstes lesen sollten

- [Statusseiten – Übersicht](/docs/status-pages/index) – was eine Statusseite ist und wie die Teile zusammenpassen.
- [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups) – auswählen, was Besucher auf der Seite tatsächlich sehen.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – E-Mail-, SMS-, Slack- und Webhook-Abonnenten sowie Ankündigungen.
- [Public API](/docs/status-pages/public-api) – Statusseitendaten programmatisch abrufen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was einen Vorfall auf der Seite erscheinen und wieder verschwinden lässt.
