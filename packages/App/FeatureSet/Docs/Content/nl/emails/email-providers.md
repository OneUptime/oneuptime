# E-mailproviders

Verstuur de e-mail van OneUptime via de HTTPS-API van een e-mailprovider in plaats van via een SMTP-server: Amazon SES, SendGrid, Mailgun, Postmark of Resend. Een project kiest er één voor een SMTP-configuratie, en een zelf gehoste installatie kan al haar eigen e-mail via één ervan versturen. De API wordt via HTTPS op poort 443 bereikt, zodat e-mail ook vertrekt vanuit netwerken die de SMTP-poorten blokkeren, en de sleutel van elke provider wordt versleuteld opgeslagen.

:::cards
- [Amazon SES](#amazon-ses): Een IAM-toegangssleutel en de regio waarin uw afzender is geverifieerd.
- [SendGrid](#sendgrid): Een API-sleutel met toegang tot Mail Send.
- [Mailgun](#mailgun): Een API-sleutel, het verzenddomein en de regio ervan.
- [Postmark](#postmark): Het API-token van de server.
- [Resend](#resend): Een API-sleutel met verzendtoegang.
- [Problemen oplossen](#problemen-oplossen): Wat de weigering van elke provider betekent.
:::

## Een provider kiezen

:::tabs
@tab Project
Open via **Projectinstellingen > Meldingen > Meldingsinstellingen** het onderdeel **Meer instellingen** en klik op **SMTP-configuratie aanmaken** in de kaart **Aangepaste SMTP-configuraties**. Vul in de stap **Provider** een **Naam** in en kies de provider. De volgende stap vraagt om de instellingen van die provider, en de stap **Afzender** om de **E-mail van** en de **Van naam**. Zodra de configuratie is opgeslagen, controleert **Test-e-mail verzenden** in haar rij of ze werkt.
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

### De stap Amazon SES invullen

Vul de **Toegangssleutel-ID** en de **Geheime toegangssleutel** in, en zet de **Regio** op de regio waarin uw identiteit is geverifieerd, zoals `us-east-1`.
:::

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
