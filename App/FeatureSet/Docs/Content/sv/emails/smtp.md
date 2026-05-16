# SMTP-konfiguration

OneUptime stöder e-postsändning via anpassade SMTP-servrar med tre autentiseringsmetoder:

- **Användarnamn och lösenord** – Traditionell SMTP-autentisering
- **OAuth 2.0** – Modern autentisering för Microsoft 365 och Google Workspace
- **Ingen** – För reläservrar som inte kräver autentisering

Den här guiden beskriver hur du konfigurerar OAuth 2.0-autentisering för Microsoft 365 och Google Workspace.

## OAuth 2.0-autentisering

OAuth 2.0 ger ett säkrare sätt att autentisera mot e-postservrar, särskilt för företagsmiljöer som har inaktiverat grundläggande autentisering. OneUptime stöder två OAuth-bidragstyper:

- **Client Credentials** – Används av Microsoft 365 och de flesta OAuth-leverantörer
- **JWT Bearer** – Används av Google Workspace-tjänstkonton

### Obligatoriska fält för OAuth

När du konfigurerar SMTP med OAuth-autentisering i OneUptime behöver du:

| Fält | Beskrivning |
|------|-------------|
| **Värdnamn** | SMTP-serveradress |
| **Port** | SMTP-port (vanligtvis 587 för STARTTLS eller 465 för implicit TLS) |
| **Användarnamn** | E-postadressen att skicka från |
| **Autentiseringstyp** | Välj "OAuth" |
| **OAuth-leverantörstyp** | Välj "Client Credentials" för Microsoft 365 eller "JWT Bearer" för Google Workspace |
| **Klient-ID** | Program/Klient-ID från din OAuth-leverantör (för Google: tjänstkontots e-post) |
| **Klienthemlighet** | Klienthemligheten från din OAuth-leverantör (för Google: privat nyckel) |
| **Token-URL** | OAuth-tokens slutpunkts-URL |
| **Scope** | Obligatoriska OAuth-scope(n) för SMTP-åtkomst |

---

## Microsoft 365-konfiguration

För att använda OAuth med Microsoft 365/Exchange Online behöver du registrera ett program i Microsoft Entra (Azure AD) och konfigurera lämpliga behörigheter.

### Steg 1: Registrera ett program i Microsoft Entra

