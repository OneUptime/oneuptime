# SMTP

Verstuur de e-mail van OneUptime via uw eigen mailserver. Een project voegt SMTP-configuraties toe waarmee de statuspagina's van dat project hun e-mail versturen, en een zelf gehoste installatie stelt de server in via welke OneUptime al het andere verstuurt. Beide ondersteunen drie manieren van aanmelden:

- **Gebruikersnaam en wachtwoord**: de klassieke SMTP-authenticatie.
- **OAuth 2.0**: voor Microsoft 365 en Google Workspace, waar basisauthenticatie vaak is uitgeschakeld.
- **Geen**: voor relayservers die geen authenticatie vereisen.

```mermaid title="Welke mailserver wat verstuurt"
flowchart TB
    SP["E-mail van een statuspagina"] --> Q{"Aangepaste SMTP-configuratie<br/>gekozen voor de pagina?"}
    Q -->|"Ja"| P["De SMTP-configuratie<br/>van het project"]
    Q -->|"Nee"| D["De eigen mailserver<br/>van OneUptime"]
    E["Alle andere e-mail<br/>van OneUptime"] --> D
```

Bij een zelf gehoste installatie is de eigen mailserver van OneUptime de server die in het Admin Dashboard is ingesteld. Een statuspagina kiest haar SMTP-configuratie op haar pagina **Abonneeinstellingen**, in de kaart **Aangepaste SMTP**.

