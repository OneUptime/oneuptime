# Slack-integration

Anslut ditt självhostade OneUptime-projekt till Slack för aviseringar, incidentåtgärder, kommandon och meddelandehändelser.

## Konfiguration

1. Konfigurera OneUptimes värdnamn och HTTPS enligt nedan. Kopiera det genererade manifestet under **Settings > Slack Integration**, även tillgängligt på `https://your-oneuptime-domain.com/api/slack/app-manifest`.
2. [Skapa en Slack-app](https://api.slack.com/apps) i arbetsytan med manifestet från din egen installation så att URL:erna matchar värdnamnet.
3. Kopiera **Client ID**, **Client Secret** och **Signing Secret** från **Basic Information** till `config.env` för Docker Compose:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Använd dessa värden i Helm:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Tillämpa konfigurationen och vänta på omstart av OneUptime. Upprepa kontrollen av Events-URL:en om den misslyckades innan signeringshemligheten konfigurerades.
5. Återgå till **Settings > Slack Integration**, välj **Connect to Slack** och auktorisera appen. Anslut även ditt personliga Slack-konto i OneUptime för åtgärder som kräver användaridentitet.

## Nätverksåtkomst för självhostade installationer

### Trafikriktning och ändpunkter

| Trafik | Åtkomst som krävs |
| --- | --- |
| OneUptime → Slack | DNS och utgående HTTPS på TCP 443 till `slack.com` för Web API och OAuth-tokenutbyte; `hooks.slack.com` för kommandosvar och aviseringar via inkommande webhooks när de används |
| Slack → OneUptime | Offentlig HTTPS på TCP 443 till de fyra POST-rutterna nedan för hela integrationen |
| Användarens webbläsare → OneUptime | Dashboard och OAuth-omdirigeringar till `/api/slack/auth/:projectId/:userId` och `/api/slack/auth/:projectId/:userId/user`; kan förbli åtkomliga via användarens VPN |

Domänerna beskriver OneUptime-integrationen, inte en fullständig tillåtelselista för Slack-klienter eller alla funktioner. En *inkommande webhook* i Slack finns hos Slack: OneUptime skickar till den; den är ingen inkommande ändpunkt på din server. Se [guiden för inkommande webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Vidarebefordra dessa callbacks från leverantören till OneUptime-applikationen genom dess ingress:

| Metod och sökväg | Syfte |
| --- | --- |
| `POST /api/slack/events` | Events API-verifiering, reaktioner, omnämnanden och meddelanden |
| `POST /api/slack/interactive` | Knappar, genvägar, modala formulär, `/incident` och `/maintenance` |
| `POST /api/slack/options-load` | Förfrågningar om interaktiva menyalternativ |
| `POST /api/slack/command` | Kommandot `/oneuptime` |

OAuth använder en [webbläsaromdirigering följd av tokenutbyte på servern](https://docs.slack.dev/authentication/installing-with-oauth/). Manifestet registrerar `/api/slack/auth` som prefix; OneUptime lägger till projekt- och användarsökvägar vid auktorisering. Enbart webbläsaråtkomst låter inte Slack leverera händelser eller åtgärder.

### Privata installationer och callbacksäkerhet

Använd offentlig DNS och en gateway med offentligt betrott HTTPS-certifikat, fullständig certifikatkedja och privat väg till OneUptimes ingress. Tillåt inkommande TCP 443 och publicera endast leverantörens POST-callbacks ovan. Privat `ClusterIP`, intern DNS eller en anställds VPN ger inte leverantören åtkomst. Delad DNS kan hålla dashboard och webbläsarens OAuth-rutter privata under samma värdnamn.

Ange `HOST=oneuptime.example.com` och `HTTP_PROTOCOL=https` i `config.env`, eller `host: oneuptime.example.com` och `httpProtocol: https` i Helm. Tillämpa konfigurationen och vänta på omstart. Värdena genererar URL:er; de ordnar inte DNS, TLS eller brandväggsregler. Generera och uppdatera Slack-manifestet igen efter byte av värdnamn.

Bevara metod, sökväg, frågesträng, ursprunglig kropp, `Content-Type`, `X-Slack-Signature` och `X-Slack-Request-Timestamp`. Bevara offentlig värd och HTTPS genom betrodda proxyhuvuden. Undanta callbacks från webbläsar-SSO, CAPTCHA och proxyinloggning, men behåll OneUptimes signatur- och tidsstämpelkontroller. Synkronisera serverklockan. Kontroll av käll-IP ersätter inte [Slacks signaturverifiering](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Verifiera åtkomst och förstå begränsningar

Verifiera Events Request URL under **Event Subscriptions**: Slack skickar en [POST-utmaning och kontrollerar TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Skicka en testavisering, kör ett slash-kommando, tryck på en incidentknapp och utlös en prenumererad händelse. Granska gateway- och OneUptime-loggar utan att logga hemligheter. Slack kräver snabba kvittenser, inklusive [svar inom tre sekunder för interaktioner](https://docs.slack.dev/interactivity/handling-user-interaction/). Ett webbläsar-GET eller ett lyckat utgående meddelande verifierar inte POST-callbacks.

Utan inkommande anslutningar kan en redan auktoriserad app fortfarande skicka meddelanden via utgående HTTPS, men händelser, knappar, genvägar och kommandon fungerar inte. OneUptimes manifest använder HTTP-callbacks och inaktiverar Socket Mode; aktivering av Slack Socket Mode är inget alternativ som stöds. [Inställningen för privat nätverksåtkomst](/docs/self-hosted/private-network-access) styr utgående förfrågningar till privata mål och publicerar inte callbacks.
