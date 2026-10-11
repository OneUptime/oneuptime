# Microsoft Teams

Koppel OneUptime aan Microsoft Teams om incidenten, waarschuwingen, episodes, gepland onderhoud, monitoren en updates van de bereikbaarheidsdienst in je kanalen en chats te plaatsen, elk incident een eigen kanaal te geven en responders vanuit Teams te laten handelen: bevestigen, oplossen, notities toevoegen, de dienst oproepen, incidenten melden en OneUptime AI vragen stellen.

:::cards
- [Microsoft Teams koppelen](#microsoft-teams-koppelen): Beheerderstoestemming, je aanmelding en de app in elk team.
- [Meldingsregels](#meldingsregels): Bepaal welke gebeurtenissen waar worden geplaatst, en welke een eigen kanaal krijgen.
- [Praten met de OneUptime-bot](#praten-met-de-oneuptime-bot): Commando's, vragen en formulieren in een chat met de bot.
- [Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Microsoft Teams](#handelen-op-incidenten-waarschuwingen-en-gebeurtenissen-vanuit-microsoft-teams): De knoppen op de kaarten van OneUptime.
:::

## Hoe het werkt

```mermaid title="Van een gebeurtenis in OneUptime naar een kaart in Microsoft Teams"
flowchart TB
    event["Een incident, waarschuwing of gebeurtenis<br/>wordt aangemaakt of verandert"] --> rules{"Meldingsregels<br/>waarvan de voorwaarden kloppen"}
    rules -->|"Create Microsoft Teams Channel"| own["Een eigen kanaal<br/>in het team dat je kiest"]
    rules -->|"Plaatsen in een bestaand<br/>kanaal of een bestaande chat"| existing["Je kanalen en chats"]
    own --> card["Een kaart met knoppen"]
    existing --> card
    card -->|"Een responder drukt er een in"| change["De wijziging gebeurt in OneUptime,<br/>als die responder"]
```

Drie dingen maken dit mogelijk:

- **De koppeling van het project**, één keer gemaakt: een Microsoft 365-beheerder geeft toestemming voor de OneUptime-app voor je organisatie.
- **De OneUptime-app in elk team** waarin je meldingen wilt. Microsoft laat de bot alleen plaatsen in een team waaraan hij is toegevoegd.
- **De eigen koppeling van elke persoon**: hun Microsoft Teams-account gekoppeld aan hun OneUptime-account. Knoppen, commando's en reacties handelen als die persoon, met diens rechten in het project.

## Voordat je begint

- **Een rol die het project mag koppelen:** **Project Owner**, **Project Admin** of **Project Member**. Verwijderen vereist **Project Owner** of **Project Admin**.
- **Een Microsoft 365-beheerder** die beheerderstoestemming geeft, één keer voor de hele organisatie.
- **Het Growth-abonnement op OneUptime Cloud** voor meldingsregels en samenvattingen. Zie [Meldingsregels onder het Growth-abonnement](#meldingsregels-onder-het-growth-abonnement).
- **Op een zelf gehoste server,** eerst een Teams-bot die ervoor is ingesteld. Zie [Microsoft Teams-integratie](/docs/self-hosted/microsoft-teams-integration).

## Microsoft Teams koppelen

:::steps
### Beheerderstoestemming geven

Ga naar **Projectinstellingen** > **Werkruimte** > **Microsoft Teams** en klik op **Beheerderstoestemming verlenen**. Een Microsoft 365-beheerder meldt zich aan en staat de OneUptime-app toe voor de organisatie. De kaart zegt daarna **Admin Consent Completed**. Zolang er geen workspace is gekoppeld, bevat de sectie **Werkruimte** van de menu's Incidenten, Waarschuwingen, Gepland onderhoud, Monitoren en Bereikbaarheidsdienst **Slack of Teams koppelen**, dat ook hierheen leidt.

### Je account koppelen

Klik op **Connect with Microsoft Teams** en meld je aan met je werkaccount. OneUptime leest de teams van je organisatie; **Teams bekijken** toont ze.

### De OneUptime-app aan elk team toevoegen (verplicht)

Je account koppelen is op zichzelf niet genoeg. Microsoft laat de OneUptime-bot alleen plaatsen in een team waaraan hij is toegevoegd, dus doe dit voor elk team waarin je meldingen wilt:

- Klik in Microsoft Teams op de "..." naast de **teamnaam** (niet de kanaalnaam).
- Kies **Manage team** > **Apps** > **More apps**, zoek **OneUptime** en klik op **Add**.

Op OneUptime Cloud opent **Teams Store openen** de app in de Microsoft Teams Store, waar **Add to a team** hetzelfde doet. Installeer op een zelf gehoste server in plaats daarvan het pakket van **App-manifest-zip downloaden**: alleen dat bevat de bot van je server. Als een testmelding zegt dat de OneUptime-app niet in het team is geïnstalleerd, is dit de stap die werd overgeslagen.

### Alle anderen koppelen

Elke persoon koppelt zijn eigen Microsoft Teams-account onder **Gebruikersinstellingen** > **Werkruimte** > **Microsoft Teams** met **Connect my account with Microsoft Teams**, om als zichzelf op incidenten te handelen en directe berichten te krijgen. Die sectie verschijnt zodra het project aan Microsoft Teams is gekoppeld.

### Een meldingsregel toevoegen

Ga naar **Incidenten** > **Werkruimte** > **Microsoft Teams**. De sectie **Werkruimte** toont alleen de chatworkspaces die je project heeft gekoppeld, dus **Microsoft Teams** verschijnt daar zodra het is gekoppeld. Maak een regel aan, bijvoorbeeld een die in een Teams-kanaal plaatst als er een incident wordt aangemaakt, en klik dan op **Testregel** in de rij ervan.
:::

> [!NOTE]
> OneUptime voor jezelf installeren, of aan een chat toevoegen, is een andere installatie en laat het niet in de kanalen van een team plaatsen. **Privékanalen** hebben de app nodig in het kanaal zelf: open het kanaal > "..." > **Manage channel** > **Apps** > **Add an app**. **Gedeelde kanalen** kunnen geen meldingen ontvangen: Microsoft Teams ondersteunt geen bots in gedeelde kanalen.

## Meldingsregels

Een meldingsregel bepaalt welke gebeurtenissen in Microsoft Teams worden geplaatst, en waar. Elk product heeft zijn eigen regels, onder **Werkruimte** > **Microsoft Teams** in zijn menu:

| Product | Tabbladen op zijn **Microsoft Teams**-pagina |
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
| **Bestemming** | Waar hij plaatst: een bestaand kanaal van een team dat je kiest, de chats die je kiest, een nieuw kanaal dat wordt aangemaakt in een team dat je kiest, of meerdere daarvan samen. |
| **Video Call** | Alleen incidenten en waarschuwingen: start voor elk een gesprek. Zie [Videogesprekken](/docs/workspace-connections/video-calls). |

Een kanaal dat de regel aanmaakt, krijgt zijn naam van **New Microsoft Teams Channel Name** gevolgd door het nummer van het record, zoals `oneuptime-incident-42`, en alleen een aangemaakt kanaal krijgt de mensen die de regel uitnodigt. Een privé-incident, -waarschuwing of -episode krijgt een privékanaal. Elke latere update van het record — een statuswijziging, een notitie, een nieuwe eigenaar — wordt in zijn kanalen en chats geplaatst.

**Projectinstellingen** > **Werkruimte** > **Microsoft Teams** toont de kanalen die OneUptime in je teams ziet, en de chats waaraan het is toegevoegd, met **Test verzenden** naast elk ervan. Een chat verschijnt zodra de OneUptime-app er in Microsoft Teams aan wordt toegevoegd; **Refresh Chats** haalt nieuwe chats en hun huidige namen op.

## Een regel testen

**Testregel** in de rij van een regel plaatst een testbericht voor die regel in de kanalen die hij noemt, zodat je het ziet aankomen. Als de regel voor elke gebeurtenis een kanaal aanmaakt, maakt de test er ook een aan en nodigt de mensen van de regel uit.

Net als **Test verzenden** naast een kanaal in **Projectinstellingen** > **Werkruimte** > **Microsoft Teams** vereist het rechten om meldingsregels aan te maken: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, of **Create Workspace Notification Rule** en **Read Workspace Notification Rule** in een aangepaste rol. Voor iemand die de regels alleen mag bekijken, zoals een **Viewer**, is **Testregel** vergrendeld, en de tooltip zegt wat er nodig is; de API weigert diens test met "You do not have permission to send test notifications in this project." Op OneUptime Cloud vereist het testen van een regel het **Growth**-abonnement, net als het toevoegen ervan.

Op OneUptime Cloud vereist **Test verzenden** naast een kanaal of een chat ook het **Growth**-abonnement, omdat in een kanaal plaatsen is wat regels en samenvattingen doen. **Test nu verzenden** bij een samenvatting vereist rechten om samenvattingen aan te maken (**Create Workspace Notification Summary** en **Read Workspace Notification Summary** in een aangepaste rol) en, op OneUptime Cloud, het **Growth**-abonnement; voor ieder ander is het vergrendeld, en de tooltip zegt wat er nodig is. Een MCP-client die met alleen-lezen toegang is gekoppeld, kan geen enkele test versturen.

## Samenvattingen

Het tabblad **Summary** van **Incidenten** > **Werkruimte** > **Microsoft Teams** (en van **Waarschuwingen**) plaatst een terugkerend overzicht in de kanalen die je noemt: hoeveel incidenten of waarschuwingen er waren, hoe snel ze werden bevestigd en opgelost, en een lijst met links. Elke week gaat er een nieuwe samenvatting uit, over de afgelopen 7 dagen. Laat **Eerste rapport verzenden om** leeg, en de eerste gaat om 09:00 uit aan het begin van de volgende week, dag of maand; het formulier zegt wanneer.

Een samenvatting gaat uit volgens de klok van zijn **Tijdzone**, die begint met de jouwe. Hij houdt daar het hele jaar zijn tijdstip: een die op 09:00 in Berlijn is ingesteld, gaat na de overgang naar zomertijd nog steeds om 09:00 in Berlijn uit, en de datums in zijn bericht zijn ook die van Berlijn. Stuur via de API `timezone` mee als IANA-tijdzonenaam, zoals `Europe/Berlin`. Een samenvatting die zonder tijdzone wordt aangemaakt, neemt de tijdzone uit het profiel van wie hem aanmaakte, of UTC als een API-sleutel hem aanmaakt.

Het formulier van een samenvatting heeft vier stappen: **Basisinformatie** (de naam, de kanalen en hun **Teamnaam**), **Schema**, **Inhoud** (**Wat op te nemen**) en **Filters** (welke incidenten of waarschuwingen hij telt).

## Meldingsregels onder het Growth-abonnement

Op OneUptime Cloud horen meldingsregels en samenvattingen bij het **Growth**-abonnement en hoger. Een project daaronder houdt de regels en samenvattingen die het al heeft, en die blijven in Microsoft Teams plaatsen. Daarom toont de **Microsoft Teams**-pagina van elk product (Incidenten, Waarschuwingen, Gepland onderhoud, Bereikbaarheidsdienst, Monitoren) de abonnementsmelding met die regels eronder (**Nog ingestelde meldingsregels**, **Nog ingestelde samenvattingen**): verwijder een regel, of zet een samenvatting uit of verwijder hem. Regels en samenvattingen toevoegen of wijzigen vereist **Growth**.

## Opgeroepen worden in Microsoft Teams

Om met een direct bericht te worden opgeroepen als je dienst hebt, voeg je Microsoft Teams toe als een van je meldingsmethoden:

:::steps
1. Koppel je eigen Microsoft Teams-account (zie [Microsoft Teams koppelen](#microsoft-teams-koppelen)).
2. Ga naar **Gebruikersinstellingen** > **Meldingsmethoden**, open het tabblad **Workspace Apps** en klik op **Add Microsoft Teams Account**.
3. Klik op **Send Test Message** in de rij ervan. Het bericht komt aan in je chats in Microsoft Teams.
:::

Toevoegen zet het meteen in je bereikbaarheidsregels, dus vanaf dan bereiken oproepen je in Microsoft Teams. Wijzig welke oproepen het krijgt onder **Gebruikersinstellingen** > **Bereikbaarheidsregels**.

## Berichten als notities opslaan

Reageer op een bericht, of een antwoord, in het kanaal dat OneUptime aanmaakte voor een incident, waarschuwing, episode of geplande onderhoudsgebeurtenis, en OneUptime slaat het op als notitie bij dat record. Het pikt de reactie binnen een minuut op en bevestigt dat met een antwoord in de thread:

| Reactie | Opgeslagen als |
| --- | --- |
| 📌 of 📍 | Een privénotitie, alleen zichtbaar voor je team |
| 📣 of 📢 | Een openbare notitie, getoond op de statuspagina. Alleen incidenten en geplande onderhoudsgebeurtenissen. |

De notitie wordt als jou opgeslagen, met jouw rechten, dus je eigen Microsoft Teams-account moet gekoppeld zijn, en de OneUptime-app moet in het team zitten.

## Praten met de OneUptime-bot

Stuur de bot een bericht in een persoonlijke chat, of noem OneUptime met @ in een kanaal of een groepschat: daar antwoordt hij alleen als hij wordt genoemd.

| Bericht | Wat de bot doet |
| --- | --- |
| `help` | Toont wat hij kan. |
| `ask <question>`, of elke vraag in gewone taal | OneUptime AI beantwoordt vragen over je logs, traces, metrieken, incidenten en monitoren, bijvoorbeeld "welke monitoren liggen er nu uit?". Antwoorden lezen alleen. |
| `create incident [title]` | Opent het incidentformulier, met de titel ingevuld. |
| `create maintenance [title]` | Opent het formulier voor gepland onderhoud, met de titel ingevuld. |
| `show active incidents`, `show active alerts` | Toont wat er nu openstaat. |
| `show scheduled maintenance`, `show ongoing maintenance` | Toont komende, of lopende, onderhoudsgebeurtenissen. |

OneUptime AI vragen stellen vereist dat AI voor het project aanstaat. Zie [AI vragen](/docs/ai/ask-ai).

## Incidenten en onderhoud aanmaken vanuit Microsoft Teams

`create incident` of `create maintenance` typen aan de OneUptime-bot opent een formulier voor de persoon die het typte, in een persoonlijke chat, een kanaal of een groepschat. Het wordt ingevuld als die persoon: als het OneUptime-account waaraan diens Microsoft Teams-account is gekoppeld (zie [Microsoft Teams koppelen](#microsoft-teams-koppelen)), met de rechten van dat account in het project. Iemand van wie het account niet gekoppeld is, of van wie het OneUptime-account geen lid meer is van het project, krijgt te horen wat te doen in plaats van het formulier.

- **Wie ze mag gebruiken.** De mensen die in OneUptime een incident mogen melden of een geplande onderhoudsgebeurtenis mogen aanmaken: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** en **Incident Member** voor een incident (**Create Incident** in een aangepaste rol), en **Scheduled Maintenance Admin** en **Scheduled Maintenance Member** voor een gebeurtenis (**Create Scheduled Maintenance**). Ieder ander krijgt dat te horen, en krijgt geen formulier.
- **Wat een formulier aanbiedt.** Elke lijst — ernstniveaus, monitoren, monitorstatussen, bereikbaarheidsbeleid en labels — bevat wat de persoon die erom vroeg mag lezen, net als dezelfde lijst in OneUptime, en de "not shown"-notities op de kaart tellen alleen die: met een rol die tot enkele labels beperkt is, de monitoren en het bereikbaarheidsbeleid met die labels. Een lijst die hij helemaal niet mag lezen, blijft weg. Gearchiveerd bereikbaarheidsbeleid wordt nooit aangeboden.
- **Wat een formulier mag noemen.** In een kanaal of een groepschat mag iedereen die daar is het formulier versturen, en het wordt verstuurd als wie dat doet, met diens eigen rechten. Het incident of de gebeurtenis wordt met die rechten aangemaakt en op naam van die persoon gezet. Een monitor, bereikbaarheidsbeleid, label, ernstniveau of status die hij niet mag lezen, of een uit een ander project, wordt geweigerd alsof het project die niet heeft, en er wordt niets aangemaakt: de bot antwoordt "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** op een incident, waarschuwing of episode werkt op dezelfde manier: het vereist rechten om een bereikbaarheidsbeleid uit te voeren (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** en **On-Call Member**, of **Create On-Call Duty Policy Execution Log** in een aangepaste rol) en om dat incident, die waarschuwing of die episode te lezen, en het biedt het actieve bereikbaarheidsbeleid aan dat de persoon mag lezen. Een monitor of bereikbaarheidsbeleid bekijken vanaf een kaart leest het ook als de persoon die op de knop drukte.

## Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Microsoft Teams

De knoppen op de kaarten van OneUptime handelen als de persoon die erop drukt, in een persoonlijke chat, een kanaal of een groepschat: als het OneUptime-account waaraan diens Microsoft Teams-account is gekoppeld, met de rechten van dat account in het project. **Acknowledge**, **Resolve**, **Change State**, **Add Note** en **Execute On-Call Policy** op een incident, een waarschuwing of een episode, en **Mark as Ongoing**, **Mark as Complete**, **Change State** en **Add Note** op een geplande onderhoudsgebeurtenis, voeren elk de wijziging uit die dezelfde actie in OneUptime uitvoert, en die wordt daar op naam van die persoon gezet: de statustijdlijn en de feed van het record tonen wie de status heeft gewijzigd, en de notitie is van die persoon. Een notitie die vanuit een bericht met een reactie wordt opgeslagen, wordt op dezelfde manier geplaatst.

- **Wie ze mag gebruiken.** De mensen die dezelfde wijziging in OneUptime mogen maken. Een incident bevestigen, oplossen of de status ervan wijzigen vereist rechten om de status te wijzigen: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** en **Incident Member**, of **Create Incident State Timeline** in een aangepaste rol. Een waarschuwing, een episode of een geplande onderhoudsgebeurtenis vereist dezelfde rechten voor het eigen soort (**Create Alert State Timeline**, bijvoorbeeld), en een notitie vereist rechten om dat soort notitie te plaatsen. Net als het statuspaneel in OneUptime vragen ze geen rechten om het incident of de waarschuwing zelf te bewerken. Ieder ander krijgt dat te horen, en er verandert niets.
- **Welke records.** Die de persoon mag lezen, net als in OneUptime: met een rol die tot enkele labels beperkt is, de incidenten, waarschuwingen, episodes en gebeurtenissen met die labels. Een knop op een ander record, of op een uit een ander project, krijgt als antwoord dat het record "was not found in this project, or you do not have access to it.", en er verandert niets. Op OneUptime Cloud wordt een wijziging die het abonnement van het project niet omvat, geweigerd met het abonnement dat ervoor nodig is.
- **Wat Change State aanbiedt.** De statussen die de persoon mag lezen en waarnaar het record als volgende mag gaan, in de volgorde van het project: geen enkele vóór de status waarin het staat, voor een episode net als voor een incident, een waarschuwing of een geplande onderhoudsgebeurtenis, omdat een statuswijziging een record nooit terug omhoog in zijn lijst zet (zie [De volgorde is een echte beperking, geen weergavevoorkeur](/docs/incidents/states-and-severities#de-volgorde-is-een-echte-beperking-geen-weergavevoorkeur)). Als hij er geen enkele mag lezen, zegt de bot "No incident states are available to you in this project. Ask a project admin for access to them."; als het record in de laatste status staat die het kan bereiken, zegt hij "There is no later state to move this incident to." Geen van beide toont een lege kaart.
- **Escalate.** **Escalate** op een kaart voert het bereikbaarheidsbeleid ervan uit voor het incident, de waarschuwing of de episode waar de kaart over gaat, als de persoon die erop drukte, met dezelfde rechten als **Execute On-Call Policy**. Een kaart die over geen van die gaat, krijgt als antwoord "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", en niemand wordt opgeroepen.

## Ontkoppelen

- **Disconnect** ontkoppelt alleen je eigen Microsoft Teams-account, en verwijdert daarmee ook je Microsoft Teams-meldingsmethode.
- **Uninstall OneUptime from Microsoft Teams**, op **Projectinstellingen** > **Werkruimte** > **Microsoft Teams**, ontkoppelt het project. OneUptime stopt met plaatsen in Microsoft Teams, en de **Werkruimte**-menu's tonen het niet meer. De meldingsregels en samenvattingen blijven bewaard voor als je opnieuw koppelt.

> [!WARNING]
> Verwijderen ontkoppelt ook het Microsoft Teams-account van elk lid van het project, en verwijdert de Microsoft Teams-meldingsmethoden en de bereikbaarheidsregels die ze gebruikten. Een project is gekoppeld aan één Microsoft 365-organisatie: verwijder het eerst om het naar een andere te verplaatsen.

## Problemen oplossen

:::details Een test zegt dat de OneUptime-app niet in het team is geïnstalleerd
Microsoft weigerde het bericht omdat de bot niet in dat team zit. Voeg de app toe aan het team (zie [Microsoft Teams koppelen](#microsoft-teams-koppelen)) of, voor een privékanaal, aan het kanaal zelf. De app aan één team toevoegen doet niets voor de andere.
:::

:::details Microsoft Teams is niet gekoppeld
Als Microsoft je zonder koppeling terugstuurt, zegt de pagina waarop je begon **Microsoft Teams is niet verbonden**, en één zin zegt waarom: je hebt het recht niet, de link was al gebruikt of verlopen, je bent bij een andere Microsoft 365-organisatie aangemeld, of je organisatie heeft nog geen teams. Zie [Het verbinden is niet afgerond](/docs/self-hosted/microsoft-teams-integration#het-verbinden-is-niet-afgerond) voor elke zin en wat je moet doen.
:::

:::details De bot zegt dat mijn account niet gekoppeld is
Koppel het onder **Gebruikersinstellingen** > **Werkruimte** > **Microsoft Teams** met **Connect my account with Microsoft Teams**, aangemeld bij de organisatie waaraan het project is gekoppeld. Een gastaccount van een andere organisatie is niet hetzelfde account.
:::

:::details Elke melding mislukt op een zelf gehoste server
De Teams-app die in je teams is geïnstalleerd, moet het pakket zijn dat je server heeft gebouwd, en Microsoft moet het bot-eindpunt van je server kunnen bereiken. Zie de probleemoplossing van [Microsoft Teams-integratie](/docs/self-hosted/microsoft-teams-integration#probleemoplossing).
:::

## Volgende stappen

:::cards
- [Slack](/docs/workspace-connections/slack): Dezelfde meldingen en acties in Slack.
- [Videogesprekken](/docs/workspace-connections/video-calls): Geef elk incident een gesprek, geplaatst bij zijn updates.
- [Microsoft Teams-integratie](/docs/self-hosted/microsoft-teams-integration): De Teams-bot instellen op een zelf gehoste server.
- [Een incident melden](/docs/incidents/declaring-incidents): Alle manieren waarop een incident begint, en wat er dan wordt uitgevoerd.
:::
