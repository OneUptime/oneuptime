# SCIM (System for Cross-domain Identity Management)

OneUptime støtter SCIM v2.0-protokollen for automatisert brukerklargjøring og avklargjøring. SCIM gjør det mulig for identitetsleverandører (IdP-er) som Azure AD, Okta og andre identitetssystemer for bedrifter å automatisk administrere brukertilgang til OneUptime-prosjekter og statussider.

## Oversikt

SCIM-integrasjon gir følgende fordeler:

- **Automatisert brukerklargjøring**: Opprett automatisk brukere i OneUptime når de tildeles i IdP-en din
- **Automatisert brukeravklargjøring**: Fjern automatisk brukere fra OneUptime når de fratildelses i IdP-en din
- **Synkronisering av brukerattributter**: Hold brukerinformasjonen synkronisert mellom IdP-en og OneUptime
- **Sentralisert tilgangsstyring**: Administrer OneUptime-tilgang fra det eksisterende identitetsstyringssystemet ditt

## SCIM for prosjekter

Prosjekt-SCIM lar identitetsleverandører administrere teammedlemmer innenfor OneUptime-prosjekter.

### Konfigurere prosjekt-SCIM

1. **Naviger til prosjektinnstillinger**
   - Gå til OneUptime-prosjektet ditt
   - Naviger til **Prosjektinnstillinger** > **Team** > **SCIM**

2. **Konfigurer SCIM-innstillinger**
   - Aktiver **Automatisk brukerklargjøring** for å legge til brukere automatisk når de tildeles i IdP-en
   - Aktiver **Automatisk brukeravklargjøring** for å fjerne brukere automatisk når de fratildelses i IdP-en
   - Velg **Standardteam** som nye brukere skal legges til i
   - Kopier **SCIM-basis-URL** og **Bearer-token** for IdP-konfigurasjonen

3. **Konfigurer identitetsleverandøren din**
   - Bruk SCIM-basis-URL: `https://oneuptime.com/scim/v2/{scimId}`
   - Konfigurer bearer-tokenautentisering med det angitte tokenet
   - Kartlegg brukerattributter (e-post er påkrevd)

### Prosjekt-SCIM-endepunkter

- **Tjenesteleverandørkonfig**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Skjemaer**: `GET /scim/v2/{scimId}/Schemas`
- **Ressurstyper**: `GET /scim/v2/{scimId}/ResourceTypes`
- **List brukere**: `GET /scim/v2/{scimId}/Users`
- **Hent bruker**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Opprett bruker**: `POST /scim/v2/{scimId}/Users`
- **Oppdater bruker**: `PUT /scim/v2/{scimId}/Users/{userId}` eller `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Slett bruker**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **List grupper**: `GET /scim/v2/{scimId}/Groups`
- **Hent gruppe**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Opprett gruppe**: `POST /scim/v2/{scimId}/Groups`
- **Oppdater gruppe**: `PUT /scim/v2/{scimId}/Groups/{groupId}` eller `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Slett gruppe**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Livssyklus for prosjekt-SCIM-bruker

1. **Brukertildeling i IdP**: Når en bruker tildeles OneUptime i IdP-en din
2. **SCIM-klargjøring**: IdP kaller OneUptime SCIM API for å opprette brukeren
3. **Teammedlemskap**: Brukeren legges automatisk til i konfigurerte standardteam
4. **Tilgang gitt**: Brukeren kan nå få tilgang til OneUptime-prosjektet
5. **Brukerfratildeling**: Når brukeren fratildelses i IdP
6. **SCIM-avklargjøring**: IdP kaller OneUptime SCIM API for å fjerne brukeren
7. **Tilgang tilbakekalt**: Brukeren mister tilgang til prosjektet

## SCIM for statussider

Statusside-SCIM lar identitetsleverandører administrere abonnenter på private statussider.

### Konfigurere statusside-SCIM

1. **Naviger til statussideinnstillinger**
   - Gå til OneUptime-statussiden din
   - Naviger til **Statussideinnstillinger** > **Private brukere** > **SCIM**

