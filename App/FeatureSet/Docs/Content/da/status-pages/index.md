# Statussider – Oversigt

En statusside er det offentlige ansigt på alt, hvad du overvåger: én URL, dine kunder kan åbne i stedet for at sende dig en e-mail for at spørge, om det bare er dem. Den viser den aktuelle tilstand for de tjenester, du vælger at eksponere, de hændelser du arbejder på, den vedligeholdelse du har planlagt, og enhver meddelelse du vil fastgøre øverst.

Når noget går i stykker klokken 2 om natten, er statussiden det første, din supportkø linker til. Det er også det, dine abonnenter får besked fra — så den er værd at sætte op, før du får brug for den, ikke under udfaldet.

Statussider bor under **Statussider** i dashboardets venstre navigation, i gruppen **Grundlæggende**. Alt på denne side er per statusside: et projekt kan køre lige så mange, det vil — en offentlig til kunder, en privat til et internt publikum, en per region til et bestemt marked.

## I et hurtigt overblik

- **Oprettes med to felter.** En ny statusside beder kun om **Navn** og **Beskrivelse**. Ressourcer, branding og domæner konfigureres bagefter.
- **Ressourcer er det, besøgende ser.** Hver række på siden er en **Statusside Ressource** — en monitor (eller monitorgruppe) med sit eget visningsnavn, værktøjstip og oppetidsindstillinger. Grupper deler en lang side op i sektioner og kan indlejres.
- **En preview-URL fra dag ét.** Hver statusside får et preview-link, så du kan se på den, før et brugerdefineret domæne findes.
- **Besøgendes ruter er styret af indstillinger.** Hændelser, meddelelser, planlagte begivenheder og abonnentsiden vises hver kun, når deres kontakt på **Avancerede indstillinger** er slået til.
- **Tre måder at gøre den privat på.** Private brugere, et hovedkodeord eller SAML SSO / OIDC — plus en IP-hvidliste.
- **Abonnenter får automatisk besked.** Abonnenter via e-mail, SMS, Slack, Microsoft Teams og webhook kan alle følge en side, hver kanal bag sin egen kontakt.

## Nøglebegreber

| Begreb                        | Betydning                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Statusside**                | Én offentlig (eller privat) side, med sin egen branding, sine domæner, ressourcer og abonnenter. Modellen `StatusPage`.             |
| **Ressource**                 | Én række besøgende ser — en monitor eller monitorgruppe vist på siden med et visningsnavn og oppetidsindstillinger.                 |
| **Gruppe**                    | En navngiven sektion, der rummer ressourcer. Grupper indlejres i andre grupper, og hvert niveau ruller status op for alt nedenunder. |
| **Meddelelse**                | En besked, du sender til en eller flere statussider, med et starttidspunkt og et valgfrit sluttidspunkt.                             |
| **Abonnent**                  | Nogen (eller noget), der følger siden via e-mail, SMS, Slack, Microsoft Teams eller en webhook.                                      |
| **Brugerdefineret domæne**    | Et domæne, du ejer — `status.example.com` — peget mod siden med en CNAME og et SSL-certifikat.                                       |
| **Privat bruger**             | En konto, der kan logge ind på en privat statusside. Adskilt fra dine OneUptime-projektbrugere.                                      |

## At oprette en statusside

1. Åbn **Statussider → Alle statussider** og klik **Opret statusside**.
2. I modalen **Create New Status Page** udfylder du **Navn** (påkrævet, mindst to tegn) og eventuelt **Beskrivelse**.
3. Klik **Opret statusside**.

Det er hele oprettelsesformularen. Listen, du lander tilbage på, viser **Navn**, **Beskrivelse**, **Etiketter** og **Ejere**, og kan filtreres efter **Statusside-ID**, **Navn** og **Beskrivelse**.

Åbn den nye side, og du lander på dens skærm **Oversigt**, som bærer to kort: **Status Page Preview URL** med et link til selve siden, og **Statussidedetaljer** hvor du kan redigere det navn, den beskrivelse og de etiketter, du lige satte.

Dernæst, i nogenlunde rækkefølge efter nytte:

- Tilføj ressourcer, så siden har noget på sig — se [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups).
- Sæt sidetitel, favicon, logo og cover, og knyt derefter et brugerdefineret domæne — se [Statusside – branding og domæner](/docs/status-pages/branding-and-domains).
- Beslut hvilke kanaler folk kan abonnere på — se [Abonnenter og meddelelser](/docs/status-pages/subscribers).
- Justér hvad der vises på siden under **Avancerede indstillinger**.

## Hvor alting bor

Når en statusside er åbnet, er dens egen venstre sidemenu grupperet i ni sektioner. Brug denne som kort over resten af denne dokumentationsgruppe.

| Sektion               | Hvad der er i den                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grundlæggende**     | **Oversigt**, **Meddelelser**, **Ejere**.                                                                                                      |
| **Ressourcer**        | En enkelt skærm **Ressourcer** — grupper til venstre, den valgte gruppes monitorer til højre.                                                  |
| **Abonnenter**        | **E-mail-abonnenter**, **SMS-abonnenter**, **Slack-abonnenter**, **MS Teams-abonnenter**, **Webhook-abonnenter**, **Abonnementsindstillinger**. |
| **Notifikationslogs** | **Notifikationslogs** — hvad der blev sendt til abonnenter.                                                                                    |
| **Revision**          | **Auditlogs**.                                                                                                                                 |
| **Branding**          | **Essentiel branding**, **HTML, CSS og JavaScript**, **Brugerdefinerede domæner**, **Sidehoved**, **Sidefod**, **Oversigtsside**, **Sprog**.   |
| **Sikkerhed**         | **Private brugere**, **SSO**, **OIDC**, **SCIM**, **Godkendelsesindstillinger**.                                                               |
| **AI**                | **MCP**.                                                                                                                                       |
| **Avanceret**         | **Monitor Rules**, **Indlejret status**, **Rapporter**, **Brugerdefinerede felter**, **Avancerede indstillinger**, **Slet statusside**.        |

To navnemæssige særheder værd at kende, før du går på jagt:

- Punktet **Ressourcer** hedder kun **Ressourcer**, når projektet har monitorgrupper aktiveret. Ellers hedder det **Monitorer**. Det er den samme skærm i begge tilfælde.
- Der er ingen separat Grupper-side. Grupper og ressourcer blev slået sammen, og den gamle rute `/groups` omdirigerer nu til ressourceskærmen.

Uden for en individuel side har selve sektionen **Statussider** en sektion **Mere** med **Meddelelser**, og en sammenklappet sektion **Indstillinger**, der rummer **Meddelelsesskabeloner**, **Abonnementsskabeloner**, **Brugerdefinerede felter**, **Ejerregler** og **Etiketregler** — disse er projektbrede og deles på tværs af hver statusside.

## Hvad besøgende ser

Den offentlige side er sin egen app, med et lille sæt ruter:

