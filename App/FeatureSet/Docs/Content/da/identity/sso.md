# SSO (Single Sign-On)

OneUptime understøtter SAML 2.0-baseret Single Sign-On (SSO) til enterprise-autentificering. SSO giver dine teammedlemmer mulighed for at logge ind på OneUptime ved hjælp af din organisations identitetsudbyder (IdP), hvilket giver centraliseret adgangsstyring og forbedret sikkerhed.

## Oversigt

SSO-integration giver følgende fordele:

- **Centraliseret autentificering**: Brugere logger ind med deres eksisterende virksomhedslegitimationsoplysninger
- **Forbedret sikkerhed**: Udnyt din IdPs multifaktorgodkendelse og sikkerhedspolitikker
- **Forenklet brugeradministration**: Administrer adgang fra dit eksisterende identitetsstyringssystem
- **Reduceret adgangskodetræthed**: Brugere behøver ikke huske en separat OneUptime-adgangskode

## Opsætning af SSO

1. **Naviger til projektindstillinger**
   - Gå til dit OneUptime-projekt
   - Naviger til **Projektindstillinger** > **Autentificering** > **SSO**

2. **Opret SSO-konfiguration**
   - Klik på **Opret SSO**
   - Indtast et **Navn** til SSO-konfigurationen (f.eks. "Keycloak SAML" eller "Okta SAML")
   - Indtast **Sign On URL** fra din identitetsudbyder
   - Indtast **Udsteder** (Entity ID) fra din identitetsudbyder
   - Indsæt **Offentligt certifikat** fra din identitetsudbyder
   - Vælg **Signaturalgoritme** (f.eks. `RSA-SHA-256`)
   - Vælg **Digest-algoritme** (f.eks. `SHA256`)

3. **Hent OneUptime SSO-metadata**
   - Efter gemning skal du klikke på knappen **Vis SSO-konfiguration**
   - Kopiér **Identifikator (Entity ID)** – dette er nødvendigt i din IdP-konfiguration
   - Kopiér **Svar-URL (Assertion Consumer Service URL)** – dette er nødvendigt i din IdP-konfiguration

## Keycloak SAML-konfiguration

Keycloak er en populær open source-identitets- og adgangsstyringsløsning. Følg disse trin for at konfigurere Keycloak som din SAML-identitetsudbyder til OneUptime.

### Forudsætninger

- En kørende Keycloak-instans med et konfigureret realm
- Administratoradgang til både Keycloak og OneUptime
- OneUptime-konto med SSO-understøttelse

### Trin 1: Konfigurer OneUptime SSO

