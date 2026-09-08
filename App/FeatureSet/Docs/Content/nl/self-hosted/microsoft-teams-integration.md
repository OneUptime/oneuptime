# Microsoft Teams-integratie

Om Microsoft Teams te integreren met uw zelf-gehoste OneUptime-instantie, moet u Azure App-registratie configureren en de vereiste omgevingsvariabelen instellen.

## Vereisten

- Azure-account — U kunt er een aanmaken op [https://azure.com](https://azure.com)
- Toegang tot uw OneUptime-serverconfiguratie

## Netwerktoegang

OneUptime gebruikt een Azure Bot voor de Teams-integratie. Een Incoming Webhook- of Teams Workflow-URL vervangt het berichteneindpunt van deze bot niet. Microsoft vereist een [openbaar toegankelijk HTTPS-eindpunt voor een zelfgehoste bot](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). Een privé-IP-adres, interne DNS-naam of VPN-verbinding van een medewerker geeft Azure Bot Service geen toegang tot OneUptime.

| Functie | OneUptime naar aanbieder | Aanbieder naar OneUptime |
| --- | --- | --- |
| Teams-meldingen | HTTPS naar Microsoft-API's | Vereist voor de volledige botintegratie, inclusief het ontdekken van gesprekken |
| Teams-opdrachten, kaartknoppen, installatiegebeurtenissen in chats | HTTPS | `POST /api/microsoft-bot/messages` |

De omleidingen van de appregistratie `/api/microsoft-teams/auth` en `/api/microsoft-teams/admin-consent/callback` keren terug via de browser van de gebruiker. Die browser moet OneUptime kunnen bereiken, bijvoorbeeld via uw bedrijfsnetwerk of VPN. Botberichten en kaartacties komen van Microsofts servers en hebben een eigen bereikbare ingress nodig. Alleen uitgaande aflevering van meldingen verifieert de inkomende verbinding niet.

### Productie: publiceer een gateway naar de privé-installatie

1. **Kies een hostnaam**, bijvoorbeeld `oneuptime.example.com`. Publiceer openbare DNS-records die naar een internetgerichte gateway verwijzen. Privé-IP-adressen en uitsluitend interne DNS-namen zijn niet bereikbaar voor de aanbieders. Met split-DNS kunnen medewerkers dezelfde hostnaam naar de privé-ingress laten verwijzen en het dashboard via de VPN blijven gebruiken. De privé-ingress moet ook HTTPS aanbieden met een certificaat dat geldig is voor die hostnaam.

2. **Verbind de gateway met OneUptime.** Plaats deze in een DMZ met een route naar de privé-ingress, of gebruik een openbare gateway die via uw eigen site-to-site-VPN/privéverbinding is verbonden. Sta verkeer van de gateway naar de ingress toe op de poort van de achterliggende dienst. Voor Kubernetes/Portainer volstaat een privéservice van het type `ClusterIP` niet: de gateway heeft een ingress/controller of een andere bereikbare achterliggende dienst nodig. Houd databases en andere interne diensten privé.

3. **Beëindig HTTPS op poort 443** met een publiek vertrouwd certificaat en een volledige keten van tussencertificaten. Sta inkomend TCP 443 naar de gateway toe. Alleen een certificaat installeren of DNS wijzigen maakt nog geen route naar de privé-infrastructuur aan.

4. Publiceer alleen `/api/microsoft-bot/messages` en stel deze volledige openbare HTTPS-URL in stap 4 in als Azure Bot-berichtenendpoint. OneUptimes Bot Framework-adapter moet de verzoeken ontvangen en authenticeren. Behoud methode, pad, querystring, inhoud en authenticatieheaders (`Authorization`). Behoud de openbare `Host` en stel vertrouwde headers `X-Forwarded-Host` en `X-Forwarded-Proto: https` in. Voeg geen omleidingen toe.

5. Stel deze paden vrij van browser-SSO, CAPTCHA en proxy-inlogpagina's. Houd OneUptime-authenticatie ingeschakeld. Beperk toegang tot de oorspronkelijke server tot de gateway en bevoegde interne clients; maskeer tokens in logboeken.

6. **Stel de canonieke URL van OneUptime in**:

   Docker Compose, in `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-waarden:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Vervang het voorbeeld door uw domein. Deze instellingen genereren URL's; ze maken geen DNS, TLS of firewallregels aan. Pas de Compose-configuratie of Helm-update toe en wacht tot de applicatie opnieuw is gestart. Werk bij een hostnaamwijziging het Azure Bot-endpoint en de omleidings-URI's van de appregistratie bij en download en upload daarna het Teams-manifest opnieuw.

De [instellingen voor toegang tot privénetwerken](/docs/self-hosted/private-network-access) regelen uitgaande verzoeken van OneUptime naar interne diensten. Het inschakelen van `ALLOW_PRIVATE_NETWORK_WEBHOOKS` maakt OneUptime niet bereikbaar voor Teams.

### Uitgaande toegang en IP-beperkingen

Sta DNS-resolutie en uitgaand HTTPS (TCP 443)-verkeer vanuit de OneUptime-applicatie toe. Teams gebruikt `graph.microsoft.com`, `login.microsoftonline.com`, authenticatie-/kanaaleindpunten van Bot Framework en de connectorservice-URL voor het gesprek. Gebruik [Microsofts firewallrichtlijnen](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) en controleer geblokkeerd verkeer tijdens het testen; deze voorbeelden vormen geen volledige domeinlijst. De reserveconnector voor de commerciële cloud is `https://smba.trafficmanager.net/teams/`; de service-URL van een gesprek kan afwijken.

Microsoft ondersteunt geen vaste lijsten met toegestane inkomende Bot Framework-IP-adressen, omdat deze veranderen. Teams-clientmediabereiken zijn geen bronadressen voor botwebhooks. Houd Bot Framework-authenticatie ingeschakeld.

### Testen en installaties zonder inkomende toegang

Controleer openbare DNS en TLS vanuit een netwerk buiten uw VPN en controleer vervolgens de Teams-route:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Verwacht bij huidige OneUptime-versies `405 Method Not Allowed` met `Allow: POST`. Dit bevestigt dat het GET-verzoek de route heeft bereikt, maar niet dat een geauthenticeerd POST-verzoek van de bot zal werken. Oudere versies kunnen de JSON-404 van OneUptime teruggeven; controleer de inhoud van het antwoord en de proxylogs. TLS-fouten, time-outs of een HTML-foutpagina van een proxy wijzen op certificaat- of routeringsproblemen.

Verbind Teams, stuur een testmelding, schrijf aan de bot en druk op een kaartknop. Bevestig de actie in OneUptime en vergelijk Microsoft-diagnostiek met de gateway- en applicatielogboeken. Een bezorgde melding verifieert geen geauthenticeerde inkomende POST.

Voor ontwikkeling beschrijft Microsofts [Teams-testhandleiding](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams) hoe u een lokale dienst via een tunnel beschikbaar maakt. Stuur door naar de ingress van OneUptime en gebruik `/api/microsoft-bot/messages` in plaats van Microsofts voorbeeldpad `/api/messages`. Werk het Azure Bot-eindpunt bij wanneer de openbare tunnel-URL verandert en gebruik een stabiele ingress voor productie. Configureer ook de bijbehorende OneUptime-hostnaam. Stop de tunnel na het testen; deze biedt nog steeds inkomende toegang.

Als alle inkomende verbindingen verboden zijn, werkt de volledige Teams-integratie niet: opdrachten, kaartacties en gespreksherkenning zijn daarvan afhankelijk. Een volledig losgekoppelde installatie kan Teams niet gebruiken.

Azure Bot Private Endpoint vervangt deze Teams-ingress niet. Microsofts [instructies voor netwerkisolatie](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) beschrijven isolatie van Direct Line en stellen dat Teams-kanalen worden verwijderd als openbare netwerktoegang wordt uitgeschakeld.

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

`ChannelMessage.Send` is uitsluitend een gedelegeerde machtiging; deze heeft geen variant als applicatiemachtiging in de [Microsoft Graph-machtigingenreferentie](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend). Laat deze in de bovenstaande lijst met gedelegeerde machtigingen staan.

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

1. Ga naar **Projectinstellingen** > **Werkruimte** > **Microsoft Teams**
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
