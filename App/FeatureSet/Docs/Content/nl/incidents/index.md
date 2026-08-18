# Incidenten – Overzicht

Een incident in OneUptime is het record waar je team zich omheen verzamelt wanneer er iets stukgaat. Het draagt een nummer, een titel, een ernst, een huidige status, de middelen die het raakt, en alles wat je team tijdens de respons opschrijft — notities, hoofdoorzaak, herstelstappen, en een alleen-toevoegen-feed van wie wat deed.

Incidenten zijn wat een monitor die op rood springt omzet in een gecoördineerde respons. Er een melden paget de juiste piketrotatie, voegt eigenaren toe die over elke wijziging bericht krijgen, start runbooks, en — als je dat wilt — plaatst de storing op je publieke statuspagina zodat klanten stoppen met tickets openen om te vragen of je het al weet.

Je kunt een incident om 3 uur 's nachts met de hand melden, of een monitor het voor je laten melden zodra zijn criteria matchen. Hoe dan ook is het incident hetzelfde object, met dezelfde levenscyclus en hetzelfde papieren spoor aan het eind.

## In één oogopslag

- **Top-level feature** — **Incidenten** in de linkernavigatie van het dashboard, op `/dashboard/{projectId}/incidents`.
- **Drie voorgeconfigureerde statussen** — **Identified**, **Bevestigd** en **Opgelost** worden voor elk nieuw project aangemaakt. Je kunt er zelf aan toevoegen; de drie voorgeconfigureerde statussen kunnen worden hernoemd en van kleur veranderd, maar nooit verwijderd.
- **Drie voorgeconfigureerde ernstniveaus** — **Critical Incident**, **Major Incident** en **Minor Incident**. Ernst is een label met een kleur en een volgorde — het draagt geen gedrag van zichzelf.
- **Vier manieren om binnen te komen** — de wizard **Incident melden**, **Maken op basis van sjabloon**, een monitor-criteriaregel, of `POST /api/incident`.
- **Genummerd per project** — elk incident krijgt een incidentnummer, standaard weergegeven als `#42` of met je eigen voorvoegsel, zoals `INC-42`.
- **Twee soorten notities** — privénotities (interne notities) voor je team, openbare notities voor abonnees van de statuspagina.
- **Instellingen staan onder Incidenten, niet onder Projectinstellingen** — statussen, ernstniveaus, sjablonen, aangepaste velden en de regel-engines staan allemaal onder **Incidenten → Instellingen** en **Incidenten → Regels**.

## Kernbegrippen

Een handvol woorden komt op elke andere pagina in deze sectie terug. Krijg deze eerst helder.

| Term                     | Betekenis                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident**             | Het record zelf — titel, beschrijving, ernst, huidige status, getroffen middelen, en alles wat er tijdens de respons op geschreven wordt.            |
| **Incidentstatus**       | Waar het incident zich in zijn levenscyclus bevindt. Een projectgebonden rij met een naam, kleur en `order`, plus de vlaggen die er betekenis aan geven. |
| **Incident-ernst**       | Hoe erg het is. Een projectgebonden rij met een naam, kleur en `order`. Puur een classificatie — niets in het product behandelt één ernst apart.     |
| **Incidentnummer**       | Een teller per project, weergegeven als `#42`, of met een voorvoegsel dat je configureert, als `INC-42`.                                             |
| **Getroffen middelen**   | De monitoren, hosts, Kubernetes-clusters, Docker-hosts, services en andere infrastructuur die je aan het incident koppelt.                           |
| **Openbare notitie**     | Een update geschreven voor lezers en abonnees van de statuspagina. Hij verschijnt op de tijdlijn van de statuspagina.                                |
| **Privénotitie**         | Een interne notitie (het `IncidentInternalNote`-model) voor het responsteam. Hij bereikt nooit een statuspagina.                                     |
| **Eigenaar**             | Een gebruiker of team dat verantwoordelijk is voor het incident. Eigenaren krijgen bericht bij aanmaak, bij geplaatste notities en bij statuswijzigingen. |
| **Incidentfeed**         | De alleen-toevoegen-activiteitentijdlijn op het **Overzicht** van het incident, met statuswijzigingen, notities, eigenaarswijzigingen, regeluitvoeringen en meldingen. |
| **Statustijdlijn**       | Het record van in welke status het incident zat, wanneer en hoe lang — met de meldingsstatus voor abonnees bij elke overgang.                        |

