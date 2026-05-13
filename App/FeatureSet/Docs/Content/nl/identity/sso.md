# SSO (Single Sign-On)

OneUptime ondersteunt SAML 2.0-gebaseerde Single Sign-On (SSO) voor enterprise-authenticatie. SSO stelt uw teamleden in staat in te loggen bij OneUptime met de inloggegevens van uw organisatie's identiteitsprovider (IdP), wat gecentraliseerd toegangsbeheer en verbeterde beveiliging biedt.

## Overzicht

SSO-integratie biedt de volgende voordelen:

- **Gecentraliseerde authenticatie**: Gebruikers loggen in met hun bestaande bedrijfsgegevens
- **Verbeterde beveiliging**: Maak gebruik van de meervoudige authenticatie en het beveiligingsbeleid van uw IdP
- **Vereenvoudigd gebruikersbeheer**: Beheer toegang vanuit uw bestaand identiteitsbeheersysteem
- **Minder wachtwoordmoeheid**: Gebruikers hoeven geen apart OneUptime-wachtwoord te onthouden

## SSO instellen

1. **Navigeer naar Projectinstellingen**
   - Ga naar uw OneUptime-project
   - Navigeer naar **Projectinstellingen** > **Authenticatie** > **SSO**

2. **SSO-configuratie aanmaken**
   - Klik op **SSO aanmaken**
   - Voer een **Naam** in voor de SSO-configuratie (bijv. "Keycloak SAML" of "Okta SAML")
   - Voer de **Sign On URL** in van uw identiteitsprovider
   - Voer de **Issuer** (Entiteit-ID) in van uw identiteitsprovider
   - Plak het **Openbaar certificaat** van uw identiteitsprovider
   - Selecteer het **Handtekeningalgoritme** (bijv. `RSA-SHA-256`)
   - Selecteer het **Digestalgoritme** (bijv. `SHA256`)

3. **OneUptime SSO-metagegevens ophalen**
   - Klik na het opslaan op de knop **SSO-configuratie bekijken**
   - Kopieer de **Identifier (Entiteit-ID)** — dit is nodig in uw IdP-configuratie
   - Kopieer de **Reply URL (Assertion Consumer Service URL)** — dit is nodig in uw IdP-configuratie

## Keycloak SAML-configuratie

Keycloak is een populaire open-source oplossing voor identiteits- en toegangsbeheer. Volg deze stappen om Keycloak als uw SAML-identiteitsprovider voor OneUptime te configureren.

### Vereisten

- Een actieve Keycloak-instantie met een geconfigureerd realm
- Beheerderstoegang tot zowel Keycloak als OneUptime
- OneUptime-account met SSO-ondersteuning

### Stap 1: OneUptime SSO configureren

