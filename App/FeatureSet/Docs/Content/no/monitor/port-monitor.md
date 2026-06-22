# Port-monitor

Port-overvåking lar deg overvåke tilgjengeligheten til spesifikke TCP- eller UDP-porter på en vert. OneUptime forsøker periodisk å koble til den angitte porten og sjekker om den er åpen og responsiv.

## Oversikt

Port-monitorer tester om en spesifikk nettverksport aksepterer tilkoblinger. Dette gjør det mulig å:

- Overvåke tjenestetilgjengelighet på spesifikke porter
- Spore port-svartider
- Verifisere at tjenester som databaser, e-postservere og applikasjonsservere kjører
- Oppdage tjenesteavbrudd før de påvirker brukere

## Opprette en port-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Port** som monitortype
4. Skriv inn vertsnavnet eller IP-adressen og portnummeret
5. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### Vertsnavn eller IP-adresse

Skriv inn vertsnavnet eller IP-adressen til målverten (f.eks. `example.com` eller `192.168.1.1`).

### Port

Skriv inn portnummeret som skal overvåkes (1–65535). Vanlige eksempler:

| Port  | Tjeneste   |
| ----- | ---------- |
| 22    | SSH        |
| 25    | SMTP       |
| 80    | HTTP       |
| 443   | HTTPS      |
| 3306  | MySQL      |
| 5432  | PostgreSQL |
| 6379  | Redis      |
| 27017 | MongoDB    |

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når porten anses som tilgjengelig, degradert eller utilgjengelig basert på:

### Tilgjengelige kontrolltyper

| Kontrolltype          | Beskrivelse                                      |
| --------------------- | ------------------------------------------------ |
| Is Online             | Om porten er åpen og aksepterer tilkoblinger     |
| Response Time (in ms) | Tid for å opprette en tilkobling i millisekunder |
| Is Request Timeout    | Om tilkoblingsforsøket fikk tidsavbrudd          |

### Filtertyper

For **Is Online** og **Is Request Timeout**:

- **True** – Betingelsen er sann
- **False** – Betingelsen er usann

For **Response Time**:

- **Greater Than** – Svartiden overskrider en terskel
- **Less Than** – Svartiden er under en terskel
- **Greater Than or Equal To** – Svartiden er ved eller over en terskel
- **Less Than or Equal To** – Svartiden er ved eller under en terskel
- **Equal To** – Svartiden samsvarer nøyaktig
- **Not Equal To** – Svartiden samsvarer ikke
- **Evaluate Over Time** – Evaluer ved hjelp av aggregering (Average, Sum, Maximum, Minimum, All Values, Any Value) over et tidsvindu

### Eksempelkriterier

#### Marker som utilgjengelig hvis porten er lukket

- **Sjekk på**: Is Online
- **Filtertype**: False

#### Varsle hvis tilkobningstid overskrider 500 ms

- **Sjekk på**: Response Time (in ms)
- **Filtertype**: Greater Than
- **Verdi**: 500

#### Marker som degradert hvis tilkoblingen er treg

- **Sjekk på**: Response Time (in ms)
- **Filtertype**: Greater Than
- **Verdi**: 200
