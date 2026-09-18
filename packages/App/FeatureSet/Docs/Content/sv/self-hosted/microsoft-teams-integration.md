# Microsoft Teams-integration

För att integrera Microsoft Teams med din egeninstallerade OneUptime-instans behöver du konfigurera Azure App Registration och ange de obligatoriska miljövariablerna.

## Förutsättningar

- Azure-konto – Du kan skapa ett på [https://azure.com](https://azure.com)
- Åtkomst till din OneUptime-serverkonfiguration

## Nätverksåtkomst

OneUptime använder en Azure Bot för Teams-integrationen. En Incoming Webhook- eller Teams Workflow-URL ersätter inte botens meddelandeslutpunkt. Microsoft kräver en [offentligt tillgänglig HTTPS-slutpunkt för en egenhostad bot](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). En privat IP-adress, ett internt DNS-namn eller en anställds VPN-anslutning ger inte Azure Bot Service åtkomst till OneUptime.

| Funktion | OneUptime till leverantör | Leverantör till OneUptime |
| --- | --- | --- |
| Teams-aviseringar | HTTPS till Microsofts API:er | Krävs för den fullständiga botintegrationen, inklusive upptäckt av konversationer |
| Teams-kommandon, kortknappar, installationshändelser i chattar | HTTPS | `POST /api/microsoft-bot/messages` |

Appregistreringens omdirigeringar `/api/microsoft-teams/auth` och `/api/microsoft-teams/admin-consent/callback` återvänder via användarens webbläsare. Webbläsaren måste kunna nå OneUptime, exempelvis via företagsnätverket eller VPN. Botmeddelanden och kortåtgärder kommer från Microsofts servrar och behöver en egen nåbar ingress. Utgående aviseringsleverans verifierar inte i sig inkommande anslutning.

### Produktion: publicera en gateway till den privata installationen

1. **Välj ett värdnamn**, till exempel `oneuptime.example.com`. Publicera offentliga DNS-poster som pekar på en gateway mot internet. Privata IP-adresser och interna DNS-namn är inte nåbara för leverantörerna. Med delad DNS kan anställda låta samma värdnamn peka på den privata ingressen och fortsätta använda instrumentpanelen via VPN. Den privata ingressen måste också erbjuda HTTPS med ett certifikat som är giltigt för värdnamnet.

2. **Anslut gatewayen till OneUptime.** Placera den i en DMZ med en väg till den privata ingressen eller använd en offentlig gateway ansluten via din egen site-to-site-VPN/privata länk. Tillåt trafik från gateway till ingress på den bakomliggande tjänstens port. För Kubernetes/Portainer räcker inte en privat `ClusterIP`-tjänst: gatewayen behöver en ingress/controller eller en annan nåbar bakomliggande tjänst. Håll databaser och andra interna tjänster privata.

3. **Terminera HTTPS på port 443** med ett offentligt betrott certifikat och en fullständig kedja av mellanliggande certifikat. Tillåt inkommande TCP 443 till gatewayen. Att installera ett certifikat eller ändra DNS skapar inte i sig en väg till den privata bakomliggande tjänsten.

4. Publicera endast `/api/microsoft-bot/messages` och ange denna fullständiga offentliga HTTPS-URL som Azure Bots meddelandeslutpunkt i steg 4. OneUptimes Bot Framework-adapter måste ta emot och autentisera förfrågningarna. Bevara metod, sökväg, frågesträng, innehåll och autentiseringshuvuden (`Authorization`). Behåll offentlig `Host` och ange betrodda huvuden `X-Forwarded-Host` och `X-Forwarded-Proto: https`. Lägg inte till omdirigeringar.

5. Undanta dessa sökvägar från webbläsar-SSO, CAPTCHA och proxyns inloggningssidor. Behåll OneUptimes autentisering aktiverad. Begränsa åtkomst till ursprungsservern till gatewayen och behöriga interna klienter; maskera token i loggar.

6. **Ange OneUptimes kanoniska URL**:

   Docker Compose, i `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-värden:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Ersätt exemplet med din domän. Inställningarna genererar URL:er; de skapar inte DNS, TLS eller brandväggsregler. Tillämpa Compose-konfigurationen eller Helm-uppdateringen och vänta på att applikationen startas om. Om värdnamnet ändras uppdaterar du Azure Bot-slutpunkten och appregistreringens omdirigerings-URI:er och laddar sedan ned och upp Teams-manifestet igen.

[Inställningarna för privat nätverksåtkomst](/docs/self-hosted/private-network-access) styr OneUptimes utgående begäranden till interna tjänster. Att aktivera `ALLOW_PRIVATE_NETWORK_WEBHOOKS` gör inte OneUptime nåbart för Teams.

### Utgående åtkomst och IP-begränsningar

Tillåt DNS-uppslagning och utgående HTTPS (TCP 443) från OneUptime-applikationen. Teams använder `graph.microsoft.com`, `login.microsoftonline.com`, Bot Frameworks autentiserings-/kanalslutpunkter och anslutningstjänstens URL för konversationen. Använd [Microsofts brandväggsvägledning](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) och undersök blockerad trafik vid testning; exemplen utgör ingen fullständig domänlista. Reservanslutningen i det kommersiella molnet är `https://smba.trafficmanager.net/teams/`; en konversations tjänst-URL kan skilja sig åt.

Microsoft stöder inte fasta tillåtelselistor för inkommande Bot Framework-IP-adresser, eftersom adresserna ändras. Teams-klienternas medieintervall är inte källadresser för botens webhooks. Behåll Bot Framework-autentisering aktiverad.

### Testning och installationer utan inkommande åtkomst

Kontrollera offentlig DNS och TLS från ett nätverk utanför din VPN och kontrollera sedan Teams-sökvägen:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

På aktuella OneUptime-versioner förväntas `405 Method Not Allowed` med `Allow: POST`. Det bekräftar att GET-begäran nådde sökvägen, men inte att en autentiserad POST-begäran från boten fungerar. Äldre versioner kan returnera OneUptimes JSON-404; granska svarsinnehållet och proxyloggarna. TLS-fel, tidsgränser som överskrids eller en proxys HTML-felsida tyder på certifikat- eller routningsproblem.

Anslut Teams, skicka ett testmeddelande, skriv till boten och tryck på en kortknapp. Bekräfta åtgärden i OneUptime och jämför Microsofts diagnostik med gatewayens och applikationens loggar. Ett levererat meddelande verifierar inte en autentiserad inkommande POST.

För utveckling beskriver Microsofts [Teams-testguide](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams) hur en lokal tjänst exponeras med en tunnel. Vidarebefordra till OneUptimes ingress och använd `/api/microsoft-bot/messages` i stället för Microsofts exempelsökväg `/api/messages`. Uppdatera Azure Bot-slutpunkten när den offentliga tunnel-URL:en ändras och använd en stabil ingress i produktion. Konfigurera även motsvarande OneUptime-värdnamn. Stoppa tunneln efter testningen; den exponerar fortfarande inkommande åtkomst.

Om alla inkommande anslutningar är förbjudna fungerar inte den fullständiga Teams-integrationen: kommandon, kortåtgärder och identifiering av konversationer kräver dem. En helt frånkopplad installation kan inte använda Teams.

Azure Bot Private Endpoint ersätter inte denna Teams-ingress. Microsofts [instruktioner om nätverksisolering](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) beskriver Direct Line-isolering och anger att Teams-kanaler avkonfigureras när offentlig nätverksåtkomst inaktiveras.

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

`ChannelMessage.Send` är endast en delegerad behörighet; den har ingen variant som programbehörighet i [Microsoft Graphs behörighetsreferens](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend). Behåll den i listan över delegerade behörigheter ovan.

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

1. Gå till **Projektinställningar** > **Arbetsyta** > **Microsoft Teams**
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