1. Log in op uw OneUptime-dashboard
2. Navigeer naar **Projectinstellingen** > **Authenticatie** > **SSO**
3. Klik op **SSO aanmaken** en vul het volgende in:
   - **Naam**: Een beschrijvende naam (bijv. `my-project-oneuptime`)
   - **Sign On URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Issuer**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certificaat**: Zie [Stap 2](#stap-2-het-keycloak-certificaat-ophalen) hieronder
   - **Handtekeningalgoritme**: `RSA-SHA-256`
   - **Digestalgoritme**: `SHA256`
4. Sla de configuratie op

### Stap 2: Het Keycloak-certificaat ophalen

1. Navigeer in Keycloak naar uw clientconfiguratie
2. Klik op **Exporteren** (of ga naar het tabblad **Sleutels**, afhankelijk van uw Keycloak-versie)
3. Zoek in het geëxporteerde JSON-bestand de sleutel met `certificate` in de naam
4. Kopieer de certificaatwaarde en plak deze in OneUptime in het volgende formaat:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Stap 3: Keycloak-client configureren

1. Navigeer in Keycloak naar **Clients** in uw realm
2. Maak een nieuwe client aan of bewerk een bestaande
3. Stel **Client Protocol** in op `saml`
4. Stel **Client ID** in op de waarde **Identifier (Entiteit-ID)** uit **SSO-configuratie bekijken** van OneUptime
5. Stel **Geldige omleidings-URI's** in op uw OneUptime-URL
6. Stel **Root URL** in op uw OneUptime-basis-URL
7. Plak de **Reply URL (Assertion Consumer Service URL)** van OneUptime in het veld **Assertion Consumer Service POST Binding URL**

### Stap 4: Keycloak-clientinstellingen configureren

1. Schakel **Handtekeningsleutelsconfiguratie** uit (onder het tabblad Sleutels)
2. Stel **Name ID Format** in op `email`
3. Zorg dat de optie **Name ID Format forceren** is ingeschakeld zodat Keycloak altijd het e-mailadres als Name ID verstuurt

### Stap 5: De configuratie verifiëren

1. Sla alle instellingen op in zowel Keycloak als OneUptime
2. Probeer in te loggen bij OneUptime via SSO
3. U zou doorgestuurd moeten worden naar uw Keycloak-inlogpagina en na succesvolle authenticatie terug naar OneUptime

### Probleemoplossing voor Keycloak

- **Inloggen mislukt met handtekeningsfout**: Zorg dat het certificaat correct is gekopieerd, inclusief de regels `BEGIN CERTIFICATE` en `END CERTIFICATE`
- **Name ID-fout**: Controleer of **Name ID Format** is ingesteld op `email` in Keycloak
- **Omleidingslus**: Controleer of de **Geldige omleidings-URI's** en **Assertion Consumer Service POST Binding URL** correct zijn geconfigureerd
- **Certificaat niet gevonden**: Zorg dat u exporteert vanuit de juiste client in het juiste realm

---

## Microsoft Entra ID (voorheen Azure AD / Active Directory) SAML-configuratie

Microsoft Entra ID is de cloudgebaseerde identiteits- en toegangsbeheerservice van Microsoft. Volg deze stappen om Entra ID als uw SAML-identiteitsprovider voor OneUptime te configureren.

### Vereisten

- Microsoft Entra ID-tenant (elke laag die enterprise-applicaties met SAML SSO ondersteunt)
- Beheerderstoegang tot zowel Microsoft Entra ID als OneUptime
- OneUptime-account met SSO-ondersteuning

### Stap 1: OneUptime SSO configureren

1. Log in op uw OneUptime-dashboard
2. Navigeer naar **Projectinstellingen** > **Authenticatie** > **SSO**
3. Klik op **SSO aanmaken** en vul het volgende in:
   - **Naam**: Een beschrijvende naam (bijv. `Azure AD SAML`)
   - **Sign On URL**: U ontvangt dit van Entra ID in [Stap 3](#stap-3-entra-id-saml-metagegevens-kopiëren-naar-oneuptime)
   - **Issuer**: U ontvangt dit van Entra ID in [Stap 3](#stap-3-entra-id-saml-metagegevens-kopiëren-naar-oneuptime)
   - **Certificaat**: U ontvangt dit van Entra ID in [Stap 3](#stap-3-entra-id-saml-metagegevens-kopiëren-naar-oneuptime)
   - **Handtekeningalgoritme**: `RSA-SHA-256`
   - **Digestalgoritme**: `SHA256`
4. Klik op **SSO-configuratie bekijken** en kopieer de **Identifier (Entiteit-ID)** en **Reply URL (Assertion Consumer Service URL)** — u heeft deze nodig voor Entra ID

### Stap 2: Enterprise-toepassing aanmaken in Microsoft Entra ID

1. Meld u aan bij het [Microsoft Entra-beheercentrum](https://entra.microsoft.com)
2. Navigeer naar **Identiteit** > **Applicaties** > **Enterprise-toepassingen**
3. Klik op **+ Nieuwe toepassing**
4. Klik op **+ Uw eigen toepassing maken**
5. Voer een naam in (bijv. "OneUptime")
6. Selecteer **Een andere toepassing integreren die u niet in de galerie vindt (Niet-galerie)**
7. Klik op **Maken**

### Stap 3: SAML SSO configureren in Entra ID

1. Ga in uw nieuwe enterprise-toepassing naar **Eenmalige aanmelding**
2. Selecteer **SAML** als de methode voor eenmalige aanmelding
3. Klik in **Basis SAML-configuratie** op **Bewerken** en stel in:
   - **Identifier (Entiteit-ID)**: Plak de **Identifier (Entiteit-ID)** uit **SSO-configuratie bekijken** van OneUptime
   - **Reply URL (Assertion Consumer Service URL)**: Plak de **Reply URL** uit **SSO-configuratie bekijken** van OneUptime
4. Klik op **Opslaan**
5. In de sectie **SAML-certificaten**:
   - Download het **Certificaat (Base64)**
   - Open het gedownloade certificaatbestand in een teksteditor en kopieer de inhoud
6. Kopieer in de sectie **OneUptime instellen**:
   - **Aanmeldings-URL** — plak dit als de **Sign On URL** in OneUptime
   - **Azure AD-identifier** — plak dit als de **Issuer** in OneUptime
7. Ga terug naar OneUptime en plak het certificaat en de URL's, sla dan op

### Stap 4: Gebruikersattributen en claims configureren

1. Klik op de SAML-configuratiepagina op **Bewerken** bij **Attributen en claims**
2. Zorg dat de volgende claims zijn geconfigureerd:

| Claimnaam | Waarde |
|-----------|-------|
| `Unique User Identifier (Name ID)` | `user.userprincipalname` of `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

3. Stel de **Name identifier-indeling** in op `E-mailadres`
4. Klik op **Opslaan**

### Stap 5: Gebruikers en groepen toewijzen

1. Ga in uw enterprise-toepassing naar **Gebruikers en groepen**
2. Klik op **+ Gebruiker/groep toevoegen**
3. Selecteer de gebruikers en/of groepen die u SSO-toegang wilt verlenen
4. Klik op **Toewijzen**

### Stap 6: De configuratie verifiëren

1. Sla alle instellingen op in zowel Entra ID als OneUptime
2. Probeer in te loggen bij OneUptime via SSO
3. U zou doorgestuurd moeten worden naar de Microsoft-inlogpagina en na succesvolle authenticatie terug naar OneUptime

### Probleemoplossing voor Microsoft Entra ID

- **AADSTS700016-fout**: De Identifier (Entiteit-ID) in Entra ID komt niet overeen met OneUptime — controleer of beide waarden identiek zijn
- **Certificaatfout**: Zorg dat u het **Base64**-certificaat heeft gedownload (niet het onbewerkte/binaire formaat) en de regels `BEGIN CERTIFICATE` / `END CERTIFICATE` heeft opgenomen
- **Gebruiker niet toegewezen**: Gebruikers moeten expliciet worden toegewezen aan de enterprise-toepassing voordat ze via SSO kunnen inloggen
- **Name ID-mismatch**: Zorg dat de Name ID-claim is ingesteld op een e-mailadres dat overeenkomt met het e-mailadres van de gebruiker in OneUptime

---

## Okta SAML-configuratie

Okta is een veelgebruikt identiteitsplatform dat robuuste SAML SSO-mogelijkheden biedt. Volg deze stappen om Okta als uw SAML-identiteitsprovider voor OneUptime te configureren.

### Vereisten

- Okta-organisatie met beheerderstoegang
- OneUptime-account met SSO-ondersteuning

### Stap 1: OneUptime SSO configureren

1. Log in op uw OneUptime-dashboard
2. Navigeer naar **Projectinstellingen** > **Authenticatie** > **SSO**
3. Klik op **SSO aanmaken** en vul het volgende in:
   - **Naam**: Een beschrijvende naam (bijv. `Okta SAML`)
   - **Sign On URL**: U ontvangt dit van Okta in [Stap 3](#stap-3-okta-saml-metagegevens-kopiëren-naar-oneuptime)
   - **Issuer**: U ontvangt dit van Okta in [Stap 3](#stap-3-okta-saml-metagegevens-kopiëren-naar-oneuptime)
   - **Certificaat**: U ontvangt dit van Okta in [Stap 3](#stap-3-okta-saml-metagegevens-kopiëren-naar-oneuptime)
   - **Handtekeningalgoritme**: `RSA-SHA-256`
   - **Digestalgoritme**: `SHA256`
4. Klik op **SSO-configuratie bekijken** en kopieer de **Identifier (Entiteit-ID)** en **Reply URL (Assertion Consumer Service URL)** — u heeft deze nodig voor Okta

### Stap 2: SAML-applicatie aanmaken in Okta

1. Meld u aan bij uw Okta-beheerconsole
2. Navigeer naar **Applicaties** > **Applicaties**
3. Klik op **App-integratie aanmaken**
4. Selecteer **SAML 2.0** en klik op **Volgende**
5. Voer "OneUptime" in als **App-naam** en klik op **Volgende**
6. Configureer in de sectie **SAML-instellingen**:
   - **Single sign-on URL**: Plak de **Reply URL (Assertion Consumer Service URL)** uit **SSO-configuratie bekijken** van OneUptime
   - **Audience URI (SP Entity ID)**: Plak de **Identifier (Entiteit-ID)** uit **SSO-configuratie bekijken** van OneUptime
   - **Name ID-indeling**: Selecteer `EmailAddress`
   - **Applicatiegebruikersnaam**: Selecteer `Email`
7. Klik op **Volgende**, selecteer vervolgens **Ik ben een Okta-klant die een interne app toevoegt** en klik op **Voltooien**

### Stap 3: Okta SAML-metagegevens kopiëren naar OneUptime

1. Ga in uw Okta-applicatie naar het tabblad **Aanmelden**
2. Zoek in de sectie **SAML-handtekeningcertificaten** het actieve certificaat en klik op **Acties** > **IdP-metagegevens bekijken**
3. Vanuit de metagegevens-XML, of vanuit de details op het tabblad **Aanmelden**:
   - Kopieer de **Sign On URL** (ook wel **Identity Provider Single Sign-On URL** genoemd) — plak dit als de **Sign On URL** in OneUptime
   - Kopieer de **Issuer** (ook wel **Identity Provider Issuer** genoemd) — plak dit als de **Issuer** in OneUptime
4. Download het handtekeningcertificaat:
   - Klik in de sectie **SAML-handtekeningcertificaten** op **Acties** > **Certificaat downloaden** voor het actieve certificaat
   - Open het gedownloade `.cert`-bestand in een teksteditor en kopieer de inhoud
   - Plak het certificaat in OneUptime (inclusief de regels `BEGIN CERTIFICATE` en `END CERTIFICATE`)
5. Sla de OneUptime SSO-configuratie op

### Stap 4: Attribuutstatements configureren (optioneel)

1. Ga in de Okta-applicatie naar het tabblad **Algemeen**
2. Klik op **Bewerken** in de sectie **SAML-instellingen** en klik op **Volgende** om bij de SAML-instellingen te komen
3. Voeg in de sectie **Attribuutstatements** toe:

| Naam | Waarde |
|------|-------|
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

4. Klik op **Volgende** en vervolgens op **Voltooien**

### Stap 5: Gebruikers en groepen toewijzen

1. Ga in uw Okta-applicatie naar het tabblad **Toewijzingen**
2. Klik op **Toewijzen** > **Toewijzen aan personen** of **Toewijzen aan groepen**
3. Selecteer de gebruikers of groepen die u SSO-toegang wilt verlenen
4. Klik op **Toewijzen** voor elke selectie, klik vervolgens op **Gereed**

### Stap 6: De configuratie verifiëren

1. Sla alle instellingen op in zowel Okta als OneUptime
2. Probeer in te loggen bij OneUptime via SSO
3. U zou doorgestuurd moeten worden naar de Okta-inlogpagina en na succesvolle authenticatie terug naar OneUptime

### Probleemoplossing voor Okta

- **404 of ongeldige SSO URL**: Controleer of de **Single sign-on URL** in Okta exact overeenkomt met de **Reply URL** van OneUptime
- **Audience-mismatch**: Zorg dat de **Audience URI** in Okta exact overeenkomt met de **Identifier (Entiteit-ID)** van OneUptime
- **Certificaatfout**: Zorg dat u het certificaat heeft gedownload voor het **actieve** handtekeningcertificaat, niet een inactief certificaat
- **Gebruiker niet toegewezen**: Gebruikers moeten worden toegewezen aan de Okta-applicatie voordat ze via SSO kunnen inloggen
- **Name ID-fout**: Controleer of de **Name ID-indeling** is ingesteld op `EmailAddress` en de **Applicatiegebruikersnaam** op `Email`

---

## Andere identiteitsproviders

De SSO-implementatie van OneUptime gebruikt het SAML 2.0-protocol en zou moeten werken met elke conforme identiteitsprovider. De algemene configuratiestappen zijn:

1. Maak in OneUptime een SSO-configuratie aan en noteer de **Identifier (Entiteit-ID)** en **Reply URL (Assertion Consumer Service URL)** via de knop **SSO-configuratie bekijken**
2. Maak in uw identiteitsprovider een SAML-applicatie aan met:
   - **Assertion Consumer Service URL / Reply URL**: Uit OneUptime SSO-configuratie
   - **Entity ID / Audience URI**: Uit OneUptime SSO-configuratie
   - **Name ID Format**: E-mailadres
3. Kopieer het volgende vanuit uw identiteitsprovider naar OneUptime:
   - **Sign On URL** (SSO-eindpunt)
   - **Issuer** (Entiteit-ID van de IdP)
   - **Openbaar certificaat** (X.509-handtekeningcertificaat)
4. Stel het **Handtekeningalgoritme** in op `RSA-SHA-256` en het **Digestalgoritme** op `SHA256`

## Opmerkingen over SSO en rollen

OneUptime ondersteunt momenteel geen koppeling van SAML-rollen vanuit uw identiteitsprovider. Op rollen gebaseerde toegang moet afzonderlijk worden geconfigureerd binnen **Projectinstellingen** > **SSO** in OneUptime, waar u standaardrollen voor SSO-gebruikers kunt toewijzen.
