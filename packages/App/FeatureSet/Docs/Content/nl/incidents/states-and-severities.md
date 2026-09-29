# Statussen en ernstniveaus

Elk incident draagt twee classificaties: een **status** die zegt waar het in je respons staat, en een **ernst** die zegt hoeveel pijn het doet. In het dashboard lijken ze op elkaar — allebei verschijnen ze als gekleurde pillen in de incidentenlijst, allebei zijn het projectgebonden lijsten die je kunt hernoemen en verkleuren. Ze doen totaal verschillend werk.

Statussen sturen gedrag. Drie booleanvlaggen op de statusrijen bepalen welke incidenten als actief tellen, welke knoppen in de incidentkop verschijnen, wanneer de SLA-klok stopt en wanneer het incident van je statuspagina verdwijnt. Ernstniveaus sturen op zichzelf niets — het zijn labels die impact beschrijven en waar andere regels op kunnen matchen.

Beide lijsten worden aangemaakt wanneer je project ontstaat, en beide bewerk je onder **Incidenten → Instellingen**. Die sectie van het zijmenu Incidenten is standaard ingeklapt, dus vouw **Instellingen** uit voordat je gaat zoeken.

## Statussen dragen gedrag, ernstniveaus dragen betekenis

Het model `IncidentState` heeft `name`, `description`, `color` en `order`, plus drie booleans: `isCreatedState`, `isAcknowledgedState` en `isResolvedState`. Alles wat het product met statussen doet hangt aan die booleans en aan `order` — nooit aan de naam van de status. Daarom kun je **Opgelost** hernoemen naar "Gesloten" zonder dat er iets breekt: de vlag reist mee met de rij.

Het model `IncidentSeverity` heeft `name`, `description`, `color` en `order` en verder niets. Er zijn geen vlaggen. Niets in OneUptime behandelt **Critical Incident** uit zichzelf anders dan **Minor Incident** — ernst telt alleen daar waar je er iets op richt, zoals het matchcriterium **Incident Ernsten** op een bereikbaarheidsregel.

Een paar snelle regels:

- **Kies ernst om impact te communiceren** — hij staat in de incidentenlijst, op het **Overzicht** van het incident, en is een verplicht veld wanneer je een incident meldt.
- **Kies statussen om je proces te modelleren** — de responsstappen die je echt doorloopt, in de volgorde waarin je ze doorloopt.
- **Stop geen urgentie in statussen** — een status met de naam "Kritiek" paget niemand. Ernst plus een bereikbaarheidsregel doet dat wel.

## De voorgeconfigureerde statussen

Drie statussen worden met het project aangemaakt, in deze volgorde. Dat aanmaken is idempotent — een status wordt alleen toegevoegd als er nog geen bestaat met die naam.

| Status           | `order` | Vlag                  | Kleur     | Wat het betekent                                     |
| ---------------- | ------- | --------------------- | --------- | ---------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | De status waarin nieuwe incidenten belanden.         |
| **Bevestigd**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Iemand heeft het incident opgepakt.                  |
| **Opgelost**     | `3`     | `isResolvedState`     | `#2ab57d` | Het incident is voorbij en telt niet meer als actief. |

Let op de naam: de eerste status is **Identified**, ook al noemen verschillende beschrijvingen in het product hem nog de "aangemaakt"-status. Zegt een doc of een tooltip "aangemaakt-status", dan bedoelt het de status die `isCreatedState` draagt — in een vers project is dat **Identified**.

## Wat elke statusvlag daadwerkelijk doet

| Vlag                  | Waarvoor                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | De status die een incident krijgt wanneer niemand er een koos. Draagt geen enkele status in het project deze vlag, dan mislukt het aanmaken van een incident met de melding dat je vanuit de instellingen een aangemaakt-status moet toevoegen. |
| `isAcknowledgedState` | Voedt de knop **Acknowledge** en de stat-tegel "<statusnaam> in" op het **Overzicht** van het incident. Bij een statuswijziging naar deze status wordt de SLA van het incident als beantwoord gemarkeerd. |
| `isResolvedState`     | Voedt de knop **Oplossen** en de opgelost-stat-tegel, bepaalt de lijst **Actieve incidenten**, en is wat het incident uit het actieve deel van een statuspagina haalt. Markeert de SLA als opgelost. |

Per project hoort maar één status elke vlag te dragen — de opzoekacties halen één rij op. De drie gevlagde statussen kun je hernoemen, verkleuren en herschikken, maar de instellingenpagina weigert ze te verwijderen en toont een foutmelding die de aangemaakt-, bevestigd- en opgelost-status benoemt.

