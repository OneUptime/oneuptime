# SMTP

Skicka OneUptimes e-post via din egen e-postserver. Ett projekt lägger till SMTP-konfigurationer som projektets statussidor skickar sin e-post med, och en egenvärdad installation anger den server som OneUptime skickar allt annat från. Båda stöder tre sätt att logga in:

- **Användarnamn och lösenord**: klassisk SMTP-autentisering.
- **OAuth 2.0**: för Microsoft 365 och Google Workspace, där grundläggande autentisering ofta är avstängd.
- **Ingen**: för relä-servrar som inte kräver autentisering.

```mermaid title="Vilken e-postserver som skickar vad"
flowchart TB
    SP["E-post från en statussida"] --> Q{"Anpassad SMTP-konfiguration<br/>vald för sidan?"}
    Q -->|"Ja"| P["Projektets<br/>SMTP-konfiguration"]
    Q -->|"Nej"| D["OneUptimes egen<br/>e-postserver"]
    E["All annan e-post<br/>från OneUptime"] --> D
```

I en egenvärdad installation är OneUptimes egen e-postserver den som anges i Admin Dashboard. En statussida väljer sin SMTP-konfiguration på sin sida **Prenumerantinställningar**, i kortet **Anpassad SMTP**.

:::cards
- [Lägg till en e-postserver](#lägg-till-en-smtp-server): Två steg, allt annat hopfällt.
- [Microsoft 365](#konfiguration-för-microsoft-365): OAuth med en appregistrering i Entra.
- [Google Workspace](#konfiguration-för-google-workspace): OAuth med ett tjänstkonto.
- [Felsökning](#felsökning): Vanliga fel och vad de betyder.
:::

## Lägg till en SMTP-server

Lägg till ett projekts e-postserver under **Projektinställningar > Aviseringar > Aviseringsinställningar**, i kortet **Anpassade SMTP-konfigurationer**. I en egenvärdad installation anges servern som OneUptime själv skickar från under **Admin Dashboard > Inställningar > Notifieringar > E-post**, i kortet **Anpassade e-post- och SMTP-inställningar**. Båda formulären frågar efter samma saker, i två steg.

:::steps
### Öppna formuläret

:::tabs
@tab Projekt
Klicka under **Projektinställningar > Aviseringar > Aviseringsinställningar** på **Skapa SMTP Konfiguration** i kortet **Anpassade SMTP-konfigurationer**.
@tab Egenvärdad instans
Öppna **Inställningar** i Admin Dashboard och sedan **Notifieringar > E-post** i sidomenyn (**Notifieringar** är hopfällt från början). Klicka i kortet **E-post-serverinställningar** på **Redigera server** och sätt **Typ av e-postserver** till `Custom SMTP`. Klicka sedan på **Redigera SMTP-konfig** i kortet **Anpassade e-post- och SMTP-inställningar**, som visas nedanför.
:::

### Fyll i steget Server

I steget **Server** anger du **Namn** (bara projektkonfigurationer), **Värdnamn**, **Port** (en ny projektkonfiguration börjar på `587`), **Användarnamn** och **Lösenord**.

### Kontrollera Fler fält

Allt annat är hopfällt under **Fler fält** i slutet av steget **Server**. Medan det är hopfällt berättar rubriken hur e-post skickas, till exempel ”E-post skickas via SMTP, med inloggning med användarnamn och lösenord. TLS krävs.” Öppna det bara om du behöver ändra någon av inställningarna i tabellen nedan.

### Fyll i steget Avsändare

I steget **Avsändare** anger du **E-post från** och **Från-namn** som dina e-postmeddelanden kommer från. Din server måste tillåta att e-post skickas från den adressen.

### Spara och skicka ett test-e-postmeddelande

Spara konfigurationen. När en projektkonfiguration är sparad kontrollerar **Skicka test-e-post** på dess rad att den fungerar. Det kräver behörighet att lägga till SMTP-konfigurationer: **Project Owner**, **Project Admin**, eller **Create SMTP Config** och **Read SMTP Config** i en anpassad roll. På OneUptime Cloud krävs även planen **Growth**, precis som för att lägga till en konfiguration. För alla andra är knappen låst, och dess verktygstips berättar vad som krävs.

Testet frågar efter en **E-post**-adress att skicka till, från början din egen. Kontrollera att meddelandet kommer fram.
:::

Det här är inställningarna under **Fler fält**:

| Fält | Vad det gör |
| --- | --- |
| **Transport** | `SMTP` (standard), eller `Microsoft Graph` för en Microsoft 365-klientorganisation där SMTP AUTH är avstängt. När du väljer Microsoft Graph döljs värdnamn, port, användarnamn och lösenord, och OAuth-fälten visas. |
| **Kräv TLS** | På för en ny projektkonfiguration. E-post skickas bara över en krypterad anslutning med ett giltigt certifikat. När detta är av krypteras e-post bara om servern erbjuder det, och certifikatet kontrolleras inte. Port 465 är alltid krypterad. |
| **Autentiseringstyp** | `Username and Password` (standard), `OAuth`, eller `None` för ett relä som inte kräver inloggning. |
| **OAuth-fält** | **OAuth-leverantörstyp**, **OAuth Client ID**, **OAuth Client Secret**, **OAuth-token-URL** och **OAuth-omfattning**, som visas när OAuth eller Microsoft Graph är valt. |
| **Beskrivning** | En anteckning för ditt team (bara projektkonfigurationer). |

**Microsoft Graph.** Öppna **Fler fält**, sätt **Transport** till `Microsoft Graph` och fyll i en Azure-app som har programbehörigheten **Mail.Send**: dess klient-ID och klienthemlighet, token-URL:en `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` och omfattningen `https://graph.microsoft.com/.default`. E-post skickas från brevlådan för **E-post från**, som måste vara en licensierad brevlåda i din klientorganisation.

> [!NOTE]
> På OneUptime Cloud måste ett projekts e-postserver kunna nås via internet: en värd som slås upp till en privat eller intern adress avvisas. I en egenvärdad installation är privata adresser tillåtna, såvida inte `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` är `true`; loopback- och link-local-adresser avvisas alltid. Instansens egen e-postserver kontrolleras inte på det här sättet.

## OAuth 2.0-autentisering

Med OAuth 2.0 loggar OneUptime in på din e-postserver utan lösenord, vilket e-posttjänster för företag allt oftare kräver. OneUptime stöder två typer av OAuth-beviljanden:

- **Client Credentials**: används av Microsoft 365 och de flesta OAuth-leverantörer.
- **JWT Bearer**: används av tjänstkonton i Google Workspace.

```mermaid title="Så loggar OneUptime in med OAuth"
sequenceDiagram
    participant O as OneUptime
    participant T as Token-URL
    participant M as E-postserver
    O->>T: Begär en åtkomsttoken
    T-->>O: Åtkomsttoken
    Note over O: Cachas och förnyas<br/>innan den går ut
    O->>M: Loggar in med token
    O->>M: Skickar e-postmeddelandet
```

**Autentiseringstyp** och OAuth-fälten finns under **Fler fält** i formulärets steg Server. För att logga in med OAuth fyller du i:

| Fält | Beskrivning |
| --- | --- |
| **Värdnamn** | SMTP-serverns adress |
| **Port** | SMTP-port (oftast 587 för STARTTLS eller 465 för implicit TLS) |
| **Användarnamn** | E-postadressen för brevlådan som skickar |
| **Autentiseringstyp** | `OAuth` |
| **OAuth-leverantörstyp** | `Client Credentials` för Microsoft 365, eller `JWT Bearer` för Google Workspace |
| **OAuth Client ID** | Program-ID:t (klient-ID:t) från din OAuth-leverantör (hos Google: tjänstkontots e-post) |
| **OAuth Client Secret** | Klienthemligheten från din OAuth-leverantör (hos Google: den privata nyckeln) |
| **OAuth-token-URL** | Din leverantörs OAuth-tokenslutpunkt |
| **OAuth-omfattning** | Den OAuth-omfattning som ger SMTP-åtkomst |

OneUptime cachar OAuth-token och förnyar dem automatiskt innan de går ut.

## Konfiguration för Microsoft 365

För att använda OAuth med Microsoft 365 (Exchange Online) registrerar du ett program i Microsoft Entra, ger det behörighet att skicka e-post via SMTP och låter det använda brevlådan du skickar från.

:::steps
### Registrera ett program i Microsoft Entra

1. Logga in i [administrationscentret för Microsoft Entra](https://entra.microsoft.com).
2. Gå till **Identity** > **Applications** > **App registrations** och klicka på **New registration**.
3. Ange ett namn (till exempel ”OneUptime SMTP”), välj ”Accounts in this organizational directory only” och lämna **Redirect URI** tomt.
4. Klicka på **Register**.

På sidan **Overview** antecknar du **Application (client) ID** (ditt klient-ID) och **Directory (tenant) ID** (för token-URL:en).

### Skapa en klienthemlighet

1. Gå i din appregistrering till **Certificates & secrets** och klicka på **New client secret**.
2. Lägg till en beskrivning, välj en giltighetstid och klicka på **Add**.
3. **Kopiera hemlighetens värde direkt**: det visas inte igen.

### Lägg till SMTP-behörigheten

1. Gå till **API permissions** och klicka på **Add a permission**.
2. Välj **APIs my organization uses** och sök sedan efter och välj **Office 365 Exchange Online**.
3. Välj **Application permissions**, markera **SMTP.SendAsApp** och klicka på **Add permissions**.
4. Klicka på **Grant admin consent for [your organization]** (det kräver administratörsbehörighet).

### Registrera tjänstens huvudnamn i Exchange Online

Innan programmet kan skicka e-post registrerar du dess tjänsthuvudnamn i Exchange Online och ger det åtkomst till brevlådan du skickar från:

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
> Använd `Add-MailboxPermission`, inte `Add-RecipientPermission`. `Add-RecipientPermission` ger bara `SendAs` på mottagaren, vilket inte räcker för att tjänsthuvudnamnet ska kunna skicka e-post via SMTP med OAuth: sändningen misslyckas med ett autentiserings- eller behörighetsfel.

### Skapa SMTP-konfigurationen i OneUptime

Skapa eller redigera en SMTP-konfiguration med de här inställningarna och ersätt `<tenant-id>` med ditt **Directory (tenant) ID**:

| Fält | Värde |
| --- | --- |
| Värdnamn | `smtp.office365.com` |
| Port | `587` |
| Användarnamn | E-postadressen som du gav behörigheterna (t.ex. `sender@yourdomain.com`) |
| Autentiseringstyp | `OAuth` |
| OAuth-leverantörstyp | `Client Credentials` |
| OAuth Client ID | Ditt **Application (client) ID** |
| OAuth Client Secret | Klienthemlighetens värde |
| OAuth-token-URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth-omfattning | `https://outlook.office365.com/.default` |
| E-post från | Samma som användarnamnet |
| Kräv TLS | På |

Kontrollera den sedan med **Skicka test-e-post**.
:::

## Konfiguration för Google Workspace

Google Workspace behöver ett **tjänstkonto** med domänomfattande delegering, som skickar e-post för en användare i din domän. Googles SMTP-servrar stöder inte ett enkelt client credentials-flöde för Gmail.

### Innan du börjar med Google Workspace

- Ett Google Workspace-konto. Privata Gmail-konton stöder inte detta.
- Superadministratörsåtkomst till administratörskonsolen för Google Workspace.
- Åtkomst till Google Cloud Console.

:::steps
### Skapa ett Google Cloud-projekt

1. Gå till [Google Cloud Console](https://console.cloud.google.com).
2. Klicka på projektväljaren och välj **New Project**.
3. Ange ett projektnamn, klicka på **Create** och välj ditt nya projekt.

### Aktivera Gmail API

1. Gå till **APIs & Services** > **Library**.
2. Sök efter ”Gmail API”, klicka på **Gmail API** och sedan på **Enable**.

### Skapa ett tjänstkonto

1. Gå till **APIs & Services** > **Credentials**.
2. Klicka på **Create Credentials** > **Service account**.
3. Ange ett namn och en beskrivning, klicka på **Create and Continue**, hoppa över de valfria stegen och klicka på **Done**.

### Skapa en nyckel för tjänstkontot

1. Klicka på tjänstkontot du just skapade och gå till fliken **Keys**.
2. Klicka på **Add Key** > **Create new key**, välj **JSON** och klicka på **Create**.
3. Förvara den nedladdade JSON-filen säkert. Dess `client_email` är ditt OAuth-klient-ID och dess `private_key` din OAuth-klienthemlighet.

### Aktivera domänomfattande delegering

1. Klicka på **Show Advanced Settings** i tjänstkontots detaljer.
2. Anteckna det numeriska **Client ID**.
3. Markera **Enable Google Workspace Domain-wide Delegation** och klicka på **Save**.

### Auktorisera tjänstkontot i administrationen för Google Workspace

1. Logga in i [administratörskonsolen för Google Workspace](https://admin.google.com).
2. Gå till **Security** > **Access and data control** > **API Controls** och klicka på **Manage Domain Wide Delegation**.
3. Klicka på **Add new**, ange det numeriska **Client ID** från föregående steg och skriv `https://mail.google.com/` under **OAuth Scopes**.
4. Klicka på **Authorize**.

Det kan ta från några minuter upp till 24 timmar innan delegeringen börjar gälla.

### Skapa SMTP-konfigurationen för Google Workspace

Skapa eller redigera en SMTP-konfiguration med de här inställningarna:

| Fält | Värde |
| --- | --- |
| Värdnamn | `smtp.gmail.com` |
| Port | `587` |
| Användarnamn | Google Workspace-e-postadressen som det ska skickas från (t.ex. `notifications@yourdomain.com`). Tjänstkontot agerar för den här användaren. |
| Autentiseringstyp | `OAuth` |
| OAuth-leverantörstyp | `JWT Bearer` |
| OAuth Client ID | `client_email` från tjänstkontots JSON (t.ex. `your-service@your-project.iam.gserviceaccount.com`) |
| OAuth Client Secret | `private_key` från tjänstkontots JSON (hela nyckeln, inklusive `-----BEGIN PRIVATE KEY-----` och `-----END PRIVATE KEY-----`) |
| OAuth-token-URL | `https://oauth2.googleapis.com/token` |
| OAuth-omfattning | `https://mail.google.com/` |
| E-post från | Samma som användarnamnet |
| Kräv TLS | På |

Kontrollera den sedan med **Skicka test-e-post**.
:::

> [!IMPORTANT]
> Hos Google (JWT Bearer) är **OAuth Client ID** **tjänstkontots e-post** (`client_email`), inte det numeriska `client_id`. Tjänstkontot agerar för användaren i **Användarnamn** för att skicka e-post.

## Felsökning

### Fel i Microsoft 365

| Problem | Lösning |
| --- | --- |
| "Authentication unsuccessful" | Kontrollera att tjänsthuvudnamnet är registrerat i Exchange och har behörighet till brevlådan |
| "AADSTS700016: Application not found" | Kontrollera att klient-ID:t är rätt och att appen finns i din klientorganisation |
| "AADSTS7000215: Invalid client secret" | Skapa en ny klienthemlighet: den gamla kan ha gått ut |
| "The mailbox is not enabled for this operation" | Kör `Add-MailboxPermission` för att ge åtkomst till brevlådan |

### Fel i Google Workspace

| Problem | Lösning |
| --- | --- |
| "invalid_grant" | Se till att den domänomfattande delegeringen är rätt konfigurerad och har börjat gälla |
| "unauthorized_client" | Kontrollera att klient-ID:t är auktoriserat i administratörskonsolen för Google Workspace |
| "access_denied" | Kontrollera att omfattningen `https://mail.google.com/` är auktoriserad |
| "Domain policy has disabled third-party Drive apps" | Aktivera API-åtkomst i administrationen för Google Workspace, under Security > API Controls |

### Andra problem

:::details "Cannot send email. Please check your SMTP config."
**Skicka test-e-post** säger detta när en server som man loggar in på med användarnamn och lösenord, eller inte loggar in på alls, inte tar emot e-postmeddelandet. Kontrollera **Värdnamn**, **Port**, **Användarnamn** och **Lösenord**. Om din server inte erbjuder TLS, eller om dess certifikat inte är giltigt för dess värdnamn, stänger du av **Kräv TLS** under **Fler fält** och försöker igen. Serverns eget svar sparas tillsammans med testet: öppna fliken **E-post** under **Projektinställningar > Aviseringar > Aviseringsloggar** och välj **Visa statusmeddelande** på dess rad.
:::

:::details "Cannot send email with OAuth authentication"
Inloggningen med OAuth misslyckades, och meddelandet slutar med felet som din leverantör returnerade. Kontrollera **OAuth Client ID**, **OAuth Client Secret**, **OAuth-token-URL** och **OAuth-omfattning**, att programmet har behörigheterna ovan och att administratörsmedgivande har getts. Om din Microsoft 365-klientorganisation har SMTP AUTH avstängt sätter du i stället **Transport** till `Microsoft Graph`.
:::

:::details "Microsoft Graph send failed"
En konfiguration vars **Transport** är `Microsoft Graph` säger detta när Graph inte tar emot e-postmeddelandet, följt av Microsofts eget fel. Kontrollera att appen har programbehörigheten **Mail.Send** med administratörsmedgivande givet, att **OAuth-omfattning** är `https://graph.microsoft.com/.default` och att **E-post från** är en licensierad brevlåda i din klientorganisation.
:::

:::details "SMTP server host … could not be reached"
OneUptime vägrade ansluta till projektets e-postserver. På OneUptime Cloud avvisas ett värdnamn som inte kan slås upp, eller som slås upp till en privat adress, loopback- eller link-local-adress, med det här meddelandet, som aldrig säger vilket av fallen det är: använd e-postserverns offentliga värdnamn. I en egenvärdad installation, och för en e-postserver som anges som IP-adress, säger meddelandet i stället varför. **Skicka test-e-post** visar det bara för en OAuth-konfiguration; för de andra hittar du det under **Visa statusmeddelande** på fliken **E-post** i aviseringsloggarna.
:::

:::details Test-e-postmeddelandet kommer inte fram
Kontrollera **E-post från**: din server måste tillåta att e-post skickas från den. Titta sedan i mottagarens skräppostmapp och i din e-postservers loggar efter försöket.
:::

## God säkerhetspraxis

- **Byt hemligheter regelbundet.** Skapa påminnelser om att ersätta klienthemligheter innan de går ut.
- **Använd egna inloggningsuppgifter.** Skapa separata inloggningsuppgifter för OneUptime i stället för att dela dem med andra program.
- **Ge minsta möjliga behörighet.** Ge bara det som sändning kräver: **SMTP.SendAsApp** hos Microsoft, omfattningen `https://mail.google.com/` hos Google.
- **Övervaka användningen.** Granska e-postloggar och OAuth-programmens inloggningar efter ovanlig aktivitet.
- **Förvara hemligheter säkert.** Lägg aldrig in klienthemligheter i versionshantering.

## Vidare läsning

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Nästa steg

:::cards
- [Aviseringssammanfattning](/docs/emails/notification-rollup): Hur OneUptime samlar vågor av e-post till ägare.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers): Skicka e-post till en statussidas prenumeranter via en SMTP-konfiguration i projektet.
:::
