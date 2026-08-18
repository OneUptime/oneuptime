# Instellingen en automatisering

Incidentconfiguratie staat niet bij de projectinstellingen. Ze staat in het productgebied Incidenten zelf, onder **Incidenten → Instellingen** en **Incidenten → Regels**, op routes die beginnen met `/dashboard/{projectId}/incidents/settings/`. Heb je **Projectinstellingen** afgezocht op incidentsjablonen of aangepaste velden — dat is waarom je ze niet vond.

Zowel de sectie **Regels** als de sectie **Instellingen** van het zijmenu Incidenten is standaard ingeklapt, dus je moet ze uitvouwen voordat de items hieronder verschijnen. Alles hier is projectgebonden: sjablonen, rollen, aangepaste velden en regels horen bij één project en gelden voor elk incident dat daarin wordt gemeld.

Deze pagina is de referentie voor die configuratie — wat er op elke pagina staat, en welk deel ervan automatisch draait zodra een incident wordt aangemaakt.

## Waar de incidentinstellingen staan

Open **Incidenten** in de linkernavigatie en vouw onderaan het zijmenu **Instellingen** uit.

| Pagina                   | Wat je daar doet                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| **Status incident**      | Statussen die een incident doorloopt toevoegen, hernoemen, verkleuren en herschikken.        |
| **Ernst van incident**   | Ernstniveaus toevoegen, hernoemen, verkleuren en herschikken.                                |
| **Incident-sjablonen**   | Een heel incident vooraf invullen — titel, beschrijving, resources, bereikbaarheidsbeleid, eigenaren, labels. |
| **Notitie-sjablonen**    | Herbruikbare tekst voor openbare en privénotities.                                           |
| **Postmortem-sjablonen** | Herbruikbare postmortemstructuren.                                                           |
| **Aangepaste velden**    | Extra velden definiëren die op elk incident verschijnen.                                     |
| **Incidentrollen**       | De rollen definiëren waaraan je responders toewijst, zoals Incident Commander.               |
| **Meer instellingen**    | De nummervoorvoegsels voor incidenten en incident-episodes.                                  |

