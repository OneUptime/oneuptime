# Statussider – Oversigt

En statusside er det offentlige ansigt på alt det, du overvåger: én URL, dine kunder kan åbne i stedet for at skrive til dig og spørge, om det bare er dem. Den viser den aktuelle tilstand for de tjenester, du vælger at vise frem, de hændelser du arbejder på, den vedligeholdelse du har planlagt, og enhver meddelelse du vil have hængt op øverst.

Når noget går i stykker klokken to om natten, er statussiden det første, din support linker til. Det er også den, dine abonnenter får besked fra — så den er værd at sætte op, før du får brug for den, ikke midt under nedbruddet.

Statussider bor under **Statussider** i dashboardets venstre navigation, i gruppen **essentials**. Alt på denne side gælder per statusside: et projekt kan køre lige så mange, det vil — en offentlig til kunderne, en privat til et internt publikum, en per region til et bestemt marked.

## Kort fortalt

- **Oprettes med to felter.** En ny statusside beder kun om **Navn** og **Beskrivelse**. Ressourcer, branding og domæner konfigureres bagefter.
- **Ressourcer er det, besøgende ser.** Hver række på siden er en **Statusside Ressource** — en monitor (eller monitorgruppe) med sit eget visningsnavn, værktøjstip og oppetidsindstillinger. Grupper deler en lang side op i sektioner og kan ligge inde i hinanden.
- **En preview-URL fra dag ét.** Hver statusside får et preview-link, så du kan se på den, før der findes et brugerdefineret domæne.
- **De besøgendes ruter styres af indstillinger.** Hændelser, episoder, meddelelser og planlagte begivenheder dukker kun op, så længe deres kontakt i **Hvad din statusside viser** (på **Avancerede indstillinger**) er slået til, og abonnementssiden kun, så længe **Vis abonnentside** er slået til.
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

Hvad de besøgende ser, indstilles i ét kort: **Hvad din statusside viser**, på **Statussider → din side → Avanceret → Avancerede indstillinger**. Det har en række for hver liste, siden kan vise, derefter **Oppetidshistorik** og linjen "Powered by OneUptime". Der er ingen redigeringsknap: En kontakt gemmes, så snart du slår den om, og et antal dage, når du forlader feltet eller trykker på Enter.

- **Vis hændelser** (`showIncidentsOnStatusPage`) — slået til som standard. Under den bestemmer **Vis de seneste … dage** (`showIncidentHistoryInDays`, standard 14), hvor langt tilbage listen over hændelser rækker, og **Vis hændelsesetiketter** (`showIncidentLabelsOnStatusPage`) er slået fra som standard.
- **Vis kun hændelser, der er begrænset til denne side** (`onlyShowScopedIncidents`) — også i hændelsesrækken, slået fra som standard. Er den slået til, viser siden kun de hændelser, der med **Begræns til disse statussider** er begrænset til den, og kun dem får dens abonnenter besked om. Den afgør også, hvilke hændelser der bringer deres episoder på siden, så den bliver stående, når **Vis hændelser** er slået fra.
- **Vis episoder** (`showEpisodesOnStatusPage`) — slået til som standard, med **Vis de seneste … dage** (`showEpisodeHistoryInDays`, standard 14) og **Vis episodeetiketter** (`showEpisodeLabelsOnStatusPage`, slået fra som standard). Episoder er deres egen model med deres egne endpoints, ikke en visning af hændelser.
- **Vis meddelelser** (`showAnnouncementsOnStatusPage`) — slået til som standard, med **Vis de seneste … dage** (`showAnnouncementHistoryInDays`, standard 14).
- **Vis planlagte vedligeholdelsesbegivenheder** (`showScheduledMaintenanceEventsOnStatusPage`) — slået til som standard, med **Vis de seneste … dage** (`showScheduledEventHistoryInDays`, standard 14) og **Vis begivenhedsetiketter** (`showScheduledEventLabelsOnStatusPage`, slået fra som standard).
- **Oppetidshistorik** — **Vis de seneste … dage** (`showUptimeHistoryInDays`) er længden af oppetidsbjælken ved siden af hver ressource. Standard er 90 og skal ligge mellem 1 og 90. Hver eneste **Vis oppetid %**- og **Vis statushistorikdiagram**-indstilling på en ressource eller gruppe læser dette tal.
- **Vis "Powered By OneUptime"-branding** — slået til som standard, så sidefoden hos de besøgende lyder "Powered by OneUptime". Slå den fra for at skjule linjen. Kolonnen gemmer det omvendt, som `hidePoweredByOneUptimeBranding`.

**En liste, der er slået fra,** forsvinder fra siden sammen med sit punkt i navigationslinjen, hvis den har et; dens offentlige endpoint afviser anmodninger, og sidens abonnenter får ikke besked om den slags begivenhed. Dens række viser så kun kontakten: Hvor langt tilbage en skjult liste går, og om den viser etiketter, ændrer intet.

**Planer.** På OneUptime Cloud står den nødvendige plan ved siden af en indstilling, som din plan ikke må ændre. De fire listekontakter, de tre etiketkontakter og episodehistorikken kræver **Growth**; at skjule linjen "Powered by OneUptime" kræver **Scale**. De øvrige historikvinduer, **Oppetidshistorik** og **Vis kun hændelser, der er begrænset til denne side** kan ændres på alle planer, og hver indstilling gemmes for sig.

Om siden viser punktet **Abonner** (**Vis abonnentside**, `showSubscriberPageOnStatusPage`, slået til som standard), og hvilke kanaler besøgende kan abonnere via, indstilles ikke på denne skærm: Begge dele findes i kortet **Kanaler** under **Abonnenter → Abonnementsindstillinger** (se [Abonnenter og meddelelser](/docs/status-pages/subscribers)).

Under kortet følger et kort, der eksporterer statussidens indstillinger til en JSON-fil, som du kan importere igen, og kortet til at arkivere statussiden.

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

Til en privat side bundet til din identitetsudbyder konfigurerer **Statussider → din side → Sikkerhed → SSO** SAML (du angiver sign-on-URL, issuer og x509-certifikat, og signatur- og digest-metoderne udfyldes under **Flere felter**), og **Statussider → din side → Sikkerhed → OIDC** konfigurerer OpenID Connect: du angiver issuer, client-ID og -secret, og discovery-URL, scopes og claim-navne udfyldes under **Flere felter**. **SCIM** provisionerer private brugere automatisk fra IdP'en. På OneUptime Cloud kræver alle tre Scale-planen eller højere. På en selvhostet installation er SSO og OIDC en del af alle udgaver, mens SCIM kræver [Enterprise Edition](/docs/self-hosted/enterprise).

Et **SSO-indstillinger**-kort viser **Tving SSO til login** (`requireSsoForLogin`, slået fra som standard). Test din SSO-konfiguration, før du slår den til — virker den ikke, låser du dig selv ude af statussiden. På OneUptime Cloud kræver det planen **Scale** at slå den til, mens den kan slås fra på alle planer. En side, der stadig kræver SSO, når en Scale-prøveperiode slutter eller planen sættes ned, bliver ved med at kræve det, indtil nogen slår det fra: siderne **SSO** og **OIDC** viser kontakten under planens opgraderingstilbud til netop det.

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
