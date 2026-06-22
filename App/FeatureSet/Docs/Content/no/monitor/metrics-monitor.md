# Metrikk-monitor

Metrikkovervåking lar deg overvåke egendefinerte applikasjons- og infrastrukturmetrikker samlet inn via OpenTelemetry. OneUptime evaluerer metrikkverdier over et tidsvindu og utløser varsler basert på dine konfigurerte kriterier.

## Oversikt

Metrikk-monitorer spør og evaluerer numeriske metrikker fra telemetritjenestene dine. Dette gjør det mulig å:

- Overvåke egendefinerte applikasjonsmetrikker (forespørselsrater, køydybder, feilrater, osv.)
- Spore infrastrukturmetrikker (CPU, minne, disk, nettverk)
- Opprette komplekse metrikk-spørringer med filtre og aggregeringer
- Kombinere flere metrikker ved hjelp av matematiske formler
- Sette opp varsler basert på metrikkterskler

## Opprette en metrikk-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Metrics** som monitortype
4. Konfigurer metrikk-spørringer og valgfrie formler
5. Velg aggregeringsstrategi
6. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### Metrikk-spørringer

Definer én eller flere metrikk-spørringer. Hver spørring inkluderer:

| Felt             | Beskrivelse                                                           | Påkrevd |
| ---------------- | --------------------------------------------------------------------- | ------- |
| Metric Name      | Navnet på metrikken som skal spørres                                  | Ja      |
| Aggregation Type | Hvordan rå metrikkverdier skal aggregeres (sum, avg, min, max, count) | Ja      |
| Attributes       | Nøkkel-verdi-filtre for å begrense metrikk-dataene                    | Nei     |
| Aggregate By     | Dimensjoner det skal grupperes etter                                  | Nei     |

Hver spørring tildeles et alias (f.eks. `a`, `b`, `c`) for bruk i formler.

### Formler

Kombiner flere metrikk-spørringer ved hjelp av matematiske uttrykk. For eksempel:

- `a / b * 100` – Beregn en prosent fra to spørringer
- `a + b` – Summer to metrikker
- `a - b` – Differansen mellom metrikker

### Rullende tidsvindu

Velg tidsvinduet for metrikkevealuering:

- Siste 1 minutt
- Siste 5 minutter
- Siste 10 minutter
- Siste 15 minutter
- Siste 30 minutter
- Siste 60 minutter

### Aggregeringsstrategi

Velg hvordan metrikkverdiene skal aggregeres for evaluering:

| Strategi      | Beskrivelse                             |
| ------------- | --------------------------------------- |
| Average       | Gjennomsnittlig verdi over tidsvinduet  |
| Sum           | Sum av alle verdier                     |
| Maximum Value | Høyeste verdi i tidsvinduet             |
| Minimum Value | Laveste verdi i tidsvinduet             |
| All Values    | Alle verdier må samsvare med kriteriene |
| Any Value     | Minst én verdi må samsvare              |

## Overvåkingskriterier

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse                                                                  |
| ------------ | ---------------------------------------------------------------------------- |
| Metric Value | Den aggregerte verdien av den konfigurerte metrikk-spørringen eller formelen |

### Filtertyper

- **Greater Than** – Metrikkverdien overskrider en terskel
- **Less Than** – Metrikkverdien er under en terskel
- **Greater Than or Equal To** – Metrikkverdien er ved eller over en terskel
- **Less Than or Equal To** – Metrikkverdien er ved eller under en terskel
- **Equal To** – Metrikkverdien samsvarer nøyaktig
- **Not Equal To** – Metrikkverdien samsvarer ikke

### Eksempelkriterier

#### Varsle hvis feilraten overskrider 5 %

- **Spørring a**: `http_requests_total` filtrert etter `status=5xx`
- **Spørring b**: `http_requests_total`
- **Formel**: `a / b * 100`
- **Sjekk på**: Metric Value
- **Filtertype**: Greater Than
- **Verdi**: 5

#### Varsle hvis forespørselskødybden er høy

- **Spørring**: `request_queue_size`, aggregering: Maximum Value
- **Sjekk på**: Metric Value
- **Filtertype**: Greater Than
- **Verdi**: 1000

## Krav til oppsett

Metrikkovervåking krever at applikasjonene dine eller infrastrukturen sender metrikker til OneUptime via OpenTelemetry. Se dokumentasjonen for [OpenTelemetry](/docs/telemetry/open-telemetry) for instruksjoner om oppsett.