:::cards
- [Een mailserver toevoegen](#een-smtp-server-toevoegen): Twee stappen, met al het andere ingeklapt.
- [Microsoft 365](#configuratie-voor-microsoft-365): OAuth met een app-registratie in Entra.
- [Google Workspace](#configuratie-voor-google-workspace): OAuth met een serviceaccount.
- [Problemen oplossen](#problemen-oplossen): Veelvoorkomende fouten en wat ze betekenen.
:::

## Een SMTP-server toevoegen

Voeg de mailserver van een project toe via **Projectinstellingen > Meldingen > Meldingsinstellingen**, in de kaart **Aangepaste SMTP-configuraties**. Bij een zelf gehoste installatie stelt u de server via welke OneUptime zelf verstuurt in via **Admin Dashboard > Instellingen > Meldingen > E-mails**, in de kaart **Aangepaste e-mail- en SMTP-instellingen**. Beide formulieren vragen hetzelfde, in twee stappen.

:::steps
### Het formulier openen

:::tabs
@tab Project
Klik via **Projectinstellingen > Meldingen > Meldingsinstellingen** op **SMTP Configuratie aanmaken** in de kaart **Aangepaste SMTP-configuraties**.
@tab Zelf gehoste instantie
Open in het Admin Dashboard **Instellingen** en daarna **Meldingen > E-mails** in het zijmenu (**Meldingen** is eerst ingeklapt). Klik in de kaart **E-mailserverinstellingen** op **Server bewerken** en zet **Type e-mailserver** op `Custom SMTP`. Klik daarna op **SMTP-config bewerken** in de kaart **Aangepaste e-mail- en SMTP-instellingen**, die eronder verschijnt.
:::

### De stap Server invullen

Vul in de stap **Server** de **Naam** in (alleen bij projectconfiguraties), de **Hostnaam**, de **Poort** (een nieuwe projectconfiguratie begint op `587`), de **Gebruikersnaam** en het **Wachtwoord**.

### Meer velden controleren

Al het andere is ingeklapt onder **Meer velden**, aan het eind van de stap **Server**. Zolang die sectie is ingeklapt, zegt de kop hoe e-mail wordt verzonden, bijvoorbeeld "E-mail wordt via SMTP verzonden, met aanmelden met de gebruikersnaam en het wachtwoord. TLS is vereist." Open de sectie alleen als u een van de instellingen in de tabel hieronder moet wijzigen.

### De stap Afzender invullen

Vul in de stap **Afzender** de **E-mail van** en de **Van naam** in waarvan uw e-mails komen. Uw server moet verzenden vanaf dat adres toestaan.

### Opslaan en een testmail sturen

Sla de configuratie op. Zodra een projectconfiguratie is opgeslagen, controleert **Test-e-mail verzenden** in haar rij of ze werkt. Daarvoor is de machtiging nodig om SMTP-configuraties toe te voegen: **Project Owner**, **Project Admin**, of **Create SMTP Config** en **Read SMTP Config** in een aangepaste rol. Op OneUptime Cloud is ook het abonnement **Growth** nodig, net als voor het toevoegen van een configuratie. Voor anderen is de knop vergrendeld, en de tooltip zegt wat ervoor nodig is.

De test vraagt om een **E-mail**-adres om naartoe te sturen, eerst het uwe. Controleer of het bericht aankomt.
:::

Dit zijn de instellingen onder **Meer velden**:

| Veld | Wat het doet |
| --- | --- |
| **Transport** | `SMTP` (de standaard), of `Microsoft Graph` voor een Microsoft 365-tenant waarin SMTP AUTH is uitgeschakeld. Met Microsoft Graph worden hostnaam, poort, gebruikersnaam en wachtwoord verborgen en de OAuth-velden getoond. |
| **TLS vereisen** | Aan bij een nieuwe projectconfiguratie. E-mail wordt alleen verzonden via een versleutelde verbinding met een geldig certificaat. Als dit uit staat, wordt e-mail alleen versleuteld als de server dat aanbiedt, en wordt het certificaat niet gecontroleerd. Poort 465 is altijd versleuteld. |
| **Authenticatietype** | `Username and Password` (de standaard), `OAuth`, of `None` voor een relay die geen aanmelding vraagt. |
| **OAuth-velden** | **OAuth-providertype**, **OAuth Client ID**, **OAuth Client Secret**, **OAuth-token-URL** en **OAuth-scope**, getoond zodra OAuth of Microsoft Graph is gekozen. |
| **Beschrijving** | Een notitie voor uw team (alleen bij projectconfiguraties). |

**Microsoft Graph.** Open **Meer velden**, zet **Transport** op `Microsoft Graph` en vul een Azure-app in die de toepassingsmachtiging **Mail.Send** heeft: de client-ID en het clientgeheim ervan, de token-URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` en de scope `https://graph.microsoft.com/.default`. E-mail wordt verzonden vanuit de mailbox van **E-mail van**, die een mailbox met licentie in uw tenant moet zijn.

> [!NOTE]
> Op OneUptime Cloud moet de mailserver van een project via internet bereikbaar zijn: een host die naar een privé- of intern adres verwijst, wordt geweigerd. Bij een zelf gehoste installatie zijn privéadressen toegestaan, tenzij `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` `true` is; loopback- en link-local-adressen worden altijd geweigerd. De eigen mailserver van de instantie wordt niet op deze manier gecontroleerd.

## Authenticatie met OAuth 2.0

Met OAuth 2.0 meldt OneUptime zich zonder wachtwoord aan bij uw mailserver, wat zakelijke maildiensten steeds vaker vereisen. OneUptime ondersteunt twee OAuth-granttypen:

- **Client Credentials**: gebruikt door Microsoft 365 en de meeste OAuth-providers.
- **JWT Bearer**: gebruikt door serviceaccounts van Google Workspace.

```mermaid title="Hoe OneUptime zich aanmeldt met OAuth"
sequenceDiagram
    participant O as OneUptime
    participant T as Token-URL
    participant M as Mailserver
    O->>T: Vraagt een toegangstoken aan
    T-->>O: Toegangstoken
    Note over O: In de cache en vernieuwd<br/>voordat het verloopt
    O->>M: Meldt zich aan met het token
    O->>M: Verstuurt de e-mail
```

**Authenticatietype** en de OAuth-velden staan onder **Meer velden** in de stap Server van het formulier. Vul voor aanmelden met OAuth het volgende in:

| Veld | Beschrijving |
| --- | --- |
| **Hostnaam** | Adres van de SMTP-server |
| **Poort** | SMTP-poort (meestal 587 voor STARTTLS of 465 voor impliciete TLS) |
| **Gebruikersnaam** | Het e-mailadres van de mailbox die verstuurt |
| **Authenticatietype** | `OAuth` |
| **OAuth-providertype** | `Client Credentials` voor Microsoft 365, of `JWT Bearer` voor Google Workspace |
| **OAuth Client ID** | De applicatie-ID (client-ID) van uw OAuth-provider (bij Google: het e-mailadres van het serviceaccount) |
| **OAuth Client Secret** | Het clientgeheim van uw OAuth-provider (bij Google: de privésleutel) |
| **OAuth-token-URL** | Het OAuth-tokeneindpunt van uw provider |
| **OAuth-scope** | De OAuth-scope die SMTP-toegang verleent |

OneUptime bewaart OAuth-tokens in de cache en vernieuwt ze automatisch voordat ze verlopen.

## Configuratie voor Microsoft 365

Om OAuth met Microsoft 365 (Exchange Online) te gebruiken, registreert u een applicatie in Microsoft Entra, geeft u die machtiging om e-mail via SMTP te versturen en staat u haar toe de mailbox te gebruiken waarvandaan u verstuurt.

:::steps
### Een applicatie registreren in Microsoft Entra

1. Meld u aan bij het [Microsoft Entra-beheercentrum](https://entra.microsoft.com).
2. Ga naar **Identity** > **Applications** > **App registrations** en klik op **New registration**.
3. Voer een naam in (bijvoorbeeld "OneUptime SMTP"), kies "Accounts in this organizational directory only" en laat **Redirect URI** leeg.
4. Klik op **Register**.

Noteer op de pagina **Overview** de **Application (client) ID** (uw client-ID) en de **Directory (tenant) ID** (voor de token-URL).

### Een clientgeheim maken

1. Ga in uw app-registratie naar **Certificates & secrets** en klik op **New client secret**.
2. Voeg een beschrijving toe, kies een verloopperiode en klik op **Add**.
3. **Kopieer de waarde van het geheim meteen**: die wordt niet opnieuw getoond.

### De SMTP-machtiging toevoegen

1. Ga naar **API permissions** en klik op **Add a permission**.
2. Kies **APIs my organization uses** en zoek en selecteer daarna **Office 365 Exchange Online**.
3. Kies **Application permissions**, vink **SMTP.SendAsApp** aan en klik op **Add permissions**.
4. Klik op **Grant admin consent for [your organization]** (hiervoor zijn beheerdersrechten nodig).

### De service-principal registreren in Exchange Online

Voordat de applicatie e-mail kan versturen, registreert u haar service-principal in Exchange Online en geeft u die toegang tot de mailbox waarvandaan u verstuurt:

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
> Gebruik `Add-MailboxPermission`, niet `Add-RecipientPermission`. `Add-RecipientPermission` verleent alleen `SendAs` op de ontvanger, en dat is niet genoeg om de service-principal e-mail via SMTP met OAuth te laten versturen: het verzenden mislukt met een authenticatie- of machtigingsfout.

### De SMTP-configuratie in OneUptime maken

Maak of bewerk een SMTP-configuratie met deze instellingen en vervang `<tenant-id>` door uw **Directory (tenant) ID**:

| Veld | Waarde |
| --- | --- |
| Hostnaam | `smtp.office365.com` |
| Poort | `587` |
| Gebruikersnaam | Het e-mailadres waaraan u de machtigingen hebt gegeven (bijv. `sender@yourdomain.com`) |
| Authenticatietype | `OAuth` |
| OAuth-providertype | `Client Credentials` |
| OAuth Client ID | Uw **Application (client) ID** |
| OAuth Client Secret | De waarde van het clientgeheim |
| OAuth-token-URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth-scope | `https://outlook.office365.com/.default` |
| E-mail van | Gelijk aan de gebruikersnaam |
| TLS vereisen | Aan |

Controleer de configuratie daarna met **Test-e-mail verzenden**.
:::

## Configuratie voor Google Workspace

Google Workspace heeft een **serviceaccount** met domeinbrede delegatie nodig, dat e-mail verstuurt namens een gebruiker in uw domein. De SMTP-servers van Google ondersteunen geen eenvoudige client-credentials-flow voor Gmail.

### Voordat u met Google Workspace begint

- Een Google Workspace-account. Persoonlijke Gmail-accounts ondersteunen dit niet.
- Super Admin-toegang tot de beheerconsole van Google Workspace.
- Toegang tot de Google Cloud Console.

:::steps
### Een Google Cloud-project maken

1. Ga naar de [Google Cloud Console](https://console.cloud.google.com).
2. Klik op de projectkiezer en kies **New Project**.
3. Voer een projectnaam in, klik op **Create** en selecteer uw nieuwe project.

### De Gmail API inschakelen

1. Ga naar **APIs & Services** > **Library**.
2. Zoek naar "Gmail API", klik op **Gmail API** en daarna op **Enable**.

### Een serviceaccount maken

1. Ga naar **APIs & Services** > **Credentials**.
2. Klik op **Create Credentials** > **Service account**.
3. Voer een naam en een beschrijving in, klik op **Create and Continue**, sla de optionele stappen over en klik op **Done**.

### Een sleutel voor het serviceaccount maken

1. Klik op het serviceaccount dat u net hebt gemaakt en ga naar het tabblad **Keys**.
2. Klik op **Add Key** > **Create new key**, kies **JSON** en klik op **Create**.
3. Bewaar het gedownloade JSON-bestand veilig. De `client_email` ervan is uw OAuth-client-ID, en de `private_key` uw OAuth-clientgeheim.

### Domeinbrede delegatie inschakelen

1. Klik in de details van het serviceaccount op **Show Advanced Settings**.
2. Noteer de numerieke **Client ID**.
3. Vink **Enable Google Workspace Domain-wide Delegation** aan en klik op **Save**.

### Het serviceaccount autoriseren in het beheer van Google Workspace

1. Meld u aan bij de [beheerconsole van Google Workspace](https://admin.google.com).
2. Ga naar **Security** > **Access and data control** > **API Controls** en klik op **Manage Domain Wide Delegation**.
3. Klik op **Add new**, voer de numerieke **Client ID** uit de vorige stap in en vul bij **OAuth Scopes** `https://mail.google.com/` in.
4. Klik op **Authorize**.

Het kan enkele minuten tot 24 uur duren voordat de delegatie werkt.

### De SMTP-configuratie voor Google Workspace maken

Maak of bewerk een SMTP-configuratie met deze instellingen:

| Veld | Waarde |
| --- | --- |
| Hostnaam | `smtp.gmail.com` |
| Poort | `587` |
| Gebruikersnaam | Het Google Workspace-e-mailadres waarvandaan wordt verstuurd (bijv. `notifications@yourdomain.com`). Het serviceaccount treedt op namens deze gebruiker. |
| Authenticatietype | `OAuth` |
| OAuth-providertype | `JWT Bearer` |
| OAuth Client ID | De `client_email` uit de JSON van uw serviceaccount (bijv. `your-service@your-project.iam.gserviceaccount.com`) |
| OAuth Client Secret | De `private_key` uit de JSON van uw serviceaccount (de hele sleutel, inclusief `-----BEGIN PRIVATE KEY-----` en `-----END PRIVATE KEY-----`) |
| OAuth-token-URL | `https://oauth2.googleapis.com/token` |
| OAuth-scope | `https://mail.google.com/` |
| E-mail van | Gelijk aan de gebruikersnaam |
| TLS vereisen | Aan |

Controleer de configuratie daarna met **Test-e-mail verzenden**.
:::

> [!IMPORTANT]
> Bij Google (JWT Bearer) is de **OAuth Client ID** het **e-mailadres van het serviceaccount** (`client_email`), niet de numerieke `client_id`. Het serviceaccount treedt op namens de gebruiker in **Gebruikersnaam** om e-mail te versturen.

## Problemen oplossen

### Fouten bij Microsoft 365

| Probleem | Oplossing |
| --- | --- |
| "Authentication unsuccessful" | Controleer of de service-principal in Exchange is geregistreerd en machtigingen voor de mailbox heeft |
| "AADSTS700016: Application not found" | Controleer of de client-ID klopt en of de app in uw tenant bestaat |
| "AADSTS7000215: Invalid client secret" | Maak een nieuw clientgeheim: het oude is misschien verlopen |
| "The mailbox is not enabled for this operation" | Voer `Add-MailboxPermission` uit om toegang tot de mailbox te verlenen |

### Fouten bij Google Workspace

| Probleem | Oplossing |
| --- | --- |
| "invalid_grant" | Zorg dat de domeinbrede delegatie goed is ingesteld en al actief is |
| "unauthorized_client" | Controleer of de client-ID is geautoriseerd in de beheerconsole van Google Workspace |
| "access_denied" | Controleer of de scope `https://mail.google.com/` is geautoriseerd |
| "Domain policy has disabled third-party Drive apps" | Schakel API-toegang in via het beheer van Google Workspace, onder Security > API Controls |

### Andere problemen

:::details "Cannot send email. Please check your SMTP config."
**Test-e-mail verzenden** meldt dit wanneer een server waarbij u zich met gebruikersnaam en wachtwoord of helemaal niet aanmeldt, de e-mail niet aanneemt. Controleer **Hostnaam**, **Poort**, **Gebruikersnaam** en **Wachtwoord**. Als uw server geen TLS aanbiedt, of als zijn certificaat niet geldig is voor zijn hostnaam, zet u **TLS vereisen** uit onder **Meer velden** en probeert u het opnieuw. Het eigen antwoord van de server wordt bij de test bewaard: open het tabblad **E-mail** van **Projectinstellingen > Meldingen > Meldingslogboeken** en kies **Statusbericht bekijken** in de rij van de test.
:::

:::details "Cannot send email with OAuth authentication"
Het aanmelden met OAuth is mislukt, en de melding eindigt met de fout die uw provider teruggaf. Controleer **OAuth Client ID**, **OAuth Client Secret**, **OAuth-token-URL** en **OAuth-scope**, of de applicatie de machtigingen hierboven heeft en of beheerderstoestemming is verleend. Als SMTP AUTH in uw Microsoft 365-tenant is uitgeschakeld, zet u **Transport** in plaats daarvan op `Microsoft Graph`.
:::

:::details "Microsoft Graph send failed"
Een configuratie waarvan het **Transport** `Microsoft Graph` is, meldt dit wanneer Graph de e-mail niet aanneemt, gevolgd door de eigen fout van Microsoft. Controleer of de app de toepassingsmachtiging **Mail.Send** heeft met verleende beheerderstoestemming, of **OAuth-scope** `https://graph.microsoft.com/.default` is en of **E-mail van** een mailbox met licentie in uw tenant is.
:::

:::details "SMTP server host … could not be reached"
OneUptime weigerde verbinding te maken met de mailserver van het project. Op OneUptime Cloud wordt een hostnaam die niet kan worden opgezocht, of die naar een privé-, loopback- of link-local-adres verwijst, geweigerd met deze melding, die nooit zegt welk geval het is: gebruik de openbare hostnaam van de mailserver. Bij een zelf gehoste installatie, en bij een mailserver die als IP-adres is opgegeven, zegt de melding in plaats daarvan waarom. **Test-e-mail verzenden** toont haar alleen bij een OAuth-configuratie; bij de andere vindt u haar via **Statusbericht bekijken** op het tabblad **E-mail** van de meldingslogboeken.
:::

:::details De testmail komt niet aan
Controleer **E-mail van**: uw server moet verzenden vanaf dat adres toestaan. Kijk daarna in de spammap van de ontvanger en in de logboeken van uw mailserver naar de poging.
:::

## Goede beveiligingspraktijken

- **Vervang geheimen regelmatig.** Stel herinneringen in om clientgeheimen te vervangen voordat ze verlopen.
- **Gebruik aparte inloggegevens.** Maak eigen inloggegevens voor OneUptime in plaats van ze met andere applicaties te delen.
- **Verleen zo min mogelijk rechten.** Verleen alleen wat verzenden nodig heeft: **SMTP.SendAsApp** bij Microsoft, de scope `https://mail.google.com/` bij Google.
- **Houd het gebruik in de gaten.** Bekijk e-maillogboeken en aanmeldingen van OAuth-applicaties op ongebruikelijke activiteit.
- **Bewaar geheimen veilig.** Zet clientgeheimen nooit in versiebeheer.

## Verder lezen

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Volgende stappen

:::cards
- [Meldingsoverzicht](/docs/emails/notification-rollup): Hoe OneUptime golven van e-mails aan eigenaren bundelt.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers): De e-mail aan de abonnees van een statuspagina versturen via een SMTP-configuratie van het project.
:::
