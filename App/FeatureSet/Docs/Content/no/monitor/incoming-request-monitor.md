# Innkommende forespørselsmonitor

En innkommende forespørselsmonitor gir deg en URL som andre systemer sender HTTP-forespørsler til. OneUptime vurderer hver forespørsel mot kriteriene dine og kan endre monitorens status, opprette hendelser og varsle vaktrotasjonen din.

Den dekker to ulike oppgaver:

- **Hjerteslag-overvåking** — en cron-jobb, en worker eller en enhet kaller URL-en etter en plan, og OneUptime oppretter en hendelse når hjerteslagene uteblir.
- **Motta varsler fra et annet system** — Prometheus Alertmanager, Grafana eller hva som helst annet som kan POSTe JSON sender varsler inn, og OneUptime gjør hvert av dem om til en hendelse med vakteskalering og automatisk løsning ved gjenoppretting.

Begge bruker samme monitortype. Det som skiller dem, er kriteriene du setter opp.

## Oversikt

Innkommende forespørselsmonitorer tilbyr en unik URL som tjenestene dine kaller. Det lar deg:

- Overvåke cron-jobber og planlagte oppgaver
- Kontrollere at bakgrunns-workere kjører
- Overvåke tjenester bak brannmurer som ikke kan nås utenfra
- Motta varsler fra Prometheus Alertmanager, Grafana og andre varslingssystemer
- Følge hjerteslag-signaler fra ethvert system som kan HTTP

## Opprette en innkommende forespørselsmonitor

1. Gå til **Monitorer** i OneUptime-dashbordet
2. Klikk **Opprett monitor**
3. Velg **Innkommende forespørsel** som monitortype
4. En **Hemmelig nøkkel** og en URL genereres for denne monitoren
5. Åpne monitoren og klikk **Documentation** i venstremenyen for å kopiere URL-en
6. Konfigurer tjenesten din til å sende forespørsler til den URL-en
7. Konfigurer overvåkingskriterier som beskrevet nedenfor

## Forespørsels-URL-en

Monitoren din har en unik URL på formatet:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Erstatt `https://oneuptime.com` med URL-en til din egen OneUptime-instans hvis du er selvhostet.

Send **GET**- eller **POST**-forespørsler til denne URL-en. HEAD godtas og behandles som GET. Andre metoder returnerer 404. Den hemmelige nøkkelen i stien er den eneste legitimasjonen — ingen header eller token kreves.

> **Warning:** Alle som kjenner denne URL-en kan markere monitoren som frisk, så behandle den som en hemmelighet. Hver header du sender lagres på monitoren og er synlig for alle som kan lese den — ikke send API-nøkler eller tokens i headere til dette endepunktet.

OneUptime svarer umiddelbart med en tom `200` og behandler forespørselen i en kø. Det svaret skrives før noen validering skjer, så en `200` er **ikke** en bekreftelse på at forespørselen ble godtatt — en feil hemmelig nøkkel, en slettet monitor og en deaktivert monitor returnerer også `200`. Sjekk monitorens egen tidslinje for å bekrefte at forespørslene kommer frem.

### Sende en forespørselskropp

Hvis du vil adressere felter inne i kroppen — `{{requestBody.status}}` i en hendelsestittel, en JSON-sti i hendelsesgruppering, eller et JavaScript Expression-kriterium — send `Content-Type: application/json`; det er formatet denne dokumentasjonen forutsetter hele veien. En `application/x-www-form-urlencoded`-kropp parses også, men bare til flate felter på øverste nivå. Enhver annen content type, eller ingen, parses ikke, og hver `requestBody`-referanse løses til ingenting.

Kropper opptil 50 MB godtas. Ikke komprimer kroppen med `Content-Encoding: gzip`; den lagres uparset, og stier inn i den vil ikke bli løst.

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
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python-eksempel
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Overvåkingskriterier

Du kan sette opp kriterier for å avgjøre når tjenesten din regnes som tilgjengelig, degradert eller utilgjengelig. Hvert kriteriefilter har en **Filter Type** (hva som ses på), en **Filter Condition** (hvordan det sammenlignes) og en **Value**.

### Tilgjengelige Filter Types

