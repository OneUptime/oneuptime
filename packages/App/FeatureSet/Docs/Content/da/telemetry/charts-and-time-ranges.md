# Zoom ind på et tidsinterval

Træk hen over en graf for at zoome siden ind på det øjeblik, og dobbeltklik for at komme tilbage. Denne side forklarer bevægelserne, hvordan en zoom opfører sig, og hvilke grafer der zoomer hvad.

:::cards
- [Zoom ind og ud igen](#zoom-ind-og-ud-igen): De to bevægelser og knappen Reset zoom.
- [Sådan opfører zoom sig](#sådan-opfører-zoom-sig): Indlejrede zoom, automatisk opdatering, klik og træk.
- [Hvor det virker](#hvor-det-virker): De sider og grafer, hvis interval et træk ændrer.
- [Grafer uden zoom](#grafer-uden-zoom): Striber, målere og sparklines.
:::

## Zoom ind og ud igen

Hver tidsseriegraf i OneUptime fungerer også som vælger af tidsinterval. Når en graf viser en spids, du vil se nærmere på, behøver du ikke åbne vælgeren og skrive datoer:

:::steps
1. **Træk hen over spidsen** på en vilkårlig graf. Sidens tidsinterval skifter til det vindue, du trak op, præcis som hvis du havde valgt det i vælgeren af tidsinterval. Hver graf, og hver flise eller tabel beregnet ud fra sidens tidsinterval, henter data igen for det, så du aflæser ét øjeblik på tværs af dem alle.
2. **Dobbeltklik på en vilkårlig graf** for at komme tilbage. Siden vender tilbage til det tidsinterval, den havde, før du begyndte at zoome.
:::

Paneler, der viser den aktuelle tilstand, bliver ved nu, ligesom når du selv vælger et interval: inventartal, helbred, de største ressourceforbrugere, seneste advarsler, åbne hændelser og alarmer og et dashboards live-lister.

Mens en zoom er aktiv, vises en knap **Reset zoom** ved siden af sidens vælger af tidsinterval. Den gør det samme som et dobbeltklik og er vejen tilbage for tastaturbrugere og på touchskærme.

```mermaid title="Hvad et træk, et dobbeltklik og vælgeren gør ved sidens tidsinterval"
stateDiagram-v2
    state "Interval fra vælgeren" as Picked
    state "Zoomet vindue" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: træk hen over en graf
    Zoomed --> Zoomed: træk igen
    Zoomed --> Picked: dobbeltklik eller Reset zoom
    Zoomed --> Picked: vælg et interval
```

## Sådan opfører zoom sig

- **Zoom så dybt du vil; én nulstilling går hele vejen ud.** Når du har zoomet fra "Past 1 Hour" ind på ti minutter og derefter på ét, giver et enkelt dobbeltklik (eller **Reset zoom**) hele timen tilbage i stedet for ét niveau ad gangen.
- **Enhver graf kan nulstille enhver zoom.** Træk på CPU-grafen, dobbeltklik på hukommelsesgrafen: det er siden, der er zoomet, ikke grafen.
- **Når du selv vælger et interval, starter du forfra.** En forudindstilling eller et brugerdefineret interval i vælgeren er et nyt udgangspunkt: zoomen er slut, og **Reset zoom** forsvinder.
- **Et zoomet vindue ligger fast.** "Past 30 Minutes" følger uret; en zoom er et fast vindue, så det står stille, mens automatisk opdatering er slået til. Nulstil zoomen for at følge uret igen.
- **En zoom går aldrig ud over nu.** En grafs nyeste bucket fyldes som regel stadig op; et træk, der ender på den, skæres af ved det aktuelle tidspunkt.
- **Du kan slippe musen uden for grafen**: trækket tæller stadig.
- **Du behøver ikke vente på, at graferne indlæses, for at komme tilbage.** Lige efter en zoom, mens graferne stadig henter det vindue, du trak op, eller når vinduet viser sig at være tomt, nulstiller et dobbeltklik på en graf zoomen med det samme.
- **Et dobbeltklik på en side, der ikke er zoomet, gør ingenting.**

### Klik og træk

- **På linje-, flade- og søjlediagrammer er et almindeligt klik ikke en zoom.** Det gælder de fleste grafer: metrikkort og metrikudforskeren, ressourceoversigter, SLO'er, monitorer og alle grafer på et dashboard. Kun et træk hen over flere buckets zoomer, så et klik på et punkt, en søjle eller en forklaring gør stadig, hvad det gjorde før. Mens en zoom er aktiv, træder et klik på en grafs tegneflade i kraft et øjeblik senere, så det kan skelnes fra det dobbeltklik, der nulstiller. Tidslinjen for fejlmønstre i logindsigterne og en undtagelses Occurrence Trend zoomer også kun ved træk.
- **På udforskernes volumengrafer zoomer et klik på én søjle ind på den søjle.** Volumengraferne i udforskerne for logs, spor, undtagelser og sikkerhedshændelser samt analysegraferne for logs og spor zoomer ind på de søjler, du trækker hen over, eller på den ene søjle, du klikker på. Disse grafer viser **Click or drag to zoom**.

### Tip på graferne

De fleste grafer, der kan zoome, nævner bevægelsen over tegnefladen, **Drag to zoom** eller **Click or drag to zoom**, og tilføjer, mens en zoom er aktiv, påmindelsen **double-click to reset**. Metrikkort, metrikudforskeren og udforskernes volumengrafer viser altid tippet. På grafkortene i ressourceoversigter og SLO'er og på nogle dashboard-widgets vises det kun, mens du peger på kortet eller tabber ind i det.

## Hvor det virker

Zoom ændrer hele sidens interval på:

- ressourceoversigter og deres indsigtssider: Kubernetes-klynger, Docker-, Podman- og Docker Swarm-værter, værter og deres processer, tjenester og systemd-enheder, VMware, Proxmox, Ceph, lagerarrays, databaser, cloudressourcer og serverløse funktioner;
- tjenester og RUM-applikationer;
- netværksenheders metrikker og trafik;
- metrikkort, inklusive en ressources fane Metrikker og en monitors metrikker;
- metrikudforskeren;
- SLO-historikgrafer;
- logindsigter, inklusive tidslinjen "Hvornår det skete" for et fejlmønster, hvis panel har sin egen **Reset zoom**, fordi det dækker sidens vælger;
- volumengrafer for logs, spor, undtagelser og sikkerhedshændelser samt analysegraferne for logs og spor, der ændrer intervallet i den udforsker, de hører til;
- [dashboards](/docs/dashboards/authoring), hvor et træk ændrer hele dashboardets interval.

Grafer med deres eget vindue zoomer kun det vindue og ændrer derfor aldrig noget andet på siden. Det gælder en metrikforhåndsvisning i en monitors formular (monitoren bliver ved med at evaluere sit eget rullende vindue), en undtagelses Occurrence Trend, en graf åbnet i et pop op-vindue eller i undersøgelsespanelet og grafer i svar fra AI-chatten. Et dobbeltklik på en af dem, eller dens knap **Reset zoom**, sætter dens eget vindue tilbage.

Telemetri-øjebliksbilledet på en hændelses, alarms eller episodes side har også sit eget vindue. Et træk på dets graf (metrikgrafen eller volumengrafen for logs, spor eller undtagelser, når det er det, øjebliksbilledet viser) zoomer hele øjebliksbilledet, så fanerne Metrikker, Logs, Spor og Undtagelser alle viser det udsnit, du trak op. **Reset zoom** ved siden af øjebliksbilledets mærkat, eller et dobbeltklik på den graf, sætter øjebliksbilledets vindue tilbage.

## Grafer uden zoom

Nogle få visualiseringer har ingen tidsakse at trække hen over, er for små at trække på eller viser altid et fast vindue af deres eget, så de zoomer ikke:

- oppetidsstriber (én søjle pr. dag), som ikke kan vise noget finere end en dag;
- andels- og proportionsbjælker, målere og statuslinjer;
- flammegrafer, tjenestekort og flowdiagrammer;
- de små trend-sparklines i metriklister, hvor et klik åbner metrikken: åbn den for at få en graf, du kan zoome;
- små sparklines med et fast vindue af deres eget, som en netværksenheds rundturstid over den seneste time: deres link **Open metrics** fører til grafer, du kan zoome.

## Næste trin

:::cards
- [Opret et dashboard](/docs/dashboards/authoring): Zoom virker på alle grafer på et dashboard.
- [Søgesyntaks](/docs/telemetry/search-syntax): Filtrér udforskerne, når du har fundet øjeblikket.
- [Metrik-monitor](/docs/monitor/metrics-monitor): Få en alarm på den metrik, du kiggede på.
:::
