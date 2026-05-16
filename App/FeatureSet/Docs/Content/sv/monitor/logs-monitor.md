# Loggmonitor

Loggövervakning gör det möjligt att övervaka dina applikationsloggar och utlösa varningar baserat på loggmönster, antal och allvarlighetsgrader. OneUptime utvärderar loggar från dina telemetritjänster och kontrollerar dem mot dina konfigurerade kriterier.

## Översikt

Loggmonitorer söker och räknar loggar som matchar specifika filter under ett tidsfönster. Detta gör det möjligt att:

- Varna om felloggspikar
- Övervaka specifika loggmönster eller meddelanden
- Spåra loggvolym efter allvarlighetsgrad
- Filtrera loggar efter tjänst, attribut och innehåll
- Identifiera applikationsproblem från loggmönster

## Skapa en loggmonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Loggar** som monitortyp
4. Välj de telemetritjänster att övervaka
5. Konfigurera loggfilter och kriterier efter behov

## Konfigurationsalternativ

### Telemetritjänster

Välj en eller flera tjänster att övervaka loggar från. Tjänster måste skicka loggar till OneUptime via OpenTelemetry.

### Loggfilter

| Filter | Beskrivning | Obligatorisk |
|--------|-------------|--------------|
| Allvarlighetsgrader | Filtrera efter loggallvarlighetsgrad (ERROR, WARN, INFO, DEBUG etc.) | Nej |
| Innehåll | Textsökning i loggmeddelandets innehåll | Nej |
| Attribut | Nyckel-värdepar för filtrering på anpassade loggattribut | Nej |
| Tidsfönster | Hur långt bakåt man söker efter loggar (i sekunder, standard: 60) | Nej |

### Allvarlighetsgrader

Filtrera loggar efter en eller flera allvarlighetsgrader:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Övervakningskriterier

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Loggantal | Antalet loggar som matchar dina filter i tidsfönstret |

### Filtertyper

- **Större än** – Loggantalet överstiger ett tröskelvärde
- **Mindre än** – Loggantalet understiger ett tröskelvärde
- **Större än eller lika med** – Loggantalet är vid eller över ett tröskelvärde
- **Mindre än eller lika med** – Loggantalet är vid eller under ett tröskelvärde
- **Lika med** – Loggantalet matchar exakt
- **Inte lika med** – Loggantalet matchar inte

### Exempelkriterier

#### Varna om mer än 100 felloggar på 60 sekunder

- **Allvarlighetsgrader**: ERROR
- **Tidsfönster**: 60 sekunder
- **Kontrollera på**: Loggantal
- **Filtertyp**: Större än
- **Värde**: 100

#### Varna om fatala loggar dyker upp

- **Allvarlighetsgrader**: FATAL
- **Tidsfönster**: 60 sekunder
- **Kontrollera på**: Loggantal
- **Filtertyp**: Större än
- **Värde**: 0

#### Övervaka loggar med ett specifikt felmeddelande

- **Innehåll**: `database connection timeout`
- **Tidsfönster**: 300 sekunder
- **Kontrollera på**: Loggantal
- **Filtertyp**: Större än
- **Värde**: 5

## Konfigurationskrav

Loggövervakning kräver att dina applikationer skickar loggar till OneUptime via OpenTelemetry. Se dokumentationen för [OpenTelemetry](/docs/telemetry/open-telemetry) för konfigurationsinstruktioner.
