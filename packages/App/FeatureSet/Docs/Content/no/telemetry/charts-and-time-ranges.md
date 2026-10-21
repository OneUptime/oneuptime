# Zoome inn på et tidsintervall

Dra over et diagram for å zoome siden inn på det øyeblikket, og dobbeltklikk for å gå tilbake. Denne siden forklarer bevegelsene, hvordan en zoom oppfører seg, og hvilke diagrammer som zoomer hva.

:::cards
- [Zoome inn og ut igjen](#zoome-inn-og-ut-igjen): De to bevegelsene og knappen Reset zoom.
- [Slik oppfører zooming seg](#slik-oppfører-zooming-seg): Nestede zoomer, automatisk oppdatering, klikk og dra.
- [Hvor det virker](#hvor-det-virker): Sidene og diagrammene der et dra endrer intervallet.
- [Diagrammer uten zoom](#diagrammer-uten-zoom): Striper, målere og sparklines.
:::

## Zoome inn og ut igjen

Hvert tidsseriediagram i OneUptime fungerer også som velger for tidsintervall. Når et diagram viser en topp du vil se nærmere på, trenger du ikke åpne velgeren og skrive inn datoer:

:::steps
1. **Dra over toppen** i et hvilket som helst diagram. Sidens tidsintervall flytter seg til vinduet du dro opp, akkurat som om du hadde valgt det i velgeren for tidsintervall. Hvert diagram, og hver flis eller tabell som beregnes fra sidens tidsintervall, henter data på nytt for det, så du leser ett øyeblikk på tvers av alle.
2. **Dobbeltklikk på et hvilket som helst diagram** for å gå tilbake. Siden går tilbake til tidsintervallet den hadde før du begynte å zoome.
:::

Paneler som viser nåværende tilstand, blir stående på nå, akkurat som når du velger et intervall selv: antall i inventaret, helse, de største ressursforbrukerne, nylige advarsler, åpne hendelser og varsler og et dashbords sanntidslister.

Mens en zoom er aktiv, vises en knapp **Reset zoom** ved siden av sidens velger for tidsintervall. Den gjør det samme som et dobbeltklikk og er veien tilbake for tastaturbrukere og på berøringsskjermer.

```mermaid title="Hva et dra, et dobbeltklikk og velgeren gjør med sidens tidsintervall"
stateDiagram-v2
    state "Intervall fra velgeren" as Picked
    state "Zoomet vindu" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: dra over et diagram
    Zoomed --> Zoomed: dra igjen
    Zoomed --> Picked: dobbeltklikk eller Reset zoom
    Zoomed --> Picked: velg et intervall
```

## Slik oppfører zooming seg

- **Zoom så dypt du vil; én tilbakestilling går helt ut.** Etter at du har zoomet fra "Past 1 Hour" inn på ti minutter og deretter på ett, gir ett enkelt dobbeltklikk (eller **Reset zoom**) hele timen tilbake i stedet for ett nivå om gangen.
- **Ethvert diagram kan tilbakestille enhver zoom.** Dra i CPU-diagrammet, dobbeltklikk i minnediagrammet: det er siden som er zoomet, ikke diagrammet.
- **Å velge et intervall selv begynner på nytt.** En forhåndsinnstilling eller et egendefinert intervall i velgeren er et nytt utgangspunkt: zoomen er over, og **Reset zoom** forsvinner.
- **Et zoomet vindu ligger fast.** "Past 30 Minutes" følger klokken; en zoom er et fast vindu, så det står stille mens automatisk oppdatering er på. Tilbakestill zoomen for å følge klokken igjen.
- **En zoom går aldri forbi nå.** Et diagrams nyeste bucket fylles som regel fortsatt opp; et dra som slutter på den, kuttes ved gjeldende tidspunkt.
- **Du kan slippe musen utenfor diagrammet**: draget teller likevel.
- **Du trenger ikke vente på at diagrammene lastes for å gå tilbake.** Rett etter en zoom, mens diagrammene fortsatt henter vinduet du dro opp, eller når vinduet viser seg å være tomt, tilbakestiller et dobbeltklikk på et diagram zoomen med en gang.
- **Å dobbeltklikke på en side som ikke er zoomet, gjør ingenting.**

### Klikk og dra

- **I linje-, flate- og stolpediagrammer er et vanlig klikk ikke en zoom.** Det gjelder de fleste diagrammer: målingskort og målingsutforskeren, ressursoversikter, SLO-er, monitorer og alle diagrammer på et dashbord. Bare et dra over flere buckets zoomer, så et klikk på et punkt, en stolpe eller en forklaring gjør fortsatt det det gjorde før. Mens en zoom er aktiv, virker et klikk på diagrammets tegneflate et øyeblikk senere, slik at det kan skilles fra dobbeltklikket som tilbakestiller. Tidslinjen for feilmønstre i logginnsikten og et unntaks Occurrence Trend zoomer også bare ved dra.
- **I utforskernes volumdiagrammer zoomer et klikk på én stolpe inn på den stolpen.** Volumdiagrammene i utforskerne for logger, spor, unntak og sikkerhetshendelser, og analysediagrammene for logger og spor, zoomer inn på stolpene du drar over, eller på den ene stolpen du klikker på. Disse diagrammene viser **Click or drag to zoom**.

### Tips på diagrammene

De fleste diagrammer som zoomer, nevner bevegelsen over tegneflaten, **Drag to zoom** eller **Click or drag to zoom**, og legger mens en zoom er aktiv til påminnelsen **double-click to reset**. Målingskort, målingsutforskeren og utforskernes volumdiagrammer viser alltid tipset. På diagramkortene i ressursoversikter og SLO-er, og på enkelte dashbord-widgeter, vises det bare mens du peker på kortet eller tabber inn i det.

## Hvor det virker

Zooming endrer hele sidens intervall på:

- ressursoversikter og insiktssidene deres: Kubernetes-klynger, Docker-, Podman- og Docker Swarm-verter, verter og prosessene deres, tjenester og systemd-enheter, VMware, Proxmox, Ceph, lagringsmatriser, databaser, skyressurser og serverløse funksjoner;
- tjenester og RUM-applikasjoner;
- nettverksenheters målinger og trafikk;
- målingskort, inkludert en ressurs' fane Målinger og en monitors målinger;
- målingsutforskeren;
- SLO-historikkdiagrammer;
- logginnsikt, inkludert tidslinjen "Når det skjedde" for et feilmønster, der panelet har sin egen **Reset zoom** fordi det dekker sidens velger;
- volumdiagrammer for logger, spor, unntak og sikkerhetshendelser, og analysediagrammene for logger og spor, som endrer intervallet i utforskeren de hører til;
- [dashbord](/docs/dashboards/authoring), der et dra endrer intervallet for hele dashbordet.

Diagrammer med eget vindu zoomer bare det vinduet og endrer derfor aldri noe annet på siden. Det gjelder en forhåndsvisning av en måling i en monitors skjema (monitoren fortsetter å evaluere sitt eget rullerende vindu), et unntaks Occurrence Trend, et diagram åpnet i en popup eller i undersøkelsespanelet og diagrammer i svar fra AI-chatten. Et dobbeltklikk på et av dem, eller knappen **Reset zoom** til det, setter det egne vinduet tilbake.

Telemetri-øyeblikksbildet på siden til en hendelse, et varsel eller en episode har også sitt eget vindu. Et dra i diagrammet dets (målingsdiagrammet, eller volumdiagrammet for logger, spor eller unntak når det er det øyeblikksbildet viser) zoomer hele øyeblikksbildet, slik at fanene Målinger, Logger, Spor og Unntak alle viser utsnittet du dro opp. **Reset zoom** ved siden av øyeblikksbildets merke, eller et dobbeltklikk på det diagrammet, setter øyeblikksbildets vindu tilbake.

## Diagrammer uten zoom

Noen få visualiseringer har ingen tidsakse å dra over, er for små til å dra på eller viser alltid et fast eget vindu, så de zoomer ikke:

- oppetidsstriper (én stolpe per dag), som ikke kan vise noe finere enn en dag;
- andels- og proporsjonsstolper, målere og fremdriftsindikatorer;
- flammegrafer, tjenestekart og flytdiagrammer;
- de små trend-sparklines i målingslister, der et klikk åpner målingen: åpne den for å få et diagram du kan zoome;
- små sparklines med et fast eget vindu, som en nettverksenhets tur-retur-tid den siste timen: lenken deres **Open metrics** fører til diagrammer du kan zoome.

## Neste trinn

:::cards
- [Opprette et dashbord](/docs/dashboards/authoring): Zoom virker i alle diagrammer på et dashbord.
- [Søkesyntaks](/docs/telemetry/search-syntax): Filtrere utforskerne når du har funnet øyeblikket.
- [Metrikk-overvåking](/docs/monitor/metrics-monitor): Få varsel på målingen du så på.
:::
