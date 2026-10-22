# Bak en VPN eller brannmur

En selvhostet OneUptime-instans kan holdes utenfor det offentlige internettet: Den sender alle varsler over utgående tilkoblinger. Noen få ting kommer likevel inn. En vakthavende trykker på **Acknowledge** i en melding, Twilio melder fra om en tast som ble trykket under et anrop, Slack melder fra om et knappeklikk. Denne siden går gjennom hver av dem, hvem som kobler seg til serveren din for den, og på hvilken sti, slik at du kan publisere bare det du bruker, eller ingenting i det hele tatt.

:::cards
- [Hvem som kobler seg til serveren din](#hvem-som-kobler-seg-til-serveren-din): Telefonene til de vakthavende, og leverandørene som sender tilbakekall.
- [Hold alt privat](#hold-alt-privat): Koble telefonene til de vakthavende til VPN-et ditt.
- [Publiser bare bekreftelsessidene](#publiser-bare-bekreftelsessidene): En smal inngang for bekreftelseslenker.
- [Tilbakekall fra leverandører](#tilbakekall-fra-leverandører): Telegram, Twilio, WhatsApp, Slack og Microsoft Teams.
:::

## Hvem som kobler seg til serveren din

Sending trenger aldri innkommende tilgang: OneUptime kobler seg selv ut til e-postserveren din, Twilio, Telegram, Meta, Slack, Microsoft og push-reléet. Det som kommer inn, er ett av disse:

| Hva som skjer | Hvem som kobler seg til serveren din | Kan en tillatelsesliste med kildeadresser dekke det? |
| --- | --- | --- |
| En vakthavende trykker på **Acknowledge** i en e-post-, SMS-, WhatsApp- eller Telegram-melding | Telefonen eller datamaskinen til den vakthavende | Nei: den kobler seg til fra der den vakthavende er |
| En vakthavende bekrefter i OneUptime On-Call-appen | Telefonen til den vakthavende | Nei: av samme grunn |
| En vakthavende trykker 1 under et vaktanrop | Twilio | Bare med Twilios Static Proxy for Webhooks |
| Noen kobler til Telegram-kontoen sin | Telegram | Ja, eller poll Telegram og tillat ingenting |
| Noen klikker på en knapp i en Slack- eller Microsoft Teams-melding | Slack eller Microsoft | Nei: ingen av dem publiserer faste adresser |
| WhatsApp melder at en melding er levert eller lest | Meta | Nei: Meta publiserer ingen faste adresser |

En selvhostet server snakker direkte med disse leverandørene, aldri via OneUptimes egne servere, så det finnes ingen liste over OneUptime-adresser å tillate.

## Hold alt privat

Koble telefonene til de vakthavende til VPN-et ditt, enten alltid på eller ved behov for OneUptime-vertsnavnet ditt, så ingen må koble til VPN-et først for å bekrefte en varsling klokken tre om natten. Uten at noe er publisert:

- Bekreftelseslenkene i e-post-, SMS-, WhatsApp- og Telegram-meldinger åpnes, fordi telefonen når serveren din.
- OneUptime On-Call-appen fungerer: pek den mot adressen til serveren din. Push-varsler trenger ingen innkommende tilgang, fordi serveren sender dem gjennom push-reléet.
- Folk kan koble til Telegram-kontoene sine når du slår på polling (se [Telegram](#telegram)).

En lenke i en meldingsapp åpnes i appens egen nettleser eller i telefonens standardnettleser, aldri i OneUptime-appen. Et VPN per app må derfor dekke meldingsappene og nettleseren, ikke bare OneUptime-appen.

Å trykke 1 under et anrop, knapper i Slack- og Microsoft Teams-meldinger og leveringskvitteringene fra WhatsApp krever fortsatt at leverandøren deres når serveren din.

## Publiser bare bekreftelsessidene

Hvis telefonene til de vakthavende ikke kan bruke VPN-et ditt, publiserer du sidene en bekreftelseslenke åpner, og ingenting annet. Sett en reverse proxy foran OneUptime, eller en utgående tunnel som Cloudflare Tunnel, som ikke trenger noen innkommende brannmurregel, og slipp bare disse stiene gjennom:

| Metode | Sti | Hva den leverer |
| --- | --- | --- |
| GET | `/l/*` | De korte lenkene i SMS-, WhatsApp- og Telegram-meldinger |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | Siden som viser hva varslingen gjelder, med knappen **Acknowledge** |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | Knappen **Acknowledge** |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Valgfritt: siden som sender varslingen videre til neste person |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Valgfritt: knappen på den siden |
| GET | `/oneuptime-assets/*` | Skrifttypene, stilene og logoen til disse sidene |

:::steps
### Pek et offentlig navn mot proxyen
Lenkene i meldingene bygges fra innstillingen `HOST`, så det navnet må slås opp offentlig til proxyen, med et offentlig klarert sertifikat. Med delt DNS fortsetter folk på nettverket ditt å slå det opp til den private adressen og bruker alt annet som før.

### Send stiene videre uendret
Send disse stiene til OneUptimes ingress med metoden, stien og spørringsstrengen deres, og svar på alt annet med 404.

### Begrens antall forespørsler
Hver lenke inneholder en tilfeldig ID, og en kort lenke er åtte bokstaver lang. Begrens hvor mange forespørsler hver adresse kan gjøre, så ingen kan prøve ut ID-er i høyt tempo.
:::

Etter at en vakthavende har bekreftet, åpner siden varselet i dashbordet, som bare lastes inn på nettverket ditt. Da er bekreftelsen allerede lagret.

## Tilbakekall fra leverandører

### Telegram

Å sende varsler krever bare utgående HTTPS til `api.telegram.org`. Å koble til en konto betyr at serveren din mottar meldingen `/start` som en person sender til boten din, på én av to måter:

- **Med polling**: slå på **Poll Telegram for Messages** i **Admin Dashboard > Innstillinger > Telegram**. OneUptime henter botens meldinger fra Telegram med noen få sekunders mellomrom over utgående HTTPS, så ingenting trenger å nå serveren din.
- **Med webhook**: Telegram sender hver melding til `POST /api/notification/telegram/webhook`. Telegram [sender webhooker](https://core.telegram.org/bots/webhooks) fra `149.154.160.0/20` og `91.108.4.0/22`, så du kan tillate bare de adressene.

### Twilio

Når en vakthavende trykker 1 under et anrop for å bekrefte varslingen, sender Twilio tasten til `POST /api/user-notification-log-timeline/call/gather-input/*`. Twilios webhook-adresser endres, med mindre Twilio-utgaven din inkluderer [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Oppdateringer om SMS-levering og innkommende anrop er beskrevet i [Twilio-integrasjon](/docs/self-hosted/twilio-integration).

### WhatsApp

Varsler og bekreftelser trenger ingenting innkommende. Meta sender leverings- og lesekvitteringer til `/api/notification/whatsapp/webhook`; uten dem kan ikke WhatsApp-loggen i OneUptime vise om en melding ble levert, lest eller feilet etter at Meta godtok den. Meta signerer hver forespørsel og publiserer ingen faste adresser.

### Slack og Microsoft Teams

Knapper, menyer og kommandoer i meldingene deres kaller opp serveren din fra adresser som ingen av dem publiserer. Stiene, og hvordan du publiserer dem, finner du i [Slack-integrasjon](/docs/self-hosted/slack-integration) og [Microsoft Teams-integrasjon](/docs/self-hosted/microsoft-teams-integration).

## Neste steg

:::cards
- [Twilio-integrasjon](/docs/self-hosted/twilio-integration): SMS og anrop gjennom din egen Twilio-konto.
- [Push-varsler](/docs/self-hosted/push-notifications): Push-reléet, og hva serveren og telefonene dine når.
- [Apper – Oversikt](/docs/mobile-desktop-apps/index): Koble OneUptime On-Call-appen til serveren din.
- [Tilgang til privat nettverk](/docs/self-hosted/private-network-access): Andre veien: la OneUptime nå de interne verktøyene dine.
:::
