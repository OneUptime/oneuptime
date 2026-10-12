# SMTP

Send e-posten fra OneUptime gjennom din egen e-postserver. Et prosjekt legger til SMTP-konfigurasjoner som prosjektets statussider sender e-post med, og en selvdriftet installasjon angir serveren som OneUptime sender alt annet fra. Begge støtter tre måter å logge på:

- **Brukernavn og passord**: klassisk SMTP-autentisering.
- **OAuth 2.0**: for Microsoft 365 og Google Workspace, der grunnleggende autentisering ofte er slått av.
- **Ingen**: for relé-servere som ikke krever autentisering.

```mermaid title="Hvilken e-postserver sender hva"
flowchart TB
    SP["E-post fra en statusside"] --> Q{"Egendefinert SMTP-konfigurasjon<br/>valgt for siden?"}
    Q -->|"Ja"| P["Prosjektets<br/>SMTP-konfigurasjon"]
    Q -->|"Nei"| D["OneUptimes egen<br/>e-postserver"]
    E["All annen e-post<br/>fra OneUptime"] --> D
```

I en selvdriftet installasjon er OneUptimes egen e-postserver den som er angitt i Admin Dashboard. En statusside velger SMTP-konfigurasjonen sin på siden **Abonnentsinnstillinger**, i kortet **Egendefinert SMTP**.

