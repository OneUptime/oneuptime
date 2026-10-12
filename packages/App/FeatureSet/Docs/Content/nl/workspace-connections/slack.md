# Slack

Koppel OneUptime aan Slack om incidenten, waarschuwingen, episodes, gepland onderhoud, monitoren en updates van de bereikbaarheidsdienst in je kanalen te plaatsen, elk incident een eigen kanaal te geven en responders te laten handelen zonder Slack te verlaten: bevestigen, oplossen, notities toevoegen, de dienst oproepen en incidenten melden.

:::cards
- [Slack koppelen](#slack-koppelen): Installeer OneUptime in je workspace en koppel daarna je eigen account.
- [Meldingsregels](#meldingsregels): Bepaal welke gebeurtenissen waar worden geplaatst, en welke een eigen kanaal krijgen.
- [Incidenten en onderhoud aanmaken vanuit Slack](#incidenten-en-onderhoud-aanmaken-vanuit-slack): `/incident` en `/maintenance`, als jezelf.
- [Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Slack](#handelen-op-incidenten-waarschuwingen-en-gebeurtenissen-vanuit-slack): De knoppen in de berichten van OneUptime.
:::

## Hoe het werkt

```mermaid title="Van een gebeurtenis in OneUptime naar een bericht in Slack"
flowchart TB
    event["Een incident, waarschuwing of gebeurtenis<br/>wordt aangemaakt of verandert"] --> rules{"Meldingsregels<br/>waarvan de voorwaarden kloppen"}
    rules -->|"Create Slack Channel"| own["Een eigen kanaal,<br/>met de mensen uitgenodigd"]
    rules -->|"Post to Existing Slack Channel"| existing["Je bestaande kanalen"]
    own --> message["Een bericht met knoppen"]
    existing --> message
    message -->|"Een responder drukt er een in"| change["De wijziging gebeurt in OneUptime,<br/>als die responder"]
```

Twee koppelingen maken dit mogelijk:

- **De koppeling van het project**, één keer gemaakt: de app van OneUptime geïnstalleerd in je Slack-workspace. Die plaatst de berichten, maakt de kanalen aan en nodigt mensen uit.
- **De eigen koppeling van elke persoon**: hun Slack-account gekoppeld aan hun OneUptime-account. Knoppen, commando's en emoji-reacties handelen als die persoon, met diens rechten in het project.

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

Het installeren van de app koppelt het account van wie de app installeerde. Alle anderen koppelen hun eigen Slack-account onder **Gebruikersinstellingen** > **Werkruimte** > **Slack** met **Connect my account with Slack**, om als zichzelf op incidenten te handelen en directe berichten te krijgen. Die sectie verschijnt zodra het project aan Slack is gekoppeld.

### Een meldingsregel toevoegen

Ga naar **Incidenten** > **Werkruimte** > **Slack**. De sectie **Werkruimte** toont alleen de chatworkspaces die je project heeft gekoppeld, dus **Slack** verschijnt daar zodra het is gekoppeld. Maak een regel aan, bijvoorbeeld een die voor elk nieuw incident een Slack-kanaal aanmaakt en de eigenaren van het incident uitnodigt. Zie [Meldingsregels](#meldingsregels).

### De regel testen

Klik op **Testregel** in de rij van de regel. Er komt een testbericht aan in de kanalen die de regel noemt. Zie [Een regel testen](#een-regel-testen).
:::

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
| **Voorwaarden** | Voor welke gebeurtenissen de regel afgaat, bijvoorbeeld op ernst, status, label, monitor of woorden in de titel. Zonder voorwaarden gaat hij af voor elke gebeurtenis. Met twee of meer bepaalt **Overeenkomstvoorwaarde** of ze allemaal moeten kloppen, of één ervan. |
| **Bestemming** | Waar hij plaatst: **Post to Existing Slack Channel** met de kanaalnamen, **Create Slack Channel** met de naam van het nieuwe kanaal en wie er wordt uitgenodigd, of allebei. |
| **Video Call** | Alleen incidenten en waarschuwingen: start voor elk een gesprek. Zie [Videogesprekken](/docs/workspace-connections/video-calls). |

Een kanaal dat de regel aanmaakt, krijgt zijn naam van **New Slack Channel Name** gevolgd door het nummer van het record, zoals `oneuptime-incident-42`, en alleen een aangemaakt kanaal krijgt de mensen die de regel uitnodigt: de eigenaren van het record, gekozen teams en gebruikers en, bij incidenten en waarschuwingen, de mensen van de dienst zodra ze worden opgeroepen. Een privé-incident, -waarschuwing of -episode krijgt een privékanaal. Elke latere update van het record — een statuswijziging, een notitie, een nieuwe eigenaar — wordt in zijn kanalen geplaatst en in de bestaande kanalen die zijn regels noemen. Een incident, waarschuwing of episode die al opgelost werd aangemaakt, krijgt geen eigen kanaal; het aanmaakbericht gaat nog wel naar de kanalen die je regels noemen. Zie [Al bevestigd of opgelost gemeld](/docs/incidents/declaring-incidents#al-bevestigd-of-opgelost-gemeld).

**Projectinstellingen** > **Werkruimte** > **Slack** toont de kanalen die OneUptime kan zien, met **Test verzenden** naast elk kanaal. OneUptime treedt zelf toe tot een openbaar kanaal de eerste keer dat het daar plaatst. Een privékanaal wordt pas getoond, en kan pas berichten ontvangen, nadat de app van OneUptime er in Slack voor is uitgenodigd.

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
| 📢 Een megafoon- of luidspreker-emoji | Een openbare notitie, getoond op de statuspagina. Alleen incidenten en geplande onderhoudsgebeurtenissen. |

De notitie wordt als jou opgeslagen, met jouw rechten, dus je eigen Slack-account moet gekoppeld zijn. Een bericht wordt maar één keer opgeslagen, hoeveel mensen er ook op reageren.

## OneUptime AI vragen vanuit Slack

Stel in gewone taal vragen over je logs, traces, metrieken, incidenten en monitoren. Noem OneUptime met @ in een kanaal, of stuur het een direct bericht, en het antwoordt in de thread; antwoord daar om meer te vragen. `/oneuptime ask which monitors are down?` plaatst het antwoord in het kanaal. Beide vereisen dat je eigen Slack-account gekoppeld is en dat AI voor het project aanstaat. Antwoorden in Slack lezen alleen: gebruik de knoppen om iets te wijzigen. Zie [AI vragen](/docs/ai/ask-ai).

## Incidenten en onderhoud aanmaken vanuit Slack

`/incident` en `/maintenance` openen een formulier dat je als jezelf invult en verstuurt: als het OneUptime-account waaraan je Slack-account is gekoppeld (zie [Slack koppelen](#slack-koppelen)), met de rechten van dat account in het project. Als je Slack-account niet gekoppeld is, of je OneUptime-account geen lid meer is van het project, vertelt OneUptime je in een direct bericht wat je moet doen, en gaat er geen formulier open. De snelkoppelingen **Create New Incident** en **Create Scheduled Event** openen dezelfde formulieren.

- **Wie ze mag gebruiken.** De mensen die in OneUptime een incident mogen melden of een geplande onderhoudsgebeurtenis mogen aanmaken: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** en **Incident Member** voor een incident (**Create Incident** in een aangepaste rol), en **Scheduled Maintenance Admin** en **Scheduled Maintenance Member** voor een gebeurtenis (**Create Scheduled Maintenance**). Ieder ander krijgt dat te horen in een direct bericht, en er gaat geen formulier open.
- **Wat een formulier aanbiedt.** Elke lijst — ernstniveaus, monitoren, monitorstatussen, bereikbaarheidsbeleid en labels — bevat wat jij mag lezen, net als dezelfde lijst in OneUptime: met een rol die tot enkele labels beperkt is, de monitoren en het bereikbaarheidsbeleid met die labels. Een lijst die je helemaal niet mag lezen, blijft weg uit het formulier. Gearchiveerd bereikbaarheidsbeleid wordt nooit aangeboden.
- **Wat een formulier mag noemen.** Het incident of de gebeurtenis wordt aangemaakt met jouw eigen rechten en op jouw naam gezet. Een monitor, bereikbaarheidsbeleid, label, ernstniveau of status die je niet mag lezen, of een uit een ander project, wordt geweigerd alsof het project die niet heeft, zelfs vanuit een formulier dat werd geopend voordat je toegang veranderde, en er wordt niets aangemaakt. OneUptime vertelt je in een direct bericht waarom.

**Execute On-Call Policy** op een incident, waarschuwing of episode werkt op dezelfde manier: het vereist rechten om een bereikbaarheidsbeleid uit te voeren (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** en **On-Call Member**, of **Create On-Call Duty Policy Execution Log** in een aangepaste rol) en om dat incident, die waarschuwing of die episode te lezen, en het biedt het actieve bereikbaarheidsbeleid aan dat je mag lezen.

## Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Slack

De knoppen in de Slack-berichten van OneUptime handelen ook als jou: als het OneUptime-account waaraan je Slack-account is gekoppeld, met de rechten van dat account in het project. **Acknowledge**, **Resolve**, **Change State**, **Add Note** en **Execute On-Call Policy** op een incident, een waarschuwing of een episode, en **Mark as Ongoing**, **Mark as Complete**, **Change State** en **Add Note** op een geplande onderhoudsgebeurtenis, voeren elk de wijziging uit die dezelfde actie in OneUptime uitvoert, en die wordt daar op jouw naam gezet: de statustijdlijn en de feed van het record tonen dat jij de status hebt gewijzigd, en de notitie is van jou. Een notitie die vanuit een bericht met een emoji-reactie wordt opgeslagen, wordt op dezelfde manier geplaatst.

- **Wie ze mag gebruiken.** De mensen die dezelfde wijziging in OneUptime mogen maken. Een incident bevestigen, oplossen of de status ervan wijzigen vereist rechten om de status te wijzigen: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** en **Incident Member**, of **Create Incident State Timeline** in een aangepaste rol. Een waarschuwing, een episode of een geplande onderhoudsgebeurtenis vereist dezelfde rechten voor het eigen soort (**Create Alert State Timeline**, bijvoorbeeld), en een notitie vereist rechten om dat soort notitie te plaatsen. Ieder ander krijgt dat te horen in een direct bericht, en er verandert niets.
- **Welke records.** Die je mag lezen, net als in OneUptime: met een rol die tot enkele labels beperkt is, de incidenten, waarschuwingen, episodes en gebeurtenissen met die labels. Een knop op een ander record, of op een uit een ander project, krijgt als antwoord dat het record "was not found in this project, or you do not have access to it.", en er verandert niets. Op OneUptime Cloud wordt een wijziging die het abonnement van het project niet omvat, geweigerd met het abonnement dat ervoor nodig is.
- **Wat Change State aanbiedt.** De statussen die je mag lezen en waarnaar het record als volgende mag gaan, in de volgorde van het project: geen enkele vóór de status waarin het staat, voor een episode net als voor een incident, een waarschuwing of een geplande onderhoudsgebeurtenis, omdat een statuswijziging een record nooit terug omhoog in zijn lijst zet (zie [De volgorde is een echte beperking, geen weergavevoorkeur](/docs/incidents/states-and-severities#de-volgorde-is-een-echte-beperking-geen-weergavevoorkeur)). Als je er geen enkele mag lezen, krijg je te horen "No incident states are available to you in this project. Ask a project admin for access to them."; als het record in de laatste status staat die het kan bereiken, krijg je te horen "There is no later state to move this incident to." Geen van beide opent een leeg formulier.

## Ontkoppelen

- **Disconnect** ontkoppelt alleen je eigen Slack-account, en verwijdert daarmee ook je Slack-meldingsmethode.
- **Uninstall OneUptime from Slack**, op **Projectinstellingen** > **Werkruimte** > **Slack**, ontkoppelt het project. OneUptime stopt met plaatsen in Slack, en de **Werkruimte**-menu's tonen het niet meer. De meldingsregels en samenvattingen blijven bewaard voor als je opnieuw koppelt.

> [!WARNING]
> Verwijderen ontkoppelt ook het Slack-account van elk lid van het project, en verwijdert de Slack-meldingsmethoden en de bereikbaarheidsregels die ze gebruikten. Wie in Slack werd opgeroepen, wordt via zijn andere meldingsmethoden opgeroepen tot hij Slack opnieuw toevoegt.

## Problemen oplossen

:::details Een regel plaatst niets
Controleer de voorwaarden van de regel met **Testregel**: komt de test aan, dan klopten de voorwaarden van de regel niet voor de gebeurtenis. Komt hij niet aan, dan zegt de Slack-pagina waarom. Nodig voor een privékanaal eerst de app van OneUptime uit in Slack. Elk bericht dat OneUptime plaatst, en elk bericht dat Slack weigerde, staat in **Projectinstellingen** > **Meldingen** > **Meldingslogboeken**, op het tabblad **Werkruimte**.
:::

:::details Slack is niet gekoppeld
Als Slack je zonder koppeling terugstuurt, zegt de pagina waarop je begon **Slack is niet verbonden**, en één zin zegt waarom: je hebt het recht niet, de link was al gebruikt of verlopen, je bent bij een andere workspace aangemeld, of de server is niet ingesteld voor Slack. Zie [Het verbinden is niet voltooid](/docs/self-hosted/slack-integration#het-verbinden-is-niet-voltooid) voor elke zin en wat je moet doen.
:::

:::details Een knop of commando zegt dat mijn Slack-account niet gekoppeld is
Koppel het onder **Gebruikersinstellingen** > **Werkruimte** > **Slack** met **Connect my account with Slack**. Als je geen lid meer bent van het project, zegt OneUptime dat in plaats daarvan, en handelt het nergens op voor jou.
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
