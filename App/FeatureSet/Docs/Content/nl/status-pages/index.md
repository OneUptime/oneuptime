# Statuspagina's – Overzicht

Een statuspagina is het publieke gezicht van alles wat je monitort: één URL die je klanten kunnen openen in plaats van je te mailen om te vragen of het probleem alleen bij hen zit. Ze toont de huidige status van de services die je kiest om te tonen, de incidenten waar je aan werkt, het geplande onderhoud, en elke aankondiging die je bovenaan wilt vastzetten.

Als er om 2 uur 's nachts iets stukgaat, is de statuspagina het eerste waar je supportqueue naar linkt. Het is ook waar je abonnees vandaan bericht krijgen — dus het loont om dit in te richten voordat je het nodig hebt, niet tijdens de storing.

Statuspagina's leven onder **Status Pages** in de linkernavigatie van het dashboard, in de groep **essentials**. Alles op deze pagina is per statuspagina: een project kan er zoveel draaien als het wil — een publieke voor klanten, een private voor een intern publiek, een per-regio voor een specifieke markt.

## In één oogopslag

- **Aangemaakt met twee velden.** Een nieuwe statuspagina vraagt alleen om **Name** en **Description**. Resources, branding en domeinen worden allemaal daarna geconfigureerd.
- **Resources zijn wat bezoekers zien.** Elke rij op de pagina is een **Status Page Resource** — een monitor (of monitorgroep) met een eigen weergavenaam, tooltip en uptime-opties. Groepen splitsen een lange pagina op in secties en kunnen genest worden.
- **Een preview-URL vanaf dag één.** Elke statuspagina krijgt een preview-link, zodat je ernaar kunt kijken voordat er een aangepast domein bestaat.
- **Bezoekersroutes worden gestuurd door instellingen.** Incidenten, aankondigingen, geplande gebeurtenissen en de abonneepagina verschijnen elk alleen wanneer hun schakelaar op **Advanced Settings** aan staat.
- **Drie manieren om hem privé te maken.** Privégebruikers, een hoofdwachtwoord, of SAML SSO / OIDC — plus een IP-whitelist.
- **Abonnees worden automatisch geïnformeerd.** E-mail-, SMS-, Slack-, Microsoft Teams- en webhook-abonnees kunnen allemaal een pagina volgen, elk kanaal achter zijn eigen schakelaar.

## Kernbegrippen

| Term                  | Betekenis                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Statuspagina**      | Eén publieke (of private) pagina, met eigen branding, domeinen, resources en abonnees. Het `StatusPage`-model.                     |
| **Resource**          | Eén rij die bezoekers zien — een monitor of monitorgroep die op de pagina getoond wordt met een weergavenaam en uptime-opties.     |
| **Groep**             | Een benoemde sectie die resources bevat. Groepen nesten in andere groepen, en elk niveau rolt de status van alles eronder op.       |
| **Aankondiging**      | Een bericht dat je op één of meer statuspagina's plaatst, met een starttijd en een optionele eindtijd.                             |
| **Abonnee**           | Iemand (of iets) dat de pagina volgt via e-mail, SMS, Slack, Microsoft Teams of een webhook.                                        |
| **Aangepast domein**  | Een domein van jezelf — `status.example.com` — dat met een CNAME en een SSL-certificaat naar de pagina wijst.                       |
| **Privégebruiker**    | Een account dat kan inloggen op een private statuspagina. Los van je OneUptime-projectgebruikers.                                   |

## Een statuspagina aanmaken

1. Open **Status Pages → All Status Pages** en klik op **Create Status Page**.
2. Vul in de modal **Create New Status Page** het veld **Name** in (verplicht, minstens twee tekens) en, optioneel, **Description**.
3. Klik op **Create Status Page**.

Dat is het hele aanmaakformulier. De lijst waarop je terechtkomt toont **Name**, **Description**, **Labels** en **Owners**, en kan gefilterd worden op **Status Page ID**, **Name** en **Description**.