**Status incident** en **Ernst van incident** worden uitgebreid behandeld in [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — de rest van deze pagina pakt de draad op bij **Incident-sjablonen**.

Vouw **Regels** uit en je krijgt acht pagina's erbij: **Groeperingsregels**, **Bereikbaarheidsregels**, **Eigenaarsregels**, **Runbook-regels**, **Privacyregels**, **Labelregels**, **SLA-regels** en **Reminder Rules**. Die komen verderop aan bod.

## Incidentsjablonen

Een incidentsjabloon is een opgeslagen skelet van een incident. In plaats van elke keer dat het betaalcluster wiebelt dezelfde titel, dezelfde monitorlijst en hetzelfde bereikbaarheidsbeleid opnieuw in te tikken, sla je het één keer op en meld je het incident vanuit dat sjabloon.

Ga naar **Incidenten → Instellingen → Incident-sjablonen** (`/dashboard/{projectId}/incidents/settings/templates`). De kaart heet **Incident-sjablonen**. Er een aanmaken loopt via een wizard van zes stappen:

- **Sjablooninformatie** — **Sjabloonnaam** en **Sjabloonbeschrijving**. Die benoemen het sjabloon zelf; ze komen nooit op het incident terecht.
- **Incidentdetails** — **Titel**, **Beschrijving** (Markdown), **Ernst van incident** en **Initiële incidentstatus**. **Initiële incidentstatus** is optioneel en begint leeg; de opties staan in statusvolgorde. Laat je het leeg, dan komen incidenten uit dit sjabloon in de aangemaakt-status van het project terecht.
- **Getroffen middelen** — de monitoren, hosts, clusters en services waaraan het incident gekoppeld moet worden, plus **Change Monitor Status to**.
- **Bereikbaarheid** — **Bereikbaarheidsbeleid**, het beleid dat wordt uitgevoerd zodra een incident uit dit sjabloon wordt gemeld.
- **Eigenaren** — **Eigenaar - Teams** en **Eigenaar - Gebruikers**.
- **Labels** — **Labels**.

Een paar snelle regels:

- De sjabloonlijst toont alleen **Naam** en **Beschrijving**. Rijen zijn vanuit de lijst niet te bewerken of te verwijderen — open een sjabloon (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) om het te wijzigen.
- Sjablonen ondersteunen JSON-import en -export, zodat je er een tussen projecten kunt verplaatsen.
- De lege staat leest "No incident templates found."

### Hoe een sjabloon wordt toegepast

Er zijn twee routes, en ze gedragen zich hetzelfde.

- **Vanuit het dashboard** — de knop **Maken op basis van sjabloon** in de incidentenlijst opent een keuzevenster **Selecteer incidentsjabloon**, waarna de meldpagina het sjabloon leest uit de queryparameter `incidentTemplateId` en het formulier alvast invult met het sjabloon plus zijn eigenaarsteams en eigenaargebruikers.
- **Vanuit de API** — geef `createdIncidentTemplateId` mee aan `POST /api/incident` en de server vult het incident vanuit het sjabloon.

Het belangrijkste is de samenvoegregel: **een sjabloon vult alleen een veld in dat je zelf niet hebt gezet**. Titel, beschrijving, ernst, initiële status, de monitorstatus achter **Change Monitor Status to**, monitoren, hosts, Kubernetes-clusters, Docker-hosts, Podman-hosts, services, bereikbaarheidsbeleid en labels worden alleen uit het sjabloon gekopieerd wanneer de aanroeper of het formulier niets heeft meegegeven. Wat jij expliciet instelt, wint altijd.

**De dialoog voor de lege staat wijst naar de verkeerde plek.** Heb je nog geen sjablonen, dan toont de knop **Maken op basis van sjabloon** een dialoog **No Incident Templates**. De tekst verwijst naar de projectinstellingen, maar de knop stuurt je naar **Incidenten → Instellingen → Incident-sjablonen** — daar staan ze echt.

## Notitiesjablonen

Notitiesjablonen geven responders kant-en-klare tekst voor incidentupdates, zodat een statuspagina-update om 03:00 uur niet vanaf nul wordt geschreven door iemand die half slaapt.

Ga naar **Incidenten → Instellingen → Notitie-sjablonen** (`/dashboard/{projectId}/incidents/settings/note-templates`). De kaart heet **Openbare of privénotitiesjablonen voor incidenten** — één bibliotheek bedient beide notitietypen. Het aanmaakformulier heeft twee stappen:

- **Sjablooninformatie** — **Sjabloonnaam** en **Sjabloonbeschrijving**, beide verplicht.
- **Notitiedetails** — de notitietekst zelf, in Markdown, verplicht.

Net als bij incidentsjablonen worden rijen aangemaakt en bekeken in plaats van ter plekke bewerkt; open een sjabloon om het te wijzigen.

Notitiesjablonen duiken op waar je ze echt nodig hebt: de bevestigingsdialogen **Acknowledge Incident** en **Resolve Incident** bieden allebei **Selecteer notitiesjabloon** naast het veld **Openbare notitie**. Zie [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) voor het verschil tussen openbare en privénotities.

## Postmortemsjablonen

Een postmortemsjabloon is het skelet van het verslag dat je na een incident schrijft — jouw kopjes, jouw aanwijzingen, jouw vaste vragen — zodat elke evaluatie in het project dezelfde vorm volgt.

Ga naar **Incidenten → Instellingen → Postmortem-sjablonen** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). De kaart heet **Postmortem-sjablonen**. Het aanmaakformulier heeft twee stappen:

- **Sjablooninformatie** — **Sjabloonnaam** en **Sjabloonbeschrijving**, beide verplicht.
- **Postmortem-details** — **Postmortem-sjabloon**, de tekst zelf, in Markdown, verplicht.

