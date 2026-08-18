# Ressourcer og grupper

En ressource er én række på din statusside — en monitor (eller en monitorgruppe) med et navn, besøgende kan forstå, en aktuel status og eventuelt et oppetidstal og et historikdiagram. En gruppe er en sektion, der rummer ressourcer, så en side med fyrre monitorer læses som "API", "Webapp" og "Datapipeline" i stedet for én endeløs liste.

Du bygger begge dele på én skærm. Åbn en statusside og vælg **Ressourcer** i sidemenuen (punktet hedder **Monitorer** på projekter, der ikke har monitorgrupper aktiveret). Grupper plejede at bo på deres egen side; det gør de ikke længere, og den gamle URL `/groups` omdirigerer bare hertil.

Få denne del rigtig, og resten af statussiden er pynt. Besøgende bedømmer "er det mig eller er det dem?" ud fra disse rækker, så navngiv dem, som kunderne taler om dit produkt — **Checkout API**, ikke `prod-checkout-lb-healthcheck-us-east-1`.

## Skærmen Ressourcer

Skærmen er delt i to. Til venstre er en navigator, der lister hver gruppe på siden; til højre er indholdet af den gruppe, du har valgt.

- **Gruppenavigatoren (venstre)** — et træ af grupper, med et søgefelt (**Search groups...**) over det og en løbende optælling under det, som `3 groups · 12 resources`. Når en side har flere grupper, end der er plads til, viser en knap **Show N more of M** resten.
- **Top of page** — den første række i navigatoren. Den rummer ressourcer, der ikke er i nogen gruppe, og dens værktøjstip siger præcis, hvad det betyder: besøgende ser disse først, over hver gruppe. Hvis siden slet ingen grupper har, hedder højre rude i stedet **Alle ressourcer**.
- **Ressourceruden (højre)** — med titlen på den gruppe, du valgte. Dens sidehoved bærer **Edit Group**, den primære knap **Tilføj monitor** og en overflow-menu **More actions**.

To knapper bor i selve kortets sidehoved: **New Group**, og en tre-prikkers overflow, der rummer **Import groups from CSV** og **Opdater**.

Kortets beskrivelse ændrer sig med din sides form. Med grupper lyder den, at dette er alt, hvad besøgende ser, og at du skal vælge en gruppe til venstre for at redigere, hvad der er i den. Uden grupper endnu opfordrer den dig til at oprette en for at dele en længere side op i sektioner.

**Tomtilstande fortæller dig, hvad du skal gøre.** En tom gruppe viser **No monitors here yet** med **Tilføj monitor**, **Add Multiple** og — kun når statussiden slet ingen grupper har — **Create a Group**. En søgning, der ikke matcher noget, viser **No resources match your search**. En tom navigator siger, at grupper deler en længere statusside op i sektioner, og at de kan indlejres.

## At tilføje en monitor

Vælg den gruppe, ressourcen skal lande i (eller **Top of page** for en ugrupperet række), og klik derefter **Tilføj monitor**. Modalen hedder **Add a monitor to {group}** og har to trin: **Monitordetaljer** og **Avanceret**.

På **Monitordetaljer**:

- **Overvågning** — rullemenuen over monitorer i dit projekt, pladsholder **Vælg overvågning**. Påkrævet.
- **Visningsnavn** — påkrævet. Dette er den tekst, besøgende læser, og den gemmes adskilt fra monitorens eget navn, så du kan omdøbe den her uden at røre ved overvågningen.
- **Beskrivelse** — valgfri markdown vist under rækken. God til en sætning, der forklarer, hvad tjenesten faktisk gør.

Hvis dit projekt har monitorgrupper aktiveret, står der et link under rullemenuen: **Add a Monitor Group instead.** — klik det, og rullemenuen **Overvågning** byttes ud med en rullemenu **Monitor Gruppe** (**Vælg overvågningsgruppe**). Linket vender så til **Add a Monitor instead.**, så du kan gå tilbage. Brug en monitorgruppe, når du vil have én række på siden til at repræsentere flere tjek rullet sammen.

### At tilføje flere på én gang

**Add Multiple** (også **Add multiple monitors** i menuen **More actions**) åbner **Add Multiple Monitors**. Den har de samme to trin, men det første er et multivalg **Monitorer** i stedet for en enkelt rullemenu, og de visningsindstillinger, du vælger på **Avanceret**, gælder for hver monitor, du har valgt. Dette er den hurtigste måde at fylde en ny side op på.

## Visningsindstillinger på en ressource

Trinnet **Avanceret** er det samme på enkelt-tilføj-formularen og i masse-modalen. Alt her er per ressource — to rækker i samme gruppe kan konfigureres forskelligt.

