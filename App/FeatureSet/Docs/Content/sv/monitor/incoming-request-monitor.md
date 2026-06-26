# Monitor för inkommande förfrågningar

Övervakning av inkommande förfrågningar (även känt som hjärtslagsövervakning) gör det möjligt att övervaka tjänster genom att låta dem skicka periodiska HTTP-förfrågningar till OneUptime. Istället för att OneUptime når ut till din tjänst, pingar din tjänst OneUptime för att bekräfta att den körs.

## Översikt

Monitorer för inkommande förfrågningar tillhandahåller en unik webhook-URL som dina tjänster anropar enligt ett schema. Detta gör det möjligt att:

- Övervaka cron-jobb och schemalagda uppgifter
- Verifiera att bakgrundsarbetare körs
- Övervaka tjänster bakom brandväggar som inte kan nås externt
- Integrera med tredjepartsövervakningsverktyg
- Spåra hjärtslagssignaler från HTTP-kapabla system

## Skapa en monitor för inkommande förfrågningar

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Inkommande förfrågan** som monitortyp
4. En **Hemlig nyckel** och hjärtslagURL kommer att genereras för den här monitorn
5. Konfigurera din tjänst att skicka förfrågningar till hjärtslagURL:en
6. Konfigurera övervakningskriterier efter behov

## Hjärtslagurs URL

När den väl har skapats har din monitor en unik hjärtslagURL i formatet:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Din tjänst bör skicka HTTP **GET**- eller **POST**-förfrågningar till denna URL med jämna mellanrum.

### Skicka ett hjärtslag

#### Använda curl

```bash
# Enkel GET-förfrågan
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST-förfrågan med anpassat innehåll
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Från ett cron-jobb

```bash
# Lägg till i crontab för att skicka hjärtslag var 5:e minut
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Från applikationskod

```javascript
// Node.js-exempel
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python-exempel
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

Ersätt `https://oneuptime.com` med din OneUptime-instans-URL om du egeninstallerar.

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din tjänst anses vara online, degraderad eller offline baserat på:

### Tillgängliga kontrolltyper

| Kontrolltyp            | Beskrivning                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| Inkommande förfrågan   | Om ett hjärtslag togs emot inom ett tidsfönster                     |
| Förfrågningsinnehåll   | Innehållet i det förfrågningsinnehåll som skickades med hjärtslaget |
| Förfrågningshuvud      | Namnet på ett specifikt förfrågningshuvud                           |
| Förfrågningshuvudvärde | Värdet på ett specifikt förfrågningshuvud                           |

### Filtertyper

För **Inkommande förfrågan**:

- **Mottagen inom minuter** – Ett hjärtslag togs emot inom det angivna antalet minuter
- **Inte mottagen inom minuter** – Inget hjärtslag togs emot inom det angivna antalet minuter

För **Förfrågningsinnehåll**, **Förfrågningshuvud** och **Förfrågningshuvudvärde**:

- **Innehåller** – Värdet innehåller den angivna texten
- **Innehåller inte** – Värdet innehåller inte den angivna texten

### Exempelkriterier

#### Markera som offline om inget hjärtslag på 10 minuter

- **Kontrollera på**: Inkommande förfrågan
- **Filtertyp**: Inte mottagen inom minuter
- **Värde**: 10

#### Markera som degraderad baserat på förfrågningsinnehåll

- **Kontrollera på**: Förfrågningsinnehåll
- **Filtertyp**: Innehåller
- **Värde**: `"status": "degraded"`

## Bästa praxis

1. **Ange tidsfönstret lämpligt** – Om ditt cron-jobb körs var 5:e minut, ange tröskeln "Inte mottagen inom minuter" till 10–15 minuter för att tillåta tillfälliga förseningar
2. **Inkludera meningsfull data** – Skicka statusinformation i förfrågningsinnehållet så att du kan konfigurera detaljerade kriterier
3. **Använd POST för rik data** – Använd POST-förfrågningar med JSON-innehåll när du behöver skicka detaljerad statusinformation
4. **Övervaka monitorn** – Se till att tjänsten som skickar hjärtslag har korrekt felhantering så att misslyckade hjärtslagsförfrågningar inte förblir ouppmärksammade
