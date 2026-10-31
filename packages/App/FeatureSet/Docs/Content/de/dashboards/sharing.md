# Teilen & öffentliche Dashboards

Standardmäßig ist ein Dashboard privat für Ihr Projekt: Nur Personen, die sich in Ihrem Projekt anmelden, können es sehen. Sie können es auch über einen öffentlichen Link teilen, diesen Link mit einem Passwort schützen, ihn auf bestimmte IP-Adressen beschränken und ihn unter Ihrer eigenen Domain bereitstellen. Diese Seite behandelt alle vier.

:::cards
- [Wer ein Dashboard sehen kann](#wer-ein-dashboard-sehen-kann): Eine Wahl aus dreien, mit dem Tarif, den jede braucht.
- [Mit einem Passwort teilen](#mit-einem-passwort-teilen): Teilen Sie den Link und dann das Passwort mit den Personen, die es sehen sollen.
- [IP-Zulassungsliste](#ip-zulassungsliste): Den öffentlichen Link nur für Ihr Büro oder VPN öffnen.
- [Eigene Domains](#eigene-domains): Das Dashboard unter Ihrer eigenen Domain bereitstellen, mit einem kostenlosen Zertifikat.
:::

## Was ein Besucher durchläuft

Ein Besucher, der den öffentlichen Link eines Dashboards öffnet, trifft der Reihe nach auf jede dieser Prüfungen. Projektmitglieder, die sich bei OneUptime anmelden, sehen das Dashboard im Produkt, egal was Sie hier wählen.

```mermaid title="Was ein Besucher sieht, wenn er den öffentlichen Link öffnet"
flowchart TB
    visit["Ein Besucher öffnet<br/>den öffentlichen Link"] --> shared("Ist das Dashboard<br/>öffentlich geteilt?")
    shared -->|"Nein"| missing["Eine Seite<br/>„nicht gefunden“"]
    shared -->|"Ja"| allowed("Steht seine Adresse<br/>auf der IP-Liste?")
    allowed -->|"Ja, oder<br/>keine Liste"| locked("Ist ein Passwort<br/>nötig?")
    allowed -->|"Nein"| denied["Eine Seite<br/>Access Denied"]
    locked -->|"Ja"| prompt["Die Passwort-<br/>abfrage"]
    prompt --> board["Das Dashboard"]
    locked -->|"Nein"| board
```

## Wer ein Dashboard sehen kann

Öffnen Sie das Dashboard und wählen Sie **⋯ → Teilen**, oder öffnen Sie **Freigabe** im Seitenmenü des Dashboards. Die Karte **Wer dieses Dashboard sehen kann** ist eine einzige Wahl:

- **Nur Personen in diesem Projekt** (Standard): Mitglieder sehen das Dashboard, wenn sie sich bei OneUptime anmelden. Es hat keinen öffentlichen Link: Seine öffentliche Adresse zeigt dieselbe Seite „nicht gefunden“ wie eine Adresse ohne Dashboard und nichts über das Dashboard, nicht einmal seinen Namen.
- **Alle mit dem Link**: Das Dashboard ist öffentlich. Wer seinen Link hat, kann es sehen, ohne sich anzumelden.
- **Alle mit dem Link und einem Passwort**: Besucher öffnen den Link und geben dann ein Passwort ein, das Sie mit ihnen teilen. Niemand braucht ein Konto.

Die Wahl einer Option bittet um Bestätigung, sagt, was sich für Besucher ändert, und gilt dann sofort. Die Wahl von **Alle mit dem Link und einem Passwort** fragt im selben Dialog nach dem Passwort, wenn das Dashboard keines hat; solange sie gewählt ist, ersetzt **Passwort ändern** es. Solange das Dashboard öffentlich ist, stehen die Adressen, unter denen Besucher es öffnen, unter der Wahl: zuerst seine eigenen Domains, dann sein öffentlicher Link, jede mit **Link kopieren**. Eine eigene Domain, die noch nicht erreichbar ist, ist mit **Noch nicht live** markiert, mit dem Grund.

Innerhalb des Projekts bestimmen Eigentümer und Beschriftungen, wer was sieht — siehe [Dashboard-Konfiguration & Berechtigungen](/docs/dashboards/configuration). Wer das Dashboard sehen, aber nicht bearbeiten darf, sieht die Wahl und kann den öffentlichen Link kopieren, aber nicht ändern.

In OneUptime Cloud braucht das Teilen eines Dashboards den Tarif **Growth**: In einem niedrigeren Tarif zeigen die beiden öffentlichen Optionen den Tarif, den sie brauchen, und können nicht gewählt werden. Ein Dashboard wieder privat zu machen — **Nur Personen in diesem Projekt** — funktioniert in jedem Tarif, sodass ein Dashboard, das nach dem Ende einer Testphase oder nach einem Wechsel in einen niedrigeren Tarif öffentlich geblieben ist, immer aufhören kann, geteilt zu werden; der Dialog sagt, dass erneutes Teilen **Growth** braucht. Der Wechsel zwischen **Alle mit dem Link** und **Alle mit dem Link und einem Passwort** sowie das Ändern des Passworts funktionieren in jedem Tarif. Ein über die API oder Terraform erstelltes Dashboard unterliegt denselben Tarifen: öffentlich erstellt braucht es **Growth**, mit einer IP-Zulassungsliste erstellt **Scale**.

Die Wahl wird in drei Spalten gespeichert, die die API und Terraform wie bisher lesen und schreiben: `isPublicDashboard`, `enableMasterPassword` und `masterPassword`. Nur ein öffentliches Dashboard hat einen öffentlichen Link, und seine Besucher werden nach dem Passwort gefragt, wann immer `enableMasterPassword` an ist. Ein öffentliches Dashboard mit `enableMasterPassword` an, aber ohne gesetztes Passwort lässt niemanden über seinen öffentlichen Link hinein: Die Seite **Freigabe** zeigt es als **Alle mit dem Link und einem Passwort**, sagt, dass noch niemand den Link öffnen kann, und bietet **Passwort festlegen** an. Die Wahl von **Nur Personen in diesem Projekt** schaltet auch `enableMasterPassword` aus und behält das Passwort, sodass erneutes Teilen mit Passwort es wiederverwenden kann.

## Öffentliche Dashboards

Ein öffentliches Dashboard:

- Öffnet sich immer zum Lesen. Besucher können es nicht bearbeiten und sehen nie seine Bearbeitungselemente.
- Enthält die Variablen, die Sie hinzugefügt haben. Besucher wählen aus denselben Auswahlen wie Ihr Team und können den Zeitbereich ändern, zoomen, die automatische Aktualisierung einschalten und in den Vollbildmodus wechseln. Es öffnet sich mit dem Standardzeitraum und der standardmäßigen automatischen Aktualisierung des Dashboards, und der Browser jedes Besuchers merkt sich seine eigene Auswahl.
- Lässt Besucher [seine Listen und Tabellen sortieren](/docs/dashboards/widgets#listen-und-tabellen-sortieren), indem sie auf einen Spaltenkopf klicken, wie Ihr Team es tut. Der Browser jedes Besuchers merkt sich seine eigene Sortierung, und OneUptime sortiert die ganze Liste selbst, immer nur nach einer der Spalten des Widgets.
- Verwendet das Branding, das Sie auf der Seite **Branding** des Dashboards festlegen: Seitentitel, Beschreibung, Logo, Design, Favicon.
- Lässt jeden Besucher mit einer Schaltfläche mit Sonne oder Mond in seiner Werkzeugleiste zwischen dem hellen und dem dunklen Dashboard wechseln; [Design](#design) erklärt, wie.

Behandeln Sie das Teilen eines Dashboards wie das Veröffentlichen einer Webseite. Jedes Widget darauf wird für alle mit dem Link lesbar. Sehen Sie sich an, was auf der Arbeitsfläche ist, bevor Sie es teilen.

Jedes Widget veröffentlicht nur, was es zeichnet, und nur für die Ressourcen, auf die es gerichtet wurde. Ein SLO-Widget zum Beispiel veröffentlicht die Kennzahlen dieses SLO, aber nie seine Definition — siehe [SLO](/docs/dashboards/widgets#slo). Widgets mit externer **Datenquelle** sind die Ausnahme: Sie werden aus einem öffentlichen Dashboard ganz weggelassen statt gezeichnet, weil ihre Konfiguration die Abfrage selbst ist. Einige weitere Widgets können ohne angemeldete Sitzung nicht angezeigt werden und sagen das an ihrer Stelle: [Auf einem öffentlichen Dashboard](/docs/dashboards/widgets#auf-einem-öffentlichen-dashboard) führt sie auf.

## Mit einem Passwort teilen

Wählen Sie **Alle mit dem Link und einem Passwort** und geben Sie das Passwort im Dialog ein. Besucher sehen eine Passwortabfrage, bevor das Dashboard erscheint. Die Abfrage zeigt den Namen, den Seitentitel und das Favicon des Dashboards, im Design des Dashboards, und sonst nichts: Seine Beschreibung, sein Logo und seine Widgets erscheinen, sobald das Passwort eingegeben ist. Das Passwort wird als Hash gespeichert — niemand kann es zurücklesen. Ein neues Passwort gilt sofort; wer das alte eingegeben hat, kann das Dashboard noch bis zu 7 Tage lang ansehen.

Verwenden Sie ein Passwort, wenn:

- Sie mit einem Partner oder Kunden teilen wollen, die URL aber nicht nützlich sein soll, falls sie durchsickert.
- Das Dashboard „halböffentlich“ ist — offen genug, dass Sie nicht jeden Betrachter als Teammitglied einladen wollen, aber nicht offen genug für das offene Internet.

Für eine stärkere Absicherung (eigene Konten pro Betrachter, ein Prüfpfad, wer was angesehen hat) belassen Sie das Dashboard bei **Nur Personen in diesem Projekt** und laden Sie Betrachter stattdessen als Teammitglieder mit Leserechten ein.

## IP-Zulassungsliste

Unter **Weitere Einstellungen** auf der Seite **Freigabe** beschränkt der Abschnitt **IP-Zulassungsliste** (die Spalte `ipWhitelist`) den öffentlichen Link auf die IP-Adressen oder IPv4-Bereiche, die Sie auflisten, einen pro Zeile, zum Beispiel `203.0.113.7` oder `10.0.0.0/8`. Sie gilt mit und ohne Passwort; angemeldete Projektmitglieder sind nicht betroffen. Lassen Sie sie leer, um jede Adresse zu erlauben. Sie speichert sich eigenständig, getrennt von der Wahl, und sie zu ändern braucht in OneUptime Cloud den Tarif **Scale**; sie zu leeren funktioniert in jedem Tarif. Solange eine Liste gilt, zeigt der eingeklappte Kopf von **Weitere Einstellungen** **IP-Zulassungsliste** mit der Anzahl ihrer Einträge. Selbst gehostet gehört das Ändern zur Enterprise Edition: In der Community Edition gilt eine bereits gesetzte Liste weiter und kann nur entfernt werden.

Verwenden Sie dies, wenn:

- Das Dashboard nur aus Ihrem Büro oder VPN erreichbar sein soll.
- Ein Lieferantenportal nur von dessen bekannten IPs erreichbar sein soll.
- Sie zusätzlich zu einem Passwort einen weiteren Schutz wollen.

Anfragen von jeder anderen IP werden mit einer Seite **Access Denied** abgewiesen, die nichts über das Dashboard zeigt: nicht seinen Namen, nicht sein Branding und nicht seine Passwortabfrage. Eine Zeile, die keine IP-Adresse und kein IPv4-Bereich ist, wird beim Speichern abgelehnt, weil der Server sie überspringen würde.

## Eigene Domains

Standardmäßig wird ein öffentliches Dashboard unter seinem öffentlichen Link bereitgestellt, auf der eigenen Adresse von OneUptime. Um es unter Ihrer eigenen Subdomain wie `dashboard.acme.com` bereitzustellen, öffnen Sie **Branding → Benutzerdefinierte Domains** im Seitenmenü des Dashboards. Es funktioniert genau wie die Seite **Benutzerdefinierte Domains** einer Statusseite.

Die Karte heißt **Benutzerdefinierte Domains** und sagt, was zu tun ist: Lassen Sie den CNAME-Eintrag jeder Domain auf den Dashboard-CNAME-Eintrag Ihrer Installation zeigen, und OneUptime stellt das SSL-Zertifikat der Domain aus und erneuert es für Sie. Die Tabelle hat zwei Spalten, **Domäne** und **Status**.

Ihr Dashboard unter Ihrer eigenen Domain bereitzustellen, braucht drei Schritte, und nur die ersten beiden sind Ihre:

1. **Die Domain hinzufügen**: eine Subdomain und eine Ihrer verifizierten Domains.
2. **Ihren CNAME-Eintrag hinzufügen**, bei Ihrem DNS-Anbieter. Der Dialog **DNS-Einrichtung** öffnet sich mit dem Eintrag, sobald Sie die Domain hinzufügen.
3. **Das kostenlose SSL-Zertifikat wird automatisch ausgestellt**, sobald der Eintrag gefunden wird. Es gibt keine Schaltfläche zu drücken.

Nach der Verifizierung ist das Dashboard sowohl unter Ihrer eigenen Domain als auch unter der ursprünglichen URL erreichbar.

### Die Domain hinzufügen

Klicken Sie auf **Dashboard-Domain erstellen**. Der Dialog ist eine einzige Seite:

- **Subdomain**: nur die Bezeichnung, Platzhalter `dashboard (leave blank for root)`. Geben Sie nur `dashboard` ein, nicht den ganzen Hostnamen. Lassen Sie sie leer oder geben Sie `@` ein, um die Stammdomain (Apex) zu verwenden.
- **Domäne**: die unter **Projekteinstellungen → Erweitert → Domänen** verifizierten Domains, wo Sie mit einem TXT-Eintrag beweisen, dass Ihnen eine Domain gehört. Eine Domain, die Sie nicht verifiziert haben, wird nicht aufgeführt, weil sie abgelehnt würde. Der Link **Domain hinzufügen** neben dem Feld öffnet diese Seite in einem neuen Tab.
- **Weitere Felder**: eingeklappt. Solange es eingeklappt ist, sagt sein Kopf, welches Zertifikat die Domain verwenden wird: „Wir stellen ein kostenloses SSL-Zertifikat für diese Domain aus und erneuern es automatisch.“ Öffnen Sie es nur, um ein eigenes Zertifikat zu verwenden (siehe unten).

Klicken Sie auf **Dashboard-Domain erstellen**. Der Dialog schließt sich, und die **DNS-Einrichtung** der neuen Domain öffnet sich. Der vollständige Name einer Domain wird beim Hinzufügen festgelegt; **Bearbeiten** ändert daher nur ihr Zertifikat. Um eine andere Subdomain zu verwenden, fügen Sie diese Domain hinzu und löschen die alte.

### DNS-Einrichtung und Jetzt prüfen

Der Dialog **DNS-Einrichtung** zeigt den Eintrag, den Sie bei Ihrem DNS-Anbieter hinzufügen, ein Feld pro Zeile, jedes mit einer Schaltfläche zum Kopieren: **Typ** `CNAME`, **Name** die vollständige Domain, die Sie hinzugefügt haben, und **Wert** der Dashboard-CNAME-Eintrag Ihrer Installation. Für eine Stammdomain, eine ohne Subdomain, fügt der Dialog einen Hinweis hinzu: Viele DNS-Anbieter erlauben dort keinen CNAME-Eintrag, verwenden Sie daher stattdessen den ALIAS-, ANAME- oder CNAME-Flattening-Eintrag Ihres Anbieters mit demselben Wert.

OneUptime prüft jede nicht verifizierte Domain alle 15 Minuten, und wenn die Prüfung den Eintrag findet, bestellt sie das kostenlose Let's-Encrypt-Zertifikat der Domain in derselben Prüfung, ob Sie zurückkommen oder nicht. Um sofort zu prüfen, klicken Sie auf **Jetzt prüfen**:

- **Der Eintrag ist noch nicht gefunden.** Der Dialog bleibt offen und sagt, nach welchem Eintrag er gesucht hat. Ein neuer DNS-Eintrag kann eine Weile brauchen, bis er erscheint. Klicken Sie später erneut auf **Jetzt prüfen**, oder überlassen Sie es der Prüfung alle 15 Minuten.
- **Der Eintrag ist gefunden.** Der Dialog sagt „Ihr CNAME-Eintrag ist verifiziert.“ und was als Nächstes mit dem Zertifikat geschieht. Das kostenlose Zertifikat wird in diesem Moment bestellt und ist meist innerhalb von 15 Minuten aktiv.

Bis eine Domain verifiziert ist und ihr Zertifikat bereitsteht, hat ihre Zeile eine Aktion **DNS-Einrichtung**, die denselben Dialog öffnet. Bei einer verifizierten Domain, deren Zertifikatsbestellung immer wieder fehlschlägt oder deren Zertifikat abgelaufen ist, bestellt **Jetzt prüfen** dort erneut und zeigt, warum die letzte Bestellung fehlgeschlagen ist. Es bestellt höchstens einmal pro Domain alle 15 Minuten; dazwischen versucht OneUptime es von selbst weiter und wartet nach jedem Fehlschlag in Folge etwas länger. Die Erneuerung erfolgt automatisch, lange bevor das Zertifikat abläuft, und eine fehlgeschlagene DNS-Prüfung entfernt nie ein Zertifikat, das noch gültig ist.

### Die Spalte Status lesen

Die Spalte **Status** sagt, wo jede Domain auf ihrem Weg zu HTTPS steht, in einem von acht Zuständen, genau wie bei Statusseiten. Ist eine Bestellung fehlgeschlagen, steht der Grund in der Zeile darunter.

| Was die Spalte Status sagt | Was es bedeutet |
| --- | --- |
| Warten auf DNS: Fügen Sie den CNAME-Eintrag hinzu. | Der CNAME-Eintrag ist noch nicht gefunden. Öffnen Sie **DNS-Einrichtung** für den Eintrag, fügen Sie ihn bei Ihrem DNS-Anbieter hinzu und klicken Sie dann auf **Jetzt prüfen** oder warten Sie auf die Prüfung alle 15 Minuten. |
| Kostenloses Zertifikat wird ausgestellt, meist innerhalb von 15 Minuten. | Der Eintrag ist verifiziert, und das Zertifikat wird bestellt oder geschrieben. Nichts zu tun. |
| Kostenloses Zertifikat konnte noch nicht ausgestellt werden. Wir versuchen es weiter. | Der Eintrag ist verifiziert, aber die Bestellung seines Zertifikats ist fehlgeschlagen, aus dem Grund in der Zeile darunter. Beheben Sie die Ursache, öffnen Sie dann **DNS-Einrichtung** und klicken Sie auf **Jetzt prüfen**, um sofort erneut zu bestellen. |
| Zertifikat abgelaufen. Wir versuchen weiter, es zu erneuern. | Das Zertifikat der Domain ist abgelaufen, weil seine Erneuerungen fehlgeschlagen sind. Öffnen Sie **DNS-Einrichtung** und klicken Sie auf **Jetzt prüfen**, um es sofort zu erneuern und den Grund zu sehen. |
| Zertifikat ausgestellt, wird automatisch erneuert. | Fertig. Die Domain liefert ihr Zertifikat über HTTPS aus, und OneUptime erneuert es. |
| Zertifikat ausgestellt, aber die Erneuerung ist fehlgeschlagen. Wir versuchen es weiter. | Die Domain liefert noch ein gültiges Zertifikat aus, aber ihre letzte Erneuerung ist fehlgeschlagen, aus dem Grund in der Zeile darunter. OneUptime versucht es lange vor dem Ablauf des Zertifikats erneut. |
| Verwendet Ihr hochgeladenes Zertifikat. | Der Eintrag ist verifiziert, und die Domain wird mit dem Zertifikat ausgeliefert, das Sie hochgeladen haben. |
| Verifiziert. Verwendet das HTTPS Ihres eigenen Proxys. | Bei einer selbst gehosteten Installation ohne Let's-Encrypt-Kontoschlüssel ist der Eintrag verifiziert und die Domain erreichbar. Ihr HTTPS übernimmt Ihr eigener Proxy, es sei denn, Sie laden ein Zertifikat hoch. |

Schlägt eine Bestellung fehl, sind die üblichen Ursachen ein CAA-Eintrag Ihrer Domain, der `letsencrypt.org` nicht erlaubt, und bei einer selbst gehosteten Installation ein Server, den Let's Encrypt auf Port 80 nicht erreichen kann.

### Ihr eigenes Zertifikat und Neuausstellung

Um stattdessen Ihr eigenes Zertifikat zu verwenden, öffnen Sie beim Hinzufügen der Domain **Weitere Felder**, schalten **Benutzerdefiniertes Zertifikat hochladen** ein und fügen **Zertifikat** und **Privater Schlüssel des Zertifikats** ein. OneUptime liefert es innerhalb von 15 Minuten aus, statt ein Let's-Encrypt-Zertifikat zu bestellen, und es ersetzt jedes Let's-Encrypt-Zertifikat, das die Domain vorher hatte. Ein hochgeladenes Zertifikat zu erneuern, ist Ihre Sache: Bearbeiten Sie die Domain und fügen Sie das neue ein. Hatte die Domain vorher ein kostenloses Zertifikat, erneuert OneUptime es weiter, während Ihres in Gebrauch ist, sodass der Wechsel zurück sofort geht.

Sobald für eine Domain ein kostenloses Zertifikat bestellt wurde, zeigt ihre Zeile **SSL neu ausstellen**, das Let's Encrypt um ein brandneues Zertifikat bittet, wenn Sie eines vor der automatischen Erneuerung wollen. Jede Domain kann einmal alle 24 Stunden neu ausgestellt werden.

Bei einer selbst gehosteten Installation werden eigene Domains für Dashboards über die Umgebungsvariable `DASHBOARD_CNAME_RECORD` eingeschaltet (`dashboard.cnameRecord` im Helm-Chart), das Ziel, auf das Ihre CNAME-Einträge zeigen. Ohne sie sagen die Karte und der Dialog **DNS-Einrichtung** "Custom Domains not enabled for this OneUptime installation", statt einen Eintrag zu zeigen, und OneUptime verifiziert keine Domains und bestellt keine Zertifikate für Dashboards. Eine Installation ohne Let's-Encrypt-Kontoschlüssel (`LETS_ENCRYPT_ACCOUNT_KEY`, `letsEncrypt.accountKey` im Helm-Chart) bestellt keine Zertifikate: Eine Dashboard-Domain ist erreichbar, sobald ihr Eintrag verifiziert ist, und wird über das HTTPS Ihres eigenen Proxys oder ein Zertifikat ausgeliefert, das Sie hochladen.

### Wer prüfen und neu ausstellen darf

**Jetzt prüfen**, die Bestellung des Zertifikats einer Domain und **SSL neu ausstellen** ändern die Domain, also brauchen sie die Berechtigung, sie zu bearbeiten: **Edit Dashboard Domain** oder eine Rolle, die sie enthält (Project Owner, Project Admin, Project Member, Settings Admin oder Settings Member).

Wer die Domain nur lesen darf, etwa ein Viewer oder ein Settings Viewer, sieht weiterhin die Spalte **Status** und den hinzuzufügenden Eintrag in **DNS-Einrichtung**. Für sie sind **Jetzt prüfen** und **SSL neu ausstellen** gesperrt und sagen, welche Berechtigung sie brauchen. OneUptime prüft jede Domain und bestellt ihr Zertifikat so oder so von selbst.

Dasselbe gilt für API-Schlüssel. Ein Schlüssel, der Dashboard-Domains nur lesen darf, kann `verify-cname`, `order-ssl` oder `reissue-ssl` auf `/dashboard-domain` nicht aufrufen. Geben Sie ihm **Read Dashboard Domain** und **Edit Dashboard Domain**, wenn er das braucht.

Eine Domain gehört jeweils zu einem Dashboard des Projekts. Sie können einem Dashboard mehr als eine eigene Domain zuordnen, wenn Sie denselben Inhalt mehreren Zielgruppen bereitstellen: ein kundennahes Dashboard unter Ihrer eigenen Marke, ein gemeinsam gebrandetes Partner-Dashboard oder eine öffentliche Statusseite mit eigener URL. Ein Name, den schon eine Statusseite oder ein Formular verwendet, in welchem Projekt auch immer, wird abgelehnt: Eine Domain zeigt eine Statusseite, ein Dashboard oder ein Formular.

## Branding

Auf der Seite **Branding** des Dashboards können Sie festlegen:

- **Seitentitel** — was im Browser-Tab und oben auf der Seite steht.
- **Seitenbeschreibung** — die Beschreibung, die Suchmaschinen und Link-Vorschauen verwenden.
- **Logo** — ein Bild im Kopf des öffentlichen Dashboards.
- **Design** — hell, dunkel oder so, wie das Gerät jedes Besuchers eingestellt ist; siehe [Design](#design).
- **Favicon** — das kleine Symbol im Browser-Tab.

Das Logo und das Favicon sind Dateien, die im eigenen Projekt des Dashboards hochgeladen wurden, und das wird bei jedem Speichern geprüft — aus dem Dashboard, über die API, Terraform oder einen Workflow. Eine in einem anderen Projekt hochgeladene Datei wird mit den Worten abgelehnt, die eine nicht mehr vorhandene Datei bekommt: "The logo's file could not be found. Upload the logo again." oder "The favicon's file could not be found. Upload the favicon again." Das öffentliche Dashboard zeigt nur Bilder seines eigenen Projekts.

Der Seitentitel und die Beschreibung stehen für Ihr Team auch über der Werkzeugleiste des Dashboards, anstelle seines Namens und seiner Beschreibung. Das Logo, das Design und das Favicon gelten nur für das öffentliche Dashboard.

Besucher sehen das Branding erst, sobald sie das Dashboard sehen dürfen. Vor der Eingabe des Passworts zeigt ein mit Passwort geteiltes Dashboard nur seinen Seitentitel, sein Favicon und sein Design, und Suchmaschinen und Link-Vorschauen sehen seinen Seitentitel, aber nicht seine Seitenbeschreibung. Ein Dashboard mit IP-Zulassungsliste zeigt sein Branding nur den Adressen auf der Liste, und Suchmaschinen und Link-Vorschauen sehen nichts davon.

### Design

Die Karte **Design**, direkt unter dem Logo, legt fest, wie das öffentliche Dashboard für seine Besucher aussieht. Wählen Sie eine ihrer drei Möglichkeiten, und sie wird sofort gespeichert; es gibt keine Schaltfläche **Bearbeiten**.

| Auswahl | Was Besucher sehen |
| ------ | ----------------- |
| **Hell** | Das helle Dashboard, egal wie ihr Gerät eingestellt ist. Dashboards, die vor dieser Einstellung angelegt wurden, sind **Hell**, sie sehen also aus wie immer. |
| **Dunkel** | Das dunkle Dashboard, egal wie ihr Gerät eingestellt ist. |
| **Wie das Gerät des Besuchers** | Hell oder dunkel, wie ihr Gerät eingestellt ist, und das Dashboard wechselt mit dem Gerät, solange es offen ist. |

Was Sie auch wählen: Eine Schaltfläche mit Sonne oder Mond in der Werkzeugleiste des Dashboards lässt jeden Besucher zum hellen oder zum dunklen Dashboard wechseln oder zurück zu dem Design, das Sie festgelegt haben, und sein Browser merkt sich die Wahl für jedes öffentliche Dashboard unter dieser Adresse. Auf dem dunklen Dashboard steht das Logo auf einem hellen Hintergrund, sodass auch ein Logo für eine weiße Seite gut zu sehen bleibt.

Ein Dashboard, das ab jetzt angelegt wird, beginnt mit **Wie das Gerät des Besuchers**. Über die API und Terraform heißt das Feld `theme`, mit einem der Werte `Light`, `Dark` oder `System` (**Wie das Gerät des Besuchers**), genau so geschrieben; jeder andere Wert wird abgelehnt. Eine Terraform-Konfiguration, die kein `theme` setzt, bekommt `Light`, sodass eine Konfiguration von vor dieser Einstellung nie eine Änderung an einem Dashboard plant, das sie verwaltet.

Das Design steht im HTML des Dashboards, das Dashboard wird also von Anfang an darin gezeichnet: Ein dunkles Dashboard blitzt beim Laden nicht weiß auf, und auch seine Passwortabfrage wird darin gezeichnet. Jedes Widget folgt ihm; der eigene Code eines HTML-Widgets kann das dunkle Design gestalten, wie [HTML](/docs/dashboards/widgets#html) beschreibt. Die Seiten **Access Denied** und „nicht gefunden“ zeigen nichts von einem Dashboard, also folgen sie dem Besucher: seiner eigenen Wahl, sonst seinem Gerät.

## Einbetten

Sie können ein öffentliches Dashboard mit einem iframe in Ihre eigene Website einbetten, unter seinem öffentlichen Link oder unter einer seiner eigenen Domains:

```html title="embed.html"
<iframe
  src="https://dashboard.acme.com"
  width="100%"
  height="800"
  frameborder="0"
></iframe>
```

Ist das Dashboard mit einem Passwort geteilt, sehen Besucher die Passwortabfrage im iframe.

Um einem eingebetteten Dashboard das Aussehen Ihrer Website zu geben, hängen Sie `?theme=light` oder `?theme=dark` an seine Adresse an, wie in `https://dashboard.acme.com/?theme=dark`: Das Dashboard wird dann für alle, die diese Adresse öffnen, in diesem Design gezeichnet, unabhängig von seinem eigenen Design und der Wahl des Besuchers, und seine Werkzeugleiste hat keine Design-Schaltfläche. `?theme=system` folgt dem Gerät jedes Besuchers. Das Design bleibt über die Passwortabfrage hinweg erhalten.

## Einen Link senden

Der öffentliche Link öffnet das Dashboard mit seinen gespeicherten Standardwerten. Um einen Link zu senden, der mit einem bestimmten Wert öffnet, hängen Sie die Variable als `?var-<name>=<value>` an, wie es die Adressleiste tut, wenn ein Besucher einen Wert wählt; mehrere Werte werden durch Kommas getrennt. Um es mit einem eigenen Zeitbereich oder einer eigenen automatischen Aktualisierung zu öffnen, hängen Sie auf dieselbe Weise `range` und `refresh` an: `?range=1d&refresh=1m` öffnet es mit dem letzten Tag und aktualisiert es jede Minute, wie es ein Wandbildschirm braucht. `range` nimmt `5m`, `15m`, `30m`, `1h`, `2h`, `3h`, `1d`, `2d`, `7d`, `14d`, `1mo` oder `3mo`, und `refresh` nimmt `off`, `5s`, `10s`, `30s`, `1m`, `5m` oder `15m`. Sie haben Vorrang vor den Standardwerten des Dashboards und der eigenen Auswahl des Besuchers, und Besucher können sie trotzdem ändern. Um das Dashboard in einem Design zu öffnen, hängen Sie `theme=light`, `theme=dark` oder `theme=system` an, wie [Einbetten](#einbetten) beschreibt.

## Nächste Schritte

:::cards
- [Dashboard-Konfiguration & Berechtigungen](/docs/dashboards/configuration): Eigentümer, Beschriftungen und wer die Freigabe ändern darf.
- [Dashboard-Variablen & Filter](/docs/dashboards/variables): Die Auswahlen, die Besucher nutzen, und Links, die eine Auswahl behalten.
- [Dashboard-Widgets](/docs/dashboards/widgets): Was jedes Widget auf einem öffentlichen Dashboard veröffentlicht.
- [Statusseiten – Übersicht](/docs/status-pages/index): Sagen Sie Kunden, ob Ihr Dienst läuft.
:::
