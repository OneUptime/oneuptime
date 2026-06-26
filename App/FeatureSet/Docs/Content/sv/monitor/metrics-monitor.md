# Mätvärdesmonitor

Mätvärdesövervakning gör det möjligt att övervaka anpassade applikations- och infrastrukturmätvärden som samlats in via OpenTelemetry. OneUptime utvärderar mätvärdesvärden under ett tidsfönster och utlöser varningar baserat på dina konfigurerade kriterier.

## Översikt

Mätvärdesmonitorer frågar och utvärderar numeriska mätvärden från dina telemetritjänster. Detta gör det möjligt att:

- Övervaka anpassade applikationsmätvärden (förfrågningshastigheter, ködjup, felfrekvenser etc.)
- Spåra infrastrukturmätvärden (CPU, minne, disk, nätverk)
- Skapa komplexa mätvärdesförfrågningar med filter och aggregeringar
- Kombinera flera mätvärden med matematiska formler
- Ange varningar baserat på mätvärdeströsklar

## Skapa en mätvärdesmonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Mätvärden** som monitortyp
4. Konfigurera mätvärdesförfrågningar och valfria formler
5. Välj aggregeringsstrategi
6. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Mätvärdesförfrågningar

Definiera en eller flera mätvärdesförfrågningar. Varje förfrågan inkluderar:

| Fält            | Beskrivning                                                            | Obligatorisk |
| --------------- | ---------------------------------------------------------------------- | ------------ |
| Mätvärdets namn | Namnet på mätvärdet att fråga                                          | Ja           |
| Aggregeringstyp | Hur man aggregerar råa mätvärdesvärden (summa, medel, min, max, antal) | Ja           |
| Attribut        | Nyckel-värdefilter för att begränsa mätvärdesdata                      | Nej          |
| Aggregera efter | Dimensioner att gruppera mätvärdet efter                               | Nej          |

Varje förfrågan tilldelas ett alias (t.ex. `a`, `b`, `c`) för användning i formler.

### Formler

Kombinera flera mätvärdesförfrågningar med matematiska uttryck. Till exempel:

- `a / b * 100` – Beräkna en procentandel från två förfrågningar
- `a + b` – Summera två mätvärden
- `a - b` – Skillnaden mellan mätvärden

### Rullande tidsfönster

Välj tidsfönstret för mätvärdesutvärdering:

- Senaste 1 minuten
- Senaste 5 minuterna
- Senaste 10 minuterna
- Senaste 15 minuterna
- Senaste 30 minuterna
- Senaste 60 minuterna

### Aggregeringsstrategi

Välj hur mätvärdesvärden ska aggregeras för utvärdering:

| Strategi       | Beskrivning                          |
| -------------- | ------------------------------------ |
| Medelvärde     | Medelvärde under tidsfönstret        |
| Summa          | Summan av alla värden                |
| Maxvärde       | Högsta värdet i tidsfönstret         |
| Minvärde       | Lägsta värdet i tidsfönstret         |
| Alla värden    | Alla värden måste matcha kriterierna |
| Valfritt värde | Minst ett värde måste matcha         |

## Övervakningskriterier

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| Mätvärde    | Det aggregerade värdet av den konfigurerade mätvärdesförfrågan eller formeln |

### Filtertyper

- **Större än** – Mätvärdet överstiger ett tröskelvärde
- **Mindre än** – Mätvärdet understiger ett tröskelvärde
- **Större än eller lika med** – Mätvärdet är vid eller över ett tröskelvärde
- **Mindre än eller lika med** – Mätvärdet är vid eller under ett tröskelvärde
- **Lika med** – Mätvärdet matchar exakt
- **Inte lika med** – Mätvärdet matchar inte

### Exempelkriterier

#### Varna om felfrekvensen överstiger 5%

- **Förfrågan a**: `http_requests_total` filtrerat efter `status=5xx`
- **Förfrågan b**: `http_requests_total`
- **Formel**: `a / b * 100`
- **Kontrollera på**: Mätvärde
- **Filtertyp**: Större än
- **Värde**: 5

#### Varna om förfrågningsködjupet är högt

- **Förfrågan**: `request_queue_size`, aggregering: Maxvärde
- **Kontrollera på**: Mätvärde
- **Filtertyp**: Större än
- **Värde**: 1000

## Konfigurationskrav

Mätvärdesövervakning kräver att dina applikationer eller infrastruktur skickar mätvärden till OneUptime via OpenTelemetry. Se dokumentationen för [OpenTelemetry](/docs/telemetry/open-telemetry) för konfigurationsinstruktioner.
