# SMTP-konfigurasjon

OneUptime støtter sending av e-post via egendefinerte SMTP-servere med tre autentiseringsmetoder:

- **Brukernavn og passord** – Tradisjonell SMTP-autentisering
- **OAuth 2.0** – Moderne autentisering for Microsoft 365 og Google Workspace
- **Ingen** – For reléservere som ikke krever autentisering

Den første delen nedenfor viser hvor hver innstilling er. Resten av denne veiledningen handler om OAuth 2.0-autentisering for Microsoft 365 og Google Workspace.

## Legge til en SMTP-server

Legg til et prosjekts e-postserver under **Prosjektinnstillinger > Varsler > Varselinnstillinger**, i kortet **Egendefinerte SMTP-konfigurasjoner**. På en selvhostet installasjon angis serveren OneUptime selv sender fra under **Admin Dashboard > Innstillinger > E-poster**, i kortet **Egendefinerte e-post- og SMTP-innstillinger**. Begge skjemaene spør om det samme, i to trinn:

1. **Server**: **Navn** (bare prosjektkonfigurasjoner), **Vertsnavn**, **Port** (en ny konfigurasjon starter på `587`), **Brukernavn** og **Passord**.
2. **Avsender**: **E-post fra** og **Fra-navn** som e-postene dine kommer fra.

Alt annet er felt sammen under **Flere felt** på slutten av trinnet Server. Mens det er felt sammen, sier overskriften hvordan e-post sendes, for eksempel "E-post sendes via SMTP, med pålogging med brukernavn og passord. TLS er påkrevd."

| Felt                   | Hva det gjør                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transport**          | `SMTP` (standard), eller `Microsoft Graph` for en Microsoft 365-leietaker der SMTP AUTH er slått av. Velger du Microsoft Graph, skjules vertsnavn, port, brukernavn og passord, og OAuth-feltene vises.                                       |
| **Krev TLS**           | På for en ny prosjektkonfigurasjon. E-post sendes bare over en kryptert tilkobling med et gyldig sertifikat. Når dette er av, krypteres e-post bare hvis serveren tilbyr det, og sertifikatet kontrolleres ikke. Port 465 er alltid kryptert. |
| **Autentiseringstype** | `Username and Password` (standard), `OAuth`, eller `None` for et relé som ikke krever pålogging.                                                                                                                                              |
| **OAuth-felt**         | Leverandørtype, klient-ID, klienthemmelighet, token-URL og omfang, som vises når OAuth eller Microsoft Graph er valgt.                                                                                                                        |
| **Beskrivelse**        | Et notat til teamet ditt (bare prosjektkonfigurasjoner).                                                                                                                                                                                      |

**Microsoft Graph.** Åpne **Flere felt**, sett **Transport** til `Microsoft Graph`, og fyll inn en Azure-app med apptillatelsen **Mail.Send**: klient-ID-en og klienthemmeligheten, token-URL-en `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` og omfanget `https://graph.microsoft.com/.default`. E-post sendes fra postkassen i **E-post fra**, som må være en lisensiert postkasse i leietakeren din.

Når en prosjektkonfigurasjon er lagret, sjekker **Send test-e-post** på raden at den fungerer. Det krever tillatelse til å legge til SMTP-konfigurasjoner: **Project Owner**, **Project Admin** eller **Create SMTP Config** og **Read SMTP Config** i en egendefinert rolle. På OneUptime Cloud krever det også planen **Growth**, akkurat som å legge til en konfigurasjon. For alle andre er den låst, og verktøytipset sier hva som kreves.

## OAuth 2.0-autentisering

OAuth 2.0 gir en sikrere måte å autentisere med e-postservere, spesielt for bedriftsmiljøer som har deaktivert grunnleggende autentisering. OneUptime støtter to OAuth-tildelingstyper:

- **Klientlegitimasjon** – Brukes av Microsoft 365 og de fleste OAuth-leverandører
- **JWT Bearer** – Brukes av Google Workspace-tjenestekontoer

### Påkrevde felt for OAuth

