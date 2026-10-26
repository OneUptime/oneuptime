# Slack

Koppel OneUptime aan Slack om incidenten, waarschuwingen, episodes, gepland onderhoud, monitoren en updates van de bereikbaarheidsdienst in je kanalen te plaatsen, elk incident een eigen kanaal te geven en responders te laten handelen zonder Slack te verlaten: bevestigen, oplossen, notities toevoegen, de dienst oproepen en incidenten melden.

:::cards
- [Slack koppelen](#slack-koppelen): Installeer OneUptime in je workspace en koppel daarna je eigen account.
- [Iedereen vragen hun account te koppelen](#iedereen-vragen-hun-account-te-koppelen): Stuur in één keer een bericht aan elk lid dat zijn account nog niet heeft gekoppeld.
- [Meldingsregels](#meldingsregels): Bepaal welke gebeurtenissen waar worden geplaatst, en welke een eigen kanaal krijgen.
- [Wie er in het kanaal van een record zit](#wie-er-in-het-kanaal-van-een-record-zit): Zie wie erin zit, neem deel en voeg mensen toe, vanaf de pagina van het record.
- [Het commando /oneuptime](#het-commando-oneuptime): Meld incidenten, plan onderhoud, zie wie er dienst heeft en stel vragen aan AI.
- [Gebruikersgroepen voor bereikbaarheid](#gebruikersgroepen-voor-bereikbaarheid): Houd een gebruikersgroep gelijk aan wie er dienst heeft, en roep die op.
- [Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Slack](#handelen-op-incidenten-waarschuwingen-en-gebeurtenissen-vanuit-slack): De knoppen in de berichten van OneUptime.
:::

## Hoe het werkt

```mermaid title="Van een gebeurtenis in OneUptime naar een bericht in Slack"
flowchart TB
    event["Een incident, waarschuwing of gebeurtenis<br/>wordt aangemaakt of verandert"] --> rules{"Meldingsregels<br/>waarvan de voorwaarden kloppen"}
    rules -->|"Een kanaal<br/>voor elk"| own["Een eigen kanaal,<br/>met de mensen uitgenodigd zodra ze erbij komen"]
    rules -->|"In bestaande kanalen plaatsen"| existing["Je bestaande kanalen"]
    own --> message["Een bericht met knoppen"]
    existing --> message
    message -->|"Een responder drukt er een in"| change["De wijziging gebeurt in OneUptime,<br/>als die responder"]
```

Twee koppelingen maken dit mogelijk:

- **De koppeling van het project**, één keer gemaakt: de app van OneUptime geïnstalleerd in je Slack-workspace. Die plaatst de berichten, maakt de kanalen aan en nodigt mensen uit.
- **De eigen koppeling van elke persoon**: hun Slack-account gekoppeld aan hun OneUptime-account. Knoppen, commando's en emoji-reacties handelen als die persoon, met diens rechten in het project.

Eén Slack-workspace kan aan meer dan één project gekoppeld zijn, zoals productie en staging. Een knop of een formulier handelt in het project van het record waar het over gaat. Een commando of een bericht aan OneUptime handelt in het project van het kanaal waarin het staat, zoals het kanaal van een incident, of anders in het enige project waarin je Slack-account gekoppeld is. Als niets dat aangeeft, vraagt OneUptime welk project je bedoelt, met een knop voor elk project waarin je zit, en gaat het daar verder zodra je kiest. In een gesprek met OneUptime AI geldt je keuze voor de rest van de thread.

## Voordat je begint

- **Een rol die het project mag koppelen:** **Project Owner**, **Project Admin** of **Project Member**. De app verwijderen vereist **Project Owner** of **Project Admin**.
- **Een Slack-workspace** waarin je apps mag installeren.
- **Het Growth-abonnement op OneUptime Cloud** voor meldingsregels en samenvattingen. Zie [Meldingsregels onder het Growth-abonnement](#meldingsregels-onder-het-growth-abonnement).
- **Op een zelf gehoste server,** eerst een Slack-app die ervoor is ingesteld. Zie [Slack-integratie](/docs/self-hosted/slack-integration).

## Slack koppelen

:::steps
### OneUptime installeren in je Slack-workspace

Ga naar **Projectinstellingen** > **Werkruimte** > **Slack** en klik op **Connect with Slack**. Kies de workspace en sta OneUptime toe. Slack stuurt je terug naar dezelfde pagina, die nu de workspace noemt waaraan het project is gekoppeld. Zolang er geen workspace is gekoppeld, bevat de sectie **Werkruimte** van de menu's Incidenten, Waarschuwingen, Gepland onderhoud, Monitoren en Bereikbaarheidsdienst **Slack of Teams koppelen**, dat ook hierheen leidt.

### Je eigen Slack-account koppelen

Het installeren van de app koppelt het account van wie de app installeerde. Alle anderen koppelen hun eigen Slack-account onder **Gebruikersinstellingen** > **Werkruimte** > **Slack** met **Connect my account with Slack**, om als zichzelf op incidenten te handelen en directe berichten te krijgen. Die sectie verschijnt zodra het project aan Slack is gekoppeld. Zie [Iedereen vragen hun account te koppelen](#iedereen-vragen-hun-account-te-koppelen) om een heel team in één keer erbij te halen.

### Een meldingsregel toevoegen

Ga naar **Incidenten** > **Werkruimte** > **Slack**. De sectie **Werkruimte** toont alleen de chatworkspaces die je project heeft gekoppeld, dus **Slack** verschijnt daar zodra het is gekoppeld. Maak een regel aan, bijvoorbeeld een die voor elk nieuw incident een Slack-kanaal aanmaakt met iedereen die eraan werkt: de opgeroepen mensen, de Incident Commander en de eigenaren. Zie [Meldingsregels](#meldingsregels).

### De regel testen

Klik op **Testregel** in de rij van de regel. Er komt een testbericht aan in de kanalen die de regel noemt. Zie [Een regel testen](#een-regel-testen).
:::

## Iedereen vragen hun account te koppelen

Niemand kan het Slack-account van iemand anders koppelen, ook een beheerder niet: ieder meldt zich aan met zijn eigen account. Om een heel team erbij te halen, vraagt een **Project Owner** of **Project Admin** iedereen tegelijk op **Projectinstellingen** > **Werkruimte** > **Slack**. De kaart **Members' Slack accounts** zegt hoeveel leden hun account al hebben gekoppeld. **Ask everyone to connect** stuurt elk lid dat nog niet gekoppeld is een direct bericht van OneUptime in Slack, met een knop **Connect Slack account** die het account met één klik koppelt.

- **Wie een bericht krijgt.** Elk lid van het project dat zijn Slack-account niet heeft gekoppeld en dat OneUptime in Slack via zijn e-mailadres vindt. Wie in de afgelopen 24 uur al is gevraagd, wordt niet opnieuw gevraagd, dus opnieuw vragen de volgende dag is alleen een herinnering voor wie zijn account nog steeds niet heeft gekoppeld.
- **Wat de kaart zegt.** Hoe ver het versturen is terwijl de berichten de deur uit gaan, en daarna wie het vroeg en hoeveel leden een bericht kregen. Leden die OneUptime niet via hun e-mailadres in Slack kon vinden, staan bij naam op de kaart: zij koppelen hun account zelf onder **Gebruikersinstellingen** > **Werkruimte** > **Slack**.
- **Wat de knop koppelt.** Het Slack-account van wie erop drukt en zich aanmeldt, aan diens eigen OneUptime-account. Een bericht dat aan iemand anders is doorgestuurd, koppelt niets aan het lid naar wie het was gestuurd.

## Meldingsregels

Een meldingsregel bepaalt welke gebeurtenissen in Slack worden geplaatst, en waar. Elk product heeft zijn eigen regels, onder **Werkruimte** > **Slack** in zijn menu:

| Product | Tabbladen op zijn **Slack**-pagina |
| --- | --- |
| **Incidenten** | **Incidenten**, **Incidentepisodes**, **Summary** |
| **Waarschuwingen** | **Waarschuwingen**, **Waarschuwing Episodes**, **Summary** |
| **Geplande onderhoud** | Eén lijst met regels |
| **Monitoren** | Eén lijst met regels |
| **Bereikbaarheidsdienst** | Eén lijst met regels |

Een regel aanmaken gaat in vier stappen:

| Stap | Wat je instelt |
| --- | --- |
| **Basis** | **Regelnaam** en **Regelbeschrijving**. |
| **Voorwaarden** | Voor welke gebeurtenissen de regel geldt, bijvoorbeeld op ernst, status, label, monitor of woorden in de titel. Ze worden gecontroleerd wanneer een gebeurtenis wordt aangemaakt en opnieuw bij elke update die OneUptime erover plaatst, dus een regel voor bevestigde incidenten werkt zodra een incident wordt bevestigd. Een nieuwe regel geldt voor elke gebeurtenis, bijvoorbeeld **Alle incidenten**. Om de regel in te perken, kies **Alleen incidenten die aan de voorwaarden voldoen** en voeg de voorwaarden toe. Met twee of meer bepaalt **Overeenkomstvoorwaarde** of ze allemaal moeten kloppen, of één ervan. |
| **Bestemming** | Waar hij plaatst: **In bestaande kanalen plaatsen** met de kanaalnamen, **Een kanaal aanmaken voor elk incident** (of waarschuwing, episode, evenement, monitor of bereikbaarheidsbeleid) met wie er lid van wordt, of allebei. Onder de stap zegt **Wat deze regel doet** het in zinnen, zoals de kaart van de regel. |
| **Video Call** | Alleen incidenten en waarschuwingen: start voor elk een gesprek. Zie [Videogesprekken](/docs/workspace-connections/video-calls). |

Een kanaal dat de regel aanmaakt, krijgt de naam van zijn record: incident INC-42 krijgt `inc-42`, waarschuwing ALT-7 krijgt `alt-7` en in een project zonder nummervoorvoegsels krijgt incident 42 `incident-42`. Tekst in **Voorvoegsel van de kanaalnaam** komt ervoor, dus `prod-` wordt `prod-inc-42`, en het formulier toont de naam terwijl je typt. Bij een geplande onderhoudsgebeurtenis neemt het voorvoegsel de plaats in van het nummervoorvoegsel: SM-5 krijgt `sm-5` en `maint-` wordt `maint-5`. Slack neemt kleine letters, cijfers, `-` en `_`, tot 80 tekens. Bestaat er al een kanaal met die naam, zoals dat van een ander project of een gearchiveerd kanaal, dan voegt OneUptime `-2`, `-3` enzovoort toe.

Een regel maakt zijn kanaal aan de eerste keer dat een gebeurtenis eraan voldoet: wanneer de gebeurtenis wordt aangemaakt, of later, wanneer een update haar laat voldoen terwijl ze nog open is. Een regel voor bevestigde incidenten maakt het kanaal aan zodra het incident wordt bevestigd. Een privé-incident, -waarschuwing of -episode krijgt een privékanaal.

**Wie lid wordt van het kanaal** toont wie de regel aan zijn kanaal toevoegt, ieder zodra die bij het record komt, niet alleen bij het aanmaken van het kanaal: **Bereikbare medewerkers, zodra ze worden opgeroepen**, **Incident Commander en andere incidentrollen, zodra ze worden toegewezen** (incidenten en incidentepisodes) en **Eigenaren, zodra ze worden toegevoegd**, bij een nieuwe regel allemaal aangevinkt, en de mensen, teams en bereikbaarheidsschema's in **Ook uitnodigen** bij het aanmaken van het kanaal. De Incident Commander wordt meestal toegewezen wanneer iemand het incident voor het eerst bevestigt, en wordt dan lid van het kanaal. Een regel die is opgeslagen voordat incidentrollen een eigen vakje hadden, voegt ze toe wanneer hij de eigenaren of de bereikbare medewerkers toevoegt, en zijn vakje staat aangevinkt. Een bestaand kanaal waarin een regel plaatst, krijgt niemand.

Voor een bereikbaarheidsschema in **Ook uitnodigen** geldt: wie er bij het aanmaken van het kanaal dienst heeft in het schema, zoals de pagina ervan laat zien, wordt lid van het kanaal zonder te worden opgeroepen. Wil je alleen mensen toevoegen aan de kanalen van sommige incidenten, geef dan een tweede regel die voorwaarden en die mensen, met hetzelfde **Voorvoegsel van de kanaalnaam** als de eerste: regels waaraan een incident voldoet wanneer zijn kanaal wordt aangemaakt, delen dat kanaal, en elke regel voegt zijn eigen mensen toe.

Elke latere update van het record — een statuswijziging, een notitie, een nieuwe eigenaar — wordt in zijn kanalen geplaatst, en in de bestaande kanalen die zijn regels noemen zolang hun voorwaarden kloppen. Met **Kanaal archiveren wanneer het incident is opgelost** aan, of de tegenhanger ervan voor waarschuwingen, episodes, evenementen, monitoren en bereikbaarheidsbeleid, archiveert de regel die een kanaal aanmaakte het wanneer het record is opgelost, voltooid of verwijderd, wat zijn voorwaarden dan ook zeggen. Een incident, waarschuwing of episode die al opgelost werd aangemaakt, krijgt geen eigen kanaal; het aanmaakbericht gaat nog wel naar de kanalen die je regels noemen. Zie [Al bevestigd of opgelost gemeld](/docs/incidents/declaring-incidents#al-bevestigd-of-opgelost-gemeld).

Een incident, waarschuwing, episode of geplande onderhoudsgebeurtenis met een eigen kanaal heeft **Openen in Slack** in de kop van zijn pagina in OneUptime, naast de statusknoppen. Die opent dat kanaal in een nieuw tabblad, in de Slack-app of in de browser. Een record met twee eigen kanalen toont ze allebei onder de knop. Een record met kanalen in zowel Slack als Microsoft Teams heeft in plaats daarvan één knop **Kanaal openen**, die ze allemaal toont. De bestaande kanalen waarin uw regels posten, worden niet aangeboden.

Een kanaal blijft leesbaar: elke gebeurtenis wordt één keer geplaatst, en de eerste status van een record staat in het bericht dat het record aankondigt, niet in een eigen bericht. Een uitvoering van een bereikbaarheidsbeleid is één bericht dat wordt bewerkt terwijl de uitvoering escaleert: wie werd opgeroepen, hoe vaak en hoe, wie niet en waarom, en wie bevestigde. Een nieuw bericht wordt alleen geplaatst als iemand moet handelen: een escalatieregel bereikte niemand, of de uitvoering eindigde zonder dat iemand bevestigde. Iemand van wie het Slack-account niet met OneUptime is verbonden, wordt toegevoegd via het Slack-account met diens e-mailadres. Iemand die OneUptime op geen van beide manieren vindt, of die gast is in Slack, kan niet aan een kanaal worden toegevoegd; OneUptime zegt dat één keer per kanaal, in één bericht dat hen allemaal noemt en wordt bewerkt als de lijst groeit. Stuur ze de link **Connect Slack account** uit dat bericht, zodat ze hun account in één stap koppelen. Dat de eigenaren van het record of de abonnees van de statuspagina bericht kregen, blijft in zijn feed in OneUptime staan.

**Projectinstellingen** > **Werkruimte** > **Slack** toont de kanalen die OneUptime kan zien, met **Test verzenden** naast elk kanaal. OneUptime treedt zelf toe tot een openbaar kanaal de eerste keer dat het daar plaatst. Een privékanaal wordt pas getoond, en kan pas berichten ontvangen, nadat de app van OneUptime er in Slack voor is uitgenodigd.

## Wie er in het kanaal van een record zit

Een incident, waarschuwing, episode of geplande onderhoudsgebeurtenis met een eigen Slack-kanaal heeft een kaart **Slack-kanaal** op zijn pagina in OneUptime. De kaart toont het kanaal, als link die het in Slack opent, of het privé is en wie erin zit, jij eerst. Vanaf de kaart, zonder Slack-beheerder:

- **Deelnemen aan kanaal** voegt jou toe, als je niet in het kanaal zit.
- **Mensen toevoegen** opent een lijst van de mensen en teams van het project: kies iemand om die toe te voegen, of een team om iedereen erin toe te voegen.

De app van OneUptime voegt ze toe, zoals hij de mensen van het kanaal van een regel toevoegt. De app blijft in de kanalen die hij aanmaakt, dus dit werkt ook voor een privékanaal dat iedereen heeft verlaten.

- **Wie mensen mag toevoegen.** Wie het record mag bewerken: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** en **Incident Member** voor een incident, of **Edit Incident** in een aangepaste rol, en dezelfde toestemming voor een waarschuwing, een episode of een gebeurtenis (bijvoorbeeld **Edit Alert**). Ieder ander ziet wie er in het kanaal zit, en hoe je erin komt.
- **Wie kan worden toegevoegd.** Iemand die OneUptime in Slack vindt: via het Slack-account dat diegene heeft gekoppeld, of anders via het e-mailadres dat Slack van diegene heeft. De kaart noemt wie hij niet kon toevoegen, en waarom, zoals een gast die Slack buiten het kanaal houdt.
- **Wat wordt vastgelegd.** Wie is toegevoegd, en door wie, in de feed van het record (**Kanaallid toegevoegd**) en in **Projectinstellingen** > **Meldingen** > **Meldingslogboeken**, op het tabblad **Werkruimte**.
- **Iemand eruit halen.** OneUptime voegt alleen toe: haal iemand in Slack uit het kanaal.

## Een regel testen

**Testregel** in de rij van een regel plaatst een testbericht voor die regel in de kanalen die hij noemt, zodat je het ziet aankomen. Als de regel voor elke gebeurtenis een kanaal aanmaakt, maakt de test er ook een aan en nodigt de mensen van de regel uit.

Net als **Test verzenden** naast een kanaal in **Projectinstellingen** > **Werkruimte** > **Slack** vereist het rechten om meldingsregels aan te maken: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, of **Create Workspace Notification Rule** en **Read Workspace Notification Rule** in een aangepaste rol. Voor iemand die de regels alleen mag bekijken, zoals een **Viewer**, is **Testregel** vergrendeld, en de tooltip zegt wat er nodig is; de API weigert diens test met "You do not have permission to send test notifications in this project." Op OneUptime Cloud vereist het testen van een regel het **Growth**-abonnement, net als het toevoegen ervan.

Op OneUptime Cloud vereist **Test verzenden** naast een kanaal ook het **Growth**-abonnement, omdat in een kanaal plaatsen is wat regels en samenvattingen doen. **Test nu verzenden** bij een samenvatting vereist rechten om samenvattingen aan te maken (**Create Workspace Notification Summary** en **Read Workspace Notification Summary** in een aangepaste rol) en, op OneUptime Cloud, het **Growth**-abonnement; voor ieder ander is het vergrendeld, en de tooltip zegt wat er nodig is. Een MCP-client die met alleen-lezen toegang is gekoppeld, kan geen enkele test versturen.

## Samenvattingen

Het tabblad **Summary** van **Incidenten** > **Werkruimte** > **Slack** (en van **Waarschuwingen**) plaatst een terugkerend overzicht in de kanalen die je noemt: hoeveel incidenten of waarschuwingen er waren, hoe snel ze werden bevestigd en opgelost, en een lijst met links. Elke week gaat er een nieuwe samenvatting uit, over de afgelopen 7 dagen. Laat **Eerste rapport verzenden om** leeg, en de eerste gaat om 09:00 uit aan het begin van de volgende week, dag of maand; het formulier zegt wanneer.

Een samenvatting gaat uit volgens de klok van zijn **Tijdzone**, die begint met de jouwe. Hij houdt daar het hele jaar zijn tijdstip: een die op 09:00 in Berlijn is ingesteld, gaat na de overgang naar zomertijd nog steeds om 09:00 in Berlijn uit, en de datums in zijn bericht zijn ook die van Berlijn. Stuur via de API `timezone` mee als IANA-tijdzonenaam, zoals `Europe/Berlin`. Een samenvatting die zonder tijdzone wordt aangemaakt, neemt de tijdzone uit het profiel van wie hem aanmaakte, of UTC als een API-sleutel hem aanmaakt.

Het formulier van een samenvatting heeft vier stappen: **Basisinformatie** (de naam en de kanalen), **Schema**, **Inhoud** (**Wat op te nemen**) en **Filters** (welke incidenten of waarschuwingen hij telt).

## Meldingsregels onder het Growth-abonnement

Op OneUptime Cloud horen meldingsregels en samenvattingen bij het **Growth**-abonnement en hoger. Een project daaronder houdt de regels en samenvattingen die het al heeft, en die blijven in Slack plaatsen. Daarom toont de **Slack**-pagina van elk product (Incidenten, Waarschuwingen, Gepland onderhoud, Bereikbaarheidsdienst, Monitoren) de abonnementsmelding met die regels eronder (**Nog ingestelde meldingsregels**, **Nog ingestelde samenvattingen**): verwijder een regel, of zet een samenvatting uit of verwijder hem. Regels en samenvattingen toevoegen of wijzigen vereist **Growth**.

## Opgeroepen worden in Slack

Om met een direct bericht te worden opgeroepen als je dienst hebt, voeg je Slack toe als een van je meldingsmethoden:

:::steps
1. Koppel je eigen Slack-account (zie [Slack koppelen](#slack-koppelen)).
2. Ga naar **Gebruikersinstellingen** > **Meldingsmethoden**, open het tabblad **Workspace Apps** en klik op **Add Slack Account**.
3. Klik op **Send Test Message** in de rij ervan. Het bericht komt aan in je directe berichten in Slack.
:::

Toevoegen zet het meteen in je bereikbaarheidsregels, dus vanaf dan bereiken oproepen je in Slack. Wijzig welke oproepen het krijgt onder **Gebruikersinstellingen** > **Bereikbaarheidsregels**.

## Berichten als notities opslaan

Reageer op een bericht in het kanaal van een incident, waarschuwing, episode of geplande onderhoudsgebeurtenis, en OneUptime slaat het op als notitie bij dat record en bevestigt dat met een antwoord in de thread:

| Reactie | Opgeslagen als |
| --- | --- |
| 📌 Een punaise-emoji, of Slacks eigen **Pin to channel** | Een privénotitie, alleen zichtbaar voor je team |
| 📢 Een megafoon- of luidspreker-emoji | Een openbare notitie, getoond op de statuspagina. Alleen incidenten en geplande onderhoudsgebeurtenissen. Bij een privé-incident een privénotitie, en de bevestiging zegt waarom. |

De notitie houdt het bericht zoals Slack het liet zien: de opmaak, links en code, de personen en kanalen die het noemt bij naam, en de bestanden en afbeeldingen als links ernaar. Een openbare notitie laat de bestanden en afbeeldingen weg, omdat die alleen voor je team opengaan.

Het zijn de woorden van wie het bericht schreef: diens OneUptime-naam als diens Slack-account gekoppeld is, anders de naam die Slack toont. Een privénotitie komt in de tijdlijn op het moment dat het bericht werd geplaatst, hoe lang daarna ze ook wordt opgeslagen. Een openbare notitie komt erin op het moment dat ze wordt opgeslagen, dus wanneer de statuspagina haar toont. De tijdlijn zegt wie haar opsloeg. De notitie wordt niet teruggeplaatst in het kanaal, waar het bericht al staat.

De notitie wordt als jou opgeslagen, met jouw rechten. Is je Slack-account nog niet gekoppeld, dan vraagt OneUptime je om het te koppelen, in een bericht dat alleen jij ziet, met een knop die het bericht opslaat zodra je dat hebt gedaan. Een bericht wordt maar één keer opgeslagen, hoeveel mensen er ook op reageren.

## Het commando /oneuptime

OneUptime heeft één commando in Slack, `/oneuptime`. Het woord dat je erachter typt, zegt wat er moet gebeuren; al het andere erachter is een vraag aan OneUptime AI.

| Commando | Wat het doet |
| --- | --- |
| `/oneuptime help` | Toont de commando's, met voorbeelden. |
| `/oneuptime incident [title or number]` | Opent het incidentformulier, met de titel ingevuld. Het nummer van een incident, zoals `42` of `INC-42`, toont in plaats daarvan dat incident: zie [Een incident beheren vanuit Slack](#een-incident-beheren-vanuit-slack). |
| `/oneuptime maintenance [title]` | Opent het formulier voor gepland onderhoud, met de titel ingevuld. |
| `/oneuptime oncall` | Toont wie er nu dienst heeft in elk bereikbaarheidsschema dat je kunt zien, tot wanneer, en wie de volgende is. |
| `/oneuptime page [who] [message]` | Roept de mensen op die je met @ noemt, over je bericht, of opent een formulier om te kiezen wie je oproept. Zie [Iemand oproepen vanuit Slack](#iemand-oproepen-vanuit-slack). |
| `/oneuptime ask [question]`, of elke vraag | OneUptime AI beantwoordt vragen over je logs, traces, metrieken, incidenten en monitoren. |

De antwoorden op `help` en `oncall` zijn berichten die alleen jij ziet, onder het commando. Een eerste woord dat lijkt op een verkeerd getypt commando, zoals `incidnet`, krijgt het commando waarop het lijkt, geen antwoord van OneUptime AI. De formulieren voor incidenten en onderhoud werken namens jou: zie [Incidenten en onderhoud aanmaken vanuit Slack](#incidenten-en-onderhoud-aanmaken-vanuit-slack).

> [!NOTE]
> `/oneuptime incident` en `/oneuptime maintenance` vervangen `/incident` en `/maintenance`, die konden botsen met gelijknamige commando's van andere Slack-apps. Een Slack-app die vanuit een eerder manifest is aangemaakt, houdt ze, en ze openen dezelfde formulieren, tot de app wordt bijgewerkt: zie [Apps aangemaakt vanuit een ouder manifest](/docs/self-hosted/slack-integration#apps-aangemaakt-vanuit-een-ouder-manifest).

## De startpagina van OneUptime in Slack

Open OneUptime onder **Apps** in de zijbalk van Slack: het tabblad **Home** laat zien wat er in het project gebeurt, zoals jij het mag zien, en wordt bij elke keer openen opnieuw gelezen.

- **Jouw dienst.** De bereikbaarheidsschema's waarin je nu dienst hebt, en tot wanneer, of anders je volgende dienst.
- **Wat open is.** De nieuwste open incidenten en waarschuwingen die je mag lezen, elk met een link naar de pagina ervan in OneUptime.
- **De knoppen.** **Declare incident**, **Schedule maintenance** en **Page someone** openen dezelfde formulieren als `/oneuptime incident`, `/oneuptime maintenance` en `/oneuptime page`, en **Who's on call** antwoordt zoals `/oneuptime oncall`.

De startpagina leest als jou, dus heeft ze je eigen gekoppelde Slack-account nodig. Zolang dat niet zo is, staat er een knop **Connect Slack account** op, en zodra je het hebt gekoppeld, zie je je startpagina.

Als iemand OneUptime aan een kanaal toevoegt, plaatst het daar een begroeting: hoe je het een vraag stelt en waar je een meldingsregel toevoegt die in het kanaal plaatst. De eerste keer dat je het tabblad **Messages** opent, heet het je daar welkom: wat het in Slack doet en hoe je begint.

## OneUptime AI vragen vanuit Slack

Stel in gewone taal vragen over je logs, traces, metrieken, incidenten en monitoren. Noem OneUptime met @ in een kanaal, of stuur het een direct bericht, en het antwoordt in de thread. `/oneuptime ask which monitors are down?` plaatst het antwoord in het kanaal. Beide vereisen dat je eigen Slack-account gekoppeld is en dat AI voor het project aanstaat. Antwoorden in Slack lezen alleen: gebruik de knoppen om iets te wijzigen. Zie [AI vragen](/docs/ai/ask-ai).

OneUptime antwoordt alleen op wat aan OneUptime gericht is.

- **In je eigen gesprek antwoord je gewoon.** Een vraag die je in een kanaal stelt, niet in een thread, begint een gesprek in de thread eronder: antwoord daar om meer te vragen zonder OneUptime opnieuw te noemen, en iedereen anders doet mee door OneUptime te noemen.
- **In elke andere thread noem je OneUptime.** Onder het bericht van een incident bijvoorbeeld noem je OneUptime elke keer: wat mensen daar aan elkaar schrijven, krijgt geen antwoord.
- **Als je Slack-account niet gekoppeld is.** OneUptime vraagt je één keer per gesprek om het te koppelen, in een bericht dat alleen jij ziet, met een knop **Connect Slack account**.

## Incidenten en onderhoud aanmaken vanuit Slack

`/oneuptime incident` en `/oneuptime maintenance` openen een formulier dat je als jezelf invult en verstuurt: als het OneUptime-account waaraan je Slack-account is gekoppeld (zie [Slack koppelen](#slack-koppelen)), met de rechten van dat account in het project. Als je Slack-account niet gekoppeld is, of je OneUptime-account geen lid meer is van het project, vertelt OneUptime je waar je de opdracht gaf, in een bericht dat alleen jij ziet, wat je moet doen, en gaat er geen formulier open. De snelkoppelingen **Create New Incident** en **Create Scheduled Event** openen dezelfde formulieren.

- **Wie ze mag gebruiken.** De mensen die in OneUptime een incident mogen melden of een geplande onderhoudsgebeurtenis mogen aanmaken: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** en **Incident Member** voor een incident (**Create Incident** in een aangepaste rol), en **Scheduled Maintenance Admin** en **Scheduled Maintenance Member** voor een gebeurtenis (**Create Scheduled Maintenance**). Ieder ander krijgt dat te horen waar die de opdracht gaf, en er gaat geen formulier open.
- **Wat een formulier aanbiedt.** Elke lijst — ernstniveaus, monitoren, monitorstatussen, bereikbaarheidsbeleid en labels — bevat wat jij mag lezen, net als dezelfde lijst in OneUptime: met een rol die tot enkele labels beperkt is, de monitoren en het bereikbaarheidsbeleid met die labels. Een lijst die je helemaal niet mag lezen, blijft weg uit het formulier. Gearchiveerd bereikbaarheidsbeleid wordt nooit aangeboden.
- **Wat een formulier mag noemen.** Het incident of de gebeurtenis wordt aangemaakt met jouw eigen rechten en op jouw naam gezet. Een monitor, bereikbaarheidsbeleid, label, ernstniveau of status die je niet mag lezen, of een uit een ander project, wordt geweigerd alsof het project die niet heeft, zelfs vanuit een formulier dat werd geopend voordat je toegang veranderde, en er wordt niets aangemaakt. OneUptime vertelt je in het kanaal waarom, in een bericht dat alleen jij ziet.

**Execute On-Call Policy** op een incident, waarschuwing of episode werkt op dezelfde manier: het vereist rechten om een bereikbaarheidsbeleid uit te voeren (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** en **On-Call Member**, of **Create On-Call Duty Policy Execution Log** in een aangepaste rol) en om dat incident, die waarschuwing of die episode te lezen, en het biedt het actieve bereikbaarheidsbeleid aan dat je mag lezen.

## Iemand oproepen vanuit Slack

`/oneuptime page @nawaz The checkout API is throwing 500s` roept Nawaz meteen op. OneUptime maakt een waarschuwing aan met je bericht als titel, en elke persoon die je met @ noemt krijgt een telefoontje, een sms, een pushmelding of een e-mail, zoals diens eigen bereikbaarheidsregels zeggen, tot iemand de waarschuwing bevestigt.

- **Wie meteen wordt opgeroepen.** De mensen die je met @ noemt, en wie er dienst heeft in de schema's die een gebruikersgroep volgt die je met @ noemt (zie [Gebruikersgroepen voor bereikbaarheid](#gebruikersgroepen-voor-bereikbaarheid)), als er een bericht op hen volgt. OneUptime herkent iemand aan het OneUptime-account waaraan diens Slack-account is gekoppeld, of anders aan het e-mailadres dat Slack van diegene heeft. Niemand buiten het project wordt opgeroepen.
- **Al het andere opent een formulier.** Zonder iemand met @ genoemd, zonder bericht, met `@here`, met een gebruikersgroep die geen bereikbaarheidsschema volgt dat je kunt zien, of met iemand die OneUptime niet herkent, opent het formulier **Page someone** met wat je typte al ingevuld, en zegt het wie het niet kon kiezen. Kies mensen, een team, een bereikbaarheidsschema, dat oproept wie er nu dienst in heeft, of een bereikbaarheidsbeleid, dat oproept via zijn escalatieregels, en verstuur het. Een naam die je eerst typt, zoals in `/oneuptime page Primary The disk is full`, kiest het schema, het team of het beleid met die naam.
- **Waar het te zien is.** Het kanaal toont de oproep als één bericht dat wordt bijgewerkt: wie werd opgeroepen en hoe, en wie bevestigde. Waar OneUptime niet kan posten, zoals in een privékanaal waarvoor het niet is uitgenodigd, zegt een bericht dat alleen jij ziet wie werd opgeroepen, met een link naar de waarschuwing.
- **Wie mag oproepen.** Iedereen die zowel een bereikbaarheidsbeleid mag uitvoeren als een waarschuwing mag aanmaken: **Project Owner**, **Project Admin** en **Project Member**, of **On-Call Member** samen met **Alert Member** (**Create On-Call Duty Policy Execution Log** en **Create Alert** in een aangepaste rol). Mensen, een team of een schema rechtstreeks oproepen, zonder bereikbaarheidsbeleid achter de oproep, vereist daarnaast toegang tot elk bereikbaarheidsbeleid van het project. Ieder ander krijgt dat te horen waar die de opdracht gaf, en niemand wordt opgeroepen. Op OneUptime Cloud vereist oproepen het Growth-abonnement: daaronder zegt OneUptime welk abonnement nodig is, en wordt niemand opgeroepen.

## Gebruikersgroepen voor bereikbaarheid

Houd een Slack-gebruikersgroep, zoals `@payments-oncall`, gelijk aan wie er dienst heeft in een of meer bereikbaarheidsschema's, zodat iedereen die met @ kan noemen om hen te bereiken. OneUptime past de leden van de groep aan bij elke overdracht en vervanging, en controleert de groep elke 15 minuten.

:::steps
### Een gebruikersgroep aan een schema koppelen

Open het schema onder **Bereikbaarheidsdienst** > **Bereikbaarheidsschema's**. Klik in de kaart **Slack-gebruikersgroepen** op **Gebruikersgroep koppelen**, en kies een van de gebruikersgroepen in je werkruimte, of **Nieuwe gebruikersgroep maken** met een naam en een alias. De leden worden meteen vervangen door wie er dienst heeft.

### De groep ook aan het secundaire schema koppelen

Voor een groep met zowel de primaire als de secundaire dienst koppel je dezelfde groep ook op de pagina van het secundaire schema. Een groep kan zoveel schema's volgen als je wilt.
:::

- **Wat de kaart toont.** Wie er nu in elke groep zit, de andere schema's die de groep volgt, en of die **Actueel** is. Wie dienst heeft maar niet in de groep kan, wordt genoemd, met de reden: OneUptime vindt iemand via diens gekoppelde Slack-account, of anders via het e-mailadres dat Slack van diegene heeft, en Slack houdt gasten buiten gebruikersgroepen.
- **Niemand heeft dienst.** Slack kan geen lege gebruikersgroep bewaren, dus OneUptime schakelt de groep uit tot iemand dienst heeft, en schakelt die dan weer in.
- **De groep oproepen.** `/oneuptime page @payments-oncall The checkout API is down` roept op wie er dienst heeft in de schema's die de groep volgt. Zie [Iemand oproepen vanuit Slack](#iemand-oproepen-vanuit-slack).
- **Wat Slack nodig heeft.** Gebruikersgroepen horen bij de betaalde abonnementen van Slack, en een werkruimte kan alleen de eigenaren en beheerders toestaan ze te wijzigen: de kaart zegt welke van de twee, en wat je kunt doen. Als Slack gekoppeld is voordat OneUptime gebruikersgroepen kon bijhouden, koppel het dan één keer opnieuw onder **Projectinstellingen** > **Werkruimte** > **Slack**.
- **Wie er een mag koppelen.** De rollen die schema's mogen bewerken: **Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** en **On-Call Member**, of **Edit On-Call Duty Policy Schedule** in een aangepaste rol. In OneUptime Cloud vraagt koppelen het abonnement **Growth**.
- **Ontkoppelen.** OneUptime past de groep niet meer aan. De groep en de leden blijven in Slack zoals ze zijn.

## Een incident beheren vanuit Slack

Het bericht van een incident heeft vier knoppen, **Acknowledge Incident**, **Resolve Incident**, **Add Note** en **View Incident**, en de rest in zijn menu, de knop met drie puntjes erachter:

| Menu-item | Wat het doet |
| --- | --- |
| **Change Severity** | Stelt de ernst van het incident in. |
| **Change Incident State** | Zet het incident in een latere status. |
| **Assign Role** | Geeft iemand een rol in het incident, zoals **Incident Commander**. Een rol voor één persoon gaat naar die persoon over. |
| **Page Someone** | Roept mensen, een team, wie in een schema nu dienst heeft, of een bereikbaarheidsbeleid op over het incident, tot iemand het bevestigt. |
| **Edit Custom Fields** | Stelt de aangepaste velden van het incident in, elk ingevuld met wat het incident bevat. Een leeg gelaten veld wordt gewist. |

`/oneuptime incident 42` toont incident 42, met deze knoppen en zijn menu, in een bericht dat alleen jij ziet. Typ het nummer zoals OneUptime het toont: `42`, `#42` of `INC-42`. In het eigen kanaal van een incident toont `/oneuptime incident` zonder meer dat incident.

- **Wie ze mag gebruiken.** De mensen die dezelfde wijziging in OneUptime mogen maken. **Change Severity** en **Edit Custom Fields** vereisen toestemming om het incident te bewerken: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** en **Incident Member**, of **Edit Incident** in een aangepaste rol. **Assign Role** vereist **Create Incident Member**, en **Delete Incident Member** om een rol voor één persoon over te dragen. **Page Someone** vereist wat **Execute On-Call Policy** vereist. Ieder ander hoort waarom, en er opent geen formulier.
- **Wat de formulieren aanbieden.** Wat jij in het project mag lezen. Een aangepast veld dat van de monitor van het incident wordt gekopieerd, ontbreekt, omdat het opnieuw zou worden gekopieerd, en een formulier bevat 40 velden: bewerk de rest in OneUptime.
- **Wat er gebeurt.** Het formulier sluit, en de wijziging wordt als jij gemaakt, zoals in OneUptime: de feed van het incident, en daarmee de kanalen van het incident, zeggen wat er veranderde, elk aangepast veld met zijn nieuwe waarde. Een waarde die niet bij het veld past, zoals tekst voor een getal, wordt onder het veld genoemd, en het formulier blijft open. **Page Someone** zegt wie werd opgeroepen, of waarom niemand; een incident dat al is opgelost, roept niemand op.
- **Berichten van vóór het menu.** Ze houden hun knop **Execute On-Call Policy**, en die blijft werken: **Page Someone** roept ook een bereikbaarheidsbeleid op. Waarschuwingen en episodes houden die van hen.

## Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Slack

De knoppen in de Slack-berichten van OneUptime handelen ook als jou: als het OneUptime-account waaraan je Slack-account is gekoppeld, met de rechten van dat account in het project. **Acknowledge**, **Resolve**, **Change State**, **Add Note** en **Execute On-Call Policy** op een incident, een waarschuwing of een episode, en **Mark as Ongoing**, **Mark as Complete**, **Change State** en **Add Note** op een geplande onderhoudsgebeurtenis, voeren elk de wijziging uit die dezelfde actie in OneUptime uitvoert, en die wordt daar op jouw naam gezet: de statustijdlijn en de feed van het record tonen dat jij de status hebt gewijzigd, en de notitie is van jou. Een notitie die vanuit een bericht met een emoji-reactie wordt opgeslagen, wordt op dezelfde manier geplaatst.

- **Wie ze mag gebruiken.** De mensen die dezelfde wijziging in OneUptime mogen maken. Een incident bevestigen, oplossen of de status ervan wijzigen vereist rechten om de status te wijzigen: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** en **Incident Member**, of **Create Incident State Timeline** in een aangepaste rol. Een waarschuwing, een episode of een geplande onderhoudsgebeurtenis vereist dezelfde rechten voor het eigen soort (**Create Alert State Timeline**, bijvoorbeeld), en een notitie vereist rechten om dat soort notitie te plaatsen. Ieder ander krijgt dat te horen, en er verandert niets.
- **Welke records.** Die je mag lezen, net als in OneUptime: met een rol die tot enkele labels beperkt is, de incidenten, waarschuwingen, episodes en gebeurtenissen met die labels. Een knop op een ander record zegt waarom, en er verandert niets: bij een incident waar je rol niet bij kan, "your access in this project does not include this incident. Ask a project admin for access to it."; bij een privé-incident waarvan je geen eigenaar bent, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; en bij een incident dat inmiddels is verwijderd, "the incident was not found. It may have been deleted." Op OneUptime Cloud wordt een wijziging die het abonnement van het project niet omvat, geweigerd met het abonnement dat ervoor nodig is.
- **Wat Change State aanbiedt.** De statussen die je mag lezen en waarnaar het record als volgende mag gaan, in de volgorde van het project: geen enkele vóór de status waarin het staat, voor een episode net als voor een incident, een waarschuwing of een geplande onderhoudsgebeurtenis, omdat een statuswijziging een record nooit terug omhoog in zijn lijst zet (zie [De volgorde is een echte beperking, geen weergavevoorkeur](/docs/incidents/states-and-severities#de-volgorde-is-een-echte-beperking-geen-weergavevoorkeur)). Als je er geen enkele mag lezen, krijg je te horen "No incident states are available to you in this project. Ask a project admin for access to them."; als het record in de laatste status staat die het kan bereiken, krijg je te horen "There is no later state to move this incident to." Geen van beide opent een leeg formulier.
- **Add Note bij een privé-incident of privé-episode.** Een privé-incident of privé-episode krijgt geen openbare notities, dus het formulier vraagt niet om een notitietype en voegt een privénotitie toe. Een formulier dat werd geopend voordat het privé werd, voegt ook een privénotitie toe, en zegt dat. Zie [Privé-incidenten krijgen alleen privénotities](/docs/incidents/notes-owners-and-feed#privé-incidenten-krijgen-alleen-privénotities).
- **Waar je antwoord krijgt.** Onder het bericht met de knop, in een bericht dat alleen jij ziet; alleen als Slack dat weigert, in een direct bericht. Een knop die te laat wordt ingedrukt, zegt wie je voor was, en wanneer, zoals "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Als je Slack-account niet gekoppeld is.** Het antwoord vraagt je het te koppelen, met een knop **Connect Slack account**. De knop opent je eigen Slack-instellingen in OneUptime en koppelt je account in één stap, nadat je zo nodig bij OneUptime bent ingelogd. Daarna maakt OneUptime af wat je indrukte, als jou, en antwoordt onder hetzelfde bericht; bij een knop die een formulier opent, of een opdracht, vraagt het je die opnieuw in te drukken of te geven. De knop werkt één keer, 30 minuten lang, en alleen voor het Slack-account dat hem indrukte: ingelogd in Slack als iemand anders koppelt hij niets.

## Ontkoppelen

- **Disconnect** ontkoppelt alleen je eigen Slack-account, en verwijdert daarmee ook je Slack-meldingsmethode.
- **Uninstall OneUptime from Slack**, op **Projectinstellingen** > **Werkruimte** > **Slack**, ontkoppelt het project. OneUptime stopt met plaatsen in Slack, en de **Werkruimte**-menu's tonen het niet meer. De meldingsregels en samenvattingen blijven bewaard voor als je opnieuw koppelt.

> [!WARNING]
> Verwijderen ontkoppelt ook het Slack-account van elk lid van het project, en verwijdert de Slack-meldingsmethoden en de bereikbaarheidsregels die ze gebruikten. Wie in Slack werd opgeroepen, wordt via zijn andere meldingsmethoden opgeroepen tot hij Slack opnieuw toevoegt.

## Je Slack-gegevens

OneUptime leest uit Slack alleen wat deze functies nodig hebben, met de rechten die je geeft als je het installeert:

- **Berichten aan OneUptime.** Een bericht dat het met @ noemt, een bericht dat je het in een direct bericht stuurt en je antwoorden in een gesprek ermee, samen met de eerdere berichten van die thread of dat directe bericht, zodat OneUptime AI kan antwoorden. Slack stuurt het ook de andere berichten van de kanalen en groepsberichten waarin het zit; OneUptime beantwoordt die niet en bewaart ze niet.
- **Berichten die je als notitie opslaat.** Een bericht waarop je met 📌 of 📢 reageert, of dat je vastmaakt, in het kanaal van een incident, waarschuwing, episode of geplande onderhoudsgebeurtenis, opgeslagen als notitie bij dat record met de naam van de schrijver.
- **Namen van kanalen en mensen.** De kanalen waarin het kan plaatsen, zodat je ze kunt kiezen, de namen van mensen, om te laten zien wie iets schreef of deed, en wie er in het eigen kanaal van een record zit, gelezen als de pagina van het record dat toont.
- **E-mailadressen.** Het e-mailadres dat Slack van iemand heeft, om diens Slack-account aan diens OneUptime-account te koppelen als diegene het niet zelf heeft gekoppeld: om diegene op te roepen, in een gebruikersgroep voor bereikbaarheid te zetten, aan het kanaal van een record toe te voegen of te vragen het te koppelen.
- **Gebruikersgroepen.** De gebruikersgroepen van je werkruimte, om er een te kiezen voor een bereikbaarheidsschema, en de mensen in een groep die je koppelt, om die gelijk te houden aan wie er dienst heeft.

Wat OneUptime ervan bewaart — de naam van de werkruimte, de kanalen, de Slack-accounts die mensen koppelen, de notities en de gebruikersgroepen — wordt bij je project opgeslagen. Het [Privacybeleid](https://oneuptime.com/legal/privacy) beschrijft hoe OneUptime met je gegevens omgaat.

## Problemen oplossen

:::details Een regel plaatst niets
Controleer de voorwaarden van de regel met **Testregel**: komt de test aan, dan klopten de voorwaarden van de regel niet voor de gebeurtenis. Komt hij niet aan, dan zegt de Slack-pagina waarom. Nodig voor een privékanaal eerst de app van OneUptime uit in Slack. Elk bericht dat OneUptime plaatst, en elk bericht dat Slack weigerde, staat in **Projectinstellingen** > **Meldingen** > **Meldingslogboeken**, op het tabblad **Werkruimte**.
:::

:::details Iemand ontbreekt in het kanaal van een regel
De kaart van de regel zegt onder **Daarna** wie de regel uitnodigt. Elk soort persoon wordt lid zodra die bij het record komt: de opgeroepen mensen zodra ze worden opgeroepen, de Incident Commander zodra die wordt toegewezen, een eigenaar zodra die wordt toegevoegd, en wie al bij het record hoorde toen het kanaal werd aangemaakt. Iemand die OneUptime niet in Slack kan vinden, via het account dat diegene heeft gekoppeld of via diens e-mailadres, kan niet worden toegevoegd; OneUptime noemt die persoon in het kanaal, met een link om het account te koppelen. Om iemand nu toe te voegen, druk je op **Mensen toevoegen** op de kaart **Slack-kanaal** van het record.
:::

:::details Iedereen heeft een privékanaal verlaten
Open het incident, de waarschuwing, de episode of de gebeurtenis in OneUptime en druk op **Deelnemen aan kanaal** op de kaart **Slack-kanaal**, en daarna op **Mensen toevoegen** om de anderen terug te halen. Daarvoor is toestemming nodig om het record te bewerken, geen Slack-beheerder: de app van OneUptime zit nog in het kanaal en voegt ze toe. Zegt de kaart dat OneUptime het kanaal niet kan zien, dan is het kanaal verwijderd of de app eruit gehaald: iemand in het kanaal kan de app terugzetten door `/invite @OneUptime` te typen.
:::

:::details Slack is niet gekoppeld
Als Slack je zonder koppeling terugstuurt, zegt de pagina waarop je begon **Slack is niet verbonden**, en één zin zegt waarom: je hebt het recht niet, de link was al gebruikt of verlopen, je bent bij een andere workspace aangemeld, of de server is niet ingesteld voor Slack. Zie [Het verbinden is niet voltooid](/docs/self-hosted/slack-integration#het-verbinden-is-niet-voltooid) voor elke zin en wat je moet doen.
:::

:::details Een knop of commando zegt dat mijn Slack-account niet gekoppeld is
Druk in dat antwoord op **Connect Slack account** om het in één stap te koppelen, of koppel het onder **Gebruikersinstellingen** > **Werkruimte** > **Slack** met **Connect my account with Slack**. Als je geen lid meer bent van het project, zegt OneUptime dat in plaats daarvan, en handelt het nergens op voor jou.
:::

:::details OneUptime antwoordt niet op een antwoord in een thread
Een antwoord waarin je OneUptime niet noemt, wordt alleen beantwoord in je eigen gesprek met OneUptime AI: de thread onder een vraag die je het in een kanaal stelde. In elke andere thread, zoals die onder het bericht van een incident, noem je OneUptime met @. Is je Slack-account niet gekoppeld, dan vraagt OneUptime je één keer per gesprek om het te koppelen, niet bij elk bericht: druk in dat bericht op **Connect Slack account**, of koppel het onder **Gebruikersinstellingen** > **Werkruimte** > **Slack**. Zie [OneUptime AI vragen vanuit Slack](#oneuptime-ai-vragen-vanuit-slack).
:::

:::details Meldingen komen aan, maar knoppen en commando's doen niets
Op een zelf gehoste server moet Slack OneUptime kunnen bereiken voor knoppen, formulieren en commando's; meldingen hebben alleen uitgaande toegang nodig. Zie [Netwerktoegang voor zelf gehoste installaties](/docs/self-hosted/slack-integration#netwerktoegang-voor-zelf-gehoste-installaties).
:::

## Volgende stappen

:::cards
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Dezelfde meldingen en acties in Microsoft Teams.
- [Videogesprekken](/docs/workspace-connections/video-calls): Geef elk incident een gesprek, geplaatst bij zijn updates.
- [Slack-integratie](/docs/self-hosted/slack-integration): De Slack-app instellen op een zelf gehoste server.
- [Een incident melden](/docs/incidents/declaring-incidents): Alle manieren waarop een incident begint, en wat er dan wordt uitgevoerd.
:::
