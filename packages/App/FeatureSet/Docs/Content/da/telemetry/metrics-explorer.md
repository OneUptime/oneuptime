# Måleudforsker

Metrikker er de tal, dine tjenester og din infrastruktur rapporterer over tid: antal forespørgsler, latenser, CPU, kødybde. Måleudforskeren viser hver metrik, dit projekt modtager, viser en hvilken som helst af dem i et diagram, kombinerer dem med formler og gør et diagram til en monitor eller en dashboard-widget.

:::cards
- [Find en metrik](#find-en-metrik): Søg i listen over metriknavne.
- [Vis en metrik i et diagram](#vis-en-metrik-i-et-diagram): Aggregér, filtrér og gruppér en forespørgsel.
- [Kombinér forespørgsler med en formel](#kombinér-forespørgsler-med-en-formel): Fejlrater og andre forhold.
- [Brug det, du har vist i diagrammet](#brug-det-du-har-vist-i-diagrammet): En monitor, en dashboard-widget eller et link.
:::

## Sådan virker udforskeren

Udforskeren har to niveauer. Fanen **Seer** viser de metrikker, dit projekt modtager. Klik på en, og måleudforskeren åbner med en forespørgsel til den: en metrik, hvordan den aggregeres, og hvordan den filtreres og grupperes. Hver forespørgsel er en variabel, `a`, `b` og så videre, som en formel kan bruge.

```mermaid title="Fra metrikforespørgsler til et diagram, en monitor eller et dashboard"
flowchart TB
    a["Forespørgsel a: kald,<br/>aggregeret med Sum"] --> f["Formel:<br/>$b / $a * 100"]
    b["Forespørgsel b: fejl,<br/>aggregeret med Sum"] --> f
    f --> chart["Diagram: fejlrate<br/>i procent"]
    chart --> monitor["En metrik-monitor"]
    chart --> dash["En dashboard-widget"]
```

Udforskeren har fire faner:

| Fane | Hvad den bruges til |
| --- | --- |
| **Seer** | Listen over metrikker, hver med et lille diagram og sin seneste værdi. Den åbner på den seneste time. |
| **Indsigter** | Hvilke tjenester der rapporterer metrikker, og hvor mange. |
| **Opsætningsvejledning** | Sådan sender du metrikker med OpenTelemetry med en af dine indtagelsesnøgler. |
| **Indstillinger** | **Pipelineregler** og **Optagelsesregler**: hvad der sker med metrikker, når de ankommer. |

## Før du begynder

- **Metrikker, der ankommer.** Send dem med [OpenTelemetry](/docs/telemetry/open-telemetry) eller fra en agent som [OpenTelemetry-collectoren til værter](/docs/telemetry/host-otel-collector) eller [Kubernetes-agenten](/docs/telemetry/kubernetes-agent).
- **En rolle, der må læse telemetri.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member eller Telemetry Viewer, eller en brugerdefineret rolle med tilladelsen Read Telemetry Service Metrics. Se [Telemetri](/docs/permissions/index#telemetri) om, hvilke metrikker den læser.

## Find en metrik

Gå til **Produkter → Observabilitet → Målinger**. **Seer** viser hver metrik, dit projekt har modtaget, efter navn, hver med et lille diagram over tidsintervallet og sin seneste værdi.

- Søg i navne med løse ord eller `name:`, for eksempel finder `name:http.server` metrikken `http.server.request.duration`. Se [Søgesyntaks](/docs/telemetry/search-syntax#metrikker).
- Filtrér efter **Tjeneste** i sidepanelet for kun at se de metrikker, én tjeneste rapporterer.
- Klik på en metrik for at vise den i måleudforskeren.

## Vis en metrik i et diagram

:::steps
### Åbn metrikken

Klik på metrikken i **Seer**. Udforskeren åbner med én forespørgsel, `a`, for listens tidsinterval og filtre.

### Vælg, hvordan den aggregeres

Under **Aggregate by** vælger du, hvordan værdierne i hvert punkt i diagrammet kombineres: Avg, som er standard, Sum, Min, Max, Count eller en percentil, P50, P75, P90, P95 eller P99. En percentil af en histogrammetrik, såsom en forespørgsels varighed, beregnes ud fra dens buckets.

### Filtrér og gruppér den

Åbn **Filters & grouping**. **Filter by attributes** beholder de datapunkter, hvis attributter passer, såsom én bestemt `http.route`, og **Group by** tegner én linje pr. værdi af de attributter, du vælger, såsom én linje pr. vært.

### Tilpas diagrammet

Åbn **Display Settings** for at vælge **Chart type** (linje, område eller søjler), tegne en **Warning Threshold** og en **Critical Threshold** i diagrammet eller slå **Convert to per-second rate** til.
:::

> [!TIP]
> En tæller, der kun stiger, såsom `system.disk.io`, læses bedst som en rate. Slå **Convert to per-second rate** til for at vise, hvor hurtigt den ændrer sig, i stedet for dens løbende total; udforskeren foreslår det, når den genkender sådan en tæller.

Hver forespørgsel tegner sit eget diagram. For at tegne en forespørgsel i samme diagram som den forrige skal du slå **Overlay with previous query** til i dens **Display Settings**.

## Kombinér forespørgsler med en formel

:::steps
### Tilføj forespørgslerne

Klik på **Tilføj metrik** for hver metrik, du har brug for. De nye forespørgsler hedder `b`, `c` og så videre.

### Tilføj en formel

Klik på **Tilføj formel**, og skriv **Formel** med forespørgslernes variabler, operatorerne `+`, `-`, `*`, `/`, `%` og `^` samt parenteser. For en fejlrate i procent skriver du `$b / $a * 100`.
:::

En variabel kan skrives med eller uden sit `$`, med store eller små bogstaver. En formel, der nævner en forespørgsel, du ikke har defineret, siger det i stedet for at tegne.

## Udforsk omkring et diagram

Knapperne over diagrammerne arbejder med det tidsinterval, du kigger på:

| Knap | Hvad den gør |
| --- | --- |
| **Protokoller** | Åbner [Protokoludforsker](/docs/telemetry/logs-explorer) for dette tidsinterval og dine filtre. |
| **Spor** | Åbner [Sporudforsker](/docs/telemetry/traces-explorer) for dette tidsinterval og dine filtre. |
| **Investigate** | Åbner et sidepanel med protokollerne, sporene og undtagelserne fra dette tidsinterval. |
| **Begivenheder** | Markerer hændelserne og advarslerne fra dette tidsinterval i diagrammerne. |
| **Compare** | Tegner den forrige periode som en stiplet linje i hvert diagram, så du kan se, hvad der ændrede sig. |

Træk hen over et diagram for at zoome ind på et øjeblik, og dobbeltklik for at zoome ud igen: se [Zoom ind på et tidsinterval](/docs/telemetry/charts-and-time-ranges).

## Brug det, du har vist i diagrammet

- **Handlinger → Opret monitor fra denne visning** åbner en ny metrik-monitor, hvor disse forespørgsler og formler allerede er udfyldt. Se [Metrik-monitor](/docs/monitor/metrics-monitor).
- **Handlinger → Add to dashboard** tilføjer diagrammet til et dashboard, du vælger. Du skal have tilladelse til at redigere det dashboard.
- **Kopiér link** kopierer et link til præcis denne visning: forespørgsler, formler og tidsinterval.
- **Saved Views** gemmer visningen under et navn til alle i projektet. **Seer** har sine egne gemte visninger til sin søgning og sine filtre. Gemte visninger fungerer som i [Protokoludforsker](/docs/telemetry/logs-explorer#gem-en-visning).

## Indsigter i metrikker

Fanen **Indsigter** tæller metrikkerne i et tidsinterval: **Aktive målinger**, **Rapporteringstjenester** og gennemsnittet pr. tjeneste. Den inddeler metrikkerne i kategorier og viser de tjenester, der rapporterer dem.

## Hvad der sker med metrikker, når de ankommer

**Målinger → Indstillinger → Pipelineregler** ændrer metrikker, når de ankommer, før de gemmes. Reglerne kører i listens rækkefølge, som du ændrer ved at trække; en regel for én tjeneste kører før reglerne for alle tjenester.

| Regeltype | Hvad den gør |
| --- | --- |
| Filter (tilladelsesliste) | Beholder kun de datapunkter, der passer, og kasserer resten. |
| Kassér | Kasserer de datapunkter, der passer. |
| Omdøb måling | Omdøber metrikken. |
| Omdøb attribut | Omdøber en attributs nøgle på de datapunkter, der passer. |
| Tilføj attribut | Tilføjer en attribut til de datapunkter, der passer. |
| Fjern attribut | Fjerner en attribut, for eksempel en med for mange værdier til at være nyttig. |
| Redigér attribut bort | Erstatter en attributs værdi med en pladsholder. |
| Stikprøve | Beholder en procentdel af de datapunkter, der passer. |

**Målinger → Indstillinger → Optagelsesregler** beregner hvert minut nye metrikker ud fra andre metrikker. Se [Optagelsesregler for logs](/docs/telemetry/log-recording-rules) om, hvordan optagelsesregler virker.

## Fejlfinding

:::details En tællers diagram stiger kun
Det er en kumulativ tæller. Slå **Convert to per-second rate** til i forespørgslens **Display Settings**.
:::

:::details Listen siger, at der ikke blev fundet nogen metrikker
Ryd først din søgning og dine filterchips. Er listen stadig tom, har ingen metrikker nået OneUptime endnu: sammenlign din opsætning med **Opsætningsvejledning**.
:::

:::details En tjenestes metrikker mangler
Filtrér **Seer** efter den **Tjeneste**, og udvid tidsintervallet. Mangler de stadig, udelader din rolles omfang måske den tjeneste: se [Telemetri](/docs/permissions/index#telemetri).
:::

## Næste skridt

:::cards
- [Metrik-monitor](/docs/monitor/metrics-monitor): Få besked, når en metrik krydser en grænse.
- [Opret et dashboard](/docs/dashboards/authoring): Sæt dine diagrammer side om side.
- [Søgesyntaks](/docs/telemetry/search-syntax): Hvert filter, søgefeltet forstår.
:::