| Filter Type           | Kontrollerer                                           | Merknader                                                                                |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Incoming Request      | Om en forespørsel ble mottatt innenfor et tidsvindu    | Den eneste kontrollen som kan utløses når ingenting kommer inn                           |
| Request Body          | Forespørselskroppen                                    | Delstrengstreff. Objektkropper sammenlignes som kompakt JSON                             |
| Request Header        | Navnene på forespørselens headere                      | Nøyaktig treff mot et headernavn, med små bokstaver                                      |
| Request Header Value  | Verdiene i forespørselens headere                      | Nøyaktig treff mot en headerverdi, med små bokstaver                                     |
| JavaScript Expression | Ethvert uttrykk over `requestBody` og `requestHeaders` | Det mest fleksible valget — se [JavaScript-uttrykk](/docs/monitor/javascript-expression) |

### Filter Conditions

Hver Filter Type tilbyr sitt eget sett med betingelser.

For **Incoming Request** (gjengitt her med dashbordets stavemåte):

- **Recieved In Minutes** — en forespørsel ble mottatt innenfor det angitte antall minutter
- **Not Recieved In Minutes** — ingen forespørsel ble mottatt innenfor det angitte antall minutter

For **Request Body**, **Request Header** og **Request Header Value**: **Contains** og **Not Contains**.

For **JavaScript Expression**: **Evaluates To True**.

> **Note:** Headernavn og headerverdier gjøres om til små bokstaver før sammenligning, og det matches mot hele navnet eller verdien, ikke en delstreng. Skriv `content-type`, ikke `Content-Type`, og `application/json`, ikke `application/JSON`. Bare **Request Body** gjør et reelt delstrengstreff.

Objektkropper sammenlignes som kompakt JSON uten mellomrom, så et **Request Body** / **Contains**-filter må skrives `"status":"firing"` — å kopiere `"status": "firing"` fra en formatert nyttelast vil aldri gi treff.

### Eksempelkriterier

#### Merk som utilgjengelig hvis intet hjerteslag på 10 minutter

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### Merk som degradert basert på forespørselskroppinnhold

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** En monitor revurderes bare i bakgrunnen hvis minst ett av kriteriene kontrollerer **Incoming Request**. En monitor der kriteriene bare kontrollerer Request Body, Request Header eller et JavaScript Expression, vurderes når en forespørsel kommer inn og ikke på noe annet tidspunkt — den kan altså aldri gå utilgjengelig av seg selv. Vil du ha et varsel om manglende hjerteslag, trenger du et **Incoming Request**-kriterium.

Merk også at en monitor som aldri har mottatt en forespørsel, behandles som om opprettelsestidspunktet var den siste forespørselen. Et kriterium «Not Recieved In Minutes: 10» på en helt ny monitor utløses 10 minutter etter at du oppretter den, selv om avsenderen aldri ble koblet til.

## Motta varsler fra et annet system

Alertmanager, Grafana og lignende verktøy POSTer et JSON-dokument som beskriver ett eller flere varsler. Som standard åpner et kriterium **én** hendelse, så en nyttelast med fem varsler ville gi én enkelt hendelse. Hendelsesgruppering endrer dette: den henter ut en verdi fra nyttelasten og åpner **én separat hendelse per unike verdi**, som alle kan være åpne samtidig.

### Slå på hendelsesgruppering

Åpne kriteriet, utvid **Settings** og slå på **Group incidents and alerts by a payload field**. Fire felt dukker opp:

| Felt                               | Eksempel                                 | Hva det gjør                                                                                 |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | Stien hvis unike verdier deler hendelsene fra hverandre                                      |
| Field that signals recovery        | `requestBody.alerts[*].status`           | Stien som sjekkes for å avgjøre at et varsel er gjenopprettet                                |
| Value that means recovered         | `resolved`                               | Den nøyaktige verdien som markerer gjenoppretting                                            |
| Max incidents per request          | `100` (standard)                         | Sikkerhetsgrense slik at et felt med høy kardinalitet ikke kan åpne ubegrenset med hendelser |

### Sti-syntaks

Stier må begynne med det bokstavelige prefikset `requestBody.`. En sti uten det — `alerts[*].labels.alertname` — matcher ingenting, og det skjer lydløst. `{{ }}`-innpakningen er valgfri: `requestBody.status` og `{{requestBody.status}}` oppfører seg likt.

- `[*]` brer seg ut over en matrise — én hendelse per **unike** verdi. To elementer som gir samme verdi faller sammen til én hendelse, og den hendelsens firing/resolved-tilstand tas fra det **første** matchende elementet. **Bare det første `[*]` i en sti er et jokertegn**; `requestBody.groups[*].alerts[*].name` matcher ingenting.
- `[0]` og `[last]` velger ett enkelt element, og kan følge etter et `[*]`.
- Objekt- og matriseverdier, tomme strenger og null-verdier hoppes over. `0` og `false` er gyldige nøkler.

