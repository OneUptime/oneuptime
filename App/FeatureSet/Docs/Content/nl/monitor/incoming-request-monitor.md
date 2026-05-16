# Inkomend verzoek-monitor

Inkomend verzoek-monitoring (ook bekend als heartbeat-monitoring) stelt u in staat diensten te bewaken door ze periodiek HTTP-verzoeken naar OneUptime te laten sturen. In plaats dat OneUptime uw dienst benadert, pingt uw dienst OneUptime om te bevestigen dat hij actief is.

## Overzicht

Inkomend verzoek-monitors bieden een unieke webhook-URL die uw diensten op een schema aanroepen. Hiermee kunt u:

- Cron-taken en geplande processen bewaken
- Verifiëren dat achtergrondwerkers actief zijn
- Diensten bewaken achter firewalls die extern niet bereikbaar zijn
- Integreren met externe monitoringtools
- Heartbeat-signalen bijhouden van elk HTTP-compatibel systeem

## Een Inkomend verzoek-monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Inkomend verzoek** als het monitortype
4. Er wordt een **Geheime sleutel** en heartbeat-URL gegenereerd voor deze monitor
5. Configureer uw dienst om verzoeken naar de heartbeat-URL te sturen
6. Configureer monitoringcriteria naar wens

## Heartbeat-URL

Na aanmaak heeft uw monitor een unieke heartbeat-URL in het formaat:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Uw dienst moet met regelmatige tussenpozen HTTP **GET**- of **POST**-verzoeken naar deze URL sturen.

### Een heartbeat versturen

#### Via curl

```bash
# Eenvoudig GET-verzoek
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST-verzoek met aangepast lichaam
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Via een cron-taak

```bash
# Voeg toe aan crontab om elke 5 minuten een heartbeat te versturen
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Via applicatiecode

```javascript
// Node.js voorbeeld
const https = require('https');
https.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY');
```

```python
# Python voorbeeld
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

Vervang `https://oneuptime.com` door de URL van uw OneUptime-instantie als u zelf host.

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw dienst als online, gedegradeerd of offline wordt beschouwd op basis van:

### Beschikbare controletypen

| Controletype | Beschrijving |
|------------|-------------|
| Inkomend verzoek | Of een heartbeat werd ontvangen binnen een tijdvenster |
| Verzoeklichaam | Inhoud van het verzoeklichaam meegestuurd met de heartbeat |
| Verzoekheader | Naam van een specifieke verzoekheader |
| Verzoekheaderwaarde | Waarde van een specifieke verzoekheader |

### Filtertypen

Voor **Inkomend verzoek**:

- **Ontvangen in minuten** — Een heartbeat werd ontvangen binnen het opgegeven aantal minuten
- **Niet ontvangen in minuten** — Geen heartbeat ontvangen binnen het opgegeven aantal minuten

Voor **Verzoeklichaam**, **Verzoekheader** en **Verzoekheaderwaarde**:

- **Bevat** — Waarde bevat de opgegeven tekst
- **Bevat niet** — Waarde bevat de opgegeven tekst niet

### Voorbeeldcriteria

#### Als offline markeren als er 10 minuten geen heartbeat is

- **Controleer op**: Inkomend verzoek
- **Filtertype**: Niet ontvangen in minuten
- **Waarde**: 10

#### Als gedegradeerd markeren op basis van inhoud van verzoeklichaam

- **Controleer op**: Verzoeklichaam
- **Filtertype**: Bevat
- **Waarde**: `"status": "degraded"`

## Best practices

1. **Stel het tijdvenster passend in** — Als uw cron-taak elke 5 minuten wordt uitgevoerd, stel dan de drempelwaarde "Niet ontvangen in minuten" in op 10-15 minuten om gelegenheid te bieden voor incidentele vertragingen
2. **Voeg betekenisvolle gegevens toe** — Stuur statusinformatie in het verzoeklichaam zodat u gedetailleerde criteria kunt instellen
3. **Gebruik POST voor rijke gegevens** — Gebruik POST-verzoeken met JSON-lichamen wanneer u gedetailleerde statusinformatie moet versturen
4. **Bewaken de monitor** — Zorg dat de dienst die heartbeats verstuurt goede foutafhandeling heeft zodat mislukte heartbeat-verzoeken niet onopgemerkt blijven