Når du konfigurerer SMTP med OAuth-autentisering i OneUptime, trenger du:

| Felt                     | Beskrivelse                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------ |
| **Vertsnavn**            | SMTP-serveradresse                                                                   |
| **Port**                 | SMTP-port (vanligvis 587 for STARTTLS eller 465 for implisitt TLS)                   |
| **Brukernavn**           | E-postadressen å sende fra                                                           |
| **Autentiseringstype**   | Velg "OAuth"                                                                         |
| **OAuth-leverandørtype** | Velg "Client Credentials" for Microsoft 365, eller "JWT Bearer" for Google Workspace |
| **Klient-ID**            | Applikasjon/klient-ID fra OAuth-leverandøren din (for Google: tjenestekontos e-post) |
| **Klienthemmelighet**    | Klienthemmelighet fra OAuth-leverandøren din (for Google: privat nøkkel)             |
| **Token-URL**            | OAuth-tokenendepunkt-URL                                                             |
| **Omfang**               | Påkrevde OAuth-omfang for SMTP-tilgang                                               |

**Autentiseringstype** og OAuth-feltene ligger under **Flere felt** i skjemaets trinn Server.

---

## Microsoft 365-konfigurasjon

For å bruke OAuth med Microsoft 365/Exchange Online må du registrere en applikasjon i Microsoft Entra (Azure AD) og konfigurere de nødvendige tillatelsene.

### Trinn 1: Registrer en applikasjon i Microsoft Entra

