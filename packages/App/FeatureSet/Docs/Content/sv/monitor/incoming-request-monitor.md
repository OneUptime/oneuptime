# Monitor för inkommande förfrågningar

En monitor för inkommande förfrågningar ger dig en URL som andra system skickar HTTP-förfrågningar till. OneUptime bedömer varje förfrågan mot dina kriterier och kan ändra monitorns status, skapa incidenter och larma din jourrotation.

Den täcker två olika uppgifter:

- **Hjärtslagsövervakning** — ett cron-jobb, en worker eller en enhet anropar URL:en enligt ett schema, och OneUptime öppnar en incident när hjärtslagen uteblir.
- **Ta emot larm från ett annat system** — Prometheus Alertmanager, Grafana eller något annat som kan POSTa JSON skickar in larm, och OneUptime gör varje larm till en incident med jour-eskalering och automatisk lösning vid återhämtning.

Båda använder samma monitortyp. Det som skiljer dem åt är de kriterier du konfigurerar.

## Översikt

Monitorer för inkommande förfrågningar tillhandahåller en unik URL som dina tjänster anropar. Det låter dig:

- Övervaka cron-jobb och schemalagda uppgifter
- Kontrollera att bakgrundsworkers kör
- Övervaka tjänster bakom brandväggar som inte kan nås utifrån
- Ta emot larm från Prometheus Alertmanager, Grafana och andra larmsystem
- Följa hjärtslagssignaler från vilket HTTP-kapabelt system som helst

## Skapa en monitor för inkommande förfrågningar

1. Gå till **Monitorer** i OneUptime-panelen
2. Klicka på **Skapa monitor**
3. Välj **Inkommande förfrågan** som monitortyp
4. En **Hemlig nyckel** och en URL genereras för denna monitor
5. Öppna monitorn och klicka på **Documentation** i vänstermenyn för att kopiera URL:en
6. Konfigurera din tjänst att skicka förfrågningar till den URL:en
7. Konfigurera övervakningskriterier enligt beskrivningen nedan

## Förfrågans URL

Din monitor har en unik URL i formatet:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Ersätt `https://oneuptime.com` med URL:en till din egen OneUptime-instans om du kör självhostat.

Skicka **GET**- eller **POST**-förfrågningar till denna URL. HEAD accepteras och behandlas som GET. Andra metoder ger 404. Den hemliga nyckeln i sökvägen är den enda inloggningsuppgiften — ingen header eller token behövs.

> **Warning:** Alla som känner till denna URL kan markera monitorn som frisk, så behandla den som en hemlighet. Varje header du skickar lagras på monitorn och syns för alla som kan läsa den — skicka inte API-nycklar eller tokens i headers till denna endpoint.

OneUptime svarar direkt med en tom `200` och bearbetar förfrågan via en kö. Det svaret skrivs innan någon validering sker, så en `200` är **ingen** bekräftelse på att förfrågan accepterades — en felaktig hemlig nyckel, en raderad monitor och en inaktiverad monitor ger också `200`. Kontrollera monitorns egen tidslinje för att bekräfta att förfrågningarna kommer fram.

### Skicka ett förfrågningsinnehåll

Om du vill adressera fält inuti innehållet — `{{requestBody.status}}` i en incidenttitel, en JSON-sökväg i incidentgruppering, eller ett JavaScript Expression-kriterium — skicka `Content-Type: application/json`; det är formatet den här dokumentationen förutsätter genomgående. Ett `application/x-www-form-urlencoded`-innehåll tolkas också, men bara till platta fält på toppnivå. Alla andra content types, eller inget alls, tolkas inte och varje `requestBody`-referens löses upp till ingenting.

Innehåll upp till 50 MB accepteras. Komprimera inte innehållet med `Content-Encoding: gzip`; det lagras otolkat och sökvägar in i det kommer inte att lösas upp.

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
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python-exempel
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din tjänst räknas som online, degraderad eller offline. Varje kriteriefilter har en **Filter Type** (vad som ska tittas på), ett **Filter Condition** (hur det ska jämföras) och ett **Value**.

### Tillgängliga Filter Types