2. **Konfigurer SCIM-innstillinger**
   - Aktiver **Automatisk brukerklargjøring** for å legge til abonnenter automatisk når de tildeles i IdP-en
   - Aktiver **Automatisk brukeravklargjøring** for å fjerne abonnenter automatisk når de fratildelses i IdP-en
   - Kopier **SCIM-basis-URL** og **Bearer-token** for IdP-konfigurasjonen

3. **Konfigurer identitetsleverandøren din**
   - Bruk SCIM-basis-URL: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Konfigurer bearer-tokenautentisering med det angitte tokenet
   - Kartlegg brukerattributter (e-post er påkrevd)

### Statusside-SCIM-endepunkter

- **Tjenesteleverandørkonfig**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Skjemaer**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Ressurstyper**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **List brukere**: `GET /status-page-scim/v2/{scimId}/Users`
- **Hent bruker**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Opprett bruker**: `POST /status-page-scim/v2/{scimId}/Users`
- **Oppdater bruker**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` eller `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Slett bruker**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Livssyklus for statusside-SCIM-bruker

1. **Brukertildeling i IdP**: Når en bruker tildeles OneUptime-statussiden i IdP-en din
2. **SCIM-klargjøring**: IdP kaller OneUptime SCIM API for å opprette abonnenten
3. **Tilgang gitt**: Brukeren kan nå få tilgang til den private statussiden
4. **Brukerfratildeling**: Når brukeren fratildelses i IdP
5. **SCIM-avklargjøring**: IdP kaller OneUptime SCIM API for å fjerne abonnenten
6. **Tilgang tilbakekalt**: Brukeren mister tilgang til statussiden

## Konfigurasjon av identitetsleverandør

### Microsoft Entra ID (tidligere Azure AD)

Microsoft Entra ID gir identitetsstyring på bedriftsnivå med robuste SCIM-klargjøringsfunksjoner. Følg disse detaljerte trinnene for å konfigurere SCIM-klargjøring med OneUptime.

#### Forutsetninger

- Microsoft Entra ID-leietaker med Premium P1 eller P2-lisens (påkrevd for automatisk klargjøring)
- OneUptime-konto med Scale-plan eller høyere
- Administratortilgang til både Microsoft Entra ID og OneUptime

#### Trinn 1: Hent SCIM-konfigurasjon fra OneUptime

1. Logg inn på OneUptime-dashbordet ditt
2. Naviger til **Prosjektinnstillinger** > **Team** > **SCIM**
3. Klikk **Opprett SCIM-konfigurasjon**
4. Skriv inn et vennlig navn (f.eks. "Microsoft Entra ID Provisioning")
5. Konfigurer følgende alternativer:
   - **Automatisk brukerklargjøring**: Aktiver for å automatisk opprette brukere
   - **Automatisk brukeravklargjøring**: Aktiver for å automatisk fjerne brukere
   - **Standardteam**: Velg team som nye brukere skal legges til i
   - **Aktiver Push Groups**: Aktiver hvis du vil administrere teammedlemskap via Entra ID-grupper
6. Lagre konfigurasjonen
7. Kopier **SCIM-basis-URL** og **Bearer-token** – du trenger disse for Entra ID

#### Trinn 2: Opprett bedriftsapplikasjon i Microsoft Entra ID

