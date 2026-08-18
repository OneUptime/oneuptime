# Incidenten – Overzicht

Een incident in OneUptime is het dossier waar je team zich omheen verzamelt zodra er iets stukgaat. Het draagt een nummer, een titel, een ernst, een huidige status, de middelen die het raakt, en alles wat je team tijdens de respons opschrijft — notities, hoofdoorzaak, herstelstappen en een alleen-toevoegen feed van wie wat deed.

Incidenten zijn wat een monitor die op rood springt verandert in een gecoördineerde respons. Er een melden paget de juiste mensen die piket hebben, voegt eigenaren toe die bij elke wijziging bericht krijgen, start runbooks en — als je dat wilt — zet de storing op je openbare statuspagina, zodat klanten geen tickets meer openen met de vraag of je het al weet.

Je kunt een incident om drie uur 's nachts met de hand melden, of een monitor het voor je laten melden zodra zijn criteria matchen. Hoe dan ook is het incident hetzelfde object, met dezelfde levenscyclus en achteraf hetzelfde papieren spoor.

## In één oogopslag

- **Een functie op het hoogste niveau** — **Incidenten** in de linkernavigatie van het dashboard, op `/dashboard/{projectId}/incidents`.
- **Drie voorgeconfigureerde statussen** — **Identified**, **Bevestigd** en **Opgelost** worden voor elk nieuw project aangemaakt. Je kunt er zelf bij zetten; de drie voorgeconfigureerde statussen kun je hernoemen en van kleur veranderen, maar nooit verwijderen.
- **Drie voorgeconfigureerde ernstniveaus** — **Critical Incident**, **Major Incident** en **Minor Incident**. Ernst is een label met een kleur en een volgorde — het draagt geen eigen gedrag.
- **Vier manieren naar binnen** — de wizard **Incident melden**, **Maken op basis van sjabloon**, een criteriaregel op een monitor, of `POST /api/incident`.
- **Genummerd per project** — elk incident krijgt een incidentnummer, standaard weergegeven als `#42` of met je eigen voorvoegsel, zoals `INC-42`.
- **Twee soorten notities** — privénotities (interne notities) voor je team, openbare notities voor abonnees van de statuspagina.
- **Instellingen staan onder Incidenten, niet onder Projectinstellingen** — statussen, ernstniveaus, sjablonen, aangepaste velden en de regelmotoren staan allemaal onder **Incidenten → Instellingen** en **Incidenten → Regels**.

## Kernbegrippen

Een handvol woorden komt op elke andere pagina in deze sectie terug. Zet die eerst op een rij.

| Begrip                 | Wat het betekent                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident**           | Het dossier zelf — titel, beschrijving, ernst, huidige status, getroffen middelen en alles wat er tijdens de respons op wordt geschreven.             |
| **Incidentstatus**     | Waar het incident in zijn levenscyclus staat. Een projectgebonden rij met een naam, kleur en `order`, plus de vlaggen die er betekenis aan geven.     |
| **Incidenternst**      | Hoe erg het is. Een projectgebonden rij met een naam, kleur en `order`. Puur een classificatie — niets in het product behandelt één ernst apart.      |
| **Incidentnummer**     | Een teller per project, getoond als `#42`, of met een voorvoegsel dat je instelt, als `INC-42`.                                                       |
| **Getroffen middelen** | De monitoren, hosts, Kubernetes-clusters, Docker-hosts, services en andere infrastructuur die je aan het incident koppelt.                            |
| **Openbare notitie**   | Een update geschreven voor lezers en abonnees van de statuspagina. Hij verschijnt op de tijdlijn van de statuspagina.                                 |
| **Privénotitie**       | Een interne notitie (het model `IncidentInternalNote`) voor het respondteam. Hij bereikt nooit een statuspagina.                                      |
| **Eigenaar**           | Een gebruiker of team dat verantwoordelijk is voor het incident. Eigenaren krijgen bericht bij aanmaak, bij nieuwe notities en bij statuswijzigingen. |
| **Incidentfeed**       | De alleen-toevoegen activiteitentijdlijn op het **Overzicht** van het incident, met statuswijzigingen, notities, eigenaarswijzigingen, regeluitvoeringen en meldingen. |
| **Statustijdlijn**     | Het verslag van in welke status het incident wanneer en hoe lang stond — met per overgang de meldingsstatus voor abonnees.                            |

