# Instellingen en automatisering

Incidentconfiguratie staat niet in Projectinstellingen. Het staat binnen het Incidenten-productgebied zelf, onder **Incidenten → Instellingen** en **Incidenten → Regels**, op routes die beginnen met `/dashboard/{projectId}/incidents/settings/`. Als je door **Projectinstellingen** hebt zitten zoeken naar incident-sjablonen of aangepaste velden, is dat de reden dat je ze niet kon vinden.

Zowel de sectie **Regels** als de sectie **Instellingen** van het zijmenu Incidenten is standaard ingeklapt, dus je moet ze uitvouwen voordat de items hieronder verschijnen. Alles hier is projectgebonden: sjablonen, rollen, aangepaste velden en regels horen bij één project en gelden voor elk incident dat daarin wordt gemeld.

Deze pagina is de referentie voor die configuratie — wat elke pagina bevat, en welk deel daarvan automatisch draait zodra er een incident wordt aangemaakt.

## Waar incidentinstellingen leven

Open **Incidenten** in de linkernavigatie en vouw daarna **Instellingen** onderaan het zijmenu uit.

| Pagina                      | Wat je daar doet                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Status incident**         | Statussen waar een incident doorheen beweegt toevoegen, hernoemen, verkleuren en herschikken.            |
| **Ernst van incident**      | Ernstniveaus toevoegen, hernoemen, verkleuren en herschikken.                                            |
| **Incident-sjablonen**      | Een heel incident vooraf invullen — titel, beschrijving, middelen, bereikbaarheidsbeleid, eigenaren, labels. |
| **Notitie-sjablonen**       | Herbruikbare tekst voor openbare en privénotities.                                                       |
| **Postmortem-sjablonen**    | Herbruikbare postmortem-structuren.                                                                      |
| **Aangepaste velden**       | Extra velden definiëren die op elk incident verschijnen.                                                 |
| **Incidentrollen**          | De rollen definiëren waaraan je responders toewijst, zoals Incident Commander.                           |
| **Meer instellingen**       | De nummervoorvoegsels voor incidenten en incident-episoden.                                              |

