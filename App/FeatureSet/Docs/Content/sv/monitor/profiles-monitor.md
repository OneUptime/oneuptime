# Profilmonitor

Profilövervakning gör det möjligt att övervaka kontinuerliga profileringsdata från dina applikationer och utlösa varningar baserat på profilantal och mönster. OneUptime utvärderar profildata från dina telemetritjänster under ett tidsfönster.

## Översikt

Profilmonitorer räknar och filtrerar profileringsdata som matchar specifika kriterier. Detta gör det möjligt att:

- Övervaka kontinuerliga profileringsdata från dina applikationer
- Filtrera profiler efter typ (CPU, minne, goroutines etc.)
- Spåra profilvolym och mönster
- Varna om profileringsanomalier
- Filtrera efter anpassade profilattribut

## Skapa en profilmonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Profiler** som monitortyp
4. Välj de telemetritjänster att övervaka
5. Konfigurera profilfilter och kriterier efter behov

## Konfigurationsalternativ

### Telemetritjänster

Välj en eller flera tjänster att övervaka profiler från. Tjänster måste skicka kontinuerliga profileringsdata till OneUptime via OpenTelemetry.

### Profilfilter

| Filter | Beskrivning | Obligatorisk |
|--------|-------------|--------------|
| Profiltyper | Filtrera efter profiltypnamn (t.ex. CPU, minne, goroutines) | Nej |
| Attribut | Nyckel-värdepar för filtrering på anpassade profilattribut | Nej |
| Tidsfönster | Hur långt bakåt man söker efter profiler (i sekunder, standard: 60) | Nej |

## Övervakningskriterier

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Profilantal | Antalet profiler som matchar dina filter i tidsfönstret |

### Filtertyper

- **Större än** – Profilantalet överstiger ett tröskelvärde
- **Mindre än** – Profilantalet understiger ett tröskelvärde
- **Större än eller lika med** – Profilantalet är vid eller över ett tröskelvärde
- **Mindre än eller lika med** – Profilantalet är vid eller under ett tröskelvärde
- **Lika med** – Profilantalet matchar exakt
- **Inte lika med** – Profilantalet matchar inte

### Exempelkriterier

#### Varna om inga profiler togs emot på 5 minuter

- **Tidsfönster**: 300 sekunder
- **Kontrollera på**: Profilantal
- **Filtertyp**: Lika med
- **Värde**: 0

## Konfigurationskrav

Profilövervakning kräver att dina applikationer skickar kontinuerliga profileringsdata till OneUptime via OpenTelemetry. Se dokumentationen för [OpenTelemetry](/docs/telemetry/open-telemetry) för konfigurationsinstruktioner.
