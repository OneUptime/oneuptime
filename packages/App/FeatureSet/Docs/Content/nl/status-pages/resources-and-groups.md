# Statuspagina – bronnen en groepen

Een resource is één rij op uw statuspagina: een monitor of een monitorgroep, met een naam die uw klanten begrijpen, de huidige status en, als u wilt, de uptime en de geschiedenis. Groepen zijn secties die resources bevatten, zodat een pagina met veertig monitoren leest als "API", "Webapp" en "Datapipeline" in plaats van als één eindeloze lijst. U bouwt beide op één scherm: open een statuspagina en kies **Middelen** in het zijmenu.

:::cards
- [Een monitor toevoegen](#een-monitor-toevoegen): Zet een monitor op de pagina, met de naam die bezoekers lezen.
- [Groepen](#groepen): Verdeel de pagina in secties en nest ze.
- [Monitorregels](#monitoren-automatisch-toevoegen-met-monitorregels): Laat een regel elke overeenkomende monitor voor u toevoegen.
- [Groepen importeren uit CSV](#groepen-importeren-uit-csv): Bouw in één keer een diepe hiërarchie.
:::

Bezoekers beoordelen aan de hand van deze rijen "ligt het aan mij of aan hen?", dus geef ze de namen die klanten voor uw product gebruiken: **Checkout API**, niet `prod-checkout-lb-healthcheck-us-east-1`.

## Hoe een status door de pagina omhoog werkt

Elke rij toont de huidige status van haar monitor. Elk niveau daarboven toont de slechtste status van alles eronder, waarbij de slechtste status die is met de hoogste prioriteit onder de monitorstatussen van uw project.

```mermaid title="Hoe de status van een monitor de bovenkant van de pagina bereikt"
flowchart TB
    subgraph Rows["Resourcerijen"]
        direction LR
        M["Monitor:<br/>zijn eigen status"]
        MG["Monitorgroep:<br/>de slechtste van zijn monitoren"]
    end
    Rows --> G["Groepskop:<br/>slechtste status eronder"]
    G --> P["Bovenliggende groep:<br/>slechtste status eronder"]
    Rows --> O["Banner met algemene status:<br/>slechtste status op de pagina"]
```

Een resource bepaalt meer dan de kleur van haar rij:

- **Gearchiveerde monitoren worden niet getoond.** Een gearchiveerde monitor wordt niet meer gecontroleerd, dus zijn laatste status is bevroren; de pagina laat zijn rij weg (en laat hem buiten de status van een monitorgroep) in plaats van die bevroren status te tonen alsof hij actueel is. De rij blijft bewaard, dus de monitor uit het archief halen zet hem meteen terug.
- **Resources bepalen welke incidenten de pagina toont.** Een incident verschijnt hier, en de abonnees van de pagina horen ervan, wanneer een van de monitoren van het incident een resource op de pagina is, rechtstreeks of via een monitorgroep. Zet dezelfde monitor op meerdere pagina's en zijn incidenten bereiken ze allemaal, tenzij een incident tot enkele van die pagina's is beperkt. Zie [Eén statuspagina per doelgroep](/docs/status-pages/one-status-page-per-audience).
- **Een rij van een monitorgroep staat voor elke monitor erin, ook voor abonnees.** Op een pagina die abonnees resources laat kiezen, hoort iemand die zich op een monitorgroep abonneert over incidenten, gepland onderhoud en aankondigingen van elke monitor in de groep, alsof die persoon die monitor had gekozen. Zie [Abonnees en aankondigingen](/docs/status-pages/subscribers#abonnees-zelf-resources-en-gebeurtenistypen-laten-kiezen).

## Het scherm Middelen

Het item heet **Middelen** in projecten waarin monitorgroepen zijn ingeschakeld, en **Monitoren** in de andere; het is hetzelfde scherm. Groepen hadden vroeger een eigen pagina, en het oude adres `/groups` opent nu dit scherm.

Het scherm is in tweeën verdeeld:

| Deel | Wat het bevat |
| ---- | ------------- |
| **Groepsnavigator** (links) | Elke groep op de pagina, als boom, met een vak **Search groups...** erboven en een telling eronder, zoals `3 groups · 12 resources`. Een lange lijst eindigt met een knop **Show N more of M**. |
| **Top of page** | De eerste rij van de navigator: resources zonder groep, die bezoekers als eerste zien, boven elke groep. Op een pagina zonder groepen heet het rechterdeelvenster in plaats daarvan **All resources**. |
| **Resourcedeelvenster** (rechts) | De resources van de geselecteerde groep. De kop ervan bevat **Edit Group**, de primaire knop **Monitor toevoegen** en een menu **More actions**. |
| Kaartkop | **New Group**, en een menu met drie puntjes met **Import groups from CSV** en **Vernieuwen**. |

**Lege toestanden vertellen u wat u moet doen.** Een lege groep toont **No monitors here yet** met **Monitor toevoegen**, **Add Multiple** en, alleen zolang de pagina helemaal geen groepen heeft, **Create a Group**. Een zoekopdracht zonder resultaat toont **No resources match your search**.

## Een monitor toevoegen

:::steps
### Kiezen waar de rij komt

Selecteer in de groepsnavigator de groep waarin de resource thuishoort, of **Top of page** voor een rij zonder groep.

### Klikken op Monitor toevoegen

Het dialoogvenster **Add a monitor to {group}** opent. Het bestaat uit één pagina.

### De monitor kiezen

Kies hem in **Monitor** (plaatshouder **Selecteer monitor**). **Weergavenaam**, de tekst die bezoekers lezen, wordt ingevuld met de naam van de monitor en gaat mee wanneer u een andere monitor kiest, tot u zelf een naam typt. Hij wordt los van de naam van de monitor zelf opgeslagen, dus hem hier hernoemen verandert niets aan de bewaking.

### De weergaveopties instellen, als u wilt

**Meer velden** is ingeklapt. Het bevat **Beschrijving** (optionele markdown onder de rij, handig voor een zin die uitlegt wat de service echt doet; een afbeelding erin wordt aan elke bezoeker getoond) en de [weergaveopties](#weergaveopties-van-een-resource). Laat het dicht en de resource krijgt de standaardwaarden ervan.

### De resource opslaan

Klik op **Monitor toevoegen**. De rij verschijnt in de groep en op de statuspagina.
:::

In een rastergroep vraagt het dialoogvenster boven **Meer velden** ook om de rij en de kolom waarin de monitor komt; zie [Lijstindeling of rasterindeling](#lijstindeling-of-rasterindeling).

> [!TIP]
> Om meerdere controles als één rij te tonen, voegt u een monitorgroep toe. Met de schakelaar **Monitorgroepen** aan (**Projectinstellingen** > **Geavanceerd** > **Functievlaggen**, die wordt opgeslagen zodra u hem omzet) staat onder de keuzelijst een link **Add a Monitor Group instead.** Klik erop en **Monitor** wordt **Monitor Groep** (**Selecteer monitorgroep**); **Add a Monitor instead.** zet het terug.

### Meerdere tegelijk toevoegen

**Add Multiple** (ook **Add multiple monitors** in het menu **More actions**) opent **Add Multiple Monitors**. Ook dat is één pagina: een meervoudige selectie **Monitoren**, dan dezelfde ingeklapte **Meer velden**, waarvan de weergaveopties gelden voor elke monitor die u kiest. Elke resource neemt de weergavenaam en beschrijving van zijn monitor over, en **Add Monitors** voegt ze allemaal toe. Zo vult u het snelst een nieuwe pagina.

De meervoudige selectie heeft een tabblad **Labels**: klik op een label en elke monitor met dat label wordt in één keer geselecteerd.

### Twee keer op label toevoegen is veilig

Een statuspagina toont een monitor maar één keer. Toevoegen is idempotent, dus hetzelfde label opnieuw kiezen nadat u een paar nieuwe monitoren een label hebt gegeven, voegt alleen de nieuwe toe: de monitoren die al op de pagina staan, blijven precies zoals ze zijn, met de weergavenaam en opties die u ze gaf.

De samenvatting aan het eind van het bulksgewijs toevoegen zegt dat ook: toegevoegde monitoren staan onder **Toegevoegd**, en de monitoren die er al stonden onder **Already Added**. Niets wordt als fout gemeld, en voor die monitoren wordt niets weggeschreven.

Dezelfde regel geldt overal waar een resource wordt aangemaakt. Een monitor die al op de pagina staat, toevoegen vanuit het formulier voor één monitor, of een bestaande resource er vanuit het bewerkformulier naar laten verwijzen, wordt geweigerd met *"This monitor is already added to this status page"*, ook wanneer de bestaande resource in een andere groep staat, want een bezoeker zou de monitor anders toch twee keer zien. Om een monitor in een andere groep te tonen, verwijdert u de resource die hij al heeft en voegt u hem toe waar u hem wilt hebben.

## Weergaveopties van een resource

De sectie **Meer velden** is dezelfde in het formulier voor één monitor en in het bulkvenster. Ze begint in beide ingeklapt, en ook in **Resource bewerken**, waar de ingeklapte kop laat zien wat er niet op de standaardwaarde staat. Alles hier geldt per resource: twee rijen in dezelfde groep kunnen verschillend zijn ingesteld.

| Veld | Standaard | Wat het doet |
| ----- | ------- | ------------ |
| **Tooltip** (`displayTooltip`) | Leeg | Wordt als tooltip naast de resource op uw statuspagina getoond. Gebruik het voor de reikwijdte: "Klanten in de VS en de EU". |
| **Huidige resourcestatus weergeven** (`showCurrentStatus`) | Aan | Toont de actuele status, zoals operationeel, verminderd of offline, naast de rij. |
| **Uptime % weergeven** (`showUptimePercent`) | Uit | Toont een uptimepercentage naast de resource. |
| **Selecteer uptime-precisie** (`uptimePercentPrecision`) | Eén decimaal | Verschijnt zodra **Uptime % weergeven** aan staat, en is dan verplicht. |
| **Statusgeschiedenisgrafiek weergeven** (`showStatusHistoryChart`) | Aan | Toont de dagelijkse balken van de uptimegeschiedenis van de resource. |

**Weergavenaam** (`displayName`) en **Beschrijving** (`displayDescription`) dienen ook alleen voor de weergave: ze veranderen nooit de monitor zelf.

## Uptimepercentages en geschiedenisgrafieken

**Uptime % weergeven** en **Statusgeschiedenisgrafiek weergeven** lezen allebei één instelling voor de hele pagina: hoeveel dagen ze beslaan. Dat is **Uptimegeschiedenis** op de kaart **Wat uw statuspagina toont** onder **Statuspagina's → uw pagina → Geavanceerd → Geavanceerde instellingen**. Die accepteert 1 tot 90 dagen en staat standaard op 90. Zet de schakelaars dus per resource aan en stel het venster één keer in voor de hele pagina.

**Precisie is een kwestie van afwegen.** **Selecteer uptime-precisie** biedt `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` en `99.999% (Three Decimal)`. Meer decimalen ogen nauwkeurig en nodigen uit tot discussies over de derde; publiceert u een SLA van drie negens, kies dan precies dat en niet meer.

Groepen hebben hun eigen exemplaren van deze schakelaars (zie hieronder), dus een groep kan een samengevat percentage tonen terwijl de monitoren erin stil blijven, of andersom.

De kleuren van de balken in de geschiedenisgrafiek stelt u in onder **Meer instellingen** op de pagina **Huisstijl**, en welke monitorstatussen als "down" tellen bij **Telt als downtime**, op de kaart **Wat uw statuspagina toont** van **Geavanceerde instellingen**; beide worden behandeld in [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains).

## Groepen

De meeste groepen hebben alleen een naam nodig.

:::steps
### Klikken op New Group

**Create New Status Page Group** opent: twee velden, daarna twee ingeklapte secties.

### De groep een naam geven

Typ de **Groepsnaam**: de sectiekop die bezoekers zien.

### Hem nesten, als hij in een andere groep thuishoort

Kies een **Parent Group**, of laat het op **No parent group (top level)**. **Add a sub group** in de menu's van een groep vult dit voor u in.

### De groep maken

Klik op **Create Status Page Group**. De groep verschijnt in de navigator, klaar voor monitoren.
:::

De twee velden zijn **Groepsnaam** (`name`) en **Parent Group** (`parentStatusPageGroupId`). De twee ingeklapte secties bevatten de rest:

- **Indeling**: de ingeklapte kop zegt **List** of **Grid**. Ze bevat **Weergavemodus** en de assen van een raster (zie [Lijstindeling of rasterindeling](#lijstindeling-of-rasterindeling)), en ze klapt bij een rastergroep vanzelf open.
- **Meer velden**: de exemplaren op groepsniveau van de resource-opties:
  - **Groepsbeschrijving** (`description`): optionele markdown, onder de kop getoond. Een afbeelding erin wordt aan elke bezoeker getoond.
  - **Standaard uitvouwen op statuspagina** (`isExpandedByDefault`): standaard aan; bepaalt of de sectie voor bezoekers open of ingeklapt begint.
  - **Huidige groepsstatus weergeven** (`showCurrentStatus`): standaard aan. Toont een status naast de groepskop.
  - **Uptime % weergeven** (`showUptimePercent`): standaard uit, met **Selecteer uptime-precisie** zodra het aan staat.

Om een groep te wijzigen, gebruikt u **Edit Group** in de kop van het deelvenster, of **Edit group** in het rijmenu van de navigator: **Edit Status Page Group** opent, met een knop **Wijzigingen opslaan**. De kop van het deelvenster toont labels voor de instellingen die aan staan (**Grid**, **Collapsed by default**, **Uptime %**), zodat u ziet hoe een groep is ingesteld zonder het formulier te openen.

### Een groep beheren

| Waar | Acties |
| ----- | ------- |
| Het rijmenu van de navigator | **Edit group**, **Move up**, **Move down**, **ID weergeven**, **Delete group** |
| Het menu **More actions** van het deelvenster | **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Vernieuwen**, **Delete this group** |

Een groep die zonder naam is opgeslagen, verschijnt als **Untitled group**, een goed teken dat u iets wilde typen.

## Groepen nesten

Groepen zijn te nesten: stel **Parent Group** in op de onderliggende groep, of gebruik **Add a sub group inside this group** in de navigator. De helptekst van het formulier beschrijft de vorm waarvoor het bedoeld is (iets als Bedrijfsonderdelen › Regio › Markt), en elk niveau toont de samengevatte status en uptime van alles eronder.

Wanneer een groep onderliggende groepen heeft, toont het resourcedeelvenster een rij labels **Sub groups** die rechtstreeks naar elke onderliggende groep leidt, zodat u door de hiërarchie loopt zonder terug te gaan naar de navigator.

Nesten loont op grote pagina's: een hostingprovider met regio's binnen producten, of een retailer met markten binnen bedrijfsonderdelen. Op een pagina met twaalf monitoren is één plat niveau vriendelijker.

## Lijstindeling of rasterindeling

De sectie **Indeling** van het groepsformulier stelt de **Weergavemodus** (`viewMode`) van de groep in, die bepaalt hoe de groep op de statuspagina verschijnt.

| Als u… wilt | Kies |
| --------------- | ---- |
| Een eenvoudige verticale lijst van services wilt tonen, één per rij | **List** (de standaard) |
| Dezelfde service in meerdere regio's of tenants als matrix wilt tonen | **Grid** |

Kies **Grid** en er verschijnen nog vier velden:

| Veld | Wat u invult |
| ----- | ------------- |
| **Label van rij-as** | De naam van de rijdimensie, plaatshouder `Service`. |
| **Waarden van rij-as** | De rijen, één voor één toegevoegd met **Add Row** (plaatshouder `e.g. Auth`). |
| **Label van kolomas** | De kolomdimensie, plaatshouder `Region`. |
| **Waarden van kolomas** | De kolommen, toegevoegd met **Add Column** (plaatshouder `e.g. US-East`). |

Elke monitor in een rastergroep staat in een cel, dus **Monitor toevoegen** en het bulkvenster vragen naast de monitor ook om de rij en de kolom, met uw eigen aslabels.

> [!IMPORTANT]
> Stel de assen in voordat u monitoren toevoegt. Een rastergroep zonder rijen of kolommen toont een melding dat er nog nergens een monitor kan staan, met een knop **Set up the grid** die het groepsformulier op de sectie **Indeling** opent, en de knop **Monitor toevoegen** ervan verdwijnt tot u dat hebt gedaan.

## Volgorde bepalen van wat bezoekers zien

De volgorde bepaalt u zelf, niet het alfabet:

| Wat | Hoe u het herschikt |
| ---- | ----------------- |
| Resources binnen een groep | Sleep een rij. Het deelvenster zegt het: **Drag a row to change the order visitors see**. |
| Groepen ten opzichte van elkaar | **Move up** / **Move down** in het rijmenu van de navigator, of **Move group up** / **Move group down** in **More actions**. |
| Resources zonder groep | Die staan in **Top of page** en verschijnen altijd boven elke groep, dus zet daar wat iedereen als eerste controleert. |

**Twee gevallen waarin slepen uit staat.** Zoeken met het vak **Search in {group}...** zet herschikken uit (het deelvenster zegt `N of M shown · drag to reorder is off while filtering`), dus maak eerst de zoekopdracht leeg. En rastergroepen worden nooit door slepen herschikt, omdat de plaats van een monitor uit zijn rij en kolom volgt.

Zet de service waarover het meest wordt gevraagd bovenaan. Bezoekers die tijdens een storing op de pagina komen, lezen meestal niet verder dan het eerste scherm.

## Monitoren automatisch toevoegen met monitorregels

Een monitorregel voegt monitoren voor u aan de pagina toe: beschrijf de monitoren één keer, en elke overeenkomende monitor komt in de groep die u kiest. Regels staan onder **Middelen → Monitor Rules**, naast het scherm Middelen.

:::steps
### Monitor Rules openen

Open de statuspagina, kies **Monitor Rules** in de sectie **Middelen** van het zijmenu en klik op **Status Page Monitor Rule aanmaken**.

### De regel een naam geven

Vul op **Basisinformatie** een **Naam** in. **Ingeschakeld** staat standaard aan.

### Zeggen met welke monitoren hij overeenkomt

Vul op **Overeenkomstcriteria** minstens één van **Monitorlabels** (een monitor met een van die labels komt overeen), **Monitornaam** en **Monitorbeschrijving** in. Een monitor moet aan elk criterium voldoen dat u invult. De twee patronen accepteren een hoofdletterongevoelige reguliere expressie (`^api-.*`) of een jokerteken `*` (`*checkout*`); `.*` komt met elke monitor overeen.

### De groep kiezen

Kies op **Groep** de groep bij **Add Monitors To Group**, of laat het leeg om de monitoren zonder groep toe te voegen. Daarna volgen dezelfde weergaveopties als bij een resource; bij een regel staat **Uptime % weergeven** standaard aan.

### De regel opslaan

De regel draait meteen tegen elke monitor die al bestaat, en de lijst toont onder **Adds Monitors To** de groep waaraan hij monitoren toevoegt.
:::

Daarna draait een regel opnieuw voor een monitor telkens wanneer er een wordt aangemaakt of wanneer de labels, de naam of de beschrijving ervan veranderen. Een regel verwijdert alleen de resources die hij zelf heeft toegevoegd: hem uitzetten of verwijderen haalt die van de pagina, en een monitor die u met de hand hebt toegevoegd, wordt nooit aangeraakt. Een monitor die al op de pagina staat, wordt nooit twee keer toegevoegd.

## Groepen importeren uit CSV

Een diepe hiërarchie met de hand opbouwen is omslachtig. **Import groups from CSV**, in het menu met drie puntjes van de kaartkop, opent het dialoogvenster **Import Groups from CSV**.

:::steps
### Het sjabloon downloaden

Klik op **Download CSV Template** om `status-page-groups-template.csv` te krijgen.

### Het invullen

Eén rij per groep. Alleen `name` is verplicht; de kolommen staan hieronder.

### Uploaden en een voorbeeld bekijken

Klik op **Choose CSV File**, kies uw bestand en dan **Preview Import** om te controleren wat er wordt aangemaakt voordat er iets wordt weggeschreven.

### Importeren

Voer de import uit. Een tabel **Import results** toont elke rij als **Aangemaakt**, **Mislukt** of **Overgeslagen**, met de reden, zodat een foute rij nooit stilletjes verdwijnt.
:::

| Kolom | Wat het instelt |
| ------ | ------------ |
| `name` | De groepsnaam. Verplicht. |
| `parentName` | De naam van de groep waarin deze genest is. |
| `description` | De groepsbeschrijving. |
| `isExpandedByDefault` | Of de sectie voor bezoekers open begint. |
| `showCurrentStatus` | Of er een status naast de groepskop verschijnt. |
| `showUptimePercent` | Of er een uptimepercentage naast de groep verschijnt. |
| `uptimePercentPrecision` | Hoeveel decimalen dat percentage gebruikt. |
| `viewMode` | `List` of `Grid`. |
| `rowAxisLabel` | De naam van de rijdimensie, voor een rastergroep. |
| `rowAxisValues` | De rijwaarden, voor een rastergroep. |
| `columnAxisLabel` | De naam van de kolomdimensie, voor een rastergroep. |
| `columnAxisValues` | De kolomwaarden, voor een rastergroep. |

De import maakt groepen aan, geen resources: voeg daarna monitoren toe met **Monitor toevoegen**, **Add Multiple** of een monitorregel.

## Problemen oplossen

:::details "This monitor is already added to this status page"
Een pagina toont elke monitor maar één keer, ook over groepen heen. De monitor heeft al een resource, misschien in een andere groep of toegevoegd door een monitorregel. Zoek hem op in de navigator, verwijder die resource en voeg de monitor toe waar u hem wilt hebben.
:::

:::details Een monitor die ik heb toegevoegd, verschijnt niet op de statuspagina
Controleer of de monitor is gearchiveerd: de rij van een gearchiveerde monitor wordt weggelaten tot u hem uit het archief haalt. Controleer ook de groep: een groep die ingeklapt begint (**Standaard uitvouwen op statuspagina** uit), verbergt zijn rijen tot een bezoeker hem opent.
:::

:::details Er is geen knop Monitor toevoegen in een rastergroep
Het raster heeft nog geen rijen of kolommen. Klik op **Set up the grid**, voeg de aswaarden toe in de sectie **Indeling**, en **Monitor toevoegen** komt terug.
:::

:::details Ik kan geen rijen slepen
Maak het vak **Search in {group}...** leeg: herschikken staat uit zolang het deelvenster gefilterd is. Rastergroepen worden nooit door slepen herschikt.
:::

## Volgende stappen

:::cards
- [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains): Logo, favicon, kleuren van de geschiedenisgrafiek en uw eigen domein.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers): Wie het hoort wanneer deze resources veranderen.
- [Eén statuspagina per doelgroep](/docs/status-pages/one-status-page-per-audience): Dezelfde monitor op veel pagina's, en een incident dat er maar enkele bereikt.
- [Publieke API](/docs/status-pages/public-api): Lees resources, groepen en uptime als JSON.
:::
