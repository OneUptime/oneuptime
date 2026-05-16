# Ping-monitor

Ping-overvåking lar deg overvåke tilgjengelighet og respons for enhver vert eller IP-adresse. OneUptime sender periodisk ping-forespørsler til målet ditt og sjekker om det svarer korrekt.

## Oversikt

Ping-monitorer tester grunnleggende nettverkstilkobling ved å sende ICMP-ping-forespørsler til en vert. Dette gjør det mulig å:

- Overvåke vertoppetid og tilgjengelighet
- Spore nettverkslatens og svartider
- Oppdage tilkoblingsproblemer før de påvirker tjenestene dine
- Verifisere at servere og nettverksenheter er tilgjengelige

## Opprette en ping-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Ping** som monitortype
4. Skriv inn vertsnavnet eller IP-adressen du ønsker å overvåke
5. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### Ping-vertsnavn eller IP-adresse

Skriv inn vertsnavnet eller IP-adressen til målet du ønsker å overvåke (f.eks. `example.com` eller `192.168.1.1`). Både vertsnavn og IP-adresser aksepteres.

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når verten anses som tilgjengelig, degradert eller utilgjengelig basert på:

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse |
|-------------|-------------|
| Is Online | Om verten svarer på ping-forespørsler |
| Response Time (in ms) | Tur-retur-tid for ping-forespørselen i millisekunder |
| Is Request Timeout | Om ping-forespørselen fikk tidsavbrudd |

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

#### Marker som utilgjengelig hvis verten ikke er tilgjengelig

- **Sjekk på**: Is Online
- **Filtertype**: False

#### Varsle hvis svartid overskrider 200 ms

- **Sjekk på**: Response Time (in ms)
- **Filtertype**: Greater Than
- **Verdi**: 200
