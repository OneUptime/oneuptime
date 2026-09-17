# Indgående anmodningsmonitor

En Indgående anmodningsmonitor giver dig en URL, som andre systemer sender HTTP-anmodninger til. OneUptime vurderer hver anmodning ud fra dine kriterier og kan ændre monitorens status, oprette hændelser og tilkalde din vagtrotation.

Den dækker to forskellige opgaver:

- **Hjerteslag-overvågning** — et cron-job, en worker eller en enhed kalder URL'en efter en plan, og OneUptime opretter en hændelse, når hjerteslagene udebliver.
- **Modtagelse af alarmer fra et andet system** — Prometheus Alertmanager, Grafana eller alt andet, der kan POSTe JSON, sender alarmer ind, og OneUptime laver hver enkelt om til en hændelse med vagt-eskalering og automatisk løsning ved genopretning.

Begge bruger samme monitortype. Det, der adskiller dem, er de kriterier, du opsætter.

## Oversigt

Indgående anmodningsmonitorer stiller en unik URL til rådighed, som dine tjenester kalder. Det gør dig i stand til at:

- Overvåge cron-jobs og planlagte opgaver
- Kontrollere at baggrunds-workers kører
- Overvåge tjenester bag firewalls, som ikke kan nås udefra
- Modtage alarmer fra Prometheus Alertmanager, Grafana og andre alarmeringssystemer
- Følge hjerteslag-signaler fra ethvert system, der kan HTTP

## Oprettelse af en Indgående Anmodningsmonitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Indgående anmodning** som monitortype
4. Der genereres en **Hemmelig nøgle** og en URL til denne monitor
5. Åbn monitoren og klik på **Documentation** i menuen til venstre for at kopiere URL'en
6. Konfigurér din tjeneste til at sende anmodninger til den URL
7. Konfigurér overvågningskriterier som beskrevet nedenfor

## Anmodnings-URL'en

Din monitor har en unik URL i formatet:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Erstat `https://oneuptime.com` med URL'en til din egen OneUptime-instans, hvis du selv hoster.

Send **GET**- eller **POST**-anmodninger til denne URL. HEAD accepteres og behandles som GET. Andre metoder returnerer 404. Den hemmelige nøgle i stien er den eneste legitimation — ingen header eller token er nødvendig.

> **Warning:** Enhver, der kender denne URL, kan markere monitoren som rask, så behandl den som en hemmelighed. Hver header, du sender, gemmes på monitoren og er synlig for alle, der kan læse den — send ikke API-nøgler eller tokens i headers til dette endpoint.

OneUptime svarer straks med et tomt `200` og behandler anmodningen i en kø. Det svar skrives, før nogen validering finder sted, så et `200` er **ikke** en bekræftelse på, at anmodningen blev accepteret — en forkert hemmelig nøgle, en slettet monitor og en deaktiveret monitor returnerer også `200`. Tjek monitorens egen tidslinje for at bekræfte, at anmodningerne når frem.

### Afsendelse af et anmodningsindhold

Hvis du vil adressere felter inde i indholdet — `{{requestBody.status}}` i en hændelsestitel, en JSON-sti i hændelsesgruppering eller et JavaScript Expression-kriterium — så send `Content-Type: application/json`; det er det format, denne dokumentation forudsætter hele vejen igennem. Et `application/x-www-form-urlencoded`-indhold parses også, men kun til flade felter på øverste niveau. Enhver anden content type, eller ingen, parses ikke, og enhver `requestBody`-reference opløses til ingenting.

Indhold op til 50 MB accepteres. Komprimér ikke indholdet med `Content-Encoding: gzip`; det gemmes uparset, og stier ind i det vil ikke blive opløst.

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
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python-eksempel
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Overvågningskriterier

Du kan opsætte kriterier for at afgøre, hvornår din tjeneste betragtes som online, forringet eller offline. Hvert kriteriefilter har en **Filter Type** (hvad der kigges på), en **Filter Condition** (hvordan der sammenlignes) og en **Value**.

### Tilgængelige Filter Types

