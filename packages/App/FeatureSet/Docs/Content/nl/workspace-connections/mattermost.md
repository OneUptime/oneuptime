# Mattermost

Koppel OneUptime aan je Mattermost-server om incidenten, waarschuwingen, episodes, gepland onderhoud, monitoren en updates van de bereikbaarheidsdienst in je kanalen te plaatsen, elk incident een eigen kanaal te geven en responders te laten bevestigen, oplossen, notities toevoegen en de status wijzigen zonder Mattermost te verlaten.

:::cards
- [Mattermost koppelen](#mattermost-koppelen): Maak een botaccount voor OneUptime aan en koppel daarna het project met zijn token.
- [Je eigen account koppelen](#je-eigen-mattermost-account-koppelen): Koppel je Mattermost-account aan je OneUptime-account.
- [Meldingsregels](#meldingsregels): Bepaal welke gebeurtenissen waar worden geplaatst, en welke een eigen kanaal krijgen.
- [Wie er in het kanaal van een record zit](#wie-er-in-het-kanaal-van-een-record-zit): Zie wie erin zit, neem deel en voeg mensen toe, vanaf de pagina van het record.
- [Handelen vanuit Mattermost](#handelen-op-incidenten-waarschuwingen-en-gebeurtenissen-vanuit-mattermost): De knoppen in de berichten van OneUptime.
- [Netwerk en zelf hosten](#netwerk-en-zelf-hosten): Wat elke server moet kunnen bereiken.
:::

## Hoe het werkt

```mermaid title="Van een gebeurtenis in OneUptime naar een bericht in Mattermost"
flowchart TB
    event["Een incident, waarschuwing of gebeurtenis<br/>wordt aangemaakt of verandert"] --> rules{"Meldingsregels<br/>waarvan de voorwaarden kloppen"}
    rules -->|"Een kanaal<br/>voor elk"| own["Een eigen kanaal,<br/>met de mensen toegevoegd zodra ze erbij komen"]
    rules -->|"In bestaande kanalen plaatsen"| existing["Je bestaande kanalen"]
    own --> message["Een bericht met knoppen"]
    existing --> message
    message -->|"Een responder drukt er een in"| change["De wijziging gebeurt in OneUptime,<br/>als die responder"]
```

Twee koppelingen maken dit mogelijk:

- **De koppeling van het project**, één keer gemaakt: een botaccount op je Mattermost-server, in de teams waarin OneUptime plaatst. Die plaatst de berichten, maakt de kanalen aan en voegt er mensen aan toe.
- **De eigen koppeling van elke persoon**: hun Mattermost-account gekoppeld aan hun OneUptime-account. Knoppen handelen als die persoon, met diens rechten in het project.

Eén Mattermost-team kan aan meer dan één project gekoppeld zijn, zoals productie en staging. Een knop handelt in het project van het record waar zijn bericht over gaat.

## Voordat je begint

- **Een rol die het project mag koppelen:** **Projecteigenaar**, **Projectbeheerder** of **Projectlid**. Ontkoppelen vereist **Projecteigenaar** of **Projectbeheerder**.
- **Een Mattermost-server** waarop je een botaccount mag aanmaken, of een Mattermost-beheerder die er een voor je kan aanmaken. Mattermost Cloud en een zelf gehoste Mattermost werken allebei.
- **Het Growth-abonnement op OneUptime Cloud** voor meldingsregels en samenvattingen.

OneUptime hoeft voor Mattermost niets op zijn eigen server ingesteld te hebben: elk project brengt zijn eigen Mattermost-server en botaccount mee.

## Mattermost koppelen

:::steps
### Een botaccount aanmaken in Mattermost

Open in Mattermost **System Console** > **Integrations** > **Bot Accounts** en controleer of **Enable Bot Account Creation** aanstaat. Ga daarna naar **Integrations** > **Bot Accounts** > **Add Bot Account**, noem het account `oneuptime` en sla op. Mattermost toont het toegangstoken van de bot één keer: kopieer het.

### De bot aan je team toevoegen

Voeg de bot toe aan elk team waarin OneUptime moet plaatsen, zoals je een persoon zou toevoegen: **Main Menu** > **Invite People**, en nodig `@oneuptime` uit. OneUptime maakt alleen kanalen aan en plaatst alleen in de teams waarvan de bot lid is.

### Het project koppelen

Ga in OneUptime naar **Projectinstellingen** > **Werkruimte** > **Mattermost** en klik op **Koppelen met Mattermost**. Vul het adres van je server in, zoals `https://chat.example.com`, en het toegangstoken van de bot. OneUptime controleert het token bij je server voordat het iets bewaart. Zit de bot in meer dan één team, dan vraagt OneUptime welk team het standaardteam is: het team waarin een meldingsregel die geen team noemt zijn kanalen aanmaakt. Zolang er geen workspace is gekoppeld, bevat de sectie **Werkruimte** van de menu's Incidenten, Waarschuwingen, Gepland onderhoud, Monitoren en Bereikbaarheid **Werkruimte koppelen**, dat ook hierheen leidt.

### Een meldingsregel toevoegen

Ga naar **Incidenten** > **Werkruimte** > **Mattermost** en maak een regel aan. Bijvoorbeeld een die voor elk nieuw incident een Mattermost-kanaal aanmaakt met iedereen die eraan werkt. Zie [Meldingsregels](#meldingsregels).
:::

Het toegangstoken van de bot wordt alleen op de OneUptime-server bewaard, versleuteld samen met de andere geheimen van het project, en wordt nooit meer getoond. Het serveradres, de teams en de gebruikersnaam van de bot zijn voor iedereen in het project zichtbaar, op de instellingenpagina van Mattermost.

Een project is aan één Mattermost-server gekoppeld. Om het naar een andere server te verplaatsen, ontkoppel je het eerst: **Projectinstellingen** > **Werkruimte** > **Mattermost**, daarna **⋯** > **Mattermost ontkoppelen**. Ontkoppelen ontkoppelt ook het eigen Mattermost-account van elk lid, en verwijdert diens Mattermost-meldingsmethode en de bereikbaarheidsregels die die gebruiken. Je meldingsregels en samenvattingen blijven bewaard voor als je opnieuw koppelt.

## Meer dan één team

OneUptime werkt in elk team van je Mattermost-server waarvan zijn bot lid is:

1. Voeg in Mattermost de bot toe aan elk team dat OneUptime moet gebruiken, zoals je een persoon zou toevoegen: open het team, daarna **Main Menu** > **Invite People**.
2. De kaart **Mattermost-teams** onder **Projectinstellingen** > **Werkruimte** > **Mattermost** toont die teams, het standaardteam eerst. Klik op **Vernieuwen** nadat je de bot aan een ander team hebt toegevoegd.

- **Welk team een regel gebruikt.** Meldingsregels kiezen het **Mattermost-team** waarin hun kanalen staan. Blijft het veld leeg, dan maakt een regel zijn kanaal aan in het standaardteam, en zoekt hij de kanalen die hij noemt eerst daar en daarna in de andere teams van de bot.
- **Welk team een samenvatting gebruikt.** Samenvattingen, op het tabblad **Samenvatting** van **Incidenten** en **Waarschuwingen**, kiezen net zo het **Mattermost-team** waarin hun kanalen staan. Blijft het veld leeg, dan zoekt een samenvatting haar kanalen eerst in het standaardteam en daarna in de andere teams van de bot.
- **Het standaardteam.** Dat is het team waaraan je het project hebt gekoppeld. **Als standaard instellen** op de kaart maakt een ander team de standaard, voor een rol die het project mag koppelen.
- **Waar OneUptime werkt.** De knoppen in de berichten van OneUptime, en de formulieren die ze openen, werken in elk van die teams. In een team waaruit de bot is verwijderd, meldt een knop alleen dat het team niet meer gekoppeld is.
- **Een standaardteam waaruit de bot is verwijderd.** De kaart meldt dat. Voeg de bot in Mattermost weer toe, of maak een ander team de standaard.
- **Een team dat een regel noemt en waaruit de bot is verwijderd.** De kaart van de regel meldt dat, en de regel gebruikt niet in plaats daarvan een ander team. Voeg de bot in Mattermost weer toe aan het team, of kies een ander team in de regel: het formulier toont de oude keuze nog, zodat je die kunt wijzigen.

## Je eigen Mattermost-account koppelen

Mattermost heeft geen aanmelding waar OneUptime je naartoe kan sturen, dus stuurt de bot van OneUptime je Mattermost-account in plaats daarvan een direct bericht met een link:

:::steps
1. Ga naar **Gebruikersinstellingen** > **Werkruimte** > **Mattermost**. OneUptime zoekt het Mattermost-account met jouw e-mailadres. Vindt het er een, klik dan op **Link naar @your-username sturen**. Zo niet, klik dan op **Stuur mij een link** en vul je Mattermost-gebruikersnaam in.
2. Open het directe bericht van de OneUptime-bot in Mattermost en klik op **Connect my account**.
3. De link opent OneUptime, dat je account koppelt.
:::

Open de link in dezelfde browser waarin je hem hebt aangevraagd: hij werkt alleen daar, maar één keer en maar 15 minuten lang. Zo is bewezen dat wie de link aanvroeg beide accounts heeft, dus niemand kan het Mattermost-account van iemand anders koppelen. Heb je geen link aangevraagd, negeer hem dan: er wordt niets gekoppeld tot hij wordt geopend in de browser die erom vroeg.

De koppeling van je account hoort bij dit project. Is een ander project aan hetzelfde Mattermost-team gekoppeld, koppel je account dan daar ook.

## Opgeroepen worden in Mattermost

Om met een direct bericht te worden opgeroepen als je dienst hebt, voeg je Mattermost toe als een van je meldingsmethoden:

:::steps
1. Koppel je eigen Mattermost-account (zie [Je eigen Mattermost-account koppelen](#je-eigen-mattermost-account-koppelen)).
2. Ga naar **Gebruikersinstellingen** > **Meldingsmethoden**, open het tabblad **Werkruimte-apps** en klik op **Mattermost-account toevoegen**.
3. Klik op **Send Test Message** in de rij ervan. Het bericht komt aan als direct bericht van de bot van het project.
:::

Toevoegen zet het meteen in je bereikbaarheidsregels, dus vanaf dan bereiken oproepen je in Mattermost. Wijzig welke oproepen het krijgt onder **Gebruikersinstellingen** > **Hoe ik bereikbaar ben**. Elke oproep bevat een link om hem te bevestigen en een om hem te escaleren. Als je je Mattermost-account ontkoppelt, verdwijnen deze methode en de bereikbaarheidsregels die hem gebruiken.

## Meldingsregels

Een meldingsregel bepaalt welke gebeurtenissen in Mattermost worden geplaatst, en waar. Elk product heeft zijn eigen regels, onder **Werkruimte** > **Mattermost** in zijn menu: **Incidenten** (met **Incidentepisodes** en een tabblad **Samenvatting**), **Waarschuwingen** (met **Waarschuwingsepisodes** en **Samenvatting**), **Geplande onderhoud**, **Monitoren**, **Bereikbaarheid**, **Beveiligingsgebeurtenissen** en **SLOs**. Ze werken zoals die van Slack: zie [Meldingsregels](/docs/workspace-connections/slack#meldingsregels) voor voorwaarden, bestemmingen en wie lid wordt van een kanaal.

Een kanaal dat een regel aanmaakt, krijgt de naam van zijn record: incident INC-42 krijgt `inc-42`. Mattermost neemt kleine letters, cijfers, `-` en `_`, tot 64 tekens, beginnend en eindigend met een letter of een cijfer, en het regelformulier toont de naam terwijl je typt. Bestaat er al een kanaal met die naam, zoals een gearchiveerd kanaal, dan voegt OneUptime `-2`, `-3` enzovoort toe. Een privé-incident, -waarschuwing of -episode krijgt een privékanaal.

Om in een bestaand kanaal te plaatsen, vul je de naam in zoals die in het adres van het kanaal staat, zoals `incidents` voor `chat.example.com/team/channels/incidents`, of de weergavenaam. OneUptime treedt zelf toe tot een openbaar kanaal de eerste keer dat het daar plaatst. Voeg de bot in Mattermost toe aan een privékanaal voordat een regel erin plaatst. Zit de bot in meer dan één team, dan kiest een regel ook het team waarin zijn kanalen staan: zie [Meer dan één team](#meer-dan-één-team).

Mensen worden lid van het kanaal van een regel via het Mattermost-account dat ze hebben gekoppeld, of anders via het Mattermost-account met hun e-mailadres, als je server e-mailadressen aan de bot toont (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime noemt wie het niet kon toevoegen in één bericht in het kanaal, met een link om hun account te koppelen.

Een incident, waarschuwing, episode of geplande onderhoudsgebeurtenis met een eigen kanaal heeft **Openen in Mattermost** in de kop van zijn pagina in OneUptime, naast de statusknoppen. Die opent dat kanaal in een nieuw tabblad, op je Mattermost-server. Een record met twee eigen kanalen toont ze allebei onder de knop. Een record dat ook kanalen in Slack of Microsoft Teams heeft, heeft in plaats daarvan één knop **Kanaal openen**, die ze allemaal toont. De bestaande kanalen waarin je regels posten, worden niet aangeboden.

**Regel testen** in de rij van een regel plaatst een testbericht voor die regel in de kanalen die hij noemt, zoals bij Slack.

De berichten van OneUptime sturen niemand een melding via wat ze citeren: een naam of een beschrijving met `@channel`, `@here` of `@someone` wordt getoond zoals die is geschreven, en pingt niemand.

## Wie er in het kanaal van een record zit

Een incident, waarschuwing, episode of geplande onderhoudsgebeurtenis met een eigen Mattermost-kanaal heeft een kaart **Mattermost-kanaal** op zijn pagina in OneUptime. De kaart toont het kanaal, als link die het op je Mattermost-server opent, of het privé is en wie erin zit, jij eerst. Vanaf de kaart, zonder Mattermost-beheerder:

- **Deelnemen aan kanaal** voegt jou toe, als je niet in het kanaal zit.
- **Mensen toevoegen** opent een lijst van de mensen en teams van het project: kies iemand om die toe te voegen, of een team om iedereen erin toe te voegen.

De bot van OneUptime voegt ze toe, zoals hij de mensen van het kanaal van een regel toevoegt. De bot blijft in de kanalen die hij aanmaakt, dus dit werkt ook voor een privékanaal dat iedereen heeft verlaten. Een record dat ook kanalen in Slack of Microsoft Teams heeft, toont ze allemaal op één kaart **Chatkanalen**.

- **Wie mensen mag toevoegen.** Wie het record mag bewerken: **Projecteigenaar**, **Projectbeheerder**, **Projectlid**, **Incidentbeheerder** en **Incidentlid** voor een incident, of **Edit Incident** in een aangepaste rol, en dezelfde toestemming voor een waarschuwing, een episode of een gebeurtenis (bijvoorbeeld **Edit Alert**). Ieder ander ziet wie er in het kanaal zit, en hoe je erin komt.
- **Wie kan worden toegevoegd.** Iemand die OneUptime in Mattermost vindt, via het account dat diegene heeft gekoppeld of anders via het e-mailadres, als je server e-mailadressen aan de bot toont, en die in het team van het kanaal zit. Ook een gastaccount in dat team kan worden toegevoegd: Mattermost laat de leden van een kanaal gasten toevoegen. De kaart noemt wie hij niet kon toevoegen, en waarom.
- **Wat wordt vastgelegd.** Wie is toegevoegd, en door wie, in de feed van het record (**Kanaallid toegevoegd**) en in **Projectinstellingen** > **Meldingen** > **Meldingslogboeken**, op het tabblad **Werkruimte**.
- **Een gearchiveerd kanaal.** De kaart toont nog steeds wie erin zit, en voegt niemand toe totdat het kanaal in Mattermost uit het archief is gehaald.
- **Een kanaal waaruit de bot is verwijderd.** Mattermost toont de mensen van een kanaal alleen aan iemand die erin zit, ook bij een openbaar kanaal, dus de kaart zegt dat hij het kanaal niet kan zien. Iemand in het kanaal kan de bot weer toevoegen in Mattermost. OneUptime gaat ook vanzelf weer in een openbaar kanaal zitten zodra het daar weer iets plaatst.
- **Iemand eruit halen.** OneUptime voegt alleen toe: haal iemand in Mattermost uit het kanaal.

## Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Mattermost

De berichten van OneUptime hebben knoppen, en een menu **More actions** voor wat minder mensen nodig hebben. Elk ervan handelt als jou, met jouw rechten in het project, en antwoordt in een bericht dat alleen jij ziet.

| Record | Knoppen en menu |
| --- | --- |
| **Incident** | **Acknowledge**, **Resolve**, **Add Note**, en in het menu **Change Severity** en **Change State** |
| **Waarschuwing** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Incidentepisode, waarschuwingsepisode** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Gepland onderhoud** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** en **Execute On-Call Policy** openen een formulier in Mattermost. Een notitie bij een incident of een geplande onderhoudsgebeurtenis kan openbaar zijn, getoond op de statuspagina, of privé; een notitie bij een privé-incident is altijd privé, en bij een waarschuwing ook altijd privé. Elk bericht heeft ook een link die zijn record in OneUptime opent, voor al het andere. Als openbare notities in het project goedkeuring nodig hebben, wacht een openbare notitie uit het formulier daarop, en een bericht dat alleen jij ziet, zegt op wie ze wacht: zie [Goedkeuring van openbare notities](/docs/incidents/notes-owners-and-feed#goedkeuring-van-openbare-notities).

Is je Mattermost-account nog niet gekoppeld, dan zegt een knop je dat, met een link naar **Gebruikersinstellingen** > **Werkruimte** > **Mattermost**. Koppel je account en druk daarna opnieuw op de knop.

Elke druk op een knop wordt vastgelegd in **Projectinstellingen** > **Meldingen** > **Meldingslogboeken**, op het tabblad **Werkruimte**, met wie erop drukte.

## Een openbare notitie goedkeuren

Als de openbare notities van uw project goedgekeurd moeten worden en u Mattermost aanzet voor **Goedkeuring van openbare notities** in uw meldingsinstellingen, komt elke openbare notitie die wacht op een stap die u goedkeurt naar uw directe berichten met de bot van OneUptime: wie haar stuurde, op welke stap ze wacht, de notitie, **Approve**, **Reject** en een link naar de notitie in OneUptime. **Approve** keurt haar goed voor die stap; bij de laatste stap heet de knop **Approve and publish** en wordt de notitie meteen gepubliceerd. **Reject** opent een formulier dat naar de reden vraagt: een reden is verplicht, en de auteur van de notitie ziet hem. De knoppen handelen als u, volgens dezelfde regels als in OneUptime, en antwoorden in een bericht dat alleen u ziet. Een klik nadat iemand anders heeft beslist, of nadat de notitie of haar stappen zijn veranderd, beslist niets en zegt wat er is gebeurd. Zodra over de notitie is beslist, verandert het bericht van elke goedkeurder erover, ook het uwe, en zegt het wat er is gebeurd: goedgekeurd voor haar stap en op wie ze nu wacht, gepubliceerd, afgewezen, gewijzigd of opnieuw ter goedkeuring gestuurd, zonder goedkeuring gepubliceerd, of verwijderd. Het houdt zijn link naar de notitie in OneUptime, en **Approve** en **Reject** zijn verdwenen. Is uw Mattermost-account niet verbonden, verbind het dan onder **Gebruikersinstellingen** > **Werkruimte** > **Mattermost** en klik daarna opnieuw op de knop. Veranderen de goedkeuringsstappen terwijl een notitie wacht, dan verandert ook je bericht erover als de notitie niet meer op jouw stap wacht of je niet meer gevraagd wordt, en wie ze nu nodig heeft, krijgt een eigen bericht. Zie [Goedkeuring van openbare notities](/docs/incidents/notes-owners-and-feed#goedkeuring-van-openbare-notities).

## Netwerk en zelf hosten

Twee servers praten met elkaar:

- **OneUptime roept je Mattermost-server aan**, om te plaatsen, kanalen aan te maken en mensen toe te voegen. Op OneUptime Cloud moet je Mattermost-server vanaf het internet bereikbaar zijn. Een zelf gehoste OneUptime kan een Mattermost-server op een privénetwerk bereiken zodra de beheerder van die OneUptime privéadressen toestaat met `ALLOW_PRIVATE_NETWORK_WEBHOOKS` of `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`. OneUptime roept nooit een adres op zijn eigen machine of een cloudmetadata-adres aan, en volgt nooit een omleiding.
- **Je Mattermost-server roept OneUptime aan** wanneer iemand op een knop drukt of een formulier verstuurt: `https://<your OneUptime>/api/mattermost/interactive` en `/api/mattermost/dialog`. Is het adres van OneUptime een privéadres, voeg dan de host ervan toe aan **System Console** > **Environment** > **Developer** > **Allow untrusted internal connections to** in Mattermost, anders werken de knoppen niet.

Elke knop die OneUptime plaatst, draagt een handtekening, die wordt gecontroleerd wanneer erop wordt gedrukt, voor het Mattermost-team waarin hij is geplaatst: een druk op een knop die OneUptime niet heeft ondertekend, of een die vanuit een ander team is verstuurd, doet niets.

## Problemen oplossen

| Wat je ziet | Wat je doet |
| --- | --- |
| **Mattermost did not accept the access token** | Kopieer het token van de bot opnieuw. Mattermost toont het maar één keer: maak zo nodig een nieuw aan onder **Integrations** > **Bot Accounts**. |
| **The bot account is not a member of any team** | Voeg de bot in Mattermost toe aan je team en koppel daarna opnieuw. |
| Een team waaraan je de bot hebt toegevoegd, staat niet op de kaart **Mattermost-teams** | Klik op **Vernieuwen** op de kaart. |
| **OneUptime's bot is not a member of this Mattermost team** | Je hebt een team gekozen dat de bot heeft verlaten. Voeg de bot in Mattermost toe aan dat team en klik daarna op **Vernieuwen**. |
| **OneUptime's bot may not create channels in the Mattermost team this rule names** | Voeg de bot in Mattermost toe aan dat team, of kies een ander team in de regel. |
| **OneUptime's bot is not a member of the Mattermost team chosen for the channel** | Voeg de bot in Mattermost toe aan dat team, of kies een ander team in de regel. |
| **OneUptime's bot is no longer a member of the project's default Mattermost team** | Voeg de bot in Mattermost weer toe aan dat team, of maak een ander team de standaard. |
| **OneUptime could not reach the Mattermost server** | Controleer het adres, en of OneUptime het kan bereiken. Zie [Netwerk en zelf hosten](#netwerk-en-zelf-hosten). |
| **The bot is not a member of the private Mattermost channel** | Voeg de bot in Mattermost toe aan het kanaal. |
| Een knop doet niets, of Mattermost zegt dat het de actie niet kon voltooien | Mattermost kan OneUptime niet bereiken. Zie [Netwerk en zelf hosten](#netwerk-en-zelf-hosten). |
| Er komt geen direct bericht met je link aan | Controleer de gebruikersnaam, en of de bot in een team zit waarin jij ook zit. |
| De kanaalkaart zegt dat OneUptime het kanaal niet kan zien | Het kanaal is verwijderd, of de bot is eruit verwijderd. Als het nog bestaat, kan iemand in het kanaal de bot weer toevoegen in Mattermost. |
| De kanaalkaart zegt dat iemand niet in het Mattermost-team zit | Voeg diegene in Mattermost toe aan het team van het kanaal, en voeg diegene daarna opnieuw toe. |
