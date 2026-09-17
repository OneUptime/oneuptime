# Microsoft Teams-integration

For at integrere Microsoft Teams med din selvhostede OneUptime-instans skal du konfigurere Azure App Registration og opsætte de nødvendige miljøvariabler.

## Forudsætninger

- Azure-konto – Du kan oprette en ved at gå til [https://azure.com](https://azure.com)
- Adgang til din OneUptime-serverkonfiguration

## Netværksadgang

OneUptime bruger en Azure Bot til Teams-integrationen. En Incoming Webhook- eller Teams Workflow-URL erstatter ikke bottens meddelelsesendepunkt. Microsoft kræver et [offentligt tilgængeligt HTTPS-endepunkt for en selvhostet bot](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). En privat IP-adresse, et internt DNS-navn eller en medarbejders VPN-forbindelse giver ikke Azure Bot Service adgang til OneUptime.

| Funktion | OneUptime til udbyder | Udbyder til OneUptime |
| --- | --- | --- |
| Teams-notifikationer | HTTPS til Microsoft-API'er | Påkrævet til den fulde botintegration, herunder registrering af samtaler |
| Teams-kommandoer, kortknapper, installationshændelser i chats | HTTPS | `POST /api/microsoft-bot/messages` |

Appregistreringens omdirigeringer `/api/microsoft-teams/auth` og `/api/microsoft-teams/admin-consent/callback` returnerer gennem brugerens browser. Browseren skal kunne nå OneUptime, for eksempel via virksomhedens netværk eller VPN. Botbeskeder og korthandlinger kommer fra Microsofts servere og kræver deres egen tilgængelige ingress. Udgående alarmlevering alene verificerer ikke indgående forbindelse.

### Produktion: offentliggør en gateway til den private installation

1. **Vælg et værtsnavn**, for eksempel `oneuptime.example.com`. Offentliggør DNS-poster, der peger på en gateway mod internettet. Private IP-adresser og interne DNS-navne er ikke tilgængelige for udbyderne. Med split-DNS kan medarbejdere lade samme værtsnavn pege på den private ingress og fortsætte med at bruge dashboardet via VPN. Den private ingress skal også tilbyde HTTPS med et certifikat, der er gyldigt for dette værtsnavn.

2. **Forbind gatewayen til OneUptime.** Placer den i en DMZ med en rute til den private ingress, eller brug en offentlig gateway forbundet via din egen site-to-site-VPN/private forbindelse. Tillad trafik fra gateway til ingress på den bagvedliggende tjenestes port. For Kubernetes/Portainer er en privat `ClusterIP`-tjeneste alene utilstrækkelig: gatewayen kræver en ingress/controller eller en anden tilgængelig bagvedliggende tjeneste. Hold databaser og andre interne tjenester private.

3. **Terminér HTTPS på port 443** med et offentligt betroet certifikat og en komplet kæde af mellemliggende certifikater. Tillad indgående TCP 443 til gatewayen. Installation af et certifikat eller ændring af DNS opretter ikke i sig selv en rute til den private bagvedliggende tjeneste.

4. Offentliggør kun `/api/microsoft-bot/messages`, og angiv hele denne offentlige HTTPS-URL som Azure Bots messaging-endepunkt i trin 4. OneUptimes Bot Framework-adapter skal modtage og godkende anmodningerne. Bevar metode, sti, query-streng, indhold og godkendelsesheadere (`Authorization`). Bevar den offentlige `Host`, og angiv betroede headere `X-Forwarded-Host` og `X-Forwarded-Proto: https`. Tilføj ikke omdirigeringer.

5. Undtag disse stier fra browser-SSO, CAPTCHA og proxyens login-sider. Hold OneUptimes godkendelse aktiveret. Begræns adgang til oprindelsesserveren til gatewayen og autoriserede interne klienter; skjul tokens i logfiler.

6. **Indstil OneUptimes kanoniske URL**:

   Docker Compose, i `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-værdier:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Erstat eksemplet med dit domæne. Disse indstillinger genererer URL'er; de opretter ikke DNS, TLS eller firewallregler. Anvend Compose-konfigurationen eller Helm-opdateringen, og vent på, at applikationen genstarter. Hvis værtsnavnet ændres, skal du opdatere Azure Bot-endepunktet og appregistreringens redirect-URI'er og derefter hente og uploade Teams-manifestet igen.

[Indstillingerne for adgang til private netværk](/docs/self-hosted/private-network-access) styrer OneUptimes udgående anmodninger til interne tjenester. Aktivering af `ALLOW_PRIVATE_NETWORK_WEBHOOKS` gør ikke OneUptime tilgængelig for Teams.

### Udgående adgang og IP-begrænsninger

Tillad DNS-opslag og udgående HTTPS (TCP 443) fra OneUptime-applikationen. Teams bruger `graph.microsoft.com`, `login.microsoftonline.com`, Bot Frameworks godkendelses-/kanalendepunkter og samtalens connector-service-URL. Brug [Microsofts firewallvejledning](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0), og undersøg blokeret trafik under test; disse eksempler er ikke en udtømmende domæneliste. Reserveconnectoren i den kommercielle cloud er `https://smba.trafficmanager.net/teams/`; en samtales service-URL kan være en anden.

Microsoft understøtter ikke faste indgående IP-tilladelseslister for Bot Framework, da adresserne ændres. Teams-klienternes medieområder er ikke bot-webhooks' kildeadresser. Hold Bot Framework-godkendelsen aktiveret.

### Test og installationer uden indgående adgang

Kontroller offentlig DNS og TLS fra et netværk uden for din VPN, og kontroller derefter Teams-ruten:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

På aktuelle OneUptime-versioner skal du forvente `405 Method Not Allowed` med `Allow: POST`. Det bekræfter, at GET-anmodningen nåede ruten, men ikke at en godkendt POST-anmodning fra botten vil fungere. Ældre versioner kan returnere OneUptimes JSON-404; undersøg svarets indhold og proxylogfilerne. TLS-fejl, timeouts eller en proxys HTML-fejlside tyder på certifikat- eller routingproblemer.

Forbind Teams, send en testmeddelelse, skriv til botten, og tryk på en kortknap. Bekræft handlingen i OneUptime, og sammenhold Microsofts diagnostik med gatewayens og applikationens logfiler. En leveret meddelelse bekræfter ikke en godkendt indgående POST.

Til udvikling beskriver Microsofts [Teams-testvejledning](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams), hvordan en lokal tjeneste eksponeres med en tunnel. Videresend til OneUptimes ingress, og brug `/api/microsoft-bot/messages` i stedet for Microsofts eksempelsti `/api/messages`. Opdater Azure Bot-endepunktet, når den offentlige tunnel-URL ændres, og brug en stabil ingress til produktion. Konfigurér også det tilsvarende OneUptime-værtsnavn. Stop tunnelen efter test; den giver stadig indgående adgang.

Hvis al indgående trafik er forbudt, virker den fulde Teams-integration ikke: kommandoer, korthandlinger og registrering af samtaler afhænger af den. En helt frakoblet installation kan ikke bruge Teams.

Azure Bot Private Endpoint er ikke en erstatning for denne Teams-ingress. Microsofts [instruktioner om netværksisolering](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) beskriver Direct Line-isolering og angiver, at deaktivering af offentlig netværksadgang fjerner konfigurationen af Teams-kanaler.

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

`ChannelMessage.Send` er kun en delegeret tilladelse; den har ingen applikationstilladelsesvariant i [Microsoft Graphs tilladelsesreference](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend). Behold den i listen over delegerede tilladelser ovenfor.

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

1. Gå til **Projektindstillinger** > **Arbejdsområde** > **Microsoft Teams**
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
