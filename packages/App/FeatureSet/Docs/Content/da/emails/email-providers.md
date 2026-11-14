# E-mailudbydere

Send OneUptimes e-mail gennem en e-mailudbyders HTTPS-API i stedet for en SMTP-server: Amazon SES, SendGrid, Mailgun, Postmark eller Resend. Et projekt vælger en af dem til en SMTP-konfiguration, og en selvhostet installation kan sende al sin egen e-mail gennem en af dem. API'et nås over HTTPS på port 443, så e-mail stadig kommer ud fra netværk, der blokerer SMTP-portene, og hver udbyders nøgle gemmes krypteret.

:::cards
- [Amazon SES](#amazon-ses): En IAM-adgangsnøgle eller serverens egen IAM-rolle og den region, din afsender er verificeret i.
- [SendGrid](#sendgrid): En API-nøgle med adgang til Mail Send.
- [Mailgun](#mailgun): En API-nøgle, afsenderdomænet og dets region.
- [Postmark](#postmark): Serverens API-token.
- [Resend](#resend): En API-nøgle med adgang til at sende.
- [Fejlfinding](#fejlfinding): Hvad hver udbyders afvisning betyder.
:::

## Vælg en udbyder

:::tabs
@tab Projekt
Åbn **Yderligere indstillinger** under **Projektindstillinger > Notifikationer > Notifikationskanaler**, og klik på **Opret SMTP-konfiguration** i kortet **Brugerdefinerede SMTP-konfigurationer**. I trinnet **Udbyder** angiver du et **Navn** og vælger udbyderen. Det næste trin beder om udbyderens indstillinger, og trinnet **Afsender** om **E-mail fra** og **Fra-navn**. Når konfigurationen er gemt, tjekker **Send test-e-mail** i dens række, at den virker.
@tab Selvhostet instans
Åbn **Indstillinger** i Admin Dashboard og derefter **Notifikationer > E-mails**. Klik i kortet **E-mail-serverindstillinger** på **Rediger server**, og vælg udbyderen som **E-mailservertype**. Udbyderens kort vises nedenunder, for eksempel **Amazon SES-indstillinger**: klik på dets redigeringsknap, for eksempel **Rediger Amazon SES**, og udfyld udbyderens indstillinger og trinnet **Afsender**. Indtil kortet har alt, hvad det skal bruge, siger det, hvad der mangler, og hver e-mail afvises med den indstilling, der skal udfyldes.
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
