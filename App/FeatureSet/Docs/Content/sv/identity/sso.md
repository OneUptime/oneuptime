# SSO (Single Sign-On)

OneUptime stöder SAML 2.0-baserad Single Sign-On (SSO) för enterprise-autentisering. SSO gör det möjligt för dina teammedlemmar att logga in på OneUptime med din organisations identitetsleverantör (IdP), vilket ger centraliserad åtkomsthantering och förbättrad säkerhet.

## Översikt

SSO-integration ger följande fördelar:

- **Centraliserad autentisering**: Användare loggar in med sina befintliga företagsuppgifter
- **Förbättrad säkerhet**: Utnyttja din IdP:s multifaktorautentisering och säkerhetspolicyer
- **Förenklad användarhantering**: Hantera åtkomst från ditt befintliga identitetshanteringssystem
- **Minskad lösenordströtthet**: Användare behöver inte komma ihåg ett separat OneUptime-lösenord

## Konfigurera SSO

1. **Navigera till projektinställningar**

   - Gå till ditt OneUptime-projekt
   - Navigera till **Projektinställningar** > **Autentisering** > **SSO**

2. **Skapa SSO-konfiguration**

   - Klicka på **Skapa SSO**
   - Ange ett **Namn** för SSO-konfigurationen (t.ex. "Keycloak SAML" eller "Okta SAML")
   - Ange **Inloggnings-URL** från din identitetsleverantör
   - Ange **Utgivare** (Entity ID) från din identitetsleverantör
   - Klistra in **Offentligt certifikat** från din identitetsleverantör
   - Välj **Signaturalgoritm** (t.ex. `RSA-SHA-256`)
   - Välj **Digest-algoritm** (t.ex. `SHA256`)

3. **Hämta OneUptime SSO-metadata**
   - Efter att du sparat, klicka på knappen **Visa SSO-konfiguration**
   - Kopiera **Identifieraren (Entity ID)** – detta behövs i din IdP-konfiguration
   - Kopiera **Svars-URL (Assertion Consumer Service URL)** – detta behövs i din IdP-konfiguration

## Keycloak SAML-konfiguration

Keycloak är en populär open source-lösning för identitets- och åtkomsthantering. Följ dessa steg för att konfigurera Keycloak som din SAML-identitetsleverantör för OneUptime.

### Förutsättningar

- En körande Keycloak-instans med ett konfigurerat rike
- Administratörsåtkomst till både Keycloak och OneUptime
- OneUptime-konto med SSO-stöd

### Steg 1: Konfigurera OneUptime SSO

