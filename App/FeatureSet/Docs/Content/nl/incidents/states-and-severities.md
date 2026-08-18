# Statussen en ernstniveaus

Elk incident draagt twee classificaties: een **status** die zegt waar het in je respons staat, en een **ernst** die zegt hoeveel pijn het doet. In het dashboard lijken ze op elkaar — beide verschijnen als gekleurde pillen in de incidentenlijst, beide zijn projectgebonden lijsten die je kunt hernoemen en van kleur veranderen. Ze doen heel verschillend werk.

Statussen sturen gedrag. Drie booleaanse vlaggen op de statusrijen bepalen welke incidenten als actief tellen, welke knoppen op de incidentkop verschijnen, wanneer de SLA-klok stopt, en wanneer het incident van je statuspagina verdwijnt. Ernstniveaus sturen op zichzelf niets — het zijn labels die impact beschrijven, en waar andere regels op kunnen matchen.

Beide lijsten worden aangemaakt wanneer je project wordt aangemaakt, en beide worden bewerkt onder **Incidenten → Instellingen**. Die sectie van het zijmenu Incidenten is standaard ingeklapt, dus vouw **Instellingen** uit voordat je gaat zoeken.

## Statussen dragen gedrag, ernstniveaus dragen betekenis

Het `IncidentState`-model heeft `name`, `description`, `color` en `order`, plus drie booleans: `isCreatedState`, `isAcknowledgedState` en `isResolvedState`. Alles wat het product met statussen doet hangt aan die booleans en aan `order` — nooit aan de naam van de status. Daarom kun je **Opgelost** hernoemen naar "Gesloten" zonder dat er iets breekt: de vlag reist mee met de rij.

Het `IncidentSeverity`-model heeft `name`, `description`, `color` en `order` en verder niets. Er zijn geen vlaggen. Niets in OneUptime behandelt **Critical Incident** op zichzelf anders dan **Minor Incident** — ernst doet er alleen toe waar je er iets op richt, zoals het matchcriterium **Incident Ernsten** op een bereikbaarheidsregel.

Een paar snelle regels:

- **Kies ernst om impact te communiceren** — het staat in de incidentenlijst, op het **Overzicht** van het incident, en het is een verplicht veld wanneer je een incident meldt.
- **Kies statussen om je proces te modelleren** — de responsstappen die je daadwerkelijk doorloopt, in de volgorde waarin je ze doorloopt.
- **Codeer urgentie niet in statussen** — een status genaamd "Kritiek" zou niemand pagen. Ernst plus een bereikbaarheidsregel doet dat.

## De voorgeconfigureerde statussen

Drie statussen worden met het project aangemaakt, in deze volgorde. Het aanmaken is idempotent — een status wordt alleen toegevoegd wanneer er nog geen bestaat met die naam.

| Status           | `order` | Vlag                  | Kleur     | Betekenis                                                    |
| ---------------- | ------- | --------------------- | --------- | ------------------------------------------------------------ |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | De status waarin nieuwe incidenten belanden.                 |
| **Bevestigd**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Iemand heeft het incident opgepakt.                          |
| **Opgelost**     | `3`     | `isResolvedState`     | `#2ab57d` | Het incident is voorbij en telt niet langer als actief.      |

Let op de naam: de eerste status is **Identified**, ook al noemen verschillende beschrijvingen in het product hem nog de "aangemaakt"-status. Wanneer een doc of een tooltip "aangemaakt-status" zegt, bedoelt hij de status die `isCreatedState` draagt — in een vers project is dat **Identified**.

## Wat elke statusvlag werkelijk doet

