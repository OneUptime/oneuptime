# Statussider – Oversigt

En statusside er det offentlige ansigt på alt det, du overvåger: én URL, dine kunder kan åbne i stedet for at skrive til dig og spørge, om det bare er dem. Den viser den aktuelle tilstand for de tjenester, du vælger at vise frem, de hændelser du arbejder på, den vedligeholdelse du har planlagt, og enhver meddelelse du vil have hængt op øverst.

Når noget går i stykker klokken to om natten, er statussiden det første, din support linker til. Det er også den, dine abonnenter får besked fra — så den er værd at sætte op, før du får brug for den, ikke midt under nedbruddet.

Statussider bor under **Statussider** i dashboardets venstre navigation, i gruppen **essentials**. Alt på denne side gælder per statusside: et projekt kan køre lige så mange, det vil — en offentlig til kunderne, en privat til et internt publikum, en per region til et bestemt marked.

## Kort fortalt

- **Oprettes med to felter.** En ny statusside beder kun om **Navn** og **Beskrivelse**. Ressourcer, branding og domæner konfigureres bagefter.
- **Ressourcer er det, besøgende ser.** Hver række på siden er en **Statusside Ressource** — en monitor (eller monitorgruppe) med sit eget visningsnavn, værktøjstip og oppetidsindstillinger. Grupper deler en lang side op i sektioner og kan ligge inde i hinanden.
- **En preview-URL fra dag ét.** Hver statusside får et preview-link, så du kan se på den, før der findes et brugerdefineret domæne.
- **De besøgendes ruter styres af indstillinger.** Hændelser, meddelelser, planlagte begivenheder og abonnementssiden dukker kun op, når deres kontakt på **Avancerede indstillinger** er slået til.
- **Tre måder at gøre den privat på.** Private brugere, en hovedadgangskode eller SAML SSO / OIDC — plus en IP-hvidliste.
- **Abonnenter får automatisk besked.** Abonnenter via e-mail, SMS, Slack, Microsoft Teams og webhook kan alle følge en side, hver kanal bag sin egen kontakt.

## Nøglebegreber

| Begreb                        | Hvad det betyder                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statusside**                | Én offentlig (eller privat) side med sin egen branding, sine domæner, ressourcer og abonnenter. Modellen `StatusPage`.                          |
| **Ressource**                 | Én række, de besøgende ser — en monitor eller monitorgruppe vist på siden med et visningsnavn og oppetidsindstillinger.                        |
| **Gruppe**                    | En navngiven sektion, der rummer ressourcer. Grupper kan ligge inde i andre grupper, og hvert niveau ruller status op for alt nedenunder.       |
| **Meddelelse**                | En besked, du slår op på en eller flere statussider, med et starttidspunkt og et valgfrit sluttidspunkt.                                        |
| **Abonnent**                  | En person (eller et system), der følger siden via e-mail, SMS, Slack, Microsoft Teams eller en webhook.                                         |
| **Brugerdefineret domæne**    | Et domæne, du ejer — `status.example.com` — som peges mod siden med en CNAME og et SSL-certifikat.                                              |
| **Privat bruger**             | En konto, der kan logge ind på en privat statusside. Adskilt fra brugerne i dit OneUptime-projekt.                                              |

## At oprette en statusside

1. Åbn **Statussider → Alle statussider**, og klik **Opret statusside**.
2. Udfyld **Navn** (påkrævet, mindst to tegn) og eventuelt **Beskrivelse** i modalen **Create New Status Page**.
3. Klik **Opret statusside**.

Det er hele opret-formularen. Listen, du lander tilbage på, viser **Navn**, **Beskrivelse**, **Etiketter** og **Ejere**, og kan filtreres på **Statusside-ID**, **Navn** og **Beskrivelse**.

Åbn den nye side, og du lander på dens **Oversigt**-skærm, som bærer to kort: **Status Page Preview URL** med et link til selve siden, og **Statussidedetaljer**, hvor du kan redigere det navn, den beskrivelse og de etiketter, du lige har sat.

Derefter, i nogenlunde nytteorden:

- Tilføj ressourcer, så der er noget på siden — se [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups).
- Sæt sidetitel, favicon, logo og cover, og hægt så et brugerdefineret domæne på — se [Statusside – branding og domæner](/docs/status-pages/branding-and-domains).
- Beslut, hvilke kanaler folk kan abonnere på — se [Abonnenter og meddelelser](/docs/status-pages/subscribers).
- Finjustér, hvad der vises på siden, under **Avancerede indstillinger**.

## Hvor alting bor

Når en statusside først er åben, er dens egen venstre sidemenu delt i ni sektioner. Brug den som kort over resten af denne dokumentationsgruppe.