| Filter Type           | Kontrollerar                                                     | Anmärkningar                                                                           |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Incoming Request      | Om en förfrågan togs emot inom ett tidsfönster                   | Den enda kontrollen som kan utlösas när ingenting anländer                             |
| Request Body          | Förfrågans innehåll                                              | Delsträngsmatchning. Objektinnehåll jämförs som kompakt JSON                           |
| Request Header        | Namnen på förfrågans headers                                     | Exakt matchning mot ett headernamn, i gemener                                          |
| Request Header Value  | Värdena i förfrågans headers                                     | Exakt matchning mot ett headervärde, i gemener                                         |
| JavaScript Expression | Vilket uttryck som helst över `requestBody` och `requestHeaders` | Det mest flexibla valet — se [JavaScript-uttryck](/docs/monitor/javascript-expression) |

### Filter Conditions

Varje Filter Type erbjuder sin egen uppsättning villkor.

För **Incoming Request** (återgivna här med panelens stavning):

- **Recieved In Minutes** — en förfrågan togs emot inom angivet antal minuter
- **Not Recieved In Minutes** — ingen förfrågan togs emot inom angivet antal minuter

För **Request Body**, **Request Header** och **Request Header Value**: **Contains** och **Not Contains**.

För **JavaScript Expression**: **Evaluates To True**.

> **Note:** Headernamn och headervärden görs om till gemener före jämförelsen, och matchningen sker mot hela namnet eller värdet, inte en delsträng. Skriv `content-type`, inte `Content-Type`, och `application/json`, inte `application/JSON`. Endast **Request Body** gör en verklig delsträngsmatchning.

Objektinnehåll jämförs som kompakt JSON utan mellanslag, så ett **Request Body** / **Contains**-filter måste skrivas `"status":"firing"` — att kopiera `"status": "firing"` från en formaterad payload kommer aldrig att matcha.

### Exempelkriterier

#### Markera som offline om inget hjärtslag på 10 minuter

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### Markera som degraderad baserat på förfrågningsinnehåll

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** En monitor omvärderas bara i bakgrunden om minst ett av dess kriterier kontrollerar **Incoming Request**. En monitor vars kriterier bara kontrollerar Request Body, Request Header eller ett JavaScript Expression utvärderas när en förfrågan anländer och vid inget annat tillfälle — den kan alltså aldrig gå offline av sig själv. Vill du ha ett larm för uteblivet hjärtslag behöver du ett **Incoming Request**-kriterium.

Observera också att en monitor som aldrig har tagit emot någon förfrågan behandlas som om dess skapelsetidpunkt vore den senaste förfrågan. Ett kriterium "Not Recieved In Minutes: 10" på en helt ny monitor utlöses 10 minuter efter att du skapat den, även om avsändaren aldrig kopplades in.

## Ta emot larm från ett annat system

Alertmanager, Grafana och liknande verktyg POSTar ett JSON-dokument som beskriver ett eller flera larm. Som standard öppnar ett kriterium **en** incident, så en payload med fem larm skulle ge en enda incident. Incidentgruppering ändrar det: den plockar ut ett värde ur payloaden och öppnar **en separat incident per unikt värde**, som alla kan vara öppna samtidigt.

### Slå på incidentgruppering

Öppna kriteriet, fäll ut **Settings** och slå på **Group incidents and alerts by a payload field**. Fyra fält dyker upp:

| Fält                               | Exempel                                  | Vad det gör                                                                                  |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | Sökvägen vars unika värden delar upp incidenterna                                            |
| Field that signals recovery        | `requestBody.alerts[*].status`           | Sökvägen som kontrolleras för att avgöra att ett larm har återhämtat sig                     |
| Value that means recovered         | `resolved`                               | Det exakta värdet som markerar återhämtning                                                  |
| Max incidents per request          | `100` (standard)                         | Säkerhetsgräns så att ett fält med hög kardinalitet inte kan öppna obegränsat med incidenter |

### Sökvägssyntax

Sökvägar måste börja med det bokstavliga prefixet `requestBody.`. En sökväg utan det — `alerts[*].labels.alertname` — matchar ingenting, och det sker tyst. `{{ }}`-omslutningen är valfri: `requestBody.status` och `{{requestBody.status}}` beter sig likadant.

- `[*]` breder ut sig över en array — en incident per **unikt** värde. Två element som ger samma värde faller samman till en incident, och den incidentens firing/resolved-tillstånd tas från det **första** matchande elementet. **Endast det första `[*]` i en sökväg är ett jokertecken**; `requestBody.groups[*].alerts[*].name` matchar ingenting.
- `[0]` och `[last]` väljer ett enskilt element och får följa efter ett `[*]`.
- Objekt- och arrayvärden, tomma strängar och null hoppas över. `0` och `false` är giltiga nycklar.

