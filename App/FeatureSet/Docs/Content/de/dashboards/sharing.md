# Teilen & öffentliche Dashboards

Die meisten Dashboards sind für Ihr Projekt privat — nur eingeloggte Mitglieder des Projekts können sie sehen. Aber OneUptime lässt Sie auch ein Dashboard unter einer öffentlichen URL veröffentlichen, es optional mit einem Passwort schützen, es nach IP einschränken und es unter einer benutzerdefinierten Domain hosten. Diese Seite behandelt alle vier.

## Private Dashboards (Standard)

Standardmäßig ist ein Dashboard nur für eingeloggte Benutzer erreichbar, die Projektmitglieder sind. Die URL sieht aus wie `https://oneuptime.com/dashboards/<id>/view`. Der direkte Zugriff erfordert Authentifizierung und die entsprechende Leseberechtigung für das Dashboard.

Innerhalb des Projekts steuern Ownership und Labels, wer was sieht — siehe [Konfiguration & Berechtigungen](/docs/dashboards/configuration).

## Öffentliche Dashboards

Unter **Dashboard → Settings** schalten Sie **Public Dashboard** ein. Das Dashboard hat jetzt eine zweite URL, die kein Login erfordert. Teilen Sie sie mit Anbietern, Partnern, Kunden, oder fügen Sie sie in eine öffentliche README ein.

Ein öffentliches Dashboard:

- Wird nur im **View**-Modus gerendert. Öffentliche Besucher können nicht bearbeiten, abgesehen von der Änderung der Zeitbereichs-URLs nichts ändern, oder die Widget-Palette sehen.
- Enthält die Variablen, die Sie definiert haben — Besucher können aus Dropdowns auswählen, genau wie interne Benutzer.
- Trägt das **Branding**, das Sie unter Settings konfigurieren: Seitentitel, Seitenbeschreibung, Logodatei, Favicon. Diese sind es, was im Browser-Tab und in Social-Media-Vorschauen erscheint.

Behandeln Sie das Aktivieren von **Public Dashboard** wie das Veröffentlichen einer Webseite. Jedes Widget auf dem Dashboard ist jetzt weltweit lesbar. Auditieren Sie, was sich auf der Arbeitsfläche befindet, bevor Sie den Schalter umlegen.

## Master-Passwort

Um ein öffentliches Dashboard mit einem Passwort zu schützen, anstatt es völlig offen zu machen:

1. Aktivieren Sie **Public Dashboard**.
2. Aktivieren Sie **Master Password**.
3. Setzen Sie das Passwort.

Besucher erhalten eine Passwortabfrage, bevor das Dashboard gerendert wird. Das Passwort wird im Ruhezustand gehasht; nur der Hash wird gespeichert.

Verwenden Sie ein Master-Passwort, wenn:

- Sie mit einem Partner oder Kunden teilen möchten, aber nicht möchten, dass die URL gültig ist, falls sie durchsickert.
- Das Dashboard „halböffentlich" ist — offen genug, dass Sie keine OneUptime-Konten für jeden Betrachter wollen, aber nicht offen genug, um es ins offene Internet zu stellen.

Für wertvollere Zugriffskontrolle (Konten pro Betrachter, Audit-Trail darüber, wer was gesehen hat) halten Sie das Dashboard privat und laden Sie Betrachter als Nur-Lese-Mitglieder zum Projekt ein.

## IP-Allowlist

Im Tarif **Scale** können Sie ein öffentliches Dashboard auf eine Liste von Quell-IPs oder CIDR-Bereichen beschränken. Konfigurieren Sie die Liste unter **Dashboard → Settings → IP Whitelist**.

Verwenden Sie eine IP-Allowlist, wenn:

- Das Dashboard nur aus Ihrem Büro oder VPN erreichbar sein soll.
- Ein Lieferantenportal nur über die veröffentlichten Egress-IPs des Lieferanten erreichbar sein soll.
- Sie eine Verteidigung in der Tiefe zusätzlich zu einem Master-Passwort wollen.

Anfragen von jeder anderen IP erhalten ein 403.

## Benutzerdefinierte Domains

Standardmäßig wird ein öffentliches Dashboard auf `oneuptime.com` bereitgestellt. Um es auf Ihrer eigenen Subdomain zu hosten (z. B. `dashboard.acme.com`):

1. Fügen Sie einen CNAME-Datensatz in Ihrem DNS hinzu, der die Subdomain auf das veröffentlichte Ziel von OneUptime verweist.
2. Unter **Dashboard → Settings → Custom Domains** fügen Sie die Domain hinzu.
3. Verifizieren Sie den DNS-Datensatz (OneUptime prüft ihn für Sie).
4. Nach der Verifizierung ist das Dashboard sowohl über die OneUptime-URL als auch über Ihre benutzerdefinierte Domain erreichbar.

Benutzerdefinierte Domains sind nützlich für:

- Kundengerichtete Dashboards unter Ihrer Marke.
- Co-Branded-Partner-Dashboards.
- SEO auf einer öffentlichen Gesundheitsseite.

Sie können mehrere benutzerdefinierte Domains an ein Dashboard binden, wenn Sie denselben Inhalt mehreren Zielgruppen anbieten.

## Branding für öffentliche Dashboards

Unter **Dashboard → Settings** konfigurieren Sie:

- **Seitentitel** — der `<title>`-Tag und die Überschrift, die Besucher sehen.
- **Seitenbeschreibung** — die Meta-Beschreibung, die von Suchmaschinen und Social-Media-Vorschauen verwendet wird.
- **Logodatei** — laden Sie ein PNG/SVG hoch; wird in der Dashboard-Kopfzeile angezeigt.
- **Favicon** — hochgeladen; wird im Browser-Tab angezeigt.

Branding gilt nur für das Rendering im öffentlichen Modus. Interne Betrachter sehen immer das OneUptime-Branding.

## Einbetten

Sie können ein öffentliches Dashboard in einem `<iframe>` auf Ihrer eigenen Website einbetten:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Wenn Sie ein Dashboard einbetten, das durch ein Master-Passwort geschützt ist, sieht der Besucher die Passwortabfrage innerhalb des iframes.

## Teilbare URLs mit Variablen-Zustand

Die Dashboard-URL kodiert die aktuellen Variablen-Auswahlen und den Zeitbereich als Query-Parameter. Passen Sie die Dropdowns an, kopieren Sie die URL und fügen Sie sie im Chat ein — der Empfänger sieht das Dashboard mit genau derselben Ansicht, einschließlich des Zeitbereichs, den Sie betrachtet haben.

Dies ist der schnellste Weg, einen Teamkollegen auf „das Dashboard zum Zeitpunkt des Vorfallstarts" zu verweisen — Zeitbereich anheften, kopieren, einfügen.

## Wo weiterlesen

- [Konfiguration & Berechtigungen](/docs/dashboards/configuration) — Zugriffskontrolle im privaten Modus.
- [Variablen & Filter](/docs/dashboards/variables) — Variablen, mit denen öffentliche Besucher interagieren können.
- [Ein Dashboard erstellen](/docs/dashboards/authoring) — was überhaupt auf die Arbeitsfläche kommt.