1. Logg inn på [Microsoft Entra-administrasjonssenteret](https://entra.microsoft.com)
2. Naviger til **Identitet** > **Applikasjoner** > **Bedriftsapplikasjoner**
3. Klikk **+ Ny applikasjon**
4. Klikk **+ Opprett din egen applikasjon**
5. Skriv inn et navn (f.eks. "OneUptime")
6. Velg **Integrer enhver annen applikasjon du ikke finner i galleriet (ikke-galleri)**
7. Klikk **Opprett**

#### Trinn 3: Konfigurer SCIM-klargjøring

1. I OneUptime-bedriftsapplikasjonen din, gå til **Klargjøring**
2. Klikk **Kom i gang**
3. Sett **Klargjøringsmodus** til **Automatisk**
4. Under **Administratorlegitimasjon**:
   - **Leietaker-URL**: Skriv inn SCIM-basis-URL fra OneUptime (f.eks. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Hemmelig token**: Skriv inn Bearer-tokenet fra OneUptime
5. Klikk **Test tilkobling** for å bekrefte konfigurasjonen
6. Klikk **Lagre**

#### Trinn 4: Konfigurer attributtkartlegginger

1. I klargjøringsdelen, klikk **Kartlegginger**
2. Klikk **Klargjør Azure Active Directory-brukere**
3. Konfigurer følgende attributtkartlegginger:

| Azure AD-attributt | OneUptime SCIM-attributt | Påkrevd |
|--------------------|--------------------------|---------|
| `userPrincipalName` | `userName` | Ja |
| `mail` | `emails[type eq "work"].value` | Anbefalt |
| `displayName` | `displayName` | Anbefalt |
| `givenName` | `name.givenName` | Valgfritt |
| `surname` | `name.familyName` | Valgfritt |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | Anbefalt |

4. Fjern kartlegginger som ikke er nødvendige for å forenkle klargjøringen
5. Klikk **Lagre**

#### Trinn 5: Konfigurer gruppeklargjøring (valgfritt)

Hvis du aktiverte **Push Groups** i OneUptime:

1. Gå tilbake til **Kartlegginger**
2. Klikk **Klargjør Azure Active Directory-grupper**
3. Aktiver gruppeklargjøring ved å sette **Aktivert** til **Ja**
4. Konfigurer følgende attributtkartlegginger:

| Azure AD-attributt | OneUptime SCIM-attributt |
|--------------------|--------------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. Klikk **Lagre**

#### Trinn 6: Tildel brukere og grupper

1. I OneUptime-bedriftsapplikasjonen din, gå til **Brukere og grupper**
2. Klikk **+ Legg til bruker/gruppe**
3. Velg brukerne og/eller gruppene du vil klargjøre til OneUptime
4. Klikk **Tildel**

#### Trinn 7: Start klargjøring

1. Gå til **Klargjøring** > **Oversikt**
2. Klikk **Start klargjøring**
3. Den første klargjøringssyklusen begynner (dette kan ta opptil 40 minutter for den første synkroniseringen)
4. Overvåk **Klargjøringslogger** for eventuelle feil

#### Feilsøking for Microsoft Entra ID

- **Test av tilkobling mislykkes**: Bekreft at SCIM-basis-URL inkluderer `/api/identity`-prefikset og at Bearer-tokenet er riktig
- **Brukere klargjøres ikke**: Sjekk at brukere er tildelt applikasjonen og at attributtkartlegginger er riktige
- **Klargjøringsfeil**: Gjennomgå klargjøringsloggene i Entra ID for spesifikke feilmeldinger
- **Synkroniseringsforsinkelser**: Første klargjøring kan ta opptil 40 minutter; påfølgende synkroniseringer skjer hvert 40. minutt

---

### Okta

Okta gir fleksibel identitetsstyring med utmerket SCIM-støtte. Følg disse detaljerte trinnene for å konfigurere SCIM-klargjøring med OneUptime.

#### Forutsetninger

- Okta-leietaker med klargjøringsfunksjoner (Lifecycle Management-funksjon)
- OneUptime-konto med Scale-plan eller høyere
- Administratortilgang til både Okta og OneUptime

#### Trinn 1: Hent SCIM-konfigurasjon fra OneUptime

1. Logg inn på OneUptime-dashbordet ditt
2. Naviger til **Prosjektinnstillinger** > **Team** > **SCIM**
3. Klikk **Opprett SCIM-konfigurasjon**
4. Skriv inn et vennlig navn (f.eks. "Okta Provisioning")
5. Konfigurer følgende alternativer:
   - **Automatisk brukerklargjøring**: Aktiver for å automatisk opprette brukere
   - **Automatisk brukeravklargjøring**: Aktiver for å automatisk fjerne brukere
   - **Standardteam**: Velg team som nye brukere skal legges til i
   - **Aktiver Push Groups**: Aktiver hvis du vil administrere teammedlemskap via Okta-grupper
6. Lagre konfigurasjonen
7. Kopier **SCIM-basis-URL** og **Bearer-token** – du trenger disse for Okta

#### Trinn 2: Opprett eller konfigurer Okta-applikasjon

**Hvis du har en eksisterende SSO-applikasjon:**
1. Logg inn på Okta Admin Console
2. Naviger til **Applikasjoner** > **Applikasjoner**
3. Finn og velg den eksisterende OneUptime-applikasjonen din

**Hvis du oppretter en ny applikasjon:**
1. Logg inn på Okta Admin Console
2. Naviger til **Applikasjoner** > **Applikasjoner**
3. Klikk **Opprett appintegrasjon**
4. Velg **SAML 2.0** og klikk **Neste**
5. Skriv inn "OneUptime" som appnavn
6. Fullfør SAML-konfigurasjonen (se SSO-dokumentasjonen)
7. Klikk **Fullfør**

#### Trinn 3: Aktiver SCIM-klargjøring

1. I OneUptime-applikasjonen din, gå til fanen **Generelt**
2. I seksjonen **Appinnstillinger**, klikk **Rediger**
3. Under **Klargjøring**, velg **SCIM**
4. Klikk **Lagre**
5. En ny fane for **Klargjøring** vises

#### Trinn 4: Konfigurer SCIM-tilkobling

1. Gå til fanen **Klargjøring**
2. Klikk **Integrasjon** i venstre sidefelt
3. Klikk **Konfigurer API-integrasjon**
4. Huk av **Aktiver API-integrasjon**
5. Konfigurer følgende:
   - **SCIM-konnektorbasis-URL**: Skriv inn SCIM-basis-URL fra OneUptime (f.eks. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Unikt identifikasjonsfelt for brukere**: Skriv inn `userName`
   - **Støttede klargjøringshandlinger**: Velg handlingene du vil aktivere:
     - Importer nye brukere og profiloppdateringer
     - Push nye brukere
     - Push profiloppdateringer
     - Push grupper (hvis du bruker gruppebasert klargjøring)
   - **Autentiseringsmodus**: Velg **HTTP-overskrift**
   - **Autorisasjon**: Skriv inn `Bearer {your-bearer-token}` (erstatt med faktisk token)
6. Klikk **Test API-legitimasjon** for å bekrefte tilkoblingen
7. Klikk **Lagre**

#### Trinn 5: Konfigurer klargjøring til app

1. I fanen **Klargjøring**, klikk **Til app** i venstre sidefelt
2. Klikk **Rediger**
3. Aktiver følgende alternativer:
   - **Opprett brukere**: Aktiver for å klargjøre nye brukere
   - **Oppdater brukerattributter**: Aktiver for å synkronisere attributtendringer
   - **Deaktiver brukere**: Aktiver for å avklargjøre brukere når de fratildelses
4. Klikk **Lagre**

#### Trinn 6: Konfigurer attributtkartlegginger

1. Bla ned til **Attributtkartlegginger**
2. Bekreft eller konfigurer følgende kartlegginger:

| Okta-attributt | OneUptime SCIM-attributt | Retning |
|----------------|--------------------------|---------|
| `userName` | `userName` | Okta til app |
| `user.email` | `emails[primary eq true].value` | Okta til app |
| `user.firstName` | `name.givenName` | Okta til app |
| `user.lastName` | `name.familyName` | Okta til app |
| `user.displayName` | `displayName` | Okta til app |

3. Fjern unødvendige kartlegginger
4. Klikk **Lagre** hvis du har gjort endringer

#### Trinn 7: Konfigurer Push Groups (valgfritt)

Hvis du aktiverte **Push Groups** i OneUptime:

1. Gå til fanen **Push Groups**
2. Klikk **+ Push Groups**
3. Velg **Finn grupper etter navn** eller **Finn grupper etter regel**
4. Søk etter og velg gruppene du vil pushe
5. Klikk **Lagre**

#### Trinn 8: Tildel brukere

1. Gå til fanen **Tildelinger**
2. Klikk **Tildel** > **Tildel til personer** eller **Tildel til grupper**
3. Velg brukerne eller gruppene du vil klargjøre
4. Klikk **Tildel** for hvert valg
5. Klikk **Ferdig**

#### Trinn 9: Bekreft klargjøring

1. Gå til **Rapporter** > **Systemlogg** i Okta Admin Console
2. Filtrer etter hendelser relatert til OneUptime-applikasjonen din
3. Bekreft at klargjøringshendelser er vellykkede
4. Sjekk OneUptime for å bekrefte at brukere er opprettet

#### Feilsøking for Okta

- **Test av API-legitimasjon mislykkes**: Bekreft at SCIM-basis-URL og Bearer-token er riktige
- **Brukere klargjøres ikke**: Sørg for at brukere er tildelt applikasjonen og at klargjøring er aktivert
- **Dupliserte brukere**: Sørg for at `userName`-attributtet er unikt og kartlegges korrekt til e-post
- **Feil ved gruppe-push**: Bekreft at gruppene eksisterer og har riktig medlemskap
- **Feil: 401 Uautorisert**: Generer Bearer-tokenet på nytt i OneUptime og oppdater Okta

---

### Andre identitetsleverandører

OneUptimes SCIM-implementasjon følger SCIM v2.0-spesifikasjonen og skal fungere med alle kompatible identitetsleverandører. Generelle konfigurasjonstrinn:

1. **SCIM-basis-URL**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (for prosjekter) eller `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (for statussider)
2. **Autentisering**: HTTP Bearer-token
3. **Påkrevd brukerattributt**: `userName` (må være en gyldig e-postadresse)
4. **Støttede operasjoner**: GET, POST, PUT, PATCH, DELETE for brukere og grupper

#### Støttede SCIM-endepunkter

| Endepunkt | Metoder | Beskrivelse |
|-----------|---------|-------------|
| `/ServiceProviderConfig` | GET | SCIM-serverkapasiteter |
| `/Schemas` | GET | Tilgjengelige ressursskjemaer |
| `/ResourceTypes` | GET | Tilgjengelige ressurstyper |
| `/Users` | GET, POST | List og opprett brukere |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | Administrer individuelle brukere |
| `/Groups` | GET, POST | List og opprett grupper/team (kun prosjekt-SCIM) |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | Administrer individuelle grupper (kun prosjekt-SCIM) |

#### SCIM-brukerskjema

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true
}
```

#### SCIM-gruppeskjema

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-id-here",
      "display": "user@example.com"
    }
  ]
}
```

## Vanlige spørsmål

### Hva skjer når en bruker avklargjøres?

Når en bruker avklargjøres (enten via DELETE-forespørsel eller ved å sette `active: false`), fjernes de fra teamene konfigurert i SCIM-innstillingene. Brukerkontoen forblir i OneUptime, men mister tilgang til prosjektet.

### Kan jeg bruke SCIM uten SSO?

Ja, SCIM og SSO er uavhengige funksjoner. Du kan bruke SCIM for brukerklargjøring mens brukere logger inn med OneUptime-passordene sine eller en annen autentiseringsmetode.

### Hvordan håndterer jeg brukere som allerede finnes i OneUptime?

Når SCIM prøver å opprette en bruker som allerede finnes (matchet etter e-post), vil OneUptime ganske enkelt legge dem til de konfigurerte standardteamene fremfor å opprette en duplikatbruker.

### Hva er forskjellen mellom standardteam og push-grupper?

- **Standardteam**: Alle brukere som klargjøres via SCIM legges til de samme forhåndsdefinerte teamene
- **Push-grupper**: Teammedlemskap administreres av identitetsleverandøren din, slik at ulike brukere kan være i ulike team basert på IdP-gruppemedlemskap

### Hvor ofte skjer klargjøringssynkronisering?

Dette avhenger av identitetsleverandøren din:
- **Microsoft Entra ID**: Første synkronisering kan ta opptil 40 minutter; påfølgende synkroniseringer hvert 40. minutt
- **Okta**: Nær sanntid for de fleste operasjoner, med periodiske fullstendige synkroniseringer
