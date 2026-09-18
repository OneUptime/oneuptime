# Slack-integrasjon

Koble ditt selvhostede OneUptime-prosjekt til Slack for varsler, hendelseshandlinger, kommandoer og meldingshendelser.

## Oppsett

1. Konfigurer OneUptimes vertsnavn og HTTPS som beskrevet nedenfor. Kopier det genererte manifestet under **Settings > Slack Integration**, også tilgjengelig på `https://your-oneuptime-domain.com/api/slack/app-manifest`.
2. [Opprett en Slack-app](https://api.slack.com/apps) i arbeidsområdet med manifestet fra din egen installasjon, slik at URL-ene samsvarer med vertsnavnet.
3. Kopier **Client ID**, **Client Secret** og **Signing Secret** fra **Basic Information** til `config.env` for Docker Compose:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Bruk disse verdiene i Helm:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Bruk konfigurasjonen og vent på omstart av OneUptime. Gjenta Events-URL-kontrollen hvis den feilet før signeringshemmeligheten var konfigurert.
5. Gå tilbake til **Settings > Slack Integration**, velg **Connect to Slack** og godkjenn appen. Koble også din personlige Slack-konto i OneUptime for handlinger som krever brukeridentitet.

## Nettverkstilgang for selvhostede installasjoner

### Trafikkretning og endepunkter

| Trafikk | Nødvendig tilgang |
| --- | --- |
| OneUptime → Slack | DNS og utgående HTTPS på TCP 443 til `slack.com` for Web API og OAuth-tokenutveksling; `hooks.slack.com` for kommandosvar og varsler via innkommende webhooks når de brukes |
| Slack → OneUptime | Offentlig HTTPS på TCP 443 til de fire POST-rutene nedenfor for hele integrasjonen |
| Brukerens nettleser → OneUptime | Dashbord og OAuth-omdirigeringer til `/api/slack/auth/:projectId/:userId` og `/api/slack/auth/:projectId/:userId/user`; kan fortsatt være tilgjengelige via brukerens VPN |

Domenene beskriver OneUptime-integrasjonen, ikke en fullstendig tillatelsesliste for Slack-klienter eller alle funksjoner. En Slack-*innkommende webhook* driftes av Slack: OneUptime sender til den; den er ikke et innkommende endepunkt på din server. Se [veiledningen for innkommende webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Videresend disse callbackene fra leverandøren til OneUptime-applikasjonen gjennom ingress:

| Metode og sti | Formål |
| --- | --- |
| `POST /api/slack/events` | Events API-verifisering, reaksjoner, omtaler og meldinger |
| `POST /api/slack/interactive` | Knapper, snarveier, innsending av modaler, `/incident` og `/maintenance` |
| `POST /api/slack/options-load` | Forespørsler om interaktive menyalternativer |
| `POST /api/slack/command` | Kommandoen `/oneuptime` |

OAuth bruker en [nettleseromdirigering etterfulgt av tokenutveksling på serveren](https://docs.slack.dev/authentication/installing-with-oauth/). Manifestet registrerer `/api/slack/auth` som prefiks; OneUptime legger til prosjekt- og brukerstier ved godkjenning. Nettlesertilgang alene lar ikke Slack levere hendelser eller handlinger.

### Private installasjoner og sikkerhet for callbacks

Bruk offentlig DNS og en gateway med offentlig betrodd HTTPS-sertifikat, komplett sertifikatkjede og privat rute til OneUptime-ingress. Tillat innkommende TCP 443 og publiser bare leverandørens POST-callbacks ovenfor. Privat `ClusterIP`, intern DNS eller ansatt-VPN gir ikke leverandøren tilgang. Delt DNS kan holde dashbord og nettleserens OAuth-ruter private under samme vertsnavn.

Sett `HOST=oneuptime.example.com` og `HTTP_PROTOCOL=https` i `config.env`, eller `host: oneuptime.example.com` og `httpProtocol: https` i Helm. Bruk konfigurasjonen og vent på omstart. Verdiene genererer URL-er; de oppretter ikke DNS, TLS eller brannmurregler. Generer og oppdater Slack-manifestet på nytt hvis vertsnavnet endres.

Bevar metode, sti, spørringsstreng, opprinnelig body, `Content-Type`, `X-Slack-Signature` og `X-Slack-Request-Timestamp`. Bevar offentlig vert og HTTPS gjennom betrodde proxy-headere. Unnta callbacks fra nettleser-SSO, CAPTCHA og proxyinnlogging, men behold OneUptimes signatur- og tidsstempelkontroller. Synkroniser serverklokken. Kontroll av kilde-IP erstatter ikke [Slacks signaturverifisering](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Kontroller tilgang og forstå begrensninger

Kontroller Events Request URL under **Event Subscriptions**: Slack sender en [POST-challenge og kontrollerer TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Send et testvarsel, kjør en slash-kommando, trykk på en hendelsesknapp og utløs en abonnert hendelse. Undersøk gateway- og OneUptime-logger uten å logge hemmeligheter. Slack krever raske bekreftelser, blant annet [svar innen tre sekunder for interaksjoner](https://docs.slack.dev/interactivity/handling-user-interaction/). En nettleser-GET eller vellykket utgående melding verifiserer ikke POST-callbacks.

Uten innkommende forbindelser kan en allerede godkjent app sende meldinger via utgående HTTPS, men hendelser, knapper, snarveier og kommandoer virker ikke. OneUptimes manifest bruker HTTP-callbacks og deaktiverer Socket Mode; aktivering av Slack Socket Mode er ikke et støttet alternativ. [Innstillingen for privat nettverkstilgang](/docs/self-hosted/private-network-access) styrer utgående forespørsler til private mål og publiserer ikke callbacks.