| Vlag                  | Doel                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isCreatedState`      | De status die een incident krijgt wanneer niemand er een koos. Draagt geen enkele status in het project deze vlag, dan mislukt het aanmaken van een incident met een foutmelding die zegt dat je vanuit de instellingen een aangemaakt-incidentstatus moet toevoegen. |
| `isAcknowledgedState` | Voedt de knop **Acknowledge** en de stat-tegel "<statusnaam> in" op het **Overzicht** van het incident. Bij een statuswijziging naar deze status wordt de SLA van het incident gemarkeerd als beantwoord. |
| `isResolvedState`     | Voedt de knop **Oplossen** en de opgelost-stat-tegel, definieert de lijst **Actieve incidenten**, en is wat het incident uit de actieve sectie van een statuspagina haalt. Markeert de SLA als opgelost. |

Er wordt verwacht dat per project maar één status elke vlag draagt — de lookups halen één enkele rij op. De drie gevlagde statussen kunnen worden hernoemd, van kleur veranderd en herschikt, maar de instellingenpagina weigert ze te verwijderen en toont een foutmelding die de aangemaakt-, bevestigd- en opgelost-status noemt.

Omdat de UI statusnamen dynamisch uitleest, verandert een status hernoemen wat je overal ziet — de stat-tegels, de titels van bevestigingsmodalen, en de pil in de incidentenlijst volgen allemaal de naam die je de rij gaf.

## Eigen statussen toevoegen

Ga naar **Incidenten → Instellingen → Status incident**. De pagina is een geordende lijst gesorteerd op `order` oplopend, en nieuwe statussen worden achteraan toegevoegd. Sleep een rij om de positie te wijzigen.

**Velden op een status:**

- **Naam** — verplicht, minstens twee tekens. De placeholder suggereert iets als "Investigating".
- **Beschrijving** — optionele vrije tekst die uitlegt wanneer een incident in deze status zit.
- **Kleur** — verplicht. Gekozen uit de kleurkiezer; opgeslagen als een hexwaarde zoals `#fd625e`.

Je kunt de drie vlaggen niet vanuit dit formulier instellen — ze horen bij de voorgeconfigureerde rijen. Een status die je toevoegt is dus een ongevlagde status, wat twee gevolgen heeft waar je rekening mee wilt houden:

- **Hij telt als actief.** **Actieve incidenten** is gedefinieerd als "huidige status is niet de opgeloste status", dus alles wat je toevoegt anders dan de opgeloste status houdt het incident in de actieve lijst en in de teller in de zijbalk.
- **De overgangsknop is generiek.** In plaats van **Acknowledge** of **Oplossen** heet de bevestigingsmodaal **Mark Incident as `<state name>`** met een verzendknop **Mark as `<state name>`**.

Een gebruikelijke vorm is om een triage- of mitigatiestap tussen de bevestigd- en opgelost-status te schuiven — sleep bijvoorbeeld een nieuwe status "Gemitigeerd" zodat die na **Bevestigd** en vóór **Opgelost** komt.

## Volgorde is een echte beperking, geen weergavevoorkeur

De kolom `order` wordt afgedwongen wanneer een statuswijziging wordt weggeschreven, niet alleen wanneer de lijst wordt getekend:

- **Overgangen terug worden geweigerd.** Een incident naar een status verplaatsen die eerder in de volgorde staat dan zijn huidige status mislukt met een foutmelding die beide statussen noemt.
- **De huidige status opnieuw kiezen wordt geweigerd.** Een incident zetten op de status waarin het al zit mislukt met "Incident state cannot be same as previous state."
- **Een teruggedateerde rij mag zijn buur niet dupliceren.** Een tijdlijnrij invoegen waarvan de status gelijk is aan de rij die erop volgt wordt ook geweigerd.
- **De knoppen in de kop volgen de positie van de gevlagde statussen in de volgorde.** **Acknowledge** en **Oplossen** worden aangeboden op basis van waar de huidige status staat in de op volgorde gesorteerde lijst. Een eigen status die *na* de opgeloste status is geplaatst zal nooit een knop **Oplossen** tonen, omdat er niets meer over is om naar voren te bewegen.

Zet een status dus daar waar een incident er echt doorheen zou komen. Hem verkeerd ordenen ziet er niet alleen raar uit — het maakt overgangen onmogelijk.

## De voorgeconfigureerde ernstniveaus

Drie ernstniveaus worden met het project aangemaakt, in deze volgorde:

- **Critical Incident** (`order` 1, `#b70400`) — problemen met zeer hoge impact op klanten, die om een onmiddellijke respons vragen. Een volledige storing of een datalek.
- **Major Incident** (`order` 2, `#fd625e`) — aanzienlijke impact, meestal met een onmiddellijke respons nodig, soms met een workaround die de schade beperkt. Een belangrijk subsysteem dat uitvalt.
- **Minor Incident** (`order` 3, `#ffbf53`) — lage impact, meestal binnen werktijd afgehandeld, en de meeste klanten merken er waarschijnlijk niets van. Een lichte terugval in applicatieprestaties.

Ernst is verplicht wanneer je een incident meldt, en het is verplicht op elke incidentspecificatie in de criteria van een monitor, dus elk incident — handmatig of automatisch — arriveert met een ernst. Zie [Een incident melden](/docs/incidents/declaring-incidents) voor de meldflow en [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating) voor het monitor-gestuurde pad.

## Ernstniveaus bewerken

