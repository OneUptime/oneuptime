# Microsoft Teams

Koppel OneUptime aan Microsoft Teams om incidenten, waarschuwingen, episodes, gepland onderhoud, monitoren en updates van de bereikbaarheidsdienst in je kanalen en chats te plaatsen, elk incident een eigen kanaal te geven en responders vanuit Teams te laten handelen: bevestigen, oplossen, notities toevoegen, de dienst oproepen, incidenten melden en OneUptime AI vragen stellen.

:::cards
- [Microsoft Teams koppelen](#microsoft-teams-koppelen): Beheerderstoestemming, je aanmelding en de app in elk team.
- [Iedereen vragen hun account te koppelen](#iedereen-vragen-hun-account-te-koppelen): Stuur in één keer een bericht aan elk lid dat zijn account nog niet heeft gekoppeld.
- [Meldingsregels](#meldingsregels): Bepaal welke gebeurtenissen waar worden geplaatst, en welke een eigen kanaal krijgen.
- [Praten met de OneUptime-bot](#praten-met-de-oneuptime-bot): Commando's, vragen en formulieren in een chat met de bot.
- [Tags voor bereikbaarheid](#tags-voor-bereikbaarheid): Houd de tag van een team gelijk aan wie er dienst heeft, en roep die op.
- [Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Microsoft Teams](#handelen-op-incidenten-waarschuwingen-en-gebeurtenissen-vanuit-microsoft-teams): De knoppen op de kaarten van OneUptime.
:::

## Hoe het werkt

```mermaid title="Van een gebeurtenis in OneUptime naar een kaart in Microsoft Teams"
flowchart TB
    event["Een incident, waarschuwing of gebeurtenis<br/>wordt aangemaakt of verandert"] --> rules{"Meldingsregels<br/>waarvan de voorwaarden kloppen"}
    rules -->|"Een kanaal<br/>voor elk"| own["Een eigen kanaal<br/>in het team dat je kiest"]
    rules -->|"Plaatsen in een bestaand<br/>kanaal of een bestaande chat"| existing["Je kanalen en chats"]
    own --> card["Een kaart met knoppen"]
    existing --> card
    card -->|"Een responder drukt er een in"| change["De wijziging gebeurt in OneUptime,<br/>als die responder"]
```

Drie dingen maken dit mogelijk:

- **De koppeling van het project**, één keer gemaakt: een Microsoft 365-beheerder geeft toestemming voor de OneUptime-app voor je organisatie.
- **De OneUptime-app in elk team** waarin je meldingen wilt. Microsoft laat de bot alleen plaatsen in een team waaraan hij is toegevoegd.
- **De eigen koppeling van elke persoon**: hun Microsoft Teams-account gekoppeld aan hun OneUptime-account. Knoppen, commando's en reacties handelen als die persoon, met diens rechten in het project.

Eén Microsoft 365-organisatie kan aan meer dan één project gekoppeld zijn, zoals productie en staging. De knop van een kaart handelt in het project waarvoor de kaart is verstuurd, zoals het project van het incident waar de kaart over gaat. Een bericht aan de bot handelt in het project van het kanaal waarin het wordt verstuurd, zoals het kanaal van een incident, of anders in het enige project waarin het Microsoft Teams-account van de afzender gekoppeld is. Als niets dat aangeeft, vraagt de bot de afzender welk project diegene bedoelt, met een knop voor elk project waarin diegene zit, en gaat het daar verder zodra diegene kiest. In een gesprek met OneUptime AI geldt die keuze voor de vervolgvragen, tot er een uur voorbijgaat zonder een.

## Voordat je begint

- **Een rol die het project mag koppelen:** **Projecteigenaar**, **Projectbeheerder** of **Projectlid**. Verwijderen vereist **Projecteigenaar** of **Projectbeheerder**.
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

Elke persoon koppelt zijn eigen Microsoft Teams-account onder **Gebruikersinstellingen** > **Werkruimte** > **Microsoft Teams** met **Connect my account with Microsoft Teams**, om als zichzelf op incidenten te handelen en directe berichten te krijgen. Die sectie verschijnt zodra het project aan Microsoft Teams is gekoppeld. Zie [Iedereen vragen hun account te koppelen](#iedereen-vragen-hun-account-te-koppelen) om een heel team in één keer erbij te halen.

### Een meldingsregel toevoegen

Ga naar **Incidenten** > **Werkruimte** > **Microsoft Teams**. De sectie **Werkruimte** toont alleen de chatworkspaces die je project heeft gekoppeld, dus **Microsoft Teams** verschijnt daar zodra het is gekoppeld. Maak een regel aan, bijvoorbeeld een die in een Teams-kanaal plaatst als er een incident wordt aangemaakt, en klik dan op **Testregel** in de rij ervan.
:::

> [!NOTE]
> OneUptime voor jezelf installeren, of aan een chat toevoegen, is een andere installatie en laat het niet in de kanalen van een team plaatsen. **Privékanalen** hebben de app nodig in het kanaal zelf: open het kanaal > "..." > **Manage channel** > **Apps** > **Add an app**. **Gedeelde kanalen** kunnen geen meldingen ontvangen: Microsoft Teams ondersteunt geen bots in gedeelde kanalen.

## Iedereen vragen hun account te koppelen

Niemand kan het Microsoft Teams-account van iemand anders koppelen, ook een beheerder niet: ieder meldt zich aan met zijn eigen account. Om een heel team erbij te halen, vraagt een **Projecteigenaar** of **Projectbeheerder** iedereen tegelijk op **Projectinstellingen** > **Werkruimte** > **Microsoft Teams**. De kaart **Members' Microsoft Teams accounts** zegt hoeveel leden hun account al hebben gekoppeld. **Ask everyone to connect** laat de OneUptime-bot een bericht sturen aan elk lid dat nog niet gekoppeld is, met een knop **Connect Microsoft Teams account** die het account met één klik koppelt.

- **Wie een bericht krijgt.** Elk lid van het project dat zijn Microsoft Teams-account niet heeft gekoppeld, in een team zit waaraan de OneUptime-app is toegevoegd en daar via zijn e-mailadres of user principal name (UPN) wordt gevonden. Wie in de afgelopen 24 uur al is gevraagd, wordt niet opnieuw gevraagd, dus opnieuw vragen de volgende dag is alleen een herinnering voor wie zijn account nog steeds niet heeft gekoppeld.
- **Wat de kaart zegt.** Hoe ver het versturen is terwijl de berichten de deur uit gaan, en daarna wie het vroeg en hoeveel leden een bericht kregen. Leden die OneUptime niet kon vinden, staan bij naam op de kaart: voeg de app toe aan hun team, of laat ze hun account zelf koppelen onder **Gebruikersinstellingen** > **Werkruimte** > **Microsoft Teams**.
- **Wat de knop koppelt.** Het Microsoft Teams-account van wie erop drukt en zich aanmeldt, aan diens eigen OneUptime-account. Een bericht dat aan iemand anders is doorgestuurd, koppelt niets aan het lid naar wie het was gestuurd.

## Meldingsregels

Een meldingsregel bepaalt welke gebeurtenissen in Microsoft Teams worden geplaatst, en waar. Elk product heeft zijn eigen regels, onder **Werkruimte** > **Microsoft Teams** in zijn menu:

| Product | Tabbladen op zijn **Microsoft Teams**-pagina |
| --- | --- |
| **Incidenten** | **Incidenten**, **Incidentepisodes**, **Samenvatting** |
| **Waarschuwingen** | **Waarschuwingen**, **Waarschuwing Episodes**, **Samenvatting** |
| **Geplande onderhoud** | Eén lijst met regels |
| **Monitoren** | Eén lijst met regels |
| **Bereikbaarheidsdienst** | Eén lijst met regels |

Een regel aanmaken gaat in vier stappen:

| Stap | Wat je instelt |
| --- | --- |
| **Basis** | **Regelnaam** en **Regelbeschrijving**. |
| **Voorwaarden** | Voor welke gebeurtenissen de regel geldt, bijvoorbeeld op ernst, status, label, monitor of woorden in de titel. Ze worden gecontroleerd wanneer een gebeurtenis wordt aangemaakt en opnieuw bij elke update die OneUptime erover plaatst, dus een regel voor bevestigde incidenten werkt zodra een incident wordt bevestigd. Een nieuwe regel geldt voor elke gebeurtenis, bijvoorbeeld **Alle incidenten**. Om de regel in te perken, kies **Alleen incidenten die aan de voorwaarden voldoen** en voeg de voorwaarden toe. Met twee of meer bepaalt **Overeenkomstvoorwaarde** of ze allemaal moeten kloppen, of één ervan. |
| **Bestemming** | Waar hij plaatst: een bestaand kanaal van een team dat je kiest, de chats die je kiest, een kanaal voor elk incident (of waarschuwing, episode, evenement, monitor of bereikbaarheidsbeleid) dat wordt aangemaakt in een team dat je kiest, of meerdere daarvan samen. Onder de stap zegt **Wat deze regel doet** het in zinnen, zoals de kaart van de regel. |
| **Video Call** | Alleen incidenten en waarschuwingen: start voor elk een gesprek. Zie [Videogesprekken](/docs/workspace-connections/video-calls). |

Een kanaal dat de regel aanmaakt, krijgt de naam van zijn record: incident INC-42 krijgt `inc-42`, waarschuwing ALT-7 krijgt `alt-7` en in een project zonder nummervoorvoegsels krijgt incident 42 `incident-42`. Tekst in **Voorvoegsel van de kanaalnaam** komt ervoor, dus `prod-` wordt `prod-inc-42`, en het formulier toont de naam terwijl je typt. Bij een geplande onderhoudsgebeurtenis neemt het voorvoegsel de plaats in van het nummervoorvoegsel: SM-5 krijgt `sm-5` en `maint-` wordt `maint-5`. OneUptime houdt letters, cijfers, spaties, `-` en `_` over, tot de 50 tekens die Microsoft Teams aanneemt. Heeft het team al een kanaal met die naam, zoals dat van een ander project of een kanaal dat de afgelopen 30 dagen is verwijderd, dan voegt OneUptime `-2`, `-3` enzovoort toe.

Een regel maakt zijn kanaal aan de eerste keer dat een gebeurtenis eraan voldoet: wanneer de gebeurtenis wordt aangemaakt, of later, wanneer een update haar laat voldoen terwijl ze nog open is. Een regel voor bevestigde incidenten maakt het kanaal aan zodra het incident wordt bevestigd. Microsoft Teams toont de kanalen van een team aan iedereen in het team, dus OneUptime voegt niemand een voor een aan een kanaal toe: iedereen in het team dat je kiest kan het openen, zoals het regelformulier zegt onder **Wie lid wordt van het kanaal**. Een privé-incident, -waarschuwing of -episode krijgt een privékanaal, dat alleen de leden ervan zien; voeg mensen toe in Microsoft Teams.

Om wie er dienst heeft erbij te halen, kies je hun bereikbaarheidsschema's onder **Vermelden wie er dienst heeft**. Bij het aanmaken van het kanaal plaatst OneUptime erin, direct na het eerste bericht van het record, een bericht dat wie er dienst heeft in die schema's met @ noemt, zodat Microsoft Teams hun een melding geeft. Niemand wordt opgeroepen. OneUptime vindt elke persoon in het team via het Microsoft Teams-account dat diegene aan OneUptime heeft gekoppeld, of anders via diens e-mailadres. Wie niet in het team zit, kan de kanalen ervan niet openen, dus wordt diegene in plaats daarvan in het bericht bij naam genoemd, met de reden. Een privékanaal kunnen alleen de leden ervan openen, dus voeg de mensen die dienst hebben er in Microsoft Teams aan toe.

Elke latere update van het record — een statuswijziging, een notitie, een nieuwe eigenaar — wordt in zijn kanalen geplaatst, en in de bestaande kanalen en chats die zijn regels noemen zolang hun voorwaarden kloppen. OneUptime kan een Microsoft Teams-kanaal niet archiveren, dus het kanaal van een regel blijft bestaan wanneer het record voorbij is; archiveer of verwijder het in Microsoft Teams.

Een incident, waarschuwing, episode of geplande onderhoudsgebeurtenis met een eigen kanaal heeft **Openen in Microsoft Teams** in de kop van zijn pagina in OneUptime, naast de statusknoppen. Die opent dat kanaal in een nieuw tabblad, in de Microsoft Teams-app of in de browser. Een record met twee eigen kanalen toont ze allebei onder de knop. Een record met kanalen in zowel Slack als Microsoft Teams heeft in plaats daarvan één knop **Kanaal openen**, die ze allemaal toont. De bestaande kanalen en chats waarin uw regels posten, worden niet aangeboden.

De pagina van het record heeft ook een kaart **Microsoft Teams-kanaal**, die zegt wie het kanaal kan openen: iedereen in het team of, bij een privékanaal, de leden ervan, die de eigenaren ervan in Microsoft Teams toevoegen. OneUptime verandert niet wie er in een Microsoft Teams-kanaal zit. Bij een Slack-kanaal toont de kaart wie erin zit en voegt hij mensen toe: zie [Wie er in het kanaal van een record zit](/docs/workspace-connections/slack#wie-er-in-het-kanaal-van-een-record-zit).

Kanalen en chats blijven leesbaar: elke gebeurtenis wordt één keer geplaatst, en de eerste status van een record staat in de kaart die het record aankondigt, niet in een eigen kaart. Een uitvoering van een bereikbaarheidsbeleid is één kaart die wordt bewerkt terwijl de uitvoering escaleert: wie werd opgeroepen, hoe vaak en hoe, wie niet en waarom, en wie bevestigde. Een nieuwe kaart wordt alleen geplaatst als iemand moet handelen: een escalatieregel bereikte niemand, of de uitvoering eindigde zonder dat iemand bevestigde. Dat de eigenaren van het record of de abonnees van de statuspagina bericht kregen, blijft in zijn feed in OneUptime staan.

**Projectinstellingen** > **Werkruimte** > **Microsoft Teams** toont de kanalen die OneUptime in je teams ziet, en de chats waaraan het is toegevoegd, met **Test verzenden** naast elk ervan. Een chat verschijnt zodra de OneUptime-app er in Microsoft Teams aan wordt toegevoegd; **Refresh Chats** haalt nieuwe chats en hun huidige namen op.

## Een regel testen

**Testregel** in de rij van een regel plaatst een testbericht voor die regel in de kanalen die hij noemt, zodat je het ziet aankomen. Als de regel voor elke gebeurtenis een kanaal aanmaakt, maakt de test er ook een aan en nodigt de mensen van de regel uit.

Net als **Test verzenden** naast een kanaal in **Projectinstellingen** > **Werkruimte** > **Microsoft Teams** vereist het rechten om meldingsregels aan te maken: **Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Instellingenbeheerder**, **Instellingenlid**, of **Create Workspace Notification Rule** en **Read Workspace Notification Rule** in een aangepaste rol. Voor iemand die de regels alleen mag bekijken, zoals een **Kijker**, is **Testregel** vergrendeld, en de tooltip zegt wat er nodig is; de API weigert diens test met "You do not have permission to send test notifications in this project." Op OneUptime Cloud vereist het testen van een regel het **Growth**-abonnement, net als het toevoegen ervan.

Op OneUptime Cloud vereist **Test verzenden** naast een kanaal of een chat ook het **Growth**-abonnement, omdat in een kanaal plaatsen is wat regels en samenvattingen doen. **Test nu verzenden** bij een samenvatting vereist rechten om samenvattingen aan te maken (**Create Workspace Notification Summary** en **Read Workspace Notification Summary** in een aangepaste rol) en, op OneUptime Cloud, het **Growth**-abonnement; voor ieder ander is het vergrendeld, en de tooltip zegt wat er nodig is. Een MCP-client die met alleen-lezen toegang is gekoppeld, kan geen enkele test versturen.

## Samenvattingen

Het tabblad **Samenvatting** van **Incidenten** > **Werkruimte** > **Microsoft Teams** (en van **Waarschuwingen**) plaatst een terugkerend overzicht in de kanalen die je noemt: hoeveel incidenten of waarschuwingen er waren, hoe snel ze werden bevestigd en opgelost, en een lijst met links. Elke week gaat er een nieuwe samenvatting uit, over de afgelopen 7 dagen. Laat **Eerste rapport verzenden om** leeg, en de eerste gaat om 09:00 uit aan het begin van de volgende week, dag of maand; het formulier zegt wanneer.

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
| 📣 of 📢 | Een openbare notitie, getoond op de statuspagina. Alleen incidenten en geplande onderhoudsgebeurtenissen. Bij een privé-incident een privénotitie, en de bevestiging zegt waarom. |

De notitie houdt het bericht zoals Microsoft Teams het liet zien: de opmaak, links en code, de personen die het noemt bij naam, en de bestanden en afbeeldingen als links ernaar. Een openbare notitie laat de bestanden en afbeeldingen weg, omdat die alleen voor je team opengaan.

Het zijn de woorden van wie het bericht schreef: diens OneUptime-naam als diens Microsoft Teams-account gekoppeld is, anders de naam die Teams toont. Een privénotitie komt in de tijdlijn op het moment dat het bericht werd geplaatst, hoe lang daarna ze ook wordt opgeslagen. Een openbare notitie komt erin op het moment dat ze wordt opgeslagen, dus wanneer de statuspagina haar toont. De tijdlijn zegt wie haar opsloeg. De notitie wordt niet teruggeplaatst in het kanaal, waar het bericht al staat.

De notitie wordt als jou opgeslagen, met jouw rechten, en de OneUptime-app moet in het team zitten. Is je Microsoft Teams-account nog niet gekoppeld, dan vraagt OneUptime je om het te koppelen, in een antwoord dat jou noemt, met een knop die het bericht opslaat zodra je dat hebt gedaan.

## Praten met de OneUptime-bot

Stuur de bot een bericht in een persoonlijke chat, of noem OneUptime met @ in een kanaal of een groepschat: daar antwoordt hij alleen als hij wordt genoemd.

| Bericht | Wat de bot doet |
| --- | --- |
| `help` | Toont wat hij kan. |
| `incident [title or number]` | Opent het incidentformulier, met de titel ingevuld. Het nummer van een incident, zoals `42` of `INC-42`, toont in plaats daarvan dat incident: zie [Een incident beheren vanuit Microsoft Teams](#een-incident-beheren-vanuit-microsoft-teams). |
| `maintenance [title]` | Opent het formulier voor gepland onderhoud, met de titel ingevuld. |
| `oncall` | Toont wie er nu dienst heeft in elk bereikbaarheidsschema dat je kunt zien, tot wanneer, en wie de volgende is. |
| `page [who] [message]` | Roept de mensen op die je met @ noemt, over je bericht, of stuurt een kaart om te kiezen wie je oproept. Zie [Iemand oproepen vanuit Microsoft Teams](#iemand-oproepen-vanuit-microsoft-teams). |
| `ask [question]`, of elke vraag in gewone taal | OneUptime AI beantwoordt vragen over je logs, traces, metrieken, incidenten en monitoren, bijvoorbeeld "welke monitoren liggen er nu uit?". Antwoorden lezen alleen. |
| `show active incidents`, `show active alerts` | Toont wat er nu openstaat. |
| `show scheduled maintenance`, `show ongoing maintenance` | Toont komende, of lopende, onderhoudsgebeurtenissen. |

Op de `show`-lijsten na zijn dit de woorden die in Slack na `/oneuptime` komen; `create incident` en `create maintenance` werken ook nog. OneUptime AI vragen stellen vereist dat je eigen Microsoft Teams-account gekoppeld is en dat AI voor het project aanstaat. Is je account niet gekoppeld, dan vraagt de bot je één keer per thread of chat om het te koppelen, met een knop **Connect Microsoft Teams account**. Zie [AI vragen](/docs/ai/ask-ai).

## Jouw startpagina in Microsoft Teams

Typ `home` naar de OneUptime-bot, en hij antwoordt met je startpagina: een kaart met wat er in het project gebeurt, zoals jij het mag zien.

- **Jouw dienst.** De bereikbaarheidsschema's waarin je nu dienst hebt, en tot wanneer, of anders je volgende dienst.
- **Wat open is.** De nieuwste open incidenten en waarschuwingen die je mag lezen, elk met een link naar de pagina ervan in OneUptime.
- **De knoppen.** **Declare incident** en **Page someone** antwoorden zoals `incident` en `page`, **Who's on call** zoals `oncall`, en **Refresh** leest de kaart opnieuw, op dezelfde plek.

Als je de OneUptime-app voor jezelf toevoegt, stuurt de bot je meteen je startpagina. De startpagina en de `show`-lijsten lezen als jou, dus hebben ze je eigen gekoppelde Microsoft Teams-account nodig: zolang dat niet zo is, antwoordt de bot met een knop **Connect Microsoft Teams account**. **OneUptime openen in Microsoft Teams**, onder **Gebruikersinstellingen** > **Werkruimte** > **Microsoft Teams**, opent de app in Teams.

Als de app aan een team wordt toegevoegd, zegt de bot daar hallo: hoe je hem een vraag stelt en waar je een meldingsregel toevoegt die in de kanalen van het team plaatst.

## Incidenten en onderhoud aanmaken vanuit Microsoft Teams

`incident` of `maintenance` typen aan de OneUptime-bot opent een formulier voor de persoon die het typte, in een persoonlijke chat, een kanaal of een groepschat. Het wordt ingevuld als die persoon: als het OneUptime-account waaraan diens Microsoft Teams-account is gekoppeld (zie [Microsoft Teams koppelen](#microsoft-teams-koppelen)), met de rechten van dat account in het project. Iemand van wie het account niet gekoppeld is, of van wie het OneUptime-account geen lid meer is van het project, krijgt in een antwoord dat diegene noemt te horen wat te doen, in plaats van het formulier.

- **Wie ze mag gebruiken.** De mensen die in OneUptime een incident mogen melden of een geplande onderhoudsgebeurtenis mogen aanmaken: **Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Incidentbeheerder** en **Incidentlid** voor een incident (**Create Incident** in een aangepaste rol), en **Onderhoudsbeheerder** en **Onderhoudslid** voor een gebeurtenis (**Create Scheduled Maintenance**). Ieder ander krijgt dat te horen, en krijgt geen formulier.
- **Wat een formulier aanbiedt.** Elke lijst — ernstniveaus, monitoren, monitorstatussen, bereikbaarheidsbeleid en labels — bevat wat de persoon die erom vroeg mag lezen, net als dezelfde lijst in OneUptime, en de "not shown"-notities op de kaart tellen alleen die: met een rol die tot enkele labels beperkt is, de monitoren en het bereikbaarheidsbeleid met die labels. Een lijst die hij helemaal niet mag lezen, blijft weg. Gearchiveerd bereikbaarheidsbeleid wordt nooit aangeboden.
- **Wat een formulier mag noemen.** In een kanaal of een groepschat mag iedereen die daar is het formulier versturen, en het wordt verstuurd als wie dat doet, met diens eigen rechten. Het incident of de gebeurtenis wordt met die rechten aangemaakt en op naam van die persoon gezet. Een monitor, bereikbaarheidsbeleid, label, ernstniveau of status die hij niet mag lezen, of een uit een ander project, wordt geweigerd alsof het project die niet heeft, en er wordt niets aangemaakt: de bot antwoordt "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** op een incident, waarschuwing of episode werkt op dezelfde manier: het vereist rechten om een bereikbaarheidsbeleid uit te voeren (**Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Bereikbaarheidsbeheerder** en **Bereikbaarheidslid**, of **Create On-Call Duty Policy Execution Log** in een aangepaste rol) en om dat incident, die waarschuwing of die episode te lezen, en het biedt het actieve bereikbaarheidsbeleid aan dat de persoon mag lezen. Een monitor of bereikbaarheidsbeleid bekijken vanaf een kaart leest het ook als de persoon die op de knop drukte.

## Iemand oproepen vanuit Microsoft Teams

In een kanaal of een groepschat roept `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` Nawaz meteen op. Hij krijgt een telefoontje, een sms, een pushmelding of een e-mail, zoals zijn eigen bereikbaarheidsregels zeggen, en elk daarvan vertelt hem wie hem opriep, via welk team of schema, en je bericht. Waar je de opdracht stuurt, bepaalt waar de oproep over gaat:

- **In het eigen kanaal van een incident of een waarschuwing**, het kanaal dat OneUptime ervoor aanmaakte, gaat de oproep over dat incident of die waarschuwing, en wordt er niets nieuws aangemaakt. Een bericht is daar optioneel: `@OneUptime page @Nawaz Dhandala` is genoeg. De mensen die je oproept, worden opgeroepen tot een van hen antwoordt, vanuit de oproep of door het incident of de waarschuwing te bevestigen; als iemand anders het bevestigt, stopt de oproep niet, en oplossen stopt hem wel.
- **Overal elders**, zoals in een ander kanaal, een groepschat, een persoonlijke chat met de bot of het kanaal van een opgelost incident of een opgeloste waarschuwing, maakt OneUptime een waarschuwing aan met je bericht als titel, en roept op tot iemand de waarschuwing bevestigt. De kaart zegt dat, en de oproep in het gesprek noemt de waarschuwing.
- **Wie meteen wordt opgeroepen.** De mensen die je met @ noemt, en wie er dienst heeft in de schema's die een tag volgt die je met @ noemt (zie [Tags voor bereikbaarheid](#tags-voor-bereikbaarheid)), als er een bericht op hen volgt, of zonder bericht in het eigen kanaal van een incident of een waarschuwing. OneUptime herkent iemand aan het OneUptime-account waaraan diens Microsoft Teams-account is gekoppeld, of anders aan diens e-mailadres in Microsoft Teams. Niemand buiten het project wordt opgeroepen.
- **Al het andere krijgt een kaart.** Zonder iemand met @ genoemd, zoals in een persoonlijke chat met de bot, zonder bericht waar de oproep er een nodig heeft, met een tag die geen bereikbaarheidsschema volgt dat je kunt zien, of met iemand die OneUptime niet herkent, antwoordt de bot met de kaart **Page someone**, met wat je typte al ingevuld, en zegt hij wie hij niet kon kiezen. In het eigen kanaal van een incident of een waarschuwing opent de kaart met dat incident of die waarschuwing. Kies mensen, een team, een bereikbaarheidsschema, dat oproept wie er nu dienst in heeft, of een bereikbaarheidsbeleid, dat oproept via zijn escalatieregels, en verstuur de kaart. Iedereen in het gesprek mag de kaart versturen, als zichzelf. Zodra er is opgeroepen, wordt de kaart verwijderd, zodat niemand er twee keer mee oproept.
- **Waar het te zien is.** Het gesprek toont de oproep als één kaart die wordt bijgewerkt: wie werd opgeroepen en hoe, elk team bij zijn naam met zijn mensen erachter, je bericht, en wie bevestigde. Waar de bot die niet kan posten, zegt zijn antwoord wie werd opgeroepen, met een link naar het incident of de waarschuwing.
- **Wie mag oproepen.** In het eigen kanaal van een incident of een waarschuwing iedereen die een bereikbaarheidsbeleid mag uitvoeren (**Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Bereikbaarheidsbeheerder** en **Bereikbaarheidslid**, of **Create On-Call Duty Policy Execution Log** in een aangepaste rol) en dat incident of die waarschuwing mag lezen. Overal elders maakt de oproep een waarschuwing aan, dus vereist hij ook het recht om er een aan te maken: **Projecteigenaar**, **Projectbeheerder** en **Projectlid**, of **Bereikbaarheidslid** samen met **Waarschuwingslid** (**Create On-Call Duty Policy Execution Log** en **Create Alert** in een aangepaste rol). Mensen, een team of een schema rechtstreeks oproepen, zonder bereikbaarheidsbeleid achter de oproep, vereist daarnaast toegang tot elk bereikbaarheidsbeleid van het project. Ieder ander krijgt dat te horen in een antwoord, en niemand wordt opgeroepen. Op OneUptime Cloud vereist oproepen het Growth-abonnement: daaronder zegt OneUptime welk abonnement nodig is, en wordt niemand opgeroepen.

## Tags voor bereikbaarheid

Houd een Microsoft Teams-tag, zoals `@Payments on-call`, gelijk aan wie er dienst heeft in een of meer bereikbaarheidsschema's, zodat iedereen in het team die met @ kan noemen om hen te bereiken. OneUptime past de leden van de tag aan bij elke overdracht en vervanging, en controleert de tag elke 15 minuten.

:::steps
### Een tag aan een schema koppelen

Open het schema onder **Bereikbaarheidsdienst** > **Bereikbaarheidsschema's**. Klik in de kaart **Microsoft Teams-tags** op **Tag koppelen**, kies het team en geef de tag een naam: de tag van het team met die naam, of een nieuwe die OneUptime maakt. De leden worden meteen vervangen door wie er dienst heeft.

### De tag ook aan het secundaire schema koppelen

Voor een tag met zowel de primaire als de secundaire dienst koppel je dezelfde tag ook op de pagina van het secundaire schema. Een tag kan zoveel schema's volgen als je wilt.
:::

- **Wat de kaart toont.** Wie er nu in elke tag zit, het team, de andere schema's die de tag volgt, en of die **Actueel** is. Een tag bevat alleen mensen uit het eigen team: wie dienst heeft maar niet in het team zit, wordt genoemd, met de reden.
- **Niemand heeft dienst.** OneUptime haalt iedereen uit de tag tot iemand dienst heeft. Een nieuwe tag heeft iemand uit het team met dienst nodig, want Microsoft Teams maakt geen lege tag.
- **De tag oproepen.** `@OneUptime page @Payments on-call The checkout API is down` roept op wie er dienst heeft in de schema's die de tag volgt. Zie [Iemand oproepen vanuit Microsoft Teams](#iemand-oproepen-vanuit-microsoft-teams).
- **Wat Microsoft 365 nodig heeft.** Tags wijzigen vraagt de machtiging `TeamworkTag.ReadWrite.All` van de app, die een Microsoft 365-beheerder verleent met **Beheerderstoestemming verlenen** onder **Projectinstellingen** > **Werkruimte** > **Microsoft Teams**. Gaf je organisatie toestemming voordat OneUptime tags kon bijhouden, geef die dan één keer opnieuw.
- **Wie er een mag koppelen.** De rollen die schema's mogen bewerken: **Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Bereikbaarheidsbeheerder** en **Bereikbaarheidslid**, of **Edit On-Call Duty Policy Schedule** in een aangepaste rol. In OneUptime Cloud vraagt koppelen het abonnement **Growth**.
- **Ontkoppelen.** OneUptime past de tag niet meer aan. De tag en de leden blijven in Microsoft Teams zoals ze zijn.

## Een incident beheren vanuit Microsoft Teams

De kaart van een incident heeft vier knoppen, **Acknowledge Incident**, **Resolve Incident**, **Add Note** en **View Incident**, en de rest in haar menu, de knop met drie puntjes:

| Menu-item | Wat het doet |
| --- | --- |
| **Change Severity** | Stelt de ernst van het incident in. |
| **Change Incident State** | Zet het incident in een latere status. |
| **Assign Role** | Geeft iemand een rol in het incident, zoals **Incident Commander**. Een rol voor één persoon gaat naar die persoon over. |
| **Page Someone** | Roept mensen, een team, wie in een schema nu dienst heeft, of een bereikbaarheidsbeleid op over het incident, met een optioneel bericht. Mensen worden opgeroepen tot een van hen antwoordt; een beleid roept op tot iemand het incident bevestigt. |
| **Edit Custom Fields** | Stelt de aangepaste velden van het incident in, elk ingevuld met wat het incident bevat. Een leeg gelaten veld wordt gewist. |

`incident 42`, getypt naar de bot, antwoordt met incident 42, deze knoppen en zijn menu. Typ het nummer zoals OneUptime het toont: `42`, `#42` of `INC-42`. In het eigen kanaal van een incident toont `incident` zonder meer dat incident.

- **Wie ze mag gebruiken.** De mensen die dezelfde wijziging in OneUptime mogen maken, zoals in Slack: zie [Een incident beheren vanuit Slack](/docs/workspace-connections/slack#een-incident-beheren-vanuit-slack). Elk item antwoordt met een kaart, ingevuld zoals de persoon die het indrukte het incident mag zien. Iedereen in het gesprek mag de kaart versturen, als zichzelf, met de eigen rechten.
- **Wat er gebeurt.** De wijziging wordt gemaakt als de persoon die de kaart verstuurde, zoals in OneUptime, en de feed van het incident zegt wat er veranderde. De bot zegt het in een antwoord dat diegene noemt, en verwijdert de kaart, zodat niemand haar twee keer verstuurt. **Page Someone** zegt wie werd opgeroepen, of waarom niemand; een incident dat al is opgelost, roept niemand op.
- **Waar Microsoft Teams anders is.** Een kaart kan niet onder een veld zeggen wat er mis is: een waarde die niet past, wordt in een antwoord genoemd, en de kaart blijft staan om te verbeteren en opnieuw te versturen. Een veld voor datum en tijd is een dag en een tijd, in je eigen tijdzone. Een oudere Teams-client toont het menu als extra knoppen. `incident 42` antwoordt in het gesprek, waar iedereen erin het incident kan zien.
- **Kaarten van vóór het menu.** Ze houden hun knop **Execute On-Call Policy**, en die blijft werken: **Page Someone** roept ook een bereikbaarheidsbeleid op. Waarschuwingen en episodes houden die van hen.

## Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Microsoft Teams

De knoppen op de kaarten van OneUptime handelen als de persoon die erop drukt, in een persoonlijke chat, een kanaal of een groepschat: als het OneUptime-account waaraan diens Microsoft Teams-account is gekoppeld, met de rechten van dat account in het project. **Acknowledge**, **Resolve**, **Change State**, **Add Note** en **Execute On-Call Policy** op een incident, een waarschuwing of een episode, en **Mark as Ongoing**, **Mark as Complete**, **Change State** en **Add Note** op een geplande onderhoudsgebeurtenis, voeren elk de wijziging uit die dezelfde actie in OneUptime uitvoert, en die wordt daar op naam van die persoon gezet: de statustijdlijn en de feed van het record tonen wie de status heeft gewijzigd, en de notitie is van die persoon. Een notitie die vanuit een bericht met een reactie wordt opgeslagen, wordt op dezelfde manier geplaatst.

- **Wie ze mag gebruiken.** De mensen die dezelfde wijziging in OneUptime mogen maken. Een incident bevestigen, oplossen of de status ervan wijzigen vereist rechten om de status te wijzigen: **Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Incidentbeheerder** en **Incidentlid**, of **Create Incident State Timeline** in een aangepaste rol. Een waarschuwing, een episode of een geplande onderhoudsgebeurtenis vereist dezelfde rechten voor het eigen soort (**Create Alert State Timeline**, bijvoorbeeld), en een notitie vereist rechten om dat soort notitie te plaatsen. Net als het statuspaneel in OneUptime vragen ze geen rechten om het incident of de waarschuwing zelf te bewerken. Ieder ander krijgt dat te horen, en er verandert niets.
- **Welke records.** Die de persoon mag lezen, net als in OneUptime: met een rol die tot enkele labels beperkt is, de incidenten, waarschuwingen, episodes en gebeurtenissen met die labels. Een knop op een ander record zegt waarom, en er verandert niets: bij een incident waar diens rol niet bij kan, "your access in this project does not include this incident. Ask a project admin for access to it."; bij een privé-incident waarvan diegene geen eigenaar is, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; en bij een incident dat inmiddels is verwijderd, "the incident was not found. It may have been deleted." Op OneUptime Cloud wordt een wijziging die het abonnement van het project niet omvat, geweigerd met het abonnement dat ervoor nodig is.
- **Wat Change State aanbiedt.** De statussen die de persoon mag lezen en waarnaar het record als volgende mag gaan, in de volgorde van het project: geen enkele vóór de status waarin het staat, voor een episode net als voor een incident, een waarschuwing of een geplande onderhoudsgebeurtenis, omdat een statuswijziging een record nooit terug omhoog in zijn lijst zet (zie [De volgorde is een echte beperking, geen weergavevoorkeur](/docs/incidents/states-and-severities#de-volgorde-is-een-echte-beperking-geen-weergavevoorkeur)). Als hij er geen enkele mag lezen, zegt de bot "No incident states are available to you in this project. Ask a project admin for access to them."; als het record in de laatste status staat die het kan bereiken, zegt hij "There is no later state to move this incident to." Geen van beide toont een lege kaart.
- **Add Note bij een privé-incident.** Een privé-incident krijgt geen openbare notities, dus de kaart vraagt niet om een notitietype en voegt een privénotitie toe. Een kaart die werd verstuurd voordat het privé werd, voegt ook een privénotitie toe, en zegt dat. Zie [Privé-incidenten krijgen alleen privénotities](/docs/incidents/notes-owners-and-feed#privé-incidenten-krijgen-alleen-privénotities).
- **Escalate.** **Escalate** op een kaart voert het bereikbaarheidsbeleid ervan uit voor het incident, de waarschuwing of de episode waar de kaart over gaat, als de persoon die erop drukte, met dezelfde rechten als **Execute On-Call Policy**. Een kaart die over geen van die gaat, krijgt als antwoord "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", en niemand wordt opgeroepen.
- **Waar de persoon antwoord krijgt.** In een antwoord in hetzelfde gesprek, de thread van de kaart in een kanaal, dat diegene noemt, zodat Microsoft Teams diegene een melding geeft. Een knop die te laat wordt ingedrukt, zegt wie eerder was, en wanneer, zoals "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Als diens account niet gekoppeld is.** Het antwoord vraagt het te koppelen, met een knop **Connect Microsoft Teams account**. De knop opent diens eigen Microsoft Teams-instellingen in OneUptime en koppelt het account in één stap, na zo nodig inloggen bij OneUptime. Daarna maakt OneUptime af wat diegene indrukte, als diegene, en antwoordt in hetzelfde gesprek; bij een knop die een formulier opent, of een opdracht, vraagt het die opnieuw in te drukken of te typen. De knop werkt één keer, 30 minuten lang, en alleen voor het Microsoft-account dat hem indrukte.

## Ontkoppelen

- **Verbinding verbreken** ontkoppelt alleen je eigen Microsoft Teams-account, en verwijdert daarmee ook je Microsoft Teams-meldingsmethode.
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
Druk in het antwoord van de bot op **Connect Microsoft Teams account** om het in één stap te koppelen, of koppel het onder **Gebruikersinstellingen** > **Werkruimte** > **Microsoft Teams** met **Connect my account with Microsoft Teams**. In beide gevallen meld je je aan bij de organisatie waaraan het project is gekoppeld, als gast als je daar gast bent. Ben je gast en heb je eerder het account van je eigen organisatie gekoppeld, koppel het dan opnieuw.
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