**Status incident** en **Ernst van incident** worden diepgaand behandeld in [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — de rest van deze pagina pakt het op bij **Incident-sjablonen**.

Vouw **Regels** uit en je krijgt acht pagina's erbij: **Groeperingsregels**, **Bereikbaarheidsregels**, **Eigenaarsregels**, **Runbook-regels**, **Privacyregels**, **Labelregels**, **SLA-regels** en **Reminder Rules**. Die worden verderop behandeld.

## Incident-sjablonen

Een incident-sjabloon is een opgeslagen skelet van een incident. In plaats van elke keer dat het betalingscluster wiebelt dezelfde titel, dezelfde monitorlijst en hetzelfde bereikbaarheidsbeleid opnieuw te typen, sla je het één keer op en meld je eruit.

Ga naar **Incidenten → Instellingen → Incident-sjablonen** (`/dashboard/{projectId}/incidents/settings/templates`). De kaart heet **Incident-sjablonen**. Er een aanmaken loodst je door een zesstapswizard:

- **Sjablooninformatie** — **Sjabloonnaam** en **Sjabloonbeschrijving**. Deze benoemen het sjabloon zelf; ze verschijnen nooit op het incident.
- **Incidentdetails** — **Titel**, **Beschrijving** (Markdown), **Ernst van incident** en **Initiële incidentstatus**. **Initiële incidentstatus** is optioneel en begint leeg; de opties staan in statusvolgorde. Laat het leeg en incidenten uit dit sjabloon belanden in de aangemaakt-status van het project.
- **Getroffen middelen** — de monitoren, hosts, clusters en services waaraan het incident gekoppeld moet worden, plus **Change Monitor Status to**.
- **Bereikbaarheid** — **Bereikbaarheidsbeleid**, de beleidsregels die worden uitgevoerd wanneer een incident uit dit sjabloon wordt gemeld.
- **Eigenaren** — **Eigenaar - Teams** en **Eigenaar - Gebruikers**.
- **Labels** — **Labels**.

Een paar snelle regels:

- De sjabloonlijst toont alleen **Naam** en **Beschrijving**. Rijen zijn niet bewerkbaar of verwijderbaar vanuit de lijst — open een sjabloon (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) om het te wijzigen.
- Sjablonen ondersteunen JSON-import en -export, zodat je er een tussen projecten kunt verplaatsen.
- De lege staat leest "No incident templates found."

### Hoe een sjabloon wordt toegepast

Er zijn twee paden, en ze gedragen zich hetzelfde.

- **Vanuit het dashboard** — de knop **Maken op basis van sjabloon** in de incidentenlijst opent een kiezer **Selecteer incidentsjabloon**, en de meldpagina leest het sjabloon uit de querystring-parameter `incidentTemplateId` en vult daarna het formulier vooraf in met het sjabloon plus zijn eigenaarsteams en eigenaarsgebruikers.
- **Vanuit de API** — geef `createdIncidentTemplateId` mee op `POST /api/incident` en de server vult het incident vanuit het sjabloon.

Het belangrijkste is de samenvoegregel: **een sjabloon vult alleen een veld dat je op undefined liet**. Titel, beschrijving, incidenternst, initiële incidentstatus, de monitorstatus achter **Change Monitor Status to**, monitoren, hosts, Kubernetes-clusters, Docker-hosts, Podman-hosts, services, bereikbaarheidsbeleid en labels worden alleen uit het sjabloon gekopieerd wanneer de aanroeper of het formulier niets meestuurde. Alles wat je expliciet instelt wint altijd.

**Het lege-staat-dialoogvenster wijst naar de verkeerde plek.** Heb je nog geen sjablonen, dan toont de knop **Maken op basis van sjabloon** een dialoogvenster **No Incident Templates**. De tekst wijst naar Projectinstellingen, maar de knop routeert naar **Incidenten → Instellingen → Incident-sjablonen** — dat is de echte locatie.

## Notitiesjablonen

Notitiesjablonen geven responders kant-en-klare tekst voor incidentupdates, zodat een statuspagina-update om 3 uur 's nachts niet vanaf nul wordt geschreven door iemand die half slaapt.

Ga naar **Incidenten → Instellingen → Notitie-sjablonen** (`/dashboard/{projectId}/incidents/settings/note-templates`). De kaart heet **Public or Private Note Templates for Incidents** — één bibliotheek bedient beide notitietypen. Het aanmaakformulier heeft twee stappen:

- **Sjablooninformatie** — **Sjabloonnaam** en **Sjabloonbeschrijving**, beide verplicht.
- **Notitiedetails** — de notitietekst zelf, in Markdown, verplicht.

Net als bij incident-sjablonen worden rijen aangemaakt en bekeken in plaats van inline bewerkt; open een sjabloon om het te wijzigen.

Notitiesjablonen duiken op waar je ze echt nodig hebt: de bevestigingsdialogen **Acknowledge Incident** en **Resolve Incident** bieden beide **Selecteer notitiesjabloon** naast het veld **Openbare notitie**. Zie [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) voor hoe openbare en privénotities verschillen.

## Postmortem-sjablonen

Een postmortem-sjabloon is het skelet van het verslag dat je na een incident produceert — je koppen, je prompts, je vaste vragen — zodat elke evaluatie in het project dezelfde vorm volgt.

Ga naar **Incidenten → Instellingen → Postmortem-sjablonen** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). De kaart heet **Postmortem-sjablonen**. Het aanmaakformulier heeft twee stappen:

- **Sjablooninformatie** — **Sjabloonnaam** en **Sjabloonbeschrijving**, beide verplicht.
- **Postmortem-details** — **Postmortem-sjabloon**, de tekst zelf, in Markdown, verplicht.

