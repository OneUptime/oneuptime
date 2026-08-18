# Ressourcer og grupper

En ressource er én række på din statusside — en monitor (eller en monitorgruppe) med et navn, besøgende kan forstå, en aktuel status og eventuelt et oppetidstal og et historikdiagram. En gruppe er en sektion, der rummer ressourcer, så en side med fyrre monitorer læses som "API", "Webapp" og "Datapipeline" i stedet for én endeløs liste.

Du bygger begge dele på én og samme skærm. Åbn en statusside, og vælg **Ressourcer** i sidemenuen (punktet hedder **Monitorer** i projekter, der ikke har monitorgrupper slået til). Grupper havde engang deres egen side; det har de ikke længere, og den gamle `/groups`-URL viderestiller bare hertil.

Får du denne del rigtig, er resten af statussiden pynt. Besøgende afgør "er det mig eller dem?" ud fra netop de rækker, så navngiv dem, som kunderne taler om dit produkt — **Checkout API**, ikke `prod-checkout-lb-healthcheck-us-east-1`.

## Ressourcer-skærmen

Skærmen er delt i to. Til venstre er en navigator med alle grupper på siden; til højre er indholdet af den gruppe, du har valgt.

- **Gruppenavigatoren (venstre)** — et træ af grupper med et søgefelt (**Search groups...**) over sig og en løbende optælling under sig, i stil med `3 groups · 12 resources`. Når en side har flere grupper, end der er plads til, viser en **Show N more of M**-knap resten.
- **Top of page** — den første række i navigatoren. Den rummer ressourcer, der ikke ligger i nogen gruppe, og værktøjstippet siger præcis, hvad det betyder: besøgende ser dem først, over alle grupper. Har siden slet ingen grupper, hedder højre rude i stedet **Alle ressourcer**.
- **Ressourceruden (højre)** — har den valgte gruppe som titel. Dens sidehoved bærer **Edit Group**, den primære **Tilføj monitor**-knap og en **More actions**-menu.

To knapper bor i selve kortets sidehoved: **New Group** og en tre-prikkers menu med **Import groups from CSV** og **Opdater**.

Kortets beskrivelse skifter med din sides form. Har du grupper, står der, at det her er alt, hvad besøgende ser, og at du skal vælge en gruppe til venstre for at redigere, hvad der er i den. Har du ingen grupper endnu, skubber den dig til at oprette en og dele en længere side op i sektioner.

**Tomme tilstande fortæller dig, hvad du skal gøre.** En tom gruppe viser **No monitors here yet** med **Tilføj monitor**, **Add Multiple** og — kun når statussiden slet ingen grupper har — **Create a Group**. En søgning uden træffere viser **No resources match your search**. En tom navigator fortæller, at grupper deler en længere statusside op i sektioner, og at de kan ligge inde i hinanden.

## At tilføje en monitor

Vælg den gruppe, ressourcen skal lande i (eller **Top of page** for en række uden gruppe), og klik så **Tilføj monitor**. Modalen hedder **Add a monitor to {group}** og har to trin: **Monitordetaljer** og **Avanceret**.

På **Monitordetaljer**:

- **Overvågning** — rullelisten over monitorer i dit projekt, pladsholder **Vælg overvågning**. Påkrævet.
- **Visningsnavn** — påkrævet. Det er den tekst, besøgende læser, og den gemmes adskilt fra monitorens eget navn, så du kan omdøbe den her uden at røre ved overvågningen.
- **Beskrivelse** — valgfri markdown, der vises under rækken. God til en sætning om, hvad tjenesten faktisk gør.

Har dit projekt monitorgrupper slået til, står der et link under rullelisten: **Add a Monitor Group instead.** — klik det, og rullelisten **Overvågning** byttes ud med en **Monitor Gruppe**-rulleliste (**Vælg overvågningsgruppe**). Linket vender så om til **Add a Monitor instead.**, så du kan gå tilbage. Brug en monitorgruppe, når én række på siden skal repræsentere flere tjek under ét.

### At tilføje flere ad gangen

**Add Multiple** (også **Add multiple monitors** i **More actions**-menuen) åbner **Add Multiple Monitors**. Den har de samme to trin, men det første er en **Monitorer**-multivælger i stedet for én rulleliste, og de visningsindstillinger, du vælger på **Avanceret**, gælder alle de monitorer, du har valgt. Det er den hurtigste måde at fylde en ny side op på.

## Visningsindstillinger på en ressource

Trinnet **Avanceret** er det samme på enkelt-formularen og i bulk-modalen. Alt her gælder per ressource — to rækker i samme gruppe kan sagtens være sat op forskelligt.