## De drie statussen die OneUptime voor elk project aanmaakt

Wanneer een project wordt aangemaakt, maakt OneUptime precies drie incidentstatussen aan, in deze volgorde:

| Status           | Volgorde | Kleur              | Betekenis                                                                        |
| ---------------- | -------- | ------------------ | -------------------------------------------------------------------------------- |
| **Identified**   | 1        | Rood (`#fd625e`)   | De status waarin een gloednieuw incident belandt. Dit is de aangemaakt-status.   |
| **Bevestigd**    | 2        | Geel (`#ffbf53`)   | Iemand heeft het incident opgepakt en werkt eraan.                               |
| **Opgelost**     | 3        | Groen (`#2ab57d`)  | Het incident is voorbij. Oplossen is wat het van je statuspagina afhaalt.        |

De namen zijn slechts labels — wat het gedrag daadwerkelijk stuurt zijn drie booleans op de statusrij: `isCreatedState`, `isAcknowledgedState` en `isResolvedState`. Er wordt verwacht dat per project maar één status elke vlag draagt.

Dat onderscheid is belangrijker dan het klinkt:

- `isCreatedState` bepaalt waar een nieuw incident begint. Als er bij aanmaak geen status expliciet is geselecteerd, zoekt OneUptime de aangemaakt-status van het project op en gebruikt die.
- `isAcknowledgedState` en `isResolvedState` sturen de knoppen **Acknowledge** en **Oplossen** in de incidentkop, de twee stat-tegels op het **Overzicht** van het incident, en de teller-badge **Actieve incidenten** in het zijmenu.
- **Actieve incidenten** is puur gedefinieerd als "de huidige status is niet de opgeloste status". Elke eigen status die je toevoegt is dus actief, tenzij het de opgeloste is.

**Let op de naamgeving.** De eerste voorgeconfigureerde status heet **Identified**, ook al noemen verschillende beschrijvingen in het product hem nog de aangemaakt-status. Als je in de statuslijst van je project zoekt naar "Created", dan is dat de rij met de naam **Identified**.

Je kunt eigen statussen toevoegen bij **Incidenten → Instellingen → Status incident**. Nieuwe statussen worden achteraan de geordende lijst toegevoegd en je kunt slepen om ze te herschikken. De drie gevlagde statussen kunnen niet worden verwijderd — OneUptime blokkeert dat — maar je kunt ze hernoemen en van kleur veranderen, en daarom leest de UI statusnamen dynamisch uit.

Volgorde wordt afgedwongen, niet cosmetisch: een incident kan niet naar een status die eerder in de volgorde staat dan de huidige.

