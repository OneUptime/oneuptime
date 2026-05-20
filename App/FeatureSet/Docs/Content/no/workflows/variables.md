# Variabler

En arbeidsflyt er bare nyttig når data flyter gjennom den. Variabler er hvordan disse dataene beveger seg — fra triggeren inn i første komponent, fra én komponents output inn i neste komponents input, og fra prosjektnivå-hemmeligheter til hvor enn de blir referert.

OneUptime har to typer variabler og én interpoleringssyntaks som fungerer for begge.

## Globale variabler

Prosjekt-omfattende verdier definert én gang under **Arbeidsflyter → Globale variabler**. Tenk API-nøkler, base-URL-er, kanalnavn — alt du ikke vil hardkode i ti arbeidsflyter.

En global variabel har:

- **Name** — identifikatoren du refererer til den med. Bruk `UPPER_SNAKE_CASE` for å gjøre den synlig i maler.
- **Value** — strengverdien. Flerlinjeverdier støttes.
- **Is Secret** — når på er verdien skrive-bare i UI-et etter lagring og redigeres ut av kjøringslogger.

Referer en global variabel fra hvor som helst i en hvilken som helst arbeidsflyt med:

```
{{variable.NAME}}
```

For eksempel, hvis du definerte `PAGERDUTY_KEY` som en hemmelig variabel, kan hver API-komponent som kaller PagerDuty lese den som `{{variable.PAGERDUTY_KEY}}` uten at noen ser den faktiske nøkkelen i arbeidsflytens JSON.

## Lokale variabler

Lokale variabler er returverdiene til noder som allerede har kjørt i denne utførelsen. Hver trigger og hver komponent publiserer én — se [Triggere](/docs/workflows/triggers) og [Komponenter](/docs/workflows/components) for listene per node.

Referer en lokal variabel som:

```
{{NodeId.fieldName}}
```

`NodeId` er triggerens eller komponentens navn på lerretet (du kan gi det nytt navn for lesbarhet — hold det kort og `PascalCase` så referansene forblir rene). `fieldName` er det noden publiserer.

Eksempler:

- Etter en **API**-komponent kalt `LookupUser` returnerer vellykket, kan nedstrømsnoder lese statuskoden som `{{LookupUser.response-status}}` og den parsede body-en som `{{LookupUser.response-body}}`.
- Etter en **Incident → On Create**-trigger kalt `Incident` kan du lese `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` og en hvilken som helst annen kolonne på hendelsen.
- Etter en **Custom Code**-komponent kalt `Transform` eksponeres den returnerte verdien som `{{Transform.value}}`.

Lokale variabler er begrenset til en enkelt kjøring. Neste kjøring starter med blanke ark.

## Hvor interpolering fungerer

Nesten alle tekst-aktige argumenter støtter interpolering:

- URL-felt på API-komponenten
- Meldingstekst på Slack / Teams / Discord / Telegram / Email
- Emne og body på Email
- Header- og body-felt (bruk det inne i JSON-verdier)
- Venstre og høyre operander på Conditions

Rene JSON-argumenter aksepterer interpolering inne i strengverdier; du kan ikke interpolere en nøkkel. Hvis du må bygge en dynamisk struktur, bruk **Custom Code** for å sette sammen payloaden og deretter mate returverdien dens inn i neste node.

**Custom Code**-komponenten leser variabler annerledes — globale variabler eksponeres på `args.variables`, og oppstrøms returverdier sendes inn som navngitte argumenter du konfigurerer på komponenten.

## Eksempler

### Bygge en payload fra en trigger

En webhook mottar et CI-build-resultat. Body er JSON som `{ "service": "checkout", "status": "failed" }`. For å gjøre det om til en OneUptime-hendelse:

1. **Webhook**-trigger som heter `CIWebhook`.
2. **Conditions**-komponent: venstre `{{CIWebhook.Request Body.status}}`, operator `==`, høyre `failed`.
3. Fra `yes`-porten, en **Create Incident**-komponent med:
   - Tittel: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Beskrivelse: `See {{CIWebhook.Request Body.url}} for the build logs.`

### Bruke en hemmelighet i et utgående API-kall

En arbeidsflyt som kaller PagerDuty:

1. Definer `PAGERDUTY_KEY` som en hemmelig global variabel.
2. På **API**-komponenten, sett `Authorization`-headeren til `Token token={{variable.PAGERDUTY_KEY}}`.

Nøkkelen dukker aldri opp i arbeidsflytens JSON eller i kjøringslogger.

### Lenke sammen to API-kall

Det første kallet returnerer en ID som det andre kallet trenger:

1. **API**-komponent `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-komponent `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Hvis `LookupOrder` returnerer en ikke-2xx-respons, trigges `error`-porten i stedet for `success` — koble den grenen til en Email- eller Slack-komponent slik at feil ikke blir tause.

## Noen fallgruver

- **Skrivefeil i nodenavn bryter referanser stille.** Hvis du gir en node nytt navn etter å ha koblet `{{OldName.field}}` nedstrøms, må du oppdatere hver referanse. Se på kjøringsloggen — hvis du ser den bokstavelige `{{OldName.field}}` i det fangede argumentet, ble ikke oppslaget løst.
- **Hemmeligheter er case-sensitive.** `{{variable.MyKey}}` og `{{variable.mykey}}` er forskjellige variabler.
- **Manglende felt er tomme.** Å referere `{{Foo.nonexistent}}` produserer en tom streng, ikke en feil. Nyttig, men det kan skjule bugs — bruk en **Conditions**-node for å hevde tilstedeværelse hvis feltet er nødvendig for neste trinn.

## Les videre

- [Komponenter](/docs/workflows/components) — den fullstendige katalogen over returverdi-navn.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — inspiser den bokstavelige verdien av hvert interpolerte argument etter en kjøring.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — hva som er trygt å legge i en global variabel.
