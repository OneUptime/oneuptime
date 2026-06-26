# Global SSO (Instance-brede Single Sign-On)

Global SSO stelt een OneUptime **instantiebeheerder** (master admin) in staat om één enkele SAML 2.0- of OpenID Connect (OIDC)-identiteitsprovider **eenmalig op instantieniveau** te configureren en deze te verbinden met elk project op de server. Het is de instantie-brede tegenhanger van SSO per project: in plaats van dat elke projecteigenaar zijn eigen identiteitsprovider configureert, stelt een master admin er één in die de hele instantie kan bedienen.

Global SSO is een functie van **OneUptime Enterprise Edition** en is alleen beschikbaar op instanties die de Enterprise Edition-build draaien.

## Global SSO versus Project-SSO

|                        | Project-SSO                                      | Global SSO                                            |
| ---------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| Geconfigureerd door    | Projecteigenaar/-beheerder (Projectinstellingen) | Instantie-master admin (Admin Dashboard)              |
| Bereik                 | Eén enkel project                                | De hele instantie — verbindbaar met elk project       |
| Resultaat van inloggen | Toegang tot dat ene project                      | Toegang tot elk project dat de gebruiker kan bereiken |

## Global SSO instellen

1. **Open het Admin Dashboard**

   - Log in als master admin en open **Admin** > **Settings** > **Global SSO** (voor SAML) of **Global OIDC** (voor OpenID Connect).

2. **Een provider aanmaken**

   - Klik op **Create Global SSO**.
   - Voor SAML: voer een **Name** in, de **Sign On URL** en **Issuer** van uw identiteitsprovider, en plak het **Public Certificate**. Kies de **Signature**- en **Digest**-methoden (laat de standaardwaarden — `RSA-SHA256` / `SHA256` — staan als u twijfelt).
   - Voor OIDC: voer de **Discovery URL**, **Issuer**, **Client ID**, **Client Secret**, **Scopes** (moet `openid` bevatten) en de claimnamen voor **email** / **name** in.

3. **Kopieer de OneUptime-URL's naar uw identiteitsprovider**

   - Open de provider (klik op de betreffende rij in de lijst) om de kaart **Identity Provider URLs** weer te geven.
   - Voor SAML kopieert u de **ACS URL (Reply URL)** en **Issuer (Entity ID)** naar uw IdP (Okta, Azure AD, OneLogin, JumpCloud en meer).
   - Voor OIDC kopieert u de **Redirect URI** naar de lijst met toegestane omleidings-URI's van uw IdP.

4. **Test de provider**
   - Gebruik de link **Test this SSO provider** op de pagina van de provider om een end-to-end inlogtest via uw identiteitsprovider uit te voeren. De provider moet **ingeschakeld** zijn om de link te laten werken. Het inschakelen van een globale provider voegt alleen een optie "Sign in with SSO" toe op de inlogpagina — het forceert nooit SSO en sluit niemand buiten, dus het is veilig om in te schakelen, te testen en indien nodig weer uit te schakelen.

## Hoe gebruikers inloggen

Hoe een globale provider zich gedraagt, hangt af van of u er projecten aan koppelt:

- **Geen projecten gekoppeld (default-all / invite-first):** Gebruikers kunnen inloggen met de provider en **elk project bereiken waarvan ze al lid zijn**. Nieuwe gebruikers worden **niet** automatisch aangemaakt — een gebruiker moet eerst voor een project worden uitgenodigd. Gebruik dit voor bedrijfsbrede SSO waarbij lidmaatschappen elders worden beheerd.

- **Projecten gekoppeld (auto-provisioning):** Open de provider en gebruik de tabel **Attached Projects** om een of meer projecten te koppelen, elk met een set standaardteams. Gebruikers die inloggen worden **automatisch geprovisioneerd** in die projecten en bij de eerste aanmelding toegevoegd aan de standaardteams. Voeg één project + teams tegelijk toe om de lijst op te bouwen; om een koppeling te wijzigen, verwijdert u deze en voegt u haar opnieuw toe.

Als u elke automatische accountaanmaak wilt voorkomen, zelfs wanneer er projecten zijn gekoppeld, schakel dan **Disable Sign Up with SSO** in op de provider — gebruikers moeten dan worden uitgenodigd voordat ze kunnen inloggen.

## SSO afdwingen

Het configureren van een globale provider dwingt niemand om deze te gebruiken; inloggen met een wachtwoord blijft werken. Om SSO te verplichten, gebruikt u de besturingselementen **Require SSO for Login**:

- **Per project:** een project kan SSO vereisen, en optioneel een _specifieke_ provider vereisen (project of globaal).
- **Instantie-breed:** **Admin** > **Settings** > **Authentication** bevat een schakelaar **Require SSO for Login** die SSO afdwingt voor elke gebruiker in de hele instantie. Master admins blijven uitgezonderd, zodat zij niet buitengesloten kunnen worden.

## Gerelateerd

- [SSO (Project-SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
