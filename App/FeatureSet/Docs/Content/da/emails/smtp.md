# SMTP-konfiguration

OneUptime understøtter afsendelse af e-mails via brugerdefinerede SMTP-servere med tre autentificeringsmetoder:

- **Brugernavn og adgangskode** – Traditionel SMTP-autentificering
- **OAuth 2.0** – Moderne autentificering til Microsoft 365 og Google Workspace
- **Ingen** – Til relayservere, der ikke kræver autentificering

Denne guide beskriver, hvordan man konfigurerer OAuth 2.0-autentificering til Microsoft 365 og Google Workspace.

## OAuth 2.0-autentificering

OAuth 2.0 giver en mere sikker måde at autentificere med e-mailservere på, især til virksomhedsmiljøer, der har deaktiveret grundlæggende autentificering. OneUptime understøtter to OAuth-granttyper:

- **Client Credentials** – Bruges af Microsoft 365 og de fleste OAuth-udbydere
- **JWT Bearer** – Bruges af Google Workspace-tjenestekonti

### Påkrævede felter til OAuth

Når du konfigurerer SMTP med OAuth-autentificering i OneUptime, skal du bruge:

| Felt | Beskrivelse |
|-------|-------------|
| **Værtsnavn** | SMTP-serveradresse |
| **Port** | SMTP-port (typisk 587 for STARTTLS eller 465 for implicit TLS) |
| **Brugernavn** | Den e-mailadresse der sendes fra |
| **Autentificeringstype** | Vælg "OAuth" |
| **OAuth-udbydertype** | Vælg "Client Credentials" til Microsoft 365, eller "JWT Bearer" til Google Workspace |
| **Klient-ID** | Applikations-/klient-ID fra din OAuth-udbyder (til Google: tjenestekontoens e-mail) |
| **Klienthemmelighed** | Klienthemmelighed fra din OAuth-udbyder (til Google: privat nøgle) |
| **Token URL** | OAuth-tokenendpoint-URL |
| **Scope** | Påkrævede OAuth-scope(s) til SMTP-adgang |

---

## Microsoft 365-konfiguration

For at bruge OAuth med Microsoft 365/Exchange Online skal du registrere en applikation i Microsoft Entra (Azure AD) og konfigurere de nødvendige tilladelser.

### Trin 1: Registrer en applikation i Microsoft Entra

