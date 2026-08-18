# Resources en groepen

Een resource is één rij op je statuspagina — een monitor (of een monitorgroep) met een naam die bezoekers begrijpen, een huidige status, en optioneel een uptimecijfer en een geschiedenisgrafiek. Een groep is een sectie die resources bevat, zodat een pagina met veertig monitoren leest als "API", "Webapp" en "Datapijplijn" in plaats van als één eindeloze lijst.

Je bouwt beide op één scherm. Open een statuspagina en kies **Middelen** in het zijmenu (het item heet **Monitoren** in projecten waar monitorgroepen niet aan staan). Groepen hadden vroeger een eigen pagina; dat is niet meer zo, en de oude URL `/groups` leidt gewoon hierheen door.

Krijg je dit deel goed, dan is de rest van de statuspagina versiering. Bezoekers beoordelen "ligt het aan mij of aan hen?" op deze rijen, dus benoem ze zoals klanten over je product praten — **Checkout API**, niet `prod-checkout-lb-healthcheck-us-east-1`.

## Het scherm Middelen

Het scherm is in tweeën gedeeld. Links staat een navigator met alle groepen op de pagina; rechts staat de inhoud van de groep die je hebt geselecteerd.

- **De groepennavigator (links)** — een boom met groepen, met daarboven een zoekvak (**Search groups...**) en daaronder een lopende telling, zoals `3 groups · 12 resources`. Passen er meer groepen op de pagina dan in beeld, dan onthult een knop **Show N more of M** de rest.
- **Top of page** — de eerste rij in de navigator. Daarin staan resources die in geen enkele groep zitten, en de tooltip zegt precies wat dat betekent: bezoekers zien deze het eerst, boven elke groep. Heeft de pagina helemaal geen groepen, dan heet het rechterdeel in plaats daarvan **All resources**.
- **Het resourcepaneel (rechts)** — genoemd naar de groep die je koos. In de kop zitten **Edit Group**, de primaire knop **Monitor toevoegen** en een overloopmenu **More actions**.

In de kop van de kaart zelf zitten twee knoppen: **New Group**, en een driepuntsmenu met **Import groups from CSV** en **Vernieuwen**.

De beschrijving van de kaart verandert mee met de vorm van je pagina. Met groepen leest ze dat dit alles is wat bezoekers zien en dat je links een groep kiest om te bewerken wat erin zit. Zonder groepen port ze je aan er een te maken om een langere pagina in secties te splitsen.

**Lege staten vertellen je wat te doen.** Een lege groep toont **No monitors here yet** met **Monitor toevoegen**, **Add Multiple** en — alleen wanneer de statuspagina helemaal geen groepen heeft — **Create a Group**. Een zoekopdracht zonder treffers toont **No resources match your search**. Een lege navigator vertelt dat groepen een langere statuspagina in secties splitsen en dat ze genest kunnen worden.

## Een monitor toevoegen

Selecteer de groep waarin de resource moet landen (of **Top of page** voor een ongegroepeerde rij) en klik op **Monitor toevoegen**. De modal heet **Add a monitor to {group}** en heeft twee stappen: **Monitordetails** en **Geavanceerd**.

Op **Monitordetails**:

- **Monitor** — de vervolgkeuzelijst met monitoren in je project, placeholder **Selecteer monitor**. Verplicht.
- **Weergavenaam** — verplicht. Dit is de tekst die bezoekers lezen, en ze wordt los van de naam van de monitor zelf opgeslagen, dus je kunt hier hernoemen zonder aan je monitoring te komen.
- **Beschrijving** — optionele markdown, getoond onder de rij. Goed voor één zin over wat de dienst eigenlijk doet.

Staan monitorgroepen in je project aan, dan verschijnt onder de lijst een link **Add a Monitor Group instead.** — klik erop en de lijst **Monitor** wordt vervangen door een lijst **Monitor Groep** (**Selecteer monitorgroep**). De link verandert dan in **Add a Monitor instead.** zodat je terug kunt. Gebruik een monitorgroep wanneer je wilt dat één rij op de pagina meerdere checks samen vertegenwoordigt.

### Er meerdere tegelijk toevoegen

**Add Multiple** (in het menu **More actions** ook **Add multiple monitors**) opent **Add Multiple Monitors**. Dat heeft dezelfde twee stappen, maar de eerste is een multiselect **Monitoren** in plaats van één vervolgkeuzelijst, en de weergaveopties die je op **Geavanceerd** kiest gelden voor elke monitor die je selecteerde. Dit is de snelste manier om een nieuwe pagina te vullen.

## Weergaveopties op een resource

De stap **Geavanceerd** is identiek op het enkelvoudige formulier en in de bulkmodal. Alles hier geldt per resource — twee rijen in dezelfde groep mogen anders ingesteld zijn.

