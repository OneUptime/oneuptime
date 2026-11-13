# Anleitung zum Selbsthosten

Folgen Sie dieser Seite von oben nach unten, um von einem leeren Server zu Ihrem eigenen OneUptime zu kommen, das über HTTPS läuft, Ihnen eine Test-E-Mail geschickt hat und Sie alarmieren kann. Jeder Schritt endet damit, woran Sie erkennen, dass er funktioniert hat, und verweist für die Details auf die längeren Seiten.

:::cards
- [OneUptime installieren](#oneuptime-installieren): Docker Compose auf einem Server oder das Helm-Chart auf Kubernetes.
- [Den Server fertig einrichten](#den-server-fertig-einrichten): E-Mail, dann SMS und Anrufe, jeweils mit einem Test.
- [Ihre Installation prüfen](#ihre-installation-prüfen): Ein Befehl, der benennt, was nicht stimmt.
- [Schnellstart](/docs/introduction/quickstart): Ihr erster Monitor, Ihre erste Bereitschaftsrichtlinie und Ihre erste Statusseite.
:::

## Was Sie brauchen

- **Einen Server.** Für Docker Compose einen Linux-Server mit 8 GB Arbeitsspeicher, 4 Kernen und 20 GB Festplatte zum Ausprobieren, oder 16 GB, 8 Kerne und 400 GB für ein Team: siehe [Dimensionierung & Kapazitätsplanung](/docs/installation/sizing). Für das Helm-Chart einen Kubernetes-Cluster.
- **Einen Domainnamen**, über den OneUptime geöffnet werden soll, etwa `oneuptime.example.com`, mit einem DNS-`A`-Eintrag, der auf den Server zeigt. Sie können mit der IP-Adresse des Servers beginnen, aber ein Zertifikat von Let's Encrypt braucht einen Domainnamen.
- **Die Ports 80 und 443**, aus dem Internet erreichbar, für HTTPS.
- **Eine Möglichkeit, E-Mails zu senden**: einen Mailserver, etwa den Ihres Unternehmens, Microsoft 365 oder Google Workspace, oder ein Konto bei Amazon SES, SendGrid, Mailgun, Postmark oder Resend.
- **Ein Twilio-Konto**, um per SMS und Telefonanruf alarmiert zu werden. E-Mail und Push-Benachrichtigungen brauchen keines.

**Es hat funktioniert, wenn** `dig +short oneuptime.example.com` die IP-Adresse des Servers ausgibt.

## OneUptime installieren

:::tabs
@tab Docker Compose
Auf einem neuen Ubuntu-, Debian- oder RHEL-basierten Server installiert ein einziger Befehl Docker, Git und Node.js, wo sie fehlen, klont OneUptime in einen Ordner `oneuptime`, fragt nach der Adresse, über die OneUptime erreicht werden soll, und startet es:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

Dasselbe von Hand, mit installiertem Docker, Git und Node.js:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Öffnen Sie `config.env` und setzen Sie `HOST`, die erste Einstellung darin, auf Ihren Domainnamen oder Ihre IP-Adresse, ohne `http://`. Es ist die einzige Einstellung, die Sie ändern müssen: E-Mail, SMS und Anrufe richten Sie im Admin Dashboard ein, und alles unter `ADVANCED` funktioniert so, wie es ist. Starten Sie dann OneUptime:

```bash
npm start
```

**Es hat funktioniert, wenn** `npm start` mit **OneUptime is up!** und der zu öffnenden Adresse endet. Der erste Start dauert einige Minuten, während Docker die Images herunterlädt. Hält `npm start` vorher an, sagt es, was zu ändern ist. [Docker Compose](/docs/installation/docker-compose) hat alle Details.
@tab Kubernetes
Legen Sie eine `values.yaml` mit Ihrem Domainnamen oder Ihrer IP-Adresse an, ohne `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Das Chart legt seine Daten in der Standard-Storage-Class Ihres Clusters ab. Wenn `kubectl get storageclass` keine als `(default)` markiert, fügen Sie `global.storageClass` mit dem Namen einer davon hinzu. Installieren Sie dann das Chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Es hat funktioniert, wenn** `kubectl get pods` jeden Pod als `Running` zeigt und die Adresse, die `helm install` ausgegeben hat, OneUptime öffnet. Die [Installationsanleitung des Charts](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) hat alle Details.
:::

## HTTPS einschalten

Sobald Ihr Domainname auf den Server zeigt, lassen Sie OneUptime ein kostenloses Zertifikat von Let's Encrypt holen. Es erneuert das Zertifikat selbst.

:::tabs
@tab Docker Compose
Setzen Sie diese Werte in `config.env` und führen Sie dann `npm start` erneut aus:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Betreiben Sie schon einen Reverse Proxy, etwa Caddy, Nginx oder einen Load Balancer? Behalten Sie `PROVISION_SSL=false`, setzen Sie `HTTP_PROTOCOL=https` und `TRUSTED_PROXY_HOPS=2`, und lesen Sie [Einen eigenen Reverse Proxy verwenden](/docs/installation/docker-compose#einen-eigenen-reverse-proxy-verwenden).
@tab Kubernetes
Setzen Sie diese Werte in `values.yaml` und wenden Sie sie dann an:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

Um TLS stattdessen an einem eigenen Ingress-Controller zu beenden, lassen Sie `ssl.provision` aus und setzen nur `httpProtocol: https`.
:::

**Es hat funktioniert, wenn** `https://oneuptime.example.com` ohne Zertifikatswarnung öffnet. Das erste Zertifikat kommt meist innerhalb weniger Minuten. Probieren Sie OneUptime auf `localhost` aus? Überspringen Sie diesen Schritt: Ein Zertifikat braucht einen Domainnamen.

## Das Admin-Konto anlegen

Öffnen Sie Ihre Adresse, etwa `https://oneuptime.example.com`, und registrieren Sie sich. Das erste Konto auf einem neuen Server wird sein Master-Admin, der das Admin Dashboard unter `/admin` öffnen kann.

**Es hat funktioniert, wenn** `/admin` das Admin Dashboard öffnet. Solange E-Mail, HTTPS oder die Entscheidung über Registrierungen noch offen sind, öffnet es auf **Diesen Server fertig einrichten**.

## Den Server fertig einrichten

Die Seite **Server-Einrichtung** des Admin Dashboards unter `/admin/setup` listet auf, was ein neuer Server braucht, das Wichtigste zuerst. E-Mail, HTTPS und wer sich registrieren darf, sind Pflicht. SMS und Anrufe, eine globale Probe, Backups und Update-Prüfungen werden empfohlen. Jeder Punkt hat eine Schaltfläche, die die Stelle öffnet, an der er eingestellt wird, und `npm start` gibt am Ende die Adresse dieser Seite aus.

:::steps
### E-Mail einrichten

Klicken Sie auf **E-Mail einrichten**. Es öffnet **Einstellungen > Benachrichtigungen > E-Mails**, wo Sie Ihren Mailserver (die meisten nutzen Port `587`) oder Ihren E-Mail-Anbieter eintragen, und die Adresse, von der E-Mails kommen. Speichern Sie, klicken Sie dann auf **Test-E-Mail senden** und schicken Sie eine an sich selbst.

**Es hat funktioniert, wenn** die E-Mail ankommt und die Checkliste E-Mail als erledigt markiert. Schlägt der Test fehl, zeigt er, was der Mailserver geantwortet hat: siehe [SMTP](/docs/emails/smtp#fehlerbehebung).

### Festlegen, wer sich registrieren kann

Jeder, der Ihre Adresse öffnen kann, kann sich registrieren. Sobald Ihr Team seine Konten hat, schalten Sie **Registrierung erlauben** unter **Einstellungen > Authentifizierung** aus: Wen Sie in ein Projekt einladen, kann trotzdem beitreten. Um Registrierungen offen zu lassen, klicken Sie auf **Registrierungen offen lassen**.

**Es hat funktioniert, wenn** die Checkliste Registrierungen als erledigt markiert.

### SMS und Anrufe einrichten oder nur E-Mail und Push verwenden

Um per SMS und Telefonanruf alarmiert zu werden, klicken Sie auf **SMS und Anrufe einrichten** und tragen Ihr Twilio-Konto unter **Einstellungen > Benachrichtigungen > Anruf und SMS** ein: [Twilio-Integration](/docs/self-hosted/twilio-integration) zeigt, wo Sie jeden Wert finden. Klicken Sie dann auf **Test-SMS senden** und **Testanruf starten**. Um sie stattdessen über ein eigenes Gateway zu senden, siehe [SMS- und Anruf-Gateway](/docs/self-hosted/sms-and-call-gateway). Reichen E-Mail und Push-Benachrichtigungen, klicken Sie auf **Nur E-Mail und Push verwenden**.

**Es hat funktioniert, wenn** die SMS ankommt und Ihr Telefon klingelt, oder die Checkliste Ihre Entscheidung zeigt.
:::

Der HTTPS-Punkt ist erledigt, sobald [HTTPS einschalten](#https-einschalten) funktioniert, und jeder empfohlene Punkt sagt, was zu tun ist.

## Ihre Installation prüfen

:::tabs
@tab Docker Compose
Führen Sie im Ordner `oneuptime` den Doctor aus:

```bash
npm run doctor
```

Er prüft jeden Container, `config.env`, ob `HOST` diesen Server erreicht, das Zertifikat und den freien Speicherplatz, und fragt OneUptime, was es von sich selbst sieht, etwa E-Mail und Probes. Zu jedem Problem nennt er die Lösung: siehe [Ihre Installation prüfen](/docs/installation/docker-compose#ihre-installation-prüfen).
@tab Kubernetes
Führen Sie das Diagnoseskript des Charts gegen Ihren Cluster aus, wie die [Fehlerbehebungsanleitung des Charts](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it) zeigt. Es liest nur und endet mit einer Zusammenfassung dessen, was es gefunden hat, das Schlimmste zuerst.
:::

**Es hat funktioniert, wenn** der Doctor mit **Everything looks right.** endet und mit `0` beendet. Er beendet sich mit `1`, wenn etwas zu beheben ist, und mit `2`, wenn er seine Prüfungen nicht ausführen konnte. Auf Kubernetes enthält die Zusammenfassung keinen Befund `CRITICAL`.

## Etwas überwachen und alarmiert werden

Ihr Server kann jetzt E-Mails senden und Personen alarmieren. Der [Schnellstart](/docs/introduction/quickstart) geht im Produkt weiter: ein Monitor für Ihre Website, eine Bereitschaftsrichtlinie, die Sie alarmiert, wenn sie ausfällt, und eine Statusseite, in etwa fünfzehn Minuten. Sein letzter Teil meldet einen Testvorfall, damit Sie die Alarmierung ankommen sehen.

## Fehlerbehebung

:::details npm start hält an und sagt, HOST sei noch keine Adresse
`HOST` in `config.env` enthält noch einen Platzhalter, etwa `<your-address>`. Setzen Sie es auf Ihren Domainnamen oder Ihre IP-Adresse, ohne `http://`, und führen Sie `npm start` erneut aus.
:::

:::details Die Test-E-Mail schlägt fehl
Die Meldung unter der Schaltfläche ist die Antwort des Mailservers. Prüfen Sie den Hostnamen, den Port, den Benutzernamen und das Passwort, und ob der Mailserver Sie von der Adresse senden lässt, von der E-Mails kommen. Siehe [SMTP](/docs/emails/smtp#fehlerbehebung).
:::

:::details Der Browser warnt vor dem Zertifikat
Let's Encrypt braucht die Ports 80 und 443, aus dem Internet erreichbar, und Ihren Domainnamen, der auf diesen Server zeigt. Warten Sie einige Minuten und führen Sie dann `npm run doctor` aus: Er prüft das Zertifikat und sagt, was nicht stimmt.
:::

## Nächste Schritte

:::cards
- [Schnellstart](/docs/introduction/quickstart): Ein Monitor, eine Bereitschaftsrichtlinie und eine Statusseite in fünfzehn Minuten.
- [Docker Compose](/docs/installation/docker-compose): Ein eigener Proxy, Backups, Updates und die Checkliste für den Produktivbetrieb.
- [Aktualisierung](/docs/installation/upgrading): Auf ein neues Release wechseln, eine Hauptversion nach der anderen.
- [Architektur](/docs/self-hosted/architecture): Wie die Teile von OneUptime zusammenspielen.
:::