### Løsning er hendelsesdrevet

En webhook beskriver bare det som ligger i den nyttelasten, så OneUptime løser aldri en hendelse fordi nøkkelen dens har sluttet å dukke opp. En hendelse løses bare når en nyttelast uttrykkelig sier at den nøkkelen er gjenopprettet. To ting må begge være oppfylt:

1. **Field that signals recovery** og **Value that means recovered** er satt og stemmer med nyttelasten. Sammenligningen er nøyaktig og skiller mellom store og små bokstaver — `Resolved` matcher ikke `resolved`.
2. Kriteriets hendelse har **Auto Resolve Incident** slått på, under **Advanced Options** i hendelsesskjemaet. Uten det ignoreres matchende gjenopprettingshendelser, og hendelsene forblir åpne. (Det samme gjelder varsler og **Auto Resolve Alert**.)

**Max incidents per request** begrenser uthentingen, ikke bare opprettelsen. Nøkler forbi grensen er også usynlige for gjenoppretting, så i en nyttelast med flere unike nøkler enn grensen vil et varsel som melder `resolved` forbi den, ikke lukke hendelsen sin.

> **Warning:** Hvis **Field that signals recovery** inneholder `[*]`, men **Open a separate incident for each…** ikke gjør det, blir ingenting noen gang løst. Bruk `[*]` i begge, eller i ingen av dem. En gjenopprettingssti uten `[*]` vurderes mot hele nyttelasten, så en `status: resolved` på nyttelastnivå løser hver nøkkel i den nyttelasten — også varsler hvis egen status fortsatt er firing.

### Å navngi hendelsene

Grupperingsnøkkelen eksponeres for hendelses- og varselmaler som en variabel oppkalt etter **stiens siste segment**:

| Sti                                      | Variabel          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

Hele nyttelasten er tilgjengelig ved siden av, så en hendelsestittel `{{alertname}}` og en beskrivelse som viser til `{{requestBody.commonAnnotations.summary}}` fungerer begge. Se [Dynamiske hendelses- og varselmaler](/docs/monitor/incident-alert-templating).

> **Warning:** Variabelnavnet er en del av identiteten OneUptime bruker for å koble en gjenopprettingshendelse til en åpen hendelse. Endrer du grupperingsstien til en med et annet siste segment, blir alle hendelser som nå står åpne under den gamle stien foreldreløse — de kan ikke lenger løses automatisk og må lukkes for hånd.

Merk at `[*]` **bare** virker i de to grupperingssti-feltene. Andre steder løses det ikke, og en uløst plassholder skrives ut **ordrett** i stedet for å tømmes — en tittel `{{requestBody.alerts[*].labels.alertname}}` vises med krøllparentesene intakt. En tittel `{{requestBody.alerts[0].annotations.summary}}` løses, men leser alltid det første varselet i nyttelasten, ikke det denne hendelsen ble åpnet for. Foretrekk grupperingsvariabelen sammen med nyttelastens felles `commonAnnotations`-felt.

### Utarbeidet eksempel

For en fullstendig Alertmanager-konfigurasjon, se [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). For Grafana, se [Grafana](/docs/integrations/grafana).

## Beste praksis

1. **Sett tidsvinduet passende** — Hvis cron-jobben din kjører hvert 5. minutt, sett terskelen «Not Recieved In Minutes» til 10–15 minutter for å tåle enkelte forsinkelser
2. **Ta med meningsfulle data** — Send statusinformasjon i forespørselskroppen slik at du kan sette opp finmaskede kriterier
3. **Bruk POST med `Content-Type: application/json`** — alt som leser inne i kroppen avhenger av det
4. **Ikke bland de to oppgavene på én monitor** — en monitor som mottar hendelsesdrevne varsler har ingen fast takt, så et «Not Recieved In Minutes»-kriterium på den vil vippe frem og tilbake. Bruk en egen monitor til dødmannsknappen
5. **Overvåk monitoren** — Sørg for at tjenesten som sender forespørslene har skikkelig feilhåndtering, slik at mislykkede forespørsler ikke går ubemerket hen

## Hvor du leser videre

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — et komplett innkommende varslingsoppsett
- [Grafana](/docs/integrations/grafana) — det samme, for Grafana-varsling
- [Dynamiske hendelses- og varselmaler](/docs/monitor/incident-alert-templating) — alle variabler tilgjengelige i titler og beskrivelser
- [JavaScript-uttrykk](/docs/monitor/javascript-expression) — uttrykkssyntaks og regler for anførselstegn