Omdat de UI statusnamen dynamisch uitleest, verandert hernoemen wat je overal ziet — de stat-tegels, de titels van bevestigingsdialogen en de pil in de incidentenlijst volgen allemaal de naam die je de rij gaf.

## Zelf statussen toevoegen

Ga naar **Incidenten → Instellingen → Status incident**. De pagina is een geordende lijst, oplopend gesorteerd op `order`, en nieuwe statussen komen achteraan. Sleep een rij om de positie te wijzigen.

**Velden op een status:**

- **Naam** — verplicht, minstens twee tekens. De placeholder suggereert iets als "Investigating".
- **Beschrijving** — optionele vrije tekst die uitlegt wanneer een incident in deze status hoort.
- **Kleur** — verplicht. Gekozen uit de kleurenkiezer; opgeslagen als hexwaarde zoals `#fd625e`.

De drie vlaggen kun je niet vanuit dit formulier zetten — die horen bij de voorgeconfigureerde rijen. Een status die je toevoegt is dus een ongevlagde status, en dat heeft twee gevolgen waar je op moet plannen:

- **Hij telt als actief.** **Actieve incidenten** is gedefinieerd als "huidige status is niet de opgeloste status", dus alles wat je toevoegt behalve de opgeloste status houdt het incident in de actieve lijst en in de teller in het zijmenu.
- **Zijn overgangsknop is generiek.** In plaats van **Acknowledge** of **Oplossen** heet de bevestigingsdialoog **Markeer incident als `<state name>`** met een verzendknop **Mark as `<state name>`**.

Een gebruikelijke vorm is een triage- of mitigatiestap tussen de bevestigd- en de opgelost-status schuiven — sleep bijvoorbeeld een nieuwe status "Gemitigeerd" zodat die na **Bevestigd** en vóór **Opgelost** staat.

## Volgorde is een echte beperking, geen weergavevoorkeur

De kolom `order` wordt afgedwongen wanneer een statuswijziging wordt weggeschreven, niet alleen wanneer de lijst wordt getekend:

- **Overgangen terug worden geweigerd.** Een incident naar een status verplaatsen die eerder in de volgorde staat dan de huidige status mislukt met een foutmelding die beide statussen noemt.
- **De huidige status opnieuw kiezen wordt geweigerd.** Een incident zetten op de status waarin het al staat mislukt met "Incident state cannot be same as previous state."
- **Een teruggedateerde rij mag zijn buur niet dupliceren.** Een tijdlijnrij invoegen waarvan de status gelijk is aan de rij erna wordt ook geweigerd.
- **De knoppen in de kop volgen de positie van de gevlagde statussen in de volgorde.** **Acknowledge** en **Oplossen** worden aangeboden op basis van waar de huidige status staat in de op volgorde gesorteerde lijst. Een eigen status die *na* de opgeloste status staat toont nooit een knop **Oplossen**, omdat er niets meer over is om naar vooruit te bewegen.

Zet een status die je toevoegt dus daar waar een incident er echt doorheen zou komen. Verkeerd ordenen ziet er niet alleen raar uit — het maakt overgangen onmogelijk.

## De voorgeconfigureerde ernstniveaus

Drie ernstniveaus worden met het project aangemaakt, in deze volgorde:

- **Critical Incident** (`order` 1, `#b70400`) — problemen met zeer hoge impact op klanten, die om een onmiddellijke respons vragen. Een volledige storing of een datalek.
- **Major Incident** (`order` 2, `#fd625e`) — aanzienlijke impact, meestal met een onmiddellijke respons, soms met een tijdelijke oplossing die de schade beperkt. Een belangrijk subsysteem dat uitvalt.
- **Minor Incident** (`order` 3, `#ffbf53`) — lage impact, meestal binnen werktijd afgehandeld, en de meeste klanten merken er waarschijnlijk niets van. Een lichte terugval in applicatieprestaties.

Ernst is verplicht wanneer je een incident meldt, en verplicht op elke incidentspecificatie in de criteria van een monitor, dus elk incident — handmatig of automatisch — komt binnen met een ernst. Zie [Een incident melden](/docs/incidents/declaring-incidents) voor de meldflow en [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating) voor de route via monitoren.

## Ernstniveaus bewerken

Ga naar **Incidenten → Instellingen → Ernst van incident**. Dezelfde vorm als de statuspagina — een geordende lijst gesorteerd op `order`, slepen om te herschikken, nieuwe ernstniveaus achteraan, met **Naam**, **Beschrijving** en **Kleur** op het formulier.

