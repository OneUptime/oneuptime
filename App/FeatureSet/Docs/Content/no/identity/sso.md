# SSO (Single Sign-On)

OneUptime støtter SAML 2.0-basert Single Sign-On (SSO) for bedriftsautentisering. SSO lar teammedlemmene dine logge inn på OneUptime med organisasjonens identitetsleverandør (IdP), noe som gir sentralisert tilgangsstyring og forbedret sikkerhet.

## Oversikt

SSO-integrasjon gir følgende fordeler:

- **Sentralisert autentisering**: Brukere logger inn med eksisterende bedriftslegitimasjon
- **Forbedret sikkerhet**: Utnytt IdP-ens multifaktorautentisering og sikkerhetspolicyer
- **Forenklet brukeradministrasjon**: Administrer tilgang fra det eksisterende identitetsstyringssystemet ditt
- **Redusert passordtretthet**: Brukere trenger ikke å huske et separat OneUptime-passord

## Konfigurere SSO

1. **Naviger til prosjektinnstillinger**
   - Gå til OneUptime-prosjektet ditt
   - Naviger til **Prosjektinnstillinger** > **Autentisering** > **SSO**

2. **Opprett SSO-konfigurasjon**
   - Klikk **Opprett SSO**
   - Skriv inn et **Navn** for SSO-konfigurasjonen (f.eks. "Keycloak SAML" eller "Okta SAML")
   - Skriv inn **Innloggings-URL** fra identitetsleverandøren din
   - Skriv inn **Utsteder** (Entity ID) fra identitetsleverandøren din
   - Lim inn **Offentlig sertifikat** fra identitetsleverandøren din
   - Velg **Signaturalgoritme** (f.eks. `RSA-SHA-256`)
   - Velg **Sammendragsalgoritme** (f.eks. `SHA256`)

3. **Hent OneUptime SSO-metadata**
   - Etter lagring, klikk knappen **Vis SSO-konfig**
   - Kopier **Identifikator (Entity ID)** – dette er nødvendig i IdP-konfigurasjonen din
   - Kopier **Svar-URL (Assertion Consumer Service URL)** – dette er nødvendig i IdP-konfigurasjonen din

## Keycloak SAML-konfigurasjon

Keycloak er en populær åpen kildekode-løsning for identitets- og tilgangsstyring. Følg disse trinnene for å konfigurere Keycloak som SAML-identitetsleverandør for OneUptime.

### Forutsetninger

- En kjørende Keycloak-instans med et konfigurert realm
- Administratortilgang til både Keycloak og OneUptime
- OneUptime-konto med SSO-støtte

### Trinn 1: Konfigurer OneUptime SSO

