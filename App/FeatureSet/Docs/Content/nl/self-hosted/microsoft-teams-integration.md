# Microsoft Teams-integratie

Om Microsoft Teams te integreren met uw zelf-gehoste OneUptime-instantie, moet u Azure App-registratie configureren en de vereiste omgevingsvariabelen instellen.

## Vereisten

- Azure-account — U kunt er een aanmaken op [https://azure.com](https://azure.com)
- Toegang tot uw OneUptime-serverconfiguratie

## Installatie-instructies

### Stap 1: Azure App-registratie aanmaken

1. Ga naar de [Azure Portal](https://portal.azure.com)
2. Navigeer naar "App-registraties" en klik op "Nieuwe registratie"
3. Vul het registratieformulier in:
   - **Naam:** oneuptime
   - **Ondersteunde accounttypen:** Accounts in elke organisatiemap (Elke Microsoft Entra ID-tenant - Multitenant)
   - **Omleidings-URI:** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - Voeg ook toe: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. Klik op "Registreren"
5. Noteer de "Applicatie (client) ID" — u heeft dit later nodig

### Stap 2: App-machtigingen configureren

1. Ga in uw app-registratie naar "API-machtigingen"
2. Klik op "Een machtiging toevoegen" en selecteer "Microsoft Graph"

**Gedelegeerde machtigingen toevoegen** (wanneer namens een aangemelde gebruiker wordt gehandeld):

- **User.Read** — Vereist om het profiel van de geverifieerde gebruiker op te halen (weergavenaam, e-mail) tijdens de OAuth-stroom
- **Team.ReadBasic.All** — Vereist om teams te vermelden waarvan de gebruiker lid is bij het selecteren van welk team verbonden moet worden
- **Channel.ReadBasic.All** — Vereist om kanaalinformatie te lezen en kanalen binnen teams te vermelden voor meldingsbezorging
- **ChannelMessage.Send** — Vereist om meldings- en incidentmeldingen naar Teams-kanalen te sturen

**Applicatiemachtigingen toevoegen** (wanneer als de app zelf wordt gehandeld, zonder aangemelde gebruiker):

- **Team.ReadBasic.All** — Vereist om alle teams in de organisatie te vermelden nadat beheerdersmachtiging is verleend
- **Channel.ReadBasic.All** — Vereist om het bestaan van kanalen te verifiëren en kanaaldetails op te halen
- **ChannelMessage.Send** — Vereist om berichten programmatisch naar kanalen te sturen

**Opmerking:** Het Bot Framework verwerkt berichtbezorging met behulp van Resource-Specific Consent (RSC)-machtigingen die zijn gedefinieerd in het Teams-app-manifest. Deze machtigingen zijn:

- **ChannelMessage.Send.Group** — Stelt de bot in staat berichten te sturen naar teamkanalen
- **ChannelMessage.Read.Group** — Stelt de bot in staat kanaalberichten te lezen voor interactieve opdrachten
- **Channel.Create.Group** — Stelt de bot in staat kanalen aan te maken indien nodig

3. Klik op "Beheerdersmachtiging verlenen" voor uw organisatie

### Stap 3: Clientgeheim aanmaken

1. Ga naar "Certificaten en geheimen" in uw app-registratie
2. Klik op "Nieuw clientgeheim"
3. Voeg een beschrijving toe en stel een vervalperiode in (24 maanden aanbevolen)
4. Klik op "Toevoegen" en kopieer de geheimwaarde onmiddellijk — u kunt het later niet meer zien

**Belangrijk:** Kopieer niet het geheim-ID, u heeft de geheimWAARDE nodig, die doorgaans langer is en meer tekens bevat.

### Stap 4: Een botservice aanmaken

1. Navigeer in de Azure Portal naar "Azure Bot" en klik op "Aanmaken"
2. Vul het formulier voor het aanmaken van de bot in:

   - **Bot-handle:** oneuptime-bot
   - **Abonnement:** Uw Azure-abonnement
   - **Resourcegroep:** Maak een nieuwe aan of gebruik een bestaande
   - **Locatie:** Kies een locatie dicht bij uw gebruikers
   - **Prijscategorie:** F0 (Gratis) is voldoende voor testen
   - Gebruik het App (client) ID en Tenant-ID van uw eerder aangemaakte app-registratie

3. Klik op "Beoordelen + aanmaken" en vervolgens op "Aanmaken"

4. Ga na implementatie naar uw bot-resource en navigeer naar "Configuratie"
5. Stel het "Berichtenverzendings-eindpunt" in op `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. Sla de configuratie op

### Stap 5: Microsoft Teams-kanaal toevoegen aan de bot

1. Navigeer in uw Azure Bot-resource naar "Kanalen"
2. Zoek en selecteer "Microsoft Teams" en klik op "Openen" of "Toevoegen"
3. Bekijk de instellingen (inschakelen voor Teams, standaard berichtenopties behouden tenzij u specifieke behoeften heeft)
4. Klik op "Opslaan" (en "Gereed"/"Publiceren" indien gevraagd) om het Teams-kanaal in te schakelen

### Stap 6: OneUptime omgevingsvariabelen configureren

#### Docker Compose

Als u Docker Compose gebruikt, voeg dan deze omgevingsvariabelen toe aan uw configuratie:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes met Helm

Als u Kubernetes met Helm gebruikt, voeg dan deze toe aan uw `values.yaml`-bestand:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**Belangrijk:** Herstart uw OneUptime-server na het toevoegen van deze omgevingsvariabelen zodat ze van kracht worden.

### Stap 7: Teams App-manifest uploaden

1. Ga naar project **Instellingen** > **Integraties** > **Microsoft Teams**
2. Download het Teams app-manifest van daar
3. Ga naar Microsoft Teams, klik op "Apps" in de zijbalk
4. Klik onderaan op "Uw apps beheren"
5. Klik op "Een aangepaste app uploaden"
6. Selecteer "Uploaden voor mij of mijn teams"
7. Upload het manifest-zip-bestand dat u eerder hebt gedownload

## Probleemoplossing

Als u problemen ondervindt:

- Zorg dat uw app de juiste machtigingen heeft verleend
- Controleer of de omleidings-URI exact overeenkomt (vervang `your-oneuptime-domain.com` door uw werkelijke domein)
- Verifieer dat uw omgevingsvariabelen correct zijn ingesteld
- Zorg dat het berichtenverzendings-eindpunt van de bot bereikbaar is vanaf het internet
- Verifieer dat de bot correct is geconfigureerd met het Teams-kanaal
- Controleer of het Teams app-manifest succesvol is geüpload

## Ondersteuning

We willen deze integratie verbeteren, dus feedback is meer dan welkom. Stuur ons uw feedback via [hello@oneuptime.com](mailto:hello@oneuptime.com)