Twee verschillen met statussen:

- **Er is geen verwijderbeveiliging.** Elke ernst kan worden verwijderd, ook de drie voorgeconfigureerde.
- **Er zijn geen vlaggen om te erven.** Een nieuwe ernst gedraagt zich precies als de voorgeconfigureerde — het is een label met een kleur en een positie.

**Een opmerking over de placeholders.** Het ernstformulier hergebruikt de voorbeeldteksten van het statusformulier woord voor woord, dus de hints hebben het over incidentstatussen in plaats van ernstniveaus. Negeer ze en schrijf je eigen namen en beschrijvingen voor ernst.

Waar ernst meer doet dan beschrijven: op **Incidenten → Regels → Bereikbaarheidsregels** is het veld **Incident Ernsten** van een regel een matchcriterium. **Critical Incident** daar opsommen is hoe je "page het databaseteam voor alles wat kritiek is" uitdrukt — het bereikbaarheidsbeleid staat op de regel, niet op de ernst.

## Een incident door zijn statussen bewegen

Er zijn vier manieren waarop een incident van status wisselt:

- **De knoppen in de kop.** Open een incident. Staat de huidige status vóór de bevestigd-status, dan krijg je **Acknowledge** en **Oplossen**; staat hij daartussenin, dan krijg je **Oplossen**. Elk opent een bevestigingsdialoog — **Acknowledge Incident** of **Resolve Incident** — die ook **Selecteer notitiesjabloon**, **Openbare notitie** en **Statuspagina-abonnees op de hoogte stellen** aanbiedt.
- **De statustijdlijn.** Voeg met de hand een rij toe vanaf de pagina **Statustijdlijn** van het incident, met **Incidentstatus**, **Begint op** en **Statuspagina-abonnees op de hoogte stellen**.
- **Bulkwijziging.** De incidentenlijst heeft een bulkactie **Status wijzigen** om meerdere incidenten tegelijk te verplaatsen.
- **Automatisch.** Een monitorcriterium met **Incident automatisch oplossen** aan lost zijn incident op zodra het criterium niet meer wordt gehaald, en de API kan de status bijwerken via `/api/incident-state-timeline`.

Elk van deze schrijft een tijdlijnrij. Een statuswijziging doet ook een paar dingen waar je niet om hoeft te vragen: er komt een item in de incidentfeed, er wordt een Incident Commander toegewezen als het incident er nog geen heeft, en de SLA-klok wordt bijgewerkt. Een opgelost incident heropenen start een vers SLA-record vanaf het moment van heropenen.

## De statustijdlijn

De pagina **Statustijdlijn** in het zijmenu van het incident is het auditspoor van elke status waarin het incident heeft gestaan. De kaart op die pagina heet **Statustijdlijn** en is nieuwste eerst gesorteerd.

**Kolommen:**

- **Incidentstatus** — een gekleurde pil met de naam en kleur van de status.
- **Begint op** — wanneer het incident deze status binnenkwam.
- **Eindigt op** — wanneer het hem verliet. De huidige status toont `Currently Active`.
- **Duur** — de tijd in die status, voor de huidige geteld tot nu.
- **Meldingsstatus abonnee** — of de statuspagina-melding voor deze wijziging is verstuurd, overgeslagen of nog in de wacht staat, met een link **meer details** en — als de verzending mislukte — een actie **Retry**.

**Rijacties:**

- **Oorzaak bekijken** — opent een dialoog **Hoofdoorzaak** met de markdown die bij die statuswijziging is vastgelegd.
- **Logboeken bekijken** — opent een dialoog die uitlegt waarom de status wijzigde, met een viewer **Incidentstatuslogboek**.

Tijdlijnrijen kun je aanmaken en verwijderen, maar niet bewerken. De verkeerde rij verwijderen herschrijft de geschiedenis van het incident, dus behandel het als correctiemiddel en niet als opruimgewoonte.

## De lijst Actieve incidenten

**Incidenten → Actieve incidenten** is de lijst waar je tijdens een dienst naar kijkt. De definitie is precies één voorwaarde: de huidige status van het incident is een status waar `isResolvedState` onwaar is. Verder telt niets mee — niet de ernst, niet de leeftijd, en niet of iemand het al heeft bevestigd.

Het item in het zijmenu draagt een rode tellerbadge op basis van dezelfde query, dus badge en lijst zijn het altijd eens. Is er niets te zien, dan zegt de pagina dat.

