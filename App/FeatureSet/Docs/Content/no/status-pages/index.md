# Statussider – Oversikt

En statusside er det offentlige ansiktet til alt du overvåker: én URL kundene dine kan åpne i stedet for å sende deg e-post for å spørre om det bare er dem. Den viser gjeldende tilstand for tjenestene du velger å eksponere, hendelsene du jobber med, vedlikeholdet du har planlagt, og enhver kunngjøring du vil feste øverst.

Når noe ryker klokken to om natten, er statussiden det første supportkøen din lenker til. Den er også det abonnentene dine varsles fra — så det er verdt å sette den opp før du trenger den, ikke under nedetiden.

Statussider bor under **Statussider** i venstre navigasjon i dashbordet, i gruppen **Grunnleggende**. Alt på denne siden gjelder per statusside: et prosjekt kan kjøre så mange det vil — en offentlig for kunder, en privat for et internt publikum, en per region for et bestemt marked.

## Kort oppsummert

- **Opprettes med to felt.** En ny statusside spør bare etter **Navn** og **Beskrivelse**. Ressurser, merkevare og domener konfigureres alt sammen etterpå.
- **Ressurser er det de besøkende ser.** Hver rad på siden er en **Statusside Ressurs** — en overvåking (eller en overvåkingsgruppe) med sitt eget visningsnavn, verktøytips og oppetidsalternativer. Grupper deler en lang side i seksjoner og kan nestes.
- **En forhåndsvisnings-URL fra dag én.** Hver statusside får en forhåndsvisningslenke slik at du kan se på den før et egendefinert domene finnes.
- **Ruter mot besøkende styres av innstillinger.** Hendelser, kunngjøringer, planlagte hendelser og abonnementssiden vises hver for seg kun når bryteren deres på **Avanserte innstillinger** er på.
- **Tre måter å gjøre den privat på.** Private brukere, et hovedpassord, eller SAML SSO / OIDC — pluss en IP-hviteliste.
- **Abonnenter får beskjed automatisk.** Abonnenter på e-post, SMS, Slack, Microsoft Teams og webhook kan alle følge en side, hver kanal bak sin egen bryter.

## Sentrale begreper

| Begrep                     | Hva det betyr                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Statusside**             | Én offentlig (eller privat) side, med sin egen merkevare, sine egne domener, ressurser og abonnenter. Modellen `StatusPage`.          |
| **Ressurs**                | Én rad de besøkende ser — en overvåking eller overvåkingsgruppe vist på siden med et visningsnavn og oppetidsalternativer.            |
| **Gruppe**                 | En navngitt seksjon som holder ressurser. Grupper nestes inne i andre grupper, og hvert nivå ruller opp statusen til alt under seg.   |
| **Kunngjøring**            | En melding du legger ut på én eller flere statussider, med et starttidspunkt og et valgfritt sluttidspunkt.                           |
| **Abonnent**               | Noen (eller noe) som følger siden over e-post, SMS, Slack, Microsoft Teams eller en webhook.                                          |
| **Egendefinert domene**    | Et domene som er ditt — `status.example.com` — pekt mot siden med en CNAME og et SSL-sertifikat.                                      |
| **Privat bruker**          | En konto som kan logge inn på en privat statusside. Atskilt fra OneUptime-prosjektbrukerne dine.                                      |

## Å opprette en statusside

1. Åpne **Statussider → Alle statussider** og klikk **Opprett statusside**.
2. I modalen **Create New Status Page**, fyll ut **Navn** (obligatorisk, minst to tegn) og eventuelt **Beskrivelse**.
3. Klikk **Opprett statusside**.

Det er hele opprettelsesskjemaet. Listen du lander tilbake på, viser **Navn**, **Beskrivelse**, **Etiketter** og **Eiere**, og kan filtreres på **Statusside-ID**, **Navn** og **Beskrivelse**.

Åpne den nye siden, så lander du på skjermbildet **Oversikt**, som bærer to kort: **Status Page Preview URL** med en lenke til selve siden, og **Detaljer for statusside** der du kan redigere navnet, beskrivelsen og etikettene du nettopp satte.