Toepassen doe je vanaf het incident, niet vanuit de instellingen. Open een incident, kies **Postmortem** in het zijmenu (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) en gebruik **Sjabloon toepassen**. Dat opent de dialoog **Postmortemsjabloon toepassen** met een vervolgkeuzelijst **Selecteer sjabloon**; kies je er een, dan wordt de sjabloontekst in de editor **Postmortem-notitie** geladen, waar je hem bewerkt voordat je opslaat. Incident-episodes hebben dezelfde pagina **Postmortem** en putten uit dezelfde sjabloonbibliotheek.

## Aangepaste velden

Met aangepaste velden draag je je eigen metadata mee op elk incident — een interne servicenaam, een verwijzing naar een changeticket, een klantsegment.

Ga naar **Incidenten → Instellingen → Aangepaste velden** (`/dashboard/{projectId}/incidents/settings/custom-fields`). De pagina heet **Aangepaste incidentvelden**. Elke definitie heeft:

- **Veldnaam** — verplicht, minstens twee tekens. De placeholder stelt een slug-achtige naam voor, zoals `internal-service`.
- **Veldbeschrijving** — optioneel.
- **Veldtype** — verplicht. Dit bepaalt hoe data wordt ingevoerd. Bij vervolgkeuzetypen moet je ook de opties opgeven.
- **Vervolgkeuzeopties** — de waarden die in de lijst verschijnen, elk met een optionele kleur.

De definities leven in hun eigen model; de waarden staan op het incident zelf, in de kolom `customFields`. Op een afzonderlijk incident vul je ze in via **Aangepaste velden** in het zijmenu van het incident (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Eén hiaat om te kennen.** Definities van aangepaste incidentvelden zijn het enige onderdeel van de incidentfamilie zonder workflowtriggers — zie de workflowsectie hieronder.

## Incidentrollen

Incidentrollen zijn de benoemde taken waaraan je mensen toewijst tijdens een respons. Definieer ze op **Incidenten → Instellingen → Incidentrollen** (`/dashboard/{projectId}/incidents/settings/roles`); de kaartbeschrijving noemt Incident Commander en Responder als voorbeelden.

Rollen zijn alleen definities. Mensen wijs je er per incident aan toe — de meldwizard heeft een stap **Incidentrollen** met een veld **Incidentrollen toewijzen**, en elk incident heeft een pagina **Rollen** in zijn zijmenu.

## Nummervoorvoegsels

Elk incident krijgt een nummer. Standaard wordt dat weergegeven als `#42`. Zegt je team hardop "INC-42", laat het product dat dan ook zeggen.

Ga naar **Incidenten → Instellingen → Meer instellingen** (`/dashboard/{projectId}/incidents/settings/more`). De kaart heet **Nummervoorvoegsel** en bevat twee velden op het project:

- **Voorvoegsel incidentnummer** — maximaal 20 tekens, placeholder `INC-`. Stel het in en incident `#42` verschijnt als `INC-42`.
- **Nummervoorvoegsel voor incident-episode** — hetzelfde idee voor de nummers van incident-episodes, placeholder `IE-`.

Laat een van beide leeg om het standaardvoorvoegsel `#` te houden; een niet-ingesteld veld toont `# (default)`. Opslaan doe je met **Bijwerken**. De waarde met voorvoegsel wordt op het incident opgeslagen als `incidentNumberWithPrefix`, en dat is wat de incidentenlijst en de incidentkop weergeven.

## Regels die draaien wanneer een incident wordt aangemaakt

**Incidenten → Regels** bevat acht regel-engines. Ze doen allemaal hetzelfde werk — kijken naar een incident zodra het is aangemaakt en handelen als het matcht — maar ze verschillen in wat ze doen en in hoe meerdere matchende regels worden afgehandeld.

- **Groeperingsregels** — verwante incidenten groeperen tot episodes. Regels worden op prioriteitsvolgorde geëvalueerd; lagere prioriteitsnummers gaan eerst.
- **Bereikbaarheidsregels** — bereikbaarheidsbeleid uitvoeren voor matchende incidenten. Verderop uitgebreid behandeld.
- **Eigenaarsregels** — automatisch eigenaren toewijzen.
- **Runbook-regels** — een [runbook](/docs/runbooks/index) starten wanneer een incident matcht.
- **Privacyregels** — bepalen of een matchend incident privé is.
- **Labelregels** — automatisch labels toepassen.
- **SLA-regels** — reactie- en oplostijden bijhouden. Regels worden op volgorde geëvalueerd; lagere volgordenummers gaan eerst.
- **Reminder Rules** — incidenteigenaren periodiek herinneren zolang een incident nog open staat. Regels worden op volgorde geëvalueerd en de eerste matchende regel wint.

**De volgordesemantiek is niet overal gelijk.** Groeperingsregels, SLA-regels en Reminder Rules worden op volgorde geëvalueerd. Bereikbaarheidsregels niet — elke matchende regel gaat af. Ga er niet van uit dat één model voor alle acht geldt.

De pagina's **Bereikbaarheidsregels**, **Eigenaarsregels**, **Labelregels** en **Privacyregels** hebben tabbladen — **Incident Rules** en **Episode Rules**, elk met een eigen tabel. Configureer het tabblad **Incident Rules**, tenzij je echt episodes bedoelt. **Groeperingsregels**, **Runbook-regels**, **SLA-regels** en **Reminder Rules** zijn losse tabellen.

## Bereikbaarheidsregels voor incidenten

Op **Incidenten → Regels → Bereikbaarheidsregels** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) maak je het pagen automatisch. De kaart, **Bereikbaarheidsregels incident**, beschrijft regels die automatisch bereikbaarheidsbeleid uitvoeren wanneer matchende incidenten worden aangemaakt. De pagina heeft twee tabbladen: **Incident Rules** en **Episode Rules**.

