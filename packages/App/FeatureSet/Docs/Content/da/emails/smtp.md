# SMTP

Send OneUptimes e-mail gennem din egen mailserver. Et projekt tilføjer SMTP-konfigurationer, som projektets statussider sender deres e-mail med, og en selvhostet installation angiver den server, som OneUptime sender alt andet fra. Begge understøtter tre måder at logge ind på:

- **Brugernavn og adgangskode**: klassisk SMTP-godkendelse.
- **OAuth 2.0**: til Microsoft 365 og Google Workspace, hvor grundlæggende godkendelse ofte er slået fra.
- **Ingen**: til relay-servere, der ikke kræver godkendelse.

```mermaid title="Hvilken mailserver sender hvad"
flowchart TB
    SP["E-mail fra en statusside"] --> Q{"Brugerdefineret SMTP-konfiguration<br/>valgt til siden?"}
    Q -->|"Ja"| P["Projektets<br/>SMTP-konfiguration"]
    Q -->|"Nej"| D["OneUptimes egen<br/>mailserver"]
    E["Al anden e-mail<br/>fra OneUptime"] --> D
```

I en selvhostet installation er OneUptimes egen mailserver den, der er angivet i Admin Dashboard. En statusside vælger sin SMTP-konfiguration på sin side **Abonnementsindstillinger**, i kortet **Brugerdefineret SMTP**.