| Veld                                                     | Waarvoor                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Tooltip** (`displayTooltip`)                           | Extra tekst naast de resource op je statuspagina. Gebruik het voor reikwijdte: "Klanten in VS en EU". |
| **Huidige resourcestatus weergeven** (`showCurrentStatus`) | Standaard aan. Toont de actuele status — operationeel, verminderd, offline — naast de rij.        |
| **Uptime % weergeven** (`showUptimePercent`)             | Standaard uit. Toont een uptimepercentage naast de resource.                                       |
| **Selecteer uptime-precisie** (`uptimePercentPrecision`) | Verschijnt pas wanneer **Uptime % weergeven** aan staat. Verplicht, standaard één decimaal.        |
| **Statusgeschiedenisgrafiek weergeven** (`showStatusHistoryChart`) | Standaard aan. Toont de staafgrafiek met de uptime-geschiedenis per dag voor de resource. |

**Weergavenaam** (`displayName`) en **Beschrijving** (`displayDescription`) uit de eerste stap zijn eveneens alleen voor de weergave — ze veranderen nooit iets aan de monitor zelf.

## Uptimepercentages en geschiedenisgrafieken

Zowel **Uptime % weergeven** als **Statusgeschiedenisgrafiek weergeven** hangt van een instelling af die ergens anders staat. Het venster dat ze beslaan is **Uptimegeschiedenis weergeven (in dagen)** onder **Statuspagina's → jouw pagina → Geavanceerd → Geavanceerde instellingen**, in de kaart **Instellingen uptime-geschiedenis**. Het accepteert 1 tot 90 dagen en staat standaard op 90.

De volgorde is dus: zet de schakelaars per resource aan, en stel het venster daarna één keer in voor de hele pagina.

**Precisie is een afweging.** De lijst **Selecteer uptime-precisie** biedt `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` en `99.999% (Three Decimal)`. Meer decimalen ogen nauwkeurig en lokken discussie uit over de derde; publiceer je een SLA op drie negens, houd het daar dan bij en niet verder.

Groepen hebben hun eigen versies van deze schakelaars — zie hieronder — dus een groep kan een samengevat percentage tonen terwijl de losse monitoren erin stil blijven, of andersom.

De kleuren van de balken in de geschiedenisgrafiek, en welke monitorstatussen als "down" tellen, stel je in op het brandingscherm **Overzichtspagina**, behandeld in [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains).

## Groepen

Klik op **New Group** om **Create New Status Page Group** te openen. Het formulier heeft drie stappen: **Groepsdetails**, **Indeling** en **Geavanceerd**.

**Groepsdetails**:

- **Groepsnaam** (`name`) — verplicht. Dit is het sectiekopje dat bezoekers zien.
- **Groepsbeschrijving** (`description`) — optionele markdown, getoond onder het kopje.
- **Parent Group** (`parentStatusPageGroupId`) — optioneel. Laat het op **No parent group (top level)** staan om de groep op het hoogste niveau te houden.
- **Standaard uitvouwen op statuspagina** (`isExpandedByDefault`) — of de sectie voor bezoekers open of ingeklapt begint.

**Geavanceerd** spiegelt de resourceschakelaars op groepsniveau:

- **Huidige groepsstatus weergeven** (`showCurrentStatus`) — standaard aan. Toont een status naast het groepskopje.
- **Uptime % weergeven** (`showUptimePercent`) — standaard uit, met **Selecteer uptime-precisie** zodra het aan staat.

Bewerken werkt op dezelfde manier: **Edit Group** in de kop van het paneel, of **Edit group** in het rijmenu van de navigator, opent **Edit Status Page Group** met een knop **Wijzigingen opslaan**.

De kop van het paneel toont chips voor de instellingen die aan staan — **Grid**, **Collapsed by default**, **Uptime %** — zodat je ziet hoe een groep is ingesteld zonder het formulier te openen.

### Een groep beheren

Het rijmenu van de navigator bevat **Edit group**, **Move up**, **Move down**, **ID weergeven** en **Delete group**. Het overloopmenu **More actions** van het paneel heeft de uitgeschreven varianten — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Vernieuwen** en **Delete this group**. Een groep die zonder naam is opgeslagen verschijnt als **Untitled group**, wat een goed teken is dat je iets had willen typen.

## Groepen nesten

Groepen zijn nestbaar: zet **Parent Group** op de onderliggende groep, of gebruik de actie **Add a sub group inside this group** in de navigator. De helptekst van het formulier beschrijft de vorm waarvoor het is gebouwd — zoiets als Corporate Units › Region › Market — en vermeldt dat elk niveau de samengevatte status en uptime van alles eronder toont.

Heeft een groep onderliggende groepen, dan toont het resourcepaneel een chiprij **Sub groups** die rechtstreeks naar elke onderliggende groep linkt, zodat je door de hiërarchie kunt lopen zonder terug te gaan naar de navigator.

Nesten verdient zichzelf terug op grote pagina's: een hostingprovider met regio's binnen producten, of een retailer met markten binnen bedrijfsonderdelen. Op een pagina met twaalf monitoren is één vlak niveau vriendelijker.

