# Bag en VPN eller firewall

En selvhostet OneUptime kan holdes væk fra det offentlige internet: Den sender alle alarmer over udgående forbindelser. Et par ting kommer dog ind udefra. En vagthavende trykker på **Acknowledge** i en besked, Twilio melder en tast, der blev trykket under et opkald, og Slack melder et klik på en knap. Denne side gennemgår hver af dem: hvem der forbinder til din server, og på hvilken sti, så du kun udgiver det, du bruger, eller slet intet.

:::cards
- [Hvem forbinder til din server](#hvem-forbinder-til-din-server): De vagthavendes telefoner og de udbydere, der kalder tilbage.
- [Hold alt privat](#hold-alt-privat): Sæt de vagthavendes telefoner på din VPN.
- [Udgiv kun kvitteringssiderne](#udgiv-kun-kvitteringssiderne): En smal indgang til kvitteringslinks.
- [Callbacks fra udbydere](#callbacks-fra-udbydere): Telegram, Twilio, WhatsApp, Slack og Microsoft Teams.
:::

## Hvem forbinder til din server

Afsendelse kræver aldrig indgående adgang: OneUptime forbinder selv ud til din mailserver, Twilio, Telegram, Meta, Slack, Microsoft og push-relayet. Det, der kommer ind udefra, er et af følgende:

| Hvad der sker | Hvem forbinder til din server | Kan en tilladelsesliste over kildeadresser dække det? |
| --- | --- | --- |
| En vagthavende trykker på **Acknowledge** i en e-mail, en SMS eller en besked i WhatsApp eller Telegram | Den vagthavendes telefon eller computer | Nej: Den forbinder fra det sted, hvor den vagthavende er |
| En vagthavende kvitterer i appen OneUptime On-Call | Den vagthavendes telefon | Nej: af samme grund |
| En vagthavende trykker 1 under et tilkald pr. telefon | Twilio | Kun med Twilios Static Proxy for Webhooks |
| Nogen forbinder sin Telegram-konto | Telegram | Ja, eller hent beskederne fra Telegram med polling, og tillad intet |
| Nogen klikker på en knap i en besked i Slack eller Microsoft Teams | Slack eller Microsoft | Nej: Ingen af dem offentliggør faste adresser |
| WhatsApp melder, at en besked er leveret eller læst | Meta | Nej: Meta offentliggør ingen faste adresser |

En selvhostet server taler direkte med disse udbydere, aldrig gennem OneUptimes egne servere, så der findes ingen liste over OneUptime-adresser, du skal tillade.

## Hold alt privat

Sæt de vagthavendes telefoner på din VPN: altid tilsluttet, eller tilsluttet efter behov, når dit OneUptime-værtsnavn skal nås, så ingen først skal slå den til for at kvittere for et tilkald kl. 3 om natten. Når intet er udgivet:

- Kvitteringslinkene i e-mails, SMS'er og beskeder i WhatsApp og Telegram kan åbnes, fordi telefonen når frem til din server.
- Appen OneUptime On-Call virker: Peg den mod din servers adresse. Push-notifikationer kræver ingen indgående adgang, fordi serveren sender dem gennem push-relayet.
- Folk kan forbinde deres Telegram-konti, så snart du slår polling til (se [Telegram](#telegram)).

Et link i en beskedapp åbnes i appens egen browser eller i telefonens standardbrowser, aldrig i OneUptime-appen. En VPN pr. app skal derfor dække beskedapps og browseren, ikke kun OneUptime-appen.

Et tryk på 1 under et opkald, knapper i beskeder i Slack og Microsoft Teams og WhatsApps leveringskvitteringer kræver stadig, at udbyderen kan nå din server.

## Udgiv kun kvitteringssiderne

Hvis de vagthavendes telefoner ikke kan bruge din VPN, så udgiv de sider, et kvitteringslink åbner, og intet andet. Sæt en reverse proxy foran OneUptime, eller en udgående tunnel som Cloudflare Tunnel, der ikke kræver nogen indgående firewallregel, og lad kun disse stier slippe igennem:

| Metode | Sti | Hvad den leverer |
| --- | --- | --- |
| GET | `/l/*` | De korte links i SMS'er og beskeder i WhatsApp og Telegram |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | Siden, der viser, hvad tilkaldet gælder, med knappen **Acknowledge** |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | Knappen **Acknowledge** |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Valgfri: siden, der sender tilkaldet videre til den næste person |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Valgfri: dens knap |
| GET | `/oneuptime-assets/*` | Skrifttyper, styles og logo til de sider |

:::steps
### Lad et offentligt navn pege på proxyen
Linkene i beskederne bygges ud fra din indstilling `HOST`, så det navn skal kunne slås offentligt op til proxyen, med et offentligt betroet certifikat. Med split DNS slår folk på dit netværk det fortsat op til den private adresse og bruger alt andet som før.

### Videresend stierne uændret
Send disse stier til OneUptimes ingress med deres metode, sti og forespørgselsstreng, og besvar alt andet med 404.

### Indfør hastighedsbegrænsning
Hvert link indeholder et tilfældigt ID, og et kort link er otte bogstaver langt. Begræns, hvor mange forespørgsler hver adresse må sende, så ingen kan afprøve ID'er i højt tempo.
:::

Når en vagthavende har kvitteret, åbner siden advarslen i dashboardet, som kun indlæses på dit netværk. Kvitteringen er allerede gemt på det tidspunkt.

## Callbacks fra udbydere

### Telegram

At sende alarmer kræver kun udgående HTTPS til `api.telegram.org`. At forbinde en konto kræver, at din server modtager den `/start`-besked, som en person sender til din bot, og det kan ske på to måder:

- **Hentning**: Slå **Poll Telegram for Messages** til under **Admin Dashboard > Indstillinger > Telegram**. OneUptime henter bottens beskeder fra Telegram med få sekunders mellemrum over udgående HTTPS, så intet behøver at nå din server.
- **Webhook**: Telegram sender hver besked til `POST /api/notification/telegram/webhook`. Telegram [sender webhooks](https://core.telegram.org/bots/webhooks) fra `149.154.160.0/20` og `91.108.4.0/22`, så du kan nøjes med at tillade de adresser.

### Twilio

Når en vagthavende trykker 1 for at kvittere under et opkald, sender Twilio tasten til `POST /api/user-notification-log-timeline/call/gather-input/*`. Twilios webhook-adresser skifter, medmindre din Twilio-udgave omfatter [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Leveringsopdateringer for SMS og indgående opkald er beskrevet i [Twilio-integration](/docs/self-hosted/twilio-integration).

### WhatsApp

At sende alarmer og kvittere for tilkald kræver intet indgående. Meta sender leverings- og læsekvitteringer til `/api/notification/whatsapp/webhook`; uden dem kan OneUptimes WhatsApp-log ikke vise, om en besked blev leveret, læst eller mislykkedes, efter at Meta havde taget imod den. Meta signerer hver forespørgsel og offentliggør ingen faste adresser.

### Slack og Microsoft Teams

Knapper, menuer og kommandoer i deres beskeder kalder din server fra adresser, som ingen af dem offentliggør. Stierne, og hvordan du udgiver dem, står i [Slack-integration](/docs/self-hosted/slack-integration) og [Microsoft Teams-integration](/docs/self-hosted/microsoft-teams-integration).

## Næste trin

:::cards
- [Twilio-integration](/docs/self-hosted/twilio-integration): SMS og opkald gennem din egen Twilio-konto.
- [Push-notifikationer](/docs/self-hosted/push-notifications): Push-relayet, og hvad din server og telefonerne skal kunne nå.
- [Apps – Oversigt](/docs/mobile-desktop-apps/index): Forbind appen OneUptime On-Call med din server.
- [Adgang til privat netværk](/docs/self-hosted/private-network-access): Den anden vej rundt: Lad OneUptime nå dine interne værktøjer.
:::
