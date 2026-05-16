# Microsoft Teams-integrasjon

For å integrere Microsoft Teams med din selvhostede OneUptime-instans må du konfigurere Azure App Registration og sette opp de nødvendige miljøvariablene.

## Forutsetninger

- Azure-konto – Du kan opprette en ved å gå til [https://azure.com](https://azure.com)
- Tilgang til OneUptime-serverkonfigurasjonen din

## Installasjonsinstruksjoner

### Trinn 1: Opprett Azure App Registration

1. Gå til [Azure-portalen](https://portal.azure.com)
2. Naviger til "App registrations" og klikk "New registration"
3. Fyll ut registreringsskjemaet:
   - **Name:** oneuptime
   - **Supported account types:** Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
   - **Redirect URI:** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - Legg også til: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. Klikk "Register"
5. Noter ned "Application (client) ID" – du trenger dette senere

### Trinn 2: Konfigurer apptillatelser

1. I appregistreringen din, gå til "API permissions"
2. Klikk "Add a permission" og velg "Microsoft Graph"

**Legg til delegerte tillatelser** (når du handler på vegne av en innlogget bruker):
   - **User.Read** – Påkrevd for å hente den autentiserte brukerens profilinformasjon (visningsnavn, e-post) under OAuth-flyten
   - **Team.ReadBasic.All** – Påkrevd for å liste opp team som brukeren er medlem av når du velger hvilket team som skal kobles til
   - **Channel.ReadBasic.All** – Påkrevd for å lese kanalinformasjon og liste opp kanaler i team for levering av varsler
   - **ChannelMessage.Send** – Påkrevd for å sende varsel- og hendelsesvarsler til Teams-kanaler

**Legg til applikasjonstillatelser** (når du handler som appen selv, uten en innlogget bruker):
   - **Team.ReadBasic.All** – Påkrevd for å liste opp alle team i organisasjonen etter at admin-samtykke er gitt
   - **Channel.ReadBasic.All** – Påkrevd for å verifisere kanaleksistens og hente kanaldetaljer
   - **ChannelMessage.Send** – Påkrevd for å sende meldinger til kanaler programmatisk

**Merk:** Bot Framework håndterer meldingslevering ved hjelp av Resource-Specific Consent (RSC)-tillatelser definert i Teams-appmanifestet. Disse tillatelsene er:
   - **ChannelMessage.Send.Group** – Lar boten sende meldinger til teamkanaler
   - **ChannelMessage.Read.Group** – Lar boten lese kanalmeldinger for interaktive kommandoer
   - **Channel.Create.Group** – Lar boten opprette kanaler ved behov

3. Klikk "Grant admin consent" for organisasjonen din

### Trinn 3: Opprett klienthemmelighet

1. Gå til "Certificates & secrets" i appregistreringen din
2. Klikk "New client secret"
3. Legg til en beskrivelse og sett utløpsdato (anbefaler 24 måneder)
4. Klikk "Add" og kopier hemmelighets-verdien umiddelbart – du vil ikke kunne se den igjen

**Viktig:** Ikke kopier hemmelighets-ID-en, du trenger hemmelighets-VERDIEN som vanligvis er lengre og inneholder flere tegn.

### Trinn 4: Opprett en Bot Service

1. I Azure-portalen, naviger til "Azure Bot" og klikk "Create"
2. Fyll ut bot-oppretting-skjemaet:
   - **Bot handle:** oneuptime-bot
   - **Subscription:** Azure-abonnementet ditt
   - **Resource group:** Opprett en ny eller bruk en eksisterende
   - **Location:** Velg en lokasjon nær brukerne dine
   - **Pricing tier:** F0 (gratis) er tilstrekkelig for testing
   - Bruk App (client) ID og Tenant ID fra appregistreringen opprettet tidligere

3. Klikk "Review + create" og deretter "Create"

4. Når distribuert, gå til botressursen og naviger til "Configuration"
5. Sett "Messaging endpoint" til `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. Lagre konfigurasjonen

### Trinn 5: Legg til Microsoft Teams-kanal i boten

1. I Azure Bot-ressursen, naviger til "Channels"
2. Finn og velg "Microsoft Teams" og klikk "Open" eller "Add"
3. Se gjennom innstillingene (aktiver for Teams, behold standard meldingsalternativer med mindre du har spesifikke behov)
4. Klikk "Save" (og "Done"/"Publish" hvis du blir bedt om det) for å aktivere Teams-kanalen

### Trinn 6: Konfigurer OneUptime-miljøvariabler

#### Docker Compose

Hvis du bruker Docker Compose, legg til disse miljøvariablene i konfigurasjonen din:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes med Helm

Hvis du bruker Kubernetes med Helm, legg til disse i `values.yaml`-filen din:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**Viktig:** Start OneUptime-serveren på nytt etter å ha lagt til disse miljøvariablene slik at de trer i kraft.

### Trinn 7: Last opp Teams-appmanifest

1. Gå til prosjektets **Settings** > **Integrations** > **Microsoft Teams**
2. Last ned Teams-appmanifestet derfra
3. Gå til Microsoft Teams, klikk på "Apps" i sidefeltet
4. Klikk nederst "Manage your apps"
5. Klikk "Upload a custom app"
6. Velg "Upload for me or my teams"
7. Last opp manifest-zip-filen du lastet ned tidligere

## Feilsøking

Hvis du støter på problemer:

- Sørg for at appen har de korrekte tillatelsene gitt
- Sjekk at omdirigerings-URI-en samsvarer nøyaktig (erstatt `your-oneuptime-domain.com` med ditt faktiske domene)
- Verifiser at miljøvariablene er satt korrekt
- Sørg for at bot-meldingsendepunktet er tilgjengelig fra internett
- Verifiser at boten er korrekt konfigurert med Teams-kanalen
- Sjekk at Teams-appmanifestet er lastet opp vellykket

## Støtte

Vi ønsker å forbedre denne integrasjonen, så tilbakemeldinger er mer enn velkomne. Send oss gjerne en e-post til [hello@oneuptime.com](mailto:hello@oneuptime.com)
