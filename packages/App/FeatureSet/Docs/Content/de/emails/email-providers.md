# E-Mail-Anbieter

Versenden Sie die E-Mails von OneUptime über die HTTPS-API eines E-Mail-Anbieters statt über einen SMTP-Server: Amazon SES, SendGrid, Mailgun, Postmark oder Resend. Ein Projekt wählt einen davon für eine SMTP-Konfiguration, und eine selbst gehostete Installation kann alle ihre eigenen E-Mails über einen davon versenden. Die API wird über HTTPS auf Port 443 erreicht, sodass E-Mails auch aus Netzwerken hinausgehen, die die SMTP-Ports sperren, und der Schlüssel jedes Anbieters wird verschlüsselt gespeichert.

:::cards
- [Amazon SES](#amazon-ses): Ein IAM-Zugriffsschlüssel oder die eigene IAM-Rolle des Servers und die Region, in der Ihr Absender verifiziert ist.
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

Eine selbst gehostete Installation auf AWS kann den Schlüssel auslassen und sich stattdessen [mit der IAM-Rolle des Servers anmelden](#mit-der-iam-rolle-des-servers-anmelden), mit derselben Richtlinie.

### Den Schritt Amazon SES ausfüllen

Geben Sie **Zugriffsschlüssel-ID** und **Geheimer Zugriffsschlüssel** ein, dazu die **Region**, in der Ihre Identität verifiziert ist, etwa `us-east-1`.
:::

### Mit der IAM-Rolle des Servers anmelden

Eine selbst gehostete Installation auf AWS kann ihre eigenen E-Mails als die IAM-Rolle senden, die AWS dem Server gibt, ohne dass in OneUptime ein Zugriffsschlüssel gespeichert ist: Die Anmeldedaten, die AWS ausgibt, laufen innerhalb von Stunden ab, und OneUptime holt neue, bevor das geschieht. Das gilt nur für die eigenen E-Mails des Servers. Die Amazon SES-Konfiguration eines Projekts meldet sich immer mit einem Zugriffsschlüssel an, denn die Rolle des Servers ist die eigene AWS-Identität des Servers, nicht die eines Projekts.

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
:::

Klicken Sie dann im Admin Dashboard auf **Amazon SES bearbeiten**, wählen Sie **IAM-Rolle dieses Servers** als **Authentifizierungstyp** und geben Sie die **Region** ein. Beim Speichern wird ein zuvor gespeicherter Zugriffsschlüssel entfernt.

OneUptime sucht die Anmeldedaten des Servers dort, wo die AWS SDKs sie suchen, in dieser Reihenfolge: `AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY` in seiner Umgebung, ein Web-Identity-Token (`AWS_ROLE_ARN` und `AWS_WEB_IDENTITY_TOKEN_FILE`), der Endpunkt für Container-Anmeldedaten von Amazon ECS und EKS Pod Identity, dann der Instanzmetadatendienst von EC2 (IMDSv2).

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