Het praktische gevolg: elke eigen status die je toevoegt houdt incidenten in deze lijst. Dat is meestal precies wat je wilt — "Gemitigeerd" is niet "klaar" — maar het betekent wel dat de badge pas leegloopt wanneer incidenten echt de opgeloste status bereiken.

## Statuspagina-abonnees over een statuswijziging vertellen

Een statuswijziging kan je statuspagina-abonnees mailen, maar hij moet door een aantal poorten. Die begrijpen scheelt een hoop uitzoekwerk van het type "waarom kreeg niemand bericht".

De melding wordt per tijdlijnrij aangevraagd met **Statuspagina-abonnees op de hoogte stellen** (`shouldStatusPageSubscribersBeNotified`), het vinkje op de statuswijzigingsdialoog en op het handmatige tijdlijnformulier. Staat het uit, dan wordt de rij opgeslagen met een overgeslagen-status en een uitleg. Staat het aan, dan gaat de rij in de wachtrij en pakt een achtergrondtaak hem op — die taak draait elke minuut, dus bezorging is snel maar niet ogenblikkelijk.

**De rij in de wachtrij wordt alsnog overgeslagen wanneer een van deze geldt:**

- **De nieuwe status is de aangemaakt-status.** Abonnees hoorden het al toen het incident werd gemeld, dus de eerste tijdlijnrij stuurt bewust geen tweede bericht.
- **Het incident heeft geen monitoren gekoppeld.** Zonder middelen is er geen statuspagina om het incident op af te beelden.
- **Het incident is niet zichtbaar op de statuspagina** (`isVisibleOnStatusPage` staat uit).
- **De statuspagina heeft incidenten uitgezet** (`showIncidentsOnStatusPage` staat uit). Dit geldt per statuspagina — andere pagina's die dezelfde monitor tonen krijgen nog steeds bericht.

**Nog één ding dat de uitkomst verandert.** Typ je een **Openbare notitie** in de statuswijzigingsdialoog, dan wordt de tijdlijnrij gemarkeerd als reeds gemeld in plaats van in de wachtrij gezet. De notitie zelf is wat abonnees bereikt, dus ze krijgen één bericht in plaats van twee. Het gebeurtenistype achter het kale statuswijzigingsbericht is `Subscriber Incident State Changed`.

Voor wie deze ontvangt en hoe de sjablonen worden gekozen, zie [Abonnees en aankondigingen](/docs/status-pages/subscribers).

## Een incident van de statuspagina houden

Drie losse dingen bepalen of een incident überhaupt op de openbare pagina staat, en alle drie moeten waar zijn:

- **Incidenten weergeven** (`showIncidentsOnStatusPage`) op de statuspagina zelf.
- **Zichtbaar op statuspagina** (`isVisibleOnStatusPage`) op het incident — een schakelaar op de pagina **Instellingen** van het incident. Hij staat standaard aan en zit niet in de meldwizard; een monitorcriterium kan hem zetten met **Incident weergeven op statuspagina**.
- **De huidige status is niet de opgeloste status.** Dit is wat een incident uit het actieve deel haalt: de statuspagina-query haalt incidenten op waarvan de huidige status een niet-opgeloste status is. Je archiveert of sluit niets — je lost het op, en het verhuist naar de geschiedenis.

**Privé-incidenten verschijnen nooit.** **Privé-incident** aanzetten verbergt het incident voor elke statuspagina, ongeacht bovenstaande schakelaars, en beperkt het tot zijn eigenaren plus projectbeheerders en -eigenaren.

Hoeveel opgeloste geschiedenis de pagina bewaart is een instelling van de statuspagina, niet van het incident. Zie [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups) voor hoe de monitoren op de pagina bepalen welke incidenten er überhaupt verschijnen.

## Waar verder lezen

- [Incidenten – Overzicht](/docs/incidents/index) — hoe het functiegebied Incidenten in elkaar past.
- [Een incident melden](/docs/incidents/declaring-incidents) — de meldwizard, sjablonen en de API.
- [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed) — openbare notities, privénotities en de activiteitenfeed.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — sjablonen, aangepaste velden, regels en workflow-triggers.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie de e-mails krijgt die een statuswijziging verstuurt.
- [Statuspagina's – Overzicht](/docs/status-pages/index) — wat een statuspagina toont en aan wie.
- [Workflows – Overzicht](/docs/workflows/index) — met automatisering reageren op statuswijzigingen.