- `/` — **Oversigt**.
- `/incidents` og `/incidents/:id` — listen over hændelser og en enkelt hændelse.
- `/announcements` og `/announcements/:id`.
- `/scheduled-events` og `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — feedet.
- `/login`, `/sso` og `/master-password` — kun relevante på en privat side.

Den øverste navigationslinje viser altid **Oversigt**; resten vises kun, når de er aktiveret. **Hændelser**, **Meddelelser** og **Planlagte begivenheder** kræver hver deres kontakt slået til; **Subscribe** kræver både **Vis abonnentside** og mindst én abonnentkanal aktiveret. En privat side får også et punkt **Log ud**.

### Oversigtssiden

Oversigten er den side, de fleste besøgende nogensinde ser. Fra top til bund viser den:

1. **Eventuelle live meddelelser** — meddelelser, hvis starttidspunkt er passeret, og hvis sluttidspunkt ikke er.
2. **Et overordnet statusbanner** — en enkelt linje, der opsummerer, om alle eller kun nogle ressourcer er berørt.
3. **En samlet oppetidsprocent**, hvis du slog den til. Slået fra som standard.
4. **Ressourcegrupperne**, hver med sine ressourcer, deres aktuelle status og deres oppetidshistorik-bjælker.
5. **Aktive hændelser**.
6. **Planlagt Vedligeholdelse Begivenheder**.

En helt ny side uden noget på viser en tomtilstand, der beder dig tilføje ressourcer fra dashboardet — hvilket er dit stikord til at gå til skærmen **Ressourcer**.

For hvad der overhovedet sætter en hændelse på denne side, og hvad der fjerner den igen, se [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

## At vælge hvad der vises på siden

De fleste visningskontakter bor ét sted: **Statussider → din side → Avanceret → Avancerede indstillinger**. Hvert kort har sin egen knap **Edit Settings**.

**Hændelsesindstillinger**:

- **Vis hændelser** (`showIncidentsOnStatusPage`) — slået til som standard. At slå den fra fjerner også navigationspunktet **Hændelser**.
- **Vis hændelseshistorik (i dage)** (`showIncidentHistoryInDays`) — hvor langt tilbage listen over hændelser rækker. Standard er 14.
- **Vis hændelsesetiketter** (`showIncidentLabelsOnStatusPage`) — slået fra som standard.

**Episodeindstillinger** — de samme tre kontakter for hændelsesepisoder: **Vis episoder** (`showEpisodesOnStatusPage`, slået til som standard), **Vis episodehistorik (i dage)** (standard 14) og **Vis episodeetiketter** (slået fra som standard). Episoder er deres egen model med deres egne endpoints, ikke en visning af hændelser.

**Meddelelsesindstillinger**:

- **Vis meddelelser** (`showAnnouncementsOnStatusPage`) — slået til som standard.
- **Vis meddelelseshistorik (i dage)** (`showAnnouncementHistoryInDays`) — standard er 14.

**Indstillinger for planlagt begivenhed**:

- **Vis planlagte vedligeholdelsesbegivenheder** (`showScheduledMaintenanceEventsOnStatusPage`) — slået til som standard.
- **Vis historik for planlagte begivenheder (i dage)** (`showScheduledEventHistoryInDays`) — standard er 14.
- **Vis begivenhedsetiketter** (`showScheduledEventLabelsOnStatusPage`) — slået fra som standard.

**Indstillinger for oppetidshistorik**:

- **Vis oppetidshistorik (i dage)** (`showUptimeHistoryInDays`) — længden af oppetidsbjælken ved siden af hver ressource. Standard er 90 og skal være mellem 1 og 90. Hver indstilling **Vis oppetid %** og **Vis statushistorikdiagram** på en ressource eller gruppe læser dette tal.

**Abonnementsindstillinger**:

- **Vis abonnentside** (`showSubscriberPageOnStatusPage`) — slået til som standard, plus de fem aktiveringskontakter per kanal. De samme kanalkontakter optræder også på den dedikerede skærm **Abonnementsindstillinger** under sektionen **Abonnenter**; behandl den som det kanoniske sted at sætte dem.

**Drevet af OneUptime-branding**:

- **Skjul "Powered By OneUptime"-branding** — slået fra som standard, så besøgendes sidefod lyder "Powered by OneUptime", indtil du slår denne til.

**Hvor farverne er.** Oppetidsbjælkens farver er ikke her — **Standardbjælkefarve**, bjælkefarvereglerne, **Nedetidsovervågningsstatusser** og **Vis samlet oppetidsprocent** bor alle på **Statussider → din side → Branding → Oversigtsside**. Der findes ingen tema- eller brandfarveindstilling nogen steder; alt ud over de kontroller gøres med **Brugerdefineret CSS**.

## At forhåndsvise før du går live

Skærmen **Oversigt** på hver statusside bærer et kort **Status Page Preview URL** med et link direkte til siden. Brug det, mens du stadig tilføjer ressourcer, og før noget brugerdefineret domæne findes.

Bag kulisserne har hver offentlig rute en preview-tvilling under `/status-page/{statusPageId}/...` — en preview-oversigt, en preview-liste over hændelser, en preview-abonnementsside og så videre. Det betyder, at en URL eller et skærmbillede taget fra dashboardets preview ikke vil matche det, en kunde ser, når først et brugerdefineret domæne er knyttet, så dobbelttjek ethvert link, du indsætter i et runbook eller en e-mail.

## At begrænse hvem der kan se siden

Ikke enhver statusside er til offentligheden. Alle kontrollerne sidder under sektionen **Sikkerhed**.

### Private brugere

Slå **Er synlig for offentligheden** fra på **Statussider → din side → Sikkerhed → Godkendelsesindstillinger** (kolonnen `isPublicStatusPage`). Besøgende lander så på `/login` og skal logge ind.

Tilføj de mennesker, der må logge ind, på **Statussider → din side → Sikkerhed → Private brugere**. Der er en handling **Tilføj i bulk** — indsæt en liste over e-mailadresser, og hver enkelt får en invitations-e-mail. Private brugere har deres eget glemt-adgangskode- og nulstil-adgangskode-flow, adskilt fra dine OneUptime-projektkonti.

### Hovedkodeord

**Godkendelsesindstillinger** har også et kort **Hovedkodeord** med en kontakt **Kræv hovedadgangskode** og selve adgangskoden. Besøgende rammer så `/master-password` og låser siden op med en enkelt delt hemmelighed.

**Hovedkodeord og private brugere kan ikke stables.** Mens hovedkodeordet er slået til, er godkendelse af private brugere deaktiveret, og skærmen **Private brugere** viser et banner, der fortæller dig det.

### SSO og OIDC

For en privat side knyttet til din identitetsudbyder konfigurerer **Statussider → din side → Sikkerhed → SSO** SAML (sign-on-URL, issuer, x509-certifikat, signatur- og digest-metoder), og **Statussider → din side → Sikkerhed → OIDC** konfigurerer OpenID Connect (discovery-URL, issuer, klient-ID og hemmelighed, scopes, claim-navne). **SCIM** provisionerer private brugere fra IdP'en automatisk. Disse er styret af en planfunktion, så de er måske ikke tilgængelige på enhver installation.

Et kort **SSO-indstillinger** eksponerer **Tving SSO til login** (`requireSsoForLogin`, slået fra som standard). Test din SSO-konfiguration, før du slår den til — hvis den ikke virker, låser du dig selv ude af statussiden.

### IP-hvidliste

**Godkendelsesindstillinger** bærer også et kort **IP-hvidliste**, understøttet af kolonnen `ipWhitelist`, til sider der kun bør svare fra kendte netværk.

## Det indlejrbare mærke og RSS-feedet

To måder at vise status et andet sted end på selve siden.

**Indlejret statusmærke.** Slå **Aktivér indlejret statusmærke** (`enableEmbeddedOverallStatus`, slået fra som standard) til i kortet **Indlejret statusmærke** på **Statussider → din side → Avanceret → Indlejret status**. Det parres med en `embeddedOverallStatusToken` og serverer mærket fra `/badge/:statusPageId`, så du kan smide den aktuelle samlede status ind i din dokumentation, din apps sidefod eller en marketingside.

**RSS-feed.** Hver statusside serverer `/rss` — et feed med titlen "{status page name} Updates", hvis punkter er præfikset `Incident: `, `Announcement: ` og `Scheduled Maintenance: `. Praktisk for folk, der hellere vil sende dine opdateringer ind i en læser eller en chatbot end at abonnere via e-mail.

Hvis du hellere vil hente dataene selv, understøttes statussiden af offentlige læse-endpoints for oversigten, hændelser, planlagte vedligeholdelsesbegivenheder, meddelelser og episoder — se [Offentlig API](/docs/status-pages/public-api).

## Læs videre

- [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups) — at sætte monitorer på siden og organisere dem i sektioner.
- [Statusside – branding og domæner](/docs/status-pages/branding-and-domains) — logo, favicon, sidefod, brugerdefineret kode og at pege dit eget domæne mod siden.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — de fem abonnentkanaler, dobbelt opt-in og at skrive meddelelser.
- [Offentlig API](/docs/status-pages/public-api) — at læse statussidedata programmatisk.
- [Hændelser – Oversigt](/docs/incidents/index) — de begivenheder, der dukker op på siden.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad der får en hændelse til at optræde på en statusside, og hvad der fjerner den.
