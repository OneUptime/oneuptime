# Statussider – Oversikt

En statusside er det offentlige ansiktet til alt du overvåker: én URL kundene dine kan åpne i stedet for å sende deg en e-post for å høre om det bare er dem. Den viser gjeldende tilstand for tjenestene du velger å eksponere, hendelsene du jobber med, vedlikeholdet du har planlagt, og enhver kunngjøring du vil feste øverst.

Når noe ryker klokken to om natten, er statussiden det første supportkøen din lenker til. Den er også kilden abonnentene dine varsles fra — så den er verdt å sette opp før du trenger den, ikke midt under driftsavbruddet.

Statussider ligger under **Statussider** i venstre navigasjon i dashbordet, i gruppen **Grunnleggende**. Alt på denne siden gjelder per statusside: et prosjekt kan kjøre så mange det vil — en offentlig for kunder, en privat for et internt publikum, en per region for et bestemt marked.

## Kort oppsummert

- **Opprettes med to felt.** En ny statusside spør bare etter **Navn** og **Beskrivelse**. Ressurser, merkevare og domener konfigureres etterpå.
- **Ressursene er det de besøkende ser.** Hver rad på siden er en **Statusside Ressurs** — en overvåking (eller en overvåkingsgruppe) med sitt eget visningsnavn, verktøytips og oppetidsalternativer. Grupper deler en lang side i seksjoner, og de kan nestes.
- **En forhåndsvisnings-URL fra dag én.** Hver statusside får en forhåndsvisningslenke, så du kan se på den lenge før et egendefinert domene finnes.
- **Rutene de besøkende ser, styres av innstillinger.** Hendelser, episoder, kunngjøringer og planlagte hendelser dukker bare opp så lenge bryteren deres i **Hva statussiden din viser** (på **Avanserte innstillinger**) står på, og abonnementssiden bare så lenge **Vis abonnentside** står på.
- **Tre måter å gjøre den privat på.** Private brukere, et hovedpassord eller SAML SSO / OIDC — pluss en IP-hviteliste.
- **Abonnentene får beskjed automatisk.** Abonnenter på e-post, SMS, Slack, Microsoft Teams og webhook kan alle følge en side, hver kanal bak sin egen bryter.

## Sentrale begreper

| Begrep                        | Hva det betyr                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Statusside**                | Én offentlig (eller privat) side, med sin egen merkevare, sine domener, ressurser og abonnenter. Modellen `StatusPage`.                   |
| **Ressurs**                   | Én rad de besøkende ser — en overvåking eller overvåkingsgruppe løftet frem på siden med et visningsnavn og oppetidsalternativer.         |
| **Gruppe**                    | En navngitt seksjon som rommer ressurser. Grupper kan ligge inni andre grupper, og hvert nivå ruller opp statusen til alt under seg.      |
| **Kunngjøring**               | En melding du publiserer til én eller flere statussider, med et starttidspunkt og et valgfritt sluttidspunkt.                             |
| **Abonnent**                  | Noen (eller noe) som følger siden over e-post, SMS, Slack, Microsoft Teams eller en webhook.                                              |
| **Egendefinert domene**       | Et domene du eier — `status.example.com` — pekt mot siden med en CNAME og et SSL-sertifikat.                                              |
| **Privat bruker**             | En konto som kan logge inn på en privat statusside. Atskilt fra brukerne i OneUptime-prosjektet ditt.                                     |

## Å opprette en statusside

1. Åpne **Statussider → Alle statussider** og klikk **Opprett statusside**.
2. I modalen **Create New Status Page** fyller du inn **Navn** (påkrevd, minst to tegn) og eventuelt **Beskrivelse**.
3. Klikk **Opprett statusside**.

Det er hele opprettelsesskjemaet. Listen du havner tilbake på, viser **Navn**, **Beskrivelse**, **Etiketter** og **Eiere**, og den kan filtreres på **Statusside-ID**, **Navn** og **Beskrivelse**.

Åpner du den nye siden, lander du på skjermbildet **Oversikt**, som bærer to kort: **Status Page Preview URL** med en lenke til selve siden, og **Detaljer for statusside** der du kan redigere navnet, beskrivelsen og etikettene du nettopp satte.

Deretter, i grov nytteverdi-rekkefølge:

- Legg til ressurser så siden har noe på seg — se [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups).
- Sett sidetittel, favicon, logo og omslag, og knytt så til et egendefinert domene — se [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains).
- Bestem hvilke kanaler folk kan abonnere på — se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers).
- Finjuster hva som vises på siden, under **Avanserte innstillinger**.

