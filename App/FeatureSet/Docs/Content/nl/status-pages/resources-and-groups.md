# Statuspagina – bronnen en groepen

Een resource is één rij op je statuspagina — een monitor (of een monitorgroep) met een naam die bezoekers begrijpen, een huidige status, en optioneel een uptimegetal en een geschiedenisgrafiek. Een groep is een sectie die resources bevat, zodat een pagina met veertig monitoren leest als "API", "Webapp" en "Datapijplijn" in plaats van één eindeloze lijst.

Je bouwt beide op één scherm. Open een statuspagina en kies **Resources** in het zijmenu (het item heet **Monitors** op projecten die geen monitorgroepen hebben ingeschakeld). Groepen leefden vroeger op hun eigen pagina; dat is niet meer zo, en de oude `/groups`-URL stuurt gewoon hierheen door.

Krijg dit deel goed voor elkaar en de rest van de statuspagina is decoratie. Bezoekers beoordelen "ligt het aan mij of aan hen?" aan de hand van deze rijen, dus benoem ze zoals klanten over je product praten — **Checkout API**, niet `prod-checkout-lb-healthcheck-us-east-1`.

## Het scherm Resources

Het scherm is in tweeën gesplitst. Links staat een navigator met elke groep op de pagina; rechts staat de inhoud van de groep die je geselecteerd hebt.

- **De groepnavigator (links)** — een boom van groepen, met een zoekvak (**Search groups...**) erboven en een lopend aantal eronder, zoals `3 groups · 12 resources`. Wanneer een pagina meer groepen heeft dan past, onthult een knop **Show N more of M** de rest.
- **Top of page** — de eerste rij in de navigator. Hij bevat resources die in geen enkele groep zitten, en zijn tooltip zegt precies wat dat betekent: bezoekers zien deze als eerste, boven elke groep. Als de pagina helemaal geen groepen heeft, heet het rechterpaneel in plaats daarvan **All resources**.
- **Het resourcepaneel (rechts)** — getiteld met de groep die je geselecteerd hebt. De koptekst bevat **Edit Group**, de primaire knop **Add Monitor**, en een overflow **More actions**.

Twee knoppen staan in de kaartkoptekst zelf: **New Group**, en een driepuntsoverflow met **Import groups from CSV** en **Refresh**.

De beschrijving van de kaart verandert met de vorm van je pagina. Met groepen staat er dat dit alles is wat bezoekers zien en dat je links een groep kiest om te bewerken wat erin zit. Zonder groepen nog spoort hij je aan er een te maken om een langere pagina in secties op te splitsen.

**Lege staten vertellen je wat je moet doen.** Een lege groep toont **No monitors here yet** met **Add Monitor**, **Add Multiple**, en — alleen wanneer de statuspagina helemaal geen groepen heeft — **Create a Group**. Een zoekopdracht die niets oplevert toont **No resources match your search**. Een lege navigator zegt dat groepen een langere statuspagina in secties opsplitsen en dat ze genest kunnen worden.

## Een monitor toevoegen

Selecteer de groep waarin je de resource wilt laten landen (of **Top of page** voor een ongegroepeerde rij), en klik dan op **Add Monitor**. De modal heet **Add a monitor to {group}** en heeft twee stappen: **Monitor Details** en **Advanced**.

Op **Monitor Details**:

- **Monitor** — de dropdown met de monitoren in je project, placeholder **Select Monitor**. Verplicht.
- **Display Name** — verplicht. Dit is de tekst die bezoekers lezen, en hij wordt los opgeslagen van de eigen naam van de monitor, zodat je hem hier kunt hernoemen zonder aan de monitoring te komen.
- **Description** — optionele markdown die onder de rij getoond wordt. Handig voor een zin die uitlegt wat de service eigenlijk doet.

Als je project monitorgroepen heeft ingeschakeld, staat er onder de dropdown een link **Add a Monitor Group instead.** — klik erop en de dropdown **Monitor** wordt vervangen door een dropdown **Monitor Group** (**Select Monitor Group**). De link verandert dan in **Add a Monitor instead.** zodat je terug kunt. Gebruik een monitorgroep wanneer je wilt dat één rij op de pagina meerdere samengevoegde checks vertegenwoordigt.

### Meerdere tegelijk toevoegen

**Add Multiple** (ook **Add multiple monitors** in het menu **More actions**) opent **Add Multiple Monitors**. Het heeft dezelfde twee stappen, maar de eerste is een multi-select **Monitors** in plaats van een enkele dropdown, en de weergaveopties die je op **Advanced** kiest, gelden voor elke monitor die je geselecteerd hebt. Dit is de snelste manier om een nieuwe pagina te vullen.

## Weergaveopties op een resource

De stap **Advanced** is dezelfde op het formulier voor enkel toevoegen en op de bulkmodal. Alles hier is per resource — twee rijen in dezelfde groep kunnen anders geconfigureerd worden.

