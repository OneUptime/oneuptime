# Mattermost

Koppel OneUptime aan je Mattermost-server om incidenten, waarschuwingen, episodes, gepland onderhoud, monitoren en updates van de bereikbaarheidsdienst in je kanalen te plaatsen, elk incident een eigen kanaal te geven en responders te laten bevestigen, oplossen, notities toevoegen en de status wijzigen zonder Mattermost te verlaten.

:::cards
- [Mattermost koppelen](#mattermost-koppelen): Maak een botaccount voor OneUptime aan en koppel daarna het project met zijn token.
- [Je eigen account koppelen](#je-eigen-mattermost-account-koppelen): Koppel je Mattermost-account aan je OneUptime-account.
- [Meldingsregels](#meldingsregels): Bepaal welke gebeurtenissen waar worden geplaatst, en welke een eigen kanaal krijgen.
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

- **De koppeling van het project**, één keer gemaakt: een botaccount op je Mattermost-server, in het team waarin OneUptime plaatst. Die plaatst de berichten, maakt de kanalen aan en voegt er mensen aan toe.
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

Voeg de bot toe aan het team waarin OneUptime moet plaatsen, zoals je een persoon zou toevoegen: **Main Menu** > **Invite People**, en nodig `@oneuptime` uit. OneUptime maakt alleen in dat team kanalen aan en plaatst alleen daar.

### Het project koppelen

Ga in OneUptime naar **Projectinstellingen** > **Werkruimte** > **Mattermost** en klik op **Koppelen met Mattermost**. Vul het adres van je server in, zoals `https://chat.example.com`, en het toegangstoken van de bot. OneUptime controleert het token bij je server voordat het iets bewaart. Zit de bot in meer dan één team, dan vraagt OneUptime in welk team het moet plaatsen.

### Een meldingsregel toevoegen

Ga naar **Incidenten** > **Werkruimte** > **Mattermost** en maak een regel aan. Bijvoorbeeld een die voor elk nieuw incident een Mattermost-kanaal aanmaakt met iedereen die eraan werkt. Zie [Meldingsregels](#meldingsregels).
:::

Het toegangstoken van de bot wordt alleen op de OneUptime-server bewaard, versleuteld samen met de andere geheimen van het project, en wordt nooit meer getoond. Het serveradres, het team en de gebruikersnaam van de bot zijn voor iedereen in het project zichtbaar, op de instellingenpagina van Mattermost.

Een project is aan één Mattermost-team gekoppeld. Om het naar een ander team of een andere server te verplaatsen, ontkoppel je het eerst: **Projectinstellingen** > **Werkruimte** > **Mattermost**, daarna **⋯** > **Mattermost ontkoppelen**. Ontkoppelen ontkoppelt ook het eigen Mattermost-account van elk lid. Je meldingsregels en samenvattingen blijven bewaard voor als je opnieuw koppelt.

## Je eigen Mattermost-account koppelen

Mattermost heeft geen aanmelding waar OneUptime je naartoe kan sturen, dus stuurt de bot van OneUptime je Mattermost-account in plaats daarvan een direct bericht met een link:

:::steps
1. Ga naar **Gebruikersinstellingen** > **Werkruimte** > **Mattermost**. OneUptime zoekt het Mattermost-account met jouw e-mailadres. Vindt het er een, klik dan op **Link naar @your-username sturen**. Zo niet, klik dan op **Stuur mij een link** en vul je Mattermost-gebruikersnaam in.
2. Open het directe bericht van de OneUptime-bot in Mattermost en klik op **Connect my account**.
3. De link opent OneUptime, dat je account koppelt.
:::

Open de link in dezelfde browser waarin je hem hebt aangevraagd: hij werkt alleen daar, maar één keer en maar 15 minuten lang. Zo is bewezen dat wie de link aanvroeg beide accounts heeft, dus niemand kan het Mattermost-account van iemand anders koppelen. Heb je geen link aangevraagd, negeer hem dan: er wordt niets gekoppeld tot hij wordt geopend in de browser die erom vroeg.

De koppeling van je account hoort bij dit project. Is een ander project aan hetzelfde Mattermost-team gekoppeld, koppel je account dan daar ook.

## Meldingsregels

Een meldingsregel bepaalt welke gebeurtenissen in Mattermost worden geplaatst, en waar. Elk product heeft zijn eigen regels, onder **Werkruimte** > **Mattermost** in zijn menu: **Incidenten** (met **Incidentepisodes** en een tabblad **Samenvatting**), **Waarschuwingen** (met **Waarschuwing Episodes** en **Samenvatting**), **Geplande onderhoud**, **Monitoren**, **Bereikbaarheidsdienst** en **Beveiligingsgebeurtenissen**. Ze werken zoals die van Slack: zie [Meldingsregels](/docs/workspace-connections/slack#meldingsregels) voor voorwaarden, bestemmingen en wie lid wordt van een kanaal.

Een kanaal dat een regel aanmaakt, krijgt de naam van zijn record: incident INC-42 krijgt `inc-42`. Mattermost neemt kleine letters, cijfers, `-` en `_`, tot 64 tekens, beginnend en eindigend met een letter of een cijfer, en het regelformulier toont de naam terwijl je typt. Bestaat er al een kanaal met die naam, zoals een gearchiveerd kanaal, dan voegt OneUptime `-2`, `-3` enzovoort toe. Een privé-incident, -waarschuwing of -episode krijgt een privékanaal.

Om in een bestaand kanaal te plaatsen, vul je de naam in zoals die in het adres van het kanaal staat, zoals `incidents` voor `chat.example.com/team/channels/incidents`, of de weergavenaam. OneUptime treedt zelf toe tot een openbaar kanaal de eerste keer dat het daar plaatst. Voeg de bot in Mattermost toe aan een privékanaal voordat een regel erin plaatst.

Mensen worden lid van het kanaal van een regel via het Mattermost-account dat ze hebben gekoppeld, of anders via het Mattermost-account met hun e-mailadres, als je server e-mailadressen aan de bot toont (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime noemt wie het niet kon toevoegen in één bericht in het kanaal, met een link om hun account te koppelen.

**Testregel** in de rij van een regel plaatst een testbericht voor die regel in de kanalen die hij noemt, zoals bij Slack.

De berichten van OneUptime sturen niemand een melding via wat ze citeren: een naam of een beschrijving met `@channel`, `@here` of `@someone` wordt getoond zoals die is geschreven, en pingt niemand.

## Handelen op incidenten, waarschuwingen en gebeurtenissen vanuit Mattermost

De berichten van OneUptime hebben knoppen, en een menu **More actions** voor wat minder mensen nodig hebben. Elk ervan handelt als jou, met jouw rechten in het project, en antwoordt in een bericht dat alleen jij ziet.

| Record | Knoppen en menu |
| --- | --- |
| **Incident** | **Acknowledge**, **Resolve**, **Add Note**, en in het menu **Change Severity** en **Change State** |
| **Waarschuwing** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Incidentepisode, waarschuwingsepisode** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Gepland onderhoud** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** en **Execute On-Call Policy** openen een formulier in Mattermost. Een notitie bij een incident of een geplande onderhoudsgebeurtenis kan openbaar zijn, getoond op de statuspagina, of privé; een notitie bij een privé-incident is altijd privé, en bij een waarschuwing ook altijd privé. Elk bericht heeft ook een link die zijn record in OneUptime opent, voor al het andere.

Is je Mattermost-account nog niet gekoppeld, dan zegt een knop je dat, met een link naar **Gebruikersinstellingen** > **Werkruimte** > **Mattermost**. Koppel je account en druk daarna opnieuw op de knop.

Elke druk op een knop wordt vastgelegd in **Projectinstellingen** > **Meldingen** > **Meldingslogboeken**, op het tabblad **Werkruimte**, met wie erop drukte.

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
| **OneUptime could not reach the Mattermost server** | Controleer het adres, en of OneUptime het kan bereiken. Zie [Netwerk en zelf hosten](#netwerk-en-zelf-hosten). |
| **The bot is not a member of the private Mattermost channel** | Voeg de bot in Mattermost toe aan het kanaal. |
| Een knop doet niets, of Mattermost zegt dat het de actie niet kon voltooien | Mattermost kan OneUptime niet bereiken. Zie [Netwerk en zelf hosten](#netwerk-en-zelf-hosten). |
| Er komt geen direct bericht met je link aan | Controleer de gebruikersnaam, en of de bot in een team zit waarin jij ook zit. |