Ga naar **Incidenten → Instellingen → Ernst van incident**. Dezelfde vorm als de statuspagina — een geordende lijst gesorteerd op `order`, slepen om te herschikken, nieuwe ernstniveaus achteraan toegevoegd, met **Naam**, **Beschrijving** en **Kleur** op het formulier.

Twee verschillen met statussen:

- **Er is geen verwijderbeveiliging.** Elke ernst kan worden verwijderd, inclusief de drie voorgeconfigureerde.
- **Er zijn geen vlaggen om te erven.** Een nieuwe ernst gedraagt zich precies als de voorgeconfigureerde — het is een label met een kleur en een positie.

**Een opmerking over de placeholders.** Het ernstformulier hergebruikt de voorbeeldtekst van het statusformulier woord voor woord, dus de hints hebben het over incidentstatussen in plaats van ernstniveaus. Negeer ze en schrijf je eigen ernstnamen en -beschrijvingen.

Waar ernst meer doet dan beschrijven: op **Incidenten → Regels → Bereikbaarheidsregels** is het veld **Incident Ernsten** van een regel een matchcriterium. **Critical Incident** daar opsommen is hoe "page het databaseteam voor alles wat kritiek is" wordt uitgedrukt — het bereikbaarheidsbeleid staat op de regel, niet op de ernst.

## Een incident door zijn statussen bewegen

Er zijn vier manieren waarop een incident van status verandert:

- **De knoppen in de kop.** Open een incident. Staat de huidige status vóór de bevestigd-status, dan krijg je **Acknowledge** en **Oplossen**; staat hij tussen de twee in, dan krijg je **Oplossen**. Elk opent een bevestigingsmodaal — **Acknowledge Incident** of **Resolve Incident** — die ook **Selecteer notitiesjabloon**, **Openbare notitie** en **Statuspagina-abonnees op de hoogte stellen** aanbiedt.
- **De statustijdlijn.** Voeg met de hand een rij toe vanaf de pagina **Statustijdlijn** van het incident met **Incidentstatus**, **Begint op** en **Statuspagina-abonnees op de hoogte stellen**.
- **Bulkwijziging.** De incidentenlijst heeft een bulkactie **Status wijzigen** om meerdere incidenten tegelijk te verplaatsen.
- **Automatisch.** Een monitor-criterium met **Incident automatisch oplossen** aan lost zijn incident op wanneer aan het criterium niet langer wordt voldaan, en de API kan de status bijwerken via `/api/incident-state-timeline`.

Elk van deze schrijft een tijdlijnrij weg. Een statuswijziging doet ook een paar dingen waar je niet om hoeft te vragen: hij plaatst een item in de incidentfeed, wijst een Incident Commander toe als het incident er nog geen heeft, en werkt de SLA-klok bij. Een opgelost incident heropenen start een verse SLA-registratie vanaf het moment van heropenen.

## De statustijdlijn

De pagina **Statustijdlijn** in het zijmenu van het incident is het auditspoor van elke status waarin het incident heeft gezeten. De kaart op die pagina heet **Statustijdlijn**, en is gesorteerd op nieuwste eerst.

**Kolommen:**

- **Incidentstatus** — een gekleurde pil met de naam en kleur van de status.
- **Begint op** — wanneer het incident deze status binnenkwam.
- **Eindigt op** — wanneer het hem verliet. De huidige status toont `Currently Active`.
- **Duur** — tijd doorgebracht in de status, voor de huidige geteld tot nu.
- **Meldingsstatus abonnee** — of de statuspaginamelding voor deze wijziging is verstuurd, overgeslagen of nog in behandeling is, met een link **meer details**, en — wanneer het versturen mislukte — een actie **Retry**.

**Rijacties:**

- **Oorzaak bekijken** — opent een modaal **Hoofdoorzaak** die de markdown weergeeft die bij die statuswijziging is vastgelegd.
- **Logboeken bekijken** — opent een modaal dat uitlegt waarom de status veranderde, met een viewer **Incident State Log**.

Tijdlijnrijen kunnen worden aangemaakt en verwijderd, maar niet bewerkt. De verkeerde rij verwijderen herschrijft de geschiedenis van het incident, dus behandel het als een correctiemiddel en niet als een opruimgewoonte.

## De lijst Actieve incidenten

**Incidenten → Actieve incidenten** is de lijst die je tijdens een dienst in de gaten houdt. De definitie is precies één voorwaarde: de huidige status van het incident is een status waar `isResolvedState` onwaar is. Verder wordt er niets meegewogen — niet ernst, niet leeftijd, niet of iemand het heeft bevestigd.