Deretter, i omtrentlig rekkefølge etter nytteverdi:

- Legg til ressurser så siden har noe på seg — se [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups).
- Sett sidetittel, favicon, logo og forside, og knytt så til et egendefinert domene — se [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains).
- Bestem hvilke kanaler folk kan abonnere på — se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers).
- Juster hva som vises på siden under **Avanserte innstillinger**.

## Hvor alt bor

Når en statusside er åpnet, er dens egen venstre sidemeny gruppert i ni seksjoner. Bruk dette som et kart for resten av denne dokumentasjonsgruppen.

| Seksjon               | Hva som er i den                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Grunnleggende**     | **Oversikt**, **Kunngjøringer**, **Eiere**.                                                                                                          |
| **Ressurser**         | Ett enkelt skjermbilde **Ressurser** — grupper til venstre, den valgte gruppens overvåkinger til høyre.                                              |
| **Abonnenter**        | **E-postabonnenter**, **SMS-abonnenter**, **Slack-abonnenter**, **MS Teams-abonnenter**, **Webhook-abonnenter**, **Abonnentsinnstillinger**.         |
| **Varsellogger**      | **Varsellogger** — hva som ble sendt til abonnenter.                                                                                                 |
| **Revisjon**          | **Revisjonslogger**.                                                                                                                                 |
| **Merkevare**         | **Essensiell merkevare**, **HTML, CSS og JavaScript**, **Egendefinerte domener**, **Topptekst**, **Bunntekst**, **Oversiktsside**, **Språk**.        |
| **Sikkerhet**         | **Private brukere**, **SSO**, **OIDC**, **SCIM**, **Autentiseringsinnstillinger**.                                                                   |
| **KI**                | **MCP**.                                                                                                                                             |
| **Avansert**          | **Monitor Rules**, **Innebygd status**, **Rapporter**, **Egendefinerte felt**, **Avanserte innstillinger**, **Slett statusside**.                    |

To navnekuriositeter det er verdt å kjenne til før du går på leting:

- Elementet **Ressurser** er bare merket **Ressurser** når prosjektet har overvåkingsgrupper aktivert. Ellers leser det **Monitorer**. Det er det samme skjermbildet uansett.
- Det finnes ingen egen Grupper-side. Grupper og ressurser ble slått sammen, og den gamle ruten `/groups` viderekobler nå til ressursskjermbildet.

Utenfor en enkelt side har selve seksjonen **Statussider** en seksjon **Mer** med **Kunngjøringer**, og en sammenslått seksjon **Innstillinger** som rommer **Kunngjøringsmaler**, **Abonnentmaler**, **Egendefinerte felt**, **Eierregler** og **Etikettregler** — disse gjelder hele prosjektet og deles på tvers av hver statusside.

## Hva de besøkende ser

Den offentlige siden er sin egen app, med et lite sett med ruter:

- `/` — **Oversikt**.
- `/incidents` og `/incidents/:id` — hendelseslisten og en enkelt hendelse.
- `/announcements` og `/announcements/:id`.
- `/scheduled-events` og `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — feeden.
- `/login`, `/sso` og `/master-password` — kun relevante på en privat side.

Den øverste navigasjonslinjen viser alltid **Oversikt**; resten dukker opp kun når de er aktivert. **Hendelser**, **Kunngjøringer** og **Planlagte hendelser** trenger hver sin bryter på; **Subscribe** trenger både **Vis abonnentside** og minst én abonnentkanal aktivert. En privat side får også et element **Logg ut**.

### Oversiktssiden

Oversikten er den siden de fleste besøkende noensinne ser. Fra topp til bunn viser den:

1. **Eventuelle aktive kunngjøringer** — kunngjøringer hvis starttidspunkt har passert og hvis sluttidspunkt ikke har det.
2. **Et samlet statusbanner** — én enkelt linje som oppsummerer om alle eller bare noen ressurser er berørt.
3. **En samlet oppetidsprosent**, hvis du slo den på. Av som standard.
4. **Ressursgruppene**, hver med sine ressurser, deres gjeldende status og deres oppetidshistorikk-stolper.
5. **Aktive hendelser**.
6. **Planlagt Vedlikehold Hendelser**.

En helt ny side uten noe på seg viser en tomtilstand som ber deg legge til ressurser fra dashbordet — som er signalet ditt om å gå til skjermbildet **Ressurser**.

For hva som får en hendelse på denne siden i utgangspunktet, og hva som tar den av igjen, se [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

## Å velge hva som vises på siden

De fleste visningsbryterne bor på ett sted: **Statussider → siden din → Avansert → Avanserte innstillinger**. Hvert kort har sin egen knapp **Edit Settings**.

**Hendelsesinnstillinger**:

- **Vis hendelser** (`showIncidentsOnStatusPage`) — på som standard. Å slå den av fjerner også navigasjonselementet **Hendelser**.
- **Vis hendelseshistorikk (i dager)** (`showIncidentHistoryInDays`) — hvor langt tilbake hendelseslisten rekker. Standard er 14.
- **Vis hendelsesetiketter** (`showIncidentLabelsOnStatusPage`) — av som standard.

**Episodeinnstillinger** — de samme tre bryterne for hendelsesepisoder: **Vis episoder** (`showEpisodesOnStatusPage`, på som standard), **Vis episodehistorikk (i dager)** (standard 14), og **Vis episodeetiketter** (av som standard). Episoder er sin egen modell med sine egne endepunkter, ikke en visning av hendelser.

**Kunngjøringsinnstillinger**:

- **Vis kunngjøringer** (`showAnnouncementsOnStatusPage`) — på som standard.
- **Vis kunngjøringshistorikk (i dager)** (`showAnnouncementHistoryInDays`) — standard er 14.

**Innstillinger for planlagte hendelser**:

- **Vis planlagte vedlikeholdshendelser** (`showScheduledMaintenanceEventsOnStatusPage`) — på som standard.
- **Vis historikk for planlagte hendelser (i dager)** (`showScheduledEventHistoryInDays`) — standard er 14.
- **Vis hendelsesetiketter** (`showScheduledEventLabelsOnStatusPage`) — av som standard.

**Innstillinger for oppetidshistorikk**:

- **Vis oppetidshistorikk (i dager)** (`showUptimeHistoryInDays`) — lengden på oppetidsstolpen ved siden av hver ressurs. Standard er 90 og må være mellom 1 og 90. Hvert alternativ **Vis oppetid %** og **Vis statushistorikkdiagram** på en ressurs eller gruppe leser dette tallet.

**Abonnentsinnstillinger**:

- **Vis abonnentside** (`showSubscriberPageOnStatusPage`) — på som standard, pluss de fem aktiveringsbryterne per kanal. De samme kanalbryterne dukker også opp på det dedikerte skjermbildet **Abonnentsinnstillinger** under seksjonen **Abonnenter**; behandle det som det kanoniske stedet å sette dem.

**Drevet av OneUptime-merkevarebygging**:

- **Skjul «Powered By OneUptime»-merkevarebygging** — av som standard, så bunnteksten for besøkende leser «Powered by OneUptime» inntil du slår denne på.

**Hvor fargene er.** Fargene på oppetidsstolpen er ikke her — **Standard stolpefarge**, reglene for stolpefarge, **Overvåkerstatuser for nedetid** og **Vis samlet oppetidsprosent** bor alle på **Statussider → siden din → Merkevare → Oversiktsside**. Det finnes ingen tema- eller merkevarefargeinnstilling noe sted; alt utover de kontrollene gjøres med **Egendefinert CSS**.

## Å forhåndsvise før du går live

Skjermbildet **Oversikt** på hver statusside bærer et kort **Status Page Preview URL** med en lenke rett til siden. Bruk det mens du fortsatt legger til ressurser og før noe egendefinert domene finnes.

Bak kulissene har hver offentlig rute en forhåndsvisningstvilling under `/status-page/{statusPageId}/...` — en forhåndsvist oversikt, en forhåndsvist hendelsesliste, en forhåndsvist abonnementsside, og så videre. Det betyr at en URL eller et skjermbilde tatt fra dashbordets forhåndsvisning ikke vil samsvare med det en kunde ser når et egendefinert domene er knyttet til, så dobbeltsjekk enhver lenke du limer inn i et runbook eller en e-post.

## Å begrense hvem som kan se siden

Ikke hver statusside er for offentligheten. Alle kontrollene ligger under seksjonen **Sikkerhet**.

### Private brukere

Slå av **Er synlig for offentligheten** på **Statussider → siden din → Sikkerhet → Autentiseringsinnstillinger** (kolonnen `isPublicStatusPage`). De besøkende lander da på `/login` og må logge inn.

Legg til personene som får logge inn på **Statussider → siden din → Sikkerhet → Private brukere**. Det finnes en handling **Legg til i bulk** — lim inn en liste med e-postadresser, så får hver av dem en invitasjons-e-post. Private brukere har sin egen flyt for glemt passord og tilbakestilling av passord, atskilt fra OneUptime-prosjektkontoene dine.

### Hovedpassord

**Autentiseringsinnstillinger** har også et kort **Hovedpassord** med en bryter **Krev hovedpassord** og selve passordet. De besøkende treffer da `/master-password` og låser opp siden med én delt hemmelighet.

**Hovedpassord og private brukere stables ikke.** Mens hovedpassordet er på, er autentisering av private brukere deaktivert, og skjermbildet **Private brukere** viser et banner som forteller deg det.

### SSO og OIDC

For en privat side knyttet til identitetsleverandøren din, konfigurerer **Statussider → siden din → Sikkerhet → SSO** SAML (påloggings-URL, utsteder, x509-sertifikat, signatur- og digest-metoder) og **Statussider → siden din → Sikkerhet → OIDC** konfigurerer OpenID Connect (oppdagelses-URL, utsteder, klient-ID og -hemmelighet, omfang, claim-navn). **SCIM** klargjør private brukere fra IdP-en automatisk. Disse er låst bak en planfunksjon, så de er kanskje ikke tilgjengelige på hver installasjon.

Et kort **SSO-innstillinger** eksponerer **Tving SSO for innlogging** (`requireSsoForLogin`, av som standard). Test SSO-konfigurasjonen din før du slår den på — hvis den ikke virker, låser du deg selv ute av statussiden.

### IP-hviteliste

**Autentiseringsinnstillinger** bærer også et kort **IP-hviteliste**, støttet av kolonnen `ipWhitelist`, for sider som bare skal svare fra kjente nettverk.

## Det innebygdbare merket og RSS-feeden

To måter å vise status et annet sted enn på selve siden.

**Innebygd statusmerke.** Slå på **Aktiver innebygd statusmerke** (`enableEmbeddedOverallStatus`, av som standard) i kortet **Innebygd statusmerke** på **Statussider → siden din → Avansert → Innebygd status**. Det går sammen med en `embeddedOverallStatusToken` og serverer merket fra `/badge/:statusPageId`, så du kan slippe gjeldende samlede status inn i dokumentasjonen din, i bunnteksten til appen din, eller på en markedsføringsside.

**RSS-feed.** Hver statusside serverer `/rss` — en feed med tittelen «{statussidenavn} Updates» hvis elementer er prefikset `Incident: `, `Announcement: ` og `Scheduled Maintenance: `. Praktisk for folk som heller vil pipe oppdateringene dine inn i en leser eller en chat-bot enn å abonnere på e-post.

Hvis du heller vil hente dataene selv, er statussiden støttet av offentlige leseendepunkter for oversikten, hendelser, planlagte vedlikeholdshendelser, kunngjøringer og episoder — se [Offentlig API](/docs/status-pages/public-api).

## Hvor du leser videre

- [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups) — å sette overvåkinger på siden og organisere dem i seksjoner.
- [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains) — logo, favicon, bunntekst, egendefinert kode, og å peke ditt eget domene mot siden.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — de fem abonnentkanalene, dobbel bekreftelse, og å legge ut kunngjøringer.
- [Offentlig API](/docs/status-pages/public-api) — å lese statussidedata programmatisk.
- [Hendelser – Oversikt](/docs/incidents/index) — hendelsene som dukker opp på siden.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva som får en hendelse til å vises på en statusside og hva som tar den av.
