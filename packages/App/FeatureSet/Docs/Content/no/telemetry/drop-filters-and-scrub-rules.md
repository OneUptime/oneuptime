# Drop-filtre og scrub-regler

Drop-filtre og scrub-regler virker på loggene og spansene dine mens de kommer inn, før noe blir lagret. Et drop-filter kaster postene du aldri trenger, eller beholder bare et utvalg av dem. En scrub-regel maskerer personopplysninger og hemmeligheter, som e-postadresser, kortnumre og passord, slik at de aldri når lagringen din.

:::cards
- [Hvor de kjører](#hvor-de-kjører): Før pipelines, før lagring.
- [Forkast poster eller ta utvalg](#forkast-poster-eller-ta-utvalg): Velg poster, og forkast dem eller behold en andel.
- [Rens sensitive data](#rens-sensitive-data): Sladd, masker eller hash det et mønster finner.
- [Se hva et filter forkastet](#se-hva-et-filter-forkastet): Tellere på hvert filter.
:::

## Hvor de kjører

Logger har sine under **Logger → Innstillinger**, og spans under **Spor → Innstillinger**. Når en post kommer inn, kjører OneUptime dem i denne rekkefølgen:

```mermaid title="Hva som skjer med en loggpost eller et span når den kommer inn"
flowchart TB
    arrive["En loggpost eller<br/>et span kommer inn"] --> drop{"Forkaster et<br/>drop-filter den?"}
    drop -->|"Ja"| gone["Forkastet:<br/>aldri lagret"]
    drop -->|"Nei"| scrub["Scrub-regler<br/>maskerer det<br/>de finner"]
    scrub --> pipelines["Pipelines endrer<br/>posten"]
    pipelines --> stored["Lagret, klar<br/>til søk"]
```

- **De virker bare på nye poster.** En regel du oppretter eller endrer, gjelder for poster som kommer inn omtrent ett minutt senere. Poster som allerede er lagret, endres ikke.
- **En forkastet post er borte.** Ingen søk, grafer, overvåkinger eller opptaksregler ser den noen gang, og det lages ikke noe unntak fra den. På OneUptime Cloud blir den heller ikke fakturert.
- **Hver liste kjører i rekkefølge.** Dra radene i en liste for å endre rekkefølgen. Bare aktiverte filtre og regler kjører.

Drop-filtre og scrub-regler for logger gjelder like mye for logger fra OpenTelemetry, Syslog, Fluent Bit og Fluentd. [Loggpipelines](/docs/telemetry/log-pipelines) forklarer trinnet etter dem.

## Før du begynner

- **Logger eller spans som kommer inn.** Se [OpenTelemetry](/docs/telemetry/open-telemetry).
- **En rolle som endrer telemetriinnstillinger.** Project Owner eller Project Admin, eller en egendefinert rolle med tillatelsen for det du endrer, som Create Log Drop Filter eller Create Trace Scrub Rule. Telemetry-rollene kan se filtre og regler, men ikke endre dem.

## Forkast poster eller ta utvalg

:::steps
### Åpne drop-filtre

Gå til **Logger → Innstillinger → Drop-filtre**, eller til **Spor → Innstillinger → Drop-filtre** for spans.

### Velg postene

Klikk på **Opprett Logg Drop Filter**, eller på **Opprett Trase-droppfilter** for spans. Under **Treff** gir du filteret et **Navn**, og deretter bygger du **Filterspørring**: et felt, en operator og en verdi for hver betingelse, og om **Alle betingelser** eller **En av betingelsene** må stemme. Klikk på **Neste**.

### Velg handlingen

Under **Handling** beholder du **Forkast** for å kaste hver post som stemmer, eller velger **Eksempel** og fyller inn **Prøveprosent** som skal beholdes, fra 1 til 99. Opprett deretter filteret.
:::

Filteret begynner å forkaste innen ett minutt. For å lagre det uten å forkaste noe ennå slår du av **Aktivert** under **Avansert** før du oppretter det.

> [!WARNING]
> En forkastet post kan ikke hentes tilbake. Hold spørringen til et filter smal, og følg med på **Dropped**-telleren etter at du har opprettet det.

Et filter kan teste disse feltene, og alle attributter med **Custom Attribute...**:

| Poster | Felt |
| --- | --- |
| Logger | **Alvorlighetsgrad**, **Loggtekst**, **Tjeneste-ID** |
| Spans | **Span-navn**, **Span-type**, **Status**, **Statusmelding**, **Tjeneste-ID**, **Har unntak**, **Er rotspenn** |

| Operator | Treffer |
| --- | --- |
| **er lik** | Den eksakte verdien, med store og små bokstaver: `Debug` treffer, `DEBUG` gjør det ikke. |
| **er ikke lik** | Alt unntatt den eksakte verdien. |
| **inneholder** | Verdien hvor som helst i feltet, uavhengig av store og små bokstaver. En `%` i verdien er et jokertegn. |
| **er en av** | Én av en liste med eksakte verdier, skilt med komma. |

**Preview query** viser spørringen betingelsene danner. Denne forkaster debuglinjene fra en helsesjekk:

```text
severityText = 'Debug' AND body LIKE 'healthcheck'
```

Utvalget avgjøres post for post: med en **Prøveprosent** på 10 beholdes omtrent én av ti poster som stemmer. Filtrene kjører i listens rekkefølge, og det første som forkaster en post, avgjør; en post som et utvalg beholder, går videre til neste filter.

## Rens sensitive data

:::steps
### Åpne scrub-regler

Gå til **Logger → Innstillinger → Scrub-regler**, eller til **Spor → Innstillinger → Scrub-regler** for spans.

### Velg hva som skal finnes

Klikk på **Opprett Logg Scrub Regel**, eller på **Opprett Trace Scrub Regel** for spans, og velg en **Mønstertype**. Regelen får navn etter den, for eksempel **Masker e-postadresser**, til du skriver inn et eget navn. For **Egendefinert regex** fyller du også inn **Egendefinert regex-mønster**.

### Velg hvordan det skal renses

Under **Avansert** velger du **Maskeringshandling** og **Felt som skal renses**, eller lar dem stå som de er: en ny regel erstatter hvert treff med `[REDACTED]`, uansett hvor det står i posten. Opprett deretter regelen.
:::

| Mønstertype | Hva den finner |
| --- | --- |
| **E-postadresse** | E-postadresser, som `jane@example.com` |
| **Kredittkortnummer** | Seksten sifre i grupper på fire, som `4111 1111 1111 1111` |
| **SSN (personnummer)** | Amerikanske personnumre (Social Security), som `123-45-6789` |
| **Telefonnummer** | Nordamerikanske telefonnumre, som `555-123-4567` |
| **IP-adresse** | IPv4-adresser, som `192.168.1.1` |
| **Sensitive Attribute Keys** | Hele verdien av alle attributter med en nøkkel som ser hemmelig ut, som `password`, `token`, `api_key`, `authorization` eller `cookie` |
| **Egendefinert regex** | Ditt eget regulære uttrykk, skrevet uten skråstreker eller flagg, og sammenlignet med forskjell på store og små bokstaver |

| Maskeringshandling | Hva et treff blir |
| --- | --- |
| **Sladd** | `[REDACTED]`, standardvalget |
| **Maske** | For det meste skjult: en e-postadresse beholder første bokstav og slutten av domenet, et kort-, telefon- eller personnummer de fire siste sifrene, og et egendefinert treff eller en hemmelig verdi første og siste tegn. En IP-adresse skjules helt. |
| **Hash** | En kort hash av verdien, den samme for den samme verdien hver gang, slik at gjentakelser fortsatt kan telles |

For eksempel lagrer en **E-postadresse**-regel denne loggteksten:

```text
Payment failed for jane@example.com
```

som én av disse, avhengig av **Maskeringshandling**:

```text
Redact: Payment failed for [REDACTED]
Mask:   Payment failed for j***@***.com
Hash:   Payment failed for [HASHED:8c87b489]
```

**Felt som skal renses** er **Begge (brødtekst og attributter)** for en loggregel, med mindre du velger **Kun brødtekst** eller **Kun attributter**, og **Alle (navn, attributter og hendelser)** for en span-regel, med mindre du velger **Bare spennavn**, **Kun attributter** eller **Kun hendelsesattributter**. En **Sensitive Attribute Keys**-regel renser alltid attributtverdier, siden den leser attributtnøkler.

- **Unntak kommer fra den rensede posten.** Et unntak som finnes i en loggpost, lages etter rensingen, og reglene som renser span-hendelser, renser også unntakene som er registrert på dem.
- **Session Replays renses også.** Scrub-regler for logger kjører også over Session Replay-opptak, i tillegg til maskeringen opptakeren gjør i nettleseren.
- **Regler kjører i listens rekkefølge.** Hver regel ser det reglene før den etterlot.
- **Et egendefinert mønster tar tid i forhold til posten.** Det beholder JavaScripts syntaks og svar, lookaheads og lookbehinds medregnet, uansett hvordan det er skrevet. En tilbakereferanse, som `\1`, kan ikke kjøres på den måten: en regel med en slik avvises når du lagrer den, slik et mønster som er for stort til å kjøres også gjør. Hvis det å finne hvert treff ville kreve at en lang verdi ble lest om og om igjen, renser regelen hele verdien.

## Se hva et filter forkastet

Listen **Drop-filtre** viser for hvert filter **Dropped**-telleren og når det sist forkastet noe, **Last Dropped**. **Nothing dropped yet** betyr at det aldri har truffet. Et filters egen side viser det samme under **Aktivitet**, oppdatert innen ett minutt etter en forkasting. Kortet **Filterbetingelser** viser hva det velger, og du kan endre betingelsene der.

## Feilsøking

:::details Et drop-filter forkaster ingenting
**er lik**, **er ikke lik** og **er en av** sammenligner eksakt tekst, inkludert store og små bokstaver. Alvorlighetsgradene heter `Information` og `Warning`, ikke `INFO` eller `WARN`. Kontroller at filteret er aktivert, og vent ett minutt etter en endring.
:::

:::details Logger jeg ventet, mangler
Se på **Dropped**-telleren og tidspunktet for **Last Dropped** for hvert drop-filter. Slå av **Aktivert** på det du mistenker, og de neste loggene kommer inn igjen.
:::

:::details En egendefinert scrub-regel sier Maskerer ingenting
Mønsteret er tomt, ikke et gyldig regulært uttrykk eller kan ikke kjøres, for eksempel fordi det har en tilbakereferanse som `\1`, så den renser ingenting. Rediger regelen, og gi den et mønster som treffer minst ett tegn.
:::

:::details Gamle poster viser fortsatt dataene en ny regel renser
Scrub-regler virker når poster kommer inn. Poster som ble lagret før regelen, beholder det de hadde, til oppbevaringen deres utløper. Se [Dataoppbevaring](/docs/telemetry/data-retention).
:::

## Neste steg

:::cards
- [Loggpipelines](/docs/telemetry/log-pipelines): Tolk og berik loggene du beholder.
- [Loggutforsker](/docs/telemetry/logs-explorer): Søk i det som ble lagret.
- [Sporutforsker](/docs/telemetry/traces-explorer): Følg spansene du beholder.
- [Dataoppbevaring](/docs/telemetry/data-retention): Bestem hvor lenge de oppbevares.
:::