| Filter Type           | Kontrollerer                                          | Bemærkninger                                                                              |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Incoming Request      | Om en anmodning blev modtaget inden for et tidsvindue | Den eneste kontrol, der kan udløses, når intet ankommer                                   |
| Request Body          | Anmodningens indhold                                  | Delstrengsmatch. Objektindhold sammenlignes som kompakt JSON                              |
| Request Header        | Navnene på anmodningens headers                       | Nøjagtigt match mod et headernavn, med små bogstaver                                      |
| Request Header Value  | Værdierne i anmodningens headers                      | Nøjagtigt match mod en headerværdi, med små bogstaver                                     |
| JavaScript Expression | Ethvert udtryk over `requestBody` og `requestHeaders` | Den mest fleksible mulighed — se [JavaScript-udtryk](/docs/monitor/javascript-expression) |

### Filter Conditions

Hver Filter Type tilbyder sit eget sæt betingelser.

For **Incoming Request** (gengivet her med dashboardets stavemåde):

- **Recieved In Minutes** — en anmodning blev modtaget inden for det angivne antal minutter
- **Not Recieved In Minutes** — ingen anmodning blev modtaget inden for det angivne antal minutter

For **Request Body**, **Request Header** og **Request Header Value**: **Contains** og **Not Contains**.

For **JavaScript Expression**: **Evaluates To True**.

> **Note:** Headernavne og headerværdier gøres til små bogstaver før sammenligning, og der matches mod hele navnet eller værdien, ikke en delstreng. Skriv `content-type`, ikke `Content-Type`, og `application/json`, ikke `application/JSON`. Kun **Request Body** laver et reelt delstrengsmatch.

Objektindhold sammenlignes som kompakt JSON uden mellemrum, så et **Request Body** / **Contains**-filter skal skrives `"status":"firing"` — at kopiere `"status": "firing"` fra en formateret payload vil aldrig matche.

### Eksempelkriterier

#### Markér som offline, hvis intet hjerteslag inden for 10 minutter

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### Markér som forringet baseret på anmodningsindhold

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** En monitor revurderes kun i baggrunden, hvis mindst ét af dens kriterier kontrollerer **Incoming Request**. En monitor, hvis kriterier kun kontrollerer Request Body, Request Header eller et JavaScript Expression, vurderes, når en anmodning ankommer, og på intet andet tidspunkt — den kan derfor aldrig gå offline af sig selv. Vil du have en alarm for manglende hjerteslag, skal du bruge et **Incoming Request**-kriterium.

Bemærk også, at en monitor, der aldrig har modtaget en anmodning, behandles, som om dens oprettelsestidspunkt var den seneste anmodning. Et kriterium "Not Recieved In Minutes: 10" på en helt ny monitor udløses 10 minutter efter, du opretter den, selv hvis afsenderen aldrig blev koblet til.

## Modtagelse af alarmer fra et andet system

Alertmanager, Grafana og lignende værktøjer POSTer et JSON-dokument, der beskriver en eller flere alarmer. Som standard åbner et kriterium **én** hændelse, så en payload med fem alarmer ville give en enkelt hændelse. Hændelsesgruppering ændrer det: den udtrækker en værdi fra payloaden og åbner **en separat hændelse per unik værdi**, som alle kan være åbne samtidig.

### Slå hændelsesgruppering til

Åbn kriteriet, fold **Settings** ud, og slå **Group incidents and alerts by a payload field** til. Fire felter dukker op:

| Felt                               | Eksempel                                 | Hvad det gør                                                                               |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | Stien, hvis unikke værdier deler hændelserne op                                            |
| Field that signals recovery        | `requestBody.alerts[*].status`           | Stien, der tjekkes for at afgøre, om en alarm er genoprettet                               |
| Value that means recovered         | `resolved`                               | Den nøjagtige værdi, der markerer genopretning                                             |
| Max incidents per request          | `100` (standard)                         | Sikkerhedsgrænse, så et felt med høj kardinalitet ikke kan åbne ubegrænset mange hændelser |

### Sti-syntaks

Stier skal begynde med det bogstavelige præfiks `requestBody.`. En sti uden det — `alerts[*].labels.alertname` — matcher ingenting, og det sker lydløst. `{{ }}`-indpakningen er valgfri: `requestBody.status` og `{{requestBody.status}}` opfører sig ens.

- `[*]` breder sig ud over et array — én hændelse per **unik** værdi. To elementer, der giver samme værdi, falder sammen til én hændelse, og den hændelses firing/resolved-tilstand tages fra det **første** matchende element. **Kun det første `[*]` i en sti er et jokertegn**; `requestBody.groups[*].alerts[*].name` matcher ingenting.
- `[0]` og `[last]` vælger et enkelt element og må følge efter et `[*]`.
- Objekt- og array-værdier, tomme strenge og null'er springes over. `0` og `false` er gyldige nøgler.

