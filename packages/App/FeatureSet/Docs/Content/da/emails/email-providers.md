# E-mailudbydere

Send OneUptimes e-mail gennem en e-mailudbyders HTTPS-API i stedet for en SMTP-server: Amazon SES, SendGrid, Mailgun, Postmark eller Resend. Et projekt vælger en af dem til en SMTP-konfiguration, og en selvhostet installation kan sende al sin egen e-mail gennem en af dem. API'et nås over HTTPS på port 443, så e-mail stadig kommer ud fra netværk, der blokerer SMTP-portene, og hver udbyders nøgle gemmes krypteret.

:::cards
- [Amazon SES](#amazon-ses): En IAM-adgangsnøgle eller serverens egen IAM-rolle og den region, din afsender er verificeret i.
- [SendGrid](#sendgrid): En API-nøgle med adgang til Mail Send.
- [Mailgun](#mailgun): En API-nøgle, afsenderdomænet og dets region.
- [Postmark](#postmark): Serverens API-token.
- [Resend](#resend): En API-nøgle med adgang til at sende.
- [Miljøvariabler](#angiv-serverens-e-mail-med-miljøvariabler): Angiv en selvhostet servers e-mail fra Helm-values eller `config.env`.
- [Fejlfinding](#fejlfinding): Hvad hver udbyders afvisning betyder.
:::

## Vælg en udbyder

:::tabs
@tab Projekt
Åbn **Yderligere indstillinger** under **Projektindstillinger > Notifikationer > Notifikationskanaler**, og klik på **Opret SMTP-konfiguration** i kortet **Brugerdefinerede SMTP-konfigurationer**. I trinnet **Udbyder** angiver du et **Navn** og vælger udbyderen. Det næste trin beder om udbyderens indstillinger, og trinnet **Afsender** om **E-mail fra** og **Fra-navn**. Når konfigurationen er gemt, tjekker **Send test-e-mail** i dens række, at den virker.
@tab Selvhostet instans
Åbn **Indstillinger** i Admin Dashboard og derefter **Notifikationer > E-mails**. Klik i kortet **E-mail-serverindstillinger** på **Rediger server**, og vælg udbyderen som **E-mailservertype**. Udbyderens kort vises nedenunder, for eksempel **Amazon SES-indstillinger**: klik på dets redigeringsknap, for eksempel **Rediger Amazon SES**, og udfyld udbyderens indstillinger og trinnet **Afsender**. Indtil kortet har alt, hvad det skal bruge, siger det, hvad der mangler, og hver e-mail afvises med den indstilling, der skal udfyldes. En server, der udrulles fra kode, kan i stedet angive dem med miljøvariabler: se [Angiv serverens e-mail med miljøvariabler](#angiv-serverens-e-mail-med-miljøvariabler).
:::

| Udbyder | Hvad du skal angive | Hvor OneUptime sender til |
| --- | --- | --- |
| Amazon SES | Adgangsnøgle-id, Hemmelig adgangsnøgle, Region | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | API-nøgle | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API-nøgle, Domæne, Region | `https://api.mailgun.net` eller `https://api.eu.mailgun.net` |
| Postmark | Server-API-token | `https://api.postmarkapp.com/email` |
| Resend | API-nøgle | `https://api.resend.com/emails` |

Hver e-mail sendes med sin tekstdel og med sine billeder (OneUptimes logo, skærmbilleder) som indlejrede vedhæftninger. Når en udbyder begrænser, hvor hurtigt du sender, eller fejler i sin egen ende, prøver OneUptime igen efter den ventetid, udbyderen beder om; enhver anden afvisning gemmes i notifikationslogs sammen med det, udbyderen svarede.

## Amazon SES

:::steps
### Verificér afsenderen

I [Amazon SES-konsollen](https://console.aws.amazon.com/ses/) vælger du den region, du vil sende fra, og verificerer under **Identities** din afsenderadresse eller dens domæne. Så længe din konto er i SES-sandboxen, skal du også verificere hver modtager eller anmode om produktionsadgang.

### Opret en adgangsnøgle

Opret en IAM-bruger til OneUptime med en politik, der tillader `ses:SendEmail` på din identitet, og opret derefter en adgangsnøgle til brugeren:

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

En selvhostet installation på AWS kan springe nøglen over og i stedet [logge ind med serverens IAM-rolle](#log-ind-med-serverens-iam-rolle) med den samme politik.

### Udfyld trinnet Amazon SES

Angiv **Adgangsnøgle-id** og **Hemmelig adgangsnøgle**, og sæt **Region** til den region, din identitet er verificeret i, for eksempel `us-east-1`.
:::

### Log ind med serverens IAM-rolle

En selvhostet installation på AWS kan sende sine egne e-mails som den IAM-rolle, AWS giver serveren, uden at der gemmes en adgangsnøgle i OneUptime: de legitimationsoplysninger, AWS udleverer, udløber inden for timer, og OneUptime henter nye, før de gør. Det gælder kun serverens egne e-mails. Et projekts Amazon SES-konfiguration logger altid ind med en adgangsnøgle, fordi serverens rolle er serverens egen AWS-identitet, ikke et projekts.

Giv rollen politikken ovenfor, og kør derefter OneUptime som den:

:::tabs
@tab Amazon EKS
Med IAM-roller til servicekonti opretter du rollen med en tillidspolitik for din klynges OIDC-udbyder og lader Helm-chartet oprette en servicekonto med rollens ARN. OneUptimes app- og worker-pods kører som den:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

Med EKS Pod Identity opretter du i stedet en Pod Identity-tilknytning mellem rollen og den servicekonto og udelader annotationen.
@tab Amazon ECS
Angiv rollen som **Task role** i OneUptimes opgavedefinition.
@tab Amazon EC2
Tilknyt rollen til instansen som dens instansprofil. Kører OneUptime i Docker på instansen, så hæv instansmetadataenes hop-grænse til 2, så containerne kan nå dem:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Klik derefter i Admin Dashboard på **Rediger Amazon SES**, vælg **Denne servers IAM-rolle** som **Godkendelsestype**, og angiv **Region**. Når du gemmer, fjernes en adgangsnøgle, der var gemt før.

OneUptime leder efter serverens legitimationsoplysninger samme steder som AWS' SDK'er, i denne rækkefølge: `AWS_ACCESS_KEY_ID` og `AWS_SECRET_ACCESS_KEY` i dens miljø, et web identity-token (`AWS_ROLE_ARN` og `AWS_WEB_IDENTITY_TOKEN_FILE`), container-legitimationsendpointet for Amazon ECS og EKS Pod Identity og til sidst EC2's instansmetadatatjeneste (IMDSv2).

## SendGrid

I SendGrid åbner du **Settings > API Keys** og opretter en nøgle med adgang til **Mail Send**, og du verificerer din afsenderadresse (Single Sender Verification) eller dens domæne (Domain Authentication). Angiv nøglen som **API-nøgle** i trinnet **SendGrid**.

## Mailgun

I Mailgun tilføjer og verificerer du dit afsenderdomæne, for eksempel `mg.example.com`, og opretter derefter en afsendelsesnøgle til det eller bruger din kontos API-nøgle. I trinnet **Mailgun** angiver du **API-nøgle** og **Domæne** og vælger den **Region**, domænet blev oprettet i: `EU` for et domæne i Mailguns EU-region, `US` for de øvrige. **E-mail fra** skal være en adresse på det domæne. Et sandbox-domæne sender kun til sine godkendte modtagere.

## Postmark

I Postmark åbner du den server, der sender, derefter dens fane **API Tokens**, og kopierer serverens API-token: et kontotoken kan ikke sende. Angiv det som **Server-API-token** i trinnet **Postmark**. **E-mail fra** skal være en bekræftet afsendersignatur eller en adresse på et verificeret domæne. Indtil Postmark godkender din konto, sender den kun til adresser på dit eget domæne.

## Resend

I Resend tilføjer og verificerer du dit domæne under **Domains** og opretter derefter en API-nøgle med adgang til at sende under **API Keys**. Angiv den som **API-nøgle** i trinnet **Resend** sammen med en **E-mail fra** på dit verificerede domæne. Resends eget testdomæne sender kun til din egen adresse.

## Angiv serverens e-mail med miljøvariabler

En selvhostet server, der udrulles fra kode, kan starte med at sende e-mails, uden noget at sætte op i hånden: angiv dens e-mailindstillinger med miljøvariabler, fra Terraform eller det, der ellers udruller OneUptime. Når `GLOBAL_EMAIL_SERVER_TYPE` er angivet, sender serveren sine egne e-mails, som variablerne beskriver. Indstillingerne, der er gemt i Admin Dashboard under **Indstillinger** og derefter **Notifikationer > E-mails**, bruges ikke, og den side viser disse skrivebeskyttet, hvert felt med den variabel, der angiver det. Lad `GLOBAL_EMAIL_SERVER_TYPE` være tom for i stedet at sætte e-mail op i Admin Dashboard. Projekternes SMTP-konfigurationer berøres ikke.

| Variabel | Helm-værdi | Hvad den indeholder |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`, `sendgrid`, `amazon-ses`, `mailgun`, `postmark` eller `resend`. Først når den er angivet, læser OneUptime de andre variabler |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | Adressen, som hver e-mail kommer fra |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | Navnet, som hver e-mail kommer fra. Påkrævet for `custom-smtp` og `sendgrid` |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp` (også når den er tom), eller `microsoft-graph` for at sende gennem Microsoft Graph med OAuth-appen |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | Mailserveren, for eksempel `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | Dens port, for eksempel `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true` for kun at sende over en krypteret forbindelse med et gyldigt certifikat, eller `false` (også når den er tom) |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password` (også når den er tom), `oauth` eller `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | Postkassen, der logges ind som, også for `oauth`. Lad den og adgangskoden være tomme for at sende uden at logge ind |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password` eller en Secret, der er navngivet i `email.existingSecret.name` | Dens adgangskode |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials` (også når den er tom) eller `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | OAuth-appens klient-id |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret` eller en Secret, der er navngivet i `email.existingSecret.name` | Dens klienthemmelighed; for `jwt-bearer` dens private nøgle i PEM-format |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | Dens token-URL |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | Dens scope |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey` eller en Secret, der er navngivet i `email.existingSecret.name` | SendGrids API-nøgle |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key` (også når den er tom), eller `server-iam-role` for at logge ind med serverens IAM-rolle |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | Adgangsnøglens id |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey` eller en Secret, der er navngivet i `email.existingSecret.name` | Dens hemmelige adgangsnøgle |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | Regionen, som din afsender er verificeret i, for eksempel `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey` eller en Secret, der er navngivet i `email.existingSecret.name` | Mailguns API-nøgle |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | Afsenderdomænet, for eksempel `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us` (også når den er tom) eller `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken` eller en Secret, der er navngivet i `email.existingSecret.name` | Postmarks server-API-token |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey` eller en Secret, der er navngivet i `email.existingSecret.name` | Resends API-nøgle |

Kun de variabler, servertypen læser, bruges: `GLOBAL_EMAIL_SMTP_`-variablerne for `custom-smtp` og en udbyders egne for den udbyder. Serverens log og Admin Dashboard nævner enhver anden, der er angivet, som ubrugt.

Med Helm angiver du dem under `email` i dine values. For at holde adgangskoden eller nøglen ude af de values, Helm gemmer med hver release, lægger du den i en Secret, du selv administrerer, og angiver den Secret i `email.existingSecret.name`. Chartet læser den fra den nøgle, der er angivet i `email.existingSecret.key`, ellers fra den nøgle, der er opkaldt efter den: `smtpPassword`, `smtpOAuthClientSecret`, `sendgridApiKey`, `amazonSesSecretAccessKey`, `mailgunApiKey`, `postmarkServerToken` eller `resendApiKey`.

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

Chartet afviser andre `email`-værdier uden `email.serverType`, indstillinger uden den adgangskode eller nøgle, de læser, en adgangskode eller nøgle, der er angivet både i values og i en Secret, og en Secret, som indstillingerne ikke læser noget fra. Med Terraform angiver du de samme værdier på en `helm_release`, med adgangskoden eller nøglen som en følsom værdi.

Med Docker Compose angiver du `GLOBAL_EMAIL_`-indstillingerne i `config.env` og kører derefter `npm run start` for at genskabe containerne.

OneUptime læser variablerne, når den starter. Hvis en af dem er forkert, for eksempel en port, der ikke er et tal, eller en manglende adgangskode, sender serveren ingen e-mails, før det er rettet; serverens log, e-mailindstillingerne i Admin Dashboard og tjeklisten på `/admin/setup` nævner variablen. Adgangskoder og nøgler vises aldrig. For at ændre indstillingerne ændrer du variablerne og genstarter OneUptime: Admin Dashboard ændrer dem ikke.

## Fejlfinding

En test-e-mail, der ikke bliver sendt, siger hvorfor. For enhver anden e-mail åbner du fanen **E-mail** under **Projektindstillinger > Notifikationer > Notifikationslogs** og vælger **Vis statusbesked** i dens række.

:::details "Amazon SES needs a verified identity in …"
**E-mail fra** eller dens domæne er ikke verificeret i den region, der er angivet i konfigurationen, eller kontoen er i SES-sandboxen, og modtageren er ikke verificeret. Verificér den i den region, eller anmod om produktionsadgang.
:::

:::details "Amazon SES does not recognize the access key" eller "did not accept the request's signature"
Kontrollér **Adgangsnøgle-id**, at nøglen er aktiv i IAM, og at **Hemmelig adgangsnøgle** er den, der blev oprettet sammen med den. En signatur afvises også, når serverens ur går forkert.
:::

:::details "The access key may not send with Amazon SES"
IAM-brugerens politik tillader ikke `ses:SendEmail` på din identitet. Tilføj politikken ovenfor.
:::

:::details "This server has no AWS credentials"
Serveren logger ind med sin IAM-rolle, men AWS giver den ingen legitimationsoplysninger. Kør den som rollen, som [Log ind med serverens IAM-rolle](#log-ind-med-serverens-iam-rolle) viser, og genstart derefter OneUptimes pods eller opgaver: en pod får sin rolles indstillinger, når den starter. I Docker på Amazon EC2 siger meddelelsen også, når instansmetadataenes hop-grænse er for lav.
:::

:::details "This server's IAM role may not send with Amazon SES" eller "did not let this server assume the role"
Rollens politik tillader ikke `ses:SendEmail` på din identitet: tilføj politikken ovenfor. Eller, på Amazon EKS, tillader rollens tillidspolitik ikke `sts:AssumeRoleWithWebIdentity` for din klynges OIDC-udbyder og OneUptimes servicekonto.
:::

:::details "Mailgun has no domain … in its US region"
Domænet er ikke i den region, konfigurationen sender til. Kontrollér **Domæne**, og sæt **Region** til `EU`, hvis domænet blev oprettet der.
:::

:::details "is not a confirmed sender signature in Postmark" eller "is not a verified domain in Resend"
Bekræft **E-mail fra** som afsender, eller verificér dens domæne, i udbyderens dashboard.
:::

:::details "did not accept the API key" eller "did not accept the server API token"
Kontrollér nøglen i konfigurationen: SendGrids skal have adgang til Mail Send, Mailguns afsendelsesnøgle virker kun til sit eget domæne, Postmark skal have serverens token, og Resends skal have adgang til at sende.
:::

## Næste trin

:::cards
- [SMTP](/docs/emails/smtp): Send i stedet gennem din egen mailserver eller Microsoft 365.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers): Send e-mail til en statussides abonnenter via en SMTP-konfiguration i projektet.
:::