Het aanmaakformulier heeft drie stappen:

- **Basisinformatie** — **Naam** (de placeholder stelt zoiets voor als het pagen van het databaseteam bij elk DB-incident), **Beschrijving** en een schakelaar **Ingeschakeld**. De lijst toont per regel een groene pil **Ingeschakeld** of een rode **Uitgeschakeld**.
- **Overeenkomstcriteria** — **Monitoren**, **Incident Ernsten**, **Incident-labels**, **Monitorlabels**, plus hoofdletterongevoelige velden met reguliere expressies voor de incidenttitel, de incidentbeschrijving, de monitornaam en de monitorbeschrijving.
- **Bereikbaarheidsbeleid** — het beleid dat deze regel uitvoert.

### Hoe matching wordt bepaald

De regels die de pagina zelf hanteert zijn het onthouden waard:

- Een regel matcht alleen wanneer **alle** criteria die je hebt ingevuld slagen. Criteria die je leeg liet worden overgeslagen, niet als mislukt geteld.
- Binnen één lijstcriterium — **Monitoren**, **Incident Ernsten**, **Incident-labels**, **Monitorlabels** — geldt matching op een-van.
- De patroonvelden zijn hoofdletterongevoelige reguliere expressies.
- **Alle matchende regels gaan af.** Er is geen prioriteit en geen kortsluiting.
- Het beleid dat daadwerkelijk wordt uitgevoerd is de vereniging van het beleid van elke matchende regel plus alle beleidsregels die handmatig of via een sjabloon aan het incident hangen, ontdubbeld zodat elk beleid hoogstens één keer draait.

Ernst is hier een matchcriterium en nergens anders. Op een incidenternst zit geen bereikbaarheidsveld — "Critical Incident" kiezen paget op zichzelf niemand. Wil je dat ernst het pagen aanstuurt, schrijf dan een bereikbaarheidsregel die erop matcht.

## Bereikbaarheidsbeleid rechtstreeks koppelen