## Lijstindeling versus rasterindeling

De stap **Indeling** zet **Weergavemodus** (`viewMode`) voor de groep, en dat verandert hoe de groep publiek wordt weergegeven.

| Als je wilt…                                                        | Kies                     |
| ------------------------------------------------------------------- | ---------------------- |
| Een gewone verticale lijst met diensten tonen, één per rij          | **List** (de standaard) |
| Dezelfde dienst over meerdere regio's of tenants als matrix tonen   | **Grid**               |

Kies je **Grid**, dan verschijnen er vier velden bij:

- **Label van rij-as** — de naam van de rijdimensie, placeholder `Service`.
- **Waarden van rij-as** — de rijen zelf, één voor één toegevoegd met **Add Row** (placeholder `e.g. Auth`).
- **Label van kolomas** — de kolomdimensie, placeholder `Region`.
- **Waarden van kolomas** — toegevoegd met **Add Column** (placeholder `e.g. US-East`).

Elke monitor in een rastergroep krijgt vervolgens een cel, dus de bulkmodal vraagt naast de monitoren ook om de rij en de kolom, met jouw eigen aslabels.

**Zet de assen op voordat je monitoren toevoegt.** Een rastergroep zonder rijen of kolommen toont een oranje melding dat er nergens een monitor kwijt kan totdat de assen bestaan, met een knop **Set up the grid** — en de knop **Monitor toevoegen** blijft weg tot je dat hebt gedaan.

## De volgorde bepalen die bezoekers zien

De volgorde is expliciet, niet alfabetisch, en je zet hem op drie plekken:

- **Resources binnen een groep** — sleep een rij. Het paneel zegt het ook: **Drag a row to change the order visitors see**.
- **Groepen onderling** — **Move up** / **Move down** in het rijmenu van de navigator, of **Move group up** / **Move group down** in het overloopmenu van het paneel.
- **Ongegroepeerde resources** — die zitten in **Top of page** en verschijnen altijd boven elke groep, dus zet daar het ene ding waar iedereen als eerste naar kijkt.

**Twee gevallen waarin slepen uit staat.** Filter je het paneel met het vak **Search in {group}...**, dan is herordenen uitgeschakeld — het paneel meldt `N of M shown · drag to reorder is off while filtering`, dus wis eerst de zoekopdracht. En rastergroepen ondersteunen nooit slepen, omdat de positie daar uit de rij- en kolomassen komt.

Zet de dienst waar het meest naar gevraagd wordt bovenaan. Bezoekers die tijdens een storing op de pagina komen, stoppen meestal met lezen na het eerste scherm.

## Groepen importeren uit CSV

Een diepe hiërarchie met de hand bouwen is monnikenwerk. Het driepuntsmenu in de kop van de kaart heeft **Import groups from CSV**, dat de modal **Import Groups from CSV** opent.

De flow is: **Download CSV Template** voor `status-page-groups-template.csv`, dat invullen, **Choose CSV File**, en dan **Preview Import** om te zien wat er wordt aangemaakt voordat er iets wordt weggeschreven. Het resultaat splitst in **Groups Imported** en **Some Groups Could Not Be Imported**, zodat een foute rij niet stilletjes verdwijnt.

Alleen `name` is verplicht. Dit zijn de geaccepteerde kolommen:

| Kolom                    | Wat het instelt                                      |
| ------------------------ | ---------------------------------------------------- |
| `name`                   | De groepsnaam. Verplicht.                            |
| `parentName`             | De naam van de groep waarin deze nestelt.            |
| `description`            | De groepsbeschrijving.                               |
| `isExpandedByDefault`    | Of de sectie voor bezoekers open begint.             |
| `showCurrentStatus`      | Of er een status naast het groepskopje verschijnt.   |
| `showUptimePercent`      | Of er een uptimepercentage naast de groep verschijnt. |
| `uptimePercentPrecision` | Hoeveel decimalen dat percentage gebruikt.           |
| `viewMode`               | `List` of `Grid`.                                    |
| `rowAxisLabel`           | Naam van de rijdimensie voor een rastergroep.        |
| `rowAxisValues`          | De rijwaarden voor een rastergroep.                  |
| `columnAxisLabel`        | Naam van de kolomdimensie voor een rastergroep.      |
| `columnAxisValues`       | De kolomwaarden voor een rastergroep.                |

De import maakt groepen aan, geen resources — voeg de monitoren daarna toe met **Monitor toevoegen** of **Add Multiple**.

## Waar je hierna kunt lezen

- [Statuspagina's – Overzicht](/docs/status-pages/index) — wat een statuspagina is en hoe de onderdelen samenhangen.
- [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains) — logo, favicon, grafiekkleuren, en de pagina op je eigen domein zetten.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers) — wie er bericht krijgt wanneer deze resources veranderen.
- [Publieke API](/docs/status-pages/public-api) — statuspaginadata programmatisch uitlezen.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat een incident op de pagina zet en er weer af haalt.
