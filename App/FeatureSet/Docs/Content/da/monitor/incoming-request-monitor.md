# Indgående anmodningsmonitor

Indgående anmodningsovervågning (også kendt som hjerteslagsovervågning) giver dig mulighed for at overvåge tjenester ved at få dem til at sende periodiske HTTP-anmodninger til OneUptime. I stedet for at OneUptime kontakter din tjeneste pinger din tjeneste OneUptime for at bekræfte, at den kører.

## Oversigt

Indgående anmodningsmonitorer leverer en unik webhook-URL, som dine tjenester kalder efter en tidsplan. Dette giver dig mulighed for at:

- Overvåge cron-jobs og planlagte opgaver
- Bekræfte, at baggrundsmedarbejdere kører
- Overvåge tjenester bag firewalls, der ikke kan nås eksternt
- Integrere med tredjeparts overvågningsværktøjer
- Spore hjerteslag-signaler fra ethvert HTTP-kompatibelt system

## Oprettelse af en Indgående Anmodningsmonitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Indgående anmodning** som monitortype
4. En **Hemmelig nøgle** og hjerteslag-URL genereres til denne monitor
5. Konfigurer din tjeneste til at sende anmodninger til hjerteslag-URL'en
6. Konfigurer overvågningskriterier efter behov

## Hjerteslag-URL

Når den er oprettet, vil din monitor have en unik hjerteslag-URL i formatet:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Din tjeneste skal sende HTTP **GET** eller **POST**-anmodninger til denne URL med jævne mellemrum.

### Afsendelse af et hjerteslag

#### Brug af curl

```bash
# Simpel GET-anmodning
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST-anmodning med brugerdefineret indhold
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Fra et cron-job

```bash
# Tilføj til crontab for at sende hjerteslag hvert 5. minut
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Fra applikationskode

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

Erstat `https://oneuptime.com` med din OneUptime-instans-URL, hvis du selvhoster.

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår din tjeneste betragtes som online, forringet eller offline baseret på:

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse |
|------------|-------------|
| Indgående anmodning | Om et hjerteslag er modtaget inden for et tidsvindue |
| Anmodningsindhold | Indholdet af anmodningsindholdet sendt med hjerteslaget |
| Anmodningsheader | Navnet på en specifik anmodningsheader |
| Anmodningsheaderværdi | Værdien af en specifik anmodningsheader |

### Filtertyper

For **Indgående anmodning**:

- **Modtaget inden for minutter** – Et hjerteslag er modtaget inden for det angivne antal minutter
- **Ikke modtaget inden for minutter** – Intet hjerteslag er modtaget inden for det angivne antal minutter

For **Anmodningsindhold**, **Anmodningsheader** og **Anmodningsheaderværdi**:

- **Indeholder** – Værdien indeholder den angivne tekst
- **Indeholder ikke** – Værdien indeholder ikke den angivne tekst

### Eksempelkriterier

#### Markér som offline, hvis intet hjerteslag inden for 10 minutter

- **Kontroller på**: Indgående anmodning
- **Filtertype**: Ikke modtaget inden for minutter
- **Værdi**: 10

#### Markér som forringet baseret på anmodningsindhold

- **Kontroller på**: Anmodningsindhold
- **Filtertype**: Indeholder
- **Værdi**: `"status": "degraded"`

## Bedste praksis

1. **Sæt tidsvinduet passende** – Hvis dit cron-job kører hvert 5. minut, skal du sætte grænsen "Ikke modtaget inden for minutter" til 10-15 minutter for at tillade lejlighedsvise forsinkelser
2. **Inkludér meningsfulde data** – Send statusinformation i anmodningsindholdet, så du kan opsætte granulære kriterier
3. **Brug POST til avancerede data** – Brug POST-anmodninger med JSON-indhold, når du har behov for at sende detaljerede statusoplysninger
4. **Overvåg monitoren** – Sørg for, at den tjeneste, der sender hjerteslag, har korrekt fejlhåndtering, så mislykkede hjerteslagsanmodninger ikke overses
