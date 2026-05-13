# SCIM (System for Cross-domain Identity Management)

OneUptime stöder SCIM v2.0-protokollet för automatiserad användarprovisionering och avetablering. SCIM gör det möjligt för identitetsleverantörer (IdP:er) som Azure AD, Okta och andra enterprise-identitetssystem att automatiskt hantera användaråtkomst till OneUptime-projekt och statussidor.

## Översikt

SCIM-integration ger följande fördelar:

- **Automatiserad användarprovisionering**: Skapa automatiskt användare i OneUptime när de tilldelas i din IdP
- **Automatiserad användaravetablering**: Ta automatiskt bort användare från OneUptime när de tas bort i din IdP
- **Synkronisering av användarattribut**: Håll användarinformation synkroniserad mellan din IdP och OneUptime
- **Centraliserad åtkomsthantering**: Hantera OneUptime-åtkomst från ditt befintliga identitetshanteringssystem

## SCIM för projekt

Projekt-SCIM gör det möjligt för identitetsleverantörer att hantera teammedlemmar inom OneUptime-projekt.

### Konfigurera projekt-SCIM

1. **Navigera till projektinställningar**
   - Gå till ditt OneUptime-projekt
   - Navigera till **Projektinställningar** > **Team** > **SCIM**

2. **Konfigurera SCIM-inställningar**
   - Aktivera **Automatisk provisionering av användare** för att automatiskt lägga till användare när de tilldelas i din IdP
   - Aktivera **Automatisk avetablering av användare** för att automatiskt ta bort användare när de tas bort i din IdP
   - Välj de **standardteam** som nya användare ska läggas till i
   - Kopiera **SCIM bas-URL** och **Bearer-token** för din IdP-konfiguration

3. **Konfigurera din identitetsleverantör**
   - Använd SCIM bas-URL:en: `https://oneuptime.com/scim/v2/{scimId}`
   - Konfigurera bearer-tokenautentisering med den angivna token
   - Mappa användarattribut (e-post krävs)

### Projekt-SCIM-slutpunkter

- **Tjänsteleverantörskonfiguration**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Scheman**: `GET /scim/v2/{scimId}/Schemas`
- **Resurstyper**: `GET /scim/v2/{scimId}/ResourceTypes`
- **Lista användare**: `GET /scim/v2/{scimId}/Users`
- **Hämta användare**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Skapa användare**: `POST /scim/v2/{scimId}/Users`
- **Uppdatera användare**: `PUT /scim/v2/{scimId}/Users/{userId}` eller `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Ta bort användare**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **Lista grupper**: `GET /scim/v2/{scimId}/Groups`
- **Hämta grupp**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Skapa grupp**: `POST /scim/v2/{scimId}/Groups`
- **Uppdatera grupp**: `PUT /scim/v2/{scimId}/Groups/{groupId}` eller `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Ta bort grupp**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Användarlivscykel för projekt-SCIM

1. **Användartilldelning i IdP**: När en användare tilldelas OneUptime i din IdP
2. **SCIM-provisionering**: IdP anropar OneUptime SCIM API för att skapa användaren
3. **Teammedlemskap**: Användaren läggs automatiskt till i konfigurerade standardteam
4. **Åtkomst beviljad**: Användaren kan nu komma åt OneUptime-projektet
5. **Användaravtilldelning**: När användaren tas bort i IdP
6. **SCIM-avetablering**: IdP anropar OneUptime SCIM API för att ta bort användaren
7. **Åtkomst återkallad**: Användaren förlorar åtkomst till projektet

## SCIM för statussidor

Statussida-SCIM gör det möjligt för identitetsleverantörer att hantera prenumeranter av privata statussidor.

### Konfigurera statussida-SCIM

1. **Navigera till statussideinställningar**
   - Gå till din OneUptime-statussida
   - Navigera till **Statussideinställningar** > **Privata användare** > **SCIM**

2. **Konfigurera SCIM-inställningar**
   - Aktivera **Automatisk provisionering av användare** för att automatiskt lägga till prenumeranter när de tilldelas i din IdP
   - Aktivera **Automatisk avetablering av användare** för att automatiskt ta bort prenumeranter när de tas bort i din IdP
   - Kopiera **SCIM bas-URL** och **Bearer-token** för din IdP-konfiguration

3. **Konfigurera din identitetsleverantör**
   - Använd SCIM bas-URL:en: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Konfigurera bearer-tokenautentisering med den angivna token
   - Mappa användarattribut (e-post krävs)

### Statussida-SCIM-slutpunkter

- **Tjänsteleverantörskonfiguration**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Scheman**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Resurstyper**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **Lista användare**: `GET /status-page-scim/v2/{scimId}/Users`
- **Hämta användare**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Skapa användare**: `POST /status-page-scim/v2/{scimId}/Users`
- **Uppdatera användare**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` eller `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Ta bort användare**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Användarlivscykel för statussida-SCIM

