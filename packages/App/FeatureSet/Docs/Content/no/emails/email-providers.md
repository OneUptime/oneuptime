# E-postleverandører

Send e-posten fra OneUptime gjennom HTTPS-API-et til en e-postleverandør i stedet for en SMTP-server: Amazon SES, SendGrid, Mailgun, Postmark eller Resend. Et prosjekt velger én av dem for en SMTP-konfigurasjon, og en selvdriftet installasjon kan sende all sin egen e-post gjennom én av dem. API-et nås over HTTPS på port 443, så e-post kommer fortsatt ut fra nettverk som blokkerer SMTP-portene, og nøkkelen til hver leverandør lagres kryptert.

:::cards
- [Amazon SES](#amazon-ses): En IAM-tilgangsnøkkel, eller serverens egen IAM-rolle, og regionen avsenderen din er verifisert i.
- [SendGrid](#sendgrid): En API-nøkkel med tilgang til Mail Send.
- [Mailgun](#mailgun): En API-nøkkel, avsenderdomenet og regionen til domenet.
- [Postmark](#postmark): Serverens API-token.
- [Resend](#resend): En API-nøkkel med tilgang til å sende.
- [Miljøvariabler](#angi-serverens-e-post-med-miljøvariabler): Angi e-posten til en selvdriftet server fra Helm-values eller `config.env`.
- [Feilsøking](#feilsøking): Hva avvisningen fra hver leverandør betyr.
:::

## Velg en leverandør

:::tabs
@tab Prosjekt
Åpne **Flere innstillinger** under **Prosjektinnstillinger > Varsler > Varslingskanaler**, og klikk på **Opprett SMTP-konfigurasjon** i kortet **Egendefinerte SMTP-konfigurasjoner**. I trinnet **Leverandør** fyller du inn et **Navn** og velger leverandøren. Neste trinn ber om innstillingene for den leverandøren, og trinnet **Avsender** om **E-post fra** og **Fra-navn**. Når konfigurasjonen er lagret, sjekker **Send test-e-post** i raden at den virker.
@tab Selvdriftet instans
Åpne **Innstillinger** i Admin Dashboard, og deretter **Varsler > E-poster**. Klikk i kortet **E-post-serverinnstillinger** på **Rediger server**, og velg leverandøren som **E-posttjenertype**. Leverandørens kort vises under, for eksempel **Amazon SES-innstillinger**: klikk på redigeringsknappen, for eksempel **Rediger Amazon SES**, og fyll ut leverandørens innstillinger og trinnet **Avsender**. Inntil kortet har alt det trenger, sier det hva som mangler, og hver e-post avvises med innstillingen som må fylles ut. En server som rulles ut fra kode, kan i stedet angi dem med miljøvariabler: se [Angi serverens e-post med miljøvariabler](#angi-serverens-e-post-med-miljøvariabler).
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

En selvdriftet installasjon på AWS kan hoppe over nøkkelen og i stedet [logge inn med serverens IAM-rolle](#logg-inn-med-serverens-iam-rolle), med den samme policyen.

### Fyll ut trinnet Amazon SES

Fyll inn **Tilgangsnøkkel-ID** og **Hemmelig tilgangsnøkkel**, og sett **Region** til regionen identiteten din er verifisert i, for eksempel `us-east-1`.
:::

### Logg inn med serverens IAM-rolle

En selvdriftet installasjon på AWS kan sende sin egen e-post som IAM-rollen AWS gir serveren, uten at noen tilgangsnøkkel lagres i OneUptime: legitimasjonen AWS deler ut, utløper i løpet av timer, og OneUptime henter ny før den gjør det. Dette gjelder bare serverens egen e-post. Et prosjekts Amazon SES-konfigurasjon logger alltid inn med en tilgangsnøkkel, fordi serverens rolle er serverens egen AWS-identitet, ikke et prosjekts.

Gi rollen policyen ovenfor, og kjør deretter OneUptime som den:

:::tabs
@tab Amazon EKS
Med IAM-roller for tjenestekontoer oppretter du rollen med en tillitspolicy for klyngens OIDC-leverandør, og lar Helm-chartet opprette en tjenestekonto med rollens ARN. OneUptimes app- og worker-poder kjører som den:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

Med EKS Pod Identity oppretter du i stedet en Pod Identity-tilknytning mellom rollen og den tjenestekontoen, og utelater annotasjonen.
@tab Amazon ECS
Angi rollen som **Task role** i OneUptimes oppgavedefinisjon.
@tab Amazon EC2
Knytt rollen til instansen som instansprofilen dens. Med OneUptime i Docker på instansen øker du hop-grensen for instansmetadataene til 2, slik at containerne kan nå dem:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Klikk deretter **Rediger Amazon SES** i Admin Dashboard, velg **Denne serverens IAM-rolle** som **Autentiseringstype**, og fyll inn **Region**. Når du lagrer, fjernes en tilgangsnøkkel som var lagret fra før.

OneUptime ser etter serverens legitimasjon der AWS-SDK-ene gjør det, i denne rekkefølgen: `AWS_ACCESS_KEY_ID` og `AWS_SECRET_ACCESS_KEY` i miljøet, et webidentitetstoken (`AWS_ROLE_ARN` og `AWS_WEB_IDENTITY_TOKEN_FILE`), endepunktet for containerlegitimasjon i Amazon ECS og EKS Pod Identity, og til slutt instansmetadatatjenesten i EC2 (IMDSv2).

## SendGrid

I SendGrid åpner du **Settings > API Keys** og oppretter en nøkkel med tilgang til **Mail Send**, og du verifiserer avsenderadressen din (Single Sender Verification) eller domenet til den (Domain Authentication). Skriv inn nøkkelen som **API-nøkkel** i trinnet **SendGrid**.

## Mailgun

I Mailgun legger du til og verifiserer avsenderdomenet ditt, for eksempel `mg.example.com`, og oppretter deretter en sendenøkkel for det, eller bruker API-nøkkelen til kontoen din. I trinnet **Mailgun** fyller du inn **API-nøkkel** og **Domene**, og setter **Region** til regionen domenet ble opprettet i: `EU` for et domene i Mailguns EU-region, `US` for de andre. **E-post fra** må være en adresse på det domenet. Et sandbox-domene sender bare til mottakerne det har godkjent.

## Postmark

I Postmark åpner du serveren som sender, deretter fanen **API Tokens**, og kopierer serverens API-token: et kontotoken kan ikke sende. Skriv det inn som **Server-API-token** i trinnet **Postmark**. **E-post fra** må være en bekreftet avsendersignatur, eller en adresse på et verifisert domene. Inntil Postmark godkjenner kontoen din, sender den bare til adresser på ditt eget domene.

## Resend

I Resend legger du til og verifiserer domenet ditt under **Domains**, og oppretter deretter en API-nøkkel med tilgang til å sende under **API Keys**. Skriv den inn som **API-nøkkel** i trinnet **Resend**, med en **E-post fra** på det verifiserte domenet ditt. Resends eget testdomene sender bare til din egen adresse.

## Angi serverens e-post med miljøvariabler

En selvdriftet server som rulles ut fra kode, kan starte med å sende e-post, uten noe å sette opp for hånd: angi e-postinnstillingene med miljøvariabler, fra Terraform eller det som ellers ruller ut OneUptime. Så snart `GLOBAL_EMAIL_SERVER_TYPE` er angitt, sender serveren sin egen e-post slik variablene beskriver. Innstillingene som er lagret i Admin Dashboard under **Innstillinger** og deretter **Varsler > E-poster**, brukes ikke, og den siden viser disse skrivebeskyttet, hvert felt med variabelen som angir det. La `GLOBAL_EMAIL_SERVER_TYPE` stå tom for i stedet å sette opp e-post i Admin Dashboard. Prosjektenes SMTP-konfigurasjoner berøres ikke.

| Variabel | Helm-verdi | Hva den inneholder |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`, `sendgrid`, `amazon-ses`, `mailgun`, `postmark` eller `resend`. Først når den er angitt, leser OneUptime de andre variablene |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | Adressen hver e-post kommer fra |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | Navnet hver e-post kommer fra. Påkrevd for `custom-smtp` og `sendgrid` |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp` (også når den er tom), eller `microsoft-graph` for å sende gjennom Microsoft Graph med OAuth-appen |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | E-posttjeneren, for eksempel `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | Porten dens, for eksempel `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true` for bare å sende over en kryptert tilkobling med et gyldig sertifikat, eller `false` (også når den er tom) |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password` (også når den er tom), `oauth` eller `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | Postboksen det logges inn som, også for `oauth`. La den og passordet stå tomme for å sende uten å logge inn |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password`, eller en Secret som er navngitt i `email.existingSecret.name` | Passordet dens |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials` (også når den er tom) eller `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | Klient-ID-en til OAuth-appen |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret`, eller en Secret som er navngitt i `email.existingSecret.name` | Klienthemmeligheten dens; for `jwt-bearer` den private nøkkelen i PEM-format |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | Token-URL-en dens |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | Scopet dens |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey`, eller en Secret som er navngitt i `email.existingSecret.name` | API-nøkkelen til SendGrid |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key` (også når den er tom), eller `server-iam-role` for å logge inn med serverens IAM-rolle |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | ID-en til tilgangsnøkkelen |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey`, eller en Secret som er navngitt i `email.existingSecret.name` | Den hemmelige tilgangsnøkkelen dens |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | Regionen avsenderen din er verifisert i, for eksempel `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey`, eller en Secret som er navngitt i `email.existingSecret.name` | API-nøkkelen til Mailgun |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | Avsenderdomenet, for eksempel `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us` (også når den er tom) eller `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken`, eller en Secret som er navngitt i `email.existingSecret.name` | Server-API-tokenet til Postmark |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey`, eller en Secret som er navngitt i `email.existingSecret.name` | API-nøkkelen til Resend |

Bare variablene servertypen leser, brukes: `GLOBAL_EMAIL_SMTP_`-variablene for `custom-smtp`, og en leverandørs egne for den leverandøren. Serverens logg og Admin Dashboard nevner enhver annen som er angitt, som ubrukt.

Med Helm angir du dem under `email` i dine values. For å holde passordet eller nøkkelen utenfor de values Helm lagrer med hver release, legger du det i en Secret du selv administrerer, og angir den Secret-en i `email.existingSecret.name`. Chartet leser det fra nøkkelen som er angitt i `email.existingSecret.key`, ellers fra nøkkelen som er oppkalt etter det: `smtpPassword`, `smtpOAuthClientSecret`, `sendgridApiKey`, `amazonSesSecretAccessKey`, `mailgunApiKey`, `postmarkServerToken` eller `resendApiKey`.

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

Chartet avviser andre `email`-verdier uten `email.serverType`, innstillinger uten passordet eller nøkkelen de leser, et passord eller en nøkkel som er angitt både i values og i en Secret, og en Secret som innstillingene ikke leser noe fra. Med Terraform angir du de samme verdiene på en `helm_release`, med passordet eller nøkkelen som en sensitiv verdi.

Med Docker Compose angir du `GLOBAL_EMAIL_`-innstillingene i `config.env` og kjører deretter `npm run start` for å gjenopprette containerne.

OneUptime leser variablene når den starter. Hvis én av dem er feil, for eksempel en port som ikke er et tall, eller et manglende passord, sender serveren ingen e-post før det er rettet; serverens logg, e-postinnstillingene i Admin Dashboard og sjekklisten på `/admin/setup` nevner variabelen. Passord og nøkler vises aldri. For å endre innstillingene endrer du variablene og starter OneUptime på nytt: Admin Dashboard endrer dem ikke.

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

:::details "This server has no AWS credentials"
Serveren logger inn med IAM-rollen sin, men AWS gir den ingen legitimasjon. Kjør den som rollen, slik [Logg inn med serverens IAM-rolle](#logg-inn-med-serverens-iam-rolle) viser, og start deretter OneUptimes poder eller oppgaver på nytt: en pod får rollens innstillinger når den starter. I Docker på Amazon EC2 sier meldingen også når hop-grensen for instansmetadataene er for lav.
:::

:::details "This server's IAM role may not send with Amazon SES" eller "did not let this server assume the role"
Rollens policy tillater ikke `ses:SendEmail` på identiteten din: legg til policyen ovenfor. Eller, på Amazon EKS, tillater ikke rollens tillitspolicy `sts:AssumeRoleWithWebIdentity` for klyngens OIDC-leverandør og OneUptimes tjenestekonto.
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
