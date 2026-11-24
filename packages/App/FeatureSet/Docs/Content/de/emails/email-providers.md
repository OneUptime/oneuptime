# E-Mail-Anbieter

Versenden Sie die E-Mails von OneUptime über die HTTPS-API eines E-Mail-Anbieters statt über einen SMTP-Server: Amazon SES, SendGrid, Mailgun, Postmark oder Resend. Ein Projekt wählt einen davon für eine SMTP-Konfiguration, und eine selbst gehostete Installation kann alle ihre eigenen E-Mails über einen davon versenden. Die API wird über HTTPS auf Port 443 erreicht, sodass E-Mails auch aus Netzwerken hinausgehen, die die SMTP-Ports sperren, und der Schlüssel jedes Anbieters wird verschlüsselt gespeichert.

:::cards
- [Amazon SES](#amazon-ses): Ein IAM-Zugriffsschlüssel, eine IAM-Rolle in Ihrem AWS-Konto oder die eigene IAM-Rolle des Servers und die Region, in der Ihr Absender verifiziert ist.
- [SendGrid](#sendgrid): Ein API-Schlüssel mit Zugriff auf Mail Send.
- [Mailgun](#mailgun): Ein API-Schlüssel, die Versanddomain und ihre Region.
- [Postmark](#postmark): Das API-Token des Servers.
- [Resend](#resend): Ein API-Schlüssel mit Sendezugriff.
- [Umgebungsvariablen](#die-e-mail-des-servers-über-umgebungsvariablen-festlegen): Die E-Mail eines selbst gehosteten Servers aus Helm-Values oder `config.env` festlegen.
- [Fehlerbehebung](#fehlerbehebung): Was die Ablehnung jedes Anbieters bedeutet.
:::

## Einen Anbieter wählen

:::tabs
@tab Projekt
Öffnen Sie unter **Projekteinstellungen > Benachrichtigungen > Benachrichtigungskanäle** den Bereich **Weitere Einstellungen** und klicken Sie in der Karte **Benutzerdefinierte SMTP-Konfigurationen** auf **SMTP-Konfiguration erstellen**. Füllen Sie im Schritt **Anbieter** das Feld **Name** aus und wählen Sie den Anbieter. Der nächste Schritt fragt nach den Einstellungen dieses Anbieters, der Schritt **Absender** nach **Absender-E-Mail** und **Absendername**. Nach dem Speichern prüft **Test-E-Mail senden** in der Zeile der Konfiguration, ob sie funktioniert.
@tab Selbst gehostete Instanz
Öffnen Sie im Admin Dashboard **Einstellungen** und dann **Benachrichtigungen > E-Mails**. Klicken Sie in der Karte **E-Mail-Server-Einstellungen** auf **Server bearbeiten** und wählen Sie den Anbieter als **E-Mail-Servertyp**. Darunter erscheint die Karte des Anbieters, etwa **Amazon SES-Einstellungen**: Klicken Sie auf ihre Schaltfläche zum Bearbeiten, etwa **Amazon SES bearbeiten**, und füllen Sie die Einstellungen des Anbieters und den Schritt **Absender** aus. Solange noch etwas fehlt, nennt die Karte, was fehlt, und jede E-Mail wird mit der Einstellung abgelehnt, die noch auszufüllen ist. Ein Server, der aus Code bereitgestellt wird, kann sie stattdessen über Umgebungsvariablen festlegen: siehe [Die E-Mail des Servers über Umgebungsvariablen festlegen](#die-e-mail-des-servers-über-umgebungsvariablen-festlegen).
:::

| Anbieter | Benötigte Angaben | Wohin OneUptime sendet |
| --- | --- | --- |
| Amazon SES | Zugriffsschlüssel-ID, Geheimer Zugriffsschlüssel, Region | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | API-Schlüssel | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API-Schlüssel, Domäne, Region | `https://api.mailgun.net` oder `https://api.eu.mailgun.net` |
| Postmark | Server-API-Token | `https://api.postmarkapp.com/email` |
| Resend | API-Schlüssel | `https://api.resend.com/emails` |

Jede E-Mail wird mit ihrem Textteil versendet, ihre Bilder (das Logo von OneUptime, Screenshots) als Inline-Anhänge. Wenn ein Anbieter begrenzt, wie schnell Sie senden, oder auf seiner Seite ein Fehler auftritt, versucht OneUptime es nach der Wartezeit erneut, die der Anbieter verlangt; jede andere Ablehnung wird mit der Antwort des Anbieters in den Benachrichtigungsprotokollen festgehalten.

## Amazon SES

:::steps
### Den Absender verifizieren

Verifizieren Sie in der [Konsole von Amazon SES](https://console.aws.amazon.com/ses/), in der Region, aus der Sie senden werden, unter **Identities** die Adresse, von der Sie senden, oder ihre Domain. Solange Ihr Konto in der SES-Sandbox ist, verifizieren Sie auch jeden Empfänger oder beantragen Sie Produktionszugriff.

### Einen Zugriffsschlüssel erstellen

Legen Sie für OneUptime einen IAM-Benutzer mit einer Richtlinie an, die `ses:SendEmail` für Ihre Identität erlaubt, und erstellen Sie dann einen Zugriffsschlüssel für ihn:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

Eine selbst gehostete Installation auf AWS kann den Schlüssel auslassen und sich stattdessen [mit der IAM-Rolle des Servers anmelden](#mit-der-iam-rolle-des-servers-anmelden), mit derselben Richtlinie. Auch die Konfiguration eines Projekts kann ihn auslassen und sich [mit einer IAM-Rolle in Ihrem AWS-Konto anmelden](#mit-einer-iam-rolle-in-ihrem-aws-konto-anmelden).

### Den Schritt Amazon SES ausfüllen

Lassen Sie **Zugriffsschlüssel** als **Authentifizierungstyp** stehen und geben Sie **Zugriffsschlüssel-ID**, **Geheimer Zugriffsschlüssel** und die **Region** ein, in der Ihre Identität verifiziert ist, etwa `us-east-1`.
:::

### Mit der IAM-Rolle des Servers anmelden

Eine selbst gehostete Installation kann ihre eigenen E-Mails als eine IAM-Rolle senden, ohne dass in OneUptime ein Zugriffsschlüssel gespeichert ist: auf AWS als die Rolle, die AWS dem Server gibt, überall sonst als eine Rolle, bei der sie sich mit IAM Roles Anywhere anmeldet. Die Anmeldedaten laufen innerhalb von Stunden ab, und OneUptime holt neue, bevor das geschieht. Das gilt nur für die eigenen E-Mails des Servers: Die Rolle des Servers ist die eigene AWS-Identität des Servers, nicht die eines Projekts. Die Amazon SES-Konfiguration eines Projekts meldet sich mit einem Zugriffsschlüssel an oder [mit einer IAM-Rolle in Ihrem AWS-Konto](#mit-einer-iam-rolle-in-ihrem-aws-konto-anmelden).

Geben Sie der Rolle die Richtlinie von oben und führen Sie OneUptime dann als diese Rolle aus:

:::tabs
@tab Amazon EKS
Mit IAM-Rollen für Dienstkonten erstellen Sie die Rolle mit einer Vertrauensrichtlinie für den OIDC-Anbieter Ihres Clusters und lassen das Helm-Chart ein Dienstkonto mit dem ARN der Rolle erstellen. Die App- und Worker-Pods von OneUptime laufen unter diesem Konto:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

Mit EKS Pod Identity erstellen Sie stattdessen eine Pod-Identity-Zuordnung zwischen der Rolle und diesem Dienstkonto und lassen die Annotation weg.
@tab Amazon ECS
Legen Sie die Rolle als **Task role** der Aufgabendefinition von OneUptime fest.
@tab Amazon EC2
Hängen Sie die Rolle als Instanzprofil an die Instanz an. Läuft OneUptime in Docker auf der Instanz, erhöhen Sie das Hop-Limit der Instanzmetadaten auf 2, damit die Container sie erreichen:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
@tab IAM Roles Anywhere
Außerhalb von AWS, auf Ihren eigenen Servern oder in einer anderen Cloud, meldet sich der Server über IAM Roles Anywhere als Rolle an, das ein X.509-Zertifikat gegen die Anmeldedaten der Rolle eintauscht. Erstellen Sie in IAM Roles Anywhere einen Trust Anchor für Ihre Zertifizierungsstelle und ein Profil für die Rolle. Legen Sie dann das Hilfsprogramm von AWS für Anmeldedaten, `aws_signing_helper`, in einen Ordner, zusammen mit dem Zertifikat, seinem privaten Schlüssel und einer AWS-Konfigurationsdatei, deren Profil das Hilfsprogramm als seinen `credential_process` ausführt:

```ini title="aws/config"
[profile oneuptime]
credential_process = /etc/oneuptime/aws/aws_signing_helper credential-process --certificate /etc/oneuptime/aws/certificate.pem --private-key /etc/oneuptime/aws/private-key.pem --trust-anchor-arn arn:aws:rolesanywhere:us-east-1:123456789012:trust-anchor/TRUST_ANCHOR_ID --profile-arn arn:aws:rolesanywhere:us-east-1:123456789012:profile/PROFILE_ID --role-arn arn:aws:iam::123456789012:role/oneuptime-ses
```

Mit Docker Compose binden Sie den Ordner schreibgeschützt ein und nennen die Datei und das Profil in `docker-compose.override.yml` neben `docker-compose.yml`:

```yaml title="docker-compose.override.yml"
services:
  app:
    environment:
      AWS_CONFIG_FILE: /etc/oneuptime/aws/config
      AWS_PROFILE: oneuptime
    volumes:
      - ./aws:/etc/oneuptime/aws:ro
```

Mit dem Helm-Chart binden Sie die Konfiguration, das Zertifikat und seinen Schlüssel aus einem Secret mit `extraVolumes` und `extraVolumeMounts` ein, setzen `AWS_CONFIG_FILE` und `AWS_PROFILE` mit `extraEnv` und legen das Hilfsprogramm in ein Image, das auf dem von OneUptime aufbaut: Ein Secret fasst höchstens 1 MB. OneUptime führt das Hilfsprogramm ohne Shell aus, über seinen vollständigen Pfad, höchstens 30 Sekunden lang und nur aus einer Konfigurationsdatei, die es selbst nicht ändern kann: Eine Datei, in die es schreiben könnte, wird abgelehnt.
:::

Klicken Sie dann im Admin Dashboard auf **Amazon SES bearbeiten**, wählen Sie **IAM-Rolle dieses Servers** als **Authentifizierungstyp** und geben Sie die **Region** ein. Beim Speichern wird ein zuvor gespeicherter Zugriffsschlüssel entfernt.

OneUptime sucht die Anmeldedaten des Servers dort, wo die AWS SDKs sie suchen, in dieser Reihenfolge: `AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY` in seiner Umgebung, das AWS-Profil, das `AWS_PROFILE`, `AWS_CONFIG_FILE` oder `AWS_SHARED_CREDENTIALS_FILE` nennt (seine Schlüssel oder sein `credential_process`), ein Web-Identity-Token (`AWS_ROLE_ARN` und `AWS_WEB_IDENTITY_TOKEN_FILE`), der Endpunkt für Container-Anmeldedaten von Amazon ECS und EKS Pod Identity, dann der Instanzmetadatendienst von EC2 (IMDSv2). Ist keine der drei gesetzt, liest OneUptime keine AWS-Konfigurationsdatei.

### Mit einer IAM-Rolle in Ihrem AWS-Konto anmelden

Die Amazon SES-Konfiguration eines Projekts kann sich mit einer IAM-Rolle in Ihrem eigenen AWS-Konto anmelden, sodass in OneUptime kein Schlüssel gespeichert ist. OneUptime meldet sich mit seiner eigenen AWS-Identität und einer externen ID bei der Rolle an, die nur die E-Mails Ihres Projekts verwenden, und jede Sitzung dauert eine Stunde. Geben Sie der Rolle die Richtlinie oben und eine Vertrauensrichtlinie, die das AWS-Konto von OneUptime mit dieser externen ID hereinlässt:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::123456789012:root" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "oneuptime-0123456789abcdef0123456789abcdef"
        }
      }
    }
  ]
}
```

Wählen Sie im Schritt **Amazon SES** der Konfiguration **IAM-Rolle in Ihrem AWS-Konto** als **Authentifizierungstyp**. Unter dem **Rollen-ARN** zeigt **Rolle in AWS einrichten** die **Externe ID** Ihres Projekts und diese Vertrauensrichtlinie mit dem Konto von OneUptime und Ihrer ID darin, bereit zum Kopieren. Erstellen Sie die Rolle damit, geben Sie ihren **Rollen-ARN** und die **Region** ein und klicken Sie dann in der Zeile der Konfiguration auf **Test-E-Mail senden**. Beim Speichern der Rolle wird ein zuvor gespeicherter Zugriffsschlüssel entfernt.

OneUptime prüft die Rolle, bevor es über sie sendet, und meldet sich nie an bei:

- Einer Rolle, deren Vertrauensrichtlinie die externe ID Ihres Projekts nicht verlangt: Jedes Projekt, das ihren ARN kennt, könnte über Ihr Konto E-Mails senden. Fügen Sie die Bedingung `sts:ExternalId` hinzu und senden Sie eine Test-E-Mail, die die Rolle sofort erneut prüft. Die Prüfung läuft etwa einmal am Tag und erscheint im CloudTrail der Rolle als ein `AccessDenied` für `sts:AssumeRole`.
- Einer Rolle im eigenen AWS-Konto von OneUptime, was auch immer ihre Vertrauensrichtlinie sagt. Um die eigenen E-Mails des Servers über das Konto zu senden, in dem er läuft, verwenden Sie stattdessen [die IAM-Rolle des Servers](#mit-der-iam-rolle-des-servers-anmelden).

Die externe ID gehört Ihrem Projekt und ist kein Geheimnis. Die IAM-Rollen von Cloud Connect verwenden eine andere, sodass eine für das eine erstellte Rolle nie vom anderen angemeldet wird. Ein Server ohne eigene AWS-Identität, also weder mit einem Cloud Connect-Zugriffsschlüssel noch mit AWS-Anmeldedaten, kann sich bei keiner Rolle anmelden, und der Schritt sagt das.

## SendGrid

Öffnen Sie in SendGrid **Settings > API Keys**, erstellen Sie einen Schlüssel mit Zugriff auf **Mail Send** und verifizieren Sie die Adresse, von der Sie senden (Single Sender Verification), oder ihre Domain (Domain Authentication). Geben Sie den Schlüssel im Schritt **SendGrid** als **API-Schlüssel** ein.

## Mailgun

Fügen Sie in Mailgun Ihre Versanddomain hinzu, etwa `mg.example.com`, verifizieren Sie sie und erstellen Sie dann einen Sendeschlüssel für sie, oder verwenden Sie den API-Schlüssel Ihres Kontos. Geben Sie im Schritt **Mailgun** den **API-Schlüssel** und die **Domäne** ein und wählen Sie die **Region**, in der die Domain erstellt wurde: `EU` für eine Domain in der EU-Region von Mailgun, `US` für alle anderen. Die **Absender-E-Mail** muss eine Adresse dieser Domain sein. Eine Sandbox-Domain sendet nur an ihre autorisierten Empfänger.

## Postmark

Öffnen Sie in Postmark den Server, der sendet, dann seinen Tab **API Tokens**, und kopieren Sie das Server-API-Token: Mit einem Konto-Token lässt sich nicht senden. Geben Sie es im Schritt **Postmark** als **Server-API-Token** ein. Die **Absender-E-Mail** muss eine bestätigte Absendersignatur sein oder eine Adresse einer verifizierten Domain. Bis Postmark Ihr Konto freigibt, sendet es nur an Adressen Ihrer eigenen Domain.

## Resend

Fügen Sie in Resend unter **Domains** Ihre Domain hinzu, verifizieren Sie sie und erstellen Sie dann unter **API Keys** einen API-Schlüssel mit Sendezugriff. Geben Sie ihn im Schritt **Resend** als **API-Schlüssel** ein, dazu eine **Absender-E-Mail** Ihrer verifizierten Domain. Die eigene Testdomain von Resend sendet nur an Ihre eigene Adresse.

## Die E-Mail des Servers über Umgebungsvariablen festlegen

Ein selbst gehosteter Server, der aus Code bereitgestellt wird, kann gleich beim Start E-Mails versenden, ohne dass etwas von Hand einzurichten ist: Legen Sie seine E-Mail-Einstellungen über Umgebungsvariablen fest, aus Terraform oder dem, womit Sie OneUptime sonst bereitstellen. Sobald `GLOBAL_EMAIL_SERVER_TYPE` gesetzt ist, versendet der Server seine eigenen E-Mails so, wie die Variablen es beschreiben. Die im Admin Dashboard unter **Einstellungen** und dann **Benachrichtigungen > E-Mails** gespeicherten Einstellungen werden nicht verwendet, und diese Seite zeigt diese schreibgeschützt an, jedes Feld mit der Variable, die es festlegt. Lassen Sie `GLOBAL_EMAIL_SERVER_TYPE` leer, um die E-Mail stattdessen im Admin Dashboard einzurichten. Die SMTP-Konfigurationen der Projekte sind davon nicht betroffen.

| Variable | Helm-Wert | Was sie enthält |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`, `sendgrid`, `amazon-ses`, `mailgun`, `postmark` oder `resend`. Erst wenn sie gesetzt ist, liest OneUptime die anderen Variablen |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | Die Adresse, von der jede E-Mail kommt |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | Der Name, von dem jede E-Mail kommt. Für `custom-smtp` und `sendgrid` erforderlich |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp` (auch wenn leer), oder `microsoft-graph`, um mit der OAuth-App über Microsoft Graph zu senden |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | Der Mailserver, etwa `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | Sein Port, etwa `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true`, um nur über eine verschlüsselte Verbindung mit gültigem Zertifikat zu senden, oder `false` (auch wenn leer) |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password` (auch wenn leer), `oauth` oder `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | Das Postfach, als das angemeldet wird, auch für `oauth`. Lassen Sie es und das Passwort leer, um ohne Anmeldung zu senden |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password` oder ein Secret, das in `email.existingSecret.name` genannt ist | Sein Passwort |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials` (auch wenn leer) oder `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | Die Client-ID der OAuth-App |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret` oder ein Secret, das in `email.existingSecret.name` genannt ist | Ihr Client-Secret; für `jwt-bearer` ihr privater Schlüssel im PEM-Format |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | Ihre Token-URL |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | Ihr Scope |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey` oder ein Secret, das in `email.existingSecret.name` genannt ist | Der API-Schlüssel von SendGrid |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key` (auch wenn leer), oder `server-iam-role`, um sich mit der IAM-Rolle des Servers anzumelden |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | Die Zugriffsschlüssel-ID |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey` oder ein Secret, das in `email.existingSecret.name` genannt ist | Ihr geheimer Zugriffsschlüssel |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | Die Region, in der Ihr Absender verifiziert ist, etwa `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey` oder ein Secret, das in `email.existingSecret.name` genannt ist | Der API-Schlüssel von Mailgun |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | Die Versanddomain, etwa `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us` (auch wenn leer) oder `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken` oder ein Secret, das in `email.existingSecret.name` genannt ist | Das Server-API-Token von Postmark |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey` oder ein Secret, das in `email.existingSecret.name` genannt ist | Der API-Schlüssel von Resend |

Verwendet werden nur die Variablen, die der Servertyp liest: die `GLOBAL_EMAIL_SMTP_`-Variablen für `custom-smtp` und die eigenen eines Anbieters für diesen Anbieter. Das Log des Servers und das Admin Dashboard nennen jede andere, die gesetzt ist, als ungenutzt.

Mit Helm setzen Sie sie unter `email` in Ihren Values. Damit das Passwort oder der Schlüssel nicht in den Values steht, die Helm mit jedem Release speichert, legen Sie es in einem eigenen Secret ab und nennen dieses Secret in `email.existingSecret.name`. Das Chart liest es aus dem Schlüssel, der in `email.existingSecret.key` genannt ist, sonst aus dem Schlüssel, der danach benannt ist: `smtpPassword`, `smtpOAuthClientSecret`, `sendgridApiKey`, `amazonSesSecretAccessKey`, `mailgunApiKey`, `postmarkServerToken` oder `resendApiKey`.

```bash
kubectl create secret generic oneuptime-email --namespace oneuptime \
  --from-literal=smtpPassword=YOUR_SMTP_PASSWORD
```

```yaml
email:
  serverType: custom-smtp
  fromEmail: alerts@example.com
  fromName: OneUptime
  smtp:
    host: smtp.example.com
    port: 587
    requireTls: true
    username: alerts@example.com
  existingSecret:
    name: oneuptime-email
```

Das Chart lehnt andere `email`-Werte ohne `email.serverType` ab, Einstellungen ohne das Passwort oder den Schlüssel, den sie lesen, ein Passwort oder einen Schlüssel, der sowohl in den Values als auch in einem Secret angegeben ist, und ein Secret, aus dem die Einstellungen nichts lesen. Mit Terraform setzen Sie dieselben Werte an einem `helm_release`, das Passwort oder den Schlüssel als sensiblen Wert.

Mit Docker Compose setzen Sie die `GLOBAL_EMAIL_`-Einstellungen in `config.env` und führen dann `npm run start` aus, um die Container neu zu erstellen.

OneUptime liest die Variablen beim Start. Ist eine davon falsch, etwa ein Port, der keine Zahl ist, oder ein fehlendes Passwort, versendet der Server keine E-Mails, bis das behoben ist; das Log des Servers, die E-Mail-Einstellungen im Admin Dashboard und die Checkliste unter `/admin/setup` nennen die Variable. Passwörter und Schlüssel werden nie angezeigt. Um die Einstellungen zu ändern, ändern Sie die Variablen und starten OneUptime neu: Das Admin Dashboard ändert sie nicht.

## Sehen, was der Server gesendet hat

Auf einem selbst gehosteten Server endet **Einstellungen > Benachrichtigungen > E-Mails** im Admin Dashboard mit der Karte **E-Mail-Protokoll**. Sie listet jede E-Mail, die der Server über seine eigenen Einstellungen gesendet hat und die zu keinem Projekt gehört, etwa ein Zurücksetzen des Passworts, einen Anmeldelink oder eine Einladung, und jede E-Mail, die er nicht senden konnte, auch die eines Projekts: an wen sie ging, wann, was sie war und was der Mail-Dienst geantwortet hat.

- Schalten Sie **Nur fehlgeschlagene E-Mails** ein, um nur die E-Mails zu sehen, die nicht versendet wurden.
- Die versendete E-Mail eines Projekts steht in den eigenen Protokollen dieses Projekts, nicht hier. Eine E-Mail über den eigenen Mailserver eines Projekts steht nie hier.
- Das Protokoll speichert nie die Nachricht selbst, denn ein Zurücksetzen des Passworts oder ein Anmeldelink lässt jeden herein, der ihn hat. Ein Link in einem Betreff wird als `[link]` gespeichert.
- Nur Master-Admins können es lesen. Jede E-Mail wird 30 Tage lang aufbewahrt.

## Erfahren, wenn E-Mail oder die Sonden ausfallen

Wenn die E-Mail des Servers nicht mehr funktioniert, keine globale Sonde mehr meldet oder eine globale Sonde in Rückstand gerät (ihre Monitore werden seltener geprüft oder ihre Netzwerkgeräte seltener abgefragt als eingestellt), benachrichtigt OneUptime die Master-Admins, und noch einmal, sobald alles wieder stimmt. Wählen Sie in der Karte **Ausfallbenachrichtigungen** auf derselben Seite, wohin:

- **Push an die Geräte der Master-Administratoren** sendet eine Push-Benachrichtigung an jedes Gerät, auf dem ein Master-Admin in der OneUptime-App angemeldet ist. Sie ist eingeschaltet, bis Sie sie ausschalten.
- **SMS an diese Nummer** sendet eine SMS über die SMS-Einstellungen des Servers.
- Die **Admin-Benachrichtigungs-E-Mail** erfährt es bei den Sonden ebenfalls.

Eine Nachricht geht nie über den ausgefallenen Kanal, eine Nachricht über E-Mail also nie per E-Mail, und nie über einen Kanal, über den der Server gerade nicht senden kann. Gemeldet wird nur eine Änderung, für jedes höchstens einmal pro Stunde, und Projektmitglieder werden nie benachrichtigt.

## Fehlerbehebung

Eine Test-E-Mail, die nicht versendet wird, nennt den Grund. Bei jeder anderen E-Mail öffnen Sie den Tab **E-Mail** unter **Projekteinstellungen > Benachrichtigungen > Benachrichtigungsprotokolle** und wählen in ihrer Zeile **Statusmeldung anzeigen**.

:::details "Amazon SES needs a verified identity in …"
Die **Absender-E-Mail** oder ihre Domain ist in der Region, die in der Konfiguration eingestellt ist, nicht verifiziert, oder das Konto ist in der SES-Sandbox und der Empfänger ist nicht verifiziert. Verifizieren Sie sie in dieser Region oder beantragen Sie Produktionszugriff.
:::

:::details "Amazon SES does not recognize the access key" oder "did not accept the request's signature"
Prüfen Sie die **Zugriffsschlüssel-ID**, ob der Schlüssel in IAM aktiv ist und ob unter **Geheimer Zugriffsschlüssel** das Secret steht, das mit ihm erstellt wurde. Eine Signatur wird auch abgelehnt, wenn die Uhr des Servers falsch geht.
:::

:::details "The access key may not send with Amazon SES"
Die Richtlinie des IAM-Benutzers erlaubt `ses:SendEmail` für Ihre Identität nicht. Fügen Sie die Richtlinie von oben hinzu.
:::

:::details "This server has no AWS credentials"
Der Server meldet sich mit seiner IAM-Rolle an, aber AWS gibt ihm keine Anmeldedaten. Führen Sie ihn als die Rolle aus, wie [Mit der IAM-Rolle des Servers anmelden](#mit-der-iam-rolle-des-servers-anmelden) zeigt, und starten Sie dann die Pods oder Tasks von OneUptime neu: Ein Pod erhält die Einstellungen seiner Rolle beim Start. In Docker auf Amazon EC2 sagt die Meldung auch, wenn das Hop-Limit der Instanzmetadaten zu niedrig ist.
:::

:::details "This server's IAM role may not send with Amazon SES" oder "did not let this server assume the role"
Die Richtlinie der Rolle erlaubt `ses:SendEmail` für Ihre Identität nicht: Fügen Sie die Richtlinie von oben hinzu. Oder auf Amazon EKS erlaubt die Vertrauensrichtlinie der Rolle `sts:AssumeRoleWithWebIdentity` für den OIDC-Anbieter Ihres Clusters und das Dienstkonto von OneUptime nicht.
:::

:::details "This role lets OneUptime sign in without this config's external ID" oder "This role is in this OneUptime's own AWS account"
OneUptime sendet nicht über die Rolle, wie [Mit einer IAM-Rolle in Ihrem AWS-Konto anmelden](#mit-einer-iam-rolle-in-ihrem-aws-konto-anmelden) beschreibt. Fügen Sie der Vertrauensrichtlinie der Rolle die Bedingung `sts:ExternalId` hinzu, die **Rolle in AWS einrichten** der Konfiguration zeigt, oder erstellen Sie die Rolle in Ihrem eigenen AWS-Konto, und senden Sie dann eine Test-E-Mail.
:::

:::details "Mailgun has no domain … in its US region"
Die Domain liegt nicht in der Region, an die die Konfiguration sendet. Prüfen Sie die **Domäne** und setzen Sie die **Region** auf `EU`, wenn die Domain dort erstellt wurde.
:::

:::details "is not a confirmed sender signature in Postmark" oder "is not a verified domain in Resend"
Bestätigen Sie die **Absender-E-Mail** im Dashboard des Anbieters als Absender oder verifizieren Sie dort ihre Domain.
:::

:::details "did not accept the API key" oder "did not accept the server API token"
Prüfen Sie den Schlüssel in der Konfiguration: Der von SendGrid braucht Zugriff auf Mail Send, der Sendeschlüssel von Mailgun funktioniert nur für seine eigene Domain, Postmark braucht das Token des Servers, und der von Resend braucht Sendezugriff.
:::

## Nächste Schritte

:::cards
- [SMTP](/docs/emails/smtp): Stattdessen über Ihren eigenen Mailserver oder Microsoft 365 senden.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers): Die E-Mails an die Abonnenten einer Statusseite über eine SMTP-Konfiguration des Projekts senden.
:::