1. **Användartilldelning i IdP**: När en användare tilldelas OneUptime-statussidan i din IdP
2. **SCIM-provisionering**: IdP anropar OneUptime SCIM API för att skapa prenumeranten
3. **Åtkomst beviljad**: Användaren kan nu komma åt den privata statussidan
4. **Användaravtilldelning**: När användaren tas bort i IdP
5. **SCIM-avetablering**: IdP anropar OneUptime SCIM API för att ta bort prenumeranten
6. **Åtkomst återkallad**: Användaren förlorar åtkomst till statussidan

## Konfiguration av identitetsleverantör

### Microsoft Entra ID (tidigare Azure AD)

Microsoft Entra ID tillhandahåller enterprise-grade identitetshantering med robusta SCIM-provisioneringsfunktioner. Följ dessa detaljerade steg för att konfigurera SCIM-provisionering med OneUptime.

#### Förutsättningar

- Microsoft Entra ID-klient med Premium P1 eller P2-licens (krävs för automatisk provisionering)
- OneUptime-konto med Scale-plan eller högre
- Administratörsåtkomst till både Microsoft Entra ID och OneUptime

#### Steg 1: Hämta SCIM-konfiguration från OneUptime

1. Logga in på din OneUptime-instrumentpanel
2. Navigera till **Projektinställningar** > **Team** > **SCIM**
3. Klicka på **Skapa SCIM-konfiguration**
4. Ange ett beskrivande namn (t.ex. "Microsoft Entra ID Provisioning")
5. Konfigurera följande alternativ:
   - **Automatisk provisionering av användare**: Aktivera för att automatiskt skapa användare
   - **Automatisk avetablering av användare**: Aktivera för att automatiskt ta bort användare
   - **Standardteam**: Välj team som nya användare ska läggas till i
   - **Aktivera Push-grupper**: Aktivera om du vill hantera teammedlemskap via Entra ID-grupper
6. Spara konfigurationen
7. Kopiera **SCIM bas-URL** och **Bearer-token** – du behöver dessa för Entra ID

#### Steg 2: Skapa Enterprise-program i Microsoft Entra ID