| Veld                                                      | Doel                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Tooltip** (`displayTooltip`)                              | Extra tekst die naast de resource op je statuspagina getoond wordt. Gebruik hem voor scope: "US and EU customers". |
| **Show Current Resource Status** (`showCurrentStatus`)      | Standaard aan. Toont de live status — operationeel, verminderd, offline — naast de rij.                |
| **Show Uptime %** (`showUptimePercent`)                     | Standaard uit. Toont een uptimepercentage naast de resource.                                           |
| **Select Uptime Precision** (`uptimePercentPrecision`)      | Verschijnt alleen zodra **Show Uptime %** aan staat. Verplicht, standaard één decimaal.                |
| **Show Status History Chart** (`showStatusHistoryChart`)    | Standaard aan. Toont de dag-voor-dag uptime-geschiedenisbalkgrafiek voor de resource.                  |

**Display Name** (`displayName`) en **Description** (`displayDescription`) uit de eerste stap zijn ook alleen-weergave — ze veranderen nooit de monitor zelf.

## Uptimepercentages en geschiedenisgrafieken

Zowel **Show Uptime %** als **Show Status History Chart** hangen af van een instelling die ergens anders leeft. Het venster dat ze bestrijken is **Show Uptime History (in days)** onder **Status Pages → jouw pagina → Advanced → Advanced Settings**, in de kaart **Uptime History Settings**. Het accepteert 1 tot 90 dagen en staat standaard op 90.

De volgorde is dus: zet de schakelaars per resource aan, en stel dan het venster één keer in voor de hele pagina.

**Precisie is een kwestie van inschatting.** De dropdown **Select Uptime Precision** biedt `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` en `99.999% (Three Decimal)`. Meer decimalen zien er precies uit en lokken discussies uit over die derde decimaal; als je een SLA publiceert op drie negens, match dat en niet meer.

Groepen hebben hun eigen kopieën van deze schakelaars — zie hieronder — zodat een groep een opgeteld percentage kan tonen terwijl de afzonderlijke monitoren erin stil blijven, of andersom.

De kleuren van de balken in de geschiedenisgrafiek, en welke monitorstatussen als "down" tellen, worden ingesteld op het brandingscherm **Overview Page**, behandeld in [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains).

## Groepen

Klik op **New Group** om **Create New Status Page Group** te openen. Het formulier heeft drie stappen: **Group Details**, **Layout** en **Advanced**.

**Group Details**:

- **Group Name** (`name`) — verplicht. Dit is de sectiekop die bezoekers zien.
- **Group Description** (`description`) — optionele markdown, getoond onder de kop.
- **Parent Group** (`parentStatusPageGroupId`) — optioneel. Laat op **No parent group (top level)** staan om de groep op het topniveau te houden.
- **Expand on Status Page by Default** (`isExpandedByDefault`) — of de sectie voor bezoekers open of ingeklapt begint.

**Advanced** spiegelt de resourceschakelaars op groepsniveau:

- **Show Current Group Status** (`showCurrentStatus`) — standaard aan. Toont een status naast de groepskop.
- **Show Uptime %** (`showUptimePercent`) — standaard uit, met **Select Uptime Precision** die verschijnt zodra hij aan staat.

Bewerken werkt op dezelfde manier: **Edit Group** in de paneelkoptekst, of **Edit group** in het rijmenu van de navigator, opent **Edit Status Page Group** met een knop **Save Changes**.

De paneelkoptekst toont chips voor de instellingen die momenteel aan staan — **Grid**, **Collapsed by default**, **Uptime %** — zodat je kunt zien hoe een groep geconfigureerd is zonder het formulier te openen.

### Een groep beheren

Het rijmenu van de navigator bevat **Edit group**, **Move up**, **Move down**, **Show ID** en **Delete group**. De overflow **More actions** van het paneel heeft de uitgebreidere equivalenten — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Refresh** en **Delete this group**. Een groep die zonder naam wordt opgeslagen, wordt weergegeven als **Untitled group**, wat een goed teken is dat je iets had willen typen.

## Groepen nesten

Groepen zijn nestbaar: stel **Parent Group** in op het kind, of gebruik de actie **Add a sub group inside this group** van de navigator. De eigen helptekst van het formulier beschrijft de vorm waarvoor het gebouwd is — zoiets als Corporate Units › Region › Market — en merkt op dat elk niveau de opgetelde status en uptime van alles eronder toont.

Wanneer een groep kinderen heeft, toont het resourcepaneel een rij chips **Sub groups** die rechtstreeks naar elk kind linkt, zodat je door de hiërarchie kunt lopen zonder terug te gaan naar de navigator.

Nesten verdient zichzelf terug op grote pagina's: een hostingprovider met regio's binnen producten, of een retailer met markten binnen bedrijfsonderdelen. Op een pagina met twaalf monitoren is één plat niveau vriendelijker.

## Lijstlayout versus rasterlayout

