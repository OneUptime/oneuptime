# Trase-overvåking

En trasemonitor teller innenfor et tidsvindu spans tjenestene dine sender til OneUptime som samsvarer med filtrene dine (span-navn, status, tjeneste, attributter). Når antallet oppfyller kriteriene dine, endrer den monitorens status, oppretter et varsel eller erklærer en hendelse. Bruk den til å bli varslet om mislykkede forespørsler til et endepunkt, en økning i feil-spans eller en tjeneste som har sluttet å sende traser.

:::cards
- [Opprett monitoren](#opprett-en-trasemonitor): Velg hvilke spans som telles, og når du skal varsles.
- [Span-statuskoder](#span-statuskoder): Hva OK, ERROR og UNSET betyr, og hva du bør filtrere på.
- [Slik evalueres den](#slik-evalueres-den): Tidsvinduet, tellingen og syklusen på ett minutt.
- [Kriterier](#kriterier): Terskler, avviksdeteksjon og standardverdiene.
:::

## Slik fungerer det

```mermaid title="Hvert minutt teller og sjekker en trasemonitor"
flowchart TB
    App["Tjenestene dine"] -->|OpenTelemetry| Store[("Spans i OneUptime")]
    Store --> Count["Tell samsvarende spans<br/>i tidsvinduet"]
    Count --> Check{"Kriterier oppfylt?"}
    Check -->|"Første treff"| Act["Endre status,<br/>varsel eller hendelse"]
    Check -->|Ingen| Default["Standardstatus"]
```

Hvert minutt teller OneUptime spans som samsvarer med monitorens filtre og startet innenfor tidsvinduet. Antallet sammenlignes med monitorens kriterier fra topp til bunn, og det første kriteriet som samsvarer, avgjør hva som skjer. Når ingen samsvarer, går monitoren tilbake til standardstatusen sin.

## Før du starter

- Tjenestene dine sender traser til OneUptime via OpenTelemetry. Se [OpenTelemetry](/docs/telemetry/open-telemetry).
- Slå opp det nøyaktige navnet på spannet du vil overvåke, i trase-utforskeren: span-navn bestemmes av instrumenteringen din, for eksempel `POST /api/checkout` eller `GET`.

## Opprett en trasemonitor

:::steps
### Start en ny monitor

Gå til **Monitorer**, og klikk på **Opprett monitor**. Eller filtrer i trase-utforskeren spans du vil ha beskjed om, og klikk på **Opprett monitor** i verktøylinjen: den nye monitoren følger fra start med på utforskerens tjenester, statuser, span-navn og attributter.

### Velg Traces

Under **Monitortype** klikker du på **Flere monitortyper** og velger **Spor** under **Telemetri**, eller du skriver `traces` i søkefeltet. Skriv inn et **Navn**, og klikk deretter på **Neste**.

### Velg hva monitoren skal fortelle deg om

Under **Hva skal denne overvåkingen fortelle deg om?** velger du **For mange mislykkede forespørsler** eller **Forespørsler uteblir**. Hvert valg fyller ut spans du skal følge med på og regelen, som du kan endre lenger ned. Velg **Noe annet** for å sette dem opp selv.

### Velg spans som skal telles

I **Spans å følge med på** angir du **Span-status** og **Span-navnet inneholder**. Et filter du lar stå tomt, samsvarer med alle spans. **Samsvarende spans** under filtrene viser spans de samsvarer med akkurat nå.

### Snevre dem inn (valgfritt)

Åpne **Flere felt** for å filtrere etter telemetritjeneste, infrastrukturentitet eller attributt.

### Si når det skal varsles

I **Når det skal varsles** velger du en **Betingelse**, **Antall spans** og et **Tidsvindu**. Setningen under dem gjentar regelen med vanlige ord. Diagrammet under den teller de samsvarende spans i hvert vindu de siste timene, tegner regelens tall som en linje og forteller hvor ofte regelen ville ha varslet. Knappen der foreslår et tall som regelen ikke ville ha passert i den perioden.

### Velg hva som skjer

I **Hva som skjer** velger du **Opprett et varsel**, **Erklær en hendelse** eller **Begge**, og gir det en tittel og en alvorlighetsgrad. Mens regelen samsvarer, viser monitoren statusen under **Flere felt**; når den slutter å samsvare, går monitoren tilbake til standardstatusen sin, og varselet eller hendelsen løser seg selv.

### Opprett monitoren

Klikk på **Opprett monitor**. Monitoren åpnes på siden **Oversikt**, og den første evalueringen kjøres innen ett minutt.
:::

> [!TIP]
> For å få beskjed når en AI-funksjon svarer dårlig (mislykkede, avviste, avkortede, tomme, flaggede eller trege svar), velger du i stedet **AI / LLM** under **Telemetri**. Den monitoren leser AI-kallene i trasene dine for deg, uten span-filtre du må skrive. Se [AI- / LLM-observerbarhet](/docs/telemetry/ai-llm-observability#få-beskjed-når-ai-en-svarer-dårlig).

## Hva den spør etter

| Felt | Hva det samsvarer med | Standard |
| --- | --- | --- |
| **Span-status** | Spans med en av de valgte statusene: **Ikke angitt**, **OK** eller **Feil**. | Tom: alle statuser |
| **Span-navnet inneholder** | Spans der navnet inneholder denne teksten, uten forskjell på store og små bokstaver. | Tom: alle spans |
| **Tidsvindu** (i **Når det skal varsles**) | Spans som startet de siste 5 sekundene opp til de siste 24 timene. | **Siste 5 minutter** |
| **Filtrer etter telemetritjeneste** (under **Flere felt**) | Spans fra en av de valgte tjenestene. | Tom: alle tjenester |
| **Filtrer etter infrastrukturenhet** (under **Flere felt**) | Spans fra en av de valgte vertene, podene, containerne og andre entitetene. | Tom: alle entiteter |
| **Filtrer etter attributter** (under **Flere felt**) | Spans der attributtene oppfyller alle vilkår. Hvert vilkår har sin egen operator, som «er lik» eller «inneholder». | Tom: ingen vilkår |

Alle filtrene du angir, må samsvare for at et span skal telles.

### Span-statuskoder

- **OK** – Operasjonen ble eksplisitt merket som vellykket av applikasjonskode eller en sporings-pipeline
- **ERROR** – Operasjonen støtte på en feil
- **UNSET** – Ingen feilstatus ble angitt. Dette er standardstatusen i OpenTelemetry

UNSET betyr ikke at data mangler. OpenTelemetry-instrumentering setter ERROR når en operasjon feiler, og lar vellykkede spans stå som UNSET, så på en sunn tjeneste er de fleste spans UNSET. OneUptime viser dem i grønt som «Unset (no error)». Å registrere et unntak endrer ikke statusen til et span, så et UNSET-span kan fortsatt ha unntak; de vises sammen med spannet. Filtrer på ERROR for å varsle ved feil. Velg både OK og UNSET for å telle alle spans som ikke feilet.

Hvis du vil at vellykkede forespørsler skal vises som OK, legger du til en sporings-pipeline under **Spor > Innstillinger > Pipelines** med filtervilkåret **Status = Ikke angitt** og en **Status-omkartlegger** som tilordner `http.response.status_code`-verdier, for eksempel `200`, til OK.

## Slik evalueres den

- **Hvert minutt.** En trasemonitor sjekkes ikke av sonder, så den har ikke noe intervall å angi og ingen side **Sonder og intervall**.
- **Ett tall per evaluering.** Monitoren teller spans som samsvarer med alle filtre og startet innenfor **Tidsvindu** før evalueringen. Med **Siste 5 minutter** ser hver evaluering fem minutter tilbake, så vinduene for evalueringer som følger etter hverandre, overlapper.
- **Ingen spans er et antall på 0.** En tjeneste som slutter å sende traser, gir 0, og det er det **Forespørsler uteblir** ser etter.
- **OneUptimes eget nedetid er ikke stillhet.** Så lenge tidsvinduet inneholder tid da OneUptime selv ikke mottok data (det startet på nytt, ble oppgradert eller tok igjen et etterslep), venter sjekken: statusen endres ikke, og ingen hendelse eller varsel åpnes eller løses. Se [Når OneUptime ikke mottar data](/docs/monitor/when-oneuptime-is-not-receiving).
- **Kriterier fra topp til bunn.** Det første kriteriet som samsvarer, avgjør, så legg det mest alvorlige øverst.

Hver statusendring registreres med årsaken på monitorens **Statustidslinje**.

## Kriterier

Kriteriene til en trasemonitor har én **Filtertype**: **Span Count**, antallet spans som samsvarte i vinduet. **Når det skal varsles** setter opp ett kriterium, der **Betingelse** er **Mer enn**, **Minst**, **Færre enn**, **Høyst**, **Nøyaktig**, **Uvanlig høy**, **Uvanlig lav** eller **Uvanlig høy eller lav**. For flere kriterier, eller ett med mer enn ett filter, klikker du på **Rediger som egne kriterier** under **Flere felt** i **Hva som skjer**: hvert kriterium der har et **Filtervilkår** og, for et tersklevilkår, en **Verdi**.

| Filtervilkår | Samsvarer når antallet spans er… |
| --- | --- |
| **Større enn** | over verdien |
| **Større enn eller lik** | lik verdien eller høyere |
| **Mindre enn** | under verdien |
| **Mindre enn eller lik** | lik verdien eller lavere |
| **Lik** | nøyaktig verdien |
| **Anomalously High** | over det forventede området for denne timen i uken |
| **Anomalously Low** | under det området |
| **Anomalous** | utenfor det området, i hvilken som helst retning |

Avviksvilkårene har ingen **Verdi**. Velg en **Følsomhet** (Lav, Middels, som er standard, eller Høy) og, i de egne kriteriene, et **Grunnlinjevindu** på 14 (standard), 28, 60 eller 90 dager. OneUptime gjør antallet om til en rate per minutt og sammenligner den med samme time i uken over det vinduet. Grunnlinjen dekker bare monitorens tjenester og span-statuser: filtrene på span-navn og attributter inngår ikke. Inntil den timen i uken har nok historikk, lærer kriteriet fortsatt og utløses ikke.

En trasemonitor som er opprettet i Opprett monitor, starter med regelen for det du valgte under **Hva skal denne overvåkingen fortelle deg om?**:

| Valg | Regel | Hva som skjer |
| --- | --- | --- |
| **For mange mislykkede forespørsler** | **Span-status** **Feil**, **Mer enn** `10` i **Siste 5 minutter** | Oppretter et varsel, som løser seg selv |
| **Forespørsler uteblir** | **Nøyaktig** `0` i **Siste 10 minutter** | Erklærer en hendelse, som løser seg selv |

En trasemonitor som er opprettet via API-et eller Terraform uten kriterier, starter med disse kriteriene:

| Kriterium | Filter | Virkning |
| --- | --- | --- |
| Check if … is offline | **Span Count** **Lik** `0` | Setter monitoren som frakoblet og erklærer en hendelse som løses automatisk |
| Check if … is online | **Span Count** **Større enn** `0` | Setter monitoren som tilkoblet |

## Gjennomgått eksempel: mislykkede checkout-forespørsler

På fem minutter registrerer checkout-tjenesten 1 200 spans med navnet `POST /api/checkout`: 1 150 UNSET, 20 OK og 30 ERROR. Den samme monitoren teller svært ulike tall avhengig av **Span-status**:

| Span-status | Span Count | Hva det måler |
| --- | --- | --- |
| **Feil** | 30 | Forespørsler som mislyktes |
| **OK** | 20 | Bare forespørslene koden din merket som vellykkede |
| **Ikke angitt** og **OK** | 1 170 | Alle forespørsler som ikke mislyktes |
| Tom | 1 200 | Alle forespørsler |

For å bli tilkalt når mer enn 10 checkout-forespørsler mislykkes på fem minutter:

- **Span-navnet inneholder**: `POST /api/checkout`
- **Tidsvindu**: **Siste 5 minutter**
- **Span-status**: **Feil**
- **Når det skal varsles**: **Mer enn** `10`
- **Hva som skjer**: **Erklær en hendelse**

Med 30 mislykkede forespørsler samsvarer regelen, og hendelsen erklæres. Når det har gått fem minutter med 10 eller færre feil, slutter regelen å samsvare, monitoren er tilkoblet igjen, og hendelsen løser seg selv.

## Feilsøking

:::details Monitoren teller ingen spans for endepunktet mitt
**Span-navnet inneholder** sammenlignes med spannets navn, og instrumentering navngir ofte server-spans etter ruten (`POST /api/checkout`) eller bare etter metoden (`GET`). Finn det nøyaktige navnet i trase-utforskeren. Åpne deretter monitorens side **Kriterier** (under **Konfigurasjon**), og klikk på **Edit Monitoring Criteria**: **Samsvarende spans** viser hva filtrene samsvarer med akkurat nå.
:::

:::details Vellykkede forespørsler telles ikke når jeg filtrerer på OK
De fleste instrumenteringer lar vellykkede spans stå som UNSET, ikke OK (se [Span-statuskoder](#span-statuskoder)). Velg både **Ikke angitt** og **OK**, eller legg til sporings-pipelinen som er beskrevet der.
:::

:::details Et span har et unntak, men telles ikke som feil
Å registrere et unntak endrer ikke statusen til et span. Filtrer på **Feil**, eller bruk en [unntaksmonitor](/docs/monitor/exceptions-monitor) for å bli varslet om selve unntakene.
:::

:::details Et avvikskriterium utløses aldri
Det lærer fortsatt: timen i uken det sammenligner med, har ikke nok historikk ennå innenfor **Grunnlinjevindu**.
:::

## Neste steg

:::cards
- [Unntak-overvåking](/docs/monitor/exceptions-monitor): Bli varslet om unntakene tjenestene dine registrerer.
- [Logg-overvåking](/docs/monitor/logs-monitor): Bli varslet om loggmengde og -innhold.
- [Søkesyntaks](/docs/telemetry/search-syntax): Finn span-navn og -statuser i trase-utforskeren.
- [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating): Skriv nyttige titler og beskrivelser for varsler.
:::
