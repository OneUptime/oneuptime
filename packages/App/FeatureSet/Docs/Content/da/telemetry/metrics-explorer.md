# Måleudforsker

Metrikker er de tal, dine tjenester og din infrastruktur rapporterer over tid: antal forespørgsler, latenser, CPU, kødybde. Måleudforskeren viser hver metrik, dit projekt modtager, viser en hvilken som helst af dem i et diagram, kombinerer dem med formler og gør et diagram til en monitor eller en dashboard-widget.

:::cards
- [Find en metrik](#find-en-metrik): Søg i listen over metriknavne.
- [Vis en metrik i et diagram](#vis-en-metrik-i-et-diagram): Aggregér, filtrér og gruppér en forespørgsel.
- [Kombinér forespørgsler med en formel](#kombinér-forespørgsler-med-en-formel): Fejlrater og andre forhold.
- [Brug det, du har vist i diagrammet](#brug-det-du-har-vist-i-diagrammet): En monitor, en dashboard-widget eller et link.
- [Forbedr metrikker og tilføj de manglende med AI](#forbedr-metrikker-og-tilføj-de-manglende-med-ai): Pull requests, der retter dine metrikker og tilføjer dem, en tjeneste mangler.
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

Udforskeren har fem faner:

| Fane | Hvad den bruges til |
| --- | --- |
| **Seer** | Listen over metrikker, hver med et lille diagram og sin seneste værdi. Den åbner på den seneste time. |
| **Indsigter** | Hvilke tjenester der rapporterer metrikker, og hvor mange. |
| **AI** | De problemer, OneUptime finder i dine metrikker (for mange værdier, histogram-buckets, der ikke passer, manglende metrikker), og hvad OneUptime AI gjorde ved dem. Se [Forbedr metrikker og tilføj de manglende med AI](#forbedr-metrikker-og-tilføj-de-manglende-med-ai). |
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
| **Undersøge** | Åbner et sidepanel med protokollerne, sporene og undtagelserne fra dette tidsinterval. |
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

## Forbedr metrikker og tilføj de manglende med AI

Hver time gennemgår OneUptime de metrikker, dine tjenester har sendt i den seneste time, for dem, der registrerer for mange værdier, histogrammer, hvis buckets ikke passer, og travle tjenester, der ikke sender nogen metrikker. Det, den finder, gemmer den som AI-indsigter med beviserne. Derefter undersøger OneUptime AI hver enkelt og åbner en pull request, der retter det. Intet bliver nogensinde flettet: dit team gennemgår hver pull request.

OneUptime læser nøje de 10 metrikker, dine tjenester sendte flest datapunkter for i den seneste time, hver med mindst 1.000 af dem, og opretter tre slags fund:

| Fund | Hvornår OneUptime opretter det | Pull requesten |
| --- | --- | --- |
| **Høj kardinalitet** | En attribut, som koden sætter på en af disse metrikker, fik 1.000 eller flere værdier i timen, såsom bruger-id'er eller fulde URL'er, så hver værdi bliver sin egen serie. Eller 50 eller flere af en tjenestes metriknavne er ét navn med et forskelligt id i. | Holder op med at registrere værdien på metrikken, eller tager id'erne ud af dens navne. |
| **Forkerte histogram-buckets** | En af disse metrikker er et histogram, der registrerede 1.000 eller flere værdier, og 90 % eller flere af dem faldt i dets mindste bucket eller over dets største, eller det har ingen buckets, så dets percentiler ikke kan skelnes fra hinanden. | Giver histogrammet buckets, der passer til dets værdier, eller retter dets enhed. |
| **Manglende metrikker** | En tjeneste sendte 1.000 eller flere spans i timen og har aldrig sendt en metrik. | Tilføjer antallet af forespørgsler, fejlene og varigheden af dens travleste operationer som metrikker. |

Et fund gemmer aldrig en attributs værdier: kun attributtens navn, hvor mange værdier den fik, og hvordan de ser ud.

### Slå det til

**Målinger → AI → Indstillinger** rummer kontakten **Forbedr metrikker og tilføj de manglende**, der er slået til for nye projekter. Er **Aktivér AI** slået fra, findes problemer i dine metrikker stadig, men OneUptime AI gør intet med dem. For at åbne pull requests skal OneUptime AI have et repository forbundet i [Kode](/docs/ai/ai-agent): siden siger først, hvad der mangler. Koden i hvert repository ændres på den Runner, som repositoryet vælger i Kode.

OneUptime AI åbner selv højst 5 pull requests om dagen (UTC), én for hvert fund, og aldrig flere end et repositorys grænse for åbne AI-pull requests.

### AI-regler

Uden regler undersøger OneUptime AI straks hvert problem, den finder i dine metrikker, og åbner en pull request for hvert, den kan rette. **AI-regler** under **Yderligere indstillinger** indsnævrer det, i tre trin:

| Trin | Hvad det afgør |
| --- | --- |
| **Match** | Hvilke tjenester: de valgte, dem med bestemte etiketter eller dem, hvis navn passer til et mønster. |
| **Undersøge** | **Med det samme** eller **Kun hvis stadig fundet efter en ventetid**: et problem, der forsvinder i ventetiden, undersøges ikke. |
| **Rettelse** | **Ret ikke**, **Spørg, før der rettes** eller **Ret uden at spørge**. At spørge først overlader pull requesten til en person: fundet tilbyder **Ret med AI**. |

Under **Flere felter** vælger en regel de koderepositorier, MCP-servere og den LLM-udbyder, som OneUptime AI må bruge for den. Er intet valgt, må den bruge dem alle og projektets standard-LLM-udbyder.

### Se, hvad den gjorde

- **Målinger → AI → Indsigter** viser, hvad OneUptime fandt, hvert fund med sine beviser og **Åbn i Målinger**, som åbner dets metrik for dets tjeneste fra den time, det blev fundet i. En tjeneste uden metrikker tilbyder i stedet **Åbn i Spor**: de spans, dens metrikker ville måle.
- **Målinger → AI → Protokoller** viser hver undersøgelse og hver pull request, nyeste først, med status for hver.
- I Kode siger opgaven, at OneUptime startede den, med et link til dens fund, og pull requesten siger, hvorfor den blev åbnet.

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
