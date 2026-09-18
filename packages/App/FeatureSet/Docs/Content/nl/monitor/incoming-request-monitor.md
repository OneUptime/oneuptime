# Inkomend verzoek-monitor

Een Inkomend verzoek-monitor geeft je een URL waar andere systemen HTTP-verzoeken naartoe sturen. OneUptime beoordeelt elk verzoek aan de hand van je criteria en kan de status van de monitor wijzigen, incidenten aanmaken en je wachtdienst oproepen.

Hij dekt twee verschillende taken:

- **Heartbeat-monitoring** — een cron-taak, worker of apparaat pingt de URL volgens een schema, en OneUptime opent een incident wanneer de pings uitblijven.
- **Alerts ontvangen van een ander systeem** — Prometheus Alertmanager, Grafana of wat dan ook dat JSON kan POSTen duwt alerts naar binnen, en OneUptime maakt van elk daarvan een incident met wachtdienst-escalatie en automatische oplossing bij herstel.

Beide gebruiken hetzelfde monitortype. Wat ze onderscheidt zijn de criteria die je instelt.

## Overzicht

Inkomend verzoek-monitors bieden een unieke URL die je services aanroepen. Daarmee kun je:

- Cron-taken en geplande taken monitoren
- Controleren of achtergrond-workers draaien
- Services achter firewalls monitoren die extern niet bereikbaar zijn
- Alerts ontvangen van Prometheus Alertmanager, Grafana en andere alerting-systemen
- Heartbeat-signalen volgen van elk systeem dat HTTP kan

## Een Inkomend verzoek-monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor maken**
3. Selecteer **Inkomend verzoek** als monitortype
4. Er worden een **Geheime sleutel** en een URL voor deze monitor gegenereerd
5. Open de monitor en klik op **Documentation** in het linkermenu om de URL te kopiëren
6. Configureer je service om verzoeken naar die URL te sturen
7. Configureer de monitoringcriteria zoals hieronder beschreven

## De verzoek-URL

Je monitor heeft een unieke URL in het formaat:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Vervang `https://oneuptime.com` door de URL van je eigen OneUptime-instantie als je zelf host.

Stuur **GET**- of **POST**-verzoeken naar deze URL. HEAD wordt geaccepteerd en behandeld als GET. Andere methodes geven 404. De geheime sleutel in het pad is de enige credential — een header of token is niet nodig.

> **Warning:** Iedereen die deze URL kent kan de monitor gezond markeren, dus behandel hem als een geheim. Elke header die je stuurt wordt op de monitor opgeslagen en is zichtbaar voor iedereen die hem kan lezen — stuur geen API-sleutels of tokens in headers naar dit endpoint.

OneUptime antwoordt direct met een lege `200` en verwerkt het verzoek via een wachtrij. Dat antwoord wordt geschreven vóór enige validatie, dus een `200` is **geen** bevestiging dat het verzoek is geaccepteerd — een verkeerde geheime sleutel, een verwijderde monitor en een uitgeschakelde monitor geven ook `200`. Controleer de tijdlijn van de monitor zelf om te bevestigen dat verzoeken aankomen.

### Een verzoeklichaam versturen

Als je velden binnen het lichaam wilt aanspreken — `{{requestBody.status}}` in een incidenttitel, een JSON-pad in incidentgroepering, of een JavaScript Expression-criterium — stuur dan `Content-Type: application/json`; dat is het formaat waar deze documentatie overal van uitgaat. Een `application/x-www-form-urlencoded`-lichaam wordt ook geparseerd, maar alleen naar platte velden op het hoogste niveau. Elk ander content type, of helemaal geen, wordt niet geparseerd en elke verwijzing naar `requestBody` levert niets op.

Lichamen tot 50 MB worden geaccepteerd. Comprimeer het lichaam niet met `Content-Encoding: gzip`; het wordt ongeparseerd opgeslagen en paden erin zullen niet oplossen.

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
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python voorbeeld
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Monitoringcriteria

Je kunt criteria instellen om te bepalen wanneer je service als online, gedegradeerd of offline geldt. Elk criteriumfilter heeft een **Filter Type** (waar je naar kijkt), een **Filter Condition** (hoe je het vergelijkt) en een **Value**.

### Beschikbare Filter Types

