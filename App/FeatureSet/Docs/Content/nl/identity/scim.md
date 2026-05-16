# SCIM (System for Cross-domain Identity Management)

OneUptime ondersteunt het SCIM v2.0-protocol voor geautomatiseerde gebruikersinrichting en -verwijdering. SCIM stelt identiteitsproviders (IdP's) zoals Azure AD, Okta en andere enterprise-identiteitssystemen in staat om automatisch gebruikerstoegang tot OneUptime-projecten en statuspagina's te beheren.

## Overzicht

SCIM-integratie biedt de volgende voordelen:

- **Geautomatiseerde gebruikersinrichting**: Automatisch gebruikers aanmaken in OneUptime wanneer ze zijn toegewezen in uw IdP
- **Geautomatiseerde gebruikersverwijdering**: Automatisch gebruikers verwijderen uit OneUptime wanneer ze zijn verwijderd in uw IdP
- **Synchronisatie van gebruikersattributen**: Gebruikersinformatie gesynchroniseerd houden tussen uw IdP en OneUptime
- **Gecentraliseerd toegangsbeheer**: OneUptime-toegang beheren vanuit uw bestaand identiteitsbeheersysteem

## SCIM voor projecten

Project-SCIM stelt identiteitsproviders in staat teamleden binnen OneUptime-projecten te beheren.

### Project-SCIM instellen

1. **Navigeer naar Projectinstellingen**
   - Ga naar uw OneUptime-project
   - Navigeer naar **Projectinstellingen** > **Team** > **SCIM**

2. **SCIM-instellingen configureren**
   - Schakel **Gebruikers automatisch inrichten** in om gebruikers automatisch toe te voegen wanneer ze zijn toegewezen in uw IdP
   - Schakel **Gebruikers automatisch verwijderen** in om gebruikers automatisch te verwijderen wanneer ze zijn verwijderd in uw IdP
   - Selecteer de **Standaardteams** waartoe nieuwe gebruikers worden toegevoegd
   - Kopieer de **SCIM Basis-URL** en het **Bearer-token** voor uw IdP-configuratie

3. **Uw identiteitsprovider configureren**
   - Gebruik de SCIM Basis-URL: `https://oneuptime.com/scim/v2/{scimId}`
   - Configureer bearer-tokenauthenticatie met het opgegeven token
   - Wijs gebruikersattributen toe (e-mail is vereist)

### Project-SCIM-eindpunten

- **Serviceproviderinformatie**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schema's**: `GET /scim/v2/{scimId}/Schemas`
- **Resourcetypen**: `GET /scim/v2/{scimId}/ResourceTypes`
- **Gebruikers weergeven**: `GET /scim/v2/{scimId}/Users`
- **Gebruiker ophalen**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Gebruiker aanmaken**: `POST /scim/v2/{scimId}/Users`
- **Gebruiker bijwerken**: `PUT /scim/v2/{scimId}/Users/{userId}` of `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Gebruiker verwijderen**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **Groepen weergeven**: `GET /scim/v2/{scimId}/Groups`
- **Groep ophalen**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Groep aanmaken**: `POST /scim/v2/{scimId}/Groups`
- **Groep bijwerken**: `PUT /scim/v2/{scimId}/Groups/{groupId}` of `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Groep verwijderen**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Levenscyclus van Project-SCIM-gebruikers

1. **Gebruikerstoewijzing in IdP**: Wanneer een gebruiker wordt toegewezen aan OneUptime in uw IdP
2. **SCIM-inrichting**: IdP roept de OneUptime SCIM API aan om de gebruiker aan te maken
3. **Teamlidmaatschap**: Gebruiker wordt automatisch toegevoegd aan geconfigureerde standaardteams
4. **Toegang verleend**: Gebruiker heeft nu toegang tot het OneUptime-project
5. **Gebruikersverwijdering**: Wanneer gebruiker wordt verwijderd in IdP
6. **SCIM-verwijdering**: IdP roept de OneUptime SCIM API aan om de gebruiker te verwijderen
7. **Toegang ingetrokken**: Gebruiker verliest toegang tot het project

## SCIM voor statuspagina's

Statuspagina-SCIM stelt identiteitsproviders in staat abonnees van privé-statuspagina's te beheren.

### Statuspagina-SCIM instellen

1. **Navigeer naar Statuspagina-instellingen**
   - Ga naar uw OneUptime-statuspagina
   - Navigeer naar **Statuspagina-instellingen** > **Privégebruikers** > **SCIM**

2. **SCIM-instellingen configureren**
   - Schakel **Gebruikers automatisch inrichten** in om abonnees automatisch toe te voegen wanneer ze zijn toegewezen in uw IdP
   - Schakel **Gebruikers automatisch verwijderen** in om abonnees automatisch te verwijderen wanneer ze zijn verwijderd in uw IdP
   - Kopieer de **SCIM Basis-URL** en het **Bearer-token** voor uw IdP-configuratie

3. **Uw identiteitsprovider configureren**
   - Gebruik de SCIM Basis-URL: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Configureer bearer-tokenauthenticatie met het opgegeven token
   - Wijs gebruikersattributen toe (e-mail is vereist)

### Statuspagina-SCIM-eindpunten

- **Serviceproviderinformatie**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schema's**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Resourcetypen**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **Gebruikers weergeven**: `GET /status-page-scim/v2/{scimId}/Users`
- **Gebruiker ophalen**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Gebruiker aanmaken**: `POST /status-page-scim/v2/{scimId}/Users`
- **Gebruiker bijwerken**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` of `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Gebruiker verwijderen**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Levenscyclus van Statuspagina-SCIM-gebruikers

1. **Gebruikerstoewijzing in IdP**: Wanneer een gebruiker wordt toegewezen aan de OneUptime-statuspagina in uw IdP
2. **SCIM-inrichting**: IdP roept de OneUptime SCIM API aan om de abonnee aan te maken
3. **Toegang verleend**: Gebruiker heeft nu toegang tot de privé-statuspagina
4. **Gebruikersverwijdering**: Wanneer gebruiker wordt verwijderd in IdP
5. **SCIM-verwijdering**: IdP roept de OneUptime SCIM API aan om de abonnee te verwijderen
6. **Toegang ingetrokken**: Gebruiker verliest toegang tot de statuspagina

## Configuratie van identiteitsproviders

### Microsoft Entra ID (voorheen Azure AD)

Microsoft Entra ID biedt enterprise-grade identiteitsbeheer met robuuste SCIM-inrichtingsmogelijkheden. Volg deze gedetailleerde stappen om SCIM-inrichting te configureren met OneUptime.

#### Vereisten

- Microsoft Entra ID-tenant met Premium P1 of P2-licentie (vereist voor automatische inrichting)
- OneUptime-account met Scale-abonnement of hoger
- Beheerderstoegang tot zowel Microsoft Entra ID als OneUptime

#### Stap 1: SCIM-configuratie ophalen uit OneUptime

1. Log in op uw OneUptime-dashboard
2. Navigeer naar **Projectinstellingen** > **Team** > **SCIM**
3. Klik op **SCIM-configuratie aanmaken**
4. Voer een beschrijvende naam in (bijv. "Microsoft Entra ID-inrichting")
5. Configureer de volgende opties:
   - **Gebruikers automatisch inrichten**: Inschakelen om gebruikers automatisch aan te maken
   - **Gebruikers automatisch verwijderen**: Inschakelen om gebruikers automatisch te verwijderen
   - **Standaardteams**: Selecteer teams waaraan nieuwe gebruikers worden toegevoegd
   - **Groepen pushen inschakelen**: Inschakelen als u teamlidmaatschap wilt beheren via Entra ID-groepen
6. Sla de configuratie op
7. Kopieer de **SCIM Basis-URL** en het **Bearer-token** - u heeft deze nodig voor Entra ID

#### Stap 2: Enterprise-toepassing aanmaken in Microsoft Entra ID

1. Meld u aan bij het [Microsoft Entra-beheercentrum](https://entra.microsoft.com)
2. Navigeer naar **Identiteit** > **Applicaties** > **Enterprise-toepassingen**
3. Klik op **+ Nieuwe toepassing**
4. Klik op **+ Uw eigen toepassing maken**
5. Voer een naam in (bijv. "OneUptime")
6. Selecteer **Een andere toepassing integreren die u niet in de galerie vindt (Niet-galerie)**
7. Klik op **Maken**

#### Stap 3: SCIM-inrichting configureren

1. Ga in uw OneUptime-enterprise-toepassing naar **Inrichting**
2. Klik op **Aan de slag**
3. Stel de **Inrichtingsmodus** in op **Automatisch**
4. Voer onder **Beheerdersreferenties** in:
   - **Tenant-URL**: Voer de SCIM Basis-URL uit OneUptime in (bijv. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Geheim token**: Voer het Bearer-token uit OneUptime in
5. Klik op **Verbinding testen** om de configuratie te verifiëren
6. Klik op **Opslaan**

#### Stap 4: Attribuutkoppelingen configureren

1. Klik in de sectie Inrichting op **Koppelingen**
2. Klik op **Azure Active Directory-gebruikers inrichten**
3. Configureer de volgende attribuutkoppelingen:

| Azure AD-attribuut | OneUptime SCIM-attribuut | Vereist |
|-------------------|-------------------------|----------|
| `userPrincipalName` | `userName` | Ja |
| `mail` | `emails[type eq "work"].value` | Aanbevolen |
| `displayName` | `displayName` | Aanbevolen |
| `givenName` | `name.givenName` | Optioneel |
| `surname` | `name.familyName` | Optioneel |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | Aanbevolen |

4. Verwijder eventuele onnodige koppelingen om de inrichting te vereenvoudigen
5. Klik op **Opslaan**

#### Stap 5: Groepsinrichting configureren (optioneel)

Als u **Groepen pushen** heeft ingeschakeld in OneUptime:

1. Ga terug naar **Koppelingen**
2. Klik op **Azure Active Directory-groepen inrichten**
3. Schakel groepsinrichting in door **Ingeschakeld** op **Ja** te zetten
4. Configureer de volgende attribuutkoppelingen:

| Azure AD-attribuut | OneUptime SCIM-attribuut |
|-------------------|-------------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. Klik op **Opslaan**

#### Stap 6: Gebruikers en groepen toewijzen

1. Ga in uw OneUptime-enterprise-toepassing naar **Gebruikers en groepen**
2. Klik op **+ Gebruiker/groep toevoegen**
3. Selecteer de gebruikers en/of groepen die u wilt inrichten in OneUptime
4. Klik op **Toewijzen**

#### Stap 7: Inrichting starten

1. Ga naar **Inrichting** > **Overzicht**
2. Klik op **Inrichting starten**
3. De eerste inrichtingscyclus begint (dit kan tot 40 minuten duren voor de eerste synchronisatie)
4. Controleer de **Inrichtingslogboeken** op eventuele fouten

#### Probleemoplossing voor Microsoft Entra ID

- **Verbindingstest mislukt**: Controleer of de SCIM Basis-URL het voorvoegsel `/api/identity` bevat en of het Bearer-token correct is
- **Gebruikers worden niet ingericht**: Controleer of gebruikers zijn toegewezen aan de toepassing en of attribuutkoppelingen correct zijn
- **Inrichtingsfouten**: Bekijk de inrichtingslogboeken in Entra ID voor specifieke foutmeldingen
- **Synchronisatievertraging**: Eerste inrichting kan tot 40 minuten duren; volgende synchronisaties vinden elke 40 minuten plaats

---

### Okta

Okta biedt flexibel identiteitsbeheer met uitstekende SCIM-ondersteuning. Volg deze gedetailleerde stappen om SCIM-inrichting te configureren met OneUptime.

#### Vereisten

- Okta-tenant met inrichtingsmogelijkheden (Lifecycle Management-functie)
- OneUptime-account met Scale-abonnement of hoger
- Beheerderstoegang tot zowel Okta als OneUptime

#### Stap 1: SCIM-configuratie ophalen uit OneUptime

1. Log in op uw OneUptime-dashboard
2. Navigeer naar **Projectinstellingen** > **Team** > **SCIM**
3. Klik op **SCIM-configuratie aanmaken**
4. Voer een beschrijvende naam in (bijv. "Okta-inrichting")
5. Configureer de volgende opties:
   - **Gebruikers automatisch inrichten**: Inschakelen om gebruikers automatisch aan te maken
   - **Gebruikers automatisch verwijderen**: Inschakelen om gebruikers automatisch te verwijderen
   - **Standaardteams**: Selecteer teams waaraan nieuwe gebruikers worden toegevoegd
   - **Groepen pushen inschakelen**: Inschakelen als u teamlidmaatschap wilt beheren via Okta-groepen
6. Sla de configuratie op
7. Kopieer de **SCIM Basis-URL** en het **Bearer-token** - u heeft deze nodig voor Okta

#### Stap 2: Okta-applicatie aanmaken of configureren

**Als u een bestaande SSO-applicatie heeft:**
1. Meld u aan bij uw Okta-beheerconsole
2. Navigeer naar **Applicaties** > **Applicaties**
3. Zoek uw bestaande OneUptime-applicatie en selecteer deze

**Als u een nieuwe applicatie aanmaakt:**
1. Meld u aan bij uw Okta-beheerconsole
2. Navigeer naar **Applicaties** > **Applicaties**
3. Klik op **App-integratie aanmaken**
4. Selecteer **SAML 2.0** en klik op **Volgende**
5. Voer "OneUptime" in als app-naam
6. Voltooi de SAML-configuratie (zie SSO-documentatie)
7. Klik op **Voltooien**

#### Stap 3: SCIM-inrichting inschakelen

1. Ga in uw OneUptime-applicatie naar het tabblad **Algemeen**
2. Klik in de sectie **App-instellingen** op **Bewerken**
3. Selecteer bij **Inrichting** de optie **SCIM**
4. Klik op **Opslaan**
5. Er verschijnt een nieuw tabblad **Inrichting**

#### Stap 4: SCIM-verbinding configureren

1. Ga naar het tabblad **Inrichting**
2. Klik op **Integratie** in de linkerzijbalk
3. Klik op **API-integratie configureren**
4. Vink **API-integratie inschakelen** aan
5. Configureer het volgende:
   - **SCIM connector-basis-URL**: Voer de SCIM Basis-URL uit OneUptime in (bijv. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Uniek identificatieveld voor gebruikers**: Voer `userName` in
   - **Ondersteunde inrichtingsacties**: Selecteer de acties die u wilt inschakelen:
     - Nieuwe gebruikers en profielupdates importeren
     - Nieuwe gebruikers pushen
     - Profielupdates pushen
     - Groepen pushen (bij gebruik van groepsgebaseerde inrichting)
   - **Authenticatiemodus**: Selecteer **HTTP-header**
   - **Autorisatie**: Voer `Bearer {your-bearer-token}` in (vervang door het werkelijke token)
6. Klik op **API-referenties testen** om de verbinding te verifiëren
7. Klik op **Opslaan**

#### Stap 5: Inrichting naar app configureren

1. Klik op het tabblad **Inrichting** op **Naar app** in de linkerzijbalk
2. Klik op **Bewerken**
3. Schakel de volgende opties in:
   - **Gebruikers aanmaken**: Inschakelen om nieuwe gebruikers in te richten
   - **Gebruikersattributen bijwerken**: Inschakelen om attribuutwijzigingen te synchroniseren
   - **Gebruikers deactiveren**: Inschakelen om gebruikers te verwijderen wanneer ze zijn verwijderd
4. Klik op **Opslaan**

#### Stap 6: Attribuutkoppelingen configureren

1. Blader omlaag naar **Attribuutkoppelingen**
2. Controleer of configureer de volgende koppelingen:

| Okta-attribuut | OneUptime SCIM-attribuut | Richting |
|---------------|-------------------------|-----------|
| `userName` | `userName` | Okta naar app |
| `user.email` | `emails[primary eq true].value` | Okta naar app |
| `user.firstName` | `name.givenName` | Okta naar app |
| `user.lastName` | `name.familyName` | Okta naar app |
| `user.displayName` | `displayName` | Okta naar app |

3. Verwijder eventuele onnodige koppelingen
4. Klik op **Opslaan** als u wijzigingen heeft aangebracht

#### Stap 7: Groepen pushen configureren (optioneel)

Als u **Groepen pushen** heeft ingeschakeld in OneUptime:

1. Ga naar het tabblad **Groepen pushen**
2. Klik op **+ Groepen pushen**
3. Selecteer **Groepen zoeken op naam** of **Groepen zoeken op regel**
4. Zoek naar de groepen die u wilt pushen en selecteer ze
5. Klik op **Opslaan**

#### Stap 8: Gebruikers toewijzen

1. Ga naar het tabblad **Toewijzingen**
2. Klik op **Toewijzen** > **Toewijzen aan personen** of **Toewijzen aan groepen**
3. Selecteer de gebruikers of groepen die u wilt inrichten
4. Klik op **Toewijzen** voor elke selectie
5. Klik op **Gereed**

#### Stap 9: Inrichting verifiëren

1. Ga naar **Rapporten** > **Systeemlogboek** in de Okta-beheerconsole
2. Filter op gebeurtenissen gerelateerd aan uw OneUptime-applicatie
3. Verifieer dat inrichtingsgebeurtenissen succesvol zijn
4. Controleer in OneUptime of gebruikers zijn aangemaakt

#### Probleemoplossing voor Okta

- **API-referentietest mislukt**: Controleer of de SCIM Basis-URL en het Bearer-token correct zijn
- **Gebruikers worden niet ingericht**: Zorg dat gebruikers zijn toegewezen aan de applicatie en inrichting is ingeschakeld
- **Dubbele gebruikers**: Zorg dat het `userName`-attribuut uniek is en correct wordt gekoppeld aan e-mail
- **Groepsignatuurfouten**: Controleer of groepen bestaan en het juiste lidmaatschap hebben
- **Fout: 401 Niet geautoriseerd**: Genereer het Bearer-token in OneUptime opnieuw en werk Okta bij

---

### Andere identiteitsproviders

De SCIM-implementatie van OneUptime volgt de SCIM v2.0-specificatie en zou moeten werken met elke conforme identiteitsprovider. Algemene configuratiestappen:

1. **SCIM Basis-URL**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (voor projecten) of `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (voor statuspagina's)
2. **Authenticatie**: HTTP Bearer-token
3. **Vereist gebruikersattribuut**: `userName` (moet een geldig e-mailadres zijn)
4. **Ondersteunde bewerkingen**: GET, POST, PUT, PATCH, DELETE voor gebruikers en groepen

#### Ondersteunde SCIM-eindpunten

| Eindpunt | Methoden | Beschrijving |
|----------|---------|-------------|
| `/ServiceProviderConfig` | GET | SCIM-servermogelijkheden |
| `/Schemas` | GET | Beschikbare resourceschema's |
| `/ResourceTypes` | GET | Beschikbare resourcetypen |
| `/Users` | GET, POST | Gebruikers weergeven en aanmaken |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | Individuele gebruikers beheren |
| `/Groups` | GET, POST | Groepen/teams weergeven en aanmaken (alleen Project-SCIM) |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | Individuele groepen beheren (alleen Project-SCIM) |

#### SCIM-gebruikersschema

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

#### SCIM-groepsschema

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

## Veelgestelde vragen

### Wat gebeurt er wanneer een gebruiker wordt verwijderd?

Wanneer een gebruiker wordt verwijderd (via een DELETE-verzoek of door `active: false` in te stellen), wordt deze verwijderd uit de teams die zijn geconfigureerd in de SCIM-instellingen. Het gebruikersaccount zelf blijft bestaan in OneUptime maar verliest toegang tot het project.

### Kan ik SCIM gebruiken zonder SSO?

Ja, SCIM en SSO zijn onafhankelijke functies. U kunt SCIM gebruiken voor gebruikersinrichting terwijl u gebruikers toestaat in te loggen met hun OneUptime-wachtwoorden of een andere authenticatiemethode.

### Hoe ga ik om met gebruikers die al bestaan in OneUptime?

Wanneer SCIM probeert een gebruiker aan te maken die al bestaat (overeenkomend op e-mail), voegt OneUptime die gebruiker eenvoudigweg toe aan de geconfigureerde standaardteams in plaats van een dubbele gebruiker aan te maken.

### Wat is het verschil tussen standaardteams en groepen pushen?

- **Standaardteams**: Alle via SCIM ingerichte gebruikers worden toegevoegd aan dezelfde vooraf gedefinieerde teams
- **Groepen pushen**: Teamlidmaatschap wordt beheerd door uw identiteitsprovider, waardoor verschillende gebruikers in verschillende teams kunnen zitten op basis van IdP-groepslidmaatschap

### Hoe vaak vindt inrichtingssynchronisatie plaats?

Dit is afhankelijk van uw identiteitsprovider:
- **Microsoft Entra ID**: Eerste synchronisatie kan tot 40 minuten duren; volgende synchronisaties elke 40 minuten
- **Okta**: Bijna realtime voor de meeste bewerkingen, met periodieke volledige synchronisaties
