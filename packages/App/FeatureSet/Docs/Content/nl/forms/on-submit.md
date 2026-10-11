# Wat een inzending aanmaakt

Elke inzending via een formulier maakt één record aan in je project: een **incident** of een **geplande onderhoudsgebeurtenis**. De pagina **Bij verzenden** van een formulier toont welke, en hoe elk veld van het nieuwe record wordt ingevuld — uit een antwoord, uit een standaardwaarde, uit een instelling die altijd geldt, of uit het incidentsjabloon. **Instellingen bewerken** wijzigt de standaardwaarden en wat altijd geldt.

:::cards
- [Hoe een inzending een incident wordt](#hoe-een-inzending-een-incident-wordt): Elk veld van het nieuwe incident, en waar de waarde ervan vandaan komt.
- [Hoe een inzending een geplande onderhoudsgebeurtenis wordt](#hoe-een-inzending-een-geplande-onderhoudsgebeurtenis-wordt): Hetzelfde, voor een onderhoudsverzoek.
- [De instellingen Bij verzenden](#de-instellingen-bij-verzenden): Standaardwaarden, wat altijd wordt gekoppeld, eigenaren en publicatie.
- [De privénotitie](#de-privénotitie): Wie het inzond, en de antwoorden die in geen veld staan.
:::

## Wat er gebeurt bij verzenden

```mermaid title="Van een inzending naar een incident of een onderhoudsgebeurtenis"
flowchart TB
    submit["Verzenden"] --> checks["Beveiligingen en<br/>controle van de antwoorden"]
    checks --> fields["Elk veld: het antwoord,<br/>anders de instellingen Bij verzenden,<br/>anders het incidentsjabloon"]
    fields --> record["Het incident of de<br/>onderhoudsgebeurtenis"]
    record --> note["Een privénotitie: wie het inzond,<br/>en de andere antwoorden"]
    record --> runs["Regels, bereikbaarheidsbeleid<br/>en workflows worden uitgevoerd"]
```

Een inzending die een controle niet doorstaat, maakt niets aan. Zie [Wat een formulier beschermt](/docs/forms/sharing-and-security#wat-een-formulier-beschermt).

## Wat elke inzending aanmaakt

De kaart **Wat elke inzending aanmaakt** bevat de keuze die je maakte toen je het formulier aanmaakte:

- **Incident** — elke inzending meldt een incident, zodat je bereikbaarheidsdienst meteen wordt ingelicht. Gebruik het voor probleemmeldingen.
- **Geplande onderhoud** — elke inzending plant een onderhoudsgebeurtenis. Gebruik het voor wijzigings- en onderhoudsverzoeken.

De andere kiezen vraagt je om bevestiging, omdat het formulier ermee verandert:

- De titel, de beschrijving, de monitoren en de labels blijven gekoppeld: beide soorten records hebben ze.
- Elke andere gekoppelde vraag — een ernstniveau, een keuze van statuspagina, een aangepast veld van het oude soort — wordt een eigen vraag van het formulier, met dezelfde tekst, waarvan het antwoord in de privénotitie wordt getoond.
- De instellingen Bij verzenden beginnen opnieuw, omdat de instellingen van een incident en van een gebeurtenis verschillen.
- Een formulier dat nu onderhoudsgebeurtenissen aanmaakt, vraagt wanneer het onderhoud begint en eindigt.

De vragen worden meteen opgeslagen, samen met de wijziging. Controleer ze op de pagina **Bouwen**.

## Hoe een inzending een incident wordt

De kaart toont elk veld van het nieuwe incident en waar de waarde ervan vandaan komt:

| Veld | Komt uit |
| --- | --- |
| **Titel** | Het antwoord op de vraag **Titel**. Als het formulier hem niet vraagt, of hij leeg blijft: de **Standaardtitel**, of anders de naam van het formulier. |
| **Beschrijving** | Het antwoord op de vraag **Beschrijving**. Als hij niet wordt gevraagd of leeg blijft, de beschrijving van het incidentsjabloon, als het formulier een sjabloon heeft. |
| **Ernst** | De keuze van de inzender, als het formulier ernaar vraagt. Anders de instelling **Ernst** van het formulier, of anders het ernstniveau van het incidentsjabloon. |
| **Monitoren** | De monitoren die de inzender koos, samen met de monitoren die de instellingen altijd koppelen. Zonder een van beide, die van het incidentsjabloon. |
| **Labels** | De labels die de inzender koos, samen met de labels die de instellingen altijd toevoegen. Zonder een van beide, die van het incidentsjabloon. |
| **Begin van de impact** | Het antwoord op **Begin van de impact**, als het formulier ernaar vraagt. |
| **Incident Sjabloon** | De instelling **Incident Sjabloon** van het formulier. Die vult alles in wat de antwoorden en de instellingen niet hebben ingesteld. |
| **Bereikbaarheidsbeleid** | Het beleid dat de instellingen noemen, uitgevoerd voor elk incident dat het formulier meldt. Zonder beleid, dat van het incidentsjabloon. |
| **Eigenaren** | De mensen en teams die de instellingen noemen, samen met de eigenaren van het sjabloon. Zij worden over elk incident ingelicht. |
| **Aangepaste velden** | Het antwoord op elke vraag van een aangepast veld — tenzij het veld zijn waarde overneemt van een aangepast monitorveld en de monitoren van het incident er een hebben; het sjabloon vult de rest in. |
| **Statuspagina's** | Nooit getoond op statuspagina's, en abonnees worden niet ingelicht, tot iemand van je team het publiceert. |
| **Overige antwoorden** | Getoond in een privénotitie bij het incident, met wie het inzond. |

> [!IMPORTANT]
> **Geen ernstniveau, geen incident.** Een incident heeft een ernstniveau nodig. Als het formulier er niet naar vraagt en de instellingen er geen noemen — of het genoemde is verwijderd — en het sjabloon er ook geen instelt, waarschuwt de rij **Ernst** je, en wordt elke inzending geweigerd met "Met dit formulier kan geen incident worden aangemaakt, omdat er geen ernst is ingesteld. Laat het team dat het formulier heeft gedeeld dit weten." Kies een ernstniveau in **Instellingen bewerken**, of een sjabloon dat er een instelt.

### Het incidentsjabloon

Kies een **Incident Sjabloon** in de instellingen en elk incident dat het formulier meldt, wordt vanuit dat sjabloon gemeld, zoals de server overal een sjabloon toepast — zie [Hoe een sjabloon wordt toegepast](/docs/incidents/settings#hoe-een-sjabloon-wordt-toegepast). De antwoorden en de instellingen van het formulier gaan voor, en het sjabloon vult al het andere in: de beginstatus, de beschrijving, het ernstniveau, de getroffen resources, het bereikbaarheidsbeleid, de eigenaren, de labels, de waarden van aangepaste velden en een wijziging van de monitorstatus.

> [!WARNING]
> **Let op de monitoren.** Een incident op een monitor melden via een formulier heeft precies hetzelfde effect op de monitor als het handmatig melden: het actief bewaken van de monitor pauzeert tot het incident is opgelost, en de **Monitorstatus wijzigen naar** van een sjabloon wijzigt meteen de status van de monitor — op elke statuspagina die de monitor toont, zelfs als het incident zelf verborgen is. Met een formulier kan iedereen met de link dit doen. Koppel monitoren via een formulier alleen als elke inzending ze moet pauzeren.

### Hoe het incident eruitziet

Een incident dat via een formulier is gemeld, is een gewoon incident, met een paar eigen instellingen:

- **Verborgen op statuspagina's.** **Zichtbaar op statuspagina** staat uit, net als **Statuspagina-abonnees op de hoogte stellen**. Tot een responder het publiceert, bereikt niets van het incident een statuspagina of een abonnee — behalve de wijziging van de monitorstatus van een sjabloon, hierboven.
- **Door niemand gemeld.** De inzender is geen OneUptime-gebruiker, dus er staat geen gebruiker geregistreerd als melder van het incident.
- **De eigenaren worden ingelicht.** De eigenaren die de instellingen en het sjabloon noemen, worden toegevoegd zodra de Slack- en Microsoft Teams-kanalen van het incident bestaan, en krijgen een melding — de melding **Incident aangemaakt** van het incident wacht tot zij de eigenaren ervan zijn, zodat ze naar hen gaat in plaats van naar de eigenaren van het project.
- **Een privénotitie legt de inzending vast** — zie [De privénotitie](#de-privénotitie).

Alles wat voor een nieuw incident wordt uitgevoerd, wordt ook voor deze uitgevoerd: privacy-, eigenaar-, label-, bereikbaarheids- en runbookregels, bereikbaarheidsbeleid en workflows met **On Create Incident**. Bereikbaarheidsregels passen bij de incidenten van een formulier zoals bij elke andere — ook op hun titel en beschrijving, die de inzender schreef.

:::steps
#### Lees wat de inzender schreef

De titel en de beschrijving verschijnen op statuspagina's zodra het incident is gepubliceerd.

#### Publiceer het incident

Zet **Zichtbaar op statuspagina** aan op de pagina **Instellingen** van het incident.

#### Licht abonnees in, als ze het moeten weten

Omdat het incident werd gemeld met **Statuspagina-abonnees op de hoogte stellen** uit, verstuurt publiceren niet de melding "incident aangemaakt". Plaats om abonnees in te lichten een openbare notitie met **Statuspagina-abonnees op de hoogte stellen** aangevinkt — zie [Een openbare notitie plaatsen](/docs/incidents/notes-owners-and-feed#een-openbare-notitie-plaatsen).
:::

## Hoe een inzending een geplande onderhoudsgebeurtenis wordt

| Veld | Komt uit |
| --- | --- |
| **Titel** | Het antwoord op de vraag **Titel**. Als het formulier hem niet vraagt, of hij leeg blijft: de **Standaardtitel**, of anders de naam van het formulier. |
| **Beschrijving** | Het antwoord op de vraag **Beschrijving**. |
| **Begint op**, **Eindigt op** | De antwoorden op **Begint op** en **Eindigt op**, die elk onderhoudsformulier vraagt en verplicht maakt. Het einde moet na het begin liggen. |
| **Monitoren** | De monitoren die de inzender koos, samen met de monitoren die de instellingen altijd koppelen. |
| **Statuspagina's** | De statuspagina's die de inzender koos, samen met de statuspagina's die de instellingen noemen. |
| **Labels** | De labels die de inzender koos, samen met de labels die de instellingen altijd toevoegen. |
| **Eigenaren** | De mensen en teams die de instellingen noemen. Zij zijn eigenaar van elke gebeurtenis die het formulier plant. |
| **Tonen op statuspagina's** | **Nee** tenzij de instellingen het aanzetten. |
| **Abonnees op de hoogte stellen** | **Nee** tenzij de instellingen het aanzetten. |
| **Aangepaste velden** | Het antwoord op elke vraag van een aangepast veld — tenzij het veld zijn waarde overneemt van een aangepast monitorveld en de monitoren van de gebeurtenis er een hebben. |
| **Overige antwoorden** | Getoond in een privénotitie bij de gebeurtenis, met wie het inzond. |

De gebeurtenis begint in de status **Scheduled** van je project en gaat verder zoals elke andere: ze wordt lopend als ze begint en eindigt als ze afloopt.

Een inzending is iemands verzoek, en een verzoek wordt beoordeeld voordat het wordt gepubliceerd. Dus tenzij je het wijzigt, blijft de gebeurtenis van haar statuspagina's af tot iemand van je team haar toont, en worden haar abonnees niet ingelicht als ze wordt aangemaakt, begint of eindigt. **Tonen op statuspagina's** en **Abonnees op de hoogte stellen**, in de stap **Publicatie** van de instellingen, wijzigen dat voor elke gebeurtenis die het formulier plant — zet ze alleen aan als je iedereen met de link vertrouwt.

## De instellingen Bij verzenden

**Instellingen bewerken** opent de instellingen in stappen: **Volgende** gaat verder, en **Wijzigingen opslaan** staat in de laatste stap. Elke stap is al ingevuld, dus de stappenlijst naast het formulier opent elke stap, ook de laatste: wijzig een instelling in haar stap, open dan de laatste stap en sla op.

| Stap | Incidentformulier | Onderhoudsformulier |
| --- | --- | --- |
| **Standaardwaarden** | **Standaardtitel**, **Ernst**, **Incident Sjabloon** | **Standaardtitel** |
| **Altijd koppelen** | **Monitoren**, **Labels**, **Bereikbaarheidsbeleid** | **Monitoren**, **Statuspagina's**, **Labels** |
| **Eigenaren** | **Eigenaren** | **Eigenaren** |
| **Publicatie** | — | **Tonen op statuspagina's**, **Abonnees op de hoogte stellen** |

**Eigenaren** is één kiezer voor mensen en teams: **Eigenaar toevoegen** opent één zoeklijst met beide, en elke keuze verschijnt als een chip die je kunt verwijderen. Alles wat de instellingen noemen, moet bij het project van het formulier horen, en eigenaren moeten er lid van zijn. Een record dat is verwijderd nadat het werd gekozen, wordt overgeslagen als een inzending wordt aangemaakt, en de rest geldt nog steeds.

## De privénotitie

Elke inzending laat een privénotitie achter op wat ze aanmaakte:

> Submitted through the form **Report a Problem** by Ada Lovelace (<ada@example.com>).
>
> **Which office are you in?**\
> Berlin

Ze noemt het formulier en de inzender — "Submitted anonymously through the form **Report a Problem**." als het formulier niet vroeg wie het is —, zegt daarna, als de inzending met een van de sjablonen van het formulier begon, welk: "Started from the template **Application Outage**." — en toont dan de antwoorden op de eigen vragen van het formulier, elk onder zijn vraag, in de volgorde van het formulier. De antwoorden op gekoppelde vragen staan al op het record: de titel, het ernstniveau, de aangepaste velden. Omdat de notitie privé is, bereikt ze nooit een statuspagina, maar ze wordt wel in de Slack- en Microsoft Teams-kanalen van het record geplaatst, zoals elke andere notitie.

Het adres is een link die precies naar dat adres schrijft — in het dashboard, in Slack en in de e-mail aan de eigenaren.

## Verborgen vragen en sjablonen

Een [verborgen vraag](/docs/forms/building#verborgen-vragen) wordt beantwoord vanuit het [sjabloon](/docs/forms/building#sjablonen) waarmee de inzending begon — nooit vanuit het verzoek —, en het antwoord gaat precies waar een getypt antwoord zou gaan: een verborgen **Beschrijving** wordt de beschrijving van het incident, een verborgen aangepast veld de waarde ervan, een verborgen eigen vraag van het formulier een regel in de privénotitie. Een inzending die met geen enkel sjabloon begon, laat verborgen vragen onbeantwoord, en hun velden worden ingevuld vanuit de instellingen Bij verzenden, zoals bij elke vraag die leeg blijft. Een sjabloon dat wordt verwijderd terwijl iemand het formulier open had, houdt diens inzending niet tegen: die wordt aangemaakt zoals hij antwoordde, zonder de verborgen antwoorden van het sjabloon.

Een sjabloon kan de vragen van het formulier [op zijn eigen manier](/docs/forms/building#hoe-een-sjabloon-elke-vraag-stelt) stellen, en de server houdt de inzending aan de vragen zoals het genoemde sjabloon ze stelt. Een vraag die het sjabloon verbergt, wordt vanuit het sjabloon beantwoord, zoals een verborgen vraag, ook als het formulier hem stelt; een die het sjabloon stelt, wordt uit het verzoek gelezen, ook als het formulier hem verbergt; en een die het sjabloon verplicht maakt, moet worden beantwoord, anders wordt de inzending geweigerd en wordt er niets aangemaakt.

De antwoorden die een sjabloon op de pagina invulde, zijn van de inzender zodra hij verzendt: de server neemt de antwoorden die het verzoek meestuurt voor de vragen die de pagina stelt, wat het sjabloon ook zei.

## Tekst die een inzender schrijft

Een inzending gaat rechtstreeks naar plekken waar tekst vanzelf iets kan doen — Slack- en Microsoft Teams-kanalen, de browser van elke responder, de e-mails van de eigenaren — en niemand leest haar eerst. Dus voordat het record wordt aangemaakt:

| Wat de inzender schrijft | Wat er wordt opgeslagen |
| --- | --- |
| Een vermelding, zoals \<!channel\>, \<!here\> of \<@U0123ABC\>, in de titel, de beschrijving of een tekstantwoord | **Vermeldingen lichten niemand in.** Alles wat Slack als vermelding leest, krijgt een onzichtbaar teken na de openingshaak. Het leest overal hetzelfde, maar geen chattool reageert erop. |
| Een afbeelding, in de beschrijving of een antwoord **Opgemaakte tekst** | **Afbeeldingen worden links.** Elke afbeelding wordt een link naar hetzelfde adres, dus er wordt niets geladen van waar de inzender koos tot een responder erop klikt. |
| Een codeblok met de taal `mermaid`, hoe ook geschreven | **Diagrammen worden code.** Het wordt als gewone code opgeslagen, dus het toont zijn tekst in plaats van een diagram te tekenen. |
| Afbeeldingssyntaxis of een diagramblok in de titel | **De titel is platte tekst.** Ook die krijgen het onzichtbare teken, dus waar de titel ook terechtkomt — een episode, een chatbericht, een notitiesjabloon — hij laadt niets en tekent niets. De onzichtbare tekens tellen mee voor de limiet van de titel. |

Al het andere — links, de rest van de Markdown, keuzes uit keuzelijsten, getallen, datums, een aangevinkt vakje — wordt opgeslagen zoals de inzender het gaf, en de inzending bewaart de naam en het e-mailadres van de inzender zoals getypt.

## Volgende stappen

:::cards
- [Een formulier bouwen](/docs/forms/building): De vragen die deze velden vullen, verborgen vragen en sjablonen.
- [Incidentinstellingen en automatisering](/docs/incidents/settings): Incidentsjablonen en aangepaste velden.
- [Incidentnotities, eigenaren en feed](/docs/incidents/notes-owners-and-feed): Privénotities, openbare notities en eigenaren.
- [Delen & beveiliging](/docs/forms/sharing-and-security): Wie er mag inzenden, en hoe vaak.
:::