| Felt                                                     | Formål                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Værktøjstip** (`displayTooltip`)                       | Ekstra tekst vist ved siden af ressourcen på din statusside. Brug den til omfang: "US- og EU-kunder". |
| **Vis aktuel ressourcestatus** (`showCurrentStatus`)     | Slået til som standard. Viser den aktuelle status — operationel, forringet, offline — ved rækken.   |
| **Vis oppetid %** (`showUptimePercent`)                  | Slået fra som standard. Viser en oppetidsprocent ved siden af ressourcen.                          |
| **Vælg oppetidspræcision** (`uptimePercentPrecision`)    | Vises først, når **Vis oppetid %** er slået til. Påkrævet, standard er én decimal.                 |
| **Vis statushistorikdiagram** (`showStatusHistoryChart`) | Slået til som standard. Viser dag-for-dag-oppetidshistorikkens søjlediagram for ressourcen.        |

**Visningsnavn** (`displayName`) og **Beskrivelse** (`displayDescription`) fra det første trin er også kun visning — de ændrer aldrig selve monitoren.

## Oppetidsprocenter og historikdiagrammer

Både **Vis oppetid %** og **Vis statushistorikdiagram** afhænger af en indstilling, der bor et andet sted. Vinduet, de dækker, er **Vis oppetidshistorik (i dage)** under **Statussider → din side → Avanceret → Avancerede indstillinger**, i kortet **Indstillinger for oppetidshistorik**. Det accepterer 1 til 90 dage og har standard 90.

Så rækkefølgen er: slå kontakterne til per ressource, og sæt derefter vinduet én gang for hele siden.

**Præcision er en vurderingssag.** Rullemenuen **Vælg oppetidspræcision** tilbyder `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` og `99.999% (Three Decimal)`. Flere decimaler ser præcise ud og inviterer til diskussioner om den tredje; hvis du offentliggør en SLA på tre nitaller, så match den og ikke mere.

Grupper har deres egne kopier af disse kontakter — se nedenfor — så en gruppe kan vise en oprullet procent, mens de enkelte monitorer inde i den forbliver tavse, eller omvendt.

Farverne på historikdiagrammets søjler, og hvilke monitorstatusser der tæller som "nede", sættes på brandingskærmen **Oversigtsside**, dækket i [Statusside – branding og domæner](/docs/status-pages/branding-and-domains).

## Grupper

Klik **New Group** for at åbne **Create New Status Page Group**. Formularen har tre trin: **Gruppedetaljer**, **Layout** og **Avanceret**.

**Gruppedetaljer**:

- **Gruppenavn** (`name`) — påkrævet. Dette er den sektionsoverskrift, besøgende ser.
- **Gruppebeskrivelse** (`description`) — valgfri markdown, vist under overskriften.
- **Parent Group** (`parentStatusPageGroupId`) — valgfri. Lad den stå på **No parent group (top level)** for at holde gruppen på øverste niveau.
- **Udvid på statusside som standard** (`isExpandedByDefault`) — om sektionen starter åben eller sammenklappet for besøgende.

**Avanceret** spejler ressourcekontakterne på gruppeniveau:

- **Vis aktuel gruppestatus** (`showCurrentStatus`) — slået til som standard. Viser en status ved siden af gruppeoverskriften.
- **Vis oppetid %** (`showUptimePercent`) — slået fra som standard, med **Vælg oppetidspræcision**, der dukker op, når den er slået til.

Redigering fungerer på samme måde: **Edit Group** i rudens sidehoved, eller **Edit group** i navigatorens rækkemenu, åbner **Edit Status Page Group** med en knap **Gem ændringer**.

Rudens sidehoved viser chips for de indstillinger, der aktuelt er slået til — **Grid**, **Collapsed by default**, **Uptime %** — så du kan se, hvordan en gruppe er konfigureret uden at åbne formularen.

### At administrere en gruppe

Navigatorens menu per række rummer **Edit group**, **Move up**, **Move down**, **Vis ID** og **Slet gruppe**. Rudens overflow **More actions** har de længere modstykker — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Opdater** og **Delete this group**. En gruppe gemt uden et navn vises som **Untitled group**, hvilket er et godt tegn på, at du mente at skrive noget.

## At indlejre grupper

Grupper kan indlejres: sæt **Parent Group** på barnet, eller brug navigatorens handling **Add a sub group inside this group**. Formularens egen hjælpetekst beskriver den form, den er bygget til — noget i stil med Forretningsenheder › Region › Marked — og bemærker, at hvert niveau viser den oprullede status og oppetid for alt nedenunder.

Når en gruppe har børn, viser ressourceruden en chip-række **Sub groups**, der linker direkte ind i hvert barn, så du kan gå gennem hierarkiet uden at vende tilbage til navigatoren.

Indlejring tjener sit eget på store sider: en hostingudbyder med regioner inde i produkter, eller en detailkæde med markeder inde i forretningsenheder. På en side med tolv monitorer er ét fladt niveau venligere.

## Listelayout kontra gitterlayout