| Sektion               | Hvad der er i den                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grundlæggende**     | **Oversigt**, **Meddelelser**, **Ejere**.                                                                                                              |
| **Ressourcer**        | En enkelt **Ressourcer**-skærm — grupper til venstre, den valgte gruppes monitorer til højre.                                                          |
| **Abonnenter**        | **E-mail-abonnenter**, **SMS-abonnenter**, **Slack-abonnenter**, **MS Teams-abonnenter**, **Webhook-abonnenter**, **Abonnementsindstillinger**.        |
| **Notifikationslogs** | **Notifikationslogs** — hvad der blev sendt til abonnenterne.                                                                                          |
| **Revision**          | **Auditlogs**.                                                                                                                                         |
| **Branding**          | **Essentiel branding**, **HTML, CSS og JavaScript**, **Brugerdefinerede domæner**, **Sidehoved**, **Sidefod**, **Oversigtsside**, **Sprog**.           |
| **Sikkerhed**         | **Private brugere**, **SSO**, **OIDC**, **SCIM**, **Godkendelsesindstillinger**.                                                                       |
| **AI**                | **MCP**.                                                                                                                                               |
| **Avanceret**         | **Monitor Rules**, **Indlejret status**, **Rapporter**, **Brugerdefinerede felter**, **Avancerede indstillinger**, **Slet statusside**.                |

To navnefinurligheder, det er værd at kende, før du går på jagt:

- Punktet **Ressourcer** hedder kun **Ressourcer**, når projektet har monitorgrupper slået til. Ellers står der **Monitorer**. Det er den samme skærm under alle omstændigheder.
- Der findes ingen selvstændig gruppeside. Grupper og ressourcer blev slået sammen, og den gamle `/groups`-rute viderestiller nu til ressourceskærmen.

Uden for en enkelt side har selve **Statussider**-sektionen en **Mere**-sektion med **Meddelelser** og en sammenklappet **Indstillinger**-sektion med **Meddelelsesskabeloner**, **Abonnementsskabeloner**, **Brugerdefinerede felter**, **Ejerregler** og **Etiketregler** — de gælder hele projektet og deles af alle statussider.

## Hvad besøgende ser

Den offentlige side er sin egen app med et lille sæt ruter:

- `/` — **Oversigt**.
- `/incidents` og `/incidents/:id` — listen over hændelser og en enkelt hændelse.
- `/announcements` og `/announcements/:id`.
- `/scheduled-events` og `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — feedet.
- `/login`, `/sso` og `/master-password` — kun relevante på en privat side.

Den øverste navigationslinje viser altid **Oversigt**; resten dukker kun op, når de er slået til. **Hændelser**, **Meddelelser** og **Planlagte hændelser** kræver hver sin kontakt slået til; **Abonner** kræver både **Vis abonnentside** og mindst én abonnentkanal aktiveret. En privat side får desuden et **Log ud**-punkt.

### Oversigtssiden

Oversigten er den side, de fleste besøgende nogensinde ser. Fra top til bund viser den:

1. **Eventuelle aktive meddelelser** — meddelelser, hvis starttidspunkt er passeret, og hvis sluttidspunkt ikke er det.
2. **Et samlet statusbanner** — en enkelt linje, der opsummerer, om alle eller kun nogle ressourcer er berørt.
3. **En samlet oppetidsprocent**, hvis du har slået den til. Slået fra som standard.
4. **Ressourcegrupperne**, hver med deres ressourcer, deres aktuelle status og deres oppetidshistorik-bjælker.
5. **Aktive hændelser**.
6. **Planlagte vedligeholdelseshændelser**.

En helt ny side uden noget på viser en tom tilstand, der beder dig tilføje ressourcer fra dashboardet — hvilket er dit stikord til at gå til **Ressourcer**-skærmen.

Se [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) for, hvad der overhovedet får en hændelse på denne side, og hvad der fjerner den igen.

## At vælge hvad der vises på siden

De fleste visningskontakter bor ét sted: **Statussider → din side → Avanceret → Avancerede indstillinger**. Hvert kort har sin egen **Edit Settings**-knap.

**Hændelsesindstillinger**:

- **Vis hændelser** (`showIncidentsOnStatusPage`) — slået til som standard. Slår du den fra, forsvinder navigationspunktet **Hændelser** også.
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

- **Vis oppetidshistorik (i dage)** (`showUptimeHistoryInDays`) — længden af oppetidsbjælken ved siden af hver ressource. Standard er 90 og skal ligge mellem 1 og 90. Hver eneste **Vis oppetid %**- og **Vis statushistorikdiagram**-indstilling på en ressource eller gruppe læser dette tal.

**Abonnementsindstillinger**:

- **Vis abonnentside** (`showSubscriberPageOnStatusPage`) — slået til som standard, plus de fem kontakter til de enkelte kanaler. De samme kanalkontakter findes også på den dedikerede skærm **Abonnementsindstillinger** under **Abonnenter**-sektionen; betragt den som det kanoniske sted at sætte dem.

**Drevet af OneUptime-branding**:

- **Skjul "Powered By OneUptime"-branding** — slået fra som standard, så sidefoden hos de besøgende lyder "Powered by OneUptime", indtil du slår den til.

**Hvor farverne er.** Farverne på oppetidsbjælken er ikke her — **Standardbjælkefarve**, reglerne for bjælkefarver, **Nedetidsovervågningsstatusser** og **Vis samlet oppetidsprocent** bor alle på **Statussider → din side → Branding → Oversigtsside**. Der findes ingen tema- eller brandfarveindstilling nogen steder; alt ud over de kontroller klares med **Brugerdefineret CSS**.

## At se siden an, før du går live

**Oversigt**-skærmen på hver statusside bærer et **Status Page Preview URL**-kort med et link direkte til siden. Brug det, mens du stadig er i gang med at tilføje ressourcer, og før der findes et brugerdefineret domæne.

Bag kulisserne har hver offentlig rute en preview-tvilling under `/status-page/{statusPageId}/...` — en preview-oversigt, en preview-liste over hændelser, en preview-abonnementsside og så videre. Det betyder, at en URL eller et skærmbillede taget fra preview i dashboardet ikke svarer til det, en kunde ser, når først et brugerdefineret domæne er hægtet på — så tjek ethvert link, du indsætter i et runbook eller en e-mail, en ekstra gang.

## At begrænse hvem der må se siden

Ikke enhver statusside er til offentligheden. Alle kontrollerne ligger under **Sikkerhed**-sektionen.

### Private brugere

Slå **Er synlig for offentligheden** fra under **Statussider → din side → Sikkerhed → Godkendelsesindstillinger** (kolonnen `isPublicStatusPage`). Besøgende lander så på `/login` og skal logge ind.

Tilføj de folk, der må logge ind, under **Statussider → din side → Sikkerhed → Private brugere**. Der er en **Tilføj i bulk**-handling — indsæt en liste af e-mailadresser, og hver af dem får en invitation på e-mail. Private brugere har deres eget flow til glemt og nulstillet adgangskode, adskilt fra dine OneUptime-projektkonti.

### Hovedadgangskode

**Godkendelsesindstillinger** har også et **Hovedkodeord**-kort med en **Kræv hovedadgangskode**-kontakt og selve adgangskoden. Besøgende rammer så `/master-password` og låser siden op med én fælles hemmelighed.

**Hovedadgangskode og private brugere kan ikke kombineres.** Så længe hovedadgangskoden er slået til, er godkendelse med private brugere deaktiveret, og skærmen **Private brugere** viser et banner, der fortæller dig det.

### SSO og OIDC

Til en privat side bundet til din identitetsudbyder konfigurerer **Statussider → din side → Sikkerhed → SSO** SAML (sign-on-URL, issuer, x509-certifikat, signatur- og digest-metoder), og **Statussider → din side → Sikkerhed → OIDC** konfigurerer OpenID Connect (discovery-URL, issuer, client-ID og -secret, scopes, claim-navne). **SCIM** provisionerer private brugere automatisk fra IdP'en. Det ligger bag en plan-funktion, så det er ikke nødvendigvis tilgængeligt i enhver installation.

Et **SSO-indstillinger**-kort viser **Tving SSO til login** (`requireSsoForLogin`, slået fra som standard). Test din SSO-konfiguration, før du slår den til — virker den ikke, låser du dig selv ude af statussiden.

### IP-hvidliste

**Godkendelsesindstillinger** bærer også et **IP-hvidliste**-kort, understøttet af kolonnen `ipWhitelist`, til sider der kun bør svare fra kendte netværk.

## Det indlejrbare mærke og RSS-feedet

To måder at vise status frem et andet sted end på selve siden.

**Indlejret statusmærke.** Slå **Aktivér indlejret statusmærke** (`enableEmbeddedOverallStatus`, slået fra som standard) til i kortet **Indlejret statusmærke** under **Statussider → din side → Avanceret → Indlejret status**. Det følges af et `embeddedOverallStatusToken` og serverer mærket fra `/badge/:statusPageId`, så du kan lægge den aktuelle samlede status ind i din dokumentation, i din apps sidefod eller på en marketingside.

**RSS-feed.** Hver statusside serverer `/rss` — et feed med titlen "{statussidens navn} Updates", hvis punkter er præfikset `Incident: `, `Announcement: ` og `Scheduled Maintenance: `. Praktisk for folk, der hellere vil pumpe dine opdateringer ind i en læser eller en chatbot end at abonnere på e-mail.

Vil du hellere hente data selv, understøttes statussiden af offentlige læse-endpoints for oversigten, hændelser, planlagte vedligeholdelsesbegivenheder, meddelelser og episoder — se [Offentlig API](/docs/status-pages/public-api).

## Hvor du kan læse videre

- [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups) — at få monitorer på siden og organisere dem i sektioner.
- [Statusside – branding og domæner](/docs/status-pages/branding-and-domains) — logo, favicon, sidefod, brugerdefineret kode og at pege dit eget domæne mod siden.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — de fem abonnementskanaler, dobbelt opt-in og at slå meddelelser op.
- [Offentlig API](/docs/status-pages/public-api) — at læse statussidedata programmatisk.
- [Hændelser – Oversigt](/docs/incidents/index) — de begivenheder, der dukker op på siden.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad der får en hændelse til at optræde på en statusside, og hvad der fjerner den.