1. Logga in på [Microsoft Entra-administrationscentret](https://entra.microsoft.com)
2. Navigera till **Identitet** > **Program** > **Appregistreringar**
3. Klicka på **Ny registrering**
4. Ange ett namn för ditt program (t.ex. "OneUptime SMTP")
5. För **Kontotyper som stöds** väljer du "Konton enbart i den här organisationskatalogen"
6. Lämna **Omdirigerings-URI** tom (behövs inte för client credentials-flödet)
7. Klicka på **Registrera**

Efter registreringen noterar du följande värden från **Översikt**-sidan:
- **Program (klient)-ID** – Detta är ditt Klient-ID
- **Katalog (klient)-ID** – Du behöver detta för Token-URL:en

### Steg 2: Skapa en klienthemlighet

1. I din appregistrering, gå till **Certifikat och hemligheter**
2. Klicka på **Ny klienthemlighet**
3. Lägg till en beskrivning och välj en utgångsperiod
4. Klicka på **Lägg till**
5. **Kopiera hemlighetsvärdet omedelbart** – det visas inte igen

### Steg 3: Lägg till SMTP API-behörigheter

1. Gå till **API-behörigheter**
2. Klicka på **Lägg till en behörighet**
3. Välj **API:er som min organisation använder**
4. Sök efter och välj **Office 365 Exchange Online**
5. Välj **Programbehörigheter**
6. Hitta och markera **SMTP.SendAsApp**
7. Klicka på **Lägg till behörigheter**
8. Klicka på **Bevilja administratörsmedgivande för [din organisation]** (kräver administratörsbehörighet)

### Steg 4: Registrera tjänstens huvudnamn i Exchange Online

Innan ditt program kan skicka e-post måste du registrera tjänstens huvudnamn i Exchange Online och bevilja postlådebehörigheter.

1. Installera Exchange Online PowerShell-modulen:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Anslut till Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Registrera tjänstens huvudnamn (använd Objekt-ID från **Enterprise-program**, inte Appregistreringar):

```powershell
# Hitta Objekt-ID i Microsoft Entra > Enterprise-program > Din app > Objekt-ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Bevilja tjänstens huvudnamn behörighet att skicka som en specifik postlåda:

```powershell
# Bevilja full postlådeåtkomst till tjänstens huvudnamn
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Observera:** Använd `Add-MailboxPermission` (inte `Add-RecipientPermission`). `Add-RecipientPermission` beviljar bara `SendAs` på mottagaren och räcker inte för att tjänstens huvudnamn ska kunna skicka e-post via SMTP med OAuth – du får ett autentiserings-/behörighetsfel vid sändning. `Add-MailboxPermission` med `FullAccess` är kommandot som faktiskt fungerar.

### Steg 5: Konfigurera i OneUptime

I OneUptime, skapa eller redigera en SMTP-konfiguration med dessa inställningar:

| Fält | Värde |
|------|-------|
| Värdnamn | `smtp.office365.com` |
| Port | `587` |
| Användarnamn | E-postadressen du beviljade behörigheter till (t.ex. `sender@yourdomain.com`) |
| Autentiseringstyp | `OAuth` |
| OAuth-leverantörstyp | `Client Credentials` |
| Klient-ID | Ditt Program (klient)-ID från Steg 1 |
| Klienthemlighet | Hemlighetsvärdet från Steg 2 |
| Token-URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope | `https://outlook.office365.com/.default` |
| Från e-post | Samma som Användarnamn |
| Säker (TLS) | Aktiverad |

Ersätt `<tenant-id>` med ditt Katalog (klient)-ID från Steg 1.

---

## Google Workspace-konfiguration

Google Workspace kräver ett **tjänstkonto** med domänövergripande delegering för att skicka e-post för användares räkning. Detta är nödvändigt eftersom Googles SMTP-servrar inte stöder direkt OAuth client credentials-flöde för Gmail.

### Förutsättningar

- Google Workspace-konto (inte vanlig Gmail – konsument-Gmail-konton stöder inte detta)
- Super Admin-åtkomst till Google Workspace Admin-konsolen
- Åtkomst till Google Cloud-konsolen

### Steg 1: Skapa ett Google Cloud-projekt

1. Gå till [Google Cloud-konsolen](https://console.cloud.google.com)
2. Klicka på projektrullgardinsmenyn och välj **Nytt projekt**
3. Ange ett projektnamn och klicka på **Skapa**
4. Välj ditt nya projekt

### Steg 2: Aktivera Gmail API

1. Gå till **API:er och tjänster** > **Bibliotek**
2. Sök efter "Gmail API"
3. Klicka på **Gmail API** och sedan **Aktivera**

### Steg 3: Skapa ett tjänstkonto

1. Gå till **API:er och tjänster** > **Autentiseringsuppgifter**
2. Klicka på **Skapa autentiseringsuppgifter** > **Tjänstkonto**
3. Ange ett namn och en beskrivning för tjänstkontot
4. Klicka på **Skapa och fortsätt**
5. Hoppa över de valfria stegen och klicka på **Klar**

### Steg 4: Skapa nycklar för tjänstkonto

1. Klicka på tjänstkontot du just skapade
2. Gå till fliken **Nycklar**
3. Klicka på **Lägg till nyckel** > **Skapa ny nyckel**
4. Välj **JSON** och klicka på **Skapa**
5. Spara den nedladdade JSON-filen på ett säkert ställe – den innehåller:
   - `client_id` – Ditt Klient-ID
   - `private_key` – Din Klienthemlighet (den privata nyckeln)

### Steg 5: Aktivera domänövergripande delegering

1. I tjänstkontots detaljer, klicka på **Visa avancerade inställningar**
2. Notera **Klient-ID** (numeriskt ID)
3. Markera **Aktivera domänövergripande delegering för Google Workspace**
4. Klicka på **Spara**

### Steg 6: Auktorisera tjänstkontot i Google Workspace Admin

1. Logga in på [Google Workspace Admin-konsolen](https://admin.google.com)
2. Gå till **Säkerhet** > **Åtkomst och datakontroll** > **API-kontroller**
3. Klicka på **Hantera domänövergripande delegering**
4. Klicka på **Lägg till ny**
5. Ange **Klient-ID** från Steg 5
6. För **OAuth-scope**, ange: `https://mail.google.com/`
7. Klicka på **Auktorisera**

Observera: Det kan ta från några minuter upp till 24 timmar för delegeringen att spridas.

### Steg 7: Konfigurera i OneUptime

I OneUptime, skapa eller redigera en SMTP-konfiguration med dessa inställningar:

| Fält | Värde |
|------|-------|
| Värdnamn | `smtp.gmail.com` |
| Port | `587` |
| Användarnamn | Google Workspace e-postadressen att skicka från (t.ex. `notifications@yourdomain.com`). Den här användaren personifieras av tjänstkontot. |
| Autentiseringstyp | `OAuth` |
| OAuth-leverantörstyp | `JWT Bearer` |
| Klient-ID | `client_email` från ditt tjänstkontots JSON (t.ex. `your-service@your-project.iam.gserviceaccount.com`) |
| Klienthemlighet | `private_key` från ditt tjänstkontots JSON (hela nyckeln inklusive `-----BEGIN PRIVATE KEY-----` och `-----END PRIVATE KEY-----`) |
| Token-URL | `https://oauth2.googleapis.com/token` |
| Scope | `https://mail.google.com/` |
| Från e-post | Samma som Användarnamn |
| Säker (TLS) | Aktiverad |

**Viktigt:** För Google (JWT Bearer) är Klient-ID **tjänstkontots e-post** (`client_email`), INTE det numeriska `client_id`. Tjänstkontot personifierar den användare som anges i fältet Användarnamn för att skicka e-post.

---

## Felsökning

### Microsoft 365

| Problem | Lösning |
|---------|---------|
| "Authentication unsuccessful" | Verifiera att tjänstens huvudnamn är registrerat i Exchange och har postlådebehörigheter |
| "AADSTS700016: Application not found" | Kontrollera att Klient-ID:t är korrekt och att appen finns i din klient |
| "AADSTS7000215: Invalid client secret" | Återgenerera klienthemligheten – den kan ha löpt ut |
| "The mailbox is not enabled for this operation" | Kör `Add-MailboxPermission` för att bevilja åtkomst till postlådan |

### Google Workspace

| Problem | Lösning |
|---------|---------|
| "invalid_grant" | Se till att domänövergripande delegering är korrekt konfigurerad och propagerad |
| "unauthorized_client" | Verifiera att Klient-ID:t är auktoriserat i Google Workspace Admin-konsolen |
| "access_denied" | Kontrollera att scope `https://mail.google.com/` är auktoriserat |
| "Domain policy has disabled third-party Drive apps" | Aktivera API-åtkomst i Google Workspace Admin > Säkerhet > API-kontroller |

### Allmänt

- **Testa din konfiguration**: Använd knappen "Skicka testmail" i OneUptime för att verifiera din konfiguration
- **Kontrollera loggar**: Granska OneUptime-loggar för detaljerade felmeddelanden
- **Token-caching**: OneUptime cachar OAuth-token och uppdaterar dem automatiskt innan de löper ut

---

## Säkerhetsbästa praxis

1. **Rotera hemligheter regelbundet**: Sätt kalenderpåminnelser för att rotera klienthemligheter innan de löper ut
2. **Använd dedikerade tjänstkonton**: Skapa separata autentiseringsuppgifter för OneUptime istället för att dela med andra applikationer
3. **Principen om minsta privilegium**: Bevilja bara de minimibehörigheter som behövs (SMTP.SendAsApp för Microsoft, mail.google.com-scope för Google)
4. **Övervaka användning**: Granska e-postloggar och OAuth-programinloggningar för ovanlig aktivitet
5. **Säker lagring**: Spara aldrig klienthemligheter i versionskontroll

---

## Ytterligare resurser

### Microsoft 365
- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