De volledige details staan in [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

## De drie ernstniveaus die OneUptime voor elk project aanmaakt

Elk nieuw project krijgt ook drie ernstniveaus:

| Ernst                 | Volgorde | Kleur                | Betekenis                                                          |
| --------------------- | -------- | -------------------- | ------------------------------------------------------------------ |
| **Critical Incident** | 1        | Kastanjebruin (`#b70400`) | Zeer hoge klantimpact, vraagt om een onmiddellijke respons.   |
| **Major Incident**    | 2        | Rood (`#fd625e`)     | Aanzienlijke impact, vraagt meestal om een onmiddellijke respons.  |
| **Minor Incident**    | 3        | Geel (`#ffbf53`)     | Lage impact, meestal binnen werktijd afgehandeld.                  |

De volledige voorgeconfigureerde beschrijvingen staan in [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

Ernstniveaus hebben `name`, `description`, `color` en `order` en verder niets. Er zijn geen vlaggen, en geen enkel codepad behandelt "Critical Incident" anders dan welke andere rij ook. Ernst is hoe mensen triage doen, en het is beschikbaar als matchcriterium wanneer je piketregels schrijft — maar een ernst kiezen paget op zichzelf niemand.

Bewerk of voeg ernstniveaus toe bij **Incidenten → Instellingen → Ernst van incident**.

## Het leven van een incident

### 1. Het wordt gemeld

Vier routes leiden naar hetzelfde object:

- **Met de hand** — klik in de incidentenlijst op **Incident melden**. Dat opent de wizard **Nieuw incident melden**, vijf stappen lang: **Incidentdetails**, **Getroffen middelen**, **Incidentrollen**, **Bereikbaarheid**, **Meer**.
- **Vanuit een sjabloon** — klik op **Maken op basis van sjabloon** en kies een opgeslagen **Incident-sjabloon**. Sjablonen vullen titel, beschrijving, ernst, beginstatus, middelen, bereikbaarheidsbeleid, eigenaren en labels alvast in.
- **Vanuit een monitor** — een monitor-criteriaregel met de schakelaar "declare an incident" aan maakt het incident automatisch aan zodra zijn filters matchen. Titels en beschrijvingen ondersteunen daar `{{variable}}`-templating.
- **Via de API** — `POST /api/incident` met een API-sleutel. De server vult `declaredAt`, de aangemaakt-status en het incidentnummer voor je in.

Zie [Een incident melden](/docs/incidents/declaring-incidents) voor de veld-voor-veld-doorloop.

### 2. De juiste mensen komen het te weten

Bij aanmaak draait OneUptime de automatisering die je hebt geconfigureerd: labelregels, bereikbaarheidsregels, eigenaarsregels en runbook-regels. Alle piketbeleidsregels die aan het incident hangen — handmatig, vanuit een sjabloon, of samengevoegd door een matchende bereikbaarheidsregel — worden parallel uitgevoerd.

Eigenaren krijgen bericht per e-mail, sms, telefoon, push en WhatsApp, afhankelijk van de eigen meldingsvoorkeuren van elke gebruiker. Heeft een incident helemaal geen eigenaren, dan valt de melding terug op de projecteigenaren in plaats van te verdwijnen.

Als het incident zichtbaar is op een statuspagina en abonneemeldingen aan staan, krijgen abonnees het ook te horen. Meldingen zijn cron-gestuurd en draaien elke minuut, dus reken op ongeveer een minuut vertraging in plaats van directe verzending.

### 3. Je team werkt eraan

Responders bevestigen het incident, koppelen getroffen middelen, draaien runbooks, wijzen incidentrollen toe en schrijven dingen op zodra ze die leren — privénotities voor het team, openbare notities voor klanten, plus de pagina's **Hoofdoorzaak** en **Herstel** wanneer het beeld helderder wordt. Alles wat ze doen belandt in de **Incidentfeed** op de pagina **Overzicht**.

### 4. Het wordt opgelost

Op **Oplossen** klikken verplaatst het incident naar de opgeloste status, stempelt de statustijdlijn, stopt de duurklok en haalt het incident uit de actieve sectie van elke statuspagina waar het op stond. Er hoeft niets anders te veranderen om dat te laten gebeuren — de opgelost-statusvlag is waar de statuspagina-query naar kijkt.

Daarna kun je een postmortem schrijven en die desgewenst op de statuspagina publiceren.

## Waar incidenten in het dashboard leven

Open **Incidenten** in de linkernavigatie. Het zijmenu is opgedeeld in secties:

| Sectie            | Wat je daar doet                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overzicht**     | **Alle incidenten** en **Actieve incidenten** — die laatste draagt een rode badge met het aantal incidenten dat niet in de opgeloste status staat.                   |
| **Episoden**      | Incidentepisoden, een aparte groeperingsfunctie met eigen pagina's.                                                                                                  |
| **AI**            | **Onderzoek** en **Herstel** — instellingen voor automatisch onderzoek en automatisch herstel.                                                                       |
| **Werkruimte**    | **Slack**- en **Microsoft Teams**-verbindingen voor incidenten.                                                                                                     |
| **Regels**        | De regel-engines: **Groeperingsregels**, **Bereikbaarheidsregels**, **Eigenaarsregels**, **Runbook-regels**, **Privacyregels**, **Labelregels**, **SLA-regels**, **Reminder Rules**. |
| **Instellingen**  | **Status incident**, **Ernst van incident**, **Incident-sjablonen**, **Notitie-sjablonen**, **Postmortem-sjablonen**, **Aangepaste velden**, **Incidentrollen**, **Meer instellingen**. |

**Regels** en **Instellingen** zijn standaard ingeklapt — vouw ze uit om de pagina's te vinden waar de rest van deze docs naar verwijst. Incidentconfiguratie staat niet onder Projectinstellingen; alles staat hier.

De incidentenlijst zelf toont **Incidentnummer**, **Titel**, **Status**, **Ernst**, **Getroffen middelen**, **Verklaard**, **Duur**, **Labels** en **Eigenaren**, met een bulkactie **Status wijzigen** om er meerdere tegelijk af te sluiten.

## Wat elke pagina op een incident toont

Open een incident en je krijgt een zijmenu links, zo gegroepeerd:

- **Overzicht** — de kaart **Incidentdetails** (titel, ernst, labels, incidentnummer, gemeld op, gemeld door, bereikbaarheidsbeleid), een kaart **Getroffen middelen**, en de **Incidentfeed**. Daarboven stat-tegels voor tijd tot bevestiging, tijd tot oplossing en totale **Duur**.
- **Statustijdlijn** — elke status waarin het incident heeft gezeten, met **Begint op**, **Eindigt op**, **Duur** en de meldingsstatus voor abonnees bij elke overgang. **Oorzaak bekijken** en **Logboeken bekijken** leggen uit waarom elke wijziging plaatsvond.
- **SLA** — SLA-tracking voor dit incident.
- **Beschrijving**, **Hoofdoorzaak**, **Herstel** — drie markdownpagina's. De beschrijving is degene die op je statuspagina verschijnt.
- **Runbooks** — runbook-uitvoeringen die aan dit incident hangen.
- **Postmortem** — het verslag, dat je desgewenst op de statuspagina kunt publiceren.
- **Rollen**, **Bereikbaarheidsuitvoeringen**, **Eigenaren** — wie eraan werkt, welke beleidsregels afgingen, en wie bericht krijgt.
- **Meldingslogboeken**, **AI-logboeken**, **Auditlogboeken** — wat er verstuurd is en wat er gewijzigd is.
- **Privénotities** en **Openbare notities** — onder de sectie **Notities** van het zijmenu.
- **Aangepaste velden**, **Instellingen**, **Incident verwijderen** — onder **Geavanceerd**. De pagina **Instellingen** bevat **Zichtbaar op statuspagina**, **Privé-incident** en de kaart **Reminders**.

[Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) behandelt de samenwerkingspagina's diepgaand.

## Hoe incidenten passen bij de rest van OneUptime

- **Monitoren zien het probleem; incidenten leggen het vast.** Een monitor-criteriaregel kan automatisch een incident melden en daarbij titel, ernst, bereikbaarheidsbeleid, eigenaren, labels en herstelnotities alvast invullen. Zie [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating) voor de variabelen die daar beschikbaar zijn.
- **Piketbeleid doet het pagen.** Koppel beleidsregels in de stap **Bereikbaarheid** van de meldwizard, op een sjabloon, of via **Incidenten → Regels → Bereikbaarheidsregels**. Elke matchende regel gaat af — de uitgevoerde set is de vereniging van alle matches plus alles wat direct gekoppeld is, ontdubbeld.
- **Runbooks vertellen mensen wat ze moeten doen.** Runbook-regels koppelen automatisch een procedure wanneer een matchend incident wordt aangemaakt, en responders kunnen er met de hand een starten vanuit het incident. Zie [Runbooks – Overzicht](/docs/runbooks/index).
- **Statuspagina's vertellen het klanten.** Een incident verschijnt in de actieve lijst van een statuspagina wanneer de pagina incidenten aan heeft staan, het incident als zichtbaar op de statuspagina is gemarkeerd, en de huidige status niet de opgeloste status is. Privé-incidenten zijn altijd verborgen voor elke statuspagina. Zie [Statuspagina's – Overzicht](/docs/status-pages/index).
- **Workflows automatiseren eromheen.** Met de triggers **On Create Incident**, **On Update Incident** en **On Delete Incident** bouw je no-code-automatisering bovenop de incidentlevenscyclus. Zie [Workflows – Overzicht](/docs/workflows/index).

## Waar verder lezen

- [Een incident melden](/docs/incidents/declaring-incidents) — de wizard, sjablonen, monitor-criteria en de API.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — de statusvlaggen, eigen statussen en ernstclassificatie.
- [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) — openbare en privénotities, eigenaren, en de activiteitenfeed.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — sjablonen, aangepaste velden, nummervoorvoegsels en de regel-engines.
- [Statuspagina's – Overzicht](/docs/status-pages/index) — hoe incidenten je klanten bereiken.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie bericht krijgt wanneer een incident verschuift.
