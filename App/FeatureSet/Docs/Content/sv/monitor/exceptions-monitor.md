# Undantagsmonitor

Undantagsövervakning gör det möjligt att övervaka applikationsundantag och fel, och utlösa varningar när antalet undantag överstiger dina konfigurerade trösklar. OneUptime utvärderar undantagsdata från dina telemetritjänster under ett tidsfönster.

## Översikt

Undantagsmonitorer räknar och filtrerar undantag som matchar specifika kriterier. Detta gör det möjligt att:

- Varna om undantagsspikar i dina applikationer
- Övervaka specifika undantagstyper
- Söka efter undantag baserat på felmeddelande
- Spåra lösta och aktiva undantag separat
- Identifiera applikationsstabilitetsproblem från felmönster

## Skapa en undantagsmonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Undantag** som monitortyp
4. Välj de telemetritjänster att övervaka
5. Konfigurera undantagsfilter och kriterier efter behov

## Konfigurationsalternativ

### Telemetritjänster

Välj en eller flera tjänster att övervaka undantag från. Tjänster måste skicka undantagsdata till OneUptime via OpenTelemetry.

### Undantagsfilter

| Filter               | Beskrivning                                                                 | Obligatorisk |
| -------------------- | --------------------------------------------------------------------------- | ------------ |
| Undantagstyper       | Filtrera efter undantagstypnamn (t.ex. `NullPointerException`, `TypeError`) | Nej          |
| Meddelande           | Textsökning i undantagsmeddelanden                                          | Nej          |
| Inkludera lösta      | Inkludera undantag som har markerats som lösta (standard: false)            | Nej          |
| Inkludera arkiverade | Inkludera undantag som har arkiverats (standard: false)                     | Nej          |
| Tidsfönster          | Hur långt bakåt man söker efter undantag (i sekunder, standard: 60)         | Nej          |

## Övervakningskriterier

### Tillgängliga kontrolltyper

| Kontrolltyp    | Beskrivning                                             |
| -------------- | ------------------------------------------------------- |
| Undantagsantal | Antalet undantag som matchar dina filter i tidsfönstret |

### Filtertyper

- **Större än** – Undantagsantalet överstiger ett tröskelvärde
- **Mindre än** – Undantagsantalet understiger ett tröskelvärde
- **Större än eller lika med** – Undantagsantalet är vid eller över ett tröskelvärde
- **Mindre än eller lika med** – Undantagsantalet är vid eller under ett tröskelvärde
- **Lika med** – Undantagsantalet matchar exakt
- **Inte lika med** – Undantagsantalet matchar inte

### Exempelkriterier

#### Varna om mer än 10 undantag på 60 sekunder

- **Tidsfönster**: 60 sekunder
- **Kontrollera på**: Undantagsantal
- **Filtertyp**: Större än
- **Värde**: 10

#### Varna om NullPointerException

- **Undantagstyper**: `NullPointerException`
- **Tidsfönster**: 60 sekunder
- **Kontrollera på**: Undantagsantal
- **Filtertyp**: Större än
- **Värde**: 0

#### Övervaka undantag med ett specifikt meddelande

- **Meddelande**: `out of memory`
- **Tidsfönster**: 300 sekunder
- **Kontrollera på**: Undantagsantal
- **Filtertyp**: Större än
- **Värde**: 0

## Konfigurationskrav

Undantagsövervakning kräver att dina applikationer skickar undantagsdata till OneUptime via OpenTelemetry. Se dokumentationen för [OpenTelemetry](/docs/telemetry/open-telemetry) för konfigurationsinstruktioner.