Regels zijn niet de enige route. Elk incident draagt zijn eigen lijst met bereikbaarheidsbeleid, zichtbaar als het veld **Bereikbaarheidsbeleid** in de stap **Bereikbaarheid** van de meldwizard en in de stap **Bereikbaarheid** van een incidentsjabloon. De veldbeschrijving zegt het onomwonden: dit is het bereikbaarheidsbeleid dat wordt uitgevoerd wanneer dit incident wordt aangemaakt.

Wanneer een incident wordt aangemaakt, draait OneUptime eerst de labelregels, dan de bereikbaarheidsregels (die hun matchende beleid samenvoegen met de lijst van het incident), dan de runbook-regels — en als de resulterende lijst niet leeg is, wordt elk beleid daarin uitgevoerd. Uitvoeringen draaien parallel en worden onafhankelijk afgehandeld, dus één falend beleid houdt de rest niet tegen. Elke uitvoering wordt gemarkeerd met het incident dat haar startte en met het meldingsgebeurtenistype voor "incident aangemaakt".

Wil je zien wat er is gebeurd, open dan het incident en kies **Bereikbaarheidsuitvoeringen** in het zijmenu (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Incidenten aansturen vanuit workflows

Workflowtriggers voor incidenten zijn niet met de hand geschreven — OneUptime genereert ze uit de datamodellen, dus elk model in de incidentfamilie krijgt componenten **On Create X**, **On Update X** en **On Delete X**, vernoemd naar de enkelvoudsnaam van het model. De belangrijkste drie zijn **On Create Incident**, **On Update Incident** en **On Delete Incident**, en je vindt ze onder de categorie **Incident** in het paneel **Component toevoegen** op `/dashboard/{projectId}/workflows`.

Diezelfde generatie levert ook triggers voor de configuratie zelf: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** en meer. Elk model krijgt bovendien bijpassende actiecomponenten — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** en hun varianten voor meerdere rijen — waardoor een trigger en een actie met vergelijkbare namen naast elkaar in dezelfde categorie staan. **On Create Incident** start een workflow; **Create One Incident** opent een incident.

Een paar details die tellen wanneer je deze aan elkaar knoopt:

- **On Update X** heeft een optioneel argument **Listen on** waarmee je de trigger beperkt tot updates die specifieke velden raken. Laat het leeg om bij elke wijziging af te gaan. Komt er een update binnen zonder registratie van welke velden veranderden, dan wordt het filter overgeslagen en draait de workflow toch.
- **On Create X** en **On Update X** hebben allebei een verplicht argument **Select Fields**; **On Delete X** heeft geen argumenten.
- Alle drie hebben één uitgang **Success**, en ze accepteren elk een ID-argument zodat je de workflow met de hand op één record kunt draaien.
- Namen komen van de enkelvoudsnaam van het model, niet van de tabelnaam — daarom zie je **On Create Incident Team Owner** en **On Create Incident User Owner** in plaats van namen in tabelvorm.
- Er zijn geen triggers voor definities van aangepaste incidentvelden. Dat model is het enige lid van de incidentfamilie met workflows uitgeschakeld.

Voor het bouwen van de rest van de workflow, zie [Een workflow maken](/docs/workflows/authoring) en [Workflow-variabelen](/docs/workflows/variables).

## Waar verder lezen

- [Incidenten – Overzicht](/docs/incidents/index) — hoe de incidentfunctie in elkaar zit.
- [Een incident melden](/docs/incidents/declaring-incidents) — de meldwizard, sjablonen en de API.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — de instellingenpagina's voor status en ernst, en wat de vlaggen doen.
- [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) — waar notitiesjablonen worden gebruikt.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie er buiten je team van een incident hoort.
- [Workflows – Overzicht](/docs/workflows/index) — automatiseren bovenop incidenttriggers.
- [Runbooks – Overzicht](/docs/runbooks/index) — de procedures die runbook-regels aanhaken.