1. Logga in på din OneUptime-instrumentpanel
2. Navigera till **Projektinställningar** > **Autentisering** > **SSO**
3. Klicka på **Skapa SSO** och fyll i följande:
   - **Namn**: Ett beskrivande namn (t.ex. `my-project-oneuptime`)
   - **Inloggnings-URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Utgivare**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certifikat**: Se [Steg 2](#steg-2-hämta-keycloak-certifikatet) nedan
   - **Signaturalgoritm**: `RSA-SHA-256`
   - **Digest-algoritm**: `SHA256`
4. Spara konfigurationen

### Steg 2: Hämta Keycloak-certifikatet

1. I Keycloak, navigera till din klientkonfiguration
2. Klicka på **Exportera** (eller gå till fliken **Nycklar** beroende på din Keycloak-version)
3. I den exporterade JSON-filen, hitta nyckeln med `certificate` i namnet
4. Kopiera certifikatvärdet och klistra in det i OneUptime i följande format:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Steg 3: Konfigurera Keycloak-klient

1. I Keycloak, navigera till **Klienter** i ditt rike
2. Skapa en ny klient eller redigera en befintlig
3. Ange **Klientprotokoll** till `saml`
4. Ange **Klient-ID** till värdet **Identifierare (Entity ID)** från OneUptimes **Visa SSO-konfiguration**
5. Ange **Giltiga omdirigerings-URI:er** till din OneUptime-URL
6. Ange **Root-URL** till din OneUptime-bas-URL
7. Klistra in **Svars-URL (Assertion Consumer Service URL)** från OneUptime i fältet **Assertion Consumer Service POST Binding URL**

### Steg 4: Konfigurera Keycloak-klientinställningar

1. Inaktivera **Signeringsnycklar konfiguration** (under fliken Nycklar)
2. Ange **Name ID-format** till `email`
3. Se till att alternativet **Tvinga Name ID-format** är aktiverat så att Keycloak alltid skickar e-posten som Name ID

### Steg 5: Verifiera konfigurationen

1. Spara alla inställningar i både Keycloak och OneUptime
2. Försök logga in på OneUptime med SSO
3. Du bör omdirigeras till din Keycloak-inloggningssida och tillbaka till OneUptime efter lyckad autentisering

### Felsökning av Keycloak

- **Inloggning misslyckas med signaturfel**: Se till att certifikatet är korrekt kopierat, inklusive raderna `BEGIN CERTIFICATE` och `END CERTIFICATE`
- **Name ID-fel**: Verifiera att **Name ID-format** är inställt på `email` i Keycloak
- **Omleddningsloop**: Kontrollera att **Giltiga omdirigerings-URI:er** och **Assertion Consumer Service POST Binding URL** är korrekt konfigurerade
- **Certifikat hittades inte**: Se till att du exporterar från rätt klient i rätt rike

---

## Microsoft Entra ID (tidigare Azure AD / Active Directory) SAML-konfiguration

Microsoft Entra ID är Microsofts molnbaserade identitets- och åtkomsthanteringstjänst. Följ dessa steg för att konfigurera Entra ID som din SAML-identitetsleverantör för OneUptime.

### Förutsättningar

- Microsoft Entra ID-klient (valfri nivå som stöder Enterprise-program med SAML SSO)
- Administratörsåtkomst till både Microsoft Entra ID och OneUptime
- OneUptime-konto med SSO-stöd

### Steg 1: Konfigurera OneUptime SSO

1. Logga in på din OneUptime-instrumentpanel
2. Navigera till **Projektinställningar** > **Autentisering** > **SSO**
3. Klicka på **Skapa SSO** och fyll i följande:
   - **Namn**: Ett beskrivande namn (t.ex. `Azure AD SAML`)
   - **Inloggnings-URL**: Du hämtar detta från Entra ID i [Steg 3](#steg-3-konfigurera-saml-sso-i-entra-id)
   - **Utgivare**: Du hämtar detta från Entra ID i [Steg 3](#steg-3-konfigurera-saml-sso-i-entra-id)
   - **Certifikat**: Du hämtar detta från Entra ID i [Steg 3](#steg-3-konfigurera-saml-sso-i-entra-id)
   - **Signaturalgoritm**: `RSA-SHA-256`
   - **Digest-algoritm**: `SHA256`
4. Klicka på **Visa SSO-konfiguration** och kopiera **Identifieraren (Entity ID)** och **Svars-URL (Assertion Consumer Service URL)** – du behöver dessa för Entra ID

### Steg 2: Skapa Enterprise-program i Microsoft Entra ID

1. Logga in på [Microsoft Entra-administrationscentret](https://entra.microsoft.com)
2. Navigera till **Identitet** > **Program** > **Enterprise-program**
3. Klicka på **+ Nytt program**
4. Klicka på **+ Skapa ditt eget program**
5. Ange ett namn (t.ex. "OneUptime")
6. Välj **Integrera ett annat program som du inte hittar i galleriet (Icke-galleri)**
7. Klicka på **Skapa**

### Steg 3: Konfigurera SAML SSO i Entra ID

1. I ditt nya Enterprise-program, gå till **Single sign-on**
2. Välj **SAML** som single sign-on-metod
3. I **Grundläggande SAML-konfiguration**, klicka på **Redigera** och ange:
   - **Identifierare (Entity ID)**: Klistra in **Identifieraren (Entity ID)** från OneUptimes **Visa SSO-konfiguration**
   - **Svars-URL (Assertion Consumer Service URL)**: Klistra in **Svars-URL** från OneUptimes **Visa SSO-konfiguration**
4. Klicka på **Spara**
5. I avsnittet **SAML-certifikat**:
   - Ladda ned **Certifikat (Base64)**
   - Öppna det nedladdade certifikatfilen i en textredigerare och kopiera innehållet
6. I avsnittet **Konfigurera OneUptime**, kopiera:
   - **Inloggnings-URL** – klistra in detta som **Inloggnings-URL** i OneUptime
   - **Azure AD-identifierare** – klistra in detta som **Utgivare** i OneUptime
7. Gå tillbaka till OneUptime och klistra in certifikatet och URL:erna, spara sedan

### Steg 4: Konfigurera användarattribut och anspråk

1. På SAML-konfigurationssidan, klicka på **Redigera** i **Attribut och anspråk**
2. Se till att följande anspråk är konfigurerade:

| Anspråksnamn                                                         | Värde                                      |
| -------------------------------------------------------------------- | ------------------------------------------ |
| `Unique User Identifier (Name ID)`                                   | `user.userprincipalname` eller `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail`                                |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`    | `user.givenname`                           |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`      | `user.surname`                             |

3. Ange **Namnidentifierarformat** till `E-postadress`
4. Klicka på **Spara**

### Steg 5: Tilldela användare och grupper

1. I ditt Enterprise-program, gå till **Användare och grupper**
2. Klicka på **+ Lägg till användare/grupp**
3. Välj de användare och/eller grupper du vill bevilja SSO-åtkomst
4. Klicka på **Tilldela**

### Steg 6: Verifiera konfigurationen

1. Spara alla inställningar i både Entra ID och OneUptime
2. Försök logga in på OneUptime med SSO
3. Du bör omdirigeras till Microsofts inloggningssida och tillbaka till OneUptime efter lyckad autentisering

### Felsökning av Microsoft Entra ID

- **AADSTS700016-fel**: Identifieraren (Entity ID) i Entra ID matchar inte OneUptime – verifiera att båda värdena är identiska
- **Certifikatfel**: Se till att du laddade ned certifikatet i **Base64**-format (inte raw/binärt format) och inkluderade raderna `BEGIN CERTIFICATE` / `END CERTIFICATE`
- **Användaren är inte tilldelad**: Användare måste uttryckligen tilldelas Enterprise-programmet innan de kan logga in via SSO
- **Name ID-mismatch**: Se till att Name ID-anspråket är inställt på en e-postadress som matchar användarens e-post i OneUptime

---

## Okta SAML-konfiguration

Okta är en vanligt använd identitetsplattform som tillhandahåller robusta SAML SSO-funktioner. Följ dessa steg för att konfigurera Okta som din SAML-identitetsleverantör för OneUptime.

### Förutsättningar

- Okta-organisation med administratörsåtkomst
- OneUptime-konto med SSO-stöd

### Steg 1: Konfigurera OneUptime SSO

1. Logga in på din OneUptime-instrumentpanel
2. Navigera till **Projektinställningar** > **Autentisering** > **SSO**
3. Klicka på **Skapa SSO** och fyll i följande:
   - **Namn**: Ett beskrivande namn (t.ex. `Okta SAML`)
   - **Inloggnings-URL**: Du hämtar detta från Okta i [Steg 3](#steg-3-kopiera-okta-saml-metadata-till-oneuptime)
   - **Utgivare**: Du hämtar detta från Okta i [Steg 3](#steg-3-kopiera-okta-saml-metadata-till-oneuptime)
   - **Certifikat**: Du hämtar detta från Okta i [Steg 3](#steg-3-kopiera-okta-saml-metadata-till-oneuptime)
   - **Signaturalgoritm**: `RSA-SHA-256`
   - **Digest-algoritm**: `SHA256`
4. Klicka på **Visa SSO-konfiguration** och kopiera **Identifieraren (Entity ID)** och **Svars-URL (Assertion Consumer Service URL)** – du behöver dessa för Okta

### Steg 2: Skapa SAML-program i Okta

1. Logga in på din Okta Admin-konsol
2. Navigera till **Program** > **Program**
3. Klicka på **Skapa appintegration**
4. Välj **SAML 2.0** och klicka på **Nästa**
5. Ange "OneUptime" som **Appnamn** och klicka på **Nästa**
6. I avsnittet **SAML-inställningar**, konfigurera:
   - **Single sign-on-URL**: Klistra in **Svars-URL (Assertion Consumer Service URL)** från OneUptimes **Visa SSO-konfiguration**
   - **Audience URI (SP Entity ID)**: Klistra in **Identifieraren (Entity ID)** från OneUptimes **Visa SSO-konfiguration**
   - **Name ID-format**: Välj `EmailAddress`
   - **Programanvändarnamn**: Välj `Email`
7. Klicka på **Nästa**, välj sedan **Jag är en Okta-kund som lägger till en intern app** och klicka på **Slutför**

### Steg 3: Kopiera Okta SAML-metadata till OneUptime

1. I ditt Okta-program, gå till fliken **Sign On**
2. I avsnittet **SAML-signeringscertifikat**, hitta det aktiva certifikatet och klicka på **Åtgärder** > **Visa IdP-metadata**
3. Från metadata-XML eller från detaljer på fliken **Sign On**:
   - Kopiera **Sign On URL** (kallas även **Identity Provider Single Sign-On URL**) – klistra in detta som **Inloggnings-URL** i OneUptime
   - Kopiera **Utgivare** (kallas även **Identity Provider Issuer**) – klistra in detta som **Utgivare** i OneUptime
4. Ladda ned signeringscertifikatet:
   - I avsnittet **SAML-signeringscertifikat**, klicka på **Åtgärder** > **Ladda ned certifikat** för det aktiva certifikatet
   - Öppna den nedladdade `.cert`-filen i en textredigerare och kopiera innehållet
   - Klistra in certifikatet i OneUptime (inklusive raderna `BEGIN CERTIFICATE` och `END CERTIFICATE`)
5. Spara OneUptime SSO-konfigurationen

### Steg 4: Konfigurera attribututtryck (valfritt)

1. I Okta-programmet, gå till fliken **Allmänt**
2. Klicka på **Redigera** i avsnittet **SAML-inställningar** och klicka på **Nästa** för att komma till SAML-inställningarna
3. I avsnittet **Attribututtryck**, lägg till:

| Namn        | Värde            |
| ----------- | ---------------- |
| `email`     | `user.email`     |
| `firstName` | `user.firstName` |
| `lastName`  | `user.lastName`  |

4. Klicka på **Nästa** och sedan **Slutför**

### Steg 5: Tilldela användare och grupper

1. I ditt Okta-program, gå till fliken **Tilldelningar**
2. Klicka på **Tilldela** > **Tilldela till personer** eller **Tilldela till grupper**
3. Välj de användare eller grupper du vill bevilja SSO-åtkomst
4. Klicka på **Tilldela** för varje val och sedan **Klar**

### Steg 6: Verifiera konfigurationen

1. Spara alla inställningar i både Okta och OneUptime
2. Försök logga in på OneUptime med SSO
3. Du bör omdirigeras till Oktas inloggningssida och tillbaka till OneUptime efter lyckad autentisering

### Felsökning av Okta

- **404 eller ogiltig SSO-URL**: Verifiera att **Single sign-on-URL** i Okta exakt matchar **Svars-URL** från OneUptime
- **Audience-mismatch**: Se till att **Audience URI** i Okta exakt matchar **Identifieraren (Entity ID)** från OneUptime
- **Certifikatfel**: Se till att du laddade ned certifikatet för det **aktiva** signeringscertifikatet, inte ett inaktivt
- **Användaren är inte tilldelad**: Användare måste tilldelas Okta-programmet innan de kan logga in via SSO
- **Name ID-fel**: Verifiera att **Name ID-format** är inställt på `EmailAddress` och **Programanvändarnamn** är inställt på `Email`

---

## Andra identitetsleverantörer

OneUptimes SSO-implementering använder SAML 2.0-protokollet och bör fungera med vilken kompatibel identitetsleverantör som helst. De allmänna konfigurationsstegen är:

1. I OneUptime, skapa en SSO-konfiguration och notera **Identifieraren (Entity ID)** och **Svars-URL (Assertion Consumer Service URL)** från knappen **Visa SSO-konfiguration**
2. I din identitetsleverantör, skapa ett SAML-program med:
   - **Assertion Consumer Service URL / Svars-URL**: Från OneUptime SSO-konfiguration
   - **Entity ID / Audience URI**: Från OneUptime SSO-konfiguration
   - **Name ID-format**: E-postadress
3. Från din identitetsleverantör, kopiera följande till OneUptime:
   - **Inloggnings-URL** (SSO-slutpunkt)
   - **Utgivare** (Entity ID för IdP:n)
   - **Offentligt certifikat** (X.509-signeringscertifikat)
4. Ange **Signaturalgoritm** till `RSA-SHA-256` och **Digest-algoritm** till `SHA256`

## Noteringar om SSO och roller

OneUptime stöder för närvarande inte mappning av SAML-roller från din identitetsleverantör. Rollbaserad åtkomst måste konfigureras separat inom OneUptimes **Projektinställningar** > **SSO**, där du kan tilldela standardroller för SSO-användare.
