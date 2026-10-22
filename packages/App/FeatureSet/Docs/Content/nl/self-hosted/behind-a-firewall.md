# Achter een VPN of firewall

Een zelf gehoste OneUptime kan van het openbare internet af blijven: elke melding gaat via uitgaande verbindingen. Een paar dingen komen echter wel binnen. Een responder tikt in een bericht op **Acknowledge**, Twilio meldt een toets die tijdens een gesprek is ingedrukt, Slack meldt een klik op een knop. Deze pagina zet ze allemaal op een rij: wie er daarvoor verbinding maakt met uw server en via welk pad, zodat u alleen publiceert wat u gebruikt, of helemaal niets.

:::cards
- [Wie verbinding maakt met uw server](#wie-verbinding-maakt-met-uw-server): De telefoons van responders, en de providers die callbacks sturen.
- [Alles privé houden](#alles-privé-houden): Zet de telefoons van responders op uw VPN.
- [Alleen de bevestigingspagina's publiceren](#alleen-de-bevestigingspaginas-publiceren): Een smalle ingang voor bevestigingslinks.
- [Callbacks van providers](#callbacks-van-providers): Telegram, Twilio, WhatsApp, Slack en Microsoft Teams.
:::

## Wie verbinding maakt met uw server

Versturen heeft nooit inkomende toegang nodig: OneUptime legt zelf uitgaande verbindingen met uw mailserver, Twilio, Telegram, Meta, Slack, Microsoft en de push-relay. Wat er binnenkomt, is een van deze:

| Wat er gebeurt | Wie verbinding maakt met uw server | Volstaat een allowlist van bronadressen? |
| --- | --- | --- |
| Een responder tikt in een e-mail-, sms-, WhatsApp- of Telegram-bericht op **Acknowledge** | De telefoon of computer van de responder | Nee: die maakt verbinding vanaf waar de responder op dat moment is |
| Een responder bevestigt in de OneUptime On-Call-app | De telefoon van de responder | Nee: om dezelfde reden |
| Een responder drukt op 1 tijdens een on-call-telefoongesprek | Twilio | Alleen met Static Proxy for Webhooks van Twilio |
| Iemand koppelt een Telegram-account | Telegram | Ja, of poll Telegram en sta niets toe |
| Iemand klikt op een knop in een Slack- of Microsoft Teams-bericht | Slack of Microsoft | Nee: geen van beide publiceert vaste adressen |
| WhatsApp meldt dat een bericht is bezorgd of gelezen | Meta | Nee: Meta publiceert geen vaste adressen |

Een zelf gehoste server praat rechtstreeks met deze providers, nooit via de eigen servers van OneUptime, dus er is geen lijst met OneUptime-adressen om toe te staan.

## Alles privé houden

Zet de telefoons van de responders op uw VPN, altijd aan of op aanvraag voor uw OneUptime-hostnaam, zodat niemand om 3 uur 's nachts eerst verbinding met de VPN hoeft te maken om een oproep te bevestigen. Zonder dat u iets publiceert:

- De bevestigingslinks in e-mail-, sms-, WhatsApp- en Telegram-berichten openen, omdat de telefoon uw server bereikt.
- De OneUptime On-Call-app werkt: vul in de app het adres van uw server in. Pushmeldingen hebben geen inkomende toegang nodig, omdat de server ze via de push-relay verstuurt.
- Mensen koppelen hun Telegram-account zodra u polling aanzet (zie [Telegram](#telegram)).

Een link in een berichtenapp opent in de ingebouwde browser van die app of in de standaardbrowser van de telefoon, nooit in de OneUptime-app. Een VPN per app moet daarom de berichtenapps en de browser dekken, niet alleen de OneUptime-app.

Op 1 drukken tijdens een telefoongesprek, knoppen in Slack- en Microsoft Teams-berichten en de ontvangstbevestigingen van WhatsApp werken nog steeds alleen als hun provider uw server kan bereiken.

## Alleen de bevestigingspagina's publiceren

Als de telefoons van de responders uw VPN niet kunnen gebruiken, publiceer dan de pagina's die een bevestigingslink opent, en verder niets. Zet een reverse proxy vóór OneUptime, of een uitgaande tunnel zoals Cloudflare Tunnel, die geen inkomende firewallregel nodig heeft, en laat alleen deze paden door:

| Methode | Pad | Wat het levert |
| --- | --- | --- |
| GET | `/l/*` | De korte links in sms-, WhatsApp- en Telegram-berichten |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | De pagina die toont waarvoor is opgeroepen, met de knop **Acknowledge** |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | De knop **Acknowledge** |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Optioneel: de pagina die de oproep doorgeeft aan de volgende persoon |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Optioneel: de knop op die pagina |
| GET | `/oneuptime-assets/*` | De lettertypen, stijlen en het logo van die pagina's |

:::steps
### Laat een openbare naam naar de proxy wijzen
De links in berichten worden opgebouwd uit de instelling `HOST`, dus die naam moet publiek naar de proxy oplossen, met een openbaar vertrouwd certificaat. Met split DNS lossen mensen in uw netwerk hem nog steeds op naar het privéadres, en gebruiken ze al het andere zoals voorheen.

### Stuur de paden ongewijzigd door
Stuur deze paden met hun methode, pad en querystring door naar de ingress van OneUptime, en beantwoord al het andere met 404.

### Beperk het aantal verzoeken
Elke link bevat een willekeurige ID, en een korte link is acht letters lang. Beperk het aantal verzoeken dat elk adres mag doen, zodat niemand in hoog tempo ID's kan uitproberen.
:::

Nadat een responder heeft bevestigd, opent de pagina de waarschuwing in het dashboard, dat alleen binnen uw netwerk laadt. De bevestiging is dan al opgeslagen.

## Callbacks van providers

### Telegram

Voor het versturen van meldingen is alleen uitgaand HTTPS naar `api.telegram.org` nodig. Een account koppelen betekent dat uw server het bericht `/start` ontvangt dat iemand naar uw bot stuurt, op een van twee manieren:

- **Via polling**: zet **Poll Telegram for Messages** aan in **Admin Dashboard > Instellingen > Telegram**. OneUptime haalt de berichten van de bot om de paar seconden via uitgaand HTTPS bij Telegram op, dus er hoeft niets uw server te bereiken.
- **Via een webhook**: Telegram post elk bericht naar `POST /api/notification/telegram/webhook`. Telegram [verstuurt webhooks](https://core.telegram.org/bots/webhooks) vanaf `149.154.160.0/20` en `91.108.4.0/22`, dus u kunt alleen die adressen toestaan.

### Twilio

Wanneer een responder op 1 drukt om een oproep te bevestigen, stuurt Twilio de toets naar `POST /api/user-notification-log-timeline/call/gather-input/*`. De webhookadressen van Twilio veranderen, tenzij uw Twilio-editie [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy) bevat. Bezorgupdates voor sms en inkomende oproepen worden beschreven in [Twilio-integratie](/docs/self-hosted/twilio-integration).

### WhatsApp

Meldingen versturen en bevestigen heeft niets inkomends nodig. Meta stuurt ontvangst- en leesbevestigingen naar `/api/notification/whatsapp/webhook`; zonder die bevestigingen kan het WhatsApp-logboek van OneUptime niet tonen of een bericht is bezorgd, gelezen of mislukt nadat Meta het had geaccepteerd. Meta ondertekent elk verzoek en publiceert geen vaste adressen.

### Slack en Microsoft Teams

Knoppen, menu's en opdrachten in hun berichten roepen uw server aan vanaf adressen die geen van beide publiceert. De paden, en hoe u ze publiceert, staan in [Slack-integratie](/docs/self-hosted/slack-integration) en [Microsoft Teams-integratie](/docs/self-hosted/microsoft-teams-integration).

## Volgende stappen

:::cards
- [Twilio-integratie](/docs/self-hosted/twilio-integration): Sms en oproepen via uw eigen Twilio-account.
- [Pushmeldingen](/docs/self-hosted/push-notifications): De push-relay, en wat uw server en telefoons bereiken.
- [Apps – Overzicht](/docs/mobile-desktop-apps/index): Verbind de OneUptime On-Call-app met uw server.
- [Toegang tot privénetwerk](/docs/self-hosted/private-network-access): Andersom: laat OneUptime uw interne tools bereiken.
:::
