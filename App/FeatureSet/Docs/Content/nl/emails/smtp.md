# SMTP-configuratie

OneUptime ondersteunt het verzenden van e-mails via aangepaste SMTP-servers met drie authenticatiemethoden:

- **Gebruikersnaam en wachtwoord** - Traditionele SMTP-authenticatie
- **OAuth 2.0** - Moderne authenticatie voor Microsoft 365 en Google Workspace
- **Geen** - Voor relayservers waarvoor geen authenticatie vereist is

Deze handleiding behandelt de configuratie van OAuth 2.0-authenticatie voor Microsoft 365 en Google Workspace.

## OAuth 2.0-authenticatie

OAuth 2.0 biedt een veiligere manier om te authenticeren bij e-mailservers, met name voor enterprise-omgevingen die basisauthenticatie hebben uitgeschakeld. OneUptime ondersteunt twee OAuth-verlening typen:

- **Client Credentials** - Gebruikt door Microsoft 365 en de meeste OAuth-providers
- **JWT Bearer** - Gebruikt door Google Workspace-serviceaccounts

### Vereiste velden voor OAuth

Bij het configureren van SMTP met OAuth-authenticatie in OneUptime heeft u het volgende nodig:

| Veld | Beschrijving |
|-------|-------------|
| **Hostnaam** | SMTP-serveradres |
| **Poort** | SMTP-poort (meestal 587 voor STARTTLS of 465 voor impliciete TLS) |
| **Gebruikersnaam** | Het e-mailadres om van te verzenden |
| **Authenticatietype** | Selecteer "OAuth" |
| **OAuth Provider Type** | Selecteer "Client Credentials" voor Microsoft 365, of "JWT Bearer" voor Google Workspace |
| **Client ID** | Applicatie/Client ID van uw OAuth-provider (voor Google: e-mailadres van serviceaccount) |
| **Client Secret** | Clientgeheim van uw OAuth-provider (voor Google: privésleutel) |
| **Token URL** | OAuth token-eindpunt-URL |
| **Bereik** | Vereiste OAuth-bereik(en) voor SMTP-toegang |

---

## Microsoft 365-configuratie

Om OAuth te gebruiken met Microsoft 365/Exchange Online, moet u een applicatie registreren in Microsoft Entra (Azure AD) en de juiste machtigingen configureren.

### Stap 1: Een applicatie registreren in Microsoft Entra

