# E-postleverantörer

Skicka OneUptimes e-post via en e-postleverantörs HTTPS-API i stället för via en SMTP-server: Amazon SES, SendGrid, Mailgun, Postmark eller Resend. Ett projekt väljer en av dem för en SMTP-konfiguration, och en egenvärdad installation kan skicka all sin egen e-post via en av dem. API:et nås över HTTPS på port 443, så e-posten går ut även från nätverk som blockerar SMTP-portarna, och varje leverantörs nyckel sparas krypterad.

:::cards
- [Amazon SES](#amazon-ses): En IAM-åtkomstnyckel, eller serverns egen IAM-roll, och regionen där din avsändare är verifierad.
- [SendGrid](#sendgrid): En API-nyckel med åtkomsten Mail Send.
- [Mailgun](#mailgun): En API-nyckel, den sändande domänen och dess region.
- [Postmark](#postmark): Serverns API-token.
- [Resend](#resend): En API-nyckel med behörighet att skicka.
- [Miljövariabler](#ange-serverns-e-post-med-miljövariabler): Ange e-posten för en egenvärdad server från Helm-values eller `config.env`.
- [Felsökning](#felsökning): Vad varje leverantörs avvisning betyder.
:::

## Välj en leverantör

:::tabs
@tab Projekt
Öppna **Fler inställningar** under **Projektinställningar > Aviseringar > Aviseringskanaler** och klicka på **Skapa SMTP-konfiguration** i kortet **Anpassade SMTP-konfigurationer**. I steget **Leverantör** anger du ett **Namn** och väljer leverantören. Nästa steg frågar efter den leverantörens inställningar, och steget **Avsändare** efter **E-post från** och **Från-namn**. När konfigurationen är sparad kontrollerar **Skicka test-e-post** på dess rad att den fungerar.
@tab Egenvärdad instans
Öppna **Inställningar** i Admin Dashboard och sedan **Notifieringar > E-post**. Klicka i kortet **E-post-serverinställningar** på **Redigera server** och välj leverantören som **Typ av e-postserver**. Leverantörens kort visas nedanför, till exempel **Amazon SES-inställningar**: klicka på dess redigeringsknapp, till exempel **Redigera Amazon SES**, och fyll i leverantörens inställningar och steget **Avsändare**. Så länge något saknas visar kortet vad som fattas, och varje e-postmeddelande avvisas med besked om vilken inställning som ska fyllas i. En server som distribueras från kod kan i stället ange dem med miljövariabler: se [Ange serverns e-post med miljövariabler](#ange-serverns-e-post-med-miljövariabler).
:::

| Leverantör | Vad den frågar efter | Vart OneUptime skickar |
| --- | --- | --- |
| Amazon SES | Åtkomstnyckel-ID, Hemlig åtkomstnyckel, Region | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | API-nyckel | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API-nyckel, Domän, Region | `https://api.mailgun.net` eller `https://api.eu.mailgun.net` |
| Postmark | Server-API-token | `https://api.postmarkapp.com/email` |
| Resend | API-nyckel | `https://api.resend.com/emails` |

Varje e-postmeddelande skickas med sin textdel, och med sina bilder (OneUptimes logotyp, skärmbilder) som infogade bilagor. När en leverantör begränsar hur snabbt du får skicka, eller får ett fel på sin egen sida, försöker OneUptime igen efter den väntetid som leverantören begär; alla andra avvisningar sparas i aviseringsloggarna tillsammans med leverantörens svar.

## Amazon SES

:::steps
### Verifiera avsändaren

I [Amazon SES-konsolen](https://console.aws.amazon.com/ses/) verifierar du, i den region som du ska skicka från, adressen du skickar från eller dess domän under **Identities**. Så länge ditt konto är kvar i SES-sandlådan verifierar du även varje mottagare, eller begär produktionsåtkomst.

### Skapa en åtkomstnyckel

Skapa en IAM-användare för OneUptime med en policy som tillåter `ses:SendEmail` för din identitet, och skapa sedan en åtkomstnyckel för användaren:

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

En egenvärdad installation på AWS kan hoppa över nyckeln och i stället [logga in med serverns IAM-roll](#logga-in-med-serverns-iam-roll), med samma policy.

### Fyll i steget Amazon SES

Ange **Åtkomstnyckel-ID** och **Hemlig åtkomstnyckel**, och den **Region** där din identitet är verifierad, till exempel `us-east-1`.
:::

### Logga in med serverns IAM-roll

En egenvärdad installation på AWS kan skicka sin egen e-post som den IAM-roll som AWS ger servern, utan att någon åtkomstnyckel lagras i OneUptime: autentiseringsuppgifterna som AWS delar ut går ut inom några timmar, och OneUptime hämtar nya innan de gör det. Detta gäller bara serverns egen e-post. Ett projekts Amazon SES-konfiguration loggar alltid in med en åtkomstnyckel, eftersom serverns roll är serverns egen AWS-identitet, inte ett projekts.

Ge rollen policyn ovan och kör sedan OneUptime som den:

:::tabs
@tab Amazon EKS
Med IAM-roller för tjänstkonton skapar du rollen med en förtroendepolicy för klustrets OIDC-leverantör och låter Helm-diagrammet skapa ett tjänstkonto med rollens ARN. OneUptimes app- och worker-poddar körs som det:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

Med EKS Pod Identity skapar du i stället en Pod Identity-koppling mellan rollen och det tjänstkontot och utelämnar annoteringen.
@tab Amazon ECS
Ange rollen som **Task role** i OneUptimes uppgiftsdefinition.
@tab Amazon EC2
Koppla rollen till instansen som dess instansprofil. Med OneUptime i Docker på instansen höjer du hoppgränsen för instansmetadata till 2, så att containrarna kan nå dem:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Klicka sedan på **Redigera Amazon SES** i Admin Dashboard, välj **Den här serverns IAM-roll** som **Autentiseringstyp** och ange **Region**. När du sparar tas en åtkomstnyckel som lagrats tidigare bort.

OneUptime letar efter serverns autentiseringsuppgifter där AWS SDK:erna gör det, i den här ordningen: `AWS_ACCESS_KEY_ID` och `AWS_SECRET_ACCESS_KEY` i dess miljö, en webbidentitetstoken (`AWS_ROLE_ARN` och `AWS_WEB_IDENTITY_TOKEN_FILE`), slutpunkten för containerautentiseringsuppgifter i Amazon ECS och EKS Pod Identity, och sist instansmetadatatjänsten i EC2 (IMDSv2).

## SendGrid

Öppna **Settings > API Keys** i SendGrid och skapa en nyckel med åtkomsten **Mail Send**, och verifiera adressen du skickar från (Single Sender Verification) eller dess domän (Domain Authentication). Ange nyckeln som **API-nyckel** i steget **SendGrid**.

## Mailgun

Lägg till och verifiera din sändande domän i Mailgun, till exempel `mg.example.com`, och skapa sedan en sändningsnyckel för den, eller använd ditt kontos API-nyckel. I steget **Mailgun** anger du **API-nyckel** och **Domän** och väljer den **Region** som domänen skapades i: `EU` för en domän i Mailguns EU-region, `US` för alla andra. **E-post från** måste vara en adress på den domänen. En sandlådedomän skickar bara till sina auktoriserade mottagare.

## Postmark

Öppna servern som skickar i Postmark, sedan dess flik **API Tokens**, och kopiera serverns API-token: en kontotoken kan inte skicka. Ange den som **Server-API-token** i steget **Postmark**. **E-post från** måste vara en bekräftad avsändarsignatur, eller en adress på en verifierad domän. Tills Postmark har godkänt ditt konto skickar kontot bara till adresser på din egen domän.

## Resend

Lägg till och verifiera din domän under **Domains** i Resend och skapa sedan en API-nyckel med behörighet att skicka under **API Keys**. Ange den som **API-nyckel** i steget **Resend**, med en adress på din verifierade domän i **E-post från**. Resends egen testdomän skickar bara till din egen adress.

## Ange serverns e-post med miljövariabler

En egenvärdad server som distribueras från kod kan starta och skicka e-post direkt, utan något att ställa in för hand: ange dess e-postinställningar med miljövariabler, från Terraform eller det som annars distribuerar OneUptime. Så snart `GLOBAL_EMAIL_SERVER_TYPE` är angiven skickar servern sin egen e-post så som variablerna beskriver. Inställningarna som är sparade i Admin Dashboard under **Inställningar** och sedan **Notifieringar > E-post** används inte, och den sidan visar dessa skrivskyddat, varje fält med variabeln som anger det. Lämna `GLOBAL_EMAIL_SERVER_TYPE` tom för att i stället ställa in e-post i Admin Dashboard. Projektens SMTP-konfigurationer påverkas inte.

| Variabel | Helm-värde | Vad den innehåller |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`, `sendgrid`, `amazon-ses`, `mailgun`, `postmark` eller `resend`. Först när den är angiven läser OneUptime de andra variablerna |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | Adressen som varje e-postmeddelande kommer från |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | Namnet som varje e-postmeddelande kommer från. Krävs för `custom-smtp` och `sendgrid` |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp` (även när den är tom), eller `microsoft-graph` för att skicka via Microsoft Graph med OAuth-appen |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | E-postservern, till exempel `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | Dess port, till exempel `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true` för att bara skicka över en krypterad anslutning med ett giltigt certifikat, eller `false` (även när den är tom) |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password` (även när den är tom), `oauth` eller `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | Postlådan som det loggas in som, även för `oauth`. Lämna den och lösenordet tomma för att skicka utan att logga in |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password`, eller en Secret som anges i `email.existingSecret.name` | Dess lösenord |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials` (även när den är tom) eller `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | OAuth-appens klient-ID |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret`, eller en Secret som anges i `email.existingSecret.name` | Dess klienthemlighet; för `jwt-bearer` dess privata nyckel i PEM-format |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | Dess token-URL |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | Dess scope |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey`, eller en Secret som anges i `email.existingSecret.name` | SendGrids API-nyckel |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key` (även när den är tom), eller `server-iam-role` för att logga in med serverns IAM-roll |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | Åtkomstnyckelns ID |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey`, eller en Secret som anges i `email.existingSecret.name` | Dess hemliga åtkomstnyckel |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | Regionen där din avsändare är verifierad, till exempel `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey`, eller en Secret som anges i `email.existingSecret.name` | Mailguns API-nyckel |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | Den sändande domänen, till exempel `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us` (även när den är tom) eller `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken`, eller en Secret som anges i `email.existingSecret.name` | Postmarks server-API-token |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey`, eller en Secret som anges i `email.existingSecret.name` | Resends API-nyckel |

Bara de variabler som servertypen läser används: `GLOBAL_EMAIL_SMTP_`-variablerna för `custom-smtp`, och en leverantörs egna för den leverantören. Serverns logg och Admin Dashboard nämner varje annan som är angiven, som oanvänd.

Med Helm anger du dem under `email` i dina values. För att hålla lösenordet eller nyckeln utanför de values som Helm sparar med varje release lägger du det i en egen Secret och anger den Secret i `email.existingSecret.name`. Charten läser det från nyckeln som anges i `email.existingSecret.key`, annars från nyckeln som är uppkallad efter det: `smtpPassword`, `smtpOAuthClientSecret`, `sendgridApiKey`, `amazonSesSecretAccessKey`, `mailgunApiKey`, `postmarkServerToken` eller `resendApiKey`.

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

Charten avvisar andra `email`-värden utan `email.serverType`, inställningar utan det lösenord eller den nyckel de läser, ett lösenord eller en nyckel som anges både i values och i en Secret, och en Secret som inställningarna inte läser något från. Med Terraform anger du samma värden på en `helm_release`, med lösenordet eller nyckeln som ett känsligt värde.

Med Docker Compose anger du `GLOBAL_EMAIL_`-inställningarna i `config.env` och kör sedan `npm run start` för att återskapa containrarna.

OneUptime läser variablerna när den startar. Om någon av dem är fel, till exempel en port som inte är ett tal eller ett saknat lösenord, skickar servern ingen e-post förrän det är åtgärdat; serverns logg, e-postinställningarna i Admin Dashboard och checklistan på `/admin/setup` nämner variabeln. Lösenord och nycklar visas aldrig. För att ändra inställningarna ändrar du variablerna och startar om OneUptime: Admin Dashboard ändrar dem inte.

## Felsökning

Ett test-e-postmeddelande som inte går iväg talar om varför. För all annan e-post öppnar du fliken **E-post** under **Projektinställningar > Aviseringar > Aviseringsloggar** och väljer **Visa statusmeddelande** på dess rad.

:::details "Amazon SES needs a verified identity in …"
**E-post från**, eller dess domän, är inte verifierad i den region som anges i konfigurationen, eller så är kontot i SES-sandlådan och mottagaren är inte verifierad. Verifiera den i den regionen, eller begär produktionsåtkomst.
:::

:::details "Amazon SES does not recognize the access key" eller "did not accept the request's signature"
Kontrollera **Åtkomstnyckel-ID**, att nyckeln är aktiv i IAM och att **Hemlig åtkomstnyckel** är den som skapades tillsammans med den. En signatur avvisas också när serverns klocka går fel.
:::

:::details "The access key may not send with Amazon SES"
IAM-användarens policy tillåter inte `ses:SendEmail` för din identitet. Lägg till policyn ovan.
:::

:::details "This server has no AWS credentials"
Servern loggar in med sin IAM-roll, men AWS ger den inga autentiseringsuppgifter. Kör den som rollen, som [Logga in med serverns IAM-roll](#logga-in-med-serverns-iam-roll) visar, och starta sedan om OneUptimes poddar eller uppgifter: en podd får sin rolls inställningar när den startar. I Docker på Amazon EC2 säger meddelandet också när hoppgränsen för instansmetadata är för låg.
:::

:::details "This server's IAM role may not send with Amazon SES" eller "did not let this server assume the role"
Rollens policy tillåter inte `ses:SendEmail` för din identitet: lägg till policyn ovan. Eller, på Amazon EKS, tillåter rollens förtroendepolicy inte `sts:AssumeRoleWithWebIdentity` för klustrets OIDC-leverantör och OneUptimes tjänstkonto.
:::

:::details "Mailgun has no domain … in its US region"
Domänen finns inte i den region som konfigurationen skickar till. Kontrollera **Domän**, och sätt **Region** till `EU` om domänen skapades där.
:::

:::details "is not a confirmed sender signature in Postmark" eller "is not a verified domain in Resend"
Bekräfta **E-post från** som avsändare, eller verifiera dess domän, i leverantörens kontrollpanel.
:::

:::details "did not accept the API key" eller "did not accept the server API token"
Kontrollera nyckeln i konfigurationen: SendGrids nyckel behöver åtkomsten Mail Send, Mailguns sändningsnyckel fungerar bara för sin egen domän, Postmark behöver serverns token och Resends nyckel behöver behörighet att skicka.
:::

## Nästa steg

:::cards
- [SMTP](/docs/emails/smtp): Skicka i stället via din egen e-postserver eller Microsoft 365.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers): Skicka e-post till en statussidas prenumeranter via en SMTP-konfiguration i projektet.
:::