Je past er een toe vanaf het incident, niet vanuit de instellingen. Open een incident, kies **Postmortem** in het zijmenu (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), en gebruik **Sjabloon toepassen**. Dat opent een dialoogvenster **Apply Postmortem Template** met een keuzelijst **Selecteer sjabloon**; er een kiezen laadt de sjabloontekst in de editor **Postmortem-notitie**, waar je hem bewerkt voordat je opslaat. Incidentepisoden hebben dezelfde pagina **Postmortem** en putten uit dezelfde sjabloonbibliotheek.

## Aangepaste velden

Met aangepaste velden draag je je eigen metadata op elk incident — een interne servicenaam, een verwijzing naar een wijzigingsticket, een klanttier.

Ga naar **Incidenten → Instellingen → Aangepaste velden** (`/dashboard/{projectId}/incidents/settings/custom-fields`). De pagina heet **Incident Custom Fields**. Elke definitie heeft:

- **Veldnaam** — verplicht, minstens twee tekens. De placeholder suggereert een slug-achtige naam zoals `internal-service`.
- **Veldbeschrijving** — optioneel.
- **Veldtype** — verplicht. Dit bepaalt hoe data wordt ingevoerd. Keuzelijsttypen hebben ook hun opties nodig.
- **Vervolgkeuzeopties** — de waarden die in de keuzelijst verschijnen, elk met een optionele kleur.

Definities leven in hun eigen model; de waarden leven op het incident zelf in de kolom `customFields`. Op één incident vul je ze in via **Aangepaste velden** in het zijmenu van het incident (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Eén gat dat het weten waard is.** Definities van aangepaste incidentvelden zijn het enige deel van de incidentfamilie zonder workflow-triggers — zie de workflowsectie hieronder.

## Incidentrollen

Incidentrollen zijn de benoemde taken waaraan je tijdens een respons mensen toewijst. Definieer ze bij **Incidenten → Instellingen → Incidentrollen** (`/dashboard/{projectId}/incidents/settings/roles`); de kaartbeschrijving geeft Incident Commander en Responder als voorbeelden.

Rollen zijn alleen definities. Je wijst er per incident mensen aan toe — de meldwizard heeft een stap **Incidentrollen** met een veld **Incidentrollen toewijzen**, en elk incident heeft een pagina **Rollen** in het zijmenu.

## Nummervoorvoegsels

Elk incident krijgt een nummer. Standaard verschijnt dat als `#42`. Als je team hardop "INC-42" zegt, laat het product dat dan ook zeggen.

Ga naar **Incidenten → Instellingen → Meer instellingen** (`/dashboard/{projectId}/incidents/settings/more`). De kaart is **Nummervoorvoegsel** en bevat twee velden op het project:

- **Voorvoegsel incidentnummer** — maximaal 20 tekens, placeholder `INC-`. Stel het in en incident `#42` verschijnt als `INC-42`.
- **Nummervoorvoegsel voor incident-episode** — hetzelfde idee voor incident-episodenummers, placeholder `IE-`.

Laat een van beide leeg om het standaardvoorvoegsel `#` te houden; het niet-ingestelde veld toont `# (default)`. Sla op met **Bijwerken**. De waarde met voorvoegsel wordt op het incident opgeslagen als `incidentNumberWithPrefix`, en dat is wat de incidentenlijst en de incidentkop weergeven.

## Regels die draaien wanneer een incident wordt aangemaakt

**Incidenten → Regels** bevat acht regel-engines. Ze doen allemaal hetzelfde werk — kijken naar een incident op het moment dat het wordt aangemaakt, en handelen als het matcht — maar ze verschillen in wat ze doen en in hoe meerdere matchende regels worden opgelost.

- **Groeperingsregels** — groepeer gerelateerde incidenten in episoden. Regels worden op prioriteitsvolgorde geëvalueerd; lagere prioriteitsnummers gaan eerst.
- **Bereikbaarheidsregels** — voer piketbeleid uit voor matchende incidenten. Hieronder in detail behandeld.
- **Eigenaarsregels** — wijs automatisch eigenaren toe.
- **Runbook-regels** — start een [runbook](/docs/runbooks/index) wanneer een incident matcht.
- **Privacyregels** — bepaal of een matchend incident privé is.
- **Labelregels** — pas automatisch labels toe.
- **SLA-regels** — volg respons- en oplostijden. Regels worden op volgorde geëvalueerd; lagere volgordenummers gaan eerst.
- **Reminder Rules** — herinner incidenteigenaren periodiek zolang een incident nog open is. Regels worden op volgorde geëvalueerd en de eerste matchende regel wint.

**De volgordesemantiek is niet uniform.** Groeperingsregels, SLA-regels en Reminder Rules worden op volgorde geëvalueerd. Bereikbaarheidsregels niet — elke matchende regel gaat af. Ga er niet vanuit dat één model op alle acht van toepassing is.

De pagina's **Bereikbaarheidsregels**, **Eigenaarsregels**, **Labelregels** en **Privacyregels** hebben tabbladen — een tabblad **Incident Rules** en een tabblad **Episode Rules**, elk met een eigen tabel. Configureer het tabblad **Incident Rules** tenzij je specifiek episoden bedoelt. **Groeperingsregels**, **Runbook-regels**, **SLA-regels** en **Reminder Rules** zijn enkele tabellen.

## Incident-bereikbaarheidsregels

**Incidenten → Regels → Bereikbaarheidsregels** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) is waar je paging automatisch maakt. De kaart, **Incident On-Call Rules**, beschrijft regels die automatisch piketbeleid uitvoeren wanneer matchende incidenten worden aangemaakt. De pagina heeft twee tabbladen: **Incident Rules** en **Episode Rules**.