1. Meld u aan bij het [Microsoft Entra-beheercentrum](https://entra.microsoft.com)
2. Navigeer naar **Identiteit** > **Applicaties** > **App-registraties**
3. Klik op **Nieuwe registratie**
4. Voer een naam in voor uw applicatie (bijv. "OneUptime SMTP")
5. Selecteer bij **Ondersteunde accounttypen** de optie "Accounts alleen in deze organisatiemap"
6. Laat **Omleidings-URI** leeg (niet nodig voor de client credentials-stroom)
7. Klik op **Registreren**

Noteer na de registratie de volgende waarden op de **Overzichtspagina**:
- **Applicatie (client) ID** - Dit is uw Client ID
- **Map (tenant) ID** - U heeft dit nodig voor de Token URL

### Stap 2: Een clientgeheim aanmaken

1. Ga in uw app-registratie naar **Certificaten en geheimen**
2. Klik op **Nieuw clientgeheim**
3. Voeg een beschrijving toe en selecteer een vervalperiode
4. Klik op **Toevoegen**
5. **Kopieer de geheimwaarde onmiddellijk** - deze wordt niet opnieuw getoond

### Stap 3: SMTP API-machtigingen toevoegen

1. Ga naar **API-machtigingen**
2. Klik op **Een machtiging toevoegen**
3. Selecteer **API's die mijn organisatie gebruikt**
4. Zoek naar **Office 365 Exchange Online** en selecteer dit
5. Selecteer **Applicatiemachtigingen**
6. Zoek en vink **SMTP.SendAsApp** aan
7. Klik op **Machtigingen toevoegen**
8. Klik op **Beheerdersmachtiging verlenen voor [uw organisatie]** (vereist beheerdersrechten)

### Stap 4: Serviceprincipal registreren in Exchange Online

Voordat uw applicatie e-mails kan verzenden, moet u de serviceprincipal registreren in Exchange Online en postvakrechten verlenen.

1. Installeer de Exchange Online PowerShell-module:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Verbinding maken met Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Registreer de serviceprincipal (gebruik het Object-ID van **Enterprise-toepassingen**, niet App-registraties):

```powershell
# Zoek het Object-ID in Microsoft Entra > Enterprise-toepassingen > Uw app > Object-ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Verleen de serviceprincipal toestemming om te verzenden als een specifiek postvak:

```powershell
# Volledige postvaktoegang verlenen aan de serviceprincipal
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Opmerking:** Gebruik `Add-MailboxPermission` (niet `Add-RecipientPermission`). `Add-RecipientPermission` verleent alleen `SendAs` op de ontvanger en is niet voldoende voor de serviceprincipal om mail te verzenden via SMTP met OAuth — u krijgt dan een authenticatie-/machtigingsfout bij verzending. `Add-MailboxPermission` met `FullAccess` is de opdracht die daadwerkelijk werkt.

### Stap 5: Configureren in OneUptime

Maak of bewerk in OneUptime een SMTP-configuratie met deze instellingen:

| Veld | Waarde |
|-------|-------|
| Hostnaam | `smtp.office365.com` |
| Poort | `587` |
| Gebruikersnaam | Het e-mailadres waarvoor u machtigingen heeft verleend (bijv. `sender@yourdomain.com`) |
| Authenticatietype | `OAuth` |
| OAuth Provider Type | `Client Credentials` |
| Client ID | Uw Applicatie (client) ID uit stap 1 |
| Client Secret | De geheimwaarde uit stap 2 |
| Token URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Bereik | `https://outlook.office365.com/.default` |
| Van e-mail | Gelijk aan gebruikersnaam |
| Beveiligd (TLS) | Ingeschakeld |

Vervang `<tenant-id>` door uw Map (tenant) ID uit stap 1.

---

## Google Workspace-configuratie

Google Workspace vereist een **serviceaccount** met domeinbrede delegatie om e-mails te verzenden namens gebruikers. Dit is noodzakelijk omdat de SMTP-servers van Google geen directe OAuth client credentials-stroom ondersteunen voor Gmail.

### Vereisten

- Google Workspace-account (geen regulier Gmail - consument-Gmail-accounts ondersteunen dit niet)
- Super Admin-toegang tot de Google Workspace-beheerconsole
- Toegang tot de Google Cloud Console

### Stap 1: Een Google Cloud-project aanmaken

1. Ga naar de [Google Cloud Console](https://console.cloud.google.com)
2. Klik op de projectvervolgkeuzelijst en selecteer **Nieuw project**
3. Voer een projectnaam in en klik op **Maken**
4. Selecteer uw nieuwe project

### Stap 2: De Gmail API inschakelen

1. Ga naar **API's en services** > **Bibliotheek**
2. Zoek naar "Gmail API"
3. Klik op **Gmail API** en vervolgens op **Inschakelen**

### Stap 3: Een serviceaccount aanmaken

1. Ga naar **API's en services** > **Referenties**
2. Klik op **Referenties maken** > **Serviceaccount**
3. Voer een naam en beschrijving in voor het serviceaccount
4. Klik op **Maken en doorgaan**
5. Sla de optionele stappen over en klik op **Gereed**

### Stap 4: Serviceaccountsleutels aanmaken

1. Klik op het serviceaccount dat u zojuist hebt aangemaakt
2. Ga naar het tabblad **Sleutels**
3. Klik op **Sleutel toevoegen** > **Nieuwe sleutel aanmaken**
4. Selecteer **JSON** en klik op **Maken**
5. Sla het gedownloade JSON-bestand veilig op - het bevat:
   - `client_id` - Uw Client ID
   - `private_key` - Uw clientgeheim (de privésleutel)

### Stap 5: Domeinbrede delegatie inschakelen

1. Klik in de serviceaccountdetails op **Geavanceerde instellingen weergeven**
2. Noteer het **Client ID** (numeriek ID)
3. Vink **Domeinbrede delegatie voor Google Workspace inschakelen** aan
4. Klik op **Opslaan**

### Stap 6: Het serviceaccount autoriseren in de Google Workspace-beheerconsole

1. Meld u aan bij de [Google Workspace-beheerconsole](https://admin.google.com)
2. Ga naar **Beveiliging** > **Toegang en gegevensbeheer** > **API-besturingselementen**
3. Klik op **Domeinbrede delegatie beheren**
4. Klik op **Nieuw toevoegen**
5. Voer het **Client ID** uit stap 5 in
6. Voer voor **OAuth-bereiken** in: `https://mail.google.com/`
7. Klik op **Autoriseren**

Opmerking: Het kan enkele minuten tot 24 uur duren voordat de delegatie wordt doorgevoerd.

### Stap 7: Configureren in OneUptime

Maak of bewerk in OneUptime een SMTP-configuratie met deze instellingen:

| Veld | Waarde |
|-------|-------|
| Hostnaam | `smtp.gmail.com` |
| Poort | `587` |
| Gebruikersnaam | Het Google Workspace-e-mailadres om van te verzenden (bijv. `notifications@yourdomain.com`). Deze gebruiker wordt nagebootst door het serviceaccount. |
| Authenticatietype | `OAuth` |
| OAuth Provider Type | `JWT Bearer` |
| Client ID | Het `client_email` uit uw serviceaccount-JSON (bijv. `your-service@your-project.iam.gserviceaccount.com`) |
| Client Secret | De `private_key` uit uw serviceaccount-JSON (de volledige sleutel inclusief `-----BEGIN PRIVATE KEY-----` en `-----END PRIVATE KEY-----`) |
| Token URL | `https://oauth2.googleapis.com/token` |
| Bereik | `https://mail.google.com/` |
| Van e-mail | Gelijk aan gebruikersnaam |
| Beveiligd (TLS) | Ingeschakeld |

**Belangrijk:** Voor Google (JWT Bearer) is de Client ID het **e-mailadres van het serviceaccount** (`client_email`), NIET het numerieke `client_id`. Het serviceaccount zal de gebruiker nabootsen die is opgegeven in het veld Gebruikersnaam om e-mails te verzenden.

---

## Probleemoplossing

### Microsoft 365

| Probleem | Oplossing |
|-------|----------|
| "Authentication unsuccessful" | Controleer of de serviceprincipal is geregistreerd in Exchange en postvakrechten heeft |
| "AADSTS700016: Application not found" | Controleer of het Client ID correct is en de app bestaat in uw tenant |
| "AADSTS7000215: Invalid client secret" | Genereer het clientgeheim opnieuw - het kan zijn verlopen |
| "The mailbox is not enabled for this operation" | Voer `Add-MailboxPermission` uit om toegang tot het postvak te verlenen |

### Google Workspace

| Probleem | Oplossing |
|-------|----------|
| "invalid_grant" | Zorg dat domeinbrede delegatie correct is geconfigureerd en doorgevoerd |
| "unauthorized_client" | Controleer of het Client ID is geautoriseerd in de Google Workspace-beheerconsole |
| "access_denied" | Controleer of het bereik `https://mail.google.com/` is geautoriseerd |
| "Domain policy has disabled third-party Drive apps" | Schakel API-toegang in via Google Workspace Admin > Beveiliging > API-besturingselementen |

### Algemeen

- **Test uw configuratie**: Gebruik de knop "Test-e-mail verzenden" in OneUptime om uw instelling te verifiëren
- **Logboeken controleren**: Bekijk OneUptime-logboeken voor gedetailleerde foutmeldingen
- **Token-caching**: OneUptime cachet OAuth-tokens en vernieuwt ze automatisch voor het verlopen

---

## Best practices voor beveiliging

1. **Roteer geheimen regelmatig**: Stel kalenderherinneringen in om clientgeheimen te roteren voordat ze verlopen
2. **Gebruik speciale serviceaccounts**: Maak aparte referenties aan voor OneUptime in plaats van te delen met andere applicaties
3. **Principe van minimale bevoegdheden**: Verleen alleen de minimaal benodigde machtigingen (SMTP.SendAsApp voor Microsoft, mail.google.com-bereik voor Google)
4. **Gebruik controleren**: Bekijk e-maillogboeken en OAuth-applicatieaanmeldingen op ongebruikelijke activiteit
5. **Veilige opslag**: Sla clientgeheimen nooit op in versiebeheer

---

## Aanvullende bronnen

### Microsoft 365
- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
