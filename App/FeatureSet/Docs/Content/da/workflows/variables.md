# Workflow-variabler

Et workflow er kun nyttigt, når data flyder igennem det. Variabler er den måde, data bevæger sig på — fra triggeren ind i den første komponent, fra én komponents output ind i den næste komponents input, og fra projektniveau-hemmeligheder ind, hvor end de refereres.

OneUptime har to slags variabler og én interpolations-syntaks, der virker for begge.

## Globale variabler

Projektomfattende værdier defineret én gang under **Workflows → Global Variables**. Tænk på API-nøgler, base-URL'er, kanalnavne, alt hvad du ikke vil hardkode ind i ti workflows.

En global variabel har:

- **Name** — den identifikator, du refererer den med. Brug `UPPER_SNAKE_CASE` for at gøre den tydelig i skabeloner.
- **Value** — strengværdien. Flerlinjede værdier understøttes.
- **Is Secret** — når den er slået til, er værdien write-only i UI'et efter gem og redigeres bort fra kørselslogfiler.

Referér en global variabel fra hvor som helst i ethvert workflow med:

```
{{variable.NAME}}
```

Hvis du for eksempel har defineret `PAGERDUTY_KEY` som en hemmelig variabel, kan enhver API-komponent, der kalder PagerDuty, læse den som `{{variable.PAGERDUTY_KEY}}` uden at nogen ser den faktiske nøgle i workflow-JSON'en.

## Lokale variabler

Lokale variabler er returværdier fra noder, der allerede har kørt i denne eksekvering. Hver trigger og hver komponent publicerer én — se [Workflow-triggere](/docs/workflows/triggers) og [Workflow-komponenter](/docs/workflows/components) for listerne pr. node.

Referér en lokal variabel som:

```
{{NodeId.fieldName}}
```

`NodeId` er triggerens eller komponentens navn på lærredet (du kan omdøbe den for læsbarhed — hold det kort og `PascalCase`, så referencerne forbliver rene). `fieldName` er, hvad end noden publicerer.

Eksempler:

- Efter en **API**-komponent ved navn `LookupUser` returnerer succesfuldt, kan nedstrøms noder læse dens statuskode som `{{LookupUser.response-status}}` og den parsede body som `{{LookupUser.response-body}}`.
- Efter en **Incident → On Create**-trigger ved navn `Incident` kan du læse `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` og enhver anden kolonne på hændelsen.
- Efter en **Custom Code**-komponent ved navn `Transform` eksponeres den returnerede værdi som `{{Transform.value}}`.

Lokale variabler er afgrænset til en enkelt kørsel. Næste kørsel starter med blanke ark.

## Hvor interpolation virker

Næsten alle tekst-stil-argumenter understøtter interpolation:

- URL-felter på API-komponenten
- Beskedtekst på Slack / Teams / Discord / Telegram / E-mail
- Emne og body på E-mail
- Header- og body-felter (brug det inde i JSON-værdier)
- Venstre og højre operander på Conditions

Rene JSON-argumenter accepterer interpolation inde i strengværdier; du kan ikke interpolere en nøgle. Hvis du har brug for at bygge en dynamisk struktur, så brug **Custom Code** til at samle payloaden og pipe så dens returværdi ind i næste node.

Komponenten **Custom Code** læser variabler anderledes — globale variabler eksponeres på `args.variables`, og opstrøms returværdier sendes ind som navngivne argumenter, som du konfigurerer på komponenten.

## Eksempler

### Byg en payload ud fra en trigger

En webhook modtager et CI-build-resultat. Bodyen er JSON som `{ "service": "checkout", "status": "failed" }`. For at gøre det til en OneUptime-hændelse:

1. **Webhook**-trigger ved navn `CIWebhook`.
2. **Conditions**-komponent: venstre `{{CIWebhook.Request Body.status}}`, operator `==`, højre `failed`.
3. Fra `yes`-porten, en **Create Incident**-komponent med:
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the build logs.`

### Brug en hemmelighed i et udgående API-kald

Et workflow der kalder PagerDuty:

1. Definér `PAGERDUTY_KEY` som en hemmelig global variabel.
2. På **API**-komponenten sættes `Authorization`-headeren til `Token token={{variable.PAGERDUTY_KEY}}`.

Nøglen optræder aldrig i workflow-JSON'en eller i kørselslogfiler.

### Kæd to API-kald sammen

Det første kald returnerer et ID, som det andet kald har brug for:

1. **API**-komponent `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API**-komponent `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Hvis `LookupOrder` returnerer en ikke-2xx-respons, udløses dens `error`-port i stedet for `success` — kobl den gren til en E-mail- eller Slack-komponent, så fejl ikke forbliver lydløse.

## Et par faldgruber

- **Tastefejl i nodenavne bryder referencer lydløst.** Hvis du omdøber en node efter at have koblet `{{OldName.field}}` nedstrøms, så opdatér hver reference. Kig i kørselsloggen — hvis du ser den literal `{{OldName.field}}` i det opfangede argument, kunne opslaget ikke løses.
- **Hemmeligheder skelner mellem store og små bogstaver.** `{{variable.MyKey}}` og `{{variable.mykey}}` er forskellige variabler.
- **Manglende felter er tomme.** At referere `{{Foo.nonexistent}}` producerer en tom streng, ikke en fejl. Praktisk, men det kan skjule bugs — brug en **Conditions**-node til at sikre tilstedeværelse, hvis feltet er påkrævet for det næste trin.

## Læs videre

- [Workflow-komponenter](/docs/workflows/components) — det fulde katalog af returværdi-navne.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — inspicér den literal-værdi af hvert interpoleret argument efter en kørsel.
- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — hvad der er sikkert at lægge i en global variabel.