Open de nieuwe pagina en je komt op het scherm **Overview**, met twee kaarten: **Status Page Preview URL** met een link naar de pagina zelf, en **Status Page Details** waar je de naam, beschrijving en labels die je net hebt ingesteld kunt bewerken.

Vervolgens, in ruwe volgorde van nut:

- Voeg resources toe zodat er iets op de pagina staat — zie [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups).
- Stel de paginatitel, favicon, logo en cover in, en koppel dan een aangepast domein — zie [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains).
- Bepaal op welke kanalen mensen zich kunnen abonneren — zie [Abonnees en aankondigingen](/docs/status-pages/subscribers).
- Stel af wat er op de pagina verschijnt onder **Advanced Settings**.

## Waar alles leeft

Zodra een statuspagina open is, is het eigen linkerzijmenu ingedeeld in negen secties. Gebruik dit als kaart voor de rest van deze documentatiegroep.

| Sectie                 | Wat erin zit                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Basic**               | **Overview**, **Announcements**, **Owners**.                                                                                                     |
| **Resources**           | Eén scherm **Resources** — groepen links, de monitoren van de geselecteerde groep rechts.                                                        |
| **Subscribers**         | **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers**, **Webhook Subscribers**, **Subscriber Settings**.   |
| **Notification Logs**   | **Notification Logs** — wat er naar abonnees is verstuurd.                                                                                        |
| **Audit**               | **Audit Logs**.                                                                                                                                    |
| **Branding**            | **Essential Branding**, **HTML, CSS & JavaScript**, **Custom Domains**, **Header**, **Footer**, **Overview Page**, **Languages**.                |
| **Security**            | **Private Users**, **SSO**, **OIDC**, **SCIM**, **Authentication Settings**.                                                                      |
| **AI**                  | **MCP**.                                                                                                                                            |
| **Advanced**            | **Monitor Rules**, **Embedded Status**, **Reports**, **Custom Fields**, **Advanced Settings**, **Delete Status Page**.                            |

Twee benoemingseigenaardigheden om te kennen voordat je gaat zoeken:

- Het item **Resources** heet alleen **Resources** wanneer het project monitorgroepen heeft ingeschakeld. Anders staat er **Monitors**. Het is hoe dan ook hetzelfde scherm.
- Er is geen aparte Groups-pagina. Groepen en resources zijn samengevoegd, en de oude `/groups`-route stuurt nu door naar het resources-scherm.

Buiten een individuele pagina heeft de sectie **Status Pages** zelf een sectie **More** met **Announcements**, en een ingeklapte sectie **Settings** met **Announcement Templates**, **Subscriber Templates**, **Custom Fields**, **Owner Rules** en **Label Rules** — deze zijn projectbreed, gedeeld door elke statuspagina.

## Wat bezoekers zien

De publieke pagina is een eigen app, met een kleine set routes:

- `/` — de **Overview**.
- `/incidents` en `/incidents/:id` — de incidentenlijst en één incident.
- `/announcements` en `/announcements/:id`.
- `/scheduled-events` en `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — de feed.
- `/login`, `/sso` en `/master-password` — alleen relevant op een private pagina.

De bovenste navigatiebalk toont altijd **Overview**; de rest verschijnt alleen wanneer ingeschakeld. **Incidents**, **Announcements** en **Scheduled Events** hebben elk hun eigen schakelaar nodig; **Subscribe** heeft zowel **Show Subscriber Page** als minstens één ingeschakeld abonneekanaal nodig. Een private pagina krijgt ook een item **Logout**.

### De overzichtspagina

De overzichtspagina is de pagina die de meeste bezoekers ooit zien. Van boven naar beneden toont hij:

1. **Alle live aankondigingen** — aankondigingen waarvan de starttijd voorbij is en de eindtijd nog niet.
2. **Een algemene statusbanner** — één regel die samenvat of alle of slechts enkele resources getroffen zijn.
3. **Een algemeen uptimepercentage**, als je dat aangezet hebt. Standaard uit.
4. **De resourcegroepen**, elk met hun resources, hun huidige status, en hun uptime-geschiedenisbalken.
5. **Active Incidents**.
6. **Scheduled Maintenance Events**.

Een gloednieuwe pagina zonder iets erop toont een lege staat die je vertelt om resources toe te voegen vanuit het dashboard — dat is je signaal om naar het scherm **Resources** te gaan.

Voor wat een incident in de eerste plaats op deze pagina zet, en wat het er weer af haalt, zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

## Kiezen wat er op de pagina getoond wordt

De meeste weergaveschakelaars leven op één plek: **Status Pages → jouw pagina → Advanced → Advanced Settings**. Elke kaart heeft een eigen knop **Edit Settings**.

**Incident Settings**:

- **Show Incidents** (`showIncidentsOnStatusPage`) — standaard aan. Uitzetten verwijdert ook het navigatie-item **Incidents**.
- **Show Incident History (in days)** (`showIncidentHistoryInDays`) — hoe ver de incidentenlijst terugreikt. Standaard 14.
- **Show Incident Labels** (`showIncidentLabelsOnStatusPage`) — standaard uit.

**Episode Settings** — dezelfde drie schakelaars voor incident-episodes: **Show Episodes** (`showEpisodesOnStatusPage`, standaard aan), **Show Episode History (in days)** (standaard 14), en **Show Episode Labels** (standaard uit). Episodes zijn een eigen model met eigen endpoints, geen weergave van incidenten.

**Announcement Settings**:

- **Show Announcements** (`showAnnouncementsOnStatusPage`) — standaard aan.
- **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`) — standaard 14.

**Scheduled Event Settings**:

- **Show Scheduled Maintenance Events** (`showScheduledMaintenanceEventsOnStatusPage`) — standaard aan.
- **Show Scheduled Event History (in days)** (`showScheduledEventHistoryInDays`) — standaard 14.
- **Show Event Labels** (`showScheduledEventLabelsOnStatusPage`) — standaard uit.

**Uptime History Settings**:

- **Show Uptime History (in days)** (`showUptimeHistoryInDays`) — de lengte van de uptimebalk naast elke resource. Standaard 90 en moet tussen 1 en 90 liggen. Elke optie **Show Uptime %** en **Show Status History Chart** op een resource of groep leest dit getal.

**Subscriber Settings**:

- **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) — standaard aan, plus de vijf schakelaars per kanaal. Dezelfde kanaalschakelaars verschijnen ook op het aparte scherm **Subscriber Settings** onder de sectie **Subscribers**; beschouw dat als de canonieke plek om ze in te stellen.

**Powered By OneUptime Branding**:

- **Hide Powered By OneUptime Branding** — standaard uit, zodat de voettekst voor bezoekers "Powered by OneUptime" toont totdat je dit aanzet.

**Waar de kleuren zitten.** De kleuren van de uptimebalk zitten niet hier — de **Default Bar Color**, de balkkleurregels, de **Downtime Monitor Statuses** en **Show Overall Uptime Percent** leven allemaal op **Status Pages → jouw pagina → Branding → Overview Page**. Er is nergens een thema- of merkkleurinstelling; alles voorbij die bedieningselementen doe je met **Custom CSS**.

## Voorvertonen voordat je live gaat

Het scherm **Overview** van elke statuspagina heeft een kaart **Status Page Preview URL** met een link rechtstreeks naar de pagina. Gebruik hem terwijl je nog resources aan het toevoegen bent en voordat er een aangepast domein bestaat.

Achter de schermen heeft elke publieke route een preview-tegenhanger onder `/status-page/{statusPageId}/...` — een preview-overzicht, een preview-incidentenlijst, een preview-abonneepagina, enzovoort. Dat betekent dat een URL of screenshot van de dashboardpreview niet overeenkomt met wat een klant ziet zodra een aangepast domein gekoppeld is, dus controleer elke link die je in een runbook of e-mail plakt dubbel.

## Beperken wie de pagina kan zien

Niet elke statuspagina is voor het publiek. Alle bedieningselementen zitten onder de sectie **Security**.