| Filter Type           | Controleert                                           | Opmerkingen                                                                                 |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Incoming Request      | Of er binnen een tijdvenster een verzoek is ontvangen | De enige controle die kan afgaan wanneer er niets binnenkomt                                |
| Request Body          | Het verzoeklichaam                                    | Substring-overeenkomst. Objectlichamen worden vergeleken als compacte JSON                  |
| Request Header        | De namen van de verzoekheaders                        | Exacte overeenkomst met een headernaam, in kleine letters                                   |
| Request Header Value  | De waarden van de verzoekheaders                      | Exacte overeenkomst met een headerwaarde, in kleine letters                                 |
| JavaScript Expression | Elke expressie over `requestBody` en `requestHeaders` | De meest flexibele optie — zie [JavaScript-expressies](/docs/monitor/javascript-expression) |

### Filter Conditions

Elk Filter Type biedt zijn eigen set condities.

Voor **Incoming Request** (hier weergegeven met de spelling van het dashboard):

- **Recieved In Minutes** — er is binnen het opgegeven aantal minuten een verzoek ontvangen
- **Not Recieved In Minutes** — er is binnen het opgegeven aantal minuten geen verzoek ontvangen

Voor **Request Body**, **Request Header** en **Request Header Value**: **Contains** en **Not Contains**.

Voor **JavaScript Expression**: **Evaluates To True**.

> **Note:** Headernamen en headerwaarden worden vóór de vergelijking naar kleine letters omgezet, en er wordt vergeleken op de hele naam of waarde, niet op een substring. Schrijf `content-type`, niet `Content-Type`, en `application/json`, niet `application/JSON`. Alleen **Request Body** doet een echte substring-overeenkomst.

Objectlichamen worden vergeleken als compacte JSON zonder spaties, dus een **Request Body** / **Contains**-filter moet worden geschreven als `"status":"firing"` — `"status": "firing"` kopiëren uit een opgemaakte payload zal nooit matchen.

### Voorbeeldcriteria

#### Als offline markeren als er 10 minuten geen heartbeat is

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### Als gedegradeerd markeren op basis van inhoud van verzoeklichaam

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** Een monitor wordt alleen op de achtergrond opnieuw beoordeeld als ten minste één van zijn criteria op **Incoming Request** controleert. Een monitor waarvan de criteria alleen Request Body, Request Header of een JavaScript Expression controleren, wordt beoordeeld wanneer er een verzoek binnenkomt en op geen enkel ander moment — hij kan dus nooit uit zichzelf offline gaan. Wil je een alarm voor een ontbrekende heartbeat, dan heb je een **Incoming Request**-criterium nodig.

Let er ook op dat een monitor die nog nooit een verzoek heeft ontvangen wordt behandeld alsof zijn aanmaaktijd het laatste verzoek was. Een criterium "Not Recieved In Minutes: 10" op een gloednieuwe monitor gaat 10 minuten na het aanmaken af, ook als de verzender nooit is aangesloten.

## Alerts ontvangen van een ander systeem

Alertmanager, Grafana en vergelijkbare tools POSTen een JSON-document dat een of meer alerts beschrijft. Standaard opent een criterium **één** incident, dus een payload met vijf alerts zou één enkel incident opleveren. Incidentgroepering verandert dat: het haalt een waarde uit de payload en opent **een apart incident per unieke waarde**, die allemaal tegelijk open kunnen staan.

### Incidentgroepering inschakelen

Open het criterium, klap **Settings** uit en zet **Group incidents and alerts by a payload field** aan. Er verschijnen vier velden:

| Veld                               | Voorbeeld                                | Wat het doet                                                                            |
| ---------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | Het pad waarvan de unieke waarden de incidenten uit elkaar trekken                      |
| Field that signals recovery        | `requestBody.alerts[*].status`           | Het pad dat wordt gecontroleerd om te bepalen dat een alert hersteld is                 |
| Value that means recovered         | `resolved`                               | De exacte waarde die herstel aanduidt                                                   |
| Max incidents per request          | `100` (standaard)                        | Veiligheidslimiet zodat een veld met hoge cardinaliteit niet eindeloos incidenten opent |

### Padsyntaxis

Paden moeten beginnen met het letterlijke voorvoegsel `requestBody.`. Een pad zonder dat voorvoegsel — `alerts[*].labels.alertname` — matcht niets, en wel stilzwijgend. De `{{ }}`-omhulling is optioneel: `requestBody.status` en `{{requestBody.status}}` gedragen zich identiek.

- `[*]` waaiert uit over een array — één incident per **unieke** waarde. Twee elementen die dezelfde waarde opleveren vallen samen tot één incident, en de firing/resolved-status van dat incident komt van het **eerste** overeenkomende element. **Alleen de eerste `[*]` in een pad is een jokerteken**; `requestBody.groups[*].alerts[*].name` matcht niets.
- `[0]` en `[last]` selecteren één enkel element, en mogen na een `[*]` komen.
- Object- en arraywaarden, lege strings en nulls worden overgeslagen. `0` en `false` zijn geldige sleutels.

