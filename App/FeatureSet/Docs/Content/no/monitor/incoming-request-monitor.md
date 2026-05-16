# Innkommende forespørselsmonitor

Overvåking av innkommende forespørsler (også kjent som hjerteslag-overvåking) lar deg overvåke tjenester ved å la dem sende periodiske HTTP-forespørsler til OneUptime. I stedet for at OneUptime kontakter tjenesten din, pinger tjenesten din OneUptime for å bekrefte at den kjører.

## Oversikt

Innkommende forespørselsmonitorer gir en unik webhook-URL som tjenestene dine kaller etter en plan. Dette gjør det mulig å:

- Overvåke cron-jobber og planlagte oppgaver
- Verifisere at bakgrunnsarbeidere kjører
- Overvåke tjenester bak brannmurer som ikke kan nås eksternt
- Integrere med tredjeparts overvåkingsverktøy
- Spore hjerteslag-signaler fra ethvert HTTP-kompatibelt system

## Opprette en innkommende forespørselsmonitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Incoming Request** som monitortype
4. En **hemmelig nøkkel** og hjerteslag-URL genereres for denne monitoren
5. Konfigurer tjenesten din til å sende forespørsler til hjerteslag-URL-en
6. Konfigurer overvåkingskriterier etter behov

## Hjerteslag-URL

Når den er opprettet, vil monitoren din ha en unik hjerteslag-URL i formatet:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Tjenesten din skal sende HTTP **GET**- eller **POST**-forespørsler til denne URL-en med jevne mellomrom.

### Sende et hjerteslag

#### Bruk av curl

```bash
# Enkel GET-forespørsel
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST-forespørsel med egendefinert kropp
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Fra en cron-jobb

```bash
# Legg til i crontab for å sende hjerteslag hvert 5. minutt
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Fra applikasjonskode

```javascript
// Node.js-eksempel
const https = require('https');
https.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY');
```

```python
# Python-eksempel
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

Erstatt `https://oneuptime.com` med URL-en til din OneUptime-instans hvis du selvhoster.

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når tjenesten anses som tilgjengelig, degradert eller utilgjengelig basert på:

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse |
|-------------|-------------|
| Incoming Request | Om et hjerteslag ble mottatt innen et tidsvindu |
| Request Body | Innhold i forespørselskroppen sendt med hjerteslaget |
| Request Header | Navn på et spesifikt forespørselshode |
| Request Header Value | Verdien til et spesifikt forespørselshode |

### Filtertyper

For **Incoming Request**:

- **Received In Minutes** – Et hjerteslag ble mottatt innen det angitte antallet minutter
- **Not Received In Minutes** – Ingen hjerteslag ble mottatt innen det angitte antallet minutter

For **Request Body**, **Request Header** og **Request Header Value**:

- **Contains** – Verdien inneholder den angitte teksten
- **Not Contains** – Verdien inneholder ikke den angitte teksten

### Eksempelkriterier

#### Merk som utilgjengelig hvis intet hjerteslag på 10 minutter

- **Sjekk på**: Incoming Request
- **Filtertype**: Not Received In Minutes
- **Verdi**: 10

#### Merk som degradert basert på forespørselskroppinnhold

- **Sjekk på**: Request Body
- **Filtertype**: Contains
- **Verdi**: `"status": "degraded"`

## Beste praksis

1. **Sett tidsvinduet hensiktsmessig** – Hvis cron-jobben kjører hvert 5. minutt, sett terskelen for "Not Received In Minutes" til 10–15 minutter for å tillate tilfeldige forsinkelser
2. **Inkluder meningsfull data** – Send statusinformasjon i forespørselskroppen slik at du kan sette opp detaljerte kriterier
3. **Bruk POST for rik data** – Bruk POST-forespørsler med JSON-kropper når du trenger å sende detaljert statusinformasjon
4. **Overvåk monitoren** – Sørg for at tjenesten som sender hjerteslag har god feilhåndtering slik at mislykkede hjerteslag-forespørsler ikke går ubemerket hen