## De drie statussen die OneUptime voor elk project aanmaakt

Wanneer een project wordt aangemaakt, zet OneUptime precies drie incidentstatussen klaar, in deze volgorde:

| Status           | Volgorde | Kleur              | Wat het betekent                                                            |
| ---------------- | -------- | ------------------ | --------------------------------------------------------------------------- |
| **Identified**   | 1        | Rood (`#fd625e`)   | De status waarin een gloednieuw incident belandt. Dit is de aangemaakt-status. |
| **Bevestigd**    | 2        | Geel (`#ffbf53`)   | Iemand heeft het incident opgepakt en werkt eraan.                          |
| **Opgelost**     | 3        | Groen (`#2ab57d`)  | Het incident is voorbij. Oplossen is wat het van je statuspagina afhaalt.   |

De namen zijn niet meer dan labels — wat het gedrag echt stuurt zijn drie booleans op de statusrij: `isCreatedState`, `isAcknowledgedState` en `isResolvedState`. Per project hoort maar één status elke vlag te dragen.

Dat onderscheid telt zwaarder dan het klinkt:

- `isCreatedState` bepaalt waar een nieuw incident begint. Wordt er bij het aanmaken geen status gekozen, dan zoekt OneUptime de aangemaakt-status van het project op en gebruikt die.
- `isAcknowledgedState` en `isResolvedState` sturen de knoppen **Acknowledge** en **Oplossen** in de incidentkop, de twee stat-tegels op het **Overzicht** van het incident, en de badge met de teller **Actieve incidenten** in het zijmenu.
- **Actieve incidenten** is puur gedefinieerd als "de huidige status is niet de opgeloste status". Elke eigen status die je toevoegt is dus actief, tenzij het de opgeloste is.

**Let op de naamgeving.** De eerste voorgeconfigureerde status heet **Identified**, ook al noemen verschillende beschrijvingen in het product hem nog de aangemaakt-status. Zoek je in de statuslijst van je project naar "Created", dan is dat de rij met de naam **Identified**.

Je voegt eigen statussen toe onder **Incidenten → Instellingen → Status incident**. Nieuwe statussen komen achteraan de geordende lijst en je kunt slepen om te herschikken. De drie gevlagde statussen kun je niet verwijderen — OneUptime blokkeert dat — maar je kunt ze wel hernoemen en van kleur veranderen, en daarom leest de UI statusnamen dynamisch uit.

Volgorde wordt afgedwongen, niet alleen getoond: een incident kan niet naar een status die eerder in de volgorde staat dan de huidige.

