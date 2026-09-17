# IP-monitor

IP-overvåking lar deg overvåke tilgjengelighet og respons for enhver IPv4- eller IPv6-adresse. OneUptime tester periodisk tilkoblingen til mål-IP-adressen og rapporterer statusen.

## Oversikt

IP-monitorer verifiserer at en spesifikk IP-adresse er tilgjengelig og responsiv. Dette gjør det mulig å:

- Overvåke tilgjengeligheten for IPv4- og IPv6-adresser
- Spore svartider og latens
- Oppdage problemer med nettverkstilkobling
- Verifisere at infrastrukturendepunkter er tilgjengelige

## Opprette en IP-monitor

1. Gå til **Overvåkere** i OneUptime-dashbordet
2. Klikk **Opprett monitor**
3. Velg **IP** som monitortype
4. Skriv inn IP-adressen du ønsker å overvåke
5. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### IP-adresse

Skriv inn IPv4- eller IPv6-adressen du ønsker å overvåke (f.eks. `192.168.1.1` eller `2001:db8::1`). Verdien må være i et gyldig IP-adresseformat.

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når IP-adressen anses som tilgjengelig, degradert eller utilgjengelig basert på:

### Tilgjengelige kontrolltyper

| Kontrolltype          | Beskrivelse                                                    |
| --------------------- | -------------------------------------------------------------- |
| Is Online             | Om IP-adressen er tilgjengelig                                 |
| Response Time (in ms) | Svartid i millisekunder                                        |
| Packet Loss (in %)    | Andel ICMP echo-forespørsler uten svar                         |
| Jitter (in ms)        | Standardavvik for rundturstider på tvers av pakkene som sendes |
| Is Request Timeout    | Om forespørselen fikk tidsavbrudd                              |

### Filtertyper

For **Is Online** og **Is Request Timeout**:

- **True** – Betingelsen er sann
- **False** – Betingelsen er usann

For **Response Time**, **Packet Loss** og **Jitter**:

- **Greater Than** – Svartiden overskrider en terskel
- **Less Than** – Svartiden er under en terskel
- **Greater Than or Equal To** – Svartiden er ved eller over en terskel
- **Less Than or Equal To** – Svartiden er ved eller under en terskel

**Evaluate this criteria over a period of time** er en avkrysningsboks i kriterieskjemaet, ikke en filterbetingelse. Slå den på for å sammenligne en aggregering – valgt under **Evaluate** (Average, Sum, Maximum, Minimum, All Values, Any Value) over vinduet som angis i **For the last (in minutes)** – i stedet for verdien fra siste kontroll.

### Eksempelkriterier

#### Marker som utilgjengelig hvis IP ikke er tilgjengelig

- **Check On**: Is Online
- **Filtertype**: False

#### Varsle hvis latens overskrider 100 ms

- **Check On**: Response Time (in ms)
- **Filtertype**: Greater Than
- **Verdi**: 100