### Løsning er hændelsesdrevet

En webhook beskriver kun det, der er i den payload, så OneUptime løser aldrig en hændelse, fordi dens nøgle er holdt op med at optræde. En hændelse løses kun, når en payload udtrykkeligt siger, at den nøgle er genoprettet. To ting skal begge være opfyldt:

1. **Field that signals recovery** og **Value that means recovered** er sat og matcher payloaden. Sammenligningen er nøjagtig og skelner mellem store og små bogstaver — `Resolved` matcher ikke `resolved`.
2. Kriteriets hændelse har **Auto Resolve Incident** slået til, under **Advanced Options** i hændelsesformularen. Uden det ignoreres matchende genopretningshændelser, og hændelserne forbliver åbne. (Det samme gælder alarmer og **Auto Resolve Alert**.)

**Max incidents per request** begrænser udtrækningen, ikke kun oprettelsen. Nøgler ud over grænsen er også usynlige for genopretning, så i en payload med flere unikke nøgler end grænsen vil en alarm, der melder `resolved` ud over den, ikke lukke sin hændelse.

> **Warning:** Hvis **Field that signals recovery** indeholder `[*]`, men **Open a separate incident for each…** ikke gør, bliver intet nogensinde løst. Brug `[*]` i begge, eller i ingen af dem. En genopretningssti uden `[*]` vurderes mod hele payloaden, så et `status: resolved` på payload-niveau løser alle nøgler i den payload — også alarmer, hvis egen status stadig er firing.

### At navngive hændelserne

Grupperingsnøglen stilles til rådighed for hændelses- og alarmskabeloner som en variabel opkaldt efter **stiens sidste segment**:

| Sti                                      | Variabel          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

Hele payloaden er tilgængelig ved siden af, så en hændelsestitel `{{alertname}}` og en beskrivelse med `{{requestBody.commonAnnotations.summary}}` fungerer begge. Se [Dynamiske hændelses- og alarmskabeloner](/docs/monitor/incident-alert-templating).

> **Warning:** Variabelnavnet er en del af den identitet, OneUptime bruger til at matche en genopretningshændelse med en åben hændelse. Ændrer du grupperingsstien til en med et andet sidste segment, bliver alle hændelser, der aktuelt er åbne under den gamle sti, forældreløse — de kan ikke længere løses automatisk og skal lukkes manuelt.

Bemærk, at `[*]` **kun** virker i de to grupperingssti-felter. Andre steder opløses det ikke, og en uopløst pladsholder udskrives **ordret** i stedet for at blive tømt — en titel `{{requestBody.alerts[*].labels.alertname}}` vises med tuborgklammerne intakte. En titel `{{requestBody.alerts[0].annotations.summary}}` opløses, men læser altid den første alarm i payloaden, ikke den, denne hændelse blev åbnet for. Foretræk grupperingsvariablen sammen med payloadens fælles `commonAnnotations`-felter.

### Gennemarbejdet eksempel

For en fuld Alertmanager-konfiguration, se [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). For Grafana, se [Grafana](/docs/integrations/grafana).

## Bedste praksis

1. **Sæt tidsvinduet passende** — Hvis dit cron-job kører hvert 5. minut, sæt tærsklen "Not Recieved In Minutes" til 10–15 minutter for at tillade lejlighedsvise forsinkelser
2. **Medtag meningsfulde data** — Send statusinformation i anmodningens indhold, så du kan opsætte finkornede kriterier
3. **Brug POST med `Content-Type: application/json`** — alt, der læser inde i indholdet, afhænger af det
4. **Bland ikke de to opgaver på én monitor** — en monitor, der modtager hændelsesdrevne alarmer, har ingen fast kadence, så et "Not Recieved In Minutes"-kriterium på den vil svinge. Brug en separat monitor til dødemandsknappen
5. **Overvåg monitoren** — Sørg for, at tjenesten, der sender anmodningerne, har ordentlig fejlhåndtering, så mislykkede anmodninger ikke går ubemærket hen

## Læs videre

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — en komplet indgående alarmeringsopsætning
- [Grafana](/docs/integrations/grafana) — det samme, for Grafana-alarmering
- [Dynamiske hændelses- og alarmskabeloner](/docs/monitor/incident-alert-templating) — alle variabler til rådighed i titler og beskrivelser
- [JavaScript-udtryk](/docs/monitor/javascript-expression) — udtrykssyntaks og regler for anførselstegn