1. Logga in på [Microsoft Entra-administrationscentret](https://entra.microsoft.com)
2. Navigera till **Identitet** > **Program** > **Enterprise-program**
3. Klicka på **+ Nytt program**
4. Klicka på **+ Skapa ditt eget program**
5. Ange ett namn (t.ex. "OneUptime")
6. Välj **Integrera ett annat program som du inte hittar i galleriet (Icke-galleri)**
7. Klicka på **Skapa**

#### Steg 3: Konfigurera SCIM-provisionering

1. I ditt OneUptime Enterprise-program, gå till **Provisionering**
2. Klicka på **Kom igång**
3. Ange **Provisioneringsläge** till **Automatiskt**
4. Under **Administratörsuppgifter**:
   - **Klient-URL**: Ange SCIM bas-URL från OneUptime (t.ex. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Hemlig token**: Ange Bearer-token från OneUptime
5. Klicka på **Testa anslutning** för att verifiera konfigurationen
6. Klicka på **Spara**

#### Steg 4: Konfigurera attributmappningar

1. I Provisioneringsavsnittet, klicka på **Mappningar**
2. Klicka på **Provisionera Azure Active Directory-användare**
3. Konfigurera följande attributmappningar:

| Azure AD-attribut | OneUptime SCIM-attribut | Obligatorisk |
|-------------------|-------------------------|--------------|
| `userPrincipalName` | `userName` | Ja |
| `mail` | `emails[type eq "work"].value` | Rekommenderas |
| `displayName` | `displayName` | Rekommenderas |
| `givenName` | `name.givenName` | Valfritt |
| `surname` | `name.familyName` | Valfritt |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | Rekommenderas |

4. Ta bort alla mappningar som inte behövs för att förenkla provisioneringen
5. Klicka på **Spara**

#### Steg 5: Konfigurera gruppprovisionering (valfritt)

Om du aktiverade **Push-grupper** i OneUptime:

1. Gå tillbaka till **Mappningar**
2. Klicka på **Provisionera Azure Active Directory-grupper**
3. Aktivera gruppprovisionering genom att ange **Aktiverad** till **Ja**
4. Konfigurera följande attributmappningar:

| Azure AD-attribut | OneUptime SCIM-attribut |
|-------------------|-------------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. Klicka på **Spara**

#### Steg 6: Tilldela användare och grupper

1. I ditt OneUptime Enterprise-program, gå till **Användare och grupper**
2. Klicka på **+ Lägg till användare/grupp**
3. Välj de användare och/eller grupper du vill provisionera till OneUptime
4. Klicka på **Tilldela**

#### Steg 7: Starta provisionering

1. Gå till **Provisionering** > **Översikt**
2. Klicka på **Starta provisionering**
3. Den inledande provisioneringscykeln börjar (detta kan ta upp till 40 minuter för den första synken)
4. Övervaka **Provisioneringsloggar** för eventuella fel

#### Felsökning av Microsoft Entra ID

- **Testa anslutning misslyckas**: Verifiera att SCIM bas-URL:en inkluderar `/api/identity`-prefixet och att Bearer-token är korrekt
- **Användare provisioneras inte**: Kontrollera att användare är tilldelade till programmet och att attributmappningarna är korrekta
- **Provisioneringsfel**: Granska Provisioneringsloggar i Entra ID för specifika felmeddelanden
- **Synkfördröjningar**: Initial provisionering kan ta upp till 40 minuter; efterföljande synkar sker var 40:e minut

---

### Okta

Okta tillhandahåller flexibel identitetshantering med utmärkt SCIM-stöd. Följ dessa detaljerade steg för att konfigurera SCIM-provisionering med OneUptime.

#### Förutsättningar

- Okta-klient med provisioneringsfunktioner (Lifecycle Management-funktion)
- OneUptime-konto med Scale-plan eller högre
- Administratörsåtkomst till både Okta och OneUptime

#### Steg 1: Hämta SCIM-konfiguration från OneUptime

1. Logga in på din OneUptime-instrumentpanel
2. Navigera till **Projektinställningar** > **Team** > **SCIM**
3. Klicka på **Skapa SCIM-konfiguration**
4. Ange ett beskrivande namn (t.ex. "Okta Provisioning")
5. Konfigurera följande alternativ:
   - **Automatisk provisionering av användare**: Aktivera för att automatiskt skapa användare
   - **Automatisk avetablering av användare**: Aktivera för att automatiskt ta bort användare
   - **Standardteam**: Välj team som nya användare ska läggas till i
   - **Aktivera Push-grupper**: Aktivera om du vill hantera teammedlemskap via Okta-grupper
6. Spara konfigurationen
7. Kopiera **SCIM bas-URL** och **Bearer-token** – du behöver dessa för Okta

#### Steg 2: Skapa eller konfigurera Okta-program

**Om du har ett befintligt SSO-program:**
1. Logga in på din Okta Admin-konsol
2. Navigera till **Program** > **Program**
3. Hitta och välj ditt befintliga OneUptime-program

**Om du skapar ett nytt program:**
1. Logga in på din Okta Admin-konsol
2. Navigera till **Program** > **Program**
3. Klicka på **Skapa appintegration**
4. Välj **SAML 2.0** och klicka på **Nästa**
5. Ange "OneUptime" som appnamn
6. Slutför SAML-konfigurationen (se SSO-dokumentation)
7. Klicka på **Slutför**

#### Steg 3: Aktivera SCIM-provisionering

1. I ditt OneUptime-program, gå till fliken **Allmänt**
2. I avsnittet **Appinställningar**, klicka på **Redigera**
3. Under **Provisionering**, välj **SCIM**
4. Klicka på **Spara**
5. En ny **Provisionerings**-flik visas

#### Steg 4: Konfigurera SCIM-anslutning

1. Gå till **Provisionerings**-fliken
2. Klicka på **Integration** i vänster sidofält
3. Klicka på **Konfigurera API-integration**
4. Markera **Aktivera API-integration**
5. Konfigurera följande:
   - **SCIM-anslutningsbasens URL**: Ange SCIM bas-URL från OneUptime (t.ex. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Unikt identifierarfält för användare**: Ange `userName`
   - **Provisioneringesåtgärder som stöds**: Välj de åtgärder du vill aktivera:
     - Importera nya användare och profiluppdateringar
     - Pusha nya användare
     - Pusha profiluppdateringar
     - Pusha grupper (om du använder gruppbaserad provisionering)
   - **Autentiseringsläge**: Välj **HTTP-huvud**
   - **Auktorisering**: Ange `Bearer {your-bearer-token}` (ersätt med faktisk token)
6. Klicka på **Testa API-uppgifter** för att verifiera anslutningen
7. Klicka på **Spara**

#### Steg 5: Konfigurera provisionering till app

1. I **Provisionerings**-fliken, klicka på **Till app** i vänster sidofält
2. Klicka på **Redigera**
3. Aktivera följande alternativ:
   - **Skapa användare**: Aktivera för att provisionera nya användare
   - **Uppdatera användarattribut**: Aktivera för att synkronisera attributändringar
   - **Inaktivera användare**: Aktivera för att avetablera användare när de tas bort
4. Klicka på **Spara**

#### Steg 6: Konfigurera attributmappningar

1. Scrolla ned till **Attributmappningar**
2. Verifiera eller konfigurera följande mappningar:

| Okta-attribut | OneUptime SCIM-attribut | Riktning |
|---------------|-------------------------|----------|
| `userName` | `userName` | Okta till app |
| `user.email` | `emails[primary eq true].value` | Okta till app |
| `user.firstName` | `name.givenName` | Okta till app |
| `user.lastName` | `name.familyName` | Okta till app |
| `user.displayName` | `displayName` | Okta till app |

3. Ta bort onödiga mappningar
4. Klicka på **Spara** om du gjort ändringar

#### Steg 7: Konfigurera Push-grupper (valfritt)

Om du aktiverade **Push-grupper** i OneUptime:

1. Gå till fliken **Push-grupper**
2. Klicka på **+ Push-grupper**
3. Välj **Hitta grupper efter namn** eller **Hitta grupper efter regel**
4. Sök efter och välj de grupper du vill pusha
5. Klicka på **Spara**

#### Steg 8: Tilldela användare

1. Gå till fliken **Tilldelningar**
2. Klicka på **Tilldela** > **Tilldela till personer** eller **Tilldela till grupper**
3. Välj de användare eller grupper du vill provisionera
4. Klicka på **Tilldela** för varje val
5. Klicka på **Klar**

#### Steg 9: Verifiera provisionering

1. Gå till **Rapporter** > **Systemlogg** i Okta Admin-konsolen
2. Filtrera efter händelser relaterade till ditt OneUptime-program
3. Verifiera att provisioneringshändelser lyckas
4. Kontrollera OneUptime för att bekräfta att användare har skapats

#### Felsökning av Okta

- **Test av API-uppgifter misslyckas**: Verifiera att SCIM bas-URL:en och Bearer-token är korrekta
- **Användare provisioneras inte**: Se till att användare är tilldelade till programmet och att provisionering är aktiverat
- **Duplicerade användare**: Se till att `userName`-attributet är unikt och mappar korrekt till e-post
- **Grupppush-fel**: Verifiera att grupper finns och har korrekt medlemskap
- **Fel: 401 Unauthorized**: Regenerera Bearer-token i OneUptime och uppdatera Okta

---

### Andra identitetsleverantörer

OneUptimes SCIM-implementering följer SCIM v2.0-specifikationen och bör fungera med vilken kompatibel identitetsleverantör som helst. Allmänna konfigurationssteg:

1. **SCIM bas-URL**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (för projekt) eller `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (för statussidor)
2. **Autentisering**: HTTP Bearer-token
3. **Obligatoriskt användarattribut**: `userName` (måste vara en giltig e-postadress)
4. **Åtgärder som stöds**: GET, POST, PUT, PATCH, DELETE för användare och grupper

#### SCIM-slutpunkter som stöds

| Slutpunkt | Metoder | Beskrivning |
|-----------|---------|-------------|
| `/ServiceProviderConfig` | GET | SCIM-serverns funktioner |
| `/Schemas` | GET | Tillgängliga resursscheman |
| `/ResourceTypes` | GET | Tillgängliga resurstyper |
| `/Users` | GET, POST | Lista och skapa användare |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | Hantera enskilda användare |
| `/Groups` | GET, POST | Lista och skapa grupper/team (endast projekt-SCIM) |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | Hantera enskilda grupper (endast projekt-SCIM) |

#### SCIM-användarsschema

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

#### SCIM-gruppsschema

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

## Vanliga frågor

### Vad händer när en användare avetableras?

När en användare avetableras (antingen via DELETE-förfrågan eller genom att ange `active: false`) tas de bort från de team som konfigurerats i SCIM-inställningarna. Användarkontot finns kvar i OneUptime men förlorar åtkomst till projektet.

### Kan jag använda SCIM utan SSO?

Ja, SCIM och SSO är oberoende funktioner. Du kan använda SCIM för användarprovisionering medan du låter användare logga in med sina OneUptime-lösenord eller annan autentiseringsmetod.

### Hur hanterar jag användare som redan finns i OneUptime?

När SCIM försöker skapa en användare som redan finns (matchad på e-post) lägger OneUptime helt enkelt till dem i de konfigurerade standardteamen istället för att skapa en dubblettanvändare.

### Vad är skillnaden mellan standardteam och Push-grupper?

- **Standardteam**: Alla användare som provisioneras via SCIM läggs till i samma fördefinierade team
- **Push-grupper**: Teammedlemskap hanteras av din identitetsleverantör, vilket gör att olika användare kan vara i olika team baserat på IdP-gruppmedlemskap

### Hur ofta sker provisioneringssync?

Detta beror på din identitetsleverantör:
- **Microsoft Entra ID**: Initial sync kan ta upp till 40 minuter; efterföljande synkar var 40:e minut
- **Okta**: Nära realtid för de flesta operationer, med periodiska fullständiga synkar