| Felt                                                     | Formål                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Værktøjstip** (`displayTooltip`)                       | Ekstra tekst ved siden af ressourcen på din statusside. Brug den til afgrænsning: "Kunder i USA og EU".      |
| **Vis aktuel ressourcestatus** (`showCurrentStatus`)     | Slået til som standard. Viser den aktuelle status — i drift, forringet, offline — ved siden af rækken.        |
| **Vis oppetid %** (`showUptimePercent`)                  | Slået fra som standard. Viser en oppetidsprocent ved siden af ressourcen.                                     |
| **Vælg oppetidspræcision** (`uptimePercentPrecision`)    | Dukker først op, når **Vis oppetid %** er slået til. Påkrævet, standard er én decimal.                        |
| **Vis statushistorikdiagram** (`showStatusHistoryChart`) | Slået til som standard. Viser dag-for-dag-søjlediagrammet over oppetidshistorik for ressourcen.               |

**Visningsnavn** (`displayName`) og **Beskrivelse** (`displayDescription`) fra første trin er også rent visningsmæssige — de ændrer aldrig selve monitoren.

## Oppetidsprocenter og historikdiagrammer

Både **Vis oppetid %** og **Vis statushistorikdiagram** afhænger af en indstilling, der bor et helt andet sted. Det vindue, de dækker, er **Vis oppetidshistorik (i dage)** under **Statussider → din side → Avanceret → Avancerede indstillinger**, i kortet **Indstillinger for oppetidshistorik**. Det tager 1 til 90 dage og er 90 som standard.

Rækkefølgen er altså: slå kontakterne til per ressource, og sæt så vinduet én gang for hele siden.

**Præcision er en vurderingssag.** Rullelisten **Vælg oppetidspræcision** tilbyder `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` og `99.999% (Three Decimal)`. Flere decimaler ser præcise ud og indbyder til skænderier om den tredje; udgiver du en SLA på tre nihedstal, så ram den og ikke mere.

Grupper har deres egne udgaver af de kontakter — se nedenfor — så en gruppe kan vise en opsummeret procent, mens de enkelte monitorer indeni holder mund, eller omvendt.

Farverne på historikdiagrammets søjler, og hvilke monitorstatusser der tæller som "nede", sættes på brandingskærmen **Oversigtsside**, som er dækket i [Statusside – branding og domæner](/docs/status-pages/branding-and-domains).

## Grupper

Klik **New Group** for at åbne **Create New Status Page Group**. Formularen har tre trin: **Gruppedetaljer**, **Layout** og **Avanceret**.

**Gruppedetaljer**:

- **Gruppenavn** (`name`) — påkrævet. Det er den sektionsoverskrift, besøgende ser.
- **Gruppebeskrivelse** (`description`) — valgfri markdown, vist under overskriften.
- **Parent Group** (`parentStatusPageGroupId`) — valgfri. Lad den stå på **No parent group (top level)** for at holde gruppen på øverste niveau.
- **Udvid på statusside som standard** (`isExpandedByDefault`) — om sektionen starter åben eller sammenklappet for besøgende.

**Avanceret** spejler ressourcekontakterne på gruppeniveau:

- **Vis aktuel gruppestatus** (`showCurrentStatus`) — slået til som standard. Viser en status ved siden af gruppeoverskriften.
- **Vis oppetid %** (`showUptimePercent`) — slået fra som standard, med **Vælg oppetidspræcision** som dukker op, når den er slået til.

Redigering fungerer på samme måde: **Edit Group** i rudens sidehoved, eller **Edit group** i navigatorrækkens menu, åbner **Edit Status Page Group** med en **Gem ændringer**-knap.

Rudens sidehoved viser plaketter for de indstillinger, der er slået til — **Grid**, **Collapsed by default**, **Uptime %** — så du kan se, hvordan en gruppe er sat op, uden at åbne formularen.

### At styre en gruppe

Navigatorens menu per række rummer **Edit group**, **Move up**, **Move down**, **Vis ID** og **Slet gruppe**. Rudens **More actions**-menu har de længere modstykker — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Opdater** og **Delete this group**. En gruppe, der gemmes uden navn, vises som **Untitled group**, hvilket er et godt tegn på, at du havde tænkt dig at skrive noget.

## Grupper inde i grupper

Grupper kan ligge inde i hinanden: sæt **Parent Group** på barnet, eller brug navigatorens handling **Add a sub group inside this group**. Formularens egen hjælpetekst beskriver den form, den er bygget til — noget i retning af Corporate Units › Region › Market — og bemærker, at hvert niveau viser den opsummerede status og oppetid for alt nedenunder.

Når en gruppe har børn, viser ressourceruden en **Sub groups**-plaketrække, der linker direkte ind i hvert barn, så du kan gå gennem hierarkiet uden at vende tilbage til navigatoren.

Indlejring gør størst nytte på store sider: en hostingudbyder med regioner inde i produkter, eller en detailkæde med markeder inde i forretningsenheder. På en side med tolv monitorer er ét fladt niveau venligere.

## Listelayout kontra gitterlayout

Trinnet **Layout** sætter **Visningstilstand** (`viewMode`) for gruppen, og det ændrer, hvordan gruppen vises offentligt.