### Lösning är händelsestyrd

En webhook beskriver bara det som finns i den payloaden, så OneUptime löser aldrig en incident för att dess nyckel har slutat dyka upp. En incident löses bara när en payload uttryckligen säger att den nyckeln har återhämtat sig. Två saker måste båda vara uppfyllda:

1. **Field that signals recovery** och **Value that means recovered** är satta och stämmer med payloaden. Jämförelsen är exakt och skiljer på gemener och versaler — `Resolved` matchar inte `resolved`.
2. Kriteriets incident har **Auto Resolve Incident** påslaget, under **Advanced Options** i incidentformuläret. Utan det ignoreras matchande återhämtningshändelser och incidenterna förblir öppna. (Detsamma gäller varningar och **Auto Resolve Alert**.)

**Max incidents per request** begränsar uthämtningen, inte bara skapandet. Nycklar bortom gränsen är osynliga även för återhämtning, så i en payload med fler unika nycklar än gränsen kommer ett larm som rapporterar `resolved` bortom den inte att stänga sin incident.

> **Warning:** Om **Field that signals recovery** innehåller `[*]` men **Open a separate incident for each…** inte gör det, kommer ingenting någonsin att lösas. Använd `[*]` i båda, eller i ingen av dem. En återhämtningssökväg utan `[*]` utvärderas mot hela payloaden, så en `status: resolved` på payloadnivå löser varje nyckel i den payloaden — inklusive larm vars egen status fortfarande är firing.

### Att namnge incidenterna

Grupperingsnyckeln exponeras för incident- och varningsmallar som en variabel uppkallad efter **sökvägens sista segment**:

| Sökväg                                   | Variabel          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

Hela payloaden finns tillgänglig vid sidan av den, så en incidenttitel `{{alertname}}` och en beskrivning som refererar till `{{requestBody.commonAnnotations.summary}}` fungerar båda. Se [Dynamiska incident- och varningsmallar](/docs/monitor/incident-alert-templating).

> **Warning:** Variabelnamnet är en del av den identitet OneUptime använder för att koppla en återhämtningshändelse till en öppen incident. Om du ändrar grupperingssökvägen till en med ett annat sista segment blir varje incident som just nu är öppen under den gamla sökvägen föräldralös — de kan inte längre lösas automatiskt och måste stängas för hand.

Observera att `[*]` fungerar **endast** i de två grupperingssökvägsfälten. På andra ställen löses det inte upp, och en olöst platshållare skrivs ut **ordagrant** i stället för att tömmas — en titel `{{requestBody.alerts[*].labels.alertname}}` visas med klammerparenteserna kvar. En titel `{{requestBody.alerts[0].annotations.summary}}` löses upp, men läser alltid det första larmet i payloaden, inte det som den här incidenten öppnades för. Föredra grupperingsvariabeln tillsammans med payloadens gemensamma `commonAnnotations`-fält.

### Genomarbetat exempel

För en fullständig Alertmanager-konfiguration, se [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). För Grafana, se [Grafana](/docs/integrations/grafana).

## Bästa praxis

1. **Sätt tidsfönstret lagom** — Om ditt cron-jobb körs var 5:e minut, sätt tröskeln "Not Recieved In Minutes" till 10–15 minuter för att tåla enstaka förseningar
2. **Ta med meningsfull data** — Skicka statusinformation i förfrågans innehåll så att du kan sätta upp finmaskiga kriterier
3. **Använd POST med `Content-Type: application/json`** — allt som läser inuti innehållet beror på det
4. **Blanda inte de två uppgifterna på en monitor** — en monitor som tar emot händelsestyrda larm har ingen regelbunden takt, så ett "Not Recieved In Minutes"-kriterium på den kommer att fladdra. Använd en separat monitor för dödmansgreppet
5. **Övervaka monitorn** — Se till att tjänsten som skickar förfrågningarna har ordentlig felhantering, så att misslyckade förfrågningar inte passerar obemärkta

## Läs vidare

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — en komplett uppsättning för inkommande larm
- [Grafana](/docs/integrations/grafana) — detsamma, för Grafana-larm
- [Dynamiska incident- och varningsmallar](/docs/monitor/incident-alert-templating) — alla variabler som finns i titlar och beskrivningar
- [JavaScript-uttryck](/docs/monitor/javascript-expression) — uttryckssyntax och regler för citattecken