1. Logg inn på OneUptime-dashbordet ditt
2. Naviger til **Prosjektinnstillinger** > **Autentisering** > **SSO**
3. Klikk **Opprett SSO** og fyll inn følgende:
   - **Navn**: Et beskrivende navn (f.eks. `my-project-oneuptime`)
   - **Innloggings-URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Utsteder**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Sertifikat**: Se [Trinn 2](#trinn-2-hent-keycloak-sertifikatet) nedenfor
   - **Signaturalgoritme**: `RSA-SHA-256`
   - **Sammendragsalgoritme**: `SHA256`
4. Lagre konfigurasjonen

### Trinn 2: Hent Keycloak-sertifikatet

1. I Keycloak, naviger til klientkonfigurasjonen din
2. Klikk **Eksporter** (eller gå til fanen **Nøkler** avhengig av Keycloak-versjonen)
3. I den eksporterte JSON-filen, finn nøkkelen med `certificate` i navnet
4. Kopier sertifikatverdien og lim den inn i OneUptime i følgende format:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Trinn 3: Konfigurer Keycloak-klient

1. I Keycloak, naviger til **Klienter** i realmet ditt
2. Opprett en ny klient eller rediger en eksisterende
3. Sett **Klientprotokoll** til `saml`
4. Sett **Klient-ID** til verdien **Identifikator (Entity ID)** fra OneUptimes **Vis SSO-konfig**
5. Sett **Gyldige omdirigerings-URI-er** til OneUptime-URL-en din
6. Sett **Rot-URL** til din OneUptime-basis-URL
7. Lim inn **Svar-URL (Assertion Consumer Service URL)** fra OneUptime i feltet **Assertion Consumer Service POST Binding URL**

### Trinn 4: Konfigurer Keycloak-klientinnstillinger

1. Deaktiver **Konfigurering av signeringsnøkler** (under fanen Nøkler)
2. Sett **Name ID-format** til `email`
3. Sørg for at alternativet **Force Name ID Format** er aktivert slik at Keycloak alltid sender e-post som Name ID

### Trinn 5: Bekreft konfigurasjonen

1. Lagre alle innstillinger i både Keycloak og OneUptime
2. Prøv å logge inn på OneUptime med SSO
3. Du bør omdirigeres til Keycloak-innloggingssiden og tilbake til OneUptime etter vellykket autentisering

### Feilsøking av Keycloak

- **Innlogging mislykkes med signaturfesl**: Sørg for at sertifikatet er kopiert korrekt, inkludert linjene `BEGIN CERTIFICATE` og `END CERTIFICATE`
- **Name ID-feil**: Bekreft at **Name ID-format** er satt til `email` i Keycloak
- **Omdirigeringsløkke**: Sjekk at **Gyldige omdirigerings-URI-er** og **Assertion Consumer Service POST Binding URL** er riktig konfigurert
- **Sertifikat ikke funnet**: Sørg for at du eksporterer fra riktig klient i riktig realm

---

## Microsoft Entra ID (tidligere Azure AD / Active Directory) SAML-konfigurasjon

Microsoft Entra ID er Microsofts skybaserte identitets- og tilgangsstyringstjeneste. Følg disse trinnene for å konfigurere Entra ID som SAML-identitetsleverandør for OneUptime.

### Forutsetninger

- Microsoft Entra ID-leietaker (alle nivåer som støtter bedriftsapplikasjoner med SAML SSO)
- Administratortilgang til både Microsoft Entra ID og OneUptime
- OneUptime-konto med SSO-støtte

### Trinn 1: Konfigurer OneUptime SSO

1. Logg inn på OneUptime-dashbordet ditt
2. Naviger til **Prosjektinnstillinger** > **Autentisering** > **SSO**
3. Klikk **Opprett SSO** og fyll inn følgende:
   - **Navn**: Et beskrivende navn (f.eks. `Azure AD SAML`)
   - **Innloggings-URL**: Du henter dette fra Entra ID i [Trinn 3](#trinn-3-kopier-entra-id-saml-metadata-til-oneuptime)
   - **Utsteder**: Du henter dette fra Entra ID i [Trinn 3](#trinn-3-kopier-entra-id-saml-metadata-til-oneuptime)
   - **Sertifikat**: Du henter dette fra Entra ID i [Trinn 3](#trinn-3-kopier-entra-id-saml-metadata-til-oneuptime)
   - **Signaturalgoritme**: `RSA-SHA-256`
   - **Sammendragsalgoritme**: `SHA256`
4. Klikk **Vis SSO-konfig** og kopier **Identifikator (Entity ID)** og **Svar-URL (Assertion Consumer Service URL)** – du trenger disse for Entra ID

### Trinn 2: Opprett bedriftsapplikasjon i Microsoft Entra ID

1. Logg inn på [Microsoft Entra-administrasjonssenteret](https://entra.microsoft.com)
2. Naviger til **Identitet** > **Applikasjoner** > **Bedriftsapplikasjoner**
3. Klikk **+ Ny applikasjon**
4. Klikk **+ Opprett din egen applikasjon**
5. Skriv inn et navn (f.eks. "OneUptime")
6. Velg **Integrer enhver annen applikasjon du ikke finner i galleriet (ikke-galleri)**
7. Klikk **Opprett**

### Trinn 3: Konfigurer SAML SSO i Entra ID

1. I den nye bedriftsapplikasjonen din, gå til **Single sign-on**
2. Velg **SAML** som single sign-on-metode
3. I **Grunnleggende SAML-konfigurasjon**, klikk **Rediger** og sett:
   - **Identifikator (Entity ID)**: Lim inn **Identifikator (Entity ID)** fra OneUptimes **Vis SSO-konfig**
   - **Svar-URL (Assertion Consumer Service URL)**: Lim inn **Svar-URL** fra OneUptimes **Vis SSO-konfig**
4. Klikk **Lagre**
5. I seksjonen **SAML-sertifikater**:
   - Last ned **Sertifikat (Base64)**
   - Åpne den nedlastede sertifikatfilen i en teksteditor og kopier innholdet
6. I seksjonen **Konfigurer OneUptime**, kopier:
   - **Innloggings-URL** – lim dette inn som **Innloggings-URL** i OneUptime
   - **Azure AD-identifikator** – lim dette inn som **Utsteder** i OneUptime
7. Gå tilbake til OneUptime og lim inn sertifikatet og URL-ene, og lagre

### Trinn 4: Konfigurer brukerattributter og krav

1. På SAML-konfigurasjonssiden, klikk **Rediger** på **Attributter og krav**
2. Sørg for at følgende krav er konfigurert:

| Kravnavn | Verdi |
|----------|-------|
| `Unique User Identifier (Name ID)` | `user.userprincipalname` eller `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

3. Sett **Format for navneidentifikator** til `E-postadresse`
4. Klikk **Lagre**

### Trinn 5: Tildel brukere og grupper

1. I bedriftsapplikasjonen din, gå til **Brukere og grupper**
2. Klikk **+ Legg til bruker/gruppe**
3. Velg brukerne og/eller gruppene du vil gi SSO-tilgang
4. Klikk **Tildel**

### Trinn 6: Bekreft konfigurasjonen

1. Lagre alle innstillinger i både Entra ID og OneUptime
2. Prøv å logge inn på OneUptime med SSO
3. Du bør omdirigeres til Microsoft-innloggingssiden og tilbake til OneUptime etter vellykket autentisering

### Feilsøking av Microsoft Entra ID

- **AADSTS700016-feil**: Identifikatoren (Entity ID) i Entra ID stemmer ikke overens med OneUptime – bekreft at begge verdier er identiske
- **Sertifikatfeil**: Sørg for at du lastet ned **Base64**-sertifikatet (ikke råformat/binærformat) og inkluderte linjene `BEGIN CERTIFICATE` / `END CERTIFICATE`
- **Bruker ikke tildelt**: Brukere må eksplisitt tildeles bedriftsapplikasjonen før de kan logge inn via SSO
- **Name ID-mismatch**: Sørg for at Name ID-kravet er satt til en e-postadresse som samsvarer med brukerens e-post i OneUptime

---

## Okta SAML-konfigurasjon

Okta er en mye brukt identitetsplattform som gir robuste SAML SSO-funksjoner. Følg disse trinnene for å konfigurere Okta som SAML-identitetsleverandør for OneUptime.

### Forutsetninger

- Okta-organisasjon med administratortilgang
- OneUptime-konto med SSO-støtte

### Trinn 1: Konfigurer OneUptime SSO

1. Logg inn på OneUptime-dashbordet ditt
2. Naviger til **Prosjektinnstillinger** > **Autentisering** > **SSO**
3. Klikk **Opprett SSO** og fyll inn følgende:
   - **Navn**: Et beskrivende navn (f.eks. `Okta SAML`)
   - **Innloggings-URL**: Du henter dette fra Okta i [Trinn 3](#trinn-3-kopier-okta-saml-metadata-til-oneuptime)
   - **Utsteder**: Du henter dette fra Okta i [Trinn 3](#trinn-3-kopier-okta-saml-metadata-til-oneuptime)
   - **Sertifikat**: Du henter dette fra Okta i [Trinn 3](#trinn-3-kopier-okta-saml-metadata-til-oneuptime)
   - **Signaturalgoritme**: `RSA-SHA-256`
   - **Sammendragsalgoritme**: `SHA256`
4. Klikk **Vis SSO-konfig** og kopier **Identifikator (Entity ID)** og **Svar-URL (Assertion Consumer Service URL)** – du trenger disse for Okta

### Trinn 2: Opprett SAML-applikasjon i Okta

1. Logg inn på Okta Admin Console
2. Naviger til **Applikasjoner** > **Applikasjoner**
3. Klikk **Opprett appintegrasjon**
4. Velg **SAML 2.0** og klikk **Neste**
5. Skriv inn "OneUptime" som **Appnavn** og klikk **Neste**
6. I seksjonen **SAML-innstillinger**, konfigurer:
   - **Single sign-on URL**: Lim inn **Svar-URL (Assertion Consumer Service URL)** fra OneUptimes **Vis SSO-konfig**
   - **Audience URI (SP Entity ID)**: Lim inn **Identifikator (Entity ID)** fra OneUptimes **Vis SSO-konfig**
   - **Name ID-format**: Velg `EmailAddress`
   - **Applikasjonsbrukernavn**: Velg `Email`
7. Klikk **Neste**, velg deretter **Jeg er en Okta-kunde som legger til en intern app** og klikk **Fullfør**

### Trinn 3: Kopier Okta SAML-metadata til OneUptime

1. I Okta-applikasjonen din, gå til fanen **Innlogging**
2. I seksjonen **SAML-signeringssertifikater**, finn det aktive sertifikatet og klikk **Handlinger** > **Vis IdP-metadata**
3. Fra metadata-XML, eller fra detaljene i fanen **Innlogging**:
   - Kopier **Innloggings-URL** (også kalt **Identity Provider Single Sign-On URL**) – lim dette inn som **Innloggings-URL** i OneUptime
   - Kopier **Utsteder** (også kalt **Identity Provider Issuer**) – lim dette inn som **Utsteder** i OneUptime
4. Last ned signeringssertifikatet:
   - I seksjonen **SAML-signeringssertifikater**, klikk **Handlinger** > **Last ned sertifikat** for det aktive sertifikatet
   - Åpne den nedlastede `.cert`-filen i en teksteditor og kopier innholdet
   - Lim inn sertifikatet i OneUptime (inkludert linjene `BEGIN CERTIFICATE` og `END CERTIFICATE`)
5. Lagre OneUptime SSO-konfigurasjonen

### Trinn 4: Konfigurer attributtsetninger (valgfritt)

1. I Okta-applikasjonen din, gå til fanen **Generelt**
2. Klikk **Rediger** i seksjonen **SAML-innstillinger** og klikk **Neste** for å komme til SAML-innstillingene
3. I seksjonen **Attributtsetninger**, legg til:

| Navn | Verdi |
|------|-------|
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

4. Klikk **Neste** og deretter **Fullfør**

### Trinn 5: Tildel brukere og grupper

1. I Okta-applikasjonen din, gå til fanen **Tildelinger**
2. Klikk **Tildel** > **Tildel til personer** eller **Tildel til grupper**
3. Velg brukerne eller gruppene du vil gi SSO-tilgang
4. Klikk **Tildel** for hvert valg, og klikk deretter **Ferdig**

### Trinn 6: Bekreft konfigurasjonen

1. Lagre alle innstillinger i både Okta og OneUptime
2. Prøv å logge inn på OneUptime med SSO
3. Du bør omdirigeres til Okta-innloggingssiden og tilbake til OneUptime etter vellykket autentisering

### Feilsøking av Okta

- **404 eller ugyldig SSO-URL**: Bekreft at **Single sign-on URL** i Okta stemmer nøyaktig overens med **Svar-URL** fra OneUptime
- **Audience-mismatch**: Sørg for at **Audience URI** i Okta stemmer nøyaktig overens med **Identifikator (Entity ID)** fra OneUptime
- **Sertifikatfeil**: Sørg for at du lastet ned sertifikatet for det **aktive** signeringssertifikatet, ikke et inaktivt
- **Bruker ikke tildelt**: Brukere må tildeles Okta-applikasjonen før de kan logge inn via SSO
- **Name ID-feil**: Bekreft at **Name ID-format** er satt til `EmailAddress` og **Applikasjonsbrukernavn** er satt til `Email`

---

## Andre identitetsleverandører

OneUptimes SSO-implementasjon bruker SAML 2.0-protokollen og skal fungere med alle kompatible identitetsleverandører. Generelle konfigurasjonstrinn er:

1. I OneUptime, opprett en SSO-konfigurasjon og noter **Identifikator (Entity ID)** og **Svar-URL (Assertion Consumer Service URL)** fra knappen **Vis SSO-konfig**
2. I identitetsleverandøren din, opprett en SAML-applikasjon med:
   - **Assertion Consumer Service URL / Svar-URL**: Fra OneUptime SSO-konfig
   - **Entity ID / Audience URI**: Fra OneUptime SSO-konfig
   - **Name ID-format**: E-postadresse
3. Fra identitetsleverandøren din, kopier følgende inn i OneUptime:
   - **Innloggings-URL** (SSO-endepunkt)
   - **Utsteder** (Entity ID for IdP)
   - **Offentlig sertifikat** (X.509-signeringssertifikat)
4. Sett **Signaturalgoritme** til `RSA-SHA-256` og **Sammendragsalgoritme** til `SHA256`

## Merknader om SSO og roller

OneUptime støtter for øyeblikket ikke kartlegging av SAML-roller fra identitetsleverandøren din. Rollebasert tilgang må konfigureres separat i OneUptimes **Prosjektinnstillinger** > **SSO**-innstillinger, der du kan tildele standardroller for SSO-brukere.