:::cards
- [Legg til en e-postserver](#legg-til-en-smtp-server): To trinn, alt annet slått sammen.
- [Microsoft 365](#konfigurasjon-for-microsoft-365): OAuth med en appregistrering i Entra.
- [Google Workspace](#konfigurasjon-for-google-workspace): OAuth med en tjenestekonto.
- [Feilsøking](#feilsøking): Vanlige feil og hva de betyr.
:::

## Legg til en SMTP-server

Legg til et prosjekts e-postserver under **Prosjektinnstillinger > Varsler > Varselinnstillinger**, i kortet **Egendefinerte SMTP-konfigurasjoner**. I en selvdriftet installasjon angis serveren som OneUptime selv sender fra, under **Admin Dashboard > Innstillinger > Varsler > E-poster**, i kortet **Egendefinerte e-post- og SMTP-innstillinger**. Begge skjemaene spør om det samme, i to trinn.

:::steps
### Åpne skjemaet

:::tabs
@tab Prosjekt
Klikk under **Prosjektinnstillinger > Varsler > Varselinnstillinger** på **Opprett SMTP Konfigurasjon** i kortet **Egendefinerte SMTP-konfigurasjoner**.
@tab Selvdriftet instans
Åpne **Innstillinger** i Admin Dashboard, og deretter **Varsler > E-poster** i sidemenyen (**Varsler** er slått sammen fra start). Klikk i kortet **E-post-serverinnstillinger** på **Rediger server**, og sett **E-posttjenertype** til `Custom SMTP`. Klikk deretter på **Rediger SMTP-konfig** i kortet **Egendefinerte e-post- og SMTP-innstillinger**, som vises under.
:::

### Fyll ut trinnet Server

I trinnet **Server** fyller du inn **Navn** (bare prosjektkonfigurasjoner), **Vertsnavn**, **Port** (en ny prosjektkonfigurasjon starter på `587`), **Brukernavn** og **Passord**.

### Sjekk Flere felt

Alt annet er slått sammen under **Flere felt** på slutten av trinnet **Server**. Mens det er slått sammen, sier overskriften hvordan e-post sendes, for eksempel «E-post sendes via SMTP, med pålogging med brukernavn og passord. TLS er påkrevd.» Åpne det bare hvis du må endre en av innstillingene i tabellen nedenfor.

### Fyll ut trinnet Avsender

I trinnet **Avsender** fyller du inn **E-post fra** og **Fra-navn** som e-postene dine kommer fra. Serveren din må tillate sending fra den adressen.

### Lagre og send en test-e-post

Lagre konfigurasjonen. Når en prosjektkonfigurasjon er lagret, sjekker **Send test-e-post** i raden at den virker. Det krever tillatelse til å legge til SMTP-konfigurasjoner: **Project Owner**, **Project Admin**, eller **Create SMTP Config** og **Read SMTP Config** i en egendefinert rolle. På OneUptime Cloud krever det også planen **Growth**, på samme måte som å legge til en konfigurasjon. For alle andre er knappen låst, og verktøytipset sier hva som skal til.

Testen ber om en **E-post**-adresse å sende til, din egen til å begynne med. Sjekk at meldingen kommer frem.
:::

Dette er innstillingene under **Flere felt**:

| Felt | Hva det gjør |
| --- | --- |
| **Transport** | `SMTP` (standard), eller `Microsoft Graph` for en Microsoft 365-leietaker der SMTP AUTH er slått av. Når du velger Microsoft Graph, skjules vertsnavn, port, brukernavn og passord, og OAuth-feltene vises. |
| **Krev TLS** | På for en ny prosjektkonfigurasjon. E-post sendes bare over en kryptert tilkobling med et gyldig sertifikat. Når dette er av, krypteres e-post bare hvis serveren tilbyr det, og sertifikatet kontrolleres ikke. Port 465 er alltid kryptert. |
| **Autentiseringstype** | `Username and Password` (standard), `OAuth`, eller `None` for et relé som ikke krever pålogging. |
| **OAuth-felt** | **OAuth-leverandørtype**, **OAuth Client ID**, **OAuth Client Secret**, **OAuth-token-URL** og **OAuth-omfang**, som vises når OAuth eller Microsoft Graph er valgt. |
| **Beskrivelse** | Et notat til teamet ditt (bare prosjektkonfigurasjoner). |

**Microsoft Graph.** Åpne **Flere felt**, sett **Transport** til `Microsoft Graph`, og fyll inn en Azure-app som har programtillatelsen **Mail.Send**: klient-ID-en og klienthemmeligheten, token-URL-en `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` og omfanget `https://graph.microsoft.com/.default`. E-post sendes fra postboksen til **E-post fra**, som må være en lisensiert postboks i leietakeren din.

> [!NOTE]
> På OneUptime Cloud må et prosjekts e-postserver kunne nås over internett: en vert som slås opp til en privat eller intern adresse, avvises. I en selvdriftet installasjon er private adresser tillatt, med mindre `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` er `true`; loopback- og link-local-adresser avvises alltid. Instansens egen e-postserver kontrolleres ikke på denne måten.

## OAuth 2.0-autentisering

Med OAuth 2.0 logger OneUptime på e-postserveren din uten passord, noe e-posttjenester for bedrifter i økende grad krever. OneUptime støtter to OAuth-tildelingstyper:

- **Client Credentials**: brukes av Microsoft 365 og de fleste OAuth-leverandører.
- **JWT Bearer**: brukes av tjenestekontoer i Google Workspace.

```mermaid title="Slik logger OneUptime på med OAuth"
sequenceDiagram
    participant O as OneUptime
    participant T as Token-URL
    participant M as E-postserver
    O->>T: Ber om et tilgangstoken
    T-->>O: Tilgangstoken
    Note over O: Bufret og fornyet<br/>før det utløper
    O->>M: Logger på med tokenet
    O->>M: Sender e-posten
```

**Autentiseringstype** og OAuth-feltene ligger under **Flere felt** i skjemaets trinn Server. For å logge på med OAuth fyller du ut:

| Felt | Beskrivelse |
| --- | --- |
| **Vertsnavn** | Adressen til SMTP-serveren |
| **Port** | SMTP-port (vanligvis 587 for STARTTLS eller 465 for implisitt TLS) |
| **Brukernavn** | E-postadressen til postboksen som sender |
| **Autentiseringstype** | `OAuth` |
| **OAuth-leverandørtype** | `Client Credentials` for Microsoft 365, eller `JWT Bearer` for Google Workspace |
| **OAuth Client ID** | Program-ID-en (klient-ID-en) fra OAuth-leverandøren din (hos Google: tjenestekontoens e-post) |
| **OAuth Client Secret** | Klienthemmeligheten fra OAuth-leverandøren din (hos Google: den private nøkkelen) |
| **OAuth-token-URL** | Leverandørens OAuth-tokenendepunkt |
| **OAuth-omfang** | OAuth-omfanget som gir SMTP-tilgang |

OneUptime bufrer OAuth-tokener og fornyer dem automatisk før de utløper.

## Konfigurasjon for Microsoft 365

For å bruke OAuth med Microsoft 365 (Exchange Online) registrerer du et program i Microsoft Entra, gir det tillatelse til å sende e-post via SMTP og lar det bruke postboksen du sender fra.

:::steps
### Registrer et program i Microsoft Entra

1. Logg på [Microsoft Entra-administrasjonssenteret](https://entra.microsoft.com).
2. Gå til **Identity** > **Applications** > **App registrations**, og klikk på **New registration**.
3. Skriv inn et navn (for eksempel «OneUptime SMTP»), velg «Accounts in this organizational directory only», og la **Redirect URI** stå tom.
4. Klikk på **Register**.

På siden **Overview** noterer du **Application (client) ID** (klient-ID-en din) og **Directory (tenant) ID** (til token-URL-en).

### Opprett en klienthemmelighet

1. Gå i appregistreringen til **Certificates & secrets**, og klikk på **New client secret**.
2. Legg til en beskrivelse, velg en utløpsperiode, og klikk på **Add**.
3. **Kopier verdien av hemmeligheten med en gang**: den vises ikke igjen.

### Legg til SMTP-tillatelsen

1. Gå til **API permissions**, og klikk på **Add a permission**.
2. Velg **APIs my organization uses**, og søk deretter etter og velg **Office 365 Exchange Online**.
3. Velg **Application permissions**, kryss av for **SMTP.SendAsApp**, og klikk på **Add permissions**.
4. Klikk på **Grant admin consent for [your organization]** (dette krever administratorrettigheter).

### Registrer tjenestekontohaveren i Exchange Online

Før programmet kan sende e-post, registrerer du tjenestekontohaveren i Exchange Online og gir den tilgang til postboksen du sender fra:

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
> Bruk `Add-MailboxPermission`, ikke `Add-RecipientPermission`. `Add-RecipientPermission` gir bare `SendAs` på mottakeren, noe som ikke er nok til at tjenestekontohaveren kan sende e-post via SMTP med OAuth: sendingen feiler med en autentiserings- eller tillatelsesfeil.

### Opprett SMTP-konfigurasjonen i OneUptime

Opprett eller rediger en SMTP-konfigurasjon med disse innstillingene, og bytt ut `<tenant-id>` med din **Directory (tenant) ID**:

| Felt | Verdi |
| --- | --- |
| Vertsnavn | `smtp.office365.com` |
| Port | `587` |
| Brukernavn | E-postadressen du ga tillatelsene til (f.eks. `sender@yourdomain.com`) |
| Autentiseringstype | `OAuth` |
| OAuth-leverandørtype | `Client Credentials` |
| OAuth Client ID | Din **Application (client) ID** |
| OAuth Client Secret | Verdien av klienthemmeligheten |
| OAuth-token-URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth-omfang | `https://outlook.office365.com/.default` |
| E-post fra | Samme som brukernavnet |
| Krev TLS | På |

Sjekk den deretter med **Send test-e-post**.
:::

## Konfigurasjon for Google Workspace

Google Workspace trenger en **tjenestekonto** med domeneomfattende delegering, som sender e-post på vegne av en bruker i domenet ditt. Googles SMTP-servere støtter ikke en enkel client credentials-flyt for Gmail.

### Før du begynner med Google Workspace

- En Google Workspace-konto. Private Gmail-kontoer støtter ikke dette.
- Superadministrator-tilgang til administrasjonskonsollen for Google Workspace.
- Tilgang til Google Cloud Console.

:::steps
### Opprett et Google Cloud-prosjekt

1. Gå til [Google Cloud Console](https://console.cloud.google.com).
2. Klikk på prosjektvelgeren, og velg **New Project**.
3. Skriv inn et prosjektnavn, klikk på **Create**, og velg det nye prosjektet.

### Aktiver Gmail API

1. Gå til **APIs & Services** > **Library**.
2. Søk etter «Gmail API», klikk på **Gmail API** og deretter på **Enable**.

### Opprett en tjenestekonto

1. Gå til **APIs & Services** > **Credentials**.
2. Klikk på **Create Credentials** > **Service account**.
3. Skriv inn et navn og en beskrivelse, klikk på **Create and Continue**, hopp over de valgfrie trinnene, og klikk på **Done**.

### Opprett en nøkkel for tjenestekontoen

1. Klikk på tjenestekontoen du nettopp opprettet, og gå til fanen **Keys**.
2. Klikk på **Add Key** > **Create new key**, velg **JSON**, og klikk på **Create**.
3. Oppbevar den nedlastede JSON-filen trygt. `client_email` i den er OAuth-klient-ID-en din, og `private_key` OAuth-klienthemmeligheten din.

### Aktiver domeneomfattende delegering

1. Klikk på **Show Advanced Settings** i detaljene til tjenestekontoen.
2. Noter den numeriske **Client ID**.
3. Kryss av for **Enable Google Workspace Domain-wide Delegation**, og klikk på **Save**.

### Godkjenn tjenestekontoen i administrasjonen av Google Workspace

1. Logg på [administrasjonskonsollen for Google Workspace](https://admin.google.com).
2. Gå til **Security** > **Access and data control** > **API Controls**, og klikk på **Manage Domain Wide Delegation**.
3. Klikk på **Add new**, skriv inn den numeriske **Client ID** fra forrige trinn, og skriv `https://mail.google.com/` under **OAuth Scopes**.
4. Klikk på **Authorize**.

Det kan ta fra noen minutter til 24 timer før delegeringen trer i kraft.

### Opprett SMTP-konfigurasjonen for Google Workspace

Opprett eller rediger en SMTP-konfigurasjon med disse innstillingene:

| Felt | Verdi |
| --- | --- |
| Vertsnavn | `smtp.gmail.com` |
| Port | `587` |
| Brukernavn | Google Workspace-e-postadressen det skal sendes fra (f.eks. `notifications@yourdomain.com`). Tjenestekontoen opptrer på vegne av denne brukeren. |
| Autentiseringstype | `OAuth` |
| OAuth-leverandørtype | `JWT Bearer` |
| OAuth Client ID | `client_email` fra JSON-filen til tjenestekontoen (f.eks. `your-service@your-project.iam.gserviceaccount.com`) |
| OAuth Client Secret | `private_key` fra JSON-filen til tjenestekontoen (hele nøkkelen, inkludert `-----BEGIN PRIVATE KEY-----` og `-----END PRIVATE KEY-----`) |
| OAuth-token-URL | `https://oauth2.googleapis.com/token` |
| OAuth-omfang | `https://mail.google.com/` |
| E-post fra | Samme som brukernavnet |
| Krev TLS | På |

Sjekk den deretter med **Send test-e-post**.
:::

> [!IMPORTANT]
> Hos Google (JWT Bearer) er **OAuth Client ID** **tjenestekontoens e-post** (`client_email`), ikke den numeriske `client_id`. Tjenestekontoen opptrer på vegne av brukeren i **Brukernavn** for å sende e-post.

## Feilsøking

### Feil i Microsoft 365

| Problem | Løsning |
| --- | --- |
| "Authentication unsuccessful" | Kontroller at tjenestekontohaveren er registrert i Exchange og har tillatelser til postboksen |
| "AADSTS700016: Application not found" | Kontroller at klient-ID-en er riktig og at appen finnes i leietakeren din |
| "AADSTS7000215: Invalid client secret" | Opprett en ny klienthemmelighet: den gamle kan ha utløpt |
| "The mailbox is not enabled for this operation" | Kjør `Add-MailboxPermission` for å gi tilgang til postboksen |

### Feil i Google Workspace

| Problem | Løsning |
| --- | --- |
| "invalid_grant" | Sørg for at den domeneomfattende delegeringen er riktig satt opp og har trådt i kraft |
| "unauthorized_client" | Kontroller at klient-ID-en er godkjent i administrasjonskonsollen for Google Workspace |
| "access_denied" | Kontroller at omfanget `https://mail.google.com/` er godkjent |
| "Domain policy has disabled third-party Drive apps" | Aktiver API-tilgang i administrasjonen av Google Workspace, under Security > API Controls |

### Andre problemer

:::details "Cannot send email. Please check your SMTP config."
**Send test-e-post** sier dette når en server man logger på med brukernavn og passord, eller ikke logger på i det hele tatt, ikke tar imot e-posten. Kontroller **Vertsnavn**, **Port**, **Brukernavn** og **Passord**. Hvis serveren ikke tilbyr TLS, eller sertifikatet ikke er gyldig for vertsnavnet, slår du av **Krev TLS** under **Flere felt** og prøver igjen. Serverens eget svar lagres sammen med testen: åpne fanen **E-post** under **Prosjektinnstillinger > Varsler > Varsellogger**, og velg **Vis statusmelding** i raden.
:::

:::details "Cannot send email with OAuth authentication"
Påloggingen med OAuth mislyktes, og meldingen slutter med feilen leverandøren din returnerte. Kontroller **OAuth Client ID**, **OAuth Client Secret**, **OAuth-token-URL** og **OAuth-omfang**, at programmet har tillatelsene over, og at administratorsamtykke er gitt. Hvis Microsoft 365-leietakeren din har SMTP AUTH slått av, setter du i stedet **Transport** til `Microsoft Graph`.
:::

:::details "Microsoft Graph send failed"
En konfigurasjon der **Transport** er `Microsoft Graph`, sier dette når Graph ikke tar imot e-posten, etterfulgt av Microsofts egen feil. Kontroller at appen har programtillatelsen **Mail.Send** med administratorsamtykke gitt, at **OAuth-omfang** er `https://graph.microsoft.com/.default`, og at **E-post fra** er en lisensiert postboks i leietakeren din.
:::

:::details "SMTP server host … could not be reached"
OneUptime nektet å koble til prosjektets e-postserver. På OneUptime Cloud avvises et vertsnavn som ikke kan slås opp, eller som slås opp til en privat adresse, loopback- eller link-local-adresse, med denne meldingen, som aldri sier hvilket av tilfellene det er: bruk e-postserverens offentlige vertsnavn. I en selvdriftet installasjon, og for en e-postserver som er oppgitt som IP-adresse, sier meldingen i stedet hvorfor. **Send test-e-post** viser den bare for en OAuth-konfigurasjon; for de andre finner du den under **Vis statusmelding** på fanen **E-post** i varselloggene.
:::

:::details Test-e-posten kommer ikke frem
Kontroller **E-post fra**: serveren din må tillate sending fra den. Se deretter i mottakerens søppelpostmappe og i loggene til e-postserveren etter forsøket.
:::

## Gode sikkerhetsrutiner

- **Bytt hemmeligheter jevnlig.** Sett opp påminnelser om å erstatte klienthemmeligheter før de utløper.
- **Bruk egne påloggingsdetaljer.** Opprett egne påloggingsdetaljer for OneUptime i stedet for å dele dem med andre programmer.
- **Gi minst mulig tilgang.** Gi bare det sending krever: **SMTP.SendAsApp** hos Microsoft, omfanget `https://mail.google.com/` hos Google.
- **Overvåk bruken.** Gå gjennom e-postlogger og påloggingene til OAuth-programmer for uvanlig aktivitet.
- **Oppbevar hemmeligheter trygt.** Legg aldri klienthemmeligheter i versjonskontroll.

## Videre lesning

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Neste steg

:::cards
- [Varseloppsummering](/docs/emails/notification-rollup): Hvordan OneUptime samler bølger av e-post til eiere.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers): Send e-posten til abonnentene på en statusside via en SMTP-konfigurasjon i prosjektet.
:::