### Oplossen is event-gedreven

Een webhook beschrijft alleen wat in die payload staat, dus OneUptime lost een incident nooit op omdat zijn sleutel niet meer voorkomt. Een incident wordt alleen opgelost wanneer een payload expliciet zegt dat die sleutel hersteld is. Aan twee dingen moet tegelijk zijn voldaan:

1. **Field that signals recovery** en **Value that means recovered** zijn ingesteld en komen overeen met de payload. De vergelijking is exact en hoofdlettergevoelig — `Resolved` matcht niet met `resolved`.
2. Het incident van het criterium heeft **Auto Resolve Incident** aan staan, onder **Advanced Options** in het incidentformulier. Zonder dat worden overeenkomende herstelgebeurtenissen genegeerd en blijven de incidenten open. (Hetzelfde geldt voor alerts en **Auto Resolve Alert**.)

**Max incidents per request** begrenst de extractie, niet alleen het aanmaken. Sleutels voorbij de limiet zijn ook onzichtbaar voor herstel, dus in een payload met meer unieke sleutels dan de limiet zal een alert die voorbij die limiet `resolved` meldt zijn incident niet sluiten.

> **Warning:** Als **Field that signals recovery** een `[*]` bevat maar **Open a separate incident for each…** niet, wordt er nooit iets opgelost. Gebruik `[*]` in beide, of in geen van beide. Een herstelpad zonder `[*]` wordt tegen de hele payload beoordeeld, dus een `status: resolved` op payloadniveau lost elke sleutel in die payload op — inclusief alerts waarvan de eigen status nog firing is.

### De incidenten benoemen

De groeperingssleutel wordt aan incident- en alerttemplates aangeboden als een variabele met de naam van het **laatste segment van het pad**:

| Pad                                      | Variabele         |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

De volledige payload blijft daarnaast beschikbaar, dus een incidenttitel `{{alertname}}` en een beschrijving die `{{requestBody.commonAnnotations.summary}}` gebruikt werken allebei. Zie [Dynamische incident- en alerttemplates](/docs/monitor/incident-alert-templating).

> **Warning:** De variabelenaam maakt deel uit van de identiteit die OneUptime gebruikt om een herstelgebeurtenis aan een open incident te koppelen. Het groeperingspad wijzigen naar een pad met een ander laatste segment maakt elk incident dat nu open staat onder het oude pad wees — die kunnen niet meer automatisch worden opgelost en moeten met de hand worden gesloten.

Merk op dat `[*]` **alleen** in de twee groeperingspadvelden werkt. Elders wordt het niet omgezet, en een niet-omgezette placeholder wordt **letterlijk** afgedrukt in plaats van leeggemaakt — een titel `{{requestBody.alerts[*].labels.alertname}}` verschijnt met de accolades er nog in. Een titel `{{requestBody.alerts[0].annotations.summary}}` wordt wel omgezet, maar leest altijd de eerste alert in de payload, niet die waarvoor dit incident is geopend. Gebruik liever de groeperingsvariabele plus de gedeelde `commonAnnotations`-velden van de payload.

### Uitgewerkt voorbeeld

Voor een volledige Alertmanager-configuratie, zie [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). Voor Grafana, zie [Grafana](/docs/integrations/grafana).

## Best practices

1. **Stel het tijdvenster passend in** — Als je cron-taak elke 5 minuten draait, zet de drempel "Not Recieved In Minutes" dan op 10–15 minuten om af en toe vertraging op te vangen
2. **Neem betekenisvolle data op** — Stuur statusinformatie mee in het verzoeklichaam zodat je fijnmazige criteria kunt instellen
3. **Gebruik POST met `Content-Type: application/json`** — alles wat binnen het lichaam leest hangt hiervan af
4. **Meng de twee taken niet op één monitor** — een monitor die event-gedreven alerts ontvangt heeft geen vast ritme, dus een "Not Recieved In Minutes"-criterium erop gaat flapperen. Gebruik een aparte monitor voor de dodemansknop
5. **Monitor de monitor** — Zorg dat de service die de verzoeken stuurt goede foutafhandeling heeft, zodat mislukte verzoeken niet onopgemerkt blijven

## Waar verder lezen

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — een volledige inbound alerting-opzet
- [Grafana](/docs/integrations/grafana) — hetzelfde, voor Grafana-alerting
- [Dynamische incident- en alerttemplates](/docs/monitor/incident-alert-templating) — elke variabele die in titels en beschrijvingen beschikbaar is
- [JavaScript-expressies](/docs/monitor/javascript-expression) — expressiesyntaxis en regels voor aanhalingstekens