## Hvor alt ligger

Når en statusside først er åpen, er dens egen venstre sidemeny delt i ni seksjoner. Bruk denne som kart for resten av denne dokumentasjonsgruppen.

| Seksjon               | Hva som er i den                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grunnleggende**     | **Oversikt**, **Kunngjøringer**, **Eiere**.                                                                                                                  |
| **Ressurser**         | Ett enkelt **Ressurser**-skjermbilde — grupper til venstre, den valgte gruppens overvåkinger til høyre.                                                       |
| **Abonnenter**        | **E-postabonnenter**, **SMS-abonnenter**, **Slack-abonnenter**, **MS Teams-abonnenter**, **Webhook-abonnenter**, **Abonnentsinnstillinger**.                  |
| **Varsellogger**      | **Varsellogger** — hva som er sendt til abonnentene.                                                                                                         |
| **Revisjon**          | **Revisjonslogger**.                                                                                                                                         |
| **Merkevare**         | **Essensiell merkevare**, **HTML, CSS og JavaScript**, **Egendefinerte domener**, **Topptekst**, **Bunntekst**, **Oversiktsside**, **Språk**.                 |
| **Sikkerhet**         | **Private brukere**, **SSO**, **OIDC**, **SCIM**, **Autentiseringsinnstillinger**.                                                                           |
| **AI**                | **MCP**.                                                                                                                                                     |
| **Avansert**          | **Monitor Rules**, **Innebygd status**, **Rapporter**, **Egendefinerte felt**, **Avanserte innstillinger**, **Slett statusside**.                             |

To navnefeller det er verdt å kjenne før du går og leter:

- Elementet **Ressurser** heter bare **Ressurser** når prosjektet har overvåkingsgrupper aktivert. Ellers leser det **Monitorer**. Det er samme skjermbilde uansett.
- Det finnes ingen egen Grupper-side. Grupper og ressurser ble slått sammen, og den gamle `/groups`-ruten viderekobler nå til ressursskjermbildet.

Utenfor en enkelt side har selve seksjonen **Statussider** en **Mer**-seksjon med **Kunngjøringer**, og en sammenslått **Innstillinger**-seksjon som rommer **Kunngjøringsmaler**, **Abonnentmaler**, **Egendefinerte felt**, **Eierregler** og **Etikettregler** — disse gjelder hele prosjektet og deles av alle statussider.

## Hva de besøkende ser

Den offentlige siden er sin egen app, med et lite sett ruter:

- `/` — **Oversikt**.
- `/incidents` og `/incidents/:id` — hendelseslisten og en enkelt hendelse.
- `/announcements` og `/announcements/:id`.
- `/scheduled-events` og `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — strømmen.
- `/login`, `/sso` og `/master-password` — bare relevante på en privat side.

Den øverste navigasjonslinjen viser alltid **Oversikt**; resten dukker opp bare når de er aktivert. **Hendelser**, **Kunngjøringer** og **Planlagte hendelser** trenger hver sin bryter på; **Abonner** trenger både **Vis abonnentside** og minst én aktivert abonnentkanal. En privat side får i tillegg et **Logg ut**-element.

### Oversiktssiden

Oversikten er den siden de fleste besøkende noen gang ser. Ovenfra og ned viser den:

1. **Alle aktive kunngjøringer** — kunngjøringer der starttidspunktet har passert og sluttidspunktet ikke har det.
2. **Et samlet statusbanner** — én linje som oppsummerer om alle eller bare noen ressurser er berørt.
3. **En samlet oppetidsprosent**, hvis du slo den på. Av som standard.
4. **Ressursgruppene**, hver med sine ressurser, gjeldende status og oppetidshistorikkstolpene sine.
5. **Aktive hendelser**.
6. **Planlagte vedlikeholdshendelser**.

En helt ny side uten noe på seg viser en tomtilstand som ber deg legge til ressurser fra dashbordet — som er signalet ditt om å gå til **Ressurser**-skjermbildet.

For hva som i det hele tatt setter en hendelse på denne siden, og hva som tar den av igjen, se [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

## Å velge hva som vises på siden

Hva de besøkende ser, stilles inn i ett kort: **Hva statussiden din viser**, på **Statussider → siden din → Avansert → Avanserte innstillinger**. Det har en rad for hver liste siden kan vise, deretter **Oppetidshistorikk** og linjen «Powered by OneUptime». Det finnes ingen redigeringsknapp: En bryter lagres i det du slår den om, og et antall dager når du forlater feltet eller trykker Enter.

- **Vis hendelser** (`showIncidentsOnStatusPage`) — på som standard. Under den bestemmer **Vis de siste … dagene** (`showIncidentHistoryInDays`, standard 14) hvor langt tilbake hendelseslisten rekker, og **Vis hendelsesetiketter** (`showIncidentLabelsOnStatusPage`) er av som standard.
- **Vis bare hendelser som er begrenset til denne siden** (`onlyShowScopedIncidents`) — også i hendelsesraden, av som standard. Står den på, viser siden bare hendelsene som er begrenset til den med **Begrens til disse statussidene**, og abonnentene blir bare varslet om dem. Den avgjør også hvilke hendelser som tar med episodene sine til siden, så den blir stående når **Vis hendelser** er av.
- **Vis episoder** (`showEpisodesOnStatusPage`) — på som standard, med **Vis de siste … dagene** (`showEpisodeHistoryInDays`, standard 14) og **Vis episodeetiketter** (`showEpisodeLabelsOnStatusPage`, av som standard). Episoder er sin egen modell med sine egne endepunkter, ikke en visning av hendelser.
- **Vis kunngjøringer** (`showAnnouncementsOnStatusPage`) — på som standard, med **Vis de siste … dagene** (`showAnnouncementHistoryInDays`, standard 14).
- **Vis planlagte vedlikeholdshendelser** (`showScheduledMaintenanceEventsOnStatusPage`) — på som standard, med **Vis de siste … dagene** (`showScheduledEventHistoryInDays`, standard 14) og **Vis hendelsesetiketter** (`showScheduledEventLabelsOnStatusPage`, av som standard).
- **Oppetidshistorikk** — **Vis de siste … dagene** (`showUptimeHistoryInDays`) er lengden på oppetidsstolpen ved siden av hver ressurs. Standard er 90, og den må ligge mellom 1 og 90. Alle **Vis oppetid %**- og **Vis statushistorikkdiagram**-valg på en ressurs eller en gruppe leser dette tallet.
- **Vis «Powered By OneUptime»-merkevarebygging** — på som standard, så bunnteksten de besøkende ser, leser «Powered by OneUptime». Slå den av for å skjule linjen. Kolonnen lagrer det omvendt, som `hidePoweredByOneUptimeBranding`.

**En liste som er slått av,** forsvinner fra siden sammen med elementet sitt i navigasjonslinjen hvis den har et; det offentlige endepunktet avviser forespørsler, og abonnentene på siden blir ikke varslet om den typen hendelse. Raden viser da bare bryteren: Hvor langt tilbake en skjult liste går, og om den viser etiketter, endrer ingenting.

**Planer.** På OneUptime Cloud står planen som trengs ved siden av en innstilling planen din ikke kan endre. De fire listebryterne, de tre etikettbryterne og episodehistorikken krever **Growth**; å skjule linjen «Powered by OneUptime» krever **Scale**. De andre historikkvinduene, **Oppetidshistorikk** og **Vis bare hendelser som er begrenset til denne siden** kan endres på alle planer, og hver innstilling lagres for seg.

Om siden viser punktet **Abonner** (**Vis abonnentside**, `showSubscriberPageOnStatusPage`, på som standard), og hvilke kanaler besøkende kan abonnere med, stilles ikke inn på dette skjermbildet: Begge deler ligger i kortet **Kanaler** under **Abonnenter → Abonnentsinnstillinger** (se [Abonnenter og kunngjøringer](/docs/status-pages/subscribers)).

Under kortet følger et kort som eksporterer innstillingene for statussiden til en JSON-fil du kan importere igjen, og kortet for å arkivere statussiden.

**Hvor fargene er.** Fargene på oppetidsstolpen er ikke her — **Standard stolpefarge**, reglene for stolpefarge, **Overvåkerstatuser for nedetid** og **Vis samlet oppetidsprosent** bor alle på **Statussider → siden din → Merkevare → Oversiktsside**. Det finnes ingen tema- eller merkefargeinnstilling noe sted; alt utover disse kontrollene gjøres med **Egendefinert CSS**.

## Å forhåndsvise før du går live

Skjermbildet **Oversikt** på hver statusside bærer et kort **Status Page Preview URL** med en lenke rett til siden. Bruk den mens du fortsatt legger til ressurser og før noe egendefinert domene finnes.

Bak kulissene har hver offentlig rute en forhåndsvisningstvilling under `/status-page/{statusPageId}/...` — en forhåndsvist oversikt, en forhåndsvist hendelsesliste, en forhåndsvist abonnementsside, og så videre. Det betyr at en URL eller et skjermbilde tatt fra forhåndsvisningen i dashbordet ikke vil stemme med det en kunde ser når et egendefinert domene først er knyttet til, så dobbeltsjekk enhver lenke du limer inn i et runbook eller en e-post.

## Å begrense hvem som kan se siden

Ikke hver statusside er for offentligheten. Alle kontrollene ligger under seksjonen **Sikkerhet**.

### Private brukere

Slå av **Er synlig for offentligheten** på **Statussider → siden din → Sikkerhet → Autentiseringsinnstillinger** (kolonnen `isPublicStatusPage`). De besøkende havner da på `/login` og må logge inn.

Legg til folkene som får logge inn, på **Statussider → siden din → Sikkerhet → Private brukere**. Der finnes en handling **Legg til i bulk** — lim inn en liste med e-postadresser, så får hver av dem en invitasjonse-post. Private brukere har sin egen flyt for glemt passord og tilbakestilling, atskilt fra OneUptime-prosjektkontoene dine.

### Hovedpassord

**Autentiseringsinnstillinger** har også et kort **Hovedpassord** med en bryter **Krev hovedpassord** og selve passordet. De besøkende havner da på `/master-password` og låser opp siden med én delt hemmelighet.

**Hovedpassord og private brukere kan ikke kombineres.** Så lenge hovedpassordet er på, er autentisering med private brukere slått av, og skjermbildet **Private brukere** viser et banner som forteller deg det.

### SSO og OIDC

For en privat side knyttet til identitetsleverandøren din konfigurerer **Statussider → siden din → Sikkerhet → SSO** SAML (du skriver inn påloggings-URL, utsteder og x509-sertifikat, og signatur- og digest-metodene fylles ut under **Avansert**), og **Statussider → siden din → Sikkerhet → OIDC** konfigurerer OpenID Connect: du skriver inn utsteder, klient-ID og hemmelighet, og oppdagelses-URL, omfang og claim-navn fylles ut under **Avansert**. **SCIM** klargjør private brukere fra IdP-en automatisk. På OneUptime Cloud krever alle tre Scale-planen eller høyere. På en selvdriftet installasjon er SSO og OIDC en del av alle utgaver, mens SCIM krever [Enterprise Edition](/docs/self-hosted/enterprise).

Et kort **SSO-innstillinger** eksponerer **Tving SSO for innlogging** (`requireSsoForLogin`, av som standard). Test SSO-oppsettet ditt før du slår det på — fungerer det ikke, låser du deg selv ute av statussiden.

### IP-hviteliste

**Autentiseringsinnstillinger** bærer også et kort **IP-hviteliste**, som ligger på kolonnen `ipWhitelist`, for sider som bare skal svare fra kjente nettverk.

## Det innebygde merket og RSS-strømmen

To måter å løfte frem status et annet sted enn på selve siden.

**Innebygd statusmerke.** Slå på **Aktiver innebygd statusmerke** (`enableEmbeddedOverallStatus`, av som standard) i kortet **Innebygd statusmerke** på **Statussider → siden din → Avansert → Innebygd status**. Det går sammen med en `embeddedOverallStatusToken` og serverer merket fra `/badge/:statusPageId`, så du kan slippe gjeldende samlede status inn i dokumentasjonen din, i bunnteksten på appen din eller på en markedsføringsside.

**RSS-strøm.** Hver statusside serverer `/rss` — en strøm med tittelen «{statussidens navn} Updates» der elementene har prefiksene `Incident: `, `Announcement: ` og `Scheduled Maintenance: `. Nyttig for folk som heller vil pipe oppdateringene dine inn i en leser eller en chatbot enn å abonnere på e-post.

Vil du heller hente dataene selv, er statussiden støttet av offentlige leseendepunkter for oversikten, hendelsene, de planlagte vedlikeholdshendelsene, kunngjøringene og episodene — se [Offentlig API](/docs/status-pages/public-api).

## Hvor du leser videre

- [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups) — å sette overvåkinger på siden og organisere dem i seksjoner.
- [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains) — logo, favicon, bunntekst, egendefinert kode, og å peke ditt eget domene mot siden.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers) — de fem abonnentkanalene, dobbel bekreftelse og å publisere kunngjøringer.
- [Offentlig API](/docs/status-pages/public-api) — å lese statussidedata programmatisk.
- [Hendelser – Oversikt](/docs/incidents/index) — hendelsene som dukker opp på siden.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva som får en hendelse til å vises på en statusside, og hva som tar den av.
