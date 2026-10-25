# Metrikkutforsker

Metrikker er tallene tjenestene og infrastrukturen din rapporterer over tid: antall forespørsler, latenser, CPU, kødybde. Metrikkutforskeren viser hver metrikk prosjektet ditt mottar, viser hvilken som helst av dem i et diagram, kombinerer dem med formler og gjør et diagram om til en monitor eller en dashbord-widget.

:::cards
- [Finn en metrikk](#finn-en-metrikk): Søk i listen over metrikknavn.
- [Vis en metrikk i et diagram](#vis-en-metrikk-i-et-diagram): Aggreger, filtrer og grupper en spørring.
- [Kombiner spørringer med en formel](#kombiner-spørringer-med-en-formel): Feilrater og andre forholdstall.
- [Bruk det du har vist i diagrammet](#bruk-det-du-har-vist-i-diagrammet): En monitor, en dashbord-widget eller en lenke.
- [Forbedre målinger og legg til de som mangler med KI](#forbedre-målinger-og-legg-til-de-som-mangler-med-ki): Pull-forespørsler som retter målingene dine og legger til dem en tjeneste mangler.
:::

## Slik fungerer utforskeren

Utforskeren har to nivåer. Fanen **Viser** viser metrikkene prosjektet ditt mottar. Klikk på en, så åpnes metrikkutforskeren med en spørring for den: en metrikk, hvordan den aggregeres, og hvordan den filtreres og grupperes. Hver spørring er en variabel, `a`, `b` og så videre, som en formel kan bruke.

```mermaid title="Fra metrikkspørringer til et diagram, en monitor eller et dashbord"
flowchart TB
    a["Spørring a: kall,<br/>aggregert med Sum"] --> f["Formel:<br/>$b / $a * 100"]
    b["Spørring b: feil,<br/>aggregert med Sum"] --> f
    f --> chart["Diagram: feilrate<br/>i prosent"]
    chart --> monitor["En metrikkmonitor"]
    chart --> dash["En dashbord-widget"]
```

Utforskeren har fem faner:

| Fane | Hva den er til |
| --- | --- |
| **Viser** | Listen over metrikker, hver med et lite diagram og den siste verdien. Den åpner på siste time. |
| **Innsikt** | Hvilke tjenester som rapporterer metrikker, og hvor mange. |
| **KI** | Problemene OneUptime finner i målingene dine (for mange verdier, histogrambøtter som ikke passer, manglende målinger), og hva OneUptime AI gjorde med dem. Se [Forbedre målinger og legg til de som mangler med KI](#forbedre-målinger-og-legg-til-de-som-mangler-med-ki). |
| **Oppsettveiledning** | Hvordan du sender metrikker med OpenTelemetry med en av inntaksnøklene dine. |
| **Innstillinger** | **Pipelineregler** og **Opptaksregler**: hva som skjer med metrikker når de kommer inn. |

## Før du begynner

- **Metrikker som kommer inn.** Send dem med [OpenTelemetry](/docs/telemetry/open-telemetry), eller fra en agent som [OpenTelemetry-collectoren for verter](/docs/telemetry/host-otel-collector) eller [Kubernetes-agenten](/docs/telemetry/kubernetes-agent).
- **En rolle som kan lese telemetri.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member eller Telemetry Viewer, eller en egendefinert rolle med tillatelsen Read Telemetry Service Metrics. Se [Telemetri](/docs/permissions/index#telemetri) for hvilke metrikker den leser.

## Finn en metrikk

Gå til **Produkter → Observerbarhet → Målinger**. **Viser** viser hver metrikk prosjektet ditt har mottatt, etter navn, hver med et lite diagram over tidsintervallet og den siste verdien.

- Søk i navn med løse ord eller `name:`, for eksempel finner `name:http.server` metrikken `http.server.request.duration`. Se [Søkesyntaks](/docs/telemetry/search-syntax#målinger).
- Filtrer etter **Tjeneste** i sidepanelet for bare å se metrikkene én tjeneste rapporterer.
- Klikk på en metrikk for å vise den i metrikkutforskeren.

## Vis en metrikk i et diagram

:::steps
### Åpne metrikken

Klikk på metrikken i **Viser**. Utforskeren åpnes med én spørring, `a`, for tidsintervallet og filtrene til listen.

### Velg hvordan den aggregeres

Under **Aggregate by** velger du hvordan verdiene i hvert punkt i diagrammet kombineres: Avg, som er standard, Sum, Min, Max, Count eller en persentil, P50, P75, P90, P95 eller P99. En persentil av en histogrammetrikk, som varigheten til en forespørsel, regnes ut fra bøttene.

### Filtrer og grupper den

Åpne **Filters & grouping**. **Filter by attributes** beholder datapunktene der attributtene passer, som én bestemt `http.route`, og **Group by** tegner én linje per verdi av attributtene du velger, som én linje per vert.

### Juster diagrammet

Åpne **Display Settings** for å velge **Chart type** (linje, område eller søyler), tegne en **Warning Threshold** og en **Critical Threshold** i diagrammet, eller slå på **Convert to per-second rate**.
:::

> [!TIP]
> En teller som bare øker, som `system.disk.io`, leses best som en rate. Slå på **Convert to per-second rate** for å vise hvor fort den endrer seg i stedet for den løpende summen; utforskeren foreslår det når den kjenner igjen en slik teller.

Hver spørring tegner sitt eget diagram. For å tegne en spørring i samme diagram som den forrige slår du på **Overlay with previous query** i dens **Display Settings**.

## Kombiner spørringer med en formel

:::steps
### Legg til spørringene

Klikk på **Legg til metrikk** for hver metrikk du trenger. De nye spørringene heter `b`, `c` og så videre.

### Legg til en formel

Klikk på **Legg til formel** og skriv **Formel** med variablene til spørringene, operatorene `+`, `-`, `*`, `/`, `%` og `^`, og parenteser. For en feilrate i prosent skriver du `$b / $a * 100`.
:::

En variabel kan skrives med eller uten `$`, med store eller små bokstaver. En formel som nevner en spørring du ikke har definert, sier fra i stedet for å tegne.

## Utforsk rundt et diagram

Knappene over diagrammene jobber med tidsintervallet du ser på:

| Knapp | Hva den gjør |
| --- | --- |
| **Logger** | Åpner [Loggutforsker](/docs/telemetry/logs-explorer) for dette tidsintervallet og filtrene dine. |
| **Spor** | Åpner [Sporutforsker](/docs/telemetry/traces-explorer) for dette tidsintervallet og filtrene dine. |
| **Undersøke** | Åpner et sidepanel med loggene, sporene og unntakene fra dette tidsintervallet. |
| **Hendelser** | Markerer hendelsene og varslene fra dette tidsintervallet i diagrammene. |
| **Compare** | Tegner forrige periode som en stiplet linje i hvert diagram, så du ser hva som endret seg. |

Dra over et diagram for å zoome inn på et øyeblikk, og dobbeltklikk for å zoome ut igjen: se [Zoome inn på et tidsintervall](/docs/telemetry/charts-and-time-ranges).

## Bruk det du har vist i diagrammet

- **Handlinger → Opprett monitor fra denne visningen** åpner en ny metrikkmonitor der disse spørringene og formlene allerede er fylt inn. Se [Metrikk-overvåking](/docs/monitor/metrics-monitor).
- **Handlinger → Add to dashboard** legger diagrammet til et dashbord du velger. Du trenger tillatelse til å redigere det dashbordet.
- **Kopier lenke** kopierer en lenke til nøyaktig denne visningen: spørringer, formler og tidsintervall.
- **Saved Views** tar vare på visningen under et navn for alle i prosjektet. **Viser** har egne lagrede visninger for søket og filtrene sine. Lagrede visninger fungerer som i [Loggutforsker](/docs/telemetry/logs-explorer#lagre-en-visning).

## Innsikt i metrikker

Fanen **Innsikt** teller metrikkene i et tidsintervall: **Aktive målinger**, **Rapporteringstjenester** og gjennomsnittet per tjeneste. Den deler metrikkene inn i kategorier og viser tjenestene som rapporterer dem.

## Forbedre målinger og legg til de som mangler med KI

Hver time går OneUptime gjennom målingene tjenestene dine sendte i siste time etter dem som registrerer for mange verdier, histogrammer der bøttene ikke passer, og travle tjenester som ikke sender noen målinger. Det den finner, registrerer den som KI-innsikt, med bevisene. Deretter undersøker OneUptime AI hvert funn og åpner en pull-forespørsel som retter det. Ingenting flettes noen gang: teamet ditt gjennomgår hver pull-forespørsel.

OneUptime leser nøye de 10 målingene tjenestene dine sendte flest datapunkter for i timen, hver med minst 1 000 av dem, og registrerer tre typer funn:

| Funn | Når OneUptime registrerer det | Pull-forespørselen |
| --- | --- | --- |
| **Høy kardinalitet** | Et attributt koden setter på en av disse målingene, fikk 1 000 eller flere verdier i timen, for eksempel bruker-ID-er eller fullstendige URL-er, så hver verdi blir sin egen serie. Eller 50 eller flere av en tjenestes målingsnavn er ett navn med en annen ID i. | Slutter å registrere verdien på målingen, eller tar ID-ene ut av navnene. |
| **Feil histogrambøtter** | En av disse målingene er et histogram som registrerte 1 000 eller flere verdier, og 90 % eller flere av dem havnet i den minste bøtten eller over den største, eller det har ingen bøtter, så persentilene ikke kan skilles fra hverandre. | Gir histogrammet bøtter som passer til verdiene, eller retter enheten. |
| **Manglende målinger** | En tjeneste sendte 1 000 eller flere spans i timen og har aldri sendt en måling. | Legger til antall forespørsler, feilene og varigheten for de travleste operasjonene som målinger. |

Et funn lagrer aldri verdiene til et attributt: bare attributtets navn, hvor mange verdier det fikk og hvordan de ser ut.

### Slå det på

**Målinger → KI → Innstillinger** har bryteren **Forbedre målinger og legg til de som mangler**, som er på for nye prosjekter. Når **Aktiver AI** er av, blir problemer i målingene dine fortsatt funnet, men OneUptime AI gjør ingenting med dem. For å åpne pull-forespørsler trenger OneUptime AI et kodelager koblet til i [Kode](/docs/ai/ai-agent): siden sier først hva som mangler. Koden i hvert kodelager endres på Runneren kodelageret velger i Kode.

OneUptime AI åpner selv høyst 5 pull-forespørsler per dag (UTC), én for hvert funn, og aldri flere enn et kodelagers grense for åpne KI-pull-forespørsler.

### KI-regler

Uten regler undersøker OneUptime AI hvert problem den finner i målingene dine med en gang, og åpner en pull-forespørsel for hvert den kan rette. **AI-regler** under **Flere innstillinger** snevrer det inn, i tre trinn:

| Trinn | Hva det avgjør |
| --- | --- |
| **Treff** | Hvilke tjenester: de valgte, de med bestemte etiketter eller de der navnet passer til et mønster. |
| **Undersøke** | **Med en gang**, eller **Bare hvis fortsatt funnet etter en ventetid**: et problem som forsvinner i ventetiden, blir ikke undersøkt. |
| **Rettelse** | **Ikke rett**, **Spør før retting** eller **Rett uten å spørre**. Å spørre først overlater pull-forespørselen til en person: funnet tilbyr **Fiks med AI**. |

Under **Flere felt** velger en regel kodelagrene, MCP-serverne og LLM-leverandøren OneUptime AI kan bruke for den. Er ingenting valgt, kan den bruke alle, og prosjektets standard LLM-leverandør.

### Se hva den gjorde

- **Målinger → KI → Innsikt** viser hva OneUptime fant, hvert funn med bevisene og **Åpne i Målinger**, som åpner målingen for tjenesten fra timen det ble funnet i. En tjeneste uten målinger tilbyr i stedet **Åpne i Spor**: spansene målingene ville målt.
- **Målinger → KI → Logger** viser hver undersøkelse og hver pull-forespørsel, nyeste først, med status for hver.
- I Kode sier oppgaven at OneUptime startet den, med en lenke til funnet, og pull-forespørselen sier hvorfor den ble åpnet.

## Hva som skjer med metrikker når de kommer inn

**Målinger → Innstillinger → Pipelineregler** endrer metrikker når de kommer inn, før de lagres. Reglene kjører i rekkefølgen i listen, som du endrer ved å dra; en regel for én tjeneste kjører før reglene for alle tjenester.

| Regeltype | Hva den gjør |
| --- | --- |
| Filter (tillatelsesliste) | Beholder bare datapunktene som passer, og forkaster resten. |
| Forkast | Forkaster datapunktene som passer. |
| Gi måling nytt navn | Gir metrikken et nytt navn. |
| Gi attributt nytt navn | Gir nøkkelen til et attributt nytt navn på datapunktene som passer. |
| Legg til attributt | Legger til et attributt på datapunktene som passer. |
| Fjern attributt | Fjerner et attributt, for eksempel ett med for mange verdier til å være nyttig. |
| Sladd attributt | Erstatter verdien til et attributt med en plassholder. |
| Eksempel | Beholder en prosentandel av datapunktene som passer. |

**Målinger → Innstillinger → Opptaksregler** regner hvert minutt ut nye metrikker fra andre metrikker. Se [Opptaksregler for logger](/docs/telemetry/log-recording-rules) for hvordan opptaksregler fungerer.

## Feilsøking

:::details Diagrammet til en teller bare stiger
Det er en kumulativ teller. Slå på **Convert to per-second rate** i spørringens **Display Settings**.
:::

:::details Listen sier at ingen metrikker ble funnet
Tøm først søket og filterbrikkene dine. Er listen fortsatt tom, har ingen metrikker nådd OneUptime ennå: sammenlign oppsettet ditt med **Oppsettveiledning**.
:::

:::details Metrikkene til en tjeneste mangler
Filtrer **Viser** etter den **Tjeneste** og utvid tidsintervallet. Mangler de fortsatt, kan rollens omfang utelate den tjenesten: se [Telemetri](/docs/permissions/index#telemetri).
:::

## Neste steg

:::cards
- [Metrikk-overvåking](/docs/monitor/metrics-monitor): Få varsel når en metrikk krysser en grense.
- [Opprette et dashbord](/docs/dashboards/authoring): Sett diagrammene dine side om side.
- [Søkesyntaks](/docs/telemetry/search-syntax): Hvert filter søkefeltet forstår.
:::
