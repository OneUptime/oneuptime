# Microsoft Teams-integration

För att integrera Microsoft Teams med din egeninstallerade OneUptime-instans behöver du konfigurera Azure App Registration och ange de obligatoriska miljövariablerna.

## Förutsättningar

- Azure-konto – Du kan skapa ett på [https://azure.com](https://azure.com)
- Åtkomst till din OneUptime-serverkonfiguration

## Konfigurationsinstruktioner

### Steg 1: Skapa Azure App Registration

1. Gå till [Azure-portalen](https://portal.azure.com)
2. Navigera till "App registrations" och klicka på "New registration"
3. Fyll i registreringsformuläret:
   - **Namn:** oneuptime
   - **Kontotyper som stöds:** Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
   - **Redirect URI:** Web – `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - Lägg även till: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. Klicka på "Register"
5. Anteckna "Application (client) ID" – du behöver detta senare

### Steg 2: Konfigurera appbehörigheter

1. I din appregistrering, gå till "API permissions"
2. Klicka på "Add a permission" och välj "Microsoft Graph"

**Lägg till delegerade behörigheter** (när du agerar för en inloggad användares räkning):
   - **User.Read** – Krävs för att hämta den autentiserade användarens profilinformation under OAuth-flödet
   - **Team.ReadBasic.All** – Krävs för att lista team som användaren är medlem i vid val av vilket team att ansluta
   - **Channel.ReadBasic.All** – Krävs för att läsa kanalinformation och lista kanaler inom team
   - **ChannelMessage.Send** – Krävs för att skicka varnings- och incidentaviseringar till Teams-kanaler

**Lägg till programbehörigheter** (när appen agerar utan en inloggad användare):
   - **Team.ReadBasic.All** – Krävs för att lista alla team i organisationen efter administratörsmedgivande
   - **Channel.ReadBasic.All** – Krävs för att verifiera kanalexistens och hämta kanaldetaljer
   - **ChannelMessage.Send** – Krävs för att skicka meddelanden till kanaler programmatiskt

3. Klicka på "Grant admin consent" för din organisation

### Steg 3: Skapa klienthemlighet

1. Gå till "Certificates & secrets" i din appregistrering
2. Klicka på "New client secret"
3. Lägg till en beskrivning och ange utgångsdatum (rekommenderas 24 månader)
4. Klicka på "Add" och kopiera hemlighetsvärdet omedelbart – du kan inte se det igen

**Viktigt:** Kopiera inte hemlighets-ID:t, du behöver hemlighetsvärdet (VALUE) som vanligtvis är längre.

### Steg 4: Skapa en Bot Service

1. I Azure-portalen, navigera till "Azure Bot" och klicka på "Create"
2. Fyll i botformuläret:
   - **Bot handle:** oneuptime-bot
   - **Prenumeration:** Din Azure-prenumeration
   - **Resursgrupp:** Skapa en ny eller använd en befintlig
   - **Plats:** Välj en plats nära dina användare
   - **Prisnivå:** F0 (Gratis) räcker för testning
   - Använd App (client) ID och Tenant ID från din appregistrering ovan

3. Klicka på "Review + create" och sedan "Create"

4. När den är distribuerad, gå till din botresurs och navigera till "Configuration"
5. Ange "Messaging endpoint" till `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. Spara konfigurationen

### Steg 5: Lägg till Microsoft Teams-kanal i boten

1. I din Azure Bot-resurs, navigera till "Channels"
2. Hitta och välj "Microsoft Teams" och klicka på "Open" eller "Add"
3. Granska inställningarna
4. Klicka på "Save" för att aktivera Teams-kanalen

### Steg 6: Konfigurera OneUptime-miljövariabler

#### Docker Compose

Om du använder Docker Compose, lägg till dessa miljövariabler i din konfiguration:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes med Helm

Om du använder Kubernetes med Helm, lägg till dessa i din `values.yaml`-fil:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**Viktigt:** Starta om din OneUptime-server efter att du har lagt till dessa miljövariabler för att de ska träda i kraft.

### Steg 7: Ladda upp Teams App Manifest

1. Gå till projekt **Inställningar** > **Integrationer** > **Microsoft Teams**
2. Ladda ned Teams app-manifestet därifrån
3. Gå till Microsoft Teams, klicka på "Appar" i sidofältet
4. Längst ned, klicka på "Hantera dina appar"
5. Klicka på "Ladda upp en anpassad app"
6. Välj "Ladda upp för mig eller mina team"
7. Ladda upp den manifest-zip-fil du laddade ned tidigare

## Felsökning

Om du stöter på problem:

- Se till att din app har rätt behörigheter beviljade
- Kontrollera att Redirect URI matchar exakt (ersätt `your-oneuptime-domain.com` med din faktiska domän)
- Verifiera att dina miljövariabler är korrekt angivna
- Se till att botens meddelandeslutpunkt är tillgänglig från internet
- Verifiera att boten är korrekt konfigurerad med Teams-kanalen
- Kontrollera att Teams app-manifestet har laddats upp framgångsrikt

## Support

Vi vill förbättra denna integration, så feedback är mer än välkommen. Skicka gärna feedback till [hello@oneuptime.com](mailto:hello@oneuptime.com)