1. Logg inn på [Microsoft Entra-administrasjonssenteret](https://entra.microsoft.com)
2. Naviger til **Identitet** > **Applikasjoner** > **Appregistreringer**
3. Klikk **Ny registrering**
4. Skriv inn et navn for applikasjonen (f.eks. "OneUptime SMTP")
5. For **Støttede kontotyper**, velg "Kontoer kun i denne organisasjonskatalogen"
6. La **Omdirigerings-URI** stå tom (ikke nødvendig for klientlegitimasjonsflyt)
7. Klikk **Registrer**

Etter registrering, noter følgende verdier fra **Oversikt**-siden:

- **Applikasjons-(klient-)ID** – Dette er klient-ID-en din
- **Katalog-(leietaker-)ID** – Du trenger dette for token-URL-en

### Trinn 2: Opprett en klienthemmelighet

1. I appregistreringen din, gå til **Sertifikater og hemmeligheter**
2. Klikk **Ny klienthemmelighet**
3. Legg til en beskrivelse og velg en utløpsperiode
4. Klikk **Legg til**
5. **Kopier hemmelighetsverdien umiddelbart** – den vil ikke vises igjen

### Trinn 3: Legg til SMTP API-tillatelser

1. Gå til **API-tillatelser**
2. Klikk **Legg til en tillatelse**
3. Velg **API-er organisasjonen min bruker**
4. Søk etter og velg **Office 365 Exchange Online**
5. Velg **Applikasjonstillatelser**
6. Finn og huk av **SMTP.SendAsApp**
7. Klikk **Legg til tillatelser**
8. Klikk **Gi administratorsamtykke for [organisasjonen din]** (krever administratorrettigheter)

### Trinn 4: Registrer tjenesteprinsipal i Exchange Online

Før applikasjonen kan sende e-poster, må du registrere tjenesteprinsipalen i Exchange Online og gi postbokstillatelser.

1. Installer Exchange Online PowerShell-modulen:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Koble til Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Registrer tjenesteprinsipalen (bruk objekt-ID-en fra **Enterprise Applications**, ikke App Registrations):

```powershell
# Finn objekt-ID-en i Microsoft Entra > Enterprise Applications > Appen din > Object ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Gi tjenesteprinsipalen tillatelse til å sende som en spesifikk postboks:

```powershell
# Gi full postbokstilgang til tjenesteprinsipalen
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Merk:** Bruk `Add-MailboxPermission` (ikke `Add-RecipientPermission`). `Add-RecipientPermission` gir kun `SendAs` på mottakeren og er ikke tilstrekkelig for at tjenesteprinsipalen skal sende e-post via SMTP med OAuth – du vil få en autentiserings-/tillatelsefeil ved sending. `Add-MailboxPermission` med `FullAccess` er kommandoen som faktisk fungerer.

### Trinn 5: Konfigurer i OneUptime

I OneUptime, opprett eller rediger en SMTP-konfigurasjon med disse innstillingene:

| Felt                 | Verdi                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| Vertsnavn            | `smtp.office365.com`                                                  |
| Port                 | `587`                                                                 |
| Brukernavn           | E-postadressen du ga tillatelser til (f.eks. `sender@yourdomain.com`) |
| Autentiseringstype   | `OAuth`                                                               |
| OAuth-leverandørtype | `Client Credentials`                                                  |
| Klient-ID            | Applikasjons-(klient-)ID fra trinn 1                                  |
| Klienthemmelighet    | Hemmelighetsverdien fra trinn 2                                       |
| Token-URL            | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`     |
| Omfang               | `https://outlook.office365.com/.default`                              |
| Fra e-post           | Samme som brukernavn                                                  |
| Krev TLS             | Aktivert                                                              |

Erstatt `<tenant-id>` med katalog-(leietaker-)ID-en fra trinn 1.

---

## Google Workspace-konfigurasjon

Google Workspace krever en **tjenestekonto** med domenomfattende delegering for å sende e-poster på vegne av brukere. Dette er nødvendig fordi Googles SMTP-servere ikke støtter direkte OAuth-klientlegitimasjonsflyt for Gmail.

### Forutsetninger

- Google Workspace-konto (ikke vanlig Gmail – forbruker-Gmail-kontoer støtter ikke dette)
- Superadministratortilgang til Google Workspace Admin Console
- Tilgang til Google Cloud Console

### Trinn 1: Opprett et Google Cloud-prosjekt

1. Gå til [Google Cloud Console](https://console.cloud.google.com)
2. Klikk på prosjektmenyen og velg **Nytt prosjekt**
3. Skriv inn et prosjektnavn og klikk **Opprett**
4. Velg det nye prosjektet

### Trinn 2: Aktiver Gmail API

1. Gå til **API-er og tjenester** > **Bibliotek**
2. Søk etter "Gmail API"
3. Klikk **Gmail API** og deretter **Aktiver**

### Trinn 3: Opprett en tjenestekonto

1. Gå til **API-er og tjenester** > **Legitimasjon**
2. Klikk **Opprett legitimasjon** > **Tjenestekonto**
3. Skriv inn et navn og en beskrivelse for tjenestekontoen
4. Klikk **Opprett og fortsett**
5. Hopp over de valgfrie trinnene og klikk **Ferdig**

### Trinn 4: Opprett tjenestekontonøkler

1. Klikk på tjenestekontoen du nettopp opprettet
2. Gå til fanen **Nøkler**
3. Klikk **Legg til nøkkel** > **Opprett ny nøkkel**
4. Velg **JSON** og klikk **Opprett**
5. Lagre den nedlastede JSON-filen på et sikkert sted – den inneholder:
   - `client_id` – Klient-ID-en din
   - `private_key` – Klienthemmeligheten din (den private nøkkelen)

### Trinn 5: Aktiver domenomfattende delegering

1. I tjenestekontodetaljene, klikk **Vis avanserte innstillinger**
2. Noter **Klient-ID** (numerisk ID)
3. Huk av **Aktiver Google Workspace domenomfattende delegering**
4. Klikk **Lagre**

### Trinn 6: Autoriser tjenestekontoen i Google Workspace Admin

1. Logg inn på [Google Workspace Admin Console](https://admin.google.com)
2. Gå til **Sikkerhet** > **Tilgang og datakontroll** > **API-kontroller**
3. Klikk **Administrer domenomfattende delegering**
4. Klikk **Legg til ny**
5. Skriv inn **Klient-ID** fra trinn 5
6. For **OAuth-omfang**, skriv inn: `https://mail.google.com/`
7. Klikk **Autoriser**

Merk: Det kan ta noen minutter til 24 timer for delegeringen å propagere.

### Trinn 7: Konfigurer i OneUptime

I OneUptime, opprett eller rediger en SMTP-konfigurasjon med disse innstillingene:

| Felt                 | Verdi                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Vertsnavn            | `smtp.gmail.com`                                                                                                                             |
| Port                 | `587`                                                                                                                                        |
| Brukernavn           | Google Workspace-e-postadressen å sende fra (f.eks. `notifications@yourdomain.com`). Denne brukeren vil bli representert av tjenestekontoen. |
| Autentiseringstype   | `OAuth`                                                                                                                                      |
| OAuth-leverandørtype | `JWT Bearer`                                                                                                                                 |
| Klient-ID            | `client_email` fra tjenestekonto-JSON (f.eks. `your-service@your-project.iam.gserviceaccount.com`)                                           |
| Klienthemmelighet    | `private_key` fra tjenestekonto-JSON (hele nøkkelen inkludert `-----BEGIN PRIVATE KEY-----` og `-----END PRIVATE KEY-----`)                  |
| Token-URL            | `https://oauth2.googleapis.com/token`                                                                                                        |
| Omfang               | `https://mail.google.com/`                                                                                                                   |
| Fra e-post           | Samme som brukernavn                                                                                                                         |
| Krev TLS             | Aktivert                                                                                                                                     |

**Viktig:** For Google (JWT Bearer) er klient-ID-en **tjenestekontoens e-post** (`client_email`), IKKE den numeriske `client_id`. Tjenestekontoen vil representere brukeren angitt i brukernavnfeltet for å sende e-poster.

---

## Feilsøking

### Microsoft 365

| Problem                                         | Løsning                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Authentication unsuccessful"                   | Bekreft at tjenesteprinsipalen er registrert i Exchange og har postbokstillatelser |
| "AADSTS700016: Application not found"           | Sjekk at klient-ID-en er riktig og at appen finnes i leietakeren din               |
| "AADSTS7000215: Invalid client secret"          | Generer klienthemmeligheten på nytt – den kan ha utløpt                            |
| "The mailbox is not enabled for this operation" | Kjør `Add-MailboxPermission` for å gi tilgang til postboksen                       |

### Google Workspace

| Problem                                             | Løsning                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| "invalid_grant"                                     | Sørg for at domenomfattende delegering er korrekt konfigurert og propagert |
| "unauthorized_client"                               | Bekreft at klient-ID-en er autorisert i Google Workspace Admin Console     |
| "access_denied"                                     | Sjekk at omfanget `https://mail.google.com/` er autorisert                 |
| "Domain policy has disabled third-party Drive apps" | Aktiver API-tilgang i Google Workspace Admin > Sikkerhet > API-kontroller  |

### Generelt

- **Test konfigurasjonen**: Bruk knappen "Send testmelding" i OneUptime for å bekrefte oppsettet ditt
- **Sjekk logger**: Gjennomgå OneUptime-logger for detaljerte feilmeldinger
- **Token-caching**: OneUptime cacher OAuth-tokens og oppdaterer dem automatisk før utløp

---

## Beste praksiser for sikkerhet

1. **Rullér hemmeligheter regelmessig**: Sett påminnelser i kalenderen om å rulle klienthemmeligheter før de utløper
2. **Bruk dedikerte tjenestekontoer**: Opprett separate legitimasjonsverdier for OneUptime fremfor å dele med andre applikasjoner
3. **Minste privilegiumsprinsippet**: Gi kun de minimumstillatelsene som er nødvendige (SMTP.SendAsApp for Microsoft, mail.google.com-omfang for Google)
4. **Overvåk bruk**: Gjennomgå e-postlogger og OAuth-applikasjonsinnlogginger for uvanlig aktivitet
5. **Sikker lagring**: Aldri forplikt klienthemmeligheter til versjonskontroll

---

## Ytterligere ressurser

### Microsoft 365

- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace

- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
