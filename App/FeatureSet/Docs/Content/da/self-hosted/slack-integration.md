# Slack-integration

Forbind dit selvhostede OneUptime-projekt med Slack for at sende notifikationer og bruge hændelseshandlinger, kommandoer og beskedhændelser.

## Opsætning

1. Indstil OneUptimes værtsnavn og HTTPS som beskrevet nedenfor. Kopiér det genererede manifest under **Settings > Slack Integration**, også tilgængeligt på `https://your-oneuptime-domain.com/api/slack/app-manifest`.
2. [Opret en Slack-app](https://api.slack.com/apps) i dit workspace med manifestet fra din egen installation, så URL’erne matcher værtsnavnet.
3. Kopiér **Client ID**, **Client Secret** og **Signing Secret** fra **Basic Information** til `config.env` ved Docker Compose:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Brug disse værdier i Helm:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Anvend konfigurationen, og vent på OneUptimes genstart. Gentag kontrollen af Events-URL’en, hvis den mislykkedes, før signeringshemmeligheden var konfigureret.
5. Gå tilbage til **Settings > Slack Integration**, vælg **Connect to Slack**, og godkend appen. Forbind også din personlige Slack-konto i OneUptime til handlinger, der kræver brugeridentitet.

## Netværksadgang for selvhostede installationer

### Trafikretning og endpoints

| Trafik | Påkrævet adgang |
| --- | --- |
| OneUptime → Slack | DNS og udgående HTTPS på TCP 443 til `slack.com` for Web API og OAuth-tokenudveksling; `hooks.slack.com` for kommandosvar og notifikationer via indgående webhooks, når de bruges |
| Slack → OneUptime | Offentlig HTTPS på TCP 443 til de fire POST-ruter nedenfor for den fulde integration |
| Brugerens browser → OneUptime | Dashboard og OAuth-omdirigeringer til `/api/slack/auth/:projectId/:userId` og `/api/slack/auth/:projectId/:userId/user`; kan forblive tilgængelige via brugerens VPN |

Domænerne beskriver OneUptime-integrationen, ikke en komplet tilladelsesliste for Slack-klienter eller alle funktioner. En Slack-*indgående webhook* hostes af Slack: OneUptime sender til den; den er ikke et indgående endpoint på din server. Se [vejledningen til indgående webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Videresend disse callbacks fra udbyderen til OneUptime-applikationen gennem dens ingress:

| Metode og sti | Formål |
| --- | --- |
| `POST /api/slack/events` | Events API-verifikation, reaktioner, omtaler og beskeder |
| `POST /api/slack/interactive` | Knapper, genveje, indsendelse af modaler, `/incident` og `/maintenance` |
| `POST /api/slack/options-load` | Forespørgsler om interaktive menuvalg |
| `POST /api/slack/command` | Kommandoen `/oneuptime` |

OAuth bruger en [browseromdirigering efterfulgt af tokenudveksling på serveren](https://docs.slack.dev/authentication/installing-with-oauth/). Manifestet registrerer `/api/slack/auth` som præfiks; OneUptime tilføjer projekt- og brugerstier ved godkendelse. Browseradgang alene giver ikke Slack mulighed for at levere hændelser eller handlinger.

### Private installationer og callback-sikkerhed

Brug offentlig DNS og en gateway med offentligt betroet HTTPS-certifikat, komplet certifikatkæde og privat rute til OneUptime-ingress. Tillad indgående TCP 443, og offentliggør kun udbyderens POST-callbacks ovenfor. Privat `ClusterIP`, intern DNS eller en medarbejders VPN giver ikke udbyderen adgang. Opdelt DNS kan holde dashboard og browserens OAuth-ruter private under samme værtsnavn.

Indstil `HOST=oneuptime.example.com` og `HTTP_PROTOCOL=https` i `config.env`, eller `host: oneuptime.example.com` og `httpProtocol: https` i Helm. Anvend konfigurationen, og vent på genstart. Værdierne genererer URL’er; de etablerer ikke DNS, TLS eller firewallregler. Generér og opdatér Slack-manifestet igen ved ændring af værtsnavn.

Bevar metode, sti, querystreng, original body, `Content-Type`, `X-Slack-Signature` og `X-Slack-Request-Timestamp`. Bevar offentlig host og HTTPS via betroede proxy-headere. Undtag callbacks fra browser-SSO, CAPTCHA og proxy-login, men behold OneUptimes signatur- og tidsstempelkontrol. Synkronisér serverens ur. Kontrol af kilde-IP erstatter ikke [Slacks signaturverifikation](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Kontrollér adgang og forstå begrænsninger

Kontrollér Events Request URL under **Event Subscriptions**: Slack sender en [POST-challenge og kontrollerer TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Send en testnotifikation, kør en slash-kommando, tryk på en hændelsesknap, og udløs en abonneret hændelse. Kontrollér gateway- og OneUptime-logs uden at logge hemmeligheder. Slack kræver hurtige kvitteringer, herunder [svar inden tre sekunder for interaktioner](https://docs.slack.dev/interactivity/handling-user-interaction/). Et browser-GET eller en vellykket udgående besked verificerer ikke POST-callbacks.

Uden indgående forbindelser kan en allerede godkendt app stadig sende beskeder via udgående HTTPS, men hændelser, knapper, genveje og kommandoer virker ikke. OneUptimes manifest bruger HTTP-callbacks og deaktiverer Socket Mode; aktivering af Slack Socket Mode er ikke et understøttet alternativ. [Indstillingen for privat netværksadgang](/docs/self-hosted/private-network-access) styrer udgående forespørgsler til private destinationer og offentliggør ikke callbacks.