Alle details staan in [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

## De drie ernstniveaus die OneUptime voor elk project aanmaakt

Elk nieuw project krijgt ook drie ernstniveaus:

| Ernst                 | Volgorde | Kleur                     | Wat het betekent                                              |
| --------------------- | -------- | ------------------------- | ------------------------------------------------------------- |
| **Critical Incident** | 1        | Kastanjebruin (`#b70400`) | Zeer hoge klantimpact, vraagt om een onmiddellijke respons.   |
| **Major Incident**    | 2        | Rood (`#fd625e`)          | Aanzienlijke impact, meestal met een onmiddellijke respons.   |
| **Minor Incident**    | 3        | Geel (`#ffbf53`)          | Lage impact, meestal binnen werktijd afgehandeld.             |

De volledige voorgeconfigureerde beschrijvingen staan in [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

Ernstniveaus hebben `name`, `description`, `color` en `order` en verder niets. Er zijn geen vlaggen, en geen enkel codepad behandelt "Critical Incident" anders dan welke andere rij ook. Ernst is hoe mensen triëren, en je kunt erop matchen wanneer je bereikbaarheidsregels schrijft — maar een ernst kiezen paget op zichzelf niemand.

Ernstniveaus bewerk of voeg je toe onder **Incidenten → Instellingen → Ernst van incident**.

## Het leven van een incident

### 1. Het wordt gemeld

Vier routes leiden naar hetzelfde object:

- **Met de hand** — klik in de incidentenlijst op **Incident melden**. Dat opent de wizard **Nieuw incident melden**, vijf stappen lang: **Incidentdetails**, **Getroffen middelen**, **Incidentrollen**, **Bereikbaarheid**, **Meer**.
- **Vanuit een sjabloon** — klik op **Maken op basis van sjabloon** en kies een opgeslagen **Incident-sjabloon**. Sjablonen vullen titel, beschrijving, ernst, beginstatus, middelen, bereikbaarheidsbeleid, eigenaren en labels vooraf in.
- **Vanuit een monitor** — een criteriaregel op een monitor met de schakelaar "meld een incident" aan maakt het incident automatisch aan zodra de filters matchen. Titels en beschrijvingen ondersteunen daar `{{variable}}`-templating.
- **Via de API** — `POST /api/incident` met een API-sleutel. De server vult `declaredAt`, de aangemaakt-status en het incidentnummer voor je in.

Zie [Een incident melden](/docs/incidents/declaring-incidents) voor de rondleiding veld voor veld.

### 2. De juiste mensen horen het

Bij het aanmaken draait OneUptime de automatisering die je hebt ingericht: labelregels, bereikbaarheidsregels, eigenaarsregels en runbook-regels. Elk bereikbaarheidsbeleid dat aan het incident hangt — handmatig, vanuit een sjabloon of samengevoegd door een matchende bereikbaarheidsregel — wordt parallel uitgevoerd.

Eigenaren krijgen bericht per e-mail, sms, telefoon, push en WhatsApp, binnen de meldingsvoorkeuren van elke gebruiker. Heeft een incident helemaal geen eigenaren, dan valt de melding terug op de projecteigenaren in plaats van te verdwijnen.

Is het incident zichtbaar op een statuspagina en staan abonneemeldingen aan, dan horen abonnees het ook. Meldingen worden door een cron gestuurd die elke minuut draait, dus reken op tot ongeveer een minuut vertraging in plaats van directe verzending.

### 3. Je team werkt eraan

Responders bevestigen het incident, koppelen getroffen middelen, draaien runbooks, wijzen incidentrollen toe en schrijven op wat ze onderweg leren — privénotities voor het team, openbare notities voor klanten, plus de pagina's **Hoofdoorzaak** en **Herstel** zodra het beeld helderder wordt. Alles wat ze doen komt terecht in de **Incidentfeed** op de pagina **Overzicht**.

### 4. Het wordt opgelost

Klikken op **Oplossen** zet het incident in de opgeloste status, stempelt de statustijdlijn, stopt de duurklok en haalt het incident uit het actieve deel van elke statuspagina waarop het stond. Er hoeft verder niets te veranderen om dat te laten gebeuren — de vlag voor de opgeloste status is waar de statuspagina-query naar kijkt.

Daarna kun je een postmortem schrijven en die desgewenst op de statuspagina publiceren.

## Waar incidenten in het dashboard leven

Open **Incidenten** in de linkernavigatie. Het zijmenu is opgedeeld in secties:

| Sectie          | Wat je daar doet                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overzicht**   | **Alle incidenten** en **Actieve incidenten** — die laatste draagt een rode badge met het aantal incidenten dat niet in de opgeloste status staat.                        |
| **Episoden**    | Incident-episoden, een aparte groeperingsfunctie met eigen pagina's.                                                                                                      |
| **AI**          | **Onderzoek** en **Herstel** — instellingen voor automatisch onderzoek en automatisch herstel.                                                                            |
| **Werkruimte**  | **Slack**- en **Microsoft Teams**-verbindingen voor incidenten.                                                                                                          |
| **Regels**      | De regelmotoren: **Groeperingsregels**, **Bereikbaarheidsregels**, **Eigenaarsregels**, **Runbook-regels**, **Privacyregels**, **Labelregels**, **SLA-regels**, **Reminder Rules**. |
| **Instellingen**| **Status incident**, **Ernst van incident**, **Incident-sjablonen**, **Notitie-sjablonen**, **Postmortem-sjablonen**, **Aangepaste velden**, **Incidentrollen**, **Meer instellingen**. |

**Regels** en **Instellingen** zijn standaard ingeklapt — vouw ze uit om de pagina's te vinden waar de rest van deze documentatie naar verwijst. Incidentconfiguratie staat niet onder Projectinstellingen; het woont hier allemaal.

De incidentenlijst zelf toont **Incidentnummer**, **Titel**, **Status**, **Ernst**, **Getroffen middelen**, **Verklaard**, **Duur**, **Labels** en **Eigenaren**, met een bulkactie **Status wijzigen** om er meerdere tegelijk af te sluiten.

## Wat elke pagina op een incident toont

Open een incident en je krijgt links een zijmenu, zo gegroepeerd:

- **Overzicht** — de kaart **Incidentdetails** (titel, ernst, labels, incidentnummer, gemeld op, gemeld door, bereikbaarheidsbeleid), een kaart **Getroffen resources** en de **Incidentfeed**. Daarboven stat-tegels voor tijd tot bevestigen, tijd tot oplossen en de totale **Duur**.
- **Statustijdlijn** — elke status waarin het incident heeft gestaan, met **Begint op**, **Eindigt op**, **Duur** en per overgang de meldingsstatus voor abonnees. **Oorzaak bekijken** en **Logboeken bekijken** leggen uit waarom elke wijziging plaatsvond.
- **SLA** — SLA-bewaking voor dit incident.
- **Beschrijving**, **Hoofdoorzaak**, **Herstel** — drie markdown-pagina's. De beschrijving is degene die op je statuspagina verschijnt.
- **Runbooks** — runbook-uitvoeringen die aan dit incident hangen.
- **Postmortem** — de terugblik, die je desgewenst op de statuspagina publiceert.
- **Rollen**, **Bereikbaarheidsuitvoeringen**, **Eigenaren** — wie eraan werkt, welk beleid is afgegaan en wie bericht krijgt.
- **Meldingslogboeken**, **AI-logboeken**, **Auditlogboeken** — wat er is verstuurd en wat er is gewijzigd.
- **Privénotities** en **Openbare notities** — onder de sectie **Notities** van het zijmenu.
- **Aangepaste velden**, **Instellingen**, **Incident verwijderen** — onder **Geavanceerd**. De pagina **Instellingen** bevat **Zichtbaar op statuspagina**, **Privé-incident** en de kaart **Reminders**.

[Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) behandelt de samenwerkingspagina's in detail.

## Hoe incidenten passen bij de rest van OneUptime

- **Monitoren zien het probleem; incidenten leggen het vast.** Een criteriaregel op een monitor kan automatisch een incident melden en daarbij titel, ernst, bereikbaarheidsbeleid, eigenaren, labels en herstelnotities vooraf invullen. Zie [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating) voor de variabelen die daar beschikbaar zijn.
- **Bereikbaarheidsbeleid doet het pagen.** Koppel beleid in de stap **Bereikbaarheid** van de meldwizard, op een sjabloon, of via **Incidenten → Regels → Bereikbaarheidsregels**. Elke matchende regel gaat af — wat er draait is de vereniging van alle matches plus alles wat je direct hebt gekoppeld, ontdubbeld.
- **Runbooks vertellen mensen wat te doen.** Runbook-regels koppelen automatisch een procedure zodra er een matchend incident wordt aangemaakt, en responders kunnen er met de hand een starten vanaf het incident. Zie [Runbooks – Overzicht](/docs/runbooks/index).
- **Statuspagina's vertellen het klanten.** Een incident verschijnt in de actieve lijst van een statuspagina wanneer die pagina incidenten toont, het incident als zichtbaar op de statuspagina is gemarkeerd, en zijn huidige status niet de opgeloste status is. Privé-incidenten blijven altijd verborgen voor elke statuspagina. Zie [Statuspagina's – Overzicht](/docs/status-pages/index).
- **Workflows automatiseren eromheen.** Met de triggers **On Create Incident**, **On Update Incident** en **On Delete Incident** bouw je no-code-automatisering bovenop de incidentlevenscyclus. Zie [Workflows – Overzicht](/docs/workflows/index).

## Waar verder lezen

- [Een incident melden](/docs/incidents/declaring-incidents) — de wizard, sjablonen, monitorcriteria en de API.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — de statusvlaggen, eigen statussen en ernstclassificatie.
- [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) — openbare en privénotities, eigenaren en de activiteitenfeed.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — sjablonen, aangepaste velden, nummervoorvoegsels en de regelmotoren.
- [Statuspagina's – Overzicht](/docs/status-pages/index) — hoe incidenten je klanten bereiken.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie er bericht krijgt als een incident beweegt.
