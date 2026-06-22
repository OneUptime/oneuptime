# IP-monitor

IP-overvåking lar deg overvåke tilgjengelighet og respons for enhver IPv4- eller IPv6-adresse. OneUptime tester periodisk tilkoblingen til mål-IP-adressen og rapporterer statusen.

## Oversikt

IP-monitorer verifiserer at en spesifikk IP-adresse er tilgjengelig og responsiv. Dette gjør det mulig å:

- Overvåke tilgjengeligheten for IPv4- og IPv6-adresser
- Spore svartider og latens
- Oppdage problemer med nettverkstilkobling
- Verifisere at infrastrukturendepunkter er tilgjengelige

## Opprette en IP-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **IP** som monitortype
4. Skriv inn IP-adressen du ønsker å overvåke
5. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### IP-adresse

Skriv inn IPv4- eller IPv6-adressen du ønsker å overvåke (f.eks. `192.168.1.1` eller `2001:db8::1`). Verdien må være i et gyldig IP-adresseformat.

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når IP-adressen anses som tilgjengelig, degradert eller utilgjengelig basert på:

### Tilgjengelige kontrolltyper

| Kontrolltype          | Beskrivelse                       |
| --------------------- | --------------------------------- |
| Is Online             | Om IP-adressen er tilgjengelig    |
| Response Time (in ms) | Svartid i millisekunder           |
| Is Request Timeout    | Om forespørselen fikk tidsavbrudd |

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

#### Marker som utilgjengelig hvis IP ikke er tilgjengelig

- **Sjekk på**: Is Online
- **Filtertype**: False

#### Varsle hvis latens overskrider 100 ms

- **Sjekk på**: Response Time (in ms)
- **Filtertype**: Greater Than
- **Verdi**: 100