De stap **Layout** stelt **View Mode** (`viewMode`) in voor de groep, en dat verandert hoe de groep publiek wordt weergegeven.

| Als je wilt…                                                              | Kies                    |
| ---------------------------------------------------------------------------- | ------------------------ |
| Een gewone verticale lijst met services tonen, één per rij                   | **List** (de standaard) |
| Dezelfde service tonen over meerdere regio's of tenants als een matrix       | **Grid**                |

Kies **Grid** en er verschijnen vier extra velden:

- **Row Axis Label** — de naam van de rijdimensie, placeholder `Service`.
- **Row Axis Values** — de rijen zelf, één voor één toegevoegd met **Add Row** (placeholder `e.g. Auth`).
- **Column Axis Label** — de kolomdimensie, placeholder `Region`.
- **Column Axis Values** — toegevoegd met **Add Column** (placeholder `e.g. US-East`).

Elke monitor in een rastergroep wordt vervolgens in een cel geplaatst, dus de bulkmodal vraagt om de rij en kolom naast de monitoren, met je eigen asnamen.

**Stel de assen in voordat je monitoren toevoegt.** Een rastergroep zonder rijen of kolommen toont een oranje melding dat er nergens is om een monitor te plaatsen totdat de assen bestaan, met een knop **Set up the grid** — en de knop **Add Monitor** wordt ingetrokken totdat je dat doet.

## Ordenen wat bezoekers zien

Volgorde is expliciet, niet alfabetisch, en wordt op drie plekken ingesteld:

- **Resources binnen een groep** — sleep een rij. Het paneel zegt het zelf: **Drag a row to change the order visitors see**.
- **Groepen ten opzichte van elkaar** — **Move up** / **Move down** in het rijmenu van de navigator, of **Move group up** / **Move group down** in de overflow van het paneel.
- **Ongegroepeerde resources** — die leven in **Top of page** en worden altijd boven elke groep weergegeven, dus zet daar het ene ding dat iedereen als eerste checkt.

**Twee gevallen waarin slepen uit staat.** Het filteren van het paneel met het vak **Search in {group}...** schakelt herordenen uit — het paneel vertelt je `N of M shown · drag to reorder is off while filtering`, dus wis eerst de zoekopdracht. En rastergroepen ondersteunen nooit sleepvolgorde, omdat positie in plaats daarvan uit de rij- en kolomassen komt.

Zet de meest gevraagde service bovenaan. Bezoekers die tijdens een storing op de pagina komen, stoppen meestal met lezen na het eerste scherm.

## Groepen importeren vanuit CSV

Een diepe hiërarchie handmatig bouwen is vervelend. De driepuntsoverflow in de kaartkoptekst heeft **Import groups from CSV**, wat de modal **Import Groups from CSV** opent.

De flow is: **Download CSV Template** om `status-page-groups-template.csv` te krijgen, invullen, **Choose CSV File**, en dan **Preview Import** om te controleren wat er aangemaakt wordt voordat er iets geschreven wordt. Het resultaat splitst zich in **Groups Imported** en **Some Groups Could Not Be Imported**, zodat een foute rij niet stilletjes verdwijnt.

Alleen `name` is verplicht. De geaccepteerde kolommen zijn:

| Kolom                     | Wat hij instelt                                        |
| --------------------------- | --------------------------------------------------------- |
| `name`                       | De groepsnaam. Verplicht.                                 |
| `parentName`                 | De naam van de groep waarin deze nest.                    |
| `description`                | De groepsbeschrijving.                                     |
| `isExpandedByDefault`        | Of de sectie voor bezoekers open begint.                   |
| `showCurrentStatus`          | Of er een status naast de groepskop getoond wordt.         |
| `showUptimePercent`          | Of er een uptimepercentage naast de groep getoond wordt.   |
| `uptimePercentPrecision`     | Hoeveel decimalen dat percentage gebruikt.                 |
| `viewMode`                   | `List` of `Grid`.                                          |
| `rowAxisLabel`               | Naam van de rijdimensie voor een rastergroep.               |
| `rowAxisValues`              | De rijwaarden voor een rastergroep.                         |
| `columnAxisLabel`            | Naam van de kolomdimensie voor een rastergroep.              |
| `columnAxisValues`           | De kolomwaarden voor een rastergroep.                        |

De import maakt groepen aan, geen resources — voeg daarna monitoren toe met **Add Monitor** of **Add Multiple**.

## Waar je hierna kunt lezen

- [Statuspagina's – Overzicht](/docs/status-pages/index) — wat een statuspagina is en hoe de onderdelen op elkaar aansluiten.
- [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains) — logo, favicon, grafiekkleuren, en de pagina op je eigen domein zetten.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie bericht krijgt wanneer deze resources veranderen.
- [Public API](/docs/status-pages/public-api) — programmatisch statuspaginadata lezen.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat een incident op de pagina laat verschijnen, en weer verdwijnen.