1. Log ind på [Microsoft Entra-administrationscentret](https://entra.microsoft.com)
2. Naviger til **Identitet** > **Applikationer** > **Appregistreringer**
3. Klik på **Ny registrering**
4. Indtast et navn til din applikation (f.eks. "OneUptime SMTP")
5. Til **Understøttede kontotyper** skal du vælge "Kun konti i denne organisationsmappe"
6. Lad **Omdirigerings-URI** være tom (ikke nødvendig til klientlegitimationsflow)
7. Klik på **Registrer**

Efter registrering skal du notere følgende værdier fra **Oversigtssiden**:
- **Applikations-ID (klient)** – Dette er dit klient-ID
- **Mappe-ID (lejer)** – Du skal bruge dette til Token URL

### Trin 2: Opret en klienthemmelighed

1. I din appregistrering skal du gå til **Certifikater og hemmeligheder**
2. Klik på **Ny klienthemmelighed**
3. Tilføj en beskrivelse og vælg en udløbsperiode
4. Klik på **Tilføj**
5. **Kopiér hemmeligheds værdien med det samme** – den vises ikke igen

### Trin 3: Tilføj SMTP API-tilladelser

1. Gå til **API-tilladelser**
2. Klik på **Tilføj en tilladelse**
3. Vælg **API'er, min organisation bruger**
4. Søg efter og vælg **Office 365 Exchange Online**
5. Vælg **Applikationstilladelser**
6. Find og marker **SMTP.SendAsApp**
7. Klik på **Tilføj tilladelser**
8. Klik på **Giv administratorsamtykke til [din organisation]** (kræver administratorrettigheder)

### Trin 4: Registrer tjenesteprincipal i Exchange Online

Inden din applikation kan sende e-mails, skal du registrere tjenesteprincipalen i Exchange Online og tildele postkassetilladelser.

1. Installer Exchange Online PowerShell-modulet:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Opret forbindelse til Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Registrer tjenesteprincipalen (brug objekt-ID fra **Enterprise-applikationer**, ikke appregistreringer):

```powershell
# Find objekt-ID i Microsoft Entra > Enterprise-applikationer > Din app > Objekt-ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Giv tjenesteprincipalen tilladelse til at sende som en specifik postkasse:

```powershell
# Giv fuld postkasseadgang til tjenesteprincipalen
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Bemærk:** Brug `Add-MailboxPermission` (ikke `Add-RecipientPermission`). `Add-RecipientPermission` giver kun `SendAs` på modtageren og er ikke tilstrækkelig for tjenesteprincipalen til at sende mail via SMTP med OAuth – du vil få en autentificerings-/tilladelsefejl ved afsendelse. `Add-MailboxPermission` med `FullAccess` er den kommando, der faktisk fungerer.

### Trin 5: Konfigurer i OneUptime

I OneUptime skal du oprette eller redigere en SMTP-konfiguration med disse indstillinger:

| Felt | Værdi |
|-------|-------|
| Værtsnavn | `smtp.office365.com` |
| Port | `587` |
| Brugernavn | Den e-mailadresse, du har tildelt tilladelser til (f.eks. `sender@yourdomain.com`) |
| Autentificeringstype | `OAuth` |
| OAuth-udbydertype | `Client Credentials` |
| Klient-ID | Dit applikations-ID (klient) fra trin 1 |
| Klienthemmelighed | Hemmelighedsværdien fra trin 2 |
| Token URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope | `https://outlook.office365.com/.default` |
| Fra-e-mail | Samme som brugernavn |
| Sikker (TLS) | Aktiveret |

Erstat `<tenant-id>` med dit mappe-ID (lejer) fra trin 1.

---

## Google Workspace-konfiguration

Google Workspace kræver en **tjenestekonto** med domæneomfattende delegation for at sende e-mails på vegne af brugere. Dette er nødvendigt, fordi Googles SMTP-servere ikke understøtter direkte OAuth-klientlegitimationsflow til Gmail.

### Forudsætninger

- Google Workspace-konto (ikke almindelig Gmail – forbrugernes Gmail-konti understøtter ikke dette)
- Super Admin-adgang til Google Workspace Admin Console
- Adgang til Google Cloud Console

### Trin 1: Opret et Google Cloud-projekt

1. Gå til [Google Cloud Console](https://console.cloud.google.com)
2. Klik på projektets rullemenu og vælg **Nyt projekt**
3. Indtast et projektnavn og klik på **Opret**
4. Vælg dit nye projekt

### Trin 2: Aktiver Gmail API

1. Gå til **API'er og tjenester** > **Bibliotek**
2. Søg efter "Gmail API"
3. Klik på **Gmail API** og derefter **Aktiver**

### Trin 3: Opret en tjenestekonto

1. Gå til **API'er og tjenester** > **Legitimationsoplysninger**
2. Klik på **Opret legitimationsoplysninger** > **Tjenestekonto**
3. Indtast et navn og en beskrivelse til tjenestekontoen
4. Klik på **Opret og fortsæt**
5. Spring de valgfrie trin over og klik på **Udført**

### Trin 4: Opret tjenestekontoenøgler

1. Klik på den tjenestekonto, du netop oprettede
2. Gå til fanen **Nøgler**
3. Klik på **Tilføj nøgle** > **Opret ny nøgle**
4. Vælg **JSON** og klik på **Opret**
5. Gem den downloadede JSON-fil sikkert – den indeholder:
   - `client_id` – Dit klient-ID
   - `private_key` – Din klienthemmelighed (den private nøgle)

### Trin 5: Aktiver domæneomfattende delegation

1. I tjenestekontodetaljerne skal du klikke på **Vis avancerede indstillinger**
2. Notér **Klient-ID** (numerisk ID)
3. Marker **Aktivér Google Workspace-domæneomfattende delegation**
4. Klik på **Gem**

### Trin 6: Autoriser tjenestekontoen i Google Workspace Admin

1. Log ind på [Google Workspace Admin Console](https://admin.google.com)
2. Gå til **Sikkerhed** > **Adgang og datakontrol** > **API-kontroller**
3. Klik på **Administrer domæneomfattende delegation**
4. Klik på **Tilføj ny**
5. Indtast **Klient-ID** fra trin 5
6. Til **OAuth-scopes** skal du indtaste: `https://mail.google.com/`
7. Klik på **Autoriser**

Bemærk: Det kan tage fra få minutter op til 24 timer, før delegationen slår igennem.

### Trin 7: Konfigurer i OneUptime

I OneUptime skal du oprette eller redigere en SMTP-konfiguration med disse indstillinger:

| Felt | Værdi |
|-------|-------|
| Værtsnavn | `smtp.gmail.com` |
| Port | `587` |
| Brugernavn | Den Google Workspace-e-mailadresse der sendes fra (f.eks. `notifications@yourdomain.com`). Denne bruger vil blive repræsenteret af tjenestekontoen. |
| Autentificeringstype | `OAuth` |
| OAuth-udbydertype | `JWT Bearer` |
| Klient-ID | `client_email` fra din tjenestekonto-JSON (f.eks. `your-service@your-project.iam.gserviceaccount.com`) |
| Klienthemmelighed | `private_key` fra din tjenestekonto-JSON (hele nøglen inklusive `-----BEGIN PRIVATE KEY-----` og `-----END PRIVATE KEY-----`) |
| Token URL | `https://oauth2.googleapis.com/token` |
| Scope | `https://mail.google.com/` |
| Fra-e-mail | Samme som brugernavn |
| Sikker (TLS) | Aktiveret |

**Vigtigt:** Til Google (JWT Bearer) er klient-ID'et **tjenestekontoens e-mail** (`client_email`), IKKE det numeriske `client_id`. Tjenestekontoen vil repræsentere den bruger, der er angivet i brugernavnsfeltet, for at sende e-mails.

---

## Fejlfinding

### Microsoft 365

| Problem | Løsning |
|-------|----------|
| "Authentication unsuccessful" | Bekræft, at tjenesteprincipalen er registreret i Exchange og har postkassetilladelser |
| "AADSTS700016: Application not found" | Kontroller, at klient-ID'et er korrekt, og at appen findes i din lejer |
| "AADSTS7000215: Invalid client secret" | Regenerer klienthemmeligheden – den kan være udløbet |
| "The mailbox is not enabled for this operation" | Kør `Add-MailboxPermission` for at give adgang til postkassen |

### Google Workspace

| Problem | Løsning |
|-------|----------|
| "invalid_grant" | Sørg for, at domæneomfattende delegation er korrekt konfigureret og slået igennem |
| "unauthorized_client" | Bekræft, at klient-ID'et er autoriseret i Google Workspace Admin Console |
| "access_denied" | Kontroller, at scopet `https://mail.google.com/` er autoriseret |
| "Domain policy has disabled third-party Drive apps" | Aktiver API-adgang i Google Workspace Admin > Sikkerhed > API-kontroller |

### Generelt

- **Test din konfiguration**: Brug knappen "Send test-e-mail" i OneUptime for at bekræfte din opsætning
- **Kontroller logs**: Gennemgå OneUptime-logs for detaljerede fejlmeddelelser
- **Token-caching**: OneUptime cacher OAuth-tokens og opdaterer dem automatisk inden udløb

---

## Bedste sikkerhedspraksis

1. **Roter hemmeligheder regelmæssigt**: Sæt kalenderremindere til at rotere klienthemmeligheder inden de udløber
2. **Brug dedikerede tjenestekonti**: Opret separate legitimationsoplysninger til OneUptime frem for at dele med andre applikationer
3. **Princippet om mindste privilegium**: Giv kun de minimum nødvendige tilladelser (SMTP.SendAsApp til Microsoft, mail.google.com-scope til Google)
4. **Overvåg brugen**: Gennemgå e-maillogge og OAuth-applikationslogins for usædvanlig aktivitet
5. **Sikker opbevaring**: Commit aldrig klienthemmeligheder til versionskontrol

---

## Yderligere ressourcer

### Microsoft 365
- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
