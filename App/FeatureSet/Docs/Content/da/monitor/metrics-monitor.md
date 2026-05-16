# Metrikkermonitor

Metrisk overvågning giver dig mulighed for at overvåge brugerdefinerede applikations- og infrastrukturmetrikker indsamlet via OpenTelemetry. OneUptime evaluerer metriske værdier over et tidsvindue og udløser advarsler baseret på dine konfigurerede kriterier.

## Oversigt

Metrisk monitorer forespørger og evaluerer numeriske metrikker fra dine telemetritjenester. Dette giver dig mulighed for at:

- Overvåge brugerdefinerede applikationsmetrikker (anmodningshastigheder, køstørrelser, fejlrater osv.)
- Spore infrastrukturmetrikker (CPU, hukommelse, disk, netværk)
- Oprette komplekse metriske forespørgsler med filtre og aggregeringer
- Kombinere flere metrikker ved hjælp af matematiske formler
- Sætte advarsler baseret på metriske grænseværdier

## Oprettelse af en Metrisk Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Metrikker** som monitortype
4. Konfigurer metriske forespørgsler og valgfrie formler
5. Vælg aggregeringsstrategien
6. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Metriske forespørgsler

Definer én eller flere metriske forespørgsler. Hver forespørgsel inkluderer:

| Felt | Beskrivelse | Påkrævet |
|-------|-------------|----------|
| Metrisk navn | Navnet på metrikken der skal forespørges | Ja |
| Aggregeringstype | Sådan aggregeres råmetriske værdier (sum, gns., min., maks., antal) | Ja |
| Attributter | Nøgle-værdi-filtre til at indsnævre de metriske data | Nej |
| Aggregér efter | Dimensioner til at gruppere metrikken efter | Nej |

Hver forespørgsel tildeles et alias (f.eks. `a`, `b`, `c`) til brug i formler.

### Formler

Kombiner flere metriske forespørgsler ved hjælp af matematiske udtryk. For eksempel:

- `a / b * 100` – Beregn en procentdel fra to forespørgsler
- `a + b` – Summer to metrikker
- `a - b` – Forskel mellem metrikker

### Rullende tidsvindue

Vælg tidsvinduet for metrisk evaluering:

- Seneste 1 minut
- Seneste 5 minutter
- Seneste 10 minutter
- Seneste 15 minutter
- Seneste 30 minutter
- Seneste 60 minutter

### Aggregeringsstrategi

Vælg, hvordan de metriske værdier skal aggregeres til evaluering:

| Strategi | Beskrivelse |
|----------|-------------|
| Gennemsnit | Gennemsnitsværdi over tidsvinduet |
| Sum | Sum af alle værdier |
| Maksimumsværdi | Højeste værdi i tidsvinduet |
| Minimumsværdi | Laveste værdi i tidsvinduet |
| Alle værdier | Alle værdier skal opfylde kriterierne |
| Enhver værdi | Mindst én værdi skal opfylde kriterierne |

## Overvågningskriterier

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse |
|------------|-------------|
| Metrisk værdi | Den aggregerede værdi af den konfigurerede metriske forespørgsel eller formel |

### Filtertyper

- **Større end** – Metrisk værdi overskrider en grænseværdi
- **Mindre end** – Metrisk værdi er under en grænseværdi
- **Større end eller lig med** – Metrisk værdi er ved eller over en grænseværdi
- **Mindre end eller lig med** – Metrisk værdi er ved eller under en grænseværdi
- **Lig med** – Metrisk værdi matcher nøjagtigt
- **Ikke lig med** – Metrisk værdi matcher ikke

### Eksempelkriterier

#### Advarsel, hvis fejlrate overskrider 5%

- **Forespørgsel a**: `http_requests_total` filtreret efter `status=5xx`
- **Forespørgsel b**: `http_requests_total`
- **Formel**: `a / b * 100`
- **Kontroller på**: Metrisk værdi
- **Filtertype**: Større end
- **Værdi**: 5

#### Advarsel, hvis anmodningskommandostørrelse er høj

- **Forespørgsel**: `request_queue_size`, aggregering: Maksimumsværdi
- **Kontroller på**: Metrisk værdi
- **Filtertype**: Større end
- **Værdi**: 1000

## Opsætningskrav

Metrisk overvågning kræver, at dine applikationer eller infrastruktur sender metrikker til OneUptime via OpenTelemetry. Se dokumentationen til [OpenTelemetry](/docs/telemetry/open-telemetry) for opsætningsinstruktioner.
