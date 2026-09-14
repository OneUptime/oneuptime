# Slack-integratie

Verbind uw zelfgehoste OneUptime-project met Slack voor meldingen, incidentacties, opdrachten en berichtgebeurtenissen.

## Instellen

1. Stel de OneUptime-hostnaam en HTTPS hieronder in. Kopieer het gegenereerde manifest onder **Settings > Slack Integration**, ook beschikbaar op `https://your-oneuptime-domain.com/api/slack/app-manifest`.
2. [Maak een Slack-app](https://api.slack.com/apps) in uw workspace met het manifest van uw eigen installatie, zodat de URL’s overeenkomen met uw hostnaam.
3. Kopieer **Client ID**, **Client Secret** en **Signing Secret** uit **Basic Information** naar `config.env` voor Docker Compose:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Gebruik voor Helm deze waarden:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Pas de configuratie toe en wacht tot OneUptime opnieuw is gestart. Herhaal de controle van de Events-URL als deze mislukte voordat het ondertekeningsgeheim was ingesteld.
5. Ga terug naar **Settings > Slack Integration**, kies **Connect to Slack** en autoriseer de app. Verbind ook uw persoonlijke Slack-account in OneUptime voor acties waarvoor een gebruikersidentiteit nodig is.

## Netwerktoegang voor zelfgehoste installaties

### Verkeersrichting en endpoints

| Verkeer | Vereiste toegang |
| --- | --- |
| OneUptime → Slack | DNS en uitgaand HTTPS via TCP 443 naar `slack.com` voor Web API en OAuth-tokenuitwisseling; `hooks.slack.com` voor opdrachtantwoorden en meldingen via inkomende webhooks indien gebruikt |
| Slack → OneUptime | Openbaar HTTPS via TCP 443 naar de vier onderstaande POST-routes voor de volledige integratie |
| Browser van gebruiker → OneUptime | Dashboard en OAuth-omleidingen naar `/api/slack/auth/:projectId/:userId` en `/api/slack/auth/:projectId/:userId/user`; deze mogen via de gebruikers-VPN bereikbaar blijven |

Deze domeinen beschrijven de OneUptime-integratie, geen volledige toestemmingslijst voor Slack-clients of alle functies. Een *inkomende webhook* van Slack wordt door Slack gehost: OneUptime stuurt er verzoeken naartoe; het is geen inkomend endpoint op uw server. Zie de [handleiding voor inkomende webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Stuur deze callbacks van de provider via de ingress door naar de OneUptime-applicatie:

| Methode en pad | Doel |
| --- | --- |
| `POST /api/slack/events` | Events API-verificatie, reacties, vermeldingen en berichten |
| `POST /api/slack/interactive` | Knoppen, snelkoppelingen, modale formulieren, `/incident` en `/maintenance` |
| `POST /api/slack/options-load` | Verzoeken voor interactieve menuopties |
| `POST /api/slack/command` | Opdracht `/oneuptime` |

OAuth gebruikt een [browseromleiding gevolgd door tokenuitwisseling op de server](https://docs.slack.dev/authentication/installing-with-oauth/). Het manifest registreert `/api/slack/auth` als prefix; OneUptime voegt project- en gebruikerspaden toe tijdens autorisatie. Alleen browsertoegang geeft Slack geen toegang voor gebeurtenissen of acties.

### Privé-installaties en beveiliging van callbacks

Gebruik openbare DNS en een gateway met publiek vertrouwd HTTPS-certificaat, volledige certificaatketen en privéroute naar de OneUptime-ingress. Sta inkomend TCP 443 toe en publiceer alleen de genoemde POST-callbacks van de provider. Een privé-`ClusterIP`, interne DNS of medewerkers-VPN geeft de provider geen toegang. Met gesplitste DNS kunnen dashboard en browser-OAuth-routes privé blijven onder dezelfde hostnaam.

Stel `HOST=oneuptime.example.com` en `HTTP_PROTOCOL=https` in `config.env` in, of `host: oneuptime.example.com` en `httpProtocol: https` in Helm. Pas de configuratie toe en wacht op de herstart. Deze waarden genereren URL’s; ze regelen geen DNS, TLS of firewalltoegang. Genereer en actualiseer het Slack-manifest na een hostnaamwijziging.

Behoud methode, pad, querystring, oorspronkelijke body, `Content-Type`, `X-Slack-Signature` en `X-Slack-Request-Timestamp`. Behoud publieke host en HTTPS via vertrouwde proxyheaders. Zonder callbacks uit van browser-SSO, CAPTCHA en proxylogin, maar behoud OneUptime-controles van handtekening en tijdstempel. Synchroniseer de serverklok. Een bron-IP-controle vervangt geen [Slack-handtekeningverificatie](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Toegang controleren en beperkingen begrijpen

Controleer Events Request URL onder **Event Subscriptions**: Slack stuurt een [POST-challenge en controleert TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Verstuur een testmelding, voer een slash-opdracht uit, druk op een incidentknop en activeer een geabonneerde gebeurtenis. Controleer gateway- en OneUptime-logs zonder geheimen te loggen. Slack verwacht snelle bevestiging, bij [interacties binnen drie seconden](https://docs.slack.dev/interactivity/handling-user-interaction/). Een browser-GET of geslaagd uitgaand bericht verifieert de POST-callbacks niet.

Zonder inkomende verbindingen kan een al geautoriseerde app berichten via uitgaand HTTPS sturen, maar gebeurtenissen, knoppen, snelkoppelingen en opdrachten werken niet. Het OneUptime-manifest gebruikt HTTP-callbacks en schakelt Socket Mode uit; inschakelen van Slack Socket Mode is geen ondersteund alternatief. De [instelling voor privé-netwerktoegang](/docs/self-hosted/private-network-access) regelt uitgaande verzoeken naar privébestemmingen en publiceert geen callbacks.
