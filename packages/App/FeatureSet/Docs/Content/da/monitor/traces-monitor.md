# Trace-monitor

En trace-monitor tæller inden for et tidsvindue de spans, dine tjenester sender til OneUptime, som matcher dine filtre (span-navn, status, tjeneste, attributter). Når antallet opfylder dine kriterier, ændrer den monitorens status, opretter en advarsel eller erklærer en hændelse. Brug den til at få advarsler om mislykkede anmodninger til et endpoint, en stigning i fejl-spans eller en tjeneste, der er holdt op med at sende traces.

:::cards
- [Opret monitoren](#opret-en-trace-monitor): Vælg, hvilke spans der tælles, og hvornår du får en advarsel.
- [Span-statuskoder](#span-statuskoder): Hvad OK, ERROR og UNSET betyder, og hvad du skal filtrere på.
- [Sådan evalueres den](#sådan-evalueres-den): Tidsvinduet, optællingen og cyklussen på ét minut.
- [Kriterier](#kriterier): Tærskler, anomalidetektion og standardværdierne.
:::

## Sådan virker det

```mermaid title="Hvert minut tæller og tjekker en trace-monitor"
flowchart TB
    App["Dine tjenester"] -->|OpenTelemetry| Store[("Spans i OneUptime")]
    Store --> Count["Tæl matchende spans<br/>i tidsvinduet"]
    Count --> Check{"Kriterier opfyldt?"}
    Check -->|"Første match"| Act["Skift status,<br/>advarsel eller hændelse"]
    Check -->|Ingen| Default["Standardstatus"]
```

Hvert minut tæller OneUptime de spans, der matcher monitorens filtre og startede inden for dens tidsvindue. Det sammenligner antallet med monitorens kriterier fra top til bund, og det første kriterium, der matcher, afgør, hvad der sker. Når intet matcher, går monitoren tilbage til sin standardstatus.

## Før du starter

- Dine tjenester sender traces til OneUptime via OpenTelemetry. Se [OpenTelemetry](/docs/telemetry/open-telemetry).
- Slå det præcise navn på det span, du vil overvåge, op i trace-explorer: span-navne bestemmes af din instrumentering, for eksempel `POST /api/checkout` eller `GET`.

## Opret en trace-monitor

:::steps
### Start en ny monitor

Gå til **Monitorer**, og klik på **Opret monitor**. Eller filtrér i trace-explorer de spans, du vil have besked om, og klik på **Opret monitor** i dens værktøjslinje: den nye monitor holder fra starten øje med explorerens tjenester, statusser, span-navn og attributter.

### Vælg Traces

Under **Monitortype** klikker du på **Flere monitortyper** og vælger **Spor** under **Telemetri**, eller du skriver `traces` i søgefeltet. Angiv et **Navn**, og klik derefter på **Næste**.

### Vælg, hvad monitoren skal fortælle dig om

Under **Hvad skal denne overvågning fortælle dig om?** vælger du **For mange fejlede forespørgsler** eller **Forespørgsler udebliver**. Hvert valg udfylder de spans, der skal holdes øje med, og reglen, som du kan ændre længere nede. Vælg **Noget andet** for selv at sætte dem op.

### Vælg de spans, der skal tælles

I **Spans at holde øje med** angiver du **Span-status** og **Span-navnet indeholder**. Et filter, du lader stå tomt, matcher alle spans. **Matchende spans** under filtrene viser de spans, de matcher lige nu.

### Indsnævr dem (valgfrit)

Åbn **Flere felter** for at filtrere efter telemetritjeneste, infrastrukturentitet eller attribut.

### Sig, hvornår der skal advares

I **Hvornår der advares** vælger du en **Betingelse**, **Antal spans** og et **Tidsvindue**. Sætningen under dem gentager reglen med almindelige ord. Diagrammet under den tæller de matchende spans i hvert vindue over de seneste timer, tegner reglens tal som en linje og fortæller, hvor ofte reglen ville have advaret. Dens knap foreslår et tal, som reglen ikke ville have overskredet i den periode.

### Vælg, hvad der sker

I **Hvad der sker** vælger du **Opret en advarsel**, **Erklær en hændelse** eller **Begge**, og giver den en titel og en alvorlighed. Mens reglen matcher, viser monitoren statussen under **Flere felter**; når den holder op med at matche, går monitoren tilbage til sin standardstatus, og advarslen eller hændelsen løser sig selv.

### Opret monitoren

Klik på **Opret monitor**. Monitoren åbner på sin side **Oversigt**, og dens første evaluering kører inden for et minut.
:::

> [!TIP]
> For at få besked, når en AI-funktion svarer dårligt (mislykkede, afviste, afbrudte, tomme, markerede eller langsomme svar), vælger du i stedet **AI / LLM** under **Telemetri**. Den monitor læser AI-kaldene i dine traces for dig, uden span-filtre, du skal skrive. Se [AI- / LLM-observability](/docs/telemetry/ai-llm-observability#få-besked-når-aien-svarer-dårligt).

## Hvad den forespørger

| Felt | Hvad det matcher | Standard |
| --- | --- | --- |
| **Span-status** | Spans med en af de valgte statusser: **Ikke angivet**, **Ok** eller **Fejl**. | Tom: alle statusser |
| **Span-navnet indeholder** | Spans, hvis navn indeholder denne tekst, uden forskel på store og små bogstaver. | Tom: alle spans |
| **Tidsvindue** (i **Hvornår der advares**) | Spans, der startede inden for de seneste 5 sekunder op til de seneste 24 timer. | **Seneste 5 minutter** |
| **Filtrér efter telemetritjeneste** (under **Flere felter**) | Spans fra en af de valgte tjenester. | Tom: alle tjenester |
| **Filtrér efter infrastrukturenhed** (under **Flere felter**) | Spans fra en af de valgte værter, pods, containere og andre entiteter. | Tom: alle entiteter |
| **Filtrér efter attributter** (under **Flere felter**) | Spans, hvis attributter opfylder alle betingelser. Hver betingelse har sin egen operator, såsom "er lig med" eller "indeholder". | Tom: ingen betingelse |

Alle de filtre, du angiver, skal matche, før et span tælles.

### Span-statuskoder

- **OK** – Operationen blev eksplicit markeret som vellykket af applikationskode eller en trace-pipeline
- **ERROR** – Operationen stødte på en fejl
- **UNSET** – Der blev ikke angivet nogen fejlstatus. Dette er OpenTelemetrys standardstatus

UNSET betyder ikke, at der mangler data. OpenTelemetry-instrumentering sætter ERROR, når en operation fejler, og lader vellykkede spans stå som UNSET, så på en sund tjeneste er de fleste spans UNSET. OneUptime viser dem med grønt som "Unset (no error)". At registrere en undtagelse ændrer ikke et spans status, så et UNSET-span kan stadig have undtagelser; de vises sammen med spannet. For at advare om fejl skal du filtrere på ERROR. For at tælle alle spans, der ikke fejlede, skal du vælge både OK og UNSET.

Hvis du vil have vellykkede forespørgsler vist som OK, skal du tilføje en trace-pipeline under **Spor > Indstillinger > Pipelines** med filterbetingelsen **Status = Ikke angivet** og en **Status-remapper**, der mapper `http.response.status_code`-værdier såsom `200` til Ok.

## Sådan evalueres den

- **Hvert minut.** En trace-monitor tjekkes ikke af sonder, så den har intet interval at angive og ingen side **Sonder og interval**.
- **Ét tal pr. evaluering.** Monitoren tæller de spans, der matcher alle filtre og startede inden for **Tidsvindue** før evalueringen. Med **Seneste 5 minutter** kigger hver evaluering fem minutter tilbage, så vinduerne for på hinanden følgende evalueringer overlapper.
- **Ingen spans er et antal på 0.** En tjeneste, der holder op med at sende traces, giver 0, og det er det, **Forespørgsler udebliver** leder efter.
- **OneUptimes egen nedetid er ikke stilhed.** Så længe tidsvinduet rummer tid, hvor OneUptime selv ikke modtog data (det genstartede, blev opgraderet eller indhentede et efterslæb), venter tjekket: statussen ændres ikke, og ingen hændelse eller advarsel åbnes eller løses. Se [Når OneUptime ikke modtager data](/docs/monitor/when-oneuptime-is-not-receiving).
- **Kriterier fra top til bund.** Det første kriterium, der matcher, afgør det, så sæt det alvorligste øverst.

Hver statusændring registreres med sin årsag på monitorens **Statustidslinje**.

## Kriterier

En trace-monitors kriterier har én **Filtertype**: **Span Count**, antallet af spans, der matchede i vinduet. **Hvornår der advares** opretter ét kriterium, hvis **Betingelse** er **Mere end**, **Mindst**, **Færre end**, **Højst**, **Præcis**, **Usædvanligt høj**, **Usædvanligt lav** eller **Usædvanligt høj eller lav**. For flere kriterier, eller ét med mere end ét filter, klikker du på **Rediger som egne kriterier** under **Flere felter** i **Hvad der sker**: hvert kriterium der har en **Filterbetingelse** og, for en tærskelbetingelse, en **Værdi**.

| Filterbetingelse | Matcher, når antallet af spans er… |
| --- | --- |
| **Større end** | over værdien |
| **Større end eller lig med** | lig med værdien eller derover |
| **Mindre end** | under værdien |
| **Mindre end eller lig med** | lig med værdien eller derunder |
| **Lig med** | præcis værdien |
| **Anomalously High** | over det forventede interval for denne time på ugen |
| **Anomalously Low** | under det interval |
| **Anomalous** | uden for det interval, i begge retninger |

Anomalibetingelserne har ingen **Værdi**. Vælg en **Følsomhed** (Lav, Middel, som er standard, eller Høj) og, i de egne kriterier, et **Baseline-vindue** på 14 (standard), 28, 60 eller 90 dage. OneUptime omregner antallet til en rate pr. minut og sammenligner den med samme time på ugen over det vindue. Baselinen dækker kun monitorens tjenester og span-statusser: dens filtre på span-navn og attributter indgår ikke. Indtil den time på ugen har nok historik, er kriteriet stadig ved at lære og udløses ikke.

En trace-monitor, der er oprettet i Opret monitor, starter med reglen for det, du valgte under **Hvad skal denne overvågning fortælle dig om?**:

| Valg | Regel | Hvad der sker |
| --- | --- | --- |
| **For mange fejlede forespørgsler** | **Span-status** **Fejl**, **Mere end** `10` i **Seneste 5 minutter** | Opretter en advarsel, som løser sig selv |
| **Forespørgsler udebliver** | **Præcis** `0` i **Seneste 10 minutter** | Erklærer en hændelse, som løser sig selv |

En trace-monitor, der er oprettet via API'et eller Terraform uden kriterier, starter med disse kriterier:

| Kriterium | Filter | Effekt |
| --- | --- | --- |
| Check if … is offline | **Span Count** **Lig med** `0` | Sætter monitoren offline og erklærer en hændelse, der løses automatisk |
| Check if … is online | **Span Count** **Større end** `0` | Sætter monitoren online |

## Gennemgået eksempel: mislykkede checkout-anmodninger

På fem minutter registrerer checkout-tjenesten 1.200 spans med navnet `POST /api/checkout`: 1.150 UNSET, 20 OK og 30 ERROR. Den samme monitor tæller meget forskellige tal afhængigt af **Span-status**:

| Span-status | Span Count | Hvad det måler |
| --- | --- | --- |
| **Fejl** | 30 | Anmodninger, der mislykkedes |
| **Ok** | 20 | Kun de anmodninger, din kode markerede som vellykkede |
| **Ikke angivet** og **Ok** | 1.170 | Alle anmodninger, der ikke mislykkedes |
| Tom | 1.200 | Alle anmodninger |

For at blive kaldt ud, når mere end 10 checkout-anmodninger mislykkes på fem minutter:

- **Span-navnet indeholder**: `POST /api/checkout`
- **Tidsvindue**: **Seneste 5 minutter**
- **Span-status**: **Fejl**
- **Hvornår der advares**: **Mere end** `10`
- **Hvad der sker**: **Erklær en hændelse**

Med 30 mislykkede anmodninger matcher reglen, og hændelsen erklæres. Når der er gået fem minutter med 10 eller færre fejl, holder reglen op med at matche, monitoren er online igen, og hændelsen løser sig selv.

## Fejlfinding

:::details Monitoren tæller ingen spans for mit endpoint
**Span-navnet indeholder** sammenlignes med spannets navn, og instrumentering navngiver ofte server-spans efter ruten (`POST /api/checkout`) eller kun efter metoden (`GET`). Find det præcise navn i trace-explorer. Åbn derefter monitorens side **Kriterier** (under **Konfiguration**), og klik på **Edit Monitoring Criteria**: **Matchende spans** viser, hvad filtrene matcher lige nu.
:::

:::details Vellykkede anmodninger tælles ikke, når jeg filtrerer på Ok
De fleste instrumenteringer lader vellykkede spans stå som UNSET, ikke OK (se [Span-statuskoder](#span-statuskoder)). Vælg både **Ikke angivet** og **Ok**, eller tilføj den trace-pipeline, der er beskrevet der.
:::

:::details Et span har en undtagelse, men tælles ikke som fejl
At registrere en undtagelse ændrer ikke et spans status. Filtrér på **Fejl**, eller brug en [undtagelse-monitor](/docs/monitor/exceptions-monitor) til at få advarsler om selve undtagelserne.
:::

:::details Et anomalikriterium udløses aldrig
Det er stadig ved at lære: den time på ugen, det sammenligner med, har endnu ikke nok historik inden for **Baseline-vindue**.
:::

## Næste skridt

:::cards
- [Undtagelse-monitor](/docs/monitor/exceptions-monitor): Få advarsler om de undtagelser, dine tjenester registrerer.
- [Log-monitor](/docs/monitor/logs-monitor): Få advarsler om logmængde og -indhold.
- [Søgesyntaks](/docs/telemetry/search-syntax): Find span-navne og -statusser i trace-explorer.
- [Hændelse- og advarselsskabeloner](/docs/monitor/incident-alert-templating): Skriv nyttige titler og beskrivelser til advarsler.
:::
