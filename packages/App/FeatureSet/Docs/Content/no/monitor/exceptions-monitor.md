# Unntak-overvåking

En unntaksmonitor teller innenfor et tidsvindu unntakene tjenestene dine rapporterer til OneUptime som samsvarer med filtrene dine (melding, unntakstype, miljø, tjeneste). Når antallet oppfyller kriteriene dine, endrer den monitorens status, oppretter et varsel eller erklærer en hendelse. Bruk den til å bli varslet om hvert nytt krasj i produksjon, om én unntakstype eller om en plutselig økning i feil.

:::cards
- [Opprett monitoren](#opprett-en-unntaksmonitor): Velg hvilke unntak som telles, og når du skal varsles.
- [Miljøer](#miljøer): Begrens monitoren til `production`.
- [Slik evalueres den](#slik-evalueres-den): Hva som telles, og hva det gjør å løse et unntak.
- [Kriterier](#kriterier): Vilkårene og standardverdiene.
:::

## Slik fungerer det

```mermaid title="Hvert minutt teller og sjekker en unntaksmonitor"
flowchart TB
    App["Tjenestene dine"] -->|OpenTelemetry| Store[("Unntak i OneUptime")]
    Store --> Skip["Utelat løste og<br/>arkiverte unntak"]
    Skip --> Count["Tell samsvarende unntak<br/>i tidsvinduet"]
    Count --> Check{"Kriterier oppfylt?"}
    Check -->|"Første treff"| Act["Endre status,<br/>varsel eller hendelse"]
    Check -->|Ingen| Default["Standardstatus"]
```

Hvert minutt teller OneUptime unntakene som samsvarer med monitorens filtre og oppsto innenfor tidsvinduet, og utelater unntak du har merket som løst eller arkivert. Antallet sammenlignes med monitorens kriterier fra topp til bunn, og det første kriteriet som samsvarer, avgjør hva som skjer. Når ingen samsvarer, går monitoren tilbake til standardstatusen sin.

## Før du starter

- Tjenestene dine sender unntak til OneUptime via OpenTelemetry. Se [OpenTelemetry](/docs/telemetry/open-telemetry).
- For å begrense en monitor til et miljø må tjenestene dine angi ressursattributtet `deployment.environment`.

## Opprett en unntaksmonitor

:::steps
### Start en ny monitor

Gå til **Monitorer**, og klikk på **Opprett monitor**. Eller klikk på **Opprett monitor** ved siden av **Løs** på siden til et unntak: den nye monitoren følger fra start med på typen til det unntaket i tjenesten, og varsler når det skjer igjen.

### Velg Exceptions

Under **Monitortype** klikker du på **Flere monitortyper** og velger **Unntak** under **Telemetri**, eller du skriver `exceptions` i søkefeltet. Skriv inn et **Navn**, og klikk deretter på **Neste**.

### Velg hva monitoren skal fortelle deg om

Under **Hva skal denne overvåkingen fortelle deg om?** velger du **Hvilket som helst unntak** eller **For mange unntak**. Hvert valg fyller ut regelen, som du kan endre lenger ned. Velg **Noe annet** for å sette den opp selv. **Et nytt unntak**, **Et løst unntak kommer tilbake** og **Unntakene topper seg** varsler ved et unntak som ses for første gang, ved et som kom tilbake etter at du løste det, og ved en økning langt over det som er normalt for den timen i uken.

### Velg unntakene som skal telles

I **Unntak å følge med på** angir du **Meldingen inneholder**, **Unntakstyper** og **Miljøer**. Et filter du lar stå tomt, samsvarer med alle unntak. **Samsvarende unntak** under filtrene viser unntakene de samsvarer med akkurat nå.

### Snevre dem inn (valgfritt)

Åpne **Flere felt** for å filtrere etter telemetritjeneste eller infrastrukturentitet, eller for også å telle løste og arkiverte unntak.

### Si når det skal varsles

I **Når det skal varsles** velger du en **Betingelse**, **Antall unntak** og et **Tidsvindu**. Setningen under dem gjentar regelen med vanlige ord. Diagrammet under den teller de samsvarende unntakene i hvert vindu de siste timene, tegner regelens tall som en linje og forteller hvor ofte regelen ville ha varslet. Knappen der foreslår et tall som regelen ikke ville ha passert i den perioden. **Varsle ved** velger hva regelen sammenligner: **Unntak**, **Nye unntak**, **Unntak som kom tilbake** eller **En økning over det vanlige**. Diagrammet tegnes bare for **Unntak**. Med **Uvanlig høy**, som **Unntakene topper seg** setter opp, er det ikke noe tall å skrive inn: Velg heller en **Følsomhet**.

### Velg hva som skjer

I **Hva som skjer** velger du **Opprett et varsel**, **Erklær en hendelse** eller **Begge**, og gir det en tittel og en alvorlighetsgrad. Mens regelen samsvarer, viser monitoren statusen under **Flere felt**; når den slutter å samsvare, går monitoren tilbake til standardstatusen sin, og varselet eller hendelsen løser seg selv.

### Opprett monitoren

Klikk på **Opprett monitor**. Monitoren åpnes på siden **Oversikt**, og den første evalueringen kjøres innen ett minutt.
:::

## Hva den spør etter

| Felt | Hva det samsvarer med | Standard |
| --- | --- | --- |
| **Meldingen inneholder** | Unntak der meldingen inneholder denne teksten, uten forskjell på store og små bokstaver. | Tom: alle unntak |
| **Unntakstyper** | Unntak av en av disse typene, atskilt med komma, som `TypeError, NullReferenceException`. Typenavnet må samsvare nøyaktig. | Tom: alle typer |
| **Miljøer** | Unntak fra et av disse miljøene, atskilt med komma (se [Miljøer](#miljøer)). | Tom: alle miljøer |
| **Tidsvindu** (i **Når det skal varsles**) | Unntak fra de siste 5 sekundene opp til de siste 24 timene. | **Siste 5 minutter** |
| **Filtrer etter tjeneste** (under **Flere felt**) | Unntak fra en av de valgte tjenestene. | Tom: alle tjenester |
| **Filtrer etter infrastrukturenhet** (under **Flere felt**) | Unntak fra en av de valgte vertene, podene, containerne og andre entitetene. | Tom: alle entiteter |
| **Inkluder løste unntak** (under **Flere felt**) | Tell også unntak som er merket som løst. | Av |
| **Inkluder arkiverte unntak** (under **Flere felt**) | Tell også arkiverte unntak. | Av |

Alle filtrene du angir, må samsvare for at et unntak skal telles.

### Miljøer

Miljøer kommer fra OpenTelemetry-ressursattributtet `deployment.environment` på hvert unntak, den samme verdien som unntaksutforskeren filtrerer på med `env:production`. Skriv inn ett miljø, eller flere atskilt med komma; et unntak telles når miljøet samsvarer med ett av dem.

Sammenligningen er nøyaktig og skiller mellom store og små bokstaver: `production` samsvarer ikke med `Production` eller `prod`. Unntak uten miljø telles ikke når dette filteret er angitt. La det stå tomt for å telle unntak fra alle miljøer, også dem uten miljø.

Miljøfilteret kombineres med alle andre filtre, så en monitor som er begrenset til én telemetritjeneste og `production`, teller bare den tjenestens produksjonsunntak.

Når du oppretter monitoren via API-et, setter du `environments` på trinnets `exceptionMonitor` til en liste over miljønavn:

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

## Slik evalueres den

- **Hvert minutt.** En unntaksmonitor sjekkes ikke av sonder, så den har ikke noe intervall å angi og ingen side **Sonder og intervall**.
- **Forekomster, ikke unntakstyper.** Monitoren teller hver gang et samsvarende unntak oppsto innenfor **Tidsvindu**. Ett unntak som kastes 40 ganger, teller 40.
- **Løste og arkiverte unntak utelates.** Med mindre du slår på **Inkluder løste unntak** eller **Inkluder arkiverte unntak**, teller ikke forekomstene av et unntak du har merket som løst eller arkivert. Å merke et unntak som løst kan derfor lukke hendelsen det åpnet. Når et løst unntak oppstår igjen, blir det automatisk uløst og telles på nytt.
- **Ingen unntak er et antall på 0.**
- **OneUptimes eget nedetid er ikke stillhet.** Så lenge tidsvinduet inneholder tid da OneUptime selv ikke mottok data (det startet på nytt, ble oppgradert eller tok igjen et etterslep), venter sjekken: statusen endres ikke, og ingen hendelse eller varsel åpnes eller løses. Se [Når OneUptime ikke mottar data](/docs/monitor/when-oneuptime-is-not-receiving).
- **Kriterier fra topp til bunn.** Det første kriteriet som samsvarer, avgjør, så legg det mest alvorlige øverst.

Hver statusendring registreres med årsaken på monitorens **Statustidslinje**.

## Kriterier

Kriteriene til en unntaksmonitor har fire slags **Filtertype**: **Antall unntak**, antallet unntak som samsvarte i vinduet, og **Nye unntak**, **Unntak med regresjon** og **Økning i unntak (i %)**, som beskrives nedenfor. **Når det skal varsles** setter opp ett kriterium, der **Betingelse** er **Mer enn**, **Minst**, **Færre enn**, **Høyst**, **Nøyaktig**, **Uvanlig høy**, **Uvanlig lav** eller **Uvanlig høy eller lav**. For flere kriterier, eller ett med mer enn ett filter, klikker du på **Rediger som egne kriterier** under **Flere felt** i **Hva som skjer**: hvert kriterium der har et **Filtervilkår** og en **Verdi**.

| Filtervilkår | Samsvarer når antallet unntak er… |
| --- | --- |
| **Større enn** | over verdien |
| **Større enn eller lik** | lik verdien eller høyere |
| **Mindre enn** | under verdien |
| **Mindre enn eller lik** | lik verdien eller lavere |
| **Lik** | nøyaktig verdien |
| **Ikke lik** | alt annet enn verdien |
| **Unormalt høy** | over det forventede området for denne timen i uken |
| **Unormalt lav** | under det området |
| **Avvikende** | utenfor det området, i hvilken som helst retning |

Avviksvilkårene har ingen **Verdi**. Velg en **Følsomhet** (Lav, Middels, som er standard, eller Høy) og, i de egne kriteriene, et **Grunnlinjevindu** på 14 (standard), 28, 60 eller 90 dager. Bare **Antall unntak** har dem: se [Topper sammenlignet med det normale](#topper-sammenlignet-med-det-normale).

En unntaksmonitor som er opprettet i Opprett monitor, starter med regelen for det du valgte under **Hva skal denne overvåkingen fortelle deg om?**:

| Valg | Regel | Hva som skjer |
| --- | --- | --- |
| **Hvilket som helst unntak** | **Mer enn** `0` i **Siste 5 minutter** | Oppretter et varsel, som løser seg selv |
| **For mange unntak** | **Mer enn** `20` i **Siste 5 minutter** | Oppretter et varsel, som løser seg selv |
| **Et nytt unntak** | **Nye unntak**: **Mer enn** `0` i **Siste 10 minutter** | Oppretter et varsel, som løser seg selv |
| **Et løst unntak kommer tilbake** | **Unntak som kom tilbake**: **Mer enn** `0` i **Siste 10 minutter** | Oppretter et varsel, som løser seg selv |
| **Unntakene topper seg** | **Uvanlig høy** i **Siste 15 minutter** | Oppretter et varsel, som løser seg selv |

En unntaksmonitor som er opprettet via API-et eller Terraform uten kriterier, starter med disse kriteriene:

| Kriterium | Filter | Virkning |
| --- | --- | --- |
| Check if … has exceptions | **Antall unntak** **Større enn** `0` | Setter monitoren som frakoblet og erklærer en hendelse som løses automatisk |
| Check if … has no exceptions | **Antall unntak** **Lik** `0` | Setter monitoren som tilkoblet |

## Nye, tilbakevendte og stigende unntak

I tillegg til hvor mange unntak som skjedde, kan en unntaksmonitor varsle ved det en feilsporer begynner med. Hvert leses bare når et kriterium sjekker det.

| Filtertype | Hva den teller i vinduet |
| --- | --- |
| **Nye unntak** | Samsvarende unntak som ses for første gang og verken er løst eller arkivert. |
| **Unntak med regresjon** | Samsvarende unntak du har løst, som kom tilbake og fortsatt er åpne. |
| **Økning i unntak (i %)** | Hvor langt antallet samsvarende unntak ligger over det vanlige: dagen før vinduet, per vindu av samme lengde, minst ett. Ti unntak etter en rolig dag gir 900 %. |

Nye og tilbakevendte unntak filtreres etter tjeneste, unntakstype, miljø og melding, og også etter infrastrukturenhet: et unntak telles når en av forekomstene i vinduet kom fra en av de valgte enhetene.

## Topper sammenlignet med det normale

**Unntakene topper seg** sammenligner vinduet med de samme timene i ukene før, ikke med et fast tall. En topp mandag morgen er normal på en mandag morgen, det samme antallet klokken 3 på en søndag er det ikke, og en langsom økning over flere dager vises så snart den forlater forrige ukes område.

| Innstilling | Hva den gjør | Standard |
| --- | --- | --- |
| **Følsomhet** | Hvor langt utenfor det vanlige området et vindu må være: 4 standardavvik ved Lav, 3 ved Middels, 2 ved Høy. | Middels |
| **Grunnlinjevindu** (under **Flere felt**) | Hvor mye historikk det læres av: 14, 28, 60 eller 90 dager. | 14 dager |
| **Standardavvik** (under **Flere felt**) | Ditt eget tall i stedet for det **Følsomhet** setter. | Tomt |
| **Minste antall unntak** (under **Flere felt**) | Det minste antallet unntak i et vindu som kan varsle: 20 ved Lav, 10 ved Middels, 5 ved Høy. | Tomt |

- **Den bruker filtrene dine.** Historikken leses med monitorens egne filtre, så en monitor på én unntakstype sammenlignes med historikken til den typen, og løste og arkiverte unntak holdes utenfor begge.
- **Stille tid teller.** Et vindu uten unntak er en del av det normale, så området til en stille tjeneste forblir lite. De første få unntakene varsler ikke, på grunn av **Minste antall unntak**, og et ekte utbrudd gjør det.
- **En ny tjeneste venter.** Til en tjeneste har to uker med historikk, lærer kriteriet fortsatt og utløses ikke, uansett hvor mange unntak den kaster. Historikken går bare så langt tilbake som OneUptime tar vare på unntak: 15 dager med mindre du har endret det, og en tjeneste som tas vare på i under to uker, har aldri nok.
- **Varselet sier hvorfor.** Det nevner det forventede området og hvor langt utenfor vinduet var. Hver sjekk skriver det samme på **Statustidslinje**, eller at den fortsatt lærer.

## Gjennomgått eksempel: bare produksjonsunntak

Du vil ha en hendelse hver gang API-et kaster et unntak i produksjon, og ingenting for staging. Du velger **Hvilket som helst unntak**, setter **Miljøer** til `production`, beholder **Tidsvindu** på **Siste 5 minutter** og velger **Erklær en hendelse** under **Hva som skjer**. De siste fem minuttene:

| Unntak | Miljø | Tilstand | Telles? |
| --- | --- | --- | --- |
| `TypeError` × 3 | `production` | Aktivt | Ja: 3 |
| `TypeError` × 40 | `staging` | Aktivt | Nei: et annet miljø |
| `TimeoutError` × 2 | ingen | Aktivt | Nei: intet miljø |
| `NullReferenceException` × 4 | `production` | Løst etter at de oppsto | Nei: løst |

**Antall unntak** er 3, så **Mer enn** `0` samsvarer: monitoren blir frakoblet, og en hendelse erklæres. Når det har gått fem minutter uten noe aktivt produksjonsunntak, slutter regelen å samsvare, monitoren går tilbake til standardstatusen sin, og hendelsen løser seg selv.

## Feilsøking

:::details Unntak vises i utforskeren, men monitoren teller 0
Sammenlign verdien i **Miljøer** med utforskerens filter `env:`: sammenligningen er nøyaktig og skiller mellom store og små bokstaver, og unntak uten miljø utelates når filteret er angitt. Sjekk deretter om unntakene er løst eller arkivert. Åpne monitorens side **Kriterier** (under **Konfigurasjon**), og klikk på **Rediger kriterier**: **Samsvarende unntak** viser hva filtrene samsvarer med.
:::

:::details Hendelsen ble løst da jeg løste unntaket
Det er forventet. Løste unntak telles ikke, så antallet falt, og kriteriet sluttet å samsvare. Hvis unntaket oppstår igjen, blir det uløst og telles på nytt. Slå på **Inkluder løste unntak** for å telle dem uansett.
:::

:::details Et filter på unntakstype samsvarer ikke med noe
**Unntakstyper** sammenlignes nøyaktig med typenavnet unntaket ble rapportert med, som `TypeError`. Kopier typen fra unntaksutforskeren.
:::

:::details En regel for topper i unntak varsler aldri
Se på **Statustidslinje**: Den viser det forventede området, antallet som trengs for å varsle, eller at regelen fortsatt lærer. En tjeneste trenger to uker med historikk, så en oppbevaring på under to uker gjør at den fortsetter å lære. Hvis antallet holder seg under **Minste antall unntak**, senk det under **Flere felt**, eller velg en høyere **Følsomhet**.
:::

## Neste steg

:::cards
- [Trase-overvåking](/docs/monitor/traces-monitor): Bli varslet om mislykkede spans og endepunkter.
- [Logg-overvåking](/docs/monitor/logs-monitor): Bli varslet om loggmengde og -innhold.
- [Hendelse- og varslingsmaler](/docs/monitor/incident-alert-templating): Skriv nyttige titler og beskrivelser for varsler.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Send unntak til OneUptime.
:::
