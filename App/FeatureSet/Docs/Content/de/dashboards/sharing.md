# Freigabe & öffentliche Dashboards

Standardmäßig sind Dashboards privat zu Ihrem Projekt – nur eingeloggte Teammitglieder können sie sehen. OneUptime erlaubt es Ihnen aber auch, ein Dashboard öffentlich zu teilen, mit einem Passwort zu schützen, auf bestimmte IPs zu beschränken und auf Ihrer eigenen Domain zu hosten. Diese Seite behandelt alle vier Möglichkeiten.

## Private Dashboards (Standard)

Ein Dashboard ist nur für eingeloggte Mitglieder Ihres Projekts erreichbar. Die URL sieht aus wie `https://oneuptime.com/dashboards/<id>/view` und erfordert einen Login.

Innerhalb des Projekts steuern Eigentümer und Labels, wer was sieht – siehe [Konfiguration & Berechtigungen](/docs/dashboards/configuration).

## Öffentliche Dashboards

Unter **Dashboard → Einstellungen** schalten Sie **Öffentliches Dashboard** ein. Das Dashboard hat dann eine zweite URL, die keinen Login benötigt. Teilen Sie sie mit Lieferanten, Partnern, Kunden oder fügen Sie sie in eine öffentliche README ein.

Ein öffentliches Dashboard:

- Öffnet sich immer im Modus **Ansicht**. Öffentliche Besucher können nicht bearbeiten oder die Widget-Palette sehen.
- Enthält die von Ihnen hinzugefügten Variablen. Besucher wählen aus denselben Dropdowns wie Ihr Team.
- Verwendet das **Branding**, das Sie in den Einstellungen festgelegt haben – Seitentitel, Beschreibung, Logo, Favicon.

Behandeln Sie das Aktivieren eines öffentlichen Dashboards wie das Veröffentlichen einer Webseite. Jedes Widget darauf wird weltweit lesbar. Schauen Sie sich an, was auf der Arbeitsfläche steht, bevor Sie den Schalter umlegen.

## Master-Passwort

Um ein öffentliches Dashboard mit einem Passwort zu versehen:

1. Schalten Sie **Öffentliches Dashboard** ein.
2. Schalten Sie **Master-Passwort** ein.
3. Legen Sie das Passwort fest.

Besucher sehen eine Passwortabfrage, bevor das Dashboard erscheint. Das Passwort wird als Hash gespeichert – wir sehen das eigentliche Passwort nie.

Verwenden Sie ein Master-Passwort, wenn:

- Sie mit einem Partner oder Kunden teilen möchten, aber die URL nicht nützlich sein soll, falls sie nach außen dringt.
- Das Dashboard „halböffentlich" ist – offen genug, dass Sie nicht jeden Betrachter als Teammitglied einladen möchten, aber nicht offen genug, um es ins offene Internet zu stellen.

Für ein strengeres Gating (separate Konten pro Betrachter, ein Prüfprotokoll, wer was gesehen hat) belassen Sie das Dashboard privat und laden Sie Betrachter stattdessen als schreibgeschützte Teammitglieder ein.

## IP-Zugriffsliste

Im **Scale**-Tarif können Sie ein öffentliches Dashboard auf eine Liste von IP-Adressen oder -Bereichen beschränken. Konfigurieren Sie das unter **Dashboard → Einstellungen → IP-Whitelist**.

Nutzen Sie das, wenn:

- Das Dashboard nur aus Ihrem Büro oder VPN erreichbar sein soll.
- Ein Lieferantenportal nur aus deren bekannten IPs erreichbar sein soll.
- Sie zusätzlichen Schutz neben einem Master-Passwort wünschen.

Anfragen von anderen IPs werden abgelehnt.

## Eigene Domains

Ab Werk wird ein öffentliches Dashboard auf `oneuptime.com` ausgeliefert. Um es auf Ihrer eigenen Subdomain wie `dashboard.acme.com` zu hosten:

1. Fügen Sie in Ihrem DNS einen CNAME-Eintrag hinzu, der die Subdomain auf das Ziel von OneUptime zeigt.
2. Fügen Sie die Domain unter **Dashboard → Einstellungen → Eigene Domains** hinzu.
3. Verifizieren Sie sie. OneUptime prüft den DNS-Eintrag für Sie.
4. Nach der Verifizierung ist das Dashboard sowohl unter Ihrer eigenen Domain als auch unter der ursprünglichen URL erreichbar.

Eigene Domains sind nützlich für:

- Kundenseitige Dashboards in Ihrem eigenen Branding.
- Co-Branded Partner-Dashboards.
- Öffentliche Statusseiten mit einer eigenen URL.

Sie können einem einzelnen Dashboard mehrere eigene Domains zuweisen, wenn Sie denselben Inhalt mehreren Zielgruppen ausliefern möchten.

## Branding

Unter **Dashboard → Einstellungen** konfigurieren Sie:

- **Seitentitel** – was im Browser-Tab und am oberen Seitenrand erscheint.
- **Seitenbeschreibung** – die Beschreibung, die Suchmaschinen und soziale Vorschauen verwenden.
- **Logo** – laden Sie ein PNG oder SVG hoch, das im Kopfbereich angezeigt wird.
- **Favicon** – das kleine Symbol im Browser-Tab.

Branding wirkt nur, wenn das Dashboard öffentlich angezeigt wird. Interne Betrachter sehen weiterhin das Branding von OneUptime.

## Einbetten

Sie können ein öffentliches Dashboard in Ihre eigene Website mit einem iframe einbetten:

```html
<iframe
  src="https://dashboard.acme.com/view"
  width="100%"
  height="800"
  frameborder="0"
></iframe>
```

Hat das Dashboard ein Master-Passwort, sehen Besucher die Passwortabfrage innerhalb des iframes.

## Teilbare URLs

Die Dashboard-URL enthält die aktuellen Variablenauswahlen und den Zeitbereich als Query-Parameter. Stellen Sie die Dropdowns ein, kopieren Sie die URL, fügen Sie sie im Chat ein – wer den Link öffnet, sieht das Dashboard mit exakt derselben Ansicht.

Das ist der schnellste Weg, eine Kollegin auf „das Dashboard zum Zeitpunkt, als der Vorfall begann" zu verweisen. Zeitbereich fixieren, kopieren, einfügen.

## Weiterführende Themen

- [Konfiguration & Berechtigungen](/docs/dashboards/configuration) – Zugriffskontrolle im privaten Modus.
- [Variablen & Filter](/docs/dashboards/variables) – Variablen, mit denen Besucher interagieren können.
- [Dashboard erstellen](/docs/dashboards/authoring) – was auf die Arbeitsfläche gehört.
