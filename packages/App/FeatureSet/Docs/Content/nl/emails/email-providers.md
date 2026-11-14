# E-mailproviders

Verstuur de e-mail van OneUptime via de HTTPS-API van een e-mailprovider in plaats van via een SMTP-server: Amazon SES, SendGrid, Mailgun, Postmark of Resend. Een project kiest er één voor een SMTP-configuratie, en een zelf gehoste installatie kan al haar eigen e-mail via één ervan versturen. De API wordt via HTTPS op poort 443 bereikt, zodat e-mail ook vertrekt vanuit netwerken die de SMTP-poorten blokkeren, en de sleutel van elke provider wordt versleuteld opgeslagen.

:::cards
- [Amazon SES](#amazon-ses): Een IAM-toegangssleutel, of de eigen IAM-rol van de server, en de regio waarin uw afzender is geverifieerd.
- [SendGrid](#sendgrid): Een API-sleutel met toegang tot Mail Send.
- [Mailgun](#mailgun): Een API-sleutel, het verzenddomein en de regio ervan.
- [Postmark](#postmark): Het API-token van de server.
- [Resend](#resend): Een API-sleutel met verzendtoegang.
- [Problemen oplossen](#problemen-oplossen): Wat de weigering van elke provider betekent.
:::

## Een provider kiezen

:::tabs
@tab Project
Open via **Projectinstellingen > Meldingen > Meldingskanalen** het onderdeel **Meer instellingen** en klik op **SMTP-configuratie aanmaken** in de kaart **Aangepaste SMTP-configuraties**. Vul in de stap **Provider** een **Naam** in en kies de provider. De volgende stap vraagt om de instellingen van die provider, en de stap **Afzender** om de **E-mail van** en de **Van naam**. Zodra de configuratie is opgeslagen, controleert **Test-e-mail verzenden** in haar rij of ze werkt.
@tab Zelf gehoste instantie
Open in het Admin Dashboard **Instellingen** en daarna **Meldingen > E-mails**. Klik in de kaart **E-mailserverinstellingen** op **Server bewerken** en kies de provider als **Type e-mailserver**. Daaronder verschijnt de kaart van de provider, zoals **Amazon SES-instellingen**: klik op de bewerkknop ervan, zoals **Amazon SES bewerken**, en vul de instellingen van de provider en de stap **Afzender** in. Zolang er iets ontbreekt, zegt de kaart wat er ontbreekt, en wordt elke e-mail geweigerd met de instelling die nog moet worden ingevuld.
:::

| Provider | Wat u invult | Waar OneUptime naartoe verstuurt |
| --- | --- | --- |
| Amazon SES | Toegangssleutel-ID, Geheime toegangssleutel, Regio | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | API-sleutel | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API-sleutel, Domein, Regio | `https://api.mailgun.net` of `https://api.eu.mailgun.net` |
| Postmark | Server-API-token | `https://api.postmarkapp.com/email` |
| Resend | API-sleutel | `https://api.resend.com/emails` |

Elke e-mail wordt verstuurd met zijn tekstdeel, en met zijn afbeeldingen (het logo van OneUptime, schermafbeeldingen) als inline bijlagen. Als een provider beperkt hoe snel u verstuurt, of als er aan de kant van de provider iets misgaat, probeert OneUptime het opnieuw na de wachttijd waar de provider om vraagt; elke andere weigering wordt in de meldingslogboeken bewaard, met wat de provider zei.

## Amazon SES

:::steps
### De afzender verifiëren

Verifieer in de [Amazon SES-console](https://console.aws.amazon.com/ses/), in de regio waaruit u gaat versturen, onder **Identities** het adres waarvandaan u verstuurt of het domein ervan. Zolang uw account in de SES-sandbox staat, verifieert u ook elke ontvanger, of vraagt u productietoegang aan.

### Een toegangssleutel maken

Maak een IAM-gebruiker voor OneUptime aan met een beleid dat `ses:SendEmail` op uw identiteit toestaat, en maak daarna een toegangssleutel voor die gebruiker:

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

Een zelf gehoste installatie op AWS kan de sleutel overslaan en zich in plaats daarvan [aanmelden met de IAM-rol van de server](#aanmelden-met-de-iam-rol-van-de-server), met hetzelfde beleid.

### De stap Amazon SES invullen

Vul de **Toegangssleutel-ID** en de **Geheime toegangssleutel** in, en zet de **Regio** op de regio waarin uw identiteit is geverifieerd, zoals `us-east-1`.
:::

### Aanmelden met de IAM-rol van de server

Een zelf gehoste installatie op AWS kan haar eigen e-mail verzenden als de IAM-rol die AWS de server geeft, zonder dat er een toegangssleutel in OneUptime wordt opgeslagen: de inloggegevens die AWS uitgeeft verlopen binnen enkele uren, en OneUptime haalt nieuwe op voordat dat gebeurt. Dit geldt alleen voor de eigen e-mail van de server. De Amazon SES-configuratie van een project meldt zich altijd aan met een toegangssleutel, omdat de rol van de server de eigen AWS-identiteit van de server is, niet die van een project.

Geef de rol het beleid hierboven en voer OneUptime daarna uit als die rol:

:::tabs
@tab Amazon EKS
Met IAM-rollen voor serviceaccounts maakt u de rol aan met een vertrouwensbeleid voor de OIDC-provider van uw cluster, en laat u de Helm-chart een serviceaccount maken met de ARN van de rol. De app- en worker-pods van OneUptime draaien als dat account:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

Met EKS Pod Identity maakt u in plaats daarvan een Pod Identity-koppeling tussen de rol en dat serviceaccount, en laat u de annotatie weg.
@tab Amazon ECS
Stel de rol in als de **Task role** van de taakdefinitie van OneUptime.
@tab Amazon EC2
Koppel de rol aan de instance als haar instanceprofiel. Draait OneUptime in Docker op de instance, verhoog dan de hoplimiet van de instancemetadata naar 2, zodat de containers ze kunnen bereiken:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Klik daarna in het Admin Dashboard op **Amazon SES bewerken**, kies **IAM-rol van deze server** als **Authenticatietype** en vul de **Regio** in. Bij het opslaan wordt een eerder opgeslagen toegangssleutel verwijderd.

OneUptime zoekt de inloggegevens van de server waar de AWS SDK's ze zoeken, in deze volgorde: `AWS_ACCESS_KEY_ID` en `AWS_SECRET_ACCESS_KEY` in zijn omgeving, een webidentiteitstoken (`AWS_ROLE_ARN` en `AWS_WEB_IDENTITY_TOKEN_FILE`), het endpoint voor containerinloggegevens van Amazon ECS en EKS Pod Identity, en daarna de instancemetadataservice van EC2 (IMDSv2).

## SendGrid

Open in SendGrid **Settings > API Keys**, maak een sleutel aan met toegang tot **Mail Send**, en verifieer het adres waarvandaan u verstuurt (Single Sender Verification) of het domein ervan (Domain Authentication). Vul de sleutel in als **API-sleutel** in de stap **SendGrid**.

## Mailgun

Voeg in Mailgun uw verzenddomein toe, zoals `mg.example.com`, en verifieer het. Maak daarna een verzendsleutel voor dat domein aan, of gebruik de API-sleutel van uw account. Vul in de stap **Mailgun** de **API-sleutel** en het **Domein** in, en kies de **Regio** waarin het domein is aangemaakt: `EU` voor een domein in de EU-regio van Mailgun, `US` voor de andere. De **E-mail van** moet een adres in dat domein zijn. Een sandboxdomein verstuurt alleen naar zijn geautoriseerde ontvangers.

## Postmark

Open in Postmark de server die verstuurt, daarna het tabblad **API Tokens** ervan, en kopieer het server-API-token: met een accounttoken kunt u niet versturen. Vul het in als **Server-API-token** in de stap **Postmark**. De **E-mail van** moet een bevestigde afzenderhandtekening zijn, of een adres in een geverifieerd domein. Totdat Postmark uw account goedkeurt, verstuurt het alleen naar adressen in uw eigen domein.

## Resend

Voeg in Resend onder **Domains** uw domein toe en verifieer het, en maak daarna onder **API Keys** een API-sleutel met verzendtoegang aan. Vul die in als **API-sleutel** in de stap **Resend**, met een **E-mail van** in uw geverifieerde domein. Het eigen testdomein van Resend verstuurt alleen naar uw eigen adres.

## Problemen oplossen

Een testmail die niet wordt verzonden, zegt waarom. Open voor elke andere e-mail het tabblad **E-mail** van **Projectinstellingen > Meldingen > Meldingslogboeken** en kies **Statusbericht bekijken** in de rij ervan.

:::details "Amazon SES needs a verified identity in …"
De **E-mail van**, of het domein ervan, is niet geverifieerd in de regio die in de configuratie is ingesteld, of het account staat in de SES-sandbox en de ontvanger is niet geverifieerd. Verifieer het adres in die regio, of vraag productietoegang aan.
:::

:::details "Amazon SES does not recognize the access key" of "did not accept the request's signature"
Controleer de **Toegangssleutel-ID**, of de sleutel in IAM actief is en of de **Geheime toegangssleutel** samen met die sleutel is aangemaakt. Een handtekening wordt ook geweigerd als de klok van de server niet goed staat.
:::

:::details "The access key may not send with Amazon SES"
Het beleid van de IAM-gebruiker staat `ses:SendEmail` op uw identiteit niet toe. Voeg het beleid hierboven toe.
:::

:::details "This server has no AWS credentials"
De server meldt zich aan met zijn IAM-rol, maar AWS geeft hem geen inloggegevens. Voer hem uit als de rol, zoals [Aanmelden met de IAM-rol van de server](#aanmelden-met-de-iam-rol-van-de-server) laat zien, en start daarna de pods of taken van OneUptime opnieuw: een pod krijgt de instellingen van zijn rol wanneer hij start. In Docker op Amazon EC2 zegt de melding ook wanneer de hoplimiet van de instancemetadata te laag is.
:::

:::details "This server's IAM role may not send with Amazon SES" of "did not let this server assume the role"
Het beleid van de rol staat `ses:SendEmail` op uw identiteit niet toe: voeg het beleid hierboven toe. Of, op Amazon EKS, het vertrouwensbeleid van de rol staat `sts:AssumeRoleWithWebIdentity` niet toe voor de OIDC-provider van uw cluster en het serviceaccount van OneUptime.
:::

:::details "Mailgun has no domain … in its US region"
Het domein staat niet in de regio waarnaar de configuratie verstuurt. Controleer het **Domein** en zet de **Regio** op `EU` als het domein daar is aangemaakt.
:::

:::details "is not a confirmed sender signature in Postmark" of "is not a verified domain in Resend"
Bevestig de **E-mail van** als afzender, of verifieer het domein ervan, in het dashboard van de provider.
:::

:::details "did not accept the API key" of "did not accept the server API token"
Controleer de sleutel in de configuratie: die van SendGrid heeft toegang tot Mail Send nodig, de verzendsleutel van Mailgun werkt alleen voor zijn eigen domein, Postmark heeft het token van de server nodig, en die van Resend heeft verzendtoegang nodig.
:::

## Volgende stappen

:::cards
- [SMTP](/docs/emails/smtp): In plaats daarvan versturen via uw eigen mailserver of Microsoft 365.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers): De e-mail aan de abonnees van een statuspagina versturen via een SMTP-configuratie van het project.
:::
