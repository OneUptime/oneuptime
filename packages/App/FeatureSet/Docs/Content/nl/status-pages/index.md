# Statuspagina's – Overzicht

Een statuspagina is het publieke gezicht van alles wat je monitort: één URL die je klanten kunnen openen in plaats van je te mailen met de vraag of het aan hen ligt. Ze toont de huidige toestand van de diensten die je wilt tonen, de incidenten waaraan je werkt, het onderhoud dat je hebt gepland, en elke aankondiging die je bovenaan wilt vastzetten.

Gaat er om 02:00 uur iets stuk, dan is de statuspagina het eerste waar je supportkanaal naar linkt. Het is ook de plek van waaruit je abonnees hun meldingen krijgen — dus je richt hem beter in vóórdat je hem nodig hebt, niet tijdens de storing.

Statuspagina's staan onder **Statuspagina's** in de linkernavigatie van het dashboard, in de groep **essentials**. Alles op deze pagina geldt per statuspagina: een project mag er zoveel draaien als het wil — een publieke voor klanten, een private voor een intern publiek, een per regio voor een specifieke markt.

## In het kort

- **Aangemaakt met twee velden.** Een nieuwe statuspagina vraagt alleen om **Naam** en **Beschrijving**. Resources, huisstijl en domeinen richt je daarna in.
- **Resources zijn wat bezoekers zien.** Elke rij op de pagina is een **Statuspagina Bron** — een monitor (of monitorgroep) met een eigen weergavenaam, tooltip en uptime-opties. Groepen splitsen een lange pagina in secties en kunnen genest worden.
- **Vanaf dag één een preview-URL.** Elke statuspagina krijgt een previewlink, zodat je hem kunt bekijken voordat er een eigen domein bestaat.
- **Routes voor bezoekers hangen aan instellingen.** Incidenten, aankondigingen, geplande gebeurtenissen en de abonneepagina verschijnen elk alleen wanneer hun schakelaar op **Geavanceerde instellingen** aan staat.
- **Drie manieren om hem privé te maken.** Privégebruikers, een hoofdwachtwoord, of SAML SSO / OIDC — plus een IP-whitelist.
- **Abonnees krijgen automatisch bericht.** Abonnees via e-mail, sms, Slack, Microsoft Teams en webhook kunnen allemaal een pagina volgen, elk kanaal achter zijn eigen schakelaar.

## Kernbegrippen

| Begrip                | Wat het betekent                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Statuspagina**   | Eén publieke (of private) pagina, met een eigen huisstijl, domeinen, resources en abonnees. Het model `StatusPage`.                  |
| **Resource**      | Eén rij die bezoekers zien — een monitor of monitorgroep op de pagina, met een weergavenaam en uptime-opties.                        |
| **Groep**         | Een benoemde sectie die resources bevat. Groepen nestelen in andere groepen, en elk niveau vat de status van alles eronder samen.    |
| **Aankondiging**  | Een bericht dat je op een of meer statuspagina's plaatst, met een starttijd en een optionele eindtijd.                               |
| **Abonnee**    | Iemand (of iets) dat de pagina volgt via e-mail, sms, Slack, Microsoft Teams of een webhook.                                         |
| **Aangepast domein** | Een domein van jezelf — `status.example.com` — dat je met een CNAME en een SSL-certificaat op de pagina richt.                     |
| **Privégebruiker**  | Een account dat kan inloggen op een private statuspagina. Los van de projectgebruikers in OneUptime.                                |

## Een statuspagina aanmaken

1. Open **Statuspagina's → Alle statuspagina's** en klik op **Statuspagina maken**.
2. Vul in de modal **Create New Status Page** de **Naam** in (verplicht, minstens twee tekens) en eventueel een **Beschrijving**.
3. Klik op **Statuspagina maken**.

Dat is het hele aanmaakformulier. De lijst waarop je terugkomt toont **Naam**, **Beschrijving**, **Labels** en **Eigenaren**, en is te filteren op **Statuspagina-ID**, **Naam** en **Beschrijving**.

Open je de nieuwe pagina, dan land je op het scherm **Overzicht**, met twee kaarten: **Status Page Preview URL** met een link naar de pagina zelf, en **Statuspaginadetails** waar je de naam, beschrijving en labels bewerkt die je zojuist hebt gezet.

