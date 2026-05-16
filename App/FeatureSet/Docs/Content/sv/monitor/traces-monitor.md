# Spårningsmonitor

Spårningsövervakning gör det möjligt att övervaka distribuerade spårningar från dina applikationer och utlösa varningar baserat på span-mönster, antal och statusar. OneUptime utvärderar spårningsdata från dina telemetritjänster under ett tidsfönster.

## Översikt

Spårningsmonitorer söker och räknar spans som matchar specifika filter. Detta gör det möjligt att:

- Varna om felsspan-toppar i dina tjänster
- Övervaka specifika operationer och slutpunkter
- Spåra span-volym och mönster
- Filtrera efter span-status, namn och anpassade attribut
- Identifiera prestanda- och tillförlitlighetsproblem från spårningsdata

## Skapa en spårningsmonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Spårningar** som monitortyp
4. Välj de telemetritjänster att övervaka
5. Konfigurera span-filter och kriterier efter behov

## Konfigurationsalternativ

### Telemetritjänster

Välj en eller flera tjänster att övervaka spårningar från. Tjänster måste skicka spårningar till OneUptime via OpenTelemetry.

### Span-filter

| Filter | Beskrivning | Obligatorisk |
|--------|-------------|--------------|
| Span-statusar | Filtrera efter span-statuskod (OK, ERROR, UNSET) | Nej |
| Span-namn | Textsökning för specifika span-namn (t.ex. operations- eller slutpunktsnamn) | Nej |
| Attribut | Nyckel-värdepar för filtrering på anpassade span-attribut | Nej |
| Tidsfönster | Hur långt bakåt man söker efter spans (i sekunder, standard: 60) | Nej |

### Span-statuskoder

- **OK** – Operationen slutfördes framgångsrikt
- **ERROR** – Operationen stötte på ett fel
- **UNSET** – Status angavs inte explicit

## Övervakningskriterier

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Span-antal | Antalet spans som matchar dina filter i tidsfönstret |

### Filtertyper

- **Större än** – Span-antalet överstiger ett tröskelvärde
- **Mindre än** – Span-antalet understiger ett tröskelvärde
- **Större än eller lika med** – Span-antalet är vid eller över ett tröskelvärde
- **Mindre än eller lika med** – Span-antalet är vid eller under ett tröskelvärde
- **Lika med** – Span-antalet matchar exakt
- **Inte lika med** – Span-antalet matchar inte

### Exempelkriterier

#### Varna om mer än 50 felspans på 60 sekunder

- **Span-statusar**: ERROR
- **Tidsfönster**: 60 sekunder
- **Kontrollera på**: Span-antal
- **Filtertyp**: Större än
- **Värde**: 50

#### Varna om fel i en specifik slutpunkt

- **Span-namn**: `POST /api/checkout`
- **Span-statusar**: ERROR
- **Tidsfönster**: 120 sekunder
- **Kontrollera på**: Span-antal
- **Filtertyp**: Större än
- **Värde**: 0

## Konfigurationskrav

Spårningsövervakning kräver att dina applikationer skickar distribuerade spårningar till OneUptime via OpenTelemetry. Se dokumentationen för [OpenTelemetry](/docs/telemetry/open-telemetry) för konfigurationsinstruktioner.