Het item in het zijmenu draagt een rode tellerbadge met dezelfde query, dus de badge en de lijst zijn het altijd eens. Als er niets te zien is, zegt de pagina dat.

Het praktische gevolg: elke eigen status die je toevoegt houdt incidenten in deze lijst. Dat is meestal wat je wilt — "Gemitigeerd" is niet "klaar" — maar het betekent wel dat de badge pas leegloopt wanneer incidenten daadwerkelijk de opgeloste status bereiken.

## Statuspagina-abonnees vertellen over een statuswijziging

Een statuswijziging kan de abonnees van je statuspagina e-mailen, maar het gaat door verschillende poorten. Die begrijpen bespaart een hoop "waarom kreeg niemand bericht"-gedebug.

Melding wordt per tijdlijnrij aangevraagd met **Statuspagina-abonnees op de hoogte stellen** (`shouldStatusPageSubscribersBeNotified`), het selectievakje op de statuswijzigingsmodaal en op het handmatige tijdlijnformulier. Staat het uit, dan wordt de rij opgeslagen met een overgeslagen status en een toelichting. Staat het aan, dan wordt de rij in de wachtrij gezet en pikt een achtergrondtaak hem op — de taak draait elke minuut, dus bezorging is snel maar niet onmiddellijk.

**De rij in de wachtrij wordt vervolgens overgeslagen wanneer een van deze geldt:**

- **De nieuwe status is de aangemaakt-status.** Abonnees zijn al ingelicht toen het incident werd gemeld, dus de eerste tijdlijnrij stuurt bewust geen tweede bericht.
- **Het incident heeft geen monitoren gekoppeld.** Zonder middelen is er geen statuspagina om het incident op te mappen.
- **Het incident is niet zichtbaar op de statuspagina** (`isVisibleOnStatusPage` staat uit).
- **De statuspagina heeft incidenten uit staan** (`showIncidentsOnStatusPage` staat uit). Deze is per statuspagina — andere pagina's die dezelfde monitor tonen krijgen nog steeds bericht.

**Nog iets dat de uitkomst verandert.** Als je een **Openbare notitie** in de statuswijzigingsmodaal typt, wordt de tijdlijnrij gemarkeerd als al gemeld in plaats van in de wachtrij gezet. De notitie zelf is wat abonnees bereikt, dus ze krijgen één bericht in plaats van twee. Het eventtype achter het kale statuswijzigingsbericht is `Subscriber Incident State Changed`.

Voor wie deze ontvangt en hoe de sjablonen worden gekozen, zie [Abonnees en aankondigingen](/docs/status-pages/subscribers).

## Een incident van de statuspagina houden

Drie afzonderlijke dingen bepalen of een incident überhaupt op de publieke pagina staat, en alle drie moeten waar zijn:

- **Incidenten weergeven** (`showIncidentsOnStatusPage`) op de statuspagina zelf.
- **Zichtbaar op statuspagina** (`isVisibleOnStatusPage`) op het incident — een schakelaar op de pagina **Instellingen** van het incident. Hij staat standaard op waar en staat niet in de meldwizard; een monitor-criterium kan hem zetten met **Incident weergeven op statuspagina**.
- **De huidige status is niet de opgeloste status.** Dit is wat een incident uit de actieve sectie haalt: de statuspagina-query haalt incidenten op waarvan de huidige status een willekeurige onopgeloste status is. Je archiveert of sluit niets — je lost het op, en het verhuist naar de geschiedenis.

**Privé-incidenten verschijnen nooit.** **Privé-incident** aanzetten verbergt het incident voor elke statuspagina, ongeacht de schakelaars hierboven, en beperkt het tot zijn eigenaren plus projectbeheerders en -eigenaren.

Hoeveel opgeloste geschiedenis de pagina bewaart is een statuspagina-instelling, geen incidentinstelling. Zie [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups) voor hoe monitoren op de pagina bepalen welke incidenten überhaupt verschijnen.

## Waar verder lezen

- [Incidenten – Overzicht](/docs/incidents/index) — hoe het incident-functiegebied in elkaar past.
- [Een incident melden](/docs/incidents/declaring-incidents) — de meldwizard, sjablonen, en de API.
- [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) — openbare notities, privénotities, en de activiteitenfeed.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — sjablonen, aangepaste velden, regels, en workflow-triggers.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie de e-mails krijgt die een statuswijziging verstuurt.
- [Statuspagina's – Overzicht](/docs/status-pages/index) — wat een statuspagina toont en aan wie.
- [Workflows – Overzicht](/docs/workflows/index) — reageren op statuswijzigingen met automatisering.