1. Log ind på dit OneUptime-dashboard
2. Naviger til **Projektindstillinger** > **Autentificering** > **SSO**
3. Klik på **Opret SSO** og udfyld følgende:
   - **Navn**: Et beskrivende navn (f.eks. `my-project-oneuptime`)
   - **Sign On URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Udsteder**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certifikat**: Se [Trin 2](#trin-2-hent-keycloak-certifikatet) nedenfor
   - **Signaturalgoritme**: `RSA-SHA-256`
   - **Digest-algoritme**: `SHA256`
4. Gem konfigurationen

### Trin 2: Hent Keycloak-certifikatet

1. I Keycloak skal du navigere til din klientkonfiguration
2. Klik på **Eksporter** (eller gå til fanen **Nøgler** afhængigt af din Keycloak-version)
3. I den eksporterede JSON-fil skal du finde nøglen med `certificate` i navnet
4. Kopiér certifikatværdien og indsæt den i OneUptime i følgende format:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Trin 3: Konfigurer Keycloak-klient

1. I Keycloak skal du navigere til **Klienter** i dit realm
2. Opret en ny klient eller rediger en eksisterende
3. Sæt **Klientprotokol** til `saml`
4. Sæt **Klient-ID** til **Identifikator (Entity ID)**-værdien fra OneUptimes **Vis SSO-konfiguration**
5. Sæt **Gyldige omdirigerings-URI'er** til din OneUptime-URL
6. Sæt **Root URL** til din OneUptime-basis-URL
7. Indsæt **Svar-URL (Assertion Consumer Service URL)** fra OneUptime i feltet **Assertion Consumer Service POST Binding URL**

### Trin 4: Konfigurer Keycloak-klientindstillinger

1. Deaktiver **Signing keys config** (under fanen Nøgler)
2. Sæt **Name ID Format** til `email`
3. Sørg for, at indstillingen **Force Name ID Format** er aktiveret, så Keycloak altid sender e-mailen som Name ID

### Trin 5: Bekræft konfigurationen

1. Gem alle indstillinger i både Keycloak og OneUptime
2. Prøv at logge ind på OneUptime ved hjælp af SSO
3. Du bør blive omdirigeret til din Keycloak-loginside og tilbage til OneUptime efter vellykket autentificering

### Fejlfinding af Keycloak

- **Login mislykkes med signaturefejl**: Sørg for, at certifikatet er korrekt kopieret, inklusive linjerne `BEGIN CERTIFICATE` og `END CERTIFICATE`
- **Name ID-fejl**: Bekræft, at **Name ID Format** er sat til `email` i Keycloak
- **Omdirigeringsløkke**: Kontroller, at **Gyldige omdirigerings-URI'er** og **Assertion Consumer Service POST Binding URL** er korrekt konfigureret
- **Certifikat ikke fundet**: Sørg for, at du eksporterer fra den korrekte klient i det korrekte realm

---

## Microsoft Entra ID (tidligere Azure AD / Active Directory) SAML-konfiguration

Microsoft Entra ID er Microsofts skybaserede identitets- og adgangsstyringstjeneste. Følg disse trin for at konfigurere Entra ID som din SAML-identitetsudbyder til OneUptime.

### Forudsætninger

- Microsoft Entra ID-lejer (enhver tier der understøtter enterprise-applikationer med SAML SSO)
- Administratoradgang til både Microsoft Entra ID og OneUptime
- OneUptime-konto med SSO-understøttelse

### Trin 1: Konfigurer OneUptime SSO

1. Log ind på dit OneUptime-dashboard
2. Naviger til **Projektindstillinger** > **Autentificering** > **SSO**
3. Klik på **Opret SSO** og udfyld følgende:
   - **Navn**: Et beskrivende navn (f.eks. `Azure AD SAML`)
   - **Sign On URL**: Du henter dette fra Entra ID i [Trin 3](#trin-3-kopier-entra-id-saml-metadata-til-oneuptime)
   - **Udsteder**: Du henter dette fra Entra ID i [Trin 3](#trin-3-kopier-entra-id-saml-metadata-til-oneuptime)
   - **Certifikat**: Du henter dette fra Entra ID i [Trin 3](#trin-3-kopier-entra-id-saml-metadata-til-oneuptime)
   - **Signaturalgoritme**: `RSA-SHA-256`
   - **Digest-algoritme**: `SHA256`
4. Klik på **Vis SSO-konfiguration** og kopiér **Identifikator (Entity ID)** og **Svar-URL (Assertion Consumer Service URL)** – du skal bruge disse til Entra ID

### Trin 2: Opret enterprise-applikation i Microsoft Entra ID

1. Log ind på [Microsoft Entra-administrationscentret](https://entra.microsoft.com)
2. Naviger til **Identitet** > **Applikationer** > **Enterprise-applikationer**
3. Klik på **+ Ny applikation**
4. Klik på **+ Opret din egen applikation**
5. Indtast et navn (f.eks. "OneUptime")
6. Vælg **Integrer enhver anden applikation, du ikke finder i galleriet (ikke-galleri)**
7. Klik på **Opret**

### Trin 3: Konfigurer SAML SSO i Entra ID

1. I din nye enterprise-applikation skal du gå til **Enkeltlogon**
2. Vælg **SAML** som enkeltlogon-metode
3. I **Grundlæggende SAML-konfiguration** skal du klikke på **Rediger** og angive:
   - **Identifikator (Entity ID)**: Indsæt **Identifikator (Entity ID)** fra OneUptimes **Vis SSO-konfiguration**
   - **Svar-URL (Assertion Consumer Service URL)**: Indsæt **Svar-URL** fra OneUptimes **Vis SSO-konfiguration**
4. Klik på **Gem**
5. I afsnittet **SAML-certifikater**:
   - Download **Certifikat (Base64)**
   - Åbn den downloadede certifikatfil i en teksteditor og kopiér indholdet
6. I afsnittet **Konfigurer OneUptime** skal du kopiere:
   - **Login URL** – indsæt dette som **Sign On URL** i OneUptime
   - **Azure AD-identifikator** – indsæt dette som **Udsteder** i OneUptime
7. Gå tilbage til OneUptime og indsæt certifikatet og URL'erne, og gem derefter

### Trin 4: Konfigurer brugerattributter og krav

1. På SAML-konfigurationssiden skal du klikke på **Rediger** i **Attributter og krav**
2. Sørg for, at følgende krav er konfigureret:

| Kravnavn | Værdi |
|-----------|-------|
| `Unique User Identifier (Name ID)` | `user.userprincipalname` eller `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

3. Sæt **Name identifier format** til `Email address`
4. Klik på **Gem**

### Trin 5: Tildel brugere og grupper

1. I din enterprise-applikation skal du gå til **Brugere og grupper**
2. Klik på **+ Tilføj bruger/gruppe**
3. Vælg de brugere og/eller grupper, du vil give SSO-adgang
4. Klik på **Tildel**

### Trin 6: Bekræft konfigurationen

1. Gem alle indstillinger i både Entra ID og OneUptime
2. Prøv at logge ind på OneUptime ved hjælp af SSO
3. Du bør blive omdirigeret til Microsoft-loginsiden og tilbage til OneUptime efter vellykket autentificering

### Fejlfinding af Microsoft Entra ID

- **AADSTS700016-fejl**: Identifikator (Entity ID) i Entra ID stemmer ikke overens med OneUptime – bekræft, at begge værdier er identiske
- **Certifikatfejl**: Sørg for, at du downloadede **Base64**-certifikatet (ikke råt/binært format) og inkluderede linjerne `BEGIN CERTIFICATE` / `END CERTIFICATE`
- **Bruger ikke tildelt**: Brugere skal eksplicit tildeles enterprise-applikationen, inden de kan logge ind via SSO
- **Name ID-mismatch**: Sørg for, at Name ID-kravet er sat til en e-mailadresse, der matcher brugerens e-mail i OneUptime

---

## Okta SAML-konfiguration

Okta er en bredt anvendt identitetsplatform, der leverer robuste SAML SSO-kapaciteter. Følg disse trin for at konfigurere Okta som din SAML-identitetsudbyder til OneUptime.

### Forudsætninger

- Okta-organisation med administratoradgang
- OneUptime-konto med SSO-understøttelse

### Trin 1: Konfigurer OneUptime SSO

1. Log ind på dit OneUptime-dashboard
2. Naviger til **Projektindstillinger** > **Autentificering** > **SSO**
3. Klik på **Opret SSO** og udfyld følgende:
   - **Navn**: Et beskrivende navn (f.eks. `Okta SAML`)
   - **Sign On URL**: Du henter dette fra Okta i [Trin 3](#trin-3-kopier-okta-saml-metadata-til-oneuptime)
   - **Udsteder**: Du henter dette fra Okta i [Trin 3](#trin-3-kopier-okta-saml-metadata-til-oneuptime)
   - **Certifikat**: Du henter dette fra Okta i [Trin 3](#trin-3-kopier-okta-saml-metadata-til-oneuptime)
   - **Signaturalgoritme**: `RSA-SHA-256`
   - **Digest-algoritme**: `SHA256`
4. Klik på **Vis SSO-konfiguration** og kopiér **Identifikator (Entity ID)** og **Svar-URL (Assertion Consumer Service URL)** – du skal bruge disse til Okta

### Trin 2: Opret SAML-applikation i Okta

1. Log ind på din Okta Admin Console
2. Naviger til **Applikationer** > **Applikationer**
3. Klik på **Opret app-integration**
4. Vælg **SAML 2.0** og klik på **Næste**
5. Indtast "OneUptime" som **App-navn** og klik på **Næste**
6. I afsnittet **SAML-indstillinger** skal du konfigurere:
   - **Single sign-on URL**: Indsæt **Svar-URL (Assertion Consumer Service URL)** fra OneUptimes **Vis SSO-konfiguration**
   - **Audience URI (SP Entity ID)**: Indsæt **Identifikator (Entity ID)** fra OneUptimes **Vis SSO-konfiguration**
   - **Name ID format**: Vælg `EmailAddress`
   - **Applikationsbrugernavn**: Vælg `Email`
7. Klik på **Næste**, vælg derefter **Jeg er en Okta-kunde, der tilføjer en intern app**, og klik på **Udfør**

### Trin 3: Kopiér Okta SAML-metadata til OneUptime

1. I din Okta-applikation skal du gå til fanen **Sign On**
2. I afsnittet **SAML-signeringscertifikater** skal du finde det aktive certifikat og klikke på **Handlinger** > **Vis IdP-metadata**
3. Fra metadata-XML eller fra fanens **Sign On**-detaljer:
   - Kopiér **Sign On URL** (også kaldet **Identity Provider Single Sign-On URL**) – indsæt dette som **Sign On URL** i OneUptime
   - Kopiér **Udsteder** (også kaldet **Identity Provider Issuer**) – indsæt dette som **Udsteder** i OneUptime
4. Download signeringscertifikatet:
   - I afsnittet **SAML-signeringscertifikater** skal du klikke på **Handlinger** > **Download certifikat** for det aktive certifikat
   - Åbn den downloadede `.cert`-fil i en teksteditor og kopiér indholdet
   - Indsæt certifikatet i OneUptime (inklusive linjerne `BEGIN CERTIFICATE` og `END CERTIFICATE`)
5. Gem OneUptime SSO-konfigurationen

### Trin 4: Konfigurer attributudsagn (valgfrit)

1. I Okta-applikationen skal du gå til fanen **Generelt**
2. Klik på **Rediger** i afsnittet **SAML-indstillinger** og klik på **Næste** for at nå SAML-indstillingerne
3. I afsnittet **Attributudsagn** skal du tilføje:

| Navn | Værdi |
|------|-------|
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

4. Klik på **Næste** og derefter **Udfør**

### Trin 5: Tildel brugere og grupper

1. I din Okta-applikation skal du gå til fanen **Tildelinger**
2. Klik på **Tildel** > **Tildel til personer** eller **Tildel til grupper**
3. Vælg de brugere eller grupper, du vil give SSO-adgang
4. Klik på **Tildel** for hvert valg, og klik derefter på **Udført**

### Trin 6: Bekræft konfigurationen

1. Gem alle indstillinger i både Okta og OneUptime
2. Prøv at logge ind på OneUptime ved hjælp af SSO
3. Du bør blive omdirigeret til Okta-loginsiden og tilbage til OneUptime efter vellykket autentificering

### Fejlfinding af Okta

- **404 eller ugyldig SSO URL**: Bekræft, at **Single sign-on URL** i Okta matcher **Svar-URL** fra OneUptime nøjagtigt
- **Audience-mismatch**: Sørg for, at **Audience URI** i Okta matcher **Identifikator (Entity ID)** fra OneUptime nøjagtigt
- **Certifikatfejl**: Sørg for, at du downloadede certifikatet til det **aktive** signeringscertifikat, ikke et inaktivt
- **Bruger ikke tildelt**: Brugere skal tildeles Okta-applikationen, inden de kan logge ind via SSO
- **Name ID-fejl**: Bekræft, at **Name ID format** er sat til `EmailAddress`, og at **Applikationsbrugernavn** er sat til `Email`

---

## Andre identitetsudbydere

OneUptimes SSO-implementering bruger SAML 2.0-protokollen og bør fungere med enhver kompatibel identitetsudbyder. De generelle konfigurationstrin er:

1. I OneUptime skal du oprette en SSO-konfiguration og notere **Identifikator (Entity ID)** og **Svar-URL (Assertion Consumer Service URL)** fra knappen **Vis SSO-konfiguration**
2. I din identitetsudbyder skal du oprette en SAML-applikation med:
   - **Assertion Consumer Service URL / Svar-URL**: Fra OneUptime SSO-konfiguration
   - **Entity ID / Audience URI**: Fra OneUptime SSO-konfiguration
   - **Name ID Format**: E-mailadresse
3. Fra din identitetsudbyder skal du kopiere følgende til OneUptime:
   - **Sign On URL** (SSO-endpoint)
   - **Udsteder** (IdP'ens Entity ID)
   - **Offentligt certifikat** (X.509-signeringscertifikat)
4. Sæt **Signaturalgoritme** til `RSA-SHA-256` og **Digest-algoritme** til `SHA256`

## Noter om SSO og roller

OneUptime understøtter i øjeblikket ikke tilknytning af SAML-roller fra din identitetsudbyder. Rollebaseret adgang skal konfigureres separat i OneUptimes **Projektindstillinger** > **SSO**-indstillinger, hvor du kan tildele standardroller til SSO-brugere.
