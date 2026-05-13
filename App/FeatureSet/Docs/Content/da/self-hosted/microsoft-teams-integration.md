# Microsoft Teams-integration

For at integrere Microsoft Teams med din selvhostede OneUptime-instans skal du konfigurere Azure App Registration og opsætte de nødvendige miljøvariabler.

## Forudsætninger

- Azure-konto – Du kan oprette en ved at gå til [https://azure.com](https://azure.com)
- Adgang til din OneUptime-serverkonfiguration

## Opsætningsinstruktioner

### Trin 1: Opret Azure App Registration

1. Gå til [Azure Portal](https://portal.azure.com)
2. Naviger til "App registrations" og klik på "New registration"
3. Udfyld registreringsformularen:
   - **Navn:** oneuptime
   - **Understøttede kontotyper:** Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
   - **Omdirigerings-URI:** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - Tilføj også: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. Klik på "Register"
5. Notér "Application (client) ID" – du skal bruge det senere

### Trin 2: Konfigurer app-tilladelser

1. I din app-registrering skal du gå til "API permissions"
2. Klik på "Add a permission" og vælg "Microsoft Graph"

**Tilføj delegerede tilladelser** (når du handler på vegne af en logget ind bruger):
   - **User.Read** – Kræves for at hente den autentificerede brugers profiloplysninger (visningsnavn, e-mail) under OAuth-flowet
   - **Team.ReadBasic.All** – Kræves for at liste teams, som brugeren er medlem af, når den forbundne team vælges
   - **Channel.ReadBasic.All** – Kræves for at læse kanaloplysninger og liste kanaler inden for teams til levering af notifikationer
   - **ChannelMessage.Send** – Kræves for at sende alert- og incidentnotifikationer til Teams-kanaler

**Tilføj applikationstilladelser** (når du handler som selve appen, uden logget ind bruger):
   - **Team.ReadBasic.All** – Kræves for at liste alle teams i organisationen efter admin-samtykke er givet
   - **Channel.ReadBasic.All** – Kræves for at verificere kanaleksistens og hente kanaldetaljer
   - **ChannelMessage.Send** – Kræves for at sende meddelelser til kanaler programmatisk

**Bemærk:** Bot Framework håndterer meddelelseslevering ved hjælp af Resource-Specific Consent (RSC)-tilladelser defineret i Teams-app-manifestet. Disse tilladelser er:
   - **ChannelMessage.Send.Group** – Giver bot'en mulighed for at sende meddelelser til teamkanaler
   - **ChannelMessage.Read.Group** – Giver bot'en mulighed for at læse kanalmeddelelser til interaktive kommandoer
   - **Channel.Create.Group** – Giver bot'en mulighed for at oprette kanaler, når det er nødvendigt

3. Klik på "Grant admin consent" for din organisation

### Trin 3: Opret klienthemmelighed

1. Gå til "Certificates & secrets" i din app-registrering
2. Klik på "New client secret"
3. Tilføj en beskrivelse og angiv udløb (anbefaler 24 måneder)
4. Klik på "Add" og kopiér hemmelighedsværdien med det samme – du vil ikke kunne se den igen

**Vigtigt:** Kopiér ikke hemmelighedens ID; du har brug for hemmelighedens VÆRDI, som typisk er længere og indeholder flere tegn.

### Trin 4: Opret en Bot Service

1. I Azure Portal skal du navigere til "Azure Bot" og klikke på "Create"
2. Udfyld bot-oprettelsesformularen:
   - **Bot-handle:** oneuptime-bot
   - **Abonnement:** Dit Azure-abonnement
   - **Ressourcegruppe:** Opret en ny eller brug en eksisterende
   - **Placering:** Vælg en placering tæt på dine brugere
   - **Prisniveau:** F0 (Gratis) er tilstrækkeligt til test
   - Brug App (client) ID og Tenant ID fra din app-registrering oprettet tidligere

3. Klik på "Review + create" og derefter "Create"

4. Når den er deployeret, skal du gå til din bot-ressource og navigere til "Configuration"
5. Sæt "Messaging endpoint" til `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. Gem konfigurationen

### Trin 5: Tilføj Microsoft Teams-kanal til bot'en

1. I din Azure Bot-ressource skal du navigere til "Channels"
2. Find og vælg "Microsoft Teams" og klik på "Open" eller "Add"
3. Gennemgå indstillingerne (aktiver til Teams, behold standardmeddelelses-indstillinger medmindre du har specifikke behov)
4. Klik på "Save" (og "Done"/"Publish" hvis bedt om det) for at aktivere Teams-kanalen

### Trin 6: Konfigurer OneUptime-miljøvariabler

#### Docker Compose

Hvis du bruger Docker Compose, skal du tilføje disse miljøvariabler til din konfiguration:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes med Helm

Hvis du bruger Kubernetes med Helm, skal du tilføje disse til din `values.yaml`-fil:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**Vigtigt:** Genstart din OneUptime-server efter tilføjelse af disse miljøvariabler, så de træder i kraft.

### Trin 7: Upload Teams App-manifest

1. Gå til projekt-**Indstillinger** > **Integrationer** > **Microsoft Teams**
2. Download Teams app-manifestet derfra
3. Gå til Microsoft Teams, klik på "Apps" i sidebjælken
4. Klik på "Administrer dine apps" nederst
5. Klik på "Upload a custom app"
6. Vælg "Upload for me or my teams"
7. Upload den manifest-zip-fil, du downloadede tidligere

## Fejlfinding

Hvis du støder på problemer:

- Sørg for, at din app har de korrekte tilladelser givet
- Kontroller, at omdirigerings-URI'en matcher nøjagtigt (erstat `your-oneuptime-domain.com` med dit faktiske domæne)
- Bekræft, at dine miljøvariabler er korrekt indstillet
- Sørg for, at bot-meddelelsesendpointet er tilgængeligt fra internettet
- Bekræft, at bot'en er korrekt konfigureret med Teams-kanalen
- Kontroller, at Teams app-manifestet er uploadet succesfuldt

## Support

Vi vil gerne forbedre denne integration, så feedback er meget välkommen. Send os venligst eventuelle kommentarer på [hello@oneuptime.com](mailto:hello@oneuptime.com)