Trinnet **Layout** sætter **Visningstilstand** (`viewMode`) for gruppen, og det ændrer, hvordan gruppen vises offentligt.

| Hvis du vil…                                                       | Vælg                     |
| ------------------------------------------------------------------ | ------------------------ |
| Vise en enkel lodret liste over tjenester, én per række            | **List** (standarden)    |
| Vise den samme tjeneste på tværs af flere regioner eller kunder som en matrix | **Grid**       |

Vælg **Grid**, og fire felter mere dukker op:

- **Etiket for rækkeakse** — navnet på rækkedimensionen, pladsholder `Service`.
- **Værdier for rækkeakse** — selve rækkerne, tilføjet én ad gangen med **Add Row** (pladsholder `e.g. Auth`).
- **Etiket for kolonneakse** — kolonnedimensionen, pladsholder `Region`.
- **Værdier for kolonneakse** — tilføjet med **Add Column** (pladsholder `e.g. US-East`).

Hver monitor i en gitter-gruppe placeres derefter i en celle, så masse-modalen spørger om rækken og kolonnen sammen med monitorerne, ved hjælp af dine egne akseetiketter.

**Sæt akserne op, før du tilføjer monitorer.** En gitter-gruppe uden rækker eller kolonner viser en ravgul besked om, at der ikke er nogen steder at putte en monitor, før akserne findes, med en knap **Set up the grid** — og knappen **Tilføj monitor** trækkes tilbage, indtil du gør det.

## At bestemme rækkefølgen besøgende ser

Rækkefølgen er eksplicit, ikke alfabetisk, og den sættes tre steder:

- **Ressourcer inde i en gruppe** — træk en række. Ruden siger det: **Drag a row to change the order visitors see**.
- **Grupper i forhold til hinanden** — **Move up** / **Move down** i navigatorens rækkemenu, eller **Move group up** / **Move group down** i rudens overflow.
- **Ugrupperede ressourcer** — de bor i **Top of page** og vises altid over hver gruppe, så put den ene ting, alle tjekker først, dér.

**To tilfælde hvor træk er slået fra.** At filtrere ruden med feltet **Search in {group}...** deaktiverer omarrangering — ruden fortæller dig `N of M shown · drag to reorder is off while filtering`, så ryd søgningen først. Og gitter-grupper understøtter aldrig træk-rækkefølge, fordi placeringen i stedet kommer fra række- og kolonneakserne.

Sæt den tjeneste, der spørges mest om, øverst. Besøgende, der kom til siden under et udfald, holder som regel op med at læse efter første skærmbillede.

## At importere grupper fra CSV

At bygge et dybt hierarki i hånden er trættende. Tre-prikkers overflowen i kortets sidehoved har **Import groups from CSV**, som åbner modalen **Import Groups from CSV**.

Flowet er: **Download CSV Template** for at få `status-page-groups-template.csv`, udfyld den, **Choose CSV File**, og derefter **Preview Import** for at tjekke, hvad der vil blive oprettet, før noget skrives. Resultatet deles i **Groups Imported** og **Some Groups Could Not Be Imported**, så en dårlig række ikke i stilhed forsvinder.

Kun `name` er påkrævet. De accepterede kolonner er:

| Kolonne                  | Hvad den sætter                                       |
| ------------------------ | ----------------------------------------------------- |
| `name`                   | Gruppens navn. Påkrævet.                              |
| `parentName`             | Navnet på den gruppe, denne indlejres i.              |
| `description`            | Gruppebeskrivelsen.                                   |
| `isExpandedByDefault`    | Om sektionen starter åben for besøgende.              |
| `showCurrentStatus`      | Om en status vises ved siden af gruppeoverskriften.   |
| `showUptimePercent`      | Om en oppetidsprocent vises ved siden af gruppen.     |
| `uptimePercentPrecision` | Hvor mange decimaler den procent bruger.              |
| `viewMode`               | `List` eller `Grid`.                                  |
| `rowAxisLabel`           | Navn på rækkedimensionen for en gitter-gruppe.        |
| `rowAxisValues`          | Rækkeværdierne for en gitter-gruppe.                  |
| `columnAxisLabel`        | Navn på kolonnedimensionen for en gitter-gruppe.      |
| `columnAxisValues`       | Kolonneværdierne for en gitter-gruppe.                |

Importen opretter grupper, ikke ressourcer — tilføj monitorer bagefter med **Tilføj monitor** eller **Add Multiple**.

## Læs videre

- [Statussider – Oversigt](/docs/status-pages/index) — hvad en statusside er, og hvordan delene passer sammen.
- [Statusside – branding og domæner](/docs/status-pages/branding-and-domains) — logo, favicon, diagramfarver og at sætte siden på dit eget domæne.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der får besked, når disse ressourcer ændrer sig.
- [Offentlig API](/docs/status-pages/public-api) — at læse statussidedata programmatisk.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad der får en hændelse til at optræde på og forsvinde fra siden.
