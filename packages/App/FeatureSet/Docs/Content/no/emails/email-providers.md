# E-postleverandører

Send e-posten fra OneUptime gjennom HTTPS-API-et til en e-postleverandør i stedet for en SMTP-server: Amazon SES, SendGrid, Mailgun, Postmark eller Resend. Et prosjekt velger én av dem for en SMTP-konfigurasjon, og en selvdriftet installasjon kan sende all sin egen e-post gjennom én av dem. API-et nås over HTTPS på port 443, så e-post kommer fortsatt ut fra nettverk som blokkerer SMTP-portene, og nøkkelen til hver leverandør lagres kryptert.

:::cards
- [Amazon SES](#amazon-ses): En IAM-tilgangsnøkkel og regionen avsenderen din er verifisert i.
- [SendGrid](#sendgrid): En API-nøkkel med tilgang til Mail Send.
- [Mailgun](#mailgun): En API-nøkkel, avsenderdomenet og regionen til domenet.
- [Postmark](#postmark): Serverens API-token.
- [Resend](#resend): En API-nøkkel med tilgang til å sende.
- [Feilsøking](#feilsøking): Hva avvisningen fra hver leverandør betyr.
:::

## Velg en leverandør

:::tabs
@tab Prosjekt
Åpne **Flere innstillinger** under **Prosjektinnstillinger > Varsler > Varselinnstillinger**, og klikk på **Opprett SMTP Konfigurasjon** i kortet **Egendefinerte SMTP-konfigurasjoner**. I trinnet **Leverandør** fyller du inn et **Navn** og velger leverandøren. Neste trinn ber om innstillingene for den leverandøren, og trinnet **Avsender** om **E-post fra** og **Fra-navn**. Når konfigurasjonen er lagret, sjekker **Send test-e-post** i raden at den virker.
@tab Selvdriftet instans
Åpne **Innstillinger** i Admin Dashboard, og deretter **Varsler > E-poster**. Klikk i kortet **E-post-serverinnstillinger** på **Rediger server**, og velg leverandøren som **E-posttjenertype**. Leverandørens kort vises under, for eksempel **Amazon SES-innstillinger**: klikk på redigeringsknappen, for eksempel **Rediger Amazon SES**, og fyll ut leverandørens innstillinger og trinnet **Avsender**. Inntil kortet har alt det trenger, sier det hva som mangler, og hver e-post avvises med innstillingen som må fylles ut.
:::

| Leverandør | Hva du skriver inn | Hvor OneUptime sender til |
| --- | --- | --- |
| Amazon SES | Tilgangsnøkkel-ID, Hemmelig tilgangsnøkkel, Region | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | API-nøkkel | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API-nøkkel, Domene, Region | `https://api.mailgun.net` eller `https://api.eu.mailgun.net` |
| Postmark | Server-API-token | `https://api.postmarkapp.com/email` |
| Resend | API-nøkkel | `https://api.resend.com/emails` |

Hver e-post sendes med en tekstdel, og med bildene sine (OneUptimes logo, skjermbilder) som innebygde vedlegg. Når en leverandør begrenser hvor raskt du sender, eller feiler på sin side, prøver OneUptime igjen etter ventetiden leverandøren ber om; alle andre avvisninger lagres i varselloggene, sammen med det leverandøren svarte.

## Amazon SES

:::steps
### Verifiser avsenderen

I [Amazon SES-konsollen](https://console.aws.amazon.com/ses/) velger du regionen du skal sende fra, og verifiserer avsenderadressen din eller domenet til den under **Identities**. Så lenge kontoen din er i SES-sandboxen, må du også verifisere hver mottaker, eller be om produksjonstilgang.

### Opprett en tilgangsnøkkel

Opprett en IAM-bruker for OneUptime med en policy som tillater `ses:SendEmail` på identiteten din, og opprett deretter en tilgangsnøkkel for brukeren:

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

### Fyll ut trinnet Amazon SES

Fyll inn **Tilgangsnøkkel-ID** og **Hemmelig tilgangsnøkkel**, og sett **Region** til regionen identiteten din er verifisert i, for eksempel `us-east-1`.
:::

## SendGrid

I SendGrid åpner du **Settings > API Keys** og oppretter en nøkkel med tilgang til **Mail Send**, og du verifiserer avsenderadressen din (Single Sender Verification) eller domenet til den (Domain Authentication). Skriv inn nøkkelen som **API-nøkkel** i trinnet **SendGrid**.

## Mailgun

I Mailgun legger du til og verifiserer avsenderdomenet ditt, for eksempel `mg.example.com`, og oppretter deretter en sendenøkkel for det, eller bruker API-nøkkelen til kontoen din. I trinnet **Mailgun** fyller du inn **API-nøkkel** og **Domene**, og setter **Region** til regionen domenet ble opprettet i: `EU` for et domene i Mailguns EU-region, `US` for de andre. **E-post fra** må være en adresse på det domenet. Et sandbox-domene sender bare til mottakerne det har godkjent.

## Postmark

I Postmark åpner du serveren som sender, deretter fanen **API Tokens**, og kopierer serverens API-token: et kontotoken kan ikke sende. Skriv det inn som **Server-API-token** i trinnet **Postmark**. **E-post fra** må være en bekreftet avsendersignatur, eller en adresse på et verifisert domene. Inntil Postmark godkjenner kontoen din, sender den bare til adresser på ditt eget domene.

## Resend

I Resend legger du til og verifiserer domenet ditt under **Domains**, og oppretter deretter en API-nøkkel med tilgang til å sende under **API Keys**. Skriv den inn som **API-nøkkel** i trinnet **Resend**, med en **E-post fra** på det verifiserte domenet ditt. Resends eget testdomene sender bare til din egen adresse.

## Feilsøking

En test-e-post som ikke blir sendt, sier hvorfor. For all annen e-post åpner du fanen **E-post** under **Prosjektinnstillinger > Varsler > Varsellogger** og velger **Vis statusmelding** i raden.

:::details "Amazon SES needs a verified identity in …"
**E-post fra**, eller domenet til adressen, er ikke verifisert i regionen som er satt i konfigurasjonen, eller kontoen er i SES-sandboxen og mottakeren er ikke verifisert. Verifiser den i den regionen, eller be om produksjonstilgang.
:::

:::details "Amazon SES does not recognize the access key" eller "did not accept the request's signature"
Kontroller **Tilgangsnøkkel-ID**, at nøkkelen er aktiv i IAM, og at **Hemmelig tilgangsnøkkel** er den som ble opprettet sammen med den. En signatur avvises også når klokken på serveren går feil.
:::

:::details "The access key may not send with Amazon SES"
Policyen til IAM-brukeren tillater ikke `ses:SendEmail` på identiteten din. Legg til policyen ovenfor.
:::

:::details "Mailgun has no domain … in its US region"
Domenet er ikke i regionen konfigurasjonen sender til. Kontroller **Domene**, og sett **Region** til `EU` hvis domenet ble opprettet der.
:::

:::details "is not a confirmed sender signature in Postmark" eller "is not a verified domain in Resend"
Bekreft **E-post fra** som avsender, eller verifiser domenet, i leverandørens dashbord.
:::

:::details "did not accept the API key" eller "did not accept the server API token"
Kontroller nøkkelen i konfigurasjonen: SendGrids må ha tilgang til Mail Send, Mailguns sendenøkkel virker bare for sitt eget domene, Postmark trenger serverens token, og Resends må ha tilgang til å sende.
:::

## Neste steg

:::cards
- [SMTP](/docs/emails/smtp): Send i stedet gjennom din egen e-postserver eller Microsoft 365.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers): Send e-posten til abonnentene på en statusside via en SMTP-konfigurasjon i prosjektet.
:::