:::cards
- [Tilføj en mailserver](#tilføj-en-smtp-server): To trin, alt andet foldet væk.
- [Microsoft 365](#konfiguration-af-microsoft-365): OAuth med en appregistrering i Entra.
- [Google Workspace](#konfiguration-af-google-workspace): OAuth med en tjenestekonto.
- [Fejlfinding](#fejlfinding): Almindelige fejl, og hvad de betyder.
:::

## Tilføj en SMTP-server

Tilføj et projekts mailserver under **Projektindstillinger > Notifikationer > Notifikationsindstillinger**, i kortet **Brugerdefinerede SMTP-konfigurationer**. I en selvhostet installation angives den server, som OneUptime selv sender fra, under **Admin Dashboard > Indstillinger > Notifikationer > E-mails**, i kortet **Tilpassede e-mail- og SMTP-indstillinger**. Begge formularer spørger om det samme, i to trin.

:::steps
### Åbn formularen

:::tabs
@tab Projekt
Klik under **Projektindstillinger > Notifikationer > Notifikationsindstillinger** på **Opret SMTP Konfiguration** i kortet **Brugerdefinerede SMTP-konfigurationer**.
@tab Selvhostet instans
Åbn **Indstillinger** i Admin Dashboard og derefter **Notifikationer > E-mails** i sidemenuen (**Notifikationer** er foldet sammen fra start). Klik i kortet **E-mail-serverindstillinger** på **Rediger server**, og sæt **E-mailservertype** til `Custom SMTP`. Klik derefter på **Rediger SMTP-konfig** i kortet **Tilpassede e-mail- og SMTP-indstillinger**, som vises nedenunder.
:::

### Udfyld trinnet Server

I trinnet **Server** angiver du **Navn** (kun projektkonfigurationer), **Værtsnavn**, **Port** (en ny projektkonfiguration starter på `587`), **Brugernavn** og **Adgangskode**.

### Tjek Flere felter

Alt andet er foldet sammen under **Flere felter** i slutningen af trinnet **Server**. Mens det er foldet sammen, fortæller overskriften, hvordan mail sendes, for eksempel "Mail sendes via SMTP med login med brugernavn og adgangskode. TLS er påkrævet." Åbn det kun, hvis du skal ændre en af indstillingerne i tabellen nedenfor.

### Udfyld trinnet Afsender

I trinnet **Afsender** angiver du **E-mail fra** og **Fra-navn**, som dine e-mails kommer fra. Din server skal tillade afsendelse fra den adresse.

### Gem og send en test-e-mail

Gem konfigurationen. Når en projektkonfiguration er gemt, tjekker **Send test-e-mail** i dens række, at den virker. Det kræver tilladelse til at tilføje SMTP-konfigurationer: **Project Owner**, **Project Admin** eller **Create SMTP Config** og **Read SMTP Config** i en brugerdefineret rolle. På OneUptime Cloud kræver det også planen **Growth**, ligesom det at tilføje en konfiguration. For alle andre er knappen låst, og dens værktøjstip siger, hvad der skal til.

Testen beder om en **E-mail**-adresse at sende til, til at begynde med din egen. Tjek, at beskeden kommer frem.
:::

Det er indstillingerne under **Flere felter**:

| Felt | Hvad det gør |
| --- | --- |
| **Transport** | `SMTP` (standarden) eller `Microsoft Graph` til en Microsoft 365-lejer, hvor SMTP AUTH er slået fra. Valg af Microsoft Graph skjuler værtsnavn, port, brugernavn og adgangskode og viser OAuth-felterne. |
| **Kræv TLS** | Slået til for en ny projektkonfiguration. Mail sendes kun over en krypteret forbindelse med et gyldigt certifikat. Når dette er slået fra, krypteres mail kun, hvis serveren tilbyder det, og certifikatet kontrolleres ikke. Port 465 er altid krypteret. |
| **Godkendelsestype** | `Username and Password` (standarden), `OAuth` eller `None` til et relay, der ikke kræver login. |
| **OAuth-felter** | **OAuth-udbydertype**, **OAuth-klient-ID**, **OAuth-klienthemmelighed**, **OAuth-token-URL** og **OAuth-omfang**, som vises, når OAuth eller Microsoft Graph er valgt. |
| **Beskrivelse** | En note til dit team (kun projektkonfigurationer). |

**Microsoft Graph.** Åbn **Flere felter**, sæt **Transport** til `Microsoft Graph`, og udfyld en Azure-app, der har programtilladelsen **Mail.Send**: dens klient-id og klienthemmelighed, token-URL'en `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` og omfanget `https://graph.microsoft.com/.default`. Mail sendes fra postkassen for **E-mail fra**, som skal være en licenseret postkasse i din lejer.

> [!NOTE]
> På OneUptime Cloud skal et projekts mailserver kunne nås via internettet: en vært, der slås op til en privat eller intern adresse, afvises. I en selvhostet installation er private adresser tilladt, medmindre `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` er `true`; loopback- og link-local-adresser afvises altid. Instansens egen mailserver kontrolleres ikke på denne måde.

## OAuth 2.0-godkendelse

Med OAuth 2.0 logger OneUptime ind på din mailserver uden adgangskode, hvilket virksomheders maildienster i stigende grad kræver. OneUptime understøtter to OAuth-tilladelsestyper:

- **Client Credentials**: bruges af Microsoft 365 og de fleste OAuth-udbydere.
- **JWT Bearer**: bruges af tjenestekonti i Google Workspace.

```mermaid title="Sådan logger OneUptime ind med OAuth"
sequenceDiagram
    participant O as OneUptime
    participant T as Token-URL
    participant M as Mailserver
    O->>T: Beder om et adgangstoken
    T-->>O: Adgangstoken
    Note over O: Gemt i cache og fornyet,<br/>før det udløber
    O->>M: Logger ind med tokenet
    O->>M: Sender e-mailen
```

**Godkendelsestype** og OAuth-felterne findes under **Flere felter** i formularens trin Server. For at logge ind med OAuth udfylder du:

| Felt | Beskrivelse |
| --- | --- |
| **Værtsnavn** | SMTP-serverens adresse |
| **Port** | SMTP-port (typisk 587 til STARTTLS eller 465 til implicit TLS) |
| **Brugernavn** | E-mailadressen på den postkasse, der sender |
| **Godkendelsestype** | `OAuth` |
| **OAuth-udbydertype** | `Client Credentials` til Microsoft 365 eller `JWT Bearer` til Google Workspace |
| **OAuth-klient-ID** | Program-id'et (klient-id'et) fra din OAuth-udbyder (hos Google: tjenestekontoens e-mail) |
| **OAuth-klienthemmelighed** | Klienthemmeligheden fra din OAuth-udbyder (hos Google: den private nøgle) |
| **OAuth-token-URL** | Din udbyders OAuth-tokenendepunkt |
| **OAuth-omfang** | Det OAuth-omfang, der giver SMTP-adgang |

OneUptime gemmer OAuth-tokens i cache og fornyer dem automatisk, før de udløber.

## Konfiguration af Microsoft 365

For at bruge OAuth med Microsoft 365 (Exchange Online) registrerer du et program i Microsoft Entra, giver det tilladelse til at sende mail via SMTP og tillader det at bruge den postkasse, du sender fra.

:::steps
### Registrer et program i Microsoft Entra

1. Log ind på [Microsoft Entra Admin Center](https://entra.microsoft.com).
2. Gå til **Identity** > **Applications** > **App registrations**, og klik på **New registration**.
3. Angiv et navn (for eksempel "OneUptime SMTP"), vælg "Accounts in this organizational directory only", og lad **Redirect URI** være tom.
4. Klik på **Register**.

På siden **Overview** noterer du **Application (client) ID** (dit klient-id) og **Directory (tenant) ID** (til token-URL'en).

### Opret en klienthemmelighed

1. Gå i din appregistrering til **Certificates & secrets**, og klik på **New client secret**.
2. Tilføj en beskrivelse, vælg en udløbsperiode, og klik på **Add**.
3. **Kopiér hemmelighedens værdi med det samme**: den vises ikke igen.

### Tilføj SMTP-tilladelsen

1. Gå til **API permissions**, og klik på **Add a permission**.
2. Vælg **APIs my organization uses**, og søg derefter efter og vælg **Office 365 Exchange Online**.
3. Vælg **Application permissions**, markér **SMTP.SendAsApp**, og klik på **Add permissions**.
4. Klik på **Grant admin consent for [your organization]** (det kræver administratorrettigheder).

### Registrer tjenesteprincippet i Exchange Online

Før programmet kan sende e-mail, registrerer du dets tjenesteprincip i Exchange Online og giver det adgang til den postkasse, du sender fra:

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> Brug `Add-MailboxPermission`, ikke `Add-RecipientPermission`. `Add-RecipientPermission` giver kun `SendAs` på modtageren, hvilket ikke er nok til, at tjenesteprincippet kan sende mail via SMTP med OAuth: afsendelsen fejler med en godkendelses- eller tilladelsesfejl.

### Opret SMTP-konfigurationen i OneUptime

Opret eller rediger en SMTP-konfiguration med disse indstillinger, og erstat `<tenant-id>` med dit **Directory (tenant) ID**:

| Felt | Værdi |
| --- | --- |
| Værtsnavn | `smtp.office365.com` |
| Port | `587` |
| Brugernavn | Den e-mailadresse, du har givet tilladelserne (f.eks. `sender@yourdomain.com`) |
| Godkendelsestype | `OAuth` |
| OAuth-udbydertype | `Client Credentials` |
| OAuth-klient-ID | Dit **Application (client) ID** |
| OAuth-klienthemmelighed | Klienthemmelighedens værdi |
| OAuth-token-URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth-omfang | `https://outlook.office365.com/.default` |
| E-mail fra | Samme som brugernavnet |
| Kræv TLS | Slået til |

Tjek den derefter med **Send test-e-mail**.
:::

## Konfiguration af Google Workspace

Google Workspace kræver en **tjenestekonto** med domæneomfattende delegering, som sender e-mail på vegne af en bruger i dit domæne. Googles SMTP-servere understøtter ikke et simpelt client credentials-flow til Gmail.

### Før du begynder med Google Workspace

- En Google Workspace-konto. Private Gmail-konti understøtter ikke dette.
- Super Admin-adgang til Google Workspace-administrationskonsollen.
- Adgang til Google Cloud Console.

:::steps
### Opret et Google Cloud-projekt

1. Gå til [Google Cloud Console](https://console.cloud.google.com).
2. Klik på projektvælgeren, og vælg **New Project**.
3. Angiv et projektnavn, klik på **Create**, og vælg dit nye projekt.

### Aktivér Gmail API

1. Gå til **APIs & Services** > **Library**.
2. Søg efter "Gmail API", klik på **Gmail API** og derefter på **Enable**.

### Opret en tjenestekonto

1. Gå til **APIs & Services** > **Credentials**.
2. Klik på **Create Credentials** > **Service account**.
3. Angiv et navn og en beskrivelse, klik på **Create and Continue**, spring de valgfri trin over, og klik på **Done**.

### Opret en nøgle til tjenestekontoen

1. Klik på den tjenestekonto, du lige har oprettet, og gå til fanen **Keys**.
2. Klik på **Add Key** > **Create new key**, vælg **JSON**, og klik på **Create**.
3. Opbevar den downloadede JSON-fil sikkert. Dens `client_email` er dit OAuth-klient-id, og dens `private_key` din OAuth-klienthemmelighed.

### Aktivér domæneomfattende delegering

1. Klik på **Show Advanced Settings** i tjenestekontoens detaljer.
2. Notér det numeriske **Client ID**.
3. Markér **Enable Google Workspace Domain-wide Delegation**, og klik på **Save**.

### Godkend tjenestekontoen i Google Workspace-administrationen

1. Log ind på [Google Workspace-administrationskonsollen](https://admin.google.com).
2. Gå til **Security** > **Access and data control** > **API Controls**, og klik på **Manage Domain Wide Delegation**.
3. Klik på **Add new**, angiv det numeriske **Client ID** fra forrige trin, og skriv `https://mail.google.com/` under **OAuth Scopes**.
4. Klik på **Authorize**.

Det kan tage fra få minutter op til 24 timer, før delegeringen virker.

### Opret SMTP-konfigurationen til Google Workspace

Opret eller rediger en SMTP-konfiguration med disse indstillinger:

| Felt | Værdi |
| --- | --- |
| Værtsnavn | `smtp.gmail.com` |
| Port | `587` |
| Brugernavn | Den Google Workspace-e-mailadresse, der skal sendes fra (f.eks. `notifications@yourdomain.com`). Tjenestekontoen optræder på vegne af denne bruger. |
| Godkendelsestype | `OAuth` |
| OAuth-udbydertype | `JWT Bearer` |
| OAuth-klient-ID | `client_email` fra din tjenestekontos JSON (f.eks. `your-service@your-project.iam.gserviceaccount.com`) |
| OAuth-klienthemmelighed | `private_key` fra din tjenestekontos JSON (hele nøglen inklusive `-----BEGIN PRIVATE KEY-----` og `-----END PRIVATE KEY-----`) |
| OAuth-token-URL | `https://oauth2.googleapis.com/token` |
| OAuth-omfang | `https://mail.google.com/` |
| E-mail fra | Samme som brugernavnet |
| Kræv TLS | Slået til |

Tjek den derefter med **Send test-e-mail**.
:::

> [!IMPORTANT]
> Hos Google (JWT Bearer) er **OAuth-klient-ID** **tjenestekontoens e-mail** (`client_email`), ikke det numeriske `client_id`. Tjenestekontoen optræder på vegne af brugeren i **Brugernavn** for at sende e-mail.

## Fejlfinding

### Fejl i Microsoft 365

| Problem | Løsning |
| --- | --- |
| "Authentication unsuccessful" | Kontrollér, at tjenesteprincippet er registreret i Exchange og har tilladelser til postkassen |
| "AADSTS700016: Application not found" | Kontrollér, at klient-id'et er korrekt, og at appen findes i din lejer |
| "AADSTS7000215: Invalid client secret" | Opret en ny klienthemmelighed: den gamle kan være udløbet |
| "The mailbox is not enabled for this operation" | Kør `Add-MailboxPermission` for at give adgang til postkassen |

### Fejl i Google Workspace

| Problem | Løsning |
| --- | --- |
| "invalid_grant" | Sørg for, at den domæneomfattende delegering er sat korrekt op og er trådt i kraft |
| "unauthorized_client" | Kontrollér, at klient-id'et er godkendt i Google Workspace-administrationskonsollen |
| "access_denied" | Kontrollér, at omfanget `https://mail.google.com/` er godkendt |
| "Domain policy has disabled third-party Drive apps" | Aktivér API-adgang i Google Workspace-administrationen under Security > API Controls |

### Andre problemer

:::details "Cannot send email. Please check your SMTP config."
**Send test-e-mail** siger dette, når en server, man logger ind på med brugernavn og adgangskode eller slet ikke logger ind på, ikke tager imod e-mailen. Kontrollér **Værtsnavn**, **Port**, **Brugernavn** og **Adgangskode**. Hvis din server ikke tilbyder TLS, eller dens certifikat ikke er gyldigt for dens værtsnavn, slår du **Kræv TLS** fra under **Flere felter** og prøver igen. Serverens eget svar gemmes sammen med testen: åbn fanen **E-mail** under **Projektindstillinger > Notifikationer > Notifikationslogs**, og vælg **Vis statusbesked** i dens række.
:::

:::details "Cannot send email with OAuth authentication"
Login med OAuth mislykkedes, og beskeden slutter med den fejl, din udbyder returnerede. Kontrollér **OAuth-klient-ID**, **OAuth-klienthemmelighed**, **OAuth-token-URL** og **OAuth-omfang**, at programmet har tilladelserne ovenfor, og at administratorsamtykke er givet. Hvis din Microsoft 365-lejer har SMTP AUTH slået fra, sætter du i stedet **Transport** til `Microsoft Graph`.
:::

:::details "Microsoft Graph send failed"
En konfiguration, hvis **Transport** er `Microsoft Graph`, siger dette, når Graph ikke tager imod e-mailen, efterfulgt af Microsofts egen fejl. Kontrollér, at appen har programtilladelsen **Mail.Send** med administratorsamtykke givet, at **OAuth-omfang** er `https://graph.microsoft.com/.default`, og at **E-mail fra** er en licenseret postkasse i din lejer.
:::

:::details "SMTP server host … could not be reached"
OneUptime nægtede at forbinde til projektets mailserver. På OneUptime Cloud afvises et værtsnavn, der ikke kan slås op, eller som slås op til en privat, loopback- eller link-local-adresse, med denne besked, som aldrig siger, hvilket af tilfældene det er: brug mailserverens offentlige værtsnavn. I en selvhostet installation, og for en mailserver angivet som IP-adresse, siger beskeden i stedet hvorfor. **Send test-e-mail** viser den kun for en OAuth-konfiguration; for de andre finder du den under **Vis statusbesked** på fanen **E-mail** i notifikationslogs.
:::

:::details Test-e-mailen kommer ikke frem
Kontrollér **E-mail fra**: din server skal tillade afsendelse fra den. Kig derefter i modtagerens spammappe og i din mailservers logs efter forsøget.
:::

## Gode sikkerhedsvaner

- **Skift hemmeligheder jævnligt.** Opret påmindelser om at udskifte klienthemmeligheder, før de udløber.
- **Brug dedikerede legitimationsoplysninger.** Opret særskilte legitimationsoplysninger til OneUptime i stedet for at dele dem med andre programmer.
- **Giv mindst mulige rettigheder.** Giv kun det, afsendelse kræver: **SMTP.SendAsApp** hos Microsoft, omfanget `https://mail.google.com/` hos Google.
- **Overvåg brugen.** Gennemgå mail-logs og OAuth-programmers logins for usædvanlig aktivitet.
- **Opbevar hemmeligheder sikkert.** Læg aldrig klienthemmeligheder i versionsstyring.

## Yderligere læsning

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Næste trin

:::cards
- [Notifikationsoversigt](/docs/emails/notification-rollup): Hvordan OneUptime samler bølger af e-mails til ejere.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers): Send e-mail til en statussides abonnenter via en SMTP-konfiguration i projektet.
:::