### Privégebruikers

Zet **Is Visible to Public** uit op **Status Pages → jouw pagina → Security → Authentication Settings** (de kolom `isPublicStatusPage`). Bezoekers komen dan op `/login` terecht en moeten inloggen.

Voeg de mensen die mogen inloggen toe op **Status Pages → jouw pagina → Security → Private Users**. Er is een actie **Add in Bulk** — plak een lijst e-mailadressen en elk daarvan krijgt een uitnodigingsmail. Privégebruikers hebben hun eigen wachtwoord-vergeten- en wachtwoord-resetten-flow, los van je OneUptime-projectaccounts.

### Hoofdwachtwoord

**Authentication Settings** heeft ook een kaart **Master Password** met een schakelaar **Require Master Password** en het wachtwoord zelf. Bezoekers komen dan op `/master-password` terecht en ontgrendelen de pagina met één gedeeld geheim.

**Hoofdwachtwoord en privégebruikers stapelen niet.** Zolang het hoofdwachtwoord aan staat, is authenticatie van privégebruikers uitgeschakeld, en toont het scherm **Private Users** een banner die je dat vertelt.

### SSO en OIDC

Voor een private pagina gekoppeld aan je identity provider configureert **Status Pages → jouw pagina → Security → SSO** SAML (sign-on-URL, issuer, x509-certificaat, handtekening- en digest-methoden) en configureert **Status Pages → jouw pagina → Security → OIDC** OpenID Connect (discovery-URL, issuer, client-ID en -secret, scopes, claimnamen). **SCIM** provisioneert privégebruikers automatisch vanuit de IdP. Deze zijn afgeschermd achter een planfunctie, dus ze zijn mogelijk niet op elke installatie beschikbaar.

Een kaart **SSO Settings** toont **Force SSO for Login** (`requireSsoForLogin`, standaard uit). Test je SSO-configuratie voordat je hem aanzet — als het niet werkt, sluit je jezelf buiten de statuspagina.

### IP-whitelist

**Authentication Settings** heeft ook een kaart **IP Whitelist**, ondersteund door de kolom `ipWhitelist`, voor pagina's die alleen vanaf bekende netwerken mogen reageren.

## De insluitbare badge en de RSS-feed

Twee manieren om status ergens anders te tonen dan op de pagina zelf.

**Ingesloten statusbadge.** Zet **Enable Embedded Status Badge** (`enableEmbeddedOverallStatus`, standaard uit) aan in de kaart **Embedded Status Badge** op **Status Pages → jouw pagina → Advanced → Embedded Status**. Dit gaat samen met een `embeddedOverallStatusToken` en serveert de badge vanaf `/badge/:statusPageId`, zodat je de huidige algemene status in je documentatie, de voettekst van je app of een marketingpagina kunt plaatsen.

**RSS-feed.** Elke statuspagina serveert `/rss` — een feed getiteld "{status page name} Updates" waarvan de items voorafgegaan worden door `Incident: `, `Announcement: ` en `Scheduled Maintenance: `. Handig voor mensen die je updates liever in een reader of een chatbot laden dan zich per e-mail te abonneren.

Als je de data liever zelf ophaalt: de statuspagina wordt ondersteund door publieke leesendpoints voor het overzicht, incidenten, geplande onderhoudsgebeurtenissen, aankondigingen en episodes — zie [Public API](/docs/status-pages/public-api).

## Waar je hierna kunt lezen

- [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups) — monitoren op de pagina zetten en ze organiseren in secties.
- [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains) — logo, favicon, voettekst, aangepaste code, en je eigen domein aan de pagina koppelen.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — de vijf abonneekanalen, dubbele opt-in, en aankondigingen plaatsen.
- [Public API](/docs/status-pages/public-api) — programmatisch statuspaginadata lezen.
- [Incidenten – Overzicht](/docs/incidents/index) — de gebeurtenissen die op de pagina verschijnen.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat een incident op een statuspagina laat verschijnen en wat het er weer af haalt.