Daarna, ruwweg op volgorde van nut:

- Voeg resources toe zodat er iets op de pagina staat — zie [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups).
- Stel de paginatitel, favicon, logo en omslag in en koppel er een eigen domein aan — zie [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains).
- Bepaal op welke kanalen mensen zich kunnen abonneren — zie [Abonnees en aankondigingen](/docs/status-pages/subscribers).
- Stem onder **Geavanceerde instellingen** af wat er op de pagina verschijnt.

## Waar alles staat

Zodra een statuspagina open is, heeft die zijn eigen linkerzijmenu, verdeeld over negen secties. Gebruik dit als kaart voor de rest van deze documentatiegroep.

| Sectie                | Wat erin zit                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basis**             | **Overzicht**, **Aankondigingen**, **Eigenaren**.                                                                                              |
| **Middelen**          | Eén scherm **Middelen** — groepen links, de monitoren van de geselecteerde groep rechts.                                                        |
| **Abonnees**          | **E-mail-abonnees**, **SMS-abonnees**, **Slack-abonnees**, **MS Teams-abonnees**, **Webhook-abonnees**, **Abonneeinstellingen**.               |
| **Meldingslogboeken** | **Meldingslogboeken** — wat er naar abonnees is gestuurd.                                                                                       |
| **Audit**             | **Auditlogboeken**.                                                                                                                            |
| **Huisstijl**         | **Essentiële branding**, **HTML, CSS & JavaScript**, **Aangepaste domeinen**, **Koptekst**, **Voettekst**, **Overzichtspagina**, **Talen**.    |
| **Beveiliging**       | **Privégebruikers**, **SSO**, **OIDC**, **SCIM**, **Authenticatie-instellingen**.                                                              |
| **AI**                | **MCP**.                                                                                                                                       |
| **Geavanceerd**       | **Monitor Rules**, **Ingesloten status**, **Rapporten**, **Aangepaste velden**, **Geavanceerde instellingen**, **Statuspagina verwijderen**.   |

Twee eigenaardigheden in de naamgeving, goed om te weten voordat je gaat zoeken:

- Het item **Middelen** heet alleen **Middelen** wanneer monitorgroepen in het project aan staan. Anders leest het **Monitoren**. Het is hoe dan ook hetzelfde scherm.
- Er is geen aparte pagina voor groepen. Groepen en resources zijn samengevoegd, en de oude route `/groups` leidt nu door naar het resources-scherm.

Buiten een afzonderlijke pagina heeft de sectie **Statuspagina's** zelf nog een sectie **Meer** met **Aankondigingen**, en een ingeklapte sectie **Instellingen** met **Aankondigings-sjablonen**, **Abonnee-sjablonen**, **Aangepaste velden**, **Eigenaarsregels** en **Labelregels** — die zijn projectbreed en worden door alle statuspagina's gedeeld.

## Wat bezoekers zien

De publieke pagina is een app op zichzelf, met een beperkt aantal routes:

- `/` — het **Overzicht**.
- `/incidents` en `/incidents/:id` — de incidentenlijst en een afzonderlijk incident.
- `/announcements` en `/announcements/:id`.
- `/scheduled-events` en `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — de feed.
- `/login`, `/sso` en `/master-password` — alleen relevant op een private pagina.

De bovenste navigatiebalk toont altijd **Overzicht**; de rest verschijnt alleen wanneer je het inschakelt. **Incidenten**, **Aankondigingen** en **Geplande gebeurtenissen** hebben elk hun eigen schakelaar nodig; **Abonneren** vereist zowel **Abonneepagina weergeven** als minstens één ingeschakeld abonneekanaal. Een private pagina krijgt daarnaast een item **Uitloggen**.

### De overzichtspagina

Het overzicht is de pagina die de meeste bezoekers ooit te zien krijgen. Van boven naar beneden rendert die:

1. **Lopende aankondigingen** — aankondigingen waarvan de starttijd voorbij is en de eindtijd nog niet.
2. **Een algemene statusbanner** — één regel die samenvat of alle of slechts sommige resources geraakt zijn.
3. **Een totaal uptimepercentage**, als je dat hebt aangezet. Standaard uit.
4. **De resourcegroepen**, elk met hun resources, hun huidige status en hun uptime-geschiedenisbalken.
5. **Actieve incidenten**.
6. **Geplande onderhoudsgebeurtenissen**.

Een gloednieuwe pagina zonder inhoud toont een lege staat die je vraagt resources toe te voegen vanuit het dashboard — je teken om naar het scherm **Middelen** te gaan.

Voor wat een incident überhaupt op deze pagina zet, en wat het er weer af haalt, zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

## Kiezen wat er op de pagina komt

De meeste weergaveschakelaars zitten op één plek: **Statuspagina's → jouw pagina → Geavanceerd → Geavanceerde instellingen**. Elke kaart heeft een eigen knop **Edit Settings**.

**Incidentinstellingen**:

- **Incidenten weergeven** (`showIncidentsOnStatusPage`) — standaard aan. Zet je dit uit, dan verdwijnt ook het navigatie-item **Incidenten**.
- **Incidentgeschiedenis weergeven (in dagen)** (`showIncidentHistoryInDays`) — hoe ver de incidentenlijst terugkijkt. Standaard 14.
- **Incidentlabels weergeven** (`showIncidentLabelsOnStatusPage`) — standaard uit.

**Episode-instellingen** — dezelfde drie schakelaars voor incident-episodes: **Episoden weergeven** (`showEpisodesOnStatusPage`, standaard aan), **Episodegeschiedenis weergeven (in dagen)** (standaard 14) en **Episodelabels weergeven** (standaard uit). Episodes zijn een eigen model met eigen endpoints, geen weergave van incidenten.

**Aankondigingsinstellingen**:

- **Aankondigingen weergeven** (`showAnnouncementsOnStatusPage`) — standaard aan.
- **Aankondigingsgeschiedenis weergeven (in dagen)** (`showAnnouncementHistoryInDays`) — standaard 14.

**Instellingen voor geplande gebeurtenis**:

- **Geplande onderhoudsgebeurtenissen weergeven** (`showScheduledMaintenanceEventsOnStatusPage`) — standaard aan.
- **Geschiedenis van geplande gebeurtenissen weergeven (in dagen)** (`showScheduledEventHistoryInDays`) — standaard 14.
- **Gebeurtenislabels weergeven** (`showScheduledEventLabelsOnStatusPage`) — standaard uit.

**Instellingen uptime-geschiedenis**:

- **Uptimegeschiedenis weergeven (in dagen)** (`showUptimeHistoryInDays`) — de lengte van de uptimebalk naast elke resource. Standaard 90, en moet tussen 1 en 90 liggen. Elke optie **Uptime % weergeven** en **Statusgeschiedenisgrafiek weergeven** op een resource of groep leest dit getal.

**Abonneeinstellingen**:

- **Abonneepagina weergeven** (`showSubscriberPageOnStatusPage`) — standaard aan, plus de vijf schakelaars per kanaal. Diezelfde kanaalschakelaars staan ook op het aparte scherm **Abonneeinstellingen** onder de sectie **Abonnees**; behandel dat scherm als de canonieke plek om ze te zetten.

**Aangedreven door OneUptime-branding**:

- **Verberg 'Powered By OneUptime'-branding** — standaard uit, dus de voettekst voor bezoekers leest "Powered by OneUptime" totdat je dit aanzet.

**Waar de kleuren zitten.** De kleuren van de uptimebalk staan hier niet — de **Standaard balkkleur**, de balkkleurregels, de **Downtime-monitorstatussen** en **Totaal uptimepercentage weergeven** staan allemaal op **Statuspagina's → jouw pagina → Huisstijl → Overzichtspagina**. Er is nergens een instelling voor thema of merkkleur; alles buiten die bedieningselementen doe je met **Aangepaste CSS**.

## Vooraf bekijken voordat je live gaat

Het scherm **Overzicht** van elke statuspagina bevat een kaart **Status Page Preview URL** met een link rechtstreeks naar de pagina. Gebruik die terwijl je nog resources toevoegt en er nog geen eigen domein bestaat.

Achter de schermen heeft elke publieke route een preview-tweelingbroer onder `/status-page/{statusPageId}/...` — een preview-overzicht, een preview-incidentenlijst, een preview-abonneepagina, enzovoort. Dat betekent dat een URL of screenshot uit de dashboardpreview niet overeenkomt met wat een klant ziet zodra er een eigen domein aan hangt, dus controleer elke link die je in een runbook of een e-mail plakt.

## Beperken wie de pagina mag zien

Niet elke statuspagina is voor het publiek. Alle bedieningselementen zitten onder de sectie **Beveiliging**.

### Privégebruikers

Zet **Is zichtbaar voor publiek** uit op **Statuspagina's → jouw pagina → Beveiliging → Authenticatie-instellingen** (de kolom `isPublicStatusPage`). Bezoekers komen dan op `/login` terecht en moeten inloggen.

Voeg de mensen die mogen inloggen toe op **Statuspagina's → jouw pagina → Beveiliging → Privégebruikers**. Er is een actie **In bulk toevoegen** — plak een lijst met e-mailadressen en elk adres krijgt een uitnodigingsmail. Privégebruikers hebben hun eigen wachtwoord-vergeten- en resetflow, los van je OneUptime-projectaccounts.

### Hoofdwachtwoord

**Authenticatie-instellingen** heeft ook een kaart **Hoofdwachtwoord** met een schakelaar **Hoofdwachtwoord vereisen** en het wachtwoord zelf. Bezoekers komen dan op `/master-password` en ontgrendelen de pagina met één gedeeld geheim.

**Hoofdwachtwoord en privégebruikers stapelen niet.** Zolang het hoofdwachtwoord aan staat, is authenticatie met privégebruikers uitgeschakeld, en het scherm **Privégebruikers** toont een banner die je dat vertelt.

### SSO en OIDC

Voor een private pagina die aan je identity provider hangt, configureer je op **Statuspagina's → jouw pagina → Beveiliging → SSO** de SAML-kant (sign-on-URL, issuer, x509-certificaat, handtekening- en digestmethoden) en op **Statuspagina's → jouw pagina → Beveiliging → OIDC** de OpenID Connect-kant (discovery-URL, issuer, client-ID en secret, scopes, claimnamen). **SCIM** provisioneert privégebruikers automatisch vanuit de IdP. Dit hangt achter een planfunctie, dus het is niet op elke installatie beschikbaar.

Een kaart **SSO-instellingen** bevat **SSO afdwingen voor inloggen** (`requireSsoForLogin`, standaard uit). Test je SSO-configuratie voordat je dit aanzet — werkt het niet, dan sluit je jezelf buiten je eigen statuspagina.

### IP-whitelist

**Authenticatie-instellingen** draagt ook een kaart **IP-whitelist**, gevoed door de kolom `ipWhitelist`, voor pagina's die alleen vanuit bekende netwerken mogen antwoorden.

## De insluitbare badge en de RSS-feed

Twee manieren om status ergens anders te tonen dan op de pagina zelf.

**Ingesloten statusbadge.** Zet **Ingesloten statusbadge inschakelen** (`enableEmbeddedOverallStatus`, standaard uit) aan in de kaart **Ingesloten statusbadge** op **Statuspagina's → jouw pagina → Geavanceerd → Ingesloten status**. Die werkt samen met een `embeddedOverallStatusToken` en serveert de badge vanaf `/badge/:statusPageId`, zodat je de huidige totaalstatus in je documentatie, de voettekst van je app of een marketingpagina kunt zetten.

**RSS-feed.** Elke statuspagina serveert `/rss` — een feed met de titel "{status page name} Updates" waarvan de items het voorvoegsel `Incident: `, `Announcement: ` of `Scheduled Maintenance: ` dragen. Handig voor mensen die je updates liever in een reader of een chatbot laten binnenlopen dan zich per e-mail te abonneren.

Wil je de data liever zelf ophalen, dan wordt de statuspagina gevoed door publieke leesendpoints voor het overzicht, incidenten, geplande onderhoudsgebeurtenissen, aankondigingen en episodes — zie [Publieke API](/docs/status-pages/public-api).

## Waar je hierna kunt lezen

- [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups) — monitoren op de pagina zetten en ze in secties ordenen.
- [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains) — logo, favicon, voettekst, eigen code, en je eigen domein op de pagina richten.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — de vijf abonneekanalen, dubbele opt-in en het plaatsen van aankondigingen.
- [Publieke API](/docs/status-pages/public-api) — statuspaginadata programmatisch uitlezen.
- [Incidenten – Overzicht](/docs/incidents/index) — de gebeurtenissen die op de pagina belanden.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat een incident op een statuspagina zet en wat het er weer af haalt.
