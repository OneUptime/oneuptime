# Microsoft Teams-integrasjon

For å integrere Microsoft Teams med din selvhostede OneUptime-instans må du konfigurere Azure App Registration og sette opp de nødvendige miljøvariablene.

## Forutsetninger

- Azure-konto – Du kan opprette en ved å gå til [https://azure.com](https://azure.com)
- Tilgang til OneUptime-serverkonfigurasjonen din

## Nettverkstilgang

OneUptime bruker en Azure Bot til Teams-integrasjonen. En Incoming Webhook- eller Teams Workflow-URL erstatter ikke botens meldingsendepunkt. Microsoft krever et [offentlig tilgjengelig HTTPS-endepunkt for en selvhostet bot](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). En privat IP-adresse, et internt DNS-navn eller en ansatts VPN-tilkobling gir ikke Azure Bot Service tilgang til OneUptime.

| Funksjon | OneUptime til leverandør | Leverandør til OneUptime |
| --- | --- | --- |
| Teams-varsler | HTTPS til Microsoft-API-er | Påkrevd for hele botintegrasjonen, inkludert oppdagelse av samtaler |
| Teams-kommandoer, kortknapper, installasjonshendelser i chatter | HTTPS | `POST /api/microsoft-bot/messages` |

Appregistreringens omdirigeringer `/api/microsoft-teams/auth` og `/api/microsoft-teams/admin-consent/callback` returnerer gjennom brukerens nettleser. Nettleseren må kunne nå OneUptime, for eksempel via bedriftens nettverk eller VPN. Botmeldinger og korthandlinger kommer fra Microsofts servere og trenger sin egen tilgjengelige ingress. Utgående varslingslevering alene verifiserer ikke innkommende tilkobling.

### Produksjon: publiser en gateway til den private installasjonen

1. **Velg et vertsnavn**, for eksempel `oneuptime.example.com`. Publiser offentlige DNS-poster som peker til en internettvendt gateway. Private IP-adresser og interne DNS-navn er ikke tilgjengelige for leverandørene. Med delt DNS kan ansatte la samme vertsnavn peke til den private ingressen og fortsette å bruke dashbordet via VPN. Den private ingressen må også tilby HTTPS med et sertifikat som er gyldig for dette vertsnavnet.

2. **Koble gatewayen til OneUptime.** Plasser den i en DMZ med en rute til den private ingressen, eller bruk en offentlig gateway koblet til via din egen site-to-site-VPN/private forbindelse. Tillat trafikk fra gateway til ingress på porten til den bakenforliggende tjenesten. For Kubernetes/Portainer er ikke en privat `ClusterIP`-tjeneste alene tilstrekkelig: gatewayen trenger en ingress/controller eller en annen tilgjengelig bakenforliggende tjeneste. Hold databaser og andre interne tjenester private.

3. **Terminer HTTPS på port 443** med et offentlig betrodd sertifikat og en fullstendig kjede av mellomsertifikater. Tillat innkommende TCP 443 til gatewayen. Å installere et sertifikat eller endre DNS oppretter ikke i seg selv en rute til den private bakenforliggende tjenesten.

4. Publiser bare `/api/microsoft-bot/messages`, og angi denne komplette offentlige HTTPS-URL-en som Azure Bots meldingsendepunkt i trinn 4. OneUptimes Bot Framework-adapter må motta og autentisere forespørslene. Behold metode, sti, spørringsstreng, innhold og autentiseringsheadere (`Authorization`). Behold offentlig `Host`, og angi betrodde headere `X-Forwarded-Host` og `X-Forwarded-Proto: https`. Ikke legg til omdirigeringer.

5. Unnta disse stiene fra nettleser-SSO, CAPTCHA og proxyens innloggingssider. Behold OneUptimes autentisering aktivert. Begrens tilgang til opprinnelsesserveren til gatewayen og autoriserte interne klienter; skjul token i logger.

6. **Angi OneUptimes kanoniske URL**:

   Docker Compose, i `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-verdier:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Erstatt eksemplet med domenet ditt. Innstillingene genererer URL-er; de oppretter ikke DNS, TLS eller brannmurregler. Bruk Compose-konfigurasjonen eller Helm-oppdateringen, og vent til applikasjonen starter på nytt. Hvis vertsnavnet endres, oppdaterer du Azure Bot-endepunktet og appregistreringens omdirigerings-URI-er, og laster deretter ned og opp Teams-manifestet på nytt.

[Innstillingene for tilgang til private nettverk](/docs/self-hosted/private-network-access) styrer OneUptimes utgående forespørsler til interne tjenester. Aktivering av `ALLOW_PRIVATE_NETWORK_WEBHOOKS` gjør ikke OneUptime tilgjengelig for Teams.

### Utgående tilgang og IP-begrensninger

Tillat DNS-oppslag og utgående HTTPS (TCP 443) fra OneUptime-applikasjonen. Teams bruker `graph.microsoft.com`, `login.microsoftonline.com`, Bot Frameworks autentiserings-/kanalendepunkter og connector-tjeneste-URL-en for samtalen. Bruk [Microsofts brannmurveiledning](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0), og undersøk blokkert trafikk under testing; disse eksemplene er ikke en uttømmende domeneliste. Reserveconnectoren i den kommersielle skyen er `https://smba.trafficmanager.net/teams/`; tjeneste-URL-en for en samtale kan være annerledes.

Microsoft støtter ikke faste tillatelseslister for inngående Bot Framework-IP-er, fordi adressene endres. Teams-klientenes medieområder er ikke bot-webhooks' kildeadresser. Behold Bot Framework-autentisering aktivert.

### Testing og installasjoner uten innkommende tilgang

Kontroller offentlig DNS og TLS fra et nettverk utenfor VPN-en, og kontroller deretter Teams-ruten:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

På gjeldende OneUptime-versjoner forventer du `405 Method Not Allowed` med `Allow: POST`. Dette bekrefter at GET-forespørselen nådde ruten, men ikke at en autentisert POST-forespørsel fra boten vil fungere. Eldre versjoner kan returnere OneUptimes JSON-404; undersøk svarinnholdet og proxyloggene. TLS-feil, tidsavbrudd eller en HTML-feilside fra en proxy tyder på sertifikat- eller rutingsproblemer.

Koble til Teams, send et testvarsel, skriv til boten og trykk på en kortknapp. Bekreft handlingen i OneUptime, og sammenhold Microsofts diagnostikk med gateway- og applikasjonslogger. Et levert varsel bekrefter ikke en autentisert inngående POST.

For utvikling beskriver Microsofts [Teams-testveiledning](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams) hvordan du eksponerer en lokal tjeneste med en tunnel. Videresend til OneUptimes ingress, og bruk `/api/microsoft-bot/messages` i stedet for Microsofts eksempelsti `/api/messages`. Oppdater Azure Bot-endepunktet når den offentlige tunnel-URL-en endres, og bruk en stabil ingress i produksjon. Konfigurer også det tilsvarende OneUptime-vertsnavnet. Stopp tunnelen etter testing; den gir fortsatt inngående tilgang.

Hvis all inngående tilkobling er forbudt, fungerer ikke den komplette Teams-integrasjonen: kommandoer, korthandlinger og oppdagelse av samtaler avhenger av den. En helt frakoblet installasjon kan ikke bruke Teams.

Azure Bot Private Endpoint erstatter ikke denne Teams-ingressen. Microsofts [instruksjoner om nettverksisolering](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) beskriver Direct Line-isolering og sier at deaktivering av offentlig nettverkstilgang fjerner konfigurasjonen av Teams-kanaler.

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

`ChannelMessage.Send` er bare en delegert tillatelse; den har ingen variant som applikasjonstillatelse i [Microsoft Graphs tillatelsesreferanse](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend). Behold den i listen over delegerte tillatelser ovenfor.

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

1. Gå til prosjektets **Prosjektinnstillinger** > **Arbeidsområde** > **Microsoft Teams**
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
