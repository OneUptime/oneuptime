# SCIM (System for Cross-domain Identity Management)

OneUptime understøtter SCIM v2.0-protokollen til automatiseret brugerklargøring og -afklargøring. SCIM giver identitetsudbydere (IdP'er) som Azure AD, Okta og andre enterprise-identitetssystemer mulighed for automatisk at administrere brugeradgang til OneUptime-projekter og -statussider.

## Oversigt

SCIM-integration giver følgende fordele:

- **Automatiseret brugerklargøring**: Opret automatisk brugere i OneUptime, når de tildeles i din IdP
- **Automatiseret brugerafklargøring**: Fjern automatisk brugere fra OneUptime, når de fjernes i din IdP
- **Synkronisering af brugerattributter**: Hold brugeroplysninger synkroniseret mellem din IdP og OneUptime
- **Centraliseret adgangsstyring**: Administrer OneUptime-adgang fra dit eksisterende identitetsstyringssystem

## SCIM til projekter

Projekt-SCIM giver identitetsudbydere mulighed for at administrere teammedlemmer i OneUptime-projekter.

### Opsætning af projekt-SCIM

1. **Naviger til projektindstillinger**
   - Gå til dit OneUptime-projekt
   - Naviger til **Projektindstillinger** > **Team** > **SCIM**

2. **Konfigurer SCIM-indstillinger**
   - Aktiver **Auto-klargøring af brugere** for automatisk at tilføje brugere, når de tildeles i din IdP
   - Aktiver **Auto-afklargøring af brugere** for automatisk at fjerne brugere, når de fjernes i din IdP
   - Vælg de **Standardteams**, som nye brugere skal tilføjes til
   - Kopiér **SCIM Base URL** og **Bearer Token** til din IdP-konfiguration

3. **Konfigurer din identitetsudbyder**
   - Brug SCIM Base URL: `https://oneuptime.com/scim/v2/{scimId}`
   - Konfigurer bearer token-autentificering med det medfølgende token
   - Tilknyt brugerattributter (e-mail er påkrævet)

### Projekt-SCIM-endpoints

- **Service Provider Config**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /scim/v2/{scimId}/Users`
- **Get User**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /scim/v2/{scimId}/Users`
- **Update User**: `PUT /scim/v2/{scimId}/Users/{userId}` eller `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **List Groups**: `GET /scim/v2/{scimId}/Groups`
- **Get Group**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Create Group**: `POST /scim/v2/{scimId}/Groups`
- **Update Group**: `PUT /scim/v2/{scimId}/Groups/{groupId}` eller `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Delete Group**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Projekt-SCIM-brugerlivscyklus

1. **Brugertildeling i IdP**: Når en bruger tildeles OneUptime i din IdP
2. **SCIM-klargøring**: IdP kalder OneUptime SCIM API for at oprette brugeren
3. **Teammedlemskab**: Brugeren tilføjes automatisk til konfigurerede standardteams
4. **Adgang givet**: Brugeren kan nu tilgå OneUptime-projektet
5. **Brugerfjernelse**: Når brugeren fjernes i IdP
6. **SCIM-afklargøring**: IdP kalder OneUptime SCIM API for at fjerne brugeren
7. **Adgang tilbagekaldt**: Brugeren mister adgang til projektet

## SCIM til statussider

Statusside-SCIM giver identitetsudbydere mulighed for at administrere abonnenter på private statussider.

### Opsætning af statusside-SCIM

1. **Naviger til statussideindstillinger**
   - Gå til din OneUptime-statusside
   - Naviger til **Statussideindstillinger** > **Private brugere** > **SCIM**

2. **Konfigurer SCIM-indstillinger**
   - Aktiver **Auto-klargøring af brugere** for automatisk at tilføje abonnenter, når de tildeles i din IdP
   - Aktiver **Auto-afklargøring af brugere** for automatisk at fjerne abonnenter, når de fjernes i din IdP
   - Kopiér **SCIM Base URL** og **Bearer Token** til din IdP-konfiguration

3. **Konfigurer din identitetsudbyder**
   - Brug SCIM Base URL: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Konfigurer bearer token-autentificering med det medfølgende token
   - Tilknyt brugerattributter (e-mail er påkrævet)

### Statusside-SCIM-endpoints

- **Service Provider Config**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /status-page-scim/v2/{scimId}/Users`
- **Get User**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /status-page-scim/v2/{scimId}/Users`
- **Update User**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` eller `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Statusside-SCIM-brugerlivscyklus

1. **Brugertildeling i IdP**: Når en bruger tildeles OneUptime-statussiden i din IdP
2. **SCIM-klargøring**: IdP kalder OneUptime SCIM API for at oprette abonnenten
3. **Adgang givet**: Brugeren kan nu tilgå den private statusside
4. **Brugerfjernelse**: Når brugeren fjernes i IdP
5. **SCIM-afklargøring**: IdP kalder OneUptime SCIM API for at fjerne abonnenten
6. **Adgang tilbagekaldt**: Brugeren mister adgang til statussiden

## Konfiguration af identitetsudbyder

### Microsoft Entra ID (tidligere Azure AD)

Microsoft Entra ID leverer enterprise-grade identitetsstyring med robuste SCIM-klargøringskapaciteter. Følg disse detaljerede trin for at konfigurere SCIM-klargøring med OneUptime.

#### Forudsætninger

- Microsoft Entra ID-lejer med Premium P1- eller P2-licens (påkrævet til automatisk klargøring)
- OneUptime-konto med Scale-plan eller højere
- Administratoradgang til både Microsoft Entra ID og OneUptime

#### Trin 1: Hent SCIM-konfiguration fra OneUptime

1. Log ind på dit OneUptime-dashboard
2. Naviger til **Projektindstillinger** > **Team** > **SCIM**
3. Klik på **Opret SCIM-konfiguration**
4. Indtast et brugervenligt navn (f.eks. "Microsoft Entra ID Klargøring")
5. Konfigurer følgende indstillinger:
   - **Auto-klargøring af brugere**: Aktiver for automatisk at oprette brugere
   - **Auto-afklargøring af brugere**: Aktiver for automatisk at fjerne brugere
   - **Standardteams**: Vælg teams, som nye brugere skal tilføjes til
   - **Aktiver Push-grupper**: Aktiver, hvis du vil administrere teammedlemskab via Entra ID-grupper
6. Gem konfigurationen
7. Kopiér **SCIM Base URL** og **Bearer Token** – du skal bruge dem til Entra ID

#### Trin 2: Opret enterprise-applikation i Microsoft Entra ID

1. Log ind på [Microsoft Entra-administrationscentret](https://entra.microsoft.com)
2. Naviger til **Identitet** > **Applikationer** > **Enterprise-applikationer**
3. Klik på **+ Ny applikation**
4. Klik på **+ Opret din egen applikation**
5. Indtast et navn (f.eks. "OneUptime")
6. Vælg **Integrer enhver anden applikation, du ikke finder i galleriet (ikke-galleri)**
7. Klik på **Opret**

#### Trin 3: Konfigurer SCIM-klargøring

1. I din OneUptime-enterprise-applikation skal du gå til **Klargøring**
2. Klik på **Kom i gang**
3. Sæt **Klargøringstilstand** til **Automatisk**
4. Under **Administratorlegitimationsoplysninger**:
   - **Lejer-URL**: Indtast SCIM Base URL fra OneUptime (f.eks. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Hemmeligheds-token**: Indtast Bearer Token fra OneUptime
5. Klik på **Test forbindelse** for at bekræfte konfigurationen
6. Klik på **Gem**

#### Trin 4: Konfigurer attributtilknytninger

1. I klargøringsafsnittet skal du klikke på **Tilknytninger**
2. Klik på **Klargør Azure Active Directory-brugere**
3. Konfigurer følgende attributtilknytninger:

| Azure AD-attribut | OneUptime SCIM-attribut | Påkrævet |
|-------------------|-------------------------|----------|
| `userPrincipalName` | `userName` | Ja |
| `mail` | `emails[type eq "work"].value` | Anbefalet |
| `displayName` | `displayName` | Anbefalet |
| `givenName` | `name.givenName` | Valgfrit |
| `surname` | `name.familyName` | Valgfrit |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | Anbefalet |

4. Fjern tilknytninger, der ikke er nødvendige, for at forenkle klargøringen
5. Klik på **Gem**

#### Trin 5: Konfigurer gruppeklargøring (valgfrit)

Hvis du aktiverede **Push-grupper** i OneUptime:

1. Gå tilbage til **Tilknytninger**
2. Klik på **Klargør Azure Active Directory-grupper**
3. Aktiver gruppeklargøring ved at sætte **Aktiveret** til **Ja**
4. Konfigurer følgende attributtilknytninger:

| Azure AD-attribut | OneUptime SCIM-attribut |
|-------------------|-------------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. Klik på **Gem**

#### Trin 6: Tildel brugere og grupper

1. I din OneUptime-enterprise-applikation skal du gå til **Brugere og grupper**
2. Klik på **+ Tilføj bruger/gruppe**
3. Vælg de brugere og/eller grupper, du vil klargøre til OneUptime
4. Klik på **Tildel**

#### Trin 7: Start klargøring

1. Gå til **Klargøring** > **Oversigt**
2. Klik på **Start klargøring**
3. Den indledende klargøringscyklus begynder (dette kan tage op til 40 minutter ved første synkronisering)
4. Overvåg **Klargøringslogge** for eventuelle fejl

#### Fejlfinding af Microsoft Entra ID

- **Testforbindelsen mislykkes**: Bekræft, at SCIM Base URL inkluderer `/api/identity`-præfikset, og at Bearer Token er korrekt
- **Brugere klargøres ikke**: Kontroller, at brugere er tildelt applikationen, og at attributtilknytninger er korrekte
- **Klargøringsfejl**: Gennemgå klargøringsloggene i Entra ID for specifikke fejlmeddelelser
- **Synkroniseringsforsinkelser**: Indledende klargøring kan tage op til 40 minutter; efterfølgende synkroniseringer sker hvert 40. minut

---

### Okta

Okta leverer fleksibel identitetsstyring med fremragende SCIM-understøttelse. Følg disse detaljerede trin for at konfigurere SCIM-klargøring med OneUptime.

#### Forudsætninger

- Okta-lejer med klargøringskapaciteter (Lifecycle Management-funktion)
- OneUptime-konto med Scale-plan eller højere
- Administratoradgang til både Okta og OneUptime

#### Trin 1: Hent SCIM-konfiguration fra OneUptime

1. Log ind på dit OneUptime-dashboard
2. Naviger til **Projektindstillinger** > **Team** > **SCIM**
3. Klik på **Opret SCIM-konfiguration**
4. Indtast et brugervenligt navn (f.eks. "Okta Klargøring")
5. Konfigurer følgende indstillinger:
   - **Auto-klargøring af brugere**: Aktiver for automatisk at oprette brugere
   - **Auto-afklargøring af brugere**: Aktiver for automatisk at fjerne brugere
   - **Standardteams**: Vælg teams, som nye brugere skal tilføjes til
   - **Aktiver Push-grupper**: Aktiver, hvis du vil administrere teammedlemskab via Okta-grupper
6. Gem konfigurationen
7. Kopiér **SCIM Base URL** og **Bearer Token** – du skal bruge dem til Okta

#### Trin 2: Opret eller konfigurer Okta-applikation

**Hvis du har en eksisterende SSO-applikation:**
1. Log ind på din Okta Admin Console
2. Naviger til **Applikationer** > **Applikationer**
3. Find og vælg din eksisterende OneUptime-applikation

**Hvis du opretter en ny applikation:**
1. Log ind på din Okta Admin Console
2. Naviger til **Applikationer** > **Applikationer**
3. Klik på **Opret app-integration**
4. Vælg **SAML 2.0** og klik på **Næste**
5. Indtast "OneUptime" som app-navn
6. Fuldfør SAML-konfigurationen (se SSO-dokumentation)
7. Klik på **Udfør**

#### Trin 3: Aktiver SCIM-klargøring

1. I din OneUptime-applikation skal du gå til fanen **Generelt**
2. I afsnittet **App-indstillinger** skal du klikke på **Rediger**
3. Under **Klargøring** skal du vælge **SCIM**
4. Klik på **Gem**
5. En ny **Klargøring**-fane vises

#### Trin 4: Konfigurer SCIM-forbindelse

1. Gå til fanen **Klargøring**
2. Klik på **Integration** i venstre sidebjælke
3. Klik på **Konfigurer API-integration**
4. Marker **Aktiver API-integration**
5. Konfigurer følgende:
   - **SCIM-stik-basis-URL**: Indtast SCIM Base URL fra OneUptime (f.eks. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Unikt identifikationsfelt til brugere**: Indtast `userName`
   - **Understøttede klargøringshandlinger**: Vælg de handlinger, du vil aktivere:
     - Importér nye brugere og profilopdateringer
     - Push nye brugere
     - Push profilopdateringer
     - Push grupper (hvis du bruger gruppebaseret klargøring)
   - **Autentificeringstilstand**: Vælg **HTTP Header**
   - **Autorisering**: Indtast `Bearer {your-bearer-token}` (erstat med det faktiske token)
6. Klik på **Test API-legitimationsoplysninger** for at bekræfte forbindelsen
7. Klik på **Gem**

#### Trin 5: Konfigurer klargøring til app

1. I fanen **Klargøring** skal du klikke på **Til App** i venstre sidebjælke
2. Klik på **Rediger**
3. Aktiver følgende indstillinger:
   - **Opret brugere**: Aktiver for at klargøre nye brugere
   - **Opdater brugerattributter**: Aktiver for at synkronisere attributændringer
   - **Deaktiver brugere**: Aktiver for at afklargøre brugere, når de fjernes
4. Klik på **Gem**

#### Trin 6: Konfigurer attributtilknytninger

1. Rul ned til **Attributtilknytninger**
2. Bekræft eller konfigurer følgende tilknytninger:

| Okta-attribut | OneUptime SCIM-attribut | Retning |
|---------------|-------------------------|---------|
| `userName` | `userName` | Okta til App |
| `user.email` | `emails[primary eq true].value` | Okta til App |
| `user.firstName` | `name.givenName` | Okta til App |
| `user.lastName` | `name.familyName` | Okta til App |
| `user.displayName` | `displayName` | Okta til App |

3. Fjern unødvendige tilknytninger
4. Klik på **Gem**, hvis du foretog ændringer

#### Trin 7: Konfigurer Push-grupper (valgfrit)

Hvis du aktiverede **Push-grupper** i OneUptime:

1. Gå til fanen **Push-grupper**
2. Klik på **+ Push-grupper**
3. Vælg **Find grupper efter navn** eller **Find grupper efter regel**
4. Søg efter og vælg de grupper, du vil pushe
5. Klik på **Gem**

#### Trin 8: Tildel brugere

1. Gå til fanen **Tildelinger**
2. Klik på **Tildel** > **Tildel til personer** eller **Tildel til grupper**
3. Vælg de brugere eller grupper, du vil klargøre
4. Klik på **Tildel** for hvert valg
5. Klik på **Udført**

#### Trin 9: Bekræft klargøring

1. Gå til **Rapporter** > **Systemlog** i Okta Admin Console
2. Filtrer efter hændelser relateret til din OneUptime-applikation
3. Bekræft, at klargøringshændelser er vellykkede
4. Kontroller OneUptime for at bekræfte, at brugere er oprettet

#### Fejlfinding af Okta

- **API-legitimationsoplysninger mislykkes**: Bekræft, at SCIM Base URL og Bearer Token er korrekte
- **Brugere klargøres ikke**: Sørg for, at brugere er tildelt applikationen, og at klargøring er aktiveret
- **Duplikerede brugere**: Sørg for, at `userName`-attributten er unik og tilknyttes korrekt til e-mail
- **Gruppepush-fejl**: Bekræft, at grupper eksisterer og har det korrekte medlemskab
- **Fejl: 401 Unauthorized**: Regenerer Bearer Token i OneUptime og opdater Okta

---

### Andre identitetsudbydere

OneUptimes SCIM-implementering følger SCIM v2.0-specifikationen og bør fungere med enhver kompatibel identitetsudbyder. Generelle konfigurationstrin:

1. **SCIM Base URL**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (til projekter) eller `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (til statussider)
2. **Autentificering**: HTTP Bearer Token
3. **Påkrævet brugerattribut**: `userName` (skal være en gyldig e-mailadresse)
4. **Understøttede operationer**: GET, POST, PUT, PATCH, DELETE til brugere og grupper

#### Understøttede SCIM-endpoints

| Endpoint | Metoder | Beskrivelse |
|----------|---------|-------------|
| `/ServiceProviderConfig` | GET | SCIM-serverkapaciteter |
| `/Schemas` | GET | Tilgængelige ressourceskemaer |
| `/ResourceTypes` | GET | Tilgængelige ressourcetyper |
| `/Users` | GET, POST | List og opret brugere |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | Administrer individuelle brugere |
| `/Groups` | GET, POST | List og opret grupper/teams (kun projekt-SCIM) |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | Administrer individuelle grupper (kun projekt-SCIM) |

#### SCIM-brugerskema

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

#### SCIM-gruppeskema

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

## Ofte stillede spørgsmål

### Hvad sker der, når en bruger afklargøres?

Når en bruger afklargøres (enten via DELETE-anmodning eller ved at sætte `active: false`), fjernes de fra de teams, der er konfigureret i SCIM-indstillingerne. Selve brugerkontoen forbliver i OneUptime, men mister adgang til projektet.

### Kan jeg bruge SCIM uden SSO?

Ja, SCIM og SSO er uafhængige funktioner. Du kan bruge SCIM til brugerklargøring, mens brugere kan logge ind med deres OneUptime-adgangskoder eller en anden autentificeringsmetode.

### Hvordan håndterer jeg brugere, der allerede eksisterer i OneUptime?

Når SCIM forsøger at oprette en bruger, der allerede eksisterer (matchet efter e-mail), tilføjer OneUptime dem blot til de konfigurerede standardteams frem for at oprette en duplikatbruger.

### Hvad er forskellen på standardteams og push-grupper?

- **Standardteams**: Alle brugere, der klargøres via SCIM, tilføjes til de samme foruddefinerede teams
- **Push-grupper**: Teammedlemskab administreres af din identitetsudbyder, hvilket giver mulighed for at placere forskellige brugere i forskellige teams baseret på IdP-gruppemedlemskab

### Hvor ofte sker synkronisering af klargøring?

Dette afhænger af din identitetsudbyder:
- **Microsoft Entra ID**: Indledende klargøring kan tage op til 40 minutter; efterfølgende synkroniseringer sker hvert 40. minut
- **Okta**: Næsten realtid for de fleste operationer, med periodiske fuldstændige synkroniseringer
