# Undtagelse-monitor

En undtagelse-monitor tæller inden for et tidsvindue de undtagelser, dine tjenester rapporterer til OneUptime, som matcher dine filtre (meddelelse, undtagelsestype, miljø, tjeneste). Når antallet opfylder dine kriterier, ændrer den monitorens status, opretter en advarsel eller erklærer en hændelse. Brug den til at få advarsler om ethvert nyt nedbrud i produktion, om én undtagelsestype eller om en pludselig stigning i fejl.

:::cards
- [Opret monitoren](#opret-en-undtagelse-monitor): Vælg, hvilke undtagelser der tælles, og hvornår du får en advarsel.
- [Miljøer](#miljøer): Begræns monitoren til `production`.
- [Sådan evalueres den](#sådan-evalueres-den): Hvad der tælles, og hvad det gør at løse en undtagelse.
- [Kriterier](#kriterier): Betingelserne og standardværdierne.
:::

## Sådan virker det

```mermaid title="Hvert minut tæller og tjekker en undtagelse-monitor"
flowchart TB
    App["Dine tjenester"] -->|OpenTelemetry| Store[("Undtagelser i OneUptime")]
    Store --> Skip["Udelad løste og<br/>arkiverede undtagelser"]
    Skip --> Count["Tæl matchende undtagelser<br/>i tidsvinduet"]
    Count --> Check{"Kriterier opfyldt?"}
    Check -->|"Første match"| Act["Skift status,<br/>advarsel eller hændelse"]
    Check -->|Ingen| Default["Standardstatus"]
```

Hvert minut tæller OneUptime de undtagelser, der matcher monitorens filtre og opstod inden for dens tidsvindue, og udelader de undtagelser, du har markeret som løst eller arkiveret. Det sammenligner antallet med monitorens kriterier fra top til bund, og det første kriterium, der matcher, afgør, hvad der sker. Når intet matcher, går monitoren tilbage til sin standardstatus.

## Før du starter

- Dine tjenester sender undtagelser til OneUptime via OpenTelemetry. Se [OpenTelemetry](/docs/telemetry/open-telemetry).
- For at begrænse en monitor til et miljø skal dine tjenester angive ressourceattributten `deployment.environment`.

## Opret en undtagelse-monitor

:::steps
### Start en ny monitor

Gå til **Monitorer**, og klik på **Opret monitor**. Eller klik på **Opret monitor** ved siden af **Løs** på en undtagelses side: den nye monitor holder fra starten øje med den undtagelses type i dens tjeneste og advarer, når den sker igen.

### Vælg Exceptions

Under **Monitortype** klikker du på **Flere monitortyper** og vælger **Undtagelser** under **Telemetri**, eller du skriver `exceptions` i søgefeltet. Angiv et **Navn**, og klik derefter på **Næste**.

### Vælg, hvad monitoren skal fortælle dig om

Under **Hvad skal denne overvågning fortælle dig om?** vælger du **Enhver undtagelse** eller **For mange undtagelser**. Hvert valg udfylder reglen, som du kan ændre længere nede. Vælg **Noget andet** for selv at sætte den op. **En ny undtagelse**, **En løst undtagelse kommer tilbage** og **Undtagelser topper** advarer ved en undtagelse, der ses for første gang, ved en, der kom tilbage, efter du løste den, og ved en stigning langt over det sædvanlige.

### Vælg de undtagelser, der skal tælles

I **Undtagelser at holde øje med** angiver du **Beskeden indeholder**, **Undtagelsestyper** og **Environments**. Et filter, du lader stå tomt, matcher alle undtagelser. **Matchende undtagelser** under filtrene viser de undtagelser, de matcher lige nu.

### Indsnævr dem (valgfrit)

Åbn **Flere felter** for at filtrere efter telemetritjeneste eller infrastrukturentitet eller for også at tælle løste og arkiverede undtagelser.

### Sig, hvornår der skal advares

I **Hvornår der advares** vælger du en **Betingelse**, **Antal undtagelser** og et **Tidsvindue**. Sætningen under dem gentager reglen med almindelige ord. Diagrammet under den tæller de matchende undtagelser i hvert vindue over de seneste timer, tegner reglens tal som en linje og fortæller, hvor ofte reglen ville have advaret. Dens knap foreslår et tal, som reglen ikke ville have overskredet i den periode. **Advar ved** vælger, hvad reglen sammenligner: **Undtagelser**, **Nye undtagelser**, **Undtagelser, der kom tilbage** eller **En stigning over det sædvanlige**. Diagrammet tegnes kun for **Undtagelser**.

### Vælg, hvad der sker

I **Hvad der sker** vælger du **Opret en advarsel**, **Erklær en hændelse** eller **Begge**, og giver den en titel og en alvorlighed. Mens reglen matcher, viser monitoren statussen under **Flere felter**; når den holder op med at matche, går monitoren tilbage til sin standardstatus, og advarslen eller hændelsen løser sig selv.

### Opret monitoren

Klik på **Opret monitor**. Monitoren åbner på sin side **Oversigt**, og dens første evaluering kører inden for et minut.
:::

## Hvad den forespørger

| Felt | Hvad det matcher | Standard |
| --- | --- | --- |
| **Beskeden indeholder** | Undtagelser, hvis meddelelse indeholder denne tekst, uden forskel på store og små bogstaver. | Tom: alle undtagelser |
| **Undtagelsestyper** | Undtagelser af en af disse typer, adskilt af kommaer, såsom `TypeError, NullReferenceException`. Typenavnet skal matche præcist. | Tom: alle typer |
| **Environments** | Undtagelser fra et af disse miljøer, adskilt af kommaer (se [Miljøer](#miljøer)). | Tom: alle miljøer |
| **Tidsvindue** (i **Hvornår der advares**) | Undtagelser fra de seneste 5 sekunder op til de seneste 24 timer. | **Seneste 5 minutter** |
| **Filtrér efter telemetritjeneste** (under **Flere felter**) | Undtagelser fra en af de valgte tjenester. | Tom: alle tjenester |
| **Filtrér efter infrastrukturenhed** (under **Flere felter**) | Undtagelser fra en af de valgte værter, pods, containere og andre entiteter. | Tom: alle entiteter |
| **Inkluder løste undtagelser** (under **Flere felter**) | Tæl også undtagelser, der er markeret som løst. | Fra |
| **Inkluder arkiverede undtagelser** (under **Flere felter**) | Tæl også arkiverede undtagelser. | Fra |

Alle de filtre, du angiver, skal matche, før en undtagelse tælles.

### Miljøer

Miljøer kommer fra OpenTelemetry-ressourceattributten `deployment.environment` på hver undtagelse, den samme værdi, som undtagelses-explorer filtrerer på med `env:production`. Angiv ét miljø eller flere adskilt af kommaer; en undtagelse tælles, når dens miljø matcher et af dem.

Sammenligningen er præcis og skelner mellem store og små bogstaver: `production` matcher ikke `Production` eller `prod`. Undtagelser uden miljø tælles ikke, når dette filter er angivet. Lad det stå tomt for at tælle undtagelser fra alle miljøer, også dem uden miljø.

Miljøfilteret kombineres med alle andre filtre, så en monitor, der er begrænset til én telemetritjeneste og `production`, kun tæller den tjenestes produktionsundtagelser.

Når du opretter monitoren via API'et, sætter du `environments` på trinnets `exceptionMonitor` til en liste med miljønavne:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Sådan evalueres den

- **Hvert minut.** En undtagelse-monitor tjekkes ikke af sonder, så den har intet interval at angive og ingen side **Sonder og interval**.
- **Forekomster, ikke undtagelsestyper.** Monitoren tæller hver gang, en matchende undtagelse opstod inden for **Tidsvindue**. Én undtagelse, der kastes 40 gange, tæller 40.
- **Løste og arkiverede undtagelser udelades.** Medmindre du slår **Inkluder løste undtagelser** eller **Inkluder arkiverede undtagelser** til, tæller forekomsterne af en undtagelse, du har markeret som løst eller arkiveret, ikke med. At markere en undtagelse som løst kan derfor lukke den hændelse, den åbnede. Når en løst undtagelse opstår igen, bliver den automatisk uløst og tælles igen.
- **Ingen undtagelser er et antal på 0.**
- **OneUptimes egen nedetid er ikke stilhed.** Så længe tidsvinduet rummer tid, hvor OneUptime selv ikke modtog data (det genstartede, blev opgraderet eller indhentede et efterslæb), venter tjekket: statussen ændres ikke, og ingen hændelse eller advarsel åbnes eller løses. Se [Når OneUptime ikke modtager data](/docs/monitor/when-oneuptime-is-not-receiving).
- **Kriterier fra top til bund.** Det første kriterium, der matcher, afgør det, så sæt det alvorligste øverst.

Hver statusændring registreres med sin årsag på monitorens **Statustidslinje**.

## Kriterier

En undtagelse-monitors kriterier har fire slags **Filtertype**: **Exception Count**, antallet af undtagelser, der matchede i vinduet, samt **New Exceptions**, **Regressed Exceptions** og **Exception Increase (in %)**, som beskrives nedenfor. **Hvornår der advares** opretter ét kriterium, hvis **Betingelse** er **Mere end**, **Mindst**, **Færre end**, **Højst** eller **Præcis**. For flere kriterier, eller ét med mere end ét filter, klikker du på **Rediger som egne kriterier** under **Flere felter** i **Hvad der sker**: hvert kriterium der har en **Filterbetingelse** og en **Værdi**.

| Filterbetingelse | Matcher, når antallet af undtagelser er… |
| --- | --- |
| **Større end** | over værdien |
| **Større end eller lig med** | lig med værdien eller derover |
| **Mindre end** | under værdien |
| **Mindre end eller lig med** | lig med værdien eller derunder |
| **Lig med** | præcis værdien |
| **Ikke lig med** | alt andet end værdien |

Antal undtagelser har ingen anomalibetingelser: der er ingen baseline at sammenligne dem med.

En undtagelse-monitor, der er oprettet i Opret monitor, starter med reglen for det, du valgte under **Hvad skal denne overvågning fortælle dig om?**:

| Valg | Regel | Hvad der sker |
| --- | --- | --- |
| **Enhver undtagelse** | **Mere end** `0` i **Seneste 5 minutter** | Opretter en advarsel, som løser sig selv |
| **For mange undtagelser** | **Mere end** `20` i **Seneste 5 minutter** | Opretter en advarsel, som løser sig selv |
| **En ny undtagelse** | **Nye undtagelser**: **Mere end** `0` i **Seneste 10 minutter** | Opretter en advarsel, som løser sig selv |
| **En løst undtagelse kommer tilbage** | **Undtagelser, der kom tilbage**: **Mere end** `0` i **Seneste 10 minutter** | Opretter en advarsel, som løser sig selv |
| **Undtagelser topper** | **En stigning over det sædvanlige**: **Mere end** `200` i **Seneste 15 minutter** | Opretter en advarsel, som løser sig selv |

En undtagelse-monitor, der er oprettet via API'et eller Terraform uden kriterier, starter med disse kriterier:

| Kriterium | Filter | Effekt |
| --- | --- | --- |
| Check if … has exceptions | **Exception Count** **Større end** `0` | Sætter monitoren offline og erklærer en hændelse, der løses automatisk |
| Check if … has no exceptions | **Exception Count** **Lig med** `0` | Sætter monitoren online |

## Nye, tilbagevendte og stigende undtagelser

Ud over hvor mange undtagelser der skete, kan en undtagelse-monitor advare ved det, en fejlsporer starter med. Hver læses kun, når et kriterium tjekker den.

| Filtertype | Hvad den tæller i vinduet |
| --- | --- |
| **New Exceptions** | Matchende undtagelser, der ses for første gang og hverken er løst eller arkiveret. |
| **Regressed Exceptions** | Matchende undtagelser, du har løst, som kom tilbage og stadig er åbne. |
| **Exception Increase (in %)** | Hvor langt antallet af matchende undtagelser ligger over det sædvanlige: dagen før vinduet, pr. vindue af samme længde, mindst én. Ti undtagelser efter en rolig dag giver 900 %. |

Nye og tilbagevendte undtagelser filtreres efter tjeneste, undtagelsestype, miljø og meddelelse og også efter infrastrukturentitet: en undtagelse tæller med, når en af dens forekomster i vinduet kom fra en af de valgte entiteter.

## Gennemgået eksempel: kun produktionsundtagelser

Du vil have en hændelse, hver gang API'et kaster en undtagelse i produktion, og intet for staging. Du vælger **Enhver undtagelse**, sætter **Environments** til `production`, beholder **Tidsvindue** på **Seneste 5 minutter** og vælger **Erklær en hændelse** under **Hvad der sker**. De seneste fem minutter:

| Undtagelser | Miljø | Tilstand | Tælles? |
| --- | --- | --- | --- |
| `TypeError` × 3 | `production` | Aktiv | Ja: 3 |
| `TypeError` × 40 | `staging` | Aktiv | Nej: et andet miljø |
| `TimeoutError` × 2 | intet | Aktiv | Nej: intet miljø |
| `NullReferenceException` × 4 | `production` | Løst, efter at de opstod | Nej: løst |

**Exception Count** er 3, så **Mere end** `0` matcher: monitoren går offline, og der erklæres en hændelse. Når der er gået fem minutter uden nogen aktiv produktionsundtagelse, holder reglen op med at matche, monitoren går tilbage til sin standardstatus, og hændelsen løser sig selv.

## Fejlfinding

:::details Undtagelser vises i explorer, men monitoren tæller 0
Sammenlign værdien i **Environments** med explorerens filter `env:`: sammenligningen er præcis og skelner mellem store og små bogstaver, og undtagelser uden miljø udelades, når filteret er angivet. Tjek derefter, om de undtagelser er løst eller arkiveret. Åbn monitorens side **Kriterier** (under **Konfiguration**), og klik på **Edit Monitoring Criteria**: **Matchende undtagelser** viser, hvad filtrene matcher.
:::

:::details Hændelsen blev løst, da jeg løste undtagelsen
Det er forventet. Løste undtagelser tælles ikke, så antallet faldt, og kriteriet holdt op med at matche. Hvis undtagelsen opstår igen, bliver den uløst og tælles igen. Slå **Inkluder løste undtagelser** til for at tælle dem alligevel.
:::

:::details Et filter på undtagelsestype matcher intet
**Undtagelsestyper** sammenlignes præcist med det typenavn, undtagelsen blev rapporteret med, såsom `TypeError`. Kopiér typen fra undtagelses-explorer.
:::

## Næste skridt

:::cards
- [Trace-monitor](/docs/monitor/traces-monitor): Få advarsler om mislykkede spans og endpoints.
- [Log-monitor](/docs/monitor/logs-monitor): Få advarsler om logmængde og -indhold.
- [Hændelse- og advarselsskabeloner](/docs/monitor/incident-alert-templating): Skriv nyttige titler og beskrivelser til advarsler.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Send undtagelser til OneUptime.
:::