Het aanmaakformulier heeft drie stappen:

- **Basisinformatie** — **Naam** (de placeholder suggereert zoiets als het pagen van het databaseteam voor elk DB-incident), **Beschrijving**, en een schakelaar **Ingeschakeld**. De lijst toont per regel een groene pil **Ingeschakeld** of een rode pil **Uitgeschakeld**.
- **Overeenkomstcriteria** — **Monitoren**, **Incident Ernsten**, **Incident-labels**, **Monitorlabels**, plus hoofdletterongevoelige reguliere-expressievelden voor de incidenttitel, incidentbeschrijving, monitornaam en monitorbeschrijving.
- **Bereikbaarheidsbeleid** — de beleidsregels die deze regel uitvoert.

### Hoe matching wordt opgelost

De regels waarmee de pagina zelf komt zijn het internaliseren waard:

- Een regel matcht alleen wanneer **alle** criteria die je hebt ingevuld slagen. Criteria die je leeg liet worden overgeslagen, niet als mislukt beschouwd.
- Binnen één lijstcriterium — **Monitoren**, **Incident Ernsten**, **Incident-labels**, **Monitorlabels** — is matching een-van.
- De patroonvelden zijn hoofdletterongevoelige reguliere expressies.
- **Alle matchende regels gaan af.** Er is geen prioriteit en geen short-circuit.
- De set beleidsregels die daadwerkelijk draait is de vereniging van de beleidsregels van elke matchende regel plus alle beleidsregels die handmatig of door een sjabloon aan het incident zijn gekoppeld, ontdubbeld zodat elk beleid hoogstens één keer draait.

Ernst is hier een matchcriterium en nergens anders. Er is geen bereikbaarheidsveld op een incidenternst — "Critical Incident" selecteren paget op zichzelf niemand. Wil je dat ernst paging stuurt, schrijf dan een bereikbaarheidsregel die erop matcht.