| Hvis du vil…                                                        | Vælg                     |
| ------------------------------------------------------------------- | ------------------------ |
| Vise en enkel lodret liste af tjenester, én per række               | **List** (standarden)    |
| Vise den samme tjeneste på tværs af flere regioner eller lejere som en matrix | **Grid**       |

Vælger du **Grid**, dukker fire felter mere op:

- **Etiket for rækkeakse** — navnet på rækkedimensionen, pladsholder `Service`.
- **Værdier for rækkeakse** — selve rækkerne, tilføjet én ad gangen med **Add Row** (pladsholder `e.g. Auth`).
- **Etiket for kolonneakse** — kolonnedimensionen, pladsholder `Region`.
- **Værdier for kolonneakse** — tilføjes med **Add Column** (pladsholder `e.g. US-East`).

Hver monitor i en gittergruppe placeres derefter i en celle, så bulk-modalen spørger om rækken og kolonnen ved siden af monitorerne — med dine egne akseetiketter.

**Sæt akserne op, før du tilføjer monitorer.** En gittergruppe uden rækker eller kolonner viser en gul advarsel om, at der ikke er nogen steder at placere en monitor, før akserne findes, med en **Set up the grid**-knap — og **Tilføj monitor**-knappen er trukket tilbage, indtil du har gjort det.

## At bestemme rækkefølgen besøgende ser

Rækkefølgen er udtrykkelig, ikke alfabetisk, og den sættes tre steder:

- **Ressourcer inde i en gruppe** — træk i en række. Ruden siger det selv: **Drag a row to change the order visitors see**.
- **Grupper i forhold til hinanden** — **Move up** / **Move down** i navigatorrækkens menu, eller **Move group up** / **Move group down** i rudens menu.
- **Ressourcer uden gruppe** — de bor i **Top of page** og vises altid over alle grupper, så læg dér den ene ting, alle tjekker først.

**To tilfælde hvor træk er slået fra.** Filtrerer du ruden med **Search in {group}...**-feltet, deaktiveres omarrangering — ruden fortæller dig `N of M shown · drag to reorder is off while filtering`, så ryd søgningen først. Og gittergrupper understøtter aldrig træk-rækkefølge, fordi positionen i stedet kommer fra række- og kolonneakserne.

Læg den tjeneste, der spørges mest til, øverst. Besøgende, der kom til siden under et nedbrud, holder som regel op med at læse efter første skærmbillede.

## At importere grupper fra CSV

Det er trættende at bygge et dybt hierarki i hånden. Tre-prikkers menuen i kortets sidehoved har **Import groups from CSV**, som åbner modalen **Import Groups from CSV**.

Flowet er: **Download CSV Template** for at få `status-page-groups-template.csv`, udfyld den, **Choose CSV File**, og så **Preview Import** for at tjekke, hvad der vil blive oprettet, før der skrives noget. Resultatet deles i **Groups Imported** og **Some Groups Could Not Be Imported**, så en dårlig række ikke forsvinder i stilhed.

Kun `name` er påkrævet. De accepterede kolonner er:

| Kolonne                  | Hvad den sætter                                            |
| ------------------------ | ------------------------------------------------------------ |
| `name`                   | Gruppens navn. Påkrævet.                                    |
| `parentName`             | Navnet på den gruppe, denne ligger inde i.                  |
| `description`            | Gruppens beskrivelse.                                       |
| `isExpandedByDefault`    | Om sektionen starter åben for besøgende.                    |
| `showCurrentStatus`      | Om der vises en status ved siden af gruppeoverskriften.     |
| `showUptimePercent`      | Om der vises en oppetidsprocent ved siden af gruppen.       |
| `uptimePercentPrecision` | Hvor mange decimaler den procent bruger.                    |
| `viewMode`               | `List` eller `Grid`.                                        |
| `rowAxisLabel`           | Navnet på rækkedimensionen i en gittergruppe.               |
| `rowAxisValues`          | Rækkeværdierne for en gittergruppe.                         |
| `columnAxisLabel`        | Navnet på kolonnedimensionen i en gittergruppe.             |
| `columnAxisValues`       | Kolonneværdierne for en gittergruppe.                       |

Importen opretter grupper, ikke ressourcer — tilføj monitorer bagefter med **Tilføj monitor** eller **Add Multiple**.

## Hvor du kan læse videre

- [Statussider – Oversigt](/docs/status-pages/index) — hvad en statusside er, og hvordan brikkerne passer sammen.
- [Statusside – branding og domæner](/docs/status-pages/branding-and-domains) — logo, favicon, diagramfarver og at få siden på dit eget domæne.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der får besked, når disse ressourcer ændrer sig.
- [Offentlig API](/docs/status-pages/public-api) — at læse statussidedata programmatisk.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad der får en hændelse til at dukke op på siden, og hvad der får den til at forsvinde igen.