## Bereikbaarheidsbeleid rechtstreeks koppelen

Regels zijn niet de enige route. Elk incident draagt een eigen lijst met bereikbaarheidsbeleid, zichtbaar als het veld **Bereikbaarheidsbeleid** in de stap **Bereikbaarheid** van de meldwizard en in de stap **Bereikbaarheid** van een incident-sjabloon. De veldbeschrijving zegt het onomwonden: dit zijn de piketbeleidsregels die worden uitgevoerd wanneer dit incident wordt aangemaakt.

Wanneer een incident wordt aangemaakt, draait OneUptime labelregels, dan bereikbaarheidsregels (die hun matchende beleidsregels in de lijst van het incident samenvoegen), dan runbook-regels — en als de resulterende lijst niet leeg is, wordt elk beleid erin uitgevoerd. Uitvoeringen draaien parallel en worden onafhankelijk afgehandeld, dus één falend beleid stopt de andere niet. Elke uitvoering wordt getagd met het incident dat hem triggerde en met het meldingseventtype voor incident-aangemaakt.

Om te zien wat er gebeurde, open je het incident en kies je **Bereikbaarheidsuitvoeringen** in het zijmenu (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Incidenten aansturen vanuit workflows

Workflow-triggers voor incidenten worden niet met de hand geschreven — OneUptime genereert ze uit de datamodellen, dus elk model uit de incidentfamilie krijgt componenten **On Create X**, **On Update X** en **On Delete X**, vernoemd naar de enkelvoudsnaam van het model. De drie belangrijkste zijn **On Create Incident**, **On Update Incident** en **On Delete Incident**, en ze staan in de categorie **Incident** in het **Component toevoegen**-paneel op `/dashboard/{projectId}/workflows`.

Dezelfde generatie geeft je triggers voor de configuratie zelf: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** en meer. Elk model krijgt ook bijpassende actiecomponenten — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** en hun meervoudige equivalenten — zodat een trigger en een actie met vergelijkbare namen naast elkaar in dezelfde categorie staan. **On Create Incident** start een workflow; **Create One Incident** opent er een.

Een paar details die van belang zijn wanneer je deze aansluit:

- **On Update X** neemt een optioneel argument **Listen on** dat de trigger beperkt tot updates die specifieke velden raken. Laat het leeg om bij elke wijziging af te gaan. Komt een update binnen zonder registratie van welke velden bewogen, dan wordt het filter overgeslagen en draait de workflow toch.
- **On Create X** en **On Update X** nemen beide een verplicht argument **Select Fields**; **On Delete X** neemt geen argumenten.
- Alle drie bieden één enkele out-port **Success**, en elk accepteert een ID-argument zodat je de workflow met de hand tegen één record kunt draaien.
- Namen komen van de enkelvoudsnaam van het model, niet van de tabelnaam — daarom zie je **On Create Incident Team Owner** en **On Create Incident User Owner** in plaats van tabelvormige namen.
- Er zijn geen triggers voor definities van aangepaste incidentvelden. Dat model is het enige lid van de incidentfamilie met workflows uitgeschakeld.

Voor het bouwen van de rest van de workflow, zie [Een workflow maken](/docs/workflows/authoring) en [Workflow-variabelen](/docs/workflows/variables).

## Waar verder lezen

- [Incidenten – Overzicht](/docs/incidents/index) — hoe de incidentfunctie in elkaar past.
- [Een incident melden](/docs/incidents/declaring-incidents) — de meldwizard, sjablonen en de API.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — de instellingenpagina's voor status en ernst en wat de vlaggen doen.
- [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) — waar notitiesjablonen worden gebruikt.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie er buiten je team hoort over een incident.
- [Workflows – Overzicht](/docs/workflows/index) — automatiseren bovenop incident-triggers.
- [Runbooks – Overzicht](/docs/runbooks/index) — de procedures die runbook-regels koppelen.
